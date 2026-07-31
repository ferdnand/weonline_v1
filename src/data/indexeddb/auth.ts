/**
 * AuthService implementation backed by IndexedDB — standalone username/password
 * auth for the local backend.
 *
 * The login identifier is the user's EMAIL (the app's UI and `users` profile
 * collection are email-based), so "username" here == email. Credentials live in
 * the `auth_users` object store; the active session uid is kept in localStorage
 * (and mirrored in the in-memory `currentUser`).
 *
 * SECURITY NOTE: passwords are salted + SHA-256 hashed via the Web Crypto API for
 * basic hygiene. This is NOT bank-grade security — SHA-256 is fast and lacks the
 * key-stretching (bcrypt/scrypt/argon2) a server-side auth system would use. It
 * is adequate for a standalone, single-user, browser-local admin app only.
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
  createdAt: string; // ISO timestamp
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

  /** Synchronous snapshot of the active session (may be null until the first load resolves). */
  getCurrentUser(): AuthUser | null {
    return currentUser;
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
      createdAt: new Date().toISOString(),
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

  async signOut(): Promise<void> {
    setSession(null);
  },
};
