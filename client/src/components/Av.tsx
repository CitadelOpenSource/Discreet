/**
 * Av — Avatar component with color fallback.
 * Shows user's avatar image if available, otherwise generates
 * a colored circle with the first letter of their name.
 */
import React, { CSSProperties } from 'react';

const AVATAR_COLORS = [
  '#5865F2', '#EB459E', '#57F287', '#ED4245', '#00d4aa',
  '#9b59b6', '#e67e22', '#1abc9c', '#3498db', '#f39c12',
];

interface AvProps {
  name: string;
  size?: number;
  color?: string;
  style?: CSSProperties;
  url?: string | null;
}

export function Av({ name, size = 32, color, style: s, url }: AvProps) {
  const bg = color || AVATAR_COLORS[((name || '?').charCodeAt(0)) % AVATAR_COLORS.length];

  if (url) {
    return (
      <div style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', flexShrink: 0, ...s }}>
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2,
      background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 700, color: '#fff', flexShrink: 0, ...s,
    }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}
