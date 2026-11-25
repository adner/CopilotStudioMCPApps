import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import react from "@vitejs/plugin-react";

const isDevelopment = process.env.NODE_ENV === "development";

// Bundles one HTML entry (INPUT, default probe.html) + its TS/CSS into one
// self-contained file in dist/, which the server returns from resources/read.
// vite-plugin-singlefile needs one entry per build, so `npm run build` runs it per app.
const input = process.env.INPUT ?? "probe.html";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    minify: !isDevelopment,
    // Keep license comments (/*! … */, @license) so the served HTML carries the notices.
    rollupOptions: { input, output: { comments: { legal: true } } },
    outDir: "dist",
    emptyOutDir: false,
  },
});
