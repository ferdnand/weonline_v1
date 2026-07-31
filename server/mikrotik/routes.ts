/**
 * REST surface mirroring the MikroTik RouterOS API. Mounted at /api/mikrotik.
 *
 * Reads come from the shared cache (`manager.get`), which is filled by the
 * simulator (invented) or a live device (polled) — identical either way. Writes
 * go through the manager to the appropriate driver.
 *
 * The legacy `/api/mikrotik/status` endpoint is preserved (coherent, stateful
 * telemetry) so the existing App.tsx polling keeps working.
 */

import { Router as ExpressRouter } from 'express';
import type { RouterDriver, RouterRecord, StoreData } from '../types';
import { MikrotikManager } from './manager';
import { Store } from '../store';
import { isPrivateIpv4 } from '../net';

export function mikrotikRoutes(store: Store, mik: MikrotikManager): ExpressRouter {
  const r = ExpressRouter();
  const d = (): StoreData => store.data;
  const now = () => Date.now();

  const routerById = (id: string): RouterRecord | undefined =>
    d().routers.find((x) => x.id === id);
  const routerByIp = (ip: string): RouterRecord | undefined =>
    d().routers.find((x) => x.ipAddress === ip);

  // Never serialize the router's REST password to a client. The username is kept
  // (the UI needs it to show which account is configured); the secret is not.
  const publicRouter = (rec: RouterRecord): Omit<RouterRecord, 'password'> => {
    const { password: _password, ...safe } = rec;
    return safe;
  };

  // ── Legacy/compat telemetry endpoint (coherent, not random) ─────────────────
  r.get('/status', (req, res) => {
    const ip = (req.query.ip as string) || '';
    const rec = routerByIp(ip) || d().routers[0];
    if (!rec) {
      return res.json({ status: 'offline', cpu: 0, memory: 0, temperature: 0, uptime: '0d 0h 0m', clientsCount: 0 });
    }
    const s = mik.get(rec.id);
    if (!s || !s.online) {
      return res.json({ status: 'offline', cpu: 0, memory: 0, temperature: 0, uptime: '0d 0h 0m', clientsCount: 0, model: rec.model, ip: rec.ipAddress });
    }
    res.json({
      status: 'online',
      cpu: s.resource.cpuLoad,
      memory: s.resource.memoryUsedPct,
      temperature: s.resource.temperature,
      uptime: fmtUptime(s.resource.uptimeSec),
      clientsCount: s.activeSessions.length,
      model: s.model,
      ip: rec.ipAddress,
    });
  });

  // ── Router list + summary ───────────────────────────────────────────────────
  r.get('/routers', (_req, res) => {
    res.json(
      d().routers.map((rec) => {
        const s = mik.get(rec.id);
        return {
          ...publicRouter(rec),
          online: s?.online ?? false,
          resource: s?.resource,
          activeSessions: s?.activeSessions.length ?? 0,
          pppSecrets: s?.pppSecrets.length ?? 0,
          hotspotUsers: s?.hotspotUsers.length ?? 0,
          queues: s?.queues.length ?? 0,
        };
      }),
    );
  });

  r.get('/routers/:id', (req, res) => {
    const rec = routerById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'router not found' });
    const s = mik.get(rec.id);
    res.json({ router: publicRouter(rec), sim: s ?? null, uptime: s ? fmtUptime(s.resource.uptimeSec) : null });
  });

  // Create / update a router. Accepts the driver + live-connection fields.
  r.post('/routers', (req, res) => {
    const b = req.body || {};
    const driver: RouterDriver = b.driver === 'live' ? 'live' : 'simulator';
    const tls = driver === 'live' ? b.tls !== false : false; // live defaults to HTTPS

    // SSRF guard: a live router causes the server to make authenticated requests
    // to its address. Restrict that to private LAN ranges so the API can't be
    // abused to reach the internet, localhost, or cloud metadata (169.254.169.254).
    if (driver === 'live' && process.env.ROUTER_ALLOW_ANY_HOST !== '1') {
      const ip = String(b.ipAddress || '');
      if (!isPrivateIpv4(ip)) {
        return res.status(400).json({
          error:
            'Live routers must use a private LAN IPv4 (10.x, 172.16–31.x, or 192.168.x). ' +
            'Set ROUTER_ALLOW_ANY_HOST=1 to override (reduces SSRF protection).',
        });
      }
    }

    const id = b.id || `rtr_${Math.abs(hash(b.ipAddress || String(now())))}`;
    const existing = routerById(id);
    const rec: RouterRecord = {
      id,
      name: b.name || 'Router',
      location: b.location || '',
      ipAddress: b.ipAddress || '192.168.88.1',
      model: b.model || 'MikroTik L009UiGS-RM',
      identity: b.identity || b.name || 'MikroTik',
      // Live routers start 'offline' until the first successful poll proves reach.
      status: driver === 'live' ? existing?.status || 'offline' : 'online',
      // For live routers apiPort is the REST/www port (443 tls, 80 plain); sim keeps 8728.
      apiPort: b.apiPort || (driver === 'live' ? (tls ? 443 : 80) : 8728),
      username: b.username || 'admin',
      password: b.password ?? existing?.password ?? '',
      driver,
      tls,
      // Default to verifying TLS; accepting a self-signed cert is an explicit opt-in.
      insecureTls: driver === 'live' ? b.insecureTls === true : false,
      lastError: existing?.lastError,
      lastPolledAt: existing?.lastPolledAt,
    };
    if (existing) Object.assign(existing, rec);
    else d().routers.push(rec);
    mik.ensureRouter(rec.id, rec.identity, rec.model, now());
    store.save();
    res.json(publicRouter(rec));
  });

  r.delete('/routers/:id', (req, res) => {
    const rec = routerById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'router not found' });
    d().routers = d().routers.filter((x) => x.id !== req.params.id);
    delete d().simState[req.params.id];
    store.save();
    res.json({ ok: true });
  });

  // Read-only connectivity probe (safe to run before enabling billing writes).
  r.post('/routers/:id/test', async (req, res) => {
    const rec = routerById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'router not found' });
    const result = await mik.probe(rec.id);
    res.json({ ...result, driver: rec.driver });
  });

  r.post('/routers/:id/power', (req, res) => {
    const rec = routerById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'router not found' });
    const online = !!(req.body && req.body.online);
    rec.status = online ? 'online' : 'offline';
    mik.setOnline(rec.id, online);
    store.save();
    res.json({ id: rec.id, status: rec.status });
  });

  // ── RouterOS-style resource views (served from the cache) ───────────────────
  r.get('/routers/:id/resource', (req, res) => {
    const s = mik.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no router state' });
    res.json({ ...s.resource, uptime: fmtUptime(s.resource.uptimeSec) });
  });

  r.get('/routers/:id/active', (req, res) => {
    const s = mik.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no router state' });
    res.json(s.activeSessions);
  });

  r.get('/routers/:id/secrets', (req, res) => {
    const s = mik.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no router state' });
    res.json(s.pppSecrets);
  });

  r.get('/routers/:id/hotspot-users', (req, res) => {
    const s = mik.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no router state' });
    res.json(s.hotspotUsers);
  });

  r.get('/routers/:id/queues', (req, res) => {
    const s = mik.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no router state' });
    res.json(s.queues);
  });

  // Force-disconnect a live session (/ppp/active remove).
  r.post('/routers/:id/active/:sessionId/disconnect', async (req, res) => {
    try {
      await mik.disconnectSession(req.params.id, req.params.sessionId);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Enable/disable a user directly (staff override).
  r.post('/routers/:id/users/:username/enabled', async (req, res) => {
    const enabled = !!(req.body && req.body.enabled);
    try {
      await mik.setUserEnabled(req.params.id, req.params.username, enabled, now());
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return r;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
