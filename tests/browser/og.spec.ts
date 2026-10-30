import { test, expect } from "@playwright/test";
import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { PROFILE_OG_DESIGN_VERSION } from "../../src/lib/og-card";

test("profile OG cards use public identity on every tab and render real PNGs", async ({ request }, testInfo) => {
  const origin = testInfo.project.use.baseURL!;
  const fallback = await (await request.get("/api/og/site.png")).body();
  await mkdir("artifacts", { recursive: true });
  const cards: Buffer[] = [];
  for (const kind of ["cover", "empty", "long", "broken"]) {
    const username = `qa_og_${kind}`;
    let imageUrl = "";
    for (const suffix of ["", "?tab=replies", "?tab=likes", "?page=2"]) {
      const page = await request.get(`/${username}${suffix}`);
      expect(page.status()).toBe(200);
      const html = load(await page.text());
      const url = html('meta[property="og:image"]').attr("content")!;
      expect(url).toContain(`${origin}/api/og/profile/${username}.png?v=${PROFILE_OG_DESIGN_VERSION}-`);
      expect(html('meta[name="twitter:image"]').attr("content")).toBe(url);
      if (imageUrl) expect(url).toBe(imageUrl);
      imageUrl = url;
    }
    const response = await request.get(imageUrl);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const bytes = await response.body();
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    if (process.env.EXPECT_PROFILE_OG === "true") expect(bytes.equals(fallback)).toBe(false);
    expect(await (await request.get(`/api/og/profile/${username}.png?v=old&ignored=1`)).body()).toEqual(bytes);
    await writeFile(`artifacts/og-profile-${kind}.png`, bytes);
    cards.push(bytes);
  }
  if (process.env.EXPECT_PROFILE_OG === "true") expect(new Set(cards.map((bytes) => bytes.toString("base64"))).size).toBe(4);
  const alias = await request.get("/api/og/profile/QA_OG_EMPTY.png", { maxRedirects: 0 });
  expect(alias.status()).toBe(301);
  expect(alias.headers().location).toBe("/api/og/profile/qa_og_empty.png");
  for (const name of ["qa_og_nonexistent", "settings", "bad-name"]) {
    const response = await request.get(`/api/og/profile/${name}.png`);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

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
