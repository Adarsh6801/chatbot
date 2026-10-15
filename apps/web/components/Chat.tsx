'use client';
import {useEffect, useRef, useState} from 'react';
import {ArrowUp, Sparkles, RotateCcw, FileText} from 'lucide-react';
import {ChatMessage, streamChat} from '@/lib/api';

export default function Chat({publicKey, name, greeting='Hi! What can I help you find?', color='#d6ff63', logo='', publicView=false, onDone}:{publicKey:string; name:string; greeting?:string; color?:string; logo?:string; publicView?:boolean; onDone?:()=>void}) {
  const [messages,setMessages] = useState<ChatMessage[]>([]), [input,setInput] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const conversation = useRef<string|null>(null), visitor = useRef(''), end = useRef<HTMLDivElement>(null);
  useEffect(() => {let id = sessionStorage.getItem('af_visitor'); if (!id) {id=crypto.randomUUID(); sessionStorage.setItem('af_visitor',id);} visitor.current=id;}, []);
  useEffect(() => {end.current?.scrollIntoView({behavior:'smooth', block:'nearest'});}, [messages]);
  async function send(text:string) {
    if (!text.trim() || busy) return;
    setBusy(true); setError(''); setInput('');
    setMessages(old => [...old,{role:'user',content:text},{role:'assistant',content:''}]);
    try {
      await streamChat(publicKey,text,visitor.current,conversation.current,(kind,data) => {
        if (kind === 'error') throw new Error(data.message);
        if (kind === 'meta') conversation.current=data.conversation_id;
        if (kind === 'done') onDone?.();
        setMessages(old => old.map((m,i) => i === old.length-1 ? {...m,...(kind === 'token' ? {content:m.content+data.text} : kind === 'meta' ? {citations:data.citations,confidence:data.confidence} : kind === 'done' ? {model:data.model} : {})} : m));
      },publicView);
    } catch (err) {setError((err as Error).message);} finally {setBusy(false);}
  }
  return <div className="chat" style={{'--agent-color':color} as React.CSSProperties}>
    <div className="chat-top"><div className="agent-avatar">{logo?<img src={logo} alt={name+' logo'} width={37} height={37}/>:<Sparkles size={20}/>}</div><div><strong>{name}</strong><span><i/> Grounded in your knowledge</span></div><button className="icon-button" title="Start a new conversation" onClick={() => {setMessages([]); conversation.current=null; setError('');}} disabled={busy}><RotateCcw size={16}/></button></div>
    <div className="chat-messages">
      {!messages.length && <div className="chat-welcome"><div className="welcome-orb"><Sparkles size={27}/></div><h3>Your answers start here.</h3><p>{greeting}</p><button className="suggestion" onClick={() => send('What can you help me with?')}>What can you help me with? <ArrowUp size={14}/></button></div>}
      {messages.map((m,i) => <div className={`message ${m.role}`} key={i}>{m.role==='assistant' && <small><Sparkles size={12}/> {name}</small>}<div className="message-body">{m.content || (busy?'Searching your knowledge…':'No response received.')}</div>{m.citations && m.citations.length>0 && m.content && <details className="citations"><summary><FileText size={12}/> {m.citations.length} sources · {Math.round((m.confidence||0)*100)}% retrieval confidence</summary>{m.citations.map(c => <div key={c.index}><strong>[{c.index}] {c.source}</strong><p>{c.excerpt}</p></div>)}</details>}</div>)}
      <div ref={end}/>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    <form className="chat-input" onSubmit={e => {e.preventDefault(); send(input);}}><input aria-label="Your question" placeholder="Ask a question…" value={input} onChange={e=>setInput(e.target.value)} maxLength={4000}/><button aria-label="Send message" disabled={busy || !input.trim()}><ArrowUp size={19}/></button></form>
    <div className="chat-footer">Powered by <strong>AgentForge</strong> <span>·</span> Answers include source evidence</div>
  </div>;
}
