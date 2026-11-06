import { AUTH_TOKEN_KEY } from '@koodu/protocol';

export const AUTH_TOKEN_STORAGE_KEY = AUTH_TOKEN_KEY;

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getApiHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { 'x-koodu-auth': token } : {};
}

/** Fetch wrapper used by all direct API calls from the browser. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getAuthToken();
  if (token) headers.set('x-koodu-auth', token);
  // Default content-type if not set and body is string
  if (init?.body && typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearAuthToken();
    if (window.location.pathname !== '/session/auth' && !window.location.search.includes('frame=1')) {
      window.location.assign('/session/auth');
    }
  }
  return res;
}

export async function checkAuth(): Promise<{ required: boolean; authenticated: boolean }> {
  try {
    const res = await fetch('/api/auth/status');
    const status = (await res.json()) as { authRequired?: boolean };
    const required = Boolean(status.authRequired);
    if (!required) return { required: false, authenticated: true };
    const token = getAuthToken();
    if (!token) return { required: true, authenticated: false };
    const me = await fetch('/api/auth/me', { headers: { 'x-koodu-auth': token } });
    if (!me.ok) return { required: true, authenticated: false };
    const body = (await me.json()) as { authenticated?: boolean };
    return { required, authenticated: Boolean(body.authenticated) };
  } catch {
    // If server unreachable, assume not required to avoid blocking UI dev
    return { required: false, authenticated: true };
  }
}

export async function login(password: string): Promise<string> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    const msg = typeof body.error === 'string' ? body.error : 'login_failed';
    throw new Error(msg);
  }
  const data = (await res.json()) as { token: string };
  setAuthToken(data.token);
  return data.token;
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: getApiHeaders(),
    });
  } catch {
    // ignore
  }
  clearAuthToken();
}
