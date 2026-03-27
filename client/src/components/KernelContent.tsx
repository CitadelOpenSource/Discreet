/**
 * KernelContent — Renders SanitizedContent from the kernel's render model.
 *
 * Kernel-backed equivalent of Markdown.tsx. Instead of parsing markdown from
 * raw text, this renders from pre-parsed, pre-sanitized structured data
 * produced by the kernel's sanitization pipeline (Glassworm defense, XSS
 * strip, formatting extraction).
 *
 * NEVER uses dangerouslySetInnerHTML. All content rendered as React text
 * nodes — automatically escaped by React's JSX runtime.
 */
import React, { useState } from 'react';
import { T } from '../theme';
import type {
  SanitizedContent,
  FormattingSpan,
  Mention,
  CodeBlock,
  ValidatedLink,
} from '../kernel/types.generated';

interface KernelContentProps {
  content: SanitizedContent;
  onMention?: (username: string, e: React.MouseEvent) => void;
  mentionStyle?: (username: string) => React.CSSProperties;
}

const defaultMentionStyle: React.CSSProperties = {
  background: 'rgba(88,101,242,0.2)',
  color: '#5865F2',
  padding: '0 3px',
  borderRadius: 3,
  cursor: 'pointer',
  fontWeight: 600,
};

const inlineCodeStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  padding: '1px 5px',
  borderRadius: 3,
  fontSize: '0.9em',
  fontFamily: 'var(--font-mono)',
};

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

/** A positioned annotation derived from kernel spans. */
interface Span {
  start: number;
  end: number;
  kind: string;
  data?: FormattingSpan | Mention | CodeBlock | ValidatedLink;
}

function buildSpans(content: SanitizedContent): Span[] {
  const spans: Span[] = [];

  for (const f of content.formatting) {
    spans.push({ start: f.start, end: f.end, kind: f.style, data: f });
  }
  for (const m of content.mentions) {
    spans.push({ start: m.start, end: m.end, kind: 'Mention', data: m });
  }
  for (const cb of content.code_blocks) {
    if (cb.is_inline) {
      spans.push({ start: cb.start, end: cb.end, kind: 'InlineCode', data: cb });
    }
  }

  // Sort by start position; for same start, longer spans first
  spans.sort((a, b) => a.start - b.start || b.end - a.end);

  // Remove overlapping spans (keep first — higher priority)
  const filtered: Span[] = [];
  let lastEnd = 0;
  for (const s of spans) {
    if (s.start >= lastEnd) {
      filtered.push(s);
      lastEnd = s.end;
    }
  }
  return filtered;
}

function renderStyledSpan(
  kind: string,
  text: string,
  key: number,
  data: Span['data'],
  onMention?: KernelContentProps['onMention'],
  mentionStyleFn?: KernelContentProps['mentionStyle'],
): React.ReactNode {
  switch (kind) {
    case 'Bold':
      return <strong key={key}>{text}</strong>;
    case 'Italic':
      return <em key={key}>{text}</em>;
    case 'Strikethrough':
      return <span key={key} style={{ textDecoration: 'line-through' }}>{text}</span>;
    case 'Code':
    case 'InlineCode':
      return <code key={key} style={inlineCodeStyle}>{(data as CodeBlock)?.content ?? text}</code>;
    case 'Spoiler':
      return <Spoiler key={key}>{text}</Spoiler>;
    case 'Mention': {
      const m = data as Mention;
      const style = mentionStyleFn?.(m.username) || defaultMentionStyle;
      return (
        <span key={key} onClick={e => onMention?.(m.username, e)} style={style}>
          @{m.username}
        </span>
      );
    }
    default:
      return <span key={key}>{text}</span>;
  }
}

function renderInlineContent(
  text: string,
  spans: Span[],
  links: ValidatedLink[],
  onMention?: KernelContentProps['onMention'],
  mentionStyleFn?: KernelContentProps['mentionStyle'],
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const span of spans) {
    if (span.start > cursor) {
      nodes.push(...renderTextWithLinks(text.slice(cursor, span.start), links, key));
      key += 10;
    }
    const sliceText = text.slice(span.start, span.end);
    nodes.push(renderStyledSpan(span.kind, sliceText, key++, span.data, onMention, mentionStyleFn));
    cursor = span.end;
  }

  if (cursor < text.length) {
    nodes.push(...renderTextWithLinks(text.slice(cursor), links, key));
  }

  return nodes;
}

/** Render plain text, turning any validated URLs into links. */
function renderTextWithLinks(text: string, links: ValidatedLink[], keyBase: number): React.ReactNode[] {
  if (links.length === 0) return [<React.Fragment key={keyBase}>{text}</React.Fragment>];

  const urlPattern = /https?:\/\/[^\s<>]+/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = keyBase;
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(<React.Fragment key={key++}>{text.slice(lastIdx, match.index)}</React.Fragment>);
    }
    const url = match[0];
    const validated = links.find(l => l.url === url);
    if (validated && validated.is_safe) {
      const display = validated.display_text.length > 60 ? validated.display_text.slice(0, 60) + '\u2026' : validated.display_text;
      nodes.push(
        <a key={key++} href={validated.url} target="_blank" rel="noopener noreferrer" style={{ color: T.ac, textDecoration: 'underline' }}>
          {display}
        </a>
      );
    } else {
      nodes.push(<span key={key++} style={{ color: T.mt, textDecoration: 'line-through' }}>{url}</span>);
    }
    lastIdx = match.index + url.length;
  }

  if (lastIdx < text.length) {
    nodes.push(<React.Fragment key={key++}>{text.slice(lastIdx)}</React.Fragment>);
  }

  return nodes;
}

export function KernelContent({ content, onMention, mentionStyle }: KernelContentProps) {
  const { text, formatting, mentions, code_blocks, links } = content;

  // Nothing to render
  if (!text && code_blocks.length === 0) return null;

  const inlineSpans = buildSpans({ text, formatting, mentions, code_blocks, links });
  const blockCodes = code_blocks.filter(b => !b.is_inline).sort((a, b) => a.start - b.start);

  // If no block-level code, render text with inline annotations
  if (blockCodes.length === 0) {
    return <>{renderInlineContent(text, inlineSpans, links, onMention, mentionStyle)}</>;
  }

  // Intersperse block-level code blocks with text segments
  const elements: React.ReactNode[] = [];
  let pos = 0;
  let key = 0;

  for (const block of blockCodes) {
    // Inline content before this block
    if (block.start > pos) {
      const segText = text.slice(pos, block.start);
      const segSpans = inlineSpans.filter(s => s.start >= pos && s.end <= block.start);
      // Adjust span positions relative to segment
      const adjusted = segSpans.map(s => ({ ...s, start: s.start - pos, end: s.end - pos }));
      elements.push(
        <React.Fragment key={key++}>
          {renderInlineContent(segText, adjusted, links, onMention, mentionStyle)}
        </React.Fragment>
      );
    }

    // Block code
    elements.push(
      <div key={key++} style={{ position: 'relative', margin: '4px 0' }}>
        {block.language && (
          <div style={{
            position: 'absolute', top: 4, right: 8, fontSize: 10,
            color: T.mt, fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase', letterSpacing: '0.5px', opacity: 0.7,
          }}>
            {block.language}
          </div>
        )}
        <pre style={{
          background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6,
          padding: '10px 12px', margin: 0, overflowX: 'auto', fontSize: 13,
          lineHeight: 1.5, fontFamily: 'var(--font-mono)',
          color: T.tx, whiteSpace: 'pre-wrap',
        }}>
          <code>{block.content}</code>
        </pre>
      </div>
    );
    pos = block.end;
  }

  // Remaining text after last block
  if (pos < text.length) {
    const segText = text.slice(pos);
    const segSpans = inlineSpans.filter(s => s.start >= pos).map(s => ({ ...s, start: s.start - pos, end: s.end - pos }));
    elements.push(
      <React.Fragment key={key++}>
        {renderInlineContent(segText, segSpans, links, onMention, mentionStyle)}
      </React.Fragment>
    );
  }

  return <>{elements}</>;
}
