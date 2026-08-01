# Deploying WeOnline

WeOnline is a **stateful, always-on Node server** (a background billing scheduler
ticks every few seconds; all state persists to a local JSON file; live routers are
polled over the network). It must run on a **persistent host** — a container/VM that
stays up — **not** on a serverless platform like Vercel, where the filesystem is
ephemeral and there is no always-on process.

Three supported shapes:

- **Option A — Reverse proxy** on your own box/VPS (below).
- **Option B — Native HTTPS**, no proxy (below).
- **Option C — Managed persistent host** (Railway / Render) — see the end of this file.

The app server (`npm start`) speaks plain HTTP and, by default, binds to
`127.0.0.1`. **Do not expose it directly** — put TLS in front of it (Options A/B).
Managed hosts (Option C) terminate TLS for you.

## Option A — Reverse proxy (recommended)

Terminate TLS at a proxy on the same host and forward to the app on localhost. The
app never touches the network directly.

1. Set production env in `.env.local` (or the process environment):
   ```
   NODE_ENV=production
   AUTH_SECRET=<64 hex chars>
   DATA_ENCRYPTION_KEY=<64 hex chars>
   TRUST_PROXY=1
   # HOST stays 127.0.0.1 (default) — the proxy reaches it on localhost
   ```
   Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Build + run the app: `npm run build && npm start` (listens on `127.0.0.1:3000`).
3. Run a proxy using one of the samples here:
   - **Caddy** (automatic Let's Encrypt): `caddy run --config ./deploy/Caddyfile`
   - **nginx**: adapt `./deploy/nginx.conf`, provide certs (certbot), reload nginx.

`TRUST_PROXY=1` is important: it lets the app read the real client IP from the
proxy's `X-Forwarded-For`, so login rate-limiting buckets per client rather than
lumping everyone under the proxy's address. Only set it when actually behind a proxy
(trusting `X-Forwarded-For` on a directly-exposed server is spoofable).

If the proxy runs on a **different** host, set `HOST=0.0.0.0` and firewall port 3000
so only the proxy can reach it.

## Option B — Native HTTPS (no proxy)

For a simple single-box / LAN deployment, the app can serve TLS itself:

```
TLS_KEY_FILE=/path/to/privkey.pem
TLS_CERT_FILE=/path/to/fullchain.pem
HOST=0.0.0.0
NODE_ENV=production
AUTH_SECRET=<64 hex chars>
DATA_ENCRYPTION_KEY=<64 hex chars>
```

Then `npm run build && npm start` serves `https://<host>:3000`. Use a real cert where
possible; a self-signed cert works on a LAN but browsers will warn.

## Option C — Managed persistent host (Railway / Render)

A container platform that keeps the process alive. TLS, HTTPS, and `PORT` are
provided by the platform; you only add env vars and a persistent volume.

1. **Build/run commands** (already correct in `package.json`):
   - Build: `npm run build`
   - Start: `npm start`  (serves the SPA + API on `PORT`)
2. **Environment** (set in the platform dashboard):
   ```
   NODE_ENV=production
   HOST=0.0.0.0
   TRUST_PROXY=1
   AUTH_SECRET=<64 hex chars>          # generate fresh; see below
   DATA_ENCRYPTION_KEY=<64 hex chars>
   DATA_DIR=/data                       # must match the mounted volume path
   # Optional log shipping:
   # BETTERSTACK_SOURCE_TOKEN=...   BETTERSTACK_INGESTING_HOST=...
   ```
3. **Persistent volume (mandatory).** Mount a volume at the `DATA_DIR` path (e.g.
   `/data`). Without it, `weonline.json` — every subscriber, invoice, payment, and
   the audit log — is **wiped on each redeploy**.
4. **Health check.** Point the platform's healthcheck at `GET /api/health`.
5. **Logs.** Structured JSON is written to stdout and captured by the platform's log
   viewer / drains. Set `BETTERSTACK_SOURCE_TOKEN` to also ship to Better Stack.

### Reaching live routers from the cloud (Tailscale)

A cloud host cannot reach a router on your private LAN (`192.168.x.x`) directly, and
the SSRF guard only permits **RFC1918** addresses (Tailscale's own `100.64.0.0/10`
range is rejected). Use Tailscale **subnet routing** so the host reaches routers at
their real LAN IPs:

1. Install Tailscale on a device **on the router's LAN** and advertise the subnet:
   `tailscale up --advertise-routes=192.168.88.0/24` (approve the route in the admin
   console).
2. Run Tailscale in the app container (userspace mode) and join the same tailnet.
3. Add the router in the app with its real LAN IP (e.g. `192.168.88.1`) — it passes
   the SSRF guard unchanged; keep `ROUTER_ALLOW_ANY_HOST` **unset**.
4. Put each router's REST password in `ROUTER_<ID>_PASSWORD` rather than the store.

> If in-container Tailscale is fiddly on your platform, a small **VPS** (Option A)
> that runs Tailscale + a mounted disk + the reverse proxy above is the most robust
> setup for live routers.

## Production checklist

- [ ] `AUTH_SECRET` set (stable) — otherwise sessions reset on every restart.
      **Rotate it for production** — a dev value has been committed in `.env.local`
      before; never reuse it publicly.
- [ ] `DATA_ENCRYPTION_KEY` set — otherwise it's derived from `AUTH_SECRET` (rotating
      the secret would then also change the data key).
- [ ] **Persistent storage** for `DATA_DIR` (managed volume, or a real disk on a VPS).
- [ ] TLS in front (proxy, native, or the managed platform). Never expose plain HTTP.
- [ ] `TRUST_PROXY` set **iff** behind a proxy / managed platform.
- [ ] `PORT` honored (managed hosts inject it; the app reads it automatically).
- [ ] Logs captured (platform stdout drain) and, optionally, `BETTERSTACK_SOURCE_TOKEN`.
- [ ] First sign-up done (becomes admin); create staff via the Admin → Staff tab.
- [ ] Live routers use private LAN IPs (SSRF guard) unless `ROUTER_ALLOW_ANY_HOST=1`.
