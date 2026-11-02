import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, seedUser, row, execute, env } from "./runtime";
import { filePolicy, validSignature, PART_BYTES, MIB } from "../src/lib/upload-policy";
import { uploadApi, serveFile, cleanupUploads, parseRange } from "../src/lib/uploads";
import { forumAction } from "../src/lib/forum-service";
import { b2 } from "../src/lib/b2";
import { post, ancestors } from "../src/lib/db";
import { attachmentMarker } from "../src/lib/attachment-markers";
import { markdown } from "../src/lib/markdown";
vi.mock("../src/lib/b2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/b2")>()),
  uploadsReady: () => true,
  storageReady: () => true,
  b2: vi.fn(),
}));
vi.mock("../src/lib/auth", () => ({
  authReady: () => true,
  createAuth: () => ({ api: { getSession: async ({ headers }: { headers: Headers }) => (headers.get("cookie") ? { user: { id: headers.get("cookie") } } : null) } }),
}));
let objects: Map<string, Uint8Array>, parts: Map<string, Map<number, Uint8Array>>;
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const req = (path: string, method: string, body?: BodyInit, owner = "alice", origin = env.SITE_URL) =>
  uploadApi(new Request(`${env.SITE_URL}/api/uploads/${path}`, { method, body, headers: { origin } }), owner, path);
async function start(name = "photo.png", size = png.length, purpose = "post", conversationId?: string) {
  return (await req("", "POST", JSON.stringify({ name, size, purpose, conversationId }))).json() as Promise<{ id: string }>;
}
async function upload(name = "photo.png", bytes = png, purpose = "post", conversationId?: string) {
  const { id } = await start(name, bytes.length - (purpose === "dm" ? 16 : 0), purpose, conversationId);
  for (let n = 0; n < bytes.length; n += PART_BYTES) await req(`${id}/${1 + n / PART_BYTES}`, "PUT", bytes.slice(n, n + PART_BYTES));
  await req(`${id}/complete`, "POST", "{}");
  return id;
}
beforeEach(() => {
  resetDatabase();
  seedUser();
  seedUser("bob");
  objects = new Map();
  parts = new Map();
  vi.mocked(b2).mockImplementation(async (key, options = {}, query = {}) => {
    if (options.method === "POST" && "uploads" in query) {
      parts.set(key, new Map());
      return new Response("<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>");
    }
    if (options.method === "PUT") {
      parts.get(key)!.set(Number(query.partNumber), new Uint8Array(options.body as Uint8Array));
      return new Response(null, { headers: { etag: `"part-${query.partNumber}"` } });
    }
    if (options.method === "POST") {
      const items = [...parts.get(key)!.entries()].sort((a, b) => a[0] - b[0]);
      const result = new Uint8Array(items.reduce((n, [, b]) => n + b.length, 0));
      let offset = 0;
      for (const [, bytes] of items) {
        result.set(bytes, offset);
        offset += bytes.length;
      }
      objects.set(key, result);
      return new Response("<CompleteMultipartUploadResult/>");
    }
    if (options.method === "HEAD") {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing object");
      return new Response(null, { headers: { "content-length": String(bytes.length), "x-amz-version-id": "test-version" } });
    }
    if (options.method === "DELETE") {
      if (query.versionId) objects.delete(key);
      return new Response(null, { status: 204 });
    }
    const bytes = objects.get(key)!;
    const range = new Headers(options.headers).get("Range")!;
    const [, lo, hi] = /bytes=(\d+)-(\d+)/.exec(range)!;
    return new Response(bytes.slice(Number(lo), Number(hi) + 1), { status: 206 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("upload policy", () => {
  it("enforces formats, purpose-specific size and signatures", () => {
    expect(filePolicy("photo.PNG", 2 * MIB, "avatar")).toBe("image/png");
    expect(() => filePolicy("x.png", 2 * MIB + 1, "cover")).toThrow("2 MB");
    expect(() => filePolicy("x.mp4", 50 * MIB + 1, "post")).toThrow("50 MB");
    expect(() => filePolicy("x.svg", 100, "post")).toThrow("Choose");
    expect(validSignature(png, "image/png")).toBe(true);
    expect(validSignature(new TextEncoder().encode("<svg/>"), "image/png")).toBe(false);
  });
  it("handles bounded, open, suffix, invalid and unsatisfiable ranges", () => {
    expect(parseRange("bytes=2-4", 8)).toEqual([2, 4]);
    expect(parseRange("bytes=-3", 8)).toEqual([5, 7]);
    expect(parseRange("bytes=2-", 8)).toEqual([2, 7]);
    for (const range of ["bytes=99-", "bytes=5-3", "bytes=-0", "bytes=1-2,4-6", "bytes=-"]) expect(parseRange(range, 8)).toBeNull();
  });
});
describe("private bucket upload lifecycle", () => {
  it("keeps inline order through publishing, replying and editing with associated metadata", async () => {
    const id = await upload();
    const viewer = { id: "alice", username: "alice", name: "Alice", emailVerified: true } as any;
    const marker = attachmentMarker({ id, name: "photo.png" });
    const body = `Before\n${marker}\nAfter`;
    const response = await forumAction(viewer, "publish", { body, attachmentIds: [id] });
    const published = (await response.json()) as any;
    let saved = (await post(published.id))!;
    const preview = await markdown(body, [], undefined, undefined, saved.attachments);
    expect(saved.body).toBe(body);
    expect(await markdown(saved.body, [], undefined, undefined, saved.attachments)).toBe(preview);
    const replyId = await upload("reply.png");
    const replyBody = `Reply before\n${attachmentMarker({ id: replyId, name: "reply.png" })}\nReply after`;
    const reply = (await (await forumAction(viewer, "publish", { body: replyBody, parentId: saved.id, attachmentIds: [replyId] })).json()) as any;
    expect((await post(reply.id))?.body).toBe(replyBody);
    await forumAction(viewer, "edit", { id: saved.id, body: `Changed before\n${marker}\nChanged after`, attachmentIds: [id] });
    saved = (await post(saved.id))!;
    const edited = await markdown(saved.body, [], undefined, undefined, saved.attachments);
    expect(edited.indexOf("Changed before")).toBeLessThan(edited.indexOf("<figure"));
    expect(edited.indexOf("<figure")).toBeLessThan(edited.indexOf("Changed after"));
    expect(edited.match(/class="attachment-view"/g)).toHaveLength(1);
    await forumAction(viewer, "edit", { id: saved.id, body: "Marker removed; keep the file.", attachmentIds: [id] });
    saved = (await post(saved.id))!;
    const legacy = await markdown(saved.body, [], undefined, undefined, saved.attachments);
    expect(legacy.indexOf("Marker removed")).toBeLessThan(legacy.indexOf("<figure"));
  });
  it("rejects CSRF, unverified users, bad bytes, incomplete parts, foreign sessions and expired sessions", async () => {
    await expect(req("", "POST", "{}", "alice", "https://evil.com")).rejects.toBeInstanceOf(Response);
    execute("UPDATE user SET email_verified=0 WHERE id=?", "bob");
    await expect(start("x.png", 8)).resolves.toBeTruthy();
    await expect(req("", "POST", JSON.stringify({ name: "x.png", size: 8, purpose: "post" }), "bob")).rejects.toBeInstanceOf(Response);
    const id = row("SELECT id FROM uploads").id;
    await expect(req(`${id}/1`, "PUT", new Uint8Array(8))).rejects.toThrow("format");
    await expect(req(`${id}/complete`, "POST", "{}")).rejects.toThrow("missing");
    await expect(req(`${id}/1`, "PUT", png, "bob")).rejects.toBeInstanceOf(Response);
    execute("UPDATE uploads SET expires_at=0 WHERE id=?", id);
    await expect(req(`${id}/1`, "PUT", png)).rejects.toThrow("expired");
  });
  it("reserves only two incomplete uploads and releases cancelled/expired sessions", async () => {
    const a = await start();
    await start();
    await expect(start()).rejects.toThrow("Finish");
    await req(a.id, "DELETE");
    await expect(start()).resolves.toBeTruthy();
  });
  it("supports multipart retries, completion retries and attachment-only posts", async () => {
    const bytes = new Uint8Array(6 * MIB).fill(65),
      { id } = await start("notes.txt", bytes.length);
    await req(`${id}/1`, "PUT", bytes.slice(0, PART_BYTES));
    await req(`${id}/1`, "PUT", bytes.slice(0, PART_BYTES));
    await expect(req(`${id}/complete`, "POST", "{}")).rejects.toThrow("missing");
    await req(`${id}/2`, "PUT", bytes.slice(PART_BYTES));
    await req(`${id}/complete`, "POST", "{}");
    await req(`${id}/complete`, "POST", "{}");
    const published = await forumAction(seedUser("charlie"), "publish", { body: "", attachmentIds: [id] }).catch(() => null);
    expect(published).toBeNull();
    const response = await forumAction({ id: "alice", username: "alice", name: "Alice", emailVerified: true, suspended: false } as any, "publish", {
      body: "",
      attachmentIds: [id],
    });
    const result = (await response.json()) as any;
    expect((await post(result.id))?.attachments?.[0].id).toBe(id);
    const reply = await forumAction({ id: "bob", username: "bob", emailVerified: true } as any, "publish", { body: "Reply", parentId: result.id });
    expect((await ancestors(((await reply.json()) as any).id))[0].attachments?.[0].id).toBe(id);
  });
  it("checks publication before cache, caches ranges for 24 hours and immediately denies deleted files", async () => {
    const id = await upload(),
      url = `${env.SITE_URL}/api/files/${id}`;
    expect((await serveFile(new Request(url), id, () => {})).status).toBe(404);
    const draft = await serveFile(new Request(url, { headers: { cookie: "alice" } }), id, () => {});
    expect(draft.headers.get("cache-control")).toContain("no-store");
    await draft.arrayBuffer();
    await forumAction({ id: "alice", username: "alice", emailVerified: true } as any, "publish", { body: "Photo", attachmentIds: [id] });
    const entries = new Map<string, Response>();
    const pending: Promise<unknown>[] = [];
    vi.stubGlobal("caches", {
      default: {
        match: async (r: Request) => entries.get(r.url)?.clone(),
        put: async (r: Request, v: Response) => {
          expect(v.headers.get("cache-control")).toContain("86400");
          entries.set(r.url, v);
        },
      },
    });
    vi.mocked(b2).mockClear();
    const first = await serveFile(new Request(url, { headers: { Range: "bytes=0-3" } }), id, (p) => pending.push(p));
    expect(first.status).toBe(206);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(png.slice(0, 4));
    await Promise.all(pending);
    const second = await serveFile(new Request(url, { headers: { Range: "bytes=-4" } }), id, (p) => pending.push(p));
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(png.slice(4));
    expect(b2).toHaveBeenCalledTimes(1);
    execute("UPDATE uploads SET state='deleting' WHERE id=?", id);
    expect((await serveFile(new Request(url), id, () => {})).status).toBe(404);
  });
  it("returns an uncached retryable error when storage is unavailable", async () => {
    const id = await upload();
    await forumAction({ id: "alice", username: "alice", emailVerified: true } as any, "publish", { body: "Image", attachmentIds: [id] });
    vi.mocked(b2).mockRejectedValueOnce(new Error("Offline"));
    const response = await serveFile(new Request(`${env.SITE_URL}/api/files/${id}`), id, () => {});
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("30");
  });
  it("stores only ciphertext metadata for DM and never serves it to an outsider", async () => {
    execute("INSERT INTO dm_conversations VALUES('conversation','alice','bob',1,1)");
    const id = await upload("encrypted.bin", new Uint8Array(40), "dm", "conversation");
    const asset = row("SELECT * FROM uploads WHERE id=?", id);
    expect(asset.name).toBe("Encrypted attachment");
    expect(asset.mime).toBe("application/octet-stream");
    expect((await serveFile(new Request(`${env.SITE_URL}/api/files/${id}`), id, () => {})).status).toBe(404);
    seedUser("eve");
    expect((await serveFile(new Request(`${env.SITE_URL}/api/files/${id}`, { headers: { cookie: "eve" } }), id, () => {})).status).toBe(404);
  });
  it("saves owned uploaded profile images on localhost and rejects foreign or wrong-purpose assets", async () => {
    const avatarId = await upload("photo.png", png, "avatar");
    const viewer = { id: "alice", username: "alice", name: "Alice", emailVerified: true } as any;
    const url = `${env.SITE_URL}/api/files/${avatarId}`;
    expect((await forumAction(viewer, "profile", { name: "Alice", bio: "", image: url })).status).toBe(200);
    expect(row("SELECT image FROM user WHERE id='alice'").image).toBe(url);
    await expect(forumAction({ id: "bob" } as any, "profile", { name: "Bob", bio: "", image: url })).rejects.toThrow("available image");
    await expect(forumAction(viewer, "profile", { name: "Alice", bio: "", coverImage: url })).rejects.toThrow("available image");
    await forumAction(viewer, "profile", { name: "Alice", bio: "", image: "" });
    expect(row("SELECT state FROM uploads WHERE id=?", avatarId).state).toBe("deleting");
  });
  it("deletes the actual stored version and expires orphaned uploads", async () => {
    const id = await upload();
    execute("UPDATE uploads SET expires_at=0 WHERE id=?", id);
    await cleanupUploads();
    expect(row("SELECT id FROM uploads WHERE id=?", id)).toBeUndefined();
    expect(b2).toHaveBeenCalledWith(`forum/${id}`, { method: "DELETE" }, { versionId: "test-version" });
  });
});
