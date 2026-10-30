import "./post-tools";
import "./post-views";
import "./rich-posts";
import "./realtime";

const settingsTabs = document.querySelector<HTMLElement>(".settings-categories");
const activeSettingsTab = settingsTabs?.querySelector<HTMLElement>('[aria-current="page"]');
if (settingsTabs && activeSettingsTab && settingsTabs.scrollWidth > settingsTabs.clientWidth) {
  settingsTabs.scrollLeft = activeSettingsTab.offsetLeft - settingsTabs.offsetLeft - 20;
}

async function action(name: string, data: unknown) {
  const r = await fetch(`/api/forum/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = (await r.json()) as any;
  if (!r.ok) throw new Error(result.error || "Please try again.");
  return result;
}
document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-like],[data-copy],[data-delete],[data-report],[data-video],[data-moderate],[data-read]");
  if (!button || button.hasAttribute("disabled")) return;
  const status = button.closest("article")?.querySelector<HTMLElement>("[data-post-status],[data-moderation-status]");
  if (status) status.textContent = "";
  try {
    if (button.dataset.video) {
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube-nocookie.com/embed/${button.dataset.video}`;
      iframe.title = button.getAttribute("aria-label") || "YouTube video";
      iframe.className = "video-frame";
      iframe.allow = "encrypted-media; picture-in-picture; fullscreen";
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      button.replaceWith(iframe);
      return;
    }
    if (button.dataset.copy) {
      button.setAttribute("disabled", "");
      await navigator.clipboard.writeText(new URL(button.dataset.copy, location.origin).href);
      if (status) status.textContent = "Link copied.";
      try {
        const r = await action("share", { id: button.dataset.share });
        document.querySelectorAll<HTMLElement>("[data-share]").forEach((control) => {
          if (control.dataset.share === button.dataset.share) {
            const span = control.querySelector("span");
            if (span) span.textContent = String(r.shares);
            control.setAttribute("aria-label", `Copy post link, ${r.shares} shares`);
          }
        });
      } catch {
        if (status) status.textContent = "Link copied, but the share count could not be updated.";
      }
      return;
    }
    if (button.dataset.like) {
      if (button.dataset.signedIn !== "true") {
        location.assign("/login");
        return;
      }
      button.setAttribute("disabled", "");
      const r = await action("like", { id: button.dataset.like, liked: button.getAttribute("aria-pressed") !== "true" });
      button.setAttribute("aria-pressed", String(r.liked));
      const span = button.querySelector("span");
      if (span) span.textContent = String(r.likes || "Like");
      const svg = button.querySelector("svg");
      svg?.setAttribute("fill", r.liked ? "currentColor" : "none");
      if (!r.liked && button.closest('[data-own-likes="true"]')) location.reload();
    }
    if (button.dataset.delete && confirm("Delete this post? Replies will remain visible.")) {
      await action("delete", { id: button.dataset.delete });
      location.reload();
    }
    if (button.dataset.report) {
      const reason = prompt("Why are you reporting this post? (5–1,000 characters)");
      if (reason) {
        await action("report", { id: button.dataset.report, reason });
        if (status) status.textContent = "Report sent. An administrator will review it.";
      }
    }
    if (button.dataset.moderate) {
      const messages: Record<string, string> = {
        resolve: "Resolve this report? This closes the report without changing the post or account.",
        delete: "Remove this post? Its text will be deleted. Replies will remain visible.",
        lock: "Lock this thread? Members will no longer be able to reply.",
        unlock: "Unlock this thread? Members will be able to reply again.",
        suspend: "Suspend this account? The member will no longer be able to post or interact.",
        restore: "Restore this account? The member will be able to participate again.",
      };
      const operation = button.dataset.operation!;
      if (confirm(messages[operation] || "Apply this moderation action?")) {
        const controls = button.closest("article")?.querySelectorAll<HTMLButtonElement>("[data-moderate]");
        controls?.forEach((control) => (control.disabled = true));
        try {
          await action("moderate", { id: button.dataset.moderate, operation });
          location.reload();
        } finally {
          controls?.forEach((control) => (control.disabled = false));
        }
      }
    }
    if (button.hasAttribute("data-read")) {
      await action("read", {});
      location.reload();
    }
  } catch (e) {
    if (status) status.textContent = (e as Error).message;
    else alert((e as Error).message);
  } finally {
    button.removeAttribute("disabled");
  }
});
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
  if (event.target.closest('a,button,input,textarea,select,label,details,summary,iframe,video,audio,[contenteditable],[role="button"],[role="link"]')) return;
  if (window.getSelection()?.toString()) return;
  const post = event.target.closest<HTMLElement>("[data-post-url]");
  const url = post?.dataset.postUrl;
  if (!url) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey) window.open(url, "_blank", "noopener");
  else location.assign(url);
});
document.addEventListener(
  "error",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.src.includes("/api/media/")) {
      const note = document.createElement("span");
      note.className = "notice";
      note.textContent = "Image unavailable. The original link is still available.";
      target.replaceWith(note);
    }
  },
  true
);
