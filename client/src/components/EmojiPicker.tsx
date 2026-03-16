/**
 * EmojiPicker — Full emoji browser with category tabs, search, recent, and
 * custom server emoji.  Two modes:
 *   • quick (default) — 4 recently-used slots + "+" to open full picker
 *   • full — search bar, category tabs, recent section, custom emoji tab
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { T } from '../theme';

// ─── Constants ────────────────────────────────────────────

const DEFAULT_QUICK = ['👍', '❤️', '😂', '🔥'];
const MAX_RECENT = 20;

// ─── Emoji name map (for search) ──────────────────────────
// Emoji → lowercase keyword string. Built lazily on first search.
const EMOJI_NAMES: Record<string, string> = {};
let namesBuilt = false;

const NAME_HINTS: Record<string, string> = {
  '👍': 'thumbs up like yes', '👎': 'thumbs down dislike no', '❤️': 'red heart love',
  '😂': 'joy laugh tears', '🤣': 'rofl rolling laughing', '😭': 'crying loud sob',
  '😍': 'heart eyes love', '🥰': 'smiling hearts love', '😘': 'kiss kissing',
  '😊': 'blush smiling happy', '😎': 'cool sunglasses', '🤔': 'thinking hmm',
  '😢': 'sad tear cry', '😮': 'open mouth surprised', '😱': 'scream fear shocked',
  '😤': 'angry huffing', '😡': 'rage angry red', '🤬': 'cursing swearing',
  '🔥': 'fire hot lit', '💯': 'hundred perfect score', '✅': 'check done complete',
  '❌': 'cross wrong x', '🎉': 'party confetti celebrate', '🎊': 'confetti celebrate',
  '🚀': 'rocket launch ship', '💀': 'skull dead', '👀': 'eyes looking',
  '👋': 'wave hello hi', '🙏': 'pray please folded hands', '💪': 'muscle strong flex',
  '👏': 'clap applause', '🤝': 'handshake deal', '✨': 'sparkles stars',
  '⭐': 'star favorite', '💡': 'lightbulb idea', '💬': 'speech bubble chat',
  '📌': 'pin pushpin', '🔗': 'link chain url', '⚡': 'lightning zap bolt',
  '☕': 'coffee cup hot', '🍕': 'pizza food', '🍺': 'beer mug drink',
  '🎮': 'game controller gaming', '🎵': 'music note song', '🎧': 'headphones audio',
  '📷': 'camera photo', '💻': 'laptop computer', '📱': 'phone mobile',
  '🐱': 'cat face', '🐶': 'dog face', '🦊': 'fox', '🐻': 'bear',
  '🌈': 'rainbow', '☀️': 'sun sunny', '🌙': 'moon crescent night',
  '❄️': 'snowflake cold winter', '🌊': 'wave water ocean',
  '🤷': 'shrug idk', '🙄': 'eye roll whatever', '😏': 'smirk',
  '🤗': 'hugging hug', '😴': 'sleeping zzz', '🥱': 'yawn tired',
  '🤮': 'vomit sick', '🤒': 'sick thermometer', '💩': 'poop',
  '👻': 'ghost boo', '🤖': 'robot bot', '👽': 'alien',
  '🏆': 'trophy winner cup', '🥇': 'first gold medal', '🎯': 'target bullseye',
  '📊': 'chart graph stats', '📈': 'chart up trending',
  '🔒': 'lock locked secure', '🔓': 'unlock open', '🔑': 'key',
  '⚠️': 'warning caution', '🚫': 'prohibited forbidden no',
  '💤': 'sleep zzz', '🆘': 'sos help emergency',
};

// ─── Emoji data ───────────────────────────────────────────

const EMOJI_DATA: Record<string, { icon: string; emojis: string[] }> = {
  'Smileys': { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🥱','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
  'People': { icon: '👋', emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','👶','👧','🧒','👦','👩','🧑','👨','👩‍🦱','👨‍🦱','👩‍🦰','👨‍🦰','👱‍♀️','👱‍♂️','👩‍🦳','👨‍🦳','👩‍🦲','👨‍🦲','🧔','👵','🧓','👴','👮','💂','🕵️','👷','🫅','🤴','👸','🥷','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟'] },
  'Animals': { icon: '🐱', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🌸','💐','🌷','🌹','🥀','🌺','🌻','🌼','🌱','🪴','🌲','🌳','🌴','🌵','🍀','☘️','🍃','🍂','🍁','🌾','🌿','🍄'] },
  'Food': { icon: '🍕', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🧂','🥤','🧋','☕','🍵','🧃','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'] },
  'Activities': { icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤸','🤼','🤽','🤾','🤺','⛹️','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️','🎰','🎉','🎊'] },
  'Travel': { icon: '✈️', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🚏','🛣️','🛤️','⛽','🚨','🚥','🚦','🛑','🚧','⚓','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🎠','🎡','🎢','🌋','🗻','🏔️','⛰️','🏕️','🏖️','🏜️','🏝️','🏞️'] },
  'Objects': { icon: '💡', emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🗑️','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🔒','🔓','🔑','🗝️','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🧬','🧫','🧪','🧹','🧴','🧷','🧺','🧻','🪣','🧽'] },
  'Symbols': { icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','☢️','☣️','📴','📳','✴️','🆚','💮','🉐','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🎵','🎶','✖️','➕','➖','➗','♾️','💲','💱','™️','©️','®️','➰','➿','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄'] },
};

const CATEGORY_KEYS = Object.keys(EMOJI_DATA);
const ALL_CATS = ['Recent', ...CATEGORY_KEYS, 'Custom'];
const CAT_ICONS: Record<string, string> = {
  Recent: '🕐', Custom: '⭐',
  ...Object.fromEntries(CATEGORY_KEYS.map(k => [k, EMOJI_DATA[k].icon])),
};

// ─── Helpers ──────────────────────────────────────────────

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem('d_recent_emoji') || '[]').slice(0, MAX_RECENT); }
  catch { return []; }
}

function saveRecent(list: string[]) {
  localStorage.setItem('d_recent_emoji', JSON.stringify(list.slice(0, MAX_RECENT)));
}

/** Build name search index (lazy, once). */
function buildNames() {
  if (namesBuilt) return;
  for (const cat of CATEGORY_KEYS) {
    for (const em of EMOJI_DATA[cat].emojis) {
      EMOJI_NAMES[em] = (NAME_HINTS[em] || cat).toLowerCase();
    }
  }
  namesBuilt = true;
}

/** Get the 4 quick-react emojis (from recent, with defaults). */
export function getQuickReact(): string[] {
  const recent = getRecent();
  if (recent.length >= 4) return recent.slice(0, 4);
  const defaults = DEFAULT_QUICK.filter(e => !recent.includes(e));
  return [...recent, ...defaults].slice(0, 4);
}

// ─── Custom emoji type ────────────────────────────────────

export interface CustomEmoji {
  id: string;
  name: string;
  image_url: string;
}

// ─── Component ────────────────────────────────────────────

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  full?: boolean;
  /** Custom server emoji (loaded by parent). */
  customEmoji?: CustomEmoji[];
}

export function EmojiPicker({ onSelect, onClose, full, customEmoji = [] }: EmojiPickerProps) {
  const [cat, setCat] = useState('Smileys');
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<string[]>(getRecent);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  useEffect(() => { if (full) inputRef.current?.focus(); }, [full]);

  const pick = (emoji: string) => {
    onSelect(emoji);
    const next = [emoji, ...recent.filter(x => x !== emoji)].slice(0, MAX_RECENT);
    setRecent(next);
    saveRecent(next);
    if (!full) onClose();
  };

  // Quick mode — 4 recent + "+" button
  if (!full) {
    const quick = getQuickReact();
    return (
      <div ref={ref} style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, padding: '6px 8px', background: T.sf, borderRadius: 10, border: `1px solid ${T.bd}`, display: 'flex', gap: 2, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        {quick.map(e => (
          <div key={e} onClick={() => pick(e)} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', fontSize: 16, transition: 'background .1s' }}
            onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>{e}</div>
        ))}
      </div>
    );
  }

  // ── Full picker ─────────────────────────────────────────

  // Search filtering
  const searchResults = useMemo(() => {
    if (!search) return null;
    buildNames();
    const q = search.toLowerCase();
    const results: string[] = [];
    for (const [em, name] of Object.entries(EMOJI_NAMES)) {
      if (name.includes(q) || em === q) results.push(em);
      if (results.length >= 80) break;
    }
    // Also search custom emoji by name
    const customResults = customEmoji.filter(ce => ce.name.toLowerCase().includes(q));
    return { unicode: results, custom: customResults };
  }, [search, customEmoji]);

  const showRecent = !search && cat === 'Recent';
  const showCustom = !search && cat === 'Custom';
  const showCategory = !search && !showRecent && !showCustom;
  const currentEmojis = showCategory ? (EMOJI_DATA[cat]?.emojis || []) : [];
  const recentShow = localStorage.getItem('d_show_recent_emoji') !== 'false';

  const visibleTabs = customEmoji.length > 0 ? ALL_CATS : ALL_CATS.filter(c => c !== 'Custom');

  const emojiCell = (e: string, i: number) => (
    <div key={i} onClick={() => pick(e)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', fontSize: 18, transition: 'transform .1s' }}
      onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(255,255,255,0.08)'; ev.currentTarget.style.transform = 'scale(1.2)'; }}
      onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; ev.currentTarget.style.transform = 'scale(1)'; }}>{e}</div>
  );

  const customCell = (ce: CustomEmoji) => (
    <div key={ce.id} onClick={() => pick(`:${ce.name}:`)} title={`:${ce.name}:`}
      style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', transition: 'transform .1s' }}
      onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(255,255,255,0.08)'; ev.currentTarget.style.transform = 'scale(1.2)'; }}
      onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; ev.currentTarget.style.transform = 'scale(1)'; }}>
      <img src={ce.image_url} style={{ width: 22, height: 22, objectFit: 'contain' }} alt={ce.name} />
    </div>
  );

  return (
    <div ref={ref} style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, width: 352, maxHeight: 420, background: T.sf, borderRadius: 12, border: `1px solid ${T.bd}`, zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Search */}
      <div style={{ padding: '8px 10px 4px' }}>
        <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search emojis..." style={{ width: '100%', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, padding: '6px 10px', outline: 'none', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" }} />
      </div>

      {/* Category tabs */}
      {!search && (
        <div style={{ display: 'flex', padding: '2px 6px', gap: 1, borderBottom: `1px solid ${T.bd}`, overflowX: 'auto' }}>
          {visibleTabs.map(c => (
            <div key={c} onClick={() => setCat(c)} title={c} style={{ flex: '0 0 auto', minWidth: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 2px', cursor: 'pointer', fontSize: 13, borderBottom: cat === c ? `2px solid ${T.ac}` : '2px solid transparent', opacity: cat === c ? 1 : 0.5, transition: 'opacity .15s' }}>{CAT_ICONS[c]}</div>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px' }}>
        {/* Search results */}
        {searchResults && (
          <>
            {searchResults.unicode.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 4 }}>Results</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {searchResults.unicode.map((e, i) => emojiCell(e, i))}
                </div>
              </>
            )}
            {searchResults.custom.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginTop: 8, marginBottom: 4 }}>Custom</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {searchResults.custom.map(ce => customCell(ce))}
                </div>
              </>
            )}
            {searchResults.unicode.length === 0 && searchResults.custom.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 12 }}>No emoji found for "{search}"</div>
            )}
          </>
        )}

        {/* Recent tab */}
        {showRecent && recentShow && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase' }}>Recently Used</span>
              {recent.length > 0 && (
                <span onClick={() => { setRecent([]); saveRecent([]); }} style={{ fontSize: 10, color: T.mt, cursor: 'pointer', padding: '2px 6px', borderRadius: 3 }}
                  onMouseEnter={e => e.currentTarget.style.color = T.err}
                  onMouseLeave={e => e.currentTarget.style.color = T.mt}>Reset</span>
              )}
            </div>
            {recent.length === 0 && <div style={{ textAlign: 'center', padding: 16, color: T.mt, fontSize: 12 }}>No recently used emoji yet</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {recent.map((e, i) => emojiCell(e, i))}
            </div>
          </>
        )}
        {showRecent && !recentShow && (
          <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 12 }}>
            Recently Used Emoji is disabled in Settings &gt; Appearance.
          </div>
        )}

        {/* Custom emoji tab */}
        {showCustom && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 4 }}>Server Emoji — {customEmoji.length}/50</div>
            {customEmoji.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 12 }}>No custom emoji. Server owners can upload them in Server Settings.</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {customEmoji.map(ce => customCell(ce))}
            </div>
          </>
        )}

        {/* Standard category */}
        {showCategory && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 4 }}>{cat}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {currentEmojis.map((e, i) => emojiCell(e, i))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 10px', borderTop: `1px solid ${T.bd}`, fontSize: 10, color: T.mt, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{CATEGORY_KEYS.reduce((s, c) => s + EMOJI_DATA[c].emojis.length, 0)} emoji{customEmoji.length ? ` + ${customEmoji.length} custom` : ''}</span>
        <span onClick={() => { setRecent([]); saveRecent([]); }} style={{ cursor: 'pointer', padding: '1px 4px', borderRadius: 3 }}
          onMouseEnter={e => e.currentTarget.style.color = T.err}
          onMouseLeave={e => e.currentTarget.style.color = T.mt}>Clear recent</span>
      </div>
    </div>
  );
}
