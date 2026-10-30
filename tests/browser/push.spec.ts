import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
test("push is opt-in, preferences persist, and this device can unsubscribe", async ({ page, context }) => {
  const cookie = await readFile(".astro/qa-session.json", "utf8")
    .then(JSON.parse)
    .catch(() => null);
  test.skip(!cookie, "Local QA session required");
  await context.addCookies([cookie]);
  const endpoint = `https://fcm.googleapis.com/fcm/send/local-${Date.now()}`;
  await page.addInitScript(
    ({ endpoint }) => {
      let subscription: any = null;
      const keys = {
        p256dh: btoa(String.fromCharCode(4, ...Array(64).fill(1)))
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_"),
        auth: btoa(String.fromCharCode(...Array(16).fill(2)))
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_"),
      };
      const registration = {
        pushManager: {
          getSubscription: async () => subscription,
          subscribe: async () =>
            (subscription = {
              endpoint,
              toJSON: () => ({ endpoint, keys }),
              unsubscribe: async () => {
                subscription = null;
                return true;
              },
            }),
        },
      };
      Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => registration, ready: Promise.resolve(registration) }, configurable: true });
      (window as any).permissionRequests = 0;
      Object.defineProperty(window, "Notification", {
        value: {
          requestPermission: async () => {
            (window as any).permissionRequests++;
            return "granted";
          },
        },
        configurable: true,
      });
    },
    { endpoint }
  );
  await page.goto("/settings?category=notifications");
  const config = await (await context.request.get("/api/push")).json();
  test.skip(!config.enabled, "Run with scripts/test-live-local.mjs");
  const panel = page.locator("[data-push-settings]");
  try {
    await expect(panel.locator("[data-push-status]")).toHaveText("Notifications are off until you enable them.");
    expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(0);
    await panel.getByRole("button", { name: "Enable browser notifications", exact: true }).click();
    await expect(panel.locator("[data-push-status]")).toHaveText("Notifications are enabled on this device.");
    expect((await (await context.request.get("/api/push")).json()).deviceSubscribed).toBe(true);
    expect(await page.evaluate(() => (window as any).permissionRequests)).toBe(1);
    await panel.getByLabel("Likes", { exact: true }).uncheck();
    await expect(panel.locator("[data-push-status]")).toHaveText("Notification preferences saved.");
    expect((await (await context.request.get("/api/push")).json()).preferences.like).toBe(0);
    await panel.getByLabel("Direct messages", { exact: true }).uncheck();
    await expect(panel.locator("[data-push-status]")).toHaveText("Notification preferences saved.");
    expect((await (await context.request.get("/api/push")).json()).preferences.dm).toBe(0);
    await panel.getByRole("button", { name: "Disable on this device", exact: true }).click();
    await expect(panel.locator("[data-push-status]")).toHaveText("Notifications disabled on this device.");
    expect((await (await context.request.get("/api/push")).json()).deviceSubscribed).toBe(false);
  } finally {
    await context.request.delete("/api/push", { headers: { origin: "http://localhost:4321" }, data: { endpoint } });
    await context.request.patch("/api/push", {
      headers: { origin: "http://localhost:4321" },
      data: { reply: !!config.preferences.reply, mention: !!config.preferences.mention, like: !!config.preferences.like, dm: !!config.preferences.dm },
    });
  }
});
