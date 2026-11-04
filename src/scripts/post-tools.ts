import { iconMarkup, postIcons } from "../lib/icon-markup";
import { paintPostViews } from "../lib/post-view-label";
export {};
function enhanceTools() {
  document.querySelectorAll<HTMLElement>("[data-post-controls]:not([data-controls-ready])").forEach((host) => {
    const p = JSON.parse(host.dataset.postControls!);
    host.dataset.controlsReady = "true";
    host.innerHTML = `<div class="post-action-row"><a data-ui-reply>${postIcons.reply}<span></span></a><button type="button" data-ui-like>${p.liked ? postIcons.liked : postIcons.like}<span></span></button><button type="button" data-ui-repost>${iconMarkup("repeat-2", 17, 1.6)}<span></span></button><button type="button" data-ui-share>${postIcons.link}</button><p class="post-views"><span data-view-count></span> <span data-view-unit></span></p></div><details class="more"><summary aria-label="More actions">${postIcons.more}</summary><div class="menu"></div></details>`;
    const reply = host.querySelector<HTMLAnchorElement>("[data-ui-reply]")!;
    reply.href = `${p.url}#reply`;
    reply.setAttribute("aria-label", `Reply to ${p.name}`);
    const count = reply.querySelector<HTMLElement>("span")!;
    count.dataset.replyCount = p.id;
    count.textContent = p.replies ? Number(p.replies).toLocaleString("en-US") : "";
    const like = host.querySelector<HTMLButtonElement>("[data-ui-like]")!;
    like.dataset.like = p.id;
    like.dataset.signedIn = String(p.signedIn);
    like.setAttribute("aria-pressed", String(p.liked));
    like.setAttribute("aria-label", p.liked ? "Unlike" : "Like");
    like.querySelector("span")!.textContent = p.likes ? Number(p.likes).toLocaleString("en-US") : "";
    const share = host.querySelector<HTMLButtonElement>("[data-ui-share]")!;
    share.dataset.shareMenu = p.url;
    const repost = host.querySelector<HTMLButtonElement>("[data-ui-repost]")!;
    repost.dataset.repost = p.id;
    repost.dataset.reposted = String(p.reposted);
    repost.dataset.signedIn = String(p.signedIn);
    repost.setAttribute("aria-pressed", String(p.reposted));
    repost.setAttribute("aria-label", `Repost, ${p.reposts} reposts`);
    repost.querySelector("span")!.textContent = p.reposts ? Number(p.reposts).toLocaleString("en-US") : "";
    share.dataset.reposted = String(p.reposted);
    share.dataset.reposts = String(p.reposts);
    share.dataset.signedIn = String(p.signedIn);
    share.dataset.share = p.id;
    share.setAttribute("aria-label", "Share post");
    const views = host.querySelector<HTMLElement>(".post-views")!;
    paintPostViews(views, Number(p.views));
    const menu = host.querySelector<HTMLElement>(".menu")!;
    const link = (text: string, href: string) => {
      const a = document.createElement("a");
      a.textContent = text;
      a.href = href;
      menu.appendChild(a);
    };
    const button = (text: string, action: string, operation?: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.setAttribute(`data-${action}`, p.id);
      if (operation) b.dataset.operation = operation;
      menu.appendChild(b);
    };
    if (p.owner) {
      if (p.editable) link("Edit post", `/edit/${encodeURIComponent(p.id)}`);
      button("Delete post", "delete");
    }
    if (p.signedIn) button("Report post", "report");
    else link("Sign in to report", "/login");
    if (p.admin) {
      button("Remove as admin", "moderate", "delete");
      if (p.root) {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.dataset.pin = p.id;
        pin.dataset.pinned = String(p.pinned);
        pin.textContent = p.pinned ? "Unpin announcement" : "Pin as announcement";
        menu.appendChild(pin);
      }
      if (p.root) button(`${p.locked ? "Unlock" : "Lock"} thread`, "moderate", p.locked ? "unlock" : "lock");
    }
    const more = host.querySelector<HTMLElement>(".more");
    const identity = host.closest("article.post")?.querySelector(".identity");
    if (more && identity) identity.appendChild(more);
  });
}
enhanceTools();
document.addEventListener("forum:posts-updated", enhanceTools);
