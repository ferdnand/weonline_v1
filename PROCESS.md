# PROCESS.md — WeOnline Development Guide

WeOnline is a Wireless ISP (WISP) management app for a Kenyan internet provider. It
combines a public package storefront with an admin/technician portal. It is a
**fully standalone** app with **two backends**:

1. **Express server** (`server/`) — the authoritative backend: **server-side auth**
   (the real authorization boundary), a **stateful MikroTik RouterOS simulator**, and a
   **full-scale billing engine**, persisted to a plain JSON file (`data/weonline.json`).
   A ticking scheduler advances the sim and runs the billing cycle server-side.
2. **Browser IndexedDB** (via the `idb` package) — the legacy admin CRUD only
   (clients, routers, transactions). Auth is **no longer** browser-local.

**No Firebase, Google Cloud, database server, or any external service is used.**

---

## 1. Prerequisites

- **Node.js** 18+ (project uses ESM, `"type": "module"`)
- **npm** is the package manager (`package-lock.json` is the single source of truth):
  - `npm install`

No cloud accounts or API keys are required. A few **environment variables** are read
(see below) — all optional for local dev, but some are required for production.

---

## 2. Environment setup

Copy [`.env.example`](.env.example) to `.env.local` (gitignored). Variables are loaded
by [`server/loadenv.ts`](server/loadenv.ts) (imported first in `server.ts`) from
`.env.local` then `.env`; OS-level vars win.

| Variable | Purpose | Dev | Production |
|----------|---------|-----|------------|
| `AUTH_SECRET` | HMAC key that signs API session tokens. | Optional (an ephemeral one is generated; sessions reset on restart) | **Required** — long random value |
| `DATA_ENCRYPTION_KEY` | 32-byte key (64 hex) to encrypt credential fields at rest. | Optional (derived from `AUTH_SECRET` if unset) | Recommended (explicit key) |
| `HOST` | Bind address. Defaults to `127.0.0.1` (API not exposed on the network). | — | Set `0.0.0.0` only behind an authenticating reverse proxy / VPN |
| `TRUST_PROXY` | Number of proxy hops (e.g. `1`) so client IPs / rate-limiting are correct behind a proxy. | — | Set **iff** behind a reverse proxy |
| `TLS_KEY_FILE` / `TLS_CERT_FILE` | Serve HTTPS natively from these PEM files (instead of a proxy). | Optional | Use a proxy OR these |
| `ROUTER_<ID>_PASSWORD` | Per-router live REST password, keeps it out of `data/weonline.json`. | Optional | Recommended for live routers |
| `ROUTER_ALLOW_ANY_HOST` | `1` disables the private-IP SSRF guard on live routers. | Optional | Leave unset unless a routable router is required |

Deployment (reverse proxy / native TLS) is covered in [`deploy/`](deploy/).

Generate secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

**First run:** there are no accounts yet. The **first** person to sign up becomes the
`admin`; afterwards self-registration is closed and an admin creates further accounts.

---

## 3. Run / build / test

| Task            | Command          | Notes                                              |
|-----------------|------------------|----------------------------------------------------|
| Dev server      | `npm run dev`    | Runs `tsx server.ts` → Express + Vite middleware on `http://localhost:3000` |
| Type-check/lint | `npm run lint`   | `tsc --noEmit` (no ESLint configured)              |
| Test            | `npm test`       | Vitest unit + integration tests (`server/**/*.test.ts`); `npm run test:watch` to watch |
| Production build| `npm run build`  | `vite build` + esbuild bundles the server to `dist/server.cjs` |
| Start (prod)    | `npm start`      | `node dist/server.cjs`, serves static `dist/`      |
| Clean           | `npm run clean`  | Removes `dist/`                                     |

> Tests cover the security-critical server modules — auth tokens (sign/verify/expiry),
> PBKDF2 credential verification, at-rest field encryption, the SSRF private-IP guard,
> and an end-to-end auth-gate + staff-management integration test (via supertest).

---

## 4. Architecture overview

```
Browser (React SPA)
   │
   ├── src/data (abstraction) ──► authService + dataStore  (backend-agnostic)
   │        └── active impl: IndexedDB (local, via `idb`)   ← swap in src/data/index.ts
   │
   └── src/api/client.ts ──► Express server (server/) over REST
            ├── /api/mikrotik/*  → MikrotikManager → driver per router
            └── /api/billing/*   → billing engine
                        │
   server/  Store (JSON file: data/weonline.json)
            ├── MikrotikManager  ──dispatch by RouterRecord.driver──┐
            │        ┌─────────────────────────────────────────────┴────────┐
            │  MikrotikSimulator (driver: 'simulator')     LiveRouterOsDriver (driver: 'live')
            │  invents traffic via refresh()               polls a real RouterOS 7 box over REST
            ├── BillingEngine    plans · subscriptions · invoices · payments · reports
            └── scheduler        manager.refreshAll() + settlePending() + engine.runCycle()
```

### Driver model (simulator ↔ live device)
Each router is backed by a **driver** chosen by `RouterRecord.driver`:
- `'simulator'` — the in-memory `MikrotikSimulator` (seeded demo routers).
- `'live'` — `LiveRouterOsDriver`, a **real** MikroTik (RouterOS 7) over the REST API.

Both implement one interface ([`server/mikrotik/driver.ts`](server/mikrotik/driver.ts)) and
fill the same `store.simState[routerId]` **read cache**, so the REST routes, the console
UI, and billing `report()` are identical for both kinds. `MikrotikManager`
([`server/mikrotik/manager.ts`](server/mikrotik/manager.ts)) dispatches every call to the
right driver. Because a live device is reached over the network, the provisioning path is
**async** end-to-end (engine → manager → driver); write failures are caught, logged, and
surfaced on `RouterRecord.lastError`.

### The server backend (`server/`)
Assembled by `server/index.ts#mountApi(app)` (async), called from `server.ts`.

- [`auth/`](server/auth/) — **server-side authentication (the authorization boundary).**
  `service.ts` (PBKDF2-hashed accounts, first user bootstraps as `admin`), `tokens.ts`
  (stateless HMAC-signed session tokens, `AUTH_SECRET`), `middleware.ts` (`requireAuth` +
  admin-only DELETEs), `routes.ts` (`/api/auth/register|login|me|logout|users`,
  registration-open). Login/register are rate-limited. `/api/mikrotik` and `/api/billing`
  are mounted behind `requireAuth`.
- [`crypto.ts`](server/crypto.ts) — `generatePassword()` (crypto-random) and AES-256-GCM
  field encryption used by the store to encrypt credential fields at rest.
- [`loadenv.ts`](server/loadenv.ts) — side-effect env loader; imported first in `server.ts`.
- [`store.ts`](server/store.ts) — dependency-free JSON persistence. In-memory state,
  debounced write-through to `data/weonline.json`, flushed on shutdown. Router/subscriber
  passwords are **encrypted at rest** (decrypted into memory on load). Also `makeId`.
- [`types.ts`](server/types.ts) — server-owned domain types (billing + sim entities),
  `RouterRecord` (incl. `driver`/`tls`/`insecureTls`/`lastError`), and `ProvisionSpec`.
- [`mikrotik/driver.ts`](server/mikrotik/driver.ts) — the `MikrotikDriver` interface both
  drivers implement (`ensureRouter`, `get`, `setOnline`, `upsertUser`, `setUserEnabled`,
  `removeUser`, `disconnectSession`, `refresh`).
- [`mikrotik/simulator.ts`](server/mikrotik/simulator.ts) — `MikrotikSimulator`: per-router
  RouterOS state; `refresh(nowMs, dtSec)` evolves sessions, traffic, data-cap usage, and
  telemetry. Seeded PRNG (never `Math.random`/`Date.now` at import time).
- [`mikrotik/live.ts`](server/mikrotik/live.ts) — `LiveRouterOsDriver`: talks to a real
  RouterOS 7 device over `/rest` using Node's built-in `http`/`https` (no dependency;
  accepts self-signed certs when `insecureTls`). `refresh()` polls `/system/resource`,
  `/ppp/active`, `/ip/hotspot/active`, `/ppp/secret`, `/ip/hotspot/user`, `/queue/simple`
  into the cache; writes map to PUT/PATCH/DELETE on `/ppp/secret` etc. and ensure a
  per-plan `/ppp/profile` (rate-limit) first.
- [`mikrotik/manager.ts`](server/mikrotik/manager.ts) — `MikrotikManager` facade +
  `refreshAll()` + `probe()` (read-only connectivity test).
- [`billing/engine.ts`](server/billing/engine.ts) — `BillingEngine`: plans, subscribers,
  the subscription lifecycle, recurring invoicing, payments (M-Pesa STK simulation +
  cash/manual), **async** provisioning via the manager, and `report()`.
- [`mikrotik/routes.ts`](server/mikrotik/routes.ts) / [`billing/routes.ts`](server/billing/routes.ts)
  — the REST surface. `POST /api/mikrotik/routers` accepts the driver + connection fields;
  `POST /api/mikrotik/routers/:id/test` is a read-only probe. The legacy
  `/api/mikrotik/status` endpoint is preserved (coherent telemetry).
- [`scheduler.ts`](server/scheduler.ts) — one async loop with a re-entrancy guard:
  `manager.refreshAll()` + `settlePending()` every 3s, `engine.runCycle()` every 15s.
- [`seed.ts`](server/seed.ts) — first-run world (2 **simulator** routers, 5 plans, 6
  subscribers across the lifecycle). Runs only when `data/weonline.json` is absent/empty.

The client talks to this over [`src/api/client.ts`](src/api/client.ts) (typed fetch
wrapper), consumed by [`src/views/BillingView.tsx`](src/views/BillingView.tsx) and
[`src/views/MikrotikConsole.tsx`](src/views/MikrotikConsole.tsx).

### The data layer (`src/data/`)
The app depends **only** on two interfaces — it never touches IndexedDB or any SDK
directly.

- [`types.ts`](src/data/types.ts) — `AuthService` + `DataStore` contracts.
- [`models.ts`](src/data/models.ts) — domain models (`Client`, `Router`, etc.),
  extracted out of `App.tsx`. This is the single source of truth for document shapes.
- [`index.ts`](src/data/index.ts) — **the one place a backend is chosen.** Exports
  `authService` (now **server-backed**) + `dataStore` (IndexedDB).
- `server/auth.ts` — `AuthService` that calls `/api/auth/*`, stores the session token,
  and re-validates it against `/api/auth/me` on load. Role comes from the server.
- `indexeddb/` — the local backend for the **legacy admin CRUD** only:
  - `db.ts` — thin `idb` wrapper; one object store per collection
    (`users`, `clients`, `routers`, `transactions`).
  - `store.ts` — `DataStore` over IndexedDB, with an in-memory pub/sub layer that
    emulates realtime `subscribe` (IndexedDB has no native change events, so every
    mutation re-emits the affected collection to its listeners).

> The old browser-local `indexeddb/auth.ts` (salted SHA-256) has been **removed** —
> authentication is now server-side (PBKDF2). See the server auth section below.

To add another backend, create `src/data/<provider>/` implementing the same interfaces
and swap the exports in `src/data/index.ts`.

- **Single-file frontend:** almost the entire UI lives in
  [`src/App.tsx`](src/App.tsx) (~1900 lines) — package catalog, all views, modals, and
  `authService`/`dataStore` calls.
- **Entry:** [`src/main.tsx`](src/main.tsx) → renders `<App/>` into `index.html`.
- **Server:** [`server.ts`](server.ts) runs Vite in middleware mode during dev and
  serves the built SPA in production. It calls `mountApi(app)` (`server/index.ts`) to
  mount the RouterOS simulator + billing engine and start the scheduler.

### Views (`view` state in `App.tsx`)
- `plans` — public storefront: package cards, search, simulated M-Pesa checkout.
- `subscriptions` — customer's active/expired packages (React state only).
- `history` — customer payment receipts (React state only).
- `admin` — gated by auth; sub-tabs: `dashboard`, **`billing`**, **`mikrotik`**,
  `clients`, `routers`, `transactions`.
  - **`billing`** ([`BillingView.tsx`](src/views/BillingView.tsx)) — Overview KPIs,
    Plans CRUD, Subscribers + enroll, Invoices with M-Pesa/cash payment. Server-backed.
  - **`mikrotik`** ([`MikrotikConsole.tsx`](src/views/MikrotikConsole.tsx)) — live
    RouterOS console: resource, active sessions, PPP secrets, hotspot users, queues,
    with power/disconnect/enable-disable controls. Server-backed, polls every 3s.

### Data model — see [`src/data/models.ts`](src/data/models.ts)
IndexedDB object stores (formerly Firestore collections, same shapes):
- `users/{uid}` — `{ uid, email, role: 'admin'|'technician', name }`
- `clients/{id}` — hotspot or PPPoE customers managed by staff
- `routers/{id}` — MikroTik router configs + (simulated) live telemetry
- `transactions/{id}` — billing/recharge history
- `auth_users/{uid}` — local credentials `{ uid, email, passwordHash, salt, displayName, createdAt }`

### Roles & auth — see [`AUTHORIZATION.md`](AUTHORIZATION.md)
- **Auth is enforced server-side.** Every `/api/mikrotik` and `/api/billing` call
  requires a valid signed session token; DELETEs additionally require the `admin` role
  (mirrors the former Firestore rules). Passwords are PBKDF2-hashed.
- The **first** account to register bootstraps as `admin`; self-registration then closes.
  Admins manage all later accounts from the **Staff** tab (create, change role, reset
  password, delete — backed by `/api/auth/users*`), which enforces "can't remove the last
  admin / your own account" guards.
- The client's role (from the server) still drives the **UI gate** in `App.tsx`, but the
  server is the real boundary — the UI gate is now defense-in-depth, not the only check.

---

## 5. What is real vs. simulated (IMPORTANT)

This app is a **prototype** that now includes a genuinely stateful (but still
**simulated**) backend. Before treating anything as production-ready:

- 🟢 **MikroTik simulator** — real, coherent, stateful RouterOS behaviour (users,
  sessions, queues, traffic, telemetry) in `server/mikrotik/`, persisted and ticked
  server-side. It is a **simulator**, not a connection to a physical RouterOS device.
- 🟢 **Live RouterOS driver** — routers added with `driver: 'live'` talk to a **real**
  MikroTik (RouterOS 7) over the REST API: real telemetry/sessions are polled in, and
  billing provisioning (create/enable/disable/remove users, per-plan profiles) is applied
  on the device. This acts on live hardware — see TUTORIAL.md for the RouterOS setup.
- 🟢 **Billing engine** — real subscription lifecycle, recurring invoicing, payment
  settlement, provisioning, and reports in `server/billing/`, persisted to
  `data/weonline.json`.
- 🟡 **M-Pesa STK** — the server **simulates** the STK push (`initiateMpesa` →
  scheduler settles ~92% after ~4s). No real Daraja API. The public storefront checkout
  in [App.tsx](src/App.tsx) is still the older `setTimeout` fake and is **not** wired to
  the billing engine.
- 🟡 **Public storefront subscriptions/receipts** — still React state only; lost on
  refresh. (The admin **Billing** tab is the real, persisted path.)
- 🟢 **Server-side auth** — accounts, PBKDF2 hashing, signed session tokens, and
  role-enforced `/api/*` (admin-only DELETEs). The legacy admin CRUD
  (clients/routers/transactions) still persists in the browser's IndexedDB.

> ✅ **Server-side authorization is in place**, with helmet + a tailored CSP, login
> rate-limiting, an admin **Staff** tab for account management, at-rest secret
> encryption, and TLS options (reverse proxy or native — see [`deploy/`](deploy/)).
> Before a public deployment still: set a stable `AUTH_SECRET` / `DATA_ENCRYPTION_KEY`,
> put TLS in front, and set `TRUST_PROXY` if behind a proxy.

---

## 6. Folder structure

```
weonline_v1/
├── src/
│   ├── App.tsx                  # UI + logic (large single file)
│   ├── main.tsx                 # React entry point
│   ├── index.css                # Tailwind entry
│   ├── api/
│   │   └── client.ts            # Typed REST client for the server backend
│   ├── views/
│   │   ├── BillingView.tsx      # Admin "Billing" sub-tab (server-backed)
│   │   ├── MikrotikConsole.tsx  # Admin "MikroTik" sub-tab (server-backed)
│   │   └── StaffView.tsx        # Admin "Staff" sub-tab (admin-only account management)
│   └── data/                    # Backend-agnostic data layer
│       ├── index.ts             # Backend selector (auth: server, data: IndexedDB)
│       ├── types.ts             # AuthService + DataStore contracts
│       ├── models.ts            # Domain models
│       ├── server/              # server-backed AuthService (auth.ts)
│       └── indexeddb/           # Local backend for legacy admin CRUD: db, store
├── server/                      # Express backend: auth + sim/live drivers + billing engine
│   ├── index.ts                 # mountApi(app) [async]: wires auth/store/manager/engine/scheduler
│   ├── loadenv.ts               # env loader (imported first)
│   ├── crypto.ts                # password generation + AES-GCM field encryption
│   ├── store.ts                 # JSON-file persistence (encrypts secrets at rest) + makeId
│   ├── types.ts                 # Server domain types (AuthUserRecord, RouterRecord.driver, ...)
│   ├── net.ts                   # pure net helpers (isPrivateIpv4 SSRF guard) + net.test.ts
│   ├── scheduler.ts             # Async ticking loop (manager.refreshAll + billing cycle)
│   ├── seed.ts                  # First-run seed world (simulator routers)
│   ├── crypto.test.ts           # (tests colocate next to the module they cover)
│   ├── auth/                    # service.ts, tokens.ts, middleware.ts, routes.ts (+ *.test.ts)
│   ├── mikrotik/                # driver.ts, simulator.ts, live.ts, manager.ts, routes.ts
│   └── billing/                 # engine.ts + routes.ts
├── deploy/                      # Caddyfile, nginx.conf, README (reverse proxy / TLS)
├── data/                        # Runtime state (weonline.json) — gitignored
├── server.ts                    # Express + Vite dev/prod server; helmet + CSP, TLS, calls mountApi
├── index.html                   # SPA host page
├── metadata.json                # App manifest (name/description)
├── vite.config.ts               # Vite + Tailwind + React config
├── vitest.config.ts             # Test runner config (node env, server/**/*.test.ts)
├── tsconfig.json
├── .env.example                 # documents AUTH_SECRET / HOST / TLS / router + data-key vars
├── .env.local                   # local secrets (gitignored)
├── AUTHORIZATION.md             # access model + former security rules
└── package.json
```

---

## 7. Conventions

- **Styling:** Tailwind utility classes inline. Brand color is orange
  (`orange-500/600`); slate for neutrals; blue accents for router/network UI.
- **Icons:** `lucide-react`.
- **Animation:** `motion/react` (`motion.div`, `AnimatePresence`) for modals and view
  transitions.
- **Dates:** `date-fns` (`format`, `addDays`, etc.). ISO strings stored in the data layer.
- **Currency:** Kenyan Shilling, displayed as `KES {amount}`.
- **Data access:** always via `authService` / `dataStore` from `src/data` — never call
  IndexedDB (or any future SDK) directly from components.

---

## 8. Known gotchas / tech debt

- **Set `AUTH_SECRET` (and ideally `DATA_ENCRYPTION_KEY`) in production.** Without them a
  session secret is ephemeral (logins reset on restart) and passwords are stored plaintext
  at rest. See §2.
- **No self-service password reset / email flow.** An admin resets passwords from the
  Staff tab (or `POST /api/auth/users/:uid/password`); there's no email-based recovery.
- **Legacy IndexedDB admin CRUD** (clients/routers/transactions) is still browser-local and
  unauthenticated at the data layer — only the server-backed Billing/MikroTik/Staff surfaces
  are protected. Migrate those to the server if they become load-bearing.
- **Router telemetry writes many fields.** The former Firestore router validator only
  allowed `name, location, ipAddress, status` while the app writes ~11 fields — a bug
  noted in `AUTHORIZATION.md` to fix if router validation is ever re-enforced server-side.

---

## 9. Updating this document

Update PROCESS.md whenever the setup, build/run commands, architecture, data model,
or conventions change.
