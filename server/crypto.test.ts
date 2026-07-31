// Set a stable key up front. crypto.ts resolves the key lazily (on first use),
// so this is in place before any encrypt/decrypt call below. 64 hex = 32 bytes.
process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);

import { describe, it, expect } from 'vitest';
import { encryptField, decryptField, isEncrypted, generatePassword } from './crypto';

describe('generatePassword', () => {
  it('returns the requested length from the safe alphabet', () => {
    const pw = generatePassword(14);
    expect(pw).toHaveLength(14);
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/); // no 0/O/1/I/l look-alikes
  });

  it('is effectively unique across calls', () => {
    const set = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(set.size).toBe(200);
  });
});

describe('field encryption at rest', () => {
  it('round-trips a value', () => {
    const secret = 'pppoe-pass-123';
    const enc = encryptField(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptField(enc)).toBe(secret);
  });

  it('produces a fresh ciphertext each time (random IV)', () => {
    expect(encryptField('same')).not.toBe(encryptField('same'));
  });

  it('passes through empty strings and already-encrypted values', () => {
    expect(encryptField('')).toBe('');
    const once = encryptField('x');
    expect(encryptField(once)).toBe(once); // not double-encrypted
  });

  it('leaves legacy plaintext untouched on decrypt', () => {
    expect(decryptField('legacy-plaintext')).toBe('legacy-plaintext');
  });

  it('does not throw on a tampered ciphertext (returns input, never crashes load)', () => {
    const enc = encryptField('secret');
    const tampered = enc.slice(0, -4) + 'AAAA';
    expect(() => decryptField(tampered)).not.toThrow();
  });
});
