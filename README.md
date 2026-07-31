# WeOnline — ISP Portal & MikroTik Manager

A standalone Wireless ISP (WISP) management app: a public package storefront plus an
admin/technician portal for managing clients, routers, and billing.

**Fully local — no cloud required.** Auth and data run entirely in the browser on
IndexedDB (via the [`idb`](https://www.npmjs.com/package/idb) package). There is no
Firebase, Google Cloud, or any external service dependency.

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

No environment variables or backend setup are required. Admin accounts and data are
stored in your browser's IndexedDB (survive refresh; cleared when you clear site data).

See [`PROCESS.md`](PROCESS.md) for architecture and build details, [`TUTORIAL.md`](TUTORIAL.md)
for a feature walkthrough, and [`AUTHORIZATION.md`](AUTHORIZATION.md) for the access model.
