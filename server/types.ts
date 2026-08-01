/**
 * Server-side domain types for the WeOnline billing engine and MikroTik
 * RouterOS simulator.
 *
 * These are the source of truth for everything that lives on the server. The
 * browser talks to the server over REST (see src/api/client.ts) and mirrors the
 * shapes it needs. Keeping them here (rather than in src/data/models.ts) avoids
 * pulling server-only concepts into the client bundle.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Billing domain
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceType = 'hotspot' | 'pppoe';

/** A billable product: a bandwidth profile with a price and a billing cycle. */
export interface Plan {
  id: string;
  name: string;
  type: ServiceType;
  speedLabel: string; // human label, e.g. "Up to 10Mbps"
  downloadKbps: number; // used to build the RouterOS rate-limit (rx)
  uploadKbps: number; // rate-limit (tx)
  price: number; // KES per cycle
  durationDays: number; // billing cycle length
  dataCapMb: number; // 0 = unlimited; otherwise auto-suspend when exceeded
  active: boolean;
  createdAt: string;
}

/** A customer account. One subscriber may hold at most one active subscription. */
export interface Subscriber {
  id: string;
  name: string;
  phone: string; // MSISDN, e.g. 2547XXXXXXXX (used for M-Pesa)
  email?: string;
  type: ServiceType;
  routerId: string; // which router serves this subscriber
  username: string; // PPPoE / hotspot login provisioned on the router
  password: string;
  macAddress?: string; // hotspot binding (optional)
  createdAt: string;
}

export type SubscriptionStatus =
  | 'pending' // created, awaiting first payment — not yet on the network
  | 'active' // paid & provisioned (enabled on router)
  | 'grace' // period ended, invoice unpaid, still online during grace window
  | 'suspended' // disabled on router for non-payment
  | 'cancelled' // ended by staff
  | 'expired'; // reached data cap / final expiry

export interface Subscription {
  id: string;
  subscriberId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  autoRenew: boolean;
  provisioned: boolean; // whether the user is currently enabled on the router
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = 'unpaid' | 'paid' | 'overdue' | 'void';

export interface Invoice {
  id: string;
  number: string; // human invoice number, e.g. INV-000123
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
  mpesaReceipt?: string; // e.g. "SGH7XY12ZA"
  checkoutRequestId?: string; // STK push correlation id
  failureReason?: string;
  createdAt: string;
  completedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// MikroTik RouterOS simulator state
// ─────────────────────────────────────────────────────────────────────────────

/** A /ppp secret (PPPoE credential) as RouterOS models it. */
export interface PppSecret {
  name: string;
  password: string;
  profile: string; // maps to a plan
  service: 'pppoe';
  rateLimit: string; // "rx/tx" e.g. "10M/10M"
  disabled: boolean;
  comment?: string;
  lastLoggedOut?: string;
}

/** A /ip/hotspot/user entry. */
export interface HotspotUser {
  name: string;
  password: string;
  profile: string;
  macAddress?: string;
  rateLimit: string;
  limitBytesTotal: number; // data cap in bytes (0 = unlimited)
  bytesIn: number;
  bytesOut: number;
  disabled: boolean;
  comment?: string;
}

/** A live session in /ppp/active or /ip/hotspot/active. */
export interface ActiveSession {
  id: string; // .id
  name: string; // user
  service: ServiceType;
  address: string; // assigned IP
  macAddress: string;
  uptimeSec: number;
  bytesIn: number;
  bytesOut: number;
  rateRxKbps: number; // instantaneous throughput
  rateTxKbps: number;
  since: string;
}

/** A /queue/simple entry (per-user rate shaping). */
export interface SimpleQueue {
  id: string;
  name: string;
  target: string; // IP/32
  maxLimit: string; // "rx/tx"
  bytesIn: number;
  bytesOut: number;
  disabled: boolean;
}

/** /system/resource + /system/health. */
export interface SystemResource {
  cpuLoad: number; // %
  freeMemoryMb: number;
  totalMemoryMb: number;
  memoryUsedPct: number;
  temperature: number; // °C
  voltage: number; // V
  uptimeSec: number;
  version: string;
  boardName: string;
  cpuFrequencyMhz: number;
}

/** Everything the simulator holds for a single router. */
export interface RouterSimState {
  routerId: string;
  identity: string;
  model: string;
  online: boolean;
  resource: SystemResource;
  pppSecrets: PppSecret[];
  hotspotUsers: HotspotUser[];
  activeSessions: ActiveSession[];
  queues: SimpleQueue[];
  // aggregate interface counters (ether1 = uplink)
  uplinkBytesIn: number;
  uplinkBytesOut: number;
  lastTick: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent store shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a router is backed:
 *  - 'simulator' — the in-memory MikrotikSimulator (demo routers).
 *  - 'live'      — a real RouterOS device driven over the REST API.
 */
export type RouterDriver = 'simulator' | 'live';

/** Basic router config record (server-owned). Carries live-connection details. */
export interface RouterRecord {
  id: string;
  name: string;
  location: string;
  ipAddress: string;
  model: string;
  identity: string;
  status: 'online' | 'offline';
  apiPort: number;
  username: string;
  password: string;
  // ── live-device fields ──
  driver: RouterDriver;
  /** REST over HTTPS (true) or plain HTTP (false). Only used when driver==='live'. */
  tls: boolean;
  /** Accept the router's self-signed TLS cert (disable verification). LAN only. */
  insecureTls?: boolean;
  /** Last provisioning/poll error against a live device (surfaced in the UI). */
  lastError?: string;
  /** ISO timestamp of the last successful live poll. */
  lastPolledAt?: string;
}

/**
 * The input contract for provisioning a user on a router (PPPoE secret or hotspot
 * user + rate profile). Shared by every driver.
 */
export interface ProvisionSpec {
  username: string;
  password: string;
  service: ServiceType;
  profile: string; // plan name → maps to a RouterOS profile
  downloadKbps: number;
  uploadKbps: number;
  dataCapMb: number; // 0 = unlimited
  macAddress?: string;
  comment?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth domain (server-side — the real authorization boundary)
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'technician';

/**
 * A staff account. Credentials are PBKDF2-hashed; the plaintext password is never
 * stored. This is the source of truth for who may call the API and at what role.
 */
export interface AuthUserRecord {
  uid: string;
  email: string;
  role: Role;
  displayName: string | null;
  passwordHash: string; // hex
  salt: string; // hex
  iterations: number; // PBKDF2 rounds (stored so hashes can be upgraded later)
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit trail (persisted "who did what")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single business-level audit event. Low-volume, security/compliance-relevant
 * actions only (logins, CRUD on subscribers/plans, payments, provisioning) — NOT
 * per-request HTTP logs, which stream to the operational logger instead. Kept in
 * the store so it survives restarts and is queryable via GET /api/audit.
 */
export interface AuditEntry {
  id: string;
  ts: string; // ISO timestamp (server clock)
  actorId: string | null; // uid, or null for anonymous/system
  actorEmail: string | null; // email, or a label like 'system' / 'anonymous'
  action: string; // dotted verb, e.g. 'auth.login', 'billing.subscriber.create'
  target?: string; // affected entity id/label, e.g. subscriber id
  outcome: 'success' | 'failure';
  ip?: string; // client IP when known
  details?: Record<string, unknown>; // small, non-sensitive extra context
}

export interface StoreData {
  meta: { seeded: boolean; invoiceSeq: number; version: number };
  users: AuthUserRecord[];
  plans: Plan[];
  subscribers: Subscriber[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  payments: Payment[];
  routers: RouterRecord[];
  simState: Record<string, RouterSimState>; // keyed by routerId
  auditLog: AuditEntry[]; // capped ring of business audit events (newest last)
}
