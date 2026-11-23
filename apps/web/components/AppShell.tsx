"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { api } from "@/lib/api";

function isWorkspacePath(pathname: string) {
  return pathname === "/agents" || pathname.startsWith("/agents/") ||
    ["/analytics", "/conversations", "/api-keys", "/profile"].includes(pathname);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (pathname !== "/plans") return;
    let active = true;
    api("/auth/me").then(() => { if (active) setSignedIn(true); })
      .catch(() => { if (active) setSignedIn(false); });
    return () => { active = false; };
  }, [pathname]);

  if (isWorkspacePath(pathname)) return <Dashboard onAuthenticationChange={setSignedIn} />;
  if (pathname === "/plans") {
    if (signedIn === null) return <div className="loading">Loading plans…</div>;
    if (signedIn) return <Dashboard onAuthenticationChange={setSignedIn} />;
  }
  return <>{children}</>;
}
