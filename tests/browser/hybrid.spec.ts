import { test, expect } from "@playwright/test";
test("server HTML stays readable without JavaScript, and the browser supplies rich formatting", async ({ browser, page }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const plain = await context.newPage();
    await plain.goto("/");
    const card = plain.locator("#post-qa-notebook");
    await expect(card.locator(".plain-post")).toContainText("research notebook");
    await expect(card.locator(".katex,.hljs")).toHaveCount(0);
    await expect(plain.locator('meta[property="og:title"]')).toHaveAttribute("content", /Caledon/);
    await expect(card.locator(".post-time")).toHaveAttribute("href", /^\/p\/[0-9]+$/);
  } finally {
    await context.close();
  }
  await page.goto("/");
  await page.locator("#post-qa-notebook").scrollIntoViewIfNeeded();
  await expect(page.locator("#post-qa-notebook .hljs")).toBeVisible();
  await expect(page.locator("#post-qa-notebook [data-rich-ready]")).toHaveCount(1);
});
