import { env } from 'cloudflare:workers';
import type { ForumPost, LinkPreview } from './types';
import { PAGE_SIZE } from './content';
export const db = () => env.DB;
export const all = async <T = Record<string, unknown>>(sql: string, ...args: any[]): Promise<T[]> => (await db().prepare(sql).bind(...args).all<T>()).results;
export const one = async <T = Record<string, unknown>>(sql: string, ...args: any[]): Promise<T | null> => db().prepare(sql).bind(...args).first<T>();
export const run = (sql: string, ...args: any[]) => db().prepare(sql).bind(...args).run();
export async function publishBatch(statements:D1PreparedStatement[]) {
  for (let attempt=0;;attempt++) {
    try { return await db().batch(statements); }
    catch(error) {
      if (attempt>=2 || !/UNIQUE constraint failed: post_addresses\.id/i.test(error instanceof Error?error.message:String(error))) throw error;
    }
  }
}
const selection = `SELECT p.id,pa.id AS publicId,p.author_id AS authorId,p.root_id AS rootId,p.parent_id AS parentId,p.body,p.created_at AS createdAt,p.updated_at AS updatedAt,p.deleted,p.locked,u.name,u.username,u.image,
 CASE WHEN m.state='active' AND m.checked_at>? AND EXISTS(SELECT 1 FROM account a WHERE a.user_id=u.id AND a.provider_id='github') THEN 1 ELSE 0 END AS isCaledonMember,
 (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
 (SELECT COUNT(*) FROM posts r WHERE r.root_id=p.id AND r.deleted=0) AS replies,
 (SELECT COUNT(*) FROM posts r WHERE r.parent_id=p.id AND r.deleted=0) AS directReplies,
 EXISTS(SELECT 1 FROM posts r WHERE r.parent_id=p.id) AS hasChildren,
 EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked,
 (SELECT name FROM user pu JOIN posts pp ON pp.author_id=pu.id WHERE pp.id=p.parent_id) AS parentName,
 (SELECT pu.username FROM user pu JOIN posts pp ON pp.author_id=pu.id WHERE pp.id=p.parent_id) AS parentUsername,
 (SELECT a.id FROM post_addresses a WHERE a.post_id=p.parent_id) AS parentPublicId,
 (SELECT CASE WHEN pp.deleted=0 THEN substr(pp.body,1,120) ELSE 'Deleted post' END FROM posts pp WHERE pp.id=p.parent_id) AS parentBody
 FROM posts p JOIN post_addresses pa ON pa.post_id=p.id JOIN user u ON u.id=p.author_id LEFT JOIN memberships m ON m.user_id=u.id`;
export const posts = (where: string, args: any[], viewer?: string, order = 'p.created_at DESC,p.id DESC', page = 1) => all<ForumPost>(`${selection} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, Date.now()-86400000, viewer || '', ...args, PAGE_SIZE + 1, (page-1)*PAGE_SIZE);
export const post = async (id: string, viewer?: string) => (await posts('p.id=?', [id], viewer))[0] || null;
export async function publicPost(value:string, viewer?:string) {
  const canonical=value.replace(/^0+/,'');
  return /^[1-9][0-9]{0,18}$/.test(canonical) ? (await posts('pa.id=?',[canonical],viewer))[0] || null : null;
}
export const previews = (id: string) => all<LinkPreview>(`SELECT lp.id,lp.url,lp.kind,lp.title,lp.description,lp.site,lp.image,lp.video_id AS videoId,lp.checked_at AS checkedAt FROM link_previews lp JOIN post_links pl ON pl.preview_id=lp.id WHERE pl.post_id=? ORDER BY pl.position`, id);
export async function ancestors(id: string, viewer?: string) {
  const rows = await all<ForumPost>(`WITH RECURSIVE ancestors(id) AS (
    SELECT parent_id FROM posts WHERE id=? AND parent_id IS NOT NULL
    UNION SELECT p.parent_id FROM posts p JOIN ancestors a ON p.id=a.id WHERE p.parent_id IS NOT NULL
  ) ${selection} WHERE p.id IN (SELECT id FROM ancestors)`, id, Date.now()-86400000, viewer || '');
  const byId = new Map(rows.map(p => [p.id, p]));
  const ordered: ForumPost[] = [];
  const parentIds = new Set(rows.map(p => p.parentId));
  let current = rows.find(p => !parentIds.has(p.id));
  const seen = new Set([id]);
  while (current && !seen.has(current.id)) {
    seen.add(current.id); ordered.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return ordered.reverse();
}
export async function replyLocation(id: string) {
  const p = await one<{id:string}>('SELECT id FROM post_addresses WHERE post_id=?', id);
  return p ? `/p/${p.id}` : '/';
}
