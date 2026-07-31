/**
 * AuthService backed by the server API (/api/auth).
 *
 * Unlike the browser-local IndexedDB auth, the server is the real authorization
 * boundary: login/register return a signed session token, which the API client
 * attaches to every request. This module keeps the token + the cached user in
 * sync and re-validates the session against /api/auth/me on load.
 */

import type { AuthService, AuthUser } from '../types';
import { getApiToken, setApiToken, setUnauthorizedHandler } from '../../api/client';

interface ServerUser {
  uid: string;
  email: string;
  role: 'admin' | 'technician';
  displayName: string | null;
}

function toAuthUser(u: ServerUser): AuthUser {
  return { uid: u.uid, email: u.email, displayName: u.displayName, role: u.role };
}

let currentUser: AuthUser | null = null;
let listeners: Array<(u: AuthUser | null) => void> = [];
let readyPromise: Promise<void> | null = null;

function emit(user: AuthUser | null): void {
  currentUser = user;
  for (const cb of listeners) cb(currentUser);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data as T;
}

/** Validate any stored token against the server so a stale token means "signed out". */
async function loadSession(): Promise<void> {
  const token = getApiToken();
  if (!token) {
    currentUser = null;
    return;
  }
  try {
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('invalid session');
    const { user } = (await res.json()) as { user: ServerUser };
    currentUser = toAuthUser(user);
  } catch {
    setApiToken(null);
    currentUser = null;
  }
}

function ensureReady(): Promise<void> {
  if (!readyPromise) readyPromise = loadSession();
  return readyPromise;
}

// If any API call gets a 401, drop our session and notify subscribers.
setUnauthorizedHandler(() => {
  if (currentUser !== null) emit(null);
});

export const serverAuth: AuthService = {
  onAuthStateChanged(cb: (user: AuthUser | null) => void): () => void {
    listeners.push(cb);
    void ensureReady().then(() => cb(currentUser));
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  },

  getCurrentUser(): AuthUser | null {
    return currentUser;
  },

  async signUpWithEmail(email: string, password: string): Promise<void> {
    const { token, user } = await post<{ token: string; user: ServerUser }>('/api/auth/register', {
      email,
      password,
    });
    setApiToken(token);
    emit(toAuthUser(user));
  },

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { token, user } = await post<{ token: string; user: ServerUser }>('/api/auth/login', {
      email,
      password,
    });
    setApiToken(token);
    emit(toAuthUser(user));
  },

  async signOut(): Promise<void> {
    setApiToken(null);
    emit(null);
  },
};
