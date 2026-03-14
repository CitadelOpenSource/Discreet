/**
 * security.ts — client-side input hygiene utilities.
 *
 * Note: React's JSX already HTML-escapes rendered text, so these helpers are
 * a defence-in-depth layer for cases where text leaves the React render tree
 * (clipboard copy, API bodies, localStorage, future dangerouslySetInnerHTML
 * usage, server-side logging, etc.).
 *
 * Exports:
 *   sanitizeInput(text)                       — strips XSS vectors and SQL injection patterns
 *   validateMessageLength(text, max?)         — returns true when length is within limit
 *   rateLimitCheck(action, maxPerMinute)      — client-side sliding-window rate limit
 */

// ─── sanitizeInput ────────────────────────────────────────

/**
 * Cleans a user-supplied string of the most common injection attack vectors.
 *
 * What it removes:
 *   - Null bytes and dangerous ASCII control characters (keeps \n, \t, \r)
 *   - HTML / XML tags  (<script>, <img onerror=…>, etc.)
 *   - Code-executing URI schemes  (javascript:, vbscript:)
 *   - Inline HTML event handler attributes  (onclick=, onerror=, …)
 *   - SQL injection payloads  (UNION SELECT, ; DROP TABLE, etc.)
 *   - Block and line SQL comments  (/* … * /, --)
 *
 * What it deliberately keeps:
 *   - Apostrophes and quotes  — normal in prose ("don't", "she said "hi"")
 *   - Semicolons in natural speech  — "Done; moving on."
 *   - SQL keywords as nouns  — "SELECT is a CSS pseudo-class"
 *   - All Unicode / emoji
 *   - Newlines and tabs (for multi-line input)
 */
export function sanitizeInput(text: string): string {
  if (!text) return '';

  let s = text;

  // 1. Remove null bytes and non-printable ASCII control chars
  //    Keep: \t (0x09), \n (0x0A), \r (0x0D)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 2. Decode common HTML entity obfuscation before further checks
  //    e.g. &#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // 3. Strip all HTML / XML tags (including self-closing and malformed)
  s = s.replace(/<[^>]*>/g, '');

  // 4. Remove code-executing URI schemes (case-insensitive; tolerates whitespace/encoding)
  s = s.replace(/\b(?:javascript|vbscript)\s*:/gi, '');
  // data: URIs are only dangerous in src/href attrs; keep the keyword but drop the scheme usage
  s = s.replace(/\bdata\s*:\s*(?:text\/html|application\/)/gi, '');

  // 5. Remove HTML event handler attributes  (onerror=, onclick=, onload=, …)
  s = s.replace(/\bon\w{2,}\s*=/gi, '');

  // 6. SQL injection — target injection-specific patterns, not natural language:
  //    a) semicolon immediately followed by a DML/DDL keyword ('; DROP TABLE …')
  s = s.replace(/;\s*\b(drop|delete|truncate|insert\s+into|update\s+\w|exec(?:ute)?|xp_)\b/gi, '');
  //    b) UNION-based injection  (UNION SELECT, UNION ALL SELECT)
  s = s.replace(/\bUNION\s+(?:ALL\s+)?SELECT\b/gi, '');
  //    c) SQL block comments  /* … */
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  //    d) SQL line-comment delimiter when used as an injection terminator
  //       Match  --  followed only by optional spaces then end-of-word/line
  //       (keeps "-- TODO" style comments in code pastes by leaving a space after)
  s = s.replace(/--(?=\s*$|\s*\))/gm, '');

  return s;
}

// ─── validateMessageLength ────────────────────────────────

/**
 * Returns true when `text` does not exceed `maxLength` characters.
 * Default limit matches the industry standard 4000-char message cap.
 */
export function validateMessageLength(text: string, maxLength = 4000): boolean {
  return text.length <= maxLength;
}

// ─── rateLimitCheck ───────────────────────────────────────

const RL_PREFIX = 'd_rl_';
const WINDOW_MS = 60_000; // 1 minute sliding window

/**
 * Client-side sliding-window rate limiter backed by localStorage.
 *
 * Returns true (and records the attempt) when the caller is within the limit.
 * Returns false without recording when the limit is already reached.
 *
 * @param action      Unique key for this action type  (e.g. 'send_message', 'create_server')
 * @param maxPerMinute  Maximum allowed calls within any 60-second window
 *
 * Example:
 *   if (!rateLimitCheck('send_message', 30)) {
 *     showToast('Slow down — you're sending messages too quickly.');
 *     return;
 *   }
 */
export function rateLimitCheck(action: string, maxPerMinute: number): boolean {
  const key = RL_PREFIX + action;
  const now = Date.now();

  let timestamps: number[];
  try {
    timestamps = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(timestamps)) timestamps = [];
  } catch {
    timestamps = [];
  }

  // Drop timestamps outside the sliding window
  timestamps = timestamps.filter(t => now - t < WINDOW_MS);

  if (timestamps.length >= maxPerMinute) {
    // Write back the pruned list (avoids unbounded growth)
    try { localStorage.setItem(key, JSON.stringify(timestamps)); } catch {}
    return false;
  }

  timestamps.push(now);
  try { localStorage.setItem(key, JSON.stringify(timestamps)); } catch {}
  return true;
}
