/**
 * Low-level IndexedDB helpers shared by the local store + auth implementations.
 *
 * This is the local/offline backend used while the real backend (Supabase — see
 * MIGRATION.md Phase 4) is not yet wired up. Data lives in the browser only.
 */

const DB_NAME = 'weonline';
const DB_VERSION = 1;

/** Data collections keyed by `id`, plus the auth credential store keyed by `uid`. */
export const DATA_STORES = ['users', 'clients', 'routers', 'transactions'] as const;
export const AUTH_STORE = 'auth_users';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of DATA_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
      if (!db.objectStoreNames.contains(AUTH_STORE)) {
        db.createObjectStore(AUTH_STORE, { keyPath: 'uid' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Promisify an IDBRequest. */
export function idb<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return idb<T | undefined>(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return idb<T[]>(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function idbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDB();
  await idb(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDB();
  await idb(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
