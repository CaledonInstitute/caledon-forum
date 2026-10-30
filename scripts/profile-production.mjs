import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { load } from "cheerio";
const rendererMode = process.argv.includes("--renderer");
const workerName = rendererMode ? "caledon-forum-render-profile" : "caledon-forum";
const origin = `https://${workerName}.supervoid.workers.dev`;
const label = process.argv[2] || "baseline";
const repeatArg = process.argv.find((arg) => arg.startsWith("--repeat="));
const repeats = repeatArg ? Math.max(1, Math.min(20, Number(repeatArg.split("=")[1]) || 2)) : 2;
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Use a simple report label.");
const records = [];
const requests = [];
const child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "tail", workerName, "--format", "json"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let markReady;
const ready = new Promise((resolve) => {
  markReady = resolve;
});
child.stderr.on("data", (chunk) => {
  if (/Connected|Successfully created tail/.test(chunk.toString())) markReady(true);
});
child.on("exit", () => markReady(false));
let buffer = "",
  depth = 0,
  quoted = false,
  escaped = false;
child.stdout.on("data", (chunk) => {
  if (/Connected|Successfully created tail/.test(chunk.toString())) markReady(true);
  for (const c of chunk.toString()) {
    if (!depth && c !== "{") continue;
    buffer += c;
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    if (!depth) {
      try {
        const value = JSON.parse(buffer);
        if (value.event?.request?.url) {
          markReady(true);
          const eventUrl = new URL(value.event.request.url);
          const path = eventUrl.pathname;
          const route = path.startsWith("/p/")
            ? "/p/:id"
            : path.startsWith("/api/og/")
              ? "/api/og/:file"
              : path.startsWith("/api/forum/card/")
                ? "/api/forum/card/:id"
                : /^\/\w+$/.test(path) && !["/search", "/login", "/register"].includes(path)
                  ? "/:username"
                  : path;
          const headers = Object.fromEntries(Object.entries(value.event.request.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
          const runtime = headers["x-forum-runtime"] === "pages" ? "pages" : eventUrl.origin === origin ? "edge" : "service";
          const record = {
            route,
            runtime,
            executionModel: value.executionModel,
            authenticatedCookie: !!headers.cookie,
            outcome: value.outcome,
            cpuTime: value.cpuTime,
            wallTime: value.wallTime,
          };
          records.push(record);
          console.log(JSON.stringify(record));
        }
      } catch {
        /* CLI preamble is not an event. */
      }
      buffer = "";
    }
  }
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const warmup = setInterval(() => {
  fetch(origin, { signal: AbortSignal.timeout(10000) })
    .then((response) => response.arrayBuffer())
    .catch(() => {});
}, 5000);
try {
  // Tail creation can take tens of seconds; a fixed seven-second delay lost all CPU samples.
  const connected = await Promise.race([ready, pause(60000).then(() => false)]);
  clearInterval(warmup);
  if (!connected) throw new Error("Production tail did not become ready; rerun the probe.");
  const request = async (path) => {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    requests.push({ route: path, status: response.status, bytes: Buffer.byteLength(body) });
    // Avoid flooding live-tail sampling; keep the probe below four requests/second.
    await pause(300);
    return body;
  };
  if (rendererMode) {
    for (const path of ["/health", "/card", "/feed", "/detail", "/card", "/feed", "/detail"]) await request(path);
  } else {
    let home = await request("/");
    if (!home.includes("data-post-url")) {
      const sitemap = await request("/sitemap.xml");
      const url = /<loc>(https[^<]+\/p\/[0-9]+)<\/loc>/.exec(sitemap)?.[1];
      if (url) home += `<a data-post-url="${new URL(url).pathname}"></a>`;
    }
    const $ = load(home);
    const post = $("[data-post-url]").first().attr("data-post-url");
    const profile = $("a.post-avatar-link").first().attr("href");
    for (let i = 0; i < repeats; i++) {
      await request("/");
      if (profile) await request(profile);
      if (post) {
        await request(post);
        await request(`/api/forum/card/${post.split("/").pop()}`);
        if (process.argv.includes("--post-og")) await request(`/api/og/${post.split("/").pop()}.png`);
      }
    }
  }
  await pause(7000);
} finally {
  clearInterval(warmup);
  if (process.platform === "win32")
    await new Promise((resolve) => {
      const stop = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      stop.on("exit", resolve);
    });
  else child.kill();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    `artifacts/production-${label}.json`,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        requests,
        records,
        limitations: "Anonymous read probes only; paths in requests are public. No private headers, bodies, or console logs retained. CPU fields may be absent in live tail.",
      },
      null,
      2
    )
  );
  console.log(`Report: artifacts/production-${label}.json (${records.length} events)`);
}
