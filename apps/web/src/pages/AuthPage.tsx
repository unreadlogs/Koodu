import { useState } from 'react';
import { login } from '../app/auth';

/** Password gate — server verifies against KOODU_AUTH_PASSWORD env. */
export function AuthPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login_failed');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-950 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500 text-lg font-bold text-slate-950">K</div>
          <div>
            <h1 className="text-base font-semibold">Koodu</h1>
            <p className="text-xs uppercase tracking-widest text-slate-500">Session auth</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-slate-300">
          Enter the local password to continue. The server verifies it against the <span className="font-mono text-slate-200">KOODU_AUTH_PASSWORD</span> environment variable and returns a session key stored in local storage.
        </p>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-slate-400" htmlFor="auth-password">
          Password
        </label>
        <input
          id="auth-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
          placeholder="••••••••"
        />

        {error && (
          <p className="mt-2 rounded-md bg-rose-500/15 px-2 py-1 text-xs text-rose-200 ring-1 ring-rose-400/30">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? 'Verifying…' : 'Unlock'}
        </button>

        <p className="mt-3 text-[11px] text-slate-500">
          Key is sent as <span className="font-mono">x-koodu-auth</span> header on every API and WebSocket call. Logout clears it.
        </p>
      </form>
    </div>
  );
}
