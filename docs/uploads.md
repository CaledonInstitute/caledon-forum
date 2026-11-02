# Uploads and account deletion

Migration `0015_uploads_account_deletion.sql` adds uploads, attachment references and account-deletion jobs. Apply migrations before running this version. The old external-link-only restriction is superseded; existing image URLs still work.

## Backblaze configuration

Create a **private** bucket and a bucket-restricted S3-compatible application key with `listFiles`, `readFiles`, `writeFiles`, and `deleteFiles`. Do not use the master application key. Configure:

```dotenv
UPLOADS_ENABLED=true
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_BUCKET=your-bucket-name
B2_ACCESS_KEY_ID=your-keyID
B2_SECRET_ACCESS_KEY=your-applicationKey
```

Use your bucket's actual endpoint and region. Put development values in ignored `.dev.vars`. Put production credentials in Worker Secrets using `npx wrangler secret put B2_ACCESS_KEY_ID` and `npx wrangler secret put B2_SECRET_ACCESS_KEY`; the endpoint, region, bucket, and enabled flag can be Worker variables. Do not commit credentials. Disabling uploads prevents new transfers while existing downloads and cleanup continue. Missing storage configuration pauses cleanup until credentials are restored.

Set a B2 lifecycle rule to cancel unfinished large/multipart uploads after one day. This also handles a lost initiation response before the application can record the multipart upload ID. Do not configure automatic expiration of current attached objects. Keep Object Lock disabled for this bucket so account deletion can remove files. No bucket CORS rule is required: browsers only contact the same-origin forum Worker.

Local setup:

```powershell
npx wrangler d1 migrations apply caledon-forum-db --local
npm run dev
```

Production activation: apply the migration to the remote database, set configuration/secrets, deploy, then test a small upload, playback, and deletion against the private bucket. A deployment and production migration are separate from local development.

## Behavior and limits

- Profile/cover: JPEG, PNG, GIF, WebP; 2 MiB/file.
- Post/reply/DM: images 10 MiB, PDF/ZIP/TXT 20 MiB, MP4/WebM and MP3/M4A/OGG/WAV 50 MiB. Up to four files / 100 MiB per item. No transcoding; playback depends on browser codec support and downloads remain available.
- No per-account storage quota or daily byte quota. Creation is limited to ten upload sessions/minute and two incomplete sessions per user. Transfers use 5 MiB multipart sections and bounded Worker memory.
- Public uploads require a verified, active browser account. They become public only when saved to a profile or published post/reply. File-only posts/replies and messages are supported. Detached ready drafts expire after 24 hours; explicitly removed published files are marked for cleanup immediately.
- `/api/uploads` creates sessions; `PUT /api/uploads/:id/:part` uploads parts; `POST /api/uploads/:id/complete` verifies completion; `DELETE /api/uploads/:id` cancels unreferenced uploads. All mutations validate the browser session and origin. Uploads do not accept Bearer API keys.
- `/api/files/:id` supports GET/HEAD and single byte ranges. Public responses revalidate in the browser. Internal Cache API chunks live for 24 hours per Cloudflare location; eviction can occur sooner. Every request checks the current D1 state before touching cached bytes. Deleted files cannot be retrieved through the Worker even while old internal chunks await expiry. Cache hits avoid B2 reads; they still invoke the Worker and perform access checks. `X-File-Cache` reports HIT/MISS for the first requested chunk; storage outages return an uncached retryable error.
- B2 object version IDs are retained and deleted explicitly, preventing cleanup from merely creating a hide/delete marker. Cleanup retries storage failures and retains the job until deletion succeeds.

DM attachments are encrypted in the browser with a fresh AES-256-GCM key/IV per file. Names, MIME and keys are placed only inside the existing authenticated HPKE message payload. Upload requests use `encrypted.bin`; storage sees ciphertext, byte length, and conversation linkage. Client-side policy enforces original formats and category sizes; the server can enforce only the encrypted maximum (50 MiB + 16-byte authentication tag), total size, ownership and participants. DM bytes are internally cached as ciphertext only; browser responses are `private, no-store`. Opening a file downloads/decrypts it in full; Blob URLs are revoked when it closes or DM locks. Old encrypted messages remain compatible.

## Account deletion

Settings > Email & security > Delete account creates a 15-minute intent, signs the user out, and requires a new sign-in to the same account. The final confirmation requires the username (or `DELETE` before onboarding) and a session created after the intent, at most five minutes old. OAuth callbacks never delete automatically. The last active administrator cannot delete their account.

Confirmation immediately anonymizes/disables the account, revokes credentials, sessions, API keys, push subscriptions and DM keys, clears authored post text, and denies access to related files. Maintenance then removes dependent data, all DM conversations and attachments for both participants, and B2 versions. Authored posts keep shared “Deleted account” placeholders so other people's replies remain intact. The original user row is removed after storage cleanup completes. Previously downloaded copies cannot be recalled.

Existing once-per-minute maintenance processes bounded conversation/message/file batches. Logs identify deferred file cleanup by random asset ID, without DM contents or credentials. Inspect Worker logs and D1 `account_deletions` / `uploads WHERE state='deleting'` for stalled jobs. Configuration or B2 availability failures leave cleanup retryable.

Browser UI checks can run with `node scripts/test-browser-local.mjs`. This temporarily starts the background server with synthetic local authentication configuration, seeds local QA accounts, runs the upload UI tests, then restores `.dev.vars` and restarts the original server. Pass Playwright file paths as arguments to run additional browser suites. No production services are used.
