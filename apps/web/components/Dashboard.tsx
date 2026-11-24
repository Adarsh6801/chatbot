"use client";
import { useEffect, useState } from "react";
import { SiteLogo, SiteName } from "@/components/SiteBranding";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot as BotIcon,
  Check,
  ChevronRight,
  Code2,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  ChevronDown,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import Chat from "@/components/Chat";
import WorkflowStudio from "@/components/WorkflowStudio";
import SupportCenter from "@/components/SupportCenter";
import AccountProfile, { UserProfile } from "@/components/AccountProfile";
import { useDialogs } from "@/components/Dialogs";
import AuthGate from "@/components/AuthGate";
import "@/components/account.css";
import { api, API, Bot } from "@/lib/api";
import "@/components/workspace-polish.css";
import "@/components/support.css";

type User = UserProfile;
type Section =
  | "agents"
  | "analytics"
  | "conversations"
  | "billing"
  | "keys"
  | "profile"
  | "support";
const tabs = [
  "Workflow",
  "Knowledge",
  "Playground",
  "Analytics",
  "Conversations",
  "Logs",
  "Improve",
  "Deploy",
  "Settings",
];
const tabSlugs: Record<string, string> = {
  Workflow: "workflow", Knowledge: "knowledge", Playground: "playground",
  Analytics: "analytics", Conversations: "conversations", Logs: "logs", Improve: "improve",
  Deploy: "deploy", Settings: "settings",
};
const slugTabs = Object.fromEntries(Object.entries(tabSlugs).map(([tab, slug]) => [slug, tab]));
const agentPageCache = new Map<string, any>();
const sectionPaths: Record<Section, string> = {
  agents: "/agents", analytics: "/analytics", conversations: "/conversations",
  billing: "/plans", keys: "/api-keys", profile: "/profile", support: "/support",
};
const demoText = `AgentForge helps teams build support agents grounded in their own documents. You can upload PDF, DOCX, text, and Markdown files or import a public website page. Each answer includes citations so visitors can check its evidence.\n\nThe Free plan includes 1 agent, 10 documents, and 100 messages per month. The Pro plan includes 10 agents, 100 documents, and 5,000 messages per month. The Team plan includes 50 agents, 500 documents, and 25,000 messages per month.\n\nTo install your agent on a website, publish it from the Deploy tab, copy the embed script, and paste it before the closing body tag. You can also share the hosted chat link. Customize the greeting, accent color, and widget position from Settings.\n\nIf an agent cannot find an answer in its documents, it says it does not know and flags the question. Open Improve, write a verified answer, and save it to train the agent on the missing information.\n\nFor help, contact your AgentForge workspace administrator. Documents remain scoped to their agent and owner. The local demo uses extractive answers and does not send your documents to an AI provider unless an OpenAI API key is configured.`;

export default function Dashboard({ onAuthenticationChange }: { onAuthenticationChange?: (signedIn: boolean) => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [bots, setBots] = useState<Bot[]>([]),
    [section, setSection] = useState<Section>("agents"),
    [selected, setSelected] = useState<Bot | null>(null),
    [tab, setTab] = useState("Knowledge"),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [usage, setUsage] = useState<any>(null);
  const [accountMenu, setAccountMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agentMenu, setAgentMenu] = useState<{ bot: Bot; x: number; y: number } | null>(null);
  const { confirm: confirmDialog } = useDialogs();
  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("agentforge-sidebar-collapsed") === "true");
  }, []);
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem("agentforge-sidebar-collapsed", String(next));
      return next;
    });
  }
  useEffect(() => {
    if (!agentMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAgentMenu(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [agentMenu]);
  function showAgentMenu(event: React.MouseEvent<HTMLElement>, bot: Bot) {
    event.preventDefault();
    event.stopPropagation();
    setAgentMenu({ bot, x: Math.max(12, Math.min(event.clientX, window.innerWidth - 205)), y: Math.max(12, Math.min(event.clientY, window.innerHeight - 115)) });
  }
  async function deleteAgent(bot: Bot) {
    const accepted = await confirmDialog({
      title: `Delete “${bot.name}”?`,
      description: "This permanently removes the agent, its knowledge sources, and conversation history.",
      confirmText: "Delete agent",
      tone: "danger",
    });
    setAgentMenu(null);
    if (!accepted) return;
    await action(async () => {
      await api(`/bots/${bot.id}`, { method: "DELETE" });
      if (selected?.id === bot.id) {
        setSelected(null);
        router.replace("/agents");
      }
    }, "Agent deleted.");
  }
  function navigateSection(next: Section) {
    setSection(next);
    setSelected(null);
    router.push(sectionPaths[next]);
  }
  function navigateAgent(bot: Bot, nextTab: string) {
    setSection("agents");
    setSelected(bot);
    setTab(nextTab);
    router.push(`/agents/${bot.id}/${tabSlugs[nextTab] || "knowledge"}`);
  }
  function navigateTab(nextTab: string) {
    setTab(nextTab);
    if (selected) router.push(`/agents/${selected.id}/${tabSlugs[nextTab] || "knowledge"}`);
  }
  useEffect(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "agents") {
      setSection("agents");
      if (parts[1]) {
        const bot = bots.find((item) => item.id === parts[1]);
        if (bot) setSelected(bot);
        setTab(slugTabs[parts[2]] || "Knowledge");
      } else setSelected(null);
      return;
    }
    const routeSections: Record<string, Section> = {
      analytics: "analytics", conversations: "conversations", plans: "billing",
      "api-keys": "keys", profile: "profile",
      support: "support",
    };
    const next = routeSections[parts[0]];
    if (next) { setSection(next); setSelected(null); }
  }, [pathname, bots]);
  async function refresh() {
    const [list, u, me] = await Promise.all([
      api<Bot[]>("/bots"),
      api("/account/usage"),
      api<User>("/auth/me"),
    ]);
    setBots(list);
    setUsage(u);
    setUser((old) => (old ? { ...old, ...me } : old));
    if (selected) setSelected(list.find((b) => b.id === selected.id) || null);
  }
  useEffect(() => {
    api<User>("/auth/me")
      .then((me) => { setUser(me); onAuthenticationChange?.(true); })
      .catch(() => { onAuthenticationChange?.(false); })
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (user) refresh().catch((e) => setError(e.message));
  }, [user?.id]); // eslint-disable-line
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function action(fn: () => Promise<any>, success?: string) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (success) setToast(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setError("");
    try {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      onAuthenticationChange?.(false);
      setBots([]);
      setSelected(null);
      setSection("agents");
      router.push("/agents");
      setAccountMenu(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("billing");
    if (result) {
      navigateSection("billing");
      setToast(
        result === "success"
          ? "Checkout completed. Your plan updates after payment confirmation."
          : "Checkout cancelled. Your current plan is unchanged.",
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  if (boot)
    return (
      <div className="loading">
        <Flame /> <span>Opening your workspace…</span>
      </div>
    );
  if (!user) return <AuthGate onUser={(next) => { setUser(next); onAuthenticationChange?.(true); }} />;
  const filtered = bots.filter((b) =>
    (b.name + " " + b.description).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <a className="brand" href="/" aria-label="Home">
            <SiteLogo className="brand-icon" fallback={<div className="brand-icon"><Flame size={22} /></div>} alt="" />
            <span className="brand-name"><SiteName period /></span>
          </a>
          <button className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-avatar">{user.name[0].toUpperCase()}</div>
          <div>
            <strong>{user.name}&apos;s workspace</strong>
            <small>Personal workspace</small>
          </div>
          <span>⌄</span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(
            [
              ["agents", "My agents", BotIcon],
              ["analytics", "Analytics", Activity],
              ["conversations", "Conversations", MessageSquare],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => navigateSection(id)}
              title={label}
            >
              <Icon size={18} />
              {label}
              {id === "agents" && (
                <span className="nav-count">{bots.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label management">HELP</div>
        <nav>
          <button className={section === "support" ? "active" : ""} onClick={() => navigateSection("support")} title="Support">
            <CircleHelp size={18} />Support
          </button>
        </nav>
        <div className="nav-label management">MANAGE</div>
        <nav>
          <button
            className={section === "billing" ? "active" : ""}
            onClick={() => navigateSection("billing")}
            title="Usage & billing"
          >
            <Zap size={18} />
            Usage & billing
          </button>
          <button
            className={section === "keys" ? "active" : ""}
            onClick={() => navigateSection("keys")}
            title="API keys"
          >
            <KeyRound size={18} />
            API keys
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-card">
            <div>
              <Zap size={15} />
              <strong>
                {user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} plan
              </strong>
              <span>
                {usage?.messages || 0} / {usage?.limits.messages || 100}
              </span>
            </div>
            <div className="meter">
              <i
                style={{
                  width:
                    Math.min(
                      100,
                      ((usage?.messages || 0) /
                        (usage?.limits.messages || 100)) *
                        100,
                    ) + "%",
                }}
              />
            </div>
            <p>Monthly messages used</p>
            <button
              onClick={() => navigateSection("billing")}
            >
              Explore plans <ArrowRight size={14} />
            </button>
          </div>
          <a
            href={API + "/docs"}
            target="_blank"
            rel="noreferrer"
            className="help-link"
          >
            <BookOpen size={16} /> API documentation <ExternalLink size={13} />
          </a>
          <div className="user-card">
            <button
              className="profile-button"
              onClick={() => navigateSection("profile")}
              aria-label="Open user profile"
            >
              <div className="user-avatar">
                {user.avatar_url ? (
                  <img
                    className="avatar-image"
                    src={user.avatar_url}
                    alt="Your profile"
                  />
                ) : (
                  user.name[0].toUpperCase()
                )}
              </div>
              <div>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </div>
            </button>
            <button
              title="Open profile"
              className="icon-button"
              onClick={() => navigateSection("profile")}
            >
              <UserRound size={16} />
            </button>
          </div>
          <button className="sidebar-logout" onClick={logout}>
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {selected
                ? selected.name
                : section === "agents"
                  ? "My agents"
                  : section === "keys"
                    ? "API keys"
                      : section === "billing"
                      ? "Usage & billing"
                      : section === "support"
                        ? "Support"
                      : section[0].toUpperCase() + section.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <i /> Development workspace
            </span>
            <div className="header-account">
              <button
                aria-label="Account menu"
                aria-expanded={accountMenu}
                onClick={() => setAccountMenu(!accountMenu)}
              >
                <div className="user-avatar small">
                  {user.avatar_url ? (
                    <img
                      className="avatar-image"
                      src={user.avatar_url}
                      alt="Your profile"
                    />
                  ) : (
                    user.name[0].toUpperCase()
                  )}
                </div>
                <span>{user.name.split(" ")[0]}</span>
                <ChevronDown size={12} />
              </button>
              {accountMenu && (
                <div className="account-menu">
                  <div className="account-menu-info">
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </div>
                  <button
                    onClick={() => { navigateSection("profile"); setAccountMenu(false); }}
                  >
                    <UserRound size={15} />
                    My profile
                  </button>
                  <button
                    onClick={() => { navigateSection("billing"); setAccountMenu(false); }}
                  >
                    <Zap size={15} />
                    Subscribe & billing
                  </button>
                  <button className="logout-menu" onClick={logout}>
                    <LogOut size={15} />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main
          className={
            "main-content " +
            (selected && tab === "Workflow" ? "workflow-main" : "")
          }
        >
          {error && (
            <div className="error" role="alert">
              {error}
              <button className="icon-button" onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          {selected ? (
            <>
              <button className="back-link" onClick={() => navigateSection("agents")}>
                <ArrowLeft size={15} /> All agents
              </button>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">AGENT WORKSPACE</div>
                  <h1>{selected.name}</h1>
                  <p>
                    {selected.description ||
                      "Turn your documents into helpful conversations."}
                  </p>
                </div>
                <span
                  className={
                    "status " + (selected.published ? "live" : "draft")
                  }
                >
                  <i />
                  {selected.published ? "Live" : "Draft"}
                </span>
              </div>
              <div className="tabs">
                {tabs.map((t) => (
                  <button
                    className={tab === t ? "active" : ""}
                    key={t}
                    onClick={() => navigateTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <AgentDetail
                key={selected.id + tab}
                bot={selected}
                tab={tab}
                refresh={refresh}
                action={action}
                busy={busy}
                notify={setToast}
              />
            </>
          ) : section === "agents" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BUILD SOMETHING HELPFUL</div>
                  <h1>
                    My agents <span>{bots.length}</span>
                  </h1>
                  <p>Your knowledge. A conversation away.</p>
                </div>
                <button className="primary" onClick={() => setModal(true)}>
                  <Plus size={17} /> Create agent
                </button>
              </div>
              <div className="overview-grid">
                <Metric
                  icon={<BotIcon size={18} />}
                  label="Total agents"
                  value={String(bots.length)}
                  note={`${bots.filter((b) => b.published).length} published`}
                />
                <Metric
                  icon={<MessageSquare size={18} />}
                  label="Conversations answered"
                  value={String(bots.reduce((n, b) => n + b.messages, 0))}
                  note="Across all your agents"
                />
                <Metric
                  icon={<FileText size={18} />}
                  label="Knowledge sources"
                  value={String(bots.reduce((n, b) => n + b.documents, 0))}
                  note="Documents & web pages"
                />
                <Metric
                  icon={<ShieldCheck size={18} />}
                  label="Grounded by design"
                  value="Cited answers"
                  note="Evidence you can inspect"
                />
              </div>
              <div className="banner">
                <div className="banner-art">
                  <div className="art-ring ring-one" />
                  <div className="art-ring ring-two" />
                  <Sparkles size={34} />
                  <div className="art-dot one" />
                  <div className="art-dot two" />
                </div>
                <div>
                  <span className="badge">FROM KNOWLEDGE TO ANSWERS</span>
                  <h2>A little knowledge goes a long way.</h2>
                  <p>
                    Upload your docs. Shape your agent. Let it handle the
                    questions.
                  </p>
                  <button onClick={() => setModal(true)}>
                    Build your next agent <ArrowRight size={15} />
                  </button>
                </div>
                <div className="banner-steps">
                  <div>
                    <FileText size={16} />
                    <span>Add sources</span>
                    <Check size={13} />
                  </div>
                  <div>
                    <Settings2 size={16} />
                    <span>Make it yours</span>
                    <Check size={13} />
                  </div>
                  <div>
                    <Code2 size={16} />
                    <span>Share anywhere</span>
                    <ArrowRight size={13} />
                  </div>
                </div>
              </div>
              <div className="list-toolbar">
                <div>
                  <h2>Your agents</h2>
                  <span>{bots.length} agents in this workspace</span>
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    placeholder="Search agents…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search agents"
                  />
                </label>
              </div>
              <div className="agent-grid">
                {filtered.map((bot, i) => (
                  <div
                    className="agent-card"
                    key={bot.id}
                    onClick={() => navigateAgent(bot, "Workflow")}
                    onContextMenu={(event) => showAgentMenu(event, bot)}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); navigateAgent(bot, "Workflow"); } }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="agent-card-top">
                      <div className={"bot-avatar tint-" + (i % 3)}>
                        <BotIcon size={25} />
                      </div>
                      <span
                        className={
                          "status " + (bot.published ? "live" : "draft")
                        }
                      >
                        <i />
                        {bot.published ? "Live" : "Draft"}
                      </span>
                      <button type="button" className="card-more-button" aria-label={`Actions for ${bot.name}`} title="Agent actions" onClick={(event) => showAgentMenu(event, bot)}><MoreHorizontal className="card-more" size={18} /></button>
                    </div>
                    <h3>{bot.name}</h3>
                    <p>
                      {bot.description ||
                        "Your next great assistant starts with a little knowledge."}
                    </p>
                    <div className="agent-meta">
                      <span>
                        <FileText size={13} />
                        {bot.documents} sources
                      </span>
                      <span>
                        <MessageSquare size={13} />
                        {bot.messages} messages
                      </span>
                    </div>
                    <div className="agent-card-bottom">
                      <span>Open workspace</span>
                      <ArrowRight size={17} />
                    </div>
                  </div>
                ))}
                <button
                  className="new-agent-card"
                  onClick={() => setModal(true)}
                >
                  <div>
                    <Plus size={23} />
                  </div>
                  <strong>Create a new agent</strong>
                  <span>Put your knowledge to work</span>
                </button>
              </div>
              {agentMenu && <>
                <button className="agent-menu-dismiss" aria-label="Close agent actions" onClick={() => setAgentMenu(null)} />
                <div className="agent-context-menu" role="menu" style={{ left: agentMenu.x, top: agentMenu.y }} onClick={(event) => event.stopPropagation()}>
                  <button role="menuitem" onClick={() => { const bot = agentMenu.bot; setAgentMenu(null); navigateAgent(bot, "Workflow"); }}><ArrowRight size={14}/>Open workspace</button>
                  <button role="menuitem" className="delete" onClick={() => void deleteAgent(agentMenu.bot)}><Trash2 size={14}/>Delete agent</button>
                </div>
              </>}
              {query && !filtered.length && (
                <p className="muted">No agents match “{query}”.</p>
              )}
              {!bots.length && (
                <div className="demo-callout">
                  <Sparkles size={20} />
                  <div>
                    <strong>Want to see how it works?</strong>
                    <p>
                      Create a demo agent with sample knowledge and try your
                      first cited answer.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        const b = await api<Bot>("/bots", {
                          method: "POST",
                          body: JSON.stringify({
                            name: "AgentForge guide",
                            description:
                              "A friendly guide to your new agent workspace.",
                          }),
                        });
                        await api(`/bots/${b.id}/documents`, {
                          method: "POST",
                          body: JSON.stringify({
                            name: "AgentForge getting started",
                            content: demoText,
                          }),
                        });
                        navigateAgent(b, "Playground");
                      }, "Demo agent is ready.")
                    }
                  >
                    Try a demo <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <div className="workspace-note">
                <ShieldCheck size={14} /> Your documents stay scoped to your
                workspace. Answers are backed by sources.
              </div>
            </>
          ) : section === "support" ? (
            <SupportCenter />
          ) : section === "profile" ? (
            <AccountProfile
              user={user}
              onUpdate={setUser}
              onSubscribe={() => navigateSection("billing")}
              onLogout={logout}
              notify={setToast}
            />
          ) : section === "billing" ? (
            <Billing usage={usage} action={action} busy={busy} />
          ) : section === "keys" ? (
            <Keys action={action} notify={setToast} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {section === "analytics"
                      ? "Workspace analytics"
                      : "Conversation inbox"}
                  </h1>
                  <p>
                    Select an agent to explore its{" "}
                    {section === "analytics"
                      ? "performance and quality"
                      : "conversation history"}
                    .
                  </p>
                </div>
              </div>
              <div className="panel agent-selector">
                {bots.length ? (
                  bots.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => navigateAgent(b, section === "analytics" ? "Analytics" : "Conversations")}
                    >
                      <div className="bot-avatar">
                        <BotIcon size={20} />
                      </div>
                      <div>
                        <strong>{b.name}</strong>
                        <p>
                          {b.messages} answers · {b.documents} sources
                        </p>
                      </div>
                      <ArrowRight size={18} />
                    </button>
                  ))
                ) : (
                  <Empty
                    title="Your workspace is just getting started"
                    text="Create your first agent to start collecting conversations and performance data."
                  />
                )}
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          Made for curious builders.<span><SiteName/> · v1.0</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              action(async () => {
                const b = await api<Bot>("/bots", {
                  method: "POST",
                  body: JSON.stringify({
                    name: data.get("name"),
                    description: data.get("description"),
                  }),
                });
                navigateAgent(b, "Knowledge");
                setModal(false);
              }, "Agent created. Add its first source.");
            }}
          >
            <button
              className="modal-close icon-button"
              type="button"
              onClick={() => setModal(false)}
              aria-label="Close"
            >
              <X size={20} />
            </button>
            <div className="bot-avatar">
              <Sparkles size={24} />
            </div>
            <h2>Meet your next agent.</h2>
            <p>Give it a name and a purpose. We&apos;ll take it from there.</p>
            <label>
              Agent name
              <input
                name="name"
                required
                maxLength={80}
                autoFocus
                placeholder="e.g. Acme support"
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                maxLength={500}
                placeholder="What will your agent help people with?"
              />
            </label>
            <button className="primary full" disabled={busy}>
              {busy ? "Creating…" : "Create agent"} <ArrowRight size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="metric">
      <div>
        {label}
        <span>{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpen size={27} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function AgentDetail({
  bot,
  tab,
  refresh,
  action,
  busy,
  notify,
}: {
  bot: Bot;
  tab: string;
  refresh: () => Promise<void>;
  action: (fn: () => Promise<any>, success?: string) => Promise<void>;
  busy: boolean;
  notify: (s: string) => void;
}) {
  const { confirm: confirmDialog } = useDialogs();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [selectedVisitor, setSelectedVisitor] = useState<any>(null);
  const [visitorConversations, setVisitorConversations] = useState<any[] | null>(null);
  const [visitorLoading, setVisitorLoading] = useState(false);
  const [logoRef, setLogoRef] = useState(bot.widget_config.logo || "");
  const [logoUrlInput, setLogoUrlInput] = useState((bot.widget_config.logo || "").startsWith("https://") ? bot.widget_config.logo : "");
  const [logoPreview, setLogoPreview] = useState((bot.widget_config.logo || "").startsWith("s3://") ? `${API}/api/v1/bots/${bot.id}/widget/logo` : bot.widget_config.logo || "");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState("");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [agentVersions, setAgentVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState("");
  const cacheKey = `${bot.id}:${tab}:${page}`;
  const [data, setData] = useState<any>(() => agentPageCache.get(cacheKey) ?? null),
    [mode, setMode] = useState("upload"),
    [loadError, setLoadError] = useState("");
  const base = "/bots/" + bot.id;
  async function load() {
    const path =
      tab === "Knowledge"
        ? "/documents"
        : tab === "Analytics"
          ? "/analytics/summary"
          : tab === "Conversations"
            ? "/visitors?page=" + page
            : tab === "Improve"
              ? "/flags"
              : null;
    if (path) {
      try {
        const result = await api(base + path);
        agentPageCache.set(cacheKey, result);
        setData(result);
        setLoadError("");
      } catch (e) {
        setLoadError((e as Error).message);
      }
    }
  }
  useEffect(() => {
    setData(agentPageCache.get(cacheKey) ?? null);
    setLoadError("");
    setSelectedVisitor(null);
    setVisitorConversations(null);
  }, [cacheKey]);
  useEffect(() => {
    const ref = bot.widget_config.logo || "";
    setLogoRef(ref);
    setLogoUrlInput(ref.startsWith("https://") ? ref : "");
    setLogoPreview(ref.startsWith("s3://") ? `${API}/api/v1/bots/${bot.id}/widget/logo` : ref);
  }, [bot.id, bot.widget_config.logo]);
  useEffect(() => {setVersionHistoryOpen(false);setAgentVersions([]);setSelectedVersionId("");setVersionError("");}, [bot.id]);
  useEffect(() => {
    load();
  }, [tab, page]); // eslint-disable-line
  useEffect(() => {
    if (tab === "Knowledge") {
      const timer = setInterval(() => load(), 2500);
      return () => clearInterval(timer);
    }
  }, [tab]); // eslint-disable-line
  async function mutate(fn: () => Promise<any>, message: string) {
    await action(fn, message);
    await load();
  }
  async function openVisitor(visitor: any) {
    setSelectedVisitor(visitor);
    setVisitorConversations(null);
    setVisitorLoading(true);
    try {
      const result = await api(base + "/visitor-conversations?visitor_key=" + encodeURIComponent(visitor.key));
      setVisitorConversations(result.items);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setVisitorLoading(false);
    }
  }
  async function toggleVersionHistory() {
    if (versionHistoryOpen) {setVersionHistoryOpen(false);return;}
    setVersionHistoryOpen(true);setVersionLoading(true);setVersionError("");
    try {
      const result = await api<{items:any[]}>(base + "/versions");
      setAgentVersions(result.items || []);
      setSelectedVersionId(result.items?.[0]?.id || "");
    } catch (e) {setVersionError((e as Error).message);}
    finally {setVersionLoading(false);}
  }
  async function saveDraftVersion() {
    await action(async () => {
      await api(base + "/versions/draft", {method:"POST"});
      const result = await api<{items:any[]}>(base + "/versions");
      setAgentVersions(result.items || []);setSelectedVersionId(result.items?.[0]?.id || "");
    }, "Draft version saved.");
  }
  async function publishCurrentDraft() {
    await action(async () => {
      await api(base,{method:"PATCH",body:JSON.stringify({published:true})});
      if (versionHistoryOpen) {
        const result = await api<{items:any[]}>(base + "/versions");
        setAgentVersions(result.items || []);setSelectedVersionId(result.items?.[0]?.id || "");
      }
    },bot.published?"Published a new major version.":"Your agent is live.");
  }
  async function restoreMajorVersion(version: any) {
    if (version.kind !== "major") return;
    if (!await confirmDialog({title:`Restore version ${version.version}?`,description:"This publishes a new major version using the selected snapshot. The current version will remain in history.",confirmText:"Restore and publish",tone:"danger"})) return;
    await action(async () => {
      await api(base + "/versions/" + version.id + "/restore", {method:"POST"});
      const result = await api<{items:any[]}>(base + "/versions");
      setAgentVersions(result.items || []);setSelectedVersionId(result.items?.[0]?.id || "");
    }, `Restored version ${version.version} as a new major version.`);
  }
  if (loadError) return <div className="error">{loadError}</div>;
  if (tab === "Workflow") return <WorkflowStudio bot={bot} notify={notify} />;
  if (tab === "Logs") return <AgentLogs bot={bot} />;
  if (tab === "Playground")
    return (
      <div className="playground">
        <div className="playground-copy">
          <span className="badge">TEST BEFORE YOU SHARE</span>
          <h2>
            Give your knowledge
            <br />a voice.
          </h2>
          <p>
            Ask the questions your visitors would ask. Inspect the source
            citations and tune your knowledge before publishing.
          </p>
          <div className="tip">
            <ShieldCheck size={19} />
            <p>
              Missing evidence? Your agent will say it doesn&apos;t know. Look
              in Improve to fill the gaps.
            </p>
          </div>
        </div>
        <Chat
          publicKey={bot.public_key}
          name={bot.name}
          greeting={bot.widget_config.greeting}
          color={bot.widget_config.color}
          logo={bot.widget_config.logo?.startsWith("s3://") ? `${API}/api/v1/bots/${bot.id}/widget/logo` : bot.widget_config.logo}
          onDone={() => {
            refresh().catch(() => {});
          }}
        />
      </div>
    );
  if (["Knowledge", "Analytics", "Conversations", "Improve"].includes(tab) && data === null)
    return <div className="workspace-loading" aria-live="polite"><span className="workspace-loading-title">Loading {tab.toLowerCase()}…</span><i/><i/><i/></div>;
  if (tab === "Knowledge")
    return (
      <>
        <div className="section-heading">
          <div>
            <h2>Knowledge sources</h2>
            <p>The better the knowledge, the better the answers.</p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              mutate(
                () => api(base + "/retrain", { method: "POST" }),
                "Retraining queued.",
              )
            }
          >
            <Zap size={15} /> Retrain agent
          </button>
        </div>
        <div className="knowledge-layout">
          <div className="panel source-list">
            {data?.length ? (
              data.map((d: any) => (
                <div className="source-row" key={d.id}>
                  <div className="source-icon">
                    {d.source_type === "url" ? (
                      <Globe size={20} />
                    ) : (
                      <FileText size={20} />
                    )}
                  </div>
                  <div>
                    <strong>{d.name}</strong>
                    <p>
                      {d.chunk_count} chunks · {d.source_type.toUpperCase()}
                      {d.error ? " · " + d.error : ""}
                    </p>
                  </div>
                  <span
                    className={
                      "status " +
                      (d.status === "READY"
                        ? "live"
                        : d.status === "FAILED"
                          ? "failed"
                          : "draft")
                    }
                  >
                    <i />
                    {d.status.toLowerCase()}
                  </span>
                  <button
                    className="icon-button"
                    title="Delete source"
                    onClick={async () => {
                      if (await confirmDialog({ title: "Delete this source?", description: "This also removes its searchable chunks from this agent.", confirmText: "Delete source", tone: "danger" }))
                        mutate(
                          () =>
                            api(base + "/documents/" + d.id, {
                              method: "DELETE",
                            }),
                          "Source deleted.",
                        );
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            ) : (
              <Empty
                title="Teach your agent something new"
                text="Add a document, website, or knowledge note. Your agent will find its answers here."
              />
            )}
          </div>
          <div className="panel add-source">
            <h3>Add knowledge</h3>
            <div className="segmented">
              {["upload", "website", "text"].map((m) => (
                <button
                  className={mode === m ? "active" : ""}
                  onClick={() => setMode(m)}
                  key={m}
                >
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {mode === "upload" ? (
              <label className="upload-zone">
                <Upload size={28} />
                <strong>Choose a document</strong>
                <span>PDF, DOCX, TXT, Markdown</span>
                <small>Up to 10 MB · Readable text required</small>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const form = new FormData();
                      form.append("file", file);
                      mutate(
                        () =>
                          api(base + "/documents/upload", {
                            method: "POST",
                            body: form,
                          }),
                        "Document queued for training.",
                      );
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  const el = e.currentTarget;
                  mutate(async () => {
                    await api(base + "/documents", {
                      method: "POST",
                      body: JSON.stringify({
                        name: form.get("name"),
                        ...(mode === "website"
                          ? { url: form.get("url") }
                          : { content: form.get("content") }),
                      }),
                    });
                    el.reset();
                  }, "Source queued for training.");
                }}
              >
                <label>
                  Source name
                  <input
                    name="name"
                    placeholder="e.g. Product documentation"
                    required
                    maxLength={200}
                  />
                </label>
                {mode === "website" ? (
                  <label>
                    Public website URL
                    <input
                      name="url"
                      type="url"
                      required
                      placeholder="https://example.com/docs"
                    />
                    <small>
                      Imports one page. Use the final URL; redirects are
                      blocked.
                    </small>
                  </label>
                ) : (
                  <label>
                    Knowledge
                    <textarea
                      name="content"
                      rows={8}
                      required
                      placeholder="Paste the information your agent should know…"
                    />
                  </label>
                )}
                <button className="primary full" disabled={busy}>
                  Add source <Plus size={15} />
                </button>
              </form>
            )}
            <p className="source-note">
              <ShieldCheck size={13} /> Sources belong only to this agent.
            </p>
          </div>
        </div>
      </>
    );
  if (tab === "Analytics")
    return data ? (
      <>
        <div className="overview-grid">
          <Metric
            icon={<MessageSquare size={18} />}
            label="Messages answered"
            value={String(data.messages)}
            note={`${data.conversations} conversations`}
          />
          <Metric
            icon={<ShieldCheck size={18} />}
            label="Retrieval confidence"
            value={Math.round(data.avg_confidence * 100) + "%"}
            note={`${Math.round(data.abstain_rate * 100)}% abstain rate`}
          />
          <Metric
            icon={<Zap size={18} />}
            label="Estimated model cost"
            value={"$" + (data.cost_cents / 100).toFixed(4)}
            note={`${data.tokens.toLocaleString()} tokens`}
          />
          <Metric
            icon={<Activity size={18} />}
            label="p95 response time"
            value={(data.p95_latency_ms / 1000).toFixed(2) + "s"}
            note={`${data.open_flags} questions to improve`}
          />
        </div>
        <div className="panel chart-panel">
          <h3>Conversation activity</h3>
          {data.daily.length ? (
            <div className="bar-chart">
              {data.daily.map((d: any) => (
                <div key={d.date}>
                  <strong>{d.messages}</strong>
                  <i
                    style={{
                      height: Math.max(
                        8,
                        (d.messages /
                          Math.max(...data.daily.map((x: any) => x.messages))) *
                          150,
                      ),
                    }}
                  />
                  <span>{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="Your story starts with a question"
              text="Try your agent in Playground. Activity and quality metrics will appear here."
            />
          )}
        </div>
        <EvalPanel base={base} />
      </>
    ) : (
      <p>Loading analytics…</p>
    );
  if (tab === "Conversations")
    return data ? (
      <div className="panel conversations-panel">
        {selectedVisitor ? (
          <>
            <div className="visitor-detail-heading">
              <button className="secondary" onClick={() => {setSelectedVisitor(null);setVisitorConversations(null);setLoadError("");}}><ArrowLeft size={14}/> All users</button>
              <div><h2>{selectedVisitor.user_name || (selectedVisitor.user_id ? "User" : "Anonymous visitor")}</h2><p>{selectedVisitor.user_id ? `User ID: ${selectedVisitor.user_id}` : `Visitor ID: ${selectedVisitor.visitor_id}`}</p></div>
              <span>{selectedVisitor.conversation_count} conversations</span>
            </div>
            {visitorLoading ? <p className="visitor-loading">Loading conversations…</p> : visitorConversations?.length ? visitorConversations.map((c: any) => (
              <details className="conversation" key={c.id}>
                <summary><MessageSquare size={17}/><div><strong>{c.messages.find((m: any) => m.role === "user")?.content || "Conversation"}</strong><span>{new Date(c.created_at).toLocaleString()} · {c.messages.length} messages</span></div><ChevronRight size={17}/></summary>
                <div className="conversation-messages">{c.messages.map((m: any) => <div key={m.id} className={"message " + m.role}><small>{m.role === "user" ? (c.user_name || "Visitor") : bot.name}</small><div className="message-body">{m.content}</div>{m.role === "assistant" && <details className="trace"><summary>Inspect trace · {m.latency_ms} ms · {m.tokens} tokens</summary><pre>{JSON.stringify({confidence:m.confidence,citations:m.citations,trace:m.trace,cost_cents:m.cost_cents},null,2)}</pre></details>}</div>)}</div>
              </details>
            )) : <Empty title="No conversations yet" text="Conversations from this user will appear here."/>}
          </>
        ) : data.items.length ? (
          data.items.map((c: any) => (
            <button className="visitor-list-row" key={c.key} onClick={() => openVisitor(c)}>
              <span className="visitor-avatar"><UserRound size={17}/></span>
              <span className="visitor-list-copy"><strong>{c.user_name || (c.user_id ? "User" : "Anonymous visitor")}</strong><small>{c.user_id ? `User ID: ${c.user_id}` : `Visitor ID: ${c.visitor_id}`}</small><small>Last active {new Date(c.last_seen).toLocaleString()} · {c.last_message || "No messages yet"}</small></span>
              <span className="visitor-count">{c.conversation_count} {c.conversation_count === 1 ? "conversation" : "conversations"}</span><ChevronRight size={17}/>
            </button>
          ))
        ) : (
          <Empty
            title="No users yet"
            text="When people chat with your agent, they’ll appear here with their conversation history."
          />
        )}
        <div className="pagination">
          <button
            className="secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} · {data.total} users
          </span>
          <button
            className="secondary"
            disabled={page * 20 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    ) : (
      <p>Loading conversations…</p>
    );
  if (tab === "Improve")
    return (
      <>
        <div className="section-heading">
          <div>
            <h2>Close the knowledge gaps</h2>
            <p>Turn unanswered questions into useful, verified knowledge.</p>
          </div>
        </div>
        <div className="panel">
          {data?.length ? (
            data.map((f: any) => (
              <div className="flag-row" key={f.id}>
                <div className="flag-heading">
                  <HelpCircle size={18} />
                  <strong>{f.question}</strong>
                  <span
                    className={
                      "status " + (f.status === "resolved" ? "live" : "draft")
                    }
                  >
                    {f.status}
                  </span>
                </div>
                <p className="muted">{f.reason.replaceAll("_", " ")}</p>
                {f.status === "open" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      mutate(
                        () =>
                          api(base + "/flags/" + f.id + "/fix", {
                            method: "POST",
                            body: JSON.stringify({
                              answer: form.get("answer"),
                            }),
                          }),
                        "Verified answer added to knowledge.",
                      );
                    }}
                  >
                    <textarea
                      name="answer"
                      required
                      minLength={10}
                      placeholder="Write the verified answer your agent should use…"
                    />
                    <button className="primary" disabled={busy}>
                      <Zap size={14} /> Save & train
                    </button>
                  </form>
                )}
              </div>
            ))
          ) : (
            <Empty
              title="No knowledge gaps yet"
              text="Unanswered, low-confidence, and frustrated questions appear here after a conversation."
            />
          )}
        </div>
      </>
    );
  if (tab === "Deploy") {
    const snippet = `<script src="${API}/widget.js" data-agent-key="${bot.public_key}" async></script>`;
    const link =
      typeof window !== "undefined"
        ? window.location.origin + "/chat/" + bot.slug
        : "";
    return (
      <>
      <div className="deploy-grid">
        <div className="panel deploy-panel">
          <div className="empty-icon">
            <Globe size={27} />
          </div>
          <h2>Ready for the real world?</h2>
          <p>
            Publish saved agent settings as a major release. Publishing again
            without changes keeps the current version.
          </p>
          <div className="agent-publish-controls">
            {bot.version_history_enabled && bot.draft_needs_save && <button className="secondary" disabled={busy} onClick={() => void saveDraftVersion()}><FileText size={14}/>Save draft version</button>}
            <button className="primary" disabled={busy || (bot.published && !bot.draft_changed)} onClick={() => void publishCurrentDraft()}>{bot.published ? bot.draft_changed ? "Publish major version" : `Published${bot.published_version ? ` · v${bot.published_version}` : ""}` : "Publish agent"}<ArrowRight size={16}/></button>
            {bot.published && <button className="secondary" disabled={busy} onClick={() => action(() => api(base,{method:"PATCH",body:JSON.stringify({published:false})}),"Agent unpublished.")}>Unpublish</button>}
          </div>
          <p className="agent-publish-status">{bot.draft_changed ? "Draft changes are ready to publish." : bot.published ? `This version is live${bot.published_version ? ` · v${bot.published_version}` : ""}.` : "Publish this agent when it is ready."}</p>
          {bot.version_history_enabled && <button className="version-history-toggle" onClick={() => void toggleVersionHistory()}>{versionHistoryOpen ? "Hide version history" : "View version history"}<ChevronRight size={14}/></button>}
          <div className="divider" />
          <label>
            Shareable chat link
            <input value={link} readOnly />
          </label>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(link)
                  .then(() => notify("Chat link copied."))
                  .catch(() => notify("Select and copy the link manually."))
              }
            >
              Copy link
            </button>
            {bot.published && (
              <a
                className="secondary"
                href={link}
                target="_blank"
                rel="noreferrer"
              >
                Open chat <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
        <div className="panel deploy-panel">
          <div className="empty-icon">
            <Code2 size={27} />
          </div>
          <h2>At home on any website.</h2>
          <p>
            Add this script before the closing <code>&lt;/body&gt;</code> tag.
            The widget loads only when your agent is published. Pass each signed-in visitor’s stable ID and optional display name with <code>data-user-id</code> and <code>data-user-name</code> to group their conversations.
          </p>
          <pre className="embed-code">{snippet}</pre>
          <button
            className="secondary"
            onClick={() =>
              navigator.clipboard
                .writeText(snippet)
                .then(() => notify("Embed snippet copied."))
                .catch(() => notify("Select and copy the snippet manually."))
            }
          >
            Copy embed code <Code2 size={15} />
          </button>
          <div className="tip">
            <ShieldCheck size={18} />
            <p>
              The public key allows chat with this agent only. It cannot access
              your dashboard.
            </p>
          </div>
        </div>
      </div>
      {versionHistoryOpen && bot.version_history_enabled && <section className="panel agent-version-panel"><div className="section-heading"><div><h2>Agent versions</h2><p>Major versions are published releases. Minor versions are saved drafts.</p></div></div>{versionLoading ? <p className="version-state">Loading versions…</p> : versionError ? <div className="error" role="alert">{versionError}</div> : !agentVersions.length ? <p className="version-state">No saved versions yet.</p> : <><label>Choose a version<select value={selectedVersionId} onChange={event=>setSelectedVersionId(event.target.value)}>{agentVersions.map(version=><option key={version.id} value={version.id}>v{version.version} · {version.kind === "major" ? "Published" : "Draft"} · {new Date(version.created_at).toLocaleString()}</option>)}</select></label>{(()=>{const version=agentVersions.find(item=>item.id===selectedVersionId);if(!version)return null;return <div className="agent-version-details"><div><strong>Version {version.version}</strong><span className={version.kind}>{version.kind === "major" ? "Published major version" : "Saved minor draft"}</span><time>{new Date(version.created_at).toLocaleString()}</time></div><pre>{JSON.stringify(version.snapshot,null,2)}</pre>{version.kind === "major"&&<button className="secondary" disabled={busy} onClick={()=>void restoreMajorVersion(version)}><RefreshCw size={14}/>Restore and publish this version</button>}</div>;})()}</>}</section>}
      </>
    );
  }
  if (tab === "Settings")
    return (
      <form
        className="panel settings-panel"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          action(
            () =>
              api(base, {
                method: "PATCH",
                body: JSON.stringify({
                  name: form.get("name"),
                  description: form.get("description"),
                  system_prompt: form.get("prompt"),
                  threshold: Number(form.get("threshold")),
                  widget_config: {
                    color: form.get("color"),
                    greeting: form.get("greeting"),
                    position: form.get("position"),
                    logo: logoUrlInput.trim() || logoRef,
                    launcher_icon: form.get("launcher_icon"),
                  },
                }),
              }),
            "Agent settings saved.",
          );
        }}
      >
        <h2>Make it yours</h2>
        <div className="form-grid">
          <label>
            Agent name
            <input
              name="name"
              defaultValue={bot.name}
              required
              maxLength={80}
            />
          </label>
          <label>
            Description
            <input
              name="description"
              defaultValue={bot.description}
              maxLength={500}
            />
          </label>
        </div>
        <label>
          Answer style and instructions
          <textarea
            name="prompt"
            defaultValue={bot.system_prompt}
            maxLength={3000}
            rows={3}
          />
          <small>
            Grounding and safety rules take precedence over style instructions.
          </small>
        </label>
        <label>
          Welcome message
          <input
            name="greeting"
            defaultValue={bot.widget_config.greeting}
            maxLength={500}
          />
        </label>
        <div className="form-grid">
          <label>
            Accent color
            <input
              name="color"
              type="color"
              defaultValue={bot.widget_config.color}
            />
          </label>
          <label>
            Widget position
            <select name="position" defaultValue={bot.widget_config.position}>
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </label>
          <label>
            Chat launcher icon
            <select name="launcher_icon" defaultValue={bot.widget_config.launcher_icon || "sparkle"}>
              <option value="sparkle">Sparkle</option>
              <option value="message">Message bubble</option>
              <option value="chat">Chat bubble</option>
              <option value="headset">Headset</option>
            </select>
          </label>
        </div>
        <label>
          Logo URL (optional)
          <input
            name="logo_url"
            type="url"
            value={logoUrlInput}
            onChange={(event) => {setLogoUrlInput(event.target.value);setLogoRef("");setLogoPreview(event.target.value);}}
            placeholder="https://example.com/logo.png"
          />
          <small>Or upload a PNG, JPG, WEBP, or GIF image (up to 5 MB). Uploads are stored in your configured S3 bucket.</small>
        </label>
        <div className="widget-logo-upload">
          <label className="secondary logo-upload-button">
            {logoUploading ? "Uploading logo…" : "Upload logo to S3"}
            <input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" disabled={logoUploading || busy} onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) return;
              setLogoUploadError("");
              setLogoUploading(true);
              const body = new FormData(); body.append("file", file);
              try {
                const result = await api<{logo:string;logo_url:string}>(base + "/widget/logo", {method:"POST", body});
                setLogoRef(result.logo); setLogoUrlInput(""); setLogoPreview(result.logo_url); notify("Logo uploaded to S3.");
              } catch (error) { setLogoUploadError((error as Error).message); }
              finally { setLogoUploading(false); input.value = ""; }
            }}/>
          </label>
          {logoPreview && <div className="widget-logo-preview"><img src={logoPreview} alt="Agent chat logo preview"/><button type="button" className="danger" onClick={() => {setLogoRef("");setLogoUrlInput("");setLogoPreview("");}}>Remove logo</button></div>}
          {logoUploadError && <div className="error" role="alert">{logoUploadError}</div>}
        </div>
        <label>
          Abstention threshold
          <input
            name="threshold"
            type="number"
            min="0.05"
            max="0.95"
            step="0.01"
            defaultValue={bot.threshold}
          />
          <small>
            Raise the threshold to require stronger retrieval evidence before
            answering.
          </small>
        </label>
        <div className="settings-footer">
          <button className="primary" disabled={busy}>
            Save changes <Check size={15} />
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (await confirmDialog({ title: `Delete “${bot.name}”?`, description: "This permanently removes the agent, its knowledge sources, and conversation history.", confirmText: "Delete agent", tone: "danger" }))
                action(async () => {
                  await api(base, { method: "DELETE" });
                  await refresh();
                  router.replace("/agents");
                }, "Agent deleted.");
            }}
          >
            <Trash2 size={15} /> Delete agent
          </button>
        </div>
      </form>
    );
  return null;
}

function AgentLogs({ bot }: { bot: Bot }) {
  const [hours, setHours] = useState(24);
  const [status, setStatus] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;
  async function load(showLoading = false) {
    if (showLoading) setLoading(true);
    try {
      const result = await api<any>(`/bots/${bot.id}/workflow/logs?hours=${hours}&status=${status}&event_type=${eventType}&limit=${limit}&offset=${offset}`);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 30000);
    return () => window.clearInterval(timer);
  }, [bot.id, hours, status, eventType, offset]); // eslint-disable-line
  return <section className="agent-logs">
    <div className="agent-logs-heading">
      <div><span className="eyebrow">BOT ACTIVITY</span><h2>Agent logs</h2><p>Review conversations, retrievals, workflow steps, API calls, and errors. Logs are automatically removed after 24 hours.</p></div>
      <div className="agent-logs-controls">
        <label>Time range<select value={hours} onChange={e=>{setOffset(0);setHours(Number(e.target.value));}}><option value={1}>Last hour</option><option value={6}>Last 6 hours</option><option value={12}>Last 12 hours</option><option value={24}>Last 24 hours</option></select></label>
        <label>Event<select value={eventType} onChange={e=>{setOffset(0);setEventType(e.target.value);}}><option value="all">All events</option><option value="message_received">Visitor messages</option><option value="assistant_response">Agent responses</option><option value="knowledge_search">Knowledge searches</option><option value="knowledge_source">Knowledge sources</option><option value="workflow_step">Workflow steps</option><option value="api_call">API calls</option><option value="workflow_saved">Workflow saved</option><option value="workflow_published">Workflow published</option><option value="workflow_enabled">Workflow enabled/disabled</option><option value="agent_created">Agent created</option><option value="agent_settings">Agent settings updated</option><option value="error">Errors</option></select></label>
        <label>Result<select value={status} onChange={e=>{setOffset(0);setStatus(e.target.value);}}><option value="all">All results</option><option value="success">Successful</option><option value="error">Errors only</option></select></label>
        <button className="secondary agent-logs-refresh" onClick={()=>void load(true)}><RefreshCw size={14}/>Refresh</button>
      </div>
    </div>
    <div className="agent-logs-summary"><span><strong>{total}</strong> {status==='error'||eventType==='error'?'errors':'events'} in the selected range</span><span><Clock3 size={14}/>Refreshes every 30 seconds</span></div>
    {error&&<div className="error" role="alert">{error}</div>}
    {loading?<div className="agent-logs-empty">Loading agent logs…</div>:!items.length?<div className="agent-logs-empty"><Activity size={24}/><strong>No bot activity in this time range</strong><span>Visitor messages, agent responses, workflow steps, knowledge-source updates, API results, and errors appear here.</span></div>:
      <div className="agent-log-list">{items.map((item:any)=><article className={'agent-log '+(item.success?'success':'failed')} key={item.id}>
        <div className="agent-log-main"><span className={'agent-log-icon '+(item.success?'success':'failed')}>{item.success?<CheckCircle2 size={17}/>:<CircleAlert size={17}/>}</span><div className="agent-log-title"><strong>{item.title||item.node_name||item.event_type.replace(/_/g,' ')}</strong><div>{item.event_type==='api_call'?<><code>{item.method||'API'}</code><span className="agent-log-url">{item.url}</span></>:<><span className="agent-log-type">{item.event_type.replace(/_/g,' ')}</span>{item.details?.type&&<span className="agent-log-type">{item.details.type}</span>}</>}</div></div><span className={'agent-log-status '+(item.success?'success':'failed')}>{item.status_code||String(item.severity||'info').toUpperCase()}</span></div>
        <div className="agent-log-meta"><time>{new Date(item.created_at).toLocaleString()}</time>{(item.duration_ms||item.details?.latency_ms)&&<span>{item.duration_ms||item.details?.latency_ms} ms</span>}<span className="agent-log-source">{item.source==='playground'?'Playground test':item.source==='dashboard'?'Dashboard':item.source==='worker'?'Ingestion worker':'Visitor chat'}</span></div>
        {item.error&&<div className="agent-log-error">{item.error}</div>}
        <details className="agent-log-response"><summary>{item.event_type==='api_call'?(item.success?'View API response':'View error response'):'View event details'}</summary><pre>{item.event_type==='api_call'?(item.response_preview||item.error||'No response body was received.'):JSON.stringify(item.details||{},null,2)}</pre></details>
      </article>)}</div>}
    <div className="agent-logs-pagination"><button className="secondary" disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-limit))}>Previous</button><span>{total?`${offset+1}–${Math.min(offset+items.length,total)} of ${total}`:'0 results'}</span><button className="secondary" disabled={offset+items.length>=total||loading} onClick={()=>setOffset(offset+limit)}>Next</button></div>
  </section>;
}

function EvalPanel({ base }: { base: string }) {
  const [runs, setRuns] = useState<any[]>([]);
  useEffect(() => {
    api<any[]>(base + "/evals")
      .then(setRuns)
      .catch(() => {});
  }, [base]);
  return (
    <div className="panel eval-panel">
      <h3>Retrieval checks</h3>
      <p>
        Local retrieval smoke tests run after ingestion. Optional LLM synthetic
        QA evaluations are labeled separately.
      </p>
      {runs.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Method</th>
                <th>Source grounding</th>
                <th>Retrieval hit rate</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.method}</td>
                  <td>{Math.round(r.score_faithfulness * 100)}%</td>
                  <td>{Math.round(r.score_relevancy * 100)}%</td>
                  <td>{r.sample_size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Add knowledge to run the first check.</p>
      )}
    </div>
  );
}
function Billing({
  usage,
  action,
  busy,
}: {
  usage: any;
  action: (fn: () => Promise<any>, s?: string) => Promise<void>;
  busy: boolean;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Room to grow.</h1>
          <p>
            A plan for your next chapter. Current plan: {usage?.plan || "free"}. Checkout: {usage?.payment_provider || "Stripe"}.
          </p>
        </div>
        <button
          className="secondary"
          disabled={!usage?.has_subscription || busy}
          onClick={() =>
            action(async () => {
              const d = await api("/billing/portal", { method: "POST" });
              if (d.url) window.location.assign(d.url);
            }, usage?.payment_provider === "razorpay" ? "Cancellation scheduled for the end of the billing cycle." : undefined)
          }
        >
          {usage?.payment_provider === "razorpay" ? "Cancel at renewal" : "Manage subscription"} <ExternalLink size={14} />
        </button>
      </div>
      <div className="plan-grid">
        {[
          { name: "Free", price: "$0", bots: 1, docs: 10, messages: "100" },
          {
            name: "Pro",
            price: "Monthly plan",
            bots: 10,
            docs: 100,
            messages: "5,000",
          },
          {
            name: "Team",
            price: "Monthly plan",
            bots: 50,
            docs: 500,
            messages: "25,000",
          },
        ].map((p, i) => (
          <div
            className={"panel pricing " + (i === 1 ? "featured" : "")}
            key={p.name}
          >
            {i === 1 && <span className="badge">FOR GROWING TEAMS</span>}
            <h2>{p.name}</h2>
            <strong>{p.price}</strong>
            <p>
              {i === 0
                ? "Start building for free."
                : "Subscription pricing is shown at checkout."}
            </p>
            <ul>
              <li>
                <Check size={15} />
                {p.bots} agents
              </li>
              <li>
                <Check size={15} />
                {p.docs} knowledge sources
              </li>
              <li>
                <Check size={15} />
                {p.messages} messages per month
              </li>
              <li>
                <Check size={15} />
                Citations, analytics & embed widget
              </li>
            </ul>
            <button
              className={i === 1 ? "primary full" : "secondary full"}
              disabled={
                busy ||
                usage?.plan === p.name.toLowerCase() ||
                i === 0 ||
                !usage?.billing_configured
              }
              onClick={() =>
                action(async () => {
                  const d = await api("/billing/checkout", {
                    method: "POST",
                    body: JSON.stringify({ plan: p.name.toLowerCase() }),
                  });
                  window.location.assign(d.url);
                })
              }
            >
              {usage?.plan === p.name.toLowerCase()
                ? "Current plan"
                : i === 0
                  ? "Included"
                  : "Subscribe to " + p.name}
            </button>
          </div>
        ))}
      </div>
      {!usage?.billing_configured && (
        <p className="muted">
          Plan upgrades need{" "}
          <a href="/setup" target="_blank" rel="noreferrer">
            one-time billing setup
          </a>
          . Your free plan is ready to use.
        </p>
      )}
      <div className="panel usage-panel">
        <h3>This month&apos;s usage</h3>
        {["bots", "documents", "messages"].map((k) => (
          <div key={k}>
            <span>{k[0].toUpperCase() + k.slice(1)}</span>
            <strong>
              {usage?.[k] || 0} / {usage?.limits[k] || 0}
            </strong>
            <div className="meter">
              <i
                style={{
                  width:
                    Math.min(
                      100,
                      ((usage?.[k] || 0) / (usage?.limits[k] || 1)) * 100,
                    ) + "%",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function Keys({
  action,
  notify,
}: {
  action: (fn: () => Promise<any>, s?: string) => Promise<void>;
  notify: (s: string) => void;
}) {
  const { confirm: confirmDialog } = useDialogs();
  const [keys, setKeys] = useState<any[]>([]),
    [newKey, setNewKey] = useState("");
  const load = () => api<any[]>("/account/keys").then(setKeys);
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Build beyond the dashboard.</h1>
          <p>
            Access your agents with owner-scoped API keys. Treat them like
            passwords.
          </p>
        </div>
      </div>
      <form
        className="panel key-form"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          action(async () => {
            const d = await api("/account/keys", {
              method: "POST",
              body: JSON.stringify({ name: form.get("name") }),
            });
            setNewKey(d.key);
            await load();
          }, "API key created. Copy it now.");
        }}
      >
        <label>
          Key name
          <input
            name="name"
            required
            maxLength={80}
            placeholder="e.g. Website integration"
          />
        </label>
        <button className="primary">
          Create key <Plus size={16} />
        </button>
      </form>
      {newKey && (
        <div className="panel new-key">
          <strong>Copy this key now. It is shown only once.</strong>
          <code>{newKey}</code>
          <button
            className="secondary"
            onClick={() =>
              navigator.clipboard
                .writeText(newKey)
                .then(() => notify("API key copied."))
            }
          >
            Copy key
          </button>
        </div>
      )}
      <div className="panel">
        {keys.length ? (
          keys.map((k) => (
            <div className="source-row" key={k.id}>
              <KeyRound size={19} />
              <div>
                <strong>{k.name}</strong>
                <p>{k.prefix}••••••••</p>
              </div>
              <button
                className="danger"
                onClick={async () => {
                  if (await confirmDialog({ title: "Revoke this API key?", description: "Applications using this key will lose access immediately.", confirmText: "Revoke key", tone: "danger" }))
                    action(async () => {
                      await api("/account/keys/" + k.id, { method: "DELETE" });
                      await load();
                    }, "Key revoked.");
                }}
              >
                Revoke
              </button>
            </div>
          ))
        ) : (
          <Empty
            title="Your integrations start here"
            text="Create a key to call the AgentForge API from your own tools."
          />
        )}
      </div>
      <pre className="embed-code">{`curl ${API}/api/v1/bots \\\n  -H "Authorization: Bearer YOUR_API_KEY"`}</pre>
    </>
  );
}
