import Link from "next/link";
import { ArrowRight, BookOpen, Check, Flame, ShieldCheck, Workflow } from "lucide-react";
import MarketingActions from "@/components/MarketingActions";
import { SiteLogo, SiteName } from "@/components/SiteBranding";
import "../landing.css";
import "../marketing-nav.css";

export const metadata = { title: "About AgentForge", description: "Learn how AgentForge turns team knowledge into grounded, inspectable AI support conversations." };

export default function AboutPage() {
  return <main className="marketing">
    <header className="marketing-nav"><Link href="/" className="marketing-logo"><SiteLogo className="marketing-logo-img" fallback={<span className="marketing-logo-mark"><Flame size={19}/></span>} alt=""/><SiteName period/></Link><nav className="marketing-links"><Link href="/">Home</Link><Link href="/plans">Plans</Link><Link href="/docs">Docs</Link></nav><MarketingActions /></header>
    <section className="about-hero"><span className="marketing-kicker">ABOUT AGENTFORGE</span><h1>Useful AI starts with trusted knowledge.</h1><p>AgentForge helps teams turn the information they already maintain into support agents that can answer questions, show their sources, and hand off to connected workflows when a conversation needs more than a document search.</p><div className="marketing-hero-actions"><Link className="marketing-btn primary" href="/agents">Build an agent <ArrowRight size={15}/></Link><Link className="marketing-btn secondary" href="/">Back to home</Link></div></section>
    <section className="about-values">{[[<BookOpen size={18}/> ,"Grounded in your sources","Answers are based on the knowledge connected to an agent, with citations so people can inspect the evidence."],[<Workflow size={18}/> ,"Built for real support flows","Visual workflow blocks handle routing, visitor questions, conditions, API calls, and knowledge search."],[<ShieldCheck size={18}/> ,"Designed for clear control","Each workspace owns its agents and data. Owners can review activity and decide how agents are published."]].map(([icon,title,copy]:any)=><article key={title}><span className="marketing-feature-icon">{icon}</span><h2>{title}</h2><p>{copy}</p></article>)}</section>
    <section className="marketing-cta"><div><h2>Start with one agent and grow from there.</h2><p>Bring a knowledge source and see what your assistant can answer.</p></div><Link className="marketing-btn primary" href="/agents">Open your workspace <ArrowRight size={15}/></Link></section>
    <footer className="marketing-footer"><div className="marketing-footer-inner"><span>© {new Date().getFullYear()} <SiteName/></span><div className="marketing-footer-links"><Link href="/">Home</Link><Link href="/plans">Plans</Link><Link href="/docs">Docs</Link><Link href="/faqs">FAQs</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/agents">Workspace</Link></div></div></footer>
  </main>;
}
