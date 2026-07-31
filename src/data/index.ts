/**
 * Backend selector — the ONLY place a provider is chosen.
 *
 * The rest of the app imports `authService` / `dataStore` from here and never
 * touches a backend SDK directly. See MIGRATION.md for the plan.
 *
 * ── Active backend: LOCAL (IndexedDB) ─────────────────────────────────────────
 * Data lives in the browser only. No Firebase/network required to run the app.
 *
 * To switch backends, change the two assignments below:
 *   • Firebase  → import from './firebase/auth' + './firebase/store'
 *   • Supabase  → future: create './supabase/*' implementing AuthService/DataStore
 */

import type { AuthService, DataStore } from './types';

import { indexedDbAuth } from './indexeddb/auth';
import { indexedDbStore } from './indexeddb/store';

// --- Firebase (kept for one-line flip-back; not bundled while inactive) ---
// import { firebaseAuth } from './firebase/auth';
// import { firebaseStore } from './firebase/store';

export const authService: AuthService = indexedDbAuth;
export const dataStore: DataStore = indexedDbStore;

// Re-export contracts + domain models so callers import everything from './data'.
export * from './types';
export * from './models';
