/**
 * Low-level IndexedDB helpers shared by the local store + auth implementations.
 *
 * Backed by the `idb` package (a tiny promise-based wrapper over the raw
 * IndexedDB API — no other runtime dependency). This is the standalone local
 * backend: all data lives in the browser, no network/Firebase required.
 *
 * Object stores mirror the former Firestore collections 1:1 (same names, same
 * document shapes — see src/data/models.ts), plus a separate `auth_users` store
 * for local credentials.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'weonline';
const DB_VERSION = 1;

/** Data collections keyed by `id`, plus the auth credential store keyed by `uid`. */
export const DATA_STORES = ['users', 'clients', 'routers', 'transactions'] as const;
export const AUTH_STORE = 'auth_users';

let dbPromise: Promise<IDBPDatabase> | null = null;

/** Open (once) and memoize the IndexedDB connection. */
function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of DATA_STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        }
        if (!db.objectStoreNames.contains(AUTH_STORE)) {
          db.createObjectStore(AUTH_STORE, { keyPath: 'uid' });
        }
      },
    });
  }
  return dbPromise;
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return (await getDB()).get(store, key) as Promise<T | undefined>;
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  return (await getDB()).getAll(store) as Promise<T[]>;
}

export async function idbPut<T>(store: string, value: T): Promise<void> {
  await (await getDB()).put(store, value as unknown as object);
}

export async function idbDelete(store: string, key: string): Promise<void> {
  await (await getDB()).delete(store, key);
}
