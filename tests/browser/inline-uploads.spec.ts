import { readFile } from "node:fs/promises";
import { test, expect, type Locator } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([JSON.parse(await readFile(".astro/qa-session.json", "utf8"))]);
});
async function caret(editor: Locator, offset: number) {
  await editor.evaluate((el, offset) => {
    const text = el.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, offset);
    range.collapse(true);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    (el as HTMLElement).focus();
  }, offset);
}

test("typing during multi-file upload preserves file order and surrounding visual content", async ({ page }) => {
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
    editor = composer.getByRole("textbox", { name: "Your post", exact: true });
  await expect(composer.getByRole("button", { name: "Attach files" })).toBeEnabled();
  await editor.fill("BeforeAfter");
  await caret(editor, 6);
  await composer.locator("input[type=file]").setInputFiles(["one", "two"].map((name) => ({ name: `${name}.txt`, mimeType: "text/plain", buffer: Buffer.from(name) })));
  await expect(editor.locator(".editor-attachment")).toHaveCount(2);
  await editor.pressSequentially("Typed ");
  release();
  await expect(composer.locator("progress")).toHaveCount(0);
  await expect(editor.locator(".editor-attachment strong")).toHaveText(["one.txt", "two.txt"]);
  await expect(editor).toContainText("Before");
  await expect(editor).toContainText("After");
  await expect(editor).toContainText("Typed");
  await expect(editor.locator(".editor-attachment strong")).toHaveText(["one.txt", "two.txt"]);
  await composer.getByRole("button", { name: "Remove one.txt" }).click();
  await expect(editor.locator(".editor-attachment strong")).toHaveText(["two.txt"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/inline-files-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await composer.locator(".editor-toolbar summary").click();
  await expect
    .poll(() =>
      composer.locator(".editor-insert").evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      })
    )
    .toBe(true);
  await page.screenshot({ path: "artifacts/editor-menu-mobile.png" });
});

test("retry replaces its visual placeholder and cancel removes it without losing text", async ({ page }) => {
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
    editor = composer.getByRole("textbox", { name: "Your post", exact: true });
  await expect(composer.getByRole("button", { name: "Attach files" })).toBeEnabled();
  await editor.fill("BeforeAfter");
  await caret(editor, 6);
  const upload = { name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("notes") };
  await composer.locator("input[type=file]").setInputFiles(upload);
  await expect(composer.getByRole("button", { name: "Retry retry.txt" })).toBeVisible();
  await editor.pressSequentially("Typed ");
  fail = false;
  await composer.getByRole("button", { name: "Retry retry.txt" }).click();
  await expect(editor.locator(".editor-attachment strong")).toHaveText(["retry.txt"]);
  await expect(editor).toContainText("Typed");
  await expect(editor).toContainText("After");
  await composer.getByRole("button", { name: "Remove retry.txt" }).click();
  hold = true;
  await composer.locator("input[type=file]").setInputFiles(upload);
  await expect(composer.getByRole("button", { name: "Cancel retry.txt" })).toBeVisible();
  await composer.getByRole("button", { name: "Cancel retry.txt" }).click();
  release();
  await expect(editor.locator(".editor-attachment")).toHaveCount(0);
  await expect(editor).toContainText("Before");
  await expect(editor).toContainText("After");
  await expect(editor).toContainText("Typed");
});

test("undo and redo keep completed attachment IDs synchronized with publish", async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/uploads**", (route) => route.fulfill({ json: route.request().method() === "GET" ? { enabled: true } : { id, partBytes: 5000000, ok: true } }));
  await page.goto("/");
  const composer = page.locator("#compose");
  await expect(composer.getByRole("button", { name: "Attach files" })).toBeEnabled();
  await composer.locator("input[type=file]").setInputFiles({ name: "undo.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
  await expect(composer.getByRole("button", { name: "Remove undo.txt" })).toBeVisible();
  await composer.getByRole("button", { name: "Remove undo.txt" }).click();
  await expect(composer.locator(".editor-attachment")).toHaveCount(0);
  await composer.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(composer.getByRole("button", { name: "Remove undo.txt" })).toBeVisible();
  await composer.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(composer.locator(".editor-attachment")).toHaveCount(0);
  await composer.getByRole("button", { name: "Undo", exact: true }).click();
  let payload: any;
  await page.route("**/api/forum/publish", (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: "Review fixture" } });
  });
  await composer.getByRole("button", { name: "Post", exact: true }).click();
  await expect(composer.getByRole("alert")).toHaveText("Review fixture");
  expect(payload.attachmentIds).toEqual([id]);
  expect(payload.body).toContain(`attachment:${id}`);
  expect(JSON.stringify(payload.document)).not.toContain("pending-");
});
