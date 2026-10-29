import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { resetDatabase, seedUser, execute, row } from "./runtime";
import { POST } from "../src/pages/api/forum/[action]";
import { GET } from "../src/pages/api/avatar/[username]";
import { MAX_AVATAR_BYTES } from "../src/lib/avatar";

const url = "https://images.unsplash.com/avatar.png";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
let user: any;
const image = () => new Response(png, { headers: { "Content-Type": "image/png" } });
const profile = (data: any, viewer: any = user, origin = "http://localhost:4321") =>
  POST({
    params: { action: "profile" },
    locals: { user: viewer },
    request: new Request("http://localhost:4321/api/forum/profile", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", bio: "Hello", ...data }),
    }),
  } as any);
const avatar = (username = "alice") => GET({ params: { username } } as any);
beforeEach(() => {
  resetDatabase();
  user = seedUser();
  vi.stubGlobal("fetch", vi.fn(image));
});
afterEach(() => vi.unstubAllGlobals());

describe("profile images", () => {
  it.each([
    ["image/jpeg", new Uint8Array([255, 216, 255, 224])],
    ["image/gif", new TextEncoder().encode("GIF89a")],
    ["image/webp", new TextEncoder().encode("RIFF0000WEBP")],
  ])("accepts and proxies %s images", async (type, bytes) => {
    vi.stubGlobal("fetch", async () => new Response(bytes, { headers: { "Content-Type": type } }));
    expect((await profile({ image: url })).status).toBe(200);
    const response = await avatar();
    expect(response.headers.get("content-type")).toBe(type);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
  it("saves, replaces, preserves omitted images, and clears with blank or null", async () => {
    expect((await profile({ image: `  ${url}  ` })).status).toBe(200);
    expect(row("SELECT image FROM user").image).toBe(url);
    expect((await profile({ image: url + "?v=2" })).status).toBe(200);
    expect((await profile({})).status).toBe(200);
    expect(row("SELECT image FROM user").image).toBe(url + "?v=2");
    for (const value of ["", null]) {
      await profile({ image: url });
      expect((await profile({ image: value })).status).toBe(200);
      expect(row("SELECT image FROM user").image).toBeNull();
    }
  });
  it("updates only the signed-in user", async () => {
    seedUser("bob");
    await profile({ image: url, id: "bob" });
    expect(row("SELECT image FROM user WHERE id=?", "bob").image).toBeNull();
    expect((await profile({ image: url }, null)).status).toBe(401);
    expect((await profile({ image: url }, { ...user, suspended: true })).status).toBe(403);
    expect((await profile({ image: url }, user, "https://evil.com")).status).toBe(403);
  });
  for (const value of [
    "http://images.unsplash.com/a.png",
    "https://127.0.0.1/a.png",
    "https://service.internal/a.png",
    "data:image/png;base64,abc",
    "https://images.unsplash.com/" + "a".repeat(2048),
  ])
    it(`rejects invalid URL ${value.slice(0, 45)}`, async () => {
      expect((await profile({ image: value })).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });
  for (const [label, fetcher] of [
    ["private redirect", () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/a.png" } })],
    ["HTML", () => new Response("<html/>", { headers: { "Content-Type": "text/html" } })],
    ["fake PNG", () => new Response("<svg/>", { headers: { "Content-Type": "image/png" } })],
    ["SVG", () => new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } })],
    ["oversized stream", () => new Response(new Uint8Array(MAX_AVATAR_BYTES + 1), { headers: { "Content-Type": "image/png" } })],
    ["oversized content length", () => new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": String(MAX_AVATAR_BYTES + 1) } })],
    [
      "timeout",
      () => {
        throw new DOMException("Timed out", "TimeoutError");
      },
    ],
    ["unavailable host", () => new Response(null, { status: 404 })],
  ] as const)
    it(`rejects ${label} without changing profile`, async () => {
      execute("UPDATE user SET image=? WHERE id=?", url, user.id);
      vi.stubGlobal("fetch", vi.fn(fetcher));
      const response = await profile({ image: url + "?new" });
      expect(response.status).toBe(400);
      expect(((await response.json()) as any).error).toBeTruthy();
      expect(row("SELECT name,bio,image FROM user")).toMatchObject({ name: "alice", bio: "", image: url });
    });
});

describe("avatar proxy", () => {
  it("serves saved images with no-store and a validated MIME type", async () => {
    execute("UPDATE user SET image=? WHERE id=?", url, user.id);
    const response = await avatar();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(url);
    expect((await avatar("https://evil.com/a.png")).status).toBe(404);
  });
  it("returns uncached errors for missing or unavailable images", async () => {
    for (const username of ["alice", "missing"]) {
      const r = await avatar(username);
      expect(r.status).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    execute("UPDATE user SET image=? WHERE id=?", url, user.id);
    vi.stubGlobal("fetch", async () => new Response("<script/>", { headers: { "Content-Type": "image/png" } }));
    const r = await avatar();
    expect(r.status).toBe(502);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
