export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface KeyValueStorage {
  read(key: string): string | null;
  /** Returns false when the write could not be persisted (quota, private mode). */
  write(key: string, value: string): boolean;
  remove(key: string): void;
  /** False when writes succeed only in memory. */
  isDurable(): boolean;
}

export type MemoryStorage = KeyValueStorage & {
  dump(): Record<string, string>;
  failWrites: boolean;
};

export function createMemoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const data = new Map<string, string>(Object.entries(seed));
  const storage: MemoryStorage = {
    failWrites: false,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => {
      if (storage.failWrites) return false;
      data.set(key, value);
      return true;
    },
    remove: (key) => {
      data.delete(key);
    },
    isDurable: () => false,
    dump: () => Object.fromEntries(data.entries()),
  };
  return storage;
}

/**
 * localStorage can throw on read/write (quota, Safari private mode, disabled
 * storage). Need to degrade to memory instead of crashing the app.
 */
export function createBrowserStorage(impl: StorageLike | null | undefined): KeyValueStorage {
  if (!impl) return createMemoryStorage();

  let durable = true;
  return {
    read: (key) => {
      try {
        return impl.getItem(key);
      } catch {
        durable = false;
        return null;
      }
    },
    write: (key, value) => {
      try {
        impl.setItem(key, value);
        return true;
      } catch {
        durable = false;
        return false;
      }
    },
    remove: (key) => {
      try {
        impl.removeItem(key);
      } catch {
        durable = false;
      }
    },
    isDurable: () => durable,
  };
}
