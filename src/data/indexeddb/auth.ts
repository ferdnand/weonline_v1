/**
 * AuthService implementation backed by IndexedDB.
 *
 * Local email/password auth for the offline backend. Credentials are stored in
 * the `auth_users` object store; the active session id is kept in localStorage.
 *
 * SECURITY NOTE: passwords are salted + SHA-256 hashed for basic hygiene, but this
 * is a LOCAL DEV backend only — it is not a substitute for real server-side auth.
 * The real backend (Supabase, see MIGRATION.md) replaces this entirely.
 */

import type { AuthService, AuthUser } from '../types';
import { AUTH_STORE, idbGet, idbGetAll, idbPut } from './db';

const SESSION_KEY = 'weonline_session_uid';

interface AuthRecord {
  uid: string;
  email: string;
  passwordHash: string;
  salt: string;
  displayName: string | null;
}

let currentUser: AuthUser | null = null;
let listeners: Array<(u: AuthUser | null) => void> = [];
let readyPromise: Promise<void> | null = null;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

function toAuthUser(rec: AuthRecord): AuthUser {
  return { uid: rec.uid, email: rec.email, displayName: rec.displayName };
}

async function findByEmail(email: string): Promise<AuthRecord | undefined> {
  const all = await idbGetAll<AuthRecord>(AUTH_STORE);
  const target = email.trim().toLowerCase();
  return all.find((r) => r.email.toLowerCase() === target);
}

async function loadSession(): Promise<void> {
  const uid = localStorage.getItem(SESSION_KEY);
  if (!uid) {
    currentUser = null;
    return;
  }
  const rec = await idbGet<AuthRecord>(AUTH_STORE, uid);
  if (rec) {
    currentUser = toAuthUser(rec);
  } else {
    currentUser = null;
    localStorage.removeItem(SESSION_KEY);
  }
}

function ensureReady(): Promise<void> {
  if (!readyPromise) readyPromise = loadSession();
  return readyPromise;
}

function setSession(user: AuthUser | null): void {
  currentUser = user;
  if (user) localStorage.setItem(SESSION_KEY, user.uid);
  else localStorage.removeItem(SESSION_KEY);
  for (const cb of listeners) cb(currentUser);
}

export const indexedDbAuth: AuthService = {
  onAuthStateChanged(cb: (user: AuthUser | null) => void): () => void {
    listeners.push(cb);
    void ensureReady().then(() => cb(currentUser));
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  },

  async signUpWithEmail(email: string, password: string): Promise<void> {
    await ensureReady();
    if (await findByEmail(email)) {
      throw new Error('An account with this email already exists.');
    }
    const salt = randomSalt();
    const record: AuthRecord = {
      uid: crypto.randomUUID(),
      email: email.trim(),
      passwordHash: await hashPassword(password, salt),
      salt,
      displayName: null,
    };
    await idbPut(AUTH_STORE, record);
    setSession(toAuthUser(record));
  },

  async signInWithEmail(email: string, password: string): Promise<void> {
    await ensureReady();
    const rec = await findByEmail(email);
    if (!rec) throw new Error('No account found with this email.');
    const hash = await hashPassword(password, rec.salt);
    if (hash !== rec.passwordHash) throw new Error('Incorrect password.');
    setSession(toAuthUser(rec));
  },

  async signInWithGoogle(): Promise<void> {
    throw new Error(
      'Google sign-in is not available in local mode. Please use email and password.',
    );
  },

  async signOut(): Promise<void> {
    setSession(null);
  },
};
