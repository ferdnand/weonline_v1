/**
 * Assembles the WeOnline backend: store → simulator → billing engine →
 * scheduler → REST routes, and exposes a single `mountApi(app)` for server.ts.
 */

import type { Express } from 'express';
import { Store } from './store';
import { MikrotikManager } from './mikrotik/manager';
import { BillingEngine } from './billing/engine';
import { mikrotikRoutes } from './mikrotik/routes';
import { billingRoutes } from './billing/routes';
import { authRoutes } from './auth/routes';
import { auditRoutes } from './auditRoutes';
import { requireAuth, requireAdminForDeletes } from './auth/middleware';
import { startScheduler } from './scheduler';
import { seedIfEmpty } from './seed';

export interface Backend {
  store: Store;
  mik: MikrotikManager;
  engine: BillingEngine;
  stop: () => void;
}

export async function mountApi(app: Express): Promise<Backend> {
  const store = new Store();
  const mik = new MikrotikManager(store);
  const engine = new BillingEngine(store, mik);

  await seedIfEmpty(store, mik, engine);

  // Public: auth + health. Everything else requires a valid session, and DELETEs
  // additionally require the admin role (mirrors the former Firestore rules).
  app.use('/api/auth', authRoutes(store));
  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/mikrotik', requireAuth, requireAdminForDeletes, mikrotikRoutes(store, mik));
  app.use('/api/billing', requireAuth, requireAdminForDeletes, billingRoutes(engine, store));

  // Audit trail (admin-only, enforced inside auditRoutes).
  app.use('/api/audit', requireAuth, auditRoutes(store));

  const stopScheduler = startScheduler(mik, engine);

  const stop = () => {
    stopScheduler();
    store.flush();
  };

  // Persist on shutdown so nothing is lost between restarts.
  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });

  return { store, mik, engine, stop };
}
