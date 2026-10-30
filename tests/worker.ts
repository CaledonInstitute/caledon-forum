import { env } from "cloudflare:workers";
import sql from "../migrations/0001_forum.sql";
import addressesSql from "../migrations/0002_public_post_addresses.sql";
import coverSql from "../migrations/0003_profile_cover.sql";
import keysSql from "../migrations/0004_api_keys.sql";
import randomAddressesSql from "../migrations/0005_random_post_addresses.sql";
import profileExtrasSql from "../migrations/0007_profile_location_shares.sql";
import directRepliesSql from "../migrations/0006_direct_replies_index.sql";
import viewsSql from "../migrations/0008_post_views.sql";
import mentionsSql from "../migrations/0009_mentions.sql";
import messagingSql from "../migrations/0013_messages_reposts_activity.sql";
import { createIdentity, wrapPrivate, unlockPrivate } from "../src/lib/dm-crypto";
import { dmAction } from "../src/lib/dm-service";
import { markdown } from "../src/lib/markdown";
import { createAuth } from "../src/lib/auth";
import { POST as forum } from "../src/pages/api/forum/[action]";
import { issueKey } from "../src/lib/api-keys";
import { ALL as api } from "../src/pages/api/v1/[...path]";
import { ALL as authGateway } from "../src/pages/api/auth/[...all]";
import { post as readPost, recordPostView } from "../src/lib/db";
export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/push-crypto") {
      const webpush = await import("web-push");
      const vapid = webpush.generateVAPIDKeys();
      const client = webpush.generateVAPIDKeys();
      const details = webpush.generateRequestDetails(
        { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: client.publicKey, auth: "AgICAgICAgICAgICAgICAg" } },
        JSON.stringify({ title: "Test" }),
        { vapidDetails: { subject: "mailto:test@caledon.invalid", publicKey: vapid.publicKey, privateKey: vapid.privateKey } }
      );
      return Response.json({
        encrypted: !!details.body?.byteLength,
        encoding: details.headers["Content-Encoding"],
        vapid: String(details.headers.Authorization).startsWith("vapid "),
      });
    }
    if (new URL(request.url).pathname !== "/run") return new Response(null, { status: 404 });
    const nativeFetch = globalThis.fetch;
    let verifyUrl = "";
    let rejectEmail = false;
    const passed: string[] = [];
    const check = (value: unknown, label: string) => {
      if (!value) throw new Error(label);
      passed.push(label);
    };
    try {
      const signingKeys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, [
        "sign",
        "verify",
      ]);
      const jwk = { ...(await crypto.subtle.exportKey("jwk", signingKeys.publicKey)), kid: "test-google-key", alg: "RS256", use: "sig" };
      const base64 = (bytes: Uint8Array) =>
        btoa(String.fromCharCode(...bytes))
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
      const encode = (value: unknown) => base64(new TextEncoder().encode(JSON.stringify(value)));
      let googleJwt = "";
      // This isolate is test-only. Production never contains this transport stub.
      globalThis.fetch = async (input: any, options?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url === "https://api.resend.com/emails") {
          if (rejectEmail) return Response.json({ message: "Test email rejected" }, { status: 403 });
          const mail = JSON.parse(String(options?.body));
          check(options?.method === "POST" && !!mail.from && mail.to.length === 1 && !!mail.subject, "Resend HTTP payload is valid");
          verifyUrl = String(mail.text).match(/https?:\/\/\S+/)?.[0] || "";
          return Response.json({ id: "test-message-id" });
        }
        if (url.includes("challenges.cloudflare.com/turnstile/")) return Response.json({ success: true, hostname: "localhost" });
        if (url === "https://oauth2.googleapis.com/token")
          return Response.json({ access_token: "test-google-access", id_token: googleJwt, token_type: "Bearer", expires_in: 3600, scope: "openid email profile" });
        if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
        return nativeFetch(input, options);
      };
      const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user'").first();
      if (!table) await env.DB.exec(sql);
      const addresses = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='post_addresses'").first();
      if (!addresses) await env.DB.exec(addressesSql.replace(/^--.*$/gm, "").trim());
      const columns = await env.DB.prepare("PRAGMA table_info(user)").all<{ name: string }>();
      if (!columns.results.some((c) => c.name === "cover_image")) await env.DB.exec(coverSql.replace(/^--.*$/gm, "").trim());
      const keysTable = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").first();
      if (!keysTable) await env.DB.exec(keysSql.replace(/\s+/g, " ").trim());
      const addressColumns = await env.DB.prepare("PRAGMA table_info(post_addresses)").all<{ name: string; type: string }>();
      if (addressColumns.results.find((c) => c.name === "id")?.type !== "TEXT")
        await env.DB.exec(
          randomAddressesSql
            .replace(/^--.*$/gm, "")
            .replace(/\s+/g, " ")
            .trim()
        );
      if (!columns.results.some((c) => c.name === "location")) await env.DB.exec(profileExtrasSql.replace(/\s+/g, " ").trim());
      await env.DB.exec(directRepliesSql.replace(/^--.*$/gm, "").trim());
      const postColumns = await env.DB.prepare("PRAGMA table_info(posts)").all<{ name: string }>();
      if (!postColumns.results.some((c) => c.name === "views")) await env.DB.exec(viewsSql.trim());
      const notificationTable = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name='notifications'").first<{ sql: string }>();
      if (!notificationTable?.sql.includes("'mention'")) await env.DB.exec(mentionsSql.replace(/\s+/g, " ").trim());
      if (!columns.results.some((c) => c.name === "show_activity")) await env.DB.exec(messagingSql.replace(/\s+/g, " ").trim());
      await env.DB.batch(
        [
          "dm_reads",
          "dm_messages",
          "dm_conversations",
          "dm_blocks",
          "dm_vaults",
          "reposts",
          "api_keys",
          "notifications",
          "post_links",
          "likes",
          "reports",
          "moderation_actions",
          "post_addresses",
          "posts",
          "memberships",
          "session",
          "account",
          "verification",
          "user",
          "rate_limits",
          "link_previews",
        ].map((t) => env.DB.prepare(`DELETE FROM ${t}`))
      );
      const auth = createAuth();
      const gateway = (path: string, body: unknown) =>
        authGateway({
          params: { all: path },
          locals: { user: null },
          request: new Request(`http://localhost:8789/api/auth/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", origin: "http://localhost:8789", "x-captcha-response": "test" },
            body: JSON.stringify(body),
          }),
        } as any);
      rejectEmail = true;
      const failedSignup = await gateway("sign-up/email", {
        username: "mailfailure",
        name: "Mail failure",
        email: "mailfailure@caledon.test",
        password: "A-real-test-password-123",
        callbackURL: "/verify",
      });
      check(failedSignup.ok && ((await failedSignup.json()) as any).emailDelivery === "failed", "Signup reports created account separately from rejected verification email");
      check(!!(await env.DB.prepare("SELECT id FROM user WHERE username='mailfailure' AND email_verified=0").first()), "Email failure preserves unverified account for resend");
      const failedResend = await gateway("send-verification-email", { email: "mailfailure@caledon.test", callbackURL: "/verify" });
      check(failedResend.status === 503, "Verification resend exposes email provider failure instead of false success");
      rejectEmail = false;
      const retriedEmail = await gateway("send-verification-email", { email: "mailfailure@caledon.test", callbackURL: "/verify" });
      check(retriedEmail.ok && !!verifyUrl, "Verification delivery can be retried after provider recovery");
      verifyUrl = "";
      const call = (path: string, body: any, cookie = "") =>
        auth.handler(
          new Request(`http://localhost:8789/api/auth/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", origin: "http://localhost:8789", cookie, "x-captcha-response": "test" },
            body: JSON.stringify(body),
          })
        );
      let response = await call("sign-up/email", {
        username: "researcher",
        name: "Researcher",
        email: "researcher@caledon.test",
        password: "A-real-test-password-123",
        callbackURL: "/verify",
      });
      const signup = (await response.json()) as any;
      check(response.ok, `Worker registration: ${response.status}`);
      check(!!verifyUrl, "Verification email dispatched");
      response = await auth.handler(new Request(verifyUrl, { headers: { origin: "http://localhost:8789" } }));
      check(response.status < 400, "Email verification works");
      response = await call("sign-in/username", { username: "researcher", password: "wrong-password" });
      check(!response.ok, "Wrong password rejected");
      response = await call("sign-in/username", { username: "researcher", password: "A-real-test-password-123" });
      check(response.ok, "Worker username login");
      const cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
      check(!!session, "Signed session read from D1");
      const sessionCookie = (response: Response) =>
        response.headers
          .getSetCookie()
          .filter((c) => c.split("=")[0].endsWith("session_token"))
          .at(-1) || "";
      const cookieHeader = (response: Response) =>
        response.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
      const rememberedLogin = await call("sign-in/username", { username: "researcher", password: "A-real-test-password-123", rememberMe: true });
      check(rememberedLogin.ok && /Max-Age=2592000/i.test(sessionCookie(rememberedLogin)), "Remember me persists the password login cookie for 30 days");
      const rememberedSession = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(rememberedLogin) }) });
      check(
        rememberedSession && Math.abs(new Date(rememberedSession.session.expiresAt).getTime() - Date.now() - 30 * 86400000) < 10000,
        "Remembered password session expires in 30 days in D1"
      );
      const temporaryLogin = await call("sign-in/username", { username: "researcher", password: "A-real-test-password-123", rememberMe: false });
      check(temporaryLogin.ok && !/Max-Age=|Expires=/i.test(sessionCookie(temporaryLogin)), "Unchecked remember me uses a browser-session password cookie");
      const temporarySession = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(temporaryLogin) }) });
      check(
        temporarySession && Math.abs(new Date(temporarySession.session.expiresAt).getTime() - Date.now() - 86400000) < 10000,
        "Temporary password session expires in one day in D1"
      );
      const rememberedAgain = await call("sign-in/username", { username: "researcher", password: "A-real-test-password-123", rememberMe: true }, cookieHeader(temporaryLogin));
      check(
        rememberedAgain.ok &&
          /Max-Age=2592000/i.test(sessionCookie(rememberedAgain)) &&
          rememberedAgain.headers.getSetCookie().some((c) => c.includes("dont_remember") && /Max-Age=0/i.test(c)),
        "Remember me clears the previous temporary-session preference"
      );
      const user = { ...signup.user, username: "researcher", emailVerified: true, role: "user", suspended: false };
      const mutate = async (action: string, data: any) =>
        forum({
          params: { action },
          locals: { user },
          request: new Request(`http://localhost:8789/api/forum/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", origin: "http://localhost:8789" },
            body: JSON.stringify(data),
          }),
        } as any);
      response = await mutate("publish", { body: "😀".repeat(25000) });
      const post = (await response.json()) as any;
      check(response.ok, "25,000-character post in Workers");
      check(/^\/p\/[1-9][0-9]{18}$/.test(post.url), "New public post address has exactly 19 random digits");
      const formatted = await markdown("<strong>HTML works</strong>\n\n```python\nprint(42)\n```\n\n$E=mc^2$\n\n$$\n\\frac{1}{3}\n$$");
      check(
        formatted.includes("<strong>HTML works</strong>") && formatted.includes("hljs") && formatted.includes("katex-display"),
        "Worker renders HTML, highlighted code and LaTeX"
      );
      response = await mutate("profile", { name: "Researcher", bio: "", location: "Jakarta" });
      check(response.ok, "Worker saves profile location");
      response = await mutate("share", { id: post.id });
      check(response.ok && ((await response.json()) as any).shares === 1, "Worker increments share count");
      const viewed = (await readPost(post.id))!;
      check(viewed.views === 0, "Worker initializes views to zero");
      await Promise.all(Array.from({ length: 12 }, () => recordPostView({ ...viewed }, "GET")));
      check((await readPost(post.id))?.views === 12, "Worker counts concurrent views atomically");
      await recordPostView(viewed, "HEAD");
      check((await readPost(post.id))?.views === 12, "Worker HEAD does not add a view");
      const id = post.id;
      response = await mutate("publish", { body: "x".repeat(25000), parentId: id });
      check(response.ok, "25,000-character reply in Workers");
      response = await mutate("publish", { body: "x".repeat(25001) });
      check(response.status === 400, "Worker rejects oversized posts");
      response = await call("request-password-reset", { email: "researcher@caledon.test", redirectTo: "/reset-password" });
      check(response.ok, "Password reset email dispatched");
      const resetToken = new URL(verifyUrl).pathname.split("/").pop();
      response = await call("reset-password", { token: resetToken, newPassword: "A-new-test-password-456" });
      check(response.ok, "Password reset works");
      response = await call("reset-password", { token: resetToken, newPassword: "Another-test-password-789" });
      check(!response.ok, "Reset token cannot be reused");
      response = await call("sign-in/username", { username: "researcher", password: "A-new-test-password-456" });
      check(response.ok, "New password works");
      response = await call("sign-up/email", { username: "z", name: "Short username", email: "short@caledon.test", password: "A-real-test-password-123", callbackURL: "/verify" });
      check(response.ok, "Registration accepts a one-character username");
      response = await call("sign-up/email", {
        username: "1z",
        name: "Invalid username",
        email: "invalid@caledon.test",
        password: "A-real-test-password-123",
        callbackURL: "/verify",
      });
      check(!response.ok, "Registration rejects usernames starting with a number");
      // Exercise Google's real OAuth state, signed ID token validation, and D1 linking
      // with test-only token/JWKS transports. No production provider calls are made.
      const oauth = async (email: string, subject: string, linkCookie = "", invalidState = false, rememberMe?: boolean) => {
        const initiated = await call(
          linkCookie ? "link-social" : "sign-in/social",
          { provider: "google", callbackURL: "/onboarding", errorCallbackURL: "/login", ...(rememberMe === undefined ? {} : { additionalData: { rememberMe } }) },
          linkCookie
        );
        check(initiated.ok, "Google OAuth initiation");
        const authorization = new URL(((await initiated.json()) as any).url);
        check(authorization.searchParams.get("redirect_uri") === "http://localhost:8789/api/auth/callback/google", "Google callback URI");
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          iss: "https://accounts.google.com",
          aud: "test-google",
          sub: subject,
          email,
          email_verified: true,
          name: "Google Test",
          iat: now,
          exp: now + 3600,
          ...(authorization.searchParams.get("nonce") ? { nonce: authorization.searchParams.get("nonce") } : {}),
        };
        const unsigned = `${encode({ alg: "RS256", kid: "test-google-key", typ: "JWT" })}.${encode(payload)}`;
        googleJwt = `${unsigned}.${base64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKeys.privateKey, new TextEncoder().encode(unsigned))))}`;
        const stateCookie = initiated.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        return auth.handler(
          new Request(
            `http://localhost:8789/api/auth/callback/google?code=test-code&state=${encodeURIComponent(invalidState ? "invalid-test-state" : authorization.searchParams.get("state")!)}`,
            { headers: { origin: "http://localhost:8789", cookie: [linkCookie, stateCookie].filter(Boolean).join("; ") } }
          )
        );
      };
      response = await oauth("google-new@caledon.test", "new-google-subject");
      check(response.status === 302 && response.headers.get("location")?.endsWith("/onboarding"), "Google new-user onboarding redirect");
      const googleCookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const googleSession = await auth.api.getSession({ headers: new Headers({ cookie: googleCookie }) });
      check(!!googleSession && googleSession.user.emailVerified && !googleSession.user.username, "Verified Google user awaits username");
      const temporaryGoogle = await oauth("google-new@caledon.test", "new-google-subject", "", false, false);
      check(
        temporaryGoogle.status === 302 && !!sessionCookie(temporaryGoogle) && !/Max-Age=|Expires=/i.test(sessionCookie(temporaryGoogle)),
        "Unchecked remember me uses a browser-session Google cookie"
      );
      const temporaryGoogleSession = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(temporaryGoogle) }) });
      check(
        temporaryGoogleSession && Math.abs(new Date(temporaryGoogleSession.session.expiresAt).getTime() - Date.now() - 86400000) < 10000,
        "Temporary Google session expires in one day in D1"
      );
      const rememberedGoogle = await oauth("google-new@caledon.test", "new-google-subject", "", false, true);
      check(rememberedGoogle.status === 302 && /Max-Age=2592000/i.test(sessionCookie(rememberedGoogle)), "Remember me persists the Google login cookie for 30 days");
      const rememberedGoogleSession = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(rememberedGoogle) }) });
      check(
        rememberedGoogleSession && Math.abs(new Date(rememberedGoogleSession.session.expiresAt).getTime() - Date.now() - 30 * 86400000) < 10000,
        "Remembered Google session expires in 30 days in D1"
      );
      response = await oauth("forged@caledon.test", "forged-google-subject", "", true);
      check(response.headers.get("location")?.includes("error="), "Google rejects invalid OAuth state");
      check(!(await env.DB.prepare("SELECT id FROM user WHERE email='forged@caledon.test'").first()), "Invalid OAuth state creates no account");
      response = await oauth("researcher@caledon.test", "existing-google-subject");
      check(response.headers.get("location")?.includes("account_not_linked"), "Google does not implicitly merge an existing email");
      // Password reset revoked the earlier browser cookie; use a fresh session for linking.
      response = await call("sign-in/username", { username: "researcher", password: "A-new-test-password-456" });
      const existingCookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      response = await oauth("researcher@caledon.test", "existing-google-subject", existingCookie);
      check(response.status === 302 && !response.headers.get("location")?.includes("error="), "Explicit Google linking succeeds");
      const linked = await env.DB.prepare("SELECT user_id FROM account WHERE provider_id='google' AND account_id='existing-google-subject'").first<{ user_id: string }>();
      check(linked?.user_id === user.id, "Google links to the authenticated existing user");
      const unlink = async (viewer: any, providerId: string) =>
        authGateway({
          params: { all: "unlink-account" },
          locals: { user: viewer },
          request: new Request("http://localhost:8789/api/auth/unlink-account", {
            method: "POST",
            headers: { origin: "http://localhost:8789", "Content-Type": "application/json" },
            body: JSON.stringify({ providerId }),
          }),
        } as any);
      check((await unlink(user, "google")).ok, "Worker/D1 explicitly disconnects Google");
      check((await unlink({ ...user, id: googleSession!.user.id }, "google")).status === 400, "Worker/D1 protects the last social login");
      let passwordAttempt = 0;
      const setPassword = (cookie: string, viewer: any, newPassword: string, origin = "http://localhost:8789") =>
        authGateway({
          params: { all: "set-password" },
          locals: { user: viewer },
          request: new Request("http://localhost:8789/api/auth/set-password", {
            method: "POST",
            headers: { origin, cookie, "Content-Type": "application/json", "cf-connecting-ip": `192.0.2.${++passwordAttempt}` },
            body: JSON.stringify({ newPassword }),
          }),
        } as any);
      const googleUser = googleSession!.user;
      check((await setPassword("", null, "Social-password-12345")).status === 401, "Set password requires a signed-in user");
      check((await setPassword("", googleUser, "Social-password-12345")).status === 401, "Set password validates the actual session cookie");
      check((await setPassword(googleCookie, googleUser, "Social-password-12345", "https://attacker.invalid")).status === 403, "Set password rejects cross-origin requests");
      check((await setPassword(googleCookie, { ...googleUser, suspended: true }, "Social-password-12345")).status === 403, "Suspended users cannot set a password");
      check((await setPassword(googleCookie, googleUser, "short")).status === 400, "Set password enforces the minimum length");
      check((await setPassword(googleCookie, googleUser, "x".repeat(129))).status === 400, "Set password enforces the maximum length");
      await env.DB.prepare("UPDATE session SET created_at=? WHERE user_id=?")
        .bind(Date.now() - 2 * 86400000, googleUser.id)
        .run();
      check((await setPassword(googleCookie, googleUser, "Social-password-12345")).status === 403, "Set password rejects stale sessions");
      await env.DB.prepare("UPDATE session SET created_at=? WHERE user_id=?").bind(Date.now(), googleUser.id).run();
      verifyUrl = "";
      check((await setPassword(googleCookie, googleUser, "Social-password-12345")).ok, "Social user sets a password directly through the gateway");
      check(!verifyUrl, "Setting the first password sends no recovery email");
      check((await setPassword(googleCookie, googleUser, "Replacement-password-12345")).status === 400, "Set password cannot overwrite an existing password");
      await env.DB.prepare("UPDATE user SET username='googleuser',display_username='googleuser' WHERE id=?").bind(googleUser.id).run();
      check((await call("sign-in/username", { username: "googleuser", password: "Social-password-12345" })).ok, "Social user can sign in using the new password");
      const key = await issueKey(user.id);
      const apiCall = (token: string) =>
        api({ params: { path: "me" }, locals: { user: null }, request: new Request("http://localhost:8789/api/v1/me", { headers: { Authorization: `Bearer ${token}` } }) } as any);
      response = await apiCall(key.key);
      check(response.ok, "Worker/D1 Bearer key authentication");
      const replacement = await issueKey(user.id, true);
      check((await apiCall(key.key)).status === 401, "Worker rejects rotated key");
      check((await apiCall(replacement.key)).ok, "Worker accepts regenerated key");
      const dm = await createIdentity(user.id, 1, "A-new-test-password-456");
      await dmAction(user, "vault", { password: "A-new-test-password-456", version: 1, publicKey: dm.identity.publicKey, vault: dm.vault }, true);
      const rewrapped = await wrapPrivate(dm.identity.privateKey, "Changed-password-with-DM-123");
      response = await auth.handler(
        new Request("http://localhost:8789/api/auth/change-password", {
          method: "POST",
          headers: { origin: "http://localhost:8789", cookie: existingCookie, "Content-Type": "application/json", "x-dm-vault": JSON.stringify(rewrapped) },
          body: JSON.stringify({ currentPassword: "A-new-test-password-456", newPassword: "Changed-password-with-DM-123", revokeOtherSessions: false }),
        })
      );
      check(response.ok, `Password change preserves DM vault: ${response.status}`);
      const changed = (await dmAction(user, "vault", {}, false)) as any;
      check(
        JSON.stringify(await crypto.subtle.exportKey("jwk", await unlockPrivate(changed.vault, "Changed-password-with-DM-123"))) ===
          JSON.stringify(await crypto.subtle.exportKey("jwk", dm.identity.privateKey)),
        "Changed password unlocks original private key"
      );
      response = await call("request-password-reset", { email: "researcher@caledon.test", redirectTo: "/reset-password" });
      check(response.ok, "DM reset email requested");
      const dmResetToken = new URL(verifyUrl).pathname.split("/").pop();
      response = await call("reset-password", { token: dmResetToken, newPassword: "Reset-password-with-new-DM-456" });
      check(response.ok, `Password reset with active DM: ${response.status}`);
      const reset = (await dmAction(user, "vault", {}, false)) as any;
      check(reset.version === 2 && reset.vault === null && reset.publicKey === null, "Password reset invalidates previous DM key");
      return Response.json({ passed });
    } catch (error) {
      return Response.json({ passed, error: error instanceof Error ? error.message : "Worker test failed" }, { status: 500 });
    } finally {
      globalThis.fetch = nativeFetch;
    }
  },
};
