# Caledon Forum

A public forum for Caledon Institute, built with Astro, React, and Cloudflare Workers.

- Markdown and sanitized HTML posts and replies up to 25,000 characters each, with language-specific code highlighting and LaTeX math.
- Public profile locations and Likes tabs, profile composers, and link-copy share counts.
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

## Post formatting

Use Markdown or basic HTML (including tables and details). Scripts, event handlers, unsafe links, and embeds are removed. Images use the existing validated proxy.

Specify a language on fenced code blocks, for example `python`, `javascript`, or `rust`. Unknown languages and unlabelled blocks remain plain code. Use `$E = mc^2$` for inline LaTeX and `$$` on separate lines around display equations. Preview uses the same renderer as published content. KaTeX runs without trusted HTML commands.

Shares count successful link copies recorded by the server, including anonymous copies. They do not measure link visits or unique recipients.

Views count each GET of an active post or reply detail page, including refreshes, anonymous visitors, authors, and bots. Feed, profile, API, preview-image, and HEAD requests do not add views. Counts start at zero when migration `0008_post_views.sql` is applied; apply migrations before deploying the updated application.
