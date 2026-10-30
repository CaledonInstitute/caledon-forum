import type { APIRoute } from "astro";
import { all } from "../../../lib/db";
export const GET: APIRoute = async ({ url }) => {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(","))];
  if (!ids.length || ids.length > 21 || ids.some((id) => !/^[1-9][0-9]{0,18}$/.test(id))) return Response.json({ error: "Invalid addresses." }, { status: 400 });
  const items = await all<any>(
    `SELECT pa.id AS publicId,p.deleted,CASE WHEN p.deleted=0 THEN p.body ELSE '' END AS body,p.created_at AS createdAt,u.name,u.username,u.image,
    CASE WHEN m.state='active' AND m.checked_at>? AND EXISTS(SELECT 1 FROM account a WHERE a.user_id=u.id AND a.provider_id='github') THEN 1 ELSE 0 END AS isCaledonMember,
    (SELECT pu.username FROM posts pp JOIN user pu ON pu.id=pp.author_id WHERE pp.id=p.parent_id) AS parentUsername
    FROM posts p JOIN post_addresses pa ON pa.post_id=p.id JOIN user u ON u.id=p.author_id LEFT JOIN memberships m ON m.user_id=u.id
    WHERE pa.id IN (SELECT value FROM json_each(?)) LIMIT 21`,
    Date.now() - 86400000,
    JSON.stringify(ids)
  );
  return Response.json(
    {
      items: items.map((p) =>
        p.deleted
          ? { publicId: p.publicId, unavailable: true }
          : {
              publicId: p.publicId,
              body: p.body,
              name: p.name,
              username: p.username,
              image: p.image,
              isCaledonMember: !!p.isCaledonMember,
              createdAt: p.createdAt,
              parentUsername: p.parentUsername,
            }
      ),
    },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }
  );
};
