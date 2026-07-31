process.env.AUTH_SECRET = 'integration-test-secret-16+';

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authRoutes } from './routes';
import { requireAuth, requireAdminForDeletes } from './middleware';
import type { Store } from '../store';
import type { AuthUserRecord } from '../types';

function fakeStore(): Store {
  const users: AuthUserRecord[] = [];
  return { data: { users }, save: () => {} } as unknown as Store;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes(fakeStore()));
  // A stand-in protected resource guarded exactly like the real /api routes.
  const guarded = express.Router();
  guarded.get('/', (_req, res) => res.json({ ok: true }));
  guarded.delete('/:id', (_req, res) => res.json({ deleted: true }));
  app.use('/api/thing', requireAuth, requireAdminForDeletes, guarded);
  return app;
}

let app: express.Express;
let adminToken: string;
let techToken: string;

beforeAll(async () => {
  app = buildApp();
  // First registration bootstraps the admin.
  const reg = await request(app).post('/api/auth/register').send({ email: 'admin@x.net', password: 'password1' });
  expect(reg.status).toBe(200);
  adminToken = reg.body.token;
  // Admin creates a technician, who then logs in.
  await request(app)
    .post('/api/auth/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'tech@x.net', password: 'password2', role: 'technician' });
  const login = await request(app).post('/api/auth/login').send({ email: 'tech@x.net', password: 'password2' });
  techToken = login.body.token;
});

describe('API auth gate', () => {
  it('rejects anonymous requests with 401', async () => {
    expect((await request(app).get('/api/thing')).status).toBe(401);
  });

  it('rejects a bad token with 401', async () => {
    expect((await request(app).get('/api/thing').set('Authorization', 'Bearer nope.nope')).status).toBe(401);
  });

  it('allows an authenticated GET', async () => {
    const res = await request(app).get('/api/thing').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows admin DELETE but forbids technician DELETE (403)', async () => {
    const tech = await request(app).delete('/api/thing/1').set('Authorization', `Bearer ${techToken}`);
    expect(tech.status).toBe(403);
    const admin = await request(app).delete('/api/thing/1').set('Authorization', `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
  });

  it('closes self-registration after the first account, generic login failure', async () => {
    const second = await request(app).post('/api/auth/register').send({ email: 'x@y.net', password: 'password9' });
    expect(second.status).toBe(403);
    const bad = await request(app).post('/api/auth/login').send({ email: 'admin@x.net', password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch(/invalid email or password/);
  });
});

describe('staff management (admin-only)', () => {
  const admin = (t = adminToken) => `Bearer ${t}`;

  it('lets admins list staff but forbids technicians', async () => {
    const asTech = await request(app).get('/api/auth/users').set('Authorization', admin(techToken));
    expect(asTech.status).toBe(403);
    const asAdmin = await request(app).get('/api/auth/users').set('Authorization', admin());
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.users.length).toBe(2);
    // Never leaks hashes.
    expect(JSON.stringify(asAdmin.body)).not.toMatch(/passwordHash|salt/);
  });

  it('refuses to let an admin delete their own account or change their own role', async () => {
    const list = await request(app).get('/api/auth/users').set('Authorization', admin());
    const me = list.body.users.find((u: { email: string }) => u.email === 'admin@x.net');
    const delSelf = await request(app).delete(`/api/auth/users/${me.uid}`).set('Authorization', admin());
    expect(delSelf.status).toBe(400);
    const roleSelf = await request(app).post(`/api/auth/users/${me.uid}/role`).set('Authorization', admin()).send({ role: 'technician' });
    expect(roleSelf.status).toBe(400);
  });

  it('lets an admin reset a password, and the user can log in with it', async () => {
    const list = await request(app).get('/api/auth/users').set('Authorization', admin());
    const tech = list.body.users.find((u: { email: string }) => u.email === 'tech@x.net');
    const reset = await request(app).post(`/api/auth/users/${tech.uid}/password`).set('Authorization', admin()).send({ password: 'brand-new-pass' });
    expect(reset.status).toBe(200);
    const relogin = await request(app).post('/api/auth/login').send({ email: 'tech@x.net', password: 'brand-new-pass' });
    expect(relogin.status).toBe(200);
  });

  it('lets an admin delete a technician', async () => {
    await request(app).post('/api/auth/users').set('Authorization', admin()).send({ email: 'temp@x.net', password: 'password3' });
    const list = await request(app).get('/api/auth/users').set('Authorization', admin());
    const temp = list.body.users.find((u: { email: string }) => u.email === 'temp@x.net');
    const del = await request(app).delete(`/api/auth/users/${temp.uid}`).set('Authorization', admin());
    expect(del.status).toBe(200);
  });
});
