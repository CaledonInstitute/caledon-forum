import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.length === 1 && args[0] === "--dry-run";
if (args.length && !dryRun) {
  console.error("Use npm run deploy for production or npm run deploy -- --dry-run to check the build.");
  process.exit(1);
}

const config = ["--config", "dist/server/wrangler.json"];

function runWrangler(command, stdin = "inherit") {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...command, ...config], { stdio: [stdin, "inherit", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Wrangler exits successfully when its interactive migration prompt is declined.
if (!dryRun) runWrangler(["d1", "migrations", "apply", "DB", "--remote"], "ignore");
runWrangler(["deploy", ...args]);
