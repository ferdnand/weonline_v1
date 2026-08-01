/**
 * Express middleware that turns the signed token into an enforced authorization
 * boundary. `requireAuth` rejects anonymous callers; `requireAdminForDeletes`
 * mirrors the former Firestore rules (only admins may DELETE).
 */

import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../types';
import { verifyToken } from './tokens';

// Request augmentation: the verified identity, attached by requireAuth.
export interface AuthedRequest extends Request {
  auth?: { uid: string; role: Role; email: string };
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice('Bearer '.length).trim() || null;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  const payload = verifyToken(token, Date.now());
  if (!payload) {
    res.status(401).json({ error: 'invalid or expired session' });
    return;
  }
  req.auth = { uid: payload.uid, role: payload.role, email: payload.email };
  next();
}

/**
 * Populate req.auth when a valid token is present, but never reject anonymous
 * callers. Used by endpoints that are public yet want to attribute the caller
 * when known (e.g. logout in the audit trail).
 */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (token) {
    const payload = verifyToken(token, Date.now());
    if (payload) req.auth = { uid: payload.uid, role: payload.role, email: payload.email };
  }
  next();
}

/** Admins only for destructive DELETE requests; everything else passes through. */
export function requireAdminForDeletes(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.method === 'DELETE' && req.auth?.role !== 'admin') {
    res.status(403).json({ error: 'admin role required' });
    return;
  }
  next();
}
