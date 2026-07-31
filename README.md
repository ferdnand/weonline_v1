# WeOnline — ISP Portal & MikroTik Manager

A standalone Wireless ISP (WISP) management app: a public package storefront plus an
admin/technician portal for managing clients, routers, and billing — now with a
**stateful MikroTik RouterOS simulator** and a **full-scale billing engine** running
in the Express server.

**Fully local — no cloud required.** The browser SPA uses IndexedDB (via
[`idb`](https://www.npmjs.com/package/idb)) for auth + legacy admin CRUD. The new
billing engine and RouterOS simulator run **server-side** in Express and persist to a
plain JSON file (`data/weonline.json`) — no database server, no Firebase, no external
service dependency.

### What the simulator + billing engine do

- **MikroTik RouterOS simulator** — each router keeps real state: PPPoE secrets,
  hotspot users (with data caps), live sessions that accrue traffic every few seconds,
  per-user simple queues (rate limits), and a system resource that reacts to load. The
  API mirrors RouterOS operations (`/ppp/secret`, `/ppp/active`, `/queue/simple`,
  `/system/resource`).
- **Billing engine** — plans, subscriber accounts, a subscription lifecycle
  (`pending → active → grace → suspended → expired`), recurring invoicing, payments
  (simulated **M-Pesa STK push** + cash/manual), and revenue reporting (revenue, MRR,
  outstanding, expiring-soon).
- **Auto provision/suspend** — paying an invoice **enables** the user on the router;
  non-payment or a hit data cap **disables** them. Billing is wired to network access.

A ticking scheduler advances the simulation and runs the billing cycle even while no
browser tab is open. First run seeds a believable world (2 routers, 5 plans, 6
subscribers across the lifecycle).

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```
   npm install
   ```
2. Start the app:
   ```
   npm run dev
   ```
3. Open http://localhost:3000

No environment variables or backend setup are required. Admin accounts live in your
browser's IndexedDB; billing + simulator state persists to `data/weonline.json`
(gitignored). Delete that file to reset to a fresh seeded world.

Sign in and open the **Admin Portal** → **Billing** and **MikroTik** tabs to explore
the new features.

See [`PROCESS.md`](PROCESS.md) for architecture and build details, [`TUTORIAL.md`](TUTORIAL.md)
for a feature walkthrough, and [`AUTHORIZATION.md`](AUTHORIZATION.md) for the access model.
