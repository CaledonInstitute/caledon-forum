import { env } from 'cloudflare:workers';
import type { ForumPost, LinkPreview } from './types';
import { PAGE_SIZE } from './content';
export const db = () => env.DB;
export const all = async <T = Record<string, unknown>>(sql: string, ...args: any[]): Promise<T[]> => (await db().prepare(sql).bind(...args).all<T>()).results;
export const one = async <T = Record<string, unknown>>(sql: string, ...args: any[]): Promise<T | null> => db().prepare(sql).bind(...args).first<T>();
export const run = (sql: string, ...args: any[]) => db().prepare(sql).bind(...args).run();
const selection = `SELECT p.id,pa.id AS publicId,p.author_id AS authorId,p.root_id AS rootId,p.parent_id AS parentId,p.body,p.created_at AS createdAt,p.updated_at AS updatedAt,p.deleted,p.locked,u.name,u.username,u.image,
 CASE WHEN m.state='active' AND m.checked_at>? AND EXISTS(SELECT 1 FROM account a WHERE a.user_id=u.id AND a.provider_id='github') THEN 1 ELSE 0 END AS isCaledonMember,
 (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,
 (SELECT COUNT(*) FROM posts r WHERE r.root_id=p.id AND r.deleted=0) AS replies,
 EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked,
 (SELECT name FROM user pu JOIN posts pp ON pp.author_id=pu.id WHERE pp.id=p.parent_id) AS parentName,
 (SELECT CASE WHEN pp.deleted=0 THEN substr(pp.body,1,120) ELSE 'Deleted post' END FROM posts pp WHERE pp.id=p.parent_id) AS parentBody
 FROM posts p JOIN post_addresses pa ON pa.post_id=p.id JOIN user u ON u.id=p.author_id LEFT JOIN memberships m ON m.user_id=u.id`;
export const posts = (where: string, args: any[], viewer?: string, order = 'p.created_at DESC,p.id DESC', page = 1) => all<ForumPost>(`${selection} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, Date.now()-86400000, viewer || '', ...args, PAGE_SIZE + 1, (page-1)*PAGE_SIZE);
export const post = async (id: string, viewer?: string) => (await posts('p.id=?', [id], viewer))[0] || null;
export const publicPost = async (value:string, viewer?:string) => /^[0-9]+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value)>0 ? (await posts('pa.id=?',[Number(value)],viewer))[0] || null : null;
export const previews = (id: string) => all<LinkPreview>(`SELECT lp.id,lp.url,lp.kind,lp.title,lp.description,lp.site,lp.image,lp.video_id AS videoId,lp.checked_at AS checkedAt FROM link_previews lp JOIN post_links pl ON pl.preview_id=lp.id WHERE pl.post_id=? ORDER BY pl.position`, id);
export async function replyLocation(id: string) {
  const p = await one<{root_id: string|null; created_at:number;public_id:number;root_public_id:number|null}>('SELECT p.root_id,p.created_at,pa.id AS public_id,ra.id AS root_public_id FROM posts p JOIN post_addresses pa ON pa.post_id=p.id LEFT JOIN post_addresses ra ON ra.post_id=p.root_id WHERE p.id=?',id);
  if (!p) return '/'; if (!p.root_id) return `/p/${p.public_id}`;
  const n = await one<{n:number}>('SELECT COUNT(*) AS n FROM posts WHERE root_id=? AND (created_at<? OR (created_at=? AND id<=?))',p.root_id,p.created_at,p.created_at,id);
  const page = Math.ceil((n?.n || 1)/PAGE_SIZE);
  return `/p/${p.root_public_id}${page>1?`?page=${page}`:''}#post-${id}`;
}
