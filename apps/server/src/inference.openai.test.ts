import { describe, expect, it } from 'vitest';
import { createOpenAiRuntime, parseModelOutput } from './inference/openai';
import type { InferenceRuntime } from './inference/types';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const completion = (content: string) =>
  jsonResponse({ choices: [{ message: { content } }] });

describe('parseModelOutput', () => {
  it('accepts a minimal valid proposal', () => {
    const result = parseModelOutput(
      '{"action":"open_tab","args":{"route":"/workspace/usage"},"confidence":0.9,"reply":"ok"}',
      { id: 'local-model', kind: 'local' },
    );
    expect(result.proposal).toEqual({ action: 'open_tab', args: { route: '/workspace/usage' } });
    expect(result.confidence).toBe(0.9);
  });

  it('strips markdown fences and surrounding prose', () => {
    const result = parseModelOutput(
      'Sure!\n```json\n{"action":"get_active_tab","args":{},"confidence":0.8,"reply":null}\n```',
      { id: 'local-model', kind: 'local' },
    );
    expect(result.proposal?.action).toBe('get_active_tab');
  });

  it('treats action=null as no proposal', () => {
    const result = parseModelOutput(
      '{"action":null,"args":{},"confidence":0.1,"reply":"Not sure."}',
      { id: 'local-model', kind: 'local' },
    );
    expect(result.proposal).toBeNull();
    expect(result.reply).toBe('Not sure.');
  });

  it('rejects unknown actions and malformed json', () => {
    expect(() =>
      parseModelOutput('{"action":"format_disk","args":{}}', { id: 'local-model', kind: 'local' }),
    ).toThrow(/bad_shape/);
    expect(() =>
      parseModelOutput('not json at all', { id: 'local-model', kind: 'local' }),
    ).toThrow(/not_json/);
  });

  it('drops cloud-only actions proposed by the local model', () => {
    const result = parseModelOutput(
      '{"action":"spawn_subagent","args":{"agentType":"coding","task":"x"},"confidence":1}',
      { id: 'local-model', kind: 'local' },
    );
    expect(result.proposal).toBeNull();
    expect(result.reply).toMatch(/approval/);
  });

  it('lets the cloud model propose orchestration for approval', () => {
    const result = parseModelOutput(
      '{"action":"spawn_subagent","args":{"agentType":"coding","task":"x"},"confidence":0.9}',
      { id: 'cloud', kind: 'cloud' },
    );
    expect(result.proposal?.action).toBe('spawn_subagent');
  });
});

describe('openai runtime', () => {
  it('is not configured without a base url', async () => {
    const runtime = createOpenAiRuntime({
      id: 'local',
      kind: 'local',
      baseUrl: null,
      model: 'local-model',
    });
    expect(runtime.configured()).toBe(false);
    await expect(runtime.complete({ text: 'hi', context: {} })).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('posts to the OpenAI-compatible endpoint and parses the reply', async () => {
    const captured: { url?: string; body?: unknown } = {};
    const fetchImpl = (async (url: string | URL, init?: { body?: unknown }) => {
      captured.url = String(url);
      captured.body = JSON.parse(String(init?.body));
      return completion('{"action":"open_tab","args":{"route":"/workspace/models"},"confidence":0.7}');
    }) as unknown as typeof fetch;

    const runtime = createOpenAiRuntime({
      id: 'local',
      kind: 'local',
      baseUrl: 'http://127.0.0.1:11434/v1/',
      model: 'local-model',
      fetchImpl,
    });

    const result = await runtime.complete({ text: 'open models', context: { tabs: [] } });
    expect(result.proposal?.action).toBe('open_tab');
    expect(captured?.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect((captured?.body as { model: string }).model).toBe('local-model');
  });

  it('maps upstream failures to http_error', async () => {
    const runtime = createOpenAiRuntime({
      id: 'cloud',
      kind: 'cloud',
      baseUrl: 'http://example.test/v1',
      model: 'x',
      fetchImpl: (async () => jsonResponse({ error: 'nope' }, 500)) as unknown as typeof fetch,
    });
    await expect(runtime.complete({ text: 'x', context: {} })).rejects.toMatchObject({
      code: 'http_error',
    });
  });

  it('times out slow models', async () => {
    const hanging = ((_url: string | URL, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;

    const runtime = createOpenAiRuntime({
      id: 'local',
      kind: 'local',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'local-model',
      timeoutMs: 5,
      fetchImpl: hanging,
    });
    await expect(runtime.complete({ text: 'x', context: {} })).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});

describe('server routes', () => {
  it('reports health and 501 when inference is not configured', async () => {
    const { createServer } = await import('./server');
    const { readConfig } = await import('./config');
    const app = createServer(readConfig({}));

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    const payload = health.json();
    expect(payload.inference.local.location).toBe('server');
    expect(payload.inference.local.configured).toBe(false);

    const local = await app.inject({
      method: 'POST',
      url: '/api/intelligence/local',
      payload: { text: 'open usage', context: {} },
    });
    expect(local.statusCode).toBe(501);
    expect(local.json().error).toBe('not_configured');

    const bad = await app.inject({
      method: 'POST',
      url: '/api/intelligence/local',
      payload: { text: '' },
    });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });

  it('returns a proposal from an injected runtime', async () => {
    const { createServer } = await import('./server');
    const { readConfig } = await import('./config');
    const fake: InferenceRuntime = {
      id: 'local',
      kind: 'local',
      model: 'local-model',
      configured: () => true,
      complete: async () => ({
        provider: 'local-model',
        confidence: 0.9,
        proposal: { action: 'open_tab', args: { route: '/workspace/usage' } },
        reply: 'opening',
      }),
    };
    const app = createServer(readConfig({}), { local: fake });

    const response = await app.inject({
      method: 'POST',
      url: '/api/intelligence/local',
      payload: { text: 'open usage', context: { tabs: [] } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().proposal.action).toBe('open_tab');
    await app.close();
  });

  it('only echoes CORS headers for allowed origins', async () => {
    const { createServer } = await import('./server');
    const { readConfig } = await import('./config');
    const app = createServer(readConfig({ ALLOWED_ORIGINS: 'http://localhost:5173' }));

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.test' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });
});
