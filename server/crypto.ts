/**
 * Server crypto helpers: secure random password generation and transparent
 * field-level encryption at rest.
 *
 * Subscriber / router passwords must be provisioned to RouterOS in cleartext, so
 * they can't be one-way hashed — instead they are encrypted on disk (AES-256-GCM)
 * and decrypted into memory. The key comes from DATA_ENCRYPTION_KEY, or is derived
 * from AUTH_SECRET. With neither set, values are stored as plaintext (dev only) and
 * a warning is logged.
 */

import crypto from 'crypto';

const PREFIX = 'enc:v1:';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no look-alikes

/** Cryptographically-strong password (default 14 chars) from an unbiased alphabet. */
export function generatePassword(length = 14): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

let keyCache: Buffer | null | undefined; // undefined = unresolved, null = unavailable
let warned = false;

function resolveKey(): Buffer | null {
  if (keyCache !== undefined) return keyCache;
  const direct = process.env.DATA_ENCRYPTION_KEY;
  if (direct) {
    const buf = /^[0-9a-fA-F]{64}$/.test(direct) ? Buffer.from(direct, 'hex') : Buffer.from(direct, 'base64');
    if (buf.length === 32) return (keyCache = buf);
    console.warn('[crypto] DATA_ENCRYPTION_KEY must be 32 bytes (64 hex chars); ignoring it.');
  }
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    // Derive a stable 32-byte key from AUTH_SECRET (distinct domain via the salt).
    return (keyCache = crypto.scryptSync(secret, 'weonline-data-at-rest', 32));
  }
  if (!warned) {
    console.warn('[crypto] No DATA_ENCRYPTION_KEY or AUTH_SECRET — passwords stored as PLAINTEXT at rest. Set one for production.');
    warned = true;
  }
  return (keyCache = null);
}

export function isEncrypted(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

/** Encrypt a field value. Empty strings and already-encrypted values pass through. */
export function encryptField(plain: string): string {
  if (plain === '' || isEncrypted(plain)) return plain;
  const key = resolveKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString('base64')).join(':');
}

/**
 * Decrypt a field. Non-encrypted (legacy plaintext) values pass through unchanged
 * so existing data migrates on the next write. On failure (e.g. wrong key) the
 * original string is returned and the error logged — never throws, so a bad key
 * cannot cascade into the store's "start fresh" path and wipe data.
 */
export function decryptField(v: string): string {
  if (!isEncrypted(v)) return v;
  const key = resolveKey();
  if (!key) return v;
  try {
    const [ivB, tagB, ctB] = v.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[crypto] failed to decrypt a field (wrong DATA key?); leaving it encrypted:', (err as Error).message);
    return v;
  }
}
