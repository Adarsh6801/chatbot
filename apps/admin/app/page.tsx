"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Bot, ChevronLeft, ChevronRight, CircleHelp, CreditCard, LayoutDashboard, LogOut, MessageSquareText, RefreshCw, Search, Shield, ShieldAlert, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminAgent, AdminUser, AuditEvent } from "@/lib/api";
import "./payments.css";

type Admin = { id: string; name: string; email: string; is_admin: boolean };
type View = "overview" | "users" | "agents" | "conversations" | "activity" | "payments";
type PageResult<T> = { items: T[]; total: number; page: number; limit: number };
const labels: Record<View, string> = { overview: "Dashboard", users: "Users", agents: "Agents", conversations: "Conversations", activity: "Admin activity", payments: "Payment provider" };

function date(value?: string) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "red" | "amber" }) { return <span className={`badge ${tone}`}>{children}</span>; }

export default function AdminConsole() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(true);
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<any>(null);
  const [paymentSettings, setPaymentSettings] = useState<any>(null);
  const [rows, setRows] = useState<PageResult<any> | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [loginError, setLoginError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<{ title: string; messages: any[] } | null>(null);

  const refreshOverview = useCallback(async () => setOverview(await api("/admin/overview")), []);
  const refreshPaymentSettings = useCallback(async () => setPaymentSettings(await api("/admin/settings/payment-provider")), []);
  const refreshRows = useCallback(async (activeView: View, activePage: number, q: string) => {
    const path = activeView === "users" ? "/admin/users" : activeView === "agents" ? "/admin/agents" : activeView === "conversations" ? "/admin/conversations" : "/admin/audit";
    const params = new URLSearchParams({ page: String(activePage), limit: "25" });
    if (q) params.set("q", q);
    setRows(await api(`${path}?${params.toString()}`));
  }, []);

  useEffect(() => {
    api<Admin>("/auth/me").then((me) => {
      if (me.is_admin) setAdmin(me);
      else { setDenied(true); api("/auth/logout", { method: "POST" }).catch(() => {}); }
    }).catch(() => {}).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!admin) return;
    setError("");
    const task = view === "overview" ? Promise.all([refreshOverview(), refreshRows("activity", 1, "")]) : view === "payments" ? refreshPaymentSettings() : refreshRows(view, page, submittedQuery);
    task.catch((e) => setError(e.message));
  }, [admin, view, page, submittedQuery, refreshOverview, refreshPaymentSettings, refreshRows]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const me = await api<Admin>("/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      if (!me.is_admin) {
        await api("/auth/logout", { method: "POST" });
        setDenied(true); setLoginError("This account does not have global administrator access."); return;
      }
      setAdmin(me);
    } catch (e) { setLoginError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); } finally { setAdmin(null); setOverview(null); setRows(null); setView("overview"); }
  }

  async function updateUser(user: AdminUser, patch: { plan?: string; is_active?: boolean }) {
    const action = patch.is_active === false ? "suspend this account" : patch.is_active === true ? "reactivate this account" : `change this account to ${patch.plan}`;
    if (!window.confirm(`Confirm: ${action}?`)) return;
    setBusy(true); setError("");
    try {
      await api(`/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await Promise.all([refreshRows("users", page, submittedQuery), refreshOverview()]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleAgent(agent: AdminAgent) {
    const published = !agent.published;
    if (!published && !window.confirm(`Unpublish “${agent.name}”? Visitors will no longer be able to use it.`)) return;
    setBusy(true); setError("");
    try {
      await api(`/admin/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify({ published }) });
      await Promise.all([refreshRows("agents", page, submittedQuery), refreshOverview()]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function selectPaymentProvider(provider: "stripe" | "razorpay") {
    if (!paymentSettings || provider === paymentSettings.provider) return;
    const name = provider === "razorpay" ? "Razorpay" : "Stripe";
    if (!window.confirm(`Use ${name} for new customer checkouts? Existing subscriptions will continue on their current gateway.`)) return;
    setBusy(true); setError("");
    try {
      setPaymentSettings(await api("/admin/settings/payment-provider", { method: "PUT", body: JSON.stringify({ provider }) }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function openConversation(id: string, title: string) {
    try { setTranscript({ title, messages: await api(`/admin/conversations/${id}`) }); }
    catch (e) { setError((e as Error).message); }
  }

  if (checking) return <div className="center"><div className="loader"/>Checking secure admin session…</div>;
  if (!admin) return <main className="login-page"><div className="login-card"><div className="logo"><Shield size={22}/></div><p className="eyebrow">AGENTFORGE · PLATFORM</p><h1>Admin console</h1><p className="subtle">Sign in with the account configured as the platform administrator.</p>{denied && <div className="error-box"><ShieldAlert size={17}/><span>{loginError || "This account is not authorized for the admin console."}</span></div>}<form onSubmit={login}><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{loginError && !denied && <div className="error-box">{loginError}</div>}<button className="primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}<ChevronRight size={16}/></button></form><p className="login-foot"><Shield size={14}/> Admin access is enforced by the API.</p></div></main>;

  const nav: { id: View; icon: LucideIcon }[] = [{ id: "overview", icon: LayoutDashboard }, { id: "users", icon: Users }, { id: "agents", icon: Bot }, { id: "conversations", icon: MessageSquareText }, { id: "payments", icon: CreditCard }, { id: "activity", icon: Activity }];
  const pages = Math.max(1, Math.ceil((rows?.total || 0) / (rows?.limit || 25)));

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Shield size={19}/></div><div><strong>AgentForge</strong><small>Platform admin</small></div></div>
      <div className="side-caption">CONTROL CENTER</div>
      <nav>{nav.map(({ id, icon: Icon }) => <button key={id} className={view === id ? "selected" : ""} onClick={() => { setView(id); setPage(1); setRows(null); }}><Icon size={18}/>{labels[id]}{id === "users" && overview && <span className="nav-badge">{overview.users}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="admin-chip"><div className="avatar">{admin.name?.[0]?.toUpperCase() || "A"}</div><div><strong>{admin.name}</strong><small>Super administrator</small></div></div><button className="logout" onClick={logout}><LogOut size={16}/>Sign out</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="crumb">Platform</span><ChevronRight size={14}/><strong>{labels[view]}</strong></div><div className="top-actions"><span className="secure"><i/> Private admin</span><button className="icon-button" title="Refresh" onClick={() => (view === "overview" ? Promise.all([refreshOverview(), refreshRows("activity", 1, "")]) : view === "payments" ? refreshPaymentSettings() : refreshRows(view, page, submittedQuery)).catch(e => setError(e.message))}><RefreshCw size={16}/></button><div className="avatar small">{admin.name?.[0]?.toUpperCase() || "A"}</div></div></header>
      <div className="content">
        {error && <div className="error-banner"><CircleHelp size={16}/>{error}<button onClick={() => setError("")}><X size={15}/></button></div>}
        {view === "overview" && <Overview data={overview} activity={rows}/>}
        {view === "users" && <><PageHeading eyebrow="ACCOUNT OPERATIONS" title="Users" description="Review accounts, adjust plan access, and suspend or restore sign-in."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><UserTable rows={rows?.items || []} busy={busy} onUpdate={updateUser}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "agents" && <><PageHeading eyebrow="CONTENT OPERATIONS" title="Agents" description="View agents across every workspace and manage publication status."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><AgentTable rows={rows?.items || []} busy={busy} onToggle={toggleAgent}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "conversations" && <><PageHeading eyebrow="SUPPORT OVERSIGHT" title="Conversations" description="Inspect recent visitor conversations across all agents."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><ConversationTable rows={rows?.items || []} onOpen={openConversation}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "activity" && <><PageHeading eyebrow="SECURITY & ACCOUNTABILITY" title="Admin activity" description="A timestamped record of global administrator actions."/><AuditTable rows={rows?.items || []}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "payments" && <><PageHeading eyebrow="BILLING CONTROL" title="Payment provider" description="Choose the gateway customers use for new paid-plan checkouts."/><PaymentSettings data={paymentSettings} busy={busy} onSelect={selectPaymentProvider}/></>}
      </div>
    </main>
    {transcript && <div className="modal-backdrop" onClick={() => setTranscript(null)}><section className="transcript-modal" onClick={e => e.stopPropagation()}><header><div><p className="eyebrow">CONVERSATION TRANSCRIPT</p><h2>{transcript.title}</h2></div><button className="icon-button" onClick={() => setTranscript(null)}><X size={18}/></button></header><div className="transcript-body">{transcript.messages.map((m:any)=><article key={m.id} className={`chat-line ${m.role}`}><small>{m.role === "user" ? "Visitor" : "Agent"} · {date(m.created_at)}</small><p>{m.content}</p>{m.citations?.length > 0 && <details><summary>{m.citations.length} citations</summary>{m.citations.map((c:any,i:number)=><p className="citation" key={i}>{c.source}: {c.excerpt}</p>)}</details>}</article>)}</div></section></div>}
  </div>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subtle">{description}</p></div></div>; }
function SearchBar({ query, setQuery, onSearch }: { query: string; setQuery: (v: string) => void; onSearch: () => void }) { return <form className="searchbar" onSubmit={e => { e.preventDefault(); onSearch(); }}><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, email, or agent…"/><button className="secondary">Search</button></form>; }
function Pager({ page, pages, total, setPage }: { page: number; pages: number; total: number; setPage: (n: number) => void }) { return <div className="pager"><span>{total} records · page {page} of {pages}</span><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15}/>Previous</button><button className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next<ChevronRight size={15}/></button></div></div>; }
function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string | number; detail: string }) { return <div className="metric-card"><div className="metric-label">{icon}{label}</div><strong>{value}</strong><small>{detail}</small></div>; }
function Overview({ data, activity }: { data: any; activity: any }) {
  return <><PageHeading eyebrow="PLATFORM OVERVIEW" title="Dashboard" description="A live view of accounts, agents, usage, and platform integrations."/>{!data ? <div className="loading-card">Loading platform metrics…</div> : <><div className="welcome"><div><span>ADMINISTRATOR WORKSPACE</span><h2>Welcome back, let’s keep things running.</h2><p>Platform-wide visibility and account controls.</p></div><div className="welcome-icon"><Shield size={34}/></div></div><div className="metrics-grid"><Metric icon={<Users size={17}/>} label="Total users" value={data.users} detail={`${data.active_users} active · ${data.suspended_users} suspended`}/><Metric icon={<Bot size={17}/>} label="Total agents" value={data.agents} detail={`${data.published_agents} published`}/><Metric icon={<MessageSquareText size={17}/>} label="Knowledge sources" value={data.documents} detail="Across all workspaces"/><Metric icon={<Activity size={17}/>} label="Visitor messages" value={data.messages} detail="All time"/></div><div className="overview-grid-two"><section className="panel"><div className="panel-heading"><div><h2>Plan distribution</h2><p>Accounts by current plan</p></div></div><div className="plan-list">{["free","pro","team"].map((plan:string)=><div key={plan}><span className={`plan-dot ${plan}`}/><span className="capitalize">{plan}</span><strong>{data.plans[plan] || 0}</strong></div>)}</div></section><section className="panel"><div className="panel-heading"><div><h2>Integrations</h2><p>Configured service connections</p></div><Shield size={18}/></div><div className="integration-list">{Object.entries(data.integrations || {}).map(([name, enabled])=><div key={name}><span>{name}</span><Badge tone={enabled ? "green" : "gray"}>{enabled ? "Configured" : "Not configured"}</Badge></div>)}</div></section></div><section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent administrator actions</h2><p>Latest account and agent changes</p></div><span className="subtle small-text">See Admin activity for the full log</span></div><AuditTable rows={activity?.items?.slice(0, 5) || []}/></section></>}</>;
}
function UserTable({ rows, busy, onUpdate }: { rows: AdminUser[]; busy: boolean; onUpdate: (u: AdminUser, p: {plan?:string;is_active?:boolean}) => void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>USER</th><th>PLAN</th><th>AGENTS</th><th>MESSAGES</th><th>STATUS</th><th>JOINED</th><th>ACCOUNT ACTIONS</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td><strong>{u.name}</strong><small>{u.email}</small></td><td><select aria-label={`Plan for ${u.email}`} disabled={busy} value={u.plan} onChange={e=>onUpdate(u,{plan:e.target.value})}><option value="free">Free</option><option value="pro">Pro</option><option value="team">Team</option></select>{u.has_subscription && <small className="table-note">Stripe may resync plan</small>}</td><td>{u.agent_count}</td><td>{u.message_count}</td><td><Badge tone={u.is_active?"green":"red"}>{u.is_active?"Active":"Suspended"}</Badge></td><td>{date(u.created_at)}</td><td><button className={u.is_active?"danger-outline":"success-outline"} disabled={busy} onClick={()=>onUpdate(u,{is_active:!u.is_active})}>{u.is_active?"Suspend":"Reactivate"}</button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No user accounts match this search."/>}</div></div>; }
function AgentTable({ rows, busy, onToggle }: { rows: AdminAgent[]; busy: boolean; onToggle: (a: AdminAgent) => void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>AGENT</th><th>OWNER</th><th>SOURCES</th><th>MESSAGES</th><th>STATUS</th><th>CREATED</th><th>ACTION</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td><strong>{a.name}</strong><small className="mono">{a.id}</small></td><td>{a.owner_email}</td><td>{a.documents}</td><td>{a.messages}</td><td><Badge tone={a.published?"green":"amber"}>{a.published?"Published":"Draft"}</Badge></td><td>{date(a.created_at)}</td><td><button className={a.published?"danger-outline":"success-outline"} disabled={busy} onClick={()=>onToggle(a)}>{a.published?"Unpublish":"Publish"}</button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No agents match this search."/>}</div></div>; }
function ConversationTable({ rows, onOpen }: { rows: any[]; onOpen: (id:string,title:string)=>void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>AGENT / OWNER</th><th>LAST MESSAGE</th><th>MESSAGES</th><th>STARTED</th><th/></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><strong>{c.agent_name}</strong><small>{c.owner_email}</small></td><td className="message-preview">{c.last_message}</td><td>{c.message_count}</td><td>{date(c.created_at)}</td><td><button className="secondary" onClick={()=>onOpen(c.id,c.agent_name)}>View transcript<ChevronRight size={14}/></button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No conversations found."/>}</div></div>; }
function AuditTable({ rows }: { rows: AuditEvent[] }) { return <div className="table-scroll"><table><thead><tr><th>EVENT</th><th>ADMINISTRATOR</th><th>DETAILS</th><th>TIME</th></tr></thead><tbody>{rows.map(e=><tr key={e.id}><td><Badge tone={e.action.includes("suspend")?"red":"amber"}>{e.action}</Badge></td><td>{e.actor_email}</td><td>{Object.entries(e.details || {}).map(([k,v])=>`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || e.entity_id}</td><td>{date(e.created_at)}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No administrator actions recorded yet."/>}</div>; }
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function PaymentSettings({ data, busy, onSelect }: { data: any; busy: boolean; onSelect: (provider: "stripe" | "razorpay") => void }) {
  if (!data) return <div className="loading-card">Loading payment configuration…</div>;
  return <><div className="panel payment-panel"><div className="panel-heading"><div><h2>Active checkout gateway</h2><p>Existing subscriptions stay on their original provider.</p></div><Badge tone={data.providers[data.provider]?.configured ? "green" : "red"}>{data.provider} · {data.providers[data.provider]?.configured ? "Ready" : "Needs setup"}</Badge></div><div className="gateway-grid">{(["stripe", "razorpay"] as const).map(provider=>{const item=data.providers[provider];const active=data.provider===provider;return <button type="button" key={provider} className={`gateway-card ${active?"active":""}`} disabled={busy||!item.configured} onClick={()=>onSelect(provider)}><span className="gateway-top"><strong>{provider === "stripe" ? "Stripe" : "Razorpay"}</strong><Badge tone={item.configured?"green":"gray"}>{item.configured?"Configured":"Not configured"}</Badge></span><span className="gateway-description">{provider === "stripe" ? "Hosted recurring checkout and customer billing portal." : "Hosted recurring subscriptions with Razorpay Subscriptions."}</span><span className="gateway-select">{active?"Currently selected":item.configured?"Select for new checkouts":"Add credentials to enable"}</span>{!item.configured&&<small className="missing-keys">Required API environment values: {item.requirements.join(", ")}</small>}</button>;})}</div><p className="payment-note"><Shield size={15}/> API secrets stay in the server environment. Configure credentials and plan IDs in <code>.env</code>, then restart the API. The console only displays whether each gateway is ready.</p></div><div className="panel webhook-panel"><h2>Webhook endpoints</h2><p>Configure both gateways to send signed subscription events to the matching endpoint.</p><code>Stripe: /api/v1/webhooks/stripe</code><code>Razorpay: /api/v1/webhooks/razorpay</code><small>Payment access is granted or removed only after a verified webhook updates the account.</small></div></>;
}
