import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([JSON.parse(await readFile(".astro/qa-session.json", "utf8"))]);
});

test("typing during multi-file upload preserves the cursor, order and preview; Insert and Remove affect markers", async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let count = 0;
  await page.route("**/api/uploads**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { enabled: true } });
    if (request.method() === "POST" && !request.url().endsWith("/complete"))
      return route.fulfill({ json: { id: `11111111-1111-4111-8111-${String(++count).padStart(12, "0")}`, partBytes: 5000000 } });
    if (request.method() === "PUT") await hold;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  const composer = page.locator("#compose"),
    editor = composer.getByLabel("Your post", { exact: true });
  await expect(composer.getByRole("button", { name: "Add files" })).toBeEnabled();
  await editor.fill("BeforeAfter");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  await composer.locator("input[type=file]").setInputFiles(["one", "two"].map((name) => ({ name: `${name}.txt`, mimeType: "text/plain", buffer: Buffer.from(name) })));
  await expect(editor).toHaveValue(/Before\n\[Uploading one.txt…\].*\n\[Uploading two.txt…\].*\nAfter/);
  await editor.pressSequentially("Typed ");
  release();
  await expect(composer.locator("progress")).toHaveCount(0);
  await expect(editor).toHaveValue(/Before\n\[one.txt\].*\n\[two.txt\].*\nTyped After/);
  await editor.pressSequentially("again ");
  await expect(editor).toHaveValue(/Typed again After$/);
  await composer.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(composer.locator(".preview .attachment-view")).toHaveCount(2);
  const order = await composer.locator(".post-content").evaluate((el) => [...el.children].map((child) => child.textContent));
  expect(order[0]).toBe("Before");
  expect(order[1]).toContain("one.txt");
  expect(order[2]).toContain("two.txt");
  expect(order[3]).toBe("Typed again After");
  await page.screenshot({ path: "artifacts/inline-files-desktop.png", fullPage: true });
  await composer.getByRole("tab", { name: "Write", exact: true }).click();
  await editor.fill("Before\nAfter");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(7, 7));
  await composer.getByRole("button", { name: "Insert", exact: true }).first().click();
  await expect(editor).toHaveValue(/Before\n\[one.txt\].*\nAfter/);
  await composer.getByRole("button", { name: "Insert", exact: true }).first().click();
  await composer.getByRole("button", { name: "Remove one.txt" }).click();
  await expect(editor).not.toHaveValue(/one.txt/);
  await composer.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(composer.locator(".preview .attachment-view")).toHaveCount(1);
  await expect(composer.locator(".preview .attachment-view")).toContainText("two.txt");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/inline-files-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await composer.getByRole("tab", { name: "Write", exact: true }).click();
  await editor.fill("");
  await composer.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(composer.locator(".preview .attachment-view")).toHaveCount(1);
  await expect(composer.getByText("Your preview will appear here.")).toHaveCount(0);
});

test("retry replaces its original placeholder and cancel removes it without changing surrounding text", async ({ page }) => {
  let fail = true,
    hold = false,
    release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/uploads**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { enabled: true } });
    if (request.method() === "POST" && !request.url().endsWith("/complete")) {
      if (fail) return route.fulfill({ status: 503, json: { error: "Upload failed. Try again." } });
      return route.fulfill({ json: { id: crypto.randomUUID(), partBytes: 5000000 } });
    }
    if (hold && request.method() === "PUT") await wait;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  const composer = page.locator("#compose"),
    editor = composer.getByLabel("Your post", { exact: true });
  await expect(composer.getByRole("button", { name: "Add files" })).toBeEnabled();
  await editor.fill("BeforeAfter");
  await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  const upload = { name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("notes") };
  await composer.locator("input[type=file]").setInputFiles(upload);
  await expect(composer.getByRole("button", { name: "Retry retry.txt" })).toBeVisible();
  await editor.pressSequentially("Typed ");
  fail = false;
  await composer.getByRole("button", { name: "Retry retry.txt" }).click();
  await expect(editor).toHaveValue(/Before\n\[retry.txt\].*\nTyped After/);
  await composer.getByRole("button", { name: "Remove retry.txt" }).click();
  hold = true;
  await composer.locator("input[type=file]").setInputFiles(upload);
  await expect(composer.getByRole("button", { name: "Cancel retry.txt" })).toBeVisible();
  await composer.getByRole("button", { name: "Cancel retry.txt" }).click();
  release();
  await expect(editor).not.toHaveValue(/attachment:/);
  await expect(editor).toHaveValue("Before\nTyped \nAfter");
});
