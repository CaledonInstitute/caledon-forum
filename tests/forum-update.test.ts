import { beforeEach, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resetDatabase, seedUser, execute, row } from "./runtime";
import { forumAction } from "../src/lib/forum-service";
import { profileCounts, profilePosts, post, pinnedPost } from "../src/lib/db";
import { documentBody, validateDocument, importApiDocument, importMarkdown } from "../src/lib/editor-document";
import { migrateEditorBatch } from "../src/lib/migrate-editor";
import { marketplaceAction, getListing, listMarketplace } from "../src/lib/marketplace";
import { collectUnused, referenced, getAsset, validateAttachments } from "../src/lib/uploads";
import { markdown } from "../src/lib/markdown";
import { deleteAccount, cleanupAccounts } from "../src/lib/account-deletion";

let alice: ReturnType<typeof seedUser>, bob: ReturnType<typeof seedUser>, admin: ReturnType<typeof seedUser>;
beforeEach(() => {
  resetDatabase();
  alice = seedUser();
  bob = seedUser("bob");
  admin = seedUser("admin", true, "admin");
});
const publish = async (body: string, parentId?: string) => (await (await forumAction(alice, "publish", { body, parentId })).json()) as any;
const dm = (id = "alice") => execute("INSERT INTO dm_vaults(user_id,version,public_key,vault) VALUES(?,1,'{}','{}')", id);
const input = {
  kind: "goods",
  title: "Mechanical keyboard",
  description: "A working keyboard with switches.",
  price: 250000,
  negotiable: true,
  location: "Jakarta",
  condition: "used",
  photoIds: [],
} as any;
function asset(owner = "alice", mime = "image/png") {
  const id = crypto.randomUUID();
  execute("INSERT INTO uploads(id,owner_id,purpose,name,mime,size,object_key,state,created_at,expires_at) VALUES(?,?,'post','photo.png',?,100,?,'ready',1,1)", id, owner, mime, id);
  return id;
}
it("freezes existing content at SQL cutover without changing IDs, times or interactions", () => {
  const copy = new DatabaseSync(":memory:");
  const files = readdirSync(new URL("../migrations/", import.meta.url))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const file of files.filter((n) => n < "0017")) copy.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  copy.exec(
    "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,username) VALUES('a','A','a@a.test',1,1,1,'a'); INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('old','a','*italic*',10,11); INSERT INTO likes(post_id,user_id,created_at) VALUES('old','a',12)"
  );
  const before = copy.prepare("SELECT * FROM post_addresses").get();
  copy.exec(readFileSync(new URL("../migrations/0017_forum_update.sql", import.meta.url), "utf8"));
  expect(copy.prepare("SELECT body,original_body,legacy_readonly,created_at,updated_at FROM posts").get()).toMatchObject({
    body: "*italic*",
    original_body: "*italic*",
    legacy_readonly: 1,
    created_at: 10,
    updated_at: 11,
  });
  expect(copy.prepare("SELECT * FROM post_addresses").get()).toEqual(before);
  expect(copy.prepare("SELECT COUNT(*) n FROM likes").get()).toMatchObject({ n: 1 });
  copy.close();
});
it("resumes conversion, preserves unsupported source and rejects legacy edits but permits deletion", async () => {
  const first = await publish("*italic*");
  const second = await publish("<details><summary>Title</summary>Content</details>");
  execute("UPDATE posts SET original_body=body,legacy_readonly=1");
  execute("UPDATE posts SET editor_doc=NULL");
  expect(await migrateEditorBatch(1)).toBe(1);
  expect(await migrateEditorBatch(1)).toBe(1);
  expect(await migrateEditorBatch()).toBe(0);
  expect(row("SELECT original_body FROM posts WHERE id=?", second.id).original_body).toContain("<details>");
  expect(row("SELECT editor_doc FROM posts WHERE id=?", second.id).editor_doc).toContain("legacy");
  expect((await forumAction(alice, "edit", { id: first.id, body: "changed" })).status).toBe(409);
  expect((await forumAction(alice, "delete", { id: first.id })).status).toBe(200);
  expect(row("SELECT original_body,editor_doc FROM posts WHERE id=?", first.id)).toMatchObject({ original_body: null, editor_doc: null });
});
it("derives published body from validated JSON and allows editing new content", async () => {
  const document = validateDocument({
    version: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Visual text", marks: [{ type: "italic" }] }] }] },
  });
  const result = await forumAction(alice, "publish", { body: "untrusted competing source", document });
  const created = (await result.json()) as any;
  expect((await post(created.id))?.body).toBe("*Visual text*");
  expect(JSON.parse((await post(created.id))!.editorDocument!).version).toBe(1);
  expect((await forumAction(alice, "edit", { id: created.id, document })).status).toBe(200);
  expect(() => validateDocument({ version: 1, doc: { type: "doc", content: [{ type: "script" }] } })).toThrow();
  expect(() => validateDocument({ version: 1, doc: { type: "doc", content: [{ type: "text", text: "invalid root child" }] } })).toThrow();
  expect(() =>
    validateDocument({
      version: 1,
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] },
    })
  ).toThrow();
});
it("retains Markdown formats, code, formulas, file blocks and API HTML without executing HTML", async () => {
  const id = crypto.randomUUID();
  const source = `**bold** *italic* _also italic_ ~~strike~~\n\n\`\`\`python\nprint(42)\n\`\`\`\n\n$x^2$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[file.pdf](attachment:${id})`;
  const doc = importMarkdown(source)!;
  expect(doc).not.toBeNull();
  const body = documentBody(doc);
  const html = await markdown(body);
  expect(html).toContain("<em>italic</em>");
  expect(html).toContain("<table>");
  expect(html).toContain("katex");
  expect(html).toContain("hljs");
  expect(body).toContain(`attachment:${id}`);
  const imported = importApiDocument("<strong>Safe</strong><script>alert(1)</script>");
  expect(documentBody(imported)).toContain("<strong>Safe</strong>");
  expect(await markdown(documentBody(imported))).not.toContain("<script");
  const whitespace = validateDocument({
    version: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " italic text ", marks: [{ type: "italic" }] }] }] },
  });
  expect(await markdown(documentBody(whitespace))).toContain("<em>italic text</em>");
});
it("supports a single admin announcement, replacement, automatic unpinning and audit", async () => {
  const a = await publish("First");
  const b = await publish("Second");
  const reply = await publish("Reply", a.id);
  expect((await forumAction(alice, "pin", { id: a.id, pinned: true })).status).toBe(403);
  expect((await forumAction(admin, "pin", { id: reply.id, pinned: true })).status).toBe(404);
  await forumAction(admin, "pin", { id: a.id, pinned: true });
  expect((await pinnedPost())?.id).toBe(a.id);
  await forumAction(admin, "pin", { id: b.id, pinned: true });
  expect((await pinnedPost())?.id).toBe(b.id);
  expect(row("SELECT COUNT(*) n FROM announcement").n).toBe(1);
  await forumAction(alice, "delete", { id: b.id });
  expect(await pinnedPost()).toBeNull();
  expect(row("SELECT COUNT(*) n FROM moderation_actions WHERE action='pin'").n).toBe(2);
});
it("separates profile activity and counts media posts once across photos and replies", async () => {
  const root = await publish("Root");
  const reply = await publish("Reply", root.id);
  const photo = asset();
  const video = asset("alice", "video/mp4");
  execute("INSERT INTO post_attachments(post_id,asset_id,position) VALUES(?,?,0)", root.id, photo);
  execute("INSERT INTO post_attachments(post_id,asset_id,position) VALUES(?,?,1)", root.id, video);
  const pdf = asset("alice", "application/pdf");
  execute("INSERT INTO post_attachments(post_id,asset_id,position) VALUES(?,?,0)", reply.id, pdf);
  await forumAction(bob, "repost", { id: root.id, reposted: true });
  await forumAction(bob, "like", { id: reply.id, liked: true });
  expect(await profileCounts(alice.id)).toEqual({ posts: 1, replies: 1, reposts: 0, likes: 0, media: 1 });
  expect(await profileCounts(bob.id)).toEqual({ posts: 0, replies: 0, reposts: 1, likes: 1, media: 0 });
  expect(await profilePosts(bob.id, "posts")).toHaveLength(0);
  expect(await profilePosts(bob.id, "reposts")).toHaveLength(1);
  await forumAction(alice, "delete", { id: root.id });
  expect((await profileCounts(bob.id)).reposts).toBe(0);
});
it("allows ordinary verified sellers with DM and enforces ownership and account restrictions", async () => {
  await expect(marketplaceAction(alice, "save", input)).rejects.toThrow("Enable DM");
  dm();
  const created = (await (await marketplaceAction(alice, "save", input)).json()) as any;
  expect(created.url).toContain("/marketplace/");
  expect((await getListing(created.id))?.price).toBe(250000);
  expect((await marketplaceAction(bob, "save", { ...input, id: created.id })).status).toBe(403);
  expect((await marketplaceAction(bob, "delete", { id: created.id })).status).toBe(403);
  expect((await marketplaceAction({ ...alice, suspended: true }, "save", input)).status).toBe(403);
  expect((await marketplaceAction({ ...alice, emailVerified: false }, "save", input)).status).toBe(403);
  await marketplaceAction(alice, "close", { id: created.id, status: "closed" });
  expect(await listMarketplace(new URL("http://localhost/marketplace"), 1)).toHaveLength(0);
  expect(await listMarketplace(new URL("http://localhost/marketplace?status=closed&q=keyboard"), 1)).toHaveLength(1);
});
it("validates listing photos, preserves referenced uploads and releases removed photos", async () => {
  dm();
  const photo = asset();
  const other = asset("bob");
  const pdf = asset("alice", "application/pdf");
  for (const invalid of [other, pdf]) await expect(marketplaceAction(alice, "save", { ...input, photoIds: [invalid] })).rejects.toThrow("available images");
  const created = (await (await marketplaceAction(alice, "save", { ...input, photoIds: [photo] })).json()) as any;
  expect(await referenced((await getAsset(photo))!)).toBe(true);
  await collectUnused([photo]);
  expect((await getAsset(photo))?.state).toBe("ready");
  await expect(validateAttachments(alice.id, [photo], "post")).rejects.toThrow("marketplace");
  await expect(marketplaceAction(alice, "save", { ...input, photoIds: [photo] })).rejects.toThrow("already used");
  await marketplaceAction(alice, "save", { ...input, id: created.id, photoIds: [] });
  expect((await getAsset(photo))?.state).toBe("deleting");
});
it("reports listings once, restricts moderation to admins and audits resolution", async () => {
  dm();
  const created = (await (await marketplaceAction(alice, "save", input)).json()) as any;
  await marketplaceAction(bob, "report", { id: created.id, reason: "Incorrect description" });
  await marketplaceAction(bob, "report", { id: created.id, reason: "Another reason" });
  expect(row("SELECT COUNT(*) n FROM marketplace_reports").n).toBe(1);
  expect((await marketplaceAction(bob, "moderate", { id: created.id })).status).toBe(403);
  const report = row("SELECT id FROM marketplace_reports");
  await marketplaceAction(admin, "resolve", { id: report.id });
  expect(row("SELECT status FROM marketplace_reports").status).toBe("resolved");
  expect(await getListing(created.id)).not.toBeNull();
  await marketplaceAction(admin, "moderate", { id: created.id });
  expect(await getListing(created.id)).toBeNull();
  expect(row("SELECT COUNT(*) n FROM moderation_actions WHERE action LIKE 'marketplace-%'").n).toBe(2);
});
it("removes marketplace references when deleting a seller account", async () => {
  dm();
  const photo = asset();
  await marketplaceAction(alice, "save", { ...input, photoIds: [photo] });
  await deleteAccount(alice.id);
  expect(row("SELECT deleted FROM marketplace_listings").deleted).toBe(1);
  expect(row("SELECT COUNT(*) n FROM marketplace_photos").n).toBe(0);
  execute("DELETE FROM uploads WHERE owner_id=?", alice.id);
  await cleanupAccounts();
  expect(row("SELECT id FROM user WHERE id=?", alice.id)).toBeUndefined();
});
