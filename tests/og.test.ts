import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { postCardData, postCardKey, cardText, cardImage } from "../src/lib/og-card";
import type { ForumPost, LinkPreview } from "../src/lib/types";
import { env } from "./runtime";
import { GET } from "../src/pages/api/og/[file]";
import { publicPost, previews } from "../src/lib/db";
import { renderPostCard } from "../src/lib/og-render";
vi.mock("../src/lib/db", () => ({ publicPost: vi.fn(), previews: vi.fn() }));
vi.mock("../src/lib/og-render", () => ({ renderPostCard: vi.fn() }));
const p = {
  publicId: "123",
  id: "internal",
  name: "Alice",
  username: "alice",
  image: null,
  body: "Hello",
  createdAt: 1,
  updatedAt: 1,
  parentUsername: "bob",
  isCaledonMember: true,
} as ForumPost;
const media = { kind: "image", url: "https://cdn.public.com/a.png", image: "https://cdn.public.com/a.png" } as LinkPreview;
const get = (file = "123.png", query = "", pages = true) =>
  GET({
    params: { file },
    url: new URL(`https://forum.public.com/api/og/${file}${query}`),
    locals: { cfContext: { props: { forumPages: pages } } },
    redirect: (url: string, status: number) => new Response(null, { status, headers: { location: url } }),
  } as any);
let store: Map<string, Response>;
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  env.POST_OG_ENABLED = "true";
  env.SERVER_DO_ENABLED = "true";
  env.STATIC_OG_ENABLED = "true";
  env.ASSETS = { fetch: vi.fn(async () => new Response("static", { headers: { "Content-Type": "image/png" } })) };
  vi.mocked(publicPost).mockResolvedValue(p);
  vi.mocked(previews).mockResolvedValue([]);
  vi.mocked(renderPostCard).mockResolvedValue(new Uint8Array([1, 2, 3]));
  store = new Map();
  cache = {
    match: vi.fn(async (key: Request) => store.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, value: Response) => {
      store.set(key.url, value);
    }),
  };
  vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("cleans Markdown/HTML while preserving code and choosing only the first post image", () => {
  const data = postCardData(
    { ...p, body: "# Hi **there** <b>reader</b>\n```js\nconst x = 1;\n```\n![image](https://cdn.public.com/a.png)" },
    [{ ...media, kind: "link", image: "https://cdn.public.com/thumbnail.png" }, media],
    env.SITE_URL
  );
  expect(data.text).toBe("Hi there reader const x = 1;");
  expect(data.media).toBe(media.url);
  expect(data.parent).toBe("bob");
  expect(cardText("😀".repeat(1000), true)).toHaveLength(479);
  expect(postCardData({ ...p, body: "![image](https://cdn.public.com/a.png)" }, [media], env.SITE_URL).text).toBe("");
});
it("fingerprints content, identity, media and reply context", async () => {
  const data = postCardData(p, [media], env.SITE_URL);
  const key = (await postCardKey(data, env.SITE_URL)).url;
  for (const change of [{ name: "Changed" }, { avatar: "https://cdn.public.com/b.png" }, { member: false }, { text: "edited" }, { parent: "carol" }, { media: null }]) {
    expect((await postCardKey({ ...data, ...change }, env.SITE_URL)).url).not.toBe(key);
  }
});
it("keeps the site and disabled/untrusted runtime static without rendering", async () => {
  expect(await (await get("site.png")).text()).toBe("static");
  expect(publicPost).not.toHaveBeenCalled();
  expect(await (await get("123.png", "", false)).text()).toBe("static");
  env.POST_OG_ENABLED = "false";
  expect(await (await get()).text()).toBe("static");
  expect(renderPostCard).not.toHaveBeenCalled();
});
it("caches internally for an hour, serves for five minutes and ignores arbitrary query strings", async () => {
  expect((await get()).headers.get("cache-control")).toBe("public, max-age=300");
  expect([...store.values()][0].headers.get("cache-control")).toBe("public, max-age=3600");
  expect(await (await get("123.png", "?v=old&random=2")).arrayBuffer()).toEqual(Uint8Array.of(1, 2, 3).buffer);
  expect(renderPostCard).toHaveBeenCalledTimes(1);
  vi.mocked(publicPost).mockResolvedValue({ ...p, body: "Edited" });
  await get();
  expect(renderPostCard).toHaveBeenCalledTimes(2);
  vi.mocked(publicPost).mockResolvedValue({ ...p, deleted: 1 });
  expect((await get("123.png", "?v=old")).status).toBe(404);
  vi.mocked(publicPost).mockResolvedValue(null);
  expect((await get()).status).toBe(404);
});
it("renders despite cache failures and uses a short fallback on render failure", async () => {
  cache.match.mockRejectedValue(new Error("unavailable"));
  cache.put.mockRejectedValue(new Error("unavailable"));
  expect((await get()).status).toBe(200);
  vi.mocked(renderPostCard).mockRejectedValue(new Error("renderer"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await get();
    expect(await result.text()).toBe("static");
    expect(result.headers.get("cache-control")).toBe("public, max-age=60");
  } finally {
    log.mockRestore();
  }
});
it("rejects malformed IDs and redirects aliases before serving a fallback", async () => {
  expect((await get("bad.png")).status).toBe(404);
  expect((await get("0123.png")).headers.get("location")).toBe("/api/og/123.png");
});
it("validates media bytes, bounds downloads, blocks private hosts and handles aborts", async () => {
  const fetcher = vi.fn(async () => new Response(Uint8Array.of(137, 80, 78, 71, 1), { headers: { "Content-Type": "image/png" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await cardImage(media.url, 10, AbortSignal.timeout(3000))).toContain("data:image/png;base64,");
  expect(await cardImage(media.url, 2, AbortSignal.timeout(3000))).toBeUndefined();
  expect(await cardImage("https://127.0.0.1/a", 10, AbortSignal.timeout(3000))).toBeUndefined();
  fetcher.mockImplementation(async () => {
    throw new DOMException("Aborted", "AbortError");
  });
  expect(await cardImage(media.url, 10, AbortSignal.abort())).toBeUndefined();
  fetcher.mockImplementation(async () => new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
  expect(await cardImage(media.url, 100, AbortSignal.timeout(3000))).toBeUndefined();
});
