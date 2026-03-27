/**
 * profanityFilter — client-side text moderation utility.
 *
 * filterMessage(text, level) replaces profanity with asterisks.
 *
 * Levels (cumulative — each level includes words from levels below it):
 *   'off'    — no filtering
 *   'light'  — serious slurs only
 *   'medium' — common profanity + light words
 *   'strict' — all of the above + mild profanity/vulgarity
 *
 * The filter level for a server is stored in localStorage under the key
 *   d_profanity_<serverId>
 * and can be read/written with getProfanityLevel / setProfanityLevel.
 */

export type FilterLevel = 'off' | 'light' | 'medium' | 'strict';

// ─── Word lists ───────────────────────────────────────────
// Each list contains words matched at THAT level and above.
// Words are lowercase plain strings; matching is case-insensitive
// with word-boundary anchors so "classic" doesn't match "ass".

/** Serious slurs — always included when filter is 'light' or above. */
const WORDS_LIGHT: string[] = [
  'nigger', 'nigga', 'faggot', 'fag', 'kike', 'spic', 'chink',
  'wetback', 'gook', 'coon', 'towelhead', 'raghead', 'tranny',
  'retard', 'cracker', 'dyke',
];

/** Common profanity — included at 'medium' and above. */
const WORDS_MEDIUM: string[] = [
  'fuck', 'fucking', 'fucked', 'fucker', 'motherfucker', 'motherfucking',
  'shit', 'bullshit', 'shitty', 'shitter',
  'bitch', 'bitching', 'bitchy',
  'asshole', 'arsehole',
  'cunt', 'bastard',
  'dick', 'dickhead', 'cock', 'cocksucker',
  'pussy', 'whore', 'slut',
  'piss', 'pissed',
];

/** Mild/borderline profanity — included at 'strict' only. */
const WORDS_STRICT: string[] = [
  'damn', 'dammit', 'goddamn', 'goddammit',
  'hell', 'bloody',
  'crap', 'crappy',
  'ass', 'arse', 'jackass', 'smartass', 'dumbass', 'badass',
  'boob', 'boobs', 'tit', 'tits', 'titty', 'titties',
  'penis', 'vagina', 'boner', 'balls', 'ballsack',
  'horny', 'slutty', 'wanker', 'wank',
];

// ─── Regex cache ──────────────────────────────────────────

const _cache: Partial<Record<FilterLevel, RegExp>> = {};

function buildRegex(level: FilterLevel): RegExp {
  if (_cache[level]) return _cache[level]!;

  const words: string[] = [];
  // Cumulative: each level adds its own + all more-severe levels
  if (level === 'light' || level === 'medium' || level === 'strict') {
    words.push(...WORDS_LIGHT);
  }
  if (level === 'medium' || level === 'strict') {
    words.push(...WORDS_MEDIUM);
  }
  if (level === 'strict') {
    words.push(...WORDS_STRICT);
  }

  // Escape special regex chars, sort longest-first to avoid partial shadowing
  const escaped = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);

  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  _cache[level] = pattern;
  return pattern;
}

// ─── Public API ───────────────────────────────────────────

/**
 * Returns a copy of `text` with matched words replaced by asterisks.
 * URLs are preserved unchanged so link embeds still work.
 */
export function filterMessage(text: string, level: FilterLevel): string {
  if (!text || level === 'off') return text;

  const pattern = buildRegex(level);

  // Reset lastIndex (regex is cached and reused)
  pattern.lastIndex = 0;

  // Skip URL tokens — replace word-by-word to avoid masking protocol strings
  return text.replace(/https?:\/\/\S+|(\S+)/g, (match, word) => {
    if (!word) return match;          // URL — leave intact
    pattern.lastIndex = 0;
    return word.replace(pattern, (m: string) => '*'.repeat(m.length));
  });
}

/**
 * Read the stored profanity filter level for a server.
 * Returns 'off' if not set.
 */
export function getProfanityLevel(serverId: string): FilterLevel {
  return (localStorage.getItem(`d_profanity_${serverId}`) || 'off') as FilterLevel;
}

/**
 * Persist the profanity filter level for a server.
 */
export function setProfanityLevel(serverId: string, level: FilterLevel): void {
  localStorage.setItem(`d_profanity_${serverId}`, level);
}
