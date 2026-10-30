import { useEffect, useRef, useState } from "react";
import { LogOut, RefreshCw } from "lucide-react";
import UserAvatar from "./UserAvatar";
import ApiKeyPanel from "./ApiKeyPanel";
import type { Viewer } from "../lib/types";
declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, options: Record<string, unknown>) => string; reset: (id: string) => void; remove: (id: string) => void };
  }
}
const Github = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03A9.6 9.6 0 0 1 12 6.82c.85 0 1.7.11 2.5.34 1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
  </svg>
);
const Google = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M21.6 12.227c0-.709-.064-1.391-.182-2.045H12v3.868h5.382c-.232 1.25-.936 2.309-1.995 3.018v2.509h3.232c1.891-1.741 2.981-4.305 2.981-7.35Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.964-.895 6.618-2.423l-3.232-2.509c-.895.6-2.041.955-3.386.955-2.605 0-4.81-1.759-5.596-4.123H3.064v2.591A9.996 9.996 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.404 13.9A6.01 6.01 0 0 1 6.09 12c0-.66.114-1.302.314-1.9V7.509H3.064A9.996 9.996 0 0 0 2 12c0 1.614.386 3.141 1.064 4.491L6.404 13.9Z" />
    <path
      fill="#EA4335"
      d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C16.959 2.991 14.695 2 12 2a9.996 9.996 0 0 0-8.936 5.509l3.34 2.591C7.19 7.736 9.395 5.977 12 5.977Z"
    />
  </svg>
);
function Challenge({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    let widget: string | undefined;
    let cancelled = false;
    const render = () => {
      if (!cancelled && ref.current && window.turnstile)
        widget = window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, "expired-callback": () => onToken("") });
    };
    if (window.turnstile) render();
    else {
      let script = document.querySelector<HTMLScriptElement>("#turnstile-script");
      if (!script) {
        script = document.createElement("script");
        script.id = "turnstile-script";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey]);
  return <div ref={ref} />;
}
async function send(path: string, data: unknown, token?: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-captcha-response": token } : {}) },
    body: JSON.stringify(data),
  });
  const result = (await response.json()) as any;
  if (!response.ok) throw new Error(result.message || result.error || "Unable to complete this action.");
  return result;
}
export default function AccountPanel({
  mode,
  enabled,
  siteKey,
  user,
  hasGithub = false,
  hasPassword = false,
  category = "profile",
  currentEmail,
  googleEnabled = false,
  hasGoogle = false,
}: {
  googleEnabled?: boolean;
  hasGoogle?: boolean;
  category?: "profile" | "github" | "security" | "api";
  currentEmail?: string | null;
  mode: string;
  enabled: boolean;
  siteKey: string;
  user?: Viewer | null;
  hasGithub?: boolean;
  hasPassword?: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [token, setToken] = useState(""),
    [challenge, setChallenge] = useState(0),
    [isProfileAction, setIsProfileAction] = useState(false);
  async function perform(fn: () => Promise<void>, profile = false) {
    setIsProfileAction(profile);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setToken("");
      setChallenge((n) => n + 1);
    }
  }
  async function social(provider: "github" | "google", link = false) {
    await perform(async () => {
      const r = await send(link ? "/api/auth/link-social" : "/api/auth/sign-in/social", {
        provider,
        callbackURL: link ? `/settings?category=${provider === "github" ? "github" : "security"}` : "/onboarding",
        errorCallbackURL: link ? `/settings?category=${provider === "github" ? "github" : "security"}&error=oauth` : "/login?error=oauth",
      });
      if (r.url) location.assign(r.url);
    });
  }
  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || "");
    perform(async () => {
      if (mode === "login") {
        await send("/api/auth/sign-in/username", { username: value("username"), password: value("password") }, token);
        location.assign("/");
      }
      if (mode === "register") {
        await send(
          "/api/auth/sign-up/email",
          { username: value("username"), name: value("name"), email: value("email"), password: value("password"), callbackURL: "/verify" },
          token
        );
        setMessage("Check your inbox to verify your email. Then sign in to join the conversation.");
      }
      if (mode === "forgot-password") {
        await send("/api/auth/request-password-reset", { email: value("email"), redirectTo: "/reset-password" }, token);
        setMessage("If an account matches that email, a reset link is on its way.");
      }
      if (mode === "reset-password") {
        await send("/api/auth/reset-password", { newPassword: value("password"), token: new URL(location.href).searchParams.get("token") });
        setMessage("Password updated. You can now sign in.");
      }
      if (mode === "verify") {
        await send("/api/auth/send-verification-email", { email: value("email"), callbackURL: "/verify" }, token);
        setMessage("Check your inbox for a verification link.");
      }
      if (mode === "onboarding") {
        await send("/api/forum/onboarding", { username: value("username") });
        location.assign("/");
      }
    });
  }
  useEffect(() => {
    const params = new URL(location.href).searchParams;
    if (params.has("error"))
      setError(
        "Unable to connect this sign-in method. If you already have an account with this email, sign in using your existing method, then connect Google or GitHub from Settings."
      );
  }, []);
  const needsCaptcha = !["reset-password", "onboarding", "settings"].includes(mode);
  const guard = busy || !enabled || (needsCaptcha && !token);
  if (mode === "settings")
    return (
      <>
        {category === "api" && <ApiKeyPanel eligible={!!user?.username && !!user?.emailVerified && !user?.suspended && enabled} />}

        {category === "profile" && (
          <section className="settings-group">
            <h2>Your profile</h2>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                perform(async () => {
                  await send("/api/forum/profile", { name: f.get("name"), bio: f.get("bio"), location: f.get("location"), image: f.get("image"), coverImage: f.get("coverImage") });
                  location.reload();
                }, true);
              }}
            >
              <div className="profile-image-field">
                <UserAvatar name={user?.name} username={user?.username} image={user?.image} large />
                <label>
                  Profile image URL
                  <input type="url" name="image" defaultValue={user?.image || ""} maxLength={2048} placeholder="https://" aria-describedby="profile-image-help" />
                  <span className="help" id="profile-image-help">
                    Use a direct HTTPS image link. Leave blank to use your initials.
                  </span>
                </label>
              </div>
              <label>
                Cover photo URL
                <input type="url" name="coverImage" defaultValue={user?.coverImage || ""} maxLength={2048} placeholder="https://" aria-describedby="cover-photo-help" />
                <span className="help" id="cover-photo-help">
                  Use a direct HTTPS link to a JPEG, PNG, GIF, or WebP image (up to 2 MB). A wide image works best. Leave blank to remove your cover photo.
                </span>
              </label>
              <label>
                Username
                <input value={user?.username || ""} readOnly />
                <span className="help">Your username is permanent.</span>
              </label>
              <label>
                Display name
                <input name="name" defaultValue={user?.name} maxLength={80} required />
              </label>
              <label>
                Bio
                <textarea name="bio" defaultValue={user?.bio} maxLength={300} />
              </label>
              <label>
                Location
                <input name="location" defaultValue={user?.location || ""} maxLength={100} placeholder="City, country" />
                <span className="help">Optional. Shown on your public profile.</span>
              </label>
              <p className="error" role="alert">
                {isProfileAction ? error : ""}
              </p>
              <button className="button" disabled={busy || !hydrated}>
                Save profile
              </button>
            </form>
          </section>
        )}
        {category === "github" && (
          <section className="settings-group">
            <h2>GitHub & membership</h2>
            <p>Active CaledonInstitute members receive a bluecheck. This publicly shows your affiliation, including private organization membership.</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {hasGithub ? (
                <>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      perform(async () => {
                        const r = await send("/api/forum/membership", {});
                        setMessage(r.isCaledonMember ? "Membership verified. Your bluecheck is active." : "Your GitHub account is not an active CaledonInstitute member.");
                      })
                    }
                  >
                    <RefreshCw size={15} />
                    Refresh membership
                  </button>
                  {(hasPassword || hasGoogle) && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        perform(async () => {
                          await send("/api/auth/unlink-account", { providerId: "github" });
                          location.reload();
                        })
                      }
                    >
                      Disconnect GitHub
                    </button>
                  )}
                  <button className="text-button" disabled={busy} onClick={() => social("github", true)}>
                    Reconnect GitHub
                  </button>
                </>
              ) : (
                <button className="button secondary" disabled={busy || !enabled} onClick={() => social("github", true)}>
                  <Github size={16} />
                  Connect GitHub
                </button>
              )}
            </div>
          </section>
        )}
        {category === "security" && (
          <section className="settings-group">
            <h2>Email & security</h2>
            {(googleEnabled || hasGoogle) && (
              <div className="form" style={{ marginBottom: 24 }}>
                <h3>Google sign-in</h3>
                <p>Connect Google to sign in to this account. Accounts are never automatically merged by email.</p>
                {hasGoogle ? (
                  <>
                    <p>Google is connected.</p>
                    {(hasPassword || hasGithub) && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          perform(async () => {
                            await send("/api/auth/unlink-account", { providerId: "google" });
                            location.reload();
                          })
                        }
                      >
                        Disconnect Google
                      </button>
                    )}
                    {!hasPassword && !hasGithub && <p className="help">Add another sign-in method before disconnecting Google.</p>}
                  </>
                ) : (
                  <button className="button secondary" disabled={busy || !enabled || !googleEnabled} onClick={() => social("google", true)}>
                    <Google size={18} />
                    Connect Google
                  </button>
                )}
              </div>
            )}
            <div className="current-email">
              <h3>Current email</h3>
              <p>{currentEmail || "No email address added."}</p>
              {currentEmail && <span className="help">{user?.emailVerified ? "Verified" : "Not verified"}</span>}
              {currentEmail && !user?.emailVerified && (
                <p>
                  <a className="text-link" href="/verify">
                    Verify your email
                  </a>
                </p>
              )}
            </div>
            <p>Email is only used for verification and password recovery.</p>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                perform(async () => {
                  await send("/api/forum/email", { email: f.get("email"), token });
                  setMessage("Check your new email address to verify the change.");
                });
              }}
            >
              <label>
                New email address
                <input type="email" name="email" required autoComplete="email" />
              </label>
              <Challenge key={challenge} siteKey={siteKey} onToken={setToken} />
              <button className="button secondary" disabled={busy || !token}>
                Update email
              </button>
            </form>
            {hasPassword ? (
              <form
                className="form"
                style={{ marginTop: 24 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  perform(async () => {
                    await send("/api/auth/change-password", { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword"), revokeOtherSessions: true });
                    setMessage("Password updated. Other sessions were signed out.");
                  });
                }}
              >
                <label>
                  Current password
                  <input type="password" name="currentPassword" autoComplete="current-password" required />
                </label>
                <label>
                  New password
                  <input type="password" name="newPassword" minLength={12} maxLength={128} autoComplete="new-password" required />
                </label>
                <button className="button secondary" disabled={busy}>
                  Change password
                </button>
              </form>
            ) : (
              <p>
                <a className="text-link" href="/forgot-password">
                  Set a password using email recovery
                </a>{" "}
                to secure your account.
              </p>
            )}
          </section>
        )}
        <section className="settings-group">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                await send("/api/auth/sign-out", {});
                location.assign("/");
              })
            }
          >
            <LogOut size={16} />
            Sign out
          </button>
        </section>
        <div className="section-pad" role="status">
          <p className="error">{isProfileAction ? "" : error}</p>
          <p className="success">{message}</p>
        </div>
      </>
    );
  return (
    <div className="auth-panel">
      {!enabled && <div className="notice">Sign-in is not available yet. You can still explore public conversations.</div>}
      {(mode === "login" || mode === "register") && (
        <>
          <div className="social-signin-actions">
            {googleEnabled && (
              <button className="button secondary wide" disabled={busy || !enabled} onClick={() => social("google")}>
                <Google size={18} />
                Continue with Google
              </button>
            )}
            <button className="button secondary wide" disabled={busy || !enabled} onClick={() => social("github")}>
              <Github size={18} />
              Continue with GitHub
            </button>
          </div>
          <p className="small muted" style={{ fontSize: 11, lineHeight: 1.8, marginTop: 12 }}>
            Connecting GitHub checks CaledonInstitute membership. A bluecheck publicly shows your affiliation, including private membership.
          </p>
          <div className="divider">or use your {mode === "login" ? "username" : "email to register"}</div>
        </>
      )}
      {mode === "verify" && (
        <p className="small muted">
          Need to add or change the email associated with GitHub?{" "}
          <a className="text-link" href="/settings?category=security">
            Update your email in Settings
          </a>
          .
        </p>
      )}
      {mode === "verify" && user?.emailVerified ? (
        <div className="notice">
          Your email is verified.{" "}
          <a className="text-link" href="/">
            Return to the feed
          </a>
          .
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          {mode === "register" && (
            <label>
              Display name
              <input name="name" required maxLength={80} autoComplete="name" />
            </label>
          )}
          {["login", "register", "onboarding"].includes(mode) && (
            <label>
              Username
              <input name="username" required minLength={1} maxLength={30} pattern={mode === "login" ? "[A-Za-z0-9_]+" : "[A-Za-z_][A-Za-z0-9_]{0,29}"} autoComplete="username" />
              <span className="help">{mode === "login" ? "" : "1–30 letters, numbers, or underscores. Cannot start with a number. This cannot be changed later."}</span>
            </label>
          )}
          {["register", "forgot-password", "verify"].includes(mode) && (
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
              <span className="help">Only for verification and password recovery.</span>
            </label>
          )}
          {["login", "register", "reset-password"].includes(mode) && (
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={mode === "login" ? 1 : 12}
                maxLength={128}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              {mode !== "login" && <span className="help">At least 12 characters.</span>}
            </label>
          )}
          {needsCaptcha && <Challenge key={challenge} siteKey={siteKey} onToken={setToken} />}
          <button className="button wide" disabled={guard}>
            {busy
              ? "Working…"
              : (
                  {
                    login: "Sign in",
                    register: "Create account",
                    "forgot-password": "Send reset link",
                    "reset-password": "Reset password",
                    verify: "Send verification email",
                    onboarding: "Save username",
                  } as any
                )[mode] || "Continue"}
          </button>
        </form>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <p className="success" role="status">
        {message}
      </p>
      <div className="auth-links">
        <a className="text-link" href={mode === "login" ? "/register" : "/login"}>
          {mode === "login" ? "Create an account" : "Sign in"}
        </a>
        {mode === "login" && (
          <a className="text-link" href="/forgot-password">
            Forgot password?
          </a>
        )}
      </div>
      {mode === "register" && (
        <p className="muted small" style={{ marginTop: 24 }}>
          By joining, you agree to the{" "}
          <a className="text-link" href="/rules">
            community rules
          </a>{" "}
          and{" "}
          <a className="text-link" href="/privacy">
            privacy notice
          </a>
          .
        </p>
      )}
    </div>
  );
}
