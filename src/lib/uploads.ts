import { env } from "cloudflare:workers";
import { all, one, run, db } from "./db";
import { b2, storageReady, uploadsReady, escapeXml, xmlValue } from "./b2";
import { filePolicy, validSignature, MAX_TOTAL, PART_BYTES, fileUrl, type UploadPurpose, type Attachment } from "./upload-policy";
import { readLimited } from "./security";
import { rateLimit } from "./rate-limit";
import { createAuth, authReady } from "./auth";
import { z } from "zod";
export interface Asset extends Attachment {
  owner_id: string;
  purpose: UploadPurpose;
  conversation_id: string | null;
  object_key: string;
  upload_id: string | null;
  object_version: string | null;
  state: string;
  lock_until: number;
  expires_at: number;
}
export const getAsset = (id: string) => one<Asset>("SELECT * FROM uploads WHERE id=?", id);
export async function activeAccount(id: string) {
  const u = await one<{ suspended: number; deleting_at: number | null; email_verified: number }>("SELECT suspended,deleting_at,email_verified FROM user WHERE id=?", id);
  return !!u && !u.suspended && !u.deleting_at;
}
export async function validateAttachments(owner: string, ids: string[], purpose: "post" | "dm", target?: string) {
  if (!ids.length) return [];
  const assets = await all<Asset>("SELECT * FROM uploads WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  if (
    assets.length !== ids.length ||
    assets.some((a) => a.owner_id !== owner || a.state !== "ready" || a.purpose !== purpose || (purpose === "dm" && a.conversation_id !== target))
  )
    throw new Error("One or more attachments are unavailable. Upload them again.");
  if (assets.reduce((sum, a) => sum + a.size - (purpose === "dm" ? 16 : 0), 0) > MAX_TOTAL) throw new Error("Keep attachments within 100 MB in total.");
  const used =
    purpose === "post"
      ? await one("SELECT 1 FROM post_attachments WHERE asset_id IN (SELECT value FROM json_each(?)) AND post_id<>?", JSON.stringify(ids), target || "")
      : await one("SELECT 1 FROM dm_attachments WHERE asset_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
  if (purpose === "post" && (await one("SELECT 1 FROM marketplace_photos WHERE asset_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids))))
    throw new Error("A photo is already used in a marketplace listing.");
  if (used) throw new Error("An attachment is already used in another message or post.");
  return ids.map((id) => assets.find((a) => a.id === id)!);
}
export function postAttachmentStatements(postId: string, ids: string[]) {
  return ids.map((id, i) =>
    db()
      .prepare(
        "INSERT INTO post_attachments(post_id,asset_id,position) SELECT ?, (SELECT id FROM uploads WHERE id=? AND state='ready' AND purpose='post' AND owner_id=(SELECT author_id FROM posts WHERE id=?)), ? WHERE EXISTS(SELECT 1 FROM posts p JOIN user u ON u.id=p.author_id WHERE p.id=? AND p.deleted=0 AND u.deleting_at IS NULL)"
      )
      .bind(postId, id, postId, i, postId)
  );
}
export const postAttachments = (id: string) =>
  all<Attachment>("SELECT u.id,u.name,u.mime,u.size FROM post_attachments a JOIN uploads u ON u.id=a.asset_id WHERE a.post_id=? AND u.state='ready' ORDER BY a.position", id);
export async function referenced(a: Asset) {
  if (a.purpose === "dm") return !!(await one("SELECT 1 FROM dm_attachments WHERE asset_id=?", a.id));
  return !!(await one(
    "SELECT 1 FROM post_attachments a JOIN posts p ON p.id=a.post_id WHERE a.asset_id=? AND p.deleted=0 UNION ALL SELECT 1 FROM marketplace_photos mp JOIN marketplace_listings ml ON ml.id=mp.listing_id WHERE mp.asset_id=? AND ml.deleted=0 UNION ALL SELECT 1 FROM user WHERE image=? OR cover_image=? LIMIT 1",
    a.id,
    a.id,
    new URL(fileUrl(a.id), env.SITE_URL).href,
    new URL(fileUrl(a.id), env.SITE_URL).href
  ));
}
export async function collectUnused(ids: string[]) {
  const prefix = new URL("/api/files/", env.SITE_URL).href;
  for (const id of ids)
    await run(
      "UPDATE uploads SET state='deleting' WHERE id=? AND lock_until<? AND NOT EXISTS(SELECT 1 FROM post_attachments WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM dm_attachments WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM marketplace_photos WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM user WHERE image=?||uploads.id OR cover_image=?||uploads.id)",
      id,
      Date.now(),
      prefix,
      prefix
    );
}
export async function uploadApi(request: Request, userId: string | undefined, tail: string) {
  if (request.method === "GET" && !tail) return Response.json({ enabled: uploadsReady() }, { headers: { "Cache-Control": "no-store" } });
  if (!userId || !(await activeAccount(userId))) throw new Response("Sign in to continue.", { status: 401 });
  if (request.headers.get("origin") !== new URL(env.SITE_URL).origin) throw new Response("Refresh this page and try again.", { status: 403 });
  if (!uploadsReady()) throw new Response("File uploads are not configured yet.", { status: 503 });
  const account = await one<{ email_verified: number }>("SELECT email_verified FROM user WHERE id=?", userId);
  if (!account?.email_verified) throw new Response("Verify your email before uploading.", { status: 403 });
  const [id, operation] = tail.split("/");
  if (!id && request.method === "POST") {
    await rateLimit(`uploads:${userId}`, 10);
    const data = z
      .object({
        name: z.string().min(1).max(255),
        size: z.number().int().positive(),
        purpose: z.enum(["avatar", "cover", "post", "dm"]),
        conversationId: z.string().max(100).optional(),
      })
      .parse(JSON.parse(new TextDecoder().decode(await readLimited(new Response(request.body), 2048))));
    const mime = data.purpose === "dm" ? "application/octet-stream" : filePolicy(data.name, data.size, data.purpose);
    if (data.purpose === "dm" && data.size > 50 * 1024 * 1024) throw new Error("Keep encrypted attachments within 50 MB per file.");
    if (data.purpose === "dm") {
      if (
        !(await one(
          "SELECT 1 FROM dm_conversations c JOIN user a ON a.id=c.user_a JOIN user b ON b.id=c.user_b WHERE c.id=? AND (c.user_a=? OR c.user_b=?) AND a.deleting_at IS NULL AND b.deleting_at IS NULL AND a.suspended=0 AND b.suspended=0 AND NOT EXISTS(SELECT 1 FROM dm_blocks WHERE (user_id=c.user_a AND blocked_id=c.user_b) OR (user_id=c.user_b AND blocked_id=c.user_a))",
          data.conversationId || "",
          userId,
          userId
        ))
      )
        throw new Error("This conversation is unavailable for uploads.");
    }
    const assetId = crypto.randomUUID(),
      now = Date.now(),
      key = `forum/${assetId}`;
    // Atomic reservation across devices; pending sessions count until cancelled or expired.
    const result = await run(
      "INSERT INTO uploads(id,owner_id,purpose,conversation_id,name,mime,size,object_key,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM uploads WHERE owner_id=? AND state IN ('pending','busy') AND expires_at>?)<2 AND EXISTS(SELECT 1 FROM user WHERE id=? AND deleting_at IS NULL)",
      assetId,
      userId,
      data.purpose,
      data.purpose === "dm" ? data.conversationId : null,
      data.purpose === "dm" ? "Encrypted attachment" : data.name,
      data.purpose === "dm" ? "application/octet-stream" : mime,
      data.size + (data.purpose === "dm" ? 16 : 0),
      key,
      now,
      now + 86400000,
      userId,
      now,
      userId
    );
    if (!result.meta.changes) throw new Error("Finish or cancel your other uploads first.");
    try {
      const response = await b2(key, { method: "POST", headers: { "Content-Type": data.purpose === "dm" ? "application/octet-stream" : mime } }, { uploads: "" });
      const multipart = xmlValue(await response.text(), "UploadId");
      if (!multipart) throw new Error("Storage could not start the upload.");
      await run("UPDATE uploads SET upload_id=? WHERE id=?", multipart, assetId);
      return Response.json({ id: assetId, partBytes: PART_BYTES });
    } catch (error) {
      await run("UPDATE uploads SET state='deleting' WHERE id=?", assetId);
      throw error;
    }
  }
  if (!/^[0-9a-f-]{36}$/.test(id || "")) throw new Response("Upload not found.", { status: 404 });
  const asset = await getAsset(id);
  if (!asset || asset.owner_id !== userId) throw new Response("Upload not found.", { status: 404 });
  if (request.method === "DELETE") {
    if (await referenced(asset)) throw new Error("Remove this file from its post or profile first.");
    const prefix = new URL("/api/files/", env.SITE_URL).href;
    await run(
      "UPDATE uploads SET state='deleting' WHERE id=? AND NOT EXISTS(SELECT 1 FROM post_attachments WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM dm_attachments WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM marketplace_photos WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM user WHERE image=?||uploads.id OR cover_image=?||uploads.id)",
      id,
      prefix,
      prefix
    );
    return Response.json({ ok: true });
  }
  if (operation === "complete" && request.method === "POST" && asset.state === "ready")
    return Response.json({ id: asset.id, name: asset.name, mime: asset.mime, size: asset.size });
  if (asset.expires_at < Date.now() || !asset.upload_id || !["pending", "busy"].includes(asset.state)) throw new Error("This upload expired. Upload the file again.");
  const lock = Date.now() + 120000;
  if (!(await run("UPDATE uploads SET state='busy',lock_until=? WHERE id=? AND state IN ('pending','busy') AND lock_until<?", lock, id, Date.now())).meta.changes)
    throw new Error("This upload is busy. Try again shortly.");
  try {
    if (request.method === "PUT" && /^[1-9][0-9]*$/.test(operation || "")) {
      const part = Number(operation),
        count = Math.ceil(asset.size / PART_BYTES);
      if (part > count) throw new Error("Invalid upload part.");
      const expected = Math.min(PART_BYTES, asset.size - (part - 1) * PART_BYTES);
      const bytes = await readLimited(new Response(request.body), expected);
      if (bytes.length !== expected) throw new Error("Incomplete file part. Try again.");
      if (
        !(await one(
          "SELECT 1 FROM uploads a JOIN user u ON u.id=a.owner_id WHERE a.id=? AND a.state='busy' AND a.lock_until=? AND a.lock_until>? AND u.deleting_at IS NULL",
          id,
          lock,
          Date.now() + 30000
        ))
      )
        throw new Error("This upload timed out. Retry the file part.");
      if (asset.purpose !== "dm" && part === 1 && !validSignature(bytes, asset.mime)) throw new Error("The file contents do not match its format.");
      const r = await b2(asset.object_key, { method: "PUT", body: bytes as BodyInit }, { partNumber: String(part), uploadId: asset.upload_id });
      const etag = r.headers.get("etag");
      if (!etag) throw new Error("Storage could not verify this file part.");
      await run(
        "INSERT INTO upload_parts(asset_id,part,etag,size) VALUES(?,?,?,?) ON CONFLICT(asset_id,part) DO UPDATE SET etag=excluded.etag,size=excluded.size",
        id,
        part,
        etag,
        bytes.length
      );
      return Response.json({ ok: true });
    }
    if (operation === "complete" && request.method === "POST") {
      const parts = await all<{ part: number; etag: string; size: number }>("SELECT * FROM upload_parts WHERE asset_id=? ORDER BY part", id);
      if (parts.length !== Math.ceil(asset.size / PART_BYTES) || parts.reduce((n, p) => n + p.size, 0) !== asset.size || parts.some((p, i) => p.part !== i + 1))
        throw new Error("Some parts are missing. Retry the upload.");
      const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.part}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
      // Retry after a lost completion response: a matching immutable object is already complete.
      try {
        const r = await b2(asset.object_key, { method: "POST", body, headers: { "Content-Type": "application/xml" } }, { uploadId: asset.upload_id });
        if ((await r.text()).match(/<Error(?:\s|>)/)) throw new Error("Storage could not finish the upload.");
      } catch (error) {
        const head = await b2(asset.object_key, { method: "HEAD" }).catch(() => null);
        if (!head || Number(head.headers.get("content-length")) !== asset.size) throw error;
      }
      if (!(await activeAccount(userId))) {
        await run("UPDATE uploads SET state='deleting' WHERE id=?", id);
        throw new Error("This account is unavailable.");
      }
      const head = await b2(asset.object_key, { method: "HEAD" });
      const version = head.headers.get("x-amz-version-id");
      if (Number(head.headers.get("content-length")) !== asset.size || !version) throw new Error("Storage could not verify the completed file.");
      const committed = await run(
        "UPDATE uploads SET state='ready',object_version=?,lock_until=0 WHERE id=? AND state='busy' AND lock_until=? AND EXISTS(SELECT 1 FROM user WHERE id=uploads.owner_id AND deleting_at IS NULL)",
        version,
        id,
        lock
      );
      if (!committed.meta.changes) throw new Error("This upload is no longer available.");
      return Response.json({ id: asset.id, name: asset.name, mime: asset.mime, size: asset.size });
    }
    throw new Response("Use an upload part or complete endpoint.", { status: 405 });
  } finally {
    await run("UPDATE uploads SET state=CASE WHEN state='busy' THEN 'pending' ELSE state END,lock_until=0 WHERE id=? AND lock_until=?", id, lock);
  }
}
export async function cleanupUploads() {
  if (!storageReady()) return;
  await run(
    "UPDATE uploads SET state='deleting' WHERE state IN ('pending','busy','ready') AND expires_at<? AND lock_until<? AND NOT EXISTS(SELECT 1 FROM post_attachments WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM dm_attachments WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM marketplace_photos WHERE asset_id=uploads.id) AND NOT EXISTS(SELECT 1 FROM user WHERE image=?||uploads.id OR cover_image=?||uploads.id)",
    Date.now(),
    Date.now(),
    new URL("/api/files/", env.SITE_URL).href,
    new URL("/api/files/", env.SITE_URL).href
  );
  for (const a of await all<Asset>("SELECT * FROM uploads WHERE state='deleting' AND lock_until<? LIMIT 10", Date.now())) {
    try {
      if (a.upload_id) await b2(a.object_key, { method: "DELETE" }, { uploadId: a.upload_id });
      const head = a.object_version ? null : await b2(a.object_key, { method: "HEAD" });
      const version = a.object_version || head?.headers.get("x-amz-version-id");
      if (head?.ok && !version) throw new Error("Missing storage version.");
      if (version) await b2(a.object_key, { method: "DELETE" }, { versionId: version });
      await run("DELETE FROM uploads WHERE id=?", a.id);
    } catch {
      console.warn("File cleanup deferred", a.id);
    }
  }
}
export function parseRange(value: string | null, size: number): [number, number] | null {
  if (!value) return [0, size - 1];
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] ? (m[2] ? Math.min(Number(m[2]), size - 1) : size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? [start, end] : null;
}
export async function serveFile(request: Request, id: string, waitUntil: (p: Promise<unknown>) => void) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const a = await getAsset(id);
  if (!a || a.state !== "ready" || !(await activeAccount(a.owner_id))) return new Response(null, { status: 404 });
  const isPublic = a.purpose !== "dm" && (await referenced(a));
  if (!isPublic) {
    const session = authReady() ? await createAuth().api.getSession({ headers: request.headers }) : null;
    if (!session || !(await activeAccount(session.user.id))) return new Response(null, { status: 404 });
    if (a.purpose === "dm") {
      if (
        !(await one(
          "SELECT 1 FROM dm_conversations c JOIN user u ON u.id=c.user_a JOIN user v ON v.id=c.user_b WHERE c.id=? AND (c.user_a=? OR c.user_b=?) AND u.deleting_at IS NULL AND v.deleting_at IS NULL AND (EXISTS(SELECT 1 FROM dm_attachments WHERE asset_id=?) OR ?=?)",
          a.conversation_id,
          session.user.id,
          session.user.id,
          a.id,
          a.owner_id,
          session.user.id
        ))
      )
        return new Response(null, { status: 404 });
    } else if (session.user.id !== a.owner_id) return new Response(null, { status: 404 });
  }
  const range = parseRange(request.headers.get("range"), a.size);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${a.size}` } });
  const [start, end] = range,
    etag = `"${a.id}"`,
    headers = new Headers({
      "Content-Type": a.mime,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Cache-Control": isPublic ? "public, max-age=0, must-revalidate" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    });
  const inline =
    (a.mime === "application/pdf" && new URL(request.url).searchParams.get("inline") === "1") ||
    a.mime.startsWith("image/") ||
    a.mime.startsWith("video/") ||
    a.mime.startsWith("audio/");
  headers.set(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(a.name.toWellFormed()).replaceAll("'", "%27")}`
  );
  if (request.headers.get("if-none-match") === etag && !request.headers.has("range")) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  if (request.headers.has("range")) headers.set("Content-Range", `bytes ${start}-${end}/${a.size}`);
  const status = request.headers.has("range") ? 206 : 200;
  if (request.method === "HEAD") return new Response(null, { status, headers });
  async function readChunk(index: number) {
    const low = index * PART_BYTES,
      high = Math.min(a!.size - 1, low + PART_BYTES - 1);
    const cache = typeof caches === "undefined" ? undefined : (caches as CacheStorage & { default: Cache }).default;
    const key = new Request(new URL(`/api/files/${a!.id}?chunk=${index}`, env.SITE_URL));
    let chunk = await cache?.match(key);
    const hit = !!chunk;
    if (!chunk) {
      const r = await b2(a!.object_key, { headers: { Range: `bytes=${low}-${high}` } }, a!.object_version ? { versionId: a!.object_version } : {});
      const bytes = await readLimited(r, high - low + 1);
      if (bytes.length !== high - low + 1) throw new Error("Incomplete storage response.");
      chunk = new Response(bytes as BodyInit, { headers: { "Content-Length": String(bytes.length), "Cache-Control": "public, max-age=86400" } });
      if (cache) waitUntil(cache.put(key, chunk.clone()).catch(() => {}));
    }
    return { bytes: new Uint8Array(await chunk.arrayBuffer()), hit };
  }
  let first: Awaited<ReturnType<typeof readChunk>> | undefined;
  try {
    first = await readChunk(Math.floor(start / PART_BYTES));
  } catch {
    return new Response("File temporarily unavailable. Try again shortly.", {
      status: 502,
      headers: { "Cache-Control": "no-store", "Retry-After": "30", "X-Content-Type-Options": "nosniff" },
    });
  }
  headers.set("X-File-Cache", first.hit ? "HIT" : "MISS");
  let cursor = start;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const index = Math.floor(cursor / PART_BYTES),
          low = index * PART_BYTES,
          high = Math.min(a!.size - 1, low + PART_BYTES - 1);
        const chunk = first || (await readChunk(index));
        first = undefined;
        const last = Math.min(high, end);
        controller.enqueue(chunk.bytes.subarray(cursor - low, last - low + 1));
        cursor = last + 1;
        if (cursor > end) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, { status, headers });
}
