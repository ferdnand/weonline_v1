import { defineConfig } from 'vitest/config';

// Server-side unit/integration tests. Kept separate from vite.config.ts (the SPA
// build) so test settings never affect the production bundle.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
    // Each test file gets an isolated module registry, so per-file env vars (e.g.
    // AUTH_SECRET) and cached secrets don't leak between files.
    isolate: true,
  },
});
