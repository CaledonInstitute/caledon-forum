import { env } from "cloudflare:workers";

export function emailReady() {
  return !!(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export async function sendAuthEmail(to: string, url: string, purpose: string) {
  if (!emailReady()) throw new Error("Email is not configured.");
  const signal = AbortSignal.timeout(15000);
  let status: number | undefined;
  let code = "NETWORK_ERROR";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM!.trim(),
        to: [to],
        subject: `${purpose} — Caledon Forum`,
        text: `${purpose}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
      }),
      signal,
    });
    status = response.status;
    if (!response.ok) {
      code = "API_ERROR";
      await response.body?.cancel();
      throw new Error("Email API rejected the request.");
    }
    code = "INVALID_RESPONSE";
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id.trim()) throw new Error("Email API did not return a message ID.");
  } catch {
    // Provider responses may contain addresses or secrets. Log only our fixed
    // categories and HTTP status, never response bodies or the original error.
    console.error("Authentication email delivery failed", { code: signal.aborted ? "TIMEOUT" : code, status });
    throw new Error("Email could not be sent. Please try again later.");
  }
}
