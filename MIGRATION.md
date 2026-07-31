# MIGRATION.md — Decoupling WeOnline from Firebase / Google

Derived from [`AUDIT.md`](AUDIT.md). Goal: make WeOnline **provider-agnostic** so Firebase
Auth + Firestore can be swapped for another backend (self-hosted, Supabase, Postgres+API,
etc.) with minimal, isolated changes.

## Status (2026-07-31)

- ✅ **Phase 1** — domain models extracted to [`src/data/models.ts`](src/data/models.ts).
- ✅ **Phase 2** — abstraction defined ([`src/data/types.ts`](src/data/types.ts)) with a
  Firebase wrapper ([`src/data/firebase/`](src/data/firebase/)).
- ✅ **Phase 3** — `App.tsx` rewired to `authService`/`dataStore`; imports zero
  `firebase/*`; `tsc --noEmit` passes.
- ✅ **Phase 4 (interim)** — a **local IndexedDB backend**
  ([`src/data/indexeddb/`](src/data/indexeddb/)) is implemented and is the **active**
  backend (selected in [`src/data/index.ts`](src/data/index.ts)). This unblocks running
  the app with no Firebase/network.
- ⏳ **Phase 4 (target)** — **Supabase** remains the intended production backend; add
  `src/data/supabase/*` implementing the same interfaces and flip `index.ts`.
- ⏳ **Phase 5** — cleanup (remove `firebase`/`@google/genai` deps, prune AI Studio
  config) deferred until the Supabase backend lands, so the Firebase flip-back stays
  available in the meantime.

The rest of this document is the original plan, kept for reference.

---

## 1. Where the coupling actually lives

From the audit, the surface area is small and well-contained:

- **Only two hard dependencies:** Firebase **Auth** and **Cloud Firestore**.
- **One existing seam:** `src/firebase.ts` already centralizes SDK init and exports
  `auth` + `db`.
- **~20 direct call sites**, all inside `src/App.tsx` (Auth listener/login/logout +
  Firestore CRUD/realtime).
- **Server (`server.ts`) is already Firebase-free** — no work needed there.
- **No Admin SDK / service account** — no server-side secret to migrate.

The strategy: **introduce a thin abstraction layer** so `App.tsx` never imports
`firebase/*` directly, then swap the implementation behind that layer.

---

## 2. Target architecture

```
              ┌─────────────────────────────────────────────┐
  App.tsx ──► │  src/data/  (provider-agnostic interfaces)   │
              │    authService : AuthService                 │
              │    dataStore   : DataStore                   │
              └───────────────┬─────────────────────────────┘
                              │  one implementation chosen at build/runtime
        ┌─────────────────────┼──────────────────────────────┐
        ▼                     ▼                                ▼
  firebaseAuth /        supabaseAuth /                  restAuth /
  firebaseStore         supabaseStore                   restStore   (future)
```

Two interfaces to define (suggested `src/data/types.ts`):

```ts
// Auth
export interface AuthUser { uid: string; email: string | null; displayName: string | null; }
export interface AuthService {
  onAuthStateChanged(cb: (user: AuthUser | null) => void): () => void; // returns unsubscribe
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;   // optional; may throw "unsupported"
  signOut(): Promise<void>;
}

// Data — collections abstracted to generic documents keyed by string id
export interface DataStore {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, data: T): Promise<void>;
  add<T>(collection: string, data: T): Promise<string>;          // returns new id
  update<T>(collection: string, id: string, patch: Partial<T>): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
  subscribe<T>(                                                   // realtime
    collection: string,
    cb: (docs: Array<T & { id: string }>) => void,
    opts?: { orderBy?: { field: string; dir: 'asc' | 'desc' } }
  ): () => void;
}
```

These map 1:1 onto today's usage (`getDoc/setDoc/addDoc/updateDoc/deleteDoc/onSnapshot`),
so the refactor is mechanical.

---

## 3. Phased plan

### Phase 0 — Guardrails (before touching anything)
- [ ] Add `npm run lint` (already exists: `tsc --noEmit`) to a pre-change baseline; ensure it passes.
- [ ] Add a couple of smoke tests (or a manual test script) for the critical flows:
      login, add client, recharge, realtime list refresh. There is **no test suite today**
      (see PROCESS.md) — even a minimal one de-risks the swap.
- [ ] Rotate/settle the committed Firebase `apiKey` question (see §5).

### Phase 1 — Extract the data-model types
- [ ] Move the interfaces `Package, Subscription, Payment, Client, Router, Transaction,
      UserProfile` out of `App.tsx` into `src/data/models.ts`.
- [ ] No behavior change; just imports. Keeps later diffs readable.

### Phase 2 — Define the abstraction (no provider swap yet)
- [ ] Create `src/data/types.ts` with `AuthService` + `DataStore` (above).
- [ ] Create `src/data/firebase/` implementing both against the current SDK, reusing
      `src/firebase.ts`'s `auth`/`db`. This is a **wrapper**, not a rewrite.
- [ ] Create `src/data/index.ts` that exports the chosen implementation:
      ```ts
      export { firebaseAuth as authService } from './firebase/auth';
      export { firebaseStore as dataStore } from './firebase/store';
      ```

### Phase 3 — Rewire `App.tsx` to the abstraction
- [ ] Replace direct `firebase/auth` calls with `authService.*`:
      - `onAuthStateChanged(auth, …)` → `authService.onAuthStateChanged(…)` (App.tsx:309)
      - `signInWithPopup/GoogleAuthProvider` → `authService.signInWithGoogle()` (397–398)
      - `signInWithEmailAndPassword` → `authService.signInWithEmail()` (417)
      - `createUserWithEmailAndPassword` → `authService.signUpWithEmail()` (415)
      - `signOut(auth)` → `authService.signOut()` (434)
- [ ] Replace direct `firebase/firestore` calls with `dataStore.*` (all sites in §1 of AUDIT):
      users get/set (312/324), clients subscribe/CRUD (340,565,567,579,598,610),
      routers subscribe/CRUD/telemetry (344,371,637,639,1684),
      transactions subscribe/add (348,519,583).
- [ ] Delete now-unused `firebase/*` imports and the **dead imports** flagged in the audit
      (`getDocs, where, Timestamp, serverTimestamp`).
- [ ] `App.tsx` should import **zero** `firebase/*` modules after this phase. Verify with:
      `grep -rn "firebase/" src/App.tsx` → no results.
- [ ] Run `npm run lint` + smoke tests. **Behavior identical, provider unchanged.** This is
      the safe checkpoint — the app still runs on Firebase but is now decoupled.

### Phase 4 — Implement the replacement provider
*(Depends on chosen target — see §4 for options.)*
- [ ] Create `src/data/<provider>/auth.ts` + `store.ts` implementing the same interfaces.
- [ ] Port `firestore.rules` semantics (role-based `admin`/`technician`, field validation)
      to the new backend's authorization model. **Do not lose** the access rules in the swap.
- [ ] Migrate existing data (`users`, `clients`, `routers`, `transactions`) — export from
      Firestore, transform, import. Shapes are documented in AUDIT §2.
- [ ] Flip `src/data/index.ts` to export the new implementation.
- [ ] Re-run lint + smoke tests against the new backend.

### Phase 5 — Cleanup & config
- [ ] Remove `firebase` from `package.json` (and `@google/genai` if Gemini stays unused).
      Deleting the meta-package drops all 44 transitive `@firebase/*` subpackages.
- [ ] Remove/replace `firebase-applet-config.json`, `firestore.rules`,
      `firebase-blueprint.json`; introduce the new backend's config via `.env.local`.
- [ ] Replace the gstatic Google logo (`App.tsx:703`) with a local asset if Google login
      is dropped.
- [ ] Update `PROCESS.md`, `TUTORIAL.md`, `.env.example`, and `README.md`.

---

## 4. Backend options (pick one before Phase 4)

| Option | Auth | Data + realtime | Effort | Notes |
|---|---|---|---|---|
| **Supabase** | Supabase Auth (email + OAuth) | Postgres + Realtime subscriptions | **Low–Med** | Closest feature parity (realtime + row-level security ≈ Firestore rules). Fastest path. |
| **Appwrite** | Built-in | Databases + realtime | Med | Self-hostable, similar model. |
| **Custom REST/WS API** (Express is already here) | JWT / Passport / Lucia | Postgres/SQLite + WebSocket or SSE for realtime | **High** | Most control, most work; reuses existing `server.ts`. Realtime must be built. |
| **Pocketbase** | Built-in | SQLite + realtime | Low | Single-binary, great for a small ISP portal; self-hosted. |

Recommendation for this app's size: **Supabase** (least code, keeps realtime UX) or
**Pocketbase** (simplest self-hosted). Both satisfy the `AuthService`/`DataStore` interfaces
cleanly.

---

## 5. Risks & things not to lose

1. **Realtime is load-bearing.** `clients`, `routers`, `transactions` use `onSnapshot`
   live updates (and the 10s router telemetry writer). The replacement **must** provide
   subscriptions or the admin UI needs polling added. Don't pick a data layer without
   realtime unless you accept a UX change.
2. **Authorization rules must survive the move.** `firestore.rules` encodes real
   security (role gating, field whitelists). Reimplement equivalently (e.g. Supabase RLS).
   Note the existing **router-rule bug** (AUDIT §2) — fix it during the port, don't copy it.
3. **Named Firestore database.** Current code targets a *non-default* database id
   (`firebase.ts:8`). Any data export must read from that named DB, not `(default)`.
4. **Hardcoded admin email** (`mongeta5@gmail.com`) lives in both `App.tsx` and
   `firestore.rules`. Replace with a proper roles table/claim during migration.
5. **Committed API key** in `firebase-applet-config.json`. Firebase web keys are not
   secret by design, but if the repo is public, restrict the key (Firebase Console →
   API key restrictions) or move config to env. The new backend's secrets **must** go in
   `.env.local` (already gitignored).
6. **Customer-facing state is in-memory today.** `subscriptions`/`payments` never touch
   Firestore (they reset on refresh). Decide during migration whether to persist them —
   this is a feature gap, not just a swap.

---

## 6. Estimated effort

| Phase | Risk | Rough size |
|---|---|---|
| 0 Guardrails | Low | 0.5 day |
| 1 Extract types | Very low | 0.5 day |
| 2 Define abstraction + Firebase wrapper | Low | 1 day |
| 3 Rewire `App.tsx` (safe checkpoint) | Medium | 1–2 days |
| 4 New provider + data migration | Medium–High | 2–4 days (provider-dependent) |
| 5 Cleanup + docs | Low | 0.5 day |

**Phases 1–3 deliver the decoupling value on their own** — after Phase 3 the app is
provider-agnostic while still running on Firebase, so they can be merged independently of
choosing a new backend.

---

## 7. Definition of done

- `grep -rn "firebase" src/` returns only files under `src/data/firebase/` (or nothing,
  post-swap).
- `App.tsx` imports only from `src/data/*`, never `firebase/*`.
- All CRUD + realtime flows verified against the target backend.
- Authorization rules reimplemented and tested (admin vs technician).
- `package.json` free of unused Google packages; docs updated.
