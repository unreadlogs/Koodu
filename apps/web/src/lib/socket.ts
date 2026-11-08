import { rpcEventSchema, rpcHelloSchema, rpcPongSchema, rpcResponseSchema, type RpcLogEntry, type RpcMethod } from '@koodu/protocol';

export type SocketState = 'connecting' | 'online' | 'offline';
type Listener = () => void;
type AgentStreamPayload = { kind: 'delta'; text: string } | { kind: 'reset' };
type PendingRequest = { resolve: (value: any) => void; reject: (error: Error) => void; timer: number; method?: RpcMethod; onStream?: (event: AgentStreamPayload) => void };

/** One multiplexed JSON WebSocket for all application data requests. */
class KooduSocket {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: number | undefined;
  private state: SocketState = 'offline';
  private authRequired = false;
  private token: string | null = null;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private listeners = new Set<Listener>();
  private logListeners = new Set<(entry: RpcLogEntry) => void>();
  private pending = new Map<string, PendingRequest>();
  private pings = new Map<string, number>();
  private pingValue: number | null = null;

  get snapshot() { return { state: this.state, ping: this.pingValue, authRequired: this.authRequired }; }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  subscribeLogEntries(listener: (entry: RpcLogEntry) => void) { this.logListeners.add(listener); return () => this.logListeners.delete(listener); }
  connect() { this.stopped = false; if (!this.socket || this.socket.readyState === WebSocket.CLOSED) this.open(); }
  disconnect() { this.stopped = true; if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer); this.socket?.close(); }

  async request<T = any>(method: RpcMethod, payload: Record<string, unknown> = {}, options: { onStream?: (event: AgentStreamPayload) => void; timeoutMs?: number } = {}): Promise<T> {
    this.connect();
    await this.whenReady();
    if (this.pending.size >= 128) throw new Error('Too many pending WebSocket requests.');
    const id = crypto.randomUUID();
    const timeoutMs = options.timeoutMs ?? (method === 'agent.run' || method === 'agent.resume' || method === 'chats.send' ? 120_000 : 30_000);
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WebSocket request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method, onStream: options.onStream });
      try { this.socket?.send(JSON.stringify({ type: 'request', id, method, payload })); }
      catch { window.clearTimeout(timer); this.pending.delete(id); reject(new Error('WebSocket is not available.')); }
    });
  }

  ping() {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.ready) return;
    const id = crypto.randomUUID();
    this.pings.set(id, performance.now());
    this.socket.send(JSON.stringify({ type: 'ping', id, at: Date.now() }));
    window.setTimeout(() => this.pings.delete(id), 10_000);
  }

  private whenReady(): Promise<void> {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }
  private markReady() { this.ready = true; for (const resolve of this.readyWaiters.splice(0)) resolve(); this.emit(); }
  private emit() { for (const listener of this.listeners) listener(); }
  private open() {
    if (this.stopped) return;
    this.state = 'connecting'; this.ready = false; this.emit();
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.socket = socket;
    socket.onmessage = (event) => this.onMessage(socket, String(event.data));
    socket.onopen = () => { this.state = 'online'; this.emit(); };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.state = 'offline'; this.ready = false;
      for (const [id, request] of this.pending) { window.clearTimeout(request.timer); request.reject(new Error('WebSocket disconnected.')); this.pending.delete(id); }
      this.emit();
      if (!this.stopped) this.reconnectTimer = window.setTimeout(() => this.open(), 1800);
    };
  }
  private onMessage(socket: WebSocket, data: string) {
    let value: unknown;
    try { value = JSON.parse(data); } catch { return; }
    const hello = rpcHelloSchema.safeParse(value);
    if (hello.success) {
      this.authRequired = hello.data.authRequired;
      if (this.token) {
        const id = crypto.randomUUID();
        const timer = window.setTimeout(() => { this.pending.delete(id); this.token = null; this.markReady(); }, 5000);
        this.pending.set(id, { resolve: (result) => { window.clearTimeout(timer); if (!result?.authenticated) this.token = null; this.markReady(); }, reject: () => { window.clearTimeout(timer); this.token = null; this.markReady(); }, timer, method: 'auth.authenticate' });
        socket.send(JSON.stringify({ type: 'request', id, method: 'auth.authenticate', payload: { token: this.token } }));
      } else this.markReady();
      return;
    }
    const pong = rpcPongSchema.safeParse(value);
    if (pong.success) {
      const sent = this.pings.get(pong.data.id);
      if (sent !== undefined) { this.pingValue = Math.max(0, Math.round(performance.now() - sent)); this.pings.delete(pong.data.id); this.emit(); }
      return;
    }
    const event = rpcEventSchema.safeParse(value);
    if (event.success) {
      if (event.data.event === 'logs.entry') {
        for (const listener of this.logListeners) listener(event.data.payload);
      } else {
        this.pending.get(event.data.requestId)?.onStream?.(event.data.payload);
      }
      return;
    }
    const response = rpcResponseSchema.safeParse(value);
    if (!response.success) return;
    const pending = this.pending.get(response.data.id);
    if (!pending) return;
    this.pending.delete(response.data.id); window.clearTimeout(pending.timer);
    if (response.data.ok) {
      const result = response.data.result as any;
      if (result && typeof result.token === 'string') this.token = result.token;
      if (pending.method === 'auth.logout') this.token = null;
      pending.resolve(result);
    } else {
      if (response.data.error_code === 'unauthorized') this.token = null;
      pending.reject(Object.assign(new Error(response.data.error), { code: response.data.error_code, details: response.data.details }));
    }
  }
}

export const kooduSocket = new KooduSocket();
