# Caledon Forum

A public forum for Caledon Institute, built with Astro, React, and Cloudflare Workers.

- Markdown and sanitized HTML posts and replies up to 25,000 characters each, with language-specific code highlighting and LaTeX math.
- Public profile locations and Likes tabs, profile composers, and link-copy share counts.
- External images, link previews, and click-to-play YouTube. No image uploads.
- GitHub, optional Google, or username/password login, with verified-member badges.
- Account API keys, a versioned REST API, and public Swagger docs at `/api/docs`.
- Likes, notifications, search, reports, and admin moderation.
- @username mentions with keyboard-accessible suggestions, profile links, and notifications.
- New posts and replies appear on the current page without navigation, with a short confirmation toast.
- Paste a Caledon post or reply link to attach a quote card, including a live draft preview.
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

Paste a link to a post or reply on this forum to quote it. The first internal post link becomes a card with the original author, GMT+7 timestamp, and a short excerpt. The card opens the source; its avatar and author name open the profile. Quotes use the current source content and show an unavailable message after deletion. Quotes do not expand recursively, and links inside code or math stay literal.

Type `@` in a post or reply to find a username. Use the arrow keys and Enter to select a person, or Escape to close suggestions. Mentions link to profiles and notify existing users; mentioning yourself does not send a notification. Replies already notify their parent author once. Code, math, email addresses, and existing links are excluded. Apply `0009_mentions.sql` before deploying this feature.

Specify a language on fenced code blocks, for example `python`, `javascript`, or `rust`. Unknown languages and unlabelled blocks remain plain code. Use `$E = mc^2$` for inline LaTeX and `$$` on separate lines around display equations. Preview uses the same renderer as published content. KaTeX runs without trusted HTML commands.

Shares count successful link copies recorded by the server, including anonymous copies. They do not measure link visits or unique recipients.

Views count each GET of an active post or reply detail page, including refreshes, anonymous visitors, authors, and bots. Cards in feeds, profiles, search results, and reply lists also add one view after at least 25% of the card is visible for one continuous second in an active tab. Each card counts once per page load; scrolling away and back does not add another view. Detail posts do not also send a card impression. Reading API data, preview images, and HEAD requests does not add views. Counts start at zero when migration `0008_post_views.sql` is applied; apply migrations before deploying the updated application.
