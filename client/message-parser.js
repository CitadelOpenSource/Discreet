/**
 * @fileoverview Client-side message parsing helpers for Discreet chat rendering.
 *
 * Parsing pipeline:
 * 1) sanitize HTML-sensitive characters
 * 2) parse markdown
 * 3) parse mentions
 * 4) parse emoji shortcodes
 *
 * This module is intentionally dependency-free so it can be imported directly from
 * `client/index.html` via `<script type="module">`.
 */

/**
 * Mapping of common emoji shortcodes to unicode emoji.
 * Includes 50 frequently-used shortcodes.
 * @type {Record<string, string>}
 */
export const EMOJI_SHORTCODES = {
  smile: '😊',
  grin: '😁',
  joy: '😂',
  rofl: '🤣',
  sweat_smile: '😅',
  wink: '😉',
  blush: '😊',
  heart_eyes: '😍',
  kissing_heart: '😘',
  thinking: '🤔',
  neutral_face: '😐',
  expressionless: '😑',
  unamused: '😒',
  rolling_eyes: '🙄',
  relieved: '😌',
  sleepy: '😪',
  sob: '😭',
  cry: '😢',
  angry: '😠',
  rage: '😡',
  scream: '😱',
  party: '🥳',
  sunglasses: '😎',
  nerd: '🤓',
  upside_down: '🙃',
  wave: '👋',
  clap: '👏',
  pray: '🙏',
  ok_hand: '👌',
  thumbsup: '👍',
  thumbsdown: '👎',
  fist: '✊',
  v: '✌️',
  muscle: '💪',
  fire: '🔥',
  sparkles: '✨',
  star: '⭐',
  boom: '💥',
  eyes: '👀',
  warning: '⚠️',
  x: '❌',
  white_check_mark: '✅',
  heart: '❤️',
  broken_heart: '💔',
  two_hearts: '💕',
  hundred: '💯',
  tada: '🎉',
  rocket: '🚀',
  poop: '💩',
  skull: '💀',
};

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const LINK_PROTOCOL_REGEX = /^(https?:\/\/|mailto:)/i;

/**
 * Escapes HTML-sensitive characters to reduce XSS risk.
 *
 * @param {string} text - Raw user-provided text.
 * @returns {string} Escaped text safe for markdown parsing.
 */
export function sanitizeHtml(text) {
  return String(text ?? '').replace(/[&<>\"]/g, (char) => HTML_ESCAPE_MAP[char]);
}

/**
 * Replaces only plain-text regions while preserving existing HTML tags.
 *
 * @param {string} html - HTML string to transform.
 * @param {(text: string) => string} replacer - Transformation for text chunks.
 * @returns {string} HTML with transformed text chunks.
 */
function replaceOutsideTags(html, replacer) {
  return html
    .split(/(<[^>]+>)/g)
    .map((chunk) => (chunk.startsWith('<') ? chunk : replacer(chunk)))
    .join('');
}

/**
 * Converts a subset of markdown syntax to HTML.
 *
 * Supported syntax:
 * - `**bold**` -> `<strong>`
 * - `*italic*` -> `<em>`
 * - `__underline__` -> `<u>`
 * - `~~strikethrough~~` -> `<s>`
 * - `` `inline code` `` -> `<code>`
 * - `````triple-backtick code blocks````` -> `<pre><code>`
 * - `> blockquote` -> `<blockquote>`
 * - `[text](url)` -> `<a href="..." target="_blank" rel="noopener noreferrer">`
 *
 * @param {string} text - Input message text.
 * @returns {string} HTML-renderable markdown output.
 */
export function parseMarkdown(text) {
  let html = String(text ?? '');

  // Code blocks first to avoid inline markdown parsing inside them.
  html = html.replace(/```([\s\S]*?)```/g, (_match, code) => `<pre><code>${code.trim()}</code></pre>`);

  // Inline code before other inline formatting.
  html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

  // Links.
  html = html.replace(/\[([^\]]+?)\]\(([^)\s]+)\)/g, (_match, label, url) => {
    const safeUrl = LINK_PROTOCOL_REGEX.test(url) ? url : '#';
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Blockquotes (line-by-line for multiline support).
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');

  // Inline style transforms.
  html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+?)__/g, '<u>$1</u>');
  html = html.replace(/~~([^~]+?)~~/g, '<s>$1</s>');
  html = html.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

  return html;
}

/**
 * Converts user and channel mention syntax into semantic span elements.
 *
 * Special mentions:
 * - `@everyone` -> `mention mention-everyone`
 * - `@here` -> `mention mention-here`
 *
 * User mentions:
 * - `@username` -> `mention`
 * If `userMap` is provided and non-empty, only usernames that exist in the map are wrapped.
 *
 * Channel mentions:
 * - `#channel-name` -> `channel-mention`
 *
 * @param {string} text - Input text or HTML.
 * @param {Record<string, unknown>|Map<string, unknown>} [userMap] - Optional lookup for valid usernames.
 * @returns {string} Text with mention spans.
 */
export function parseMentions(text, userMap) {
  const hasUsers = userMap instanceof Map ? userMap.size > 0 : !!(userMap && Object.keys(userMap).length > 0);
  const userExists = (username) => {
    if (!hasUsers) return true;
    if (userMap instanceof Map) return userMap.has(username);
    return Object.prototype.hasOwnProperty.call(userMap, username);
  };

  return replaceOutsideTags(String(text ?? ''), (segment) =>
    segment
      .replace(/(^|\s)@everyone\b/g, '$1<span class="mention mention-everyone">@everyone</span>')
      .replace(/(^|\s)@here\b/g, '$1<span class="mention mention-here">@here</span>')
      .replace(/(^|\s)@([a-zA-Z0-9_.-]{2,32})\b/g, (match, prefix, username) => {
        if (!userExists(username)) return match;
        return `${prefix}<span class="mention">@${username}</span>`;
      })
      .replace(/(^|\s)#([a-zA-Z0-9_-]{1,100})\b/g, '$1<span class="channel-mention">#$2</span>')
  );
}

/**
 * Converts `:shortcode:` patterns to unicode emoji.
 *
 * @param {string} text - Input text or HTML.
 * @returns {string} Text with known shortcodes replaced.
 */
export function parseEmoji(text) {
  return replaceOutsideTags(String(text ?? ''), (segment) =>
    segment.replace(/:([a-zA-Z0-9_+-]+):/g, (match, shortcode) => EMOJI_SHORTCODES[shortcode] ?? match)
  );
}

/**
 * Full parser pipeline for user message content.
 *
 * Order is fixed for safety and expected rendering behavior:
 * sanitize -> markdown -> mentions -> emoji.
 *
 * @param {string} text - Raw message content.
 * @param {Record<string, unknown>|Map<string, unknown>} [userMap] - Optional user lookup for mentions.
 * @returns {string} Final parsed HTML string.
 */
export function parseMessage(text, userMap) {
  const sanitized = sanitizeHtml(text);
  const withMarkdown = parseMarkdown(sanitized);
  const withMentions = parseMentions(withMarkdown, userMap);
  return parseEmoji(withMentions);
}
