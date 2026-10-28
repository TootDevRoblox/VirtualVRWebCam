import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: {
    host: "127.0.0.1",
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
