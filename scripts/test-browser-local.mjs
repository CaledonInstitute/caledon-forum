import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
// Keep the user's ignored configuration in memory; never print or copy its secrets.
const original = await readFile(".dev.vars").catch(() => null);
const run = (file, args, quiet = false) => {
  const result = spawnSync(process.execPath, [file, ...args], { windowsHide: true, stdio: quiet ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`Local browser check failed: ${file}`);
};
const astro = "node_modules/astro/bin/astro.mjs";
try {
  run(astro, ["dev", "stop"], true);
  await writeFile(
    ".dev.vars",
    `SITE_URL=http://localhost:4321
AUTH_ENABLED=true
BETTER_AUTH_SECRET=local-browser-test-secret-01234567890123456789
GITHUB_CLIENT_ID=local-browser-test
GITHUB_CLIENT_SECRET=local-browser-test
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=local-browser-test
RESEND_API_KEY=re_local-browser-test
EMAIL_FROM=Caledon <local@caledon.invalid>
RATE_LIMIT_DO_ENABLED=false
SERVER_DO_ENABLED=false
REALTIME_ENABLED=false
PRESENCE_ENABLED=false
PUSH_ENABLED=false
PROFILE_OG_ENABLED=false
POST_OG_ENABLED=false
STATIC_OG_ENABLED=true
UPLOADS_ENABLED=false
`
  );
  run("node_modules/wrangler/bin/wrangler.js", ["d1", "migrations", "apply", "caledon-forum-db", "--local"], true);
  run("scripts/seed-local.mjs", [], true);
  run(astro, ["dev", "--background"]);
  const args = process.argv.slice(2);
  run("node_modules/@playwright/test/cli.js", ["test", ...(args.length ? args : ["tests/browser/uploads.spec.ts"])]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    run(astro, ["dev", "stop"], true);
  } finally {
    if (original) await writeFile(".dev.vars", original);
    else await unlink(".dev.vars").catch(() => {});
  }
  run(astro, ["dev", "--background"]);
}
