export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "X-AgentForge-Client": "dashboard" };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API}/api/v1${path}`, {
    ...options,
    credentials: "include",
    headers: { ...headers, ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`);
  return data;
}

export type AdminUser = { id: string; name: string; email: string; plan: string; is_active: boolean; created_at: string; agent_count: number; message_count: number; has_subscription: boolean };
export type AdminAgent = { id: string; name: string; owner_email: string; published: boolean; created_at: string; documents: number; messages: number };
export type AuditEvent = { id: string; action: string; entity_type: string; entity_id: string; details: Record<string, any>; created_at: string; actor_email: string };
