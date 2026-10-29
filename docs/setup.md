# Setup and operations

Public, server-rendered conversations for Caledon Institute. Astro + React islands on Cloudflare Workers, D1 + Drizzle, Better Auth, Resend, and Turnstile.

Production: https://caledon-forum.supervoid.workers.dev. Sign-in remains disabled until the external service configuration below is completed.

Each post and reply supports **25,000 Unicode code points** of Markdown. External image URLs render automatically; other URLs receive a metadata card, including click-to-load YouTube. **Image uploads are permanently out of scope.**

Profile avatars and cover photos use public HTTPS image links, validated and served through the forum proxy (JPEG, PNG, GIF, or WebP, up to 2 MB). Set or remove the cover photo in Settings > Profile. Apply migration `0003_profile_cover.sql` before running the updated app.

Public links that return 403 receive one retry to the same URL with a browser-compatible User-Agent. Discord attachment links additionally fall back from the media resize proxy to Discord's original CDN. This applies to posts, previews, profile images, and covers. The original CDN can return the image at its original size, so the same 2 MB profile/cover and 10 MB post-image limits still apply. Persistent 403 responses remain failures. Discord attachment signatures expire; use a permanent public image URL for long-lived images. Signatures and query parameters must be kept intact. Image URLs pasted next to captions also render; explicitly labelled Markdown links remain clickable links.

Profiles use `/username`; posts use `/p/<id>`. After migration `0005_random_post_addresses.sql`, new posts and replies receive random IDs with exactly 19 digits. Existing IDs and URLs remain unchanged. System usernames are reserved at registration and GitHub onboarding. The old `/u/…` and `/thread/…` routes are removed and return 404, without legacy redirects.

## Development

Requires Node 22.23.4+ and the existing Wrangler login.

```powershell
npm ci
npx wrangler d1 migrations apply caledon-forum-db --local
node scripts/prepare-renderer.mjs
npx astro dev --background
```

Use `astro dev status`, `astro dev logs`, and `astro dev stop` to manage the server. Open http://localhost:4321. To load clearly labelled local test data, run `node scripts/seed-local.mjs`; this command always uses `--local` and is never part of deployment.

Authentication fails closed until every required service is configured. Public pages remain usable while sign-in is disabled. Copy `.dev.vars.example` to ignored `.dev.vars` for local settings; never commit secrets or use test credentials in production.

## Enable authentication

1. Create GitHub OAuth Apps for local and production. Callback URLs are `http://localhost:4321/api/auth/callback/github` and `https://YOUR-WORKER.workers.dev/api/auth/callback/github`. The app requests `read:user`, `user:email`, and `read:org`. If CaledonInstitute restricts OAuth access, approve this OAuth App in the organization settings.
2. Create a Resend API key and verify an owned sending domain through its DNS records. Set `EMAIL_FROM` to a verified sender, for example `Caledon Forum <forum@YOUR-DOMAIN>`. The forum can run on workers.dev; the sender still requires an owned domain.
3. Create a Turnstile managed widget for the production hostname. Use a separate local widget/test key for localhost. Set the site key and secret key.
4. Generate a strong random `BETTER_AUTH_SECRET` of at least 32 characters. It signs sessions and encrypts GitHub tokens. Keep it stable across deployments and back it up securely.
5. Configure non-secret values in `wrangler.jsonc`: production `SITE_URL`, `EMAIL_FROM`, `TURNSTILE_SITE_KEY`. Store secrets interactively:

```powershell
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

6. Set `AUTH_ENABLED` to `true`, deploy, and complete the provider smoke checks below. Missing configuration keeps sign-in disabled. GitHub users without a verified email must add/verify one in Settings. Connecting GitHub explains that a membership badge publicly reveals affiliation, including private membership.

### Optional Google sign-in

Create a Google OAuth client of type **Web application** in Google Cloud Console and configure the consent screen. Add authorized redirect URIs `http://localhost:4321/api/auth/callback/google` for development and `https://YOUR-WORKER.workers.dev/api/auth/callback/google` for production. Use the actual `SITE_URL` hostname if it differs. During Google's testing phase, add the intended users to the consent screen's test users.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in ignored `.dev.vars` locally. For production:

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Both values must be set to show Google sign-in. Missing Google configuration does not disable existing sign-in methods. Existing accounts are never merged automatically by email: sign in using the existing method, then connect Google in Settings > Email & security. New Google users choose a permanent username in onboarding. Disconnecting the last sign-in method is blocked. Google does not grant a Caledon membership badge.

### Account API

Apply all pending migrations before deploying this version. `0004_api_keys.sql` adds the `api_keys` table; `0005_random_post_addresses.sql` preserves existing post IDs and enables random 19-digit IDs for new posts/replies. `0006_direct_replies_index.sql` adds the index for direct-reply lists and counts without changing existing posts or relations. Existing accounts and sessions remain intact. Local migrations have no effect on production:

```powershell
npx wrangler d1 migrations apply caledon-forum-db --local
# Before production deployment:
npx wrangler d1 migrations apply caledon-forum-db --remote
```

An active account with a username and verified email can generate one key in **Settings > API**. Copy it when generated: the server stores only a SHA-256 hash. Regenerating immediately invalidates the old key; revoking removes access. Keys do not expire automatically. Account suspension or removal of verified status also blocks API access.

Public Swagger UI: `/api/docs`. Downloadable OpenAPI 3.1: `/api/openapi.json`. In Swagger's **Authorize** dialog, paste the full `cfk_...` key without the `Bearer` prefix. Authorization is held in memory and cleared on reload. Documentation assets are served locally; there is no external validator.

Scripts send `Authorization: Bearer YOUR_API_KEY` to `/api/v1`. Cookies cannot replace an API key. The API supports feed/profile reads, profile updates, posts/replies, likes, reports, and notifications; login settings, key management, and administrator moderation stay on the website. IDs in API post routes and `parentId` inputs are the same public decimal IDs used by `/p/<id>`, including individual reply IDs returned by the API. All post IDs in responses (`id`, `rootId`, `parentId`, and notification `postId`) are strings, including legacy short IDs. Always send `parentId` as a string; safe legacy numeric inputs remain accepted, but 19-digit JSON numbers are rejected to prevent precision loss. List responses use `{items, page, hasMore}` with 20 entries per page. Timestamps are Unix milliseconds.

The total limit is 60 requests per minute per account, plus shared website action limits (10 publishes and 40 other mutations per action per minute). Exceeding a limit returns `429` with `Retry-After` in seconds. Clients should wait before retrying; publishing is not idempotent, so do not blindly retry after an uncertain network response. Cross-origin browser access is not enabled. Never include keys in URLs, checked-in scripts, or logs.

Smoke checks: sign in with a new Google account and finish onboarding; connect Google to an existing account; confirm an unlinked Google identity with the same email cannot auto-merge; disconnect one provider while another remains. Generate a key, use Swagger to read `/me` and create a post/reply, regenerate it, and verify the old key returns `401`. Revoke and verify access stops. Real Google credentials and consent configuration must be checked on the deployed origin; the automated OAuth tests use test-only signed tokens and mocked Google token/JWKS transports.

Register the administrator's own account first, find its ID using D1, then run:

```powershell
node scripts/admin.mjs USER_ID --remote
```

Omit `--remote` for a local administrator. Administrator status is independent of GitHub membership.

## Verification

```powershell
npm run check
npm test
npm run test:worker
node scripts/seed-local.mjs
npx playwright install chromium
npm run test:e2e
npm run build
npm audit --omit=dev
npm run test:smoke
```

The browser tests require the background dev server and local fixtures. Screenshots are saved to ignored `artifacts/`. With local authentication configured and enabled, the seed script also creates a local QA session in ignored `.astro/qa-session.json` for composer tests. Without it, the authenticated composer browser test is skipped. Worker regression tests use a separate test-only Worker and D1 database, with mocked email/Turnstile transports. They verify real workerd hashing, sessions, verification/reset tokens, and posting; they do not prove production provider credentials work. The test-only Worker is never deployed.

## Deploy

Set `SITE_URL` to the actual production workers.dev URL before deploying. For local development override it in `.dev.vars`. The bound D1 database is `caledon-forum-db`, separate from other existing databases.

```powershell
npx wrangler d1 migrations apply caledon-forum-db --remote
npm run deploy
```

Smoke checks: home/thread/profile return server HTML; unknown threads return 404; `/robots.txt`, `/sitemap.xml`, `/api/og/site.png` work; external image URLs and YouTube cards render. When authentication is enabled, also test GitHub login, username signup, verification email, password reset, membership refresh, posting, replies, likes, and reports. Test a revoked GitHub permission and ensure forum login still works.

Public feed content is not seeded in production. Account setup is required before the first real thread can be published.

## SEO operations

- Titles, descriptions, absolute canonicals, Open Graph, Twitter Cards, and JSON-LD are server-rendered.
- Thread share images are generated PNGs; a branded static PNG is available as a fallback.
- Verify the workers.dev URL-prefix property in Google Search Console. Put its HTML verification token in `SEARCH_CONSOLE_TOKEN` as a Worker secret, redeploy, and submit `/sitemap.xml`.
- Validate a real published thread with Google's Rich Results Test, inspect HTML without JavaScript, and check social link previews. Rich-result eligibility and ranking depend on the search engine.
- When moving to a custom domain, update SITE_URL, OAuth callbacks, Turnstile hostnames and Search Console; redirect the old origin to avoid duplicate indexable copies.

## Operations

Worker observability is enabled. Avoid logging credentials, OAuth tokens, email links, or post bodies. D1 migrations are additive; review future migrations before applying remotely. Use `wrangler deployments list` to identify the previous version and `wrangler rollback VERSION_ID` to redeploy it if necessary. Worker rollback does not undo database migrations.

Implementation details and security invariants: [docs/architecture.md](architecture.md).
