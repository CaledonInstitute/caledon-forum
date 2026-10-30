import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  [401, "Sign in to manage notifications."],
  [500, "Unable to load notification settings. Please try again later."],
  [503, "Unable to load notification settings. Please try again later."],
])("shows the correct notification settings error for HTTP %s", async (code, message) => {
  const status = { textContent: "" };
  const enable = { disabled: true };
  const elements: Record<string, unknown> = {
    "[data-push-enable]": enable,
    "[data-push-disable]": {},
    "[data-push-status]": status,
  };
  const panel = { querySelector: (selector: string) => elements[selector], querySelectorAll: () => [] };
  vi.stubGlobal("document", { querySelector: () => panel });
  vi.stubGlobal("navigator", { serviceWorker: {} });
  vi.stubGlobal("window", { PushManager: {}, Notification: {} });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: code })));

  await import("../src/scripts/push-settings");

  await vi.waitFor(() => expect(status.textContent).toBe(message));
  expect(enable.disabled).toBe(true);
});
