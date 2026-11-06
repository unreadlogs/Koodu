import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { actionArgsSchemas } from '@koodu/protocol';
import {
  createActionRegistry,
  createAuditLog,
  createDispatcher,
  createEventBus,
  createIdFactory,
  defineAction,
  type ActionResult,
} from './index';

interface Ctx {
  executed: string[];
}

function build(
  options: { execute?: (args: unknown, ctx: Ctx) => ActionResult | Promise<ActionResult> } = {},
) {
  const bus = createEventBus({ now: () => 1000 });
  const audit = createAuditLog(50);
  const ctx: Ctx = { executed: [] };
  const registry = createActionRegistry<Ctx>([
    defineAction({
      name: 'open_tab',
      argsSchema: actionArgsSchemas.open_tab,
      execute: (args, context) => {
        context.executed.push('open_tab');
        return options.execute
          ? options.execute(args, context)
          : { ok: true, message: `opened ${args.route}` };
      },
    }),
    defineAction({
      name: 'close_tab',
      argsSchema: actionArgsSchemas.close_tab,
      execute: () => {
        ctx.executed.push('close_tab');
        return { ok: true, message: 'closed' };
      },
    }),
    defineAction({
      name: 'spawn_subagent',
      argsSchema: actionArgsSchemas.spawn_subagent,
      execute: () => {
        ctx.executed.push('spawn_subagent');
        return { ok: true, message: 'spawned' };
      },
    }),
    defineAction({
      name: 'get_active_tab',
      argsSchema: actionArgsSchemas.get_active_tab,
      execute: () => {
        ctx.executed.push('get_active_tab');
        return { ok: true, message: 'tab', data: { id: 't1' } };
      },
    }),
  ]);

  const dispatcher = createDispatcher<Ctx>({
    registry,
    bus,
    audit,
    context: () => ctx,
    now: () => 1000,
    newId: createIdFactory(),
    timeoutMs: 50,
  });

  return { bus, audit, ctx, dispatcher };
}

describe('dispatch validation', () => {
  it('denies unknown actions', async () => {
    const { dispatcher, audit } = build();
    const outcome = await dispatcher.dispatch({
      action: 'format_disk',
      args: {},
      source: 'local',
    });
    expect(outcome).toMatchObject({ status: 'denied', reason: 'unknown_action' });
    expect(audit.all().at(-1)?.decision).toBe('denied');
  });

  it('denies invalid args before executing', async () => {
    const { dispatcher, ctx, audit } = build();
    const outcome = await dispatcher.dispatch({
      action: 'open_tab',
      args: { route: '/admin' },
      source: 'local',
    });
    expect(outcome).toMatchObject({ status: 'denied', reason: 'invalid_args' });
    expect(ctx.executed).toHaveLength(0);
    expect(audit.all().at(-1)?.risk).toBe('safe');
  });

  it('blocks local proposals for cloud-only actions', async () => {
    const { dispatcher, ctx, bus } = build();
    const outcome = await dispatcher.dispatch({
      action: 'spawn_subagent',
      args: { agentType: 'coding', task: 'refactor everything' },
      source: 'local',
    });
    expect(outcome).toMatchObject({ status: 'denied', reason: 'not_local_allowed' });
    expect(ctx.executed).toHaveLength(0);
    expect(bus.history().at(-1)?.type).toBe('action.denied');
  });

  it('runs target validation hooks', async () => {
    const bus = createEventBus({ now: () => 1 });
    const registry = createActionRegistry<Ctx>([
      defineAction({
        name: 'close_tab',
        argsSchema: actionArgsSchemas.close_tab,
        validate: () => 'unknown_tab',
        execute: () => ({ ok: true, message: 'nope' }),
      }),
    ]);
    const dispatcher = createDispatcher<Ctx>({
      registry,
      bus,
      context: () => ({ executed: [] }),
      now: () => 1,
    });
    const outcome = await dispatcher.dispatch({
      action: 'close_tab',
      args: {},
      source: 'user',
      approved: true,
    });
    expect(outcome).toMatchObject({ status: 'denied', reason: 'target_invalid' });
  });
});

describe('approval gate', () => {
  it('stops confirm actions and asks for approval', async () => {
    const { dispatcher, ctx, bus } = build();
    const outcome = await dispatcher.dispatch({
      action: 'close_tab',
      args: {},
      source: 'local',
    });
    expect(outcome).toMatchObject({ status: 'needs_approval', risk: 'confirm' });
    expect(ctx.executed).toHaveLength(0);
    expect(bus.history().map((e) => e.type)).toContain('action.approval.requested');
  });

  it('executes after explicit approval', async () => {
    const { dispatcher, ctx } = build();
    const outcome = await dispatcher.dispatch({
      action: 'close_tab',
      args: {},
      source: 'user',
      approved: true,
    });
    expect(outcome.status).toBe('ok');
    expect(ctx.executed).toEqual(['close_tab']);
  });

  it('never auto-approves dangerous actions', async () => {
    const { dispatcher } = build();
    const outcome = await dispatcher.dispatch({
      action: 'spawn_subagent',
      args: { agentType: 'coding', task: 'do things' },
      source: 'cloud',
    });
    expect(outcome).toMatchObject({ status: 'needs_approval', risk: 'dangerous' });
  });
});

describe('dispatch lifecycle', () => {
  it('publishes started then completed with correlated causation', async () => {
    const { dispatcher, bus } = build();
    const outcome = await dispatcher.dispatch({
      action: 'open_tab',
      args: { route: '/workspace/usage' },
      source: 'local',
    });
    expect(outcome.status).toBe('ok');

    const types = bus.history().map((event) => event.type);
    expect(types).toEqual(['action.started', 'action.completed']);

    const [started, completed] = bus.history();
    expect(completed?.correlationId).toBe(started?.correlationId);
    expect(completed?.causationId).toBe(started?.id);
  });

  it('publishes handler events after started', async () => {
    const { dispatcher, bus } = build({
      execute: () => ({
        ok: true,
        message: 'opened',
        events: [
          {
            type: 'workspace.tab.opened',
            payload: { tabId: 't1', route: '/workspace/usage', title: 'Usage' },
          },
        ],
      }),
    });
    await dispatcher.dispatch({
      action: 'open_tab',
      args: { route: '/workspace/usage' },
      source: 'local',
    });
    expect(bus.history().map((e) => e.type)).toEqual([
      'action.started',
      'workspace.tab.opened',
      'action.completed',
    ]);
    const handlerEvent = bus.history()[1];
    expect(handlerEvent?.causationId).toBe(bus.history()[0]?.id);
  });

  it('reports failures without throwing', async () => {
    const { dispatcher, audit, bus } = build({
      execute: () => {
        throw new Error('boom');
      },
    });
    const outcome = await dispatcher.dispatch({
      action: 'open_tab',
      args: { route: '/workspace/usage' },
      source: 'user',
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'boom' });
    expect(bus.history().map((e) => e.type)).toEqual(['action.started', 'action.failed']);
    expect(audit.all().at(-1)?.decision).toBe('failed');
  });

  it('times out a hanging action', async () => {
    vi.useFakeTimers();
    try {
      const { dispatcher } = build({
        execute: () => new Promise(() => undefined),
      });
      const pending = dispatcher.dispatch({
        action: 'open_tab',
        args: { route: '/workspace/usage' },
        source: 'user',
      });
      await vi.advanceTimersByTimeAsync(60);
      const outcome = await pending;
      expect(outcome).toMatchObject({ status: 'failed', reason: 'action_timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('registry', () => {
  it('rejects duplicate action names', () => {
    expect(() =>
      createActionRegistry<Ctx>([
        defineAction({
          name: 'get_active_tab',
          argsSchema: actionArgsSchemas.get_active_tab,
          execute: () => ({ ok: true, message: 'a' }),
        }),
        defineAction({
          name: 'get_active_tab',
          argsSchema: actionArgsSchemas.get_active_tab,
          execute: () => ({ ok: true, message: 'b' }),
        }),
      ]),
    ).toThrow(/duplicate_action/);
  });

  it('keeps argument schemas authoritative', () => {
    const { dispatcher } = build();
    expect(dispatcher.registry.get('open_tab')?.argsSchema.safeParse({ route: 'usage' }).success).toBe(
      false,
    );
    expect(z.string().safeParse('ok').success).toBe(true);
  });
});

describe('event bus', () => {
  it('guards against same-type reentrancy', () => {
    const bus = createEventBus();
    bus.subscribe('system.notice', () => {
      bus.publish({ type: 'system.notice', payload: { level: 'info', message: 'loop' } });
    });
    expect(() =>
      bus.publish({ type: 'system.notice', payload: { level: 'info', message: 'first' } }),
    ).toThrow(/event_loop/);
  });

  it('isolates listener errors', () => {
    const bus = createEventBus({ onListenerError: () => undefined });
    bus.subscribe('system.notice', () => {
      throw new Error('listener boom');
    });
    const seen = vi.fn();
    bus.subscribe('system.notice', seen);
    expect(() =>
      bus.publish({ type: 'system.notice', payload: { level: 'info', message: 'ok' } }),
    ).not.toThrow();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('caps history', () => {
    const bus = createEventBus({ historyLimit: 2 });
    for (let index = 0; index < 5; index += 1) {
      bus.publish({ type: 'system.notice', payload: { level: 'info', message: String(index) } });
    }
    expect(bus.history()).toHaveLength(2);
  });
});
