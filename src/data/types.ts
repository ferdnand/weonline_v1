/**
 * Backend-agnostic contracts for authentication and data access.
 *
 * The app (src/App.tsx) depends ONLY on these interfaces — never on firebase/*,
 * IndexedDB, or any future SDK directly. Concrete implementations live under
 * src/data/<provider>/ and are selected in src/data/index.ts.
 *
 * See MIGRATION.md for the rationale and phased plan.
 */

/** Minimal, provider-neutral view of a signed-in user. */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthService {
  /**
   * Subscribe to auth state. The callback fires once with the current user
   * (or null) shortly after subscribing, then again on every change.
   * Returns an unsubscribe function.
   */
  onAuthStateChanged(cb: (user: AuthUser | null) => void): () => void;

  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;

  /** May reject with an "unsupported" error on backends without Google OAuth. */
  signInWithGoogle(): Promise<void>;

  signOut(): Promise<void>;
}

export interface SubscribeOptions {
  orderBy?: { field: string; dir: 'asc' | 'desc' };
}

/**
 * Generic document store over named collections. Documents are plain objects
 * identified by a string `id`. Modeled on the subset of Firestore the app uses,
 * so it maps cleanly onto Firestore, IndexedDB, Supabase, or a REST backend.
 */
export interface DataStore {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, data: T): Promise<void>;
  /** Adds a document with a generated id; resolves to that id. */
  add<T>(collection: string, data: T): Promise<string>;
  update<T>(collection: string, id: string, patch: Partial<T>): Promise<void>;
  remove(collection: string, id: string): Promise<void>;

  /**
   * Realtime subscription. The callback fires once with the current contents,
   * then again after every change to the collection. Returns an unsubscribe fn.
   */
  subscribe<T>(
    collection: string,
    cb: (docs: Array<T & { id: string }>) => void,
    opts?: SubscribeOptions,
  ): () => void;
}
