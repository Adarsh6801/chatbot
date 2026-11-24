"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Bold, Italic, List, Quote, Eye, Pencil } from "lucide-react";

function inline(text: string, keyPrefix: string) {
  const token = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s]+)/g;
  return text.split(token).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
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
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3"; blocks.push(<Tag key={i}>{inline(heading[2], `h${i}`)}</Tag>); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push(<ul key={`ul-${i}`}>{items.map((item, j) => <li key={j}>{inline(item, `ul-${i}-${j}`)}</li>)}</ul>); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      blocks.push(<ol key={`ol-${i}`}>{items.map((item, j) => <li key={j}>{inline(item, `ol-${i}-${j}`)}</li>)}</ol>); continue;
    }
    if (/^>\s?/.test(line)) { blocks.push(<blockquote key={i}>{inline(line.replace(/^>\s?/, ""), `q${i}`)}</blockquote>); i++; continue; }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s+|\s*[-*]\s+|\s*\d+\.\s+|>\s?)/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={`p-${i}`}>{paragraph.map((part, j) => <span key={j}>{j > 0 && <br/>}{inline(part, `p${i}-${j}`)}</span>)}</p>);
  }
  return <div className="support-richtext">{blocks}</div>;
}

export function SupportEditor({ value, onChange, placeholder, rows = 5, maxLength = 10000 }: { value: string; onChange: (value: string) => void; placeholder: string; rows?: number; maxLength?: number }) {
  const [preview, setPreview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  function wrap(before: string, after = before) {
    const input = textarea.current;
    if (!input) return;
    const start = input.selectionStart, end = input.selectionEnd;
    const selected = value.slice(start, end) || "text";
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + before.length, start + before.length + selected.length); });
  }
  function prefixLines(prefix: string) {
    const input = textarea.current;
    if (!input) return;
    const start = input.selectionStart, end = input.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIndex = value.indexOf("\n", end);
    const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
    const lines = value.slice(lineStart, lineEnd).split("\n").map((line) => prefix + line);
    const next = value.slice(0, lineStart) + lines.join("\n") + value.slice(lineEnd);
    onChange(next);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(lineStart, lineStart + lines.join("\n").length); });
  }
  return <div className="support-editor">
    <div className="support-editor-toolbar" aria-label="Text formatting">
      <button type="button" aria-label="Bold" title="Bold" onClick={() => wrap("**")}><Bold size={15}/></button>
      <button type="button" aria-label="Italic" title="Italic" onClick={() => wrap("*")}><Italic size={15}/></button>
      <button type="button" aria-label="Bulleted list" title="Bulleted list" onClick={() => prefixLines("- ")}><List size={15}/></button>
      <button type="button" aria-label="Quote" title="Quote" onClick={() => prefixLines("> ")}><Quote size={15}/></button>
      <span/>
      <button type="button" className={preview ? "active" : ""} onClick={() => setPreview(!preview)}>{preview ? <Pencil size={14}/> : <Eye size={14}/>} {preview ? "Edit" : "Preview"}</button>
    </div>
    {preview ? <div className="support-editor-preview">{value.trim() ? <SupportMessageView text={value}/> : <span className="support-preview-empty">Nothing to preview yet.</span>}</div> : <textarea ref={textarea} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} rows={rows} required placeholder={placeholder}/>}
    {!preview && <small className="support-editor-hint">Formatting: **bold**, *italic*, - list item, &gt; quote, and https links.</small>}
  </div>;
}
