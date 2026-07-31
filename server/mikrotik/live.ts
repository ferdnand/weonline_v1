/**
 * Live RouterOS driver — talks to a real MikroTik (e.g. an L009 on RouterOS 7)
 * over the REST API (`/rest/...`).
 *
 * Transport is Node's built-in http/https (no dependency); https can accept the
 * router's self-signed certificate when `insecureTls` is set (LAN only). The
 * driver fills the same `store.simState[routerId]` cache the simulator uses — so
 * routes/UI/billing are identical — by polling on `refresh()`, and it mirrors
 * successful writes into that cache immediately so `get()` is consistent before
 * the next poll.
 *
 * RouterOS REST verb mapping: GET=print, PUT=add, PATCH /{.id}=set, DELETE /{.id}=remove.
 */

import http from 'node:http';
import https from 'node:https';
import type {
  ActiveSession,
  HotspotUser,
  PppSecret,
  ProvisionSpec,
  RouterRecord,
  RouterSimState,
  SimpleQueue,
  StoreData,
} from '../types';
import type { CappedUser, MikrotikDriver } from './driver';

interface RestResult {
  status: number;
  data: any;
}

export class LiveRouterOsDriver implements MikrotikDriver {
  constructor(private store: { data: StoreData; save: () => void }) {}

  private record(routerId: string): RouterRecord | undefined {
    return this.store.data.routers.find((r) => r.id === routerId);
  }

  private password(rec: RouterRecord): string {
    // Optional env override so the admin password need not live in the JSON store.
    const key = `ROUTER_${rec.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`;
    return process.env[key] || rec.password;
  }

  /** Low-level REST call. Rejects on network error / timeout / non-2xx. */
  private rest(rec: RouterRecord, method: string, path: string, body?: unknown): Promise<RestResult> {
    const scheme = rec.tls ? 'https' : 'http';
    const port = rec.apiPort || (rec.tls ? 443 : 80);
    const url = new URL(`${scheme}://${rec.ipAddress}:${port}/rest${path}`);
    const auth = Buffer.from(`${rec.username}:${this.password(rec)}`).toString('base64');
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return new Promise<RestResult>((resolve, reject) => {
      const mod = scheme === 'https' ? https : http;
      const req = mod.request(
        url,
        {
          method,
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          // Only meaningful for https; ignored for http.
          rejectUnauthorized: rec.insecureTls ? false : true,
          timeout: 8000,
        } as https.RequestOptions,
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            const status = res.statusCode || 0;
            let data: any = null;
            if (raw) {
              try { data = JSON.parse(raw); } catch { data = raw; }
            }
            if (status >= 200 && status < 300) resolve({ status, data });
            else reject(new Error(`RouterOS ${method} ${path} → ${status} ${typeof data === 'object' && data?.message ? data.message : raw.slice(0, 200)}`));
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(`RouterOS ${method} ${path} → timeout`)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  private mark(rec: RouterRecord, err?: unknown): void {
    if (err) {
      rec.lastError = err instanceof Error ? err.message : String(err);
    } else {
      rec.lastError = undefined;
      rec.lastPolledAt = new Date().toISOString();
    }
    this.store.save();
  }

  // ── Cache lifecycle ──────────────────────────────────────────────────────────

  ensureRouter(routerId: string, identity: string, model: string, nowMs: number): void {
    if (this.store.data.simState[routerId]) return;
    this.store.data.simState[routerId] = emptyState(routerId, identity, model, nowMs);
    this.store.save();
  }

  get(routerId: string): RouterSimState | undefined {
    return this.store.data.simState[routerId];
  }

  setOnline(routerId: string, online: boolean): void {
    const rec = this.record(routerId);
    if (rec) rec.status = online ? 'online' : 'offline';
    const s = this.store.data.simState[routerId];
    if (s) {
      s.online = online;
      if (!online) s.activeSessions = [];
    }
    this.store.save();
  }

  // ── Read-only probe (used by POST /routers/:id/test) ─────────────────────────

  async probe(routerId: string): Promise<{ ok: boolean; resource?: any; error?: string }> {
    const rec = this.record(routerId);
    if (!rec) return { ok: false, error: 'router not found' };
    try {
      const { data } = await this.rest(rec, 'GET', '/system/resource');
      this.mark(rec);
      return { ok: true, resource: data };
    } catch (err) {
      this.mark(rec, err);
      return { ok: false, error: rec.lastError };
    }
  }

  // ── Writes (provisioning) ────────────────────────────────────────────────────

  async upsertUser(routerId: string, spec: ProvisionSpec, nowMs: number): Promise<void> {
    const rec = this.record(routerId);
    if (!rec) throw new Error('router not found');
    const rateLimit = rateLimitStr(spec.downloadKbps, spec.uploadKbps);
    try {
      if (spec.service === 'pppoe') {
        await this.ensurePppProfile(rec, spec.profile, rateLimit);
        const existing = await this.findByName(rec, '/ppp/secret', spec.username);
        const attrs: Record<string, string> = {
          name: spec.username,
          password: spec.password,
          service: 'pppoe',
          profile: spec.profile,
          comment: spec.comment || '',
          // NOTE: /ppp/secret has NO `limit-bytes-total` (that's a hotspot-user field).
          // A PPPoE data cap is an egress byte limit; only send it when a cap is set.
          ...(spec.dataCapMb > 0 ? { 'limit-bytes-out': String(spec.dataCapMb * 1024 * 1024) } : {}),
        };
        if (existing) await this.rest(rec, 'PATCH', `/ppp/secret/${enc(existing['.id'])}`, attrs);
        else await this.rest(rec, 'PUT', '/ppp/secret', attrs);
      } else {
        await this.ensureHotspotProfile(rec, spec.profile, rateLimit);
        const existing = await this.findByName(rec, '/ip/hotspot/user', spec.username);
        const attrs: Record<string, string> = {
          name: spec.username,
          password: spec.password,
          profile: spec.profile,
          comment: spec.comment || '',
          'limit-bytes-total': String(spec.dataCapMb * 1024 * 1024),
          ...(spec.macAddress ? { 'mac-address': spec.macAddress } : {}),
        };
        if (existing) await this.rest(rec, 'PATCH', `/ip/hotspot/user/${enc(existing['.id'])}`, attrs);
        else await this.rest(rec, 'PUT', '/ip/hotspot/user', attrs);
      }
      this.mirrorUpsert(routerId, spec, rateLimit, nowMs);
      this.mark(rec);
    } catch (err) {
      this.mark(rec, err);
      throw err;
    }
  }

  async setUserEnabled(routerId: string, username: string, enabled: boolean, nowMs: number): Promise<void> {
    const rec = this.record(routerId);
    if (!rec) throw new Error('router not found');
    try {
      const disabled = enabled ? 'false' : 'true';
      const secret = await this.findByName(rec, '/ppp/secret', username);
      if (secret) await this.rest(rec, 'PATCH', `/ppp/secret/${enc(secret['.id'])}`, { disabled });
      const hs = await this.findByName(rec, '/ip/hotspot/user', username);
      if (hs) await this.rest(rec, 'PATCH', `/ip/hotspot/user/${enc(hs['.id'])}`, { disabled });
      // Kick any live session when disabling.
      if (!enabled) await this.kickUser(rec, username);
      this.mirrorEnabled(routerId, username, enabled, nowMs);
      this.mark(rec);
    } catch (err) {
      this.mark(rec, err);
      throw err;
    }
  }

  async removeUser(routerId: string, username: string): Promise<void> {
    const rec = this.record(routerId);
    if (!rec) throw new Error('router not found');
    try {
      await this.kickUser(rec, username);
      const secret = await this.findByName(rec, '/ppp/secret', username);
      if (secret) await this.rest(rec, 'DELETE', `/ppp/secret/${enc(secret['.id'])}`);
      const hs = await this.findByName(rec, '/ip/hotspot/user', username);
      if (hs) await this.rest(rec, 'DELETE', `/ip/hotspot/user/${enc(hs['.id'])}`);
      this.mirrorRemove(routerId, username);
      this.mark(rec);
    } catch (err) {
      this.mark(rec, err);
      throw err;
    }
  }

  async disconnectSession(routerId: string, sessionId: string): Promise<void> {
    const rec = this.record(routerId);
    if (!rec) throw new Error('router not found');
    try {
      // sessionId is the RouterOS .id we cached at poll time; try both actives.
      await this.rest(rec, 'DELETE', `/ppp/active/${enc(sessionId)}`).catch(() => undefined);
      await this.rest(rec, 'DELETE', `/ip/hotspot/active/${enc(sessionId)}`).catch(() => undefined);
      const s = this.store.data.simState[routerId];
      if (s) s.activeSessions = s.activeSessions.filter((x) => x.id !== sessionId);
      this.mark(rec);
    } catch (err) {
      this.mark(rec, err);
      throw err;
    }
  }

  // ── Poll (refresh the cache from the real device) ────────────────────────────

  async refresh(routerId: string, nowMs: number, _dtSec: number): Promise<CappedUser[]> {
    const rec = this.record(routerId);
    if (!rec) return [];
    const s = this.store.data.simState[routerId] || emptyState(routerId, rec.identity, rec.model, nowMs);
    this.store.data.simState[routerId] = s;
    try {
      // The resource fetch determines REACHABILITY — it is NOT caught, so an
      // unreachable device / bad creds throws and drops us into the catch below
      // (marking offline + lastError). The rest are best-effort (a menu like
      // hotspot may be empty on a given box) and default to [] on error.
      const resource = await this.rest(rec, 'GET', '/system/resource').then((r) => r.data);
      const [health, secrets, hsUsers, pppActive, hsActive, queues] = await Promise.all([
        this.rest(rec, 'GET', '/system/health').then((r) => r.data).catch(() => null),
        this.rest(rec, 'GET', '/ppp/secret').then((r) => arr(r.data)).catch(() => []),
        this.rest(rec, 'GET', '/ip/hotspot/user').then((r) => arr(r.data)).catch(() => []),
        this.rest(rec, 'GET', '/ppp/active').then((r) => arr(r.data)).catch(() => []),
        this.rest(rec, 'GET', '/ip/hotspot/active').then((r) => arr(r.data)).catch(() => []),
        this.rest(rec, 'GET', '/queue/simple').then((r) => arr(r.data)).catch(() => []),
      ]);

      s.online = true;
      s.model = rec.model;
      s.identity = str(resource?.['board-name']) || rec.identity;
      s.resource = mapResource(resource, health, s.resource);
      s.queues = queues.map(mapQueue);
      s.pppSecrets = secrets.map(mapSecret);
      s.hotspotUsers = hsUsers.map(mapHotspotUser);
      s.activeSessions = [
        ...pppActive.map((a: any) => mapActive(a, 'pppoe', s.queues)),
        ...hsActive.map((a: any) => mapActive(a, 'hotspot', s.queues)),
      ];
      s.uplinkBytesIn = s.queues.reduce((n, q) => n + q.bytesIn, 0);
      s.uplinkBytesOut = s.queues.reduce((n, q) => n + q.bytesOut, 0);
      s.lastTick = new Date(nowMs).toISOString();
      rec.status = 'online';

      // Data-cap detection: hotspot users over their limit (router disables them).
      const capped: CappedUser[] = s.hotspotUsers
        .filter((u) => u.limitBytesTotal > 0 && u.bytesIn + u.bytesOut >= u.limitBytesTotal)
        .map((u) => ({ routerId, username: u.name }));

      this.mark(rec);
      return capped;
    } catch (err) {
      s.online = false;
      s.activeSessions = [];
      rec.status = 'offline';
      this.mark(rec, err);
      return [];
    }
  }

  // ── RouterOS helpers ─────────────────────────────────────────────────────────

  private async findByName(rec: RouterRecord, path: string, name: string): Promise<any | undefined> {
    const { data } = await this.rest(rec, 'GET', `${path}?name=${encodeURIComponent(name)}`);
    const rows = arr(data);
    return rows.find((r) => r.name === name) || rows[0];
  }

  private async ensurePppProfile(rec: RouterRecord, name: string, rateLimit: string): Promise<void> {
    const existing = await this.findByName(rec, '/ppp/profile', name);
    const attrs = { name, 'rate-limit': rateLimit };
    if (existing) await this.rest(rec, 'PATCH', `/ppp/profile/${enc(existing['.id'])}`, attrs);
    else await this.rest(rec, 'PUT', '/ppp/profile', attrs);
  }

  private async ensureHotspotProfile(rec: RouterRecord, name: string, rateLimit: string): Promise<void> {
    const existing = await this.findByName(rec, '/ip/hotspot/user/profile', name);
    const attrs = { name, 'rate-limit': rateLimit };
    if (existing) await this.rest(rec, 'PATCH', `/ip/hotspot/user/profile/${enc(existing['.id'])}`, attrs);
    else await this.rest(rec, 'PUT', '/ip/hotspot/user/profile', attrs);
  }

  private async kickUser(rec: RouterRecord, username: string): Promise<void> {
    const ppp = await this.rest(rec, 'GET', `/ppp/active?name=${encodeURIComponent(username)}`).then((r) => arr(r.data)).catch(() => []);
    for (const a of ppp.filter((x) => x.name === username)) {
      await this.rest(rec, 'DELETE', `/ppp/active/${enc(a['.id'])}`).catch(() => undefined);
    }
    const hs = await this.rest(rec, 'GET', `/ip/hotspot/active?user=${encodeURIComponent(username)}`).then((r) => arr(r.data)).catch(() => []);
    for (const a of hs.filter((x) => x.user === username)) {
      await this.rest(rec, 'DELETE', `/ip/hotspot/active/${enc(a['.id'])}`).catch(() => undefined);
    }
  }

  // ── Optimistic cache mirroring (so get() is correct before the next poll) ─────

  private mirrorUpsert(routerId: string, spec: ProvisionSpec, rateLimit: string, nowMs: number): void {
    const s = this.store.data.simState[routerId];
    if (!s) return;
    if (spec.service === 'pppoe') {
      const idx = s.pppSecrets.findIndex((x) => x.name === spec.username);
      const secret: PppSecret = {
        name: spec.username, password: spec.password, profile: spec.profile, service: 'pppoe',
        rateLimit, disabled: idx >= 0 ? s.pppSecrets[idx].disabled : false, comment: spec.comment,
      };
      if (idx >= 0) s.pppSecrets[idx] = { ...s.pppSecrets[idx], ...secret };
      else s.pppSecrets.push(secret);
    } else {
      const idx = s.hotspotUsers.findIndex((x) => x.name === spec.username);
      const prev = idx >= 0 ? s.hotspotUsers[idx] : undefined;
      const user: HotspotUser = {
        name: spec.username, password: spec.password, profile: spec.profile, macAddress: spec.macAddress,
        rateLimit, limitBytesTotal: spec.dataCapMb * 1024 * 1024,
        bytesIn: prev?.bytesIn ?? 0, bytesOut: prev?.bytesOut ?? 0,
        disabled: prev?.disabled ?? false, comment: spec.comment,
      };
      if (idx >= 0) s.hotspotUsers[idx] = user; else s.hotspotUsers.push(user);
    }
    this.store.save();
  }

  private mirrorEnabled(routerId: string, username: string, enabled: boolean, nowMs: number): void {
    const s = this.store.data.simState[routerId];
    if (!s) return;
    const disabled = !enabled;
    s.pppSecrets.forEach((x) => { if (x.name === username) x.disabled = disabled; });
    s.hotspotUsers.forEach((x) => { if (x.name === username) x.disabled = disabled; });
    if (disabled) s.activeSessions = s.activeSessions.filter((x) => x.name !== username);
    this.store.save();
  }

  private mirrorRemove(routerId: string, username: string): void {
    const s = this.store.data.simState[routerId];
    if (!s) return;
    s.pppSecrets = s.pppSecrets.filter((x) => x.name !== username);
    s.hotspotUsers = s.hotspotUsers.filter((x) => x.name !== username);
    s.activeSessions = s.activeSessions.filter((x) => x.name !== username);
    this.store.save();
  }
}

// ── Pure mappers / parsers (RouterOS REST rows → our shapes) ───────────────────

function emptyState(routerId: string, identity: string, model: string, nowMs: number): RouterSimState {
  return {
    routerId, identity, model, online: false,
    resource: { cpuLoad: 0, freeMemoryMb: 0, totalMemoryMb: 0, memoryUsedPct: 0, temperature: 0, voltage: 0, uptimeSec: 0, version: '', boardName: model, cpuFrequencyMhz: 0 },
    pppSecrets: [], hotspotUsers: [], activeSessions: [], queues: [], uplinkBytesIn: 0, uplinkBytesOut: 0,
    lastTick: new Date(nowMs).toISOString(),
  };
}

function arr(x: any): any[] { return Array.isArray(x) ? x : x ? [x] : []; }
function str(x: any): string { return x == null ? '' : String(x); }
function num(x: any): number { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function bool(x: any): boolean { return x === true || x === 'true' || x === 'yes'; }
function enc(id: any): string { return encodeURIComponent(String(id)); }

function rateLimitStr(rxKbps: number, txKbps: number): string {
  const fmt = (k: number) => (k >= 1000 ? `${Math.round(k / 1000)}M` : `${k}k`);
  return `${fmt(rxKbps)}/${fmt(txKbps)}`;
}

/** Parse RouterOS duration like "1w2d3h4m5s" → seconds. */
function parseUptime(s: string): number {
  if (!s) return 0;
  const re = /(\d+)([wdhms])/g;
  const mult: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) total += Number(m[1]) * (mult[m[2]] || 0);
  return total;
}

/** "12345/67890" → [in, out] bytes. */
function splitPair(s: string): [number, number] {
  const [a, b] = str(s).split('/');
  return [num(a), num(b)];
}

function mapResource(r: any, health: any, prev: RouterSimState['resource']): RouterSimState['resource'] {
  if (!r) return prev;
  const total = Math.round(num(r['total-memory']) / (1024 * 1024));
  const free = Math.round(num(r['free-memory']) / (1024 * 1024));
  const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  // /system/health in v7 is a list of {name,value}; pull temperature & voltage.
  const rows = arr(health);
  const healthVal = (name: string) => num(rows.find((h) => str(h.name).includes(name))?.value);
  return {
    cpuLoad: num(r['cpu-load']),
    freeMemoryMb: free,
    totalMemoryMb: total,
    memoryUsedPct: usedPct,
    temperature: healthVal('temperature'),
    voltage: healthVal('voltage'),
    uptimeSec: parseUptime(str(r.uptime)),
    version: str(r.version),
    boardName: str(r['board-name']) || prev.boardName,
    cpuFrequencyMhz: num(r['cpu-frequency']),
  };
}

function mapQueue(q: any): SimpleQueue {
  const [bin, bout] = splitPair(q.bytes);
  return {
    id: str(q['.id']), name: str(q.name), target: str(q.target),
    maxLimit: str(q['max-limit']), bytesIn: bin, bytesOut: bout, disabled: bool(q.disabled),
  };
}

function mapSecret(x: any): PppSecret {
  return {
    name: str(x.name), password: str(x.password), profile: str(x.profile), service: 'pppoe',
    rateLimit: str(x['rate-limit']), disabled: bool(x.disabled), comment: str(x.comment) || undefined,
    lastLoggedOut: str(x['last-logged-out']) || undefined,
  };
}

function mapHotspotUser(x: any): HotspotUser {
  return {
    name: str(x.name), password: str(x.password), profile: str(x.profile) || 'default',
    macAddress: str(x['mac-address']) || undefined, rateLimit: str(x['rate-limit']),
    limitBytesTotal: num(x['limit-bytes-total']), bytesIn: num(x['bytes-in']), bytesOut: num(x['bytes-out']),
    disabled: bool(x.disabled), comment: str(x.comment) || undefined,
  };
}

function mapActive(a: any, service: 'pppoe' | 'hotspot', queues: SimpleQueue[]): ActiveSession {
  const name = str(a.name || a.user);
  const address = str(a.address);
  // PPP active doesn't carry byte counters; borrow from the matching queue if present.
  const q = queues.find((x) => x.target.startsWith(address) || x.name.includes(name));
  return {
    id: str(a['.id']),
    name,
    service,
    address,
    macAddress: str(a['caller-id'] || a['mac-address']),
    uptimeSec: parseUptime(str(a.uptime)),
    bytesIn: service === 'hotspot' ? num(a['bytes-in']) : q?.bytesIn ?? 0,
    bytesOut: service === 'hotspot' ? num(a['bytes-out']) : q?.bytesOut ?? 0,
    rateRxKbps: 0,
    rateTxKbps: 0,
    since: '',
  };
}
