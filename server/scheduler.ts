/**
 * The single ticking loop that makes the simulation feel alive.
 *
 *  - every SIM_TICK_MS: advance the RouterOS simulator (sessions, traffic,
 *    telemetry) and settle any pending M-Pesa STK payments.
 *  - every BILLING_TICK_MS: run the recurring billing cycle (renewals, grace,
 *    suspension, overdue flags, data-cap expiries).
 */

import { BillingEngine } from './billing/engine';
import { MikrotikSimulator } from './mikrotik/simulator';

const SIM_TICK_MS = 3000;
const BILLING_TICK_MS = 15000;

export function startScheduler(sim: MikrotikSimulator, engine: BillingEngine): () => void {
  let lastSim = Date.now();
  let lastBilling = 0;
  let pendingCaps: { routerId: string; username: string }[] = [];

  const simTimer = setInterval(() => {
    const now = Date.now();
    const dtSec = Math.max(1, Math.round((now - lastSim) / 1000));
    lastSim = now;
    try {
      const capped = sim.tick(now, dtSec);
      if (capped.length) pendingCaps.push(...capped);
      engine.settlePending(now);
    } catch (err) {
      console.error('[scheduler] sim tick failed:', err);
    }
  }, SIM_TICK_MS);

  const billingTimer = setInterval(() => {
    const now = Date.now();
    if (now - lastBilling < BILLING_TICK_MS) return;
    lastBilling = now;
    try {
      const caps = pendingCaps;
      pendingCaps = [];
      engine.runCycle(now, caps);
    } catch (err) {
      console.error('[scheduler] billing cycle failed:', err);
    }
  }, SIM_TICK_MS);

  return () => {
    clearInterval(simTimer);
    clearInterval(billingTimer);
  };
}
