import { env } from "cloudflare:workers";
import nodemailer from "nodemailer";

function configuration() {
  const host = env.SMTP_HOST?.trim() || "";
  return {
    host,
    port: Number(env.SMTP_PORT),
    user: env.SMTP_USER?.trim() || "",
    // Google displays App Passwords in groups of four characters.
    password: host === "smtp.gmail.com" ? env.SMTP_PASSWORD?.replace(/\s/g, "") : env.SMTP_PASSWORD,
    from: env.EMAIL_FROM?.trim() || "",
  };
}

export function emailReady() {
  const config = configuration();
  return !!(config.host && [465, 587].includes(config.port) && config.user && config.password && config.from);
}

export async function sendAuthEmail(to: string, url: string, purpose: string) {
  if (!emailReady()) throw new Error("Email is not configured.");
  const config = configuration();
  // Create a fresh connection per request; Worker sockets cannot be shared
  // across request contexts. Both supported ports require verified TLS.
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: true,
    auth: { user: config.user, pass: config.password! },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    await transport.sendMail({
      from: config.from,
      to,
      subject: `${purpose} — Caledon Forum`,
      text: `${purpose}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
    });
  } catch (error) {
    // SMTP responses can contain email addresses. Never log the raw error,
    // credentials, message body, or verification/reset link.
    const smtp = error as { code?: string; responseCode?: number; originalCode?: string; command?: string };
    // Nodemailer replaces system errors with ESOCKET; retain only known codes
    // and fixed SMTP stages, never arbitrary error text or SMTP arguments.
    const systemCodes = [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EPIPE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_SSL_WRONG_VERSION_NUMBER",
      "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
      "ERR_OPTION_NOT_IMPLEMENTED",
      "ERR_ACCESS_DENIED",
    ];
    console.error("Authentication email delivery failed", {
      code: ["EAUTH", "ECONNECTION", "ESOCKET", "ETIMEDOUT", "EENVELOPE", "EMESSAGE", "ETLS", "EDNS"].includes(smtp.code || "") ? smtp.code : "SMTP_ERROR",
      status: typeof smtp.responseCode === "number" ? smtp.responseCode : undefined,
      ...(smtp.originalCode ? { originalCode: systemCodes.includes(smtp.originalCode) ? smtp.originalCode : "OTHER" } : {}),
      ...(smtp.command
        ? {
            stage: ["CONN", "EHLO", "HELO", "STARTTLS", "AUTH", "AUTH LOGIN", "AUTH PLAIN", "AUTH XOAUTH2", "MAIL FROM", "RCPT TO", "DATA"].includes(smtp.command)
              ? smtp.command
              : "OTHER",
          }
        : {}),
      port: config.port,
      secure: config.port === 465,
    });
    throw new Error("Email could not be sent. Please try again later.");
  } finally {
    transport.close();
  }
}
