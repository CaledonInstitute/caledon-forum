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

  const publicId = /^\/p\/([1-9][0-9]*)$/.exec(path)?.[1];
  if (publicId) {
    const screenshot = document.createElement("button");
    screenshot.type = "button";
    screenshot.textContent = "Copy as screenshot";
    const download = document.createElement("a");
    download.textContent = "Download screenshot";
    download.href = `/api/screenshot/${publicId}.png`;
    download.download = `caledon-${publicId}-1080.png`;
    async function fetchPng() {
      const response = await fetch(download.href, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Could not create screenshot. Try again.");
      }
      if (!response.headers.get("content-type")?.startsWith("image/png")) throw new Error("The server did not return a screenshot. Try again.");
      return response.blob();
    }
    download.onclick = async (event) => {
      event.preventDefault();
      if (download.getAttribute("aria-disabled") === "true") return;
      download.setAttribute("aria-disabled", "true");
      const status = dialog.querySelector<HTMLElement>("[data-share-status]")!;
      status.textContent = "Preparing screenshot…";
      try {
        const png = await fetchPng();
        const url = URL.createObjectURL(png);
        const a = document.createElement("a");
        a.href = url;
        a.download = download.download;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        status.textContent = "Screenshot downloaded.";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Could not download screenshot. Try again.";
      } finally {
        download.removeAttribute("aria-disabled");
      }
    };
    const supported = !!navigator.clipboard?.write && typeof ClipboardItem !== "undefined" && (!ClipboardItem.supports || ClipboardItem.supports("image/png"));
    screenshot.disabled = !supported;
    screenshot.onclick = async () => {
      screenshot.disabled = true;
      const status = dialog.querySelector<HTMLElement>("[data-share-status]")!;
      status.textContent = "Preparing screenshot…";
      let renderError = "";
      try {
        // Pass the promise immediately to preserve user activation in Safari.
        const png = fetchPng().catch((error) => {
          renderError = error instanceof Error ? error.message : "Could not create screenshot.";
          throw error;
        });
        void png.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        status.textContent = "Screenshot copied. Paste it into another app.";
      } catch {
        status.textContent = renderError || "Could not copy screenshot. Use Download screenshot instead.";
      } finally {
        screenshot.disabled = false;
      }
    };
    actions.appendChild(screenshot);
    actions.appendChild(download);
    if (!supported) dialog.querySelector("[data-share-status]")!.textContent = "This browser cannot copy images. Use Download screenshot.";
  }

  if (innerWidth > 680) {
    const rect = button.getBoundingClientRect();
    dialog.style.top = `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - 440))}px`;
    dialog.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - 290))}px`;
  }

  dialog.showModal();
});

export {};

document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-repost],[data-pin]");
  if (!button || button.disabled) return;
  if (button.dataset.signedIn === "false") {
    location.assign("/login");
    return;
  }
  button.disabled = true;
  const status = button.closest("article")?.querySelector<HTMLElement>("[data-post-status]");
  try {
    const pin = !!button.dataset.pin;
    const response = await fetch(`/api/forum/${pin ? "pin" : "repost"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        pin ? { id: button.dataset.pin, pinned: button.dataset.pinned !== "true" } : { id: button.dataset.repost, reposted: button.dataset.reposted !== "true" }
      ),
    });
    const result: any = await response.json();
    if (!response.ok) throw new Error(result.error || "Try again.");
    if (pin) {
      location.reload();
      return;
    }
    document.querySelectorAll<HTMLButtonElement>("[data-repost]").forEach((b) => {
      if (b.dataset.repost !== button.dataset.repost) return;
      b.dataset.reposted = String(result.reposted);
      b.setAttribute("aria-pressed", String(result.reposted));
      b.setAttribute("aria-label", `Repost, ${result.reposts} reposts`);
      b.querySelector("span")!.textContent = result.reposts ? Number(result.reposts).toLocaleString("en-US") : "";
    });
    if (!result.reposted)
      document.querySelectorAll<HTMLElement>('[data-own-repost="true"], [data-own-reposts="true"] article').forEach((card) => {
        if (card.dataset.postId === button.dataset.repost) card.remove();
      });
    document.dispatchEvent(new Event("forum:profile-counts"));
  } catch (e) {
    if (status) status.textContent = e instanceof Error ? e.message : "Try again.";
  } finally {
    button.disabled = false;
  }
});
