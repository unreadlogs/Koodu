import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorage, type MemoryStorage } from '../engines/persistence';
import { createApp, type App, type CreateAppDeps } from './createApp';

let clock: number;
let storage: MemoryStorage;

beforeEach(() => {
  clock = 1_000_000;
  storage = createMemoryStorage();
});

function makeApp(overrides: Partial<CreateAppDeps> = {}): App {
  return createApp({
    storage,
    now: () => clock,
    tickMs: 0,
    checkHealth: false,
    ...overrides,
  });
}

describe('browser app vertical slice', () => {
  it('routes a command through rules and the dispatcher into workspace state', async () => {
    const app = makeApp();
    await app.start();

    // The empty workspace is seeded with Usage on startup.
    expect(app.store.getState().workspace.tabs.map((tab) => tab.route)).toEqual([
      '/workspace/usage',
    ]);

    const result = await app.submitCommand('Open Models');

    expect(result.status).toBe('dispatched');
    const workspace = app.store.getState().workspace;
    expect(workspace.tabs.map((tab) => tab.route)).toEqual([
      '/workspace/usage',
      '/workspace/models',
    ]);
    const active = workspace.tabs.find((tab) => tab.id === workspace.activeTabId);
    expect(active?.route).toBe('/workspace/models');

    // Pet reacted deterministically to the action lifecycle, not the model.
    expect(app.store.getState().pet).toMatchObject({
      activity: 'idle',
      emotion: 'happy',
    });

    const types = app.store.getState().events.map((event) => event.type);
    expect(types).toContain('intent.received');
    expect(types).toContain('intent.proposed');
    expect(types).toContain('action.started');
    expect(types).toContain('action.completed');

    app.stop();
  });

  it('requires explicit approval for confirm-risk actions and honours denial', async () => {
    const app = makeApp();
    await app.start();

    const requested = await app.submitCommand('Close Usage');
    expect(requested.status).toBe('needs_approval');
    expect(app.store.getState().ui.pendingApproval).toMatchObject({
      action: 'close_tab',
      risk: 'confirm',
    });
    expect(app.store.getState().workspace.tabs).toHaveLength(1);

    app.deny();
    expect(app.store.getState().workspace.tabs).toHaveLength(1);

    const again = await app.submitCommand('Close Usage');
    expect(again.status).toBe('needs_approval');
    const approved = await app.approve();

    expect(approved?.status).toBe('dispatched');
    expect(app.store.getState().workspace.tabs).toHaveLength(0);
    expect(app.store.getState().workspace.activeTabId).toBeNull();

    app.stop();
  });

  it('persists the workspace and restores it in a fresh app instance', async () => {
    const first = makeApp();
    await first.start();
    await first.submitCommand('Open Settings');
    first.flushPersistence();
    expect(storage.read('agent-harness:workspace:v1')).not.toBeNull();
    first.stop();

    const second = makeApp();
    await second.start();

    expect(second.store.getState().persistence.status).toBe('restored');
    expect(second.store.getState().workspace.tabs.map((tab) => tab.route)).toEqual([
      '/workspace/usage',
      '/workspace/settings',
    ]);
    second.stop();
  });

  it('never lets an iframe or local source run a non-local action', async () => {
    const app = makeApp();
    await app.start();

    const outcome = await app.runFrameCommand('spawn_subagent', {
      agentType: 'research',
      task: 'Summarise the workspace',
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe('not_local_allowed:spawn_subagent');
    expect(app.agents.list()).toHaveLength(0);
    expect(app.store.getState().ui.pendingApproval).toBeNull();

    app.stop();
  });

  it('rejects invalid arguments before any handler runs', async () => {
    const app = makeApp();
    await app.start();

    const outcome = await app.dispatchAction(
      'open_tab',
      { route: 'https://example.com' },
      { source: 'user' },
    );

    expect(outcome.status).toBe('denied');
    if (outcome.status === 'denied') expect(outcome.reason).toBe('invalid_args');
    expect(app.store.getState().workspace.tabs).toHaveLength(1);

    app.stop();
  });

  it('survives a failed write without losing in-memory state', async () => {
    storage.failWrites = true;
    const app = makeApp();
    await app.start();

    await app.submitCommand('Open Models');

    const state = app.store.getState();
    expect(state.workspace.tabs).toHaveLength(2);
    expect(state.persistence.status).toBe('failed');
    expect(state.ui.notice?.level).toBe('warn');

    app.stop();
  });

  it('restores the persisted pet mode and reports corrupt snapshots safely', async () => {
    const first = makeApp();
    await first.start();
    await first.dispatchAction('switch_pet_mode', { mode: 'floating' }, { source: 'user' });
    first.flushPersistence();
    first.stop();

    const second = makeApp();
    await second.start();
    expect(second.store.getState().pet.mode).toBe('floating');
    second.stop();

    const corrupt = createMemoryStorage({ 'agent-harness:workspace:v1': '{not json' });
    const third = makeApp({ storage: corrupt });
    await third.start();
    expect(third.store.getState().persistence).toMatchObject({
      status: 'failed',
      detail: 'corrupt_json',
    });
    // Safe default instead of crashing: a fresh workspace is seeded.
    expect(third.store.getState().workspace.tabs).toHaveLength(1);
    third.stop();
  });
});
