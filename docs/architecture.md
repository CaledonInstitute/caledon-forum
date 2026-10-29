# Caledon Forum architecture

Astro server rendering owns public HTML, metadata, structured data and crawlable pagination. React islands enhance the composer and account forms. Small TypeScript handlers handle likes, moderation and click-to-load YouTube. There is no background polling.

## Product invariants

- Never add uploads, a media write endpoint, or a media storage bucket. Images are references to validated external HTTPS URLs.
- Main posts and individual replies each allow 25,000 Unicode code points of Markdown. Entire conversations have no cumulative character budget.
- Username is permanent; a GitHub organization badge grants no moderation privileges.
- Never auto-link existing accounts by email. GitHub linking requires an authenticated session.
- Provider tokens stay encrypted in D1. Browser auth routes cannot retrieve tokens.
- API mutation authorization always comes from the server session and current D1 user state.

## Data

`migrations/0001_forum.sql` is the initial D1 migration. `src/db/schema.ts` maps Better Auth's tables for the Drizzle adapter; forum queries use bound D1 statements. Multi-statement forum changes use D1 batches. Better Auth's Drizzle transaction option is disabled because D1 does not support interactive SQL transactions.

`0002_public_post_addresses.sql` adds an INTEGER PRIMARY KEY AUTOINCREMENT address for each existing/new post. An INSERT trigger allocates new addresses atomically with the post. Public URLs use `/p/<integer>`; internal UUID references remain intact so replies, likes and reports do not need to be rewritten. Profiles use `/username`, with case-insensitive reserved system names. No old profile/thread URL handlers are retained.

Likes and notification uniqueness constraints make repeated like requests idempotent. Deletion clears post text and link references, preserving parent/root relationships. Thread locks are checked inside the reply INSERT. Moderation actions are recorded alongside their changes in a batch.

Pagination uses bounded numeric pages so anonymous users and crawlers have stable, directly addressable reply pages. Replies link to their page and anchor. Ordering always includes IDs to break timestamp ties. This uses SQL offsets rather than opaque cursor-only URLs to support public reply permalinks.

## Links and media

Parse URLs from the Markdown AST (not code blocks), inspect at most eight unique URLs, and retain images plus the first non-image card. Fetch in batches of four, timeout after five seconds, reject private URLs and revalidate up to three redirects. The production `global_fetch_strictly_public` flag additionally blocks private DNS resolutions/rebinding. Tests for this flag must run in workerd, not just Node.

HTML is bounded to 1 MB; raster images to 10 MB with MIME and magic-byte checks. SVG is rejected. Media proxy IDs must refer to a live published post, or an authenticated user's preview. Links use HTTPS, standard ports, no credentials. External HTML/embed code never runs inside the page.

Metadata is cached for 24 hours in D1. A failure leaves a normal link and does not prevent publishing. YouTube uses oEmbed metadata and a player loaded only on click. External images use the read-only proxy; no media is stored in D1.

## Membership

Check the connected GitHub identity with `GET /user/memberships/orgs/CaledonInstitute` and `read:org`. Only active membership qualifies. Store its time and state. Invalidate at each new session, and recheck on subsequent authenticated activity after 24 hours. Deduplicate checks per isolate and back off errors for five minutes. Expired positive results do not render badges. Unlink clears membership immediately.

## Social images

`scripts/prepare-renderer.mjs` adapts pinned Satori 0.63.2 for Workers: HarfBuzz and its `free(void*)` callback trampoline are statically imported WASM modules. Emscripten normally tries to compile both at runtime, which Workers forbids. The script fails loudly if the pinned bootstrap changes. Generated files live in ignored `.astro/` and must be regenerated before dev/build/check.

The PNG endpoint renders 1200×630 images, caches by post revision in the Worker Cache API, and falls back to `public/social.png`. No user-upload functionality is involved. Font data is bundled locally. The renderer never returns user-generated SVG.

## SEO

Public content and metadata are in initial server HTML, including reply bodies inside native expandable details. Canonicals use SITE_URL and normalized page/profile-tab parameters. UTM parameters do not change canonicals. Thread JSON-LD describes only comments on the current page. Sitemap lastmod includes reply changes. Private/search/auth/API responses carry noindex; robots.txt allows crawlers to read these directives. Do not add disallow rules that hide noindex pages from crawlers.

Public moderation removals return 410 when a deleted root has no remaining visible replies. Other missing pages return 404. Private HTML and authenticated responses are never cached publicly. CSP permits only the required Turnstile, GitHub avatar and click-loaded YouTube origins.
