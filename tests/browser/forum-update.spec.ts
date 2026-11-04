import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createIdentity } from "../../src/lib/dm-crypto";

test.beforeEach(async ({ context }) => {
  await context.addCookies([JSON.parse(await readFile(".astro/qa-session.json", "utf8"))]);
});

test("visual editor publishes italic, edits JSON content, and keeps preview state", async ({ page }) => {
  await page.goto("/qa_caledon");
  const editor = page.getByRole("textbox", { name: "Your post", exact: true });
  await expect(editor).toBeVisible();
  const label = `Visual regression ${Date.now()}`;
  await editor.fill(label);
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await expect(editor.locator("em")).toHaveText(label);
  expect(await editor.locator("em").evaluate((el) => getComputedStyle(el).fontSynthesis)).toContain("style");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator(".preview em")).toHaveText(label);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect(editor.locator("em")).toHaveText(label);
  const publishing = page.waitForRequest((r) => r.url().endsWith("/api/forum/publish"));
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const sent = (await publishing).postDataJSON();
  expect(sent.document.version).toBe(1);
  await expect(page.locator(".publish-toast [role=status]")).toHaveText("Post published.");
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
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(page.locator(".preview .katex")).toBeVisible();
  await expect(page.locator(".preview .hljs")).toBeVisible();
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

function simplePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 30 350 Td (Hello PDF) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(result.length);
    result += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = result.length;
  result +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result);
}
test("PDF reader loads only on demand, exposes selectable text and offers recovery", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/files/pdf-fixture", (route) => {
    reads++;
    return route.fulfill({ contentType: "application/pdf", body: simplePdf() });
  });
  await page.goto("/");
  expect(reads).toBe(0);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.dataset.pdf = "/api/files/pdf-fixture";
    button.dataset.pdfName = "Research.pdf";
    button.textContent = "Read fixture";
    document.body.appendChild(button);
  });
  await page.getByRole("button", { name: "Read fixture" }).click();
  const reader = page.getByRole("dialog", { name: "Research.pdf" });
  await expect(reader).toBeVisible();
  await expect(reader.locator(".textLayer")).toContainText("Hello PDF");
  expect(reads).toBeGreaterThan(0);
  await reader.getByRole("button", { name: "Zoom in" }).click();
  await expect(reader.locator(".textLayer")).toContainText("Hello PDF");
  expect(await reader.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0);
  await page.screenshot({ path: "artifacts/pdf-reader.png" });
  await reader.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Read fixture" })).toBeFocused();
  await page.route("**/api/files/pdf-fixture", (route) => route.fulfill({ contentType: "application/pdf", body: "not a PDF" }));
  await page.getByRole("button", { name: "Read fixture" }).click();
  await expect(reader.getByRole("status")).toContainText("Could not read this PDF");
  await expect(reader.getByRole("link", { name: "Download", exact: true })).toBeVisible();
});

test("admin can replace and remove an announcement, and moderation fits mobile", async ({ page, context }) => {
  await context.clearCookies();
  await context.addCookies([JSON.parse(await readFile(".astro/qa-admin-session.json", "utf8"))]);
  const created = await (await page.request.post("/api/forum/publish", { headers: { origin: "http://localhost:4321" }, data: { body: "Announcement browser regression" } })).json();
  await page.request.post("/api/forum/report", {
    headers: { origin: "http://localhost:4321" },
    data: { id: created.id, reason: `Local mobile moderation fixture ${created.id}. ` + "Review the conversation and its context. ".repeat(12) },
  });
  let reportId: string | null = null;
  try {
    await page.goto(created.url);
    const card = page.locator(".post-detail");
    await card.locator('summary[aria-label="More actions"]').click();
    await card.getByRole("button", { name: "Pin as announcement" }).click();
    await expect(card.locator("[data-pin]")).toHaveAttribute("data-pinned", "true");
    await page.goto("/");
    await expect(page.locator("[data-announcement]")).toContainText("Announcement browser regression");
    await expect(page.locator(`[data-post-list] [data-post-id="${created.id}"]`)).toHaveCount(0);
    for (const width of [360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin");
      await expect(page.locator(".admin-tabs")).toBeVisible();
      const report = page.locator(".moderation-report").filter({ hasText: `Local mobile moderation fixture ${created.id}.` });
      await report.locator(".report-actions summary").click();
      await expect(report.getByRole("button", { name: "Remove post", exact: true })).toBeVisible();
      reportId = await report.locator('[data-operation="resolve"]').getAttribute("data-moderate");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/admin-${width}.png`, fullPage: true });
    }
    await page.getByRole("link", { name: "History", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Recent moderation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open reports" })).toBeHidden();
    await page.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id: created.id } });
    await page.goto("/");
    await expect(page.locator("[data-announcement] article")).toHaveCount(0);
  } finally {
    if (reportId) await page.request.post("/api/forum/moderate", { headers: { origin: "http://localhost:4321" }, data: { id: reportId, operation: "resolve" } });
    await page.request.post("/api/forum/delete", { headers: { origin: "http://localhost:4321" }, data: { id: created.id } });
  }
});
