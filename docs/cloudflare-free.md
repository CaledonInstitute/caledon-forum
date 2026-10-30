# Cloudflare Free operations

The forum uses Workers, D1, SQLite Durable Objects, KV, Queues, Cron, Workers Logs, Turnstile, and Web Analytics. It does not provision R2 or enable paid subscriptions. Free allocations are shared with other applications in the account; application budgets do not guarantee account-wide availability.

## Hybrid rendering and 1102

Public HTML contains escaped text, authors, dates, permalinks, pagination, SEO metadata, and structured data. The browser progressively adds sanitized Markdown/HTML, highlighting, KaTeX, images, and current quote cards for visible posts. Composer previews use that same browser renderer. Without JavaScript, post text remains readable. Quote cards require JavaScript and do not recursively expand.

Media metadata is batched per page. Read endpoints do not import the rich renderer. D1 is read on navigation, so there is no stale server HTML-fragment cache containing deleted quotes or another viewer's likes. Renderer configuration, date formatters, and trusted packaged SVG strings are reused. The authenticated composer mounts in the browser.

`SERVER_DO_ENABLED=true` forwards remaining Astro HTML and API work to 16 stateless SQLite Durable Object instances. Measurements showed even the lightweight Astro shell could exceed the front Worker's 10 ms CPU allowance; these objects have the Free Durable Object CPU allowance instead. Rich formatting still runs in the browser. WebSocket upgrades go directly to the hibernating control object after server-side session validation, so an idle socket does not keep a page object active. Cron work uses a separate maintenance object. Requests and duration consume the account's shared Free Durable Object allocations. Internal service routes are blocked at the public entry point. The profiling script distinguishes forwarded page requests using an internal header; this is a measurement marker, never an authorization signal.

`STATIC_OG_ENABLED=true` serves the packaged 1200×630 PNG. The optional Satori/Resvg renderer remains available but should not be assumed safe under Free CPU limits. Page title/description metadata stays dynamic.

On 2026-10-30, initial production probes repeatedly ended in `exceededCpu` around 10–12 ms; the first 24-hour aggregate contained 33 `exceededResources` requests. An isolated Cloudflare probe measured 20 rich cards at approximately 123–303 ms CPU and a formatted 25,000-character detail at approximately 815 ms. These are render-only samples, not end-to-end percentiles.

After hybrid rendering and the page-object guard, the same public home/profile/detail/card probe completed 41/41 HTTP requests with status 200. Live tail captured 23 front-Worker invocations at 1–3 ms CPU, with no error outcomes among 65 captured events. Page-object CPU was 2–44 ms. This is a bounded anonymous production sample, not a guarantee for every workload or a production sign-in benchmark. Authenticated behavior and the 25,000-character format fixtures are also covered locally. Realtime, presence, and push use independent flags after these read-path checks.

Run `node scripts/profile-production.mjs LABEL --repeat=10` for anonymous HTTP probes and available CPU/outcome samples in ignored `artifacts/production-LABEL.json`. No credentials, request bodies, query strings, or console logs are retained. Tail may sample/drop events, so HTTP counts and CPU sample counts differ. `node scripts/cloudflare-metrics.mjs` reads aggregate metrics using Wrangler credentials without printing them. GraphQL CPU values are microseconds; live tail uses milliseconds. Some account APIs require permissions beyond Wrangler OAuth.

## Realtime and presence

`REALTIME_ENABLED`, `PRESENCE_ENABLED`, and `PUSH_ENABLED` are independent switches. `RATE_LIMIT_DO_ENABLED=true` moves existing action limits into SQLite; outages reject protected mutations with 503. The legacy D1 limiter remains available for rollback.

The global control object accepts 100 WebSockets, five per IP, and 5,000 handshakes/day, using Hibernation and serialized attachments. Visible tabs heartbeat every 30 seconds; presence expires after 60 seconds. Hidden tabs disconnect. Any visible authenticated tab/device keeps an account online. Push subscription alone does not mean online. Watch only visible avatars; store no last-seen history. Unchanged presence maps are not retransmitted. Unknown status is gray and labelled unavailable; online/offline is green/gray with accessible labels.

Mutation signals coalesce over ten seconds. On signals/reconnect, browsers resynchronize visible counters, current viewer likes, and unread notifications from D1. Edits/deletions refresh affected content. New posts/replies use a load-updates button; numeric pagination remains server-owned. No background polling. Reconnection backs off with jitter and stops after repeated failures or budget/session rejection.

Outgoing events, including presence, are limited to 20,000/day. At the limit, sockets close and manual refresh remains available. Daily budgets reset at UTC midnight (07:00 WIB); a stopped browser resumes after a page reload.

## Browser push

Open **Settings → Email & security → Browser notifications**. Permission is requested only after Enable. Replies, mentions, and likes default on; preferences apply across the account. Disable removes the current device. Subscription ownership is checked server-side. An HTTP-only device cookie detaches that subscription after successful sign-out; switching accounts cannot silently reassign another account's subscription.

`node scripts/setup-push.mjs` creates missing VAPID secrets through Wrangler stdin, never console or tracked files. Existing pairs are preserved because rotation invalidates subscriptions. The public key is returned to signed-in users configuring push. The subject is the public privacy-page URL.

A D1 trigger atomically creates notification outbox entries. Cron dispatches once per minute, so delivery can lag by about a minute plus provider delay. Queue messages contain IDs only. Consumers delegate encryption/provider requests to separate Durable Object instances to avoid a 10 ms cryptography invocation. Recheck ownership, preferences, suspension, read/deleted state, and expiry before sending. Do not replay notifications created before subscription.

Budgets: three devices/account; 100 distinct notifications/account/day; 1,000 provider attempts/day including retries; 1,000 queue enqueues/day; three attempts/delivery; 24-hour expiry. Queue batch size is one, with two retries. HTTP 404/410 removes a subscription. Claims prevent concurrent duplicates; notification tags replace duplicates after ambiguous failures. Web Push cannot guarantee exactly-once delivery. The outbox survives queue outages.

Only supported HTTPS push-service hosts and bounded keys/payloads are accepted. Mutations require same origin. Push text is generic; post bodies are not sent to lock screens. Click URLs stay on the forum. On iOS/iPadOS, use the installed Home Screen web app. Actual OS delivery depends on browser permission, device settings, connectivity, and support.

## Cache, monitoring, and rollout

KV optionally shares public link metadata for 24 hours, with 500 writes/day. D1 stays authoritative. Never use KV for sessions, revoked API keys, permissions, or presence. Cache failures fall back to D1/validated fetches. Analytics uses the public `WEB_ANALYTICS_TOKEN`; Workers Logs are enabled. Never log credentials, email links, push endpoints/keys, or private notification bodies.

Apply D1 migrations before deployment. `0009_mentions.sql` must precede push migrations because it rebuilds notifications. Queue: `caledon-forum-push`. Durable Objects use SQLite migrations. Forks must replace account-specific D1/KV IDs. Worker rollback does not undo D1 or namespace migrations.

Checks: `npm run check`, `npm test`, `npm run test:worker`, `npm run build`. `node scripts/test-live-local.mjs tests/browser/live.spec.ts tests/browser/push.spec.ts tests/browser/hybrid.spec.ts` temporarily enables local live flags/test keys, runs browser tests, restores `.dev.vars`, and restarts the background server without printing secrets. UI tests simulate permission/subscription; Worker tests check real encryption and VAPID signing without external delivery. Verify OS delivery separately on an opted-in device.

Set `EXPECT_STATIC_OG=true` for `npm run test:smoke`. Enable live flags only after read-path checks. Disable realtime, presence, or push independently when quotas or incidents require it.
