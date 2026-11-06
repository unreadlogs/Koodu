import { describe, expect, it, vi } from 'vitest';
import { createHttpProvider, createRuleProvider, routeIntent, IntentProviderError } from './index';
import { proposeWithRules } from './rules';
import type { IntentContext, IntentProvider } from './types';

const context: IntentContext = {
  activeRoute: '/workspace/usage',
  tabs: ['/workspace/usage'],
  petMode: 'embedded',
};

function propose(text: string) {
  return proposeWithRules({ text, context });
}

describe('rule provider', () => {
  const cases: Array<[string, string, unknown]> = [
    ['Open Usage', 'open_tab', { route: '/workspace/usage' }],
    ['open the models tab', 'open_tab', { route: '/workspace/models' }],
    ['show agents', 'open_tab', { route: '/workspace/agents' }],
    ['Close Agents', 'close_tab', { route: '/workspace/agents' }],
    ['close this window', 'close_tab', {}],
    ['minimize this window', 'minimize_window', {}],
    ['minimise the models tab', 'minimize_window', { route: '/workspace/models' }],
    ['maximize this tab', 'maximize_window', {}],
    ['restore my workspace', 'restore_workspace', {}],
    ['Switch pet to floating mode', 'switch_pet_mode', { mode: 'floating' }],
    ['put the pet in hidden mode', 'switch_pet_mode', { mode: 'hidden' }],
    ['make the pet happy', 'set_pet_emotion', { emotion: 'happy' }],
    ['What tab am I on?', 'get_active_tab', {}],
    ['Show active tasks', 'get_task_status', {}],
  ];

  for (const [text, action, args] of cases) {
    it(`maps "${text}" to ${action}`, () => {
      const result = propose(text);
      expect(result.proposal).toEqual({ action, args });
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.reply).toBeTruthy();
    });
  }

  it('handles politeness and fuzzy phrasing at lower confidence', () => {
    const result = propose('could you open the usage page for me please');
    expect(result.proposal).toEqual({ action: 'open_tab', args: { route: '/workspace/usage' } });
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('returns no proposal for unrelated text', () => {
    expect(propose('write me a poem about pandas').proposal).toBeNull();
    expect(propose('open the billing page').proposal).toBeNull();
    expect(propose('').proposal).toBeNull();
  });

  it('never proposes cloud-only orchestrations', () => {
    for (const text of ['spawn a coding agent', 'cancel task 12', 'delete everything']) {
      const action = propose(text).proposal?.action;
      expect(action === 'spawn_subagent' || action === 'cancel_task').toBe(false);
    }
  });
});

describe('router', () => {
  const rules = createRuleProvider();

  it('prefers rules and skips models for canonical commands', async () => {
    const local = vi.fn();
    const decision = await routeIntent(
      { text: 'Open Usage', context },
      { providers: [rules, { id: 'local', kind: 'local-model', propose: local }] },
    );
    expect(decision.source).toBe('rules');
    expect(decision.proposal).toEqual({ action: 'open_tab', args: { route: '/workspace/usage' } });
    expect(local).not.toHaveBeenCalled();
  });

  it('falls back to the server-side local model', async () => {
    const local: IntentProvider = {
      id: 'needle',
      kind: 'local-model',
      propose: () =>
        Promise.resolve({
          provider: 'needle',
          confidence: 0.8,
          proposal: { action: 'open_tab', args: { route: '/workspace/memory' } },
          reply: 'Opening memory.',
        }),
    };
    const decision = await routeIntent(
      { text: 'take me somewhere cosy', context },
      { providers: [rules, local] },
    );
    expect(decision.source).toBe('local-model');
    expect(decision.provider).toBe('needle');
  });

  it('degrades past failing providers and records why', async () => {
    const failing: IntentProvider = {
      id: 'needle',
      kind: 'local-model',
      propose: () => Promise.reject(new IntentProviderError('timeout', 'needle_timeout')),
    };
    const cloud: IntentProvider = {
      id: 'cloud',
      kind: 'cloud',
      propose: () =>
        Promise.resolve({
          provider: 'cloud',
          confidence: 0.9,
          proposal: { action: 'spawn_subagent', args: { agentType: 'research', task: 'dig' } },
          reply: 'Delegating.',
        }),
    };
    const errors: string[] = [];
    const decision = await routeIntent(
      { text: 'research this deeply', context },
      { providers: [rules, failing, cloud], onProviderError: (id, code) => errors.push(`${id}:${code}`) },
    );
    expect(decision.source).toBe('cloud');
    expect(decision.proposal?.action).toBe('spawn_subagent');
    expect(decision.notes).toContain('failed:needle:timeout');
    expect(errors).toEqual(['needle:timeout']);
  });

  it('blocks a local model that proposes an orchestration action', async () => {
    const rogue: IntentProvider = {
      id: 'needle',
      kind: 'local-model',
      propose: () =>
        Promise.resolve({
          provider: 'needle',
          confidence: 0.99,
          proposal: { action: 'spawn_subagent', args: { agentType: 'coding', task: 'x' } },
          reply: null,
        }),
    };
    const decision = await routeIntent(
      { text: 'do something', context },
      { providers: [rogue] },
    );
    expect(decision.proposal).toBeNull();
    expect(decision.notes).toContain('not_local_allowed:spawn_subagent');
  });

  it('honours localOnly mode', async () => {
    const cloud: IntentProvider = {
      id: 'cloud',
      kind: 'cloud',
      propose: () => Promise.reject(new Error('should not be called')),
    };
    const decision = await routeIntent(
      { text: 'hello', context },
      { providers: [rules, cloud], localOnly: true },
    );
    expect(decision.source).toBe('none');
    expect(decision.notes).toContain('skipped:cloud:local_only');
  });

  it('drops low confidence proposals', async () => {
    const unsure: IntentProvider = {
      id: 'needle',
      kind: 'local-model',
      propose: () =>
        Promise.resolve({
          provider: 'needle',
          confidence: 0.2,
          proposal: { action: 'open_tab', args: { route: '/workspace/usage' } },
          reply: null,
        }),
    };
    const decision = await routeIntent(
      { text: 'hmm', context },
      { providers: [unsure] },
    );
    expect(decision.proposal).toBeNull();
    expect(decision.notes.some((note) => note.startsWith('low_confidence'))).toBe(true);
  });

  it('surfaces a clarifying reply without a proposal', async () => {
    const clarifier: IntentProvider = {
      id: 'needle',
      kind: 'local-model',
      propose: () =>
        Promise.resolve({
          provider: 'needle',
          confidence: 0,
          proposal: null,
          reply: 'Cancelling tasks needs approval.',
        }),
    };
    const decision = await routeIntent({ text: 'cancel task', context }, { providers: [clarifier] });
    expect(decision.source).toBe('none');
    expect(decision.reply).toBe('Cancelling tasks needs approval.');
  });
});

describe('http provider', () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('sends text and context to the server and validates the reply', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({
        provider: 'needle',
        confidence: 0.7,
        proposal: { action: 'open_tab', args: { route: '/workspace/usage' } },
        reply: 'ok',
      }),
    );
    const provider = createHttpProvider({
      id: 'local',
      kind: 'local-model',
      url: '/api/intelligence/local',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await provider.propose({ text: 'open usage', context });
    expect(result.proposal?.action).toBe('open_tab');

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('/api/intelligence/local');
    expect(JSON.parse(String(init?.body))).toMatchObject({ text: 'open usage' });
  });

  it('maps 501 to not_configured and bad shapes to invalid_output', async () => {
    const notConfigured = createHttpProvider({
      id: 'cloud',
      kind: 'cloud',
      url: '/api/intelligence/cloud',
      fetchImpl: (async () => jsonResponse({ error: 'not_configured' }, 501)) as unknown as typeof fetch,
    });
    await expect(notConfigured.propose({ text: 'x', context })).rejects.toMatchObject({
      code: 'not_configured',
    });

    const badShape = createHttpProvider({
      id: 'local',
      kind: 'local-model',
      url: '/api/intelligence/local',
      fetchImpl: (async () => jsonResponse({ nope: true })) as unknown as typeof fetch,
    });
    await expect(badShape.propose({ text: 'x', context })).rejects.toMatchObject({
      code: 'invalid_output',
    });
  });

  it('times out instead of hanging the UI', async () => {
    const hangingFetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;

    const provider = createHttpProvider({
      id: 'local',
      kind: 'local-model',
      url: '/api/intelligence/local',
      timeoutMs: 5,
      fetchImpl: hangingFetch,
    });
    await expect(provider.propose({ text: 'x', context })).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});
