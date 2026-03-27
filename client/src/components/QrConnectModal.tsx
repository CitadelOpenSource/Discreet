/**
 * QrConnectModal — Displays a backend-generated QR code PNG with download
 * and copy-link buttons. Used for friend-connect and server invite QR codes.
 */
import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';

export interface QrConnectModalProps {
  type: 'friend' | 'server';
  serverId?: string;
  onClose: () => void;
}

// Module-level cache: keeps QR blob URLs alive for the session, reuses until 23h
const QR_CACHE: Record<string, { url: string; ts: number }> = {};
const QR_TTL = 23 * 60 * 60 * 1000; // 23h — slightly under server's 24h TTL

function cacheKey(type: string, serverId?: string) {
  return type === 'friend' ? 'friend' : `server-${serverId}`;
}

export function QrConnectModal({ type, serverId, onClose }: QrConnectModalProps) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = cacheKey(type, serverId);
    const cached = QR_CACHE[key];
    if (cached && Date.now() - cached.ts < QR_TTL) {
      setQrUrl(cached.url);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const url = type === 'friend'
          ? await api.getUserQrUrl()
          : await api.getServerInviteQrUrl(serverId!);
        QR_CACHE[key] = { url, ts: Date.now() };
        setQrUrl(url);
      } catch (e: any) {
        setError(e?.message || 'Failed to generate QR code');
      } finally {
        setLoading(false);
      }
    })();
    // Don't revoke cached blob URLs — they're reused across modal opens
  }, [type, serverId]);

  // Stop native mousedown from reaching document-level click-outside handlers
  // (e.g., UserProfileCard's mousedown listener that would otherwise close
  // the parent and unmount this modal when clicking inside the portal).
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('mousedown', stop);
    return () => el.removeEventListener('mousedown', stop);
  }, []);

  const connectUrl = type === 'friend'
    ? `${window.location.origin}/connect/${api.userId}`
    : `${window.location.origin}/invite/${serverId}`;

  const handleDownload = () => {
    if (!qrUrl) return;
    const a = document.createElement('a');
    a.href = qrUrl;
    a.download = type === 'friend' ? 'discreet-friend-qr.png' : 'discreet-invite-qr.png';
    a.click();
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(connectUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleQrClick = () => {
    navigator.clipboard?.writeText(connectUrl).then(() => {
      setQrCopied(true);
      setTimeout(() => setQrCopied(false), 2000);
    });
  };

  return ReactDOM.createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div ref={contentRef} onClick={e => e.stopPropagation()} style={{
        background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 16,
        padding: 28, textAlign: 'center', maxWidth: 360, width: '90%',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.tx, marginBottom: 4 }}>
          {type === 'friend' ? 'Your QR Code' : 'Server Invite QR'}
        </div>
        <div style={{ fontSize: 12, color: T.mt, marginBottom: 20 }}>
          {type === 'friend'
            ? 'Friends can scan this to add you'
            : 'Scan to join this server'}
        </div>

        {loading && (
          <div style={{ padding: 40, color: T.mt, fontSize: 13 }}>Generating...</div>
        )}
        {error && (
          <div style={{ padding: 20, color: T.err, fontSize: 13 }}>{error}</div>
        )}
        {qrUrl && (
          <div
            onClick={handleQrClick}
            style={{ background: '#fff', borderRadius: 'var(--border-radius)', padding: 16, display: 'inline-block', marginBottom: 20, cursor: 'pointer', position: 'relative' }}
            title="Click to copy link"
          >
            <img src={qrUrl} alt="QR Code" style={{ width: 220, height: 220, display: 'block' }} />
            {qrCopied && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.7)', borderRadius: 'var(--border-radius)',
                color: '#fff', fontSize: 14, fontWeight: 700,
              }}>
                Link copied!
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={handleDownload} disabled={!qrUrl} style={{
            padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.bd}`,
            background: T.sf2, color: T.tx, fontSize: 12, fontWeight: 600,
            cursor: qrUrl ? 'pointer' : 'not-allowed', opacity: qrUrl ? 1 : 0.5,
          }}>
            Download
          </button>
          <button onClick={handleCopyLink} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: `linear-gradient(135deg,${T.ac},${T.ac2})`,
            color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={onClose} style={{
            padding: '6px 20px', borderRadius: 6, border: `1px solid ${T.bd}`,
            background: 'transparent', color: T.mt, fontSize: 11, cursor: 'pointer',
          }}>Close</button>
        </div>

        <div style={{ fontSize: 10, color: T.mt, marginTop: 12 }}>
          Code expires in 24 hours
        </div>
      </div>
    </div>,
    document.body
  );
}
