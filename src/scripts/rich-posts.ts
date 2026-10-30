const observed = new WeakSet<Element>();
let renderer: Promise<typeof import("../lib/client-content")> | undefined;
let queue = Promise.resolve();
function enhance(element: HTMLElement) {
  queue = queue.then(async () => {
    try {
      renderer ||= import("../lib/client-content");
      await (await renderer).enhancePost(element);
    } catch (error) {
      console.warn("Rich content enhancement unavailable:", error instanceof Error ? error.message : "unknown error");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const observer =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              observer?.unobserve(entry.target);
              enhance(entry.target as HTMLElement);
            }
        },
        { rootMargin: "400px" }
      )
    : null;
function discover() {
  document.querySelectorAll<HTMLElement>("[data-rich-content]:not([data-rich-ready])").forEach((element) => {
    if (observed.has(element)) return;
    observed.add(element);
    if (observer) observer.observe(element);
    else enhance(element);
  });
}
discover();
document.addEventListener("forum:posts-updated", discover);
document.addEventListener("forum:quotes-updated", () => {
  if (renderer)
    queue = queue.then(async () => {
      try {
        await (await renderer!).refreshQuotes();
      } catch {}
    });
});
export {};
