import { postIcons } from "../lib/icon-markup";
export {};
function enhanceTools() {
  document.querySelectorAll<HTMLElement>("[data-post-controls]:not([data-controls-ready])").forEach((host) => {
    const p = JSON.parse(host.dataset.postControls!);
    host.dataset.controlsReady = "true";
    host.innerHTML = `<a data-ui-reply>${postIcons.reply}<span></span></a><button type="button" data-ui-like>${p.liked ? postIcons.liked : postIcons.like}<span></span></button><button type="button" data-ui-share>${postIcons.link}<span></span></button><span class="post-views" role="img">${postIcons.eye}<span aria-hidden="true"></span></span><details class="more"><summary aria-label="More actions">${postIcons.more}</summary><div class="menu"></div></details>`;
    const reply = host.querySelector<HTMLAnchorElement>("[data-ui-reply]")!;
    reply.href = `${p.url}#reply`;
    reply.setAttribute("aria-label", `Reply to ${p.name}`);
    const count = reply.querySelector<HTMLElement>("span")!;
    count.dataset.replyCount = p.id;
    count.textContent = String(p.directReplies || "Reply");
    const like = host.querySelector<HTMLButtonElement>("[data-ui-like]")!;
    like.dataset.like = p.id;
    like.dataset.signedIn = String(p.signedIn);
    like.setAttribute("aria-pressed", String(p.liked));
    like.setAttribute("aria-label", p.liked ? "Unlike" : "Like");
    like.querySelector("span")!.textContent = String(p.likes || "Like");
    const share = host.querySelector<HTMLButtonElement>("[data-ui-share]")!;
    share.dataset.shareMenu = p.url;
    share.dataset.reposted = String(p.reposted);
    share.dataset.reposts = String(p.reposts);
    share.dataset.signedIn = String(p.signedIn);
    share.dataset.share = p.id;
    share.setAttribute("aria-label", `Share post, ${p.reposts} reposts`);
    share.querySelector("span")!.textContent = String(p.reposts || "Share");
    const views = host.querySelector<HTMLElement>(".post-views")!;
    const number = Number(p.views).toLocaleString("en-US");
    views.setAttribute("aria-label", `${number} ${p.views === 1 ? "view" : "views"}`);
    views.querySelector("span")!.textContent = number;
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
      link("Edit post", `/edit/${encodeURIComponent(p.id)}`);
      button("Delete post", "delete");
    }
    if (p.signedIn) button("Report post", "report");
    else link("Sign in to report", "/login");
    if (p.admin) {
      button("Remove as admin", "moderate", "delete");
      if (p.root) button(`${p.locked ? "Unlock" : "Lock"} thread`, "moderate", p.locked ? "unlock" : "lock");
    }
  });
}
enhanceTools();
document.addEventListener("forum:posts-updated", enhanceTools);
