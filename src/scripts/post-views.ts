// Detail posts are counted by the server; only cards carry data-view-post.
const counted = new Set<string>();
const observed = new WeakSet<HTMLElement>();
function observePosts() {
  if (!("IntersectionObserver" in window)) return;
  document.querySelectorAll<HTMLElement>("[data-view-post]").forEach((post) => {
    if (observed.has(post)) return;
    observed.add(post);
    const id = post.dataset.viewPost!;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      cancel();
      if (!visible || document.visibilityState !== "visible" || counted.has(id)) return;
      timer = setTimeout(async () => {
        if (!visible || document.visibilityState !== "visible" || counted.has(id)) return;
        counted.add(id);
        observer.disconnect();
        document.removeEventListener("visibilitychange", schedule);
        try {
          const response = await fetch("/api/forum/view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          if (!response.ok) return;
          const result = (await response.json()) as { views: number };
          if (!Number.isSafeInteger(result.views) || result.views < 0) return;
          document.querySelectorAll<HTMLElement>("[data-view-post]").forEach((card) => {
            if (card.dataset.viewPost !== id) return;
            const control = card.querySelector<HTMLElement>(".post-views");
            const number = result.views.toLocaleString("en-US");
            control?.setAttribute("aria-label", `${number} ${result.views === 1 ? "view" : "views"}`);
            const label = control?.querySelector("span");
            if (label) label.textContent = number;
          });
        } catch {
          // Analytics failures must not interrupt reading or inflate counts through retries.
        }
      }, 1000);
    };
    // A quarter of a card works for long excerpts and small mobile viewports too.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
          schedule();
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -60px 0px" }
    );
    document.addEventListener("visibilitychange", schedule);
    observer.observe(post);
  });
}
observePosts();
document.addEventListener("forum:posts-updated", observePosts);
