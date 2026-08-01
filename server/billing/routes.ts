/**
 * REST surface for the billing engine. Mounted at /api/billing.
 */

import { Router as ExpressRouter } from 'express';
import { BillingEngine } from './engine';
import { generatePassword } from '../crypto';
import { Store } from '../store';
import { recordAudit, actorOf } from '../audit';
import type { AuthedRequest } from '../auth/middleware';

export function billingRoutes(engine: BillingEngine, store: Store): ExpressRouter {
  const r = ExpressRouter();
  const now = () => Date.now();
  const bad = (res: any, msg: string) => res.status(400).json({ error: msg });
  // Attribute a mutation to the authenticated caller.
  const audit = (req: AuthedRequest, action: string, target?: string, details?: Record<string, unknown>) =>
    recordAudit(store, { ...actorOf(req), action, target, details }, now());

  // ── Plans ──────────────────────────────────────────────────────────────────
  r.get('/plans', (_req, res) => res.json(engine.listPlans()));

  r.post('/plans', (req, res) => {
    const b = req.body || {};
    if (!b.name || typeof b.price !== 'number') return bad(res, 'name and numeric price required');
    const plan = engine.createPlan(
      {
        name: b.name,
        type: b.type === 'pppoe' ? 'pppoe' : 'hotspot',
        speedLabel: b.speedLabel || `${Math.round((b.downloadKbps || 5000) / 1000)}Mbps`,
        downloadKbps: b.downloadKbps || 5000,
        uploadKbps: b.uploadKbps || b.downloadKbps || 5000,
        price: b.price,
        durationDays: b.durationDays || 30,
        dataCapMb: b.dataCapMb || 0,
        active: b.active !== false,
      },
      now(),
    );
    audit(req, 'billing.plan.create', plan.id, { name: plan.name, price: plan.price });
    res.json(plan);
  });

  r.put('/plans/:id', (req, res) => {
    const plan = engine.updatePlan(req.params.id, req.body || {});
    if (!plan) return res.status(404).json({ error: 'plan not found' });
    audit(req, 'billing.plan.update', plan.id, { name: plan.name });
    res.json(plan);
  });

  r.delete('/plans/:id', (req, res) => {
    const ok = engine.deletePlan(req.params.id);
    if (!ok) return bad(res, 'plan is in use by an active subscription');
    audit(req, 'billing.plan.delete', req.params.id);
    res.json({ ok: true });
  });

  // ── Subscribers ──────────────────────────────────────────────────────────────
  r.get('/subscribers', (_req, res) => res.json(engine.listSubscribers()));

  r.post('/subscribers', (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.phone || !b.username) return bad(res, 'name, phone, username required');
    const sub = engine.createSubscriber(
      {
        name: b.name,
        phone: b.phone,
        email: b.email,
        type: b.type === 'pppoe' ? 'pppoe' : 'hotspot',
        routerId: b.routerId,
        username: b.username,
        password: b.password || generatePassword(),
        macAddress: b.macAddress,
      },
      now(),
    );
    audit(req, 'billing.subscriber.create', sub.id, { name: sub.name, username: sub.username });
    res.json(sub);
  });

  r.put('/subscribers/:id', (req, res) => {
    const sub = engine.updateSubscriber(req.params.id, req.body || {});
    if (!sub) return res.status(404).json({ error: 'subscriber not found' });
    audit(req, 'billing.subscriber.update', sub.id, { name: sub.name });
    res.json(sub);
  });

  r.delete('/subscribers/:id', async (req, res) => {
    try {
      const ok = await engine.deleteSubscriber(req.params.id);
      if (!ok) return res.status(404).json({ error: 'subscriber not found' });
      audit(req, 'billing.subscriber.delete', req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Subscriptions ────────────────────────────────────────────────────────────
  r.get('/subscriptions', (_req, res) => res.json(engine.listSubscriptions()));

  r.post('/subscriptions', async (req, res) => {
    const b = req.body || {};
    if (!b.subscriberId || !b.planId) return bad(res, 'subscriberId and planId required');
    try {
      const result = await engine.createSubscription(b.subscriberId, b.planId, b.autoRenew !== false, now());
      if ('error' in result) return bad(res, result.error);
      audit(req, 'billing.subscription.create', result.subscription.id, { planId: b.planId, invoice: result.invoice.number });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/subscriptions/:id/suspend', async (req, res) => {
    try {
      const s = await engine.suspendSubscription(req.params.id, now());
      if (!s) return res.status(404).json({ error: 'subscription not found' });
      audit(req, 'billing.subscription.suspend', s.id);
      res.json(s);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/subscriptions/:id/activate', async (req, res) => {
    try {
      const s = await engine.activateSubscription(req.params.id, now());
      if (!s) return res.status(404).json({ error: 'subscription not found' });
      audit(req, 'billing.subscription.activate', s.id);
      res.json(s);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/subscriptions/:id/cancel', async (req, res) => {
    try {
      const s = await engine.cancelSubscription(req.params.id, now());
      if (!s) return res.status(404).json({ error: 'subscription not found' });
      audit(req, 'billing.subscription.cancel', s.id);
      res.json(s);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Invoices ─────────────────────────────────────────────────────────────────
  r.get('/invoices', (_req, res) => res.json(engine.listInvoices()));

  // ── Payments ─────────────────────────────────────────────────────────────────
  r.get('/payments', (_req, res) => res.json(engine.listPayments()));

  // M-Pesa STK push (simulated). Returns a pending payment; poll /payments.
  r.post('/invoices/:id/pay/mpesa', (req, res) => {
    const phone = (req.body && req.body.phone) || '';
    if (!phone) return bad(res, 'phone required');
    const result = engine.initiateMpesa(req.params.id, phone, now());
    if ('error' in result) return bad(res, result.error);
    audit(req, 'billing.payment.mpesa.initiate', result.id, { invoiceId: req.params.id, amount: result.amount });
    res.json(result);
  });

  // Record a manual/cash payment (settles immediately).
  r.post('/invoices/:id/pay/manual', async (req, res) => {
    const method = (req.body && req.body.method) === 'cash' ? 'cash' : 'manual';
    try {
      const result = await engine.recordManualPayment(req.params.id, method, now());
      if ('error' in result) return bad(res, result.error);
      audit(req, 'billing.payment.manual', result.id, { invoiceId: req.params.id, method, amount: result.amount });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Reports / dashboard ──────────────────────────────────────────────────────
  r.get('/report', (_req, res) => res.json(engine.report(now())));

  return r;
}
