"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSiteBranding, SiteLogo, SiteName } from '@/components/SiteBranding';
import { API } from '@/lib/api';
import { documentationHeadingId, DocumentationMarkdown } from '@/components/DocumentationMarkdown';
import { ArrowLeft, ArrowRight, BookOpen, Search } from 'lucide-react';
import './documentation.css';

type DocPage = {id:string;title:string;slug:string;summary:string;position:number;updated_at?:string};
type DocCategory = {id:string;title:string;slug:string;description:string;pages:DocPage[]};
type FullDocPage = DocPage & {content:string;category?:{title:string;slug:string}|null};

export default function DocumentationCenter({slug}:{slug?:string}) {
  const {name}=useSiteBranding();
  const [categories,setCategories]=useState<DocCategory[]>([]);
  const [article,setArticle]=useState<FullDocPage|null>(null);
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setLoading(true);
    const timer=window.setTimeout(()=>{
      const query=new URLSearchParams();if(search.trim())query.set('q',search.trim());
      const suffix=query.toString();
      fetch(`${API}/api/v1/public/docs${suffix?'?'+suffix:''}`,{credentials:'omit',cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Documentation is unavailable right now.');return response.json();})
        .then(data=>{if(active){setCategories(data.categories||[]);setError('');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    },180);
    return()=>{active=false;window.clearTimeout(timer);};
  },[search]);
  const firstSlug=categories[0]?.pages?.[0]?.slug;
  const activeSlug=slug||firstSlug;
  useEffect(()=>{
    if(!activeSlug)return;
    let active=true;setArticle(null);setError('');
    fetch(`${API}/api/v1/public/docs/${encodeURIComponent(activeSlug)}`,{credentials:'omit'}).then(async response=>{if(!response.ok)throw new Error('This documentation page could not be found.');return response.json();})
      .then(data=>{if(active)setArticle(data);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[activeSlug]);
  const filtered=categories;
  const headings=useMemo(()=>article?.content.split(/\r?\n/).map(line=>line.match(/^#{2,3}\s+(.+)$/)?.[1]).filter((heading):heading is string=>!!heading)||[],[article?.content]);
  return <main className="documentation-shell">
    <header className="documentation-topbar"><Link href="/" className="documentation-brand"><SiteLogo fallback={<span className="documentation-logo"><BookOpen size={17}/></span>} className="documentation-logo-img"/><span><SiteName/> <small>Documentation</small></span></Link><div className="documentation-top-actions"><Link href="/">Home</Link><Link href="/api-docs">API reference</Link><Link className="documentation-workspace" href="/agents">Open workspace <ArrowRight size={14}/></Link></div></header>
    <div className="documentation-frame">
      <aside className="documentation-sidebar"><div className="documentation-sidebar-title">GUIDES</div><label className="documentation-search"><Search size={15}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search docs" aria-label="Search documentation"/></label><Link href="/docs" className={`documentation-overview ${!slug?'selected':''}`}><BookOpen size={15}/>Overview</Link>{loading?<p className="documentation-sidebar-state">Loading sections…</p>:filtered.map(category=><section className="documentation-nav-section" key={category.id}><h2>{category.title}</h2>{category.pages.map(page=><Link key={page.id} className={activeSlug===page.slug?'active':''} href={`/docs/${page.slug}`}>{page.title}</Link>)}</section>)}{!loading&&!filtered.length&&<p className="documentation-sidebar-state">No pages match that search.</p>}</aside>
      <article className="documentation-article">{error?<div className="documentation-error"><h1>Documentation unavailable</h1><p>{error}</p><Link href="/docs"><ArrowLeft size={14}/> Back to documentation</Link></div>:loading||!activeSlug?<div className="documentation-loading">Loading documentation…</div>:article?<><div className="documentation-breadcrumb"><Link href="/docs">Docs</Link><span>/</span><span>{article.category?.title||'Guide'}</span></div><div className="documentation-category-label">{article.category?.title||'GUIDE'}</div><h1>{article.title}</h1><p className="documentation-summary">{article.summary}</p><DocumentationMarkdown content={article.content}/><footer className="documentation-article-footer"><span>Was this page helpful?</span><Link href="/support">Contact support <ArrowRight size={14}/></Link></footer></>:<div className="documentation-loading">Loading article…</div>}</article>
      <aside className="documentation-toc"><strong>On this page</strong>{headings.length?headings.map(heading=><a key={heading} href={`#${documentationHeadingId(heading)}`}>{heading}</a>):<span className="documentation-toc-empty">Choose a topic from the guide index.</span>}<div className="documentation-toc-help"><strong>Need help?</strong><p>Contact support from your workspace.</p><Link href="/support">Open support <ArrowRight size={13}/></Link></div></aside>
    </div>
    <footer className="documentation-site-footer"><span>© {new Date().getFullYear()} {name}</span><Link href="/plans">Plans</Link><Link href="/support">Support</Link></footer>
  </main>;
}
