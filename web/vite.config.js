import { defineConfig } from "vite";

export default defineConfig({
  define: { global: "globalThis" },
  resolve: { alias: { buffer: "buffer/" } },
  build: {
    rollupOptions: { input: { main: "index.html", app: "app.html", developers: "developers.html", hunt: "hunt.html" } },
    chunkSizeWarningLimit: 1500,
  },
});
