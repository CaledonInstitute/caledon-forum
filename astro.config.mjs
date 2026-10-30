// @ts-check
import { defineConfig } from "astro/config";
import { execFileSync } from "node:child_process";

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

let lastUpdated = null;
let commitHash = null;
try {
  const [timestamp, hash] = execFileSync("git", ["log", "-1", "--format=%cI%n%H"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .trim()
    .split(/\r?\n/);
  if (!/^[a-f0-9]{40}$/.test(hash)) throw new Error("Invalid commit hash");
  lastUpdated = new Date(timestamp).toISOString();
  commitHash = hash;
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
    define: { __SITE_LAST_UPDATED__: JSON.stringify(lastUpdated), __SITE_COMMIT_HASH__: JSON.stringify(commitHash) },
  },
});
