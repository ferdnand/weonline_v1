// Load environment (.env.local → .env) BEFORE anything else is imported, so
// modules that read process.env at load time (auth token secret, etc.) see it.
import "./server/loadenv";

import express from "express";
import helmet from "helmet";
import path from "path";
import { createServer as createViteServer } from "vite";
import { mountApi } from "./server/index";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Security headers. CSP is disabled here because the SPA (Vite dev + inline
  // styles) needs a tailored policy; add a proper CSP before production.
  app.use(helmet({ contentSecurityPolicy: false }));
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
  // proxy / VPN and set HOST=0.0.0.0 explicitly.
  const HOST = process.env.HOST || "127.0.0.1";
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  });
}

startServer();
