# Setup and operations

Public, server-rendered conversations for Caledon Institute. Astro + React islands on Cloudflare Workers, D1 + Drizzle, Better Auth, Resend, and Turnstile.

Production: https://caledon-forum.supervoid.workers.dev. Sign-in remains disabled until the external service configuration below is completed.

Each post and reply supports **25,000 Unicode code points** of Markdown. External image URLs render automatically; other URLs receive a metadata card, including click-to-load YouTube. **Image uploads are permanently out of scope.**

Profiles use `/username`; posts use `/p/123` with automatically allocated, non-reused integer IDs. System usernames are reserved at registration and GitHub onboarding. The old `/u/…` and `/thread/…` routes are removed and return 404, without legacy redirects.

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

The browser tests require the background dev server and local fixtures. Screenshots are saved to ignored `artifacts/`. Worker regression tests use a separate test-only Worker and D1 database, with mocked email/Turnstile transports. They verify real workerd hashing, sessions, verification/reset tokens, and posting; they do not prove production provider credentials work. The test-only Worker is never deployed.

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
