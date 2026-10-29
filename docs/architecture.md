# Caledon Forum architecture

Astro server rendering owns public HTML, metadata, structured data and crawlable pagination. React islands enhance the composer and account forms. Small TypeScript handlers handle likes, moderation and click-to-load YouTube. There is no background polling.

## Product invariants

- Never add uploads, a media write endpoint, or a media storage bucket. Images are references to validated external HTTPS URLs.
- Main posts and individual replies each allow 25,000 Unicode code points of Markdown and sanitized HTML, with highlighted code and LaTeX. Entire conversations have no cumulative character budget.
- Username is permanent; a GitHub organization badge grants no moderation privileges.
- Never auto-link existing accounts by email. GitHub linking requires an authenticated session.
- Provider tokens stay encrypted in D1. Browser auth routes cannot retrieve tokens.
- Browser mutation authorization comes from the server session; `/api/v1` uses Bearer API keys. Both enforce current D1 user state.

## Data

`migrations/0001_forum.sql` is the initial D1 migration. `src/db/schema.ts` maps Better Auth's tables for the Drizzle adapter; forum queries use bound D1 statements. Multi-statement forum changes use D1 batches. Better Auth's Drizzle transaction option is disabled because D1 does not support interactive SQL transactions.

`0002_public_post_addresses.sql` adds an INTEGER PRIMARY KEY AUTOINCREMENT address for each existing/new post. An INSERT trigger allocates new addresses atomically with the post. Initially, public URLs used `/p/<integer>`; internal UUID references remain intact so replies, likes and reports do not need to be rewritten. Profiles use `/username`, with case-insensitive reserved system names. No old profile/thread URL handlers are retained.

Likes and notification uniqueness constraints make repeated like requests idempotent. Deletion clears post text and link references, preserving parent/root relationships. Thread locks are checked inside the reply INSERT. Moderation actions are recorded alongside their changes in a batch.

`0005_random_post_addresses.sql` replaces the public address column with TEXT while copying existing IDs verbatim. Only future inserts receive random 19-digit IDs from the D1 trigger. The unique primary key prevents duplicates; publishing retries the entire atomic batch up to three times on an address collision. Internal UUID relations remain unchanged, and legacy URLs keep resolving without redirects. API post IDs are always decimal strings to preserve all 19 digits; safe numeric legacy `parentId` inputs are still accepted. ID order never determines chronological feed/reply order.

`0004_api_keys.sql` stores one key per account with a unique SHA-256 hash, a short display prefix, and creation/last-use timestamps. Tokens have 256 random bits and are only returned by generation/rotation, never by reads. A single conditional INSERT or UPDATE determines the active key; rotation has no overlap period. Already-authorized in-flight requests may finish. Key management requires a browser session and same-origin mutation requests; Bearer keys are recognized only under `/api/v1`. Every API request joins to the current D1 user to enforce suspension, verification, and username requirements. Authenticated API responses and key management responses are never publicly cached. Key endpoints are also unavailable when `AUTH_ENABLED` is false.

`forum-service.ts` contains the shared forum mutation rules; the browser wrapper retains its origin, cookie and CAPTCHA-dependent email flow. API v1 explicitly maps only permitted operations to the shared service, uses public decimal-string post IDs at its boundary, and serializes public profiles using an explicit column list. It never dispatches arbitrary action names. Rate limits share user/action buckets with the website and add an account-wide 60/minute API bucket. `/api/docs` serves locally bundled Swagger UI, with in-memory Bearer authorization and external validation disabled; `/api/openapi.json` defines the versioned interface. API timestamps use Unix milliseconds.

Google is an optional Better Auth provider using the existing encrypted account-token storage and explicit linking policy. New Google users use the existing username onboarding. The browser auth gateway permits Google's callback, but token retrieval stays blocked. Social disconnect uses a conditional D1 delete that requires another account to remain, preventing concurrent disconnects from deleting all login methods. Disconnecting Google preserves GitHub membership; removing GitHub clears its membership cache. Google identity never affects the membership badge.

Every post and reply renders at its own `/p/<publicId>` URL. Each detail page renders only the selected post or reply in full, followed by its direct children one level inset below the composer. Clicking a child opens its own detail page to reveal the next level; ancestors and other branches are never expanded on the current page. A parent link supports navigating back one level. Deleted parents with children retain placeholders and locks follow the root. Direct children use chronological numeric pagination (20 entries), with IDs breaking timestamp ties. `0006_direct_replies_index.sql` indexes parent IDs and ordering. New publish, edit, notification and API URLs use individual permalinks; old root fragment links still open the root but may no longer reveal that reply. API v1 keeps its existing conversation-wide replies endpoint and `replies` count; UI counts use `directReplies` instead.

## Links and media

Parse URLs from the Markdown AST (not code blocks), inspect at most eight unique URLs, and retain images plus the first non-image card. Fetch in batches of four, timeout after five seconds, reject private URLs and revalidate up to three redirects. The production `global_fetch_strictly_public` flag additionally blocks private DNS resolutions/rebinding. Tests for this flag must run in workerd, not just Node.

HTML is bounded to 1 MB; raster images to 10 MB with MIME and magic-byte checks. SVG is rejected. Media proxy IDs must refer to a live published post, or an authenticated user's preview. Links use HTTPS, standard ports, no credentials. External HTML/embed code never runs inside the page.

Metadata is cached for 24 hours in D1. A failure leaves a normal link and does not prevent publishing. YouTube uses oEmbed metadata and a player loaded only on click. External images use the read-only proxy; no media is stored in D1.

Validated image URLs also render alongside captions in the same paragraph; explicitly labelled links remain links. If a signed Discord attachment on `media.discordapp.net/attachments/<channel>/<attachment>/...` returns 403, the shared fetch helper retries once on `cdn.discordapp.com` with the complete path/query intact. For any public URL that still returns 403, it retries the same URL once with a browser-compatible User-Agent. Redirects and both fallbacks share the same five-second timeout; the redirect limit stays at three. This supports previews, published images, avatars and covers. All attempts enforce public HTTPS redirects, byte limits, MIME and raster signature validation. No cookies, authorization headers, or third-party proxy services are used. Persistent 403 responses remain failures; the retry does not renew expiring signatures or bypass attachment permissions.

## Membership

Check the connected GitHub identity with `GET /user/memberships/orgs/CaledonInstitute` and `read:org`. Only active membership qualifies. Store its time and state. Invalidate at each new session, and recheck on subsequent authenticated activity after 24 hours. Deduplicate checks per isolate and back off errors for five minutes. Expired positive results do not render badges. Unlink clears membership immediately.

## Social images

`scripts/prepare-renderer.mjs` adapts pinned Satori 0.63.2 for Workers: HarfBuzz and its `free(void*)` callback trampoline are statically imported WASM modules. Emscripten normally tries to compile both at runtime, which Workers forbids. The script fails loudly if the pinned bootstrap changes. Generated files live in ignored `.astro/` and must be regenerated before dev/build/check.

The PNG endpoint renders 1200×630 images, caches by post revision in the Worker Cache API, and falls back to `public/social.png`. No user-upload functionality is involved. Font data is bundled locally. The renderer never returns user-generated SVG.

## SEO

Public content and metadata are in initial server HTML. Selected posts/replies render their full bodies; reply-list previews link to their individual details. Canonicals use SITE_URL and normalized page/profile-tab parameters. UTM parameters do not change canonicals. Thread JSON-LD describes only comments on the current page. Sitemap lastmod includes reply changes. Private/search/auth/API responses carry noindex; robots.txt allows crawlers to read these directives. Do not add disallow rules that hide noindex pages from crawlers.

Deleted post/reply details return 410 when they have no children; otherwise they retain a placeholder and links to their children. Other missing pages return 404. Private HTML and authenticated responses are never cached publicly. CSP permits only the required Turnstile, GitHub avatar and click-loaded YouTube origins.

## Profile activity and formatting

`0007_profile_location_shares.sql` adds optional public location text, per-post share counters, and an index for profile Likes ordered by like time. Profile Posts and Replies remain author lists; Likes lists the profile owner�s liked content publicly. Like button state still belongs to the viewer. Only the owner�s first Posts page includes the existing composer.

The browser share action is the exception to session-required mutations: same-origin JSON requests can atomically increment an available post�s share count, limited to 40 requests/minute/IP. The client calls it only after clipboard success. No visitor identity or recipient information is stored with the count.

Markdown parsing supports GFM and remark-math. Embedded HTML is parsed with rehype-raw, images are restricted to validated preview proxies, and rehype-sanitize removes active content before rehype-katex and rehype-highlight generate trusted markup. KaTeX trusted commands are disabled and expansion/size are bounded. Both preview and published content use this pipeline; CSS and math fonts are served locally. Declared code languages use the highlight.js common grammar set; unknown and unlabelled code remains plain text.
