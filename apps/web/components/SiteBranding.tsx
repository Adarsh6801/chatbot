"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { API } from "@/lib/api";

export type BrandDisplayMode = "both" | "image" | "text";
type Branding = { name: string; logoUrl: string; brandDisplay: BrandDisplayMode };
const defaults: Branding = { name: "AgentForge", logoUrl: "", brandDisplay: "both" };
const BrandingContext = createContext<Branding>(defaults);

export function SiteBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(defaults);
  const originalTitle = useRef("");

  const loadBranding = useCallback(() => {
    fetch(`${API}/api/v1/public/site-settings`, { credentials: "omit", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        const mode: BrandDisplayMode =
          data.brand_display === "image" || data.brand_display === "text" ? data.brand_display : "both";
        setBranding({
          name: data.name || defaults.name,
          logoUrl: data.logo_url || "",
          brandDisplay: mode,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    originalTitle.current = document.title;
    loadBranding();
    const onFocus = () => loadBranding();
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadBranding();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadBranding]);

  useEffect(() => {
    if (originalTitle.current) {
      document.title = originalTitle.current.replaceAll("AgentForge", branding.name);
    }
  }, [branding.name]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useSiteBranding() {
  return useContext(BrandingContext);
}

export function SiteLogo({ fallback, className = "", alt = "" }: { fallback: ReactNode; className?: string; alt?: string }) {
  const { name, logoUrl, brandDisplay } = useSiteBranding();
  const [failedUrl, setFailedUrl] = useState("");
  if (brandDisplay === "text") return null;
  if (!logoUrl || failedUrl === logoUrl) return <>{fallback}</>;
  const modeClass = brandDisplay === "image" ? " brand-mode-image" : "";
  return <img className={`${className}${modeClass}`.trim()} src={logoUrl} alt={alt || name} onError={() => setFailedUrl(logoUrl)} />;
}

export function SiteName({ period = false }: { period?: boolean }) {
  const { name, logoUrl, brandDisplay } = useSiteBranding();
  if (brandDisplay === "image" && logoUrl) return null;
  return <>{name}{period && <span className="marketing-logo-period">.</span>}</>;
}
