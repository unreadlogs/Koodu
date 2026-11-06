import { describe, expect, it, vi } from 'vitest';
import { createAgentEngine } from './index';

function build() {
  let clock = 1_000;
  let counter = 0;
  return createAgentEngine({
    now: () => (clock += 10),
    newId: (prefix) => `${prefix}_${(counter += 1)}`,
  });
}

describe('agent engine', () => {
  it('creates a queued task and emits a creation event', () => {
    const engine = build();
    const { task, events } = engine.create({ agentType: 'research', title: 'Find sources' });
    expect(task.status).toBe('queued');
    expect(events.map((event) => event.type)).toEqual(['agent.task.created']);
    expect(engine.list()).toHaveLength(1);
  });

  it('moves through running to completed with full progress', () => {
    const engine = build();
    const { task } = engine.create({ agentType: 'coding', title: 'Patch bug' });
    const running = engine.setStatus(task.id, 'running', { progress: 40 });
    expect(running?.task.progress).toBe(40);
    const done = engine.setStatus(task.id, 'completed', { result: 'ok' });
    expect(done?.task.status).toBe('completed');
    expect(done?.task.progress).toBe(100);
    expect(done?.task.result).toBe('ok');
  });

  it('clamps progress into 0..100', () => {
    const engine = build();
    const { task } = engine.create({ agentType: 'organizer', title: 'Sort' });
    expect(engine.setStatus(task.id, 'running', { progress: 500 })?.task.progress).toBe(100);
    expect(engine.setStatus(task.id, 'running', { progress: -20 })?.task.progress).toBe(0);
  });

  it('treats terminal states as final', () => {
    const engine = build();
    const { task } = engine.create({ agentType: 'memory', title: 'Curate' });
    engine.setStatus(task.id, 'completed');
    expect(engine.setStatus(task.id, 'running')).toBeNull();
    expect(engine.cancel(task.id)).toBeNull();
  });

  it('cancels a running task', () => {
    const engine = build();
    const { task } = engine.create({ agentType: 'research', title: 'Dig' });
    engine.setStatus(task.id, 'running');
    const cancelled = engine.cancel(task.id);
    expect(cancelled?.task.status).toBe('cancelled');
    expect(cancelled?.events.at(0)?.type).toBe('agent.task.updated');
  });

  it('returns null for unknown tasks', () => {
    const engine = build();
    expect(engine.get('nope')).toBeNull();
    expect(engine.setStatus('nope', 'running')).toBeNull();
    expect(engine.cancel('nope')).toBeNull();
  });

  it('notifies subscribers and survives a throwing listener', () => {
    const engine = build();
    const good = vi.fn();
    engine.subscribe(() => {
      throw new Error('bad listener');
    });
    engine.subscribe(good);
    engine.create({ agentType: 'research', title: 'x' });
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown agent types at runtime', () => {
    const engine = build();
    expect(() =>
      engine.create({ agentType: 'root' as never, title: 'nope' }),
    ).toThrow(/unknown_agent_type/);
  });
});
