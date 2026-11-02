import { afterEach, expect, it, vi } from "vitest";
import { detachBrowserPush } from "../src/lib/push-client";

afterEach(() => vi.unstubAllGlobals());

function browser(ok = true) {
  const unsubscribe = vi.fn(async () => true);
  const close = vi.fn();
  const registration = { pushManager: { getSubscription: async () => ({ endpoint: "https://push.example/device", unsubscribe }) }, getNotifications: async () => [{ close }] };
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => registration } });
  vi.stubGlobal("window", { PushManager: {} });
  const request = vi.fn(async () => new Response(null, { status: ok ? 200 : 500 }));
  vi.stubGlobal("fetch", request);
  return { unsubscribe, close, request };
}

it("detaches the actual browser endpoint before logout even when the device cookie is missing", async () => {
  const { unsubscribe, close, request } = browser();
  await detachBrowserPush();
  expect(request).toHaveBeenCalledWith("/api/push", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ endpoint: "https://push.example/device" }) }));
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it("keeps logout retryable if the server cannot detach the subscription", async () => {
  const { unsubscribe } = browser(false);
  await expect(detachBrowserPush()).rejects.toThrow("Try signing out again");
  expect(unsubscribe).not.toHaveBeenCalled();
});
