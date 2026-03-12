import React from 'react';
import ReactDOM from 'react-dom/client';
import { initCrypto } from './crypto/mls';
import './i18n/i18n';

// Initialize MLS WASM module before rendering
initCrypto().then(() => {
  console.log('[main] Crypto initialized, rendering app...');
}).catch(() => {
  console.warn('[main] WASM crypto unavailable, using legacy mode');
});

// Detect /meet/:code URL (e.g. /meet/ABC123)
const _meetMatch = window.location.pathname.match(/\/meet\/([A-Za-z0-9]{4,})/);
const _meetCode  = _meetMatch?.[1] ?? null;

const App = React.lazy(() => import('./App'));
const GuestMeetingJoin = React.lazy(() =>
  import('./components/GuestMeetingJoin').then(m => ({ default: m.GuestMeetingJoin }))
);

const Spinner = (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', flexDirection:'column', gap:16, background:'#07090f', color:'#e0e4ea' }}>
    <div style={{ width:32, height:32, border:'3px solid #1a1d2e', borderTop:'3px solid #00d4aa', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    <div style={{ fontSize:14, color:'#666b7a' }}>Loading Discreet...</div>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={Spinner}>
      {_meetCode
        ? <GuestMeetingJoin code={_meetCode} />
        : <App />
      }
    </React.Suspense>
  </React.StrictMode>,
);
