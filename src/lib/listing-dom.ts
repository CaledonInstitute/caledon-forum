import { iconMarkup } from "./icon-markup";
import { fileUrl } from "./upload-policy";
import { formatPrice } from "./listing-price";
import type { ListingCardData } from "./marketplace";
export interface ListingPreview {
  sourceUrl: string;
  id: string;
  listing: ListingCardData | null;
}
export function listingElement(preview: ListingPreview) {
  const listing = preview.listing;
  if (!listing) {
    const unavailable = document.createElement("aside");
    unavailable.className = "timeline-product-unavailable";
    unavailable.setAttribute("aria-label", "Unavailable listing");
    unavailable.innerHTML = `${iconMarkup("shopping-bag", 20)}<p>This listing is no longer available.</p>`;
    return unavailable;
  }
  const link = document.createElement("a");
  link.className = "timeline-product";
  link.href = `/marketplace/${encodeURIComponent(listing.id)}`;
  link.setAttribute("aria-label", `View listing: ${listing.title}`);
  // Only static markup. User content is always assigned via textContent.
  link.innerHTML = `<div class="timeline-product-photo"></div><div class="timeline-product-copy"><div class="timeline-product-source">${iconMarkup("shopping-bag", 13)}Marketplace</div><h3></h3><p class="timeline-product-price"></p><p class="timeline-product-meta"></p></div>`;
  const photo = link.querySelector(".timeline-product-photo")!;
  if (listing.photoId) {
    const image = document.createElement("img");
    image.src = fileUrl(listing.photoId);
    image.alt = "";
    image.loading = "lazy";
    photo.appendChild(image);
  } else photo.innerHTML = iconMarkup("shopping-bag", 28, 1.4);
  link.querySelector("h3")!.textContent = listing.title;
  link.querySelector(".timeline-product-price")!.textContent = formatPrice(listing.price);
  link.querySelector(".timeline-product-meta")!.textContent = listing.kind === "service" ? "Service" : listing.condition === "new" ? "New item" : "Used item";
  if (listing.status === "closed") {
    const status = document.createElement("span");
    status.className = "timeline-product-status";
    status.textContent = "Closed";
    link.querySelector(".timeline-product-source")!.appendChild(status);
  }
  if (listing.negotiable) {
    const text = document.createElement("p");
    text.className = "timeline-product-meta";
    text.textContent = "Negotiable";
    const price = link.querySelector(".timeline-product-price")!;
    price.parentNode!.insertBefore(text, price.nextSibling);
  }
  if (listing.location) {
    const location = document.createElement("p");
    location.className = "timeline-product-location";
    location.innerHTML = iconMarkup("map-pin", 13);
    location.appendChild(document.createTextNode(listing.location));
    link.querySelector(".timeline-product-copy")!.appendChild(location);
  }
  return link;
}
