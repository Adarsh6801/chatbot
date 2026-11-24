"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { API } from "@/lib/api";

type Branding = { name: string; logoUrl: string };
const defaults: Branding = { name: "AgentForge", logoUrl: "" };
const BrandingContext = createContext<Branding>(defaults);

export function SiteBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(defaults);
  const originalTitle = useRef("");
  useEffect(() => {
    originalTitle.current = document.title;
    fetch(`${API}/api/v1/public/site-settings`, { credentials: "omit" })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => setBranding({ name: data.name || defaults.name, logoUrl: data.logo_url || "" }))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (originalTitle.current) document.title = originalTitle.current.replaceAll("AgentForge", branding.name);
  }, [branding.name]);
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useSiteBranding() { return useContext(BrandingContext); }

export function SiteLogo({ fallback, className = "", alt = "" }: { fallback: ReactNode; className?: string; alt?: string }) {
  const { logoUrl } = useSiteBranding();
  return logoUrl ? <img className={className} src={logoUrl} alt={alt}/> : <>{fallback}</>;
}

export function SiteName({ period = false }: { period?: boolean }) {
  const { name } = useSiteBranding();
  return <>{name}{period && <span className="marketing-logo-period">.</span>}</>;
}
