import { defineConfig } from "vitest/config";

const apiPort = process.env.STUDIO_API_PORT ?? "8000";

// In development Vite serves the frontend and forwards `/api` to the backend,
// so the browser sees one origin, exactly as in production.
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
