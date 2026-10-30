import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("mentions support keyboard, mouse, preview, and mobile", async ({ page, context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required.");
  await context.addCookies([cookie]);
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Your post", exact: true });
  await editor.fill("Hello @qa_");
  const options = page.getByRole("option");
  await expect.poll(() => options.count()).toBeGreaterThanOrEqual(2);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  const selectedUsername = (await options.nth(1).locator(".mention-handle").textContent())!.slice(1);
  await editor.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await editor.press("Enter");
  await expect(editor).toHaveValue(`Hello @${selectedUsername} `);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const mention = page.locator(".preview a.mention");
  await expect(mention).toHaveAttribute("href", `/${selectedUsername}`);
  await expect(mention).not.toHaveAttribute("target");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await editor.fill("@qa_");
  await expect.poll(() => options.count()).toBeGreaterThanOrEqual(2);
  await editor.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(editor).toHaveValue("@qa_");
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.fill("Hello @qa_r");
  await expect(options).toHaveCount(1);
  await page.screenshot({ path: "artifacts/mentions-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await options.first().click();
  await expect(editor).toHaveValue("Hello @qa_research ");
  await page.setViewportSize({ width: 1280, height: 900 });
  await editor.fill("Hello @qa_");
  await expect.poll(() => options.count()).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: "artifacts/mentions-desktop.png", fullPage: true });
});

test("suggestion failures preserve typed mentions", async ({ page, context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required.");
  await context.addCookies([cookie]);
  await page.route("**/api/forum/mentions", (route) => route.fulfill({ status: 500, json: { error: "Unavailable" } }));
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Your post", exact: true });
  await editor.fill("Hello @qa_research");
  await expect(page.getByRole("status").filter({ hasText: "Suggestions unavailable" })).toBeVisible();
  await expect(editor).toHaveValue("Hello @qa_research");
});
