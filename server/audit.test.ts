import { describe, it, expect, afterEach } from 'vitest';
import { recordAudit } from './audit';
import type { Store } from './store';
import type { AuditEntry } from './types';

function fakeStore(): Store & { saves: number } {
  const auditLog: AuditEntry[] = [];
  let saves = 0;
  const s = { data: { auditLog }, save: () => { saves++; } } as unknown as Store & { saves: number };
  Object.defineProperty(s, 'saves', { get: () => saves });
  return s;
}

describe('recordAudit', () => {
  it('builds a well-formed entry and persists via save()', () => {
    const store = fakeStore();
    const entry = recordAudit(store, { actorEmail: 'a@x.net', actorId: 'u1', action: 'auth.login', ip: '1.2.3.4' }, 1_700_000_000_000);
    expect(entry.action).toBe('auth.login');
    expect(entry.outcome).toBe('success'); // defaults to success
    expect(entry.actorEmail).toBe('a@x.net');
    expect(entry.ip).toBe('1.2.3.4');
    expect(entry.id).toMatch(/^aud_/);
    expect(new Date(entry.ts).toISOString()).toBe(entry.ts); // valid ISO timestamp
    expect(store.data.auditLog).toHaveLength(1);
    expect(store.saves).toBe(1);
  });

  it('respects an explicit failure outcome', () => {
    const store = fakeStore();
    const entry = recordAudit(store, { actorEmail: 'x', action: 'auth.login', outcome: 'failure' }, 1);
    expect(entry.outcome).toBe('failure');
  });

  it('caps the log to AUDIT_CAP, dropping the oldest entries', () => {
    process.env.AUDIT_CAP = '3';
    const store = fakeStore();
    for (let i = 0; i < 5; i++) {
      recordAudit(store, { action: `evt.${i}` }, 1_700_000_000_000 + i);
    }
    // Cap is 3 → only the 3 newest survive, newest last.
    expect(store.data.auditLog).toHaveLength(3);
    expect(store.data.auditLog.map((e) => e.action)).toEqual(['evt.2', 'evt.3', 'evt.4']);
  });
});

afterEach(() => {
  delete process.env.AUDIT_CAP; // don't leak the small cap into other tests
});
