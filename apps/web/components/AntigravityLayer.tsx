"use client";

import { useEffect, useRef, type ReactNode } from "react";

type MotionItem = {
  element: HTMLElement;
  x: number;
  y: number;
  rx: number;
  ry: number;
  targetX: number;
  targetY: number;
  targetRx: number;
  targetRy: number;
};

export default function AntigravityLayer({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const cursorDot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    const follower = cursor.current;
    const dot = cursorDot.current;
    if (!host || !follower || !dot) return;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!finePointer || reducedMotion) return;

    const items: MotionItem[] = Array.from(host.querySelectorAll<HTMLElement>("[data-antigravity], [data-tilt], [data-magnetic]"))
      .map((element) => ({element,x:0,y:0,rx:0,ry:0,targetX:0,targetY:0,targetRx:0,targetRy:0}));
    let pointerX = -100;
    let pointerY = -100;
    let ringX = -100;
    let ringY = -100;
    let active = false;
    let frame = 0;

    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      active = true;
      host.classList.add("has-antigravity");
      const labelTarget = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-cursor-label]");
      follower.dataset.label = labelTarget?.dataset.cursorLabel || "";

      for (const item of items) {
        const bounds = item.element.getBoundingClientRect();
        const cx = bounds.left + bounds.width / 2;
        const cy = bounds.top + bounds.height / 2;
        const dx = pointerX - cx;
        const dy = pointerY - cy;
        const distance = Math.hypot(dx, dy) || 1;
        item.targetX = 0;
        item.targetY = 0;
        item.targetRx = 0;
        item.targetRy = 0;

        if (item.element.hasAttribute("data-antigravity") && distance < 170) {
          const force = (1 - distance / 170) * 19;
          item.targetX = (-dx / distance) * force;
          item.targetY = (-dy / distance) * force;
        }
        if (item.element.hasAttribute("data-tilt")) {
          item.targetRx = Math.max(-3.5, Math.min(3.5, (-dy / Math.max(bounds.height / 2, 1)) * 3.5));
          item.targetRy = Math.max(-3.5, Math.min(3.5, (dx / Math.max(bounds.width / 2, 1)) * 3.5));
        }
        if (item.element.hasAttribute("data-magnetic") && distance < 190) {
          const pull = Math.max(0, 1 - distance / 190) * 0.075;
          item.targetX = dx * pull;
          item.targetY = dy * pull;
        }
      }
    };
    const leave = () => {
      active = false;
      follower.dataset.label = "";
      for (const item of items) {
        item.targetX = 0; item.targetY = 0; item.targetRx = 0; item.targetRy = 0;
      }
    };
    const animate = () => {
      if (active) {
        ringX += (pointerX - ringX) * 0.16;
        ringY += (pointerY - ringY) * 0.16;
        follower.style.transform = `translate3d(${ringX}px,${ringY}px,0) translate(-50%,-50%)`;
        dot.style.transform = `translate3d(${pointerX}px,${pointerY}px,0) translate(-50%,-50%)`;
        follower.style.opacity = "1";
        dot.style.opacity = "1";
      } else {
        follower.style.opacity = "0";
        dot.style.opacity = "0";
        host.classList.remove("has-antigravity");
      }
      for (const item of items) {
        item.x += (item.targetX - item.x) * 0.085;
        item.y += (item.targetY - item.y) * 0.085;
        item.rx += (item.targetRx - item.rx) * 0.1;
        item.ry += (item.targetRy - item.ry) * 0.1;
        const style = item.element.style;
        style.setProperty("--ag-x", `${item.x.toFixed(2)}px`);
        style.setProperty("--ag-y", `${item.y.toFixed(2)}px`);
        style.setProperty("--ag-rx", `${item.rx.toFixed(2)}deg`);
        style.setProperty("--ag-ry", `${item.ry.toFixed(2)}deg`);
      }
      const stillMoving = active || items.some((item) => Math.abs(item.x-item.targetX)>0.08 || Math.abs(item.y-item.targetY)>0.08 || Math.abs(item.rx-item.targetRx)>0.08 || Math.abs(item.ry-item.targetRy)>0.08);
      frame = stillMoving ? window.requestAnimationFrame(animate) : 0;
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(animate); };

    host.addEventListener("pointermove", move, {passive:true});
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointermove", schedule, {passive:true});
    host.addEventListener("pointerleave", schedule);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointermove", schedule);
      host.removeEventListener("pointerleave", schedule);
      window.cancelAnimationFrame(frame);
      host.classList.remove("has-antigravity");
      for (const item of items) {
        item.element.style.removeProperty("--ag-x");
        item.element.style.removeProperty("--ag-y");
        item.element.style.removeProperty("--ag-rx");
        item.element.style.removeProperty("--ag-ry");
      }
    };
  }, []);

  return <div ref={root} className="antigravity-root">{children}<div ref={cursor} className="antigravity-cursor" aria-hidden="true"/><div ref={cursorDot} className="antigravity-cursor-dot" aria-hidden="true"/></div>;
}
