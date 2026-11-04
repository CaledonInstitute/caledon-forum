import type { APIRoute } from "astro";
import { listingCards } from "../../../lib/marketplace";
export const GET: APIRoute = async ({ url }) => {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(","))];
  if (!ids.length || ids.length > 21 || ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    return Response.json({ error: "Invalid listing addresses." }, { status: 400 });
  return Response.json({ items: await listingCards(ids.map((id) => id.toLowerCase())) }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
};
