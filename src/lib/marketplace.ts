import { env } from "cloudflare:workers";
import { z } from "zod";
import { all, one, db, publishBatch } from "./db";
import { activeAccount, collectUnused } from "./uploads";
import { attachmentList, type Attachment } from "./upload-policy";
import type { Viewer } from "./types";
import { signalChange } from "./control";

export interface Listing {
  id: string;
  seller_id: string;
  username: string;
  name: string;
  kind: "goods" | "service";
  title: string;
  description: string;
  price: number;
  negotiable: number;
  location: string;
  condition: "new" | "used" | null;
  status: "active" | "closed";
  created_at: number;
  updated_at: number;
  photos: Attachment[];
  dmEnabled: number;
}
const select = `SELECT l.*,u.username,u.name,EXISTS(SELECT 1 FROM dm_vaults v WHERE v.user_id=u.id AND v.invalidated=0) AS dmEnabled FROM marketplace_listings l JOIN user u ON u.id=l.seller_id WHERE l.deleted=0 AND u.deleting_at IS NULL AND u.suspended=0`;
export const listingPhotos = (id: string) =>
  all<Attachment>("SELECT u.id,u.name,u.mime,u.size FROM marketplace_photos p JOIN uploads u ON u.id=p.asset_id WHERE p.listing_id=? AND u.state='ready' ORDER BY p.position", id);
export async function getListing(id: string, includeSuspended = false): Promise<Listing | null> {
  const listing = await one<Listing>((includeSuspended ? select.replace(" AND u.suspended=0", "") : select) + " AND l.id=?", id);
  return listing ? { ...listing, photos: await listingPhotos(id) } : null;
}
export async function listMarketplace(url: URL, page: number) {
  const kind = url.searchParams.get("kind"),
    status = url.searchParams.get("status") === "closed" ? "closed" : "active",
    query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const items = await all<Listing>(
    select +
      ` AND l.status=? AND (?='' OR instr(lower(l.title||' '||l.description),lower(?))>0) ${kind === "goods" || kind === "service" ? "AND l.kind=?" : ""} ORDER BY l.created_at DESC,l.id DESC LIMIT 21 OFFSET ?`,
    status,
    query,
    query,
    ...(kind === "goods" || kind === "service" ? [kind] : []),
    (page - 1) * 20
  );
  return Promise.all(items.map(async (item) => ({ ...item, photos: await listingPhotos(item.id) })));
}
export { formatPrice } from "./listing-price";
export type ListingCardData = Pick<Listing, "id" | "title" | "price" | "negotiable" | "location" | "kind" | "condition" | "status"> & { photoId: string | null };
export function listingCards(ids: string[]) {
  return all<ListingCardData>(
    `SELECT l.id,l.title,l.price,l.negotiable,l.location,l.kind,l.condition,l.status,
    (SELECT mp.asset_id FROM marketplace_photos mp JOIN uploads a ON a.id=mp.asset_id WHERE mp.listing_id=l.id AND a.state='ready' ORDER BY mp.position LIMIT 1) AS photoId
    FROM marketplace_listings l JOIN user u ON u.id=l.seller_id
    WHERE l.id IN (SELECT value FROM json_each(?)) AND l.deleted=0 AND u.suspended=0 AND u.deleting_at IS NULL`,
    JSON.stringify(ids)
  );
}
export async function marketplaceAction(user: Viewer, action: string, data: any): Promise<Response> {
  if (!(await activeAccount(user.id)) || user.suspended || !user.emailVerified || !user.username)
    return Response.json({ error: "Sign in with an active, verified account and choose a username." }, { status: 403 });
  const now = Date.now();
  if (action === "save") {
    const input = z
      .object({
        id: z.uuid().optional(),
        kind: z.enum(["goods", "service"]),
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().min(10).max(10000),
        price: z.number().int().min(0).max(999999999999),
        negotiable: z.boolean(),
        location: z.string().trim().max(100),
        condition: z.enum(["new", "used"]).nullable(),
        photoIds: z.array(z.uuid()).max(4),
      })
      .parse(data);
    if (input.kind === "goods" && !input.condition) throw new Error("Choose the condition of your item.");
    const existing = input.id ? await getListing(input.id) : null;
    if (input.id && (!existing || existing.seller_id !== user.id)) return Response.json({ error: "You cannot edit this listing." }, { status: 403 });
    if (!(await one("SELECT 1 FROM dm_vaults WHERE user_id=? AND invalidated=0", user.id))) throw new Error("Enable DM in Messages before publishing a listing.");
    const ids = attachmentList(input.photoIds);
    const photos = ids.length
      ? await all<Attachment & { owner_id: string; purpose: string; state: string }>("SELECT * FROM uploads WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(ids))
      : [];
    if (photos.length !== ids.length || photos.some((p) => p.owner_id !== user.id || p.purpose !== "post" || p.state !== "ready" || !p.mime.startsWith("image/")))
      throw new Error("Choose up to four available images uploaded to your account.");
    if (
      ids.length &&
      (await one(
        "SELECT 1 FROM post_attachments WHERE asset_id IN (SELECT value FROM json_each(?)) UNION ALL SELECT 1 FROM marketplace_photos WHERE asset_id IN (SELECT value FROM json_each(?)) AND listing_id<>? LIMIT 1",
        JSON.stringify(ids),
        JSON.stringify(ids),
        input.id || ""
      ))
    )
      throw new Error("A photo is already used in another post or listing.");
    const id = input.id || crypto.randomUUID();
    const postBody = new URL(`/marketplace/${id}`, env.SITE_URL).href;
    const condition = input.kind === "goods" ? input.condition : null;
    const statement = existing
      ? db()
          .prepare("UPDATE marketplace_listings SET kind=?,title=?,description=?,price=?,negotiable=?,location=?,condition=?,updated_at=? WHERE id=? AND seller_id=? AND deleted=0")
          .bind(input.kind, input.title, input.description, input.price, Number(input.negotiable), input.location, condition, now, id, user.id)
      : db()
          .prepare(
            "INSERT INTO marketplace_listings(id,seller_id,kind,title,description,price,negotiable,location,condition,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM user WHERE id=? AND suspended=0 AND deleting_at IS NULL)"
          )
          .bind(id, user.id, input.kind, input.title, input.description, input.price, Number(input.negotiable), input.location, condition, now, now, user.id);
    await publishBatch([
      statement,
      db().prepare("DELETE FROM marketplace_photos WHERE listing_id=?").bind(id),
      ...ids.map((asset, i) =>
        db()
          .prepare("INSERT INTO marketplace_photos(listing_id,asset_id,position) SELECT ?,id,? FROM uploads WHERE id=? AND owner_id=? AND state='ready'")
          .bind(id, i, asset, user.id)
      ),
      ...(!existing
        ? [
            db()
              .prepare("INSERT INTO posts(id,author_id,body,created_at,updated_at) SELECT ?,seller_id,?,?,? FROM marketplace_listings WHERE id=? AND seller_id=? AND deleted=0")
              .bind(crypto.randomUUID(), postBody, now, now, id, user.id),
          ]
        : []),
    ]);
    await collectUnused((existing?.photos || []).filter((p) => !ids.includes(p.id)).map((p) => p.id));
    await signalChange();
    return Response.json({ ok: true, url: `/marketplace/${id}`, id });
  }
  const id = z.uuid().parse(data.id);
  if (action === "resolve") {
    if (user.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
    await db().batch([
      db().prepare("UPDATE marketplace_reports SET status='resolved' WHERE id=?").bind(id),
      db().prepare("INSERT INTO moderation_actions(id,admin_id,action,target_id,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), user.id, "marketplace-resolve", id, now),
    ]);
    return Response.json({ ok: true });
  }
  const listing = await getListing(id, user.role === "admin");
  if (!listing) return Response.json({ error: "Listing unavailable." }, { status: 404 });
  if (action === "report") {
    const reason = z.string().trim().min(5).max(1000).parse(data.reason);
    await db()
      .prepare("INSERT OR IGNORE INTO marketplace_reports(id,listing_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), id, user.id, reason, now)
      .run();
    return Response.json({ ok: true });
  }
  if (action === "moderate" && user.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  if (action !== "moderate" && listing.seller_id !== user.id) return Response.json({ error: "You cannot change this listing." }, { status: 403 });
  if (action === "close") {
    const status = z.enum(["active", "closed"]).parse(data.status);
    await db().batch([db().prepare("UPDATE marketplace_listings SET status=?,updated_at=? WHERE id=? AND seller_id=?").bind(status, now, id, user.id)]);
  } else if (action === "delete" || action === "moderate") {
    await db().batch([
      db().prepare("UPDATE marketplace_listings SET deleted=1,title='Deleted listing',description='',location='',updated_at=? WHERE id=?").bind(now, id),
      db().prepare("DELETE FROM marketplace_photos WHERE listing_id=?").bind(id),
      ...(action === "moderate"
        ? [
            db()
              .prepare("INSERT INTO moderation_actions(id,admin_id,action,target_id,created_at) VALUES(?,?,?,?,?)")
              .bind(crypto.randomUUID(), user.id, "marketplace-delete", id, now),
          ]
        : []),
    ]);
    await collectUnused(listing.photos.map((p) => p.id));
  } else return Response.json({ error: "Action not found." }, { status: 404 });
  await signalChange();
  return Response.json({ ok: true });
}
