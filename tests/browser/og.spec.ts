import { test, expect } from "@playwright/test";
import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";

test("post and reply OG images use their own content, remain passive and preserve generic pages", async ({ request }, testInfo) => {
  const origin = testInfo.project.use.baseURL!;
  const feed = load(await (await request.get("/")).text());
  const fallback = await (await request.get("/social.png")).body();
  expect(await (await request.get("/api/og/site.png")).body()).toEqual(fallback);
  expect(feed('meta[property="og:image"]').attr("content")).toBe(`${origin}/api/og/site.png`);
  const notebook = feed("#post-qa-notebook").attr("data-post-url")!;
  const detail = load(await (await request.get(notebook)).text());
  const reply = detail(".reply-list .post-time").first().attr("href")!;
  expect(reply).toMatch(/^\/p\/[0-9]+$/);
  const before = load(await (await request.get("/")).text())("#post-qa-notebook .post-views").text();
  const timings = [];
  const outputs: Buffer[] = [];
  await mkdir("artifacts", { recursive: true });
  for (const [name, path] of [
    ["post", notebook],
    ["long", feed("#post-qa-long").attr("data-post-url")!],
    ["media", feed("#post-qa-media").attr("data-post-url")!],
    ["reply", reply],
  ]) {
    const url = `/api/og/${path.split("/").pop()}.png`;
    const start = performance.now();
    const result = await request.get(url);
    const bytes = await result.body();
    const firstMs = Math.round(performance.now() - start);
    expect(result.status()).toBe(200);
    expect(result.headers()["content-type"]).toContain("image/png");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    expect(bytes.equals(fallback)).toBe(process.env.EXPECT_POST_OG !== "true");
    const warmStart = performance.now();
    expect(await (await request.get(`${url}?v=old&arbitrary=ignored`)).body()).toEqual(bytes);
    timings.push({ kind: name, firstMs, repeatMs: Math.round(performance.now() - warmStart), bytes: bytes.length });
    outputs.push(bytes);
    await writeFile(`artifacts/og-${name}.png`, bytes);
  }
  if (process.env.EXPECT_POST_OG === "true") {
    expect(outputs[0].equals(outputs[3])).toBe(false);
    expect(outputs[0].equals(outputs[2])).toBe(false);
  }
  const replyPage = load(await (await request.get(reply)).text());
  expect(replyPage('meta[property="og:image"]').attr("content")).toContain(`/api/og/${reply.split("/").pop()}.png?v=`);
  expect(replyPage('meta[name="twitter:image"]').attr("content")).toBe(replyPage('meta[property="og:image"]').attr("content"));
  const after = load(await (await request.get("/")).text())("#post-qa-notebook .post-views").text();
  expect(after).toBe(before);
  expect((await request.get("/api/og/999999999.png?v=old")).status()).toBe(404);
  await writeFile(
    "artifacts/og-local-timings.json",
    JSON.stringify({ runtime: "local workerd", metric: "HTTP wall time; not production CPU or guaranteed cold isolate", timings }, null, 2)
  );
});
