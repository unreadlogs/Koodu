import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot, WorkspaceState } from '@koodu/protocol';
import {
  activateTab,
  closeTab,
  emptyWorkspace,
  openTab,
  resolveTargetTab,
  setWindowState,
  sortedTabs,
  togglePin,
  workspaceFromSnapshot,
} from './index';

const now = 1_700_000_000_000;

function openThree(): WorkspaceState {
  let state = emptyWorkspace();
  for (const [route, id] of [
    ['/workspace/usage', 't1'],
    ['/workspace/models', 't2'],
    ['/workspace/agents', 't3'],
  ] as const) {
    const result = openTab(state, { id, route, now });
    if (!result.ok) throw new Error(result.reason);
    state = result.transition.state;
  }
  return state;
}

describe('openTab', () => {
  it('opens a tab, activates it and emits one event', () => {
    const result = openTab(emptyWorkspace(), { id: 't1', route: '/workspace/usage', now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.activeTabId).toBe('t1');
    expect(result.transition.state.tabs).toHaveLength(1);
    expect(result.transition.events.map((e) => e.type)).toEqual(['workspace.tab.opened']);
  });

  it('focuses an existing route instead of duplicating it', () => {
    const state = openThree();
    const result = openTab(state, { id: 't9', route: '/workspace/usage', now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.tabs).toHaveLength(3);
    expect(result.transition.state.activeTabId).toBe('t1');
    expect(result.transition.events.map((e) => e.type)).toEqual(['workspace.tab.activated']);
  });

  it('un-minimizes when focusing an existing route', () => {
    const minimized = setWindowState(openThree(), 't1', 'minimized');
    if (!minimized.ok) throw new Error(minimized.reason);
    const result = openTab(minimized.transition.state, {
      id: 'new',
      route: '/workspace/usage',
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tab = result.transition.state.tabs.find((t) => t.id === 't1');
    expect(tab?.windowState).toBe('normal');
  });

  it('opens every route once and then only focuses', () => {
    const routes = [
      '/workspace/usage',
      '/workspace/models',
      '/workspace/agents',
      '/workspace/memory',
      '/workspace/settings',
    ] as const;
    let current = emptyWorkspace();
    for (const [index, route] of routes.entries()) {
      const result = openTab(current, { id: `tab-${index}`, route, now });
      if (!result.ok) throw new Error(result.reason);
      current = result.transition.state;
    }
    expect(current.tabs).toHaveLength(routes.length);

    const again = openTab(current, { id: 'whatever', route: '/workspace/usage', now });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.transition.state.tabs).toHaveLength(routes.length);
  });

  it('rejects duplicate tab ids for a new route', () => {
    const state = openTab(emptyWorkspace(), { id: 't1', route: '/workspace/usage', now });
    if (!state.ok) throw new Error(state.reason);
    const result = openTab(state.transition.state, {
      id: 't1',
      route: '/workspace/models',
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate_tab_id' });
  });
});

describe('targeting', () => {
  it('resolves by id, route and active tab', () => {
    const state = openThree();
    expect(resolveTargetTab(state, { tabId: 't2' }).ok).toBe(true);
    expect(resolveTargetTab(state, { route: '/workspace/agents' }).ok).toBe(true);
    const active = resolveTargetTab(state, {});
    expect(active.ok && active.tab.id).toBe('t3');
    expect(resolveTargetTab(state, { tabId: 'missing' })).toEqual({
      ok: false,
      reason: 'unknown_tab',
    });
  });

  it('reports no active tab for an empty workspace', () => {
    expect(resolveTargetTab(emptyWorkspace(), {})).toEqual({
      ok: false,
      reason: 'no_active_tab',
    });
  });
});

describe('closeTab', () => {
  it('activates the next visible tab when closing the active one', () => {
    const result = closeTab(openThree(), 't3');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.activeTabId).toBe('t1');
    expect(result.transition.state.tabs.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(result.transition.events.map((e) => e.type)).toEqual([
      'workspace.tab.closed',
      'workspace.tab.activated',
    ]);
  });

  it('skips minimized tabs when choosing the next active tab', () => {
    const minimized = setWindowState(openThree(), 't2', 'minimized');
    if (!minimized.ok) throw new Error(minimized.reason);
    const result = closeTab(minimized.transition.state, 't3');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.activeTabId).toBe('t1');
  });

  it('leaves an empty workspace when the last tab closes', () => {
    const one = openTab(emptyWorkspace(), { id: 't1', route: '/workspace/usage', now });
    if (!one.ok) throw new Error(one.reason);
    const result = closeTab(one.transition.state, 't1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.activeTabId).toBeNull();
    expect(result.transition.state.tabs).toHaveLength(0);
  });
});

describe('window state', () => {
  it('moves activation off a minimized active tab', () => {
    const result = setWindowState(openThree(), 't3', 'minimized');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.activeTabId).toBe('t1');
    const tab = result.transition.state.tabs.find((t) => t.id === 't3');
    expect(tab?.windowState).toBe('minimized');
  });

  it('activates a maximized tab', () => {
    const result = setWindowState(openThree(), 't1', 'maximized');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.activeTabId).toBe('t1');
  });

  it('has no impossible combined states', () => {
    const minimized = setWindowState(openThree(), 't1', 'minimized');
    if (!minimized.ok) throw new Error(minimized.reason);
    const maximized = setWindowState(minimized.transition.state, 't1', 'maximized');
    if (!maximized.ok) throw new Error(maximized.reason);
    const tab = maximized.transition.state.tabs.find((t) => t.id === 't1');
    expect(tab?.windowState).toBe('maximized');
  });

  it('is a no-op when the state already matches', () => {
    const result = setWindowState(openThree(), 't1', 'normal');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.events).toHaveLength(0);
  });
});

describe('ordering and pinning', () => {
  it('keeps order stable and appends new tabs', () => {
    const state = openThree();
    expect(sortedTabs(state).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    const result = openTab(state, { id: 't4', route: '/workspace/memory', now });
    if (!result.ok) throw new Error(result.reason);
    expect(sortedTabs(result.transition.state).map((t) => t.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
    ]);
  });

  it('toggles pinning', () => {
    const result = togglePin(openThree(), 't2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.state.tabs.find((t) => t.id === 't2')?.pinned).toBe(true);
  });
});

describe('workspaceFromSnapshot', () => {
  it('restores tabs, drops duplicates and repairs the active id', () => {
    const base = openThree();
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      revision: 4,
      savedAt: now,
      tabs: [...base.tabs, { ...base.tabs[0]!, id: 'dupe' }],
      activeTabId: 'gone',
      layout: 'split',
      splitTabId: 'gone',
      pet: { mode: 'floating', position: { x: 10, y: 20 } },
    };
    const { state, dropped } = workspaceFromSnapshot(snapshot);
    expect(dropped).toBe(1);
    expect(state.tabs).toHaveLength(3);
    expect(state.activeTabId).toBe('t1');
    expect(state.layout).toBe('single');
    expect(state.splitTabId).toBeNull();
  });

  it('rejects a second activation source', () => {
    const state = openThree();
    const active = state.tabs.filter((t) => t.id === state.activeTabId);
    expect(active).toHaveLength(1);
    expect(activateTab(state, 't1').ok).toBe(true);
  });
});
