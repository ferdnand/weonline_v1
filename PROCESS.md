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

1. Copy the example env file and fill in real values:
   ```
   cp .env.example .env.local
   ```
   - `GEMINI_API_KEY` — only needed if/when Gemini features are wired up
     (the `@google/genai` dependency is currently installed but unused).
   - `APP_URL` — the hosted URL; used for self-referential links.

2. Firebase client config lives in **`firebase-applet-config.json`** and is imported
   directly by [`src/firebase.ts`](src/firebase.ts). Update it with your project's
   web app config and `firestoreDatabaseId`.

3. Deploy the security rules in [`firestore.rules`](firestore.rules) to your Firebase
   project (`firebase deploy --only firestore:rules`, or paste via the console).
   See the **Known gotchas** section — the router validator currently rejects the
   fields the app writes.

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
   ├── Firebase Auth  ──────────► Google / Email-Password sign-in
   ├── Firestore (realtime) ────► users, clients, routers, transactions
   └── /api/mikrotik/status ────► Express (server.ts) — SIMULATED router telemetry
```

- **Single-file frontend:** almost the entire UI lives in
  [`src/App.tsx`](src/App.tsx) (~2000 lines) — types, package catalog, all views,
  modals, and Firestore calls.
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
- Role-based access enforced in [`firestore.rules`](firestore.rules): `admin` vs
  `technician`. Admin is currently hardcoded to `mongeta5@gmail.com` (both in the
  rules and in `App.tsx`'s first-login bootstrap). Change this before real deployment.

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
- 🟢 **Real:** Firebase Auth, admin CRUD for clients/routers, transaction logging.

---

## 6. Folder structure

```
weonline_v1/
├── src/
│   ├── App.tsx                  # Entire UI + logic (large single file)
│   ├── main.tsx                 # React entry point
│   ├── firebase.ts              # Firebase app/auth/firestore init
│   └── index.css                # Tailwind entry
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
- **Duplicate schema files:** `firebase-blueprint.json` and `metadata.json` hold the
  same content. Consider consolidating.
- **Two lockfiles:** `bun.lock` + `package-lock.json`. Standardize on one.
- **Unused dependency:** `@google/genai` is installed but not referenced.
- **Hardcoded admin email** in two places (`App.tsx`, `firestore.rules`).
- **No test suite.**

---

## 9. Updating this document

Update PROCESS.md whenever the setup, build/run commands, architecture, data model,
or conventions change.
