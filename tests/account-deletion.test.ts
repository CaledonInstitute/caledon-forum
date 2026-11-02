import { beforeEach, it, expect, vi } from "vitest";
import { resetDatabase, seedUser, row, execute } from "./runtime";
import { deleteAccount, cleanupAccounts } from "../src/lib/account-deletion";
import { post, publicProfile } from "../src/lib/db";
import { forumAction } from "../src/lib/forum-service";
import { cleanupUploads } from "../src/lib/uploads";
import { b2 } from "../src/lib/b2";
vi.mock("../src/lib/b2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/b2")>()),
  uploadsReady: () => true,
  storageReady: () => true,
  b2: vi.fn(async () => new Response(null, { status: 204 })),
}));
beforeEach(() => {
  resetDatabase();
  vi.clearAllMocks();
  seedUser();
  seedUser("bob");
});
it("removes credentials and identity immediately and preserves replies through a shared placeholder", async () => {
  execute("INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('account','a','github','alice',1,1)");
  execute("INSERT INTO session(id,token,user_id,created_at,updated_at,expires_at) VALUES('session','token','alice',1,1,9999999999999)");
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('root','alice','private content',1,1)");
  execute("INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('reply','bob','root','root','Keep my reply',2,2)");
  execute("INSERT INTO notifications VALUES('notification','bob','alice','root','mention',1,NULL)");
  execute("INSERT INTO likes VALUES('reply','alice',1)");
  execute("INSERT INTO memberships VALUES('alice','github','active',1,0)");
  execute("INSERT INTO reports VALUES('report','reply','alice','reason','open',1)");
  execute("INSERT INTO moderation_actions VALUES('audit','alice','delete','root',1)");
  execute("INSERT INTO verification VALUES('verify','alice@mail.test','alice',999999999,1,1)");
  const viewer = seedUser("stale");
  execute("DELETE FROM user WHERE id='stale'");
  viewer.id = "alice";
  await deleteAccount("alice");
  expect(await publicProfile("alice")).toBeNull();
  expect(row("SELECT * FROM account WHERE user_id='alice'")).toBeUndefined();
  expect(row("SELECT * FROM session WHERE user_id='alice'")).toBeUndefined();
  expect((await forumAction(viewer, "publish", { body: "late write" })).status).toBe(403);
  expect((await post("root"))?.body).toBe("");
  expect((await post("root"))?.deleted).toBe(1);
  await cleanupAccounts();
  await cleanupAccounts();
  expect(row("SELECT * FROM user WHERE id='alice'")).toBeUndefined();
  expect((await post("root"))?.name).toBe("Deleted account");
  expect((await post("reply"))?.body).toBe("Keep my reply");
  expect((await post("reply"))?.parentId).toBe("root");
  expect(row("PRAGMA foreign_key_check")).toBeUndefined();
});
it("deletes both sides of a DM conversation and their file versions, retrying failed storage cleanup", async () => {
  execute("INSERT INTO dm_conversations VALUES('conversation','alice','bob',1,1)");
  for (const [id, sender] of [
    ["a", "alice"],
    ["b", "bob"],
  ]) {
    execute(
      "INSERT INTO dm_messages(id,conversation_id,sender_id,sender_version,recipient_version,sender_public_key,envelopes,created_at) VALUES(?,'conversation',?,1,1,'{}','{}',1)",
      id,
      sender
    );
    execute(
      "INSERT INTO uploads(id,owner_id,purpose,conversation_id,name,mime,size,object_key,object_version,state,created_at,expires_at) VALUES(?,?,'dm','conversation','encrypted','application/octet-stream',32,?, 'version','ready',1,9999999999999)",
      id,
      sender,
      id
    );
    execute("INSERT INTO dm_attachments VALUES(?,?)", id, id);
  }
  await deleteAccount("alice");
  await cleanupAccounts();
  expect(row("SELECT * FROM dm_conversations WHERE id='conversation'")).toBeUndefined();
  expect(row("SELECT * FROM dm_messages")).toBeUndefined();
  vi.mocked(b2).mockRejectedValueOnce(new Error("offline"));
  await cleanupUploads();
  expect(row("SELECT COUNT(*) n FROM uploads").n).toBe(1);
  await cleanupAccounts();
  await cleanupUploads();
  await cleanupAccounts();
  expect(row("SELECT * FROM uploads")).toBeUndefined();
  expect(row("SELECT * FROM user WHERE id='alice'")).toBeUndefined();
  expect(row("SELECT * FROM user WHERE id='bob'")).toBeTruthy();
  expect(row("PRAGMA foreign_key_check")).toBeUndefined();
});
it("refuses to delete the last active admin, including the database race guard", async () => {
  execute("UPDATE user SET role='admin' WHERE id='alice'");
  await expect(deleteAccount("alice")).rejects.toThrow("admin");
  expect(() => execute("UPDATE user SET deleting_at=1 WHERE id='alice'")).toThrow("last active administrator");
  execute("UPDATE user SET role='admin' WHERE id='bob'");
  await deleteAccount("alice");
  await expect(deleteAccount("bob")).rejects.toThrow("admin");
});
