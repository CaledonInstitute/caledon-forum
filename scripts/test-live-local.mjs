// Enable live features only for this local browser test run, then restore configuration.
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import webpush from "web-push";
const original = await readFile(".dev.vars", "utf8");
const run = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => (code ? reject(new Error(`${file} exited ${code}`)) : resolve()));
  });
const astro = "node_modules/astro/bin/astro.mjs";
try {
  await run(astro, ["dev", "stop"]);
  let config = original;
  const vapid = webpush.generateVAPIDKeys();
  const values = {
    REALTIME_ENABLED: "true",
    PRESENCE_ENABLED: "true",
    PUSH_ENABLED: "true",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:qa@caledon.invalid",
  };
  for (const [key, value] of Object.entries(values)) config = config.replace(new RegExp(`^${key}=.*\\r?\\n?`, "gm"), "") + `\n${key}=${value}\n`;
  await writeFile(".dev.vars", config);
  await run(astro, ["dev", "--background"]);
  await run("node_modules/@playwright/test/cli.js", ["test", ...process.argv.slice(2)]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await run(astro, ["dev", "stop"]).catch(() => {});
  await writeFile(".dev.vars", original);
  await run(astro, ["dev", "--background"]);
}
