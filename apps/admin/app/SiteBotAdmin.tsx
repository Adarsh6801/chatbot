"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, Bot, CheckCircle2, ChevronRight, Compass, FileText, Globe, MessageSquareText, Plus, RefreshCw, Search, ShieldAlert, Trash2, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import SlotyIcon from "./SlotyIcon";
import "./site-bot.css";

type SubTab = "settings" | "knowledge" | "walkthroughs" | "conversations";

type StepDraft = {
  title: string;
  instruction: string;
  route: string;
  selector: string;
  action_label: string;
  auto_advance_on_click: boolean;
};

const SELECTOR_PRESETS = [
  { label: "Custom selector…", value: "" },
  { label: "My Agents → Create agent button", value: "[data-tour='create-agent-btn']" },
  { label: "My Agents → First agent card", value: "[data-tour='agent-card']" },
  { label: "Agent Workspace → Knowledge tab", value: "[data-tour='tab-knowledge']" },
  { label: "Knowledge → Add / Upload panel", value: "[data-tour='knowledge-add-box']" },
  { label: "Agent Workspace → Workflow tab", value: "[data-tour='tab-workflow']" },
  { label: "Agent Workspace → Playground tab", value: "[data-tour='tab-playground']" },
  { label: "Agent Workspace → Deploy tab", value: "[data-tour='tab-deploy']" },
  { label: "Deploy → Publish agent button", value: "[data-tour='publish-agent-btn']" },
  { label: "API Keys → Create key button", value: "[data-tour='create-api-key-btn']" },
  { label: "API Docs → Reference navigation", value: "[data-tour='api-docs-nav']" },
  { label: "Landing → Start building CTA", value: "[data-tour='hero-start-btn']" },
];

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function SiteBotAdmin({ refreshToken }: { refreshToken: number }) {
  const [tab, setTab] = useState<SubTab>("settings");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Settings form state
  const [cfg, setCfg] = useState({
    enabled: true,
    name: "Sloty",
    tagline: "",
    greeting: "",
    system_prompt: "",
    accent_color: "#bf5b00",
    position: "right" as "right" | "left",
    include_api_docs: true,
    promptsText: "",
  });

  // Knowledge add/edit state
  const [newKb, setNewKb] = useState({ title: "", content: "" });
  const [pdfTitle, setPdfTitle] = useState("");
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [editingKbForm, setEditingKbForm] = useState({ title: "", content: "", enabled: true });

  // Walkthrough create/edit state
  const [editingGuideId, setEditingGuideId] = useState<string | "new" | null>(null);
  const [guideForm, setGuideForm] = useState<{
    slug: string;
    title: string;
    description: string;
    keywordsText: string;
    enabled: boolean;
    position: number;
    steps: StepDraft[];
  }>({
    slug: "",
    title: "",
    description: "",
    keywordsText: "",
    enabled: true,
    position: 1,
    steps: [],
  });

  // Conversations state
  const [convSearch, setConvSearch] = useState("");
  const [convSubmitted, setConvSubmitted] = useState("");
  const [convPage, setConvPage] = useState(1);
  const [convs, setConvs] = useState<{ items: any[]; total: number; page: number; limit: number } | null>(null);
  const [selectedConv, setSelectedConv] = useState<any>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<any>("/admin/site-bot");
      setData(res);
      setCfg({
        enabled: !!res.config.enabled,
        name: res.config.name || "Sloty",
        tagline: res.config.tagline || "",
        greeting: res.config.greeting || "",
        system_prompt: res.config.system_prompt || "",
        accent_color: res.config.accent_color || "#bf5b00",
        position: res.config.position === "left" ? "left" : "right",
        include_api_docs: !!res.config.include_api_docs,
        promptsText: (res.config.suggested_prompts || []).join("\n"),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(convPage), limit: "25" });
      if (convSubmitted) params.set("q", convSubmitted);
      setConvs(await api<any>(`/admin/site-bot/conversations?${params.toString()}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [convPage, convSubmitted]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, refreshToken]);

  useEffect(() => {
    if (tab === "conversations") void loadConversations();
  }, [tab, loadConversations, refreshToken]);

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const prompts = cfg.promptsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
      await api("/admin/site-bot/config", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: cfg.enabled,
          name: cfg.name,
          tagline: cfg.tagline,
          greeting: cfg.greeting,
          system_prompt: cfg.system_prompt,
          accent_color: cfg.accent_color,
          position: cfg.position,
          include_api_docs: cfg.include_api_docs,
          suggested_prompts: prompts,
        }),
      });
      await loadOverview();
      setNotice("Website bot settings saved and logged.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createKbEntry(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/admin/site-bot/knowledge", {
        method: "POST",
        body: JSON.stringify({ title: newKb.title, content: newKb.content, enabled: true }),
      });
      setNewKb({ title: "", content: "" });
      await loadOverview();
      setNotice("Knowledge entry indexed and added.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdfOrDoc(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const query = pdfTitle.trim() ? `?title=${encodeURIComponent(pdfTitle.trim())}` : "";
      await api(`/admin/site-bot/knowledge/upload${query}`, { method: "POST", body: form });
      setPdfTitle("");
      await loadOverview();
      setNotice(`Uploaded & indexed “${file.name}”.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveKbEdit(itemId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/admin/site-bot/knowledge/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify(editingKbForm),
      });
      setEditingKbId(null);
      await loadOverview();
      setNotice("Knowledge entry updated & re-indexed.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleKbItem(item: any) {
    setBusy(true);
    setError("");
    try {
      await api(`/admin/site-bot/knowledge/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      await loadOverview();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteKbItem(item: any) {
    if (!window.confirm(`Delete knowledge source “${item.title}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/site-bot/knowledge/${item.id}`, { method: "DELETE" });
      await loadOverview();
      setNotice(`Deleted “${item.title}”.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startGuideEditor(guide?: any) {
    if (!guide) {
      setEditingGuideId("new");
      setGuideForm({
        slug: "",
        title: "",
        description: "",
        keywordsText: "guide, walkthrough, help",
        enabled: true,
        position: (data?.walkthroughs?.length || 0) + 1,
        steps: [
          {
            title: "Step 1 · Highlight target",
            instruction: "Explain kindly what the user should click here and why.",
            route: "/agents",
            selector: "[data-tour='create-agent-btn']",
            action_label: "Click here",
            auto_advance_on_click: true,
          },
        ],
      });
      return;
    }
    setEditingGuideId(guide.id);
    setGuideForm({
      slug: guide.slug,
      title: guide.title,
      description: guide.description || "",
      keywordsText: (guide.keywords || []).join(", "),
      enabled: !!guide.enabled,
      position: guide.position ?? 1,
      steps: (guide.steps || []).map((s: any) => ({
        title: s.title || "",
        instruction: s.instruction || "",
        route: s.route || "/agents",
        selector: s.selector || "",
        action_label: s.action_label || "Next step",
        auto_advance_on_click: s.auto_advance_on_click !== false,
      })),
    });
  }

  async function saveGuide(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const payload = {
      slug: guideForm.slug,
      title: guideForm.title,
      description: guideForm.description,
      keywords: guideForm.keywordsText.split(",").map((s) => s.trim()).filter(Boolean),
      enabled: guideForm.enabled,
      position: Number(guideForm.position || 0),
      steps: guideForm.steps,
    };
    try {
      if (editingGuideId === "new") {
        await api("/admin/site-bot/walkthroughs", { method: "POST", body: JSON.stringify(payload) });
        setNotice("Walkthrough guide created.");
      } else if (editingGuideId) {
        await api(`/admin/site-bot/walkthroughs/${editingGuideId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setNotice("Walkthrough guide updated.");
      }
      setEditingGuideId(null);
      await loadOverview();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteGuide(guide: any) {
    if (!window.confirm(`Delete walkthrough “${guide.title}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/site-bot/walkthroughs/${guide.id}`, { method: "DELETE" });
      await loadOverview();
      setNotice(`Deleted walkthrough “${guide.title}”.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openConversationDetail(convId: string) {
    try {
      setSelectedConv(await api(`/admin/site-bot/conversations/${convId}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading && !data) {
    return <div className="loading-card">Loading website assistant configuration…</div>;
  }

  const stats = data?.stats || { conversations: 0, messages: 0, logged_in_conversations: 0, knowledge_sources: 0, knowledge_chunks: 0 };

  return (
    <div className="sitebot-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WEBSITE COMPANION ASSISTANT</p>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "#f7f8f4", border: "1px solid var(--line)", display: "grid", placeItems: "center" }}>
              <SlotyIcon size={30} />
            </div>
            <h1>{cfg.name || "Sloty"} Control Center</h1>
          </div>
          <p className="subtle">
            Configure your website chatbot name, personality, PDF &amp; knowledge sources, API documentation access, pulsating interactive walkthroughs, and inspect visitor conversations with IP, device, and signed-in user details.
          </p>
        </div>
      </div>

      {error && <div className="error-banner"><ShieldAlert size={16} />{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
      {notice && <div className="error-banner" style={{ borderColor: "#cde9dd", background: "#f4fbf7", color: "#137759" }}><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}

      <div className="sitebot-stats">
        <div className="metric-card"><div className="metric-label"><Bot size={16} />Bot Name</div><strong>{cfg.name}</strong><small>{cfg.enabled ? "Visible across website" : "Hidden on website"}</small></div>
        <div className="metric-card"><div className="metric-label"><MessageSquareText size={16} />Conversations</div><strong>{stats.conversations}</strong><small>{stats.logged_in_conversations} signed-in · {stats.messages} messages</small></div>
        <div className="metric-card"><div className="metric-label"><BookOpen size={16} />Knowledge Base</div><strong>{stats.knowledge_sources}</strong><small>{stats.knowledge_chunks} indexed chunks {cfg.include_api_docs ? "+ API Docs" : ""}</small></div>
        <div className="metric-card"><div className="metric-label"><Compass size={16} />Walkthroughs</div><strong>{data?.walkthroughs?.length || 0}</strong><small>Pulsating step-by-step guides</small></div>
      </div>

      <div className="sitebot-tabs" role="tablist">
        <button type="button" className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Bot size={14} />Settings &amp; Identity</button>
        <button type="button" className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}><FileText size={14} />Knowledge &amp; PDFs <span>{data?.knowledge?.length || 0}</span></button>
        <button type="button" className={tab === "walkthroughs" ? "active" : ""} onClick={() => setTab("walkthroughs")}><Compass size={14} />Walkthrough Guides <span>{data?.walkthroughs?.length || 0}</span></button>
        <button type="button" className={tab === "conversations" ? "active" : ""} onClick={() => setTab("conversations")}><MessageSquareText size={14} />Visitor Conversations <span>{stats.conversations}</span></button>
      </div>

      {tab === "settings" && (
        <div className="sitebot-grid">
          <form className="panel sitebot-form" onSubmit={saveSettings}>
            <div className="panel-heading"><div><h2>Identity, personality &amp; behavior</h2><p>Rename the assistant anytime (default: Sloty) and shape its companion instructions.</p></div></div>
            <label className="sitebot-check">
              <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
              <span><strong>Enable {cfg.name || "Sloty"} on website</strong><br /><small>Shows the floating assistant launcher on marketing, docs, and dashboard pages.</small></span>
            </label>
            <div className="sitebot-two">
              <label>Bot display name<input required maxLength={60} value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder="Sloty" /></label>
              <label>Tagline<input maxLength={160} value={cfg.tagline} onChange={(e) => setCfg({ ...cfg, tagline: e.target.value })} /></label>
            </div>
            <label>Welcome greeting<textarea rows={2} required maxLength={600} value={cfg.greeting} onChange={(e) => setCfg({ ...cfg, greeting: e.target.value })} /></label>
            <label>Companion system prompt<textarea rows={4} required maxLength={3000} value={cfg.system_prompt} onChange={(e) => setCfg({ ...cfg, system_prompt: e.target.value })} /></label>
            <div className="sitebot-two">
              <label>Accent color<input type="color" value={cfg.accent_color} onChange={(e) => setCfg({ ...cfg, accent_color: e.target.value })} style={{ height: 40, padding: 4 }} /></label>
              <label>Launcher corner<select value={cfg.position} onChange={(e) => setCfg({ ...cfg, position: e.target.value === "left" ? "left" : "right" })}><option value="right">Bottom Right</option><option value="left">Bottom Left</option></select></label>
            </div>
            <label className="sitebot-check">
              <input type="checkbox" checked={cfg.include_api_docs} onChange={(e) => setCfg({ ...cfg, include_api_docs: e.target.checked })} />
              <span><strong>Auto-index live API Documentation &amp; Help Center</strong><br /><small>Gives {cfg.name || "Sloty"} live access to all published docs and the API Reference endpoints.</small></span>
            </label>
            <label>Starter prompt chips (one per line)<textarea rows={4} value={cfg.promptsText} onChange={(e) => setCfg({ ...cfg, promptsText: e.target.value })} /></label>
            <div className="sitebot-actions">
              <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Save bot settings"}</button>
            </div>
          </form>

          <div className="panel sitebot-form">
            <div className="panel-heading"><div><h2>Built-in Superpowers</h2><p>What {cfg.name} can do for visitors automatically.</p></div></div>
            <div className="sitebot-preview-copy">
              <strong>1. Live Redirects</strong>{"\n"}Can open or direct visitors to `/agents`, `/api-docs`, `/api-keys`, `/docs`, `/plans`, `/analytics`, `/conversations`, `/support`, and `/profile`.{"\n\n"}
              <strong>2. Pulsating Companion Walkthroughs</strong>{"\n"}Can navigate across pages and highlight exact UI targets with a pulsing ring + companion instruction card.{"\n\n"}
              <strong>3. Grounded Knowledge + PDFs + API Docs</strong>{"\n"}Searches your editable KB entries, uploaded PDFs, published Documentation Center pages, and REST/SSE API Reference.{"\n\n"}
              <strong>4. Full Visitor Telemetry</strong>{"\n"}Every chat logs IP address, parsed Device/Browser/OS, current page, and linked authenticated user details if logged in.
            </div>
          </div>
        </div>
      )}

      {tab === "knowledge" && (
        <div className="sitebot-shell">
          <div className="sitebot-banner-info">
            <BookOpen size={16} />
            <span>{cfg.include_api_docs ? `${cfg.name} also has automatic live access to your API Reference (/api-docs) and published Documentation Center articles.` : "Live API Documentation sync is currently turned off in Settings."}</span>
          </div>

          <div className="sitebot-grid">
            <form className="panel sitebot-form" onSubmit={createKbEntry}>
              <div className="panel-heading"><div><h2>Add text / Markdown knowledge</h2><p>Teach {cfg.name} about new features, policies, pricing, or workflows.</p></div></div>
              <label>Title<input required maxLength={200} value={newKb.title} onChange={(e) => setNewKb({ ...newKb, title: e.target.value })} placeholder="e.g. Custom Enterprise Onboarding" /></label>
              <label>Content<textarea rows={5} required maxLength={500000} value={newKb.content} onChange={(e) => setNewKb({ ...newKb, content: e.target.value })} placeholder="Write clear facts and instructions…" /></label>
              <div className="sitebot-actions">
                <button type="submit" className="primary" disabled={busy}><Plus size={14} />Add &amp; index knowledge</button>
              </div>
            </form>

            <div className="panel sitebot-form">
              <div className="panel-heading"><div><h2>Upload PDF or Document</h2><p>Upload product brochures, user manuals, or API PDFs (up to 10 MB).</p></div></div>
              <label>Optional custom title<input maxLength={200} value={pdfTitle} onChange={(e) => setPdfTitle(e.target.value)} placeholder="Leave blank to use filename" /></label>
              <div className="sitebot-upload-box">
                <span className="subtle small-text">Supported: readable `.pdf`, `.docx`, `.txt`, `.md` (text is extracted and chunk-indexed immediately).</span>
                <label className="secondary sitebot-upload-label">
                  <Upload size={15} />
                  {busy ? "Uploading & indexing…" : "Choose PDF / document"}
                  <input type="file" accept=".pdf,.docx,.txt,.md,application/pdf" disabled={busy} onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void uploadPdfOrDoc(file); e.currentTarget.value = ""; }} />
                </label>
              </div>
            </div>
          </div>

          <div className="sitebot-kb-list">
            {(data?.knowledge || []).map((item: any) => (
              <article className="sitebot-kb-card" key={item.id}>
                <div className="sitebot-card-head">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h3>{item.title}</h3>
                      <span className={`badge ${item.enabled ? "green" : "gray"}`}>{item.enabled ? "Active" : "Disabled"}</span>
                      <span className="badge amber">{item.source_type.toUpperCase()}</span>
                    </div>
                    <small>{item.chunk_count} indexed chunks · Updated {fmtDate(item.updated_at)}</small>
                  </div>
                  <div className="sitebot-btn-row">
                    <button type="button" className="secondary" onClick={() => {
                      if (editingKbId === item.id) setEditingKbId(null);
                      else { setEditingKbId(item.id); setEditingKbForm({ title: item.title, content: item.content, enabled: !!item.enabled }); }
                    }}>
                      {editingKbId === item.id ? "Cancel" : "Edit"}
                    </button>
                    <button type="button" className={item.enabled ? "danger-outline" : "success-outline"} disabled={busy} onClick={() => void toggleKbItem(item)}>
                      {item.enabled ? "Disable" : "Enable"}
                    </button>
                    <button type="button" className="danger-outline" disabled={busy} onClick={() => void deleteKbItem(item)}><Trash2 size={13} /></button>
                  </div>
                </div>
                {editingKbId === item.id ? (
                  <div className="sitebot-form">
                    <label>Title<input value={editingKbForm.title} onChange={(e) => setEditingKbForm({ ...editingKbForm, title: e.target.value })} maxLength={200} /></label>
                    <label>Content (re-chunks automatically on save)<textarea rows={7} value={editingKbForm.content} onChange={(e) => setEditingKbForm({ ...editingKbForm, content: e.target.value })} /></label>
                    <div className="sitebot-actions">
                      <button type="button" className="secondary" onClick={() => setEditingKbId(null)}>Cancel</button>
                      <button type="button" className="primary" disabled={busy} onClick={() => void saveKbEdit(item.id)}>Save &amp; re-index</button>
                    </div>
                  </div>
                ) : (
                  <div className="sitebot-preview-copy">{item.preview}{item.content.length > 240 ? "…" : ""}</div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "walkthroughs" && (
        <div className="sitebot-shell">
          <div className="sitebot-btn-row" style={{ justifyContent: "space-between" }}>
            <span className="subtle">Define pulsating interactive tours. {cfg.name} triggers these guides and navigates users step-by-step across pages.</span>
            <button type="button" className="primary" onClick={() => startGuideEditor()}><Plus size={15} />New walkthrough guide</button>
          </div>

          {editingGuideId && (
            <form className="panel sitebot-form" onSubmit={saveGuide}>
              <div className="panel-heading"><div><h2>{editingGuideId === "new" ? "Create walkthrough guide" : "Edit walkthrough guide"}</h2><p>Set trigger keywords and ordered spotlight steps.</p></div></div>
              <div className="sitebot-two">
                <label>Title<input required maxLength={160} value={guideForm.title} onChange={(e) => setGuideForm({ ...guideForm, title: e.target.value })} /></label>
                <label>Slug<input required maxLength={100} value={guideForm.slug} onChange={(e) => setGuideForm({ ...guideForm, slug: e.target.value })} placeholder="build-your-first-agent" /></label>
              </div>
              <div className="sitebot-two">
                <label>Description<input maxLength={600} value={guideForm.description} onChange={(e) => setGuideForm({ ...guideForm, description: e.target.value })} /></label>
                <label>Trigger keywords (comma-separated)<input value={guideForm.keywordsText} onChange={(e) => setGuideForm({ ...guideForm, keywordsText: e.target.value })} /></label>
              </div>
              <div className="sitebot-two">
                <label>Sort position<input type="number" min={0} max={999} value={guideForm.position} onChange={(e) => setGuideForm({ ...guideForm, position: Number(e.target.value) })} /></label>
                <label className="sitebot-check" style={{ marginTop: 18 }}>
                  <input type="checkbox" checked={guideForm.enabled} onChange={(e) => setGuideForm({ ...guideForm, enabled: e.target.checked })} />
                  <span>Guide enabled</span>
                </label>
              </div>

              <div className="sitebot-btn-row" style={{ justifyContent: "space-between" }}>
                <strong>Steps ({guideForm.steps.length})</strong>
                <button type="button" className="secondary" onClick={() => setGuideForm({ ...guideForm, steps: [...guideForm.steps, { title: `Step ${guideForm.steps.length + 1}`, instruction: "", route: "/agents", selector: "", action_label: "Next step", auto_advance_on_click: true }] })}><Plus size={14} />Add step</button>
              </div>

              {guideForm.steps.map((step, idx) => (
                <div className="sitebot-step-card" key={idx}>
                  <div className="sitebot-step-head">
                    <strong>Step {idx + 1}</strong>
                    <button type="button" className="danger-outline" onClick={() => setGuideForm({ ...guideForm, steps: guideForm.steps.filter((_, i) => i !== idx) })}>Remove</button>
                  </div>
                  <div className="sitebot-two">
                    <label>Step title<input required value={step.title} onChange={(e) => { const next = [...guideForm.steps]; next[idx] = { ...step, title: e.target.value }; setGuideForm({ ...guideForm, steps: next }); }} /></label>
                    <label>Page route<input required value={step.route} onChange={(e) => { const next = [...guideForm.steps]; next[idx] = { ...step, route: e.target.value }; setGuideForm({ ...guideForm, steps: next }); }} placeholder="/agents" /></label>
                  </div>
                  <div className="sitebot-two">
                    <label>Target preset
                      <select
                        value={SELECTOR_PRESETS.some((p) => p.value === step.selector) ? step.selector : ""}
                        onChange={(e) => { if (!e.target.value) return; const next = [...guideForm.steps]; next[idx] = { ...step, selector: e.target.value }; setGuideForm({ ...guideForm, steps: next }); }}
                      >
                        {SELECTOR_PRESETS.map((p) => <option key={p.label} value={p.value}>{p.label}</option>)}
                      </select>
                    </label>
                    <label>CSS / data-tour selector to highlight<input value={step.selector} onChange={(e) => { const next = [...guideForm.steps]; next[idx] = { ...step, selector: e.target.value }; setGuideForm({ ...guideForm, steps: next }); }} placeholder="[data-tour='create-agent-btn']" /></label>
                  </div>
                  <label>Companion explanation (what to click &amp; do next)<textarea rows={2} required value={step.instruction} onChange={(e) => { const next = [...guideForm.steps]; next[idx] = { ...step, instruction: e.target.value }; setGuideForm({ ...guideForm, steps: next }); }} /></label>
                  <div className="sitebot-two">
                    <label>Action chip label<input value={step.action_label} onChange={(e) => { const next = [...guideForm.steps]; next[idx] = { ...step, action_label: e.target.value }; setGuideForm({ ...guideForm, steps: next }); }} /></label>
                    <label className="sitebot-check" style={{ marginTop: 18 }}>
                      <input type="checkbox" checked={step.auto_advance_on_click} onChange={(e) => { const next = [...guideForm.steps]; next[idx] = { ...step, auto_advance_on_click: e.target.checked }; setGuideForm({ ...guideForm, steps: next }); }} />
                      <span>Auto-advance when clicked</span>
                    </label>
                  </div>
                </div>
              ))}

              <div className="sitebot-actions">
                <button type="button" className="secondary" onClick={() => setEditingGuideId(null)}>Cancel</button>
                <button type="submit" className="primary" disabled={busy}>Save walkthrough</button>
              </div>
            </form>
          )}

          <div className="sitebot-guide-list">
            {(data?.walkthroughs || []).map((guide: any) => (
              <article className="sitebot-guide-card" key={guide.id}>
                <div className="sitebot-card-head">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h3>{guide.title}</h3>
                      <span className={`badge ${guide.enabled ? "green" : "gray"}`}>{guide.enabled ? "Enabled" : "Disabled"}</span>
                      <span className="badge amber">{(guide.steps || []).length} steps</span>
                    </div>
                    <small className="mono">slug: {guide.slug} · keywords: {(guide.keywords || []).join(", ")}</small>
                  </div>
                  <div className="sitebot-btn-row">
                    <button type="button" className="secondary" onClick={() => startGuideEditor(guide)}>Edit steps</button>
                    <button type="button" className="danger-outline" disabled={busy} onClick={() => void deleteGuide(guide)}><Trash2 size={13} /></button>
                  </div>
                </div>
                {guide.description && <p className="subtle" style={{ marginTop: 0 }}>{guide.description}</p>}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "conversations" && (
        <div className="sitebot-shell">
          <div className="sitebot-btn-row" style={{ justifyContent: "space-between" }}>
            <form className="searchbar" style={{ marginBottom: 0, flex: 1 }} onSubmit={(e) => { e.preventDefault(); setConvPage(1); setConvSubmitted(convSearch.trim()); }}>
              <Search size={17} />
              <input value={convSearch} onChange={(e) => setConvSearch(e.target.value)} placeholder="Search by email, user name, IP address, device, page, or message…" />
              <button className="secondary">Search</button>
            </form>
            <button type="button" className="secondary" onClick={() => void loadConversations()}><RefreshCw size={14} />Refresh</button>
          </div>

          <div className="panel table-panel">
            <div className="table-scroll">
              <table>
                <thead><tr><th>USER / VISITOR</th><th>IP ADDRESS</th><th>DEVICE &amp; BROWSER</th><th>PAGE</th><th>LAST MESSAGE</th><th>MSGS</th><th>LAST ACTIVE</th><th /></tr></thead>
                <tbody>
                  {(convs?.items || []).map((c: any) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.user_name || "Anonymous visitor"}</strong>
                        <small>{c.user_email ? `${c.user_email} (Signed in)` : `Visitor ${c.visitor_id.slice(0, 12)}`}</small>
                      </td>
                      <td className="mono">{c.ip_address}</td>
                      <td>
                        <strong>{c.device_summary}</strong>
                        <small className="message-preview" title={c.user_agent}>{c.user_agent || "—"}</small>
                      </td>
                      <td className="mono">{c.current_page}</td>
                      <td className="message-preview">{c.last_message || "—"}</td>
                      <td>{c.message_count}</td>
                      <td>{fmtDate(c.updated_at)}</td>
                      <td><button type="button" className="secondary" onClick={() => void openConversationDetail(c.id)}>Inspect <ChevronRight size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!convs?.items?.length && <div className="empty-state">No website assistant conversations match this filter yet.</div>}
            </div>
          </div>

          {convs && convs.total > convs.limit && (
            <div className="pager">
              <span>{convs.total} conversations · page {convPage}</span>
              <div>
                <button type="button" className="secondary" disabled={convPage <= 1} onClick={() => setConvPage((p) => p - 1)}>Previous</button>
                <button type="button" className="secondary" disabled={convPage * convs.limit >= convs.total} onClick={() => setConvPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedConv && (
        <div className="modal-backdrop" onClick={() => setSelectedConv(null)}>
          <section className="transcript-modal" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">{cfg.name.toUpperCase()} TRANSCRIPT</p>
                <h2>{selectedConv.conversation.user_name || "Anonymous visitor"}</h2>
                <p className="subtle small-text">{selectedConv.conversation.user_email || `Visitor ID: ${selectedConv.conversation.visitor_id}`}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setSelectedConv(null)}><X size={18} /></button>
            </header>
            <div className="sitebot-meta-strip">
              <span><strong>IP:</strong> {selectedConv.conversation.ip_address}</span>
              <span><strong>Device:</strong> {selectedConv.conversation.device_summary}</span>
              <span><strong>Page:</strong> {selectedConv.conversation.current_page}</span>
              {selectedConv.conversation.user_id && <span><strong>User ID:</strong> {selectedConv.conversation.user_id}</span>}
            </div>
            <div className="transcript-body">
              {selectedConv.messages.map((m: any) => (
                <article key={m.id} className={`chat-line ${m.role}`}>
                  <small>{m.role === "user" ? (selectedConv.conversation.user_name || "Visitor") : cfg.name} · {m.page_path} · {fmtDate(m.created_at)}</small>
                  <p>{m.content}</p>
                  {m.actions?.length > 0 && (
                    <div className="sitebot-action-tags">
                      {m.actions.map((act: any, idx: number) => (
                        <span key={idx}>{act.type === "redirect" ? `Redirect → ${act.route}` : `Guide → ${act.walkthrough_slug}`}</span>
                      ))}
                    </div>
                  )}
                  {m.citations?.length > 0 && (
                    <details>
                      <summary>{m.citations.length} knowledge / docs citations</summary>
                      {m.citations.map((c: any, idx: number) => (
                        <p className="citation" key={idx}>{c.source}: {c.excerpt}</p>
                      ))}
                    </details>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
