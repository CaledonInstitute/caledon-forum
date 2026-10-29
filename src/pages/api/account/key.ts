import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { issueKey, keyMetadata, requireApiAccount } from "../../../lib/api-keys";
import { one, run } from "../../../lib/db";
import type { Viewer } from "../../../lib/types";
import { rateLimit } from "../../../lib/rate-limit";
import { forumError } from "../../../lib/forum-errors";
import { readLimited } from "../../../lib/security";

export const ALL: APIRoute = async (ctx) => {
  let response: Response;
  try {
    if (env.AUTH_ENABLED !== "true") throw Response.json({ error: "API access is unavailable." }, { status: 503 });
    const user = ctx.locals.user
      ? await one<Viewer>(
          "SELECT id,username,name,email_verified AS emailVerified,image,cover_image AS coverImage,bio,location,role,suspended FROM user WHERE id=?",
          ctx.locals.user.id
        )
      : null;
    requireApiAccount(user);
    const method = ctx.request.method;
    if (!["GET", "POST", "DELETE"].includes(method)) throw Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST, DELETE" } });
    if (method === "GET") response = Response.json({ key: await keyMetadata(user.id) });
    else {
      if (ctx.request.headers.get("origin") !== new URL(env.SITE_URL).origin) throw Response.json({ error: "Refresh this page and try again." }, { status: 403 });
      await rateLimit(`keys:${user.id}`, 5, 600000);
      if (method === "DELETE") {
        await run("DELETE FROM api_keys WHERE user_id=?", user.id);
        response = Response.json({ ok: true });
      } else {
        if (!ctx.request.headers.get("content-type")?.startsWith("application/json")) throw Response.json({ error: "Use a JSON request." }, { status: 415 });
        const data = JSON.parse(new TextDecoder().decode(await readLimited(new Response(ctx.request.body), 1024)));
        if (data?.operation !== "generate" && data?.operation !== "regenerate") throw Response.json({ error: "Choose generate or regenerate." }, { status: 400 });
        response = Response.json(await issueKey(user.id, data.operation === "regenerate"));
      }
    }
  } catch (error) {
    response = forumError(error);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};
