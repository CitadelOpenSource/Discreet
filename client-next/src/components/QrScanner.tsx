/**
 * QrScanner — Camera-based QR code scanner using BarcodeDetector API.
 *
 * Uses the browser's BarcodeDetector API (Chrome 83+, Edge, Opera) with
 * fallback to manual text input for unsupported browsers.
 * No npm dependencies — purely native browser APIs.
 */
import React, { useEffect, useRef, useState } from 'react';
import { T } from '../theme';

export interface QrScannerProps {
  /** Called when a QR code is successfully scanned */
  onScan: (data: string) => void;
  /** Called when the user wants to close the scanner */
  onClose: () => void;
}

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(true);
  const [manualInput, setManualInput] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(true);

  useEffect(() => {
    // Check if BarcodeDetector is available
    if (!('BarcodeDetector' in window)) {
      setSupported(false);
      return;
    }

    let animFrame: number;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Start scanning loop
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
        const scan = async () => {
          if (!scanningRef.current || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              scanningRef.current = false;
              onScan(barcodes[0].rawValue);
              return;
            }
          } catch { /* frame not ready yet */ }
          animFrame = requestAnimationFrame(scan);
        };
        scan();
      } catch (e) {
        setError('Camera access denied. Use manual input below.');
        setSupported(false);
      }
    };

    startCamera();

    return () => {
      scanningRef.current = false;
      cancelAnimationFrame(animFrame);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [onScan]);

  // Camera view
  if (supported && !error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 280, height: 280, borderRadius: 12, overflow: 'hidden', border: `2px solid ${T.ac}` }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
          {/* Scan overlay */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ width: 180, height: 180, border: `2px solid ${T.ac}88`, borderRadius: 8 }} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: T.mt, textAlign: 'center' }}>
          Point your camera at a Discreet invite QR code
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <button onClick={onClose} style={{ padding: '6px 16px', fontSize: 12, borderRadius: 8, cursor: 'pointer', background: T.sf2, color: T.mt, border: `1px solid ${T.bd}` }}>
          Cancel
        </button>
      </div>
    );
  }

  // Fallback: manual paste
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: T.mt }}>
        {error || 'QR scanning is not supported in this browser. Paste the QR data below:'}
      </div>
      <textarea
        value={manualInput}
        onChange={e => setManualInput(e.target.value)}
        placeholder='Paste QR code data (JSON)...'
        rows={4}
        style={{ width: '100%', padding: '8px 12px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 12, resize: 'vertical', fontFamily: "'JetBrains Mono',monospace", boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => { if (manualInput.trim()) onScan(manualInput.trim()); }}
          style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: T.ac, color: '#000', border: 'none' }}
        >
          Submit
        </button>
        <button onClick={onClose} style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, cursor: 'pointer', background: T.sf2, color: T.mt, border: `1px solid ${T.bd}` }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
