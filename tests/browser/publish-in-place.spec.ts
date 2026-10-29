import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required.");
  await context.addCookies([cookie]);
});

test("publish stays in feed, renders an interactive card and dismisses its toast", async ({ page, context }) => {
  await page.goto("/?page=2");
  const url = page.url();
  const text = `In-place post ${Date.now()}`;
  let id = "";
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.getByLabel("Your post", { exact: true }).fill(text);
  const published = page.waitForResponse((r) => r.url().endsWith("/api/forum/publish") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const result = await (await published).json();
  id = result.id;
  try {
    const card = page.locator(`[id="post-${id}"]`);
    await expect(page.locator("[data-post-list] > article").first()).toHaveAttribute("id", `post-${id}`);
    await expect(card.locator(".post-content")).toHaveText(text);
    await expect(page).toHaveURL(url);
    expect(navigations).toEqual([]);
    await expect(page.getByLabel("Your post", { exact: true })).toHaveValue("");
    await expect(page.locator(".publish-toast [role=status]")).toHaveText("Post published.");
    await expect(page.locator(".publish-toast a")).toHaveAttribute("href", result.url);
    await page.screenshot({ path: "artifacts/published-post-toast.png" });
    await expect(page.locator(".publish-toast")).toHaveCount(0, { timeout: 7000 });
    await card.locator("[data-like]").click();
    await expect(card.locator("[data-like]")).toHaveAttribute("aria-pressed", "true");
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(".post-views span")).not.toHaveText("0");
  } finally {
    if (id) await context.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id } });
  }
});

test("reply stays on its parent, appends a reply and updates both reply counts", async ({ page, context }) => {
  const rootResponse = await context.request.post("/api/forum/publish", { headers: { origin: "http://localhost:4321" }, data: { body: `In-place reply parent ${Date.now()}` } });
  expect(rootResponse.ok()).toBe(true);
  const root = await rootResponse.json();
  await page.goto(root.url);
  const url = page.url();
  const parent = page.locator(".conversation > article");
  const initial = Number(await parent.locator("[data-reply-count]").textContent()) || 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Your reply", { exact: true }).fill(`Reply without navigation ${Date.now()}`);
  const published = page.waitForResponse((r) => r.url().endsWith("/api/forum/publish") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const result = await (await published).json();
  try {
    await expect(page.locator(".reply-list > article").last()).toHaveAttribute("id", `post-${result.id}`);
    await expect(page).toHaveURL(url);
    await expect(parent.locator("[data-reply-count]")).toHaveText(String(initial + 1));
    await expect(page.locator("[data-reply-summary]")).toHaveText(`${initial + 1} ${initial + 1 === 1 ? "reply" : "replies"}`);
    await expect(page.getByLabel("Your reply", { exact: true })).toHaveValue("");
    await expect(page.locator(".publish-toast [role=status]")).toHaveText("Reply posted.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "artifacts/published-reply-toast-mobile.png" });
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(page.locator(".publish-toast")).toHaveCount(0);
  } finally {
    await context.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id: result.id } });
    await context.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id: root.id } });
  }
});

test("a failed list refresh still confirms publication and does not invite resending", async ({ page, context }) => {
  await page.goto("/");
  await page.route("**/api/forum/card/*", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.getByLabel("Your post", { exact: true }).fill(`Saved despite refresh failure ${Date.now()}`);
  const published = page.waitForResponse((r) => r.url().endsWith("/api/forum/publish") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const result = await (await published).json();
  try {
    await expect(page.locator(".publish-toast [role=status]")).toContainText("Post published. Could not update this page.");
    await expect(page.getByLabel("Your post", { exact: true })).toHaveValue("");
    await expect(page.locator(".composer [role=alert]")).toBeEmpty();
    await expect(page).toHaveURL("/");
    await expect(page.locator(".publish-toast a")).toHaveAttribute("href", result.url);
    await expect(page.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  } finally {
    await context.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id: result.id } });
  }
});
