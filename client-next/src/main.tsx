import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
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

// Detect /app/privacy, /app/terms, /app/tiers routes
const _path = window.location.pathname.replace(/\/+$/, '');
const _isPrivacy = _path === '/app/privacy';
const _isTerms   = _path === '/app/terms';
const _isTiers   = _path === '/app/tiers';

const App = React.lazy(() => import('./App'));
const GuestMeetingJoin = React.lazy(() =>
  import('./components/GuestMeetingJoin').then(m => ({ default: m.GuestMeetingJoin }))
);
const PrivacyPolicy = React.lazy(() => import('./components/PrivacyPolicy'));
const TermsOfService = React.lazy(() => import('./components/TermsOfService'));
const TierComparisonPage = React.lazy(() =>
  import('./components/TierComparisonPage').then(m => ({ default: m.TierComparisonPage }))
);

const Spinner = (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', flexDirection:'column', gap:16, background:'#07090f', color:'#e0e4ea' }}>
    <div style={{ width:32, height:32, border:'3px solid #1a1d2e', borderTop:'3px solid #00d4aa', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    <div style={{ fontSize:14, color:'#666b7a' }}>Loading Discreet...</div>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={Spinner}>
        {_isPrivacy
          ? <PrivacyPolicy />
          : _isTerms
          ? <TermsOfService />
          : _isTiers
          ? <TierComparisonPage onBack={() => window.history.back()} isGuest />
          : _meetCode
          ? <GuestMeetingJoin code={_meetCode} />
          : <App />
        }
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
