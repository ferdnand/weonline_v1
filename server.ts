import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { mountApi } from "./server/index";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
