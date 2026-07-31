/**
 * DataStore implementation backed by Cloud Firestore.
 *
 * Kept so the app can flip back to Firebase by editing src/data/index.ts only.
 * Not imported while the IndexedDB backend is active.
 */

import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { DataStore, SubscribeOptions } from '../types';

export const firebaseStore: DataStore = {
  async get<T>(c: string, id: string): Promise<T | null> {
    const snap = await getDoc(doc(db, c, id));
    return snap.exists() ? (snap.data() as T) : null;
  },
  async set<T>(c: string, id: string, data: T): Promise<void> {
    await setDoc(doc(db, c, id), data as DocumentData);
  },
  async add<T>(c: string, data: T): Promise<string> {
    const ref = await addDoc(collection(db, c), data as DocumentData);
    return ref.id;
  },
  async update<T>(c: string, id: string, patch: Partial<T>): Promise<void> {
    await updateDoc(doc(db, c, id), patch as DocumentData);
  },
  async remove(c: string, id: string): Promise<void> {
    await deleteDoc(doc(db, c, id));
  },
  subscribe<T>(
    c: string,
    cb: (docs: Array<T & { id: string }>) => void,
    opts?: SubscribeOptions,
  ): () => void {
    const ref = opts?.orderBy
      ? query(collection(db, c), orderBy(opts.orderBy.field, opts.orderBy.dir))
      : collection(db, c);
    return onSnapshot(ref, (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T & { id: string }));
    });
  },
};
