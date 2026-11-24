"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Bot, ChevronLeft, ChevronRight, CircleHelp, CreditCard, LayoutDashboard, LogOut, MessageSquareText, RefreshCw, Search, Shield, ShieldAlert, Users, X, Settings2, Upload, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminAgent, AdminUser, AuditEvent } from "@/lib/api";
import { SupportEditor, SupportMessageView } from "./SupportRichText";
import "./payments.css";

type Admin = { id: string; name: string; email: string; is_admin: boolean };
type View = "overview" | "users" | "agents" | "conversations" | "tickets" | "activity" | "payments" | "site";
type PageResult<T> = { items: T[]; total: number; page: number; limit: number };
const labels: Record<View, string> = { overview: "Dashboard", users: "Users", agents: "Agents", conversations: "Conversations", tickets: "Support tickets", activity: "Admin activity", payments: "Payment provider", site: "Site settings" };

function date(value?: string) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "red" | "amber" }) { return <span className={`badge ${tone}`}>{children}</span>; }

async function cropSiteLogo(file: File): Promise<Blob> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image under 10 MB.");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");canvas.width=256;canvas.height=256;
  const context = canvas.getContext("2d");
  if (!context) {bitmap.close();throw new Error("Your browser could not crop this image.");}
  context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);bitmap.close();
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not create the cropped logo.")),"image/png"));
}

export default function AdminConsole() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(true);
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<any>(null);
  const [paymentSettings, setPaymentSettings] = useState<any>(null);
  const [siteSettings, setSiteSettings] = useState<{name:string;logo_url:string;has_logo:boolean}>({name:"AgentForge",logo_url:"",has_logo:false});
  const [siteName, setSiteName] = useState("AgentForge");
  const [siteLogoChanged, setSiteLogoChanged] = useState(false);
  const [siteLogoUploading, setSiteLogoUploading] = useState(false);
  const [rows, setRows] = useState<PageResult<any> | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [loginError, setLoginError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<{ title: string; messages: any[] } | null>(null);
  const [supportThread, setSupportThread] = useState<any>(null);
  const [supportReply, setSupportReply] = useState("");
  const [supportUnread, setSupportUnread] = useState(0);
  const [ticketNotice, setTicketNotice] = useState("");
  const previousSupportUnread = useRef<number | null>(null);

  const refreshOverview = useCallback(async () => setOverview(await api("/admin/overview")), []);
  const refreshPaymentSettings = useCallback(async () => setPaymentSettings(await api("/admin/settings/payment-provider")), []);
  const refreshSiteSettings = useCallback(async () => {
    const result = await api<{name:string;logo_url:string;has_logo:boolean}>("/admin/settings/site");
    setSiteSettings(result);setSiteName(result.name);setSiteLogoChanged(false);
  }, []);
  const refreshRows = useCallback(async (activeView: View, activePage: number, q: string) => {
    const path = activeView === "users" ? "/admin/users" : activeView === "agents" ? "/admin/agents" : activeView === "conversations" ? "/admin/conversations" : activeView === "tickets" ? "/admin/support/tickets" : "/admin/audit";
    const params = new URLSearchParams({ page: String(activePage), limit: "25" });
    if (q) params.set("q", q);
    const result = await api<any>(`${path}?${params.toString()}`);
    setRows(result);
    if (activeView === "tickets") setSupportUnread(result.unread || 0);
  }, []);

  useEffect(() => {
    api<{name:string;logo_url:string}>('/public/site-settings').then(branding=>{
      setSiteName(branding.name);setSiteSettings(current=>({...current,name:branding.name,logo_url:branding.logo_url,has_logo:!!branding.logo_url}));
    }).catch(() => {});
    api<Admin>("/auth/me").then((me) => {
      if (me.is_admin) setAdmin(me);
      else { setDenied(true); api("/auth/logout", { method: "POST" }).catch(() => {}); }
    }).catch(() => {}).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!admin) return;
    setError("");
    const task = view === "overview" ? Promise.all([refreshOverview(), refreshRows("activity", 1, "")]) : view === "payments" ? refreshPaymentSettings() : view === "site" ? refreshSiteSettings() : refreshRows(view, page, submittedQuery);
    task.catch((e) => setError(e.message));
  }, [admin, view, page, submittedQuery, refreshOverview, refreshPaymentSettings, refreshSiteSettings, refreshRows]);

  useEffect(() => {if (admin) void refreshSiteSettings().catch((e) => setError(e.message));}, [admin, refreshSiteSettings]);
  useEffect(() => {if (typeof document !== "undefined") document.title = `${siteSettings.name} Admin`;}, [siteSettings.name]);

  useEffect(() => {
    if (!admin) return;
    const poll = async () => {
      try {
        const result = await api<any>("/admin/support/tickets?page=1&limit=1");
        const unread = result.unread || 0;
        if (previousSupportUnread.current !== null && unread > previousSupportUnread.current) setTicketNotice("A new customer support ticket needs your attention.");
        previousSupportUnread.current = unread;
        setSupportUnread(unread);
      }
      catch { /* Ticket notification polling must not interrupt the current page. */ }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 20000);
    return () => window.clearInterval(timer);
  }, [admin]);

  useEffect(() => {
    if (!admin || view !== "tickets" || !supportThread?.id) return;
    const timer = window.setInterval(() => {
      void api<any>(`/admin/support/tickets/${supportThread.id}`).then(setSupportThread).catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [admin, view, supportThread?.id]);

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

  async function saveSiteSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError("");
    try {
      await api("/admin/settings/site",{method:"PUT",body:JSON.stringify({name:siteName,logo:siteLogoChanged?"":undefined})});
      await refreshSiteSettings();setError("");
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  async function uploadSiteLogo(file: File) {
    setSiteLogoUploading(true);setError("");
    try {
      const cropped = await cropSiteLogo(file);
      const form = new FormData();form.append("file",new File([cropped],"site-logo.png",{type:"image/png"}));
      const result = await api<{logo_url:string}>("/admin/settings/site/logo",{method:"POST",body:form});
      setSiteSettings(current=>({...current,logo_url:result.logo_url,has_logo:true}));setSiteLogoChanged(false);
    } catch(e) {setError((e as Error).message);} finally {setSiteLogoUploading(false);}
  }

  async function openConversation(id: string, title: string) {
    try { setTranscript({ title, messages: await api(`/admin/conversations/${id}`) }); }
    catch (e) { setError((e as Error).message); }
  }

  async function openSupportTicket(id: string) {
    try {
      await api(`/admin/support/tickets/${id}/read`, { method: "POST" });
      setSupportThread(await api(`/admin/support/tickets/${id}`));
      setSupportReply("");
      await refreshRows("tickets", page, submittedQuery);
    } catch (e) { setError((e as Error).message); }
  }

  async function sendSupportReply(event: FormEvent) {
    event.preventDefault(); if (!supportThread) return;
    if (!supportReply.trim()) { setError("Reply cannot be blank."); return; }
    setBusy(true); setError("");
    try {
      await api(`/admin/support/tickets/${supportThread.id}/messages`, { method: "POST", body: JSON.stringify({ message: supportReply }) });
      setSupportReply("");
      setSupportThread(await api(`/admin/support/tickets/${supportThread.id}`));
      await refreshRows("tickets", page, submittedQuery);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function changeSupportStatus(status: string) {
    if (!supportThread) return;
    setBusy(true); setError("");
    try {
      await api(`/admin/support/tickets/${supportThread.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setSupportThread(await api(`/admin/support/tickets/${supportThread.id}`));
      await refreshRows("tickets", page, submittedQuery);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (checking) return <div className="center"><div className="loader"/>Checking secure admin session…</div>;
  if (!admin) return <main className="login-page"><div className="login-card"><div className="logo">{siteSettings.logo_url?<img src={siteSettings.logo_url} alt=""/>:<Shield size={22}/>}</div><p className="eyebrow">{siteName.toUpperCase()} · PLATFORM</p><h1>Admin console</h1><p className="subtle">Sign in with the account configured as the platform administrator.</p>{denied && <div className="error-box"><ShieldAlert size={17}/><span>{loginError || "This account does not have global administrator access."}</span></div>}<form onSubmit={login}><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{loginError && !denied && <div className="error-box">{loginError}</div>}<button className="primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}<ChevronRight size={16}/></button></form><p className="login-foot"><Shield size={14}/> Admin access is enforced by the API.</p></div></main>;

  const nav: { id: View; icon: LucideIcon }[] = [{ id: "overview", icon: LayoutDashboard }, { id: "users", icon: Users }, { id: "agents", icon: Bot }, { id: "conversations", icon: MessageSquareText }, { id: "tickets", icon: CircleHelp }, { id: "payments", icon: CreditCard }, { id: "activity", icon: Activity }, { id: "site", icon: Settings2 }];
  const pages = Math.max(1, Math.ceil((rows?.total || 0) / (rows?.limit || 25)));

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">{siteSettings.logo_url?<img src={siteSettings.logo_url} alt=""/>:<Shield size={19}/>}</div><div><strong>{siteSettings.name}</strong><small>Platform admin</small></div></div>
      <div className="side-caption">CONTROL CENTER</div>
      <nav>{nav.map(({ id, icon: Icon }) => <button key={id} className={view === id ? "selected" : ""} onClick={() => { setView(id); setPage(1); setRows(null); }}><Icon size={18}/>{labels[id]}{id === "users" && overview && <span className="nav-badge">{overview.users}</span>}{id === "tickets" && supportUnread > 0 && <span className="nav-badge">{supportUnread}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="admin-chip"><div className="avatar">{admin.name?.[0]?.toUpperCase() || "A"}</div><div><strong>{admin.name}</strong><small>Super administrator</small></div></div><button className="logout" onClick={logout}><LogOut size={16}/>Sign out</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="crumb">Platform</span><ChevronRight size={14}/><strong>{labels[view]}</strong></div><div className="top-actions"><span className="secure"><i/> Private admin</span><button className="icon-button" title="Refresh" onClick={() => (view === "overview" ? Promise.all([refreshOverview(), refreshRows("activity", 1, "")]) : view === "payments" ? refreshPaymentSettings() : view === "site" ? refreshSiteSettings() : refreshRows(view, page, submittedQuery)).catch(e => setError(e.message))}><RefreshCw size={16}/></button><div className="avatar small">{admin.name?.[0]?.toUpperCase() || "A"}</div></div></header>
      <div className="content">
        {ticketNotice && <div className="ticket-notice"><CircleHelp size={16}/><span>{ticketNotice}</span><button onClick={()=>setTicketNotice("")} aria-label="Dismiss notification"><X size={14}/></button></div>}
        {error && <div className="error-banner"><CircleHelp size={16}/>{error}<button onClick={() => setError("")}><X size={15}/></button></div>}
        {view === "overview" && <Overview data={overview} activity={rows}/>}
        {view === "users" && <><PageHeading eyebrow="ACCOUNT OPERATIONS" title="Users" description="Review accounts, adjust plan access, and suspend or restore sign-in."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><UserTable rows={rows?.items || []} busy={busy} onUpdate={updateUser}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "agents" && <><PageHeading eyebrow="CONTENT OPERATIONS" title="Agents" description="View agents across every workspace and manage publication status."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><AgentTable rows={rows?.items || []} busy={busy} onToggle={toggleAgent}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "conversations" && <><PageHeading eyebrow="SUPPORT OVERSIGHT" title="Conversations" description="Inspect recent visitor conversations across all agents."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><ConversationTable rows={rows?.items || []} onOpen={openConversation}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "tickets" && <><PageHeading eyebrow="CUSTOMER CARE" title="Support tickets" description="Reply to customer requests, update ticket status, and follow the full message thread."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><SupportTicketTable rows={rows?.items || []} onOpen={openSupportTicket}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "activity" && <><PageHeading eyebrow="SECURITY & ACCOUNTABILITY" title="Admin activity" description="A timestamped record of global administrator actions."/><AuditTable rows={rows?.items || []}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "payments" && <><PageHeading eyebrow="BILLING CONTROL" title="Payment provider" description="Choose the gateway customers use for new paid-plan checkouts."/><PaymentSettings data={paymentSettings} busy={busy} onSelect={selectPaymentProvider}/></>}
        {view === "site" && <><PageHeading eyebrow="BRAND IDENTITY" title="Site settings" description="Set the application name and logo shown throughout the website and admin panel."/><form className="panel site-settings-panel" onSubmit={saveSiteSettings}><label>Application name<input value={siteName} onChange={event=>setSiteName(event.target.value)} maxLength={80} required/></label><div className="site-logo-settings"><div><h2>Application logo</h2><p>Upload an image and we’ll center-crop it to a fixed 256 × 256 PNG for consistent display.</p></div><div className="site-logo-preview">{siteSettings.logo_url?<img src={siteSettings.logo_url} alt="Application logo preview"/>:<span><ImageIcon size={25}/></span>}</div></div><label className="site-logo-upload secondary"><Upload size={15}/>{siteLogoUploading?"Cropping and uploading…":"Choose logo image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={siteLogoUploading||busy} onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void uploadSiteLogo(file);event.currentTarget.value="";}}/></label><small className="site-logo-help">PNG, JPG, WEBP, or GIF · maximum 10 MB · center-cropped to 256 × 256</small>{siteSettings.has_logo&&!siteLogoChanged&&<button type="button" className="danger-outline site-logo-remove" onClick={()=>{setSiteSettings(current=>({...current,has_logo:false,logo_url:""}));setSiteLogoChanged(true);}}>Remove logo</button>}{siteLogoChanged&&<p className="site-logo-pending">Logo removal will take effect when you save.</p>}<div className="site-settings-footer"><span>Branding changes appear across the public site after the next page load.</span><button className="primary" disabled={busy||siteLogoUploading}>Save site settings</button></div></form></>}
      </div>
    </main>
    {transcript && <div className="modal-backdrop" onClick={() => setTranscript(null)}><section className="transcript-modal" onClick={e => e.stopPropagation()}><header><div><p className="eyebrow">CONVERSATION TRANSCRIPT</p><h2>{transcript.title}</h2></div><button className="icon-button" onClick={() => setTranscript(null)}><X size={18}/></button></header><div className="transcript-body">{transcript.messages.map((m:any)=><article key={m.id} className={`chat-line ${m.role}`}><small>{m.role === "user" ? "Visitor" : "Agent"} · {date(m.created_at)}</small><p>{m.content}</p>{m.citations?.length > 0 && <details><summary>{m.citations.length} citations</summary>{m.citations.map((c:any,i:number)=><p className="citation" key={i}>{c.source}: {c.excerpt}</p>)}</details>}</article>)}</div></section></div>}
    {supportThread && <div className="modal-backdrop" onClick={() => setSupportThread(null)}><section className="support-admin-modal" onClick={e => e.stopPropagation()}><header><div><p className="eyebrow">SUPPORT TICKET · {supportThread.id.slice(0,8).toUpperCase()}</p><h2>{supportThread.subject}</h2><p className="subtle">{supportThread.user_name} · {supportThread.user_email}</p></div><button className="icon-button" onClick={() => setSupportThread(null)}><X size={18}/></button></header><div className="support-admin-controls"><label>Status<select disabled={busy} value={supportThread.status} onChange={e=>void changeSupportStatus(e.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_on_user">Waiting on user</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><span>Updated {date(supportThread.updated_at)}</span></div><div className="support-admin-messages">{supportThread.messages.map((m:any)=><article key={m.id} className={`admin-ticket-message ${m.author_role}`}><small>{m.author_name} · {date(m.created_at)}</small><SupportMessageView text={m.body}/></article>)}</div><form className="support-admin-reply" onSubmit={sendSupportReply}><SupportEditor value={supportReply} onChange={setSupportReply} maxLength={10000} rows={3} placeholder="Reply to the customer…"/><button className="primary" disabled={busy}><MessageSquareText size={15}/>{busy?"Sending…":"Send reply"}</button></form></section></div>}
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
function SupportTicketTable({ rows, onOpen }: { rows: any[]; onOpen: (id:string)=>void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>TICKET</th><th>USER</th><th>LAST REPLY</th><th>STATUS</th><th>UPDATED</th><th/></tr></thead><tbody>{rows.map(t=><tr key={t.id} className={t.admin_unread?"ticket-unread":""}><td><strong>{t.subject}</strong><small className="mono">{t.id.slice(0,8)}</small></td><td><strong>{t.user_name}</strong><small>{t.user_email}</small></td><td className="message-preview">{t.last_message}</td><td><Badge tone={t.status==="open"?"amber":t.status==="resolved"||t.status==="closed"?"green":"gray"}>{t.status.replaceAll("_"," ")}</Badge></td><td>{date(t.updated_at)}</td><td><button className="secondary" onClick={()=>onOpen(t.id)}>Open ticket<ChevronRight size={14}/></button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No support tickets found."/>}</div></div>; }
function AuditTable({ rows }: { rows: AuditEvent[] }) { return <div className="table-scroll"><table><thead><tr><th>EVENT</th><th>ADMINISTRATOR</th><th>DETAILS</th><th>TIME</th></tr></thead><tbody>{rows.map(e=><tr key={e.id}><td><Badge tone={e.action.includes("suspend")?"red":"amber"}>{e.action}</Badge></td><td>{e.actor_email}</td><td>{Object.entries(e.details || {}).map(([k,v])=>`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || e.entity_id}</td><td>{date(e.created_at)}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No administrator actions recorded yet."/>}</div>; }
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function PaymentSettings({ data, busy, onSelect }: { data: any; busy: boolean; onSelect: (provider: "stripe" | "razorpay") => void }) {
  if (!data) return <div className="loading-card">Loading payment configuration…</div>;
  return <><div className="panel payment-panel"><div className="panel-heading"><div><h2>Active checkout gateway</h2><p>Existing subscriptions stay on their original provider.</p></div><Badge tone={data.providers[data.provider]?.configured ? "green" : "red"}>{data.provider} · {data.providers[data.provider]?.configured ? "Ready" : "Needs setup"}</Badge></div><div className="gateway-grid">{(["stripe", "razorpay"] as const).map(provider=>{const item=data.providers[provider];const active=data.provider===provider;return <button type="button" key={provider} className={`gateway-card ${active?"active":""}`} disabled={busy||!item.configured} onClick={()=>onSelect(provider)}><span className="gateway-top"><strong>{provider === "stripe" ? "Stripe" : "Razorpay"}</strong><Badge tone={item.configured?"green":"gray"}>{item.configured?"Configured":"Not configured"}</Badge></span><span className="gateway-description">{provider === "stripe" ? "Hosted recurring checkout and customer billing portal." : "Hosted recurring subscriptions with Razorpay Subscriptions."}</span><span className="gateway-select">{active?"Currently selected":item.configured?"Select for new checkouts":"Add credentials to enable"}</span>{!item.configured&&<small className="missing-keys">Required API environment values: {item.requirements.join(", ")}</small>}</button>;})}</div><p className="payment-note"><Shield size={15}/> API secrets stay in the server environment. Configure credentials and plan IDs in <code>.env</code>, then restart the API. The console only displays whether each gateway is ready.</p></div><div className="panel webhook-panel"><h2>Webhook endpoints</h2><p>Configure both gateways to send signed subscription events to the matching endpoint.</p><code>Stripe: /api/v1/webhooks/stripe</code><code>Razorpay: /api/v1/webhooks/razorpay</code><small>Payment access is granted or removed only after a verified webhook updates the account.</small></div></>;
}
