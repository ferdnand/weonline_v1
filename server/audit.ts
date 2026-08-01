/**
 * The persisted audit trail — a durable "who did what" record.
 *
 * Business-level, security-relevant actions only (logins, subscriber/plan CRUD,
 * payments, router provisioning). These are LOW volume, so keeping them in the
 * JSON store is fine; high-volume per-request logs go to the operational logger
 * (server/logger.ts) and never here, to keep the wholesale-rewritten store small.
 *
 * The log is a capped ring (newest last): once it exceeds AUDIT_CAP entries the
 * oldest are dropped, bounding the on-disk file. Every event is also mirrored to
 * the structured logger so it reaches the log platform (Better Stack / drains).
 */

import { makeId, type Store } from './store';
import type { AuditEntry } from './types';
import { log } from './logger';

const alog = log('audit');

// Keep the most recent N events on disk. Tune via AUDIT_CAP. Read per-call (not
// at module load) so it stays configurable regardless of import ordering.
function auditCap(): number {
  return Number(process.env.AUDIT_CAP) || 5000;
}

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string;
  outcome?: 'success' | 'failure';
  ip?: string;
  details?: Record<string, unknown>;
}

/**
 * Pull the actor identity + client IP off an authenticated request, so route
 * handlers can attribute an audit event with a single spread:
 *   recordAudit(store, { ...actorOf(req), action: '…', target: id }, now())
 */
export function actorOf(req: { auth?: { uid: string; email: string }; ip?: string }): {
  actorId: string | null;
  actorEmail: string | null;
  ip?: string;
} {
  return { actorId: req.auth?.uid ?? null, actorEmail: req.auth?.email ?? null, ip: req.ip };
}

/**
 * Append an audit event. Mutates the in-memory store, trims to the cap, and
 * schedules a debounced flush via store.save(). Also emits to the logger.
 */
export function recordAudit(store: Store, input: AuditInput, nowMs: number): AuditEntry {
  const entry: AuditEntry = {
    id: makeId('aud', nowMs),
    ts: new Date(nowMs).toISOString(),
    actorId: input.actorId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: input.action,
    target: input.target,
    outcome: input.outcome ?? 'success',
    ip: input.ip,
    details: input.details,
  };

  store.data.auditLog.push(entry);
  const cap = auditCap();
  if (store.data.auditLog.length > cap) {
    store.data.auditLog.splice(0, store.data.auditLog.length - cap);
  }
  store.save();

  // Mirror to the operational logger so the platform captures it too.
  alog.info(
    {
      action: entry.action,
      outcome: entry.outcome,
      actor: entry.actorEmail,
      target: entry.target,
      ip: entry.ip,
      ...(entry.details ? { details: entry.details } : {}),
    },
    `audit: ${entry.action}`,
  );

  return entry;
}
