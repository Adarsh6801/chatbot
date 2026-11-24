"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";

type Account = { name: string };

export default function MarketingActions() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    api<Account>("/auth/me").then((user) => { if (active) setAccount(user); })
      .catch(() => { if (active) setAccount(null); });
    return () => { active = false; };
  }, []);

  return <div className="marketing-actions">
    <Link className="marketing-btn secondary marketing-account-link" data-magnetic href="/agents">
      {account === undefined ? "Workspace" : account ? account.name : "Sign in"}
    </Link>
    <Link className="marketing-btn primary" data-magnetic href="/agents">
      {account ? "Open workspace" : "Start building"}<ArrowRight size={15}/>
    </Link>
  </div>;
}
