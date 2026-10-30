import { postTime } from "../lib/post-time";
let socket: WebSocket | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let retries = 0,
  stopped = false,
  latest: string | undefined,
  refreshing = false,
  resyncRequested = false;
let reconnect: ReturnType<typeof setTimeout> | undefined;
const statuses = new Map<string, { online: boolean; lastActiveAt: number | null }>();
const visible = (element: Element) => {
  const r = element.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
};
function paint(unknown = false) {
  document.querySelectorAll<HTMLElement>("[data-presence-for]").forEach((dot) => {
    const online = unknown ? undefined : statuses.get(dot.dataset.presenceFor!)?.online;
    dot.dataset.online = String(online === true);
    const label = online === undefined ? "Status unavailable" : online ? "Online" : "Offline";
    dot.setAttribute("aria-label", label);
    dot.title = label;
    if (dot.classList.contains("profile-activity")) {
      const last = statuses.get(dot.dataset.presenceFor!)?.lastActiveAt;
      dot.textContent = online ? "Online" : last ? `Last active at ${postTime(last)}` : "";
      dot.title = last ? new Date(last).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" }) + " GMT+7" : label;
    }
    if (online === undefined) dot.hidden = true;
    else dot.hidden = false;
  });
}
function beat() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  // Indicators are hidden when status is private or unavailable. Track the avatar
  // or profile container so those users can become visible again on a later beat.
  const users = [
    ...new Set([...document.querySelectorAll<HTMLElement>("[data-presence-for]")].filter((dot) => visible(dot.parentElement || dot)).map((dot) => dot.dataset.presenceFor!)),
  ].slice(0, 100);
  socket.send(JSON.stringify({ type: "heartbeat", users }));
}
function newItemsButton() {
  if (document.querySelector(".live-updates")) return;
  const parent = document.querySelector<HTMLElement>(".reply-list[data-parent-id]");
  const list = parent || (location.pathname === "/" ? document.querySelector<HTMLElement>("[data-post-list]") : null);
  if (!list) return;
  const button = document.createElement("button");
  button.className = "button secondary live-updates";
  button.textContent = parent ? "New replies available" : "New posts available";
  button.onclick = async () => {
    button.disabled = true;
    try {
      const response = await fetch(location.href, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const replacement = doc.querySelector(parent ? ".reply-list" : "[data-post-list]");
      if (!replacement) throw new Error();
      const previous = [...list.querySelectorAll<HTMLElement>("[data-post-id]")];
      const anchor = previous.find(visible);
      const before = anchor?.getBoundingClientRect().top;
      // One post can appear as its original card and several distinct reposts.
      const retained = new Map(previous.map((card) => [card.id, card]));
      const nodes = [...replacement.childNodes].map((node) => {
        if (!(node instanceof HTMLElement)) return node;
        const existing = retained.get(node.id);
        return existing && existing.dataset.updatedAt === node.dataset.updatedAt ? existing : node;
      });
      list.replaceChildren(...nodes);
      const oldPagination = document.querySelector("[data-pagination]"),
        newPagination = doc.querySelector("[data-pagination]");
      if (oldPagination && newPagination) oldPagination.replaceChildren(...newPagination.childNodes);
      button.remove();
      if (anchor?.isConnected && before !== undefined) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
      document.dispatchEvent(new Event("forum:posts-updated"));
    } catch {
      button.textContent = "Could not load updates. Try again.";
      button.disabled = false;
    }
  };
  list.parentElement?.insertBefore(button, list);
}
async function refresh() {
  if (refreshing) {
    resyncRequested = true;
    return;
  }
  refreshing = true;
  try {
    const cards = [...document.querySelectorAll<HTMLElement>("[data-post-id]")].filter(visible).slice(0, 21);
    const query = new URLSearchParams({ ids: cards.map((card) => card.dataset.postId!).join(",") });
    const parent = document.querySelector<HTMLElement>(".reply-list[data-parent-id]")?.dataset.parentId;
    if (parent) query.set("parent", parent);
    const response = await fetch(`/api/live/snapshot?${query}`, { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as any;
    if (result.thread) {
      const state = { locked: !!result.thread.locked, deleted: !!result.thread.deleted };
      document.body.dataset.threadState = JSON.stringify(state);
      document.dispatchEvent(new CustomEvent("forum:thread-state", { detail: state }));
      const notice = document.querySelector<HTMLElement>("[data-thread-lock-notice]");
      if (notice && !state.locked) {
        notice.textContent = "This thread was unlocked. ";
        const reload = document.createElement("button");
        reload.className = "text-button";
        reload.textContent = "Refresh to reply";
        reload.onclick = () => location.reload();
        notice.appendChild(reload);
      }
    }
    if (latest && result.latest && latest !== result.latest) newItemsButton();
    latest = result.latest;
    for (const nav of document.querySelectorAll<HTMLElement>('a[href="/notifications"]')) {
      let dot = nav.querySelector<HTMLElement>(".dot");
      if (!result.unread) {
        dot?.remove();
        continue;
      }
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "dot";
        dot.setAttribute("role", "img");
        nav.appendChild(dot);
      }
      dot.setAttribute("aria-label", `${result.unread} unread notifications`);
    }
    for (const item of result.items) {
      for (const card of cards.filter((c) => c.dataset.postId === item.id)) {
        if (item.deleted) {
          if (card.querySelector(".repost-context")) {
            card.remove();
            continue;
          }
          const content = card.querySelector<HTMLElement>(".post-content");
          if (content) {
            content.dataset.richDeleted = "true";
            content.replaceChildren(document.createTextNode("This post was deleted."));
          }
          card.querySelectorAll("[data-rich-quote],.link-card,.external-image-link,.read-more").forEach((node) => node.remove());
          card.querySelector(".post-tools")?.remove();
          continue;
        }
        if (card.dataset.updatedAt !== String(item.updatedAt)) {
          const response = await fetch(`/api/forum/card/${item.publicId}${card.classList.contains("post-detail") ? "?full=1" : ""}`, { cache: "no-store" });
          if (response.ok) {
            const replacement = new DOMParser().parseFromString(await response.text(), "text/html").querySelector("article.post");
            if (replacement) {
              const repostContext = card.querySelector(".repost-context");
              if (repostContext) {
                replacement.insertBefore(repostContext.cloneNode(true), replacement.firstChild);
                replacement.id = card.id;
                (replacement as HTMLElement).dataset.ownRepost = card.dataset.ownRepost;
              }
              card.replaceWith(replacement);
            }
          }
          continue;
        }
        const like = card.querySelector<HTMLButtonElement>("[data-like]");
        like?.setAttribute("aria-pressed", String(item.liked));
        like?.querySelector("svg")?.setAttribute("fill", item.liked ? "currentColor" : "none");
        const set = (selector: string, text: string) => {
          const e = card.querySelector(selector);
          if (e) e.textContent = text;
        };
        set("[data-like] span", String(item.likes || "Like"));
        set("[data-share] span", String(item.reposts || "Share"));
        const share = card.querySelector<HTMLElement>("[data-share]");
        if (share) {
          share.dataset.reposted = String(item.reposted);
          share.dataset.reposts = String(item.reposts);
          share.setAttribute("aria-label", `Share post, ${item.reposts} reposts`);
        }
        set("[data-reply-count]", String(item.directReplies || "Reply"));
        set(".post-views span", Number(item.views).toLocaleString("en-US"));
        card.querySelector(".post-views")?.setAttribute("aria-label", `${item.views} ${item.views === 1 ? "view" : "views"}`);
      }
    }
    if (location.pathname === "/notifications") {
      const page = await fetch(location.href, { cache: "no-store" });
      if (page.ok) {
        const doc = new DOMParser().parseFromString(await page.text(), "text/html");
        const current = document.querySelector("[data-notification-list]"),
          replacement = doc.querySelector("[data-notification-list]");
        if (current && replacement) current.replaceChildren(...replacement.childNodes);
      }
    }
    document.dispatchEvent(new Event("forum:posts-updated"));
    document.dispatchEvent(new Event("forum:quotes-updated"));
  } catch {
    /* Manual refresh remains available. */
  } finally {
    refreshing = false;
    if (resyncRequested) {
      resyncRequested = false;
      void refresh();
    }
  }
}
function connect() {
  if (stopped || document.visibilityState !== "visible" || document.body.dataset.realtime !== "true") return;
  socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/live/connect`);
  socket.onopen = () => {
    document.body.dataset.realtimeConnected = "true";
    retries = 0;
    beat();
    clearInterval(heartbeat);
    heartbeat = setInterval(beat, 30000);
    void refresh();
  };
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "dm-refresh") document.dispatchEvent(new Event("forum:dm-updated"));
      else if (data.type === "refresh") void refresh();
      else if (data.type === "presence") {
        statuses.clear();
        for (const [name, online] of Object.entries(data.users)) statuses.set(name, online as { online: boolean; lastActiveAt: number | null });
        paint();
      }
    } catch {}
  };
  socket.onclose = (event) => {
    document.body.dataset.realtimeConnected = "false";
    clearInterval(heartbeat);
    paint(true);
    if (event.code === 1013 || event.code === 1008) stopped = true;
    if (!stopped && document.visibilityState === "visible" && retries < 6) reconnect = setTimeout(connect, Math.min(60000, 1000 * 2 ** retries++) + Math.random() * 1000);
  };
}
document.addEventListener("visibilitychange", () => {
  clearTimeout(reconnect);
  if (document.visibilityState !== "visible") {
    clearInterval(heartbeat);
    socket?.close(1000);
    paint(true);
  } else connect();
});
document.addEventListener("forum:posts-updated", () => paint());
window.addEventListener("pagehide", () => {
  clearTimeout(reconnect);
  clearInterval(heartbeat);
  socket?.close(1000);
});
connect();
