import { simplePdf } from "./media-fixtures";
import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createIdentity } from "../../src/lib/dm-crypto";

test.beforeEach(async ({ context }) => {
  await context.addCookies([JSON.parse(await readFile(".astro/qa-session.json", "utf8"))]);
});

test("the editor accepts typing after the first click in its empty writing area", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Your post", exact: true });
    await expect(editor).toBeVisible();
    const bounds = (await editor.boundingBox())!;
    for (const [x, y] of [
      [2, 2],
      [20, 20],
      [bounds.width - 2, bounds.height - 2],
      [bounds.width / 2, bounds.height / 2],
    ]) {
      await page.locator(".composer-head strong").click();
      await expect(editor).not.toBeFocused();
      await page.mouse.click(bounds.x + x, bounds.y + y);
      await expect(editor).toBeFocused();
      expect(await editor.evaluate((el) => el.contains(window.getSelection()?.anchorNode || null))).toBe(true);
      await page.keyboard.type("First click draft");
      await expect(editor).toHaveText("First click draft");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
    }
    await editor.fill("Existing draft");
    await page.locator(".composer-head strong").click();
    const paragraph = (await editor.locator("p").boundingBox())!;
    await page.mouse.click(paragraph.x + 1, paragraph.y + paragraph.height / 2);
    await page.keyboard.type("Start ");
    await expect(editor).toHaveText("Start Existing draft");
  }
});

test("visual editor publishes italic, edits JSON content, without preview tabs", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/qa_caledon");
  const editor = page.getByRole("textbox", { name: "Your post", exact: true });
  await expect(editor).toBeVisible();
  const label = `Visual regression ${Date.now()}`;
  await editor.fill(label);
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await expect(editor.locator("em")).toHaveText(label);
  expect(await editor.locator("em").evaluate((el) => getComputedStyle(el).fontSynthesis)).toContain("style");
  await expect(editor.locator("em")).toHaveText(label);
  const publishing = page.waitForRequest((r) => r.url().endsWith("/api/forum/publish"));
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const sent = (await publishing).postDataJSON();
  expect(sent.document.version).toBe(1);
  await expect(page.locator(".publish-toast [role=status]")).toHaveText("Post published.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).toHaveText("");
  const card = page.locator("[data-post-list] article").filter({ hasText: label }).first();
  await expect(card.locator(".post-content em")).toHaveText(label);
  const id = await card.getAttribute("data-post-id");
  try {
    await page.goto(`/edit/${id}`);
    const editing = page.getByRole("textbox", { name: "Your post", exact: true });
    await expect(editing.locator("em")).toHaveText(label);
    await editing.press("End");
    await editing.pressSequentially(" edited");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.locator(".post-detail .post-content")).toContainText(label + " edited");
  } finally {
    await page.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id } });
  }
});

test("inserts tables, language-tagged code, formulas and mention with keyboard", async ({ page }) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Your post", exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("Structured content");
  await editor.press("End");
  await editor.press("Enter");
  await page.locator(".editor-toolbar summary").click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(editor.locator("table")).toBeVisible();
  await page.getByRole("button", { name: "Delete table", exact: true }).click();
  await expect(editor.locator("table")).toHaveCount(0);
  await page.getByRole("button", { name: "Code block", exact: true }).click();
  await page.getByLabel("Code language", { exact: true }).fill("python");
  await page.locator(".editor-panel").getByRole("button", { name: "Insert", exact: true }).click();
  await editor.pressSequentially("print(42)");
  await expect(editor.locator("pre code")).toContainText("print(42)");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.press("Enter");
  await page.getByRole("button", { name: "Formula", exact: true }).click();
  await page.getByLabel("LaTeX formula", { exact: true }).fill("x^2");
  await page.locator(".editor-panel").getByRole("button", { name: "Insert", exact: true }).click();
  await expect(editor.locator(".katex")).toBeVisible();
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("@qa_re");
  await expect(page.getByRole("option").filter({ hasText: "qa_research" })).toBeVisible();
  await editor.press("Enter");
  await expect(editor.locator('[data-mention="qa_research"]')).toBeVisible();
});

test("profile tabs, marketplace and admin access fit mobile widths", async ({ page }) => {
  await mkdir("artifacts", { recursive: true });
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/qa_caledon?tab=media");
    const tabs = page.getByRole("navigation", { name: "Profile activity" });
    await expect(tabs.locator("a")).toHaveCount(5);
    await expect(tabs.locator('[aria-current="page"]')).toContainText("Media");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/profile-update-${width}.png`, fullPage: true });
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { name: "Marketplace", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/marketplace-${width}.png`, fullPage: true });
  }
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Administrator access required." })).toBeVisible();
});

test("ordinary seller publishes, edits and closes a listing; contact includes its context", async ({ page, context }) => {
  await context.clearCookies();
  await context.addCookies([JSON.parse(await readFile(".astro/qa-dm-sender-session.json", "utf8"))]);
  const vault = await (await page.request.get("/api/dm/vault")).json();
  if (!vault.vault) {
    const created = await createIdentity("qa-dm-sender", vault.version, "Local-DM-browser-password-123");
    const response = await page.request.post("/api/dm/vault", {
      headers: { origin: "http://localhost:4321" },
      data: { password: "Local-DM-browser-password-123", version: vault.version, publicKey: created.identity.publicKey, vault: created.vault },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto("/marketplace/new");
  await page.getByLabel("Title", { exact: true }).fill("Browser test keyboard");
  await page.getByLabel("Description", { exact: true }).fill("A working keyboard for a local browser regression test.");
  await page.getByLabel("Price (IDR)", { exact: true }).fill("250000");
  await page.getByRole("button", { name: "Publish listing", exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace\/[0-9a-f-]{36}$/);
  const url = page.url(),
    id = url.split("/").pop();
  try {
    await expect(page.getByRole("heading", { name: "Browser test keyboard" })).toBeVisible();
    await page.getByRole("link", { name: "Edit listing", exact: true }).click();
    await page.getByLabel("Price (IDR)", { exact: true }).fill("200000");
    await page.getByRole("button", { name: "Save listing", exact: true }).click();
    await expect(page.locator(".listing-price")).toContainText("200.000");
    await context.clearCookies();
    await context.addCookies([JSON.parse(await readFile(".astro/qa-session.json", "utf8"))]);
    await page.goto(url);
    await expect(page.getByRole("link", { name: "Contact seller" })).toHaveAttribute("href", `/dm?to=qa_dm_sender&listing=${id}`);
    await context.clearCookies();
    await context.addCookies([JSON.parse(await readFile(".astro/qa-dm-sender-session.json", "utf8"))]);
    await page.goto(url);
    await page.getByRole("button", { name: "Close listing", exact: true }).click();
    await expect(page.getByText("This listing is closed.")).toBeVisible();
  } finally {
    await page.request.post("/api/marketplace/delete", { headers: { origin: "http://localhost:4321" }, data: { id } });
  }
});

test("PDF reader loads only on demand, exposes selectable text and offers recovery", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/files/pdf-fixture", (route) => {
    reads++;
    return route.fulfill({ contentType: "application/pdf", body: simplePdf() });
  });
  await page.goto("/");
  expect(reads).toBe(0);
  const sidebarStyle = () =>
    page.locator(".sidebar").evaluate((el) => {
      const css = getComputedStyle(el);
      return { shadow: css.boxShadow, radius: css.borderRadius, border: css.borderTopWidth, padding: css.padding };
    });
  const baseline = await sidebarStyle();
  expect(baseline.shadow).toBe("none");
  expect(baseline.radius).toBe("0px");
  await page.evaluate(() => {
    const reader = document.createElement("div");
    reader.className = "pdf-inline";
    reader.dataset.pdf = "/api/files/pdf-fixture";
    reader.setAttribute("aria-label", "Research.pdf");
    document.body.insertBefore(reader, document.body.firstChild);
  });
  const reader = page.locator(".pdf-inline[aria-label='Research.pdf']");
  await expect(reader.locator(".textLayer").first()).toContainText("Hello PDF");
  await expect(reader.locator(".pdf-sheet")).toHaveCount(2);
  await reader.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(reader.locator(".pdf-sheet").nth(1).locator(".textLayer")).toContainText("Hello PDF");
  expect(await sidebarStyle()).toEqual(baseline);
  expect(reads).toBeGreaterThan(0);
  await expect(reader.getByRole("button")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/pdf-reader.png" });
  await reader.evaluate((el) => el.remove());
  await page.route("**/api/files/pdf-fixture", (route) => route.fulfill({ contentType: "application/pdf", body: "not a PDF" }));
  await page.evaluate(() => {
    const reader = document.createElement("div");
    reader.className = "pdf-inline";
    reader.dataset.pdf = "/api/files/pdf-fixture";
    document.body.insertBefore(reader, document.body.firstChild);
  });
  await expect(page.locator(".pdf-inline")).toContainText("Could not read this PDF");
});
