import type { AppStore } from './store';
import { getAuthToken } from './auth';

export interface PingResult {
  ms: number;
  serverAt: number;
}

type WsStatus = 'closed' | 'connecting' | 'open' | 'error';

interface PendingPing {
  id: string;
  at: number;
  resolve: (r: PingResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WsClient {
  start(): void;
  stop(): void;
  ping(): Promise<PingResult>;
  status(): WsStatus;
}

/**
 * Single main WebSocket for the whole shell. Iframes talk to the parent via
 * postMessage, and the parent forwards `ws.ping` intents through this socket.
 * Server enforces auth via `?token=` query (browsers cannot set WS headers).
 */
export function createWsClient(store: AppStore, options?: { baseUrl?: string }): WsClient {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let pingCounter = 0;
  const pending = new Map<string, PendingPing>();
  const baseUrl = options?.baseUrl ?? '';

  const setStatus = (status: WsStatus, lastMs?: number) => {
    store.setState((state) => ({
      ws: {
        ...state.ws,
        status,
        ...(lastMs !== undefined ? { lastPingMs: lastMs, lastPongAt: Date.now() } : {}),
      },
    }));
  };

  const urlFor = (): string => {
    const token = getAuthToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    const port = baseUrl ? new URL(baseUrl || window.location.origin).port || window.location.port : '';
    const wsHost = port ? `${host}:${port}` : host;
    // In dev, Vite proxies /api but not /ws. Connect directly to the backend.
    // In production with a single origin, fall back to same host.
    const isDevPort = window.location.port === '5173';
    const targetPort = isDevPort ? '8787' : window.location.port;
    const base = targetPort ? `${host}:${targetPort}` : host;
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${protocol}//${base}/ws${qs}`;
  };

  const connect = () => {
    if (closed) return;
    setStatus('connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(urlFor());
    } catch {
      setStatus('error');
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.addEventListener('open', () => {
      setStatus('open');
    });

    socket.addEventListener('message', (ev) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      const m = msg as { type?: string; id?: string; serverAt?: number; at?: number };
      if (m.type === 'hello') {
        // server ready
        return;
      }
      if (m.type === 'pong' && m.id) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        const ms = Math.max(0, Date.now() - p.at);
        setStatus('open', ms);
        p.resolve({ ms, serverAt: m.serverAt ?? Date.now() });
      }
    });

    socket.addEventListener('close', () => {
      if (ws === socket) ws = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('ws_closed'));
        pending.delete(id);
      }
      if (!closed) {
        setStatus('closed');
        scheduleReconnect();
      }
    });

    socket.addEventListener('error', () => {
      setStatus('error');
    });
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1500);
  };

  return {
    start() {
      closed = false;
      connect();
    },
    stop() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('ws_stopped'));
        pending.delete(id);
      }
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    },
    status() {
      return store.getState().ws.status as WsStatus;
    },
    ping(): Promise<PingResult> {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('ws_not_open'));
          return;
        }
        const id = `ping-${++pingCounter}-${Date.now()}`;
        const at = Date.now();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('ws_timeout'));
        }, 8000);
        pending.set(id, { id, at, resolve, reject, timer });
        ws.send(JSON.stringify({ type: 'ping', id, at }));
      });
    },
  };
}
