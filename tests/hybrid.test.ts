import { beforeEach, expect, it, vi } from "vitest";
import { env, resetDatabase, seedUser, execute, row } from "./runtime";
import { post, posts } from "../src/lib/db";
import { preparePostContent } from "../src/lib/post-content";
import { GET as quotes } from "../src/pages/api/public/quotes";
import { GET as snapshot } from "../src/pages/api/live/snapshot";
beforeEach(() => {
  resetDatabase();
  seedUser();
});
it("prepares twenty rich cards using one metadata query, without server-side rich rendering", async () => {
  for (let i = 0; i < 20; i++)
    execute(
      "INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,'alice',?,1,1)",
      `p${i}`,
      "**Bold** <script>unsafe()</script>\n\n```python\nprint(1)\n```\n\n$E=mc^2$"
    );
  const items = await posts("p.deleted=0", []);
  const prepare = vi.spyOn(env.DB, "prepare");
  const result = await preparePostContent(items);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(result.size).toBe(20);
  expect(result.get("p0")?.body).toContain("**Bold**");
  expect(result.get("p0")).not.toHaveProperty("html");
  prepare.mockRestore();
});
it("keeps a full 25,000-character source and a bounded card excerpt separate", async () => {
  const body = "**Bold**\n\n" + "a".repeat(24990);
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('long','alice',?,1,1)", body);
  const p = (await post("long"))!;
  expect((await preparePostContent([p])).get(p.id)?.body.length).toBeLessThanOrEqual(600);
  expect((await preparePostContent([p], new Set([p.id]))).get(p.id)?.body).toBe(body);
});
it("returns current public quote data without private user fields or cached deleted content", async () => {
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('quote','alice','Old',1,1)");
  const id = row("SELECT id FROM post_addresses WHERE post_id='quote'").id;
  const read = () => quotes({ url: new URL(`http://localhost/api/public/quotes?ids=${id}`) } as any) as Promise<Response>;
  let data = (await (await read()).json()) as any;
  expect(data.items[0]).toMatchObject({ body: "Old", username: "alice" });
  expect(data.items[0]).not.toHaveProperty("email");
  expect(data.items[0]).not.toHaveProperty("liked");
  execute("UPDATE posts SET body='New' WHERE id='quote'");
  expect(((await (await read()).json()) as any).items[0].body).toBe("New");
  execute("UPDATE posts SET deleted=1 WHERE id='quote'");
  data = await (await read()).json();
  expect(data.items[0]).toEqual({ publicId: id, unavailable: true });
});
it("snapshots inherit root locks and never expose another user's unread count", async () => {
  seedUser("bob");
  execute("INSERT INTO posts(id,author_id,body,locked,created_at,updated_at) VALUES('root','alice','Root',1,1,1)");
  execute("INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('child','bob','root','root','Reply',1,1)");
  execute("INSERT INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at) VALUES('private','alice','bob','root','like',1)");
  const read = async (user: any) =>
    (await ((await snapshot({ url: new URL("http://localhost/api/live/snapshot?parent=child&ids=root"), locals: { user } } as any)) as Response).json()) as any;
  const anonymous = await read(null);
  expect(anonymous.thread).toMatchObject({ locked: 1, deleted: 0 });
  expect(anonymous.unread).toBe(0);
  expect((await read({ id: "alice" })).unread).toBe(1);
  expect((await read({ id: "bob" })).unread).toBe(0);
});
