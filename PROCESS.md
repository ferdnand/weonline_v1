# PROCESS.md — WeOnline Development Guide

WeOnline is a Wireless ISP (WISP) management app for a Kenyan internet provider. It
combines a public package storefront with an admin/technician portal. It is a
**fully standalone** app: auth + data run in the browser on **IndexedDB** (via the
`idb` package), served through a small Express + Vite server. **No Firebase, Google
Cloud, or any external service is used.**

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
   └── /api/mikrotik/status ────► Express (server.ts) — SIMULATED router telemetry
```

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
  serves the built SPA in production. Its only API route returns **randomized** router
  stats (CPU, memory, temp, uptime, client count).

### Views (`view` state in `App.tsx`)
- `plans` — public storefront: package cards, search, simulated M-Pesa checkout.
- `subscriptions` — customer's active/expired packages (React state only).
- `history` — customer payment receipts (React state only).
- `admin` — gated by auth; sub-tabs: `dashboard`, `clients`, `routers`, `transactions`.

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

This app is largely a **prototype**. Before treating anything as production-ready:

- 🟡 **M-Pesa payments** — faked with `setTimeout` in `initiatePayment`
  ([App.tsx](src/App.tsx)). No real STK push / Daraja API integration.
- 🟡 **MikroTik telemetry** — random numbers from `/api/mikrotik/status`
  ([server.ts](server.ts)), polled every 10s and written back to the local store. No
  real RouterOS API connection.
- 🟡 **Customer subscriptions & payments** — held in React state only; lost on
  refresh. Only admin-side `clients`, `routers`, and `transactions` persist.
- 🟢 **Real:** local auth + admin CRUD for clients/routers + transaction logging. These
  persist in the browser's IndexedDB (survive refresh; cleared when you clear site
  data / IndexedDB).

---

## 6. Folder structure

```
weonline_v1/
├── src/
│   ├── App.tsx                  # UI + logic (large single file)
│   ├── main.tsx                 # React entry point
│   ├── index.css                # Tailwind entry
│   └── data/                    # Backend-agnostic data layer
│       ├── index.ts             # Backend selector (active: IndexedDB)
│       ├── types.ts             # AuthService + DataStore contracts
│       ├── models.ts            # Domain models
│       └── indexeddb/           # Local backend (active): db, store, auth
├── server.ts                    # Express + Vite dev/prod server, mock MikroTik API
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
