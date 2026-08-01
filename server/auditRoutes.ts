/**
 * Read-only REST surface for the persisted audit trail. Mounted at /api/audit
 * behind requireAuth; the router itself enforces admin-only access (a GET, so it
 * isn't covered by requireAdminForDeletes).
 *
 * Newest-first, with optional filtering by actor (substring, case-insensitive),
 * action (prefix), and outcome, plus limit/offset pagination.
 */

import { Router as ExpressRouter } from 'express';
import { Store } from './store';
import type { AuthedRequest } from './auth/middleware';

export function auditRoutes(store: Store): ExpressRouter {
  const r = ExpressRouter();

  r.get('/', (req: AuthedRequest, res) => {
    if (req.auth?.role !== 'admin') {
      return res.status(403).json({ error: 'admin role required' });
    }
    const { actor, action, outcome } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let entries = store.data.auditLog.slice().reverse(); // newest first
    if (actor) entries = entries.filter((e) => (e.actorEmail || '').toLowerCase().includes(actor.toLowerCase()));
    if (action) entries = entries.filter((e) => e.action.startsWith(action));
    if (outcome === 'success' || outcome === 'failure') entries = entries.filter((e) => e.outcome === outcome);

    const total = entries.length;
    res.json({ total, limit, offset, entries: entries.slice(offset, offset + limit) });
  });

  return r;
}
