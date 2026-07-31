/**
 * DataStore implementation backed by IndexedDB, with an in-memory pub/sub layer
 * to emulate Firestore-style realtime `subscribe`.
 *
 * IndexedDB has no native change notifications, so every mutation calls notify()
 * to re-emit the affected collection to its subscribers. Fine for a single-tab
 * admin app; a future backend gets real server-push instead.
 */

import type { DataStore, SubscribeOptions } from '../types';
import { idbGet, idbGetAll, idbPut, idbDelete } from './db';

type Doc = { id: string } & Record<string, unknown>;
type Listener = { cb: (docs: any[]) => void; opts?: SubscribeOptions };

const listeners = new Map<string, Set<Listener>>();

function genId(): string {
  // crypto.randomUUID is available in secure contexts (incl. localhost).
  return crypto.randomUUID();
}

function sortDocs(docs: Doc[], opts?: SubscribeOptions): Doc[] {
  if (!opts?.orderBy) return docs;
  const { field, dir } = opts.orderBy;
  const factor = dir === 'asc' ? 1 : -1;
  return [...docs].sort((a, b) => {
    const av = a[field] as any;
    const bv = b[field] as any;
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}

async function emit(collection: string, listener: Listener): Promise<void> {
  const all = await idbGetAll<Doc>(collection);
  listener.cb(sortDocs(all, listener.opts));
}

function notify(collection: string): void {
  const set = listeners.get(collection);
  if (!set) return;
  for (const listener of set) {
    // Fire-and-forget; each listener re-reads and re-sorts independently.
    void emit(collection, listener);
  }
}

export const indexedDbStore: DataStore = {
  async get<T>(collection: string, id: string): Promise<T | null> {
    const rec = await idbGet<T>(collection, id);
    return rec ?? null;
  },

  async set<T>(collection: string, id: string, data: T): Promise<void> {
    await idbPut(collection, { ...(data as object), id });
    notify(collection);
  },

  async add<T>(collection: string, data: T): Promise<string> {
    const id = genId();
    await idbPut(collection, { ...(data as object), id });
    notify(collection);
    return id;
  },

  async update<T>(collection: string, id: string, patch: Partial<T>): Promise<void> {
    const existing = await idbGet<Doc>(collection, id);
    if (!existing) throw new Error(`Document ${collection}/${id} not found`);
    await idbPut(collection, { ...existing, ...(patch as object), id });
    notify(collection);
  },

  async remove(collection: string, id: string): Promise<void> {
    await idbDelete(collection, id);
    notify(collection);
  },

  subscribe<T>(
    collection: string,
    cb: (docs: Array<T & { id: string }>) => void,
    opts?: SubscribeOptions,
  ): () => void {
    const listener: Listener = { cb: cb as (docs: any[]) => void, opts };
    const set = listeners.get(collection) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(collection, set);

    // Initial emit with current contents.
    void emit(collection, listener);

    return () => {
      set.delete(listener);
    };
  },
};
