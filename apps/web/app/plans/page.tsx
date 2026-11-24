import Link from "next/link";
import { ArrowRight, Check, Flame } from "lucide-react";
import MarketingActions from "@/components/MarketingActions";
import { SiteLogo, SiteName } from "@/components/SiteBranding";
import "../landing.css";
import "../marketing-nav.css";

export default function PlansPage() {
  const plans = [
    {name:"Free", price:"$0", agents:"1 agent", sources:"10 knowledge sources", messages:"100 messages/month"},
    {name:"Pro", price:"Monthly plan", agents:"10 agents", sources:"100 knowledge sources", messages:"5,000 messages/month"},
    {name:"Team", price:"Monthly plan", agents:"50 agents", sources:"500 knowledge sources", messages:"25,000 messages/month"},
  ];
  return <main className="marketing"><header className="marketing-nav"><Link href="/" className="marketing-logo"><SiteLogo className="marketing-logo-img" fallback={<span className="marketing-logo-mark"><Flame size={19}/></span>} alt=""/><SiteName period/></Link><nav className="marketing-links"><Link href="/">Home</Link><Link href="/about">About</Link></nav><MarketingActions /></header><section className="marketing-section"><div className="marketing-inner"><div className="marketing-section-heading"><span className="marketing-kicker">PLANS THAT GROW WITH YOUR WORKSPACE</span><h2>Start free. Upgrade when you’re ready.</h2><p>Try a grounded support agent on the Free plan. Paid plan prices are shown by the configured checkout provider.</p></div><div className="marketing-feature-grid">{plans.map((plan,i)=><article className="marketing-feature" key={plan.name}><span className="marketing-kicker">{i===1?"POPULAR PLAN":i===2?"FOR TEAMS":"GET STARTED"}</span><h3 style={{fontSize:24,marginTop:14}}>{plan.name}</h3><strong style={{display:"block",fontSize:19,marginBottom:16}}>{plan.price}</strong><ul style={{listStyle:"none",padding:0,display:"grid",gap:12,color:"#65705f",fontSize:13}}>{[plan.agents,plan.sources,plan.messages,"Citations, analytics & website widget"].map(item=><li key={item} style={{display:"flex",alignItems:"center",gap:8}}><Check size={15} color="#71913c"/>{item}</li>)}</ul><Link className="marketing-btn primary" style={{width:"100%",marginTop:22}} href="/agents">{i===0?"Create a free account":"View plan options"}<ArrowRight size={15}/></Link></article>)}</div></div></section><footer className="marketing-footer"><div className="marketing-footer-inner"><span>© {new Date().getFullYear()} <SiteName/></span><div className="marketing-footer-links"><Link href="/about">About</Link><Link href="/">Home</Link><Link href="/agents">Workspace</Link></div></div></footer></main>;
}
