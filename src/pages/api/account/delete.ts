import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { createAuth } from "../../../lib/auth";
import { one, run } from "../../../lib/db";
import { deleteAccount } from "../../../lib/account-deletion";
import { readLimited } from "../../../lib/security";
import { rateLimit } from "../../../lib/rate-limit";
import { forumError } from "../../../lib/forum-errors";
export const POST: APIRoute = async (ctx) => {
  try {
    if (ctx.request.headers.get("origin") !== new URL(env.SITE_URL).origin) return Response.json({ error: "Refresh this page and try again." }, { status: 403 });
    const session = await createAuth().api.getSession({ headers: ctx.request.headers, query: { disableCookieCache: true } });
    if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });
    await rateLimit(`delete-account:${session.user.id}`, 5, 600000);
    const data = JSON.parse(new TextDecoder().decode(await readLimited(new Response(ctx.request.body), 2048)));
    if (data.action === "prepare") {
      const token = crypto.randomUUID();
      await run(
        "INSERT INTO deletion_intents(token,user_id,session_id,created_at,expires_at) VALUES(?,?,?,?,?)",
        token,
        session.user.id,
        session.session.id,
        Date.now(),
        Date.now() + 900000
      );
      return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
    }
    const intent =
      typeof data.token === "string"
        ? await one<{ session_id: string; created_at: number }>(
            "SELECT session_id,created_at FROM deletion_intents WHERE token=? AND user_id=? AND expires_at>?",
            data.token,
            session.user.id,
            Date.now()
          )
        : null;
    if (
      !intent ||
      intent.session_id === session.session.id ||
      new Date(session.session.createdAt).getTime() < intent.created_at ||
      Date.now() - new Date(session.session.createdAt).getTime() > 300000
    )
      throw new Error("Sign in again before deleting your account. Start Delete account again.");
    const user = await one<{ username: string | null }>("SELECT username FROM user WHERE id=? AND deleting_at IS NULL", session.user.id);
    if (!user || data.confirmation !== (user.username || "DELETE")) throw new Error("Enter your username exactly to confirm deletion.");
    await deleteAccount(session.user.id);
    const signedOut = await createAuth().handler(
      new Request(new URL("/api/auth/sign-out", env.SITE_URL), {
        method: "POST",
        headers: { cookie: ctx.request.headers.get("cookie") || "", origin: env.SITE_URL, "Content-Type": "application/json" },
        body: "{}",
      })
    );
    const headers = new Headers(signedOut.headers);
    headers.set("Cache-Control", "no-store");
    ctx.cookies.delete("push-device", { path: "/" });
    return Response.json({ ok: true }, { status: 202, headers });
  } catch (error) {
    return forumError(error);
  }
};
