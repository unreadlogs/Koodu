import { describe, expect, it } from 'vitest';
import {
  ACTION_POLICIES,
  actionArgsSchemas,
  localProposalSchema,
  normalizeRoute,
  parseAppEvent,
  validateInboundFrameMessage,
} from './index';

describe('normalizeRoute', () => {
  it('accepts full, relative, trailing slash and query forms', () => {
    expect(normalizeRoute('/workspace/usage')).toBe('/workspace/usage');
    expect(normalizeRoute('workspace/models')).toBe('/workspace/models');
    expect(normalizeRoute('/workspace/agents/')).toBe('/workspace/agents');
    expect(normalizeRoute('  MEMORY  ')).toBe('/workspace/memory');
    expect(normalizeRoute('/workspace/settings?tab=1')).toBe('/workspace/settings');
  });

  it('rejects anything outside the allowlist', () => {
    expect(normalizeRoute('/admin')).toBeNull();
    expect(normalizeRoute('https://evil.test/workspace/usage')).toBeNull();
    expect(normalizeRoute('')).toBeNull();
  });
});

describe('action argument schemas', () => {
  it('rejects unknown routes for open_tab', () => {
    expect(actionArgsSchemas.open_tab.safeParse({ route: '/admin' }).success).toBe(false);
    expect(actionArgsSchemas.open_tab.safeParse({ route: '/workspace/usage' }).success).toBe(true);
  });

  it('rejects free-form emotions', () => {
    expect(actionArgsSchemas.set_pet_emotion.safeParse({ emotion: 'angry' }).success).toBe(false);
    expect(actionArgsSchemas.set_pet_emotion.safeParse({ emotion: 'happy' }).success).toBe(true);
  });

  it('rejects unknown agent types', () => {
    const result = actionArgsSchemas.spawn_subagent.safeParse({
      agentType: 'root',
      task: 'do something',
    });
    expect(result.success).toBe(false);
  });
});

describe('local proposal surface', () => {
  it('cannot target orchestration actions', () => {
    expect(localProposalSchema.safeParse({ action: 'spawn_subagent', args: {} }).success).toBe(
      false,
    );
    expect(localProposalSchema.safeParse({ action: 'cancel_task', args: { taskId: 't1' } }).success).toBe(
      false,
    );
  });

  it('keeps orchestration out of local reach in policy too', () => {
    expect(ACTION_POLICIES.spawn_subagent.localAllowed).toBe(false);
    expect(ACTION_POLICIES.spawn_subagent.risk).toBe('dangerous');
    expect(ACTION_POLICIES.cancel_task.localAllowed).toBe(false);
  });
});

describe('parseAppEvent', () => {
  const valid = {
    id: 'evt_1',
    type: 'action.completed',
    version: 1,
    at: 100,
    source: 'middleware',
    correlationId: 'c1',
    causationId: null,
    payload: { action: 'open_tab', durationMs: 4, message: 'opened' },
  };

  it('accepts a well formed event', () => {
    expect(parseAppEvent(valid)?.type).toBe('action.completed');
  });

  it('drops unknown types, wrong versions and bad payloads', () => {
    expect(parseAppEvent({ ...valid, type: 'nope' })).toBeNull();
    expect(parseAppEvent({ ...valid, version: 2 })).toBeNull();
    expect(parseAppEvent({ ...valid, payload: { action: 'open_tab' } })).toBeNull();
  });
});

describe('iframe message validation', () => {
  const expected = { origin: 'https://app.test' };

  it('rejects a different origin', () => {
    const result = validateInboundFrameMessage(
      { origin: 'https://evil.test', data: { v: 1, type: 'state.request', requestId: 'r1' } },
      expected,
    );
    expect(result).toEqual({ ok: false, reason: 'origin_mismatch' });
  });

  it('rejects unknown or malformed messages', () => {
    expect(
      validateInboundFrameMessage({ origin: expected.origin, data: { hello: 1 } }, expected),
    ).toEqual({ ok: false, reason: 'schema' });

    expect(
      validateInboundFrameMessage(
        {
          origin: expected.origin,
          data: { v: 1, type: 'command.request', requestId: 'r1', action: 'format_disk', args: {} },
        },
        expected,
      ),
    ).toEqual({ ok: false, reason: 'schema' });
  });

  it('rejects a message from an unexpected window', () => {
    const result = validateInboundFrameMessage(
      { origin: expected.origin, data: { v: 1, type: 'pong', requestId: 'r1' }, source: {} },
      { ...expected, window: { other: true } },
    );
    expect(result).toEqual({ ok: false, reason: 'unexpected_source' });
  });

  it('accepts a valid command request', () => {
    const result = validateInboundFrameMessage(
      {
        origin: expected.origin,
        data: { v: 1, type: 'command.request', requestId: 'r1', action: 'open_tab', args: {} },
      },
      expected,
    );
    expect(result.ok).toBe(true);
  });
});
