import './kernel/trusted-types';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary, setupGlobalErrorHandlers } from './components/ErrorBoundary';
import { TimezoneProvider } from './hooks/TimezoneContext';
import { MobileProvider } from './contexts/MobileContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { initCrypto } from './crypto/mls';
import './i18n/i18n';
import './fonts.css';
import './skins.css';

setupGlobalErrorHandlers();

initCrypto().then(() => {
  console.log('[main] Crypto initialized');
}).catch((e) => {
  console.warn('[main] WASM crypto module failed to load — encryption requires kernel or MLS', e);
});

// Detect /meet/:code URL (e.g. /meet/ABC123)
const _meetMatch = window.location.pathname.match(/\/meet\/([A-Za-z0-9]{4,})/);
const _meetCode  = _meetMatch?.[1] ?? null;

// Detect /app/privacy, /app/terms, /app/tiers routes
const _path = window.location.pathname.replace(/\/+$/, '');
const _isPrivacy = _path === '/app/privacy';
const _isTerms   = _path === '/app/terms';
const _isTiers   = _path === '/app/tiers';
const _isSupport = _path === '/app/support';
const _isOAuthCallback = _path.startsWith('/auth/callback/');

const App = React.lazy(() => import('./App'));
const GuestMeetingJoin = React.lazy(() =>
  import('./components/GuestMeetingJoin').then(m => ({ default: m.GuestMeetingJoin }))
);
const PrivacyPolicy = React.lazy(() => import('./components/legal/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })));
const TermsOfService = React.lazy(() => import('./components/legal/TermsOfService').then(m => ({ default: m.TermsOfService })));
const TierComparisonPage = React.lazy(() =>
  import('./components/TierComparisonPage').then(m => ({ default: m.TierComparisonPage }))
);
const SupportPage = React.lazy(() => import('./pages/SupportPage'));
const OAuthCallback = React.lazy(() =>
  import('./components/AuthScreen').then(m => ({ default: m.OAuthCallback }))
);

const Spinner = (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', flexDirection:'column', gap:16, background:'inherit', color:'inherit' }}>
    <div style={{ width:32, height:32, border:'3px solid currentColor', borderTopColor:'#7C3AED', borderRadius:'50%', animation:'spin 0.8s linear infinite', opacity: 0.3 }} />
    <div style={{ fontSize:14, opacity: 0.5 }}>Loading Discreet...</div>
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
          : _isSupport
          ? <SupportPage />
          : _isOAuthCallback
          ? <OAuthCallback onAuth={() => { window.location.href = '/app'; }} />
          : _meetCode
          ? <GuestMeetingJoin code={_meetCode} />
          : <MobileProvider><LayoutProvider><TimezoneProvider><App /></TimezoneProvider></LayoutProvider></MobileProvider>
        }
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
