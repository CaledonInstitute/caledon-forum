import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase, seedUser, execute, row } from "./runtime";
import { forumAction } from "../src/lib/forum-service";
import { markdown } from "../src/lib/markdown";
import { extractMentions } from "../src/lib/mentions";
import { activeMention } from "../src/lib/mention-input";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

beforeEach(resetDatabase);
describe("mentions", () => {
  it("only links prose, preserving code, links, email, math, and reserved names", async () => {
    const body =
      "Hello **@Bob**, (@alice)! <strong>@carol</strong>\n\n`@code`\n\n```text\n@fenced\n```\n\n[ask @linked](https://example.com/@path) mail@domain.com $@math$ @login @1bad @this_name_is_longer_than_thirty_characters";
    expect(extractMentions(body)).toEqual(["bob", "alice", "carol"]);
    const html = await markdown(body);
    expect(html).toContain('<a href="/bob" class="mention" rel="ugc nofollow noopener">@Bob</a>');
    expect(html.match(/class="mention"/g)).toHaveLength(3);
    expect(html).toContain('target="_blank"');
  });
  it("detects a mention at the cursor without replacing following text", () => {
    expect(activeMention("Hi @bo, hello", 6)).toEqual({ start: 3, end: 6, query: "bo" });
    expect(activeMention("@", 1)?.query).toBe("");
    expect(activeMention("mail@bob", 8)).toBeNull();
    expect(activeMention("@bob ", 5)).toBeNull();
  });
  it("suggests public usernames with a literal underscore prefix and excludes suspended users", async () => {
    const alice = seedUser();
    seedUser("bob");
    seedUser("b_ob");
    seedUser("bobby");
    execute("UPDATE user SET suspended=1 WHERE id='bobby'");
    const response = await forumAction(alice, "mentions", { query: "B_" });
    expect(((await response.json()) as any).users.map((u: any) => u.username)).toEqual(["b_ob"]);
  });
  it("notifies existing recipients once, skips self, and reconciles edited mentions", async () => {
    const alice = seedUser();
    seedUser("bob");
    seedUser("carol");
    const published = (await (await forumAction(alice, "publish", { body: "Hi @Bob @bob @alice @missing `@carol`" })).json()) as any;
    expect(row("SELECT COUNT(*) n FROM notifications").n).toBe(1);
    expect(row("SELECT recipient_id,kind FROM notifications")).toMatchObject({ recipient_id: "bob", kind: "mention" });
    execute("UPDATE notifications SET read_at=123");
    await forumAction(alice, "edit", { id: published.id, body: "Hi again @bob" });
    expect(row("SELECT read_at FROM notifications").read_at).toBe(123);
    await forumAction(alice, "edit", { id: published.id, body: "Hi @carol" });
    expect(row("SELECT COUNT(*) n FROM notifications").n).toBe(1);
    expect(row("SELECT recipient_id FROM notifications").recipient_id).toBe("carol");
  });
  it("does not duplicate reply notifications or notify from failed locked replies", async () => {
    const alice = seedUser();
    const bob = seedUser("bob");
    seedUser("carol");
    const root = (await (await forumAction(bob, "publish", { body: "Hello" })).json()) as any;
    const reply = (await (await forumAction(alice, "publish", { body: "Hi @bob @carol", parentId: root.id })).json()) as any;
    expect(row("SELECT COUNT(*) n FROM notifications WHERE recipient_id='bob'").n).toBe(1);
    await forumAction(alice, "edit", { id: reply.id, body: "Hi again @bob @carol" });
    expect(row("SELECT COUNT(*) n FROM notifications WHERE recipient_id='bob'").n).toBe(1);
    execute("UPDATE posts SET locked=1 WHERE id=?", root.id);
    await expect(forumAction(alice, "publish", { body: "Hi @carol", parentId: root.id })).rejects.toThrow("locked");
    expect(row("SELECT COUNT(*) n FROM notifications WHERE kind='mention'").n).toBe(1);
  });
  it("preserves existing notification rows during the migration", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFileSync(new URL("../migrations/0001_forum.sql", import.meta.url), "utf8"));
      database.exec("INSERT INTO user(id,name,email,created_at,updated_at) VALUES('alice','Alice','a@test.com',1,1),('bob','Bob','b@test.com',1,1)");
      database.exec("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('old','alice','test',1,1)");
      database.exec("INSERT INTO notifications VALUES('old','bob','alice','old','like',1,123)");
      database.exec(readFileSync(new URL("../migrations/0009_mentions.sql", import.meta.url), "utf8"));
      expect(database.prepare("SELECT read_at FROM notifications WHERE id='old'").get()?.read_at).toBe(123);
      database.exec("INSERT INTO notifications VALUES('new','bob','alice','old','mention',2,NULL)");
    } finally {
      database.close();
    }
  });
});
