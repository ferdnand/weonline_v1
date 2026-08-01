/**
 * MikrotikManager — the single facade the rest of the server talks to.
 *
 * Dispatches each call to the right driver based on `RouterRecord.driver`
 * ('simulator' | 'live'). Exposes the same method names the engine, routes, and
 * scheduler already used on the simulator, so their call sites change only by
 * routing through the manager (+ `await` on writes).
 */

import type { ProvisionSpec, RouterSimState, StoreData } from '../types';
import type { CappedUser, MikrotikDriver } from './driver';
import { MikrotikSimulator } from './simulator';
import { LiveRouterOsDriver } from './live';
import { log } from '../logger';

const mlog = log('mikrotik');

export class MikrotikManager {
  private simulator: MikrotikSimulator;
  private live: LiveRouterOsDriver;

  constructor(private store: { data: StoreData; save: () => void }) {
    this.simulator = new MikrotikSimulator(store);
    this.live = new LiveRouterOsDriver(store);
  }

  /** Pick the driver for a router (defaults to simulator for legacy records). */
  private driverFor(routerId: string): MikrotikDriver {
    const rec = this.store.data.routers.find((r) => r.id === routerId);
    return rec?.driver === 'live' ? this.live : this.simulator;
  }

  ensureRouter(routerId: string, identity: string, model: string, nowMs: number): void {
    this.driverFor(routerId).ensureRouter(routerId, identity, model, nowMs);
  }

  get(routerId: string): RouterSimState | undefined {
    return this.driverFor(routerId).get(routerId);
  }

  setOnline(routerId: string, online: boolean): void {
    this.driverFor(routerId).setOnline(routerId, online);
  }

  upsertUser(routerId: string, spec: ProvisionSpec, nowMs: number): Promise<void> {
    return this.driverFor(routerId).upsertUser(routerId, spec, nowMs);
  }

  setUserEnabled(routerId: string, username: string, enabled: boolean, nowMs: number): Promise<void> {
    return this.driverFor(routerId).setUserEnabled(routerId, username, enabled, nowMs);
  }

  removeUser(routerId: string, username: string): Promise<void> {
    return this.driverFor(routerId).removeUser(routerId, username);
  }

  disconnectSession(routerId: string, sessionId: string): Promise<void> {
    return this.driverFor(routerId).disconnectSession(routerId, sessionId);
  }

  /** Read-only connectivity probe for a live router (used by POST /routers/:id/test). */
  probe(routerId: string): Promise<{ ok: boolean; resource?: any; error?: string }> {
    const rec = this.store.data.routers.find((r) => r.id === routerId);
    if (rec?.driver !== 'live') {
      const s = this.simulator.get(routerId);
      return Promise.resolve({ ok: !!s?.online, resource: s?.resource });
    }
    return this.live.probe(routerId);
  }

  /**
   * Advance/poll every router by `dtSec` seconds. Simulator routers invent
   * traffic; live routers are polled. Returns all capped users across routers.
   */
  async refreshAll(nowMs: number, dtSec: number): Promise<CappedUser[]> {
    const capped: CappedUser[] = [];
    const results = await Promise.all(
      this.store.data.routers.map((rec) =>
        this.driverFor(rec.id)
          .refresh(rec.id, nowMs, dtSec)
          .catch((err) => {
            mlog.error({ routerId: rec.id, err: err instanceof Error ? err.message : err }, 'router refresh failed');
            return [] as CappedUser[];
          }),
      ),
    );
    for (const r of results) capped.push(...r);
    return capped;
  }
}
