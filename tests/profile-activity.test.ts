import { beforeEach, it, expect } from "vitest";
import { resetDatabase, seedUser, execute, row } from "./runtime";
import { POST } from "../src/pages/api/forum/[action]";
import { profilePosts } from "../src/lib/db";
let alice: any, bob: any;
beforeEach(() => {
  resetDatabase();
  alice = seedUser();
  bob = seedUser("bob");
});
async function act(action: string, data: unknown, user: any = alice, origin = "http://localhost:4321") {
  return POST({
    params: { action },
    locals: { user },
    request: new Request(`http://localhost:4321/api/forum/${action}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  } as any);
}
it("stores, trims, preserves and clears optional location on the authenticated profile only", async () => {
  expect((await act("profile", { name: "Alice", bio: "Hello", location: "  Jakarta, Indonesia  ", id: bob.id })).status).toBe(200);
  expect(row("SELECT location FROM user WHERE id=?", alice.id).location).toBe("Jakarta, Indonesia");
  expect(row("SELECT location FROM user WHERE id=?", bob.id).location).toBe("");
  await act("profile", { name: "Alice", bio: "Changed" });
  expect(row("SELECT location FROM user WHERE id=?", alice.id).location).toBe("Jakarta, Indonesia");
  expect((await act("profile", { name: "Alice", bio: "", location: "a".repeat(101) })).status).toBe(400);
  await act("profile", { name: "Alice", bio: "", location: "  " });
  expect(row("SELECT location FROM user WHERE id=?", alice.id).location).toBe("");
});
it("counts repeated anonymous and signed-in shares, without notifications or lost increments", async () => {
  const created = (await (await act("publish", { body: "Share me" })).json()) as any;
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => act("share", { id: created.id }, i % 2 ? bob : null)));
  expect(responses.every((r) => r.status === 200)).toBe(true);
  expect(row("SELECT shares FROM posts WHERE id=?", created.id).shares).toBe(12);
  expect(row("SELECT COUNT(*) n FROM notifications").n).toBe(0);
  expect((await profilePosts(alice.id, "posts"))[0].shares).toBe(12);
  expect((await act("share", { id: created.id }, null, "https://evil.com")).status).toBe(403);
  await act("delete", { id: created.id });
  expect((await act("share", { id: created.id }, null)).status).toBe(404);
  expect((await act("share", { id: "missing" }, null)).status).toBe(404);
});
it("rate limits anonymous share writes and rejects invalid input", async () => {
  expect((await act("share", { id: "" }, null)).status).toBe(400);
  const created = (await (await act("publish", { body: "Share me" })).json()) as any;
  for (let i = 0; i < 39; i++) expect((await act("share", { id: created.id }, null)).status).toBe(200);
  expect((await act("share", { id: created.id }, null)).status).toBe(429);
});
it("lists the profile owners liked posts and replies by like time, excluding deleted posts", async () => {
  const root = (await (await act("publish", { body: "Root" }, bob)).json()) as any;
  const reply = (await (await act("publish", { body: "Reply", parentId: root.id }, bob)).json()) as any;
  await act("like", { id: reply.id, liked: true });
  await act("like", { id: root.id, liked: true });
  execute("UPDATE likes SET created_at=10 WHERE post_id=?", reply.id);
  execute("UPDATE likes SET created_at=20 WHERE post_id=?", root.id);
  expect((await profilePosts(alice.id, "likes", bob.id)).map((p) => [p.id, p.liked])).toEqual([
    [root.id, 0],
    [reply.id, 0],
  ]);
  expect(await profilePosts(bob.id, "likes")).toEqual([]);
  await act("delete", { id: root.id }, bob);
  expect((await profilePosts(alice.id, "likes")).map((p) => p.id)).toEqual([reply.id]);
  await act("like", { id: reply.id, liked: false });
  expect(await profilePosts(alice.id, "likes")).toEqual([]);
});
it("paginates liked content without duplicates", async () => {
  for (let i = 0; i < 22; i++) {
    execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)", `liked-${i}`, bob.id, "Post", i, i);
    execute("INSERT INTO likes(post_id,user_id,created_at) VALUES(?,?,?)", `liked-${i}`, alice.id, i);
  }
  const first = await profilePosts(alice.id, "likes", undefined, 1),
    second = await profilePosts(alice.id, "likes", undefined, 2);
  expect(first).toHaveLength(21);
  expect(second).toHaveLength(2);
  expect(new Set([...first.slice(0, 20), ...second].map((p) => p.id)).size).toBe(22);
});
