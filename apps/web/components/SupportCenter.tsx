"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Clock3, LifeBuoy, LoaderCircle, MessageCircle, Plus, Send } from "lucide-react";
import { api } from "@/lib/api";
import { SupportEditor, SupportMessageView } from "@/components/SupportRichText";
import "@/components/support.css";

type Ticket = { id: string; subject: string; status: string; created_at: string; updated_at: string; unread: boolean; last_message: string; last_author_role: string };
type TicketMessage = { id: string; author_role: string; author_name: string; body: string; created_at: string };
type TicketThread = Ticket & { messages: TicketMessage[] };
const statusLabel: Record<string, string> = { open: "Open", in_progress: "In progress", waiting_on_user: "Waiting for you", resolved: "Resolved", closed: "Closed" };
const dateLabel = (value: string) => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function SupportCenter() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<TicketThread | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTickets = useCallback(async () => {
    const result = await api<{ items: Ticket[] }>("/support/tickets");
    setTickets(result.items || []);
  }, []);
  const loadTicket = useCallback(async (id: string, markRead = false) => {
    if (markRead) await api(`/support/tickets/${id}/read`, { method: "POST" });
    const result = await api<TicketThread>(`/support/tickets/${id}`);
    setSelected(result);
  }, []);
  useEffect(() => {
    void loadTickets().catch((e) => setError(e.message));
    const timer = window.setInterval(() => {
      void loadTickets().catch(() => {});
      if (selected?.id) void loadTicket(selected.id).catch(() => {});
    }, 12000);
    return () => window.clearInterval(timer);
  }, [loadTickets, loadTicket, selected?.id]);

  async function create(event: FormEvent) {
    event.preventDefault(); if (!message.trim()) { setError("Message cannot be blank."); return; } setBusy(true); setError("");
    try {
      const ticket = await api<Ticket>("/support/tickets", { method: "POST", body: JSON.stringify({ subject, message }) });
      setSubject(""); setMessage(""); setComposing(false);
      await loadTickets(); await loadTicket(ticket.id, true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!selected) return; if (!reply.trim()) { setError("Reply cannot be blank."); return; }
    setBusy(true); setError("");
    try {
      await api(`/support/tickets/${selected.id}/messages`, { method: "POST", body: JSON.stringify({ message: reply }) });
      setReply(""); await Promise.all([loadTickets(), loadTicket(selected.id, true)]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="support-center">
    <header className="support-heading"><div><span className="eyebrow">HELP DESK</span><h1>Support</h1><p>Send our team a message. Replies stay together in your ticket thread, like email.</p></div><button className="primary" onClick={() => { setSelected(null); setComposing(true); }}><Plus size={16}/>New ticket</button></header>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="support-layout">
      <aside className="support-ticket-list panel"><div className="support-list-heading"><h2>Your tickets</h2><span>{tickets.length}</span></div>
        {!tickets.length ? <div className="support-list-empty"><LifeBuoy size={22}/><p>No support tickets yet.</p></div> : tickets.map((ticket) => <button className={`support-ticket-row ${selected?.id === ticket.id ? "selected" : ""}`} key={ticket.id} onClick={() => { setComposing(false); void loadTicket(ticket.id, true).catch((e) => setError(e.message)); }}><span className="support-ticket-row-top"><strong>{ticket.subject}</strong>{ticket.unread && <i aria-label="New reply"/>}</span><span className="support-ticket-preview">{ticket.last_message}</span><span className="support-ticket-row-bottom"><span className={`support-status ${ticket.status}`}>{statusLabel[ticket.status] || ticket.status}</span><time>{dateLabel(ticket.updated_at)}</time></span></button>)}
      </aside>
      <main className="support-thread panel">
        {composing ? <form className="support-compose" onSubmit={create}><button type="button" className="support-back" onClick={() => setComposing(false)}><ArrowLeft size={15}/>Back to tickets</button><h2>Start a support ticket</h2><p>Describe what you need help with. The support team will be notified in the admin console.</p><label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={160} placeholder="Briefly describe your issue"/></label><div className="support-compose-field"><span>Message</span><SupportEditor value={message} onChange={setMessage} maxLength={10000} rows={7} placeholder="Include details that will help us investigate…"/></div><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="support-spin" size={15}/> : <Send size={15}/>}Send ticket</button></form>
        : selected ? <><header className="support-thread-heading"><div><span className="eyebrow">TICKET · {selected.id.slice(0, 8).toUpperCase()}</span><h2>{selected.subject}</h2><span className={`support-status ${selected.status}`}>{statusLabel[selected.status] || selected.status}</span></div><button className="support-back" onClick={() => setSelected(null)}><ArrowLeft size={15}/>All tickets</button></header><div className="support-messages">{selected.messages.map((item) => <article key={item.id} className={`support-message ${item.author_role}`}><div className="support-message-meta"><strong>{item.author_name}</strong><time>{dateLabel(item.created_at)}</time></div><SupportMessageView text={item.body}/></article>)}</div><form className="support-reply" onSubmit={sendReply}><SupportEditor value={reply} onChange={setReply} maxLength={10000} rows={3} placeholder="Write a reply…"/><div><span><Clock3 size={13}/>Replies update this ticket automatically.</span><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="support-spin" size={15}/> : <Send size={15}/>}Reply</button></div></form></>
        : <div className="support-thread-empty"><MessageCircle size={30}/><h2>{tickets.length ? "Open a ticket" : "How can we help?"}</h2><p>Select a ticket to read the conversation, or create a new one to contact support.</p><button className="secondary" onClick={() => setComposing(true)}><Plus size={15}/>Create a ticket</button></div>}
      </main>
    </div>
  </section>;
}
