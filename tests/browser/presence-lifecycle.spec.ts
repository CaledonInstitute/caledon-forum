import { readFile } from "node:fs/promises";
import ts from "typescript";
import { test, expect } from "@playwright/test";

test("hidden tabs keep a single socket; foreground, network reconnect and bfcache restore resynchronize", async ({ page }) => {
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
  const time = ts.transpileModule(await readFile("src/lib/post-time.ts", "utf8"), { compilerOptions }).outputText;
  const source = (await readFile("src/scripts/realtime.ts", "utf8")).replace("../lib/post-time", `data:text/javascript;base64,${Buffer.from(time).toString("base64")}`);
  const script = ts.transpileModule(source, { compilerOptions }).outputText;
  let connections = 0,
    snapshots = 0,
    disconnect = () => {};
  await page.route("http://localhost:4321/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<body data-realtime="true"><div><span data-presence-for="alice"></span></div></body>' })
  );
  await page.route("**/api/live/snapshot?*", (route) => {
    snapshots++;
    return route.fulfill({ json: { items: [], unread: 0 } });
  });
  await page.routeWebSocket("**/api/live/connect", (ws) => {
    connections++;
    disconnect = () => ws.close({ code: 1000 });
    ws.onMessage(() => ws.send(JSON.stringify({ type: "presence", users: { alice: { online: true, lastActiveAt: 1 } } })));
  });
  await page.clock.install();
  await page.goto("http://localhost:4321/");
  await page.addScriptTag({ type: "module", content: script });
  await expect.poll(() => connections).toBe(1);
  await expect(page.locator("[data-presence-for]")).toHaveAttribute("data-online", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(90000);
  expect(connections).toBe(1);
  await expect(page.locator("body")).toHaveAttribute("data-realtime-connected", "true");
  const previous = snapshots;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => snapshots).toBeGreaterThan(previous);
  expect(connections).toBe(1);
  disconnect();
  await expect(page.locator("body")).toHaveAttribute("data-realtime-connected", "false");
  await page.clock.fastForward(4000);
  await expect.poll(() => connections).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(page.locator("body")).toHaveAttribute("data-realtime-connected", "false");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect.poll(() => connections).toBe(3);
  await expect(page.locator("[data-presence-for]")).toHaveAttribute("data-online", "true");
});
