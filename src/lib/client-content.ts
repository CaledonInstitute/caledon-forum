import { quoteElement } from "./quote-dom";
import { markdown, extractLinks } from "./markdown";
import { excerpt } from "./content";
import type { LinkPreview, QuotedPost } from "./types";
const quoteBodies = new WeakMap<HTMLElement, string>();
function sourceLink(body: string) {
  for (const sourceUrl of extractLinks(body, false)) {
    try {
      const url = new URL(sourceUrl, location.origin);
      const id = /^\/p\/([0-9]{1,19})\/?$/.exec(url.pathname)?.[1].replace(/^0+/, "");
      if (url.origin === location.origin && !url.username && !url.password && id) return { sourceUrl, id };
    } catch {
      /* Not a forum link. */
    }
  }
  return null;
}
export async function clientQuote(body: string): Promise<QuotedPost | null> {
  const source = sourceLink(body);
  if (!source) return null;
  const response = await fetch(`/api/public/quotes?ids=${source.id}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load quoted post.");
  const p = ((await response.json()) as { items: any[] }).items[0];
  return quoteFromSource(source, p);
}
async function quoteFromSource(source: NonNullable<ReturnType<typeof sourceLink>>, p: any): Promise<QuotedPost> {
  if (!p || p.unavailable) return { sourceUrl: source.sourceUrl, url: `/p/${source.id}`, unavailable: true };
  const text = new DOMParser().parseFromString(await markdown(p.body), "text/html").body.textContent || "";
  return {
    sourceUrl: source.sourceUrl,
    url: `/p/${p.publicId}`,
    unavailable: false,
    name: p.name,
    username: p.username,
    image: p.image,
    isCaledonMember: p.isCaledonMember,
    text: excerpt(text, 320),
    createdAt: p.createdAt,
    parentUsername: p.parentUsername,
  };
}
export async function clientRender(body: string, links: LinkPreview[]) {
  const quote = await clientQuote(body);
  return { html: await markdown(body, links, quote?.sourceUrl), quote };
}
export async function enhancePost(element: HTMLElement) {
  const source = element.querySelector<HTMLTemplateElement>("template[data-rich-source]");
  if (!source) return;
  const body = source.content.textContent || "";
  const links = JSON.parse(element.dataset.richPreviews || "[]") as LinkPreview[];
  let quote: QuotedPost | null = null;
  try {
    quote = await clientQuote(body);
  } catch {
    /* Keep original link when offline. */
  }
  const html = await markdown(body, links, quote?.sourceUrl, element.closest(".post-detail") ? undefined : 600);
  if (!element.isConnected || element.dataset.richDeleted === "true") return;
  element.innerHTML = html;
  element.dataset.richReady = "true";
  const cut = !!element.querySelector("[data-content-truncated]");
  const more = element.parentElement?.querySelector<HTMLElement>(".read-more");
  if (more) more.hidden = !cut;
  else if (cut) {
    const link = document.createElement("a");
    link.className = "read-more";
    link.href = element.closest<HTMLElement>("[data-post-url]")?.dataset.postUrl || "#";
    link.textContent = "Read more";
    element.parentNode?.insertBefore(link, element.nextSibling);
  }
  const host = element.parentElement?.querySelector<HTMLElement>("[data-rich-quote]");
  if (host && body.includes("p/")) quoteBodies.set(host, body);
  if (host && quote) host.replaceChildren(quoteElement(quote));
  document.dispatchEvent(new Event("forum:posts-updated"));
}
export async function refreshQuotes() {
  const hosts = [...document.querySelectorAll<HTMLElement>("[data-rich-quote]")]
    .filter((host) => {
      const rect = host.getBoundingClientRect();
      return quoteBodies.has(host) && rect.bottom >= 0 && rect.top < innerHeight;
    })
    .slice(0, 21);
  const sources = hosts.map((host) => sourceLink(quoteBodies.get(host)!));
  const ids = [...new Set(sources.filter((s) => !!s).map((s) => s!.id))];
  if (!ids.length) return;
  const response = await fetch(`/api/public/quotes?ids=${ids.join(",")}`, { cache: "no-store" });
  if (!response.ok) return;
  const items = ((await response.json()) as { items: any[] }).items;
  await Promise.all(
    hosts.map(async (host, i) => {
      const source = sources[i];
      if (!source) return;
      const quote = await quoteFromSource(
        source,
        items.find((p) => p.publicId === source.id)
      );
      if (host.isConnected) host.replaceChildren(quoteElement(quote));
    })
  );
  document.dispatchEvent(new Event("forum:posts-updated"));
}
