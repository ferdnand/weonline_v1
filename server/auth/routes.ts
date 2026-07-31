/**
 * Public auth surface, mounted at /api/auth. Issues and validates session tokens.
 *
 * NOTE: self-registration is open and grants a `technician` role (the first ever
 * account bootstraps as `admin`). For production this should become admin-invite-
 * only; see the SECURITY summary.
 */

import { Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { Store } from '../store';
import { AuthService, toPublicUser } from './service';
import { issueToken } from './tokens';
import { requireAuth, type AuthedRequest } from './middleware';

// Throttle credential endpoints to blunt brute-force / credential-stuffing.
// Successful logins don't count against the limit, so normal use is unaffected.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'too many attempts — try again later' },
});

export function authRoutes(store: Store): ExpressRouter {
  const r = ExpressRouter();
  const auth = new AuthService(store);
  const now = () => Date.now();

  // Is open self-registration still available? Only true until the first (admin)
  // account exists; the login UI uses this to show/hide "Sign up".
  r.get('/registration-open', (_req, res) => res.json({ open: !auth.hasUsers() }));

  // Open registration bootstraps the FIRST account (admin) only. After that,
  // accounts are created by an admin via POST /users — self-signup is closed.
  r.post('/register', credentialLimiter, (req, res) => {
    if (auth.hasUsers()) {
      return res.status(403).json({ error: 'registration is closed — ask an admin to create your account' });
    }
    const { email, password, displayName } = req.body || {};
    try {
      const user = auth.createUser(email, password, displayName ?? null, now());
      const token = issueToken(user, now());
      res.json({ token, user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'registration failed' });
    }
  });

  // ── Admin-only staff management ─────────────────────────────────────────────
  const adminOnly = (req: AuthedRequest, res: import('express').Response, next: import('express').NextFunction) => {
    if (req.auth?.role !== 'admin') {
      res.status(403).json({ error: 'admin role required' });
      return;
    }
    next();
  };

  // List all staff accounts (no password hashes).
  r.get('/users', requireAuth, adminOnly, (_req, res) => {
    res.json({ users: auth.listUsers() });
  });

  // Create a staff account (role defaults to technician).
  r.post('/users', requireAuth, adminOnly, (req: AuthedRequest, res) => {
    const { email, password, displayName, role } = req.body || {};
    const wantRole = role === 'admin' ? 'admin' : 'technician';
    try {
      const user = auth.createUser(email, password, displayName ?? null, now(), { role: wantRole });
      res.json({ user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'could not create user' });
    }
  });

  // Change a user's role. Guards: can't change your own role, can't remove the last admin.
  r.post('/users/:uid/role', requireAuth, adminOnly, (req: AuthedRequest, res) => {
    const role = req.body?.role === 'admin' ? 'admin' : 'technician';
    const target = auth.findByUid(req.params.uid);
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (req.auth!.uid === target.uid) return res.status(400).json({ error: 'you cannot change your own role' });
    if (target.role === 'admin' && role !== 'admin' && auth.adminCount() <= 1) {
      return res.status(400).json({ error: 'cannot demote the last admin' });
    }
    res.json({ user: auth.setRole(target.uid, role) });
  });

  // Reset a user's password.
  r.post('/users/:uid/password', requireAuth, adminOnly, (req: AuthedRequest, res) => {
    try {
      auth.resetPassword(req.params.uid, String(req.body?.password ?? ''));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'could not reset password' });
    }
  });

  // Delete a staff account. Guards: can't delete yourself or the last admin.
  r.delete('/users/:uid', requireAuth, adminOnly, (req: AuthedRequest, res) => {
    const target = auth.findByUid(req.params.uid);
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (req.auth!.uid === target.uid) return res.status(400).json({ error: 'you cannot delete your own account' });
    if (target.role === 'admin' && auth.adminCount() <= 1) {
      return res.status(400).json({ error: 'cannot delete the last admin' });
    }
    try {
      auth.deleteUser(target.uid);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'could not delete user' });
    }
  });

  r.post('/login', credentialLimiter, (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    const rec = auth.verify(String(email), String(password));
    if (!rec) {
      // Single generic message — do not reveal whether the email exists.
      return res.status(401).json({ error: 'invalid email or password' });
    }
    const user = toPublicUser(rec);
    const token = issueToken(user, now());
    res.json({ token, user });
  });

  // Whoami — validates the caller's token and echoes their identity.
  r.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const rec = req.auth && auth.findByUid(req.auth.uid);
    if (!rec) return res.status(401).json({ error: 'invalid or expired session' });
    res.json({ user: toPublicUser(rec) });
  });

  // Stateless tokens: logout is client-side (drop the token). Provided for symmetry.
  r.post('/logout', (_req, res) => res.json({ ok: true }));

  return r;
}
