# PROCESS.md — WeOnline Development Guide

WeOnline is a Wireless ISP (WISP) management app for a Kenyan internet provider. It
combines a public package storefront with an admin/technician portal. It is a
**fully standalone** app with **two backends**:

1. **Browser IndexedDB** (via the `idb` package) — auth + the legacy admin CRUD
   (clients, routers, transactions).
2. **Express server** (`server/`) — a **stateful MikroTik RouterOS simulator** and a
   **full-scale billing engine**, persisted to a plain JSON file
   (`data/weonline.json`). A ticking scheduler advances the sim and runs the billing
   cycle server-side.

**No Firebase, Google Cloud, database server, or any external service is used.**

---

## 1. Prerequisites

- **Node.js** 18+ (project uses ESM, `"type": "module"`)
- A package manager. The repo currently carries **both** `bun.lock` and
  `package-lock.json`. Pick one and stay consistent (recommend **npm** + deleting
  `bun.lock`):
  - **npm**: `npm install`
  - **bun**: `bun install`
  - Do not mix.

No cloud accounts, API keys, or environment variables are required.

---

## 2. Environment setup

Nothing to configure. The active backend is **local IndexedDB** (selected in
[`src/data/index.ts`](src/data/index.ts)), so the app runs offline out of the box —
just install and `npm run dev`.

`.env.example` is an empty placeholder; copy it to `.env.local` (gitignored) only if
you later add config of your own. No variables are read by the app today.

---

## 3. Run / build / test

| Task            | Command          | Notes                                              |
|-----------------|------------------|----------------------------------------------------|
| Dev server      | `npm run dev`    | Runs `tsx server.ts` → Express + Vite middleware on `http://localhost:3000` |
| Type-check/lint | `npm run lint`   | `tsc --noEmit` (no ESLint configured)              |
| Production build| `npm run build`  | `vite build` + esbuild bundles the server to `dist/server.cjs` |
| Start (prod)    | `npm start`      | `node dist/server.cjs`, serves static `dist/`      |
| Clean           | `npm run clean`  | Removes `dist/`                                     |

> There is currently **no automated test suite**. `npm run lint` (type-check) is the
> only static gate.

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

- [`store.ts`](server/store.ts) — dependency-free JSON persistence. In-memory state,
  debounced write-through to `data/weonline.json`, flushed on shutdown. Also `makeId`.
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
  `authService` + `dataStore`.
- `indexeddb/` — the **active** local backend:
  - `db.ts` — thin `idb` wrapper; one object store per collection
    (`users`, `clients`, `routers`, `transactions`) plus `auth_users` for credentials.
  - `store.ts` — `DataStore` over IndexedDB, with an in-memory pub/sub layer that
    emulates realtime `subscribe` (IndexedDB has no native change events, so every
    mutation re-emits the affected collection to its listeners).
  - `auth.ts` — salted-SHA-256 username/password auth (the "username" is the email);
    session uid in `localStorage` + in-memory `currentUser`.

To add another backend (e.g. a self-hosted REST API), create `src/data/<provider>/`
implementing the same two interfaces and swap the exports in `src/data/index.ts`.

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
- The first-login bootstrap in `App.tsx` assigns `admin` to `mongeta5@gmail.com` and
  `technician` to everyone else. Change this hardcoded email before any real use.
- **There is no server**, so role-based access is a **client-side UI gate only** — fine
  for a single-user local app, but not real authorization. The former Firestore
  security rules (the actual enforcement boundary) are documented in `AUTHORIZATION.md`
  so they can be reimplemented if this ever gets a shared backend.

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
- 🟢 **Local auth + legacy admin CRUD** (clients/routers/transactions) — persist in the
  browser's IndexedDB as before.

> ⚠️ **No server-side authorization.** The `/api/*` routes are unauthenticated — any
> client can call them. Role checks remain a client-side UI gate only (see
> `AUTHORIZATION.md`). Add real auth/authz before any shared or public deployment.

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
│   │   └── MikrotikConsole.tsx  # Admin "MikroTik" sub-tab (server-backed)
│   └── data/                    # Backend-agnostic data layer (IndexedDB)
│       ├── index.ts             # Backend selector (active: IndexedDB)
│       ├── types.ts             # AuthService + DataStore contracts
│       ├── models.ts            # Domain models
│       └── indexeddb/           # Local backend (active): db, store, auth
├── server/                      # Express backend: sim/live drivers + billing engine
│   ├── index.ts                 # mountApi(app) [async]: wires store/manager/engine/scheduler
│   ├── store.ts                 # JSON-file persistence + makeId
│   ├── types.ts                 # Server domain types (RouterRecord.driver, ProvisionSpec)
│   ├── scheduler.ts             # Async ticking loop (manager.refreshAll + billing cycle)
│   ├── seed.ts                  # First-run seed world (simulator routers)
│   ├── mikrotik/                # driver.ts, simulator.ts, live.ts, manager.ts, routes.ts
│   └── billing/                 # engine.ts + routes.ts
├── data/                        # Runtime state (weonline.json) — gitignored
├── server.ts                    # Express + Vite dev/prod server; calls mountApi
├── index.html                   # SPA host page
├── metadata.json                # App manifest (name/description)
├── vite.config.ts               # Vite + Tailwind + React config
├── tsconfig.json
├── .env.example                 # placeholder (no vars required)
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

- **No server-side authorization.** Local role checks are UI-only (see
  `AUTHORIZATION.md`). Do not deploy multi-user without a real backend + rules.
- **Router telemetry writes many fields.** The former Firestore router validator only
  allowed `name, location, ipAddress, status` while the app writes ~11 fields — a bug
  noted in `AUTHORIZATION.md` to fix if router validation is ever re-enforced server-side.
- **Two lockfiles:** `bun.lock` + `package-lock.json`. Standardize on one (recommend
  deleting `bun.lock`).
- **Hardcoded admin email** (`mongeta5@gmail.com`) in `App.tsx`.
- **No test suite.**

---

## 9. Updating this document

Update PROCESS.md whenever the setup, build/run commands, architecture, data model,
or conventions change.
