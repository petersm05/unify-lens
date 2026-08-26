/**
 * The smallest useful wrapper over IndexedDB.
 *
 * localStorage would be simpler still, but it is synchronous — every read
 * blocks the main thread — and capped at a few megabytes. A schema for an
 * environment with eighty attributes across a dozen types clears that cap
 * sooner than is comfortable, and blocking paint to read a cache defeats the
 * point of having one.
 *
 * Every operation resolves to `undefined` rather than rejecting when the store
 * is unavailable. A cache is an optimisation: private browsing, a denied quota
 * or a corrupt database should cost speed, never function.
 */

const DB_NAME = 'unify-lens';
const DB_VERSION = 1;

let open: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  open ??= new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      for (const store of ['schema'] as const) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => resolve(null));
    request.addEventListener('blocked', () => resolve(null));
  });
  return open;
}

export async function read<T>(store: string, key: string): Promise<T | undefined> {
  const db = await database();
  if (!db) return undefined;

  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.addEventListener('success', () => resolve(request.result as T | undefined));
      request.addEventListener('error', () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}

export async function write(store: string, key: string, value: unknown): Promise<void> {
  const db = await database();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value, key);
      transaction.addEventListener('complete', () => resolve());
      transaction.addEventListener('error', () => resolve());
      transaction.addEventListener('abort', () => resolve());
    } catch {
      resolve();
    }
  });
}

/** Drops entries whose key does not start with `prefix` — how a stale stamp is retired. */
export async function keepOnly(store: string, prefix: string): Promise<void> {
  const db = await database();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(store, 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.getAllKeys();
      request.addEventListener('success', () => {
        for (const key of request.result) {
          if (typeof key === 'string' && !key.startsWith(prefix)) objectStore.delete(key);
        }
      });
      transaction.addEventListener('complete', () => resolve());
      transaction.addEventListener('error', () => resolve());
      transaction.addEventListener('abort', () => resolve());
    } catch {
      resolve();
    }
  });
}
