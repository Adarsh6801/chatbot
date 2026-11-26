import type { ReactNode } from 'react';

export function documentationHeadingId(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function inline(text: string, prefix: string): ReactNode[] {
  const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|https?:\/\/[^\s]+)/g;
  return text.split(tokens).filter(Boolean).map((part, index) => {
    const key = `${prefix}-${index}`;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^https?:\/\//.test(part)) return <a key={key} href={part} target="_blank" rel="noreferrer">{part}</a>;
    return <span key={key}>{part}</span>;
  });
}

export function DocumentationMarkdown({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = []; index++;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={`code-${index}`}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      const Tag = heading[1].length === 2 ? 'h2' : 'h3';
      blocks.push(<Tag id={documentationHeadingId(heading[2])} key={`heading-${index}`}>{inline(heading[2], `heading-${index}`)}</Tag>);
      index++; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*]\s+/, ''));
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, n) => <li key={n}>{inline(item, `ul-${index}-${n}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+\.\s+/, ''));
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, n) => <li key={n}>{inline(item, `ol-${index}-${n}`)}</li>)}</ol>);
      continue;
    }
    if (/^>\s?/.test(line)) { blocks.push(<blockquote key={`quote-${index}`}>{inline(line.replace(/^>\s?/, ''), `quote-${index}`)}</blockquote>); index++; continue; }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^(#{2,3}\s+|\s*[-*]\s+|\s*\d+\.\s+|>\s?|```)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={`p-${index}`}>{paragraph.map((part, n) => <span key={n}>{n > 0 && <br/>}{inline(part, `p-${index}-${n}`)}</span>)}</p>);
  }
  return <div className="documentation-markdown">{blocks}</div>;
}
