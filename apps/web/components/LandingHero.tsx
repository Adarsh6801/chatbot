"use client";

import { Fragment, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AntigravityCanvas, { type WaveRipple } from "@/components/AntigravityCanvas";

type WordBody = {
  el: HTMLElement;
  homeX: number;
  homeY: number;
  isHeadline: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  scale: number;
  vscale: number;
};

function WaveWords({ text, headline = false }: { text: string; headline?: boolean }) {
  const words = text.split(" ");
  const className = headline ? "hero-wave-word is-headline" : "hero-wave-word";
  return (
    <>
      {words.map((word, idx) => (
        <Fragment key={`${idx}-${word}`}>
          {idx > 0 ? " " : null}
          <span className={className}>{word}</span>
        </Fragment>
      ))}
    </>
  );
}

export default function LandingHero() {
  const heroRef = useRef<HTMLElement>(null);
  const wordsRef = useRef<WordBody[]>([]);
  const hasMotionRef = useRef(false);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    let cancelled = false;
    wordsRef.current = Array.from(hero.querySelectorAll<HTMLElement>(".hero-wave-word")).map((el) => ({
      el,
      homeX: 0,
      homeY: 0,
      isHeadline: el.classList.contains("is-headline"),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      rot: 0,
      vrot: 0,
      scale: 1,
      vscale: 0,
    }));

    const measure = () => {
      if (cancelled) return;
      const heroRect = hero.getBoundingClientRect();
      for (const w of wordsRef.current) {
        const prev = w.el.style.transform;
        if (prev) w.el.style.transform = "";
        const rect = w.el.getBoundingClientRect();
        w.homeX = rect.left - heroRect.left + rect.width / 2;
        w.homeY = rect.top - heroRect.top + rect.height / 2;
        if (prev) w.el.style.transform = prev;
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(hero);
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", measure);
      for (const w of wordsRef.current) {
        w.el.style.transform = "";
      }
      wordsRef.current = [];
    };
  }, []);

  const handleWaveFrame = useCallback((ripples: ReadonlyArray<WaveRipple>, dt: number) => {
    if (!ripples.length && !hasMotionRef.current) return;
    const words = wordsRef.current;
    if (!words.length) return;

    let stillMoving = ripples.length > 0;
    const damp = Math.pow(0.8, dt);
    const stiffness = 0.11;

    for (const w of words) {
      let ax = -w.x * stiffness;
      let ay = -w.y * stiffness;
      let arot = -w.rot * stiffness;
      let ascale = (1 - w.scale) * stiffness;

      for (const wave of ripples) {
        const fade = Math.max(0, 1 - wave.age / 1000);
        if (fade <= 0) continue;
        const dx = w.homeX - wave.x;
        const dy = w.homeY - wave.y;
        const dist = Math.hypot(dx, dy);
        const bandWidth = w.isHeadline ? 56 : 44;
        const band = Math.exp(-Math.pow((dist - wave.radius) / bandWidth, 2)) * fade;
        if (band < 0.005) continue;

        const push = w.isHeadline ? 1.15 : 0.85;
        const lift = w.isHeadline ? 1.75 : 1.15;
        if (dist >= 8) {
          const nx = dx / dist;
          const ny = dy / dist;
          ax += nx * band * push;
          ay += ny * band * push * 0.7;
          arot += nx * band * (w.isHeadline ? 0.8 : 0.55);
        }
        ay -= band * lift;
        ascale += band * (w.isHeadline ? 0.014 : 0.01);
      }

      w.vx = (w.vx + ax * dt) * damp;
      w.vy = (w.vy + ay * dt) * damp;
      w.vrot = (w.vrot + arot * dt) * damp;
      w.vscale = (w.vscale + ascale * dt) * damp;

      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.rot += w.vrot * dt;
      w.scale += w.vscale * dt;

      if (
        Math.abs(w.x) > 0.04 ||
        Math.abs(w.y) > 0.04 ||
        Math.abs(w.rot) > 0.02 ||
        Math.abs(w.scale - 1) > 0.001 ||
        Math.abs(w.vx) > 0.04 ||
        Math.abs(w.vy) > 0.04
      ) {
        stillMoving = true;
      }
    }

    if (stillMoving) {
      hasMotionRef.current = true;
      for (const w of words) {
        w.el.style.transform = `translate3d(${w.x.toFixed(2)}px, ${w.y.toFixed(2)}px, 0) rotate(${w.rot.toFixed(2)}deg) scale(${w.scale.toFixed(4)})`;
      }
    } else {
      hasMotionRef.current = false;
      for (const w of words) {
        w.x = 0; w.y = 0; w.vx = 0; w.vy = 0;
        w.rot = 0; w.vrot = 0; w.scale = 1; w.vscale = 0;
        if (w.el.style.transform) w.el.style.transform = "";
      }
    }
  }, []);

  return <section ref={heroRef} className="marketing-hero">
    <AntigravityCanvas pulse={0} onWaveFrame={handleWaveFrame}/>
    <div className="hero-grid-lines" aria-hidden="true"/><div className="hero-vignette" aria-hidden="true"/>
    <div className="hero-stage">
      <h1><WaveWords text="Turn your knowledge into" headline/><br/><em><WaveWords text="better answers." headline/></em></h1>
      <p className="hero-description"><WaveWords text="Build an AI support agent grounded in your content. Design its workflow, test it with real questions, and deploy it wherever your customers need help."/></p>
      <div className="hero-actions"><Link className="hero-primary" href="/agents">Build your agent <ArrowRight size={17}/></Link></div>
    </div>
  </section>;
}
