/**
 * Stateful MikroTik RouterOS simulator.
 *
 * Each router gets a RouterSimState that behaves like a small RouterOS box:
 *  - /ppp/secret        → pppSecrets      (PPPoE credentials)
 *  - /ip/hotspot/user   → hotspotUsers    (hotspot logins with data caps)
 *  - /ppp/active + /ip/hotspot/active → activeSessions (live connections)
 *  - /queue/simple      → queues          (per-user rate shaping)
 *  - /system/resource   → resource        (cpu, memory, uptime, temp…)
 *
 * The billing engine provisions users here (add/enable/disable/remove), and
 * `tick()` — driven by the scheduler — evolves the world: enabled users come
 * online, sessions accrue traffic against their rate limit, hotspot data caps
 * count down, and the system resource fluctuates with load. This is what makes
 * the telemetry *coherent* instead of random.
 *
 * Determinism note: the scheduler passes `nowMs` into every call so the module
 * never touches Date.now()/Math.random() at import time. Randomness uses a small
 * seeded PRNG per router so a restart resumes believably.
 */

import type {
  ActiveSession,
  HotspotUser,
  PppSecret,
  ProvisionSpec,
  RouterSimState,
  ServiceType,
  SimpleQueue,
  StoreData,
} from '../types';
import { makeId } from '../store';
import type { CappedUser, MikrotikDriver } from './driver';

// Deterministic-ish PRNG (mulberry32) seeded per router so we avoid Math.random.
function makePrng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function kbpsToRateLimit(rx: number, tx: number): string {
  const fmt = (kbps: number) =>
    kbps >= 1000 ? `${Math.round(kbps / 1000)}M` : `${kbps}k`;
  return `${fmt(rx)}/${fmt(tx)}`;
}

// A believable pool of assigned client IPs.
function assignIp(prng: () => number, service: ServiceType): string {
  const base = service === 'pppoe' ? '10.10' : '192.168.88';
  const third = service === 'pppoe' ? Math.floor(prng() * 4) : 0;
  const host = 2 + Math.floor(prng() * 250);
  return service === 'pppoe' ? `${base}.${third}.${host}` : `${base}.${host}`;
}

function randomMac(prng: () => number): string {
  const oct = () =>
    Math.floor(prng() * 256)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `${oct()}:${oct()}:${oct()}:${oct()}:${oct()}:${oct()}`;
}

export class MikrotikSimulator implements MikrotikDriver {
  constructor(private store: { data: StoreData; save: () => void }) {}

  private prngFor(routerId: string, salt: number): () => number {
    return makePrng((hashSeed(routerId) ^ salt) >>> 0);
  }

  /** Create the sim state for a router if it doesn't exist yet. */
  ensureRouter(
    routerId: string,
    identity: string,
    model: string,
    nowMs: number,
  ): RouterSimState {
    const existing = this.store.data.simState[routerId];
    if (existing) return existing;
    const prng = this.prngFor(routerId, 7);
    const totalMemoryMb = 512;
    const state: RouterSimState = {
      routerId,
      identity,
      model,
      online: true,
      resource: {
        cpuLoad: 6 + Math.floor(prng() * 6),
        totalMemoryMb,
        freeMemoryMb: Math.round(totalMemoryMb * 0.55),
        memoryUsedPct: 45,
        temperature: 40 + Math.floor(prng() * 4),
        voltage: 24,
        uptimeSec: 3600 * (2 + Math.floor(prng() * 40)),
        version: '7.15.3 (stable)',
        boardName: model,
        cpuFrequencyMhz: 800,
      },
      pppSecrets: [],
      hotspotUsers: [],
      activeSessions: [],
      queues: [],
      uplinkBytesIn: 0,
      uplinkBytesOut: 0,
      lastTick: new Date(nowMs).toISOString(),
    };
    this.store.data.simState[routerId] = state;
    this.store.save();
    return state;
  }

  get(routerId: string): RouterSimState | undefined {
    return this.store.data.simState[routerId];
  }

  setOnline(routerId: string, online: boolean): void {
    const s = this.store.data.simState[routerId];
    if (!s) return;
    s.online = online;
    if (!online) s.activeSessions = [];
    this.store.save();
  }

  /**
   * Add or update a user (PPPoE secret or hotspot user) + its simple queue.
   * Mirrors RouterOS `/ppp/secret add` / `/ip/hotspot/user add` with an
   * accompanying `/queue/simple` for rate shaping.
   */
  async upsertUser(routerId: string, spec: ProvisionSpec, nowMs: number): Promise<void> {
    const s = this.ensureRouter(routerId, 'router', 'MikroTik', nowMs);
    const rateLimit = kbpsToRateLimit(spec.downloadKbps, spec.uploadKbps);

    if (spec.service === 'pppoe') {
      const idx = s.pppSecrets.findIndex((x) => x.name === spec.username);
      const secret: PppSecret = {
        name: spec.username,
        password: spec.password,
        profile: spec.profile,
        service: 'pppoe',
        rateLimit,
        disabled: false,
        comment: spec.comment,
      };
      if (idx >= 0) s.pppSecrets[idx] = { ...s.pppSecrets[idx], ...secret };
      else s.pppSecrets.push(secret);
    } else {
      const idx = s.hotspotUsers.findIndex((x) => x.name === spec.username);
      const prev = idx >= 0 ? s.hotspotUsers[idx] : undefined;
      const user: HotspotUser = {
        name: spec.username,
        password: spec.password,
        profile: spec.profile,
        macAddress: spec.macAddress,
        rateLimit,
        limitBytesTotal: spec.dataCapMb * 1024 * 1024,
        bytesIn: prev?.bytesIn ?? 0,
        bytesOut: prev?.bytesOut ?? 0,
        disabled: false,
        comment: spec.comment,
      };
      if (idx >= 0) s.hotspotUsers[idx] = user;
      else s.hotspotUsers.push(user);
    }

    // Upsert the simple queue.
    const qName = `q-${spec.username}`;
    const qIdx = s.queues.findIndex((q) => q.name === qName);
    const queue: SimpleQueue = {
      id: qIdx >= 0 ? s.queues[qIdx].id : makeId('queue', nowMs),
      name: qName,
      target: qIdx >= 0 ? s.queues[qIdx].target : assignIp(this.prngFor(routerId, hashSeed(spec.username)), spec.service),
      maxLimit: rateLimit,
      bytesIn: qIdx >= 0 ? s.queues[qIdx].bytesIn : 0,
      bytesOut: qIdx >= 0 ? s.queues[qIdx].bytesOut : 0,
      disabled: false,
    };
    if (qIdx >= 0) s.queues[qIdx] = queue;
    else s.queues.push(queue);

    this.store.save();
  }

  async setUserEnabled(routerId: string, username: string, enabled: boolean, nowMs: number): Promise<void> {
    const s = this.store.data.simState[routerId];
    if (!s) return;
    const disabled = !enabled;
    s.pppSecrets.forEach((x) => {
      if (x.name === username) x.disabled = disabled;
    });
    s.hotspotUsers.forEach((x) => {
      if (x.name === username) x.disabled = disabled;
    });
    s.queues.forEach((q) => {
      if (q.name === `q-${username}`) q.disabled = disabled;
    });
    if (disabled) {
      // Kick any live session immediately (like removing a PPPoE active).
      s.activeSessions = s.activeSessions.filter((sess) => {
        if (sess.name === username) {
          const secret = s.pppSecrets.find((p) => p.name === username);
          if (secret) secret.lastLoggedOut = new Date(nowMs).toISOString();
          return false;
        }
        return true;
      });
    }
    this.store.save();
  }

  async removeUser(routerId: string, username: string): Promise<void> {
    const s = this.store.data.simState[routerId];
    if (!s) return;
    s.pppSecrets = s.pppSecrets.filter((x) => x.name !== username);
    s.hotspotUsers = s.hotspotUsers.filter((x) => x.name !== username);
    s.queues = s.queues.filter((q) => q.name !== `q-${username}`);
    s.activeSessions = s.activeSessions.filter((sess) => sess.name !== username);
    this.store.save();
  }

  /** Force-disconnect a live session (RouterOS `/ppp/active remove`). */
  async disconnectSession(routerId: string, sessionId: string): Promise<void> {
    const s = this.store.data.simState[routerId];
    if (!s) return;
    s.activeSessions = s.activeSessions.filter((x) => x.id !== sessionId);
    this.store.save();
  }

  /** List enabled, non-suspended users eligible to be online. */
  private eligibleUsers(s: RouterSimState): Array<{ name: string; service: ServiceType; rateLimit: string }> {
    const ppp = s.pppSecrets
      .filter((x) => !x.disabled)
      .map((x) => ({ name: x.name, service: 'pppoe' as ServiceType, rateLimit: x.rateLimit }));
    const hs = s.hotspotUsers
      .filter((x) => !x.disabled)
      .map((x) => ({ name: x.name, service: 'hotspot' as ServiceType, rateLimit: x.rateLimit }));
    return [...ppp, ...hs];
  }

  private parseRx(rateLimit: string): number {
    // "10M/10M" → 10000 kbps
    const rx = rateLimit.split('/')[0] || '1M';
    if (rx.endsWith('M')) return parseInt(rx) * 1000;
    if (rx.endsWith('k')) return parseInt(rx);
    return parseInt(rx) || 1000;
  }

  /**
   * Advance ONE simulated router by `dtSec` seconds (the driver `refresh` for the
   * simulator). Invents session churn, throughput, and telemetry. Returns any
   * users that hit their data cap so billing can expire them.
   */
  async refresh(routerId: string, nowMs: number, dtSec: number): Promise<CappedUser[]> {
    const capped: CappedUser[] = [];
    const iso = new Date(nowMs).toISOString();

    const s = this.store.data.simState[routerId];
    if (!s) return capped;
    if (!s.online) {
      s.activeSessions = [];
      this.store.save();
      return capped;
    }
    const prng = this.prngFor(routerId, (nowMs / 1000) | 0);
    s.resource.uptimeSec += dtSec;

    const eligible = this.eligibleUsers(s);
    const onlineNames = new Set(s.activeSessions.map((x) => x.name));

    // Connect a fraction of offline-but-eligible users.
    for (const u of eligible) {
      if (onlineNames.has(u.name)) continue;
      // ~35% chance per tick to come online (hotspot flappier than pppoe).
      const p = u.service === 'pppoe' ? 0.45 : 0.3;
      if (prng() < p) {
        s.activeSessions.push({
          id: makeId('sess', nowMs),
          name: u.name,
          service: u.service,
          address: assignIp(this.prngFor(routerId, hashSeed(u.name)), u.service),
          macAddress: randomMac(this.prngFor(routerId, hashSeed(u.name) ^ 0x55)),
          uptimeSec: 0,
          bytesIn: 0,
          bytesOut: 0,
          rateRxKbps: 0,
          rateTxKbps: 0,
          since: iso,
        });
      }
    }

    // Evolve each active session.
    let tickUplinkIn = 0;
    let tickUplinkOut = 0;
    const survivors: ActiveSession[] = [];
    for (const sess of s.activeSessions) {
      // Occasionally disconnect (session churn).
      if (prng() < 0.06) continue;
      sess.uptimeSec += dtSec;
      const cap = this.parseRx(this.rateFor(s, sess.name));
      // Instantaneous utilisation 5%–95% of the cap.
      const util = 0.05 + prng() * 0.9;
      sess.rateRxKbps = Math.round(cap * util);
      sess.rateTxKbps = Math.round(cap * util * (0.1 + prng() * 0.3));
      const inBytes = Math.round((sess.rateRxKbps * 1000 * dtSec) / 8);
      const outBytes = Math.round((sess.rateTxKbps * 1000 * dtSec) / 8);
      sess.bytesIn += inBytes;
      sess.bytesOut += outBytes;
      tickUplinkIn += inBytes;
      tickUplinkOut += outBytes;

      // Mirror into the queue counters.
      const q = s.queues.find((x) => x.name === `q-${sess.name}`);
      if (q) {
        q.bytesIn += inBytes;
        q.bytesOut += outBytes;
      }

      // Accrue hotspot data usage toward the cap.
      const hs = s.hotspotUsers.find((x) => x.name === sess.name);
      if (hs) {
        hs.bytesIn += inBytes;
        hs.bytesOut += outBytes;
        if (hs.limitBytesTotal > 0 && hs.bytesIn + hs.bytesOut >= hs.limitBytesTotal) {
          hs.disabled = true;
          capped.push({ routerId, username: hs.name });
          continue; // drop the session — cap reached
        }
      }
      survivors.push(sess);
    }
    s.activeSessions = survivors;
    s.uplinkBytesIn += tickUplinkIn;
    s.uplinkBytesOut += tickUplinkOut;

    // System resource reacts to session count.
    const load = s.activeSessions.length;
    const targetCpu = Math.min(95, 5 + load * 1.6 + prng() * 8);
    s.resource.cpuLoad = Math.round(s.resource.cpuLoad * 0.6 + targetCpu * 0.4);
    const usedPct = Math.min(92, 42 + load * 0.8 + prng() * 5);
    s.resource.memoryUsedPct = Math.round(usedPct);
    s.resource.freeMemoryMb = Math.round(s.resource.totalMemoryMb * (1 - usedPct / 100));
    s.resource.temperature = Math.round(38 + s.resource.cpuLoad * 0.12 + prng() * 2);
    s.resource.voltage = Math.round((23.8 + prng() * 0.6) * 10) / 10;
    s.lastTick = iso;

    this.store.save();
    return capped;
  }

  private rateFor(s: RouterSimState, username: string): string {
    const ppp = s.pppSecrets.find((x) => x.name === username);
    if (ppp) return ppp.rateLimit;
    const hs = s.hotspotUsers.find((x) => x.name === username);
    if (hs) return hs.rateLimit;
    return '1M/1M';
  }
}
