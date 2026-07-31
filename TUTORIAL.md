# TUTORIAL.md — Getting Started with WeOnline

Welcome! This walkthrough gets a new contributor from zero to a running WeOnline app,
then tours the core features from both the **customer** and **admin** perspectives.

WeOnline is a Wireless ISP (WISP) management app: customers buy internet packages, and
staff manage clients, routers, and billing. Note that several features (M-Pesa
payments, router telemetry) are **simulated** — see the callouts below.

---

## Part 1 — Get it running

### 1. Install dependencies

The repo has both a `bun.lock` and a `package-lock.json`. Use one consistently:

```bash
# with npm
npm install

# or with bun
bun install
```

### 2. No backend setup needed 🎉

WeOnline uses a **local IndexedDB backend** — all data (accounts, clients, routers,
transactions) is stored in your browser. **No cloud accounts, config, API keys, or
network are required.** No environment variables either (`.env.example` is just a
placeholder). Skip straight to step 3.

### 3. Start the dev server

```bash
npm run dev
```

Open **http://localhost:3000**. You should see the orange **WEONLINE** storefront.

---

## Part 2 — The customer experience

No login is required to browse and "buy" packages.

### Browse packages
- The landing page (**Internet Plans**) shows two tabs:
  - **Connect** — short-term hotspot passes (90 min to 7 days).
  - **Monthly** — 30-day home plans.
- Use the **search bar** to filter by name, speed, price, or duration
  (e.g. type `10Mbps` or `Weekly`).

### Buy a package (simulated M-Pesa)
1. Click **Buy Now** on any card.
2. Enter a Safaricom-style phone number (9 digits, e.g. `712345678`).
3. Click **Pay Now**. You'll see:
   - "Waiting for M-Pesa..." (simulated STK push)
   - "Connecting to WeOnline..." (simulated Wi-Fi handshake)
   - A **Success** screen with your session duration.

> 🟡 **Simulated:** No real payment happens. The flow uses timers, and a random MAC
> address + transaction ID are generated. A `hotspot_sale` record *is* written to the
> local `transactions` store.

### View subscriptions & receipts
- **Subscriptions** — shows active/expired packages with live "time remaining".
- **Payment History** — lists past payments; click **View Receipt** for a printable
  receipt (uses the browser's print dialog).

> 🟡 Customer subscriptions and payment receipts live in browser memory only and
> **reset on page refresh.**

---

## Part 3 — The admin / technician portal

### Sign in
1. Click **Admin Login** (top right).
2. Use **email + password** — click *Need an account? Sign up* to create one. Accounts
   are stored locally in your browser (salted-SHA-256 hashed).
   - The email **`mongeta5@gmail.com`** is bootstrapped as `admin`. Any other account
     becomes a `technician`. (Change this hardcoded email in `src/App.tsx` before real
     use.)
3. An **Admin Portal** tab appears in the nav once you're signed in.

> 💾 Your accounts and admin data live in the browser's IndexedDB. They survive
> refreshes but are wiped if you clear site data or use a different browser/profile.

### Dashboard
A quick overview with four stat cards:
- **Daily Income** — sum of today's transactions.
- **Hotspot Users** — currently online hotspot clients.
- **Router CPU / Temp** — averaged across "online" MikroTik routers.

Plus **Recent Transactions** and **Router Status** panels.

### Manage clients
Under the **Clients** tab:
- **Add Client** — name, phone, type (PPPoE/Hotspot), plan, price, router, and PPPoE
  credentials. New clients default to a 30-day expiry.
- Per-row actions:
  - 🔄 **Recharge** — extends expiry by 30 days and logs a `recharge` transaction.
  - ⏻ **Disconnect** — marks the client expired/offline.
  - ✏️ **Edit** — update client details.
  - 🗑️ **Delete** — *admins only*.

### Manage routers
Under the **Routers** tab:
- **Add Router** — name, model, IP, API port, credentials, location, and a
  "MikroTik RouterOS Simulation" toggle.
- Online MikroTik routers display **live-updating** CPU, memory, temp, and user
  counts.

> 🟡 **Simulated:** Router telemetry is random data from `/api/mikrotik/status`
> ([server.ts](server.ts)), polled every 10 seconds. There is no real RouterOS
> connection.

### Transactions
The **Transactions** tab lists all billing/recharge history (hotspot sales,
recharges) newest-first.

---

## Part 4 — Common contributor workflows

### Add or edit a package
Package definitions are a plain object near the top of
[`src/App.tsx`](src/App.tsx) (`const packages = { connect: [...], monthly: [...] }`).
Add an entry with `id`, `name`, `speed`, `price`, `duration`, `features`, and optional
`popular: true`.

### Change the brand color
The theme is orange via Tailwind classes (`orange-500`, `orange-600`). Search/replace
within `App.tsx` to re-theme, or centralize into Tailwind config if this grows.

### Type-check before committing
```bash
npm run lint   # tsc --noEmit
```

---

## Part 5 — Troubleshooting

- **I want a clean slate.**
  Clear the site's IndexedDB (`weonline` database) and `localStorage` via your browser
  DevTools → Application tab. All accounts and admin data reset.

- **I forgot my admin password.**
  There is no reset flow (local app). Clear the `weonline` IndexedDB / `localStorage`
  as above and sign up again.

- **Admin tab doesn't appear.**
  It only shows after a successful sign-in (`userProfile` is set).

- **My data disappeared.**
  IndexedDB is per-browser-profile and per-origin. A different browser, profile, or
  incognito window has its own empty database, and clearing site data wipes it.

---

## Where to go next

- Read [`PROCESS.md`](PROCESS.md) for the full architecture, build pipeline, and the
  list of known tech debt, and [`AUTHORIZATION.md`](AUTHORIZATION.md) for the access model.
- Real production use would require a shared backend with **server-side authorization**
  (see `AUTHORIZATION.md`), plus wiring up the **M-Pesa Daraja API**, a genuine
  **MikroTik RouterOS API** integration, and persisting customer subscriptions.

Update this tutorial whenever features are added or the user-facing flow changes.
