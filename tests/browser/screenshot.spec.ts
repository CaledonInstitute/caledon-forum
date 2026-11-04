import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("copies a 1080 px wide variable-height PNG for a post and a reply", async ({ page, context, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const post = page.locator("article.post").first();
  const publicId = await post.getAttribute("data-public-id");
  await post.locator("[data-share-menu]").click();
  await page.getByRole("button", { name: "Copy as screenshot", exact: true }).click();
  await expect(page.locator("[data-share-status]")).toHaveText("Screenshot copied. Paste it into another app.", { timeout: 20000 });
  const type = await page.evaluate(async () => (await navigator.clipboard.read())[0].types);
  expect(type).toContain("image/png");
  const paths = [`/api/screenshot/${publicId}.png`];
  const mediaId = await page.locator("#post-qa-media").getAttribute("data-public-id");
  if (mediaId) paths.push(`/api/screenshot/${mediaId}.png`);
  await page.getByRole("button", { name: "Close share menu" }).click();
  await page.goto(`/p/${publicId}`);
  const reply = page.locator(".reply-list article.post").first();
  if (await reply.count()) paths.push(`/api/screenshot/${await reply.getAttribute("data-public-id")}.png`);
  await mkdir("artifacts", { recursive: true });
  for (const [i, path] of paths.entries()) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(900);
    await writeFile(`artifacts/screenshot-${i}.png`, bytes);
  }
  expect((await request.get("/api/screenshot/999999999999.png")).status()).toBe(404);
});

test("oversized screenshot reports the server reason for both copy and download", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const error = "This image is too tall to export safely. Open the original image instead.";
  await page.route("**/api/screenshot/*.png", (route) => route.fulfill({ status: 400, json: { error } }));
  await page.goto("/");
  await page.locator("article.post [data-share-menu]").first().click();
  await page.getByRole("button", { name: "Copy as screenshot", exact: true }).click();
  await expect(page.locator("[data-share-status]")).toHaveText(error);
  await page.getByRole("link", { name: "Download screenshot", exact: true }).click();
  await expect(page.locator("[data-share-status]")).toHaveText(error);
});
