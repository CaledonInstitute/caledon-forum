import { test, expect } from "@playwright/test";
import { load } from "cheerio";

test("detail views count each GET while server-only listings, HEAD, redirects and previews stay passive", async ({ page, request }) => {
  const feed = load(await (await request.get("/")).text());
  const path = feed("#post-qa-notebook").attr("data-post-url")!;
  expect(path).toMatch(/^\/p\/[1-9][0-9]*$/);
  const count = (html: string, id = "qa-notebook") => Number(load(html)(`#post-${id} .post-views`).text().replaceAll(",", ""));
  const initial = count(feed.html());
  expect(count(await (await request.get("/")).text())).toBe(initial);
  expect(count(await (await request.get("/qa_caledon")).text())).toBe(initial);
  expect((await request.head(path)).status()).toBe(200);
  const redirect = await request.get(path.replace("/p/", "/p/0"), { maxRedirects: 0 });
  expect(redirect.status()).toBe(301);
  expect(redirect.headers().location).toBe(path);
  expect((await request.get("/p/999999999")).status()).toBe(404);
  expect((await request.get(`/api/og/${path.split("/").pop()}.png`)).status()).toBe(200);
  expect(count(await (await request.get("/")).text())).toBe(initial);

  await page.goto(path);
  const views = page.locator(".conversation .post-views");
  await expect(views).toHaveAttribute("aria-label", `${(initial + 1).toLocaleString("en-US")} ${initial + 1 === 1 ? "view" : "views"}`);
  await page.reload();
  await expect(views).toHaveAttribute("aria-label", `${(initial + 2).toLocaleString("en-US")} views`);
  const html = load(await page.content());
  const replyPath = html("#post-qa-reply-00").attr("data-post-url")!;
  const replyCount = count(html.html(), "qa-reply-00");
  expect(count(await (await request.get(replyPath)).text(), "qa-reply-00")).toBe(replyCount + 1);
  expect(count(await (await request.get("/")).text())).toBe(initial + 2);

  const reply = load(await (await request.get(replyPath)).text());
  const branchPath = reply("#post-qa-branch-a").attr("data-post-url")!;
  const branch = load(await (await request.get(branchPath)).text());
  const deletedPath = branch("#post-qa-branch-deleted").attr("data-post-url")!;
  const deleted = await request.get(deletedPath);
  expect(deleted.status()).toBe(200);
  expect(load(await deleted.text())(".conversation > article .post-views").length).toBe(0);

  await page.screenshot({ path: "artifacts/post-views-desktop.png" });
  await page.setViewportSize({ width: 320, height: 780 });
  await views.locator("span").evaluate((el) => {
    el.textContent = "1,234,567,890";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".conversation [data-like]")).toBeVisible();
  await expect(page.locator(".conversation [data-share]")).toBeVisible();
  await expect(page.locator(".conversation .more")).toBeVisible();
  await page.screenshot({ path: "artifacts/post-views-mobile.png" });
});

test("visible feed and profile cards count once per page load; offscreen cards and detail posts do not send impressions", async ({ page }) => {
  const impressions: string[] = [];
  await page.route("**/api/forum/view", async (route) => {
    impressions.push(route.request().postDataJSON().id);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, views: 42 }) });
  });
  await page.goto("/");
  const card = page.locator("#post-qa-notebook");
  const path = (await card.getAttribute("data-post-url"))!;
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".post-views")).toHaveAttribute("aria-label", "42 views");
  expect(impressions.filter((id) => id === "qa-notebook")).toHaveLength(1);
  const offscreen = page.locator("[data-view-post]").last();
  const offscreenId = (await offscreen.getAttribute("data-view-post"))!;
  expect(await offscreen.evaluate((el) => el.getBoundingClientRect().top >= innerHeight)).toBe(true);
  expect(impressions).not.toContain(offscreenId);
  await offscreen.scrollIntoViewIfNeeded();
  await expect(offscreen.locator(".post-views")).toHaveAttribute("aria-label", "42 views");
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  expect(impressions.filter((id) => id === "qa-notebook")).toHaveLength(1);

  await page.goto("/qa_caledon");
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => impressions.filter((id) => id === "qa-notebook").length).toBe(2);
  await page.reload();
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => impressions.filter((id) => id === "qa-notebook").length).toBe(3);
  await page.goto(path);
  await page.waitForTimeout(1200);
  expect(impressions.filter((id) => id === "qa-notebook")).toHaveLength(3);
});

test("hidden tabs do not count cards and failed impression requests leave reading usable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  });
  let requests = 0;
  await page.route("**/api/forum/view", async (route) => {
    requests++;
    await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Unavailable"}' });
  });
  await page.goto("/");
  const card = page.locator("#post-qa-notebook");
  await card.scrollIntoViewIfNeeded();
  const previous = await card.locator(".post-views").textContent();
  await page.waitForTimeout(1200);
  expect(requests).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(card.locator(".post-views")).toHaveText(previous!);
  await expect(card.locator("[data-post-status]")).toBeEmpty();
  await expect(card.locator("[data-like]")).toBeEnabled();
});
