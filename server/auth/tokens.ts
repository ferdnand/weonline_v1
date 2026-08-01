/**
 * Stateless session tokens: a compact `payload.signature` string signed with an
 * HMAC-SHA256 server secret. No server-side session storage — the signature is
 * the trust anchor, and any tampering (including role escalation) invalidates it.
 *
 * The secret comes from AUTH_SECRET. In production this MUST be set to a long
 * random value; if it is missing we generate an ephemeral one so dev still works,
 * but every restart then invalidates existing tokens (and we warn loudly).
 */

import crypto from 'crypto';
import type { Role } from '../types';
import { log } from '../logger';

const tlog = log('auth');

const TTL_SECONDS = 12 * 60 * 60; // 12h sessions

function resolveSecret(): string {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (fromEnv && fromEnv.length < 16) {
    tlog.warn('AUTH_SECRET is too short (<16 chars); using it anyway, but lengthen it for production.');
    return fromEnv;
  }
  tlog.warn(
    'AUTH_SECRET is not set — generating an ephemeral secret. Sessions will not survive a restart. ' +
      'Set AUTH_SECRET in .env.local before production.',
  );
  return crypto.randomBytes(32).toString('hex');
}

// Resolved lazily on first use (so it never races module import order), then
// cached so an ephemeral secret stays stable for the life of the process.
let cachedSecret: string | null = null;
function secret(): string {
  if (cachedSecret === null) cachedSecret = resolveSecret();
  return cachedSecret;
}

export interface TokenPayload {
  uid: string;
  role: Role;
  email: string;
  exp: number; // unix seconds
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Mint a signed token for a user. `nowMs` is passed in (Date.now() is fine at call time). */
export function issueToken(user: { uid: string; role: Role; email: string }, nowMs: number): string {
  const payload: TokenPayload = {
    uid: user.uid,
    role: user.role,
    email: user.email,
    exp: Math.floor(nowMs / 1000) + TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Verify a token's signature + expiry. Returns the payload or null. */
export function verifyToken(token: string, nowMs: number): TokenPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.', 2);
  if (!body || !sig) return null;

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (Math.floor(nowMs / 1000) >= payload.exp) return null;
  return payload;
}
