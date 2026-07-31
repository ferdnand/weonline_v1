/**
 * Driver abstraction shared by the in-memory simulator and the live RouterOS
 * device. Both back a router; the store's `simState[routerId]` is the common
 * READ cache (filled by `tick()` for a simulator, by polling for a live device),
 * so the REST routes, UI, and billing `report()` are identical for both kinds.
 *
 * Write methods return promises because a live device is reached over the network
 * and can fail. The simulator implements them synchronously (resolved promises).
 */

import type { ProvisionSpec, RouterSimState } from '../types';

export type { ProvisionSpec };

/** A user that reached its data cap this cycle → billing expires it. */
export interface CappedUser {
  routerId: string;
  username: string;
}

export interface MikrotikDriver {
  /** Ensure per-router read-cache state exists (idempotent). */
  ensureRouter(routerId: string, identity: string, model: string, nowMs: number): void;

  /** Synchronous read of the cached RouterSimState (the model behind all GET routes). */
  get(routerId: string): RouterSimState | undefined;

  /** Mark reachable/unreachable (simulator: power flag; live: probe result). */
  setOnline(routerId: string, online: boolean): void;

  /** Create/update a user + rate profile. */
  upsertUser(routerId: string, spec: ProvisionSpec, nowMs: number): Promise<void>;

  /** Enable/disable a user (and kick its live session when disabling). */
  setUserEnabled(routerId: string, username: string, enabled: boolean, nowMs: number): Promise<void>;

  /** Remove a user + its queue + any active session. */
  removeUser(routerId: string, username: string): Promise<void>;

  /** Force-disconnect one active session by id. */
  disconnectSession(routerId: string, sessionId: string): Promise<void>;

  /**
   * Advance the read model by `dtSec` seconds.
   *  - simulator: invents traffic/sessions/telemetry.
   *  - live: polls the device and writes real data into the cache.
   * Returns users that hit their data cap so billing can expire them.
   */
  refresh(routerId: string, nowMs: number, dtSec: number): Promise<CappedUser[]>;
}
