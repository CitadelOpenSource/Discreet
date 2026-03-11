/**
 * EmojiPicker — Full emoji browser with category tabs, search, and recent.
 * Two modes: full (message input) and quick (reaction picker).
 */
import React, { useState, useEffect, useRef } from 'react';
import { T } from '../theme';

// ─── Data ─────────────────────────────────────────────────

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀', '✅', '🚀'];

const EMOJI_DATA: Record<string, { icon: string; emojis: string[] }> = {
  'Smileys': { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🥱','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥺','😤','😡','😠','🤬','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
  'Gestures': { icon: '👋', emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄'] },
  'People': { icon: '👤', emojis: ['👶','👧','🧒','👦','👩','🧑','👨','👩‍🦱','🧑‍🦱','👨‍🦱','👩‍🦰','🧑‍🦰','👨‍🦰','👱‍♀️','👱','👱‍♂️','👩‍🦳','🧑‍🦳','👨‍🦳','👩‍🦲','🧑‍🦲','👨‍🦲','🧔‍♀️','🧔','🧔‍♂️','👵','🧓','👴','👲','👳‍♀️','👳','👳‍♂️','🧕','👮‍♀️','👮','💂','🕵️','👷','🫅','🤴','👸','🥷','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟'] },
  'Animals': { icon: '🐱', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒'] },
  'Nature': { icon: '🌿', emojis: ['🌸','💐','🌷','🌹','🥀','🌺','🌻','🌼','🌱','🪴','🌲','🌳','🌴','🌵','🎋','🎍','🍀','☘️','🍃','🍂','🍁','🌾','🌿','🪹','🪺','🍄','🐚','🪸','🪨','🌏','🌍','🌎','🌕','🌙','🌛','🌜','🌚','☀️','🌝','🌞','⭐','🌟','✨','🌠','🌌','☁️','⛅','⛈️','🌤️','🌥️','🌦️','🌧️','🌨️','🌩️','🌪️','🌫️','🌬️','🌀','🌈','🔥','💧','🌊','❄️','☃️','⛄','💨','🫧','💫','⚡','☔','☂️','🌡️'] },
  'Food': { icon: '🍕', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🧂','🥤','🧋','☕','🍵','🧃','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'] },
  'Travel': { icon: '✈️', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🚏','🛣️','🛤️','⛽','🚨','🚥','🚦','🛑','🚧','⚓','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🎠','🎡','🎢','🏗️','🌋','🗻','🏔️','⛰️','🏕️','🏖️','🏜️','🏝️','🏞️'] },
  'Activities': { icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤸','🤼','🤽','🤾','🤺','⛹️','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️','🎰'] },
  'Objects': { icon: '💡', emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔','🧯','🗑️','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','🩻','🩼','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡️','🧹','🧴','🧷','🧺','🧻','🪣','🧽'] },
  'Symbols': { icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','✖️','➕','➖','➗','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄'] },
  'Flags': { icon: '🏳️', emojis: ['🇺🇸','🇬🇧','🇨🇦','🇫🇷','🇩🇪','🇮🇹','🇯🇵','🇪🇺','🇷🇺','🇦🇺','🇧🇷','🇮🇳','🇨🇳','🇰🇷','🇲🇽','🇪🇸','🇦🇷','🇿🇦','🇸🇦','🇹🇷','🇮🇩','🇳🇬','🇪🇬','🇵🇰','🇧🇩','🇵🇭','🇻🇳','🇹🇭','🇲🇾','🇸🇬','🇳🇿','🇮🇱','🇦🇪','🇰🇪','🇨🇱','🇨🇴','🇵🇪','🇻🇪','🇺🇦','🇵🇱','🇳🇱','🇧🇪','🇨🇭','🇦🇹','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇮🇪','🇵🇹','🇬🇷','🇨🇿','🇭🇺','🇷🇴','🇭🇷','🇷🇸','🇧🇬','🇸🇰','🇱🇹','🇱🇻','🇪🇪','🇬🇪','🇦🇲','🇦🇿','🇰🇿','🇺🇿','🇶🇦','🇰🇼','🇧🇭','🇴🇲','🇯🇴','🇱🇧','🇮🇶','🇮🇷','🇦🇫','🇱🇾','🇹🇳','🇲🇦','🇩🇿','🇬🇭','🇹🇿','🇪🇹','🇺🇬','🇨🇲','🇨🇮','🇸🇳','🇲🇬','🇲🇿','🇿🇼','🇧🇼','🇳🇦','🇷🇼','🇨🇩','🇲🇱','🇧🇫','🇳🇪','🇹🇩','🇨🇷','🇵🇦','🇪🇨','🇧🇴','🇵🇾','🇺🇾','🇭🇳','🇬🇹','🇸🇻','🇳🇮','🇨🇺','🇩🇴','🇭🇹','🇯🇲','🇹🇹','🇧🇸','🇧🇧','🇱🇰','🇳🇵','🇲🇲','🇰🇭','🇱🇦','🇲🇳','🇰🇵','🇹🇼','🇭🇰','🇲🇴','🇫🇯','🇵🇬','🇼🇸','🇹🇴','🇲🇻','🇧🇳','🇹🇱','🇨🇾','🇲🇹','🇱🇺','🇮🇸','🇦🇱','🇲🇰','🇲🇪','🇧🇦','🇽🇰','🇲🇩','🇧🇾','🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️'] },
};

const EMOJI_CATS = Object.keys(EMOJI_DATA);

const TOTAL_EMOJIS = EMOJI_CATS.reduce((s, c) => s + EMOJI_DATA[c].emojis.length, 0);

// ─── Component ────────────────────────────────────────────

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  full?: boolean;
}

export function EmojiPicker({ onSelect, onClose, full }: EmojiPickerProps) {
  const [cat, setCat] = useState('Smileys');
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('d_recent_emoji') || '[]'); }
    catch { return []; }
  });
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h), 50);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  useEffect(() => { if (full) inputRef.current?.focus(); }, [full]);

  const pick = (e: string) => {
    onSelect(e);
    const next = [e, ...recent.filter(x => x !== e)].slice(0, 24);
    setRecent(next);
    localStorage.setItem('d_recent_emoji', JSON.stringify(next));
    if (!full) onClose();
  };

  if (!full) return (
    <div ref={ref} style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, padding: '6px 8px', background: T.sf, borderRadius: 10, border: `1px solid ${T.bd}`, display: 'flex', gap: 2, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
      {QUICK_EMOJIS.map(e => (
        <div key={e} onClick={() => pick(e)} style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', fontSize: 16, transition: 'background .1s' }}
          onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
          onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>{e}</div>
      ))}
    </div>
  );

  const allEmojis = search
    ? EMOJI_CATS.flatMap(c => EMOJI_DATA[c].emojis).filter((e, i, a) => a.indexOf(e) === i)
    : EMOJI_DATA[cat]?.emojis || [];
  const filtered = allEmojis;

  return (
    <div ref={ref} style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, width: 352, maxHeight: 400, background: T.sf, borderRadius: 12, border: `1px solid ${T.bd}`, zIndex: 100, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 10px 4px' }}>
        <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search emojis..." style={{ width: '100%', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 12, padding: '6px 10px', outline: 'none', boxSizing: 'border-box', fontFamily: "'DM Sans',sans-serif" }} />
      </div>
      {!search && (
        <div style={{ display: 'flex', padding: '2px 6px', gap: 1, borderBottom: `1px solid ${T.bd}` }}>
          {EMOJI_CATS.map(c => (
            <div key={c} onClick={() => setCat(c)} title={c} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 0', cursor: 'pointer', fontSize: 14, borderBottom: cat === c ? `2px solid ${T.ac}` : '2px solid transparent', opacity: cat === c ? 1 : 0.5, transition: 'opacity .15s' }}>{EMOJI_DATA[c].icon}</div>
          ))}
        </div>
      )}
      {!search && recent.length > 0 && cat === 'Smileys' && localStorage.getItem('d_show_recent_emoji') !== 'false' && (
        <div style={{ padding: '6px 8px 2px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 4 }}>Recently Used</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {recent.map((e, i) => (
              <div key={i} onClick={() => pick(e)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', fontSize: 18 }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>{e}</div>
            ))}
          </div>
          <div style={{ height: 1, background: T.bd, margin: '4px 0' }} />
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px' }}>
        {!search && <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 4 }}>{cat}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {filtered.map((e, i) => (
            <div key={i} onClick={() => pick(e)} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', fontSize: 18, transition: 'transform .1s' }}
              onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(255,255,255,0.08)'; ev.currentTarget.style.transform = 'scale(1.2)'; }}
              onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; ev.currentTarget.style.transform = 'scale(1)'; }}>{e}</div>
          ))}
        </div>
      </div>
      <div style={{ padding: '4px 10px', borderTop: `1px solid ${T.bd}`, fontSize: 10, color: T.mt, textAlign: 'center' }}>
        {TOTAL_EMOJIS} emojis across {EMOJI_CATS.length} categories
      </div>
    </div>
  );
}
