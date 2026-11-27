"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Activity, Bot, CheckCircle2, ChevronRight, CreditCard, KeyRound, MessageSquareText, RefreshCw, Shield, ShieldAlert, UserRound, X } from "lucide-react";
import { api } from "@/lib/api";
import "./user-detail.css";

type UserTab = "details" | "agents" | "subscription" | "conversations" | "security" | "logs";
type ConfirmRequest = {
  title: string;
  description: string;
  summary: string[];
  confirmLabel: string;
  tone?: "primary" | "danger";
  run: () => Promise<void>;
};

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function fmtMoney(amount?: number | null, currency?: string | null) {
  if (amount == null) return "—";
  return `${(amount / 100).toFixed(2)} ${(currency || "").toUpperCase()}`.trim();
}

function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "red" | "amber" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export default function UserDetailModal({
  userId,
  onClose,
  onUpdated,
  onOpenConversation,
  onOpenTicket,
}: {
  userId: string;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  onOpenConversation: (id: string, title: string) => void;
  onOpenTicket: (id: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<UserTab>("details");
  const [logKind, setLogKind] = useState<"admin" | "workspace">("admin");
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const [profileForm, setProfileForm] = useState({ name: "", company: "", bio: "", avatar_url: "" });
  const [billingForm, setBillingForm] = useState({ plan: "free", subscription_tokens: 0, topup_tokens: 0 });
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState({ name: "", description: "", system_prompt: "", threshold: 0.22 });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<any>(`/admin/users/${encodeURIComponent(userId)}`);
      setData(result);
      setProfileForm({
        name: result.user.name || "",
        company: result.user.company || "",
        bio: result.user.bio || "",
        avatar_url: result.user.avatar_url || "",
      });
      setBillingForm({
        plan: result.user.plan || "free",
        subscription_tokens: Number(result.user.subscription_tokens || 0),
        topup_tokens: Number(result.user.topup_tokens || 0),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmRequest && !saving) setConfirmRequest(null);
      else if (!confirmRequest && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmRequest, saving, onClose]);

  async function executeConfirmed() {
    if (!confirmRequest || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await confirmRequest.run();
      setConfirmRequest(null);
      await load();
      await onUpdated();
    } catch (e) {
      setError((e as Error).message);
      setConfirmRequest(null);
    } finally {
      setSaving(false);
    }
  }

  function requestProfileSave(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    const u = data.user;
    const summary: string[] = [];
    if (profileForm.name.trim() !== (u.name || "")) summary.push(`Name: "${u.name}" → "${profileForm.name.trim()}"`);
    if (profileForm.company.trim() !== (u.company || "")) summary.push(`Company: "${u.company || "—"}" → "${profileForm.company.trim() || "—"}"`);
    if (profileForm.bio.trim() !== (u.bio || "")) summary.push(`Bio updated`);
    if (profileForm.avatar_url.trim() !== (u.avatar_url || "")) summary.push(`Avatar URL updated`);
    if (!summary.length) {
      setNotice("No profile changes to save.");
      return;
    }
    setConfirmRequest({
      title: "Save user profile changes?",
      description: `This updates ${u.email}'s account profile and records the change in the admin audit log.`,
      summary,
      confirmLabel: "Confirm & save",
      run: async () => {
        await api(`/admin/users/${u.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: profileForm.name.trim(),
            company: profileForm.company.trim(),
            bio: profileForm.bio.trim(),
            avatar_url: profileForm.avatar_url.trim(),
          }),
        });
        setNotice("User profile updated and logged.");
      },
    });
  }

  function requestStatusToggle() {
    if (!data) return;
    const u = data.user;
    const nextActive = !u.is_active;
    setConfirmRequest({
      title: nextActive ? "Reactivate user account?" : "Suspend user account?",
      description: nextActive
        ? `Restores sign-in and workspace access for ${u.email}.`
        : `Suspending ${u.email} immediately revokes all active login sessions and API keys.`,
      summary: [`Status: ${u.is_active ? "Active" : "Suspended"} → ${nextActive ? "Active" : "Suspended"}`],
      confirmLabel: nextActive ? "Reactivate account" : "Suspend account",
      tone: nextActive ? "primary" : "danger",
      run: async () => {
        await api(`/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ is_active: nextActive }) });
        setNotice(nextActive ? "Account reactivated and logged." : "Account suspended, sessions/keys cleared, and logged.");
      },
    });
  }

  function requestBillingSave(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    const u = data.user;
    const summary: string[] = [];
    if (billingForm.plan !== u.plan) summary.push(`Plan: ${u.plan} → ${billingForm.plan}`);
    if (Number(billingForm.subscription_tokens) !== Number(u.subscription_tokens)) {
      summary.push(`Subscription tokens: ${Number(u.subscription_tokens).toLocaleString()} → ${Number(billingForm.subscription_tokens).toLocaleString()}`);
    }
    if (Number(billingForm.topup_tokens) !== Number(u.topup_tokens)) {
      summary.push(`Top-up tokens: ${Number(u.topup_tokens).toLocaleString()} → ${Number(billingForm.topup_tokens).toLocaleString()}`);
    }
    if (!summary.length) {
      setNotice("No subscription or token changes to save.");
      return;
    }
    if (u.has_subscription && billingForm.plan !== u.plan) {
      summary.push("Note: Account has an active provider subscription; webhooks may resync plan later.");
    }
    setConfirmRequest({
      title: "Apply subscription & token changes?",
      description: `Confirm billing updates for ${u.email}. All changes are recorded in the admin audit log.`,
      summary,
      confirmLabel: "Confirm changes",
      run: async () => {
        await api(`/admin/users/${u.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            plan: billingForm.plan,
            subscription_tokens: Number(billingForm.subscription_tokens),
            topup_tokens: Number(billingForm.topup_tokens),
          }),
        });
        setNotice("Subscription and token balances updated and logged.");
      },
    });
  }

  function startEditAgent(agent: any) {
    if (editingAgentId === agent.id) {
      setEditingAgentId(null);
      return;
    }
    setEditingAgentId(agent.id);
    setAgentForm({
      name: agent.name || "",
      description: agent.description || "",
      system_prompt: agent.system_prompt || "",
      threshold: Number(agent.threshold ?? 0.22),
    });
  }

  function requestAgentSave(event: FormEvent, agent: any) {
    event.preventDefault();
    const summary: string[] = [];
    if (agentForm.name.trim() !== agent.name) summary.push(`Name: "${agent.name}" → "${agentForm.name.trim()}"`);
    if (agentForm.description.trim() !== (agent.description || "")) summary.push("Description updated");
    if (agentForm.system_prompt !== (agent.system_prompt || "")) summary.push("System prompt updated");
    if (Math.abs(Number(agentForm.threshold) - Number(agent.threshold)) > 1e-6) summary.push(`Threshold: ${agent.threshold} → ${agentForm.threshold}`);
    if (!summary.length) {
      setEditingAgentId(null);
      return;
    }
    setConfirmRequest({
      title: `Update agent “${agent.name}”?`,
      description: "Saves the updated agent configuration and writes an administrator audit log.",
      summary,
      confirmLabel: "Save agent",
      run: async () => {
        await api(`/admin/users/${data.user.id}/agents/${agent.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: agentForm.name.trim(),
            description: agentForm.description.trim(),
            system_prompt: agentForm.system_prompt,
            threshold: Number(agentForm.threshold),
          }),
        });
        setEditingAgentId(null);
        setNotice(`Agent “${agentForm.name.trim()}” updated and logged.`);
      },
    });
  }

  function requestAgentToggle(agent: any) {
    const nextPublished = !agent.published;
    setConfirmRequest({
      title: nextPublished ? `Publish “${agent.name}”?` : `Unpublish “${agent.name}”?`,
      description: nextPublished
        ? "Makes the agent's hosted chat page and embeddable widget publicly available."
        : "Visitors will immediately lose access to the hosted chat page and embed widget.",
      summary: [`Publication status: ${agent.published ? "Published" : "Draft"} → ${nextPublished ? "Published" : "Draft"}`],
      confirmLabel: nextPublished ? "Publish agent" : "Unpublish agent",
      tone: nextPublished ? "primary" : "danger",
      run: async () => {
        await api(`/admin/users/${data.user.id}/agents/${agent.id}`, {
          method: "PATCH",
          body: JSON.stringify({ published: nextPublished }),
        });
        setNotice(`Agent ${nextPublished ? "published" : "unpublished"} and logged.`);
      },
    });
  }

  function requestRevokeKey(key: any) {
    setConfirmRequest({
      title: `Revoke API key “${key.name}”?`,
      description: "Any scripts or integrations using this key will immediately stop working.",
      summary: [`Key prefix: ${key.prefix}••••`],
      confirmLabel: "Revoke API key",
      tone: "danger",
      run: async () => {
        await api(`/admin/users/${data.user.id}/keys/${key.id}`, { method: "DELETE" });
        setNotice(`API key “${key.name}” revoked and logged.`);
      },
    });
  }

  function requestRevokeSessions() {
    if (!data) return;
    setConfirmRequest({
      title: "Revoke all active sessions?",
      description: `Signs ${data.user.email} out of all active browser sessions immediately.`,
      summary: [`Active sessions to clear: ${data.user.active_session_count}`],
      confirmLabel: "Revoke sessions",
      tone: "danger",
      run: async () => {
        await api(`/admin/users/${data.user.id}/sessions/revoke`, { method: "POST" });
        setNotice("Active sessions revoked and logged.");
      },
    });
  }

  const user = data?.user;
  const tabs: { id: UserTab; label: string; count?: number }[] = [
    { id: "details", label: "Details" },
    { id: "agents", label: "Agents", count: data?.agents?.length ?? 0 },
    { id: "subscription", label: "Subscription" },
    { id: "conversations", label: "Conversations", count: data?.conversations?.length ?? 0 },
    { id: "security", label: "Support & Keys", count: (data?.tickets?.length ?? 0) + (data?.api_keys?.length ?? 0) },
    { id: "logs", label: "Logs", count: (data?.logs?.admin_audit?.length ?? 0) + (data?.logs?.bot_activity?.length ?? 0) },
  ];

  return (
    <div className="modal-backdrop user-detail-backdrop" onClick={() => { if (!confirmRequest && !saving) onClose(); }}>
      <section className="user-detail-modal" role="dialog" aria-modal="true" aria-label="User details" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="user-detail-head-main">
            <div className="user-detail-avatar">
              {user?.avatar_url ? <img src={user.avatar_url} alt={user.name} /> : (user?.name?.[0]?.toUpperCase() || "U")}
            </div>
            <div>
              <p className="eyebrow">USER ACCOUNT INSPECTOR</p>
              <div className="user-detail-title-row">
                <h2>{user?.name || "Loading user…"}</h2>
                {user && <Badge tone={user.is_active ? "green" : "red"}>{user.is_active ? "Active" : "Suspended"}</Badge>}
                {user && <Badge tone="amber">{user.plan}</Badge>}
                {user?.is_admin && <Badge tone="green">Platform Admin</Badge>}
              </div>
              <p className="subtle">{user ? `${user.email} · ID ${user.id}` : "Fetching account details…"}</p>
            </div>
          </div>
          <div className="user-detail-head-actions">
            <button type="button" className="icon-button" title="Refresh user details" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={15} /></button>
            <button type="button" className="icon-button" aria-label="Close user details" onClick={onClose} disabled={saving}><X size={18} /></button>
          </div>
        </header>

        <nav className="user-detail-tabs" aria-label="User sections">
          {tabs.map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              {item.label}
              {item.count !== undefined && <span>{item.count}</span>}
            </button>
          ))}
        </nav>

        <div className="user-detail-body" ref={bodyRef}>
          <div className="user-detail-content">
          {error && <div className="error-banner"><ShieldAlert size={16} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}
          {notice && <div className="error-banner" style={{ borderColor: "#cde9dd", background: "#f4fbf7", color: "#137759" }}><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}

          {loading || !data ? (
            <div className="loading-card">Loading user records…</div>
          ) : tab === "details" ? (
            <>
              <div className="user-detail-stats">
                <div className="user-stat-box"><small>Agents</small><strong>{user.agent_count} ({user.published_agent_count} live)</strong></div>
                <div className="user-stat-box"><small>Knowledge sources</small><strong>{user.document_count}</strong></div>
                <div className="user-stat-box"><small>Conversations</small><strong>{user.conversation_count}</strong></div>
                <div className="user-stat-box"><small>Visitor messages</small><strong>{user.message_count}</strong></div>
              </div>

              <div className="user-detail-grid">
                <form className="user-detail-card" onSubmit={requestProfileSave}>
                  <div className="user-detail-card-head">
                    <div><h3>Edit profile details</h3><p>Changes require confirmation and write an admin audit event.</p></div>
                    <UserRound size={17} />
                  </div>
                  <div className="user-detail-form-grid">
                    <label>Full name<input required maxLength={80} value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} /></label>
                    <label>Company<input maxLength={120} value={profileForm.company} onChange={(e) => setProfileForm({ ...profileForm, company: e.target.value })} placeholder="Optional" /></label>
                  </div>
                  <label className="user-detail-field">Avatar URL (HTTPS)<input type="url" maxLength={2000} value={profileForm.avatar_url} onChange={(e) => setProfileForm({ ...profileForm, avatar_url: e.target.value })} placeholder="https://example.com/avatar.png" /></label>
                  <label className="user-detail-field">Bio<textarea rows={3} maxLength={500} value={profileForm.bio} onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })} /></label>
                  <div className="user-detail-actions">
                    <button type="submit" className="primary" disabled={saving}>Save profile changes</button>
                  </div>
                </form>

                <div className="user-detail-card">
                  <div className="user-detail-card-head">
                    <div><h3>Account metadata & access</h3><p>Identity, sign-in method, and account status.</p></div>
                    <Shield size={17} />
                  </div>
                  <div className="user-detail-meta">
                    <div><span>User ID</span><strong className="mono">{user.id}</strong></div>
                    <div><span>Email</span><strong>{user.email}</strong></div>
                    <div><span>Joined</span><strong>{fmtDate(user.created_at)}</strong></div>
                    <div><span>Google OAuth</span><strong>{user.google_connected ? "Connected" : "Not connected"}</strong></div>
                    <div><span>Active sessions</span><strong>{user.active_session_count}</strong></div>
                    <div><span>API keys</span><strong>{user.api_key_count}</strong></div>
                    <div><span>Support tickets</span><strong>{user.ticket_count}</strong></div>
                  </div>
                  <div className="user-detail-actions">
                    <button type="button" className={user.is_active ? "danger-outline" : "success-outline"} disabled={saving || user.is_admin} onClick={requestStatusToggle}>
                      {user.is_admin ? "Cannot suspend admin" : user.is_active ? "Suspend account" : "Reactivate account"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : tab === "agents" ? (
            <div className="user-agent-list">
              {!data.agents.length ? (
                <div className="empty-state">This user has not created any agents yet.</div>
              ) : (
                data.agents.map((agent: any) => (
                  <article className="user-agent-card" key={agent.id}>
                    <div className="user-agent-top">
                      <div>
                        <div className="user-detail-title-row">
                          <h3>{agent.name}</h3>
                          <Badge tone={agent.published ? "green" : "amber"}>{agent.published ? "Published" : "Draft"}</Badge>
                          {agent.has_workflow && <Badge tone={agent.workflow_enabled ? "green" : "gray"}>Workflow v{agent.workflow_version} {agent.workflow_enabled ? "enabled" : "disabled"}</Badge>}
                        </div>
                        <small className="mono">ID: {agent.id} · Slug: {agent.slug} · Key: {agent.public_key} · Created {fmtDate(agent.created_at)}</small>
                      </div>
                      <div className="user-agent-actions">
                        <button type="button" className="secondary" disabled={saving} onClick={() => startEditAgent(agent)}>
                          {editingAgentId === agent.id ? "Cancel edit" : "Edit agent"}
                        </button>
                        <button type="button" className={agent.published ? "danger-outline" : "success-outline"} disabled={saving} onClick={() => requestAgentToggle(agent)}>
                          {agent.published ? "Unpublish" : "Publish"}
                        </button>
                      </div>
                    </div>
                    {agent.description && <p className="subtle" style={{ marginTop: 0 }}>{agent.description}</p>}
                    <div className="user-agent-metrics">
                      <span><Bot size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />Threshold: {agent.threshold}</span>
                      <span>Sources: {agent.documents} ({agent.ready_documents} ready{agent.failed_documents ? `, ${agent.failed_documents} failed` : ""})</span>
                      <span>Chunks: {agent.chunks}</span>
                      <span>Conversations: {agent.conversations}</span>
                      <span>Messages: {agent.messages}</span>
                      <span>Open flags: {agent.open_flags}</span>
                      <span>Template: {agent.widget_config?.chat_template_id || "classic"}</span>
                    </div>
                    {agent.system_prompt && <div className="user-agent-prompt"><strong>System prompt:</strong> {agent.system_prompt}</div>}
                    {editingAgentId === agent.id && (
                      <form className="user-agent-edit" onSubmit={(e) => requestAgentSave(e, agent)}>
                        <div className="user-detail-form-grid">
                          <label>Agent name<input required maxLength={80} value={agentForm.name} onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })} /></label>
                          <label>Abstention threshold<input type="number" step="0.01" min="0.05" max="0.95" required value={agentForm.threshold} onChange={(e) => setAgentForm({ ...agentForm, threshold: Number(e.target.value) })} /></label>
                        </div>
                        <label className="user-detail-field">Description<input maxLength={500} value={agentForm.description} onChange={(e) => setAgentForm({ ...agentForm, description: e.target.value })} /></label>
                        <label className="user-detail-field">System prompt<textarea rows={3} maxLength={3000} value={agentForm.system_prompt} onChange={(e) => setAgentForm({ ...agentForm, system_prompt: e.target.value })} /></label>
                        <div className="user-detail-actions">
                          <button type="button" className="secondary" onClick={() => setEditingAgentId(null)}>Cancel</button>
                          <button type="submit" className="primary" disabled={saving}>Save agent changes</button>
                        </div>
                      </form>
                    )}
                  </article>
                ))
              )}
            </div>
          ) : tab === "subscription" ? (
            <>
              <div className="user-detail-grid">
                <form className="user-detail-card" onSubmit={requestBillingSave}>
                  <div className="user-detail-card-head">
                    <div><h3>Edit plan & token balances</h3><p>Adjust subscription tier or credit balances with confirmation.</p></div>
                    <CreditCard size={17} />
                  </div>
                  <div className="user-detail-form-grid">
                    <label>Plan
                      <select
                        value={billingForm.plan}
                        onChange={(e) => {
                          const nextPlan = e.target.value;
                          const matched = (data.plan_options || []).find((p: any) => p.slug === nextPlan);
                          setBillingForm({
                            ...billingForm,
                            plan: nextPlan,
                            subscription_tokens: matched ? Number(matched.tokens ?? billingForm.subscription_tokens) : billingForm.subscription_tokens,
                          });
                        }}
                      >
                        {(data.plan_options || []).map((p: any) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                      </select>
                    </label>
                    <label>Subscription tokens<input type="number" min={0} required value={billingForm.subscription_tokens} onChange={(e) => setBillingForm({ ...billingForm, subscription_tokens: Number(e.target.value) })} /></label>
                    <label>Top-up tokens<input type="number" min={0} required value={billingForm.topup_tokens} onChange={(e) => setBillingForm({ ...billingForm, topup_tokens: Number(e.target.value) })} /></label>
                  </div>
                  <div className="user-detail-actions">
                    <button type="submit" className="primary" disabled={saving}>Save billing changes</button>
                  </div>
                </form>

                <div className="user-detail-card">
                  <div className="user-detail-card-head">
                    <div><h3>Provider subscription details</h3><p>Current gateway identifiers and trial metadata.</p></div>
                  </div>
                  <div className="user-detail-meta">
                    <div><span>Active provider</span><strong className="capitalize">{data.subscription.billing_provider || "—"}</strong></div>
                    <div><span>Provider subscription</span><strong>{data.subscription.has_subscription ? "Yes" : "No"}</strong></div>
                    <div><span>Stripe customer ID</span><strong className="mono">{data.subscription.stripe_customer_id || "—"}</strong></div>
                    <div><span>Stripe subscription ID</span><strong className="mono">{data.subscription.subscription_id || "—"}</strong></div>
                    <div><span>Razorpay subscription ID</span><strong className="mono">{data.subscription.razorpay_subscription_id || "—"}</strong></div>
                    <div><span>Free trial started</span><strong>{fmtDate(data.subscription.free_started_at)}</strong></div>
                    <div><span>Free trial used</span><strong>{data.subscription.free_trial_used ? "Yes" : "No"}</strong></div>
                  </div>
                </div>
              </div>

              <section className="panel table-panel">
                <div className="panel-heading" style={{ padding: "16px 18px 0" }}><div><h2>Payments</h2><p>Subscription and top-up payment records.</p></div></div>
                <div className="table-scroll">
                  <table className="user-detail-table">
                    <thead><tr><th>KIND</th><th>PLAN</th><th>PROVIDER</th><th>AMOUNT</th><th>TOKENS</th><th>STATUS</th><th>DATE</th><th>REFERENCE</th></tr></thead>
                    <tbody>
                      {data.subscription.payments.map((p: any) => (
                        <tr key={p.id}>
                          <td className="capitalize">{p.kind}</td>
                          <td className="capitalize">{p.plan || "—"}</td>
                          <td className="capitalize">{p.provider}</td>
                          <td>{fmtMoney(p.amount, p.currency)}</td>
                          <td>{p.tokens != null ? Number(p.tokens).toLocaleString() : "—"}</td>
                          <td><Badge tone={p.status === "paid" || p.status === "captured" ? "green" : p.status === "pending" ? "amber" : "gray"}>{p.status}</Badge></td>
                          <td>{fmtDate(p.created_at)}</td>
                          <td className="mono">{p.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.subscription.payments.length && <div className="empty-state">No payment records for this user.</div>}
                </div>
              </section>

              <section className="panel table-panel">
                <div className="panel-heading" style={{ padding: "16px 18px 0" }}><div><h2>Checkout attempts</h2><p>Recent Stripe and Razorpay checkout attempts.</p></div></div>
                <div className="table-scroll">
                  <table className="user-detail-table">
                    <thead><tr><th>PROVIDER</th><th>PLAN</th><th>STATUS</th><th>PAID COUNT</th><th>REFERENCE</th><th>CREATED</th></tr></thead>
                    <tbody>
                      {data.subscription.attempts.map((a: any) => (
                        <tr key={a.id}>
                          <td className="capitalize">{a.provider}</td>
                          <td className="capitalize">{a.plan}</td>
                          <td><Badge tone={a.status === "succeeded" ? "green" : a.status === "pending" ? "amber" : "gray"}>{a.status}</Badge></td>
                          <td>{a.paid_count}</td>
                          <td className="mono">{a.provider_reference}</td>
                          <td>{fmtDate(a.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.subscription.attempts.length && <div className="empty-state">No checkout attempts recorded.</div>}
                </div>
              </section>

              <section className="panel table-panel">
                <div className="panel-heading" style={{ padding: "16px 18px 0" }}><div><h2>Recent token usage</h2><p>Latest 50 token deductions across subscription and top-up balances.</p></div></div>
                <div className="table-scroll">
                  <table className="user-detail-table">
                    <thead><tr><th>DATE</th><th>TOTAL TOKENS</th><th>FROM SUBSCRIPTION</th><th>FROM TOP-UP</th><th>SOURCE</th></tr></thead>
                    <tbody>
                      {data.subscription.token_usage.map((u: any) => (
                        <tr key={u.id}>
                          <td>{fmtDate(u.created_at)}</td>
                          <td>{Number(u.tokens).toLocaleString()}</td>
                          <td>{Number(u.subscription_tokens).toLocaleString()}</td>
                          <td>{Number(u.topup_tokens).toLocaleString()}</td>
                          <td>{u.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.subscription.token_usage.length && <div className="empty-state">No token usage recorded yet.</div>}
                </div>
              </section>
            </>
          ) : tab === "conversations" ? (
            <section className="panel table-panel">
              <div className="table-scroll">
                <table className="user-detail-table">
                  <thead><tr><th>AGENT</th><th>VISITOR</th><th>LAST MESSAGE</th><th>MESSAGES</th><th>LAST ACTIVE</th><th /></tr></thead>
                  <tbody>
                    {data.conversations.map((c: any) => (
                      <tr key={c.id}>
                        <td><strong>{c.agent_name}</strong><small className="mono">{c.agent_id}</small></td>
                        <td><strong>{c.user_name || (c.user_id ? `User ${c.user_id}` : "Anonymous")}</strong><small className="mono">{c.visitor_id}</small></td>
                        <td className="message-preview">{c.last_message || "—"}</td>
                        <td>{c.message_count}</td>
                        <td>{fmtDate(c.last_message_at)}</td>
                        <td><button type="button" className="secondary" onClick={() => onOpenConversation(c.id, `${c.agent_name} · ${user.name}`)}>View transcript<ChevronRight size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.conversations.length && <div className="empty-state">No conversations found for this user&apos;s agents.</div>}
              </div>
            </section>
          ) : tab === "security" ? (
            <>
              <div className="user-detail-card">
                <div className="user-detail-card-head">
                  <div><h3>Login sessions</h3><p>Currently active authenticated sessions: {user.active_session_count}</p></div>
                  <button type="button" className="danger-outline" disabled={saving || user.is_admin || user.active_session_count === 0} onClick={requestRevokeSessions}>
                    {user.is_admin ? "Admin session protected" : "Revoke all sessions"}
                  </button>
                </div>
              </div>

              <section className="panel table-panel">
                <div className="panel-heading" style={{ padding: "16px 18px 0" }}><div><h2>API keys</h2><p>Owner-scoped bearer tokens for API access.</p></div><KeyRound size={17} /></div>
                <div className="table-scroll">
                  <table className="user-detail-table">
                    <thead><tr><th>NAME</th><th>PREFIX</th><th>CREATED</th><th>ACTION</th></tr></thead>
                    <tbody>
                      {data.api_keys.map((k: any) => (
                        <tr key={k.id}>
                          <td><strong>{k.name}</strong></td>
                          <td className="mono">{k.prefix}••••••••</td>
                          <td>{fmtDate(k.created_at)}</td>
                          <td><button type="button" className="danger-outline" disabled={saving} onClick={() => requestRevokeKey(k)}>Revoke</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.api_keys.length && <div className="empty-state">No API keys created by this user.</div>}
                </div>
              </section>

              <section className="panel table-panel">
                <div className="panel-heading" style={{ padding: "16px 18px 0" }}><div><h2>Support tickets</h2><p>Customer help desk threads for this user.</p></div><MessageSquareText size={17} /></div>
                <div className="table-scroll">
                  <table className="user-detail-table">
                    <thead><tr><th>SUBJECT</th><th>LAST REPLY</th><th>STATUS</th><th>UPDATED</th><th /></tr></thead>
                    <tbody>
                      {data.tickets.map((t: any) => (
                        <tr key={t.id}>
                          <td><strong>{t.subject}</strong><small className="mono">{t.id.slice(0, 8)}</small></td>
                          <td className="message-preview">{t.last_message || "—"}</td>
                          <td><Badge tone={t.status === "open" ? "amber" : t.status === "resolved" || t.status === "closed" ? "green" : "gray"}>{t.status.replaceAll("_", " ")}</Badge></td>
                          <td>{fmtDate(t.updated_at)}</td>
                          <td><button type="button" className="secondary" onClick={() => onOpenTicket(t.id)}>Open ticket<ChevronRight size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.tickets.length && <div className="empty-state">No support tickets submitted by this user.</div>}
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="user-logs-toolbar">
                <div className="user-logs-switch">
                  <button type="button" className={logKind === "admin" ? "active" : ""} onClick={() => setLogKind("admin")}>
                    Admin audit log ({data.logs.admin_audit.length})
                  </button>
                  <button type="button" className={logKind === "workspace" ? "active" : ""} onClick={() => setLogKind("workspace")}>
                    Bot activity log ({data.logs.bot_activity.length})
                  </button>
                </div>
                <span className="subtle small-text"><Activity size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Every admin edit is recorded automatically</span>
              </div>

              {logKind === "admin" ? (
                <section className="panel table-panel">
                  <div className="table-scroll">
                    <table className="user-detail-table">
                      <thead><tr><th>ACTION</th><th>ADMINISTRATOR</th><th>ENTITY</th><th>DETAILS</th><th>TIME</th></tr></thead>
                      <tbody>
                        {data.logs.admin_audit.map((entry: any) => (
                          <tr key={entry.id}>
                            <td><Badge tone={entry.action.includes("suspend") || entry.action.includes("revoke") ? "red" : "amber"}>{entry.action}</Badge></td>
                            <td>{entry.actor_email}</td>
                            <td><span className="capitalize">{entry.entity_type}</span><small className="mono">{entry.entity_id}</small></td>
                            <td className="user-log-details">{Object.entries(entry.details || {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || "—"}</td>
                            <td>{fmtDate(entry.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.logs.admin_audit.length && <div className="empty-state">No administrator audit events recorded for this user yet.</div>}
                  </div>
                </section>
              ) : (
                <section className="panel table-panel">
                  <div className="table-scroll">
                    <table className="user-detail-table">
                      <thead><tr><th>BOT</th><th>EVENT</th><th>SEVERITY</th><th>TITLE</th><th>DETAILS</th><th>TIME</th></tr></thead>
                      <tbody>
                        {data.logs.bot_activity.map((entry: any) => (
                          <tr key={entry.id}>
                            <td><strong>{entry.bot_name}</strong><small>{entry.source}</small></td>
                            <td>{entry.event_type}</td>
                            <td><Badge tone={entry.severity === "error" ? "red" : entry.severity === "warning" ? "amber" : "green"}>{entry.severity}</Badge></td>
                            <td>{entry.title}</td>
                            <td className="user-log-details">{Object.entries(entry.details || {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || "—"}</td>
                            <td>{fmtDate(entry.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!data.logs.bot_activity.length && <div className="empty-state">No bot activity logs in the last 24 hours.</div>}
                  </div>
                </section>
              )}
            </>
          )}
          </div>
        </div>
      </section>

      {confirmRequest && (
        <div className="user-confirm-backdrop" onClick={() => { if (!saving) setConfirmRequest(null); }}>
          <section className="user-confirm-card" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{confirmRequest.title}</h3>
            <p>{confirmRequest.description}</p>
            {confirmRequest.summary.length > 0 && (
              <ul className="user-confirm-list">
                {confirmRequest.summary.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
            <div className="user-confirm-actions">
              <button type="button" className="secondary" disabled={saving} onClick={() => setConfirmRequest(null)}>Cancel</button>
              <button type="button" className={confirmRequest.tone === "danger" ? "danger-solid" : "primary"} disabled={saving} onClick={() => void executeConfirmed()}>
                {saving ? "Applying…" : confirmRequest.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
