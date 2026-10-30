import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("presence recovers after reconnecting with hidden status indicators", async ({ page, context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required");
  await context.addCookies([cookie]);
  let connections = 0;
  let disconnect = () => {};
  let hideStatus = () => {};
  const subscriptions: string[][] = [];
  await page.routeWebSocket("**/api/live/connect", (ws) => {
    connections++;
    disconnect = () => ws.close({ code: 1000 });
    hideStatus = () => ws.send(JSON.stringify({ type: "presence", users: {} }));
    ws.onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.type !== "heartbeat") return;
      subscriptions.push(data.users);
      ws.send(JSON.stringify({ type: "presence", users: data.users.includes("qa_caledon") ? { qa_caledon: { online: true, lastActiveAt: Date.now() } } : {} }));
    });
  });
  await page.goto("/qa_caledon");
  test.skip((await page.locator('body[data-realtime="true"]').count()) === 0, "Requires realtime enabled");
  const activity = page.locator(".profile-activity");
  const dot = page.locator('.profile-header .presence-dot[data-presence-for="qa_caledon"]');
  await expect(activity).toHaveText("Online");
  await expect(dot).toHaveAttribute("data-online", "true");
  // A private/unavailable status must still be requested when it becomes public again.
  hideStatus();
  await expect(activity).toBeHidden();
  await expect(dot).toBeHidden();
  subscriptions.length = 0;
  disconnect();
  await expect(activity).toBeHidden();
  await expect.poll(() => connections).toBe(2);
  await expect.poll(() => subscriptions.some((users) => users.includes("qa_caledon"))).toBe(true);
  await expect(activity).toBeVisible();
  await expect(activity).toHaveText("Online");
  await expect(dot).toBeVisible();
  await expect(dot).toHaveAttribute("data-online", "true");
});

test("public presence follows an authenticated tab and an anonymous viewer receives live counts", async ({ browser }) => {
  test.setTimeout(90000);
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required");
  const author = await browser.newContext();
  const reader = await browser.newContext();
  try {
    await author.addCookies([cookie]);
    const signedIn = await author.newPage();
    const anonymous = await reader.newPage();
    await signedIn.goto("/qa_caledon");
    await anonymous.goto("/qa_caledon");
    test.skip((await anonymous.locator('body[data-realtime="true"]').count()) === 0, "Run with scripts/test-live-local.mjs");
    await expect(anonymous.locator('[data-presence-for="qa_caledon"]').first()).toHaveAttribute("data-online", "true", { timeout: 40000 });
    const before = Number(await anonymous.locator("#post-qa-notebook [data-share]").getAttribute("data-reposts"));
    const response = await signedIn.request.post("/api/forum/repost", { headers: { origin: "http://localhost:4321" }, data: { id: "qa-notebook", reposted: true } });
    expect(response.ok()).toBe(true);
    await expect(anonymous.locator("#post-qa-notebook [data-share] span")).toHaveText(String(before + 1), { timeout: 20000 });
    await signedIn.request.post("/api/forum/repost", { headers: { origin: "http://localhost:4321" }, data: { id: "qa-notebook", reposted: false } });
    await signedIn.close();
    await expect(anonymous.locator('[data-presence-for="qa_caledon"]').first()).toHaveAttribute("data-online", "false", { timeout: 60000 });
  } finally {
    await author.close();
    await reader.close();
  }
});
test("websocket route rejects cross-origin upgrades", async ({ request }) => {
  const response = await request.get("/api/live/connect", { headers: { origin: "https://attacker.example", Upgrade: "websocket" } });
  expect([403, 503]).toContain(response.status());
});
test("live quotes follow source edits and deletion, and new feed items wait for a click", async ({ browser }) => {
  test.setTimeout(100000);
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required");
  const author = await browser.newContext(),
    reader = await browser.newContext();
  await author.addCookies([cookie]);
  const page = await reader.newPage();
  const ids: string[] = [];
  const action = async (name: string, data: any) => {
    const response = await author.request.post(`/api/forum/${name}`, { headers: { origin: "http://localhost:4321" }, data });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  try {
    await page.goto("/");
    test.skip((await page.locator('body[data-realtime="true"]').count()) === 0, "Run with scripts/test-live-local.mjs");
    const source = await action("publish", { body: "Live quote original" });
    ids.push(source.id);
    const ref = await action("publish", { body: `My reference\n\nhttp://localhost:4321${source.url}` });
    ids.push(ref.id);
    await page.goto(ref.url);
    await expect(page.locator(".conversation .quote-source p")).toHaveText("Live quote original");
    await action("edit", { id: source.id, body: "Live quote changed" });
    await expect(page.locator(".conversation .quote-source p")).toHaveText("Live quote changed", { timeout: 20000 });
    await action("delete", { id: source.id });
    await expect(page.locator(".conversation .quote-unavailable")).toBeVisible({ timeout: 20000 });
    const initial = page.waitForResponse((r) => r.url().includes("/api/live/snapshot"));
    await page.goto("/");
    await initial;
    const anchor = page.locator("[data-post-list] > article").first();
    const anchorId = await anchor.getAttribute("id");
    const next = await action("publish", { body: "Live feed addition" });
    ids.push(next.id);
    await expect(page.locator(".live-updates")).toBeVisible({ timeout: 20000 });
    await expect(page.locator(`[id="post-${next.id}"]`)).toHaveCount(0);
    const before = await anchor.evaluate((e) => e.getBoundingClientRect().top);
    await page.locator(".live-updates").click();
    await expect(page.locator(`[id="post-${next.id}"]`)).toBeVisible();
    const after = await page.locator(`[id="${anchorId}"]`).evaluate((e) => e.getBoundingClientRect().top);
    expect(Math.abs(after - before)).toBeLessThan(5);
    await expect(page).toHaveURL("/");
  } finally {
    await reader.close();
    for (const id of ids) await author.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id } });
    await author.close();
  }
});
