/**
 * Server-side account store + password verification.
 *
 * Passwords are hashed with PBKDF2-HMAC-SHA256 (key stretching), never stored in
 * plaintext. This module is the authorization source of truth: the API trusts a
 * request only after a token minted here (see ./tokens) is verified.
 */

import crypto from 'crypto';
import type { AuthUserRecord, Role } from '../types';
import { Store, makeId } from '../store';

const PBKDF2_ITERATIONS = 210_000; // OWASP-recommended floor for PBKDF2-HMAC-SHA256
const KEY_LEN = 32;
const DIGEST = 'sha256';

function hash(password: string, salt: string, iterations: number): string {
  return crypto.pbkdf2Sync(password, salt, iterations, KEY_LEN, DIGEST).toString('hex');
}

/** Constant-time comparison to avoid leaking match progress via timing. */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export interface PublicUser {
  uid: string;
  email: string;
  role: Role;
  displayName: string | null;
}

export function toPublicUser(rec: AuthUserRecord): PublicUser {
  return { uid: rec.uid, email: rec.email, role: rec.role, displayName: rec.displayName };
}

export class AuthService {
  constructor(private store: Store) {}

  private users(): AuthUserRecord[] {
    return this.store.data.users;
  }

  findByEmail(email: string): AuthUserRecord | undefined {
    const target = email.trim().toLowerCase();
    return this.users().find((u) => u.email.toLowerCase() === target);
  }

  findByUid(uid: string): AuthUserRecord | undefined {
    return this.users().find((u) => u.uid === uid);
  }

  hasUsers(): boolean {
    return this.users().length > 0;
  }

  /**
   * Create a staff account. The FIRST account always bootstraps as admin. Later
   * accounts are created by an admin (see the /users route) and may be given an
   * explicit role; absent one they default to technician.
   */
  createUser(
    email: string,
    password: string,
    displayName: string | null,
    nowMs: number,
    opts?: { role?: Role },
  ): PublicUser {
    const clean = email.trim();
    if (!clean || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
      throw new Error('A valid email is required.');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    if (this.findByEmail(clean)) {
      throw new Error('An account with this email already exists.');
    }
    const role: Role = this.hasUsers() ? opts?.role ?? 'technician' : 'admin';
    const salt = crypto.randomBytes(16).toString('hex');
    const rec: AuthUserRecord = {
      uid: makeId('usr', nowMs),
      email: clean,
      role,
      displayName: displayName?.trim() || null,
      passwordHash: hash(password, salt, PBKDF2_ITERATIONS),
      salt,
      iterations: PBKDF2_ITERATIONS,
      createdAt: new Date(nowMs).toISOString(),
    };
    this.users().push(rec);
    this.store.save();
    return toPublicUser(rec);
  }

  /** All accounts as safe public shapes (never exposes hashes). */
  listUsers(): Array<PublicUser & { createdAt: string }> {
    return this.users().map((u) => ({ ...toPublicUser(u), createdAt: u.createdAt }));
  }

  adminCount(): number {
    return this.users().filter((u) => u.role === 'admin').length;
  }

  deleteUser(uid: string): void {
    const idx = this.users().findIndex((u) => u.uid === uid);
    if (idx === -1) throw new Error('user not found');
    this.users().splice(idx, 1);
    this.store.save();
  }

  setRole(uid: string, role: Role): PublicUser {
    const rec = this.findByUid(uid);
    if (!rec) throw new Error('user not found');
    rec.role = role;
    this.store.save();
    return toPublicUser(rec);
  }

  resetPassword(uid: string, password: string): void {
    if (typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    const rec = this.findByUid(uid);
    if (!rec) throw new Error('user not found');
    rec.salt = crypto.randomBytes(16).toString('hex');
    rec.iterations = PBKDF2_ITERATIONS;
    rec.passwordHash = hash(password, rec.salt, PBKDF2_ITERATIONS);
    this.store.save();
  }

  /** Verify credentials; returns the account on success, null otherwise. */
  verify(email: string, password: string): AuthUserRecord | null {
    const rec = this.findByEmail(email);
    if (!rec) {
      // Spend comparable work on unknown users to blunt account enumeration by timing.
      hash(password, 'decoy-salt', PBKDF2_ITERATIONS);
      return null;
    }
    const candidate = hash(password, rec.salt, rec.iterations);
    if (!safeEqualHex(candidate, rec.passwordHash)) return null;
    return rec;
  }
}
