import { env } from "cloudflare:workers";
import type { ForumPost, LinkPreview, PublicProfile } from "./types";
import { PAGE_SIZE } from "./content";
export const db = () => env.DB;
export const all = async <T = Record<string, unknown>>(sql: string, ...args: any[]): Promise<T[]> =>
  (
    await db()
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
export const one = async <T = Record<string, unknown>>(sql: string, ...args: any[]): Promise<T | null> =>
  db()
    .prepare(sql)
    .bind(...args)
    .first<T>();
export const run = (sql: string, ...args: any[]) =>
  db()
    .prepare(sql)
    .bind(...args)
    .run();
export const publicProfile = (username: string) =>
  one<PublicProfile>(
    `SELECT u.id,u.name,u.username,u.image,u.cover_image AS coverImage,u.bio,u.location,u.created_at,CASE WHEN u.show_activity=1 THEN u.last_active_at ELSE NULL END AS lastActiveAt,CASE WHEN m.state='active' AND m.checked_at>? AND EXISTS(SELECT 1 FROM account WHERE user_id=u.id AND provider_id='github') THEN 1 ELSE 0 END AS isCaledonMember FROM user u LEFT JOIN memberships m ON m.user_id=u.id WHERE u.username=? COLLATE NOCASE`,
    Date.now() - 86400000,
    username
  );
export async function publishBatch(statements: D1PreparedStatement[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db().batch(statements);
    } catch (error) {
      if (attempt >= 2 || !/UNIQUE constraint failed: post_addresses\.id/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}
const selection = `SELECT p.id,pa.id AS publicId,p.author_id AS authorId,p.root_id AS rootId,p.parent_id AS parentId,p.body,p.created_at AS createdAt,p.updated_at AS updatedAt,p.shares,p.views,p.deleted,p.locked,u.name,u.username,u.image,
 CASE WHEN m.state='active' AND m.checked_at>? AND EXISTS(SELECT 1 FROM account a WHERE a.user_id=u.id AND a.provider_id='github') THEN 1 ELSE 0 END AS isCaledonMember,
 (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
 (SELECT COUNT(*) FROM posts r WHERE r.root_id=p.id AND r.deleted=0) AS replies,
 (SELECT COUNT(*) FROM posts r WHERE r.parent_id=p.id AND r.deleted=0) AS directReplies,
 EXISTS(SELECT 1 FROM posts r WHERE r.parent_id=p.id) AS hasChildren,
 (SELECT COUNT(*) FROM reposts rp WHERE rp.post_id=p.id) AS reposts,
 EXISTS(SELECT 1 FROM reposts rp WHERE rp.post_id=p.id AND rp.user_id=?) AS reposted,
 EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked,
 (SELECT name FROM user pu JOIN posts pp ON pp.author_id=pu.id WHERE pp.id=p.parent_id) AS parentName,
 (SELECT pu.username FROM user pu JOIN posts pp ON pp.author_id=pu.id WHERE pp.id=p.parent_id) AS parentUsername,
 (SELECT a.id FROM post_addresses a WHERE a.post_id=p.parent_id) AS parentPublicId,
 (SELECT CASE WHEN pp.deleted=0 THEN substr(pp.body,1,120) ELSE 'Deleted post' END FROM posts pp WHERE pp.id=p.parent_id) AS parentBody
 FROM posts p JOIN post_addresses pa ON pa.post_id=p.id JOIN user u ON u.id=p.author_id LEFT JOIN memberships m ON m.user_id=u.id`;
export const posts = (where: string, args: any[], viewer?: string, order = "p.created_at DESC,p.id DESC", page = 1) =>
  all<ForumPost>(
    `${selection} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    Date.now() - 86400000,
    viewer || "",
    viewer || "",
    ...args,
    PAGE_SIZE + 1,
    (page - 1) * PAGE_SIZE
  );
export const post = async (id: string, viewer?: string) => (await posts("p.id=?", [id], viewer))[0] || null;
export const incrementPostView = (id: string) => one<{ views: number }>("UPDATE posts SET views=views+1 WHERE id=? AND deleted=0 RETURNING views", id);
export async function recordPostView(p: ForumPost, method: string) {
  if (method !== "GET" || p.deleted) return;
  try {
    const result = await incrementPostView(p.id);
    if (result) p.views = result.views;
  } catch (error) {
    console.error("Failed to record post view", p.id, error);
  }
}
export async function publicPost(value: string, viewer?: string) {
  const canonical = value.replace(/^0+/, "");
  return /^[1-9][0-9]{0,18}$/.test(canonical) ? (await posts("pa.id=?", [canonical], viewer))[0] || null : null;
}
export const previews = (id: string) =>
  all<LinkPreview>(
    `SELECT lp.id,lp.url,lp.kind,lp.title,lp.description,lp.site,lp.image,lp.video_id AS videoId,lp.checked_at AS checkedAt FROM link_previews lp JOIN post_links pl ON pl.preview_id=lp.id WHERE pl.post_id=? ORDER BY pl.position`,
    id
  );
export async function replyLocation(id: string) {
  const p = await one<{ id: string }>("SELECT id FROM post_addresses WHERE post_id=?", id);
  return p ? `/p/${p.id}` : "/";
}

export type ProfileTab = "posts" | "replies" | "likes";
export function profilePosts(authorId: string, tab: ProfileTab, viewer?: string, page = 1) {
  if (tab === "posts") return timeline(viewer, page, authorId);
  return tab === "likes"
    ? posts(
        "p.deleted=0 AND EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?)",
        [authorId, authorId],
        viewer,
        "(SELECT l.created_at FROM likes l WHERE l.post_id=p.id AND l.user_id=?) DESC,p.id DESC",
        page
      )
    : posts(`p.author_id=? AND p.deleted=0 AND p.root_id IS ${tab === "replies" ? "NOT " : ""}NULL`, [authorId], viewer, undefined, page);
}

export async function ancestors(id: string, viewer?: string) {
  return all<ForumPost>(
    `WITH RECURSIVE chain(id,parent_id,seen,depth) AS (
    SELECT id,parent_id,json_array(id),0 FROM posts WHERE id=?
    UNION ALL SELECT p.id,p.parent_id,json_insert(c.seen,'$[#]',p.id),c.depth+1 FROM posts p JOIN chain c ON p.id=c.parent_id
    WHERE NOT EXISTS(SELECT 1 FROM json_each(c.seen) WHERE value=p.id)
  ) ${selection} JOIN chain c ON c.id=p.id WHERE p.id<>? ORDER BY c.depth DESC`,
    id,
    Date.now() - 86400000,
    viewer || "",
    viewer || "",
    id
  );
}
export async function timeline(viewer?: string, page = 1, author?: string) {
  const events = await all<{ id: string; repostedBy?: string; repostedName?: string; eventId: string }>(
    `
    SELECT p.id,NULL AS repostedBy,NULL AS repostedName,'post-'||p.id AS eventId,p.created_at AS time FROM posts p
    WHERE p.root_id IS NULL AND ${author ? "p.deleted=0 AND p.author_id=?" : "(p.deleted=0 OR EXISTS(SELECT 1 FROM posts r WHERE r.root_id=p.id AND r.deleted=0))"}
    UNION ALL SELECT p.id,u.username,u.name,'repost-'||r.user_id||'-'||p.id,r.created_at FROM reposts r JOIN posts p ON p.id=r.post_id JOIN user u ON u.id=r.user_id
    WHERE p.deleted=0 ${author ? "AND r.user_id=?" : ""} ORDER BY time DESC,eventId DESC LIMIT ? OFFSET ?`,
    ...(author ? [author, author] : []),
    PAGE_SIZE + 1,
    (page - 1) * PAGE_SIZE
  );
  if (!events.length) return [];
  const items = await posts("p.id IN (SELECT value FROM json_each(?))", [JSON.stringify(events.map((e) => e.id))], viewer, undefined, 1);
  return events.flatMap((e) => {
    const p = items.find((p) => p.id === e.id);
    return p ? [{ ...p, ...e }] : [];
  });
}
