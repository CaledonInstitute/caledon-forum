import { z } from "zod";
import { db, all, one, run, replyLocation, publishBatch } from "./db";
import { extractMentions } from "./mentions";
import { quotedPost } from "./quotes";
import { validateBody } from "./content";
import { markdown } from "./markdown";
import { inspectBody, attachPreviews } from "./previews";
import { refreshMembership } from "./membership";
import { isValidUsername } from "./usernames";
import { avatarUrl, fetchAvatar } from "./avatar";
import type { Viewer } from "./types";
import { signalChange } from "./control";
const id = z.string().min(1).max(100);
function mentionNotifications(body: string, postId: string, actorId: string, now: number, exclude = "") {
  return db()
    .prepare(
      `INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at)
    SELECT lower(hex(randomblob(16))),id,?,?,'mention',? FROM user
    WHERE username IN (SELECT value FROM json_each(?)) AND id!=? AND id!=? AND suspended=0
    AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.recipient_id=user.id AND n.post_id=? AND n.actor_id=? AND n.kind='reply')
    AND EXISTS(SELECT 1 FROM posts WHERE id=? AND deleted=0)`
    )
    .bind(actorId, postId, now, JSON.stringify(extractMentions(body)), actorId, exclude, postId, actorId, postId);
}
export async function forumAction(user: Viewer, action: string, data: any): Promise<Response> {
  const response = await forumActionImpl(user, action, data);
  if (response.ok && ["publish", "edit", "delete", "like", "read", "moderate", "profile", "repost", "activity"].includes(action)) {
    await signalChange();
  }
  return response;
}
async function forumActionImpl(user: Viewer, action: string, data: any): Promise<Response> {
  if (user.suspended) return Response.json({ error: "Your account is suspended." }, { status: 403 });
  if (action === "activity") {
    const input = z.object({ visible: z.boolean() }).parse(data);
    await run("UPDATE user SET show_activity=? WHERE id=?", input.visible ? 1 : 0, user.id);
    return Response.json({ ok: true });
  }
  if (action === "membership") return Response.json({ isCaledonMember: await refreshMembership(user.id, true) });
  if (action === "profile") {
    const imageInput = z.string().trim().max(2048).nullable().optional();
    const input = z
      .object({ name: z.string().trim().min(1).max(80), bio: z.string().max(300), location: z.string().trim().max(100).optional(), image: imageInput, coverImage: imageInput })
      .parse(data);
    const fields = ["name=?", "bio=?", "updated_at=?"];
    const values: (string | number | null)[] = [input.name, input.bio, Date.now()];
    if (input.location !== undefined) {
      fields.push("location=?");
      values.push(input.location);
    }
    for (const [key, column, label] of [
      ["image", "image", "Profile image"],
      ["coverImage", "cover_image", "Cover photo"],
    ] as const) {
      if (input[key] === undefined) continue;
      const image = input[key] ? avatarUrl(input[key], label) : null;
      if (image) await fetchAvatar(image, label);
      fields.push(`${column}=?`);
      values.push(image);
    }
    await run(`UPDATE user SET ${fields.join(",")} WHERE id=?`, ...values, user.id);
    return Response.json({ ok: true });
  }
  if (action === "onboarding") {
    const input = z
      .object({ username: z.string().refine(isValidUsername, "Choose 1–30 letters, numbers, or underscores. Do not start with a number. System names are reserved.") })
      .parse(data);
    if (user.username) throw new Error("Your username is already set.");
    try {
      await run("UPDATE user SET username=?,display_username=?,updated_at=? WHERE id=? AND username IS NULL", input.username.toLowerCase(), input.username, Date.now(), user.id);
    } catch {
      throw new Error("That username is already taken. Choose another.");
    }
    return Response.json({ ok: true });
  }
  if (action === "read") {
    await run("UPDATE notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL", Date.now(), user.id);
    return Response.json({ ok: true });
  }
  if (!user.username) return Response.json({ error: "Choose your username first." }, { status: 403 });
  if (!user.emailVerified) return Response.json({ error: "Verify your email before interacting." }, { status: 403 });
  if (action === "mentions") {
    const { query } = z
      .object({
        query: z
          .string()
          .max(30)
          .regex(/^[a-zA-Z0-9_]*$/),
      })
      .parse(data);
    const prefix = query.toLowerCase();
    return Response.json({
      users: await all(
        `SELECT name,username,image FROM user WHERE username IS NOT NULL AND suspended=0
      AND substr(username,1,length(?))=? ORDER BY CASE WHEN username=? THEN 0 ELSE 1 END,username LIMIT 6`,
        prefix,
        prefix,
        prefix
      ),
    });
  }
  if (action === "quote") return Response.json({ quote: await quotedPost(validateBody(data.body)) });
  if (action === "preview-data") return Response.json({ links: await inspectBody(validateBody(data.body)) });
  if (action === "preview") {
    const body = validateBody(data.body);
    const links = await inspectBody(body);
    const quote = await quotedPost(body);
    return Response.json({ html: await markdown(body, links, quote?.sourceUrl), links, quote });
  }
  if (action === "publish") {
    const body = validateBody(data.body);
    const parentId = data.parentId ? id.parse(data.parentId) : null;
    const parent = parentId
      ? await one<{ id: string; root_id: string | null; author_id: string; deleted: number }>("SELECT id,root_id,author_id,deleted FROM posts WHERE id=?", parentId)
      : null;
    if (parentId && (!parent || parent.deleted)) throw new Error("This post is no longer available for replies.");
    const rootId = parent ? parent.root_id || parent.id : null;
    const postId = crypto.randomUUID();
    const now = Date.now();
    const links = await inspectBody(body);
    const statement = rootId
      ? db()
          .prepare(
            "INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND locked=0) AND EXISTS(SELECT 1 FROM posts WHERE id=? AND deleted=0)"
          )
          .bind(postId, user.id, rootId, parentId, body, now, now, rootId, parentId)
      : db().prepare("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?)").bind(postId, user.id, body, now, now);
    const statements = [
      statement,
      ...links.map((p, i) =>
        db().prepare("INSERT OR IGNORE INTO post_links(post_id,preview_id,position) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=?)").bind(postId, p.id, i, postId)
      ),
    ];
    if (parent && parent.author_id !== user.id)
      statements.push(
        db()
          .prepare("INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=?)")
          .bind(crypto.randomUUID(), parent.author_id, user.id, postId, "reply", now, postId)
      );
    statements.push(mentionNotifications(body, postId, user.id, now, parent?.author_id));
    const results = await publishBatch(statements);
    if (!results[0].meta.changes) throw new Error("This thread is locked.");
    return Response.json({ ok: true, id: postId, url: await replyLocation(postId) });
  }
  if (action === "edit" || action === "delete") {
    const postId = id.parse(data.id);
    const own = await one<{ deleted: number }>("SELECT deleted FROM posts WHERE id=? AND author_id=?", postId, user.id);
    if (!own || own.deleted) return Response.json({ error: "You cannot change this post." }, { status: 403 });
    if (action === "delete") {
      await db().batch([
        db().prepare("UPDATE posts SET body='',deleted=1,updated_at=? WHERE id=? AND author_id=?").bind(Date.now(), postId, user.id),
        db().prepare("DELETE FROM post_links WHERE post_id=?").bind(postId),
      ]);
    } else {
      const body = validateBody(data.body);
      const links = await inspectBody(body);
      const now = Date.now();
      await db().batch([
        db().prepare("UPDATE posts SET body=?,updated_at=? WHERE id=? AND author_id=? AND deleted=0").bind(body, now, postId, user.id),
        db()
          .prepare("DELETE FROM notifications WHERE post_id=? AND kind='mention' AND recipient_id NOT IN (SELECT id FROM user WHERE username IN (SELECT value FROM json_each(?)))")
          .bind(postId, JSON.stringify(extractMentions(body))),
        mentionNotifications(body, postId, user.id, now),
      ]);
      await attachPreviews(postId, links);
    }
    return Response.json({ ok: true, url: await replyLocation(postId) });
  }
  if (action === "like") {
    const input = z.object({ id, liked: z.boolean() }).parse(data);
    const target = await one<{ author_id: string; deleted: number }>("SELECT author_id,deleted FROM posts WHERE id=?", input.id);
    if (!target || target.deleted) throw new Error("This post is no longer available.");
    if (input.liked) {
      const statements = [db().prepare("INSERT OR IGNORE INTO likes(post_id,user_id,created_at) VALUES(?,?,?)").bind(input.id, user.id, Date.now())];
      if (target.author_id !== user.id)
        statements.push(
          db()
            .prepare("INSERT OR IGNORE INTO notifications(id,recipient_id,actor_id,post_id,kind,created_at) VALUES(?,?,?,?,'like',?)")
            .bind(crypto.randomUUID(), target.author_id, user.id, input.id, Date.now())
        );
      await db().batch(statements);
    } else
      await db().batch([
        db().prepare("DELETE FROM likes WHERE post_id=? AND user_id=?").bind(input.id, user.id),
        db().prepare("DELETE FROM notifications WHERE post_id=? AND actor_id=? AND kind='like'").bind(input.id, user.id),
      ]);
    return Response.json({ ok: true, liked: input.liked, ...(await one("SELECT COUNT(*) AS likes FROM likes WHERE post_id=?", input.id)) });
  }
  if (action === "repost") {
    const input = z.object({ id, reposted: z.boolean() }).parse(data);
    if (input.reposted) await run("INSERT OR IGNORE INTO reposts(user_id,post_id,created_at) SELECT ?,id,? FROM posts WHERE id=? AND deleted=0", user.id, Date.now(), input.id);
    else await run("DELETE FROM reposts WHERE user_id=? AND post_id=?", user.id, input.id);
    return Response.json({ ok: true, reposted: input.reposted, ...(await one("SELECT COUNT(*) AS reposts FROM reposts WHERE post_id=?", input.id)) });
  }
  if (action === "report") {
    const input = z.object({ id, reason: z.string().trim().min(5).max(1000) }).parse(data);
    await run(
      "INSERT OR IGNORE INTO reports(id,post_id,reporter_id,reason,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM posts WHERE id=? AND deleted=0)",
      crypto.randomUUID(),
      input.id,
      user.id,
      input.reason,
      Date.now(),
      input.id
    );
    return Response.json({ ok: true });
  }
  if (action === "moderate") {
    if (user.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
    const input = z.object({ id, operation: z.enum(["delete", "lock", "unlock", "suspend", "restore", "resolve"]) }).parse(data);
    if (input.operation === "suspend" && input.id === user.id) throw new Error("You cannot suspend your own account.");
    const statements = [];
    if (input.operation === "delete")
      statements.push(
        db().prepare("UPDATE posts SET body='',deleted=1,updated_at=? WHERE id=?").bind(Date.now(), input.id),
        db().prepare("DELETE FROM post_links WHERE post_id=?").bind(input.id)
      );
    if (input.operation === "lock" || input.operation === "unlock")
      statements.push(
        db()
          .prepare("UPDATE posts SET locked=? WHERE id=? AND root_id IS NULL")
          .bind(input.operation === "lock" ? 1 : 0, input.id)
      );
    if (input.operation === "suspend" || input.operation === "restore")
      statements.push(
        db()
          .prepare("UPDATE user SET suspended=? WHERE id=?")
          .bind(input.operation === "suspend" ? 1 : 0, input.id)
      );
    if (input.operation === "resolve") statements.push(db().prepare("UPDATE reports SET status='resolved' WHERE id=?").bind(input.id));
    statements.push(
      db()
        .prepare("INSERT INTO moderation_actions(id,admin_id,action,target_id,created_at) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(), user.id, input.operation, input.id, Date.now())
    );
    await db().batch(statements);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Action not found." }, { status: 404 });
}
