import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { load } from "cheerio";
let notebookPath: string, mediaPath: string;
test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  const $ = load(await response.text());
  notebookPath = $("#post-qa-notebook .post-time").attr("href")!;
  mediaPath = $("#post-qa-media .post-time").attr("href")!;
  expect(notebookPath).toMatch(/^\/p\/[1-9][0-9]*$/);
  expect(mediaPath).toMatch(/^\/p\/[1-9][0-9]*$/);
});
test("feed, navigation and anonymous interaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.locator("#post-qa-notebook")).toContainText("research notebook");
  await page.screenshot({ path: "artifacts/feed-desktop.png", fullPage: true });
  await page.locator("#post-qa-notebook [data-like]").click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("public thread has SSR content, metadata and crawlable pagination", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(notebookPath + "?utm_source=test");
  expect(await page.title()).toContain("research notebook");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /research notebook/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", "http://localhost:4321" + notebookPath);
  await expect(page.locator("#post-qa-notebook pre")).toContainText("notebook.add");
  const schemas = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(schemas.some((s) => JSON.parse(s)["@type"] === "DiscussionForumPosting")).toBe(true);
  await expect(page.locator("#post-qa-reply-00 .read-more")).toHaveCount(1);
  await page.getByRole("link", { name: "Load more" }).click();
  await expect(page.locator("#post-qa-reply-22")).toBeVisible();
  await context.close();
});
test("post content and empty space open the detail page", async ({ page }) => {
  for (const area of ["content", "space"]) {
    await page.goto("/");
    const post = page.locator("#post-qa-notebook");
    if (area === "content") await post.locator(".post-content p").first().click();
    else await post.click({ position: { x: 5, y: 5 } });
    await expect(page).toHaveURL(notebookPath);
    await expect(page.getByRole("heading", { name: "Thread", exact: true })).toBeVisible();
    await expect(page.locator("#post-qa-notebook")).not.toHaveAttribute("data-post-url");
  }
});
test("post interactions and text selection keep their behavior", async ({ page }) => {
  await page.goto("/");
  const post = page.locator("#post-qa-notebook");
  await post.locator("summary").click();
  await expect(post.locator("details.more")).toHaveAttribute("open", "");
  await expect(page).toHaveURL("/");
  await post.locator("summary").click();
  await post
    .locator(".post-content p")
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  await post.dispatchEvent("click");
  await expect(page).toHaveURL("/");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await post.locator(".identity strong").click();
  await expect(page).toHaveURL("/qa_caledon");
});
test("search and profile show server-rendered results", async ({ page }) => {
  await page.goto("/search");
  await page.getByLabel("Search posts and people").fill("research notebook");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("#post-qa-notebook")).toBeVisible();
  await page.goto("/qa_caledon");
  await expect(page.getByRole("heading", { name: "Caledon QA", exact: true })).toBeVisible();
  expect(await page.locator('script[type="application/ld+json"]').last().textContent()).toContain("ProfilePage");
});
test("mobile has no horizontal overflow and exposes keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(notebookPath);
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/thread-mobile.png", fullPage: true });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});
test("index directives, missing content and generated PNG cards", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap: http://localhost:4321/sitemap.xml");
  const sitemap = await request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain(notebookPath);
  expect(await sitemap.text()).not.toContain("/login");
  expect((await request.get("/thread/nonexistent")).status()).toBe(404);
  expect((await request.get("/search")).headers()["x-robots-tag"]).toBe("noindex");
  const card = await request.get(`/api/og/${notebookPath.split("/").pop()}.png`);
  expect(card.ok()).toBe(true);
  expect(card.headers()["content-type"]).toContain("image/png");
  const bytes = await card.body();
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
  const fallback = await request.get("/social.png");
  expect(bytes.equals(await fallback.body())).toBe(false);
});
test("external images and click-loaded YouTube", async ({ page, request }) => {
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<html><body>Test player</body></html>" }));
  await page.goto(mediaPath);
  await expect(page.locator("#post-qa-media .post-content img")).toHaveAttribute("src", "/api/media/qa-image");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Play YouTube preview test fixture" }).click();
  await expect(page.locator("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw");
  const image = await request.get("/api/media/qa-image");
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toMatch(/^image\/(png|jpeg|webp|gif)/);
  expect((await request.get("/api/media/arbitrary")).status()).toBe(404);
});
test("old routes are removed and profile URLs are canonical", async ({ request }) => {
  for (const path of ["/u/qa_caledon", "/thread/qa-notebook", "/p/qa-notebook", "/api/og/qa-notebook.png"])
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(404);
  const profile = await request.get("/qa_caledon?utm_source=test");
  expect(profile.status()).toBe(200);
  const $ = load(await profile.text());
  expect($("link[rel=canonical]").attr("href")).toBe("http://localhost:4321/qa_caledon");
  expect((await request.get("/missing_profile")).status()).toBe(404);
  expect((await request.get("/constructor")).status()).toBe(404);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/thread/");
  expect(sitemap).not.toContain("/u/qa_caledon");
  expect(sitemap).toContain("/qa_caledon");
});

async function firstReplyPath(page: import("@playwright/test").Page) {
  await page.goto(notebookPath);
  return (await page.locator("#post-qa-reply-00 .post-time").getAttribute("href"))!;
}

test("reply navigation reveals one level at a time without expanding ancestors", async ({ page, browser }) => {
  const replyPath = await firstReplyPath(page);
  await expect(page.locator("#post-qa-branch-a")).toHaveCount(0);
  await page.goto(replyPath);
  await expect(page.locator(".conversation > article")).toHaveCount(1);
  await expect(page.locator("#post-qa-notebook")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to parent" })).toHaveAttribute("href", notebookPath);
  await expect(page.locator("#post-qa-reply-00")).not.toHaveAttribute("data-post-url");
  await expect(page.locator("#post-qa-reply-00 .post-content")).toContainText("pagination testing.");
  const replies = page.getByRole("region", { name: "Replies", exact: true });
  await expect(replies.locator("article")).toHaveCount(2);
  const branchPath = (await page.locator("#post-qa-branch-a .post-time").getAttribute("href"))!;
  await page.locator("#post-qa-branch-a .post-content").click();
  await expect(page).toHaveURL(branchPath);
  await expect(page.locator("#post-qa-branch-b")).toHaveCount(0);
  await expect(page.locator("#post-qa-reply-00")).toHaveCount(0);
  await expect(page.locator("#post-qa-branch-leaf")).toHaveCount(0);
  await expect(page.locator(".conversation > article")).toHaveCount(1);
  const selectedBounds = (await page.locator(".conversation > article").boundingBox())!;
  const childBounds = (await page.locator(".reply-list > article").boundingBox())!;
  expect(childBounds.x).toBeGreaterThan(selectedBounds.x);
  await page.screenshot({ path: "artifacts/reply-level-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/reply-level-mobile.png", fullPage: true });
  await page.locator("#post-qa-branch-deleted .post-time").click();
  await expect(page.locator("#post-qa-branch-deleted")).toContainText("This post was deleted.");
  await expect(page.locator("#reply")).toHaveCount(0);
  const leafPath = (await page.locator("#post-qa-branch-leaf .post-time").getAttribute("href"))!;
  await page.goto(leafPath);
  await expect(page.locator(".conversation > article")).toHaveCount(1);
  await expect(page.locator("#post-qa-branch-deleted")).toHaveCount(0);
  await expect(page.locator(".reply-list > article")).toHaveCount(0);
  await expect(page.locator("#post-qa-branch-b")).toHaveCount(0);
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", "http://localhost:4321" + leafPath);
  await page.screenshot({ path: "artifacts/reply-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/reply-mobile.png", fullPage: true });
  const context = await browser.newContext({ javaScriptEnabled: false });
  const ssr = await context.newPage();
  await ssr.goto(leafPath);
  await expect(ssr.locator(".conversation > article")).toHaveCount(1);
  await context.close();
});

test("avatar-column empty space opens post and reply details, while identity opens profiles", async ({ page }) => {
  const replyPath = await firstReplyPath(page);
  for (const [path, id, target] of [
    ["/", "qa-notebook", notebookPath],
    [notebookPath, "qa-reply-00", replyPath],
  ]) {
    await page.goto(path);
    const article = page.locator(`#post-${id}`);
    const avatar = article.locator(".post-avatar-link");
    const bounds = (await article.boundingBox())!,
      avatarBounds = (await avatar.boundingBox())!;
    expect(avatarBounds.height).toBeLessThanOrEqual(42);
    await article.click({ position: { x: avatarBounds.x - bounds.x + 5, y: avatarBounds.y - bounds.y + avatarBounds.height + 12 } });
    await expect(page).toHaveURL(target);
    await page.goto(path);
    await avatar.click();
    await expect(page).toHaveURL(id === "qa-notebook" ? "/qa_caledon" : "/qa_research");
  }
  await page.goto(replyPath);
  await page.locator("#post-qa-reply-00").click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(replyPath);
  await page.locator("#post-qa-reply-00 .handle").click();
  await expect(page).toHaveURL("/qa_research");
});

test("composer preserves failed drafts, prevents duplicate sends and stays on the current reply page", async ({ page, context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Run seed-local with local authentication enabled to test the composer.");
  await context.addCookies([cookie]);
  const replyPath = await firstReplyPath(page);
  await page.goto(replyPath);
  const destination = (await page.locator("#post-qa-branch-a .post-time").getAttribute("href"))!;
  const editor = page.getByRole("textbox", { name: "Your reply" });
  await expect(editor).toBeVisible();
  await editor.fill("A draft that should survive a failed request.");
  let calls = 0;
  let finish: (() => Promise<void>) | undefined;
  await page.route("**/api/forum/publish", async (route) => {
    calls++;
    if (calls === 1) await route.fulfill({ status: 400, json: { error: "This thread is locked." } });
    else
      await new Promise<void>((resolve) => {
        finish = async () => {
          await route.fulfill({ json: { ok: true, url: destination } });
          resolve();
        };
      });
  });
  const send = page.getByRole("button", { name: "Reply", exact: true });
  await send.click();
  await expect(page.getByRole("alert")).toHaveText("This thread is locked.");
  await expect(editor).toHaveValue("A draft that should survive a failed request.");
  await send.click();
  await expect(page.getByRole("button", { name: /^Working/ })).toBeDisabled();
  await expect(editor).toBeDisabled();
  expect(calls).toBe(2);
  await expect.poll(() => !!finish).toBe(true);
  await finish!();
  await expect(page).toHaveURL(replyPath);
  await expect(page.locator(".publish-toast [role=status]")).toHaveText("Reply posted.");
  await expect(page.getByRole("textbox", { name: "Your reply" })).toHaveValue("");
  await expect(page.locator(".counter")).toHaveText("0 / 25,000");
  await expect(page.locator(".composer [role=alert]")).toBeEmpty();
});
