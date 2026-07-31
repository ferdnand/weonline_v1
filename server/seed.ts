/**
 * First-run seed data so the app has a believable, ready-to-explore world:
 * two routers, a spread of plans, and a handful of subscribers already enrolled
 * across the subscription lifecycle (active, grace, suspended, pending).
 */

import type { RouterRecord } from './types';
import { BillingEngine } from './billing/engine';
import { MikrotikSimulator } from './mikrotik/simulator';
import { Store } from './store';

const DAY_MS = 24 * 60 * 60 * 1000;

export function seedIfEmpty(store: Store, sim: MikrotikSimulator, engine: BillingEngine): void {
  if (store.data.meta.seeded) return;
  const now = Date.now();

  // ── Routers ────────────────────────────────────────────────────────────────
  const routers: RouterRecord[] = [
    {
      id: 'rtr_hq',
      name: 'HQ Core Router',
      location: 'Nairobi CBD',
      ipAddress: '192.168.88.1',
      model: 'MikroTik CCR2004-1G-12S+2XS',
      identity: 'WeOnline-HQ',
      status: 'online',
      apiPort: 8728,
      username: 'admin',
      password: 'admin',
    },
    {
      id: 'rtr_estate',
      name: 'Estate Distribution',
      location: 'Kikuyu',
      ipAddress: '192.168.89.1',
      model: 'MikroTik L009UiGS-RM',
      identity: 'WeOnline-Estate',
      status: 'online',
      apiPort: 8728,
      username: 'admin',
      password: 'admin',
    },
  ];
  store.data.routers = routers;
  for (const r of routers) sim.ensureRouter(r.id, r.identity, r.model, now);

  // ── Plans ──────────────────────────────────────────────────────────────────
  const plans = [
    engine.createPlan(
      { name: 'Hotspot Daily', type: 'hotspot', speedLabel: 'Up to 5Mbps', downloadKbps: 5000, uploadKbps: 5000, price: 60, durationDays: 1, dataCapMb: 2048, active: true },
      now,
    ),
    engine.createPlan(
      { name: 'Hotspot Weekly', type: 'hotspot', speedLabel: 'Up to 8Mbps', downloadKbps: 8000, uploadKbps: 8000, price: 300, durationDays: 7, dataCapMb: 0, active: true },
      now,
    ),
    engine.createPlan(
      { name: 'Home Basic', type: 'pppoe', speedLabel: 'Up to 10Mbps', downloadKbps: 10000, uploadKbps: 10000, price: 1500, durationDays: 30, dataCapMb: 0, active: true },
      now,
    ),
    engine.createPlan(
      { name: 'Home Plus', type: 'pppoe', speedLabel: 'Up to 20Mbps', downloadKbps: 20000, uploadKbps: 20000, price: 2500, durationDays: 30, dataCapMb: 0, active: true },
      now,
    ),
    engine.createPlan(
      { name: 'Business', type: 'pppoe', speedLabel: 'Up to 40Mbps', downloadKbps: 40000, uploadKbps: 40000, price: 6000, durationDays: 30, dataCapMb: 0, active: true },
      now,
    ),
  ];
  const homeBasic = plans[2];
  const homePlus = plans[3];
  const hotspotWeekly = plans[1];
  const business = plans[4];

  // ── Subscribers + subscriptions across the lifecycle ────────────────────────
  type Seed = {
    name: string; phone: string; type: 'hotspot' | 'pppoe'; router: string;
    username: string; planId: string; scenario: 'active' | 'grace' | 'suspended' | 'pending';
  };
  const seeds: Seed[] = [
    { name: 'Amina Wanjiru', phone: '254712345678', type: 'pppoe', router: 'rtr_hq', username: 'amina.w', planId: homePlus.id, scenario: 'active' },
    { name: 'Brian Otieno', phone: '254723456789', type: 'pppoe', router: 'rtr_hq', username: 'brian.o', planId: homeBasic.id, scenario: 'active' },
    { name: 'Cynthia Mwikali', phone: '254734567890', type: 'pppoe', router: 'rtr_estate', username: 'cynthia.m', planId: business.id, scenario: 'grace' },
    { name: 'David Kiplagat', phone: '254745678901', type: 'pppoe', router: 'rtr_estate', username: 'david.k', planId: homeBasic.id, scenario: 'suspended' },
    { name: 'Esther Njeri', phone: '254756789012', type: 'hotspot', router: 'rtr_hq', username: 'esther.n', planId: hotspotWeekly.id, scenario: 'active' },
    { name: 'Felix Barasa', phone: '254767890123', type: 'hotspot', router: 'rtr_estate', username: 'felix.b', planId: hotspotWeekly.id, scenario: 'pending' },
  ];

  for (const s of seeds) {
    const subscriber = engine.createSubscriber(
      { name: s.name, phone: s.phone, type: s.type, routerId: s.router, username: s.username, password: 'pass1234' },
      now,
    );
    const created = engine.createSubscription(subscriber.id, s.planId, true, now);
    if ('error' in created) continue;
    const invoice = created.invoice;

    if (s.scenario === 'active') {
      engine.recordManualPayment(invoice.id, 'manual', now);
    } else if (s.scenario === 'grace') {
      // Paid the first period, but it has already lapsed into grace.
      engine.recordManualPayment(invoice.id, 'manual', now);
      const sub = engine.getSubscription(created.subscription.id)!;
      sub.currentPeriodStart = new Date(now - 32 * DAY_MS).toISOString();
      sub.currentPeriodEnd = new Date(now - 1 * DAY_MS).toISOString();
      engine.runCycle(now, []); // pushes it into grace + issues renewal invoice
    } else if (s.scenario === 'suspended') {
      // Never paid; period long past → suspend.
      const sub = engine.getSubscription(created.subscription.id)!;
      sub.currentPeriodStart = new Date(now - 40 * DAY_MS).toISOString();
      sub.currentPeriodEnd = new Date(now - 35 * DAY_MS).toISOString();
      engine.runCycle(now, []);
    }
    // 'pending' left as-is (awaiting first payment).
  }

  store.data.meta.seeded = true;
  store.flush();
  console.log('[seed] initial WeOnline world created (2 routers, 5 plans, 6 subscribers)');
}
