import { extractLinks } from "./markdown";
import { localListingId } from "./listing-link";
import { listingElement, type ListingPreview } from "./listing-dom";
import type { ListingCardData } from "./marketplace";
const listingBodies = new WeakMap<HTMLElement, string>();
export function listingSource(body: string, origin: string) {
  for (const sourceUrl of extractLinks(body, false)) {
    const id = localListingId(sourceUrl, origin);
    if (id) return { sourceUrl, id };
  }
  return null;
}
export async function clientListing(body: string): Promise<ListingPreview | null> {
  const source = listingSource(body, location.origin);
  if (!source) return null;
  const response = await fetch(`/api/public/listings?ids=${source.id}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load listing.");
  const { items } = (await response.json()) as { items: ListingCardData[] };
  return { ...source, listing: items.find((item) => item.id === source.id) || null };
}
export function trackListing(host: HTMLElement, body: string) {
  listingBodies.set(host, body);
}
export async function refreshListings() {
  const hosts = [...document.querySelectorAll<HTMLElement>("[data-rich-listing]")]
    .filter((host) => {
      const rect = host.getBoundingClientRect();
      return listingBodies.has(host) && rect.bottom >= 0 && rect.top < innerHeight;
    })
    .slice(0, 21);
  const sources = hosts.map((host) => listingSource(listingBodies.get(host)!, location.origin));
  const ids = [...new Set(sources.flatMap((source) => (source ? [source.id] : [])))];
  if (!ids.length) return;
  const response = await fetch(`/api/public/listings?ids=${ids.join(",")}`, { cache: "no-store" });
  if (!response.ok) return;
  const { items } = (await response.json()) as { items: ListingCardData[] };
  hosts.forEach((host, index) => {
    const source = sources[index];
    if (source && host.isConnected) host.replaceChildren(listingElement({ ...source, listing: items.find((item) => item.id === source.id) || null }));
  });
}
