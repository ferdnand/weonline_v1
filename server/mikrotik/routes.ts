/**
 * REST surface mirroring the MikroTik RouterOS API the sim implements.
 * Mounted at /api/mikrotik.
 *
 * The legacy `/api/mikrotik/status` endpoint is preserved (and now returns
 * COHERENT, stateful telemetry from the simulator instead of random numbers) so
 * the existing App.tsx polling keeps working.
 */

import { Router as ExpressRouter } from 'express';
import type { RouterRecord, StoreData } from '../types';
import { MikrotikSimulator } from './simulator';
import { Store } from '../store';

export function mikrotikRoutes(store: Store, sim: MikrotikSimulator): ExpressRouter {
  const r = ExpressRouter();
  const d = (): StoreData => store.data;
  const now = () => Date.now();

  const routerById = (id: string): RouterRecord | undefined =>
    d().routers.find((x) => x.id === id);
  const routerByIp = (ip: string): RouterRecord | undefined =>
    d().routers.find((x) => x.ipAddress === ip);

  // ── Legacy/compat telemetry endpoint (coherent, not random) ─────────────────
  r.get('/status', (req, res) => {
    const ip = (req.query.ip as string) || '';
    const rec = routerByIp(ip) || d().routers[0];
    if (!rec) {
      return res.json({ status: 'offline', cpu: 0, memory: 0, temperature: 0, uptime: '0d 0h 0m', clientsCount: 0 });
    }
    const s = sim.get(rec.id);
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

  // ── Router list + full sim snapshot ─────────────────────────────────────────
  r.get('/routers', (_req, res) => {
    res.json(
      d().routers.map((rec) => {
        const s = sim.get(rec.id);
        return {
          ...rec,
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
    const s = sim.get(rec.id);
    res.json({ router: rec, sim: s ?? null, uptime: s ? fmtUptime(s.resource.uptimeSec) : null });
  });

  r.post('/routers', (req, res) => {
    const b = req.body || {};
    const id = b.id || `rtr_${Math.abs(hash(b.ipAddress || String(now())))}`;
    const rec: RouterRecord = {
      id,
      name: b.name || 'Router',
      location: b.location || '',
      ipAddress: b.ipAddress || '192.168.88.1',
      model: b.model || 'MikroTik L009UiGS-RM',
      identity: b.identity || b.name || 'MikroTik',
      status: 'online',
      apiPort: b.apiPort || 8728,
      username: b.username || 'admin',
      password: b.password || '',
    };
    const existing = routerById(id);
    if (existing) Object.assign(existing, rec);
    else d().routers.push(rec);
    sim.ensureRouter(rec.id, rec.identity, rec.model, now());
    store.save();
    res.json(rec);
  });

  r.post('/routers/:id/power', (req, res) => {
    const rec = routerById(req.params.id);
    if (!rec) return res.status(404).json({ error: 'router not found' });
    const online = !!(req.body && req.body.online);
    rec.status = online ? 'online' : 'offline';
    sim.setOnline(rec.id, online);
    store.save();
    res.json({ id: rec.id, status: rec.status });
  });

  // ── RouterOS-style resource views ───────────────────────────────────────────
  r.get('/routers/:id/resource', (req, res) => {
    const s = sim.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no sim state' });
    res.json({ ...s.resource, uptime: fmtUptime(s.resource.uptimeSec) });
  });

  r.get('/routers/:id/active', (req, res) => {
    const s = sim.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no sim state' });
    res.json(s.activeSessions);
  });

  r.get('/routers/:id/secrets', (req, res) => {
    const s = sim.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no sim state' });
    res.json(s.pppSecrets);
  });

  r.get('/routers/:id/hotspot-users', (req, res) => {
    const s = sim.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no sim state' });
    res.json(s.hotspotUsers);
  });

  r.get('/routers/:id/queues', (req, res) => {
    const s = sim.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'no sim state' });
    res.json(s.queues);
  });

  // Force-disconnect a live session (/ppp/active remove).
  r.post('/routers/:id/active/:sessionId/disconnect', (req, res) => {
    sim.disconnectSession(req.params.id, req.params.sessionId);
    res.json({ ok: true });
  });

  // Enable/disable a user directly (staff override).
  r.post('/routers/:id/users/:username/enabled', (req, res) => {
    const enabled = !!(req.body && req.body.enabled);
    sim.setUserEnabled(req.params.id, req.params.username, enabled, now());
    res.json({ ok: true });
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
