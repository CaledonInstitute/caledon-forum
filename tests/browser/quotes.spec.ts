import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required.");
  await context.addCookies([cookie]);
});

for (const kind of ["post", "reply"] as const) {
  test(`pasted ${kind} link becomes a quote in editor, preview and published posts`, async ({ page, context, browser }) => {
    await page.goto("/");
    const thread = (await page.locator("#post-qa-notebook .post-time").getAttribute("href"))!;
    let source = thread;
    if (kind === "reply") {
      await page.goto(thread);
      source = (await page.locator("#post-qa-reply-00 .post-time").getAttribute("href"))!;
      await page.goto("/");
    }
    const sourceUrl = new URL(source, page.url()).href;
    const text = `My takeaway about this ${kind}.`;
    const editor = page.getByLabel("Your post", { exact: true });
    await editor.fill(`${text}\n\n${sourceUrl}`);
    const draft = page.locator(".composer .quote-card");
    await expect(draft).toBeVisible();
    await expect(draft.locator(".quote-source")).toHaveAttribute("href", source);
    if (kind === "reply") await expect(draft.locator(".quote-context")).toHaveText("Replying to @qa_caledon");
    await page.screenshot({ path: `artifacts/quote-${kind}-desktop.png` });
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(page.locator(".composer .preview .post-content")).toHaveText(text);
    await expect(draft).toBeVisible();
    await expect(page.locator(".composer .link-card")).toHaveCount(0);
    const published = page.waitForResponse((r) => r.url().endsWith("/api/forum/publish") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Post", exact: true }).click();
    const result = await (await published).json();
    try {
      const card = page.locator(`[id="post-${result.id}"]`);
      const quote = card.locator(".quote-card");
      await expect(quote).toBeVisible();
      await expect(card.locator(".post-content")).toHaveText(text);
      await expect(page).toHaveURL("/");
      await expect(page.locator(".composer .quote-card")).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await card.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/quote-${kind}-mobile.png` });
      const publicContext = await browser.newContext({ javaScriptEnabled: false });
      try {
        const reader = await publicContext.newPage();
        await reader.goto(result.url);
        const rendered = reader.locator(".conversation .quote-card");
        await expect(rendered).toBeVisible();
        const profile = (await rendered.locator(".quote-profile").first().getAttribute("href"))!;
        await rendered.locator(".quote-profile").first().click();
        await expect(reader).toHaveURL(profile);
        await reader.goto(result.url);
        await reader.locator(".conversation .quote-profile strong").click();
        await expect(reader).toHaveURL(profile);
        await reader.goto(result.url);
        await reader.locator(".conversation .quote-source p").click();
        await expect(reader).toHaveURL(source);
      } finally {
        await publicContext.close();
      }
    } finally {
      await context.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id: result.id } });
    }
  });
}

test("removing pasted link removes quote and missing sources show an unavailable card", async ({ page }) => {
  await page.goto("/");
  const path = (await page.locator("#post-qa-notebook .post-time").getAttribute("href"))!;
  const editor = page.getByLabel("Your post", { exact: true });
  await editor.fill(new URL(path, page.url()).href);
  await expect(page.locator(".composer .quote-card")).toBeVisible();
  await editor.fill("Keep only my own words.");
  await expect(page.locator(".composer .quote-card")).toHaveCount(0);
  await editor.fill("http://localhost:4321/p/9999999999999999999");
  await expect(page.locator(".composer .quote-unavailable")).toHaveText("This quoted post is no longer available.");
});
