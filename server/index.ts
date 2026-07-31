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

  app.use('/api/mikrotik', mikrotikRoutes(store, mik));
  app.use('/api/billing', billingRoutes(engine));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

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
