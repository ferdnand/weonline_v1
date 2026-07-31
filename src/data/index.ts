/**
 * Backend selector — the ONLY place a provider is chosen.
 *
 * The rest of the app imports `authService` / `dataStore` from here and never
 * touches a backend SDK directly.
 *
 * ── Active backend: LOCAL (IndexedDB) ─────────────────────────────────────────
 * Fully standalone: data lives in the browser only, no network/cloud required.
 * Auth + data are implemented over IndexedDB (via the `idb` package) under
 * ./indexeddb/. To add another backend (e.g. a self-hosted REST API), create
 * ./<provider>/auth.ts + store.ts implementing AuthService/DataStore and swap the
 * two assignments below.
 */

import type { AuthService, DataStore } from './types';

import { indexedDbAuth } from './indexeddb/auth';
import { indexedDbStore } from './indexeddb/store';

export const authService: AuthService = indexedDbAuth;
export const dataStore: DataStore = indexedDbStore;

// Re-export contracts + domain models so callers import everything from './data'.
export * from './types';
export * from './models';
