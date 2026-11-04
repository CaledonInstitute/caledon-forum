import { all, db, one, run } from "./db";
import { signalChange, signalDirectMessages } from "./control";
export async function deleteAccount(userId: string) {
  const user = await one<{ role: string; email: string }>("SELECT role,email FROM user WHERE id=? AND deleting_at IS NULL", userId);
  if (!user) throw new Error("This account is already being deleted.");
  if (user.role === "admin" && !(await one("SELECT 1 FROM user WHERE role='admin' AND id<>? AND deleting_at IS NULL AND suspended=0", userId)))
    throw new Error("Give another active account the admin role before deleting your account.");
  const peers = await all<{ id: string }>("SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS id FROM dm_conversations WHERE user_a=? OR user_b=?", userId, userId, userId);
  const now = Date.now();
  await db().batch([
    db().prepare("INSERT INTO account_deletions(user_id,created_at) VALUES(?,?)").bind(userId, now),
    db()
      .prepare(
        "UPDATE user SET deleting_at=?,suspended=1,name='Deleted account',email=?||'@deleted.invalid',username=NULL,display_username=NULL,image=NULL,cover_image=NULL,bio='',location='',last_active_at=NULL,show_activity=0 WHERE id=?"
      )
      .bind(now, crypto.randomUUID(), userId),
    db().prepare("UPDATE marketplace_listings SET deleted=1,title='Deleted listing',description='',location='' WHERE seller_id=?").bind(userId),
    db().prepare("DELETE FROM marketplace_photos WHERE listing_id IN (SELECT id FROM marketplace_listings WHERE seller_id=?)").bind(userId),
    db().prepare("UPDATE posts SET body='',original_body=NULL,editor_doc=NULL,deleted=1,updated_at=? WHERE author_id=?").bind(now, userId),
    db()
      .prepare("UPDATE uploads SET state='deleting',name='Deleted attachment' WHERE owner_id=? OR conversation_id IN (SELECT id FROM dm_conversations WHERE user_a=? OR user_b=?)")
      .bind(userId, userId, userId),
    ...["session", "account", "api_keys", "memberships", "push_subscriptions", "push_preferences", "dm_vaults"].map((table) =>
      db().prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(userId)
    ),
    db().prepare("DELETE FROM deletion_intents WHERE user_id=?").bind(userId),
    db().prepare("DELETE FROM verification WHERE identifier=? OR value=?").bind(user.email, userId),
  ]);
  await Promise.all([signalChange(), signalDirectMessages([userId, ...peers.map((p) => p.id)])]);
}
export async function cleanupAccounts() {
  for (const job of await all<{ user_id: string }>("SELECT user_id FROM account_deletions ORDER BY created_at LIMIT 5")) {
    const id = job.user_id;
    // One conversation per pass, bounded messages per pass. The deletion marker already denies access.
    const conv = await one<{ id: string }>("SELECT id FROM dm_conversations WHERE user_a=? OR user_b=? LIMIT 1", id, id);
    if (conv) {
      await run("DELETE FROM dm_messages WHERE id IN (SELECT id FROM dm_messages WHERE conversation_id=? LIMIT 100)", conv.id);
      if (!(await one("SELECT 1 FROM dm_messages WHERE conversation_id=?", conv.id)))
        await db().batch([
          db().prepare("DELETE FROM dm_reads WHERE conversation_id=?").bind(conv.id),
          db().prepare("UPDATE uploads SET conversation_id=NULL,state='deleting' WHERE conversation_id=?").bind(conv.id),
          db().prepare("DELETE FROM dm_conversations WHERE id=?").bind(conv.id),
        ]);
      continue;
    }
    await db().batch([
      db().prepare("DELETE FROM marketplace_reports WHERE reporter_id=? OR listing_id IN (SELECT id FROM marketplace_listings WHERE seller_id=?)").bind(id, id),
      db().prepare("DELETE FROM marketplace_listings WHERE seller_id=?").bind(id),
      db().prepare("DELETE FROM post_attachments WHERE post_id IN (SELECT id FROM posts WHERE author_id=?)").bind(id),
      db().prepare("DELETE FROM post_links WHERE post_id IN (SELECT id FROM posts WHERE author_id=?)").bind(id),
      db().prepare("DELETE FROM notifications WHERE recipient_id=? OR actor_id=? OR post_id IN (SELECT id FROM posts WHERE author_id=?)").bind(id, id, id),
      db().prepare("DELETE FROM likes WHERE user_id=? OR post_id IN (SELECT id FROM posts WHERE author_id=?)").bind(id, id),
      db().prepare("DELETE FROM reposts WHERE user_id=? OR post_id IN (SELECT id FROM posts WHERE author_id=?)").bind(id, id),
      db().prepare("DELETE FROM reports WHERE reporter_id=? OR post_id IN (SELECT id FROM posts WHERE author_id=?)").bind(id, id),
      db().prepare("DELETE FROM moderation_actions WHERE admin_id=? OR target_id=?").bind(id, id),
      db().prepare("DELETE FROM dm_blocks WHERE user_id=? OR blocked_id=?").bind(id, id),
      db().prepare("DELETE FROM push_daily WHERE user_id=?").bind(id),
      db().prepare("DELETE FROM push_allocations WHERE user_id=?").bind(id),
      db().prepare("DELETE FROM verification WHERE value=?").bind(id),
    ]);
    if (await one("SELECT 1 FROM uploads WHERE owner_id=?", id)) continue;
    await db().batch([
      db()
        .prepare(
          "INSERT OR IGNORE INTO user(id,name,email,email_verified,created_at,updated_at,suspended) VALUES('system-deleted','Deleted account',?||'@deleted.invalid',0,0,0,1)"
        )
        .bind(crypto.randomUUID()),
      db().prepare("UPDATE posts SET author_id='system-deleted' WHERE author_id=?").bind(id),
      db().prepare("DELETE FROM account_deletions WHERE user_id=?").bind(id),
      db().prepare("DELETE FROM user WHERE id=?").bind(id),
    ]);
  }
  await run("DELETE FROM deletion_intents WHERE expires_at<?", Date.now());
  await run(
    "DELETE FROM link_previews WHERE id IN (SELECT id FROM link_previews WHERE checked_at<? AND NOT EXISTS(SELECT 1 FROM post_links WHERE preview_id=link_previews.id) LIMIT 100)",
    Date.now() - 86400000
  );
}
