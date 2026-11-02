import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { createIdentity, encryptMessage } from "../../src/lib/dm-crypto";
import { attachmentMarker } from "../../src/lib/attachment-markers";

test("day groups merge across history pages; files stay inline and message actions support keyboard and touch", async ({ page, context }) => {
  test.setTimeout(90000);
  const password = "Local-DM-browser-password-123";
  await context.addCookies([JSON.parse(await readFile(".astro/qa-dm-sender-session.json", "utf8"))]);
  const owner = await createIdentity("qa-dm-sender", 1, password),
    peer = await createIdentity("peer", 1, password);
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const file = { id: "22222222-2222-4222-8222-222222222222", name: "research-notes.txt", mime: "text/plain", size: 12, key: btoa("a".repeat(32)), iv: btoa("b".repeat(12)) };
  const items = await Promise.all(
    Array.from({ length: 53 }, async (_, i) => {
      const seq = i + 1;
      const ctx = { id: crypto.randomUUID(), conversationId, senderId: "qa-dm-sender", recipientId: "peer", senderVersion: 1, recipientVersion: 1 };
      const payload = {
        text: seq === 53 ? `Before the file\n${attachmentMarker(file)}\nAfter the file` : `Message ${seq}: ${"A research note with enough context to read. ".repeat(4)}`,
        ...(seq === 53 ? { attachments: [file] } : {}),
      };
      return {
        ...ctx,
        seq,
        conversation_id: conversationId,
        sender_id: "qa-dm-sender",
        sender_version: 1,
        recipient_version: 1,
        sender_public_key: JSON.stringify(owner.identity.publicKey),
        envelopes: JSON.stringify(await encryptMessage(owner.identity, peer.identity.publicKey, ctx, payload)),
        created_at: Date.parse(seq === 1 ? "2026-10-31T10:00:00Z" : seq < 30 ? "2026-11-01T10:00:00Z" : "2026-11-02T10:00:00Z") + seq * 1000,
      };
    })
  );
  let deletions = 0;
  await page.route("**/api/dm/**", async (route) => {
    const url = new URL(route.request().url()),
      action = url.pathname.split("/").at(-1);
    let result: any = { ok: true, items: [] };
    if (action === "vault") result = { userId: "qa-dm-sender", version: 1, hasPassword: true, publicKey: owner.identity.publicKey, vault: owner.vault };
    if (action === "inbox") result = { unread: 0, items: [{ id: conversationId, name: "Research partner", username: "peer", peerId: "peer", unread: 0 }] };
    if (action === "messages")
      result = {
        items: url.searchParams.has("before") ? items.slice(0, 3).reverse() : items.slice(2).reverse(),
        blocked: false,
        ownBlocked: false,
        peer: { id: "peer", name: "Research partner", username: "peer", publicKey: JSON.stringify(peer.identity.publicKey), version: 1 },
      };
    if (action === "delete") deletions++;
    await route.fulfill({ json: result });
  });
  await page.goto("/dm");
  await page.getByLabel("Account password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock DM", exact: true }).click();
  await page.locator(`.dm-inbox a[href="/dm/${conversationId}"]`).click();
  await expect(page.locator(".dm-message")).toHaveCount(50);
  await expect(page.locator(".dm-day")).toHaveText(["Nov 1", "Nov 2"]);
  const history = page.locator(".dm-history");
  await history.evaluate((el) => (el.scrollTop = 0));
  const anchor = page.locator(".dm-message").first();
  const id = await anchor.getAttribute("class");
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(page.locator(".dm-message")).toHaveCount(53);
  await expect(page.locator(".dm-day")).toHaveText(["Oct 31", "Nov 1", "Nov 2"]);
  const after = await page
    .locator(".dm-message")
    .nth(3)
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(3);
  const last = page.locator(".dm-message").last();
  await last.scrollIntoViewIfNeeded();
  const order = await last.locator(".dm-bubble").evaluate((el) => [...el.children].map((child) => child.textContent));
  expect(order).toEqual(["Before the file\n", "Open research-notes.txt", "After the file"]);
  await expect(last.locator("time")).toHaveText("17:00");
  await expect(last.locator("time")).toHaveAttribute("title", "Nov 2 17:00 GMT+7");
  const trigger = last.getByRole("button", { name: "Message actions", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(last.getByRole("menuitem", { name: "Delete message" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.screenshot({ path: "artifacts/dm-inline-desktop.png" });
  await history.click({ position: { x: 10, y: 10 } });
  await expect(last.getByRole("menu")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await last.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.screenshot({ path: "artifacts/dm-inline-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once("dialog", (dialog) => dialog.dismiss());
  await last.getByRole("menuitem", { name: "Delete message" }).click();
  expect(deletions).toBe(0);
  expect(id).toContain("dm-sent");
});
