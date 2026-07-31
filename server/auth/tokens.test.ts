// Stable signing secret before the module resolves it lazily.
process.env.AUTH_SECRET = 'test-secret-at-least-16-chars-long';

import { describe, it, expect } from 'vitest';
import { issueToken, verifyToken } from './tokens';

const user = { uid: 'usr_1', role: 'admin' as const, email: 'a@b.net' };
const NOW = 1_800_000_000_000; // fixed ms (tests pass time explicitly)

describe('session tokens', () => {
  it('issues a token that verifies and carries the claims', () => {
    const token = issueToken(user, NOW);
    const payload = verifyToken(token, NOW);
    expect(payload).not.toBeNull();
    expect(payload!.uid).toBe('usr_1');
    expect(payload!.role).toBe('admin');
    expect(payload!.email).toBe('a@b.net');
    expect(payload!.exp).toBeGreaterThan(Math.floor(NOW / 1000));
  });

  it('rejects a tampered payload — no privilege escalation by editing the body', () => {
    const token = issueToken({ uid: 'usr_2', role: 'technician', email: 't@b.net' }, NOW);
    const sig = token.split('.')[1];
    // Attacker rewrites the body to role=admin but can't forge a matching signature.
    const escalated =
      Buffer.from(JSON.stringify({ uid: 'usr_2', role: 'admin', email: 't@b.net', exp: 9_999_999_999 }))
        .toString('base64url') +
      '.' +
      sig;
    expect(verifyToken(escalated, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = issueToken(user, NOW);
    const later = NOW + 13 * 60 * 60 * 1000; // > 12h TTL
    expect(verifyToken(token, later)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyToken('', NOW)).toBeNull();
    expect(verifyToken('no-dot', NOW)).toBeNull();
    expect(verifyToken('a.b.c', NOW)).toBeNull();
  });
});
