import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL,
    self: {
      location: { origin: "https://forum.example" },
      registration: { showNotification },
      clients: { openWindow },
      addEventListener: (type: string, handler: any) => (handlers[type] = handler),
    },
  });
  return { handlers, showNotification, openWindow };
}
it.each([
  ["/dm/11111111-1111-4111-8111-111111111111", "/dm/11111111-1111-4111-8111-111111111111"],
  ["/p/123", "/p/123"],
  ["https://evil.example/dm/11111111-1111-4111-8111-111111111111", "/notifications"],
  ["/dm/not-a-conversation", "/notifications"],
  ["/settings", "/notifications"],
  ["http://[", "/notifications"],
])("validates push and click destinations for %s", (url, expected) => {
  const { handlers, showNotification, openWindow } = worker();
  handlers.push({ data: { json: () => ({ url, body: "You have a new direct message." }) }, waitUntil: vi.fn() });
  expect(showNotification.mock.calls[0][1].data.url).toBe(expected);
  const close = vi.fn();
  handlers.notificationclick({ notification: { data: { url }, close }, waitUntil: vi.fn() });
  expect(close).toHaveBeenCalled();
  expect(openWindow).toHaveBeenCalledWith(`https://forum.example${expected}`);
});
it("handles malformed and null push payloads", () => {
  const { handlers, showNotification } = worker();
  for (const json of [
    () => null,
    () => {
      throw new Error("malformed");
    },
  ])
    handlers.push({ data: { json }, waitUntil: vi.fn() });
  expect(showNotification).toHaveBeenCalledTimes(2);
  expect(showNotification.mock.calls[0][1].data.url).toBe("/notifications");
});
