import {
  MAX_TABS,
  WORKSPACE_ROUTE_META,
  normalizeRoute,
  type WorkspaceTab,
} from '@koodu/protocol';
import { z } from 'zod';

export const CURRENT_SNAPSHOT_VERSION = 1;

/**
 * The pre-contract shape (`path` + `active` + `minimized` booleans). Kept here
 * so migrations are testable and old browsers recover instead of resetting.
 */
export const legacySnapshotV0Schema = z.object({
  tabs: z
    .array(
      z.object({
        id: z.string().min(1),
        path: z.string(),
        title: z.string().optional(),
        active: z.boolean().optional(),
        minimized: z.boolean().optional(),
        pinned: z.boolean().optional(),
      }),
    )
    .optional(),
  activeTabId: z.string().nullable().optional(),
});

export interface MigrationOutcome {
  value: unknown;
  warnings: string[];
}

export function migrateSnapshot(input: unknown, now: number): MigrationOutcome {
  if (typeof input !== 'object' || input === null) {
    return { value: input, warnings: ['not_an_object'] };
  }
  const raw = input as Record<string, unknown>;
  const version = typeof raw.version === 'number' ? raw.version : 0;

  if (version === CURRENT_SNAPSHOT_VERSION) return { value: input, warnings: [] };
  if (version > CURRENT_SNAPSHOT_VERSION) {
    return { value: input, warnings: [`future_version:${version}`] };
  }
  if (version === 0) return migrateV0(raw, now);
  return { value: input, warnings: [`unknown_version:${version}`] };
}

function migrateV0(raw: Record<string, unknown>, now: number): MigrationOutcome {
  const legacy = legacySnapshotV0Schema.safeParse(raw);
  if (!legacy.success) {
    return { value: raw, warnings: ['unreadable_legacy'] };
  }

  const warnings: string[] = [];
  const tabs: WorkspaceTab[] = [];
  const seenRoutes = new Set<string>();

  for (const candidate of legacy.data.tabs ?? []) {
    const route = normalizeRoute(candidate.path);
    if (!route) {
      warnings.push(`dropped_route:${candidate.path}`);
      continue;
    }
    if (seenRoutes.has(route)) {
      warnings.push(`dropped_duplicate:${route}`);
      continue;
    }
    if (tabs.length >= MAX_TABS) {
      warnings.push('dropped_overflow');
      continue;
    }
    seenRoutes.add(route);
    tabs.push({
      id: candidate.id,
      route,
      title: (candidate.title ?? WORKSPACE_ROUTE_META[route].title).slice(0, 60),
      windowState: candidate.minimized ? 'minimized' : 'normal',
      pinned: candidate.pinned ?? false,
      groupId: null,
      order: tabs.length,
      createdAt: now - (tabs.length + 1) * 1_000,
    });
  }

  const legacyActive =
    legacy.data.activeTabId ?? legacy.data.tabs?.find((tab) => tab.active)?.id ?? null;
  const activeTabId =
    legacyActive && tabs.some((tab) => tab.id === legacyActive)
      ? legacyActive
      : (tabs.find((tab) => tab.windowState !== 'minimized')?.id ?? null);

  return {
    value: {
      version: CURRENT_SNAPSHOT_VERSION,
      revision: 1,
      savedAt: now,
      tabs,
      activeTabId,
      layout: 'single',
      splitTabId: null,
      pet: { mode: 'embedded', position: { x: 24, y: 24 } },
    },
    warnings,
  };
}
