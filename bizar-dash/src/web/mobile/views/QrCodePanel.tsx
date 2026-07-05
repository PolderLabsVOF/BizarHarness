// src/mobile/views/QrCodePanel.tsx — lazy-loaded QR code panel.
// Split from MobileSettings to keep qrcode.react (~30 KB) out of the
// mobile entry chunk; it is only loaded when the user navigates to
// the Companion App section and taps "Generate QR Code".
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type PairSession = { token: string; qrPayload: string; publicUrl: string; expiresAt: number };

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function QrCodePanel({ pair, onStart }: {
  pair: PairSession;
  onStart: () => void;
}) {
  const [QRCodeSVG, setQRCodeSVG] = useState<React.ComponentType<{ value: string; size: number; level: string }> | null>(null);
  const [remaining, setRemaining] = useState(() => pair.expiresAt - Date.now());
  const expired = remaining <= 0;

  useEffect(() => {
    import('qrcode.react').then((mod) => {
      setQRCodeSVG(mod.QRCodeSVG as React.ComponentType<{ value: string; size: number; level: string }>);
    });
  }, []);

  useEffect(() => {
    if (!pair) return;
    const tick = setInterval(() => {
      setRemaining(pair.expiresAt - Date.now());
    }, 1000);
    return () => clearInterval(tick);
  }, [pair]);

  if (!QRCodeSVG) {
    return (
      <div style={{ textAlign: 'center', padding: '16px' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading QR library…</span>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ background: '#fff', padding: 12, borderRadius: 12, display: 'inline-block' }}>
        <QRCodeSVG value={pair.qrPayload} size={180} level="M" />
      </div>
      <div style={{ marginTop: 8, fontSize: 12 }}>
        Expires in <strong>{formatCountdown(remaining)}</strong>
      </div>
      <div className="mono" style={{ fontSize: 10, wordBreak: 'break-all', marginTop: 4 }}>{pair.publicUrl}</div>
      {expired && (
        <button
          type="button"
          className="mobile-btn"
          onClick={onStart}
          style={{ marginTop: 12, width: '100%' }}
        >
          <RefreshCw size={14} /> Generate new QR
        </button>
      )}
    </div>
  );
}
