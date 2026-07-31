/**
 * Assembles the WeOnline backend: store → simulator → billing engine →
 * scheduler → REST routes, and exposes a single `mountApi(app)` for server.ts.
 */

import type { Express } from 'express';
import { Store } from './store';
import { MikrotikSimulator } from './mikrotik/simulator';
import { BillingEngine } from './billing/engine';
import { mikrotikRoutes } from './mikrotik/routes';
import { billingRoutes } from './billing/routes';
import { startScheduler } from './scheduler';
import { seedIfEmpty } from './seed';

export interface Backend {
  store: Store;
  sim: MikrotikSimulator;
  engine: BillingEngine;
  stop: () => void;
}

export function mountApi(app: Express): Backend {
  const store = new Store();
  const sim = new MikrotikSimulator(store);
  const engine = new BillingEngine(store, sim);

  seedIfEmpty(store, sim, engine);

  app.use('/api/mikrotik', mikrotikRoutes(store, sim));
  app.use('/api/billing', billingRoutes(engine));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  const stopScheduler = startScheduler(sim, engine);

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

  return { store, sim, engine, stop };
}
