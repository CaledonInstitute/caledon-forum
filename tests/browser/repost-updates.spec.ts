import { readFile } from "node:fs/promises";
import ts from "typescript";
import { test, expect } from "@playwright/test";

test("loading new posts keeps originals and multiple reposts as distinct cards", async ({ page }) => {
  // Exercise the real realtime script with controlled HTTP and WebSocket updates.
  const postTime = ts.transpileModule(await readFile("src/lib/post-time.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const source = (await readFile("src/scripts/realtime.ts", "utf8")).replace("../lib/post-time", `data:text/javascript;base64,${Buffer.from(postTime).toString("base64")}`);
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  let version = 0;
  let notify = () => {};
  const card = (name?: string) =>
    `<article id="post-source${name ? `-repost-${name}` : ""}" data-post-id="source" data-updated-at="1">${name ? `<p class="repost-context">${name} reposted</p>` : ""}<p>Original post</p></article>`;
  const html = () =>
    `<body data-realtime="true"><main><section data-post-list>${version > 1 ? card("bob") : ""}${version > 0 ? card("alice") : ""}${card()}</section></main></body>`;
  await page.route("http://localhost:4321/", (route) => route.fulfill({ contentType: "text/html", body: html() }));
  await page.route("**/api/live/snapshot?*", (route) => route.fulfill({ json: { latest: `event-${version}`, items: [], unread: 0 } }));
  await page.routeWebSocket("**/api/live/connect", (ws) => {
    notify = () => ws.send(JSON.stringify({ type: "refresh" }));
  });
  await page.goto("http://localhost:4321/");
  const initial = page.waitForResponse((response) => response.url().includes("/api/live/snapshot"));
  await page.addScriptTag({ type: "module", content: script });
  await initial;
  await page.evaluate(() => {
    (window as any).originalCard = document.getElementById("post-source");
  });

  for (const name of ["alice", "bob"]) {
    version++;
    const snapshot = page.waitForResponse((response) => response.url().includes("/api/live/snapshot"));
    notify();
    await snapshot;
    await expect(page.getByRole("button", { name: "New posts available" })).toBeVisible();
    await expect(page.locator(`#post-source-repost-${name}`)).toHaveCount(0);
    await page.getByRole("button", { name: "New posts available" }).click();
    await expect(page.locator(`#post-source-repost-${name}`)).toBeVisible();
    await expect(page.locator("[data-post-list] > article")).toHaveCount(version + 1);
    await expect(page.locator("#post-source-repost-alice .repost-context")).toHaveText("alice reposted");
    await expect(page.locator("#post-source > .repost-context")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).originalCard === document.getElementById("post-source"))).toBe(true);
    await expect(page.locator(".live-updates")).toHaveCount(0);
  }
});
