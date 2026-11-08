import { describe, expect, it, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServer } from './server';
import { readConfig } from './config';
import { initializeDatabase } from './storage/database';

type WsResponse = { type: string; id?: string; ok?: boolean; result?: any; error_code?: string };

/** Tiny WS client for RPC round-trip tests. */
function wsClient(url: string) {
  const socket = new WebSocket(url);
  const waiters = new Map<string, (m: WsResponse) => void>();
  socket.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as WsResponse;
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)!(msg);
      waiters.delete(msg.id);
    }
  });
  const connected = new Promise<void>((resolve) => socket.on('open', () => resolve()));
  // Server sends `hello` without an id; wait one tick after open before using.
  async function request(method: string, payload: unknown): Promise<WsResponse> {
    await connected;
    const id = `req-${Math.random().toString(36).slice(2)}`;
    const done = new Promise<WsResponse>((resolve) => waiters.set(id, resolve));
    socket.send(JSON.stringify({ type: 'request', id, method, payload }));
    return done;
  }
  return { request, close: () => socket.close() };
}

describe('settings RPC over WebSocket + SQLite', () => {
  let app: FastifyInstance | null = null;
  let client: ReturnType<typeof wsClient> | null = null;

  afterEach(async () => {
    client?.close();
    client = null;
    await app?.close();
    app = null;
  });

  async function start() {
    const config = readConfig({} as Record<string, string | undefined>);
    const database = initializeDatabase(':memory:');
    app = createServer(config, { database });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    client = wsClient(address.replace('http', 'ws') + '/ws');
    // Give server hello / client hello handshake a tick.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { database };
  }

  it('returns defaults before anything is saved', async () => {
    await start();
    const res = await client!.request('settings.get', {});
    expect(res.ok).toBe(true);
    expect(res.result.settings).toMatchObject({ character: 'kumo', petMode: 'embedded', startupPage: '/' });
    expect(res.result.persistence).toBe('sqlite');
    expect(res.result.updatedAt).toBeNull();
  });

  it('persists a save in SQLite and resets to defaults', async () => {
    const { database } = await start();
    const next = { character: 'kitsu', animateCompanion: false, showCommandHint: false, startupPage: '/workspace/models', petMode: 'floating' } as const;
    const saved = await client!.request('settings.save', next);
    expect(saved.ok).toBe(true);
    expect(saved.result.settings).toEqual(next);
    expect(saved.result.updatedAt).toBeTruthy();

    const row = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('settings.preferences.v1') as { value_json: string };
    expect(JSON.parse(row.value_json)).toEqual(next);

    const loaded = await client!.request('settings.get', {});
    expect(loaded.result.settings).toEqual(next);

    const reset = await client!.request('settings.reset', {});
    expect(reset.ok).toBe(true);
    expect(reset.result.settings).toMatchObject({ character: 'kumo', petMode: 'embedded' });

    const afterReset = await client!.request('settings.get', {});
    expect(afterReset.result.settings.character).toBe('kumo');
  });

  it('rejects invalid payloads', async () => {
    await start();
    const bad = await client!.request('settings.save', { character: 'dragon', animateCompanion: true, showCommandHint: true, startupPage: '/', petMode: 'embedded' });
    expect(bad.ok).toBe(false);
    expect(bad.error_code).toBe('invalid_request');
  });
});
