import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { resetDatabase, seedUser, execute, row, env } from "./runtime";
import { markdown } from "../src/lib/markdown";
import { ancestors, timeline, publicProfile, profilePosts } from "../src/lib/db";
import { forumAction } from "../src/lib/forum-service";
import { GET as media } from "../src/pages/api/media/[id]";
import { inspectLink } from "../src/lib/previews";
beforeEach(() => {
  resetDatabase();
  seedUser();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete env.PUBLIC_METADATA;
});
it("truncates rendered content without destroying Markdown, HTML, code or math", async () => {
  const html = await markdown("**Bold** <em>HTML</em>\n\n```js\n" + "a".repeat(900) + "\n```", [], undefined, 600);
  expect(html).toContain("<strong>Bold</strong>");
  expect(html).toContain("<em>HTML</em>");
  expect(html).toContain("language-js");
  expect(html).toContain("data-content-truncated");
  expect(html).not.toContain("a".repeat(900));
  expect(await markdown("short **bold**", [], undefined, 600)).not.toContain("data-content-truncated");
  expect(await markdown("x".repeat(599) + " $veryLongFormula$", [], undefined, 600)).not.toContain('class="katex"');
  expect(await markdown("<script>alert(1)</script>**safe**", [], undefined, 600)).not.toContain("<script");
});
it("returns complete ancestry in root order and preserves deleted parents", async () => {
  for (let i = 0; i < 6; i++)
    execute(
      "INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES(?,'alice',?,?,?,?,1)",
      `p${i}`,
      i ? "p0" : null,
      i ? `p${i - 1}` : null,
      `body ${i}`,
      i + 1
    );
  execute("UPDATE posts SET deleted=1,body='' WHERE id='p2'");
  expect((await ancestors("p5")).map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  execute("UPDATE posts SET parent_id='p5' WHERE id='p0'");
  expect((await ancestors("p5")).length).toBe(5);
});
it("includes reposts in feed/profile and removes deleted sources", async () => {
  const user = seedUser("bob");
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('post','alice','Original',1,1)");
  await forumAction(user, "repost", { id: "post", reposted: true });
  await forumAction(user, "repost", { id: "post", reposted: true });
  expect(row("SELECT COUNT(*) AS n FROM reposts").n).toBe(1);
  expect((await timeline())[0]).toMatchObject({ id: "post", repostedBy: "bob" });
  expect((await profilePosts("bob", "posts"))[0]).toMatchObject({ id: "post", repostedBy: "bob" });
  execute("UPDATE posts SET deleted=1 WHERE id='post'");
  expect(await timeline()).toHaveLength(0);
});
it("redacts hidden activity and private profile fields", async () => {
  execute("UPDATE user SET last_active_at=123,show_activity=0 WHERE id='alice'");
  const p = await publicProfile("alice");
  expect(p?.lastActiveAt).toBeNull();
  expect(p).not.toHaveProperty("last_active_at");
  expect(p).not.toHaveProperty("email");
  execute("UPDATE user SET show_activity=1 WHERE id='alice'");
  expect((await publicProfile("alice"))?.lastActiveAt).toBe(123);
});
it("uses the original signed image rather than stale SEO thumbnail in the proxy", async () => {
  const url = "https://cdn.images.net/photo.jpg?token=keep";
  execute(
    "INSERT INTO link_previews(id,url,kind,title,description,site,image,checked_at) VALUES('stale',?,'link','SEO','','images.net','https://cdn.images.net/thumb.png',1)",
    url
  );
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('p','alice',?,1,1)", url);
  execute("INSERT INTO post_links(post_id,preview_id,position) VALUES('p','stale',0)");
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(new Uint8Array([255, 216, 255, 225]), { headers: { "Content-Type": "image/jpeg" } }));
  vi.stubGlobal("fetch", fetcher);
  expect((await media({ params: { id: "stale" }, locals: { user: null } } as any)).status).toBe(200);
  expect(String(fetcher.mock.calls[0][0])).toBe(url);
});
it("ignores stale KV classifications and falls back safely on invalid images", async () => {
  const url = "https://cdn.images.net/photo.jpg?signature=keep";
  env.PUBLIC_METADATA = { get: async () => ({ id: "stale", url, kind: "link", title: "SEO", checkedAt: Date.now() }), put: vi.fn() };
  const fetcher = vi.fn(
    async (_url: any, init: any) =>
      new Response(new Headers(init.headers).get("Accept") === "image/webp,image/png,image/jpeg,image/gif" ? new Uint8Array([255, 216, 255, 225]) : "<title>SEO</title>", {
        headers: { "Content-Type": new Headers(init.headers).get("Accept") === "image/webp,image/png,image/jpeg,image/gif" ? "image/jpeg" : "text/html" },
      })
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await inspectLink(url)).toMatchObject({ kind: "image", image: url });
  vi.stubGlobal("fetch", async () => new Response("not raster", { headers: { "Content-Type": "image/jpeg" } }));
  expect(await inspectLink(url + "2")).toBeNull();
});

it("keeps a deleted root placeholder with live replies in the feed, but excludes its reposts", async () => {
  execute("INSERT INTO posts(id,author_id,body,deleted,created_at,updated_at) VALUES('root','alice','',1,1,1)");
  execute("INSERT INTO posts(id,author_id,body,root_id,parent_id,created_at,updated_at) VALUES('reply','alice','Reply','root','root',2,2)");
  execute("INSERT INTO reposts(user_id,post_id,created_at) VALUES('alice','root',3)");
  const items = await timeline();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ id: "root", deleted: 1, repostedBy: null });
});
