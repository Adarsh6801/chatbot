"use client";

import { useEffect, useRef } from "react";

type Particle = { x: number; y: number; homeX: number; homeY: number; vx: number; vy: number; angle: number; spin: number; size: number; color: string; alpha: number; phase: number; stiffness: number; damping: number; scale: number };

export default function AntigravityCanvas({ pulse }: { pulse: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef(pulse);
  useEffect(() => { if (pulse > pulseRef.current) window.dispatchEvent(new CustomEvent("agentforge:canvas-pulse")); pulseRef.current = pulse; }, [pulse]);

  useEffect(() => {
    const surface = canvas.current; const stage = surface?.parentElement;
    const ctx = surface?.getContext("2d", { alpha: true });
    if (!surface || !stage || !ctx) return;
    const palette = ["#273b2c", "#819554", "#a6c86a", "#75923e", "#c9d2b8", "#5f7b40"];
    const particles: Particle[] = [];
    const ripples: { x: number; y: number; radius: number; age: number }[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0; let height = 0; let dpr = 1; let frame = 0; let last = 0; let pointerX = -3000; let pointerY = -3000; let pointerActive = false;

    const addParticle = (x: number, y: number, homeX = x, homeY = y) => particles.push({ x, y, homeX, homeY, vx: 0, vy: 0, angle: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * .014, size: 2.2 + Math.random() * 4.2, color: palette[Math.floor(Math.random() * palette.length)], alpha: .42 + Math.random() * .48, phase: Math.random() * Math.PI * 2, stiffness: .035 + Math.random() * .015, damping: .86 + Math.random() * .04, scale: 1 });
    const seed = (count: number) => {
      particles.length = 0;
      const cols = Math.ceil(Math.sqrt(count * width / Math.max(height, 1))); const rows = Math.ceil(count / cols); const cw = width / cols; const ch = height / rows;
      for (let i = 0; i < count; i++) { const x = ((i % cols) + .15 + Math.random() * .7) * cw; const y = (Math.floor(i / cols) + .15 + Math.random() * .7) * ch; addParticle(x, y, x, y); }
    };
    const resize = () => {
      const oldW = width || stage.clientWidth; const oldH = height || stage.clientHeight;
      const rect = stage.getBoundingClientRect(); width = rect.width; height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2); surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!particles.length || !oldW || !oldH) seed(1000);
      else { const sx = width / oldW; const sy = height / oldH; for (const p of particles) { p.x *= sx; p.y *= sy; p.homeX *= sx; p.homeY *= sy; p.vx *= sx; p.vy *= sy; } }
      ctx.clearRect(0, 0, width, height);
    };
    const drawShape = (p: Particle, force: number) => {
      const s = p.size * p.scale;
      ctx!.save(); ctx!.translate(p.x, p.y); ctx!.rotate(p.angle); ctx!.globalAlpha = Math.min(.82, p.alpha * force); ctx!.fillStyle = p.color; ctx!.strokeStyle = p.color;
      // One consistent AgentForge spark glyph gives the field a deliberate, branded rhythm.
      ctx!.beginPath(); ctx!.moveTo(0, -s); ctx!.quadraticCurveTo(s * .12, -s * .12, s, 0); ctx!.quadraticCurveTo(s * .12, s * .12, 0, s); ctx!.quadraticCurveTo(-s * .12, s * .12, -s, 0); ctx!.quadraticCurveTo(-s * .12, -s * .12, 0, -s); ctx!.closePath(); ctx!.fill();
      ctx!.restore();
    };
    const tick = (time: number, animate: boolean) => {
      ctx!.clearRect(0, 0, width, height); const dt = animate ? Math.min(2, Math.max(.5, last ? (time - last) / 16.67 : 1)) : 0; last = time;
      for (const p of particles) {
        const driftX = Math.sin(time * .0007 + p.phase) * 6; const driftY = Math.cos(time * .0006 + p.phase * 1.37) * 8;
        let ax = (p.homeX + driftX - p.x) * p.stiffness; let ay = (p.homeY + driftY - p.y) * p.stiffness; let force = 0;
        const dx = p.x - pointerX; const dy = p.y - pointerY; const dist = Math.hypot(dx, dy) || 1; const falloff = Math.max(0, 1 - dist / 245);
        if (pointerActive && falloff > 0) {
          force = falloff * falloff; const nx = dx / dist; const ny = dy / dist;
          // Draw only near the pointer and pull these tiny marks into its wake.
          ax -= nx * force * 0.22; ay -= ny * force * 0.22;
          const target = Math.atan2(ny, nx) + Math.PI / 2; let diff = ((target - p.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI; p.angle += diff * .13 * dt;
        }
        for (const wave of ripples) { const ddx = p.x - wave.x; const ddy = p.y - wave.y; const radius = Math.hypot(ddx, ddy) || 1; const band = Math.exp(-Math.pow((radius - wave.radius) / 36, 2)) * Math.max(0, 1 - wave.age / 1000); ax += ddx / radius * band * 2.8; ay += ddy / radius * band * 2.8; }
        p.vx = (p.vx + ax * dt) * Math.pow(p.damping, dt); p.vy = (p.vy + ay * dt) * Math.pow(p.damping, dt); p.x += p.vx * dt; p.y += p.vy * dt;
        if (!pointerActive || falloff <= 0) p.angle += p.spin * dt;
        const scaleTarget = 1 + falloff * .28; p.scale += (scaleTarget - p.scale) * .15 * dt;
        if (pointerActive && falloff > .035) drawShape(p, .16 + falloff * .8);
      }
      for (const wave of ripples) { wave.radius += 5.2 * dt; wave.age += 16.67 * dt; }
      while (ripples.length && (ripples[0].radius > Math.max(width, height) * .62 || ripples[0].age > 1200)) ripples.shift();
      if (animate) frame = requestAnimationFrame((next) => tick(next, true));
    };
    const pos = (event: PointerEvent | MouseEvent) => { const rect = stage!.getBoundingClientRect(); pointerX = event.clientX - rect.left; pointerY = event.clientY - rect.top; };
    const move = (event: PointerEvent) => { pointerActive = true; pos(event); };
    const leave = () => { pointerActive = false; pointerX = pointerY = -3000; };
    const pulse = () => ripples.push({ x: width / 2, y: height / 2, radius: 0, age: 0 });
    const click = (event: MouseEvent) => { const target = event.target as HTMLElement; if (target.closest("a,button")) return; const rect = stage!.getBoundingClientRect(); ripples.push({ x: event.clientX - rect.left, y: event.clientY - rect.top, radius: 0, age: 0 }); };
    const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else if (!reducedMotion && !frame) frame = requestAnimationFrame((time) => tick(time, true)); };
    resize(); if (!reducedMotion) frame = requestAnimationFrame((time) => tick(time, true));
    const observer = new ResizeObserver(resize); observer.observe(stage);
    stage.addEventListener("pointermove", move, { passive: true }); stage.addEventListener("pointerleave", leave); stage.addEventListener("click", click);
    window.addEventListener("agentforge:canvas-pulse", pulse); document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerleave", leave); stage.removeEventListener("click", click); window.removeEventListener("agentforge:canvas-pulse", pulse); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  return <canvas ref={canvas} className="antigravity-canvas" aria-hidden="true"/>;
}
