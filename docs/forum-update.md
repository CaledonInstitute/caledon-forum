# Forum update: content, community and marketplace

The visual composer supports formatted text, tables, code languages, LaTeX, mentions, images and inline file blocks. It has no source editor. DM continues to use its existing encrypted text composer.

## Storage and compatibility

`0017_forum_update.sql` preserves existing `posts.body` in `original_body`, sets `legacy_readonly=1` on rows present at cutover, and adds a versioned `editor_doc`. Posts created later default to editable. Public IDs, timestamps, reply relationships and interaction rows are unchanged. Deleted content clears its source backup and document as well as its public body.

The browser sends `{document: {version: 1, doc}, attachmentIds, parentId?}`. The server validates the schema and creates the compatible `body`; a competing client `body` cannot override the document. Existing API clients can continue sending Markdown/HTML in `body`. Supported Markdown is imported into the visual document; unsupported API formatting is retained as an atomic imported block. That block can be removed or surrounded with editable content, but does not expose an HTML source editor. All displayed imports still pass through the existing sanitizer and validated media proxy.

Legacy content cannot be edited through either UI or API (HTTP 409); deletion still works. API v1 includes `editable` and supports `tab=reposts` and `tab=media`. Likes means items liked by the profile owner. Media counts distinct original posts/replies with image/video uploads, validated external image previews, or YouTube previews; it excludes PDF/audio and decorative link thumbnails.

Maintenance processes up to 20 legacy documents per minute. Each conversion uses a conditional update and changes no timestamps or notifications. Unsupported legacy sources receive a fallback marker and keep their original renderer. Re-running maintenance neither duplicates documents nor repeatedly retries unsupported sources.

## Local validation and release

1. Back up D1 before applying production migrations. Inspect whether an existing account uses the newly reserved username `marketplace` before enabling that route; resolve a collision explicitly before release.
2. Apply `0017_forum_update.sql` and `0018_marketplace_photo_guards.sql` to a local/restored copy first. Check legacy rendering and edit rejection. `tests/forum-update.test.ts` also applies the cutover to an independent pre-migration database and checks source, timestamps, addresses and likes.
3. Run `npm run check`, `npm test`, `npm run test:worker`, and `npm run build`.
4. Run `node scripts/test-browser-local.mjs tests/browser/forum-update.spec.ts tests/browser/screenshot.spec.ts tests/browser/repost-updates.spec.ts tests/browser/publish-in-place.spec.ts tests/browser/profile-formatting.spec.ts tests/browser/inline-uploads.spec.ts tests/browser/uploads.spec.ts`. The helper uses only the local D1 database, temporarily supplies local configuration, restores it afterwards, and starts Astro with `dev --background`. Screenshots are written to ignored `artifacts/`.
5. After review, apply migrations before deploying the new code. Keep the D1 backup and `original_body`; do not drop the legacy renderer. Let scheduled maintenance backfill documents and inspect progress with the queries below. No production migration or deployment is performed by local validation.

```sql
SELECT COUNT(*) AS pending FROM posts
 WHERE legacy_readonly=1 AND editor_doc IS NULL AND deleted=0;
SELECT COUNT(*) AS legacy_fallback FROM posts
 WHERE legacy_readonly=1 AND json_extract(editor_doc,'$.legacy')=1;
SELECT COUNT(*) AS converted FROM posts
 WHERE legacy_readonly=1 AND json_extract(editor_doc,'$.doc.type')='doc';
```

If a release needs rollback, retain the additive columns and original bodies, stop the backfill, and restore the previous application build. Do not reverse user writes or overwrite `body` from backups. Content written through the visual editor has a compatible body for the previous renderer. Reconcile old-server edit access before accepting writes, since the previous application does not enforce `legacy_readonly`.

## User-visible behavior

- One Home announcement can be pinned by an administrator; replacement is atomic, removal is automatic on post deletion, and pin/unpin actions are audited. It appears only on the first feed page and is removed from that page's ordinary cards without breaking pagination.
- Repost has its own count and toggle. Share contains DM, quote, copy link and screenshot. Only successful clipboard link copies increment the separate legacy share metric; opening the menu does not increment it.
- Screenshots are 1080 px wide, with the first image full-width and uncropped. Their height follows the image ratio and text excerpt. Exports above 16,384 px fail explicitly instead of cropping or silently dropping the image. OG remains 1200 × 630, fits media without distortion and has a new cache revision. Real italic font faces are bundled for image exports; browser text permits italic synthesis.
- PDF.js loads only when Read PDF is selected. The full-screen reader provides selectable text, page controls, zoom and download/direct-open recovery. Only post attachments use it; existing file access checks and the 20 MB PDF limit remain.
- Marketplace is separate from the feed. All eligible verified accounts can publish goods or services after activating DM. Listings use IDR, free/negotiable pricing, optional location, up to four images, and active/closed status. Contact opens a DM draft with a listing link; it never sends a message automatically. Listings, reports and moderation use same-origin authenticated endpoints under `/api/marketplace/`.
- Marketplace photos participate in public file access, cleanup, account deletion and atomic exclusivity checks. They cannot simultaneously belong to a post or another listing. Reports have a separate admin tab; resolution and admin removal are audited.

Feed ranking, in-site payment, orders, reviews, disputes and PDF reading in DM are outside this release.
