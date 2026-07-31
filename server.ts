// Load environment (.env.local → .env) BEFORE anything else is imported, so
// modules that read process.env at load time (auth token secret, etc.) see it.
import "./server/loadenv";

import express from "express";
import helmet from "helmet";
import fs from "fs";
import https from "https";
import path from "path";
import { createServer as createViteServer } from "vite";
import { mountApi } from "./server/index";

async function startServer() {
  const app = express();
  const PORT = 3000;

  const isProd = process.env.NODE_ENV === "production";

  // Behind a reverse proxy, set TRUST_PROXY (e.g. 1 = one hop) so req.ip is the real
  // client — otherwise rate-limiting would bucket every client under the proxy's IP.
  // Leave unset when the app is reached directly (trusting XFF then would be spoofable).
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
  }

  // Security headers + a tailored Content-Security-Policy. The app loads no external
  // origins (see index.html), so everything is 'self'. Dev additionally needs Vite's
  // inline/eval bootstrap and the HMR websocket; prod locks those down.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          // Prod serves a static bundle (no inline/eval). Dev needs Vite's injected
          // module preamble ('unsafe-inline') and React refresh ('unsafe-eval').
          "script-src": isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          // motion/react writes inline styles at runtime → 'unsafe-inline' for styles.
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:"],
          "font-src": ["'self'", "data:"],
          // Dev HMR uses a websocket back to Vite.
          "connect-src": isProd ? ["'self'"] : ["'self'", "ws:", "wss:"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          // Don't force http→https on plain-HTTP local/dev deployments.
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  // Cap request bodies — none of the API needs large payloads.
  app.use(express.json({ limit: "100kb" }));

  // WeOnline backend: stateful MikroTik RouterOS simulator + full billing engine.
  // Mounts /api/mikrotik/* and /api/billing/*, seeds first-run data, and starts
  // the ticking scheduler. The legacy /api/mikrotik/status endpoint is preserved
  // (now serving coherent, stateful telemetry instead of random numbers).
  await mountApi(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind to localhost by default so the (now authenticated) API is not exposed on
  // the network. To serve other devices, put this behind an authenticating reverse
  // proxy / VPN (see deploy/) and set HOST=0.0.0.0 explicitly.
  const HOST = process.env.HOST || "127.0.0.1";
  const shownHost = HOST === "0.0.0.0" ? "localhost" : HOST;

  // Optional native HTTPS: set TLS_KEY_FILE + TLS_CERT_FILE to serve TLS directly
  // (e.g. a self-signed cert for a LAN box). In most production setups TLS is instead
  // terminated by a reverse proxy (see deploy/) and this stays HTTP behind it.
  const keyFile = process.env.TLS_KEY_FILE;
  const certFile = process.env.TLS_CERT_FILE;
  if (keyFile && certFile) {
    const credentials = { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    https.createServer(credentials, app).listen(PORT, HOST, () => {
      console.log(`Server running on https://${shownHost}:${PORT}`);
    });
  } else {
    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${shownHost}:${PORT}`);
    });
  }
}

startServer();
