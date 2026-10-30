import type { QuotedPost } from "./types";
import { postTime } from "./post-time";
export function quoteElement(q: QuotedPost) {
  const aside = document.createElement("aside");
  aside.className = "quote-card";
  if (q.unavailable) {
    aside.classList.add("quote-unavailable");
    aside.setAttribute("aria-label", "Unavailable quoted post");
    const text = document.createElement("p");
    text.textContent = "This quoted post is no longer available.";
    aside.appendChild(text);
    return aside;
  }
  aside.setAttribute("aria-label", "Quoted post");
  // Static structure only. Every user-controlled value is assigned as text or a validated route.
  aside.innerHTML =
    '<div class="quote-identity"><a class="quote-profile"><span class="avatar-shell"><span class="avatar" aria-hidden="true"></span><span class="presence-dot" role="img" aria-label="Status unavailable" title="Status unavailable"></span></span></a><div class="quote-author"><a class="quote-profile"><strong></strong></a><span class="quote-handle"></span></div></div><a class="quote-source"><p></p><time></time></a>';
  aside.querySelectorAll<HTMLAnchorElement>(".quote-profile").forEach((link) => {
    link.href = `/${encodeURIComponent(q.username)}`;
  });
  aside.querySelector(".quote-profile")!.setAttribute("aria-label", `${q.name}'s profile`);
  const avatar = aside.querySelector<HTMLElement>(".avatar")!;
  avatar.textContent = q.name.trim().slice(0, 1).toUpperCase() || "C";
  aside.querySelector<HTMLElement>(".presence-dot")!.dataset.presenceFor = q.username;
  if (q.image) {
    const image = document.createElement("img");
    image.src = `/api/avatar/${encodeURIComponent(q.username)}`;
    image.alt = "";
    image.width = image.height = 30;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.onerror = () => (image.style.opacity = "0");
    avatar.appendChild(image);
  }
  aside.querySelector("strong")!.textContent = q.name;
  aside.querySelector(".quote-handle")!.textContent = `@${q.username}`;
  if (q.isCaledonMember) {
    const badge = document.createElement("span");
    badge.className = "quote-badge";
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", "Verified Caledon member");
    badge.textContent = "✓";
    aside.querySelector(".quote-author")!.insertBefore(badge, aside.querySelector(".quote-handle"));
  }
  const link = aside.querySelector<HTMLAnchorElement>(".quote-source")!;
  link.href = q.url;
  if (q.parentUsername) {
    const context = document.createElement("span");
    context.className = "quote-context";
    context.textContent = `Replying to @${q.parentUsername}`;
    link.insertBefore(context, link.firstChild);
  }
  link.querySelector("p")!.textContent = q.text || "Open quoted post";
  const time = link.querySelector("time")!;
  time.dateTime = new Date(q.createdAt).toISOString();
  time.title = `${postTime(q.createdAt)} GMT+7`;
  time.textContent = postTime(q.createdAt);
  return aside;
}
