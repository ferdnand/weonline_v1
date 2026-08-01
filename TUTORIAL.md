# TUTORIAL.md — Getting Started with WeOnline

Welcome! This walkthrough gets a new contributor from zero to a running WeOnline app,
then tours the core features from both the **customer** and **admin** perspectives.

WeOnline is a Wireless ISP (WISP) management app: customers buy internet packages, and
staff manage clients, routers, and billing. The admin portal now includes a **full
billing engine** and a **stateful MikroTik RouterOS simulator** running in the Express
server (see Part 3). M-Pesa payments are still **simulated** — see the callouts below.

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
2. Use **email + password**. Accounts now live on the **server** (PBKDF2-hashed), and
   the API requires a signed session token — the app handles this for you on login.
   - **First run:** there are no accounts yet, so the form shows *Create Admin Account*.
     The **first** person to sign up becomes the `admin`. (Password must be ≥ 8 chars.)
   - After that first account, **self-registration is closed** (the *Sign up* toggle
     disappears). An admin adds further staff from the **Staff** tab (see below).
3. An **Admin Portal** tab appears in the nav once you're signed in.

> 🔐 Sessions last 12h and are signed with `AUTH_SECRET`. If that isn't set, an
> ephemeral secret is used and everyone is logged out on server restart — set it in
> `.env.local` for a stable setup (see `.env.example`).

### Dashboard
A quick overview with four stat cards:
- **Daily Income** — sum of today's transactions.
- **Hotspot Users** — currently online hotspot clients.
- **Router CPU / Temp** — averaged across "online" MikroTik routers.

Plus **Recent Transactions** and **Router Status** panels.

### Manage staff (admins only)
The **Staff** tab appears only for admins. From here you can:
- **Add staff** — create an account with a role (`technician` or `admin`).
- **Make admin / technician** — toggle a colleague's role.
- **Reset password** (🔑) — set a new password for someone who's locked out.
- **Delete** (🗑) — remove an account.

The server blocks you from deleting your own account or removing the **last admin**, so
you can't accidentally lock everyone out.

### Audit log (admins only) 🔎
The **Audit** tab is a durable, searchable record of everything that happens in the
system — "who did what, when". Every entry has a timestamp, the actor (staff email, or
`system` for automated billing), the action, the affected target, the outcome, and the
client IP. You'll see:
- **Account events** — logins (including *failed* attempts, flagged in red), sign-ups,
  and staff account/role/password changes.
- **Billing events** — plan/subscriber/subscription changes, and payments (both
  staff-recorded and automatic M-Pesa settlement).
- **Router events** — adding/removing routers, provisioning, and disconnects.
- **Automated events** — renewals, grace, suspensions, and data-cap expiries, recorded
  by the billing engine as `system`.

Filter by **actor** (email substring), **action** prefix (e.g. `billing.payment`), or
**outcome** (success/failure), and use **Load more** to page back through history. The
same events are also written to the server logs (and shipped to your log platform if
one is configured), so nothing depends on the browser being open.

### Manage clients
Under the **Clients** tab:
- **Add Client** — name, phone, type (PPPoE/Hotspot), plan, price, router, and PPPoE
  credentials. New clients default to a 30-day expiry.
- Per-row actions:
  - 🔄 **Recharge** — extends expiry by 30 days and logs a `recharge` transaction.
  - ⏻ **Disconnect** — marks the client expired/offline.
  - ✏️ **Edit** — update client details.
  - 🗑️ **Delete** — *admins only*.

### Billing (server-backed) 💳
The **Billing** tab is the full-scale billing system, backed by the Express engine
(persists to `data/weonline.json`). Four sub-sections:

- **Overview** — revenue this month, MRR, outstanding, active subscriptions, a
  subscription-lifecycle breakdown, GB used, and an "expiring within 3 days" list.
- **Plans** — create/edit/delete bandwidth products: service type (PPPoE/hotspot),
  speed, up/down rate limits, price, billing cycle (days), and a data cap.
- **Subscribers** — create customer accounts, then **Enroll** them on a plan (issues
  the first invoice). Per-row: **Activate**, **Suspend**, **Cancel**.
- **Invoices** — pay an unpaid/overdue invoice via **M-Pesa** (simulated STK push) or
  **Cash** (settles instantly). A "Recent Payments" panel shows receipts and failures.

**Try the money → network loop:** enroll a subscriber → the invoice is `unpaid` and the
user is provisioned but **disabled** on the router → pay the invoice → within a moment
the subscription flips to `active` and the user is **enabled** (watch it appear in the
MikroTik console). Miss the cycle and it moves `grace → suspended`, disabling the user.

> 🟡 **Simulated M-Pesa:** the STK push is faked server-side — ~92% succeed after a few
> seconds, the rest fail like a real cancel/timeout. No real Daraja API. (The public
> storefront checkout is a separate, older `setTimeout` fake, not wired to this engine.)

### MikroTik console (server-backed) 📡
The **MikroTik** tab is a live window into each router — a **simulator** or a **real
RouterOS device**:

- Pick a router; see its **system resource** (CPU, memory, temp, voltage, uptime,
  session count) updating every ~3 seconds. A `sim`/`live` badge shows the driver.
- Tabs for **Active** sessions (with per-session throughput and accruing totals), **PPP
  Secrets**, **Hotspot Users** (with data-cap usage bars), and **Simple Queues**.
- Controls: **Add Router**, **Edit**, **Delete**, **Test** (live only), **Power** off/on,
  **disconnect** a live session, **enable/disable** a user. These hit the same driver the
  billing engine provisions against.

> 🟢 The seeded routers are a genuinely **stateful simulator** (`server/mikrotik/`) — not
> random numbers. Traffic, sessions, and data caps evolve on a server-side scheduler even
> with no browser tab open. Routers you add as **live** talk to a real device (next
> section).

---

## Part 3b — Connect a real MikroTik L009 (RouterOS 7)

WeOnline can drive a **real** MikroTik over the RouterOS **REST API**, alongside the
simulated demo routers. Paying an invoice then enables a real PPPoE/hotspot user;
non-payment/cancel disables/removes them.

> ⚠️ A `live` router means billing acts on **real hardware** — it can cut real customers
> online/offline. Start with the **Test** button and one test user (see below).

### 1. Prepare the L009 (one-time, on the device)
Connect the PC to a **LAN** port (you'll get `192.168.88.x`; the router is `192.168.88.1`).
Then, in Winbox/WebFig terminal:

```
# Enable the REST API (served by the www-ssl service)
/ip service enable www-ssl              ;# HTTPS on 443  (or: enable www for plain HTTP/80)

# Create a dedicated API user (don't reuse admin)
/user group add name=weonline policy=read,write,api,rest-api,test,winbox,web
/user add name=weonline group=weonline password=<strong-password>

# For PPPoE plans: an IP pool + PPPoE server must exist for users to actually connect
/ip pool add name=pppoe-pool ranges=10.10.0.2-10.10.0.254
/ppp profile add name=default-encryption local-address=10.10.0.1 remote-address=pppoe-pool
/interface pppoe-server server add service-name=weonline interface=bridge disabled=no
```

Verify REST + credentials from the PC:
```bash
curl -k -u weonline:<password> https://192.168.88.1/rest/system/resource
```

### 2. Add it in the app
Admin → **MikroTik** → **Add Router**:
- **Driver:** *Live — real RouterOS device (REST)*
- **IP address:** a **private LAN IPv4** — `10.x`, `172.16–31.x`, or `192.168.x` (e.g.
  `192.168.88.1`). Public/other addresses are rejected as an SSRF safeguard (override with
  `ROUTER_ALLOW_ANY_HOST=1` only if you truly need a routable router).
- **REST port:** `443` (HTTPS) or `80` (HTTP)
- **Username / Password:** the `weonline` API user
- **Use HTTPS** — leave **Accept self-signed certificate** *unchecked* to verify the cert.
  The L009's cert is self-signed on a LAN, so you'll usually need to **check** this box;
  it's off by default so accepting an unverified cert is a conscious choice.

Click **Save**, then **Test** — you should see the real model, RouterOS version, and uptime.
The console tabs now show the router's **real** sessions, secrets, and queues.

> 🔐 The API password is **encrypted at rest** in `data/weonline.json` (AES-256-GCM). To
> keep it out of that file entirely, set `ROUTER_<ID>_PASSWORD` in `.env.local` (see
> `.env.example`) — the env value then overrides the stored one.

### 3. Provision a real user
Billing → **Subscribers** → create a subscriber **on the L009 router** → **Enroll** on a
plan → pay the invoice (M-Pesa or Cash). Within a moment a real `/ppp/secret` appears
**enabled** on the device (check Winbox). **Suspend** disables it and kicks the session;
**Cancel** removes it.

> If a write fails (device unreachable, bad creds), the console shows a **Live device
> error** banner and the router's `lastError`; nothing is silently dropped.

### Transactions
The **Transactions** tab lists the legacy IndexedDB billing/recharge history (hotspot
sales, recharges) newest-first. (Distinct from the server-backed **Billing** invoices.)

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
  Accounts, billing, and the simulator world all live server-side in
  `data/weonline.json` — stop the server and delete it to reset everything (it re-seeds,
  and the next sign-up becomes the new admin). The browser's IndexedDB / `localStorage`
  now only hold the legacy admin CRUD + your session token; clear them via DevTools →
  Application if you also want those gone.

- **The Billing / MikroTik tabs show an error or "Loading…".**
  They need the Express server (`npm run dev`) running — they call `/api/*`. If you only
  opened a static build without the server, those routes won't exist.

- **I forgot my admin password.**
  There is no self-service reset yet. Another admin can create you a new account via
  `POST /api/auth/users`. If no admin is reachable, stop the server, remove your entry
  from the `users` array in `data/weonline.json` (or empty the array to re-bootstrap),
  then restart and sign up again — the first sign-up becomes admin.

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
