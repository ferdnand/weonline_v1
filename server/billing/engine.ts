/**
 * Billing engine.
 *
 * Owns the whole money + lifecycle side of WeOnline and drives the MikroTik
 * simulator for provisioning:
 *
 *   Plans        — billable bandwidth profiles (price + cycle + data cap).
 *   Subscribers  — customer accounts (map 1:1 to a router login).
 *   Subscription — a subscriber's enrollment on a plan, with a lifecycle:
 *                    pending → active → grace → suspended → expired/cancelled
 *   Invoice      — one bill per billing period (recurring).
 *   Payment      — settles an invoice; M-Pesa STK is simulated.
 *
 * Provisioning rule: an ACTIVE (or GRACE) subscription is ENABLED on the router;
 * SUSPENDED/EXPIRED/CANCELLED users are DISABLED. Paying an invoice reactivates
 * and re-provisions automatically.
 */

import type {
  Invoice,
  Payment,
  Plan,
  ServiceType,
  StoreData,
  Subscriber,
  Subscription,
  SubscriptionStatus,
} from '../types';
import { makeId, Store } from '../store';
import { MikrotikSimulator, ProvisionSpec } from '../mikrotik/simulator';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_DAYS = 2; // grace window after period end before suspension
const DUE_DAYS = 3; // invoice due N days after issue

export class BillingEngine {
  constructor(
    private store: Store,
    private sim: MikrotikSimulator,
  ) {}

  private d(): StoreData {
    return this.store.data;
  }

  // ── Plans ──────────────────────────────────────────────────────────────────

  listPlans(): Plan[] {
    return this.d().plans;
  }

  createPlan(input: Omit<Plan, 'id' | 'createdAt'>, nowMs: number): Plan {
    const plan: Plan = {
      ...input,
      id: makeId('plan', nowMs),
      createdAt: new Date(nowMs).toISOString(),
    };
    this.d().plans.push(plan);
    this.store.save();
    return plan;
  }

  updatePlan(id: string, patch: Partial<Plan>): Plan | null {
    const plan = this.d().plans.find((p) => p.id === id);
    if (!plan) return null;
    Object.assign(plan, patch, { id: plan.id, createdAt: plan.createdAt });
    this.store.save();
    return plan;
  }

  deletePlan(id: string): boolean {
    const inUse = this.d().subscriptions.some(
      (s) => s.planId === id && s.status !== 'cancelled' && s.status !== 'expired',
    );
    if (inUse) return false;
    this.d().plans = this.d().plans.filter((p) => p.id !== id);
    this.store.save();
    return true;
  }

  // ── Subscribers ──────────────────────────────────────────────────────────────

  listSubscribers(): Subscriber[] {
    return this.d().subscribers;
  }

  createSubscriber(input: Omit<Subscriber, 'id' | 'createdAt'>, nowMs: number): Subscriber {
    const sub: Subscriber = {
      ...input,
      id: makeId('cust', nowMs),
      createdAt: new Date(nowMs).toISOString(),
    };
    this.d().subscribers.push(sub);
    this.store.save();
    return sub;
  }

  updateSubscriber(id: string, patch: Partial<Subscriber>): Subscriber | null {
    const sub = this.d().subscribers.find((s) => s.id === id);
    if (!sub) return null;
    Object.assign(sub, patch, { id: sub.id, createdAt: sub.createdAt });
    this.store.save();
    return sub;
  }

  deleteSubscriber(id: string): boolean {
    const sub = this.d().subscribers.find((s) => s.id === id);
    if (!sub) return false;
    // Deprovision any subscriptions and remove router users.
    for (const s of this.d().subscriptions.filter((x) => x.subscriberId === id)) {
      this.sim.removeUser(sub.routerId, sub.username);
      s.status = 'cancelled';
    }
    this.d().subscribers = this.d().subscribers.filter((s) => s.id !== id);
    this.store.save();
    return true;
  }

  // ── Subscriptions ────────────────────────────────────────────────────────────

  listSubscriptions(): Subscription[] {
    return this.d().subscriptions;
  }

  getSubscription(id: string): Subscription | undefined {
    return this.d().subscriptions.find((s) => s.id === id);
  }

  private provisionSpec(sub: Subscriber, plan: Plan): ProvisionSpec {
    return {
      username: sub.username,
      password: sub.password,
      service: sub.type as ServiceType,
      profile: plan.name,
      downloadKbps: plan.downloadKbps,
      uploadKbps: plan.uploadKbps,
      dataCapMb: plan.dataCapMb,
      macAddress: sub.macAddress,
      comment: `${sub.name} · ${plan.name}`,
    };
  }

  /**
   * Enroll a subscriber on a plan. Creates a PENDING subscription and its first
   * (unpaid) invoice. The user is provisioned on the router but DISABLED until
   * the first invoice is paid.
   */
  createSubscription(
    subscriberId: string,
    planId: string,
    autoRenew: boolean,
    nowMs: number,
  ): { subscription: Subscription; invoice: Invoice } | { error: string } {
    const sub = this.d().subscribers.find((s) => s.id === subscriberId);
    const plan = this.d().plans.find((p) => p.id === planId);
    if (!sub) return { error: 'subscriber not found' };
    if (!plan) return { error: 'plan not found' };

    const already = this.d().subscriptions.find(
      (s) =>
        s.subscriberId === subscriberId &&
        ['pending', 'active', 'grace', 'suspended'].includes(s.status),
    );
    if (already) return { error: 'subscriber already has an active subscription' };

    const iso = new Date(nowMs).toISOString();
    const periodEnd = new Date(nowMs + plan.durationDays * DAY_MS).toISOString();
    const subscription: Subscription = {
      id: makeId('sub', nowMs),
      subscriberId,
      planId,
      status: 'pending',
      startDate: iso,
      currentPeriodStart: iso,
      currentPeriodEnd: periodEnd,
      autoRenew,
      provisioned: false,
      createdAt: iso,
      updatedAt: iso,
    };
    this.d().subscriptions.push(subscription);

    // Provision on the router but keep disabled until paid.
    this.sim.upsertUser(sub.routerId, this.provisionSpec(sub, plan), nowMs);
    this.sim.setUserEnabled(sub.routerId, sub.username, false, nowMs);

    const invoice = this.issueInvoice(subscription, plan, nowMs);
    this.store.save();
    return { subscription, invoice };
  }

  private setStatus(sub: Subscription, status: SubscriptionStatus, nowMs: number): void {
    sub.status = status;
    sub.updatedAt = new Date(nowMs).toISOString();
  }

  /** Enable/disable a subscriber on the router and flag provisioned. */
  private applyProvisioning(sub: Subscription, enabled: boolean, nowMs: number): void {
    const subscriber = this.d().subscribers.find((s) => s.id === sub.subscriberId);
    const plan = this.d().plans.find((p) => p.id === sub.planId);
    if (!subscriber || !plan) return;
    // Re-upsert (in case caps/rates changed), then set enabled state.
    this.sim.upsertUser(subscriber.routerId, this.provisionSpec(subscriber, plan), nowMs);
    this.sim.setUserEnabled(subscriber.routerId, subscriber.username, enabled, nowMs);
    sub.provisioned = enabled;
  }

  suspendSubscription(id: string, nowMs: number): Subscription | null {
    const sub = this.getSubscription(id);
    if (!sub) return null;
    this.setStatus(sub, 'suspended', nowMs);
    this.applyProvisioning(sub, false, nowMs);
    this.store.save();
    return sub;
  }

  /** Manually (re)activate — used by staff overrides; does not settle invoices. */
  activateSubscription(id: string, nowMs: number): Subscription | null {
    const sub = this.getSubscription(id);
    if (!sub) return null;
    this.setStatus(sub, 'active', nowMs);
    this.applyProvisioning(sub, true, nowMs);
    this.store.save();
    return sub;
  }

  cancelSubscription(id: string, nowMs: number): Subscription | null {
    const sub = this.getSubscription(id);
    if (!sub) return null;
    this.setStatus(sub, 'cancelled', nowMs);
    this.applyProvisioning(sub, false, nowMs);
    // Void any unpaid invoices.
    this.d()
      .invoices.filter((inv) => inv.subscriptionId === id && inv.status !== 'paid')
      .forEach((inv) => (inv.status = 'void'));
    this.store.save();
    return sub;
  }

  // ── Invoices ─────────────────────────────────────────────────────────────────

  listInvoices(): Invoice[] {
    return this.d().invoices;
  }

  private issueInvoice(sub: Subscription, plan: Plan, nowMs: number): Invoice {
    const invoice: Invoice = {
      id: makeId('inv', nowMs),
      number: this.store.nextInvoiceNumber(),
      subscriptionId: sub.id,
      subscriberId: sub.subscriberId,
      planId: plan.id,
      amount: plan.price,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      issuedDate: new Date(nowMs).toISOString(),
      dueDate: new Date(nowMs + DUE_DAYS * DAY_MS).toISOString(),
      status: 'unpaid',
    };
    this.d().invoices.push(invoice);
    return invoice;
  }

  // ── Payments (incl. M-Pesa STK simulation) ──────────────────────────────────

  listPayments(): Payment[] {
    return this.d().payments;
  }

  /**
   * Initiate an M-Pesa STK push against an invoice. Returns a PENDING payment
   * immediately; the scheduler settles it a few seconds later (or the caller can
   * poll and the engine resolves it on the next tick via `settlePending`).
   */
  initiateMpesa(invoiceId: string, phone: string, nowMs: number): Payment | { error: string } {
    const invoice = this.d().invoices.find((i) => i.id === invoiceId);
    if (!invoice) return { error: 'invoice not found' };
    if (invoice.status === 'paid') return { error: 'invoice already paid' };

    const payment: Payment = {
      id: makeId('pay', nowMs),
      invoiceId,
      subscriberId: invoice.subscriberId,
      subscriptionId: invoice.subscriptionId,
      amount: invoice.amount,
      method: 'mpesa',
      status: 'pending',
      phone,
      checkoutRequestId: `ws_CO_${makeId('co', nowMs)}`,
      createdAt: new Date(nowMs).toISOString(),
    };
    this.d().payments.push(payment);
    this.store.save();
    return payment;
  }

  /** Record a manual/cash payment that settles immediately. */
  recordManualPayment(
    invoiceId: string,
    method: 'cash' | 'manual',
    nowMs: number,
  ): Payment | { error: string } {
    const invoice = this.d().invoices.find((i) => i.id === invoiceId);
    if (!invoice) return { error: 'invoice not found' };
    if (invoice.status === 'paid') return { error: 'invoice already paid' };
    const payment: Payment = {
      id: makeId('pay', nowMs),
      invoiceId,
      subscriberId: invoice.subscriberId,
      subscriptionId: invoice.subscriptionId,
      amount: invoice.amount,
      method,
      status: 'completed',
      createdAt: new Date(nowMs).toISOString(),
      completedAt: new Date(nowMs).toISOString(),
    };
    this.d().payments.push(payment);
    this.settleInvoice(invoice, payment, nowMs);
    this.store.save();
    return payment;
  }

  /**
   * Settle any pending M-Pesa payments that are older than ~4s. ~92% succeed;
   * the rest fail with a believable reason (mirrors real STK cancel/timeouts).
   * Called each scheduler tick.
   */
  settlePending(nowMs: number): void {
    for (const p of this.d().payments) {
      if (p.status !== 'pending' || p.method !== 'mpesa') continue;
      const age = nowMs - new Date(p.createdAt).getTime();
      if (age < 4000) continue;
      // Deterministic-ish success based on id hash → stable across restarts.
      const roll = (hash(p.id) % 100) / 100;
      if (roll < 0.92) {
        p.status = 'completed';
        p.completedAt = new Date(nowMs).toISOString();
        p.mpesaReceipt = mpesaReceipt(p.id);
        const invoice = this.d().invoices.find((i) => i.id === p.invoiceId);
        if (invoice && invoice.status !== 'paid') this.settleInvoice(invoice, p, nowMs);
      } else {
        p.status = 'failed';
        p.failureReason = roll < 0.96 ? 'Request cancelled by user' : 'STK push timed out';
      }
    }
    this.store.save();
  }

  /** Mark an invoice paid and (re)activate + provision its subscription. */
  private settleInvoice(invoice: Invoice, payment: Payment, nowMs: number): void {
    invoice.status = 'paid';
    invoice.paidDate = new Date(nowMs).toISOString();
    invoice.paymentId = payment.id;

    const sub = this.getSubscription(invoice.subscriptionId);
    if (!sub) return;

    // Advance the subscription's billing period to match the invoice just paid.
    // If that invoice's period has already fully elapsed (a late payment), start
    // a fresh period from now instead; otherwise adopt the invoice's own period
    // so the subscription's end date moves into the future and the next billing
    // cycle won't immediately re-grace it.
    if (new Date(invoice.periodEnd).getTime() <= nowMs) {
      const plan = this.d().plans.find((p) => p.id === sub.planId);
      const days = plan?.durationDays ?? 30;
      sub.currentPeriodStart = new Date(nowMs).toISOString();
      sub.currentPeriodEnd = new Date(nowMs + days * DAY_MS).toISOString();
    } else {
      sub.currentPeriodStart = invoice.periodStart;
      sub.currentPeriodEnd = invoice.periodEnd;
    }
    this.setStatus(sub, 'active', nowMs);
    this.applyProvisioning(sub, true, nowMs);
  }

  // ── Recurring billing cycle ──────────────────────────────────────────────────

  /**
   * The heartbeat of recurring billing. For every live subscription:
   *  - period ended & invoice unpaid → move to GRACE, then SUSPEND after grace
   *  - period ended & auto-renew & no open invoice → issue the next invoice
   *  - overdue invoices get flagged
   * Also expires users whose hotspot data cap was hit (passed in from the sim).
   */
  runCycle(nowMs: number, cappedUsers: { routerId: string; username: string }[] = []): void {
    // Handle data-cap expiries reported by the simulator.
    for (const { username } of cappedUsers) {
      const subscriber = this.d().subscribers.find((s) => s.username === username);
      if (!subscriber) continue;
      const sub = this.d().subscriptions.find(
        (s) => s.subscriberId === subscriber.id && ['active', 'grace'].includes(s.status),
      );
      if (sub) {
        this.setStatus(sub, 'expired', nowMs);
        sub.provisioned = false; // sim already disabled the user at the cap
      }
    }

    // Flag overdue invoices.
    for (const inv of this.d().invoices) {
      if (inv.status === 'unpaid' && new Date(inv.dueDate).getTime() < nowMs) {
        inv.status = 'overdue';
      }
    }

    for (const sub of this.d().subscriptions) {
      if (!['active', 'grace', 'pending'].includes(sub.status)) continue;
      const plan = this.d().plans.find((p) => p.id === sub.planId);
      if (!plan) continue;
      const periodEnded = new Date(sub.currentPeriodEnd).getTime() <= nowMs;
      if (!periodEnded) continue;

      const openInvoice = this.d().invoices.find(
        (i) =>
          i.subscriptionId === sub.id &&
          (i.status === 'unpaid' || i.status === 'overdue') &&
          new Date(i.periodEnd).getTime() >= new Date(sub.currentPeriodStart).getTime(),
      );

      if (sub.status === 'active') {
        // Renewal: issue the next invoice and enter grace pending payment.
        if (!openInvoice && sub.autoRenew) {
          // roll into the next period on the invoice, keep serving during grace
          const nextEnd = new Date(nowMs + plan.durationDays * DAY_MS).toISOString();
          const staged: Subscription = {
            ...sub,
            currentPeriodStart: new Date(nowMs).toISOString(),
            currentPeriodEnd: nextEnd,
          };
          this.issueInvoice(staged, plan, nowMs);
        }
        this.setStatus(sub, 'grace', nowMs);
        continue;
      }

      if (sub.status === 'grace') {
        const graceOver = new Date(sub.currentPeriodEnd).getTime() + GRACE_DAYS * DAY_MS <= nowMs;
        if (graceOver) {
          this.setStatus(sub, 'suspended', nowMs);
          this.applyProvisioning(sub, false, nowMs);
        }
        continue;
      }

      if (sub.status === 'pending') {
        // Never paid the first invoice past due → suspend.
        const graceOver = new Date(sub.currentPeriodEnd).getTime() + GRACE_DAYS * DAY_MS <= nowMs;
        if (graceOver) {
          this.setStatus(sub, 'suspended', nowMs);
          this.applyProvisioning(sub, false, nowMs);
        }
      }
    }
    this.store.save();
  }

  // ── Reports ──────────────────────────────────────────────────────────────────

  report(nowMs: number) {
    const d = this.d();
    const paid = d.payments.filter((p) => p.status === 'completed');
    const revenueTotal = paid.reduce((a, p) => a + p.amount, 0);

    const monthStart = startOfMonth(nowMs);
    const revenueThisMonth = paid
      .filter((p) => p.completedAt && new Date(p.completedAt).getTime() >= monthStart)
      .reduce((a, p) => a + p.amount, 0);

    const activeSubs = d.subscriptions.filter((s) => s.status === 'active' || s.status === 'grace');
    // MRR: normalise each active plan's price to a 30-day month.
    const mrr = activeSubs.reduce((a, s) => {
      const plan = d.plans.find((p) => p.id === s.planId);
      if (!plan) return a;
      return a + (plan.price * 30) / plan.durationDays;
    }, 0);

    const outstanding = d.invoices
      .filter((i) => i.status === 'unpaid' || i.status === 'overdue')
      .reduce((a, i) => a + i.amount, 0);

    const soon = nowMs + 3 * DAY_MS;
    const expiringSoon = d.subscriptions.filter(
      (s) =>
        (s.status === 'active' || s.status === 'grace') &&
        new Date(s.currentPeriodEnd).getTime() <= soon,
    ).length;

    const statusCounts = d.subscriptions.reduce<Record<string, number>>((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {});

    // Total data usage across all sims (GB).
    let bytes = 0;
    for (const st of Object.values(d.simState)) {
      bytes += st.uplinkBytesIn + st.uplinkBytesOut;
    }

    return {
      revenueTotal: Math.round(revenueTotal),
      revenueThisMonth: Math.round(revenueThisMonth),
      mrr: Math.round(mrr),
      outstanding: Math.round(outstanding),
      activeSubscriptions: activeSubs.length,
      totalSubscribers: d.subscribers.length,
      expiringSoon,
      statusCounts,
      totalPayments: paid.length,
      unpaidInvoices: d.invoices.filter((i) => i.status === 'unpaid' || i.status === 'overdue').length,
      dataUsedGb: Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100,
    };
  }
}

function startOfMonth(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mpesaReceipt(seed: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let h = hash(seed);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet[h % alphabet.length];
    h = Math.imul(h ^ (h >>> 13), 16777619) >>> 0;
  }
  return out;
}
