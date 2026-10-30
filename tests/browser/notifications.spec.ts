import { readFile } from "node:fs/promises";
import { test, expect, type BrowserContext } from "@playwright/test";

test("mentions notify recipients and notification cards fit mobile screens", async ({ page, context, browser }) => {
  const cookies = await Promise.all(
    ["qa-session.json", "qa-mention-session.json"].map((filename) =>
      readFile(`.astro/${filename}`, "utf8")
        .then(JSON.parse)
        .catch(() => null)
    )
  );
  test.skip(
    cookies.some((cookie) => !cookie),
    "Run the local seed script with authentication enabled."
  );
  await context.addCookies([cookies[0]]);
  const sender = await browser.newContext();
  await sender.addCookies([cookies[1]]);
  const baseURL = test.info().project.use.baseURL!;
  async function action(account: BrowserContext, name: string, data: unknown) {
    const response = await account.request.post(`${baseURL}/api/forum/${name}`, { data, headers: { origin: new URL(baseURL).origin } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const created: string[] = [];
  const longName = "Researcher".repeat(8);
  try {
    await action(sender, "profile", { name: longName, bio: "" });
    const composer = await sender.newPage();
    await composer.goto(baseURL);
    await composer.getByRole("textbox", { name: "Your post", exact: true }).fill(`${"x".repeat(110)} @qa_caledon @QA_caledon`);
    const published = composer.waitForResponse((r) => r.url().endsWith("/api/forum/publish") && r.request().method() === "POST");
    await composer.getByRole("button", { name: "Post", exact: true }).click();
    const post = await (await published).json();
    expect(post.ok).toBe(true);
    created.push(post.id);

    const root = await action(sender, "publish", { body: "Local notification regression thread" });
    created.push(root.id);
    const reply = await action(sender, "publish", { body: "Hello @qa_caledon", parentId: root.id });
    created.push(reply.id);
    const edited = await action(sender, "publish", { body: "Before adding a mention" });
    created.push(edited.id);
    const urlBody = `\`https://example.invalid/${"path".repeat(30)}\` @qa_caledon`;
    await action(sender, "edit", { id: edited.id, body: urlBody });
    await action(sender, "edit", { id: edited.id, body: urlBody });

    await page.goto("/notifications");
    for (const result of [post, reply, edited]) {
      const card = page.locator(".notification").filter({ has: page.locator(`.notification-post[href="${result.url}"]`) });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText("mentioned you in a post");
      await expect(card).toHaveClass(/unread/);
    }
    await expect(page.locator('.nav a[href="/notifications"] .dot')).toHaveCount(1);
    await expect(page.locator('.mobile-nav a[href="/notifications"] .dot')).toHaveAttribute("aria-label", /\d+ unread notifications/);

    for (const width of [320, 390, 680, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      if (width <= 680) await expect(page.locator('.mobile-nav a[href="/notifications"] .dot')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(
        await page.locator(".notification").evaluateAll((cards) =>
          cards.every((card) => {
            const bounds = card.getBoundingClientRect();
            return [...card.querySelectorAll(".notification-content, strong, p, time")].every((element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= bounds.left && rect.right <= bounds.right && element.scrollWidth <= element.clientWidth + 1;
            });
          })
        )
      ).toBe(true);
      await page.screenshot({ path: `artifacts/notifications-${width}.png`, fullPage: true });
    }

    const card = page.locator(".notification").filter({ has: page.locator(`.notification-post[href="${post.url}"]`) });
    await card.locator(".notification-profile strong").click();
    await expect(page).toHaveURL(/\/qa_research$/);
    await page.goto("/notifications");
    await card.locator(".notification-post").click();
    await expect(page).toHaveURL(post.url);
    await page.goto("/notifications");
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(page.locator(".notification.unread")).toHaveCount(0);
    await expect(page.locator(".nav .dot, .mobile-nav .dot")).toHaveCount(0);
  } finally {
    for (const id of created.reverse()) await action(sender, "delete", { id });
    await action(sender, "profile", { name: "Research QA", bio: "" });
    await sender.close();
  }
});
