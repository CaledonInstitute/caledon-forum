import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 550 },
  { width: 1600, height: 690 },
  { width: 1024, height: 600 },
  { width: 1280, height: 900 },
]) {
  test(`sidebar links stay reachable at ${viewport.width}x${viewport.height}`, async ({ page, context }) => {
    const cookie = await readFile(".astro/qa-session.json", "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (cookie) await context.addCookies([cookie]);
    await page.setViewportSize(viewport);
    await page.goto("/");
    const sidebar = page.locator(".sidebar");
    const links = sidebar.locator("a");
    for (const link of await links.all()) {
      // Keyboard focus must bring every navigation, account and footer link into view.
      await link.focus();
      const bounds = await link.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(-1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await sidebar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator('.sidebar a[href="/privacy"]').click();
    await expect(page).toHaveURL("/privacy");
  });
}
