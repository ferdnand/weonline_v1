# PROCESS.md — WeOnline Development Guide

WeOnline is a Wireless ISP (WISP) management app for a Kenyan internet provider. It
combines a public package storefront with an admin/technician portal, backed by
Firebase (Auth + Firestore) and served through a small Express + Vite server.

---

## 1. Prerequisites

- **Node.js** 18+ (project uses ESM, `"type": "module"`)
- A package manager. The repo currently carries **both** `bun.lock` and
  `package-lock.json`. Pick one and stay consistent:
  - If using **bun**: `bun install`
  - If using **npm**: `npm install`
  - Do not mix. (Recommend deleting whichever lockfile you are not using.)
- A **Firebase project** with Firestore and Authentication enabled
  (Email/Password + Google sign-in).

---

## 2. Environment setup

The app runs against a pluggable data backend selected in
[`src/data/index.ts`](src/data/index.ts). **The active backend is local IndexedDB**,
so **no Firebase project or network is required to run the app locally.** Just install
and `npm run dev`.

1. (Optional) Copy the example env file:
   ```
   cp .env.example .env.local
   ```
   - `GEMINI_API_KEY` — only needed if/when Gemini features are wired up
     (the `@google/genai` dependency is currently installed but unused).
   - `APP_URL` — the hosted URL; used for self-referential links.
   Neither is required for the local IndexedDB backend.

2. **Only if you switch the backend to Firebase** (see §4): Firebase client config
   lives in **`firebase-applet-config.json`** ([`src/firebase.ts`](src/firebase.ts)),
   and the security rules in [`firestore.rules`](firestore.rules) must be deployed
   (`firebase deploy --only firestore:rules`). See **Known gotchas** — the router
   validator currently rejects the fields the app writes.

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
> only static gate. Add tests under a `test/` or `*.test.tsx` convention if introduced.

---

## 4. Architecture overview

```
Browser (React SPA)
   │
   ├── src/data (abstraction) ──► authService + dataStore  (backend-agnostic)
   │        └── active impl: IndexedDB (local)   ← swap in src/data/index.ts
   │            other impls: Firebase (kept), Supabase (future — MIGRATION.md)
   └── /api/mikrotik/status ────► Express (server.ts) — SIMULATED router telemetry
```

### The data layer (`src/data/`)
The app depends **only** on two interfaces — it never imports `firebase/*` or touches
IndexedDB directly. See [`AUDIT.md`](AUDIT.md) and [`MIGRATION.md`](MIGRATION.md).

- [`types.ts`](src/data/types.ts) — `AuthService` + `DataStore` contracts.
- [`models.ts`](src/data/models.ts) — domain models (`Client`, `Router`, etc.),
  extracted out of `App.tsx`.
- [`index.ts`](src/data/index.ts) — **the one place a backend is chosen.** Exports
  `authService` + `dataStore`.
- `indexeddb/` — **active** local backend. `store.ts` emulates Firestore-style
  realtime `subscribe` with an in-memory pub/sub; `auth.ts` does salted-SHA-256
  email/password auth with the session id in `localStorage`.
- `firebase/` — Firebase Auth + Firestore implementation, kept for a one-line
  flip-back. Not bundled while inactive.

To change backends, edit the two exports in `src/data/index.ts` only.

- **Single-file frontend:** almost the entire UI lives in
  [`src/App.tsx`](src/App.tsx) (~1900 lines) — package catalog, all views, modals, and
  `authService`/`dataStore` calls. Domain types now live in `src/data/models.ts`.
- **Entry:** [`src/main.tsx`](src/main.tsx) → renders `<App/>` into `index.html`.
- **Server:** [`server.ts`](server.ts) runs Vite in middleware mode during dev and
  serves the built SPA in production. Its only API route returns **randomized** router
  stats (CPU, memory, temp, uptime, client count).

### Views (`view` state in `App.tsx`)
- `plans` — public storefront: package cards, search, simulated M-Pesa checkout.
- `subscriptions` — customer's active/expired packages (React state only).
- `history` — customer payment receipts (React state only).
- `admin` — gated by auth; sub-tabs: `dashboard`, `clients`, `routers`, `transactions`.

### Data model (Firestore) — see [`firebase-blueprint.json`](firebase-blueprint.json)
- `users/{uid}` — `{ uid, email, role: 'admin'|'technician', name }`
- `clients/{id}` — hotspot or PPPoE customers managed by staff
- `routers/{id}` — MikroTik router configs + (simulated) live telemetry
- `transactions/{id}` — billing/recharge history

### Roles & auth
- The first-login bootstrap in `App.tsx` assigns `admin` to `mongeta5@gmail.com` and
  `technician` to everyone else. On the **Firebase** backend, role-based access is also
  enforced server-side in [`firestore.rules`](firestore.rules). On the **IndexedDB**
  backend there is no server, so the client-side role is the only gate (fine for local
  dev). Change the hardcoded email before any real deployment.

---

## 5. What is real vs. simulated (IMPORTANT)

This app is largely a **prototype**. Before treating anything as production-ready:

- 🟡 **M-Pesa payments** — faked with `setTimeout` in `initiatePayment`
  ([App.tsx](src/App.tsx)). No real STK push / Daraja API integration.
- 🟡 **MikroTik telemetry** — random numbers from `/api/mikrotik/status`
  ([server.ts](server.ts)), polled every 10s and written back to Firestore. No real
  RouterOS API connection.
- 🟡 **Customer subscriptions & payments** — held in React state only; lost on
  refresh. Only admin-side `clients`, `routers`, and `transactions` persist.
- 🟢 **Real:** auth + admin CRUD for clients/routers + transaction logging. With the
  **IndexedDB** backend these persist in the browser (survive refresh; cleared when you
  clear site data / IndexedDB). With **Firebase** they persist in Firestore.

---

## 6. Folder structure

```
weonline_v1/
├── src/
│   ├── App.tsx                  # UI + logic (large single file)
│   ├── main.tsx                 # React entry point
│   ├── firebase.ts              # Firebase SDK init (used only by src/data/firebase/*)
│   ├── index.css                # Tailwind entry
│   └── data/                    # Backend-agnostic data layer
│       ├── index.ts             # Backend selector (active: IndexedDB)
│       ├── types.ts             # AuthService + DataStore contracts
│       ├── models.ts            # Domain models
│       ├── indexeddb/           # Local backend (active): db, store, auth
│       └── firebase/            # Firebase backend (kept for flip-back)
├── server.ts                    # Express + Vite dev/prod server, mock MikroTik API
├── index.html                   # SPA host page
├── firebase-applet-config.json  # Firebase client config (imported by firebase.ts)
├── firebase-blueprint.json      # Firestore schema/entity blueprint
├── metadata.json                # Duplicate of the blueprint schema
├── firestore.rules              # Firestore security rules (role-based)
├── vite.config.ts               # Vite + Tailwind + React config
├── tsconfig.json
├── .env.example                 # GEMINI_API_KEY, APP_URL
└── package.json
```

---

## 7. Conventions

- **Styling:** Tailwind utility classes inline. Brand color is orange
  (`orange-500/600`); slate for neutrals; blue accents for router/network UI.
- **Icons:** `lucide-react`.
- **Animation:** `motion/react` (`motion.div`, `AnimatePresence`) for modals and view
  transitions.
- **Dates:** `date-fns` (`format`, `addDays`, etc.). ISO strings stored in Firestore.
- **Currency:** Kenyan Shilling, displayed as `KES {amount}`.
- **Error handling:** Firestore writes funnel through `handleFirestoreError` in
  `App.tsx` (logs + rethrows).

---

## 8. Known gotchas / tech debt

- **Firestore rules reject router writes.** `isValidRouter` in `firestore.rules`
  only allows `['name','location','ipAddress','status']`, but the app writes ~11
  fields (username, apiPort, isMikrotik, model, cpu, memory, uptime, temperature,
  clientsCount). Update the validator before deploying rules, or router create/update
  will fail with permission errors.
- **`firebase-blueprint.json`** (Firestore entity schema) and **`metadata.json`** (AI
  Studio applet manifest declaring the Gemini capability) are both leftover from the AI
  Studio origin and are not consumed by the app code. Prune when convenient.
- **Two lockfiles:** `bun.lock` + `package-lock.json`. Standardize on one.
- **Unused dependency:** `@google/genai` is installed but not referenced.
- **Hardcoded admin email** in two places (`App.tsx`, `firestore.rules`).
- **No test suite.**

---

## 9. Updating this document

Update PROCESS.md whenever the setup, build/run commands, architecture, data model,
or conventions change.
