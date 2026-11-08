import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createServer } from './server';
import { readConfig } from './config';
import { initializeDatabase } from './storage/database';
import type { InferenceRuntime } from './inference/types';

type WsResponse = { type: string; id?: string; ok?: boolean; result?: any; error_code?: string };

function wsClient(url: string) {
  const socket = new WebSocket(url);
  const waiters = new Map<string, (message: WsResponse) => void>();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as WsResponse;
    if (message.id && waiters.has(message.id)) {
      waiters.get(message.id)!(message);
      waiters.delete(message.id);
    }
  });
  const connected = new Promise<void>((resolve) => socket.on('open', () => resolve()));
  async function request(method: string, payload: unknown): Promise<WsResponse> {
    await connected;
    const id = `req-${Math.random().toString(36).slice(2)}`;
    const done = new Promise<WsResponse>((resolve) => waiters.set(id, resolve));
    socket.send(JSON.stringify({ type: 'request', id, method, payload }));
    return done;
  }
  return { request, close: () => socket.close() };
}

const fakeRuntime = (reply: string): InferenceRuntime => ({
  id: 'fake-cloud',
  kind: 'cloud',
  model: 'fake-model',
  configured: () => true,
  complete: async () => ({ provider: 'fake-cloud', confidence: 1, proposal: null, reply }),
});

describe('agent.resume over WebSocket', () => {
  let app: FastifyInstance | null = null;
  let client: ReturnType<typeof wsClient> | null = null;

  afterEach(async () => {
    client?.close();
    client = null;
    await app?.close();
    app = null;
  });

  async function start(database: Database.Database) {
    const config = readConfig({} as Record<string, string | undefined>);
    app = createServer(config, { database, cloud: fakeRuntime('resumed reply') });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    client = wsClient(address.replace('http', 'ws') + '/ws');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  function seedPausedChatTask(database: Database.Database, status = 'paused') {
    const now = new Date().toISOString();
    const conversationId = 'conversation-resume-test';
    database.prepare('INSERT INTO chat_conversations (id,title,created_at,updated_at) VALUES (?,?,?,?)').run(conversationId, 'Resume test', now, now);
    const checkpoint = {
      version: 1,
      agentType: 'organizer',
      text: 'finish the chat task',
      context: { conversationId, conversation: [{ role: 'user', content: 'finish the chat task' }] },
      observations: [],
      iteration: 0,
      toolCalls: 0,
      partialReply: '',
      createdAt: now,
    };
    const taskId = 'task-resume-test';
    database
      .prepare('INSERT INTO agent_tasks (id,agent_type,task,status,progress,created_at,updated_at,checkpoint_json) VALUES (?,?,?,?,?,?,?,?)')
      .run(taskId, 'organizer', checkpoint.text, status, 10, now, now, JSON.stringify(checkpoint));
    return { taskId, conversationId };
  }

  it('continues a paused task and stores the reply in its chat conversation', async () => {
    const database = initializeDatabase(':memory:');
    const { taskId, conversationId } = seedPausedChatTask(database);
    await start(database);

    const resumed = await client!.request('agent.resume', { taskId, role: 'cloud' });
    expect(resumed.ok).toBe(true);
    expect(resumed.result.status).toBe('completed');
    expect(resumed.result.reply).toBe('resumed reply');

    const task = await client!.request('tasks.get', { taskId });
    expect(task.result.task.status).toBe('completed');
    expect(task.result.task.checkpoint).toBeNull();

    const messages = database
      .prepare('SELECT role,content FROM chat_messages WHERE conversation_id=? ORDER BY created_at,id')
      .all(conversationId) as Array<{ role: string; content: string }>;
    expect(messages).toEqual([{ role: 'assistant', content: 'resumed reply' }]);
    database.close();
  });

  it('rejects resuming a task without a checkpoint', async () => {
    const database = initializeDatabase(':memory:');
    const { taskId } = seedPausedChatTask(database, 'completed');
    await start(database);

    const resumed = await client!.request('agent.resume', { taskId, role: 'cloud' });
    expect(resumed.ok).toBe(false);
    expect(resumed.error_code).toBe('task_not_resumable');
    database.close();
  });
});
