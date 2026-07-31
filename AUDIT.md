# Firebase / Google Services Dependency Audit — WeOnline

**Scope:** entire `weonline_v1` project. **Date:** 2026-07-31. **Status:** read-only audit, no code modified.

## Executive summary

| Service | Used? | Hard/Optional | Where |
|---|---|---|---|
| **Firebase Auth** (Email/Password + Google popup) | ✅ Yes | **Hard** (core) | `src/App.tsx`, `src/firebase.ts` |
| **Cloud Firestore** | ✅ Yes | **Hard** (core) | `src/App.tsx`, `src/firebase.ts` |
| **Firebase Storage** | ⚠️ Configured, never called | Dead config | `firebase-applet-config.json` |
| **Firebase Analytics** | ❌ No (`measurementId` empty) | None | config only |
| **Cloud Functions** | ❌ No (only transitive in lockfile) | None | — |
| **Firebase Hosting** | ❌ No (`firebase.json`/`.firebaserc` absent) | None | — |
| **Google Gemini / `@google/genai`** | ⚠️ Installed + declared, never imported in code | Optional/aspirational | `package.json`, `vite.config.ts`, `metadata.json` |
| **`@google-cloud/*` packages** | ❌ None installed | None | — |
| **gstatic.com** (Google logo asset) | ✅ Yes | Optional (cosmetic) | `src/App.tsx:703` |

No `firebase.json`, no `.firebaserc`, no service-account JSON, no `@google-cloud/*` dependency anywhere.

---

## 1. Code dependencies — file, line, purpose, hard/optional

### `src/firebase.ts` — Firebase initialization (HARD)
| Line | Symbol | Purpose | Hard/Optional |
|---|---|---|---|
| 1 | `initializeApp` from `firebase/app` | Boot the Firebase SDK from `firebase-applet-config.json` | **Hard** |
| 2 | `getAuth` from `firebase/auth` | Exported `auth` instance | **Hard** |
| 3 | `getFirestore, doc, getDocFromServer` from `firebase/firestore` | Exported `db` instance | **Hard** |
| 4 | `import firebaseConfig from '../firebase-applet-config.json'` | Config source | **Hard** |
| 8 | `getFirestore(app, firebaseConfig.firestoreDatabaseId)` | ⚠️ Uses a **named (non-default) Firestore database**, not `(default)` | **Hard** |
| 11–19 | `getDocFromServer(doc(db, 'test', 'connection'))` | Startup connectivity probe; reads `test/connection` doc | Optional (diagnostic only) |

### `src/App.tsx` — Auth (HARD, core gate for admin portal)
| Line | Symbol | Purpose | Hard/Optional |
|---|---|---|---|
| 41, 398 | `signInWithPopup` | Google login popup | Optional path* |
| 42, 397 | `GoogleAuthProvider` | Google identity provider | Optional path* |
| 43, 417 | `signInWithEmailAndPassword` | Email login | **Hard** (primary path) |
| 44, 415 | `createUserWithEmailAndPassword` | Email signup | **Hard** |
| 45, 309 | `onAuthStateChanged` | Session listener; drives `user`/`userProfile`; bootstraps admin | **Hard** |
| 46, 434 | `signOut` | Logout | **Hard** |
| 47, 262 | `User as FirebaseUser` | Type for auth state | **Hard** |

*Google popup is optional because Email/Password is a complete alternative — but both are Firebase Auth, so removing Firebase removes both.

### `src/App.tsx` — Firestore (HARD)
| Line | Symbol(s) | Purpose |
|---|---|---|
| 49–64 | `collection, doc, setDoc, getDoc, onSnapshot, query, orderBy, addDoc, updateDoc, deleteDoc` | Full CRUD + realtime |
| 65 | `import { auth, db } from './firebase'` | Uses shared instances |
| 78–81 | `handleFirestoreError` | Central Firestore error wrapper |
| 312 | `getDoc(doc(db,'users',uid))` | Read user profile on login |
| 324 | `setDoc(doc(db,'users',uid), profile)` | Bootstrap new user profile |
| 340 | `onSnapshot(collection(db,'clients'))` | Realtime clients list |
| 344 | `onSnapshot(collection(db,'routers'))` | Realtime routers list |
| 348 | `onSnapshot(query(collection(db,'transactions'), orderBy('date','desc')))` | Realtime transactions |
| 371 | `updateDoc(doc(db,'routers',id), {...telemetry})` | Write simulated router stats every 10s |
| 519 | `addDoc(collection(db,'transactions'), {...})` | Log a `hotspot_sale` |
| 565/567 | `updateDoc` / `addDoc` `clients` | Save/edit client |
| 579 | `updateDoc(doc(db,'clients',id))` | Recharge (extend expiry) |
| 583 | `addDoc(collection(db,'transactions'))` | Log a `recharge` |
| 598 | `updateDoc(doc(db,'clients',id))` | Disconnect client |
| 610 | `deleteDoc(doc(db,'clients',id))` | Delete client |
| 637/639 | `updateDoc` / `addDoc` `routers` | Save/edit router |
| 1684 | `deleteDoc(doc(db,'routers',id))` | Delete router (inline) |

> **Dead imports** (imported, never used): `getDocs`, `where`, `Timestamp`, `serverTimestamp` (firestore); `addWeeks`, `isAfter`, `parseISO` (date-fns). Not a dependency risk — just cleanup.

### External Google asset (OPTIONAL)
| Line | What | Hard/Optional |
|---|---|---|
| `src/App.tsx:703` | `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg">` — Google logo on login button | Optional (cosmetic; swap for a local asset) |

### Gemini / AI Studio (OPTIONAL — declared, not wired)
| Location | What | Hard/Optional |
|---|---|---|
| `vite.config.ts:11` | `define: { 'process.env.GEMINI_API_KEY': ... }` | Optional (no runtime reader in code) |
| `.env.example:4` | `GEMINI_API_KEY` | Optional |
| `metadata.json:6` | `"MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"` (AI Studio applet flag) | Optional |
| `package.json:14` | `@google/genai` dependency | Optional — **installed but never imported** |

### Server (`server.ts`)
**No Firebase/Google dependency.** Pure Express + Vite. The `/api/mikrotik/status` route returns `Math.random()` data — no Google service involved.

---

## 2. Firestore data shapes (collection → fields → types)

### `users/{uid}` — read (312) + write (324)
```ts
{ uid: string, email: string, role: 'admin' | 'technician', name: string }
```
Rules require **exactly** these 4 fields (`firestore.rules:38`).

### `clients/{autoId}` — realtime read (340), create/update (565–598), delete (610)
Written shape (`App.tsx:548–561`):
```ts
{
  name: string, type: 'hotspot' | 'pppoe', planName: string, price: number,
  phoneNumber: string, status: 'active' | 'expired', online: boolean,
  startDate: string /*ISO*/, expiryDate: string /*ISO*/,
  pppoeUsername: string, pppoePassword: string, routerId: string
  // macAddress?: string  (in TS type, not always written)
}
```

### `routers/{autoId}` — realtime read (344), create/update (637), telemetry update (371), delete (1684)
Full written shape (`App.tsx:619–632`):
```ts
{
  name: string, location: string, ipAddress: string, username: string,
  apiPort: number, isMikrotik: boolean, model: string,
  status: 'online' | 'offline', cpu: number, memory: number,
  uptime: string, temperature: number, clientsCount: number
}
```
Telemetry patch (`App.tsx:371`): `{ cpu, memory, temperature, uptime, clientsCount, model }`.
> ⚠️ **Rule mismatch:** `isValidRouter` (`firestore.rules:53`) allows only `name, location, ipAddress, status` → these writes would be **rejected** under the deployed rules.

### `transactions/{autoId}` — realtime read (348), create (519, 583)
```ts
{ clientId: string, clientName: string, amount: number,
  date: string /*ISO*/, planName: string, type: string /* 'hotspot_sale' | 'recharge' */ }
```

### `test/connection` — read only (`firebase.ts:13`)
Connectivity probe; no schema/writes.

---

## 3. Firebase config files

| File | Type | Consumed by | Notes |
|---|---|---|---|
| `firebase-applet-config.json` | **firebaseConfig object** | `src/firebase.ts:4` (`import`) | **HARD.** Contains live `apiKey`, `projectId` (`gen-lang-client-0957396270`), `appId`, `authDomain`, `firestoreDatabaseId` (`ai-studio-...`), `storageBucket`, `messagingSenderId`, empty `measurementId`. ⚠️ Real API key committed to repo. |
| `firestore.rules` | Firestore security rules | Firebase project (deploy) | Role-based (`admin`/`technician`); hardcoded admin `mongeta5@gmail.com`; router validator is out of sync with app writes. |
| `firebase-blueprint.json` | Entity/schema blueprint (AI Studio) | Not imported by code | Documentation/schema for `User/Client/Router/Transaction`. |
| `metadata.json` | AI Studio applet manifest | Not imported by code | Declares `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`. Not a duplicate of the blueprint — different content. |
| `firebase.json` | Hosting/deploy config | — | **Absent** |
| `.firebaserc` | Project alias | — | **Absent** |
| service-account JSON | Admin SDK creds | — | **Absent** (no server-side Admin SDK usage) |

---

## 4. npm packages

**Direct dependencies (`package.json`):**
- `firebase` `^12.11.0` — **HARD** (Auth + Firestore). Meta-package.
- `@google/genai` `^1.29.0` — **installed but unused** in code (optional/aspirational).

**`@google-cloud/*`:** none.

**Transitive `@firebase/*` subpackages** (pulled in by the `firebase` meta-package; present in `package-lock.json`, **not** directly imported): `@firebase/app`, `auth`, `firestore` (the three actually used) plus `ai, analytics, analytics-compat, app-check, app-compat, component, data-connect, database, functions, installations, logger, messaging, performance, remote-config, storage, util, webchannel-wrapper`, and their `-compat`/`-types` variants (44 entries total). Only `app`, `auth`, `firestore` are reachable from source; the rest are dead weight from importing the meta-package rather than modular subpackages.

---

## Key takeaways for a future migration/decoupling

1. **Two hard dependencies only:** Firebase **Auth** and **Firestore**. Everything else Google-related is either config-only (Storage bucket), empty (Analytics), transitive (unused `@firebase/*`), or aspirational (`@google/genai`/Gemini).
2. **Single abstraction seam already exists:** `src/firebase.ts` exports `auth` + `db`. Firestore/Auth calls are otherwise scattered directly through `App.tsx` (~20 call sites), so a swap would touch that one large file.
3. **Server is Firebase-free** — no Admin SDK, so no service-account secret to migrate.
4. **Committed secret:** a live Firebase `apiKey` sits in `firebase-applet-config.json` (low-severity for Firebase web keys, but worth noting).

See [`MIGRATION.md`](MIGRATION.md) for the decoupling/migration plan derived from this audit.
