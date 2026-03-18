/**
 * QrConnectModal — Displays a backend-generated QR code PNG with download
 * and copy-link buttons. Used for friend-connect and server invite QR codes.
 */
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';

export interface QrConnectModalProps {
  type: 'friend' | 'server';
  serverId?: string;
  onClose: () => void;
}

export function QrConnectModal({ type, serverId, onClose }: QrConnectModalProps) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let revoke = '';
    (async () => {
      try {
        const url = type === 'friend'
          ? await api.getUserQrUrl()
          : await api.getServerInviteQrUrl(serverId!);
        revoke = url;
        setQrUrl(url);
      } catch (e: any) {
        setError(e?.message || 'Failed to generate QR code');
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [type, serverId]);

  const handleDownload = () => {
    if (!qrUrl) return;
    const a = document.createElement('a');
    a.href = qrUrl;
    a.download = type === 'friend' ? 'discreet-friend-qr.png' : 'discreet-invite-qr.png';
    a.click();
  };

  const handleCopyLink = () => {
    // The QR encodes a connect URL. We reconstruct it here for clipboard.
    // The actual link will be in the QR — we just give a generic deep link.
    const base = window.location.origin;
    const text = type === 'friend'
      ? `${base}/app — Scan my Discreet QR code to connect!`
      : `${base}/app — Scan this QR code to join the server!`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return ReactDOM.createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
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
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, display: 'inline-block', marginBottom: 20 }}>
            <img src={qrUrl} alt="QR Code" style={{ width: 220, height: 220, display: 'block' }} />
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
