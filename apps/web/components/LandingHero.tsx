"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AntigravityCanvas from "@/components/AntigravityCanvas";

export default function LandingHero() {
  return <section className="marketing-hero">
    <AntigravityCanvas pulse={0}/>
    <div className="hero-grid-lines" aria-hidden="true"/><div className="hero-vignette" aria-hidden="true"/>
    <div className="hero-stage">
      <h1>Turn your knowledge into<br/><em>better answers.</em></h1>
      <p className="hero-description">Build an AI support agent grounded in your content. Design its workflow, test it with real questions, and deploy it wherever your customers need help.</p>
      <div className="hero-actions"><Link className="hero-primary" href="/agents">Build your agent <ArrowRight size={17}/></Link></div>
    </div>
  </section>;
}
