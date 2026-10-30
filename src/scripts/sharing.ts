let opener: HTMLButtonElement | null = null;

const dialog = document.createElement("dialog");
dialog.className = "share-dialog";

dialog.setAttribute("aria-labelledby", "share-heading");

dialog.innerHTML =
  '<div class="share-heading"><h2 id="share-heading">Share post</h2><button type="button" data-share-close aria-label="Close share menu">×</button></div><div data-share-actions></div><p class="error" data-share-status role="status"></p>';

document.body.appendChild(dialog);

dialog.querySelector("[data-share-close]")!.addEventListener("click", () => dialog.close());

dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => opener?.focus());

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-share-menu]");
  if (!button) return;

  opener = button;
  const path = button.dataset.shareMenu!;
  const signedIn = button.dataset.signedIn === "true";

  const actions = dialog.querySelector<HTMLElement>("[data-share-actions]")!;
  actions.replaceChildren();
  dialog.querySelector("[data-share-status]")!.textContent = "";

  const link = (label: string, url: string) => {
    const a = document.createElement("a");
    a.textContent = label;
    a.href = url;
    actions.appendChild(a);
  };

  link("Send via DM", signedIn ? `/dm?share=${encodeURIComponent(path)}` : "/login");

  const repost = document.createElement("button");
  repost.type = "button";
  repost.textContent = button.dataset.reposted === "true" ? "Undo repost" : "Repost";

  repost.onclick = async () => {
    if (!signedIn) {
      location.assign("/login");
      return;
    }
    repost.disabled = true;
    try {
      const r = await fetch("/api/forum/repost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: button.dataset.share, reposted: button.dataset.reposted !== "true" }),
      });
      const result: any = await r.json();
      if (!r.ok) throw new Error(result.error || "Could not repost.");
      document.querySelectorAll<HTMLButtonElement>("[data-share-menu]").forEach((b) => {
        if (b.dataset.share === button.dataset.share) {
          b.dataset.reposted = String(result.reposted);
          b.dataset.reposts = String(result.reposts);
          b.querySelector("span")!.textContent = String(result.reposts || "Share");
        }
      });
      if (!result.reposted)
        document.querySelectorAll<HTMLElement>('[data-own-repost="true"]').forEach((card) => {
          if (card.dataset.postId === button.dataset.share) card.remove();
        });
      dialog.close();
    } catch (e) {
      dialog.querySelector("[data-share-status]")!.textContent = e instanceof Error ? e.message : "Try again.";
    } finally {
      repost.disabled = false;
    }
  };
  actions.appendChild(repost);

  link("Quote post", signedIn ? `/?quote=${encodeURIComponent(path)}#compose` : "/login");

  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy link";
  copy.onclick = async () => {
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(new URL(path, location.origin).href);
      dialog.querySelector("[data-share-status]")!.textContent = "Link copied.";
      const recorded = await fetch("/api/forum/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: button.dataset.share }) });
      if (!recorded.ok) dialog.querySelector("[data-share-status]")!.textContent = "Link copied, but the share count could not be updated.";
    } catch {
      dialog.querySelector("[data-share-status]")!.textContent = "Could not copy. Try again.";
    } finally {
      copy.disabled = false;
    }
  };
  actions.appendChild(copy);

  if (innerWidth > 680) {
    const rect = button.getBoundingClientRect();
    dialog.style.top = `${Math.min(rect.bottom + 8, innerHeight - 300)}px`;
    dialog.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - 290))}px`;
  }

  dialog.showModal();
});

export {};
