import type { APIRoute } from "astro";
import { posts, one } from "../../../lib/db";
export const GET: APIRoute = async (ctx) => {
  const ids = [...new Set((ctx.url.searchParams.get("ids") || "").split(",").filter(Boolean))];
  if (ids.length > 21 || ids.some((id) => !/^[a-zA-Z0-9-]{1,100}$/.test(id))) return Response.json({ error: "Invalid posts." }, { status: 400 });
  const parent = ctx.url.searchParams.get("parent");
  if (parent && !/^[a-zA-Z0-9-]{1,100}$/.test(parent)) return new Response(null, { status: 400 });
  const items = ids.length ? await posts("p.id IN (SELECT value FROM json_each(?))", [JSON.stringify(ids)], ctx.locals.user?.id) : [];
  const thread = parent
    ? await one<{ locked: number; deleted: number }>(
        "SELECT COALESCE(root.locked,p.locked) AS locked,p.deleted FROM posts p LEFT JOIN posts root ON root.id=p.root_id WHERE p.id=?",
        parent
      )
    : null;
  const latest = parent
    ? await one<{ id: string }>("SELECT id FROM posts WHERE deleted=0 AND parent_id=? ORDER BY created_at DESC,id DESC LIMIT 1", parent)
    : await one<{ id: string }>(
        "SELECT 'post-'||id AS id,created_at AS time FROM posts WHERE deleted=0 AND root_id IS NULL UNION ALL SELECT 'repost-'||r.user_id||'-'||r.post_id,r.created_at FROM reposts r JOIN posts p ON p.id=r.post_id WHERE p.deleted=0 ORDER BY time DESC,id DESC LIMIT 1"
      );
  const unread =
    ctx.locals.user && !ctx.locals.user.suspended
      ? await one<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE recipient_id=? AND read_at IS NULL", ctx.locals.user.id)
      : null;
  return Response.json(
    {
      latest: latest?.id,
      thread,
      unread: unread?.n || 0,
      items: items.map((p) => ({
        id: p.id,
        publicId: p.publicId,
        likes: p.likes,
        liked: !!p.liked,
        shares: p.shares,
        reposts: p.reposts || 0,
        reposted: !!p.reposted,
        views: p.views,
        directReplies: p.directReplies,
        updatedAt: p.updatedAt,
        deleted: !!p.deleted,
        locked: !!p.locked,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
};
