export async function showPublishedPost(url: string, parentId?: string) {
  const publicId = /^\/p\/([1-9][0-9]*)$/.exec(url)?.[1];
  if (!publicId) throw new Error("Missing post address");
  const response = await fetch(`/api/forum/card/${publicId}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Could not load post");
  const fragment = new DOMParser().parseFromString(await response.text(), "text/html");
  const card = fragment.querySelector<HTMLElement>("article.post");
  const list = document.querySelector<HTMLElement>(parentId ? ".reply-list" : "[data-post-list]");
  if (!card || !list) throw new Error("Could not update the list");
  if (!document.getElementById(card.id)) {
    list.querySelectorAll("[data-post-empty]").forEach((element) => element.remove());
    if (parentId) list.appendChild(card);
    else list.insertBefore(card, list.firstChild);
  }
  const parent = fragment.querySelector<HTMLTemplateElement>("template[data-parent-id]");
  if (parent) {
    const count = Number(parent.dataset.directReplies);
    document.querySelectorAll<HTMLElement>("[data-reply-count]").forEach((element) => {
      if (element.dataset.replyCount === parent.dataset.parentId) element.textContent = String(count || "Reply");
    });
    document.querySelectorAll<HTMLElement>("[data-reply-summary]").forEach((element) => {
      if (element.dataset.replySummary === parent.dataset.parentId) element.textContent = `${count} ${count === 1 ? "reply" : "replies"}`;
    });
  }
  document.dispatchEvent(new Event("forum:posts-updated"));
}
