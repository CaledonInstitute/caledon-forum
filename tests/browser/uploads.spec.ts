import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { createIdentity, decryptMessage } from "../../src/lib/dm-crypto";
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
async function mockUploads(page: Page) {
  await page.route("**/api/uploads**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { enabled: true } });
    if (request.method() === "POST" && !request.url().endsWith("/complete")) return route.fulfill({ json: { id: crypto.randomUUID(), partBytes: 5 * 1024 * 1024 } });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/files/*", (route) => route.fulfill({ contentType: "image/png", body: image }));
}
test.beforeEach(async ({ context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Run seed-local first");
  await context.addCookies([cookie]);
});
test("uploads multiple files, previews them and preserves IDs when publishing an attachment-only post", async ({ page }) => {
  await mockUploads(page);
  await page.goto("/");
  const composer = page.locator("#compose");
  await expect(composer.getByRole("button", { name: "Add files" })).toBeEnabled();
  await composer.locator("input[type=file]").setInputFiles([
    { name: "research.png", mimeType: "image/png", buffer: image },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Notes") },
  ]);
  await expect(composer.locator(".attachment-draft strong").filter({ hasText: "research.png" })).toBeVisible();
  await expect(composer.locator(".attachment-draft strong").filter({ hasText: "notes.txt" })).toBeVisible();
  await expect(composer.locator("progress")).toHaveCount(0);
  await composer.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(composer.locator(".attachment-view")).toHaveCount(2);
  await expect(composer.locator(".attachment-view img")).toBeVisible();
  await composer.getByRole("tab", { name: "Write", exact: true }).click();
  let payload: any;
  await page.route("**/api/forum/publish", (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: "Review fixture" } });
  });
  await composer.getByRole("button", { name: "Post", exact: true }).click();
  await expect(composer.getByRole("alert")).toHaveText("Review fixture");
  expect(payload.body).toMatch(/\[research\.png\]\(attachment:[0-9a-f-]{36}\)\n+\[notes\.txt\]\(attachment:[0-9a-f-]{36}\)/);
  expect(payload.attachmentIds).toHaveLength(2);
  await page.screenshot({ path: "artifacts/uploads-composer-desktop.png", fullPage: true });
});
test("validates files, accepts pasted images in the editor and lets users remove attachments", async ({ page }) => {
  await mockUploads(page);
  await page.goto("/");
  const composer = page.locator("#compose");
  await expect(composer.getByRole("button", { name: "Add files" })).toBeEnabled();
  await composer.locator("input[type=file]").setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(composer.getByText(/Choose a JPEG/)).toBeVisible();
  await composer.getByLabel("Your post", { exact: true }).evaluate((el, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  }, Array.from(image));
  await expect(composer.getByText("pasted.png", { exact: true })).toBeVisible();
  await composer.getByRole("button", { name: "Remove pasted.png" }).click();
  await expect(composer.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
});
test("profile image controls and destructive account confirmation fit mobile and keyboard use", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockUploads(page);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Choose photo", exact: true })).toBeEnabled();
  await page.locator("input[type=file]").first().setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: image });
  await expect(page.locator("input[name=image]")).toHaveValue(/\/api\/files\//);
  await expect(page.getByRole("button", { name: "Save profile" })).toBeEnabled();
  await page.screenshot({ path: "artifacts/uploads-settings-mobile.png", fullPage: true });
  await page.goto("/settings?category=security");
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const dialog = page.locator(".delete-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Sign in again" })).toBeVisible();
  await expect(dialog.getByText(/cannot be undone/)).toBeVisible();
  await page.screenshot({ path: "artifacts/delete-account-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("DM uploads ciphertext and keeps attachment names and keys inside the encrypted message", async ({ page, context }) => {
  const cookie = JSON.parse(await readFile(".astro/qa-dm-sender-session.json", "utf8"));
  await context.addCookies([cookie]);
  const password = "Local-DM-browser-password-123";
  const owner = await createIdentity("qa-dm-sender", 1, password),
    peer = await createIdentity("peer", 1, password);
  const conversationId = crypto.randomUUID();
  let outgoing: any, uploadMetadata: any, uploadedBytes: Buffer | undefined;
  await page.route("**/api/dm/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    let result: any = { ok: true, items: [] };
    if (action === "vault") result = { userId: "qa-dm-sender", version: 1, hasPassword: true, publicKey: owner.identity.publicKey, vault: owner.vault };
    if (action === "inbox")
      result = { unread: 0, items: [{ id: conversationId, peerId: "peer", name: "Recipient", username: "recipient", image: null, unread: 0, updated_at: 1 }] };
    if (action === "messages")
      result = {
        items: [],
        blocked: false,
        ownBlocked: false,
        peer: {
          id: "peer",
          name: "Recipient",
          username: "recipient",
          image: null,
          publicKey: JSON.stringify(peer.identity.publicKey),
          version: 1,
          emailVerified: true,
          suspended: false,
          invalidated: false,
        },
      };
    if (action === "send") outgoing = route.request().postDataJSON();
    return route.fulfill({ json: result });
  });
  await page.route("**/api/uploads**", async (route) => {
    const r = route.request();
    if (r.method() === "GET") return route.fulfill({ json: { enabled: true } });
    if (r.method() === "PUT") {
      uploadedBytes = r.postDataBuffer()!;
      return route.fulfill({ json: { ok: true } });
    }
    if (r.method() === "POST" && !r.url().endsWith("/complete")) {
      uploadMetadata = r.postDataJSON();
      return route.fulfill({ json: { id: crypto.randomUUID(), partBytes: 5 * 1024 * 1024 } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/dm");
  await page.getByLabel("Account password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock DM", exact: true }).click();
  await page.locator(`.dm-inbox a[href="/dm/${conversationId}"]`).click();
  await expect(page.getByRole("button", { name: "Add files" })).toBeEnabled();
  await page.locator("input[type=file]").setInputFiles({ name: "secret-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Confidential attachment") });
  await expect(page.getByText("secret-notes.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => !!outgoing).toBe(true);
  expect(uploadMetadata.name).toBe("encrypted.bin");
  expect(uploadedBytes?.toString()).not.toContain("Confidential attachment");
  expect(JSON.stringify(outgoing)).not.toContain("secret-notes.txt");
  const payload = await decryptMessage(
    peer.identity,
    {
      id: outgoing.id,
      conversation_id: conversationId,
      sender_id: "qa-dm-sender",
      sender_version: 1,
      recipient_version: 1,
      sender_public_key: JSON.stringify(owner.identity.publicKey),
      envelopes: JSON.stringify(outgoing.envelopes),
    },
    "qa-dm-sender"
  );
  expect(payload.attachments?.[0].name).toBe("secret-notes.txt");
  expect(outgoing.attachmentIds).toEqual([payload.attachments![0].id]);
});
