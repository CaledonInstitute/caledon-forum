import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";

function wave() {
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(16000, 40);
  return bytes;
}

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([JSON.parse(await readFile(".astro/qa-session.json", "utf8"))]);
  let count = 0;
  await page.route("**/api/uploads**", (route) => {
    const request = route.request();
    return route.fulfill({
      json:
        request.method() === "GET"
          ? { enabled: true }
          : {
              id: `11111111-1111-4111-8111-${String(request.method() === "POST" && !request.url().endsWith("/complete") ? ++count : count).padStart(12, "0")}`,
              partBytes: 5000000,
              ok: true,
            },
    });
  });
});

for (const width of [1280, 390]) {
  test(`inline media and compact documents at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/");
    const image = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 160;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#b8d5e6";
        ctx.fillRect(0, 0, 240, 160);
        ctx.fillStyle = "#386149";
        ctx.fillRect(0, 100, 240, 60);
        return canvas.toDataURL().split(",")[1];
      }),
      "base64"
    );
    const video = await readFile("tests/fixtures/tiny.mp4");
    await page.route("**/api/files/*", (route) => {
      const id = route.request().url().slice(-1);
      return route.fulfill({ contentType: id === "1" ? "image/png" : id === "2" ? "video/mp4" : "audio/wav", body: id === "1" ? image : id === "2" ? video : wave() });
    });
    const composer = page.locator("#compose");
    await expect(composer.getByRole("button", { name: "Attach files" })).toBeEnabled();
    await composer.getByRole("textbox", { name: "Your post", exact: true }).fill("Attachment preview");
    const documentName = "research-notes-with-a-very-long-filename-for-mobile-layout.pdf";
    await composer.locator("input[type=file]").setInputFiles([
      { name: "landscape.png", mimeType: "image/png", buffer: image },
      { name: "clip.mp4", mimeType: "video/mp4", buffer: video },
      { name: "recording.wav", mimeType: "audio/wav", buffer: wave() },
      { name: documentName, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
    ]);
    await expect(composer.locator("progress")).toHaveCount(0);
    const img = composer.locator(".editor-media img"),
      player = composer.locator("video"),
      audio = composer.locator("audio");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(240);
    expect((await img.boundingBox())!.width).toBe(240);
    expect((await img.boundingBox())!.height).toBe(160);
    for (const media of [player, audio]) {
      await expect.poll(() => media.evaluate((el: HTMLMediaElement) => el.readyState)).toBeGreaterThanOrEqual(1);
      expect(await media.evaluate((el: HTMLMediaElement) => el.controls && el.paused && !el.autoplay)).toBe(true);
    }
    await expect(player).toHaveAttribute("playsinline", "");
    await expect(player).toHaveAttribute("poster", /^blob:/);
    await expect(composer.locator(".editor-file-card strong")).toHaveAttribute("title", documentName);
    await expect(composer.locator(".editor-file-card small")).toHaveText("8 B");
    await expect(composer.locator(".pdf-inline, iframe, canvas")).toHaveCount(0);
    await composer.getByRole("button", { name: `Remove ${documentName}` }).focus();
    await composer.screenshot({ path: `artifacts/editor-attachments-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await audio.focus();
    await audio.press("Space");
    await expect.poll(() => audio.evaluate((el: HTMLMediaElement) => el.paused)).toBe(false);
    const handle = await audio.elementHandle();
    await composer.getByRole("button", { name: "Remove recording.wav" }).click();
    await expect(audio).toHaveCount(0);
    expect(await handle!.evaluate((el: HTMLMediaElement) => el.paused && !el.hasAttribute("src"))).toBe(true);
    await composer.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(audio).toBeVisible();
    await composer.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(audio).toHaveCount(0);
    await composer.getByRole("button", { name: "Undo", exact: true }).click();
    let payload: any;
    await page.route("**/api/forum/publish", (route) => {
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 400, json: { error: "Review fixture" } });
    });
    await composer.getByRole("button", { name: "Post", exact: true }).click();
    await expect(composer.getByRole("alert")).toHaveText("Review fixture");
    expect(payload.attachmentIds).toHaveLength(4);
    expect(payload.body).toContain("Attachment preview");
    expect(payload.body).toContain("[recording.wav](attachment:");
  });
}

test("failed media preview retains filename and remove action", async ({ page }) => {
  await page.route("**/api/files/*", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  const composer = page.locator("#compose");
  await expect(composer.getByRole("button", { name: "Attach files" })).toBeEnabled();
  await composer.locator("input[type=file]").setInputFiles({ name: "missing.png", mimeType: "image/png", buffer: Buffer.from("broken") });
  await expect(composer.getByRole("status")).toHaveText("Preview unavailable. Remove the file and upload it again.");
  await expect(composer.locator(".editor-media strong")).toHaveText("missing.png");
  await composer.getByRole("button", { name: "Remove missing.png" }).click();
  await expect(composer.locator(".editor-attachment")).toHaveCount(0);
});

test("existing attachments render when reopening Markdown and visual posts for editing", async ({ page, baseURL }) => {
  if (new URL(baseURL!).hostname !== "localhost") throw new Error("Editor fixtures require the local browser-test environment.");
  const id = "22222222-2222-4222-8222-222222222222";
  const postId = "qa-editor-attachment";
  const body = `Before\n\n[existing.png](attachment:${id})\n\nAfter`;
  const doc = JSON.stringify({
    version: 1,
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before" }] },
        { type: "attachment", attrs: { id, name: "existing.png" } },
        { type: "paragraph", content: [{ type: "text", text: "After" }] },
      ],
    },
  });
  const sql = async (statements: string) => {
    await writeFile(".astro/editor-attachment-browser.sql", statements);
    execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "caledon-forum-db", "--local", "--file", ".astro/editor-attachment-browser.sql"], {
      windowsHide: true,
      stdio: "pipe",
    });
  };
  await sql(`INSERT OR IGNORE INTO posts(id,author_id,body,created_at,updated_at) VALUES('${postId}','qa-alice','${body}',${Date.now()},${Date.now()});
    INSERT OR IGNORE INTO uploads(id,owner_id,purpose,name,mime,size,object_key,state,created_at,expires_at) VALUES('${id}','qa-alice','post','existing.png','image/png',100,'editor-attachment-browser','ready',${Date.now()},${Date.now() + 86400000});
    INSERT OR IGNORE INTO post_attachments(post_id,asset_id,position) VALUES('${postId}','${id}',0);`);
  await page.route("**/api/files/*", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64") })
  );
  try {
    for (const initialDocument of ["NULL", `'${doc}'`]) {
      await sql(`UPDATE posts SET editor_doc=${initialDocument} WHERE id='${postId}';`);
      await page.goto(`/edit/${postId}`);
      const editor = page.locator(".visual-editor");
      await expect(editor.locator(".editor-media img")).toBeVisible();
      await expect(editor.locator(".editor-file-details strong")).toHaveText("existing.png");
      await expect(editor).toContainText("Before");
      await expect(editor).toContainText("After");
      expect((await editor.locator("img").boundingBox())!.width).toBe(1);
      await page.getByRole("button", { name: "Remove existing.png" }).click();
      await expect(editor.locator(".editor-attachment")).toHaveCount(0);
    }
  } finally {
    await sql(`DELETE FROM post_attachments WHERE post_id='${postId}'; DELETE FROM uploads WHERE id='${id}'; DELETE FROM posts WHERE id='${postId}';`);
  }
});
