// Run against the built Worker and its real ForumPages Durable Objects. No flag files are changed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
// A fresh origin also gives the render probe fresh image-cache keys on each run.
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://localhost:${port}`;
const worker = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--port",
    String(port),
    "--var",
    "POST_OG_ENABLED:true",
    "--var",
    "PROFILE_OG_ENABLED:true",
    "--var",
    `SITE_URL:${origin}`,
    "--log-level",
    "error",
  ],
  {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }
);
let output = "";
worker.stdout.on("data", (chunk) => {
  output = (output + chunk).slice(-8000);
});
worker.stderr.on("data", (chunk) => {
  output = (output + chunk).slice(-8000);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      await response.arrayBuffer();
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local Worker. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`Local Worker did not start. ${output}`);
  await new Promise((resolve, reject) => {
    const test = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "tests/browser/og.spec.ts"], {
      windowsHide: true,
      stdio: "inherit",
      env: { ...process.env, TEST_BASE_URL: origin, EXPECT_POST_OG: "true", EXPECT_PROFILE_OG: "true" },
    });
    test.on("error", reject);
    test.on("exit", (code) => (code ? reject(new Error(`OG browser test exited ${code}. ${output}`)) : resolve()));
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (process.platform === "win32")
    await new Promise((resolve) => {
      const stop = spawn("taskkill", ["/pid", String(worker.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      stop.on("exit", resolve);
    });
  else worker.kill("SIGTERM");
}
