/**
 * AvatarCreator — SVG avatar builder with full customization.
 * Generates a PNG via canvas and passes the data URL to onSave.
 */
import React, { useState } from 'react';
import { T } from '../theme';
import { Modal } from './Modal';

// ─── Types ───────────────────────────────────────────────

interface AvatarConfig {
  bg: string;
  skin: string;
  hair: string;
  hairStyle: string;
  eyes: string;
  eyeColor: string;
  mouth: string;
  nose: string;
  brows: string;
  glasses: string;
  hat: string;
  beard: string;
  shirt: string;
  accessory: string;
  faceShape: string;
}

export interface AvatarCreatorProps {
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

// ─── Palettes ─────────────────────────────────────────────

const SKINS  = ['#fce4d4','#f0c8a0','#d4a574','#c68642','#8d5524','#6b3a1f','#4a2511','#2d1810'];
const HAIRS  = ['#1a1a1a','#3a2518','#8b4513','#b5651d','#d4a03c','#c0392b','#e67e22','#9b59b6','#2ecc71','#3498db','#e74c3c','#f1c40f','#ecf0f1'];
const BGS    = ['#5865F2','#57F287','#FEE75C','#EB459E','#ED4245','#2d3436','#0984e3','#6c5ce7','#00b894','#fdcb6e','#e17055','#636e72','#2d3436','#dfe6e9'];
const SHIRTS = ['#7289da','#43b581','#faa61a','#f04747','#747f8d','#9b59b6','#1abc9c','#e74c3c','#2ecc71','#e91e63','#3f51b5','#ff9800'];

// ─── SVG rendering ────────────────────────────────────────

function renderSVG(cfg: AvatarConfig): string {
  const faceW = 200, faceH = 200, cx = 100, cy = 105;
  const faceR  = cfg.faceShape === 'round' ? 65 : cfg.faceShape === 'oval' ? 55 : cfg.faceShape === 'square' ? 58 : 60;
  const faceRy = cfg.faceShape === 'oval' ? 72 : cfg.faceShape === 'long' ? 75 : faceR;

  const hair = (() => {
    switch (cfg.hairStyle) {
      case 'short':    return `<ellipse cx="${cx}" cy="${cy-40}" rx="62" ry="30" fill="${cfg.hair}"/><rect x="${cx-60}" y="${cy-55}" width="120" height="25" rx="10" fill="${cfg.hair}"/>`;
      case 'medium':   return `<ellipse cx="${cx}" cy="${cy-35}" rx="65" ry="35" fill="${cfg.hair}"/><rect x="${cx-65}" y="${cy-40}" width="130" height="30" rx="8" fill="${cfg.hair}"/><ellipse cx="${cx-50}" cy="${cy+10}" rx="18" ry="40" fill="${cfg.hair}"/><ellipse cx="${cx+50}" cy="${cy+10}" rx="18" ry="40" fill="${cfg.hair}"/>`;
      case 'long':     return `<ellipse cx="${cx}" cy="${cy-30}" rx="68" ry="40" fill="${cfg.hair}"/><rect x="${cx-68}" y="${cy-30}" width="136" height="80" rx="20" fill="${cfg.hair}"/><rect x="${cx-55}" y="${cy+20}" width="20" height="50" rx="10" fill="${cfg.hair}"/><rect x="${cx+35}" y="${cy+20}" width="20" height="50" rx="10" fill="${cfg.hair}"/>`;
      case 'mohawk':   return `<rect x="${cx-12}" y="${cy-85}" width="24" height="55" rx="12" fill="${cfg.hair}"/><ellipse cx="${cx}" cy="${cy-40}" rx="15" ry="20" fill="${cfg.hair}"/>`;
      case 'curly':    return `<circle cx="${cx-30}" cy="${cy-50}" r="22" fill="${cfg.hair}"/><circle cx="${cx}" cy="${cy-55}" r="24" fill="${cfg.hair}"/><circle cx="${cx+30}" cy="${cy-50}" r="22" fill="${cfg.hair}"/><circle cx="${cx-45}" cy="${cy-30}" r="18" fill="${cfg.hair}"/><circle cx="${cx+45}" cy="${cy-30}" r="18" fill="${cfg.hair}"/><circle cx="${cx-50}" cy="${cy}" r="15" fill="${cfg.hair}"/><circle cx="${cx+50}" cy="${cy}" r="15" fill="${cfg.hair}"/>`;
      case 'buzz':     return `<ellipse cx="${cx}" cy="${cy-40}" rx="58" ry="25" fill="${cfg.hair}" opacity="0.6"/>`;
      case 'bald':     return '';
      case 'ponytail': return `<ellipse cx="${cx}" cy="${cy-40}" rx="62" ry="28" fill="${cfg.hair}"/><rect x="${cx-8}" y="${cy-20}" width="16" height="55" rx="8" fill="${cfg.hair}" transform="rotate(25,${cx},${cy})"/>`;
      case 'pigtails': return `<ellipse cx="${cx}" cy="${cy-40}" rx="62" ry="28" fill="${cfg.hair}"/><rect x="${cx-60}" y="${cy-15}" width="14" height="50" rx="7" fill="${cfg.hair}"/><rect x="${cx+46}" y="${cy-15}" width="14" height="50" rx="7" fill="${cfg.hair}"/>`;
      default: return '';
    }
  })();

  const ey = cy - 5, elx = cx - 22, erx = cx + 22;
  const eyes = (() => {
    switch (cfg.eyes) {
      case 'round':  return `<circle cx="${elx}" cy="${ey}" r="8" fill="white"/><circle cx="${erx}" cy="${ey}" r="8" fill="white"/><circle cx="${elx}" cy="${ey}" r="5" fill="${cfg.eyeColor}"/><circle cx="${erx}" cy="${ey}" r="5" fill="${cfg.eyeColor}"/><circle cx="${elx+1}" cy="${ey-1}" r="2" fill="white"/><circle cx="${erx+1}" cy="${ey-1}" r="2" fill="white"/>`;
      case 'narrow': return `<ellipse cx="${elx}" cy="${ey}" rx="10" ry="5" fill="white"/><ellipse cx="${erx}" cy="${ey}" rx="10" ry="5" fill="white"/><circle cx="${elx}" cy="${ey}" r="4" fill="${cfg.eyeColor}"/><circle cx="${erx}" cy="${ey}" r="4" fill="${cfg.eyeColor}"/>`;
      case 'big':    return `<circle cx="${elx}" cy="${ey}" r="12" fill="white"/><circle cx="${erx}" cy="${ey}" r="12" fill="white"/><circle cx="${elx}" cy="${ey+1}" r="7" fill="${cfg.eyeColor}"/><circle cx="${erx}" cy="${ey+1}" r="7" fill="${cfg.eyeColor}"/><circle cx="${elx+2}" cy="${ey-2}" r="3" fill="white"/><circle cx="${erx+2}" cy="${ey-2}" r="3" fill="white"/>`;
      case 'wink':   return `<circle cx="${elx}" cy="${ey}" r="8" fill="white"/><circle cx="${elx}" cy="${ey}" r="5" fill="${cfg.eyeColor}"/><circle cx="${elx+1}" cy="${ey-1}" r="2" fill="white"/><path d="M${erx-8} ${ey} Q${erx} ${ey+6} ${erx+8} ${ey}" stroke="${cfg.eyeColor}" stroke-width="2.5" fill="none"/>`;
      case 'sleepy': return `<path d="M${elx-8} ${ey-2} Q${elx} ${ey+5} ${elx+8} ${ey-2}" stroke="${cfg.eyeColor}" stroke-width="2.5" fill="none"/><path d="M${erx-8} ${ey-2} Q${erx} ${ey+5} ${erx+8} ${ey-2}" stroke="${cfg.eyeColor}" stroke-width="2.5" fill="none"/>`;
      default: return '';
    }
  })();

  const by = cy - 18;
  const brows = (() => {
    switch (cfg.brows) {
      case 'normal': return `<path d="M${cx-32} ${by} Q${cx-22} ${by-6} ${cx-12} ${by}" stroke="#333" stroke-width="2.5" fill="none"/><path d="M${cx+12} ${by} Q${cx+22} ${by-6} ${cx+32} ${by}" stroke="#333" stroke-width="2.5" fill="none"/>`;
      case 'angry':  return `<path d="M${cx-32} ${by-4} L${cx-12} ${by+2}" stroke="#333" stroke-width="2.5" fill="none"/><path d="M${cx+12} ${by+2} L${cx+32} ${by-4}" stroke="#333" stroke-width="2.5" fill="none"/>`;
      case 'raised': return `<path d="M${cx-32} ${by} Q${cx-22} ${by-10} ${cx-12} ${by}" stroke="#333" stroke-width="2.5" fill="none"/><path d="M${cx+12} ${by-4} Q${cx+22} ${by-14} ${cx+32} ${by-4}" stroke="#333" stroke-width="2.5" fill="none"/>`;
      case 'thick':  return `<path d="M${cx-34} ${by} Q${cx-22} ${by-8} ${cx-10} ${by}" stroke="#333" stroke-width="4" fill="none"/><path d="M${cx+10} ${by} Q${cx+22} ${by-8} ${cx+34} ${by}" stroke="#333" stroke-width="4" fill="none"/>`;
      case 'none':   return '';
      default: return '';
    }
  })();

  const my = cy + 18;
  const mouth = (() => {
    switch (cfg.mouth) {
      case 'smile':   return `<path d="M${cx-15} ${my} Q${cx} ${my+15} ${cx+15} ${my}" stroke="#333" stroke-width="2.5" fill="none"/>`;
      case 'grin':    return `<path d="M${cx-18} ${my} Q${cx} ${my+18} ${cx+18} ${my}" stroke="#333" stroke-width="2" fill="white"/>`;
      case 'neutral': return `<line x1="${cx-12}" y1="${my+3}" x2="${cx+12}" y2="${my+3}" stroke="#333" stroke-width="2.5"/>`;
      case 'open':    return `<ellipse cx="${cx}" cy="${my+5}" rx="12" ry="9" fill="#333"/><ellipse cx="${cx}" cy="${my+8}" rx="8" ry="4" fill="#c0392b"/>`;
      case 'smirk':   return `<path d="M${cx-10} ${my+3} Q${cx+5} ${my+12} ${cx+15} ${my}" stroke="#333" stroke-width="2.5" fill="none"/>`;
      case 'tongue':  return `<path d="M${cx-15} ${my} Q${cx} ${my+15} ${cx+15} ${my}" stroke="#333" stroke-width="2" fill="none"/><ellipse cx="${cx}" cy="${my+12}" rx="6" ry="8" fill="#e74c3c"/>`;
      default: return '';
    }
  })();

  const ny = cy + 8;
  const nose = (() => {
    switch (cfg.nose) {
      case 'small':   return `<circle cx="${cx}" cy="${ny}" r="3" fill="${cfg.skin}" stroke="#00000022" stroke-width="1"/>`;
      case 'pointed': return `<path d="M${cx} ${ny-5} L${cx+5} ${ny+4} L${cx-5} ${ny+4} Z" fill="${cfg.skin}" stroke="#00000022" stroke-width="1"/>`;
      case 'wide':    return `<ellipse cx="${cx}" cy="${ny+2}" rx="8" ry="4" fill="${cfg.skin}" stroke="#00000022" stroke-width="1"/>`;
      case 'button':  return `<circle cx="${cx}" cy="${ny}" r="5" fill="${cfg.skin}" stroke="#00000033" stroke-width="1.5"/>`;
      default: return '';
    }
  })();

  const gy = cy - 5;
  const glasses = (() => {
    switch (cfg.glasses) {
      case 'round':  return `<circle cx="${cx-22}" cy="${gy}" r="14" fill="none" stroke="#333" stroke-width="2.5"/><circle cx="${cx+22}" cy="${gy}" r="14" fill="none" stroke="#333" stroke-width="2.5"/><line x1="${cx-8}" y1="${gy}" x2="${cx+8}" y2="${gy}" stroke="#333" stroke-width="2"/>`;
      case 'square': return `<rect x="${cx-36}" y="${gy-10}" width="28" height="20" rx="3" fill="none" stroke="#333" stroke-width="2.5"/><rect x="${cx+8}" y="${gy-10}" width="28" height="20" rx="3" fill="none" stroke="#333" stroke-width="2.5"/><line x1="${cx-8}" y1="${gy}" x2="${cx+8}" y2="${gy}" stroke="#333" stroke-width="2"/>`;
      case 'shades': return `<rect x="${cx-38}" y="${gy-11}" width="30" height="22" rx="4" fill="#1a1a1a" stroke="#333" stroke-width="1.5"/><rect x="${cx+8}" y="${gy-11}" width="30" height="22" rx="4" fill="#1a1a1a" stroke="#333" stroke-width="1.5"/><line x1="${cx-8}" y1="${gy}" x2="${cx+8}" y2="${gy}" stroke="#333" stroke-width="2"/>`;
      default: return '';
    }
  })();

  const hat = (() => {
    switch (cfg.hat) {
      case 'beanie': return `<ellipse cx="${cx}" cy="${cy-55}" rx="60" ry="22" fill="${cfg.hair}"/><rect x="${cx-55}" y="${cy-65}" width="110" height="20" rx="10" fill="#e74c3c"/><circle cx="${cx}" cy="${cy-72}" r="6" fill="#e74c3c"/>`;
      case 'cap':    return `<path d="M${cx-55} ${cy-45} Q${cx} ${cy-80} ${cx+55} ${cy-45}" fill="#2c3e50"/><rect x="${cx-65}" y="${cy-48}" width="130" height="8" rx="4" fill="#2c3e50"/>`;
      case 'tophat': return `<rect x="${cx-28}" y="${cy-100}" width="56" height="50" rx="4" fill="#1a1a1a"/><rect x="${cx-40}" y="${cy-55}" width="80" height="10" rx="5" fill="#1a1a1a"/><rect x="${cx-28}" y="${cy-60}" width="56" height="8" rx="3" fill="#8b0000"/>`;
      case 'crown':  return `<path d="M${cx-30} ${cy-55} L${cx-35} ${cy-80} L${cx-15} ${cy-65} L${cx} ${cy-85} L${cx+15} ${cy-65} L${cx+35} ${cy-80} L${cx+30} ${cy-55} Z" fill="#f1c40f" stroke="#d4a017" stroke-width="1.5"/>`;
      default: return '';
    }
  })();

  const beard = (() => {
    switch (cfg.beard) {
      case 'stubble':  return `<rect x="${cx-30}" y="${cy+15}" width="60" height="25" rx="15" fill="${cfg.hair}" opacity="0.3"/>`;
      case 'goatee':   return `<ellipse cx="${cx}" cy="${cy+30}" rx="15" ry="18" fill="${cfg.hair}" opacity="0.7"/>`;
      case 'full':     return `<ellipse cx="${cx}" cy="${cy+25}" rx="40" ry="30" fill="${cfg.hair}" opacity="0.6"/><ellipse cx="${cx}" cy="${cy+35}" rx="30" ry="25" fill="${cfg.hair}" opacity="0.7"/>`;
      case 'mustache': return `<path d="M${cx-18} ${cy+14} Q${cx-10} ${cy+22} ${cx} ${cy+15} Q${cx+10} ${cy+22} ${cx+18} ${cy+14}" fill="${cfg.hair}" opacity="0.8"/>`;
      default: return '';
    }
  })();

  const shirt = `<path d="M${cx-55} ${faceH} Q${cx-40} ${cy+faceRy-15} ${cx} ${cy+faceRy+5} Q${cx+40} ${cy+faceRy-15} ${cx+55} ${faceH}" fill="${cfg.shirt}"/>`;

  const accessory = (() => {
    switch (cfg.accessory) {
      case 'earring_l': return `<circle cx="${cx-faceR-2}" cy="${cy+5}" r="4" fill="#f1c40f" stroke="#d4a017" stroke-width="1"/>`;
      case 'earrings':  return `<circle cx="${cx-faceR-2}" cy="${cy+5}" r="4" fill="#f1c40f" stroke="#d4a017" stroke-width="1"/><circle cx="${cx+faceR+2}" cy="${cy+5}" r="4" fill="#f1c40f" stroke="#d4a017" stroke-width="1"/>`;
      case 'scar':      return `<path d="M${cx+10} ${cy-15} L${cx+20} ${cy+15}" stroke="#c0392b" stroke-width="2" opacity="0.5"/>`;
      case 'blush':     return `<ellipse cx="${cx-28}" cy="${cy+12}" rx="10" ry="6" fill="#ff6b6b" opacity="0.25"/><ellipse cx="${cx+28}" cy="${cy+12}" rx="10" ry="6" fill="#ff6b6b" opacity="0.25"/>`;
      case 'freckles':  return `<circle cx="${cx-20}" cy="${cy+8}" r="1.5" fill="#a0522d" opacity="0.4"/><circle cx="${cx-15}" cy="${cy+5}" r="1.5" fill="#a0522d" opacity="0.4"/><circle cx="${cx-25}" cy="${cy+5}" r="1.5" fill="#a0522d" opacity="0.4"/><circle cx="${cx+20}" cy="${cy+8}" r="1.5" fill="#a0522d" opacity="0.4"/><circle cx="${cx+15}" cy="${cy+5}" r="1.5" fill="#a0522d" opacity="0.4"/><circle cx="${cx+25}" cy="${cy+5}" r="1.5" fill="#a0522d" opacity="0.4"/>`;
      default: return '';
    }
  })();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${faceW} ${faceH}" width="${faceW}" height="${faceH}">
    <rect width="${faceW}" height="${faceH}" rx="20" fill="${cfg.bg}"/>
    ${shirt}
    <ellipse cx="${cx}" cy="${cy}" rx="${faceR}" ry="${faceRy}" fill="${cfg.skin}"/>
    ${beard}
    ${hair}
    ${brows}
    ${eyes}
    ${nose}
    ${mouth}
    ${glasses}
    ${hat}
    ${accessory}
  </svg>`;
}

// ─── Sub-components ───────────────────────────────────────

interface OptRowProps {
  label: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (v: string) => void;
}

function OptRow({ label, value, options, onChange }: OptRowProps) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {options.map(o => {
          const v = typeof o === 'object' ? o.value : o;
          const lbl = typeof o === 'object' ? o.label : o;
          return (
            <div key={v} onClick={() => onChange(v)} style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', background: value === v ? T.ac + '33' : 'rgba(255,255,255,0.05)', color: value === v ? T.ac : T.mt, border: `1px solid ${value === v ? T.ac + '55' : T.bd}`, textTransform: 'capitalize', fontWeight: value === v ? 700 : 400 }}>{lbl}</div>
          );
        })}
      </div>
    </div>
  );
}

interface ColorRowProps {
  label: string;
  value: string;
  colors: string[];
  onChange: (v: string) => void;
}

function ColorRow({ label, value, colors, onChange }: ColorRowProps) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {colors.map(c => (
          <div key={c} onClick={() => onChange(c)} style={{ width: 20, height: 20, borderRadius: 10, background: c, cursor: 'pointer', border: value === c ? `2px solid ${T.ac}` : '2px solid transparent', boxSizing: 'border-box' }} />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────

export function AvatarCreator({ onSave, onClose }: AvatarCreatorProps) {
  const [cfg, setCfg] = useState<AvatarConfig>({
    bg: '#5865F2', skin: '#f0c8a0', hair: '#3a2518', hairStyle: 'short',
    eyes: 'round', eyeColor: '#3b5998', mouth: 'smile', nose: 'small',
    brows: 'normal', glasses: 'none', hat: 'none', beard: 'none',
    shirt: '#7289da', accessory: 'none', faceShape: 'round',
  });

  const set = <K extends keyof AvatarConfig>(k: K, v: AvatarConfig[K]) => setCfg(p => ({ ...p, [k]: v }));

  const svgStr = renderSVG(cfg);

  const handleSave = () => {
    const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 200, 200);
      onSave(c.toDataURL('image/png'));
    };
    img.src = svgDataUrl;
  };

  const randomize = () => {
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    setCfg({
      bg: pick(BGS), skin: pick(SKINS), hair: pick(HAIRS),
      hairStyle: pick(['short','medium','long','mohawk','curly','buzz','bald','ponytail','pigtails']),
      eyes: pick(['round','narrow','big','wink','sleepy']),
      eyeColor: pick(['#3b5998','#2ecc71','#8b4513','#1a1a1a','#2d3436','#6c5ce7','#00b894']),
      mouth: pick(['smile','grin','neutral','open','smirk','tongue']),
      nose: pick(['small','pointed','wide','button']),
      brows: pick(['normal','angry','raised','thick','none']),
      glasses: pick(['none','none','none','round','square','shades']),
      hat: pick(['none','none','none','none','beanie','cap','tophat','crown']),
      beard: pick(['none','none','none','stubble','goatee','full','mustache']),
      shirt: pick(SHIRTS),
      accessory: pick(['none','none','earring_l','earrings','scar','blush','freckles']),
      faceShape: pick(['round','oval','square','long']),
    });
  };

  return (
    <Modal title="🎨 Create Your Avatar" onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 160, height: 160, borderRadius: 16, overflow: 'hidden', border: `2px solid ${T.bd}`, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }} dangerouslySetInnerHTML={{ __html: svgStr }} />
          <button onClick={randomize} className="pill-btn" style={{ background: 'rgba(255,255,255,0.08)', color: T.ac, border: `1px solid ${T.bd}`, padding: '6px 14px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>🎲 Randomize</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: 380, paddingRight: 4 }}>
          <ColorRow label="Background" value={cfg.bg} colors={BGS} onChange={v => set('bg', v)} />
          <ColorRow label="Skin Tone" value={cfg.skin} colors={SKINS} onChange={v => set('skin', v)} />
          <OptRow label="Face Shape" value={cfg.faceShape} options={['round','oval','square','long']} onChange={v => set('faceShape', v)} />
          <OptRow label="Hair Style" value={cfg.hairStyle} options={['bald','buzz','short','medium','long','curly','mohawk','ponytail','pigtails']} onChange={v => set('hairStyle', v)} />
          <ColorRow label="Hair Color" value={cfg.hair} colors={HAIRS} onChange={v => set('hair', v)} />
          <OptRow label="Eyes" value={cfg.eyes} options={['round','narrow','big','wink','sleepy']} onChange={v => set('eyes', v)} />
          <ColorRow label="Eye Color" value={cfg.eyeColor} colors={['#3b5998','#2ecc71','#8b4513','#1a1a1a','#2d3436','#6c5ce7','#00b894']} onChange={v => set('eyeColor', v)} />
          <OptRow label="Eyebrows" value={cfg.brows} options={['none','normal','angry','raised','thick']} onChange={v => set('brows', v)} />
          <OptRow label="Nose" value={cfg.nose} options={['small','pointed','wide','button']} onChange={v => set('nose', v)} />
          <OptRow label="Mouth" value={cfg.mouth} options={['smile','grin','neutral','open','smirk','tongue']} onChange={v => set('mouth', v)} />
          <OptRow label="Beard" value={cfg.beard} options={['none','stubble','goatee','full','mustache']} onChange={v => set('beard', v)} />
          <OptRow label="Glasses" value={cfg.glasses} options={['none','round','square','shades']} onChange={v => set('glasses', v)} />
          <OptRow label="Hat" value={cfg.hat} options={['none','beanie','cap','tophat','crown']} onChange={v => set('hat', v)} />
          <ColorRow label="Shirt Color" value={cfg.shirt} colors={SHIRTS} onChange={v => set('shirt', v)} />
          <OptRow label="Extra" value={cfg.accessory} options={[{value:'none',label:'None'},{value:'earring_l',label:'Earring'},{value:'earrings',label:'Both Earrings'},{value:'blush',label:'Blush'},{value:'freckles',label:'Freckles'},{value:'scar',label:'Scar'}]} onChange={v => set('accessory', v)} />
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button onClick={handleSave} style={{ flex: 1, padding: '10px 0', background: T.ac, color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Save as Avatar</button>
        <button onClick={onClose} className="pill-btn" style={{ background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, padding: '10px 20px', fontSize: 13 }}>Cancel</button>
      </div>
    </Modal>
  );
}
