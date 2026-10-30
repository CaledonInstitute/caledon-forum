import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "./runtime";
import { authReady } from "../src/lib/auth";
import { emailReady, sendAuthEmail } from "../src/lib/email";
import nodemailer from "nodemailer";

vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
const original = { ...env };
const sendMail = vi.fn();
const close = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  env.AUTH_ENABLED = "true";
  env.TURNSTILE_SECRET_KEY = "test";
  env.SMTP_HOST = "smtp.gmail.com";
  env.SMTP_PORT = "465";
  env.SMTP_USER = "sender@example.com";
  env.SMTP_PASSWORD = "abcd efgh ijkl mnop";
  env.EMAIL_FROM = "Caledon Forum <sender@example.com>";
  sendMail.mockResolvedValue({ accepted: ["member@example.com"] });
  vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close } as any);
});
afterEach(() => {
  for (const key of Object.keys(env)) if (!(key in original)) delete env[key];
  Object.assign(env, original);
  vi.restoreAllMocks();
});

it("requires SMTP credentials and keeps authentication disabled until the password is supplied", () => {
  expect(emailReady()).toBe(true);
  expect(authReady()).toBe(true);
  env.SMTP_PASSWORD = "   ";
  expect(emailReady()).toBe(false);
  expect(authReady()).toBe(false);
});

it("sends verification mail over verified TLS using the configured Gmail App Password", async () => {
  await sendAuthEmail("member@example.com", "https://forum.example/api/auth/verify-email?token=secret", "Verify your email");
  expect(nodemailer.createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      requireTLS: true,
      auth: { user: "sender@example.com", pass: "abcdefghijklmnop" },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
    })
  );
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "Caledon Forum <sender@example.com>",
      to: "member@example.com",
      subject: "Verify your email — Caledon Forum",
      text: expect.stringContaining("https://forum.example/api/auth/verify-email?token=secret"),
    })
  );
  expect(close).toHaveBeenCalledOnce();
});

it("requires STARTTLS on port 587 and rejects unsupported ports", async () => {
  env.SMTP_PORT = "587";
  await sendAuthEmail("member@example.com", "https://forum.example/reset", "Reset your password");
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true }));
  env.SMTP_PORT = "25";
  expect(emailReady()).toBe(false);
  await expect(sendAuthEmail("member@example.com", "https://forum.example/reset", "Reset your password")).rejects.toThrow("Email is not configured");
});

it.each(["EAUTH", "ETIMEDOUT", "ESOCKET"])("reports %s without exposing SMTP credentials, recipients, or links", async (code) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  sendMail.mockRejectedValueOnce(Object.assign(new Error("private SMTP response member@example.com token=secret password=abcdefghijklmnop"), { code, responseCode: 535 }));
  await expect(sendAuthEmail("member@example.com", "https://forum.example/?token=secret", "Verify your email")).rejects.toThrow("Email could not be sent");
  expect(log).toHaveBeenCalledWith("Authentication email delivery failed", { code, status: 535 });
  expect(close).toHaveBeenCalledOnce();
});
