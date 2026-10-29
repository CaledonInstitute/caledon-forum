import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { resetDatabase, seedUser, execute, row, env } from "./runtime";
import { quotedPost, localPostId } from "../src/lib/quotes";
import { forumAction } from "../src/lib/forum-service";
import { markdown } from "../src/lib/markdown";
import { inspectLink } from "../src/lib/previews";

let alice: ReturnType<typeof seedUser>;
let url: string;
beforeEach(() => {
  resetDatabase();
  alice = seedUser();
  seedUser("bob");
  execute("INSERT INTO posts(id,author_id,body,created_at,updated_at) VALUES('source','bob','A useful **observation** <script>secret</script>',1793271600000,1793271600000)");
  url = `${env.SITE_URL}/p/${row("SELECT id FROM post_addresses WHERE post_id='source'").id}`;
});
afterEach(() => vi.unstubAllGlobals());

it("resolves copied post addresses without fetching the website or adding views", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const quote = await quotedPost(`My comment\n\n${url}?from=share#reply`);
  expect(quote).toMatchObject({ unavailable: false, name: "bob", username: "bob", text: "A useful observation", url: new URL(url).pathname });
  expect(fetcher).not.toHaveBeenCalled();
  expect(row("SELECT views FROM posts WHERE id='source'").views).toBe(0);
});
it("accepts relative links and rejects lookalike hosts and credentials", async () => {
  expect(localPostId(new URL(url).pathname)).toBeTruthy();
  for (const value of ["https://localhost.evil.test/p/123", "http://user:pass@localhost:4321/p/123", "http://localhost:4322/p/123", "https://example.com/p/123"])
    expect(localPostId(value)).toBeNull();
  expect(await quotedPost(`[quoted](${new URL(url).pathname})`)).toMatchObject({ username: "bob" });
});
it("does not quote URLs in code, math, or image sources", async () => {
  for (const body of [`\`${url}\``, `\`\`\`text\n${url}\n\`\`\``, `$${url}$`, `![image](${url})`]) expect(await quotedPost(body)).toBeNull();
});
it("replaces a bare quoted URL in preview while keeping surrounding text and labelled links", async () => {
  const response = await forumAction(alice, "preview", { body: `My thoughts\n\n${url}` });
  const result = (await response.json()) as any;
  expect(result.quote).toMatchObject({ username: "bob" });
  expect(result.html).toContain("My thoughts");
  expect(result.html).not.toContain(url);
  expect(result.links).toEqual([]);
  expect(await markdown(`[read the source](${url})`, [], url)).toContain("read the source");
});
it("always uses current source content and hides deleted content", async () => {
  execute("UPDATE posts SET body='Updated observation' WHERE id='source'");
  expect(await quotedPost(url)).toMatchObject({ text: "Updated observation" });
  execute("UPDATE posts SET deleted=1 WHERE id='source'");
  expect(await quotedPost(url)).toEqual({ unavailable: true, sourceUrl: url, url: new URL(url).pathname });
  expect(await quotedPost(`${env.SITE_URL}/p/9999999999999999999`)).toMatchObject({ unavailable: true });
});
it("quotes replies, limits nesting, and selects one source", async () => {
  execute("INSERT INTO posts(id,author_id,root_id,parent_id,body,created_at,updated_at) VALUES('reply','alice','source','source',?,1,1)", `A reply quoting ${url}`);
  const replyUrl = `${env.SITE_URL}/p/${row("SELECT id FROM post_addresses WHERE post_id='reply'").id}`;
  const quote = await quotedPost(replyUrl);
  expect(quote).toMatchObject({ username: "alice", parentUsername: "bob" });
  expect(quote).not.toHaveProperty("quote");
  expect(await quotedPost(`${url}\n${replyUrl}`)).toMatchObject({ username: "bob" });
});
it("never scrapes internal quote links for generic link previews", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await inspectLink(url)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
