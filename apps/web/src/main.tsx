import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './components/AppShell';
import { createApp } from './app/createApp';
import { attachFrameBridge } from './app/frameBridge';
import { FrameApp } from './frame/FrameApp';
import { AuthPage } from './pages/AuthPage';
import { checkAuth } from './app/auth';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

const root = createRoot(container);
const params = new URLSearchParams(window.location.search);
const isFrame = params.get('frame') === '1';
const path = window.location.pathname;

// Direct /session/auth route (SPA, no router needed)
if (path === '/session/auth') {
  root.render(
    <StrictMode>
      <AuthPage />
    </StrictMode>,
  );
} else if (isFrame) {
  root.render(
    <StrictMode>
      <FrameApp />
    </StrictMode>,
  );
} else {
  // Auth gate: if server requires auth and no token, checksum first
  function Gate() {
    const [state, setState] = useState<'checking' | 'ok' | 'auth'>('checking');

    useEffect(() => {
      checkAuth().then((r) => {
        if (r.required && !r.authenticated) {
          setState('auth');
        } else {
          setState('ok');
        }
      });
    }, []);

    if (state === 'checking') {
      return (
        <div className="flex h-full items-center justify-center bg-slate-950">
          <p className="text-sm text-slate-400">Checking session…</p>
        </div>
      );
    }
    if (state === 'auth') {
      window.location.assign('/session/auth');
      return null;
    }
    const app = createApp();
    const bridge = attachFrameBridge(app, window, window.location.origin);
    void app.start();
    return <AppShell app={app} bridge={bridge} />;
  }

  root.render(
    <StrictMode>
      <Gate />
    </StrictMode>,
  );
}
