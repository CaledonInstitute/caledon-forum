import { beforeEach, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resetDatabase, seedUser, execute, row, env } from "./runtime";
import { post, posts, recordPostView } from "../src/lib/db";
import { POST } from "../src/pages/api/forum/[action]";

const impression = (data: unknown = { id: "root" }, origin = "http://localhost:4321", user: unknown = null) =>
  POST({
    params: { action: "view" },
    locals: { user },
    request: new Request("http://localhost:4321/api/forum/view", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  } as any);

beforeEach(() => {
  resetDatabase();
  seedUser();
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('root','alice','Root',1,1)");
  execute("INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('reply','alice','root','root','Reply',2,2)");
});

it("initializes existing and new posts to zero without changing their content", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../migrations/0001_forum.sql", import.meta.url), "utf8"));
    db.exec(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','User','u@test.com',1,1); INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('old','u','Original',1,1)"
    );
    db.exec(readFileSync(new URL("../migrations/0008_post_views.sql", import.meta.url), "utf8"));
    expect(db.prepare("SELECT body,views FROM posts WHERE id='old'").get()).toMatchObject({ body: "Original", views: 0 });
    db.exec("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('new','u','New',2,2)");
    expect(db.prepare("SELECT views FROM posts WHERE id='new'").get()).toMatchObject({ views: 0 });
  } finally {
    db.close();
  }
});

it("counts repeat opens and returns the updated count while reads stay passive", async () => {
  const p = (await post("root"))!;
  expect(p.views).toBe(0);
  await recordPostView(p, "GET");
  expect(p.views).toBe(1);
  await recordPostView(p, "GET");
  expect(p.views).toBe(2);
  expect((await posts("p.root_id IS NULL", []))[0].views).toBe(2);
  expect((await post("root"))?.views).toBe(2);
  expect(row("SELECT views,updated_at FROM posts WHERE id='root'")).toMatchObject({ views: 2, updated_at: 1 });
});

it("does not lose increments from simultaneous opens with stale post data", async () => {
  const p = (await post("root"))!;
  await Promise.all(Array.from({ length: 25 }, () => recordPostView({ ...p }, "GET")));
  expect((await post("root"))?.views).toBe(25);
});

it("counts reply opens independently and ignores HEAD and deleted posts", async () => {
  const p = (await post("root"))!,
    reply = (await post("reply"))!;
  await recordPostView(reply, "GET");
  await recordPostView(p, "HEAD");
  expect((await post("reply"))?.views).toBe(1);
  expect((await post("root"))?.views).toBe(0);
  execute("UPDATE posts SET deleted=1 WHERE id='root'");
  await recordPostView(p, "GET");
  await recordPostView((await post("root"))!, "GET");
  expect((await post("root"))?.views).toBe(0);
});

it("keeps the previous count and logs failures without blocking the post", async () => {
  const p = (await post("root"))!;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const prepare = vi.spyOn(env.DB, "prepare").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  try {
    await expect(recordPostView(p, "GET")).resolves.toBeUndefined();
    expect(p.views).toBe(0);
    expect(log).toHaveBeenCalledWith("Failed to record post view", "root", expect.any(Error));
  } finally {
    prepare.mockRestore();
    log.mockRestore();
  }
});

it("records anonymous and signed-in card impressions atomically without changing post content", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => impression({ id: "root" }, undefined, i % 2 ? { id: "alice" } : null)));
  expect(responses.every((response) => response.status === 200)).toBe(true);
  expect((await post("root"))?.views).toBe(12);
  expect(await (await impression({ id: "reply" })).json()).toMatchObject({ ok: true, views: 1 });
  expect(row("SELECT body,updated_at FROM posts WHERE id='root'")).toMatchObject({ body: "Root", updated_at: 1 });
});

it("rejects cross-origin, invalid, missing and deleted card impressions", async () => {
  expect((await impression({ id: "root" }, "https://evil.test")).status).toBe(403);
  expect((await impression({ id: "" })).status).toBe(400);
  expect((await impression({ id: "x".repeat(101) })).status).toBe(400);
  expect((await impression({ id: "missing" })).status).toBe(404);
  execute("UPDATE posts SET deleted=1 WHERE id='root'");
  expect((await impression()).status).toBe(404);
  expect(row("SELECT views FROM posts WHERE id='root'").views).toBe(0);
});

it("rate limits card impressions", async () => {
  for (let i = 0; i < 240; i++) expect((await impression()).status).toBe(200);
  const response = await impression();
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect((await post("root"))?.views).toBe(240);
});
