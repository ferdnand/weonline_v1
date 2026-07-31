# AUTHORIZATION.md — Access model (and what was lost with Firestore)

This app was migrated from Firebase Auth + Cloud Firestore to a **standalone,
browser-local** stack (IndexedDB via the `idb` package; local username/password
auth). See `PROCESS.md` for the current architecture.

> ⚠️ **Important:** Firestore Security Rules ran **server-side** and were the real
> enforcement boundary. The local IndexedDB backend has **no server**, so there is
> **no equivalent enforcement** — any code running in the browser can read/write the
> whole `weonline` IndexedDB database directly, regardless of role. In local mode the
> role check is a **UI gate only** (it decides what the app shows/does, not what the
> data layer permits). This is acceptable for a single-user local/prototype app; it is
> **not** a substitute for server-side authorization. If this app ever gets a real
> shared backend, the rules below must be reimplemented there (e.g. Postgres RLS /
> API middleware) — do not ship a multi-user deployment without them.

## Roles

- **admin** — full access, including deletes. Bootstrapped to the hardcoded email
  `mongeta5@gmail.com` on first sign-in (`src/App.tsx`); everyone else becomes a
  `technician`. Change this before any real deployment.
- **technician** — read + create/update on `clients`, `routers`, `transactions`;
  **no** deletes; cannot change their own role.

## Former Firestore rules (preserved verbatim for reference)

The deleted `firestore.rules` encoded the following. Reimplement equivalently on any
future server backend.

| Collection | read | create | update | delete |
|---|---|---|---|---|
| `users/{uid}` | any authenticated | valid user shape AND (owner OR admin) | valid shape AND (admin OR owner keeping same role) | — |
| `clients/{id}` | technician+ | technician+ AND valid client | technician+ AND valid client | admin |
| `routers/{id}` | technician+ | technician+ AND valid router | technician+ AND valid router | admin |
| `transactions/{id}` | technician+ | technician+ AND valid txn | admin AND valid txn | admin |

Field validators the rules enforced:

- **User** — exactly `{ uid, email, role∈{admin,technician}, name }` (all strings).
- **Client** — only the fields in `src/data/models.ts` `Client`; `name` non-empty
  (<100 chars); `type∈{hotspot,pppoe}`; `status∈{active,expired}`.
- **Router** — the shipped rule allowed only `{ name, location, ipAddress, status }`,
  which was **out of sync** with the ~11 fields the app actually writes (telemetry,
  credentials, etc.). This was a known bug — if you re-enforce router validation on a
  server, allow the full `Router` field set from `src/data/models.ts`.
- **Transaction** — only `{ clientId, clientName, amount, date, planName, type }` with
  `clientId:string, amount:number, date:string`.

## Cloud Functions / triggers

There were **none** — the project had no Cloud Functions and no Admin SDK / server-side
triggers. The only backend code is `server.ts` (Express), which is unrelated to
Firebase and returns **simulated** MikroTik telemetry. So no server-side trigger logic
was lost in the migration.
