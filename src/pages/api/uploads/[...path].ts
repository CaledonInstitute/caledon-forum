import type { APIRoute } from "astro";
import { uploadApi } from "../../../lib/uploads";
import { forumError } from "../../../lib/forum-errors";
export const ALL: APIRoute = async (ctx) => {
  try {
    const r = await uploadApi(ctx.request, ctx.locals.user?.id, ctx.params.path || "");
    r.headers.set("Cache-Control", "no-store");
    return r;
  } catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return forumError(error);
  }
};
