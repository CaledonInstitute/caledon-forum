# Caledon Forum

A public forum for Caledon Institute, built with Astro, React, and Cloudflare Workers.

- Markdown posts and replies up to 25,000 characters each.
- External images, link previews, and click-to-play YouTube. No image uploads.
- GitHub, optional Google, or username/password login, with verified-member badges.
- Account API keys, a versioned REST API, and public Swagger docs at `/api/docs`.
- Likes, notifications, search, reports, and admin moderation.
- Server-rendered pages, Open Graph, Twitter Cards, and structured data.

Profiles live at `/username`; posts at `/p/<id>`. New post IDs have exactly 19 random digits; existing post URLs are preserved.

## Development

Requires Node.js 22.23.4+.

```sh
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply caledon-forum-db --local
npm run dev
```

Open http://localhost:4321. The dev server runs in the background; use `npx astro dev stop` to stop it.

Authentication stays disabled until GitHub OAuth, Resend, and Turnstile are configured. Forks should update the Worker name, D1 binding, and site URL in `wrangler.jsonc`.

## Checks

```sh
npm run check
npm test
npm run test:worker
npm run build
```

See [setup and deployment](docs/setup.md) for service configuration and browser tests, or [architecture](docs/architecture.md) for implementation details.

## Contributing

Issues and pull requests are welcome. Keep changes focused and include relevant checks.
