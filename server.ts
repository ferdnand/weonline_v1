import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // MikroTik Simulation API
  app.get("/api/mikrotik/status", (req, res) => {
    const { ip } = req.query;
    
    // Simulate data for L009
    const cpu = Math.floor(Math.random() * 15) + 5; // 5-20%
    const memory = Math.floor(Math.random() * 20) + 40; // 40-60%
    const temperature = Math.floor(Math.random() * 10) + 38; // 38-48°C
    const uptime = `${Math.floor(Math.random() * 5)}d ${Math.floor(Math.random() * 24)}h ${Math.floor(Math.random() * 60)}m`;
    const clientsCount = Math.floor(Math.random() * 50) + 10;

    res.json({
      status: "online",
      cpu,
      memory,
      temperature,
      uptime,
      clientsCount,
      model: "MikroTik L009UiGS-RM",
      ip: ip || "192.168.88.1"
    });
  });

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
