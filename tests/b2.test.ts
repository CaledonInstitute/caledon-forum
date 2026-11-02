import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { env } from "./runtime";
import { b2, storageReady, uploadsReady } from "../src/lib/b2";
beforeEach(() => {
  Object.assign(env, {
    B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    B2_REGION: "us-west-004",
    B2_BUCKET: "private-forum",
    B2_ACCESS_KEY_ID: "test-key-id",
    B2_SECRET_ACCESS_KEY: "test-secret",
    UPLOADS_ENABLED: "true",
  });
});
afterEach(() => {
  for (const key of ["B2_ENDPOINT", "B2_REGION", "B2_BUCKET", "B2_ACCESS_KEY_ID", "B2_SECRET_ACCESS_KEY", "UPLOADS_ENABLED"]) delete env[key];
  vi.unstubAllGlobals();
});
it("signs bucket-scoped requests with SigV4 and keeps writes inside the configured bucket", async () => {
  const transport = vi.fn(async (request: Request) => {
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key-id\/\d+\/us-west-004\/s3\/aws4_request/);
    expect(request.url).toContain("/private-forum/forum/random-key");
    expect(request.url).toContain("partNumber=1");
    expect(request.method).toBe("PUT");
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", transport);
  await b2("forum/random-key", { method: "PUT", body: new Uint8Array([1, 2, 3]) }, { partNumber: "1", uploadId: "multipart" });
  expect(transport).toHaveBeenCalledOnce();
});
it("can read and clean up stored files while new uploads are disabled", async () => {
  env.UPLOADS_ENABLED = "false";
  expect(uploadsReady()).toBe(false);
  expect(storageReady()).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 }))
  );
  expect((await b2("forum/key", { method: "HEAD" })).ok).toBe(true);
});
it("distinguishes absent HEAD objects from storage outages and rejects non-B2 endpoints", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 }))
  );
  expect((await b2("forum/key", { method: "HEAD" })).status).toBe(404);
  await expect(b2("forum/key")).rejects.toThrow("temporarily unavailable");
  env.B2_ENDPOINT = "https://example.com";
  await expect(b2("forum/key")).rejects.toThrow("Invalid B2 endpoint");
});
