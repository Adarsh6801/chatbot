"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Bot, BookOpen, ChevronLeft, ChevronRight, CircleHelp, CreditCard, Eye, FileText, LayoutDashboard, LogOut, MessageSquareText, RefreshCw, Search, Shield, ShieldAlert, Users, X, Settings2, Upload, Image as ImageIcon, Sparkles, Zap } from "lucide-react";
import { api, API } from "@/lib/api";
import type { AdminAgent, AdminUser, AuditEvent } from "@/lib/api";
import { SupportEditor, SupportMessageView } from "./SupportRichText";
import DocumentationAdmin from "./DocumentationAdmin";
import PagesAdmin from "./PagesAdmin";
import SiteBotAdmin from "./SiteBotAdmin";
import UserDetailModal from "./UserDetailModal";
import "./payments.css";
import "./langfuse.css";

type Admin = { id: string; name: string; email: string; is_admin: boolean };
type View = "overview" | "users" | "agents" | "conversations" | "tickets" | "activity" | "payments" | "plans" | "chat-templates" | "langfuse" | "documentation" | "pages" | "site-bot" | "site";
type PageResult<T> = { items: T[]; total: number; page: number; limit: number; plan_options?: {slug:string;name:string}[] };
type DateRange = { from: string; to: string };
const labels: Record<View, string> = { overview: "Dashboard", users: "Users", agents: "Agents", conversations: "Conversations", tickets: "Support tickets", activity: "Admin activity", payments: "Payment provider", plans: "Plans management", "chat-templates": "Chat templates", langfuse: "Langfuse traces", documentation: "Documentation", pages: "Pages", "site-bot": "Website bot", site: "Site settings" };

function date(value?: string) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function dateInputValue(value: Date) { return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`; }
function lastDaysRange(days: number): DateRange { const end = new Date(); const start = new Date(end); start.setDate(start.getDate()-(days-1)); return {from:dateInputValue(start),to:dateInputValue(end)}; }
function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "red" | "amber" }) { return <span className={`badge ${tone}`}>{children}</span>; }

async function cropSiteLogo(file: File): Promise<Blob> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image under 10 MB.");
  const bitmap = await createImageBitmap(file);
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = bitmap.width;
  srcCanvas.height = bitmap.height;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) {bitmap.close();throw new Error("Your browser could not process this image.");}
  srcCtx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Safely trim excess uniform margins (e.g. wide padding around wordmark logos)
  let sx = 0, sy = 0, sw = srcCanvas.width, sh = srcCanvas.height;
  if (sw * sh <= 4096 * 4096) {
    const imgData = srcCtx.getImageData(0, 0, sw, sh).data;
    const cornerAlpha = imgData[3];
    const r0 = imgData[0], g0 = imgData[1], b0 = imgData[2];
    const isBg = (idx: number) => {
      const a = imgData[idx + 3];
      if (cornerAlpha < 20) return a < 20;
      if (a < 20) return true;
      return Math.abs(imgData[idx] - r0) + Math.abs(imgData[idx + 1] - g0) + Math.abs(imgData[idx + 2] - b0) < 36;
    };
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (!isBg((y * sw + x) * 4)) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX > minX && maxY > minY) {
      const pad = Math.max(2, Math.round(Math.max(maxX - minX, maxY - minY) * 0.02));
      sx = Math.max(0, minX - pad);
      sy = Math.max(0, minY - pad);
      sw = Math.min(srcCanvas.width - sx, maxX - minX + 1 + pad * 2);
      sh = Math.min(srcCanvas.height - sy, maxY - minY + 1 + pad * 2);
    }
  }

  const scale = Math.min(640 / sw, 256 / sh, 1);
  const width = Math.max(32, Math.round(sw * scale));
  const height = Math.max(32, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not process this image.");
  context.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, width, height);
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Could not create the PNG logo.")),"image/png"));
}

export default function AdminConsole() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(true);
  const [google, setGoogle] = useState<boolean|null>(null);
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<any>(null);
  const [paymentSettings, setPaymentSettings] = useState<any>(null);
  const [paymentRows, setPaymentRows] = useState<PageResult<any> | null>(null);
  const [subscriptionRows, setSubscriptionRows] = useState<PageResult<any> | null>(null);
  const [langfuseData, setLangfuseData] = useState<{configured:boolean;items:any[];cursor:string|null}|null>(null);
  const [langfuseMetrics, setLangfuseMetrics] = useState<any>(null);
  const [langfuseMetricsLoading, setLangfuseMetricsLoading] = useState(false);
  const [langfuseRange, setLangfuseRange] = useState<DateRange>(()=>lastDaysRange(7));
  const [langfuseDraftRange, setLangfuseDraftRange] = useState<DateRange>(langfuseRange);
  const [documentationRefreshToken, setDocumentationRefreshToken] = useState(0);
  const [pagesRefreshToken, setPagesRefreshToken] = useState(0);
  const [siteBotRefreshToken, setSiteBotRefreshToken] = useState(0);
  const [siteSettings, setSiteSettings] = useState<{name:string;logo_url:string;has_logo:boolean;brand_display:"both"|"image"|"text"}>({name:"AgentForge",logo_url:"",has_logo:false,brand_display:"both"});
  const [siteName, setSiteName] = useState("AgentForge");
  const [brandDisplay, setBrandDisplay] = useState<"both"|"image"|"text">("both");
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
  const [viewedUserId, setViewedUserId] = useState<string | null>(null);
  const [supportReply, setSupportReply] = useState("");
  const [supportUnread, setSupportUnread] = useState(0);
  const [ticketNotice, setTicketNotice] = useState("");
  const previousSupportUnread = useRef<number | null>(null);

  const refreshOverview = useCallback(async () => setOverview(await api("/admin/overview")), []);
  const refreshPaymentSettings = useCallback(async () => {
    const [settings, records, subscriptions] = await Promise.all([api("/admin/settings/payment-provider"), api<PageResult<any>>(`/admin/payments?page=${page}&limit=25`), api<PageResult<any>>(`/admin/subscriptions?page=${page}&limit=25`)]);
    setPaymentSettings(settings);setPaymentRows(records);setSubscriptionRows(subscriptions);
  }, [page]);
  const refreshSiteSettings = useCallback(async () => {
    const result = await api<{name:string;logo_url:string;has_logo:boolean;brand_display?:"both"|"image"|"text"}>("/admin/settings/site");
    const mode = result.brand_display === "image" || result.brand_display === "text" ? result.brand_display : "both";
    setSiteSettings({...result, brand_display: mode});setSiteName(result.name);setBrandDisplay(mode);setSiteLogoChanged(false);
  }, []);
  const refreshLangfuse = useCallback(async (cursor?: string) => {
    const query = new URLSearchParams({limit:"50"}); if(cursor) query.set("cursor",cursor);
    const result = await api<{configured:boolean;items:any[];cursor:string|null}>(`/admin/langfuse/observations?${query}`);
    setLangfuseData(current => cursor && current ? {...result,items:[...current.items,...result.items]} : result);
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
    api<{name:string;logo_url:string;brand_display?:"both"|"image"|"text"}>('/public/site-settings').then(branding=>{
      const mode = branding.brand_display === "image" || branding.brand_display === "text" ? branding.brand_display : "both";
      setSiteName(branding.name);setBrandDisplay(mode);setSiteSettings(current=>({...current,name:branding.name,logo_url:branding.logo_url,has_logo:!!branding.logo_url,brand_display:mode}));
    }).catch(() => {});
    api<{google_enabled:boolean}>('/auth/config').then(config=>setGoogle(config.google_enabled)).catch(()=>setGoogle(false));
    api<Admin>("/auth/me").then((me) => {
      if (me.is_admin) setAdmin(me);
      else { setDenied(true); api("/auth/logout", { method: "POST" }).catch(() => {}); }
    }).catch(() => {}).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!admin) return;
    setError("");
    const task = view === "overview" ? Promise.all([refreshOverview(), refreshRows("activity", 1, "")]) : view === "payments" ? refreshPaymentSettings() : view === "site" ? refreshSiteSettings() : view === "langfuse" ? refreshLangfuse() : view === "documentation" || view === "plans" || view === "pages" || view === "site-bot" ? Promise.resolve() : refreshRows(view, page, submittedQuery);
    task.catch((e) => setError(e.message));
  }, [admin, view, page, submittedQuery, refreshOverview, refreshPaymentSettings, refreshSiteSettings, refreshLangfuse, refreshRows]);

  useEffect(() => {
    if (!admin || view !== "langfuse") return;
    let current = true;
    const from = new Date(`${langfuseRange.from}T00:00:00`);
    const toExclusive = new Date(`${langfuseRange.to}T00:00:00`);
    toExclusive.setDate(toExclusive.getDate()+1);
    const to = new Date(toExclusive.getTime()-1);
    const params = new URLSearchParams({from_timestamp:from.toISOString(),to_timestamp:to.toISOString()});
    setLangfuseMetricsLoading(true);
    api<any>(`/admin/langfuse/metrics?${params}`).then(result=>{if(current)setLangfuseMetrics(result);}).catch(e=>{if(current)setError((e as Error).message);}).finally(()=>{if(current)setLangfuseMetricsLoading(false);});
    return ()=>{current=false;};
  }, [admin, view, langfuseRange]);

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
      await api("/admin/settings/site",{method:"PUT",body:JSON.stringify({name:siteName,logo:siteLogoChanged?"":undefined,brand_display:brandDisplay})});
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
      if (view === "tickets") await refreshRows("tickets", page, submittedQuery);
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
      if (view === "tickets") await refreshRows("tickets", page, submittedQuery);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function changeSupportStatus(status: string) {
    if (!supportThread) return;
    setBusy(true); setError("");
    try {
      await api(`/admin/support/tickets/${supportThread.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setSupportThread(await api(`/admin/support/tickets/${supportThread.id}`));
      if (view === "tickets") await refreshRows("tickets", page, submittedQuery);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (checking) return <div className="center"><div className="loader"/>Checking secure admin session…</div>;
  if (!admin) return <main className="login-page"><div className="login-card"><div className="logo">{siteSettings.logo_url?<img src={siteSettings.logo_url} alt=""/>:<Shield size={22}/>}</div><p className="eyebrow">{siteName.toUpperCase()} · PLATFORM</p><h1>Admin console</h1><p className="subtle">Sign in with the Google account configured as the platform administrator.</p>{denied && <div className="error-box"><ShieldAlert size={17}/><span>{loginError || "This account does not have global administrator access."}</span></div>}<button type="button" className="admin-google-login" disabled={google===null} onClick={()=>google?window.location.assign(`${API}/api/v1/auth/google/start?admin=true`):setLoginError("Google sign-in is not connected yet. Configure the Google OAuth client and restart the API.")}><span className="admin-google-mark">G</span>Continue with Google</button>{google===false&&<p className="google-login-hint">Google sign-in is not configured.</p>}{loginError&&!denied&&<div className="error-box">{loginError}</div>}<p className="login-foot"><Shield size={14}/> Admin access is enforced by the API.</p></div></main>;

  const nav: { id: View; icon: LucideIcon }[] = [{ id: "overview", icon: LayoutDashboard }, { id: "users", icon: Users }, { id: "agents", icon: Bot }, { id: "conversations", icon: MessageSquareText }, { id: "tickets", icon: CircleHelp }, { id: "payments", icon: CreditCard }, { id: "plans", icon: Zap }, { id: "chat-templates", icon: MessageSquareText }, { id: "langfuse", icon: Sparkles }, { id: "documentation", icon: BookOpen }, { id: "pages", icon: FileText }, { id: "site-bot", icon: Bot }, { id: "activity", icon: Activity }, { id: "site", icon: Settings2 }];
  const pages = Math.max(1, Math.ceil((rows?.total || 0) / (rows?.limit || 25)));

  return <div className={view === "chat-templates" ? "shell appearance-shell" : "shell"}>
    <aside className="sidebar">
      <div className="brand">{siteSettings.brand_display !== "text" && <div className={`brand-mark${siteSettings.brand_display === "image" && siteSettings.logo_url ? " brand-mode-image" : ""}`}>{siteSettings.logo_url?<img src={siteSettings.logo_url} alt={siteSettings.name} style={siteSettings.brand_display === "image" ? { objectFit: "contain" } : undefined}/>:<Shield size={19}/>}</div>}{!(siteSettings.brand_display === "image" && siteSettings.logo_url) && <div><strong>{siteSettings.name}</strong><small>Platform admin</small></div>}</div>
      <div className="side-caption">CONTROL CENTER</div>
      <nav>{nav.map(({ id, icon: Icon }) => <button key={id} className={view === id ? "selected" : ""} onClick={() => { setView(id); setPage(1); setRows(null); }}><Icon size={18}/>{labels[id]}{id === "users" && overview && <span className="nav-badge">{overview.users}</span>}{id === "tickets" && supportUnread > 0 && <span className="nav-badge">{supportUnread}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="admin-chip"><div className="avatar">{admin.name?.[0]?.toUpperCase() || "A"}</div><div><strong>{admin.name}</strong><small>Super administrator</small></div></div><button className="logout" onClick={logout}><LogOut size={16}/>Sign out</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="crumb">Platform</span><ChevronRight size={14}/><strong>{labels[view]}</strong></div><div className="top-actions"><span className="secure"><i/> Private admin</span><button className="icon-button" title="Refresh" onClick={() => (view === "overview" ? Promise.all([refreshOverview(), refreshRows("activity", 1, "")]) : view === "payments" ? refreshPaymentSettings() : view === "site" ? refreshSiteSettings() : view === "langfuse" ? refreshLangfuse() : view === "documentation" ? (setDocumentationRefreshToken(value=>value+1),Promise.resolve()) : view === "pages" ? (setPagesRefreshToken(value=>value+1),Promise.resolve()) : view === "site-bot" ? (setSiteBotRefreshToken(value=>value+1),Promise.resolve()) : view === "plans" ? Promise.resolve() : refreshRows(view, page, submittedQuery)).catch(e => setError(e.message))}><RefreshCw size={16}/></button><div className="avatar small">{admin.name?.[0]?.toUpperCase() || "A"}</div></div></header>
      <div className={view === "chat-templates" ? "content appearance-content" : "content"}>
        {ticketNotice && <div className="ticket-notice"><CircleHelp size={16}/><span>{ticketNotice}</span><button onClick={()=>setTicketNotice("")} aria-label="Dismiss notification"><X size={14}/></button></div>}
        {error && <div className="error-banner"><CircleHelp size={16}/>{error}<button onClick={() => setError("")}><X size={15}/></button></div>}
        {view === "overview" && <Overview data={overview} activity={rows}/>}
        {view === "users" && <><PageHeading eyebrow="ACCOUNT OPERATIONS" title="Users" description="Review accounts, adjust plan access, and suspend or restore sign-in."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><UserTable rows={rows?.items || []} planOptions={rows?.plan_options||[]} busy={busy} onUpdate={updateUser} onView={(u) => setViewedUserId(u.id)}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "agents" && <><PageHeading eyebrow="CONTENT OPERATIONS" title="Agents" description="View agents across every workspace and manage publication status."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><AgentTable rows={rows?.items || []} busy={busy} onToggle={toggleAgent}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "conversations" && <><PageHeading eyebrow="SUPPORT OVERSIGHT" title="Conversations" description="Inspect recent visitor conversations across all agents."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><ConversationTable rows={rows?.items || []} onOpen={openConversation}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "tickets" && <><PageHeading eyebrow="CUSTOMER CARE" title="Support tickets" description="Reply to customer requests, update ticket status, and follow the full message thread."/><SearchBar query={query} setQuery={setQuery} onSearch={() => { setSubmittedQuery(query.trim()); setPage(1); }}/><SupportTicketTable rows={rows?.items || []} onOpen={openSupportTicket}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "activity" && <><PageHeading eyebrow="SECURITY & ACCOUNTABILITY" title="Admin activity" description="A timestamped record of global administrator actions."/><AuditTable rows={rows?.items || []}/><Pager page={page} pages={pages} setPage={setPage} total={rows?.total || 0}/></>}
        {view === "payments" && <><PageHeading eyebrow="BILLING CONTROL" title="Payments & subscriptions" description="Review current subscriptions and payments, manage token top-up packages, and track top-up revenue."/><PaymentSettings data={paymentSettings} busy={busy} onSelect={selectPaymentProvider}/><TopupAdmin/><SubscriptionTable rows={subscriptionRows?.items || []}/><Pager page={page} pages={Math.max(1,Math.ceil((subscriptionRows?.total||0)/25))} setPage={setPage} total={subscriptionRows?.total||0}/><PaymentTable rows={paymentRows?.items || []}/><Pager page={page} pages={Math.max(1,Math.ceil((paymentRows?.total||0)/25))} setPage={setPage} total={paymentRows?.total||0}/></>}
        {view === "plans" && <><PageHeading eyebrow="BILLING CONFIGURATION" title="Plans management" description="Manage plan limits and connect each plan to recurring Stripe prices and Razorpay plan IDs."/><PlansAdmin/></>}
        {view === "chat-templates" && <AppearanceStudio onExit={()=>setView("overview")}/>}
        {view === "langfuse" && <LangfuseView data={langfuseData} metrics={langfuseMetrics} metricsLoading={langfuseMetricsLoading} range={langfuseRange} draftRange={langfuseDraftRange} onDraftRange={setLangfuseDraftRange} onApplyRange={()=>setLangfuseRange(langfuseDraftRange)} onPreset={days=>{const range=lastDaysRange(days);setLangfuseDraftRange(range);setLangfuseRange(range);}} onMore={()=>langfuseData?.cursor&&refreshLangfuse(langfuseData.cursor)}/>}
        {view === "documentation" && <DocumentationAdmin refreshToken={documentationRefreshToken}/>}
        {view === "pages" && <PagesAdmin refreshToken={pagesRefreshToken}/>}
        {view === "site-bot" && <SiteBotAdmin refreshToken={siteBotRefreshToken}/>}
        {view === "site" && <><PageHeading eyebrow="BRAND IDENTITY" title="Site settings" description="Set the application name, logo image, and whether the website shows the image, text, or both."/><form className="panel site-settings-panel" onSubmit={saveSiteSettings}><label>Application name<input value={siteName} onChange={event=>setSiteName(event.target.value)} maxLength={80} required/></label><label>Brand header display<select value={brandDisplay} onChange={event=>setBrandDisplay(event.target.value as "both"|"image"|"text")}><option value="both">Image + Text (show logo beside name)</option><option value="image">Image only (show logo without text)</option><option value="text">Text only (show application name without logo)</option></select></label><div className="site-logo-settings"><div><h2>Application logo</h2><p>Upload a PNG, JPG, WEBP, or GIF logo (fits up to 512 × 256 PNG while keeping your full image shape).</p></div><div className="site-logo-preview" style={{ width: brandDisplay === "image" ? 150 : 82 }}>{siteSettings.logo_url?<img src={siteSettings.logo_url} alt="Application logo preview" style={{ objectFit: brandDisplay === "image" ? "contain" : "cover" }}/>:<span><ImageIcon size={25}/></span>}</div></div><div className="site-logo-settings" style={{ background: "#fafbfc" }}><div><h2>Website header preview</h2><p>Live preview of how your brand appears across the site navbar and dashboard.</p></div><div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 10, background: "#fff", border: "1px solid var(--line)" }}>{brandDisplay !== "text" && (siteSettings.logo_url ? <img src={siteSettings.logo_url} alt={siteName} style={{ height: 32, width: brandDisplay === "image" ? "auto" : 32, maxWidth: 160, objectFit: brandDisplay === "image" ? "contain" : "cover", borderRadius: 7 }} /> : <span className="brand-mark" style={{ width: 32, height: 32 }}><Shield size={16} /></span>)}{!(brandDisplay === "image" && siteSettings.logo_url) && <strong style={{ fontSize: 15 }}>{siteName || "AgentForge"}</strong>}</div></div><label className="site-logo-upload secondary"><Upload size={15}/>{siteLogoUploading?"Processing and uploading…":"Choose logo image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={siteLogoUploading||busy} onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void uploadSiteLogo(file);event.currentTarget.value="";}}/></label><small className="site-logo-help">PNG, JPG, WEBP, or GIF · maximum 10 MB · automatically converted to PNG (up to 512 × 256)</small>{siteSettings.has_logo&&!siteLogoChanged&&<button type="button" className="danger-outline site-logo-remove" onClick={()=>{setSiteSettings(current=>({...current,has_logo:false,logo_url:""}));setSiteLogoChanged(true);if(brandDisplay==="image")setBrandDisplay("both");}}>Remove logo</button>}{siteLogoChanged&&<p className="site-logo-pending">Logo removal will take effect when you save.</p>}<div className="site-settings-footer"><span>Branding changes appear across the public website automatically.</span><button className="primary" disabled={busy||siteLogoUploading}>Save site settings</button></div></form></>}
      </div>
    </main>
    {viewedUserId && <UserDetailModal userId={viewedUserId} onClose={() => setViewedUserId(null)} onUpdated={async () => { await Promise.all([refreshRows("users", page, submittedQuery), refreshOverview()]); }} onOpenConversation={openConversation} onOpenTicket={openSupportTicket} />}
    {transcript && <div className="modal-backdrop" onClick={() => setTranscript(null)}><section className="transcript-modal" onClick={e => e.stopPropagation()}><header><div><p className="eyebrow">CONVERSATION TRANSCRIPT</p><h2>{transcript.title}</h2></div><button className="icon-button" onClick={() => setTranscript(null)}><X size={18}/></button></header><div className="transcript-body">{transcript.messages.map((m:any)=><article key={m.id} className={`chat-line ${m.role}`}><small>{m.role === "user" ? "Visitor" : "Agent"} · {date(m.created_at)}</small><p>{m.content}</p>{m.citations?.length > 0 && <details><summary>{m.citations.length} citations</summary>{m.citations.map((c:any,i:number)=><p className="citation" key={i}>{c.source}: {c.excerpt}</p>)}</details>}</article>)}</div></section></div>}
    {supportThread && <div className="modal-backdrop" onClick={() => setSupportThread(null)}><section className="support-admin-modal" onClick={e => e.stopPropagation()}><header><div><p className="eyebrow">SUPPORT TICKET · {supportThread.id.slice(0,8).toUpperCase()}</p><h2>{supportThread.subject}</h2><p className="subtle">{supportThread.user_name} · {supportThread.user_email}</p></div><button className="icon-button" onClick={() => setSupportThread(null)}><X size={18}/></button></header><div className="support-admin-controls"><label>Status<select disabled={busy} value={supportThread.status} onChange={e=>void changeSupportStatus(e.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_on_user">Waiting on user</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><span>Updated {date(supportThread.updated_at)}</span></div><div className="support-admin-messages">{supportThread.messages.map((m:any)=><article key={m.id} className={`admin-ticket-message ${m.author_role}`}><small>{m.author_name} · {date(m.created_at)}</small><SupportMessageView text={m.body}/></article>)}</div><form className="support-admin-reply" onSubmit={sendSupportReply}><SupportEditor value={supportReply} onChange={setSupportReply} maxLength={10000} rows={3} placeholder="Reply to the customer…"/><button className="primary" disabled={busy}><MessageSquareText size={15}/>{busy?"Sending…":"Send reply"}</button></form></section></div>}
  </div>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subtle">{description}</p></div></div>; }
function SearchBar({ query, setQuery, onSearch }: { query: string; setQuery: (v: string) => void; onSearch: () => void }) { return <form className="searchbar" onSubmit={e => { e.preventDefault(); onSearch(); }}><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, email, or agent…"/><button className="secondary">Search</button></form>; }
function Pager({ page, pages, total, setPage }: { page: number; pages: number; total: number; setPage: (n: number) => void }) { return <div className="pager"><span>{total} records · page {page} of {pages}</span><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15}/>Previous</button><button className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next<ChevronRight size={15}/></button></div></div>; }
function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string | number; detail: string }) { return <div className="metric-card"><div className="metric-label">{icon}{label}</div><strong>{value}</strong><small>{detail}</small></div>; }
function Overview({ data, activity }: { data: any; activity: any }) {
  return <><PageHeading eyebrow="PLATFORM OVERVIEW" title="Dashboard" description="A live view of accounts, agents, usage, and platform integrations."/>{!data ? <div className="loading-card">Loading platform metrics…</div> : <><div className="welcome"><div><span>ADMINISTRATOR WORKSPACE</span><h2>Welcome back, let’s keep things running.</h2><p>Platform-wide visibility and account controls.</p></div><div className="welcome-icon"><Shield size={34}/></div></div><div className="metrics-grid"><Metric icon={<Users size={17}/>} label="Total users" value={data.users} detail={`${data.active_users} active · ${data.suspended_users} suspended`}/><Metric icon={<Bot size={17}/>} label="Total agents" value={data.agents} detail={`${data.published_agents} published`}/><Metric icon={<MessageSquareText size={17}/>} label="Knowledge sources" value={data.documents} detail="Across all workspaces"/><Metric icon={<Activity size={17}/>} label="Visitor messages" value={data.messages} detail="All time"/></div><div className="overview-grid-two"><section className="panel"><div className="panel-heading"><div><h2>Plan distribution</h2><p>Accounts by current plan</p></div></div><div className="plan-list">{Object.entries(data.plans||{}).map(([plan,count]:[string,any])=><div key={plan}><span className={`plan-dot ${plan}`}/><span className="capitalize">{plan}</span><strong>{count}</strong></div>)}</div></section><section className="panel"><div className="panel-heading"><div><h2>Integrations</h2><p>Configured service connections</p></div><Shield size={18}/></div><div className="integration-list">{Object.entries(data.integrations || {}).map(([name, enabled])=><div key={name}><span>{name}</span><Badge tone={enabled ? "green" : "gray"}>{enabled ? "Configured" : "Not configured"}</Badge></div>)}</div></section></div><section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent administrator actions</h2><p>Latest account and agent changes</p></div><span className="subtle small-text">See Admin activity for the full log</span></div><AuditTable rows={activity?.items?.slice(0, 5) || []}/></section></>}</>;
}
function UserTable({ rows, planOptions, busy, onUpdate, onView }: { rows: AdminUser[]; planOptions: {slug:string;name:string}[]; busy: boolean; onUpdate: (u: AdminUser, p: {plan?:string;is_active?:boolean}) => void; onView: (u: AdminUser) => void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>USER</th><th>PLAN</th><th>AGENTS</th><th>MESSAGES</th><th>STATUS</th><th>JOINED</th><th>ACCOUNT ACTIONS</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td><strong>{u.name}</strong><small>{u.email}</small></td><td><select aria-label={`Plan for ${u.email}`} disabled={busy} value={u.plan} onChange={e=>onUpdate(u,{plan:e.target.value})}>{(planOptions.length?planOptions:[{slug:'free',name:'Free'},{slug:'pro',name:'Pro'},{slug:'team',name:'Team'}]).map(p=><option key={p.slug} value={p.slug}>{p.name}</option>)}</select>{u.has_subscription && <small className="table-note">Provider may resync plan</small>}</td><td>{u.agent_count}</td><td>{u.message_count}</td><td><Badge tone={u.is_active?"green":"red"}>{u.is_active?"Active":"Suspended"}</Badge></td><td>{date(u.created_at)}</td><td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" className="secondary" onClick={()=>onView(u)}><Eye size={14}/>View</button><button className={u.is_active?"danger-outline":"success-outline"} disabled={busy} onClick={()=>onUpdate(u,{is_active:!u.is_active})}>{u.is_active?"Suspend":"Reactivate"}</button></div></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No user accounts match this search."/>}</div></div>; }
function AgentTable({ rows, busy, onToggle }: { rows: AdminAgent[]; busy: boolean; onToggle: (a: AdminAgent) => void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>AGENT</th><th>OWNER</th><th>SOURCES</th><th>MESSAGES</th><th>STATUS</th><th>CREATED</th><th>ACTION</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td><strong>{a.name}</strong><small className="mono">{a.id}</small></td><td>{a.owner_email}</td><td>{a.documents}</td><td>{a.messages}</td><td><Badge tone={a.published?"green":"amber"}>{a.published?"Published":"Draft"}</Badge></td><td>{date(a.created_at)}</td><td><button className={a.published?"danger-outline":"success-outline"} disabled={busy} onClick={()=>onToggle(a)}>{a.published?"Unpublish":"Publish"}</button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No agents match this search."/>}</div></div>; }
function ConversationTable({ rows, onOpen }: { rows: any[]; onOpen: (id:string,title:string)=>void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>AGENT / OWNER</th><th>LAST MESSAGE</th><th>MESSAGES</th><th>STARTED</th><th/></tr></thead><tbody>{rows.map(c=><tr key={c.id}><td><strong>{c.agent_name}</strong><small>{c.owner_email}</small></td><td className="message-preview">{c.last_message}</td><td>{c.message_count}</td><td>{date(c.created_at)}</td><td><button className="secondary" onClick={()=>onOpen(c.id,c.agent_name)}>View transcript<ChevronRight size={14}/></button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No conversations found."/>}</div></div>; }
function SupportTicketTable({ rows, onOpen }: { rows: any[]; onOpen: (id:string)=>void }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>TICKET</th><th>USER</th><th>LAST REPLY</th><th>STATUS</th><th>UPDATED</th><th/></tr></thead><tbody>{rows.map(t=><tr key={t.id} className={t.admin_unread?"ticket-unread":""}><td><strong>{t.subject}</strong><small className="mono">{t.id.slice(0,8)}</small></td><td><strong>{t.user_name}</strong><small>{t.user_email}</small></td><td className="message-preview">{t.last_message}</td><td><Badge tone={t.status==="open"?"amber":t.status==="resolved"||t.status==="closed"?"green":"gray"}>{t.status.replaceAll("_"," ")}</Badge></td><td>{date(t.updated_at)}</td><td><button className="secondary" onClick={()=>onOpen(t.id)}>Open ticket<ChevronRight size={14}/></button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No support tickets found."/>}</div></div>; }
function AuditTable({ rows }: { rows: AuditEvent[] }) { return <div className="table-scroll"><table><thead><tr><th>EVENT</th><th>ADMINISTRATOR</th><th>DETAILS</th><th>TIME</th></tr></thead><tbody>{rows.map(e=><tr key={e.id}><td><Badge tone={e.action.includes("suspend")?"red":"amber"}>{e.action}</Badge></td><td>{e.actor_email}</td><td>{Object.entries(e.details || {}).map(([k,v])=>`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || e.entity_id}</td><td>{date(e.created_at)}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No administrator actions recorded yet."/>}</div>; }
function Empty({ text }: { text: string }) { return <div className="empty-state">{text}</div>; }
function PaymentSettings({ data, busy, onSelect }: { data: any; busy: boolean; onSelect: (provider: "stripe" | "razorpay") => void }) {
  if (!data) return <div className="loading-card">Loading payment configuration…</div>;
  return <><div className="panel payment-panel"><div className="panel-heading"><div><h2>Active checkout gateway</h2><p>Existing subscriptions stay on their original provider.</p></div><Badge tone={data.providers[data.provider]?.configured ? "green" : "red"}>{data.provider} · {data.providers[data.provider]?.configured ? "Ready" : "Needs setup"}</Badge></div><div className="gateway-grid">{(["stripe", "razorpay"] as const).map(provider=>{const item=data.providers[provider];const active=data.provider===provider;return <button type="button" key={provider} className={`gateway-card ${active?"active":""}`} disabled={busy||!item.configured} onClick={()=>onSelect(provider)}><span className="gateway-top"><strong>{provider === "stripe" ? "Stripe" : "Razorpay"}</strong><Badge tone={item.configured?"green":"gray"}>{item.configured?"Configured":"Not configured"}</Badge></span><span className="gateway-description">{provider === "stripe" ? "Hosted recurring checkout and customer billing portal." : "Hosted recurring subscriptions with Razorpay Subscriptions."}</span><span className="gateway-select">{active?"Currently selected":item.configured?"Select for new checkouts":"Add credentials to enable"}</span>{!item.configured&&<small className="missing-keys">Required configuration: {item.requirements.join(", ")}</small>}</button>;})}</div><p className="payment-note"><Shield size={15}/> API secrets stay in the server environment. Configure recurring provider IDs in <strong>Plans management</strong>; credentials and webhook secrets are read from the API environment.</p></div><div className="panel webhook-panel"><h2>Webhook endpoints</h2><p>Configure both gateways to send signed subscription and payment events to the matching endpoint.</p><code>Stripe: /api/v1/webhooks/stripe</code><code>Razorpay: /api/v1/webhooks/razorpay</code><small>Signed webhooks remain enabled. The checkout status endpoint can also confirm provider status when the customer returns.</small></div></>;
}

function PlansAdmin() {
  const [provider,setProvider]=useState<'stripe'|'razorpay'>('razorpay');
  const [plans,setPlans]=useState<any[]>([]),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [editing,setEditing]=useState('');
  const [form,setForm]=useState<any>({slug:'',name:'',amount:1000,currency:'INR',interval:'month',interval_count:1,bots:1,documents:10,tokens:1000000});
  const load=()=>api<any>(`/admin/plans/provider/${provider}`).then(data=>setPlans(data.plans||[])).catch(e=>setError(e.message));
  useEffect(()=>{setPlans([]);setError('');void load();},[provider]);
  function clearForm(){setEditing('');setForm({slug:'',name:'',amount:1000,currency:provider==='razorpay'?'INR':'USD',interval:'month',interval_count:1,bots:1,documents:10,tokens:1000000})}
  async function save(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{await api(`/admin/plans/provider/${provider}`,{method:'POST',body:JSON.stringify(form)});clearForm();await load()}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  async function remove(plan:any){setSaving(true);setError('');try{await api(`/admin/plans/provider/${provider}/${encodeURIComponent(plan.slug)}`,{method:'DELETE'});if(editing===plan.slug)clearForm();await load()}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  function edit(plan:any){setEditing(plan.slug);setForm({slug:plan.slug,name:plan.name,amount:plan[`${provider}_amount`]??1000,currency:plan[`${provider}_currency`]||(provider==='razorpay'?'INR':'USD'),interval:plan[`${provider}_interval`]||'month',interval_count:plan[`${provider}_interval_count`]||1,bots:plan.bots,documents:plan.documents,tokens:plan.tokens})}
  return <section className="plans-admin">
    <FreePlanAdmin />
    <div className="panel plan-provider-select"><label>Payment provider<select value={provider} onChange={e=>{const next=e.target.value as 'stripe'|'razorpay';setProvider(next);setEditing('');setForm({slug:'',name:'',amount:1000,currency:next==='razorpay'?'INR':'USD',interval:'month',interval_count:1,bots:1,documents:10,tokens:1000000})}}><option value="razorpay">Razorpay</option><option value="stripe">Stripe</option></select></label><span>Each provider has its own plan list and provider-created IDs.</span></div>
    <form className="panel provider-plan-form" onSubmit={save}><div className="panel-heading"><div><h2>{editing?'Replace':'Create'} {provider==='stripe'?'Stripe':'Razorpay'} subscription plan</h2><p>{editing?'Provider recurring prices are immutable; saving creates a replacement plan and updates this app plan.':'The provider creates the recurring plan and ID. It will be added to this app after creation.'}</p></div></div>
      <div className="provider-plan-fields"><label>Plan name<input required maxLength={80} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Plan key<input required pattern="[a-z][a-z0-9_-]{1,39}" title="Lowercase letters, numbers, underscores or hyphens" disabled={!!editing} value={form.slug} onChange={e=>setForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g,'')})}/></label><label>Amount<input type="number" required min="0.01" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:Number(e.target.value)})}/></label><label>Currency<input required minLength={3} maxLength={3} value={form.currency} onChange={e=>setForm({...form,currency:e.target.value.toUpperCase()})}/></label><label>Billing period<select value={form.interval} onChange={e=>setForm({...form,interval:e.target.value})}><option value="month">Monthly</option><option value="year">Yearly</option></select></label><label>Every N periods<input type="number" min="1" max="12" value={form.interval_count} onChange={e=>setForm({...form,interval_count:Number(e.target.value)})}/></label></div>
      <h3>Included limits</h3><div className="plan-limits-grid">{([['bots','Agents'],['documents','Knowledge sources'],['tokens','Tokens per billing period']] as [string,string][]).map(([key,label])=><label key={key}>{label}<input type="number" min="0" value={form[key]} onChange={e=>setForm({...form,[key]:Number(e.target.value)})}/></label>)}</div>
      {error&&<p className="error">{error}</p>}<div className="plan-admin-actions"><button type="button" className="secondary" onClick={clearForm}>Clear</button><button className="primary" disabled={saving}>{saving?'Creating…':editing?'Create replacement plan':'Create plan with '+(provider==='stripe'?'Stripe':'Razorpay')}</button></div>
    </form>
    <section className="panel table-panel provider-plan-list"><div className="panel-heading"><div><h2>{provider==='stripe'?'Stripe':'Razorpay'} plans</h2><p>Plans created with this provider and available to customer checkout.</p></div><button className="secondary" onClick={()=>void load()}>Refresh list</button></div><div className="table-scroll"><table><thead><tr><th>PLAN</th><th>PRICE</th><th>PERIOD</th><th>PLAN ID</th><th>LIMITS</th><th>ACTIONS</th></tr></thead><tbody>{plans.map(plan=><tr key={plan.slug}><td><strong>{plan.name}</strong><small>{plan.slug}</small></td><td>{plan[`${provider}_amount`]==null?'—':`${plan[`${provider}_currency`]} ${plan[`${provider}_amount`]}`}</td><td>{plan[`${provider}_interval_count`]||1} {plan[`${provider}_interval`]||'month'}(s)</td><td className="mono">{plan[provider==='stripe'?'stripe_price_id':'razorpay_plan_id']}</td><td>{Number(plan.bots).toLocaleString()} agents · {Number(plan.documents).toLocaleString()} sources · {Number(plan.tokens).toLocaleString()} tokens</td><td><button className="secondary" disabled={saving} onClick={()=>edit(plan)}>Edit / replace</button> <button className="danger-outline" disabled={saving} onClick={()=>void remove(plan)}>Remove</button></td></tr>)}</tbody></table>{!plans.length&&<Empty text={`No ${provider==='stripe'?'Stripe':'Razorpay'} recurring plans yet. Create one above.`}/>}</div><p className="plan-provider-note">Stripe prices are deactivated when removed. Razorpay does not support deleting plans, so Remove disconnects the plan from new app checkouts; existing subscriptions continue.</p></section>
  </section>;
}

const emptyChatTheme:any={layout:"classic",accent_color:"#d6ff63",surface_color:"#ffffff",text_color:"#252b25",muted_color:"#858b80",header_subtitle:"Grounded in your knowledge",welcome_title:"Your answers start here.",suggested_prompt:"What can you help me with?",footer_text:"Answers include source evidence",corner_radius:16,show_header:true,show_avatar:true,show_header_subtitle:true,show_new_chat:true,show_welcome:true,show_welcome_icon:true,show_suggestion:true,show_citations:true,show_footer:true};
const CHAT_LAYOUTS=["classic","minimal","studio","helpdesk","knowledge","concierge","boutique","bold","editorial","compact","night"];
const appearanceComponents:[string,string,string][]=[["show_header","Chat header","Agent name and top controls"],["show_avatar","Agent avatar","Logo or assistant avatar in the header"],["show_header_subtitle","Header subtitle","Supporting status and helper text"],["show_new_chat","New chat action","Let visitors start a fresh conversation"],["show_welcome","Welcome screen","Headline, greeting and first prompt"],["show_welcome_icon","Welcome icon","Brand mark on the welcome screen"],["show_suggestion","Quick reply buttons","Suggested first question"],["show_citations","Source citations","Evidence and source references"],["show_footer","Legal footer","Powered by and footer text"]];
function AppearanceStudio({onExit}:{onExit:()=>void}){
  const [templates,setTemplates]=useState<any[]>([]),[screen,setScreen]=useState<"gallery"|"studio">("gallery"),[editing,setEditing]=useState(""),[baseId,setBaseId]=useState("classic"),[saving,setSaving]=useState(false),[error,setError]=useState(""),[mode,setMode]=useState<"desktop"|"mobile"|"widget">("desktop"),[openGroup,setOpenGroup]=useState("Theme & Colors"),[showEnabledOnly,setShowEnabledOnly]=useState(false);
  const [form,setForm]=useState<any>({name:"",description:"",active:true,config:{...emptyChatTheme}}),[savedForm,setSavedForm]=useState<any>(null);
  async function load(){const result=await api<any>("/admin/chat-templates");setTemplates(result.templates||[])}
  useEffect(()=>{void load().catch(e=>setError(e.message))},[]);
  function makeNew(){const next={name:"New chatbot template",description:"A custom hosted chat experience",active:true,config:{...emptyChatTheme}};setForm(next);setSavedForm(next);setEditing("");setBaseId("classic");setError("");setScreen("studio")}
  function editTemplate(template:any){const next={name:template.name,description:template.description||"",active:template.active,config:{...emptyChatTheme,...template.config}};setForm(next);setSavedForm(JSON.parse(JSON.stringify(next)));setEditing(template.id);setBaseId(template.id);setError("");setScreen("studio")}
  function applyBase(template:any){const next={name:`${template.name} copy`,description:template.description||"",active:true,config:{...emptyChatTheme,...template.config}};setForm(next);setSavedForm(JSON.parse(JSON.stringify(next)));setEditing("");setBaseId(template.id)}
  function patchConfig(key:string,value:any){setForm((current:any)=>({...current,config:{...current.config,[key]:value}}))}
  async function save(event:FormEvent){event.preventDefault();setSaving(true);setError("");try{const result=await api<any>(`/admin/chat-templates${editing?`/${encodeURIComponent(editing)}`:""}`,{method:editing?"PUT":"POST",body:JSON.stringify(form)});await load();const next={...form};setForm(next);setSavedForm(JSON.parse(JSON.stringify(next)));setEditing(result.template?.id||editing);setBaseId(result.template?.id||baseId)}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  async function remove(template:any){if(!window.confirm(`Delete “${template.name}”? Agents using it will fall back to Classic.`))return;setSaving(true);setError("");try{await api(`/admin/chat-templates/${encodeURIComponent(template.id)}`,{method:"DELETE"});if(editing===template.id){setEditing("");setScreen("gallery")}await load()}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  function templateCard(template:any){return <article key={template.id} className={`studio-template-card ${template.id===baseId?"selected":""}`}><button className="studio-template-select" type="button" onClick={()=>applyBase(template)}><ChatTemplatePreview name={template.name} config={{...emptyChatTheme,...template.config}}/><span className="studio-template-name">{template.name}<ChevronRight size={14}/></span></button><div className="studio-template-actions"><span className={template.active?"template-active":"template-hidden"}>{template.active?"Active":"Hidden"}</span><button type="button" onClick={()=>editTemplate(template)}>Edit</button><button type="button" className="template-delete" onClick={()=>void remove(template)}>Delete</button></div></article>}
  if(screen==="gallery")return <div className="appearance-studio appearance-gallery-page"><header className="appearance-top"><div className="appearance-brand"><span>✦</span><strong>Appearance Studio</strong></div><div className="appearance-address">◌　Hosted chat templates</div><button type="button" className="appearance-exit" onClick={onExit}>← Admin console</button></header><section className="appearance-gallery-header"><div><p>PUBLIC CHAT EXPERIENCE</p><h1>Template library</h1><span>Choose a design to customize, or create a new reusable chatbot experience.</span></div><button className="studio-publish" onClick={makeNew}>＋ Create template</button></section>{error&&<div className="studio-error">{error}</div>}<div className="appearance-gallery-grid">{templates.map(template=><article className="appearance-gallery-card" key={template.id}><ChatTemplatePreview name={template.name} config={{...emptyChatTheme,...template.config}}/><div><span className="studio-gallery-tag">{template.config.layout}</span><h2>{template.name}</h2><p>{template.description}</p><div className="studio-gallery-actions"><button type="button" onClick={()=>editTemplate(template)}>Open in Studio</button><button type="button" className="template-delete" onClick={()=>void remove(template)}>Delete</button></div></div></article>)}</div>{!templates.length&&<p className="studio-empty">No templates yet. Create the first one.</p>}</div>;
  return <div className="appearance-studio"><header className="appearance-top"><div className="appearance-brand"><span>✦</span><strong>Appearance Studio</strong></div><div className="appearance-address">⌕　Public chat appearance　/　{form.name||"New template"}</div><div className="appearance-top-tools"><button type="button" aria-label="Studio settings">⚙</button><button type="button" aria-label="Help">?</button><span className="appearance-avatar">AF</span></div></header><div className="appearance-toolbar"><button type="button" className="studio-nav-icon" aria-label="Template library" onClick={()=>setScreen("gallery")}>▤</button><div className="appearance-title"><h1>Chatbot Pro Customizer</h1><span>{form.name||"New template"} <b>● {form.active?"Active":"Hidden"}</b></span></div><div className="appearance-toolbar-actions"><button type="button" onClick={()=>setForm(savedForm?JSON.parse(JSON.stringify(savedForm)):{...form,config:{...emptyChatTheme}})}>Reset</button><button type="button" onClick={()=>setScreen("gallery")}>Discard</button><button type="submit" form="appearance-template-form" className="studio-publish" disabled={saving}>{saving?"Saving…":editing?"Publish Changes":"Create Template"}</button></div></div>{error&&<div className="studio-error">{error}</div>}<form id="appearance-template-form" className="appearance-columns" onSubmit={save}>
    <section className="studio-panel studio-controls"><div className="studio-panel-title"><h2>Design & Add Features</h2><button type="button" onClick={()=>setShowEnabledOnly(value=>!value)}>{showEnabledOnly?"All components":"＋ Filter"}</button></div><div className="studio-accordion"><button type="button" onClick={()=>setOpenGroup(openGroup==="Theme & Colors"?"":"Theme & Colors")}>⌄　Theme & Colors <span>⌃</span></button>{openGroup==="Theme & Colors"&&<div className="studio-color-grid"><label>Design style<select value={form.config.layout} onChange={e=>patchConfig("layout",e.target.value)}>{CHAT_LAYOUTS.map(layout=><option key={layout} value={layout}>{layout[0].toUpperCase()+layout.slice(1)}</option>)}</select></label>{([['accent_color','Custom primary color'],['surface_color','Surface'],['text_color','Text'],['muted_color','Muted text']] as [string,string][]).map(([key,label])=><label key={key}>{label}<input type="color" value={form.config[key]} onChange={e=>patchConfig(key,e.target.value)}/></label>)}<label>Corner radius<input type="range" min="6" max="28" value={form.config.corner_radius} onChange={e=>patchConfig("corner_radius",Number(e.target.value))}/><small>{form.config.corner_radius}px</small></label></div>}</div><div className="studio-accordion"><button type="button" onClick={()=>setOpenGroup(openGroup==="Component Library"?"":"Component Library")}>⌄　Component Library <span>⌃</span></button>{openGroup==="Component Library"&&<div className="studio-component-library">{appearanceComponents.map(([key,label,description])=><button type="button" key={key} onClick={()=>patchConfig(key,true)}><span>↳</span>{label}<b>♥</b><small>{description}</small></button>)}</div>}</div><div className="studio-accordion"><button type="button" onClick={()=>setOpenGroup(openGroup==="Template details"?"":"Template details")}>›　Template details <span>⌄</span></button>{openGroup==="Template details"&&<div className="studio-detail-fields"><label>Template name<input value={form.name} maxLength={80} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Description<input value={form.description} maxLength={240} onChange={e=>setForm({...form,description:e.target.value})}/></label><label className="studio-check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Available to users</label></div>}</div></section>
    <section className="studio-panel studio-components"><div className="studio-panel-title"><div><h2>Chat components</h2><p>Toggle and configure each module in your chatbot.</p></div></div>{appearanceComponents.filter(([key])=>!showEnabledOnly||form.config[key]).map(([key,label,description])=><article className="studio-component-card" key={key}><div className="studio-component-icon">{key==="show_suggestion"?"▤":key==="show_citations"?"▧":"▣"}</div><div className="studio-component-content"><strong>{label}</strong><p>{description}</p>{key==="show_welcome"&&form.config.show_welcome&&<label>Welcome headline<input value={form.config.welcome_title} maxLength={120} onChange={e=>patchConfig("welcome_title",e.target.value)}/></label>}{key==="show_suggestion"&&form.config.show_suggestion&&<label>Quick reply text<input value={form.config.suggested_prompt} maxLength={180} onChange={e=>patchConfig("suggested_prompt",e.target.value)}/></label>}{key==="show_header_subtitle"&&form.config.show_header&&form.config.show_header_subtitle&&<label>Header subtitle<input value={form.config.header_subtitle} maxLength={120} onChange={e=>patchConfig("header_subtitle",e.target.value)}/></label>}{key==="show_footer"&&form.config.show_footer&&<label>Footer text<input value={form.config.footer_text} maxLength={180} onChange={e=>patchConfig("footer_text",e.target.value)}/></label>}</div><label className="studio-switch"><input aria-label={`Enable ${label}`} type="checkbox" checked={form.config[key]} onChange={e=>patchConfig(key,e.target.checked)}/><span/></label></article>)}</section>
    <section className="studio-panel studio-template-rail"><div className="studio-panel-title"><div><h2>Apply Base Admin Templates</h2><p>Choose a starting point for your design.</p></div><button type="button" onClick={()=>setScreen("gallery")}>All</button></div><div className="studio-template-list">{templates.map(templateCard)}</div></section>
    <section className="studio-panel studio-preview"><div className="studio-panel-title"><div><h2>Live Sandbox Preview</h2><p>Changes update in this preview.</p></div><div className="studio-preview-modes">{(["desktop","mobile","widget"] as const).map(item=><button type="button" key={item} className={mode===item?"active":""} onClick={()=>setMode(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div></div><div className={`studio-browser studio-${mode}`}><div className="studio-browser-bar"><span>●　●　●</span><div>◈　Hosted chat preview</div><span>＋　⋮</span></div><div className={`studio-preview-canvas hosted-${form.config.layout}`}><ChatTemplatePreview name={form.name||"Your assistant"} config={form.config}/></div></div><div className="studio-preview-footer">Preview mode: {mode} <span>·</span> Sample conversation only</div></section>
  </form></div>;
}
function ChatTemplatePreview({name="Your assistant",config=emptyChatTheme}:{name?:string;config?:any}){
  return <div className={`template-live-preview preview-${config.layout||"classic"}`} style={{background:config.surface_color,color:config.text_color,borderColor:`${config.text_color}22`,borderRadius:config.corner_radius}}>{config.show_header!==false&&<div className="template-preview-head" style={{borderColor:`${config.text_color}18`}}>{config.show_avatar!==false&&<span className="template-preview-avatar" style={{background:config.accent_color}}>✦</span>}<div><strong>{name||"Your assistant"}</strong>{config.show_header_subtitle!==false&&<small style={{color:config.muted_color}}>{config.header_subtitle}</small>}</div>{config.show_new_chat!==false&&<span className="template-preview-status" style={{color:config.muted_color}}>↻ New chat</span>}</div>}<div className="template-preview-body">{config.show_welcome!==false&&<div className="template-preview-welcome">{config.show_welcome_icon!==false&&<span className="template-preview-orb" style={{background:`${config.accent_color}35`,color:config.text_color}}>✦</span>}<h3>{config.welcome_title}</h3><p style={{color:config.muted_color}}>Hi! What can I help you find?</p>{config.show_suggestion!==false&&<div className="template-preview-prompt" style={{borderColor:`${config.accent_color}99`}}>{config.suggested_prompt}<span style={{color:config.accent_color}}>↗</span></div>}</div>}<div className="template-preview-message" style={{background:`${config.accent_color}30`}}>Can you tell me more?</div>{config.show_citations!==false&&<small className="template-preview-citation" style={{color:config.muted_color}}>▤ 2 sources · evidence included</small>}</div><div className="template-preview-input" style={{borderColor:`${config.text_color}22`,color:config.muted_color}}>Ask a question…<span style={{background:config.accent_color,color:config.layout==="bold"||config.layout==="night"?"#10202a":"#202820"}}>↑</span></div>{config.show_footer!==false&&<div className="template-preview-footer" style={{color:config.muted_color}}>{config.footer_text}</div>}</div>
}

function FreePlanAdmin() {
  const [plan,setPlan]=useState<any>(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=()=>api<any>('/admin/plans/free').then(result=>setPlan(result.plan)).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  async function save(event:FormEvent){event.preventDefault();setSaving(true);setError('');setNotice('');try{const result=await api<any>('/admin/plans/free',{method:'PUT',body:JSON.stringify({name:plan.name,active:plan.active,bots:Number(plan.bots),documents:Number(plan.documents),tokens:Number(plan.tokens)})});setPlan(result.plan);setNotice('Free plan settings saved.')}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  if(!plan)return <section className="panel free-plan-admin"><div className="panel-heading"><div><h2>Free plan</h2><p>{error||'Loading free plan settings…'}</p></div></div></section>;
  return <form className="panel free-plan-admin" onSubmit={save}><div className="panel-heading"><div><h2>Free plan</h2><p>Set the no-payment trial limits. Hiding this plan stops new accounts from receiving the 30-day Free allowance.</p></div><Badge tone={plan.active?'green':'gray'}>{plan.active?'Available to new users':'Hidden from new users'}</Badge></div><div className="free-plan-form-grid"><label>Display name<input required maxLength={80} value={plan.name} onChange={e=>setPlan({...plan,name:e.target.value})}/></label>{([['bots','Agents'],['documents','Knowledge sources'],['tokens','Tokens for 30 days']] as [string,string][]).map(([key,label])=><label key={key}>{label}<input type="number" min="0" value={plan[key]} onChange={e=>setPlan({...plan,[key]:Number(e.target.value)})}/></label>)}<label className="free-plan-toggle"><input type="checkbox" checked={!!plan.active} onChange={e=>setPlan({...plan,active:e.target.checked})}/><span><strong>Offer Free plan to new accounts</strong><small>Existing users keep their current plan and remaining access.</small></span></label></div>{error&&<p className="error">{error}</p>}{notice&&<p className="success-message">{notice}</p>}<div className="plan-admin-actions"><button className="primary" disabled={saving}>{saving?'Saving…':'Save Free plan'}</button></div></form>;
}

function TopupAdmin() {
  const [data,setData]=useState<any>(null),[packages,setPackages]=useState<any[]>([]),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const load=()=>api<any>('/admin/topups').then(result=>{setData(result);setPackages(result.packages||[])}).catch(e=>setError(e.message));
  useEffect(()=>{void load()},[]);
  async function save(){setSaving(true);setError('');try{await api('/admin/topups/packages',{method:'PUT',body:JSON.stringify({packages:packages.map(({id,...item})=>item)})});await load()}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  return <section className="panel table-panel topup-admin"><div className="panel-heading"><div><h2>Token top-ups</h2><p>Set fixed rupee prices and token amounts available in the customer workspace.</p></div><Badge tone="green">Revenue ₹{((data?.revenue||0)/100).toFixed(2)}</Badge></div>
    <div className="topup-package-editor">{packages.map((pkg:any,index:number)=><div className="topup-package-row" key={pkg.id||index}><input aria-label="Package name" value={pkg.name} onChange={e=>setPackages(rows=>rows.map((row,i)=>i===index?{...row,name:e.target.value}:row))}/><label>₹ <input aria-label="Amount in rupees" type="number" min="1" value={pkg.amount} onChange={e=>setPackages(rows=>rows.map((row,i)=>i===index?{...row,amount:Number(e.target.value)}:row))}/></label><label>Tokens <input aria-label="Token amount" type="number" min="1" value={pkg.tokens} onChange={e=>setPackages(rows=>rows.map((row,i)=>i===index?{...row,tokens:Number(e.target.value)}:row))}/></label><button className="secondary" onClick={()=>setPackages(rows=>rows.filter((_,i)=>i!==index))}>Delete</button></div>)}
    <div className="topup-package-actions"><button className="secondary" onClick={()=>setPackages(rows=>[...rows,{name:'New package',amount:100,tokens:10000}])}>Add package</button><button className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Save packages'}</button></div></div>{error&&<p className="error">{error}</p>}
    <div className="table-scroll"><table><thead><tr><th>USER</th><th>DATE</th><th>TOKENS</th><th>AMOUNT</th><th>PROVIDER</th><th>STATUS</th><th>REFERENCE</th></tr></thead><tbody>{(data?.transactions||[]).map((p:any)=><tr key={p.id}><td><strong>{p.user_name}</strong><small>{p.user_email}</small></td><td>{date(p.created_at)}</td><td>{Number(p.tokens||0).toLocaleString()}</td><td>{p.amount==null?'—':`${(p.amount/100).toFixed(2)} ${(p.currency||'').toUpperCase()}`}</td><td>{p.provider}</td><td><Badge tone={p.status==='paid'||p.status==='captured'?'green':'amber'}>{p.status}</Badge></td><td className="mono">{p.id}</td></tr>)}</tbody></table>{data&&!data.transactions.length&&<Empty text="No top-up transactions yet."/>}</div>
  </section>;
}

function PaymentTable({ rows }: { rows: any[] }) { return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>USER</th><th>PROVIDER</th><th>PLAN</th><th>AMOUNT</th><th>STATUS</th><th>PAID</th><th>REFERENCE</th></tr></thead><tbody>{rows.map(payment=><tr key={payment.id}><td><strong>{payment.user_name}</strong><small>{payment.user_email}</small></td><td className="capitalize">{payment.provider}</td><td className="capitalize">{payment.plan||"—"}</td><td>{payment.amount == null ? "—" : `${(payment.amount / 100).toFixed(2)} ${(payment.currency||"").toUpperCase()}`}</td><td><Badge tone={payment.status==="paid"||payment.status==="captured"?"green":"gray"}>{payment.status}</Badge></td><td>{date(payment.created_at)}</td><td className="mono">{payment.id}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No payments have been recorded from verified provider events yet."/>}</div></div>; }

function SubscriptionTable({ rows }: { rows: any[] }) { return <section className="panel table-panel"><div className="panel-heading"><div><h2>Subscriptions</h2><p>Accounts with a provider subscription ID, including subscriptions awaiting webhook confirmation.</p></div></div><div className="table-scroll"><table><thead><tr><th>USER</th><th>PROVIDER</th><th>PLAN</th><th>ACCESS</th><th>CREATED</th><th>SUBSCRIPTION ID</th></tr></thead><tbody>{rows.map(subscription=><tr key={subscription.id}><td><strong>{subscription.user_name}</strong><small>{subscription.user_email}</small></td><td className="capitalize">{subscription.provider}</td><td className="capitalize">{subscription.plan}</td><td><Badge tone={subscription.status==="active"?"green":"amber"}>{subscription.status}</Badge></td><td>{date(subscription.created_at)}</td><td className="mono">{subscription.id}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No subscriptions found. A row appears once checkout creates a provider subscription ID."/>}</div></section>; }

function LangfuseView({data,metrics,metricsLoading,range,draftRange,onDraftRange,onApplyRange,onPreset,onMore}:{data:{configured:boolean;items:any[];cursor:string|null}|null;metrics:any;metricsLoading:boolean;range:DateRange;draftRange:DateRange;onDraftRange:(range:DateRange)=>void;onApplyRange:()=>void;onPreset:(days:number)=>void;onMore:()=>void}) {
  const summary=metrics?.summary||{};
  return <><PageHeading eyebrow="AI OBSERVABILITY" title="Langfuse traces" description="Review token usage, cost, latency, and chat traces. Trace inputs and outputs are visible to platform administrators."/>
    {!data ? <div className="loading-card">Loading Langfuse observations…</div> : !data.configured ? <section className="panel"><div className="panel-heading"><div><h2>Connect a Langfuse project</h2><p>Langfuse credentials are read by the API and never sent to this page.</p></div><Badge tone="amber">Not configured</Badge></div><ol className="langfuse-setup"><li>Create or open a project in Langfuse and create API keys in project settings.</li><li>Set <code>LANGFUSE_PUBLIC_KEY</code> and <code>LANGFUSE_SECRET_KEY</code> in the root <code>.env</code>.</li><li>Set <code>LANGFUSE_HOST</code> to your region URL (EU: <code>https://cloud.langfuse.com</code>, US: <code>https://us.cloud.langfuse.com</code>), then restart the API.</li></ol><p className="subtle">Once connected, new chat activity will appear here. Credentials should have read access to traces for this project.</p></section> : <>
      <section className="panel langfuse-range-panel"><div><h2>Usage date range</h2><p>Aggregate metrics for completed agent chats in the selected local date range.</p></div><form className="langfuse-range-controls" onSubmit={event=>{event.preventDefault();if(draftRange.from<=draftRange.to)onApplyRange();}}><label>From<input type="date" value={draftRange.from} max={draftRange.to} onChange={event=>onDraftRange({...draftRange,from:event.target.value})} required/></label><label>To<input type="date" value={draftRange.to} min={draftRange.from} onChange={event=>onDraftRange({...draftRange,to:event.target.value})} required/></label><button className="secondary" type="button" onClick={()=>onPreset(7)}>7 days</button><button className="secondary" type="button" onClick={()=>onPreset(30)}>30 days</button><button className="secondary" type="button" onClick={()=>onPreset(90)}>90 days</button><button className="primary" disabled={metricsLoading}>Apply range</button></form></section>
      <div className="langfuse-metrics-caption">{range.from} through {range.to}{metricsLoading&&<span> · Updating metrics…</span>}</div>
      <div className="metrics-grid langfuse-metrics-grid"><Metric icon={<MessageSquareText size={17}/>} label="Agent chats" value={Number(summary.requests||0).toLocaleString()} detail="Root chat observations"/><Metric icon={<Activity size={17}/>} label="Total tokens" value={Number(summary.total_tokens||0).toLocaleString()} detail="Input and output tokens"/><Metric icon={<CreditCard size={17}/>} label="Total cost" value={`$${Number(summary.total_cost||0).toFixed(6)}`} detail="Reported by Langfuse, USD"/><Metric icon={<RefreshCw size={17}/>} label="Average latency" value={`${(Number(summary.avg_latency||0)*1000).toFixed(0)} ms`} detail="Per chat observation"/></div>
      <section className="panel table-panel langfuse-breakdown"><div className="panel-heading"><div><h2>Usage by model</h2><p>Tokens, cost, and chats during the selected period.</p></div></div><div className="table-scroll"><table><thead><tr><th>MODEL</th><th>CHATS</th><th>TOKENS</th><th>COST (USD)</th></tr></thead><tbody>{(metrics?.by_model||[]).map((row:any,i:number)=><tr key={`${row.providedModelName||"unknown"}-${i}`}><td>{row.providedModelName||"Unknown model"}</td><td>{Number(row.count_count||0).toLocaleString()}</td><td>{Number(row.sum_totalTokens||0).toLocaleString()}</td><td>${Number(row.sum_totalCost||0).toFixed(6)}</td></tr>)}</tbody></table>{!metricsLoading&&!(metrics?.by_model||[]).length&&<Empty text="No model usage in this date range."/>}</div></section>
      <section className="panel table-panel langfuse-breakdown"><div className="panel-heading"><div><h2>Daily usage</h2><p>Daily chats, tokens, and cost for the selected period.</p></div></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>CHATS</th><th>TOKENS</th><th>COST (USD)</th></tr></thead><tbody>{(metrics?.daily||[]).map((row:any,i:number)=><tr key={`${row.time_dimension||"day"}-${i}`}><td>{row.time_dimension?new Date(row.time_dimension).toLocaleDateString():"—"}</td><td>{Number(row.count_count||0).toLocaleString()}</td><td>{Number(row.sum_totalTokens||0).toLocaleString()}</td><td>${Number(row.sum_totalCost||0).toFixed(6)}</td></tr>)}</tbody></table>{!metricsLoading&&!(metrics?.daily||[]).length&&<Empty text="No daily usage in this date range."/>}</div></section>
      <section className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>STARTED</th><th>TRACE</th><th>MODEL</th><th>LATENCY</th><th>TOKENS</th><th>COST</th><th>INPUT</th><th>OUTPUT</th></tr></thead><tbody>{data.items.map((observation:any)=><tr key={observation.id}><td>{date(observation.startTime)}</td><td><strong>{observation.traceName||observation.name||"Agent chat"}</strong><small className="mono">{observation.traceId}</small></td><td>{observation.model||"—"}</td><td>{observation.latency==null?"—":`${(observation.latency*1000).toFixed(0)} ms`}</td><td>{observation.totalUsage==null?"—":displayTraceValue(observation.totalUsage)}</td><td>{observation.totalCost==null?"—":`$${Number(observation.totalCost).toFixed(6)}`}</td><td className="trace-io"><TraceValue value={observation.input}/></td><td className="trace-io"><TraceValue value={observation.output}/></td></tr>)}</tbody></table>{!data.items.length&&<Empty text="No observations in the last 90 days. Send a chat after configuring the Langfuse keys."/>}</div></section>{data.cursor&&<div className="pager"><span>{data.items.length} observations loaded · latest 90 days</span><button className="secondary" onClick={onMore}>Load more<ChevronRight size={14}/></button></div>}
    </>}
  </>;
}
function displayTraceValue(value:any) { if(value==null)return "—";if(typeof value==="string"){try{const parsed=JSON.parse(value);return typeof parsed==="string"?parsed:JSON.stringify(parsed);}catch{return value;}}return JSON.stringify(value); }
function TraceValue({value}:{value:any}) { const text=displayTraceValue(value);return <details><summary>{text.length>180?`${text.slice(0,180)}…`:text}</summary><pre>{text}</pre></details>; }
