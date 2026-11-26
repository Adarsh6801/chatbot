export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string,string> = {'X-AgentForge-Client': 'dashboard'};
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(API + '/api/v1' + path, {...options, credentials: path.startsWith('/public/') ? 'omit' : 'include', headers: {...headers, ...options.headers}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status}). Check your input.`);
  return data;
}
export type Bot = {id:string; name:string; description:string; slug:string; public_key:string; system_prompt:string; threshold:number; published:boolean; draft_changed?:boolean; draft_needs_save?:boolean; version_history_enabled?:boolean; published_version?:string|null; documents:number; messages:number; widget_config:{color:string; greeting:string; position:string; logo:string; launcher_icon?:string; chat_template_id?:string; chat_customization?:Record<string, string | number | boolean>; chat_theme?:Record<string, string | number | boolean>}};
export type Citation = {index:number; source:string; excerpt:string};
export type ChatMessage = {role:'user'|'assistant'; content:string; citations?:Citation[]; confidence?:number; model?:string};
export async function streamChat(key:string, message:string, visitor:string, conversation:string|null, onEvent:(event:string,data:any)=>void, publicView=false, userId?:string, userName?:string) {
  const response = await fetch(`${API}/api/v1/chat/${key}`, {method:'POST', credentials:publicView?'omit':'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message, visitor_id:visitor, conversation_id:conversation, user_id:userId || undefined, user_name:userName || undefined})});
  if (!response.ok) {const data = await response.json(); throw new Error(data.detail || 'Chat request failed.');}
  if (!response.body) throw new Error('Streaming is not supported in this browser.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const {done,value} = await reader.read();
    buffer += decoder.decode(value, {stream:!done});
    const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
    for (const frame of frames) {
      const kind = frame.match(/^event: (.+)$/m)?.[1];
      const payload = frame.match(/^data: (.+)$/m)?.[1];
      if (kind && payload) onEvent(kind, JSON.parse(payload));
    }
    if (done) break;
  }
}
