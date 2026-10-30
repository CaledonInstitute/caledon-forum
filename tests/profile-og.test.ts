import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { profileCardData, profileCardKey, truncateCardText } from "../src/lib/og-card";
import { GET } from "../src/pages/api/og/profile/[username].png";
import { publicProfile } from "../src/lib/db";
import { renderProfileCard } from "../src/lib/og-render";
import type { PublicProfile } from "../src/lib/types";
import { env } from "./runtime";
vi.mock("../src/lib/db", () => ({ publicProfile: vi.fn() }));
vi.mock("../src/lib/og-render", () => ({ renderProfileCard: vi.fn() }));
const person = {
  id: "alice",
  name: "Alice 😀",
  username: "alice",
  image: null,
  coverImage: null,
  bio: " Hello\nworld ",
  location: "",
  created_at: 1,
  isCaledonMember: 1,
} as PublicProfile;
const get = (username = "alice", query = "", pages = true) =>
  GET({
    params: { username },
    url: new URL(`https://forum.public.com/api/og/profile/${username}.png${query}`),
    locals: { cfContext: { props: { forumPages: pages } } },
    redirect: (url: string, status: number) => new Response(null, { status, headers: { location: url } }),
  } as any);
let store: Map<string, Response>;
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  env.PROFILE_OG_ENABLED = "true";
  env.SERVER_DO_ENABLED = "true";
  env.ASSETS = { fetch: vi.fn(async () => new Response("static", { headers: { "Content-Type": "image/png" } })) };
  vi.mocked(publicProfile).mockResolvedValue(person);
  vi.mocked(renderProfileCard).mockResolvedValue(Uint8Array.of(1, 2, 3));
  store = new Map();
  cache = {
    match: vi.fn(async (key: Request) => store.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => {
      store.set(key.url, response);
    }),
  };
  vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
});
afterEach(() => vi.unstubAllGlobals());

it("uses only public card fields, normalizes whitespace and truncates Unicode safely", () => {
  expect(profileCardData(person, env.SITE_URL)).toEqual({
    name: "Alice 😀",
    username: "alice",
    avatar: null,
    cover: null,
    member: true,
    bio: "Hello world",
    host: "localhost:4321",
  });
  expect(truncateCardText("😀".repeat(50), 4)).toBe("😀😀😀…");
});
it("fingerprints every displayed field and keeps profile and post namespaces distinct", async () => {
  const data = profileCardData(person, env.SITE_URL);
  const key = (await profileCardKey(data, env.SITE_URL)).url;
  expect(key).toContain("/api/og/profile/alice.png?v=profile-v1-");
  for (const change of [
    { name: "Bob" },
    { username: "bob" },
    { avatar: "https://public.com/a.png" },
    { cover: "https://public.com/c.png" },
    { member: false },
    { bio: "Changed" },
    { host: "other.com" },
  ]) {
    expect((await profileCardKey({ ...data, ...change }, env.SITE_URL)).url).not.toBe(key);
  }
});
it("rejects invalid/reserved usernames before lookup and missing profiles without caching", async () => {
  for (const username of ["bad-name", "123", "settings", "a".repeat(31)]) {
    const response = await get(username);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(publicProfile).not.toHaveBeenCalled();
  vi.mocked(publicProfile).mockResolvedValue(null);
  expect((await get()).status).toBe(404);
  expect(renderProfileCard).not.toHaveBeenCalled();
});
it("redirects case aliases before fallback", async () => {
  env.PROFILE_OG_ENABLED = "false";
  const response = await get("ALICE", "?v=old");
  expect(response.status).toBe(301);
  expect(response.headers.get("location")).toBe("/api/og/profile/alice.png?v=old");
});
it("requires all runtime gates and works without a signed-in viewer", async () => {
  expect(await (await get("alice", "", false)).text()).toBe("static");
  env.PROFILE_OG_ENABLED = "false";
  expect(await (await get()).text()).toBe("static");
  env.PROFILE_OG_ENABLED = "true";
  env.SERVER_DO_ENABLED = "false";
  expect(await (await get()).text()).toBe("static");
  expect(renderProfileCard).not.toHaveBeenCalled();
});
it("uses server-derived cache keys, checks existence before cache, and refreshes on edits", async () => {
  const response = await get();
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect([...store.values()][0].headers.get("cache-control")).toBe("public, max-age=3600");
  expect(await (await get("alice", "?v=old&random=2")).arrayBuffer()).toEqual(Uint8Array.of(1, 2, 3).buffer);
  expect(renderProfileCard).toHaveBeenCalledTimes(1);
  vi.mocked(publicProfile).mockResolvedValue({ ...person, bio: "Edited" });
  await get();
  expect(renderProfileCard).toHaveBeenCalledTimes(2);
  vi.mocked(publicProfile).mockResolvedValue(null);
  expect((await get()).status).toBe(404);
});
it("renders through cache failures and serves a short fallback on render failure", async () => {
  cache.match.mockRejectedValue(new Error("cache"));
  cache.put.mockRejectedValue(new Error("cache"));
  expect((await get()).status).toBe(200);
  vi.mocked(renderProfileCard).mockRejectedValue(new Error("render"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await get();
    expect(await response.text()).toBe("static");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  } finally {
    log.mockRestore();
  }
});
