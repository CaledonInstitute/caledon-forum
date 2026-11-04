import { beforeEach, expect, it } from "vitest";
import { resetDatabase, seedUser, execute, row } from "./runtime";
import { marketplaceAction, getListing, listingCards } from "../src/lib/marketplace";
import { forumAction } from "../src/lib/forum-service";
import { post, timeline, profilePosts, profileCounts } from "../src/lib/db";
import { listingSource } from "../src/lib/client-listings";
import { localListingId } from "../src/lib/listing-link";
import { GET as publicListings } from "../src/pages/api/public/listings";
import { markdown } from "../src/lib/markdown";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { deleteAccount, cleanupAccounts } from "../src/lib/account-deletion";

let alice: ReturnType<typeof seedUser>;
const input = {
  kind: "goods",
  title: "Research notebook",
  description: "A notebook for your next experiment.",
  price: 0,
  negotiable: false,
  location: "Jakarta",
  condition: "used",
  photoIds: [],
};
beforeEach(() => {
  resetDatabase();
  alice = seedUser();
  execute("INSERT INTO dm_vaults(user_id,version,public_key,vault) VALUES('alice',1,'{}','{}')");
});
async function publish(overrides = {}) {
  const response = await marketplaceAction(alice, "save", { ...input, ...overrides });
  expect(response.status).toBe(200);
  const { id } = (await response.json()) as { id: string };
  const linked = row("SELECT id FROM posts WHERE body=?", `http://localhost:4321/marketplace/${id}`);
  return { id, postId: linked?.id as string };
}
it("publishes exactly one root post with an address to the profile and main timelines", async () => {
  const { id, postId } = await publish();
  const p = (await post(postId))!;
  expect(p).toMatchObject({ authorId: "alice", rootId: null, parentId: null, attachments: [] });
  expect(p.publicId).toMatch(/^[1-9][0-9]*$/);
  expect(p.body).toBe(`http://localhost:4321/marketplace/${id}`);
  expect((await timeline()).map((p) => p.id)).toEqual([postId]);
  expect((await timeline(undefined, 1, alice.id)).map((p) => p.id)).toEqual([postId]);
  expect((await profilePosts(alice.id, "posts")).map((p) => p.id)).toEqual([postId]);
  expect((await profileCounts(alice.id)).posts).toBe(1);
  expect((await listingCards([id]))[0]).toMatchObject({ id, title: input.title, price: 0, photoId: null });
});
it("updates the existing card without duplicating or bumping its original publication time", async () => {
  const { id, postId } = await publish();
  const before = (await post(postId))!;
  await publish({ id, title: "Updated notebook", price: 150000, negotiable: true });
  const after = (await post(postId))!;
  expect(after.createdAt).toBe(before.createdAt);
  expect(after.body).toBe(before.body);
  expect(row("SELECT COUNT(*) n FROM posts WHERE body=?", before.body).n).toBe(1);
  expect((await listingCards([id]))[0]).toMatchObject({ title: "Updated notebook", price: 150000, negotiable: 1 });
  for (const status of ["closed", "active"]) {
    await marketplaceAction(alice, "close", { id, status });
    expect((await listingCards([id]))[0]?.status).toBe(status);
  }
});
it("reads marketplace photos without duplicating ownership and reflects photo replacements", async () => {
  const photos = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of photos)
    execute(
      "INSERT INTO uploads(id,owner_id,purpose,name,mime,size,object_key,state,created_at,expires_at) VALUES(?,'alice','post','photo.png','image/png',100,?,'ready',1,1)",
      id,
      id
    );
  const { id } = await publish({ photoIds: [photos[0]] });
  expect(row("SELECT COUNT(*) n FROM post_attachments").n).toBe(0);
  expect((await listingCards([id]))[0]?.photoId).toBe(photos[0]);
  await publish({ id, photoIds: [photos[1]] });
  expect((await listingCards([id]))[0]?.photoId).toBe(photos[1]);
});
it("rolls back the listing and photo links if automatic post creation fails", async () => {
  execute("CREATE TRIGGER reject_listing_post BEFORE INSERT ON posts WHEN NEW.body LIKE '%/marketplace/%' BEGIN SELECT RAISE(ABORT,'forced post failure'); END");
  await expect(marketplaceAction(alice, "save", input)).rejects.toThrow("forced post failure");
  expect(row("SELECT COUNT(*) n FROM marketplace_listings").n).toBe(0);
  expect(row("SELECT COUNT(*) n FROM posts").n).toBe(0);
});
it("keeps link posts editable and independent from their listings", async () => {
  const { id, postId } = await publish();
  const bob = seedUser("bob");
  expect((await forumAction(bob, "like", { id: postId, liked: true })).status).toBe(200);
  expect((await forumAction(bob, "publish", { parentId: postId, body: "Is this still available?" })).status).toBe(200);
  expect((await post(postId))?.replies).toBe(1);
  expect((await forumAction(alice, "edit", { id: postId, body: "My thoughts about this product" })).status).toBe(200);
  expect((await post(postId))?.body).toBe("My thoughts about this product");
  expect((await forumAction(alice, "delete", { id: postId })).status).toBe(200);
  expect(await getListing(id)).not.toBeNull();
  await publish({ id, title: "Updated after hiding" });
  expect((await post(postId))?.deleted).toBe(1);
  expect((await profileCounts(alice.id)).posts).toBe(0);
});
it.each(["delete", "moderate"])("preserves ordinary link posts when a listing is removed via %s", async (action) => {
  const { id, postId } = await publish();
  const actor = action === "moderate" ? seedUser("admin", true, "admin") : alice;
  await marketplaceAction(actor, action, { id });
  expect((await post(postId))?.deleted).toBe(0);
  expect(await profilePosts(alice.id, "posts")).toHaveLength(1);
  expect(await listingCards([id])).toEqual([]);
});
it("does not leak suspended listings and remains compatible with account cleanup", async () => {
  const { id, postId } = await publish();
  execute("UPDATE user SET suspended=1 WHERE id='alice'");
  expect(await listingCards([id])).toEqual([]);
  execute("UPDATE user SET suspended=0 WHERE id='alice'");
  await deleteAccount(alice.id);
  await cleanupAccounts();
  expect(row("SELECT COUNT(*) n FROM marketplace_listings").n).toBe(0);
  expect((await post(postId))?.deleted).toBe(1);
});

it("recognizes bare and Markdown product links, ignoring external origins, code and image links", async () => {
  const { id } = await publish();
  const url = `http://localhost:4321/marketplace/${id}`;
  expect(listingSource(`Recommended: ${url}`, "http://localhost:4321")).toEqual({ id, sourceUrl: url });
  expect(listingSource(`[Product](/marketplace/${id})`, "http://localhost:4321")?.id).toBe(id);
  for (const body of [`\`${url}\``, `![Image](${url})`, `https://other.test/marketplace/${id}`]) expect(listingSource(body, "http://localhost:4321")).toBeNull();
  expect(localListingId(`http://localhost:4321@evil.test/marketplace/${id}`, "http://localhost:4321")).toBeNull();
  const html = await markdown(`My recommendation\n\n${url}`, [], [url]);
  expect(html).toContain("My recommendation");
  expect(html).not.toContain(url);
});
it("serves current public cards and rejects unbounded or malformed requests", async () => {
  const { id } = await publish();
  const read = (ids: string) => publicListings({ url: new URL(`http://localhost:4321/api/public/listings?ids=${ids}`) } as any) as Promise<Response>;
  const response = await read(id);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(((await response.json()) as any).items[0]).toMatchObject({ id, title: input.title });
  for (const ids of ["", "bad", Array.from({ length: 22 }, () => crypto.randomUUID()).join(",")]) expect((await read(ids)).status).toBe(400);
  await marketplaceAction(alice, "delete", { id });
  expect(await (await read(id)).json()).toEqual({ items: [] });
});

it("migrates previous special posts into link posts without losing addresses or reactions", () => {
  const copy = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql") && name < "0020")
      .sort())
      copy.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    const id = "40000000-0000-4000-8000-000000000001";
    copy.exec(`INSERT INTO user(id,name,email,email_verified,created_at,updated_at,username) VALUES('seller','Seller','seller@test.invalid',1,1,1,'seller');
      INSERT INTO marketplace_listings(id,seller_id,kind,title,description,price,created_at,updated_at) VALUES('${id}','seller','service','Help','Research help',0,1,1);
      INSERT INTO posts(id,author_id,listing_id,body,created_at,updated_at) VALUES('old','seller','${id}','Old title and price',1,2);
      INSERT INTO likes(post_id,user_id,created_at) VALUES('old','seller',3);`);
    const address = copy.prepare("SELECT id FROM post_addresses WHERE post_id='old'").get();
    copy.exec(readFileSync(new URL("../migrations/0020_listing_link_posts.sql", import.meta.url), "utf8"));
    const migrated = copy.prepare("SELECT body,created_at,updated_at FROM posts WHERE id='old'").get() as { body: string };
    expect(listingSource(migrated.body, "http://localhost:4321")?.id).toBe(id);
    expect(migrated).toMatchObject({ created_at: 1, updated_at: 2 });
    expect(copy.prepare("SELECT id FROM post_addresses WHERE post_id='old'").get()).toEqual(address);
    expect(copy.prepare("SELECT COUNT(*) n FROM likes WHERE post_id='old'").get()).toMatchObject({ n: 1 });
    expect(
      copy
        .prepare("PRAGMA table_info(posts)")
        .all()
        .some((column) => column.name === "listing_id")
    ).toBe(false);
  } finally {
    copy.close();
  }
});
