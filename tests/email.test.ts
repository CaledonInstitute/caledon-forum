import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "./runtime";
import { authReady } from "../src/lib/auth";
import { emailReady, sendAuthEmail } from "../src/lib/email";

const original = { ...env };
const send = vi.fn();
beforeEach(() => {
  env.AUTH_ENABLED = "true";
  env.TURNSTILE_SECRET_KEY = "test";
  env.RESEND_API_KEY = " re_test-only-key ";
  env.EMAIL_FROM = " Caledon Forum <noreply@hengker.tech> ";
  send.mockReset().mockResolvedValue(Response.json({ id: "test-message-id" }));
  vi.stubGlobal("fetch", send);
});

afterEach(() => {
  for (const key of Object.keys(env)) if (!(key in original)) delete env[key];
  Object.assign(env, original);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["RESEND_API_KEY", "EMAIL_FROM"])("requires %s before authentication or email is ready", async (key) => {
  expect(emailReady()).toBe(true);
  expect(authReady()).toBe(true);
  env[key] = "   ";
  expect(emailReady()).toBe(false);
  expect(authReady()).toBe(false);
  await expect(sendAuthEmail("member@example.com", "https://forum.hengker.tech/verify", "Verify your email")).rejects.toThrow("Email is not configured");
  expect(send).not.toHaveBeenCalled();
});

it.each(["Verify your email", "Reset your password"])("sends %s through Resend with the configured sender and a deadline", async (purpose) => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const url = "https://forum.hengker.tech/api/auth/verify-email?token=secret";
  await sendAuthEmail("member@example.com", url, purpose);
  expect(send).toHaveBeenCalledOnce();
  const [endpoint, options] = send.mock.calls[0];
  expect(endpoint).toBe("https://api.resend.com/emails");
  expect(options).toEqual(
    expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer re_test-only-key", "Content-Type": "application/json" },
      signal: expect.any(AbortSignal),
    })
  );
  expect(JSON.parse(options.body)).toEqual({
    from: "Caledon Forum <noreply@hengker.tech>",
    to: ["member@example.com"],
    subject: `${purpose} — Caledon Forum`,
    text: `${purpose}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
  });
  expect(timeout).toHaveBeenCalledWith(15000);
});

it.each([401, 403, 422, 429, 500])("handles HTTP %s without retrying or exposing provider content", async (status) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  send.mockResolvedValueOnce(Response.json({ message: "private member@example.com token=secret re_test-only-key" }, { status }));
  await expect(sendAuthEmail("member@example.com", "https://forum.hengker.tech/?token=secret", "Verify your email")).rejects.toThrow("Email could not be sent");
  expect(log).toHaveBeenCalledExactlyOnceWith("Authentication email delivery failed", { code: "API_ERROR", status });
  expect(send).toHaveBeenCalledOnce();
});

it.each(["not-json", "null", "{}", '{"id":" "}', '{"id":123}'])("rejects invalid success response %s", async (body) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  send.mockResolvedValueOnce(new Response(body, { status: 200 }));
  await expect(sendAuthEmail("member@example.com", "https://forum.hengker.tech/reset", "Reset your password")).rejects.toThrow("Email could not be sent");
  expect(log).toHaveBeenCalledExactlyOnceWith("Authentication email delivery failed", { code: "INVALID_RESPONSE", status: 200 });
});

it.each([false, true])("handles network failure with timeout=%s without exposing errors", async (timedOut) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  if (timedOut) vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
  send.mockRejectedValueOnce(new Error("private member@example.com token=secret re_test-only-key"));
  await expect(sendAuthEmail("member@example.com", "https://forum.hengker.tech/reset", "Reset your password")).rejects.toThrow("Email could not be sent");
  expect(log).toHaveBeenCalledExactlyOnceWith("Authentication email delivery failed", { code: timedOut ? "TIMEOUT" : "NETWORK_ERROR", status: undefined });
  expect(send).toHaveBeenCalledOnce();
});
