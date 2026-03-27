/**
 * Markdown — XSS-safe markdown renderer using React elements only.
 * NEVER uses dangerouslySetInnerHTML. All user content is rendered as
 * React text nodes, which are automatically escaped by React's JSX runtime.
 * No raw HTML strings are ever injected into the DOM.
 *
 * Supported syntax:
 *   **bold**  *italic*  ~~strike~~  `inline code`
 *   ```lang\ncode block\n```
 *   > blockquote
 *   ||spoiler||
 *   @mentions   URLs
 */
import React, { useState } from 'react';
import { T } from '../theme';

// ── Spoiler component ──────────────────────────────────────────────────

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      style={{
        background: revealed ? 'rgba(255,255,255,0.06)' : T.tx,
        color: revealed ? T.tx : 'transparent',
        padding: '0 4px',
        borderRadius: 3,
        cursor: revealed ? 'default' : 'pointer',
        transition: 'background .2s, color .2s',
        userSelect: revealed ? 'auto' : 'none',
      }}
    >
      {children}
    </span>
  );
}

// ── Inline parser ──────────────────────────────────────────────────────
// All text is rendered via JSX text nodes — React escapes < > & " automatically.
// No esc() helper needed; that would cause double-escaping.

interface InlineCtx {
  onMention?: (username: string, e: React.MouseEvent) => void;
  mentionStyle?: (username: string) => React.CSSProperties;
}

function parseInline(text: string, ctx: InlineCtx, keyBase = 0): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Order matters: bold before italic, spoiler uses ||
  const re = /(\*\*(?:[^*]|\*(?!\*))+\*\*|~~[^~]+~~|\|\|[^|]+\|\||\*(?:[^*])+\*|`[^`\n]+`|@[\w.-]+|https?:\/\/[^\s<>]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = keyBase;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    k++;

    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      parts.push(<strong key={k}>{parseInline(tok.slice(2, -2), ctx, k * 1000)}</strong>);
    } else if (tok.startsWith('~~') && tok.endsWith('~~') && tok.length > 4) {
      parts.push(<span key={k} style={{ textDecoration: 'line-through', opacity: 0.7 }}>{parseInline(tok.slice(2, -2), ctx, k * 1000)}</span>);
    } else if (tok.startsWith('||') && tok.endsWith('||') && tok.length > 4) {
      parts.push(<Spoiler key={k}>{parseInline(tok.slice(2, -2), ctx, k * 1000)}</Spoiler>);
    } else if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) {
      parts.push(<em key={k}>{parseInline(tok.slice(1, -1), ctx, k * 1000)}</em>);
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      parts.push(
        <code key={k} style={{ background: T.bg, padding: '1px 5px', borderRadius: 3, fontSize: '0.9em', fontFamily: 'var(--font-mono)' }}>
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith('@')) {
      const style = ctx.mentionStyle?.(tok.slice(1)) || { background: 'rgba(88,101,242,0.2)', color: '#5865F2', padding: '0 3px', borderRadius: 3, cursor: 'pointer', fontWeight: 600 };
      parts.push(
        <span key={k} onClick={e => ctx.onMention?.(tok.slice(1), e)} style={style}>
          {tok}
        </span>
      );
    } else if (tok.startsWith('http')) {
      const display = tok.length > 60 ? tok.slice(0, 60) + '\u2026' : tok;
      parts.push(
        <a key={k} href={tok} target="_blank" rel="noopener noreferrer" style={{ color: T.ac, textDecoration: 'underline' }}>
          {display}
        </a>
      );
    } else {
      parts.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Block-level parser ─────────────────────────────────────────────────

export interface MarkdownProps {
  text: string;
  onMention?: (username: string, e: React.MouseEvent) => void;
  mentionStyle?: (username: string) => React.CSSProperties;
}

export function Markdown({ text, onMention, mentionStyle }: MarkdownProps) {
  if (!text) return null;
  const ctx: InlineCtx = { onMention, mentionStyle };

  // Split into code blocks first, then process remaining lines
  const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
  const segments: { type: 'text' | 'codeblock'; content: string; lang?: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = codeBlockRe.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: text.slice(last, m.index) });
    segments.push({ type: 'codeblock', content: m[2], lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', content: text.slice(last) });

  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const seg of segments) {
    if (seg.type === 'codeblock') {
      key++;
      elements.push(
        <div key={key} style={{ position: 'relative', margin: '4px 0' }}>
          {seg.lang && (
            <div style={{ position: 'absolute', top: 4, right: 8, fontSize: 10, color: T.mt, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.7 }}>
              {seg.lang}
            </div>
          )}
          <pre style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, padding: '10px 12px', margin: 0, overflowX: 'auto', fontSize: 13, lineHeight: 1.5, fontFamily: 'var(--font-mono)', color: T.tx, whiteSpace: 'pre-wrap' }}>
            <code>{seg.content}</code>
          </pre>
        </div>
      );
      continue;
    }

    // Process text lines for blockquotes
    const lines = seg.content.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Blockquote: lines starting with >
      if (line.trimStart().startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trimStart().startsWith('>')) {
          quoteLines.push(lines[i].trimStart().replace(/^>\s?/, ''));
          i++;
        }
        key++;
        elements.push(
          <div key={key} style={{ borderInlineStart: `3px solid ${T.mt}`, paddingInlineStart: 10, margin: '4px 0', color: T.mt }}>
            {parseInline(quoteLines.join('\n'), ctx, key * 1000)}
          </div>
        );
        continue;
      }

      // Regular line
      key++;
      if (line === '') {
        if (elements.length > 0 && i < lines.length - 1) {
          elements.push(<br key={key} />);
        }
      } else {
        const inline = parseInline(line, ctx, key * 1000);
        if (i < lines.length - 1) {
          elements.push(<React.Fragment key={key}>{inline}{'\n'}</React.Fragment>);
        } else {
          elements.push(<React.Fragment key={key}>{inline}</React.Fragment>);
        }
      }
      i++;
    }
  }

  return <>{elements}</>;
}
