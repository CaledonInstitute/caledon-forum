import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function setup() {
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return { ...(await import("../src/lib/dm-inbox")), fetch };
}
const snapshot = (unread = 0) => ({ unread, items: [{ id: "conversation", peerId: "peer", name: "Peer", username: "peer", image: null, unread, updated_at: 1 }] });

it("shares concurrent inbox requests and preserves unchanged row and list references", async () => {
  const { fetch, refreshInbox, subscribeInbox } = await setup();
  let resolve!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  const listener = vi.fn();
  const unsubscribe = subscribeInbox(listener);
  const first = refreshInbox();
  const concurrent = refreshInbox();
  expect(fetch).toHaveBeenCalledTimes(1);
  resolve(Response.json(snapshot()));
  const result = await first;
  expect(await concurrent).toBe(result);
  fetch.mockResolvedValueOnce(Response.json(snapshot()));
  expect((await refreshInbox()).items).toBe(result.items);
  fetch.mockResolvedValueOnce(Response.json(snapshot(1)));
  expect((await refreshInbox()).items[0]).not.toBe(result.items[0]);
  unsubscribe();
  expect(listener).toHaveBeenCalledTimes(3);
});

it("refreshes after a write even if an older inbox request is still in flight", async () => {
  const { fetch, refreshInbox } = await setup();
  let resolve!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  const old = refreshInbox();
  const afterRead = refreshInbox(true);
  fetch.mockResolvedValueOnce(Response.json(snapshot()));
  resolve(Response.json(snapshot(1)));
  expect((await old).unread).toBe(1);
  expect((await afterRead).unread).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("allows retry after a failed inbox request", async () => {
  const { fetch, refreshInbox } = await setup();
  fetch.mockResolvedValueOnce(Response.json({ error: "Sign in to continue." }, { status: 401 }));
  await expect(refreshInbox()).rejects.toThrow("Sign in");
  fetch.mockResolvedValueOnce(Response.json(snapshot()));
  expect((await refreshInbox()).unread).toBe(0);
});
