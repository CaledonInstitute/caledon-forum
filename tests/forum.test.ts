import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { resetDatabase, seedUser, execute, row, env } from "./runtime";
import { POST } from "../src/pages/api/forum/[action]";
import { refreshMembership } from "../src/lib/membership";
import { symmetricEncrypt } from "better-auth/crypto";
import { inspectLink, inspectBody, normalizePreview } from "../src/lib/previews";
import { posts, replyLocation, post } from "../src/lib/db";
let alice: any, bob: any;
async function act(action: string, data: any, user: any = alice, origin = "http://localhost:4321") {
  const response = await POST({
    params: { action },
    locals: { user },
    request: new Request(`http://localhost:4321/api/forum/${action}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  } as any);
  return { status: response.status, data: (await response.json()) as any };
}
beforeEach(() => {
  resetDatabase();
  alice = seedUser();
  bob = seedUser("bob");
});
afterEach(() => vi.unstubAllGlobals());
describe("forum data and authorization", () => {
  it("publishes 25k main posts and 25k replies without a conversation-wide cap", async () => {
    const main = await act("publish", { body: "a".repeat(25000) });
    expect(main.status).toBe(200);
    const id = main.data.id;
    expect(main.data.url).toMatch(/^\/p\/[1-9][0-9]*$/);
    for (let i = 0; i < 2; i++) expect((await act("publish", { body: "😀".repeat(25000), parentId: id }, bob)).status).toBe(200);
    expect(row("SELECT COUNT(*) n FROM posts").n).toBe(3);
    expect((await act("publish", { body: "a".repeat(25001) })).status).toBe(400);
  });
  it("rejects anonymous, unverified, suspended and cross-origin writes", async () => {
    expect((await act("publish", { body: "hello" }, null)).status).toBe(401);
    expect((await act("publish", { body: "hello" }, { ...alice, emailVerified: false })).status).toBe(403);
    expect((await act("publish", { body: "hello" }, { ...alice, suspended: true })).status).toBe(403);
    expect((await act("publish", { body: "hello" }, alice, "https://evil.com")).status).toBe(403);
  });
  it("keeps feed chronological and excludes replies", async () => {
    await act("publish", { body: "First" });
    const first = row("SELECT id FROM posts").id;
    execute("UPDATE posts SET created_at=1 WHERE id=?", first);
    await act("publish", { body: "Second" });
    await act("publish", { body: "Reply", parentId: first }, bob);
    const feed = await posts("p.root_id IS NULL", []);
    expect(feed.map((p) => p.body)).toEqual(["Second", "First"]);
  });
  it("separates direct replies from branches and preserves parent links at each level", async () => {
    const root = (await act("publish", { body: "Root" })).data.id;
    const a = (await act("publish", { body: "Branch A", parentId: root }, bob)).data.id;
    const b = (await act("publish", { body: "Branch B", parentId: root }, bob)).data.id;
    const child = (await act("publish", { body: "A child", parentId: a })).data.id;
    const leaf = (await act("publish", { body: "A leaf", parentId: child }, bob)).data.id;
    expect(await post(leaf)).toMatchObject({ rootId: root, parentId: child });
    expect(await post(child)).toMatchObject({ rootId: root, parentId: a });
    expect((await posts("p.parent_id=?", [root])).map((p) => p.id).sort()).toEqual([a, b].sort());
    expect((await posts("p.parent_id=?", [a])).map((p) => p.id)).toEqual([child]);
    expect((await posts("p.id=?", [root]))[0]).toMatchObject({ replies: 4, directReplies: 2 });
    expect((await posts("p.id=?", [a]))[0]).toMatchObject({ replies: 0, directReplies: 1, parentUsername: "alice" });
    await act("delete", { id: a }, bob);
    expect(await post(a)).toMatchObject({ deleted: 1, parentId: root });
    expect((await posts("p.id=?", [a]))[0]).toMatchObject({ hasChildren: 1, directReplies: 1 });
    const admin = seedUser("moderator", true, "admin");
    await act("moderate", { id: root, operation: "lock" }, admin);
    expect((await post(root))?.locked).toBe(1);
    expect((await act("publish", { body: "Blocked", parentId: leaf })).status).toBe(400);
  });
  it("handles idempotent likes, grouped notification records and unlike", async () => {
    await act("publish", { body: "Hello" });
    const id = row("SELECT id FROM posts").id;
    await act("like", { id, liked: true }, bob);
    await act("like", { id, liked: true }, bob);
    expect(row("SELECT COUNT(*) n FROM likes").n).toBe(1);
    expect(row("SELECT COUNT(*) n FROM notifications").n).toBe(1);
    await act("like", { id, liked: false }, bob);
    expect(row("SELECT COUNT(*) n FROM notifications").n).toBe(0);
  });
  it("prevents editing other users and preserves deleted parents", async () => {
    await act("publish", { body: "Parent" });
    const id = row("SELECT id FROM posts").id;
    expect((await act("edit", { id, body: "hijack" }, bob)).status).toBe(403);
    await act("publish", { body: "Reply", parentId: id }, bob);
    await act("delete", { id });
    expect(row("SELECT body,deleted FROM posts WHERE id=?", id)).toMatchObject({ body: "", deleted: 1 });
    expect(row("SELECT COUNT(*) n FROM posts WHERE root_id=?", id).n).toBe(1);
  });
  it("locks threads and audits admin actions", async () => {
    await act("publish", { body: "Hello" });
    const id = row("SELECT id FROM posts").id;
    expect((await act("moderate", { id, operation: "lock" }, bob)).status).toBe(403);
    const admin = seedUser("admin", true, "admin");
    await act("moderate", { id, operation: "lock" }, admin);
    expect((await act("publish", { body: "Reply", parentId: id }, bob)).status).toBe(400);
    expect(row("SELECT COUNT(*) n FROM moderation_actions").n).toBe(1);
  });
  it("keeps usernames permanent and protects bluecheck fields", async () => {
    expect((await act("onboarding", { username: "other" })).status).toBe(400);
    await act("profile", { name: "Alice", bio: "Hello", role: "admin", isCaledonMember: true });
    expect(row("SELECT role FROM user WHERE id=?", alice.id).role).toBe("user");
    expect(row("SELECT COUNT(*) n FROM memberships").n).toBe(0);
  });
  it("builds a permalink to the reply detail page", async () => {
    await act("publish", { body: "root" });
    const id = row("SELECT id FROM posts").id;
    for (let i = 0; i < 21; i++)
      execute(
        "INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        `r${i.toString().padStart(2, "0")}`,
        bob.id,
        id,
        id,
        "reply",
        i,
        i
      );
    expect(await replyLocation("r20")).toBe(`/p/${row("SELECT id FROM post_addresses WHERE post_id=?", "r20").id}`);
  });
});
describe("previews", () => {
  it("caches sanitized metadata and keeps one non-image card", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          '<title>Fallback</title><meta property="og:title" content="Research talk"><meta property="og:description" content="A good discussion"><meta property="og:image" content="/thumb.png">',
          { headers: { "Content-Type": "text/html" } }
        )
    );
    vi.stubGlobal("fetch", fetcher);
    const first = await inspectLink("https://github.com/CaledonInstitute");
    expect(first?.title).toBe("Research talk");
    expect(first?.image).toBe("https://github.com/thumb.png");
    await inspectLink("https://github.com/CaledonInstitute");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const links = await inspectBody("https://github.com/CaledonInstitute\n\nhttps://www.astro.build");
    expect(links).toHaveLength(1);
  });
  it("falls back when provider fails and rejects fake images", async () => {
    vi.stubGlobal("fetch", async () => new Response("<svg/>", { headers: { "Content-Type": "image/png" } }));
    expect(await inspectLink("https://github.com/picture.png")).toBeNull();
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    expect(await inspectLink("https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect((await act("publish", { body: "https://github.com/unavailable" })).status).toBe(200);
  });
  it("prefers image bytes over HTML SEO cards for image attachment URLs", async () => {
    const jpeg = new Uint8Array([255, 216, 255, 225, 0, 16]);
    const html =
      '<title>Photo</title><meta property="og:title" content="SEO card"><meta property="og:description" content="Should not win"><meta property="og:image" content="/thumb.png">';
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const accept = String(new Headers(init?.headers).get("Accept") || "");
      if (accept.includes("image/")) return new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } });
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const preview = await inspectLink("https://cdn.example.com/attachments/1/2/photo.jpg?ex=sig");
    expect(preview).toMatchObject({ kind: "image", image: "https://cdn.example.com/attachments/1/2/photo.jpg?ex=sig", title: "" });
    expect(fetcher.mock.calls.every(([, init]) => String(new Headers(init?.headers).get("Accept") || "").includes("image/"))).toBe(true);
  });
  it("never turns video or audio attachment URLs into SEO cards", async () => {
    const html =
      '<title>Clip</title><meta property="og:title" content="Video page"><meta property="og:description" content="Clip"><meta property="og:image" content="/thumb.png">';
    const fetcher = vi.fn(async () => new Response(html, { headers: { "Content-Type": "text/html" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await inspectLink("https://cdn.example.com/clip.mp4")).toBeNull();
    expect(await inspectLink("https://cdn.example.com/track.mp3?token=1")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("still scrapes ordinary HTML pages without media extensions", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response('<meta property="og:title" content="Article"><meta property="og:description" content="News">', {
          headers: { "Content-Type": "text/html" },
        })
    );
    expect(await inspectLink("https://news.example.com/story")).toMatchObject({ kind: "link", title: "Article" });
  });
  it("reclassifies stale SEO cards for image paths like Imgur instead of serving the 24h cache", async () => {
    const url = "https://i.imgur.com/MEJbf21.png";
    execute(
      "INSERT INTO link_previews(id,url,kind,title,description,site,image,checked_at) VALUES(?,?,?,?,?,?,?,?)",
      "stale-imgur",
      url,
      "link",
      "SEO card",
      "Should not stick",
      "imgur.com",
      "https://i.imgur.com/MEJbf21.png",
      Date.now()
    );
    const jpeg = new Uint8Array([255, 216, 255, 225, 0, 16]);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const accept = String(new Headers(init?.headers).get("Accept") || "");
      if (accept.includes("image/")) return new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } });
      return new Response('<meta property="og:title" content="SEO card">', { headers: { "Content-Type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await inspectLink(url)).toMatchObject({ id: "stale-imgur", kind: "image", image: url, title: "" });
    expect(row("SELECT kind,title FROM link_previews WHERE id=?", "stale-imgur")).toMatchObject({ kind: "image", title: "" });
    expect(normalizePreview({ id: "x", url, kind: "link", title: "SEO", description: "nope", site: "imgur.com", image: url, videoId: null, checkedAt: 1 })).toMatchObject({
      kind: "image",
      image: url,
      title: "",
    });
  });
});
describe("membership", () => {
  async function link() {
    execute(
      "INSERT INTO account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      "github-account",
      "1234",
      "github",
      alice.id,
      await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: "oauth-test" }),
      Date.now(),
      Date.now()
    );
  }
  it("accepts active private membership, encrypts tokens, caches and revokes", async () => {
    await link();
    const fetcher = vi.fn(async () => Response.json({ state: "active", role: "admin" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await refreshMembership(alice.id)).toBe(true);
    expect(row("SELECT access_token FROM account").access_token).not.toBe("oauth-test");
    expect(await posts("1=0", [])).toHaveLength(0);
    await refreshMembership(alice.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    expect(await refreshMembership(alice.id, true)).toBe(false);
  });
  it("rejects pending and hides expired status after API failure", async () => {
    await link();
    vi.stubGlobal("fetch", async () => Response.json({ state: "pending" }));
    expect(await refreshMembership(alice.id, true)).toBe(false);
    execute("UPDATE memberships SET state='active',checked_at=1 WHERE user_id=?", alice.id);
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));
    expect(await refreshMembership(alice.id)).toBe(false);
    expect(row("SELECT checked_at FROM memberships").checked_at).toBe(1);
  });
  it("removes membership when GitHub is unlinked", async () => {
    await link();
    vi.stubGlobal("fetch", async () => Response.json({ state: "active" }));
    await refreshMembership(alice.id);
    execute("DELETE FROM account WHERE user_id=?", alice.id);
    expect(await refreshMembership(alice.id)).toBe(false);
    expect(row("SELECT COUNT(*) n FROM memberships").n).toBe(0);
  });
});
