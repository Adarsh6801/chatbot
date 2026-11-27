"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Flame, Search } from "lucide-react";
import MarketingActions from "@/components/MarketingActions";
import { SiteLogo, SiteName } from "@/components/SiteBranding";
import { DocumentationMarkdown } from "@/components/DocumentationMarkdown";
import { API } from "@/lib/api";
import "../app/landing.css";
import "../app/marketing-nav.css";
import "./site-pages.css";

type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  category: string;
  position: number;
};

type SitePagePayload = {
  slug: string;
  title: string;
  subtitle: string;
  content: string;
  updated_at: string;
  faqs?: FaqEntry[];
};

export default function PublicSitePageView({ slug }: { slug: "faqs" | "terms" | "privacy" }) {
  const [data, setData] = useState<SitePagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`${API}/api/v1/public/pages/${slug}`, { credentials: "omit", cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "This page is unavailable.");
        return body;
      })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err) => {
        if (active) setError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  const categories = useMemo(() => {
    const items = data?.faqs || [];
    return ["All", ...Array.from(new Set(items.map((f) => f.category || "General")))];
  }, [data?.faqs]);

  const filteredFaqs = useMemo(() => {
    const items = data?.faqs || [];
    const q = query.trim().toLowerCase();
    return items.filter((f) => {
      if (category !== "All" && (f.category || "General") !== category) return false;
      if (!q) return true;
      return (
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        (f.category || "").toLowerCase().includes(q)
      );
    });
  }, [data?.faqs, category, query]);

  return (
    <main className="marketing">
      <header className="marketing-nav">
        <Link href="/" className="marketing-logo">
          <SiteLogo className="marketing-logo-img" fallback={<span className="marketing-logo-mark"><Flame size={19} /></span>} alt="" />
          <SiteName period />
        </Link>
        <nav className="marketing-links" aria-label="Main navigation">
          <Link href="/">Home</Link>
          <Link href="/plans">Plans</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/faqs">FAQs</Link>
        </nav>
        <MarketingActions />
      </header>

      <section className="site-page-hero">
        <span className="marketing-kicker">
          {slug === "faqs" ? "HELP & ANSWERS" : slug === "terms" ? "LEGAL AGREEMENT" : "PRIVACY & TRUST"}
        </span>
        <h1>{data?.title || (slug === "faqs" ? "Frequently Asked Questions" : slug === "terms" ? "Terms & Conditions" : "Privacy Policy")}</h1>
        <p>{data?.subtitle || "Loading page details…"}</p>
        {data?.updated_at && (
          <div className="site-page-meta">
            <span>Last updated {new Date(data.updated_at).toLocaleDateString([], { dateStyle: "long" })}</span>
          </div>
        )}
      </section>

      <section className="site-page-wrap">
        {loading ? (
          <div className="site-page-state">Loading page…</div>
        ) : error || !data ? (
          <div className="site-page-state">{error || "This page is currently unavailable."}</div>
        ) : slug === "faqs" ? (
          <>
            {data.content && (
              <div className="site-page-card" style={{ padding: "18px 22px" }}>
                <DocumentationMarkdown content={data.content} />
              </div>
            )}

            <div className="faq-controls">
              <label className="faq-search" aria-label="Search FAQs">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search questions, features, or API answers…"
                />
              </label>
              <div className="faq-categories">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`faq-cat-btn ${category === cat ? "active" : ""}`}
                    onClick={() => setCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="faq-list">
              {filteredFaqs.length ? (
                filteredFaqs.map((faq, idx) => (
                  <details className="faq-item" key={faq.id} open={idx === 0 && !query}>
                    <summary>
                      <div>
                        <span>{faq.question}</span>
                        <span className="faq-cat-tag">{faq.category}</span>
                      </div>
                      <ChevronDown size={18} className="faq-chevron" />
                    </summary>
                    <div className="faq-answer">{faq.answer}</div>
                  </details>
                ))
              ) : (
                <div className="site-page-state">No FAQs match your search filter.</div>
              )}
            </div>
          </>
        ) : (
          <article className="site-page-card">
            <DocumentationMarkdown content={data.content} />
          </article>
        )}
      </section>

      <footer className="marketing-footer">
        <div className="marketing-footer-inner">
          <span>© {new Date().getFullYear()} <SiteName /></span>
          <div className="marketing-footer-links">
            <Link href="/about">About</Link>
            <Link href="/plans">Plans</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/faqs">FAQs</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/agents">Workspace</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
