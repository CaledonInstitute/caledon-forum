// @ts-check
import { defineConfig } from "astro/config";
import { execFileSync } from "node:child_process";

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

let lastUpdated = null;
try {
  const timestamp = execFileSync("git", ["log", "-1", "--format=%cI"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  lastUpdated = new Date(timestamp).toISOString();
} catch {
  console.warn("[last-updated] Git metadata unavailable; the site update date will be hidden.");
}

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  session: false,
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    assetsInclude: ["**/*.wasm", "**/*.ttf"],
    define: { __SITE_LAST_UPDATED__: JSON.stringify(lastUpdated) },
  },
});
