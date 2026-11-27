import Link from "next/link";
import { Activity, ArrowRight, BookOpen, Bot, Flame, MessageSquareText, ShieldCheck, Workflow } from "lucide-react";
import AntigravityLayer from "@/components/AntigravityLayer";
import MarketingActions from "@/components/MarketingActions";
import LandingHero from "@/components/LandingHero";
import { SiteLogo, SiteName } from "@/components/SiteBranding";
import "./landing.css";
import "./marketing-nav.css";
import "./antigravity.css";

export const metadata = { title: "AgentForge — AI support grounded in your knowledge", description: "Build a support agent from your documents, design its workflow, and launch cited answers on your website." };

const features = [
  { icon: <BookOpen size={18}/>, title: "Connect your knowledge", copy: "Upload readable PDFs, documents, and text or import public web pages. Sources are indexed for search." },
  { icon: <Workflow size={18}/>, title: "Design a conversation flow", copy: "Route questions, collect visitor details, check conditions, call your public APIs, and search your knowledge." },
  { icon: <ShieldCheck size={18}/>, title: "See evidence and improve", copy: "Inspect source citations, review conversations, and improve content when the agent cannot answer confidently." },
  { icon: <Activity size={18}/>, title: "Measure what happens", copy: "Review conversations, usage, retrieval checks, and signals from real visitor questions." },
  { icon: <Bot size={18}/>, title: "Publish where customers are", copy: "Test in the playground, then publish and embed the agent on your website." },
  { icon: <MessageSquareText size={18}/>, title: "Keep control in your hands", copy: "Manage each agent’s settings, deployment, plans, and workspace data from dedicated pages." },
];

export default function LandingPage() {
  return <AntigravityLayer><main className="marketing">
    <header className="marketing-nav">
      <Link href="/" className="marketing-logo"><SiteLogo className="marketing-logo-img" fallback={<span className="marketing-logo-mark"><Flame size={19}/></span>} alt=""/><SiteName period/></Link>
      <nav className="marketing-links" aria-label="Main navigation"><a href="#features">Features</a><Link href="/plans">Plans</Link><Link href="/about">About</Link><Link href="/docs">Docs</Link></nav>
      <MarketingActions />
    </header>

    <LandingHero />

    <section className="marketing-section alt" id="features"><div className="marketing-inner"><div className="marketing-section-heading"><span className="marketing-kicker">ONE WORKSPACE, END TO END</span><h2>Everything you need to build a helpful agent</h2><p>Keep the knowledge, conversations, and controls for each agent together in a workspace designed for the whole support lifecycle.</p></div><div className="marketing-feature-grid">{features.map((feature)=><article className="marketing-feature" data-tilt key={feature.title}><span className="marketing-feature-icon">{feature.icon}</span><h3>{feature.title}</h3><p>{feature.copy}</p><span className="feature-index">0{features.indexOf(feature)+1}</span></article>)}</div></div></section>

    <section className="marketing-section"><div className="marketing-inner"><div className="marketing-section-heading"><span className="marketing-kicker">A SIMPLE PATH TO LAUNCH</span><h2>From your documents to a live assistant</h2><p>Build a grounded agent in a few clear steps. Start simple and add workflow logic when you need it.</p></div><div className="marketing-steps"><article className="marketing-step"><span>01 / ADD SOURCES</span><h3>Bring your knowledge</h3><p>Upload support guides, policies, product documentation, or other text-based sources.</p></article><article className="marketing-step"><span>02 / SHAPE ANSWERS</span><h3>Test and guide behavior</h3><p>Use the playground and visual workflow to tune routing, messages, and actions.</p></article><article className="marketing-step"><span>03 / GO LIVE</span><h3>Publish and learn</h3><p>Embed the agent, review conversations, and refine your knowledge from real questions.</p></article></div></div></section>

    <section className="marketing-cta"><div><span className="marketing-kicker">YOUR KNOWLEDGE, READY TO HELP</span><h2>Make every answer useful and easy to trust.</h2><p>Create an agent, add a source, and try a grounded answer.</p></div><Link className="marketing-btn primary" data-magnetic href="/agents">Open your workspace <ArrowRight size={15}/></Link></section>
    <footer className="marketing-footer"><div className="marketing-footer-inner"><span>© {new Date().getFullYear()} <SiteName/></span><div className="marketing-footer-links"><Link href="/about">About</Link><Link href="/plans">Plans</Link><Link href="/docs">Docs</Link><Link href="/faqs">FAQs</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/agents">Workspace</Link></div></div></footer>
  </main></AntigravityLayer>;
}
