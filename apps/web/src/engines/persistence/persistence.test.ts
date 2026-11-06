import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, type WorkspaceState } from '@koodu/protocol';
import {
  createBrowserStorage,
  createMemoryStorage,
  createPersistenceService,
  decodeSnapshot,
} from './index';

const NOW = 1_700_000_000_000;

const workspace: WorkspaceState = {
  tabs: [
    {
      id: 't1',
      route: '/workspace/usage',
      title: 'Usage',
      windowState: 'normal',
      pinned: false,
      groupId: null,
      order: 0,
      createdAt: NOW,
    },
  ],
  activeTabId: 't1',
  layout: 'single',
  splitTabId: null,
};

describe('decodeSnapshot', () => {
  it('reports an empty store without failing loudly', () => {
    expect(decodeSnapshot(null)).toEqual({
      ok: false,
      snapshot: null,
      warnings: [],
      reason: 'empty',
    });
  });

  it('reports corrupt json', () => {
    expect(decodeSnapshot('{not json').reason).toBe('corrupt_json');
  });

  it('rejects a snapshot from a newer version', () => {
    const raw = JSON.stringify({ version: 99, tabs: [] });
    expect(decodeSnapshot(raw, NOW)).toMatchObject({
      ok: false,
      reason: 'future_version',
    });
  });

  it('migrates the legacy v0 shape and repairs invalid tabs', () => {
    const raw = JSON.stringify({
      tabs: [
        { id: 'a', path: '/workspace/usage', minimized: true },
        { id: 'b', path: '/admin', title: 'Admin' },
        { id: 'c', path: 'models', active: true },
        { id: 'd', path: '/workspace/usage' },
      ],
      activeTabId: 'missing',
    });

    const decoded = decodeSnapshot(raw, NOW);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || !decoded.snapshot) return;

    expect(decoded.snapshot.version).toBe(1);
    expect(decoded.snapshot.tabs.map((tab) => tab.route)).toEqual([
      '/workspace/usage',
      '/workspace/models',
    ]);
    expect(decoded.snapshot.tabs[0]?.windowState).toBe('minimized');
    expect(decoded.snapshot.activeTabId).toBe('c');
    expect(decoded.warnings).toContain('dropped_route:/admin');
    expect(decoded.warnings).toContain('dropped_duplicate:/workspace/usage');
  });

  it('fails closed on an unreadable legacy shape', () => {
    expect(decodeSnapshot(JSON.stringify({ version: 0, tabs: 'nope' }), NOW)).toMatchObject({
      ok: false,
      reason: 'invalid_snapshot',
    });
  });
});

describe('persistence service', () => {
  it('round-trips workspace and pet state', () => {
    const storage = createMemoryStorage();
    const service = createPersistenceService({ storage, now: () => NOW });
    expect(service.load().reason).toBe('empty');

    const saved = service.save({ workspace, pet: { mode: 'floating', position: { x: 1, y: 2 } } });
    expect(saved).toEqual({ ok: true, revision: 1 });

    const decoded = service.load();
    expect(decoded.ok).toBe(true);
    expect(decoded.snapshot?.pet.mode).toBe('floating');
    expect(decoded.snapshot?.tabs).toHaveLength(1);
    expect(service.revision()).toBe(1);
  });

  it('increments the revision so stale writers can be detected', () => {
    const storage = createMemoryStorage();
    const service = createPersistenceService({ storage, now: () => NOW });
    service.save({ workspace, pet: { mode: 'embedded', position: { x: 0, y: 0 } } });
    const second = service.save({ workspace, pet: { mode: 'embedded', position: { x: 0, y: 0 } } });
    expect(second.revision).toBe(2);
    expect(decodeSnapshot(storage.read(STORAGE_KEY), NOW).snapshot?.revision).toBe(2);
  });

  it('reports a failed write instead of throwing', () => {
    const storage = createMemoryStorage();
    storage.failWrites = true;
    const service = createPersistenceService({ storage, now: () => NOW });
    const result = service.save({ workspace, pet: { mode: 'embedded', position: { x: 0, y: 0 } } });
    expect(result).toMatchObject({ ok: false, reason: 'write_failed' });
  });

  it('clears the store', () => {
    const storage = createMemoryStorage();
    const service = createPersistenceService({ storage, now: () => NOW });
    service.save({ workspace, pet: { mode: 'embedded', position: { x: 0, y: 0 } } });
    service.clear();
    expect(storage.read(STORAGE_KEY)).toBeNull();
    expect(service.revision()).toBe(0);
  });
});

describe('browser storage adapter', () => {
  it('falls back to memory when localStorage is unavailable', () => {
    const fallback = createBrowserStorage(null);
    expect(fallback.isDurable()).toBe(false);
    expect(fallback.write('k', 'v')).toBe(true);
    expect(fallback.read('k')).toBe('v');
  });

  it('swallows quota errors and stops claiming durability', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const storage = createBrowserStorage(throwing);
    expect(storage.write('k', 'v')).toBe(false);
    expect(storage.isDurable()).toBe(false);
  });
});
