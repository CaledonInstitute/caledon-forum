import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { username, captcha } from "better-auth/plugins";
import * as schema from "../db/schema";
import { stagePasswordVault, reconcileVault } from "./dm-vault";
import { createAuthMiddleware } from "better-auth/api";
import { run } from "./db";
import { isValidUsername } from "./usernames";
export function authReady() {
  return (
    env.AUTH_ENABLED === "true" &&
    !!(env.BETTER_AUTH_SECRET && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.RESEND_API_KEY && env.EMAIL_FROM && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY)
  );
}
export function googleReady() {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
async function email(to: string, url: string, purpose: string) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Email is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject: `${purpose} — Caledon Forum`,
      text: `${purpose}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
    }),
  });
  if (!response.ok) throw new Error("Email could not be sent. Please try again.");
}
let cachedAuth: ReturnType<typeof buildAuth> | undefined;
let cachedConfiguration = "";
export function createAuth() {
  const configuration = JSON.stringify([
    env.SITE_URL,
    env.BETTER_AUTH_SECRET,
    env.GITHUB_CLIENT_ID,
    env.GITHUB_CLIENT_SECRET,
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.TURNSTILE_SECRET_KEY,
  ]);
  if (!cachedAuth || configuration !== cachedConfiguration) {
    cachedAuth = buildAuth();
    cachedConfiguration = configuration;
  }
  return cachedAuth;
}
function buildAuth() {
  if (!env.BETTER_AUTH_SECRET) throw new Error("Authentication is not configured.");
  return betterAuth({
    appName: "Caledon Forum",
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite", schema, transaction: false }),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/reset-password") {
          const token = ctx.body?.token || ctx.query?.token;
          if (token) {
            const record = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
            if (record && record.expiresAt > new Date()) (ctx.context as any).dmResetUser = record.value;
          }
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => email(user.email, url, "Reset your password"),
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => email(user.email, url, "Verify your email"),
    },
    user: {
      changeEmail: { enabled: true },
      additionalFields: {
        bio: { type: "string", defaultValue: "", input: false },
        role: { type: "string", defaultValue: "user", input: false },
        suspended: { type: "boolean", defaultValue: false, input: false },
      },
    },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true, allowUnlinkingAll: false } },
    socialProviders: {
      ...(googleReady() ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } } : {}),
      github: {
        clientId: env.GITHUB_CLIENT_ID || "",
        clientSecret: env.GITHUB_CLIENT_SECRET || "",
        scope: ["read:org"],
        getUserInfo: async (tokens) => {
          const headers = { Authorization: `Bearer ${tokens.accessToken}`, "User-Agent": "CaledonForum", Accept: "application/vnd.github+json" };
          const [pr, er] = await Promise.all([
            fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(5000) }),
            fetch("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(5000) }),
          ]);
          if (!pr.ok) return null;
          const profile = (await pr.json()) as any;
          const emails = er.ok ? ((await er.json()) as any[]) : [];
          const selected = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails.find((e) => e.primary);
          return {
            user: {
              name: profile.name || profile.login,
              email: selected?.email || `github-${profile.id}@unverified.caledon.invalid`,
              emailVerified: !!selected?.verified,
              image: profile.avatar_url,
            },
            data: profile,
          };
        },
      },
    },
    plugins: [
      username({ immutableUsername: true, minUsernameLength: 1, maxUsernameLength: 30, usernameValidator: isValidUsername }),
      ...(env.TURNSTILE_SECRET_KEY
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: env.TURNSTILE_SECRET_KEY,
              allowedHostnames: [new URL(env.SITE_URL).hostname],
              endpoints: ["/sign-up/email", "/sign-in/username", "/sign-in/email", "/request-password-reset", "/send-verification-email", "/change-email"],
            }),
          ]
        : []),
    ],
    rateLimit: { enabled: false }, // Persistent D1 rate limiting is applied before the auth handler.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      account: {
        update: {
          before: async (account, ctx) => {
            if (!account.password || !ctx) return;
            const reset = ctx.path === "/reset-password";
            const userId = reset ? (ctx.context as any).dmResetUser : ctx.context.session?.user.id;
            if (!userId) throw new Error("Unable to coordinate password and message keys.");
            const header = ctx.headers?.get("x-dm-vault");
            await stagePasswordVault(userId, account.password, header ? JSON.parse(header) : undefined, reset);
          },
          after: async (account) => {
            if (account.userId && account.password) await reconcileVault(account.userId);
          },
        },
      },
      session: {
        create: {
          after: async (s) => {
            await run("UPDATE memberships SET checked_at=0,retry_after=0 WHERE user_id=?", s.userId);
          },
        },
      },
    },
  });
}
