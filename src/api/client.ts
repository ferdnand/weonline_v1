/**
 * Typed REST client for the WeOnline backend (server/).
 *
 * The billing + MikroTik features talk to the server over HTTP. Auth and the
 * legacy admin CRUD still use the IndexedDB data layer (src/data) — this module
 * is purely the new server-backed surface.
 */

// ── Mirrored server DTOs ──────────────────────────────────────────────────────

export type ServiceType = 'hotspot' | 'pppoe';

export interface Plan {
  id: string;
  name: string;
  type: ServiceType;
  speedLabel: string;
  downloadKbps: number;
  uploadKbps: number;
  price: number;
  durationDays: number;
  dataCapMb: number;
  active: boolean;
  createdAt: string;
}

export interface Subscriber {
  id: string;
  name: string;
  phone: string;
  email?: string;
  type: ServiceType;
  routerId: string;
  username: string;
  password: string;
  macAddress?: string;
  createdAt: string;
}

export type SubscriptionStatus =
  | 'pending' | 'active' | 'grace' | 'suspended' | 'cancelled' | 'expired';

export interface Subscription {
  id: string;
  subscriberId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  autoRenew: boolean;
  provisioned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = 'unpaid' | 'paid' | 'overdue' | 'void';

export interface Invoice {
  id: string;
  number: string;
  subscriptionId: string;
  subscriberId: string;
  planId: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  issuedDate: string;
  dueDate: string;
  status: InvoiceStatus;
  paidDate?: string;
  paymentId?: string;
}

export type PaymentMethod = 'mpesa' | 'cash' | 'manual';
export type PaymentStatus = 'pending' | 'completed' | 'failed';

export interface Payment {
  id: string;
  invoiceId?: string;
  subscriberId: string;
  subscriptionId?: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  phone?: string;
  mpesaReceipt?: string;
  checkoutRequestId?: string;
  failureReason?: string;
  createdAt: string;
  completedAt?: string;
}

export interface BillingReport {
  revenueTotal: number;
  revenueThisMonth: number;
  mrr: number;
  outstanding: number;
  activeSubscriptions: number;
  totalSubscribers: number;
  expiringSoon: number;
  statusCounts: Record<string, number>;
  totalPayments: number;
  unpaidInvoices: number;
  dataUsedGb: number;
}

export interface SystemResource {
  cpuLoad: number;
  freeMemoryMb: number;
  totalMemoryMb: number;
  memoryUsedPct: number;
  temperature: number;
  voltage: number;
  uptimeSec: number;
  version: string;
  boardName: string;
  cpuFrequencyMhz: number;
  uptime?: string;
}

export interface RouterSummary {
  id: string;
  name: string;
  location: string;
  ipAddress: string;
  model: string;
  identity: string;
  status: 'online' | 'offline';
  online: boolean;
  resource?: SystemResource;
  activeSessions: number;
  pppSecrets: number;
  hotspotUsers: number;
  queues: number;
}

export interface ActiveSession {
  id: string;
  name: string;
  service: ServiceType;
  address: string;
  macAddress: string;
  uptimeSec: number;
  bytesIn: number;
  bytesOut: number;
  rateRxKbps: number;
  rateTxKbps: number;
  since: string;
}

export interface PppSecret {
  name: string; password: string; profile: string; service: 'pppoe';
  rateLimit: string; disabled: boolean; comment?: string; lastLoggedOut?: string;
}

export interface HotspotUser {
  name: string; password: string; profile: string; macAddress?: string;
  rateLimit: string; limitBytesTotal: number; bytesIn: number; bytesOut: number;
  disabled: boolean; comment?: string;
}

export interface SimpleQueue {
  id: string; name: string; target: string; maxLimit: string;
  bytesIn: number; bytesOut: number; disabled: boolean;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Billing
  report: () => req<BillingReport>('GET', '/api/billing/report'),

  listPlans: () => req<Plan[]>('GET', '/api/billing/plans'),
  createPlan: (p: Partial<Plan>) => req<Plan>('POST', '/api/billing/plans', p),
  updatePlan: (id: string, p: Partial<Plan>) => req<Plan>('PUT', `/api/billing/plans/${id}`, p),
  deletePlan: (id: string) => req<{ ok: true }>('DELETE', `/api/billing/plans/${id}`),

  listSubscribers: () => req<Subscriber[]>('GET', '/api/billing/subscribers'),
  createSubscriber: (s: Partial<Subscriber>) => req<Subscriber>('POST', '/api/billing/subscribers', s),
  updateSubscriber: (id: string, s: Partial<Subscriber>) => req<Subscriber>('PUT', `/api/billing/subscribers/${id}`, s),
  deleteSubscriber: (id: string) => req<{ ok: true }>('DELETE', `/api/billing/subscribers/${id}`),

  listSubscriptions: () => req<Subscription[]>('GET', '/api/billing/subscriptions'),
  createSubscription: (subscriberId: string, planId: string, autoRenew = true) =>
    req<{ subscription: Subscription; invoice: Invoice }>('POST', '/api/billing/subscriptions', { subscriberId, planId, autoRenew }),
  suspendSubscription: (id: string) => req<Subscription>('POST', `/api/billing/subscriptions/${id}/suspend`),
  activateSubscription: (id: string) => req<Subscription>('POST', `/api/billing/subscriptions/${id}/activate`),
  cancelSubscription: (id: string) => req<Subscription>('POST', `/api/billing/subscriptions/${id}/cancel`),

  listInvoices: () => req<Invoice[]>('GET', '/api/billing/invoices'),
  listPayments: () => req<Payment[]>('GET', '/api/billing/payments'),
  payMpesa: (invoiceId: string, phone: string) =>
    req<Payment>('POST', `/api/billing/invoices/${invoiceId}/pay/mpesa`, { phone }),
  payManual: (invoiceId: string, method: 'cash' | 'manual' = 'manual') =>
    req<Payment>('POST', `/api/billing/invoices/${invoiceId}/pay/manual`, { method }),

  // MikroTik
  listRouters: () => req<RouterSummary[]>('GET', '/api/mikrotik/routers'),
  getRouter: (id: string) =>
    req<{ router: RouterSummary; sim: any; uptime: string | null }>('GET', `/api/mikrotik/routers/${id}`),
  routerActive: (id: string) => req<ActiveSession[]>('GET', `/api/mikrotik/routers/${id}/active`),
  routerSecrets: (id: string) => req<PppSecret[]>('GET', `/api/mikrotik/routers/${id}/secrets`),
  routerHotspotUsers: (id: string) => req<HotspotUser[]>('GET', `/api/mikrotik/routers/${id}/hotspot-users`),
  routerQueues: (id: string) => req<SimpleQueue[]>('GET', `/api/mikrotik/routers/${id}/queues`),
  routerResource: (id: string) => req<SystemResource>('GET', `/api/mikrotik/routers/${id}/resource`),
  setRouterPower: (id: string, online: boolean) =>
    req<{ id: string; status: string }>('POST', `/api/mikrotik/routers/${id}/power`, { online }),
  disconnectSession: (id: string, sessionId: string) =>
    req<{ ok: true }>('POST', `/api/mikrotik/routers/${id}/active/${sessionId}/disconnect`),
  setUserEnabled: (id: string, username: string, enabled: boolean) =>
    req<{ ok: true }>('POST', `/api/mikrotik/routers/${id}/users/${encodeURIComponent(username)}/enabled`, { enabled }),
};

// ── Formatting helpers shared by the views ────────────────────────────────────

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function fmtRate(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
