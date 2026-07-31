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

  // Admin-only: create a staff account (role defaults to technician).
  r.post('/users', requireAuth, (req: AuthedRequest, res) => {
    if (req.auth?.role !== 'admin') {
      return res.status(403).json({ error: 'admin role required' });
    }
    const { email, password, displayName, role } = req.body || {};
    const wantRole = role === 'admin' ? 'admin' : 'technician';
    try {
      const user = auth.createUser(email, password, displayName ?? null, now(), { role: wantRole });
      res.json({ user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'could not create user' });
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
