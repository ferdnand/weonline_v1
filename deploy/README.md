# Deploying WeOnline

The app server (`npm start`) speaks plain HTTP and, by default, binds to
`127.0.0.1`. **Do not expose it directly** — put TLS in front of it. Two supported
shapes:

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

## Production checklist

- [ ] `AUTH_SECRET` set (stable) — otherwise sessions reset on every restart.
- [ ] `DATA_ENCRYPTION_KEY` set — otherwise it's derived from `AUTH_SECRET` (rotating
      the secret would then also change the data key).
- [ ] TLS in front (proxy or native). Never expose plain HTTP to the network.
- [ ] `TRUST_PROXY` set **iff** behind a proxy.
- [ ] First sign-up done (becomes admin); create staff via the Admin → Staff tab.
- [ ] Live routers use private LAN IPs (SSRF guard) unless `ROUTER_ALLOW_ANY_HOST=1`.
