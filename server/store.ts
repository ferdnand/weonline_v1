/**
 * Dependency-free JSON-file persistence.
 *
 * Keeps the whole billing + simulator state in memory and writes it through to
 * `data/weonline.json` on a short debounce. This preserves the app's "fully
 * standalone, no external service" ethos (no SQLite native module, no cloud) while
 * still surviving a server restart.
 *
 * The simulator ticks frequently, so we NEVER write on every mutation — callers
 * mutate the in-memory object and call `save()`, which is debounced.
 */

import fs from 'fs';
import path from 'path';
import type { StoreData } from './types';
import { decryptField, encryptField } from './crypto';
import { log } from './logger';

const slog = log('store');

// Where the JSON store lives. Overridable via DATA_DIR so a persistent-host
// volume (Railway/Render) can mount anywhere; defaults to ./data locally.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'weonline.json');

// Credential fields that must be encrypted on disk (they can't be one-way hashed
// because RouterOS needs the cleartext to provision users).
function decryptSecrets(data: StoreData): void {
  for (const r of data.routers) if (typeof r.password === 'string') r.password = decryptField(r.password);
  for (const s of data.subscribers) if (typeof s.password === 'string') s.password = decryptField(s.password);
}

/** Deep clone with credential fields encrypted — used only for the on-disk form. */
function toEncryptedDisk(data: StoreData): StoreData {
  const copy: StoreData = JSON.parse(JSON.stringify(data));
  for (const r of copy.routers) if (typeof r.password === 'string') r.password = encryptField(r.password);
  for (const s of copy.subscribers) if (typeof s.password === 'string') s.password = encryptField(s.password);
  return copy;
}

function emptyStore(): StoreData {
  return {
    meta: { seeded: false, invoiceSeq: 0, version: 1 },
    users: [],
    plans: [],
    subscribers: [],
    subscriptions: [],
    invoices: [],
    payments: [],
    routers: [],
    simState: {},
    auditLog: [],
  };
}

export class Store {
  data: StoreData;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor() {
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as StoreData;
        // Merge onto a fresh skeleton so new collections added later are present.
        const data = { ...emptyStore(), ...parsed, meta: { ...emptyStore().meta, ...parsed.meta } };
        // Bring encrypted credential fields back to cleartext in memory.
        decryptSecrets(data);
        return data;
      }
    } catch (err) {
      slog.error({ err }, 'failed to load store, starting fresh');
    }
    return emptyStore();
  }

  /** Mark the store dirty and schedule a debounced flush to disk. */
  save(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 1500);
  }

  /** Write immediately (used on shutdown). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(toEncryptedDisk(this.data), null, 2), 'utf-8');
      this.dirty = false;
    } catch (err) {
      slog.error({ err }, 'failed to flush store to disk');
    }
  }

  /** Monotonic invoice number generator, e.g. INV-000123. */
  nextInvoiceNumber(): string {
    this.data.meta.invoiceSeq += 1;
    return `INV-${String(this.data.meta.invoiceSeq).padStart(6, '0')}`;
  }
}

/**
 * A tiny, dependency-free unique id. Not cryptographically strong — fine for a
 * local simulation. Combines a caller-supplied timestamp with a counter so ids
 * are unique and roughly sortable without relying on Date.now() at import time.
 */
let idCounter = 0;
export function makeId(prefix: string, nowMs: number): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${nowMs.toString(36)}${idCounter.toString(36).padStart(4, '0')}`;
}
