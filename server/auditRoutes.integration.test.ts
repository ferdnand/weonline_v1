process.env.AUTH_SECRET = 'integration-test-secret-16+';

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authRoutes } from './auth/routes';
import { auditRoutes } from './auditRoutes';
import { requireAuth } from './auth/middleware';
import type { Store } from './store';
import type { AuditEntry, AuthUserRecord } from './types';

// Shared store: authRoutes bootstraps users into it; auditRoutes reads the log.
function fakeStore(auditLog: AuditEntry[]): Store {
  const users: AuthUserRecord[] = [];
  return { data: { users, auditLog }, save: () => {} } as unknown as Store;
}

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: over.id || 'aud_x',
    ts: over.ts || '2026-01-01T00:00:00.000Z',
    actorId: over.actorId ?? null,
    actorEmail: over.actorEmail ?? null,
    action: over.action || 'evt',
    outcome: over.outcome || 'success',
    ...over,
  };
}

const seeded: AuditEntry[] = [
  entry({ id: 'a1', action: 'auth.login', actorEmail: 'admin@x.net', outcome: 'success' }),
  entry({ id: 'a2', action: 'auth.login', actorEmail: 'bad@x.net', outcome: 'failure' }),
  entry({ id: 'a3', action: 'billing.payment.manual', actorEmail: 'admin@x.net', outcome: 'success' }),
];

let app: express.Express;
let adminToken: string;
let techToken: string;

beforeAll(async () => {
  const store = fakeStore(seeded);
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(store));
  app.use('/api/audit', requireAuth, auditRoutes(store));

  const reg = await request(app).post('/api/auth/register').send({ email: 'admin@x.net', password: 'password1' });
  adminToken = reg.body.token;
  await request(app)
    .post('/api/auth/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'tech@x.net', password: 'password2', role: 'technician' });
  const login = await request(app).post('/api/auth/login').send({ email: 'tech@x.net', password: 'password2' });
  techToken = login.body.token;
});

describe('GET /api/audit', () => {
  it('rejects anonymous callers with 401', async () => {
    expect((await request(app).get('/api/audit')).status).toBe(401);
  });

  it('forbids technicians with 403', async () => {
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  it('returns the log newest-first for an admin', async () => {
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // The auth setup (register/create-user/login) also recorded events into this
    // same store, so the seeded three are not the only entries. Assert their
    // relative newest-first order instead: a3 (newest seeded) before a2 before a1.
    const ids: string[] = res.body.entries.map((e: AuditEntry) => e.id);
    expect(ids.indexOf('a3')).toBeLessThan(ids.indexOf('a2'));
    expect(ids.indexOf('a2')).toBeLessThan(ids.indexOf('a1'));
    expect(res.body.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by action prefix', async () => {
    const res = await request(app).get('/api/audit?action=billing').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.every((e: AuditEntry) => e.action.startsWith('billing'))).toBe(true);
    expect(res.body.entries.some((e: AuditEntry) => e.id === 'a3')).toBe(true);
  });

  it('filters by outcome', async () => {
    const res = await request(app).get('/api/audit?outcome=failure').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.every((e: AuditEntry) => e.outcome === 'failure')).toBe(true);
    expect(res.body.entries.some((e: AuditEntry) => e.id === 'a2')).toBe(true);
  });
});
