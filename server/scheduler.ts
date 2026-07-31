/**
 * The single ticking loop that makes the system live.
 *
 *  - every SIM_TICK_MS: refresh every router (simulator invents traffic; live
 *    routers are polled over REST) and settle any pending M-Pesa STK payments.
 *  - every BILLING_TICK_MS: run the recurring billing cycle (renewals, grace,
 *    suspension, overdue flags, data-cap expiries).
 *
 * Ticks are async (live polling + provisioning hit the network), so a re-entrancy
 * guard prevents overlapping runs if a poll is slow.
 */

import { BillingEngine } from './billing/engine';
import { MikrotikManager } from './mikrotik/manager';

const SIM_TICK_MS = 3000;
const BILLING_TICK_MS = 15000;

export function startScheduler(mik: MikrotikManager, engine: BillingEngine): () => void {
  let lastSim = Date.now();
  let lastBilling = 0;
  let pendingCaps: { routerId: string; username: string }[] = [];
  let running = false;

  const timer = setInterval(async () => {
    if (running) return; // skip this beat if the previous one is still working
    running = true;
    try {
      const now = Date.now();
      const dtSec = Math.max(1, Math.round((now - lastSim) / 1000));
      lastSim = now;

      const capped = await mik.refreshAll(now, dtSec);
      if (capped.length) pendingCaps.push(...capped);
      await engine.settlePending(now);

      if (now - lastBilling >= BILLING_TICK_MS) {
        lastBilling = now;
        const caps = pendingCaps;
        pendingCaps = [];
        await engine.runCycle(now, caps);
      }
    } catch (err) {
      console.error('[scheduler] tick failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }, SIM_TICK_MS);

  return () => clearInterval(timer);
}
