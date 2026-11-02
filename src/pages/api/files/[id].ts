import type { APIRoute } from "astro";
import { serveFile } from "../../../lib/uploads";
export const ALL: APIRoute = async (ctx) =>
  serveFile(ctx.request, ctx.params.id!, (p) => {
    void p;
  });
