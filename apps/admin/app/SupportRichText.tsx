"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Bold, Eye, Italic, List, Pencil, Quote } from "lucide-react";

function inline(text: string, prefix: string): ReactNode[] {
  const token = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s]+)/g;
  return text.split(token).filter(Boolean).map((part, index) => {
    const key = `${prefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={key}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (/^https?:\/\//.test(part)) return <a key={key} href={part} target="_blank" rel="noreferrer">{part}</a>;
    return <span key={key}>{part}</span>;
  });
}

export function SupportMessageView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/), blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<pre key={`code-${i}`}><code>{code.join("\n")}</code></pre>); continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3"; blocks.push(<Tag key={i}>{inline(heading[2], `h${i}`)}</Tag>); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, "")); blocks.push(<ul key={`u${i}`}>{items.map((item,j)=><li key={j}>{inline(item,`u${i}-${j}`)}</li>)}</ul>); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, "")); blocks.push(<ol key={`o${i}`}>{items.map((item,j)=><li key={j}>{inline(item,`o${i}-${j}`)}</li>)}</ol>); continue; }
    if (/^>\s?/.test(line)) { blocks.push(<blockquote key={i}>{inline(line.replace(/^>\s?/, ""),`q${i}`)}</blockquote>); i++; continue; }
    const paragraph = [line]; i++; while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s+|\s*[-*]\s+|\s*\d+\.\s+|>\s?)/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={`p${i}`}>{paragraph.map((part,j)=><span key={j}>{j>0&&<br/>}{inline(part,`p${i}-${j}`)}</span>)}</p>);
  }
  return <div className="support-richtext">{blocks}</div>;
}

export function SupportEditor({ value, onChange, placeholder, rows = 4, maxLength = 10000 }: { value: string; onChange: (value: string) => void; placeholder: string; rows?: number; maxLength?: number }) {
  const [preview, setPreview] = useState(false), textarea = useRef<HTMLTextAreaElement>(null);
  function change(before: string, after = before, lines = false) {
    const input = textarea.current; if (!input) return;
    const start = input.selectionStart, end = input.selectionEnd;
    if (lines) {
      const a = value.lastIndexOf("\n", start - 1) + 1, b0 = value.indexOf("\n", end), b = b0 < 0 ? value.length : b0;
      const nextLines = value.slice(a,b).split("\n").map(line=>before+line).join("\n");
      onChange(value.slice(0,a)+nextLines+value.slice(b));
      requestAnimationFrame(()=>{input.focus();input.setSelectionRange(a,a+nextLines.length);});
    } else {
      const selected = value.slice(start,end) || "text", next = value.slice(0,start)+before+selected+after+value.slice(end);
      onChange(next); requestAnimationFrame(()=>{input.focus();input.setSelectionRange(start+before.length,start+before.length+selected.length);});
    }
  }
  return <div className="support-editor"><div className="support-editor-toolbar" aria-label="Text formatting"><button type="button" title="Bold" aria-label="Bold" onClick={()=>change("**")}><Bold size={14}/></button><button type="button" title="Italic" aria-label="Italic" onClick={()=>change("*")}><Italic size={14}/></button><button type="button" title="Bulleted list" aria-label="Bulleted list" onClick={()=>change("- ","",true)}><List size={14}/></button><button type="button" title="Quote" aria-label="Quote" onClick={()=>change("> ","",true)}><Quote size={14}/></button><span/><button type="button" onClick={()=>setPreview(!preview)}>{preview?<Pencil size={13}/>:<Eye size={13}/>} {preview?"Edit":"Preview"}</button></div>{preview?<div className="support-editor-preview">{value.trim()?<SupportMessageView text={value}/>:<span className="support-preview-empty">Nothing to preview yet.</span>}</div>:<textarea ref={textarea} value={value} onChange={e=>onChange(e.target.value)} maxLength={maxLength} rows={rows} required placeholder={placeholder}/>} {!preview&&<small className="support-editor-hint">Formatting: **bold**, *italic*, - list item, &gt; quote, and https links.</small>}</div>;
}
