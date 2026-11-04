import { simplePdf } from "./media-fixtures";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createIdentity, encryptMessage } from "../../src/lib/dm-crypto";

for (const width of [1280, 390]) {
  test(`post PDF scrolls through pages at ${width}px without opening the post`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/qa-scroll.pdf", (route) => route.fulfill({ contentType: "application/pdf", body: simplePdf() }));
    await page.route("**/qa-post-should-not-open", (route) => route.fulfill({ contentType: "text/html", body: "Post opened" }));
    await page.goto("/");
    await page.evaluate(() => {
      const post = document.createElement("article");
      post.dataset.postUrl = "/qa-post-should-not-open";
      post.innerHTML =
        '<p data-qa-post-body>Post with PDF</p><button type="button" data-qa-post-action>Post action</button><figure class="attachment-view"><div class="pdf-inline" data-pdf="/qa-scroll.pdf"></div></figure>';
      post.querySelector("button")!.addEventListener("click", (event) => {
        (event.currentTarget as HTMLButtonElement).textContent = "Action clicked";
      });
      document.querySelector("main")!.prepend(post);
    });
    const pdf = page.locator('[data-pdf="/qa-scroll.pdf"]');
    await pdf.scrollIntoViewIfNeeded();
    await expect(pdf.locator(".textLayer").first()).toContainText("Hello PDF");
    await pdf.hover();
    await page.mouse.wheel(0, 650);
    await expect.poll(() => pdf.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(pdf.locator('[data-page="2"] .textLayer')).toContainText("Hello PDF");
    const sheet = pdf.locator('[data-page="2"]');
    expect(await sheet.locator(".textLayer").evaluate((el) => el.offsetParent === el.parentElement)).toBe(true);
    const url = page.url();
    await pdf.click({ position: { x: 40, y: 40 } });
    await expect(page).toHaveURL(url);
    await page.locator("[data-qa-post-action]").click();
    await expect(page.locator("[data-qa-post-action]")).toHaveText("Action clicked");
    await expect(page).toHaveURL(url);
    await page.locator("[data-qa-post-body]").click();
    await expect(page).toHaveURL(/\/qa-post-should-not-open$/);
  });
}

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

test("audio duration and video poster load before play on dynamic posts", async ({ page }) => {
  await page.route("**/qa-audio.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wave() }));
  await page.route("**/qa-video.mp4", async (route) => route.fulfill({ contentType: "video/mp4", body: await readFile("tests/fixtures/tiny.mp4") }));
  await page.goto("/");
  await page.evaluate(() => {
    const figure = document.createElement("figure");
    figure.className = "attachment-view";
    figure.innerHTML =
      '<audio controls preload="metadata" src="/qa-audio.wav"></audio><span data-media-duration></span><video controls preload="metadata" src="/qa-video.mp4"></video>';
    document.querySelector("main")!.insertBefore(figure, document.querySelector("main")!.firstChild);
  });
  const audio = page.locator('audio[src="/qa-audio.wav"]');
  const video = page.locator('video[src="/qa-video.mp4"]');
  await expect.poll(() => audio.evaluate((el) => (el as HTMLAudioElement).duration)).toBe(1);
  await expect(video).toHaveAttribute("poster", /^blob:/);
  await expect(page.locator("[data-media-duration]")).toHaveText("0:01");
  expect(await video.evaluate((el) => (el as HTMLVideoElement).paused)).toBe(true);
  await page.screenshot({ path: "artifacts/inline-media.png" });
});

test("DM decrypts visible media automatically, retries errors and disposes blobs on lock", async ({ page, context }) => {
  await context.addCookies([JSON.parse(await readFile(".astro/qa-dm-sender-session.json", "utf8"))]);
  const password = "Local-DM-browser-password-123";
  const owner = await createIdentity("qa-dm-sender", 1, password);
  const peer = await createIdentity("peer", 1, password);
  const conversationId = "77777777-7777-4777-8777-777777777777";
  const plainFiles = [wave(), await readFile("tests/fixtures/tiny.mp4"), simplePdf()];
  const encrypted = new Map<string, Buffer>();
  const files = await Promise.all(
    plainFiles.map(async (bytes, i) => {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const id = `88888888-8888-4888-8888-88888888888${i}`;
      encrypted.set(id, Buffer.from(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(bytes))));
      return {
        id,
        name: ["voice.wav", "clip.mp4", "research.pdf"][i]!,
        mime: ["audio/wav", "video/mp4", "application/pdf"][i]!,
        size: bytes.length,
        key: Buffer.from(await crypto.subtle.exportKey("raw", key)).toString("base64"),
        iv: Buffer.from(iv).toString("base64"),
      };
    })
  );
  const ctx = { id: crypto.randomUUID(), conversationId, senderId: "peer", recipientId: "qa-dm-sender", senderVersion: 1, recipientVersion: 1 };
  const envelopes = await encryptMessage(peer.identity, owner.identity.publicKey, ctx, { text: "Media fixture", attachments: files });
  await page.route("**/api/dm/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    let result: unknown = { ok: true, items: [] };
    const peerData = {
      id: "peer",
      name: "Recipient",
      username: "recipient",
      image: null,
      publicKey: JSON.stringify(peer.identity.publicKey),
      version: 1,
      emailVerified: true,
      suspended: false,
      invalidated: false,
    };
    if (action === "vault") result = { userId: "qa-dm-sender", version: 1, hasPassword: true, publicKey: owner.identity.publicKey, vault: owner.vault };
    if (action === "inbox")
      result = { unread: 0, items: [{ id: conversationId, peerId: "peer", name: "Recipient", username: "recipient", image: null, unread: 0, updated_at: 1 }] };
    if (action === "messages")
      result = {
        peer: peerData,
        blocked: false,
        ownBlocked: false,
        items: [
          {
            id: ctx.id,
            conversation_id: conversationId,
            sender_id: "peer",
            sender_version: 1,
            recipient_version: 1,
            sender_public_key: JSON.stringify(peer.identity.publicKey),
            envelopes: JSON.stringify(envelopes),
            created_at: Date.now(),
          },
        ],
      };
    await route.fulfill({ json: result });
  });
  let fail = true;
  await page.route("**/api/files/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    if (fail && id === files[0].id) return route.fulfill({ status: 503 });
    return route.fulfill({ contentType: "application/octet-stream", body: encrypted.get(id)! });
  });
  await page.goto("/dm");
  await page.getByLabel("Account password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock DM", exact: true }).click();
  await page.locator(`.dm-inbox a[href="/dm/${conversationId}"]`).click();
  await page.locator(".private-attachment").first().scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Retry voice.wav" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry voice.wav" }).click();
  const audio = page.locator(".private-attachment audio"),
    video = page.locator(".private-attachment video");
  await expect.poll(() => audio.evaluate((el) => (el as HTMLAudioElement).duration)).toBe(1);
  await video.scrollIntoViewIfNeeded();
  await expect(video).toHaveAttribute("poster", /^blob:/);
  await expect.poll(() => video.evaluate((el) => !(el as HTMLVideoElement).seeking)).toBe(true);
  const pdf = page.locator(".private-attachment .pdf-inline");
  await pdf.scrollIntoViewIfNeeded();
  await expect(pdf.locator(".textLayer").first()).toContainText("Hello PDF");
  await expect(page.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", /^blob:/);
  await expect(page.locator(".private-attachment [data-media-duration]")).toHaveText("0:01");
  await page.setViewportSize({ width: 390, height: 844 });
  await audio.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const blob = await audio.getAttribute("src");
  await page.screenshot({ path: "artifacts/dm-inline-media.png" });
  expect(await page.evaluate(async (url) => (await fetch(url!)).ok, blob)).toBe(true);
  await page.getByRole("link", { name: "Back to inbox" }).click();
  await expect(page.locator(".private-attachment")).toHaveCount(0);
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url!);
        return false;
      } catch {
        return true;
      }
    }, blob)
  ).toBe(true);
  await page.locator(`.dm-inbox a[href="/dm/${conversationId}"]`).click();
  await page.locator(".private-attachment").first().scrollIntoViewIfNeeded();
  await expect(page.locator(".private-attachment audio")).toBeVisible();
  const secondBlob = await page.locator(".private-attachment audio").getAttribute("src");
  await page.evaluate(() => document.dispatchEvent(new Event("forum:dm-locked")));
  await expect(page.locator(".private-attachment audio, .private-attachment video, .private-attachment .pdf-inline")).toHaveCount(0);
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url!);
        return false;
      } catch {
        return true;
      }
    }, secondBlob)
  ).toBe(true);
});
