import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";
export function storageReady() {
  return !!(env.B2_ENDPOINT && env.B2_REGION && env.B2_BUCKET && env.B2_ACCESS_KEY_ID && env.B2_SECRET_ACCESS_KEY);
}
export function uploadsReady() {
  return env.UPLOADS_ENABLED !== "false" && storageReady();
}
export async function b2(key: string, options: RequestInit = {}, query: Record<string, string> = {}) {
  if (!storageReady()) throw new Error("File uploads are not configured yet.");
  const base = new URL(env.B2_ENDPOINT!);
  if (base.protocol !== "https:" || !/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(base.hostname)) throw new Error("Invalid B2 endpoint.");
  base.pathname = `/${encodeURIComponent(env.B2_BUCKET!)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  for (const [k, v] of Object.entries(query)) base.searchParams.set(k, v);
  const client = new AwsClient({ accessKeyId: env.B2_ACCESS_KEY_ID!, secretAccessKey: env.B2_SECRET_ACCESS_KEY!, region: env.B2_REGION!, service: "s3", retries: 1 });
  const response = await client.fetch(base.href, { ...options, signal: AbortSignal.timeout(25000) });
  if (!response.ok && !(["DELETE", "HEAD"].includes(options.method || "") && response.status === 404)) throw new Error("Storage is temporarily unavailable. Try again.");
  return response;
}
export const escapeXml = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
export const xmlValue = (xml: string, tag: string) =>
  new RegExp(`<${tag}>([^<]+)</${tag}>`)
    .exec(xml)?.[1]
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
