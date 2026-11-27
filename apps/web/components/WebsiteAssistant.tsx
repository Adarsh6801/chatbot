"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Compass, MousePointerClick, RotateCcw, Send, X } from "lucide-react";
import { api } from "@/lib/api";
import SlotyIcon from "./SlotyIcon";
import "./website-assistant.css";

type ActionItem =
  | { type: "redirect"; label: string; route: string; auto?: boolean }
  | { type: "walkthrough"; label: string; walkthrough_slug: string };

type CitationItem = {
  index: number;
  source: string;
  url?: string | null;
  excerpt: string;
};

type BotMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ActionItem[];
  citations?: CitationItem[];
  created_at?: string;
};

type WalkthroughStep = {
  title: string;
  instruction: string;
  route: string;
  selector?: string;
  action_label?: string;
  auto_advance_on_click?: boolean;
};

type WalkthroughGuide = {
  id: string;
  slug: string;
  title: string;
  description: string;
  steps: WalkthroughStep[];
};

type BotConfig = {
  enabled: boolean;
  name: string;
  tagline: string;
  greeting: string;
  accent_color: string;
  position: "right" | "left";
  suggested_prompts: string[];
  walkthroughs: WalkthroughGuide[];
};

const VISITOR_KEY = "agentforge_site_visitor_id";
const TOUR_KEY = "agentforge_site_tour";

function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "site-visitor";
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id || id.length < 8) {
    id = "sv_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

function renderFormattedCopy(text: string) {
  const blocks = (text || "").split(/\n\n+/);
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });

  return (
    <div className="sitebot-copy">
      {blocks.map((block, bIdx) => {
        const lines = block.split("\n");
        if (lines.every((l) => l.trim().startsWith("- "))) {
          return (
            <ul key={bIdx}>
              {lines.map((l, lIdx) => (
                <li key={lIdx}>{inline(l.trim().slice(2))}</li>
              ))}
            </ul>
          );
        }
        return <p key={bIdx}>{lines.map((l, lIdx) => <span key={lIdx}>{lIdx > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </div>
  );
}

export default function WebsiteAssistant() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const isStandaloneBotPage = pathname.startsWith("/chat/") || pathname.startsWith("/widget/");

  const [config, setConfig] = useState<BotConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [showGuides, setShowGuides] = useState(false);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Active pulsating tour state
  const [activeTour, setActiveTour] = useState<{ slug: string; stepIndex: number } | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadConfigAndHistory = useCallback(async () => {
    try {
      const cfg = await api<BotConfig>("/site-bot/config", { cache: "no-store" });
      setConfig(cfg);
      if (!cfg.enabled) return;
      const vid = getOrCreateVisitorId();
      const hist = await api<{ conversation_id: string | null; messages: BotMessage[] }>(
        `/site-bot/history?visitor_id=${encodeURIComponent(vid)}`,
        { cache: "no-store" },
      );
      setConversationId(hist.conversation_id);
      if (hist.messages?.length) {
        setMessages(hist.messages);
      } else {
        setMessages([{ id: "greeting", role: "assistant", content: cfg.greeting }]);
      }
    } catch {
      // Fail quietly if API is temporarily unreachable so marketing pages never break.
    }
  }, []);

  useEffect(() => {
    if (isStandaloneBotPage) return;
    void loadConfigAndHistory();
    try {
      const savedTour = sessionStorage.getItem(TOUR_KEY);
      if (savedTour) {
        const parsed = JSON.parse(savedTour);
        if (parsed?.slug && typeof parsed.stepIndex === "number") {
          setActiveTour(parsed);
        }
      }
    } catch {
      // ignore storage issues
    }
  }, [isStandaloneBotPage, loadConfigAndHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, showGuides]);

  const activeGuide = useMemo(() => {
    if (!activeTour || !config) return null;
    return config.walkthroughs.find((g) => g.slug === activeTour.slug) || null;
  }, [activeTour, config]);

  const currentStep = useMemo(() => {
    if (!activeGuide || !activeTour) return null;
    return activeGuide.steps[activeTour.stepIndex] || null;
  }, [activeGuide, activeTour]);

  const updateTour = useCallback((next: { slug: string; stepIndex: number } | null) => {
    setActiveTour(next);
    setTargetRect(null);
    try {
      if (next) sessionStorage.setItem(TOUR_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(TOUR_KEY);
    } catch {
      // ignore
    }
  }, []);

  const startWalkthrough = useCallback(
    (slug: string) => {
      const guide = config?.walkthroughs.find((g) => g.slug === slug);
      if (!guide || !guide.steps.length) return;
      const first = guide.steps[0];
      updateTour({ slug, stepIndex: 0 });
      setShowGuides(false);
      setOpen(false);
      if (first.route && pathname !== first.route && !pathname.startsWith(first.route + "/")) {
        router.push(first.route);
      }
    },
    [config, pathname, router, updateTour],
  );

  // Sync walkthrough navigation & locate spotlight element on current page
  useEffect(() => {
    if (!currentStep || !activeGuide || !activeTour) {
      setTargetRect(null);
      return;
    }
    const matchesRoute =
      !currentStep.route ||
      pathname === currentStep.route ||
      (currentStep.route !== "/" && pathname.startsWith(currentStep.route + "/"));

    if (!matchesRoute) {
      setTargetRect(null);
      router.push(currentStep.route);
      return;
    }

    let attachedElement: Element | null = null;
    let scrolledOnce = false;

    const handleTargetClick = () => {
      if (!currentStep.auto_advance_on_click) return;
      const nextIndex = activeTour.stepIndex + 1;
      if (nextIndex < activeGuide.steps.length) {
        updateTour({ slug: activeGuide.slug, stepIndex: nextIndex });
      } else {
        updateTour(null);
      }
    };

    const locate = () => {
      if (!currentStep.selector) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector(currentStep.selector);
      if (!el) {
        setTargetRect(null);
        return;
      }
      if (!scrolledOnce) {
        scrolledOnce = true;
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setTargetRect(rect);
      }
      if (attachedElement !== el) {
        attachedElement?.removeEventListener("click", handleTargetClick);
        attachedElement = el;
        el.addEventListener("click", handleTargetClick);
      }
    };

    locate();
    const timer = window.setInterval(locate, 350);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
      observer.disconnect();
      attachedElement?.removeEventListener("click", handleTargetClick);
    };
  }, [currentStep, activeGuide, activeTour, pathname, router, updateTour]);

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || sending || !config) return;
    setError("");
    setShowGuides(false);
    setSending(true);
    const optimistic: BotMessage = { id: "temp-" + Date.now(), role: "user", content: clean };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const res = await api<{ conversation_id: string; bot_name: string; message: BotMessage }>("/site-bot/chat", {
        method: "POST",
        body: JSON.stringify({
          message: clean,
          visitor_id: getOrCreateVisitorId(),
          conversation_id: conversationId,
          current_page: pathname,
        }),
      });
      setConversationId(res.conversation_id);
      if (res.bot_name && res.bot_name !== config.name) {
        setConfig((c) => (c ? { ...c, name: res.bot_name } : c));
      }
      setMessages((prev) => [...prev, res.message]);

      const autoRedir = res.message.actions?.find((a): a is Extract<ActionItem, { type: "redirect" }> => a.type === "redirect" && !!a.auto);
      if (autoRedir && autoRedir.route !== pathname) {
        window.setTimeout(() => router.push(autoRedir.route), 550);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function resetChat() {
    if (!config) return;
    const nextVid = "sv_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(VISITOR_KEY, nextVid);
    setConversationId(null);
    setMessages([{ id: "greeting", role: "assistant", content: config.greeting }]);
    setShowGuides(false);
    setError("");
  }

  if (isStandaloneBotPage || !config || !config.enabled) return null;

  const side = config.position === "left" ? "left" : "right";
  const accentStyle = { "--sitebot-accent": config.accent_color || "#bf5b00" } as CSSProperties;

  // Position tour companion card gracefully near the highlighted element or centered at bottom
  const tourCardStyle: CSSProperties = (() => {
    if (!targetRect || typeof window === "undefined") {
      return { bottom: 22, left: "50%", transform: "translateX(-50%)" };
    }
    const cardHeight = 220;
    const placeAbove = targetRect.bottom + cardHeight + 24 > window.innerHeight && targetRect.top > cardHeight + 20;
    const left = Math.max(12, Math.min(window.innerWidth - 377, targetRect.left));
    if (placeAbove) {
      return { bottom: Math.max(14, window.innerHeight - targetRect.top + 14), left };
    }
    return { top: Math.min(window.innerHeight - cardHeight - 14, targetRect.bottom + 14), left };
  })();

  return (
    <div style={accentStyle}>
      {!open && (
        <button type="button" className={`sitebot-launcher ${side}`} onClick={() => setOpen(true)} aria-label={`Chat with ${config.name}`}>
          <span className="sitebot-launcher-orb">
            <SlotyIcon size={23} />
            <span className="sitebot-launcher-dot" />
          </span>
          <span>Ask {config.name}</span>
        </button>
      )}

      {open && (
        <section className={`sitebot-panel ${side}`} role="dialog" aria-label={`${config.name} assistant`}>
          <header className="sitebot-head">
            <div className="sitebot-head-id">
              <div className="sitebot-head-avatar"><SlotyIcon size={25} /></div>
              <div>
                <h3>{config.name}</h3>
                <p>{config.tagline || "Companion & interactive guide"}</p>
              </div>
            </div>
            <div className="sitebot-head-actions">
              <button
                type="button"
                className={`sitebot-icon-btn ${showGuides ? "active" : ""}`}
                onClick={() => setShowGuides((v) => !v)}
                title="Browse interactive walkthrough guides"
              >
                <Compass size={13} /> Guides
              </button>
              <button type="button" className="sitebot-icon-btn" onClick={resetChat} title="Start fresh conversation" aria-label="Reset chat">
                <RotateCcw size={13} />
              </button>
              <button type="button" className="sitebot-icon-btn" onClick={() => setOpen(false)} aria-label="Minimize assistant">
                <X size={14} />
              </button>
            </div>
          </header>

          <div className="sitebot-messages">
            {showGuides ? (
              <div className="sitebot-guides-view">
                <p style={{ margin: 0, fontSize: 12, color: "#5f697d" }}>
                  Pick any interactive guide below — {config.name} will take you to the right page and pulse on what to click next!
                </p>
                {config.walkthroughs.map((guide) => (
                  <div className="sitebot-guide-item" key={guide.slug}>
                    <strong>{guide.title}</strong>
                    <p>{guide.description}</p>
                    <button type="button" className="sitebot-action-btn guide" onClick={() => startWalkthrough(guide.slug)}>
                      <MousePointerClick size={14} /> Start {guide.steps.length}-step guide
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {messages.map((m) => (
                  <div key={m.id} className={`sitebot-bubble ${m.role}`}>
                    {renderFormattedCopy(m.content)}
                    {m.actions && m.actions.length > 0 && (
                      <div className="sitebot-actions">
                        {m.actions.map((act, idx) =>
                          act.type === "walkthrough" ? (
                            <button key={idx} type="button" className="sitebot-action-btn guide" onClick={() => startWalkthrough(act.walkthrough_slug)}>
                              <MousePointerClick size={14} /> {act.label}
                            </button>
                          ) : (
                            <button key={idx} type="button" className="sitebot-action-btn" onClick={() => router.push(act.route)}>
                              <ArrowRight size={14} /> {act.label}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                    {m.citations && m.citations.length > 0 && (
                      <details className="sitebot-citations">
                        <summary>{m.citations.length} platform &amp; API sources</summary>
                        {m.citations.map((c, idx) => (
                          <div className="sitebot-citation-item" key={idx}>
                            {c.url ? (
                              <button type="button" className="sitebot-citation-link" onClick={() => router.push(c.url!)}>
                                <BookOpen size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                                {c.source}
                              </button>
                            ) : (
                              <strong>{c.source}</strong>
                            )}
                            <span>{c.excerpt}</span>
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                ))}

                {messages.length <= 1 && config.suggested_prompts.length > 0 && (
                  <div className="sitebot-prompts">
                    {config.suggested_prompts.map((prompt) => (
                      <button key={prompt} type="button" className="sitebot-prompt-chip" onClick={() => void sendMessage(prompt)}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {error && <div className="sitebot-tour-hint">{error}</div>}
            <div ref={messagesEndRef} />
          </div>

          <form className="sitebot-form" onSubmit={handleSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask ${config.name} anything or say "guide me"…`}
              maxLength={3000}
              disabled={sending}
            />
            <button type="submit" className="sitebot-send-btn" disabled={sending || !input.trim()} aria-label="Send message">
              <Send size={15} />
            </button>
          </form>
        </section>
      )}

      {currentStep && activeGuide && activeTour && (
        <>
          {targetRect && (
            <div
              className="sitebot-spotlight-ring"
              style={{
                top: Math.max(4, targetRect.top - 5),
                left: Math.max(4, targetRect.left - 5),
                width: targetRect.width + 10,
                height: targetRect.height + 10,
              }}
            >
              <span className="sitebot-spotlight-badge">
                <MousePointerClick size={12} /> {currentStep.action_label || "Click here"}
              </span>
            </div>
          )}

          <aside className="sitebot-tour-card" style={tourCardStyle} role="dialog" aria-label="Interactive walkthrough">
            <div className="sitebot-tour-top">
              <span className="sitebot-tour-pill">
                <SlotyIcon size={15} /> {config.name} · Step {activeTour.stepIndex + 1} of {activeGuide.steps.length}
              </span>
              <button type="button" className="sitebot-tour-close" onClick={() => updateTour(null)} aria-label="Close guide">
                <X size={16} />
              </button>
            </div>
            <h4>{currentStep.title}</h4>
            <p>{currentStep.instruction}</p>
            {!targetRect && currentStep.selector && (
              <div className="sitebot-tour-hint">
                If you aren&apos;t signed in yet or don&apos;t see the highlighted button on <code>{currentStep.route}</code>, sign in first or click Next step when ready.
              </div>
            )}
            <div className="sitebot-tour-footer">
              <button type="button" className="sitebot-tour-btn" onClick={() => { setOpen(true); setShowGuides(false); }}>
                Ask {config.name}
              </button>
              <div className="sitebot-tour-footer-btns">
                <button
                  type="button"
                  className="sitebot-tour-btn"
                  disabled={activeTour.stepIndex === 0}
                  onClick={() => updateTour({ slug: activeGuide.slug, stepIndex: activeTour.stepIndex - 1 })}
                >
                  Back
                </button>
                {activeTour.stepIndex + 1 < activeGuide.steps.length ? (
                  <button
                    type="button"
                    className="sitebot-tour-btn primary"
                    onClick={() => updateTour({ slug: activeGuide.slug, stepIndex: activeTour.stepIndex + 1 })}
                  >
                    Next step
                  </button>
                ) : (
                  <button type="button" className="sitebot-tour-btn primary" onClick={() => updateTour(null)}>
                    Finish guide
                  </button>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
