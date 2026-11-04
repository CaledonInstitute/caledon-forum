import type { APIRoute } from "astro";
import { profileCounts, publicProfile } from "../../../lib/db";
export const GET: APIRoute = async ({ params }) => {
  const person = await publicProfile(params.username || "");
  return person ? Response.json(await profileCounts(person.id), { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 404 });
};
