import ipaddr from "ipaddr.js";
export function publicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Only public HTTPS links are supported.");
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host)) throw new Error("This address is not public.");
  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== "unicast") throw new Error("This address is not public.");
  url.hash = "";
  return url;
}
export async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new Error("Response is too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new Error("Response is too large.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
// global_fetch_strictly_public also blocks private DNS resolutions and DNS rebinding in Workers.
export async function safeFetch(value: string, accept = "text/html,application/json,image/*", fetcher: typeof fetch = fetch, requestSignal?: AbortSignal) {
  let url = publicUrl(value);
  const signal = requestSignal || AbortSignal.timeout(5000);
  let redirects = 0,
    discordFallback = false,
    compatibilityRetry = false;
  for (;;) {
    const response = await fetcher(url, {
      redirect: "manual",
      signal,
      headers: { Accept: accept, "User-Agent": compatibilityRetry ? "Mozilla/5.0" : "CaledonForum/1.0 (+link preview)" },
    });
    // Discord's resize proxy can reject Workers while the same signed attachment
    // remains available from its original CDN. Preserve the full signed query.
    if (response.status === 403 && !discordFallback && url.hostname === "media.discordapp.net" && /^\/attachments\/[0-9]+\/[0-9]+\//.test(url.pathname)) {
      await response.body?.cancel();
      const original = new URL(url);
      original.hostname = "cdn.discordapp.com";
      url = publicUrl(original.href);
      discordFallback = true;
      continue;
    }
    // Some public hosts reject non-browser clients. Retry the same public URL
    // once with a compatible User-Agent, keeping its path/query and Accept intact.
    if (response.status === 403 && !compatibilityRetry) {
      await response.body?.cancel();
      compatibilityRetry = true;
      continue;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects === 3 || !response.headers.get("location")) throw new Error("Too many redirects.");
      url = publicUrl(new URL(response.headers.get("location")!, url).href);
      redirects++;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("The linked page is unavailable.");
    }
    return response;
  }
}
export function rasterType(bytes: Uint8Array, mime: string): boolean {
  const text = new TextDecoder("latin1").decode(bytes.slice(0, 16));
  return (
    (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (mime === "image/png" && bytes[0] === 137 && text.slice(1, 4) === "PNG") ||
    (mime === "image/gif" && /^GIF8[79]a/.test(text)) ||
    (mime === "image/webp" && text.startsWith("RIFF") && text.slice(8, 12) === "WEBP")
  );
}
