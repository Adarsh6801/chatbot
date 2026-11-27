"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, Edit3, Eye, FileText, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import "./pages-admin.css";

type ConfirmSpec = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  run: () => Promise<void>;
};

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function renderMarkdownPreview(content: string) {
  const blocks = (content || "").split(/\n\n+/);
  return blocks.map((block, idx) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("## ")) return <h2 key={idx}>{trimmed.slice(3)}</h2>;
    if (trimmed.startsWith("### ")) return <h3 key={idx}>{trimmed.slice(4)}</h3>;
    const lines = trimmed.split("\n");
    if (lines.every((l) => l.trim().startsWith("- "))) {
      return (
        <ul key={idx}>
          {lines.map((l, li) => (
            <li key={li}>{l.trim().slice(2)}</li>
          ))}
        </ul>
      );
    }
    return <p key={idx}>{trimmed}</p>;
  });
}

export default function PagesAdmin({ refreshToken }: { refreshToken: number }) {
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [viewedSlug, setViewedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingPage, setEditingPage] = useState(false);
  const [pageForm, setPageForm] = useState({ title: "", subtitle: "", content: "", status: "published" });

  // FAQ add / edit state
  const [addingFaq, setAddingFaq] = useState(false);
  const [newFaq, setNewFaq] = useState({ question: "", answer: "", category: "General", position: 10, published: true });
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [editingFaqForm, setEditingFaqForm] = useState({ question: "", answer: "", category: "General", position: 0, published: true });

  const [saving, setSaving] = useState(false);
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<{ items: any[] }>("/admin/pages");
      setPages(res.items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (slug: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const res = await api<any>(`/admin/pages/${encodeURIComponent(slug)}`);
      setDetail(res);
      setPageForm({
        title: res.title || "",
        subtitle: res.subtitle || "",
        content: res.content || "",
        status: res.status || "published",
      });
      setNewFaq((curr) => ({ ...curr, position: (res.faqs?.length || 0) + 1 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshToken]);

  useEffect(() => {
    if (!viewedSlug) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [viewedSlug]);

  function openPageView(slug: string) {
    setViewedSlug(slug);
    setEditingPage(false);
    setAddingFaq(false);
    setEditingFaqId(null);
    setNotice("");
    void loadDetail(slug);
  }

  async function runConfirmed() {
    if (!confirmSpec || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await confirmSpec.run();
      setConfirmSpec(null);
      await loadList();
      if (viewedSlug) await loadDetail(viewedSlug);
    } catch (e) {
      setError((e as Error).message);
      setConfirmSpec(null);
    } finally {
      setSaving(false);
    }
  }

  function requestSavePage(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setConfirmSpec({
      title: `Save changes to “${pageForm.title.trim()}”?`,
      description: "Updates the public website page immediately and records an admin audit entry.",
      confirmLabel: "Save page",
      run: async () => {
        await api(`/admin/pages/${detail.slug}`, {
          method: "PATCH",
          body: JSON.stringify(pageForm),
        });
        setEditingPage(false);
        setNotice(`Saved “${pageForm.title.trim()}”.`);
      },
    });
  }

  function requestAddFaq(e: FormEvent) {
    e.preventDefault();
    setConfirmSpec({
      title: "Add this FAQ item?",
      description: "Adds the new Q&A entry to the public FAQs page.",
      confirmLabel: "Add FAQ",
      run: async () => {
        await api("/admin/pages/faqs/items", {
          method: "POST",
          body: JSON.stringify(newFaq),
        });
        setAddingFaq(false);
        setNewFaq({ question: "", answer: "", category: "General", position: (detail?.faqs?.length || 0) + 2, published: true });
        setNotice("New FAQ added and published.");
      },
    });
  }

  function requestEditFaq(faqId: string) {
    setConfirmSpec({
      title: "Update this FAQ item?",
      description: "Saves changes to the question, answer, category, or visibility.",
      confirmLabel: "Save FAQ",
      run: async () => {
        await api(`/admin/pages/faqs/items/${faqId}`, {
          method: "PATCH",
          body: JSON.stringify(editingFaqForm),
        });
        setEditingFaqId(null);
        setNotice("FAQ item updated.");
      },
    });
  }

  function requestDeleteFaq(faq: any) {
    setConfirmSpec({
      title: "Delete this FAQ item?",
      description: `Removes “${faq.question}” permanently from the FAQs page.`,
      confirmLabel: "Delete FAQ",
      tone: "danger",
      run: async () => {
        await api(`/admin/pages/faqs/items/${faq.id}`, { method: "DELETE" });
        setNotice("FAQ deleted.");
      },
    });
  }

  return (
    <div className="pages-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLIC CONTENT MANAGEMENT</p>
          <h1>Pages</h1>
          <p className="subtle">
            View and edit your public FAQs, Terms &amp; Conditions, and Privacy Policy pages. Each page is served on its own dedicated website route.
          </p>
        </div>
      </div>

      {error && <div className="error-banner"><ShieldAlert size={16} />{error}<button onClick={() => setError("")}><X size={15} /></button></div>}
      {notice && !viewedSlug && <div className="error-banner" style={{ borderColor: "#cde9dd", background: "#f4fbf7", color: "#137759" }}><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}

      {loading ? (
        <div className="loading-card">Loading website pages…</div>
      ) : (
        <div className="panel table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PAGE</th>
                  <th>WEB ROUTE</th>
                  <th>DETAILS</th>
                  <th>STATUS</th>
                  <th>LAST UPDATED</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.slug}>
                    <td>
                      <strong>{p.title}</strong>
                      <small>{p.subtitle}</small>
                    </td>
                    <td className="mono">{p.route}</td>
                    <td>{p.slug === "faqs" ? `${p.faq_count ?? 0} FAQ entries` : "Markdown document"}</td>
                    <td><span className={`badge ${p.status === "published" ? "green" : "amber"}`}>{p.status}</span></td>
                    <td>{fmtDate(p.updated_at)}</td>
                    <td>
                      <button type="button" className="secondary" onClick={() => openPageView(p.slug)}>
                        <Eye size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewedSlug && (
        <div className="modal-backdrop pages-view-backdrop" onClick={() => { if (!confirmSpec && !saving) setViewedSlug(null); }}>
          <section className="pages-view-modal" role="dialog" aria-modal="true" aria-label="View page" onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <p className="eyebrow">WEBSITE PAGE · {detail?.route || `/${viewedSlug}`}</p>
                <h2>{detail?.title || "Loading page…"}</h2>
                {detail && <p className="subtle">{detail.subtitle}</p>}
              </div>
              <div className="pages-view-actions">
                {detail && (
                  <button type="button" className={editingPage ? "secondary" : "primary"} onClick={() => setEditingPage((v) => !v)}>
                    <Edit3 size={14} /> {editingPage ? "Back to preview" : "Edit page"}
                  </button>
                )}
                {detail?.slug === "faqs" && (
                  <button type="button" className="secondary" onClick={() => { setAddingFaq((v) => !v); setEditingPage(false); }}>
                    <Plus size={14} /> {addingFaq ? "Close FAQ form" : "Add new FAQ"}
                  </button>
                )}
                <button type="button" className="icon-button" aria-label="Close page viewer" onClick={() => setViewedSlug(null)}><X size={18} /></button>
              </div>
            </header>

            <div className="pages-view-body">
              <div className="pages-view-content">
                {notice && <div className="error-banner" style={{ marginBottom: 0, borderColor: "#cde9dd", background: "#f4fbf7", color: "#137759" }}><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}
                {error && <div className="error-banner" style={{ marginBottom: 0 }}><ShieldAlert size={16} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}

                {detailLoading || !detail ? (
                  <div className="loading-card">Loading page content…</div>
                ) : editingPage ? (
                  <form className="pages-form" onSubmit={requestSavePage}>
                    <div className="pages-two">
                      <label>Page title<input required maxLength={160} value={pageForm.title} onChange={(e) => setPageForm({ ...pageForm, title: e.target.value })} /></label>
                      <label>Status
                        <select value={pageForm.status} onChange={(e) => setPageForm({ ...pageForm, status: e.target.value })}>
                          <option value="published">Published (visible on website)</option>
                          <option value="draft">Draft (hidden from website)</option>
                        </select>
                      </label>
                    </div>
                    <label>Subtitle / intro line<input maxLength={500} value={pageForm.subtitle} onChange={(e) => setPageForm({ ...pageForm, subtitle: e.target.value })} /></label>
                    <label>
                      {detail.slug === "faqs" ? "FAQs intro text" : "Page content (supports ## headings, lists, bold, links)"}
                      <textarea rows={detail.slug === "faqs" ? 4 : 14} value={pageForm.content} onChange={(e) => setPageForm({ ...pageForm, content: e.target.value })} />
                    </label>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button type="button" className="secondary" onClick={() => setEditingPage(false)}>Cancel</button>
                      <button type="submit" className="primary" disabled={saving}>Save changes</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="pages-preview-card">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <FileText size={15} />
                          <strong>Public URL: <span className="mono">{detail.route}</span></strong>
                        </div>
                        <span className={`badge ${detail.status === "published" ? "green" : "amber"}`}>{detail.status}</span>
                      </div>
                      <div className="pages-preview-rendered">{renderMarkdownPreview(detail.content)}</div>
                    </div>

                    {detail.slug === "faqs" && (
                      <>
                        {addingFaq && (
                          <form className="pages-form" onSubmit={requestAddFaq}>
                            <h3 style={{ fontSize: 15, margin: 0 }}>Add a new FAQ</h3>
                            <div className="pages-two">
                              <label>Category<input required maxLength={80} value={newFaq.category} onChange={(e) => setNewFaq({ ...newFaq, category: e.target.value })} /></label>
                              <label>Display order<input type="number" min={0} max={9999} value={newFaq.position} onChange={(e) => setNewFaq({ ...newFaq, position: Number(e.target.value) })} /></label>
                            </div>
                            <label>Question<input required maxLength={500} value={newFaq.question} onChange={(e) => setNewFaq({ ...newFaq, question: e.target.value })} placeholder="e.g. How do I embed my bot in React or HTML?" /></label>
                            <label>Answer<textarea rows={4} required maxLength={10000} value={newFaq.answer} onChange={(e) => setNewFaq({ ...newFaq, answer: e.target.value })} /></label>
                            <label className="pages-check">
                              <input type="checkbox" checked={newFaq.published} onChange={(e) => setNewFaq({ ...newFaq, published: e.target.checked })} />
                              <span>Published immediately on `/faqs`</span>
                            </label>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                              <button type="button" className="secondary" onClick={() => setAddingFaq(false)}>Cancel</button>
                              <button type="submit" className="primary" disabled={saving}>Create FAQ</button>
                            </div>
                          </form>
                        )}

                        <div className="pages-faq-list">
                          {(detail.faqs || []).map((faq: any) => (
                            <article className="pages-faq-card" key={faq.id}>
                              <div className="pages-faq-head">
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <h3>{faq.question}</h3>
                                    <span className="badge amber">{faq.category}</span>
                                    <span className={`badge ${faq.published ? "green" : "gray"}`}>{faq.published ? "Published" : "Hidden"}</span>
                                  </div>
                                  <small className="subtle">Order #{faq.position} · Updated {fmtDate(faq.updated_at)}</small>
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => {
                                      if (editingFaqId === faq.id) setEditingFaqId(null);
                                      else {
                                        setEditingFaqId(faq.id);
                                        setEditingFaqForm({
                                          question: faq.question,
                                          answer: faq.answer,
                                          category: faq.category || "General",
                                          position: faq.position ?? 0,
                                          published: !!faq.published,
                                        });
                                      }
                                    }}
                                  >
                                    {editingFaqId === faq.id ? "Cancel" : "Edit"}
                                  </button>
                                  <button type="button" className="danger-outline" onClick={() => requestDeleteFaq(faq)}><Trash2 size={13} /></button>
                                </div>
                              </div>

                              {editingFaqId === faq.id ? (
                                <div className="pages-form" style={{ padding: 14 }}>
                                  <div className="pages-two">
                                    <label>Category<input value={editingFaqForm.category} onChange={(e) => setEditingFaqForm({ ...editingFaqForm, category: e.target.value })} maxLength={80} /></label>
                                    <label>Order<input type="number" min={0} max={9999} value={editingFaqForm.position} onChange={(e) => setEditingFaqForm({ ...editingFaqForm, position: Number(e.target.value) })} /></label>
                                  </div>
                                  <label>Question<input value={editingFaqForm.question} onChange={(e) => setEditingFaqForm({ ...editingFaqForm, question: e.target.value })} maxLength={500} /></label>
                                  <label>Answer<textarea rows={4} value={editingFaqForm.answer} onChange={(e) => setEditingFaqForm({ ...editingFaqForm, answer: e.target.value })} maxLength={10000} /></label>
                                  <label className="pages-check">
                                    <input type="checkbox" checked={editingFaqForm.published} onChange={(e) => setEditingFaqForm({ ...editingFaqForm, published: e.target.checked })} />
                                    <span>Published</span>
                                  </label>
                                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                                    <button type="button" className="secondary" onClick={() => setEditingFaqId(null)}>Cancel</button>
                                    <button type="button" className="primary" disabled={saving} onClick={() => requestEditFaq(faq.id)}>Save FAQ</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="pages-faq-answer">{faq.answer}</div>
                              )}
                            </article>
                          ))}
                          {!detail.faqs?.length && <div className="empty-state">No FAQs added yet. Click &ldquo;Add new FAQ&rdquo; above to create one.</div>}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          {confirmSpec && (
            <div className="pages-confirm-backdrop" onClick={() => { if (!saving) setConfirmSpec(null); }}>
              <section className="pages-confirm-card" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <h3>{confirmSpec.title}</h3>
                <p>{confirmSpec.description}</p>
                <div className="pages-confirm-actions">
                  <button type="button" className="secondary" disabled={saving} onClick={() => setConfirmSpec(null)}>Cancel</button>
                  <button type="button" className={confirmSpec.tone === "danger" ? "danger-solid" : "primary"} disabled={saving} onClick={() => void runConfirmed()}>
                    {saving ? "Applying…" : confirmSpec.confirmLabel}
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
