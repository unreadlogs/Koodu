import {
  STORAGE_KEY,
  workspaceSnapshotSchema,
  type PetState,
  type WorkspaceSnapshot,
  type WorkspaceState,
} from '@koodu/protocol';
import { migrateSnapshot } from './migrations';
import type { KeyValueStorage } from './storage';

export interface DecodedSnapshot {
  ok: boolean;
  snapshot: WorkspaceSnapshot | null;
  warnings: string[];
  reason?: string;
}

export function decodeSnapshot(raw: string | null, now: number = Date.now()): DecodedSnapshot {
  if (raw === null || raw.length === 0) {
    return { ok: false, snapshot: null, warnings: [], reason: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, snapshot: null, warnings: [], reason: 'corrupt_json' };
  }

  const migrated = migrateSnapshot(parsed, now);
  if (migrated.warnings.some((warning) => warning.startsWith('future_version'))) {
    return {
      ok: false,
      snapshot: null,
      warnings: migrated.warnings,
      reason: 'future_version',
    };
  }

  const result = workspaceSnapshotSchema.safeParse(migrated.value);
  if (!result.success) {
    return {
      ok: false,
      snapshot: null,
      warnings: migrated.warnings,
      reason: 'invalid_snapshot',
    };
  }

  return { ok: true, snapshot: result.data, warnings: migrated.warnings };
}

export function encodeSnapshot(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(snapshot);
}

export interface SaveInput {
  workspace: WorkspaceState;
  pet: Pick<PetState, 'mode' | 'position'>;
}

export interface SaveOutcome {
  ok: boolean;
  revision: number;
  reason?: string;
}

export interface PersistenceService {
  load(): DecodedSnapshot;
  save(input: SaveInput): SaveOutcome;
  clear(): void;
  revision(): number;
  durable(): boolean;
}

export interface PersistenceOptions {
  storage: KeyValueStorage;
  key?: string;
  now?: () => number;
}

export function createPersistenceService(options: PersistenceOptions): PersistenceService {
  const { storage } = options;
  const key = options.key ?? STORAGE_KEY;
  const now = options.now ?? Date.now;

  let revision = 0;

  return {
    load() {
      const decoded = decodeSnapshot(storage.read(key), now());
      revision = decoded.snapshot?.revision ?? 0;
      return decoded;
    },

    save(input) {
      revision += 1;
      const snapshot: WorkspaceSnapshot = {
        version: 1,
        revision,
        savedAt: now(),
        tabs: input.workspace.tabs,
        activeTabId: input.workspace.activeTabId,
        layout: input.workspace.layout,
        splitTabId: input.workspace.splitTabId,
        pet: { mode: input.pet.mode, position: input.pet.position },
      };
      const written = storage.write(key, encodeSnapshot(snapshot));
      return written
        ? { ok: true, revision }
        : { ok: false, revision, reason: 'write_failed' };
    },

    clear() {
      storage.remove(key);
      revision = 0;
    },

    revision() {
      return revision;
    },

    durable() {
      return storage.isDurable();
    },
  };
}
