import { readFile } from "node:fs/promises";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createIdentity, encryptMessage } from "../../src/lib/dm-crypto";
const password = "Local-DM-browser-password-123";
async function account(context: BrowserContext, name: string) {
  const cookie = await readFile(`.astro/qa-dm-${name}-session.json`, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Run node scripts/seed-local.mjs");
  await context.addCookies([cookie]);
  await context.route("**/api/avatar/qa_dm_*", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64") })
  );
}
async function unlock(page: Page) {
  await page.goto("/dm");
  const input = page.getByLabel("Account password", { exact: true });
  await expect(input.or(page.getByLabel("New message", { exact: true }))).toBeVisible();
  if (await input.isVisible()) {
    await input.fill(password);
    await page.getByRole("button", { name: /^(Enable DM|Unlock DM)$/ }).click();
  }
  await expect(page.getByLabel("New message", { exact: true })).toBeVisible();
}

test("switching DM preserves the inbox and drafts, ignores stale responses, and supports history", async ({ page, context }) => {
  test.setTimeout(90000);
  await account(context, "sender");
  const owner = await createIdentity("qa-dm-sender", 1, password);
  const peer = await createIdentity("peer", 1, password);
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const items = await Promise.all(
    ids.map(async (id, i) => {
      const messageContext = { id: crypto.randomUUID(), conversationId: id, senderId: "peer", recipientId: "qa-dm-sender", senderVersion: 1, recipientVersion: 1 };
      return {
        ...messageContext,
        conversation_id: id,
        sender_id: "peer",
        sender_version: 1,
        recipient_version: 1,
        sender_public_key: JSON.stringify(peer.identity.publicKey),
        envelopes: JSON.stringify(await encryptMessage(peer.identity, owner.identity.publicKey, messageContext, { text: `Message ${i}` })),
        seq: i + 1,
        created_at: Date.now(),
      };
    })
  );
  const requests: string[] = [];
  let releaseMessages: (() => void) | undefined;
  let delayId: string | undefined;
  let releaseSend: (() => void) | undefined;
  let holdSend = false;
  await context.route("**/api/dm/**", async (route) => {
    const url = new URL(route.request().url());
    const action = url.pathname.split("/").at(-1)!;
    requests.push(action);
    let result: any = { ok: true };
    if (action === "vault") result = { userId: "qa-dm-sender", version: 1, hasPassword: true, publicKey: owner.identity.publicKey, vault: owner.vault };
    if (action === "inbox")
      result = { unread: 0, items: ids.map((id, i) => ({ id, peerId: "peer", name: `Peer ${i}`, username: `peer_${i}`, image: null, unread: 0, updated_at: 1 })) };
    if (action === "users" || action === "blocks") result = { items: [] };
    if (action === "messages") {
      const id = url.searchParams.get("conversationId")!;
      if (id === delayId)
        await new Promise<void>((resolve) => {
          releaseMessages = resolve;
        });
      const i = ids.indexOf(id);
      result = {
        peer: { id: "peer", name: `Peer ${i}`, username: `peer_${i}`, image: null, publicKey: JSON.stringify(peer.identity.publicKey), version: 1, emailVerified: true },
        blocked: false,
        ownBlocked: false,
        items: [items[i]],
      };
    }
    if (action === "send" && holdSend)
      await new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
    await route.fulfill({ json: result });
  });
  await unlock(page);
  await page.evaluate(() => {
    document.body.dataset.realtimeConnected = "true";
  });
  const inbox = page.getByRole("complementary", { name: "Inbox", exact: true });
  await expect(inbox.getByRole("link")).toHaveCount(3);
  const savedInbox = await inbox.elementHandle();
  const savedRow = await inbox.getByRole("link").last().elementHandle();
  await page.getByLabel("New message", { exact: true }).fill("keep search");
  await expect(inbox.getByText("No users with DM enabled found.")).toBeVisible();
  await inbox.getByRole("link").nth(0).click();
  await expect(page.getByText("Message 0", { exact: true })).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("draft zero");
  const beforeSwitch = requests.length;
  const navigations: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations.push(r.url());
  });
  delayId = ids[1];
  await inbox.getByRole("link").nth(1).click();
  await expect.poll(() => !!releaseMessages).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Loading messages" })).toBeVisible();
  await inbox.getByRole("link").nth(2).click();
  await expect(page.getByText("Message 2", { exact: true })).toBeVisible();
  releaseMessages!();
  delayId = undefined;
  await expect(page.getByRole("heading", { name: "Peer 2", exact: true })).toBeVisible();
  await expect(page.getByText("Message 1", { exact: true })).toHaveCount(0);
  await page.getByLabel("Message", { exact: true }).fill("draft two");
  await inbox.getByRole("link").nth(0).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("draft zero");
  await expect(page.getByText("Message 0", { exact: true })).toBeVisible();
  expect(requests.slice(beforeSwitch).filter((action) => action === "vault" || action === "inbox")).toEqual([]);
  expect(await savedInbox!.evaluate((node) => node === document.querySelector(".dm-inbox"))).toBe(true);
  expect(await savedRow!.evaluate((node) => node === document.querySelectorAll(".dm-inbox nav a")[2])).toBe(true);
  await expect(page.getByLabel("New message", { exact: true })).toHaveValue("keep search");
  const popupPromise = context.waitForEvent("page");
  await inbox
    .getByRole("link")
    .nth(2)
    .click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupPromise;
  await expect(popup).toHaveURL(new RegExp(`/dm/${ids[2]}$`));
  await popup.close();
  await expect(page).toHaveURL(new RegExp(`/dm/${ids[0]}$`));
  await page.goBack();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("draft two");
  await page.goForward();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("draft zero");
  holdSend = true;
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => !!releaseSend).toBe(true);
  await inbox.getByRole("link").nth(2).click();
  await expect(page.getByText("Message 2", { exact: true })).toBeVisible();
  releaseSend!();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("draft two");
  expect(navigations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Back to inbox", exact: true }).click();
  await expect(page).toHaveURL(/\/dm$/);
  await expect(inbox).toBeVisible();
  await inbox.getByRole("link").nth(2).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("draft two");
  await page.getByRole("button", { name: "Conversation details", exact: true }).click();
  await page.getByRole("button", { name: "Lock DM", exact: true }).click();
  await expect(page.getByLabel("Account password", { exact: true })).toBeVisible();
  await page.getByLabel("Account password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock DM", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    history.pushState(null, "", location.pathname + "?share=%2Fp%2F123");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".dm-compose .notice")).toContainText("/p/123");
  await inbox.getByRole("link").nth(0).click();
  await expect(page).toHaveURL(new RegExp(`/dm/${ids[0]}\\?share=`));
  await expect(page.locator(".dm-compose .notice")).toContainText("/p/123");
  await expect(page.getByText("Message 0", { exact: true })).toBeVisible();
});
test("encrypted personal DM, remembered access, cross-device unlock, blocking and shared post", async ({ browser }) => {
  test.setTimeout(90000);
  const sender = await browser.newContext(),
    recipient = await browser.newContext();
  await account(sender, "sender");
  await account(recipient, "recipient");
  const a = await sender.newPage(),
    b = await recipient.newPage();
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  try {
    await unlock(b);
    await unlock(a);
    await a.getByLabel("New message", { exact: true }).fill("qa_dm_recipient");
    await a.getByRole("button", { name: /qa_dm_recipient/ }).click();
    await expect(a).toHaveURL(/\/dm\/[^/?]+$/);
    const path = new URL(a.url()).pathname;
    const text = `Encrypted browser message ${Date.now()}`;
    await a.getByLabel("Message", { exact: true }).fill(text);
    const sent = a.waitForRequest((r) => r.url().endsWith("/api/dm/send"));
    await a.getByRole("button", { name: "Send", exact: true }).click();
    const request = await sent;
    expect(request.postData()).not.toContain(text);
    await expect(a.getByText(text, { exact: true })).toBeVisible();
    await a.reload();
    await expect(a.getByText(text, { exact: true })).toBeVisible();
    await expect(a.getByLabel("Account password", { exact: true })).toHaveCount(0);
    await b.goto(path);
    await expect(b.getByText(text, { exact: true })).toBeVisible();
    await expect(a.locator(".page-header")).toHaveCount(0);
    const reply = `Reply from recipient ${Date.now()}`;
    await b.getByLabel("Message", { exact: true }).fill(reply);
    await b.getByRole("button", { name: "Send", exact: true }).click();
    await expect(b.getByText(reply, { exact: true })).toBeVisible();
    await a.reload();
    await expect(a.getByText(reply, { exact: true })).toBeVisible();
    const sentColor = await a
      .locator(".dm-sent .dm-bubble")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const receivedColor = await a
      .locator(".dm-received .dm-bubble")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(sentColor).toBe("rgb(29, 112, 232)");
    expect(receivedColor).toBe("rgb(238, 242, 244)");
    await expect(b.locator(".dm-peer-avatar img")).toBeVisible();
    await expect(b.getByRole("button", { name: "Block", exact: true })).not.toBeVisible();
    await b.getByRole("button", { name: "Conversation details", exact: true }).click();
    await expect(b.getByRole("dialog", { name: "Conversation details" })).toBeVisible();
    await b.getByRole("button", { name: "Block", exact: true }).click();
    await expect(b.getByText("Messaging is blocked.")).toBeVisible();
    await a.reload();
    await expect(a.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await b.getByRole("button", { name: "Conversation details", exact: true }).click();
    await b.getByRole("button", { name: "Unblock", exact: true }).click();
    const notebook = (await (await a.request.get("/")).text()).match(/id="post-qa-notebook"[\s\S]*?data-post-url="([^" ]+)"/)?.[1];
    expect(notebook).toBeTruthy();
    await a.goto(path + "?share=" + encodeURIComponent(notebook!));
    await a.getByRole("button", { name: "Send", exact: true }).click();
    await expect(a.locator(".dm-history .quote-card").last()).toBeVisible();
    await expect(a.getByRole("button", { name: "Send", exact: true })).toBeVisible();
    await expect(a.getByRole("button", { name: "Sending…", exact: true })).toHaveCount(0);
    await expect(a.locator(".dm-peer-avatar img")).toBeVisible();
    await a.setViewportSize({ width: 390, height: 844 });
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(a.locator(".mobile-header")).not.toBeVisible();
    expect(await a.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true);
    await a.screenshot({ path: "artifacts/dm-mobile.png", fullPage: true });
    await a.setViewportSize({ width: 1280, height: 900 });
    await a.screenshot({ path: "artifacts/dm-desktop.png", fullPage: true });
    await a.getByRole("button", { name: "Conversation details", exact: true }).click();
    await a.screenshot({ path: "artifacts/dm-details-desktop.png" });
    await a.keyboard.press("Escape");
    await expect(a.getByRole("button", { name: "Conversation details", exact: true })).toBeFocused();
    await a.setViewportSize({ width: 390, height: 844 });
    await a.getByRole("button", { name: "Conversation details", exact: true }).click();
    await a.screenshot({ path: "artifacts/dm-details-mobile.png" });
    await a.getByRole("button", { name: "Lock DM", exact: true }).click();
    await expect(a.getByLabel("Account password", { exact: true })).toBeVisible();
    await a.reload();
    await expect(a.getByLabel("Account password", { exact: true })).toBeVisible();
    const other = await browser.newContext();
    try {
      await account(other, "sender");
      const c = await other.newPage();
      await unlock(c);
      await c.goto(path);
      await expect(c.getByText(text, { exact: true })).toBeVisible();
    } finally {
      await other.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await sender.close();
    await recipient.close();
  }
});
test("Share menu separates copying from reposting and mobile navigation includes DM", async ({ page, context }) => {
  test.setTimeout(60000);
  await account(context, "sender");
  await page.goto("/");
  const card = page.locator("#post-qa-notebook");
  await card.locator("[data-share-menu]").click();
  const menu = page.getByRole("dialog", { name: "Share post" });
  await expect(menu.getByRole("link", { name: "Send via DM" })).toHaveAttribute("href", /\/dm\?share=/);
  await expect(menu.getByRole("link", { name: "Quote post" })).toHaveAttribute("href", /quote=/);
  const repost = menu.getByRole("button", { name: /^(Repost|Undo repost)$/ });
  const toggleRepost = async (button: ReturnType<typeof menu.getByRole>) => {
    const [response] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/forum/repost" && response.request().method() === "POST"),
      button.click(),
    ]);
    expect(response.ok(), await response.text()).toBe(true);
    await expect(menu).not.toBeVisible();
  };
  if ((await repost.textContent()) === "Undo repost") {
    await toggleRepost(repost);
    await card.locator("[data-share-menu]").click();
  }
  await toggleRepost(menu.getByRole("button", { name: "Repost", exact: true }));
  await page.goto("/qa_dm_sender");
  await expect(page.locator(".repost-context").filter({ hasText: "qa_dm_sender reposted" })).toBeVisible();
  await page.locator('[data-post-id="qa-notebook"] [data-share-menu]').click();
  await toggleRepost(menu.getByRole("button", { name: "Undo repost", exact: true }));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "DM", exact: true })).toBeVisible();
  await expect(page.locator(".mobile-header").getByRole("link", { name: "Search", exact: true })).toBeVisible();
  await page.goto("/");
  await page.locator("#post-qa-notebook [data-share-menu]").click();
  const sheet = page.getByRole("dialog", { name: "Share post" });
  const bounds = (await sheet.boundingBox())!;
  expect(bounds.x).toBe(0);
  expect(bounds.width).toBe(390);
  expect(Math.abs(bounds.y + bounds.height - 844)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "artifacts/share-mobile.png" });
});
test("activity setting hides public profile timestamp", async ({ page, context, browser }) => {
  await account(context, "sender");
  await page.goto("/settings");
  const toggle = page.getByRole("checkbox", { name: "Show activity status" });
  await toggle.uncheck();
  await expect(page.locator("[data-activity-status]")).toHaveText("Activity visibility updated.");
  const publicContext = await browser.newContext({ javaScriptEnabled: false });
  try {
    const reader = await publicContext.newPage();
    await reader.goto("/qa_dm_sender");
    await expect(reader.locator(".profile-activity")).toHaveCount(0);
  } finally {
    await publicContext.close();
    await toggle.check();
    await expect(toggle).toBeEnabled();
  }
});
