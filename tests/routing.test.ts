import { beforeEach, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resetDatabase, seedUser, execute, row, randomSequence } from "./runtime";
import { isValidUsername, isReservedUsername } from "../src/lib/usernames";
import { publicPost, replyLocation } from "../src/lib/db";
import { POST } from "../src/pages/api/forum/[action]";
import { forumAction } from "../src/lib/forum-service";
beforeEach(resetDatabase);
it("allows 1–30 characters while rejecting leading numbers and reserved short names", () => {
  for (const name of ["a", "Z", "ab", "_", "_1", "a1", "a".repeat(30)]) expect(isValidUsername(name), name).toBe(true);
  for (const name of ["", "1", "1a", "9_name", "a".repeat(31), "a-b", "a b", "é", "p", "P", "u", "U"]) expect(isValidUsername(name), name).toBe(false);
});
it.each(["a", "ab", "_1", "1a", "p"])("applies short username rules in onboarding: %s", async (username) => {
  const user = seedUser();
  execute("UPDATE user SET username=NULL WHERE id=?", user.id);
  user.username = null as any;
  const response = await POST({
    params: { action: "onboarding" },
    locals: { user },
    request: new Request("http://localhost:4321/api/forum/onboarding", {
      method: "POST",
      headers: { origin: "http://localhost:4321", "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    }),
  } as any);
  const valid = isValidUsername(username);
  expect(response.status).toBe(valid ? 200 : 400);
  expect(row("SELECT username FROM user WHERE id=?", user.id).username).toBe(valid ? username : null);
});
it("reserves system usernames case-insensitively", () => {
  for (const name of ["settings", "ADMIN", "search", "register", "api", "thread", "constructor", "__proto__"]) expect(isReservedUsername(name)).toBe(true);
  expect(isValidUsername("andika")).toBe(true);
  expect(isValidUsername("qa_caledon")).toBe(true);
  expect(isValidUsername("AdMiN")).toBe(false);
});
it("rejects reserved names in GitHub onboarding", async () => {
  const user = seedUser();
  execute("UPDATE user SET username=NULL WHERE id=?", user.id);
  user.username = null as any;
  const response = await POST({
    params: { action: "onboarding" },
    locals: { user },
    request: new Request("http://localhost:4321/api/forum/onboarding", {
      method: "POST",
      headers: { origin: "http://localhost:4321", "Content-Type": "application/json" },
      body: JSON.stringify({ username: "AdMiN" }),
    }),
  } as any);
  expect(response.status).toBe(400);
  expect(row("SELECT username FROM user WHERE id=?", user.id).username).toBeNull();
});
it("allocates stable random 19-digit addresses as strings and rejects UUID URLs", async () => {
  const user = seedUser();
  for (const id of ["first-uuid", "second-uuid"]) execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)", id, user.id, "hello", 1, 1);
  const first = row("SELECT id FROM post_addresses WHERE post_id=?", "first-uuid").id;
  expect(first).toMatch(/^[1-9][0-9]{18}$/);
  expect(await replyLocation("first-uuid")).toBe(`/p/${first}`);
  expect((await publicPost(String(first)))?.id).toBe("first-uuid");
  expect(await publicPost("first-uuid")).toBeNull();
  execute("DELETE FROM posts WHERE id=?", "first-uuid");
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)", "third-uuid", user.id, "hello", 1, 1);
  const third = row("SELECT id FROM post_addresses WHERE post_id=?", "third-uuid").id;
  expect(third).toMatch(/^[1-9][0-9]{18}$/);
  expect(third).not.toBe(first);
  expect(await publicPost("0")).toBeNull();
  expect(await publicPost("9007199254740992")).toBeNull();
});
it("retries address collisions without leaving a partial post or duplicate notification", async () => {
  const alice = seedUser(),
    bob = seedUser("bob");
  randomSequence([0, 0, 0, 0, 1, 1]);
  const act = (user: any, data: any) => forumAction(user, "publish", data);
  const root = (await (await act(alice, { body: "Root" })).json()) as any;
  const reply = await act(bob, { body: "Reply", parentId: root.id });
  expect(reply.status).toBe(200);
  expect(row("SELECT COUNT(*) n FROM posts").n).toBe(2);
  expect(row("SELECT COUNT(*) n FROM post_addresses").n).toBe(2);
  expect(row("SELECT COUNT(*) n FROM notifications").n).toBe(1);
  expect(row("SELECT id FROM post_addresses WHERE post_id=?", root.id).id).toBe("1000000000000000000");
});
it("preserves legacy addresses and relations while generating 19-digit IDs only for new posts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const migration of ["0001_forum.sql", "0002_public_post_addresses.sql"]) db.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    db.exec(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','User','u@test.com',1,1); INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('root','u','Root',1,1); INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('reply','u','root','root','Reply',2,2); INSERT INTO likes(post_id,user_id,created_at) VALUES('reply','u',2);"
    );
    db.exec(readFileSync(new URL("../migrations/0005_random_post_addresses.sql", import.meta.url), "utf8"));
    expect(db.prepare("SELECT id FROM post_addresses WHERE post_id=?").get("root")).toMatchObject({ id: "1" });
    expect(db.prepare("SELECT id FROM post_addresses WHERE post_id=?").get("reply")).toMatchObject({ id: "2" });
    expect(db.prepare("SELECT root_id,parent_id FROM posts WHERE id='reply'").get()).toMatchObject({ root_id: "root", parent_id: "root" });
    expect(db.prepare("SELECT post_id FROM likes").get()).toMatchObject({ post_id: "reply" });
    db.exec("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('new','u','New',3,3)");
    const address = db.prepare("SELECT id FROM post_addresses WHERE post_id=?").get("new") as { id: string };
    expect(address.id).toMatch(/^[1-9][0-9]{18}$/);
    db.exec("DELETE FROM posts WHERE id='new'");
    expect(db.prepare("SELECT id FROM post_addresses WHERE post_id=?").get("new")).toBeUndefined();
  } finally {
    db.close();
  }
});
it("backfills existing posts without changing reply and like relations", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../migrations/0001_forum.sql", import.meta.url), "utf8"));
    db.exec(
      "INSERT INTO user(id,name,email,created_at,updated_at) VALUES('u','User','u@test.com',1,1); INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('root','u','Root',1,1); INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('reply','u','root','root','Reply',2,2); INSERT INTO likes(post_id,user_id,created_at) VALUES('reply','u',2);"
    );
    db.exec(readFileSync(new URL("../migrations/0002_public_post_addresses.sql", import.meta.url), "utf8"));
    expect(db.prepare("SELECT COUNT(*) n FROM post_addresses").get()).toMatchObject({ n: 2 });
    expect(db.prepare("SELECT root_id,parent_id FROM posts WHERE id='reply'").get()).toMatchObject({ root_id: "root", parent_id: "root" });
    expect(db.prepare("SELECT post_id FROM likes").get()).toMatchObject({ post_id: "reply" });
  } finally {
    db.close();
  }
});
