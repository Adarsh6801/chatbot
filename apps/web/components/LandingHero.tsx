"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import AntigravityCanvas from "@/components/AntigravityCanvas";

export default function LandingHero() {
  const [pulse, setPulse] = useState(0);
  return <section className="marketing-hero">
    <AntigravityCanvas pulse={pulse}/>
    <div className="hero-grid-lines" aria-hidden="true"/><div className="hero-vignette" aria-hidden="true"/>
    <div className="hero-stage">
      <div className="hero-status-pill"><i/><span>MOVE TO GATHER SPARKS</span><b>INTERACTIVE</b></div>
      <h1>Turn your knowledge into<br/><em>better answers.</em></h1>
      <p className="hero-description">Build an AI support agent grounded in your content. Design its workflow, test it with real questions, and deploy it wherever your customers need help.</p>
      <div className="hero-actions"><Link className="hero-primary" href="/agents">Build your agent <ArrowRight size={17}/></Link><button className="hero-secondary" type="button" onClick={() => setPulse((n) => n + 1)}><Zap size={15}/>Trigger pulse</button></div>
    </div>
  </section>;
}
