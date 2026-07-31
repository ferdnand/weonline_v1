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

import { indexedDbStore } from './indexeddb/store';
import { serverAuth } from './server/auth';

// Auth is now the server's responsibility (real authorization boundary): login
// returns a signed token the API client sends on every request. The legacy admin
// CRUD (clients/routers/transactions in the marketing/demo UI) still uses the
// browser-local IndexedDB store.
export const authService: AuthService = serverAuth;
export const dataStore: DataStore = indexedDbStore;

// Re-export contracts + domain models so callers import everything from './data'.
export * from './types';
export * from './models';
