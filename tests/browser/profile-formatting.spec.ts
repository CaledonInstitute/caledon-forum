import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("Share opens without recording, copying records only after clipboard succeeds", async ({ page }) => {
  await page.goto("/");
  let calls = 0;
  await page.route("**/api/forum/share", (route) => {
    calls++;
    return route.fulfill({ status: 200, json: { ok: true } });
  });
  const button = page.locator("#post-qa-notebook [data-share-menu]");
  await button.click();
  const menu = page.getByRole("dialog", { name: "Share post" });
  await expect(menu).toBeVisible();
  expect(calls).toBe(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard unavailable");
        },
      },
    })
  );
  await menu.getByRole("button", { name: "Copy link" }).click();
  await expect(menu.locator("[data-share-status]")).toHaveText("Could not copy. Try again.");
  expect(calls).toBe(0);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
  await menu.getByRole("button", { name: "Copy link" }).click();
  await expect(menu.locator("[data-share-status]")).toHaveText("Link copied.");
  await expect.poll(() => calls).toBe(1);
  await page.route("**/api/forum/share", (route) => route.fulfill({ status: 500, json: { error: "Unavailable" } }));
  await menu.getByRole("button", { name: "Copy link" }).click();
  await expect(menu.locator("[data-share-status]")).toHaveText("Link copied, but the share count could not be updated.");
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("profile composer previews and publishes HTML, highlighted code and LaTeX with public Likes", async ({ page, context, browser }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Requires local QA session");
  await context.addCookies([cookie]);
  await page.goto("/qa_caledon");
  await expect(page.locator("#compose")).toBeVisible();
  await page.goto("/qa_caledon?tab=replies");
  await expect(page.locator("#compose")).toHaveCount(0);
  await page.goto("/qa_caledon?tab=likes");
  await expect(page.locator("#compose")).toHaveCount(0);
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", "http://localhost:4321/qa_caledon?tab=likes");
  await page.goto("/qa_research");
  await expect(page.locator("#compose")).toHaveCount(0);
  await page.goto("/qa_caledon?page=2");
  await expect(page.locator("#compose")).toHaveCount(0);
  await page.goto("/qa_caledon");
  const body = "Formatting browser fixture\n\n<strong>Safe HTML</strong>\n\n```python\nprint(42)\n```\n\n$E=mc^2$\n\n$$\n\\frac{1}{3}\n$$";
  await page.getByLabel("Your post", { exact: true }).fill(body);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const preview = page.locator(".preview .post-content");
  await expect(preview.locator("strong")).toHaveText("Safe HTML");
  await expect(preview.locator(".hljs")).toBeVisible();
  await expect(preview.locator(".katex-display")).toBeVisible();
  await page.screenshot({ path: "artifacts/profile-composer-formatting.png", fullPage: true });
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.locator(".publish-toast [role=status]")).toHaveText("Post published.");
  await expect(page).toHaveURL("/qa_caledon");
  const ownPost = page.locator("[data-post-list] > article").first();
  await expect(ownPost.locator(".post-content")).toContainText("Formatting browser fixture");
  const id = (await ownPost.getAttribute("id"))!.slice(5),
    path = (await ownPost.locator(".post-time").getAttribute("href"))!;
  try {
    await expect(ownPost.locator(".hljs")).toBeVisible();
    await expect(ownPost.locator(".katex-display")).toBeVisible();
    const font = await page
      .locator(".katex .mord")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toContain("KaTeX");
    await ownPost.locator("[data-like]").click();
    await expect(ownPost.locator("[data-like]")).toHaveAttribute("aria-pressed", "true");
    const anonymous = await browser.newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto("/qa_caledon?tab=likes");
    await expect(publicPage.locator(`#post-${id}`)).toBeVisible();
    await expect(publicPage.locator("#compose")).toHaveCount(0);
    await anonymous.close();
    await page.goto("/qa_caledon?tab=likes");
    await page.locator(`#post-${id} [data-like]`).click();
    await expect(page.locator(`#post-${id}`)).toHaveCount(0);
    await page.goto(path);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "artifacts/post-formatting-mobile.png", fullPage: true });
  } finally {
    await context.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id } });
  }
});

test("settings saves and clears a public profile location", async ({ page, context, browser }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Requires local QA session");
  await context.addCookies([cookie]);
  await page.goto("/settings");
  const field = page.getByLabel(/^Location/);
  const original = await field.inputValue();
  try {
    await field.fill("Jakarta, Indonesia");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/forum/profile") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Save profile", exact: true }).click(),
    ]);
    await page.goto("/qa_caledon");
    await expect(page.locator(".profile-location")).toHaveText("Jakarta, Indonesia");
    const anonymous = await browser.newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto("/qa_caledon");
    await expect(publicPage.locator(".profile-location")).toHaveText("Jakarta, Indonesia");
    await anonymous.close();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "artifacts/profile-location-mobile.png", fullPage: true });
    await page.goto("/settings");
    await field.fill("");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/forum/profile") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Save profile", exact: true }).click(),
    ]);
    await page.goto("/qa_caledon");
    await expect(page.locator(".profile-location")).toHaveCount(0);
  } finally {
    await page.goto("/settings");
    await field.fill(original);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/forum/profile") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Save profile", exact: true }).click(),
    ]);
  }
});
