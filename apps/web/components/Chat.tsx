'use client';
import {useEffect, useRef, useState} from 'react';
import {ArrowUp, Sparkles, RotateCcw, FileText} from 'lucide-react';
import {API, ChatMessage, streamChat} from '@/lib/api';
import {SiteName} from '@/components/SiteBranding';

export default function Chat({publicKey, name, greeting='Hi! What can I help you find?', color='#d6ff63', logo='', publicView=false, onDone, userId='', userName=''}:{publicKey:string; name:string; greeting?:string; color?:string; logo?:string; publicView?:boolean; onDone?:()=>void; userId?:string; userName?:string}) {
  const [messages,setMessages] = useState<ChatMessage[]>([]), [input,setInput] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState(''), [chatReady,setChatReady] = useState(!publicView);
  const conversation = useRef<string|null>(null), visitor = useRef(''), end = useRef<HTMLDivElement>(null);
  const identity = useRef({userId, userName});
  const newSessionKey = useRef('');
  useEffect(() => {
    let id = sessionStorage.getItem('af_visitor'); if (!id) {id=crypto.randomUUID(); sessionStorage.setItem('af_visitor',id);} visitor.current=id;
    const params = new URLSearchParams(window.location.search);
    identity.current = {userId: userId || (publicView ? params.get('user_id') : '') || '', userName: userName || (publicView ? params.get('user_name') : '') || ''};
    const identityKey = identity.current.userId ? `user:${identity.current.userId}` : `visitor:${id}`;
    newSessionKey.current = `af_new_${publicKey}_${identityKey}`;
    if (!publicView) {setChatReady(true); return;}
    if (localStorage.getItem(newSessionKey.current)) {setChatReady(true); return;}
    const query = `visitor_id=${encodeURIComponent(id)}`;
    fetch(`${API}/api/v1/public/chat/${encodeURIComponent(publicKey)}/history?${query}`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not restore this conversation.')))
      .then(history => {if (history.conversation_id) {conversation.current=history.conversation_id;setMessages(history.messages || []);}})
      .catch(() => setError('Could not restore your previous conversation.'))
      .finally(() => setChatReady(true));
  }, [publicKey, publicView, userId, userName]);
  useEffect(() => {end.current?.scrollIntoView({behavior:'smooth', block:'nearest'});}, [messages]);
  async function send(text:string) {
    if (!text.trim() || busy || !chatReady) return;
    setBusy(true); setError(''); setInput('');
    setMessages(old => [...old,{role:'user',content:text},{role:'assistant',content:''}]);
    try {
      await streamChat(publicKey,text,visitor.current,conversation.current,(kind,data) => {
        if (kind === 'error') throw new Error(data.message);
        if (kind === 'meta') {conversation.current=data.conversation_id;localStorage.removeItem(newSessionKey.current);}
        if (kind === 'done') onDone?.();
        setMessages(old => old.map((m,i) => i === old.length-1 ? {...m,...(kind === 'token' ? {content:m.content+data.text} : kind === 'meta' ? {citations:data.citations,confidence:data.confidence} : kind === 'done' ? {model:data.model} : {})} : m));
      },publicView,identity.current.userId,identity.current.userName);
    } catch (err) {setError((err as Error).message);} finally {setBusy(false);}
  }
  return <div className="chat" style={{'--agent-color':color} as React.CSSProperties}>
    <div className="chat-top"><div className="agent-avatar">{logo?<img src={logo} alt={name+' logo'} width={37} height={37}/>:<Sparkles size={20}/>}</div><div><strong>{name}</strong><span><i/> Grounded in your knowledge</span></div><button className="icon-button chat-new-session" title="Start a new conversation" aria-label="Start a new conversation" onClick={() => {setMessages([]); conversation.current=null; setError(''); if (publicView) localStorage.setItem(newSessionKey.current, '1');}} disabled={busy}><RotateCcw size={15}/>New chat</button></div>
    <div className="chat-messages">
      {!messages.length && <div className="chat-welcome"><div className="welcome-orb"><Sparkles size={27}/></div><h3>Your answers start here.</h3><p>{greeting}</p><button className="suggestion" onClick={() => send('What can you help me with?')}>What can you help me with? <ArrowUp size={14}/></button></div>}
      {messages.map((m,i) => <div className={`message ${m.role}`} key={i}>{m.role==='assistant' && <small><Sparkles size={12}/> {name}</small>}<div className="message-body">{m.content || (busy?'Searching your knowledge…':'No response received.')}</div>{m.citations && m.citations.length>0 && m.content && <details className="citations"><summary><FileText size={12}/> {m.citations.length} sources · {Math.round((m.confidence||0)*100)}% retrieval confidence</summary>{m.citations.map(c => <div key={c.index}><strong>[{c.index}] {c.source}</strong><p>{c.excerpt}</p></div>)}</details>}</div>)}
      <div ref={end}/>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    <form className="chat-input" onSubmit={e => {e.preventDefault(); send(input);}}><input aria-label="Your question" placeholder={chatReady ? "Ask a question…" : "Restoring your conversation…"} value={input} onChange={e=>setInput(e.target.value)} maxLength={4000} disabled={!chatReady}/><button aria-label="Send message" disabled={!chatReady || busy || !input.trim()}><ArrowUp size={19}/></button></form>
    <div className="chat-footer">Powered by <strong><SiteName/></strong> <span>·</span> Answers include source evidence</div>
  </div>;
}
