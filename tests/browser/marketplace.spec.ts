import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const listingId = "40000000-0000-4000-8000-000000000001";
const photoId = (i: number) => `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const query = "Marketplace regression";
async function sql(statements: string[]) {
  await mkdir(".astro", { recursive: true });
  await writeFile(".astro/marketplace-browser.sql", statements.join(";\n") + ";");
  execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "caledon-forum-db", "--local", "--file", ".astro/marketplace-browser.sql"], {
    windowsHide: true,
    stdio: "pipe",
  });
}
test.beforeAll(async ({ baseURL }) => {
  if (new URL(baseURL!).hostname !== "localhost") throw new Error("Marketplace fixtures require the local browser-test environment.");
  const now = Date.now();
  const statements = ["INSERT OR IGNORE INTO dm_vaults(user_id,version,public_key,vault) VALUES('qa-alice',1,'marketplace-browser','marketplace-browser')"];
  for (let i = 1; i <= 5; i++) {
    statements.push(
      `INSERT OR REPLACE INTO marketplace_listings(id,seller_id,kind,title,description,price,negotiable,location,condition,status,created_at,updated_at) VALUES('40000000-0000-4000-8000-${String(i).padStart(12, "0")}','qa-alice','${i === 3 ? "service" : "goods"}','${i === 1 ? "Research notebook" : i === 2 ? "A mechanical keyboard with an intentionally long listing title for testing how two lines of text fit inside the grid" : i === 3 ? "Research mentoring" : "Desk lamp"}','${query}: available to the community.',${i === 1 ? 0 : i === 2 ? 999999999999 : 250000},${i === 2 ? 1 : 0},'Bandar Lampung, Indonesia',${i === 3 ? "NULL" : "'used'"},'${i === 5 ? "closed" : "active"}',${now - i},${now})`
    );
  }
  for (let i = 1; i <= 4; i++) {
    statements.push(
      `INSERT OR IGNORE INTO uploads(id,owner_id,purpose,name,mime,size,object_key,state,created_at,expires_at) VALUES('${photoId(i)}','qa-alice','post','notebook-${i}.png','image/png',100,'marketplace-browser-${i}','ready',${now},${now + 86400000})`
    );
    statements.push(`INSERT OR IGNORE INTO marketplace_photos(listing_id,asset_id,position) VALUES('${listingId}','${photoId(i)}',${i - 1})`);
  }
  statements.push(
    `INSERT OR IGNORE INTO posts(id,author_id,body,created_at,updated_at) VALUES('qa-marketplace-card','qa-alice','http://localhost:4321/marketplace/${listingId}',${now},${now})`
  );
  await sql(statements);
});
test.afterAll(async () => {
  await sql([
    "DELETE FROM posts WHERE id='qa-marketplace-card'",
    "DELETE FROM marketplace_photos WHERE listing_id LIKE '40000000-0000-4000-8000-%'",
    "DELETE FROM marketplace_listings WHERE id LIKE '40000000-0000-4000-8000-%'",
    "DELETE FROM uploads WHERE object_key LIKE 'marketplace-browser-%'",
    "DELETE FROM dm_vaults WHERE user_id='qa-alice' AND public_key='marketplace-browser'",
  ]);
});
test.beforeEach(async ({ page, context }) => {
  await context.addCookies([JSON.parse(await readFile(".astro/qa-session.json", "utf8"))]);
  await page.route("**/api/files/*", (route) => {
    const index = Number(route.request().url().slice(-1)) || 1;
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e2e5e8"/><g transform="translate(${175 + index * 8},70) rotate(${index * 3},200,220)"><rect width="400" height="460" rx="8" fill="#354759"/><path d="M40 0v460" stroke="#233242" stroke-width="4"/><rect x="100" y="90" width="240" height="100" rx="2" fill="#fff"/><text x="220" y="132" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#222">Research notes</text><text x="220" y="167" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#555">Volume ${index}</text></g></svg>`,
    });
  });
  await page.route("**/api/uploads**", (route) => route.fulfill({ json: { enabled: false } }));
});

test("grid keeps prices, titles and metadata separate, including a single result", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/marketplace?q=${encodeURIComponent(query)}`);
  const cards = page.locator(".listing-card");
  await expect(cards).toHaveCount(4);
  await expect(cards.first().locator(".listing-price")).toHaveText("Free");
  await expect(cards.first().locator("h2")).toHaveText("Research notebook");
  await expect(cards.nth(1).getByText("Negotiable", { exact: true })).toBeVisible();
  const first = (await cards.first().boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  expect(first.y).toBe(second.y);
  expect(second.x).toBeGreaterThan(first.x + first.width);
  const price = (await cards.first().locator(".listing-price").boundingBox())!;
  expect((await cards.first().locator("h2").boundingBox())!.y).toBeGreaterThanOrEqual(price.y + price.height);
  await page.getByRole("searchbox").fill("Research notebook");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(cards).toHaveCount(1);
  expect((await cards.first().boundingBox())!.width).toBeCloseTo(first.width, 0);
  await page.getByRole("searchbox").fill(query);
  await page.getByLabel("Listing type").selectOption("service");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator(".listing-photo")).toHaveText("Service");
  await page.getByLabel("Listing type").selectOption("");
  await page.getByLabel("Listing status").selectOption("closed");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(cards.first().locator(".listing-status")).toHaveText("Closed");
});

test("gallery selects a full-size photo with keyboard and preserves seller permissions", async ({ page, context }) => {
  await page.goto(`/marketplace/${listingId}`);
  await expect(page.getByRole("button", { name: "Show photo 1" })).toHaveAttribute("aria-pressed", "true");
  const fourth = page.getByRole("button", { name: "Show photo 4" });
  await fourth.focus();
  await page.keyboard.press("Enter");
  await expect(fourth).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".listing-gallery-main")).toHaveAttribute("href", `/api/files/${photoId(4)}`);
  await expect(page.locator(".listing-gallery-main img")).toHaveAttribute("alt", "Research notebook, photo 4");
  await expect(page.getByRole("link", { name: "Edit listing", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact seller" })).toHaveCount(0);
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole("link", { name: "Contact seller" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Edit listing", exact: true })).toHaveCount(0);
  const forbidden = await page.goto(`/marketplace/${listingId}?edit=1`);
  expect(forbidden!.status()).toBe(403);
});

test("create and edit preserve failed drafts and send the goods/service fields", async ({ page }) => {
  await page.goto("/marketplace/new");
  const publish = page.getByRole("button", { name: "Publish listing" });
  await expect(publish).toBeEnabled();
  await page.getByLabel("Title", { exact: true }).fill("Research mentoring");
  await page.getByLabel("Description", { exact: true }).fill("A session to discuss your research notebook.");
  await page.getByLabel("Type", { exact: true }).selectOption("service");
  await expect(page.getByLabel("Condition", { exact: true })).toHaveCount(0);
  let payload: any;
  await page.route("**/api/marketplace/save", (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: "Enable DM before publishing." } });
  });
  await publish.click();
  await expect(page.getByRole("alert")).toHaveText("Enable DM before publishing.");
  expect(payload.condition).toBeNull();
  expect(payload.kind).toBe("service");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Research mentoring");
  await page.goto(`/marketplace/${listingId}?edit=1`);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Research notebook");
  await expect(page.getByLabel("Condition", { exact: true })).toHaveValue("used");
  await page.getByRole("button", { name: "Save listing", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Enable DM before publishing.");
  expect(payload.id).toBe(listingId);
  expect(payload.condition).toBe("used");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/marketplace/${listingId}$`));
});

test("publishing waits for uploads and prevents duplicate requests", async ({ page }) => {
  let releaseUpload!: () => void;
  const pendingUpload = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("**/api/uploads**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    if (route.request().url().endsWith("/complete")) {
      await pendingUpload;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { id: photoId(9), partBytes: 5242880 } });
  });
  await page.goto("/marketplace/new");
  await expect(page.getByRole("button", { name: "Add files" })).toBeEnabled();
  await page.getByLabel("Title", { exact: true }).fill("New notebook");
  await page.getByLabel("Description", { exact: true }).fill("A notebook for your next research project.");
  await page.locator("input[type=file]").setInputFiles({
    name: "notebook.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByRole("button", { name: "Publish listing" })).toBeDisabled();
  releaseUpload();
  await expect(page.getByRole("button", { name: "Publish listing" })).toBeEnabled();
  let calls = 0;
  let finish!: () => void;
  const saving = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/marketplace/save", async (route) => {
    calls++;
    expect(route.request().postDataJSON().photoIds).toEqual([photoId(9)]);
    await saving;
    await route.fulfill({ json: { url: `/marketplace/${listingId}` } });
  });
  await page.getByRole("button", { name: "Publish listing" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(calls).toBe(1);
  finish();
  await expect(page).toHaveURL(new RegExp(`/marketplace/${listingId}$`));
});

test("publishing creates a live product card in the home and profile timelines", async ({ page, baseURL }) => {
  await page.goto("/marketplace/new");
  await page.getByLabel("Title", { exact: true }).fill("Timeline product browser test");
  await page.getByLabel("Description", { exact: true }).fill("A notebook offered to the community through the marketplace.");
  await page.getByLabel("Location (optional)").fill("Bandar Lampung, Indonesia");
  await page.getByRole("button", { name: "Publish listing" }).click();
  await expect(page).toHaveURL(/\/marketplace\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const card = page.locator(`.timeline-product[href='/marketplace/${id}']`);
  const action = (name: string, data: object) => page.request.post(`/api/marketplace/${name}`, { data: { id, ...data }, headers: { Origin: baseURL! } });
  try {
    for (const path of ["/", "/qa_caledon"]) {
      await page.goto(path);
      await expect(card).toHaveCount(1);
      await expect(card.locator(".timeline-product-price")).toHaveText("Free");
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/marketplace/${id}$`));
    }
    const result = await action("save", {
      kind: "service",
      title: "Updated mentoring session",
      description: "One session to review your next research project.",
      price: 150000,
      negotiable: true,
      location: "Jakarta",
      condition: null,
      photoIds: [],
    });
    expect(result.status()).toBe(200);
    await page.goto("/");
    await expect(card).toHaveCount(1);
    await expect(card.locator("h3")).toHaveText("Updated mentoring session");
    await expect(card.locator(".timeline-product-meta").last()).toHaveText("Service");
    const article = card.locator("xpath=ancestor::article");
    const postId = await article.getAttribute("data-post-id");
    await page.goto(`/edit/${postId}`);
    await expect(page.getByRole("heading", { name: "Edit post", exact: true })).toBeVisible();
    expect((await action("close", { status: "closed" })).status()).toBe(200);
    await page.goto("/qa_caledon");
    await expect(card.locator(".timeline-product-status")).toHaveText("Closed");
  } finally {
    expect((await action("delete", {})).status()).toBe(200);
  }
  await page.goto("/qa_caledon");
  await expect(page.locator(".timeline-product-unavailable")).toBeVisible();
});

test("a live deletion removes the product photo and card from an open timeline", async ({ page }) => {
  let deleted = false;
  let notify = () => {};
  await page.route("**/qa_caledon", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("<body", '<body data-realtime="true"') });
  });
  await page.route("**/api/live/snapshot?*", (route) =>
    route.fulfill({ json: { latest: "marketplace-fixture", unread: 0, items: deleted ? [{ id: "qa-marketplace-card", deleted: 1 }] : [] } })
  );
  await page.routeWebSocket("**/api/live/connect", (socket) => {
    notify = () => socket.send(JSON.stringify({ type: "refresh" }));
  });
  await page.goto("/qa_caledon");
  const article = page.locator("#post-qa-marketplace-card");
  await expect(article.locator(".timeline-product")).toBeVisible();
  await article.scrollIntoViewIfNeeded();
  await expect(page.locator("body")).toHaveAttribute("data-realtime-connected", "true");
  deleted = true;
  notify();
  await expect(article.locator(".timeline-product")).toHaveCount(0);
  await expect(article.getByText("This post was deleted.", { exact: true })).toBeVisible();
});

test("pasted product links use the same card in the composer, timeline, replies and post detail", async ({ page, baseURL }) => {
  await page.goto("/");
  const url = `${baseURL}/marketplace/${listingId}`;
  const text = "This notebook would be useful for our next experiment.";
  await page.getByLabel("Your post", { exact: true }).fill(`${text}\n\n${url}`);
  const draft = page.locator(".composer .timeline-product");
  await expect(draft).toBeVisible();
  await expect(draft).toHaveAttribute("href", `/marketplace/${listingId}`);
  const published = page.waitForResponse((r) => r.url().endsWith("/api/forum/publish") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  const result = await (await published).json();
  try {
    const article = page.locator(`#post-${result.id}`);
    await expect(article.locator(".timeline-product")).toBeVisible();
    await expect(article.locator(".post-content")).toHaveText(text);
    await expect(article.locator(".link-card")).toHaveCount(0);
    await page.goto(result.url);
    await expect(page.locator(".conversation .timeline-product")).toBeVisible();
    await page.getByLabel("Your reply", { exact: true }).fill(`I agree.\n\n${url}`);
    await expect(page.locator(".composer .timeline-product")).toBeVisible();
    const replyResponse = page.waitForResponse((r) => r.url().endsWith("/api/forum/publish") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    const reply = await (await replyResponse).json();
    try {
      await expect(page.locator(`#post-${reply.id} .timeline-product`)).toBeVisible();
      await page.goto(`/edit/${result.id}`);
      await page.getByLabel("Your post", { exact: true }).fill("Changed my recommendation.");
      await expect(page.locator(".composer .timeline-product")).toHaveCount(0);
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page.locator(`.conversation #post-${result.id} .timeline-product`)).toHaveCount(0);
    } finally {
      await page.request.post("/api/forum/delete", { data: { id: reply.id }, headers: { Origin: baseURL! } });
    }
  } finally {
    await page.request.post("/api/forum/delete", { data: { id: result.id }, headers: { Origin: baseURL! } });
  }
});

for (const width of [320, 390, 680, 1280]) {
  test(`timeline product cards fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/qa_caledon"]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".composer [contenteditable=true]")).toBeVisible();
      const card = page.locator(`.timeline-product[href='/marketplace/${listingId}']`);
      await expect(card).toBeVisible();
      await expect(card.locator("img")).toBeVisible();
      await expect(card.locator(".timeline-product-price")).toHaveText("Free");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mkdir("artifacts/marketplace", { recursive: true });
      await card.locator("xpath=ancestor::article").screenshot({ path: `artifacts/marketplace/timeline-${path === "/" ? "home" : "profile"}-${width}.png` });
      await card.focus();
      expect(await card.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/marketplace/${listingId}$`));
    }
  });
}

for (const width of [320, 390, 680, 1280]) {
  test(`all marketplace layouts fit at ${width}px`, async ({ page }) => {
    await mkdir("artifacts/marketplace", { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of [
      ["index", `/marketplace?q=${encodeURIComponent(query)}`],
      ["detail", `/marketplace/${listingId}`],
      ["create", "/marketplace/new"],
      ["edit", `/marketplace/${listingId}?edit=1`],
    ]) {
      await page.goto(path);
      if (name === "create" || name === "edit") await expect(page.locator(".listing-form button[type=submit]")).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `artifacts/marketplace/${name}-${width}.png`, fullPage: true });
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().right}`)
          .slice(0, 15)
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: ${overflow.join(", ")}`).toBe(true);
      await expect(page.locator(width <= 680 ? ".mobile-nav a[href='/marketplace']" : ".nav a[href='/marketplace']")).toHaveAttribute("aria-current", "page");
      if (name === "index") {
        const columns = await page.locator(".marketplace-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(width < 360 ? 1 : 2);
      }
      if (name === "detail") expect((await page.locator(".listing-gallery-main img").boundingBox())!.height).toBeLessThanOrEqual(400);
    }
  });
}
