# Direct messages

The conversation screen has one header with the participant avatar and a details icon. Incoming bubbles are gray on the left; sent bubbles are Caledon blue on the right, with timestamps outside. Block, fingerprints and Lock DM are accessed through the details panel.

DM v1 supports personal text conversations, encrypted post references, unread counts, blocking and chronological history in batches of 50. Accounts require a username, verified email and active status. Both participants must activate DM. New messages go directly into inbox; groups, attachments, typing, and sender read receipts are excluded.

## Cryptography

The browser creates a random P-256 key pair. HPKE authenticated mode (`@hpke/core`, DHKEM-P256/HKDF-SHA256/AES-256-GCM) creates separate envelopes for sender and recipient. Authenticated context includes protocol, message ID, conversation ID, sender/recipient IDs and both key versions. Each envelope uses a fresh HPKE encapsulation. A server-generated sequence orders messages; a unique client UUID makes retries idempotent. Ciphertext tampering and context changes fail decryption.

The private JWK is encrypted with AES-256-GCM and a fresh 12-byte IV. PBKDF2-HMAC-SHA256 derives the wrapping key from the account password, with a random 16-byte salt and 600,000 iterations. D1 stores the wrapped vault, public key and version, never an unwrapped private key or DM plaintext. Conversation participants, timestamps, counts and ciphertext sizes remain server-visible. Shared-post IDs are encrypted; public post previews are fetched after decryption.

Remember-device stores a non-extractable AES CryptoKey in IndexedDB alongside a separately wrapped private JWK. Passwords are not persisted. Reload validates the authenticated session and current key version before opening local keys. Lock DM/sign-out delete remembered access, broadcast a local lock event, and clear displayed messages. A password reset invalidates the version; cached access is discarded on the next validated refresh. Copies already read or exported by either participant cannot be revoked.

The details panel shows both public-key fingerprints for comparison through another channel. A changed peer fingerprint requires an explicit Trust new key action before sending. This is trust on first use, without a key transparency service. This design has no ratchet/forward secrecy. Because account passwords reach authentication and the server delivers application JavaScript, it does not defend against a deliberately malicious application server recording passwords or replacing code.

## Password lifecycle

Normal password changes unwrap the existing private key in-browser and send a replacement wrapped vault in `x-dm-vault`. A database account-update hook stages that vault with the exact new credential hash before the credential update. Subsequent reads reconcile the journal only when the stored credential hash matches; a lost response or interrupted after-hook does not lose the vault. Concurrent staging is rejected. Uncommitted staging expires after two minutes; sending is blocked while a vault update is pending.

Reset requests stage a reset marker instead. Once the replacement credential is committed, reconciliation clears the old vault/public key and increments its version. Activation creates a fresh pair using that version. Old messages become unavailable for the resetting account; the other participant retains their encrypted copy. OAuth-only accounts first establish a password through verified email recovery. Password reset revokes existing sessions.

## Transport and authorization

`/api/dm/{vault,users,inbox,blocks,conversation,messages,read,send,block}` accepts browser sessions only. Mutations require same-origin JSON. Every conversation operation checks membership; all responses are private/no-store and are excluded from indexing and analytics. Read positions are private and never sent to the other participant. Sending checks current key versions, account eligibility and blocks again in the INSERT. Rate limit: 30 sends/minute/account. Message text is limited to 5,000 Unicode code points in the client and after decryption; the server bounds encrypted envelope sizes.

The existing hibernating control object sends a content-free `dm-refresh` only to validated participant sessions. No DM identifiers/counters appear in public broadcast messages. Visible signed-in tabs poll every 30 seconds only while realtime is disconnected. DM browser push uses the shared durable outbox and delivery queue. Notifications contain only "You have a new direct message." and a conversation link, never names, plaintext or ciphertext. The Direct messages preference defaults on for subscribed devices; messages already read, blocked participants and inactive accounts are rechecked before delivery. Only new messages create push events; expiry, retries and daily quotas match forum push.

## Local verification and rollout

Conversation navigation stays inside the mounted React island with History API support. The inbox and navigation badge share in-flight requests; unchanged rows retain their data references. Drafts remain in memory per conversation and are cleared on lock/logout/key changes. Stale loads cannot replace the selected conversation.

Apply `npx wrangler d1 migrations apply caledon-forum-db --local`, run `node scripts/seed-local.mjs`, and use `npm run dev` (Astro background mode). The seed creates dedicated local-only DM users and signed QA sessions. `tests/dm.test.ts` covers ciphertext, authorization, blocks, stale keys, retries and vault journals. `tests/worker.ts` exercises actual Better Auth password change/reset in workerd. `tests/browser/messages.spec.ts` covers remembered access, another browser, avatars, conversation details, sharing and activity privacy.

Deploy only after applying migrations through 0014 to the intended database and validating the build. No production deployment is performed by local setup or tests.
