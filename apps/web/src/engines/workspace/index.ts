import {
  MAX_TABS,
  WORKSPACE_ROUTE_META,
  workspaceTabSchema,
  type EventDraft,
  type WorkspaceRoute,
  type WorkspaceSnapshot,
  type WorkspaceState,
  type WorkspaceTab,
} from '@koodu/protocol';

export interface WorkspaceTransition {
  state: WorkspaceState;
  events: EventDraft[];
}

export type WorkspaceResult =
  | { ok: true; transition: WorkspaceTransition }
  | { ok: false; reason: string };

export interface TabTarget {
  tabId?: string | undefined;
  route?: WorkspaceRoute | undefined;
}

const byOrder = (a: WorkspaceTab, b: WorkspaceTab): number => a.order - b.order;

export function sortedTabs(workspace: WorkspaceState): WorkspaceTab[] {
  return [...workspace.tabs].sort(byOrder);
}

export function findTab(workspace: WorkspaceState, tabId: string): WorkspaceTab | null {
  return workspace.tabs.find((tab) => tab.id === tabId) ?? null;
}

export function findTabByRoute(
  workspace: WorkspaceState,
  route: WorkspaceRoute,
): WorkspaceTab | null {
  return workspace.tabs.find((tab) => tab.route === route) ?? null;
}

export function activeTab(workspace: WorkspaceState): WorkspaceTab | null {
  if (!workspace.activeTabId) return null;
  return findTab(workspace, workspace.activeTabId);
}

export type TargetResult =
  | { ok: true; tab: WorkspaceTab }
  | { ok: false; reason: string };

export function resolveTargetTab(
  workspace: WorkspaceState,
  target: TabTarget = {},
): TargetResult {
  if (target.tabId) {
    const tab = findTab(workspace, target.tabId);
    return tab ? { ok: true, tab } : { ok: false, reason: 'unknown_tab' };
  }
  if (target.route) {
    const tab = findTabByRoute(workspace, target.route);
    return tab ? { ok: true, tab } : { ok: false, reason: 'unknown_route' };
  }
  const current = activeTab(workspace);
  return current ? { ok: true, tab: current } : { ok: false, reason: 'no_active_tab' };
}

const nextOrder = (workspace: WorkspaceState): number =>
  workspace.tabs.reduce((max, tab) => Math.max(max, tab.order + 1), 0);

export function openTab(
  workspace: WorkspaceState,
  input: { id: string; route: WorkspaceRoute; title?: string; now: number },
): WorkspaceResult {
  const existing = findTabByRoute(workspace, input.route);
  if (existing) return activateTab(workspace, existing.id);

  if (workspace.tabs.length >= MAX_TABS) {
    return { ok: false, reason: `tab_limit_reached:${MAX_TABS}` };
  }
  if (findTab(workspace, input.id)) {
    return { ok: false, reason: 'duplicate_tab_id' };
  }

  const meta = WORKSPACE_ROUTE_META[input.route];
  const tab: WorkspaceTab = {
    id: input.id,
    route: input.route,
    title: input.title?.slice(0, 40) ?? meta.title,
    windowState: 'normal',
    pinned: false,
    groupId: null,
    order: nextOrder(workspace),
    createdAt: input.now,
  };

  const parsed = workspaceTabSchema.safeParse(tab);
  if (!parsed.success) return { ok: false, reason: 'invalid_tab' };

  return {
    ok: true,
    transition: {
      state: { ...workspace, tabs: [...workspace.tabs, tab], activeTabId: tab.id },
      events: [
        {
          type: 'workspace.tab.opened',
          payload: { tabId: tab.id, route: tab.route, title: tab.title },
        },
      ],
    },
  };
}

export function activateTab(workspace: WorkspaceState, tabId: string): WorkspaceResult {
  const tab = findTab(workspace, tabId);
  if (!tab) return { ok: false, reason: 'unknown_tab' };

  const restore = tab.windowState === 'minimized';
  if (workspace.activeTabId === tabId && !restore) {
    return { ok: true, transition: { state: workspace, events: [] } };
  }

  const tabs = workspace.tabs.map((candidate) =>
    candidate.id === tabId && restore
      ? { ...candidate, windowState: 'normal' as const }
      : candidate,
  );
  const events: EventDraft[] = [{ type: 'workspace.tab.activated', payload: { tabId } }];
  if (restore) {
    events.push({ type: 'workspace.tab.window', payload: { tabId, windowState: 'normal' } });
  }

  return {
    ok: true,
    transition: { state: { ...workspace, tabs, activeTabId: tabId }, events },
  };
}

export function closeTab(workspace: WorkspaceState, tabId: string): WorkspaceResult {
  const tab = findTab(workspace, tabId);
  if (!tab) return { ok: false, reason: 'unknown_tab' };

  const remaining = sortedTabs({ ...workspace, tabs: workspace.tabs.filter((t) => t.id !== tabId) });
  let activeTabId = workspace.activeTabId;
  const events: EventDraft[] = [{ type: 'workspace.tab.closed', payload: { tabId } }];

  if (workspace.activeTabId === tabId) {
    const next = remaining.find((t) => t.windowState !== 'minimized') ?? remaining[0] ?? null;
    activeTabId = next?.id ?? null;
    if (activeTabId) {
      events.push({ type: 'workspace.tab.activated', payload: { tabId: activeTabId } });
    }
  }

  const splitTabId = workspace.splitTabId === tabId ? null : workspace.splitTabId;
  const layout = splitTabId === null ? 'single' : workspace.layout;

  return {
    ok: true,
    transition: {
      state: { ...workspace, tabs: remaining, activeTabId, splitTabId, layout },
      events,
    },
  };
}

export function setWindowState(
  workspace: WorkspaceState,
  tabId: string,
  windowState: WorkspaceTab['windowState'],
): WorkspaceResult {
  const tab = findTab(workspace, tabId);
  if (!tab) return { ok: false, reason: 'unknown_tab' };
  if (tab.windowState === windowState) {
    return { ok: true, transition: { state: workspace, events: [] } };
  }

  const tabs = workspace.tabs.map((candidate) =>
    candidate.id === tabId ? { ...candidate, windowState } : candidate,
  );
  const events: EventDraft[] = [
    { type: 'workspace.tab.window', payload: { tabId, windowState } },
  ];
  let activeTabId = workspace.activeTabId;

  if (windowState === 'minimized') {
    if (workspace.activeTabId === tabId) {
      const next =
        tabs
          .filter((t) => t.id !== tabId && t.windowState !== 'minimized')
          .sort(byOrder)[0] ?? null;
      activeTabId = next?.id ?? null;
      if (activeTabId) {
        events.push({ type: 'workspace.tab.activated', payload: { tabId: activeTabId } });
      }
    }
  } else if (workspace.activeTabId !== tabId) {
    activeTabId = tabId;
    events.push({ type: 'workspace.tab.activated', payload: { tabId } });
  }

  return {
    ok: true,
    transition: { state: { ...workspace, tabs, activeTabId }, events },
  };
}

export function togglePin(workspace: WorkspaceState, tabId: string): WorkspaceResult {
  const tab = findTab(workspace, tabId);
  if (!tab) return { ok: false, reason: 'unknown_tab' };
  const pinned = !tab.pinned;
  return {
    ok: true,
    transition: {
      state: {
        ...workspace,
        tabs: workspace.tabs.map((candidate) =>
          candidate.id === tabId ? { ...candidate, pinned } : candidate,
        ),
      },
      events: [{ type: 'workspace.tab.pinned', payload: { tabId, pinned } }],
    },
  };
}

export function setSplit(
  workspace: WorkspaceState,
  splitTabId: string | null,
): WorkspaceResult {
  if (splitTabId !== null && !findTab(workspace, splitTabId)) {
    return { ok: false, reason: 'unknown_tab' };
  }
  const layout = splitTabId === null || splitTabId === workspace.activeTabId ? 'single' : 'split';
  return {
    ok: true,
    transition: {
      state: { ...workspace, layout, splitTabId: layout === 'split' ? splitTabId : null },
      events: [],
    },
  };
}

export function emptyWorkspace(): WorkspaceState {
  return { tabs: [], activeTabId: null, layout: 'single', splitTabId: null };
}

/**
 * Rebuilds workspace state from a persisted snapshot. Invalid, duplicate or
 * over-limit tabs are dropped instead of failing the whole restore.
 */
export function workspaceFromSnapshot(snapshot: WorkspaceSnapshot): {
  state: WorkspaceState;
  dropped: number;
} {
  let dropped = 0;
  const seenRoutes = new Set<string>();
  const tabs: WorkspaceTab[] = [];

  for (const candidate of snapshot.tabs) {
    const parsed = workspaceTabSchema.safeParse(candidate);
    if (!parsed.success || seenRoutes.has(parsed.data.route) || tabs.length >= MAX_TABS) {
      dropped += 1;
      continue;
    }
    seenRoutes.add(parsed.data.route);
    tabs.push({ ...parsed.data, order: tabs.length });
  }

  const activeTabId =
    (snapshot.activeTabId && tabs.some((tab) => tab.id === snapshot.activeTabId)
      ? snapshot.activeTabId
      : null) ??
    tabs.find((tab) => tab.windowState !== 'minimized')?.id ??
    null;

  const splitTabId =
    snapshot.splitTabId && tabs.some((tab) => tab.id === snapshot.splitTabId)
      ? snapshot.splitTabId
      : null;

  return {
    state: {
      tabs,
      activeTabId,
      layout: splitTabId && splitTabId !== activeTabId ? 'split' : 'single',
      splitTabId: splitTabId && splitTabId !== activeTabId ? splitTabId : null,
    },
    dropped,
  };
}
