// One lifecycle for server-rendered posts, live updates, and React attachment views.
let watching = false;
const mounted = new Map<HTMLElement, () => void>();

function mountVideo(video: HTMLVideoElement) {
  let poster = "";
  let disposed = false;
  let seeking = false;
  const capture = () => {
    if (disposed || !seeking || !video.paused) return;
    seeking = false;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(video.videoWidth, 960);
      canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (disposed || !blob) return;
          poster = URL.createObjectURL(blob);
          video.poster = poster;
        },
        "image/jpeg",
        0.8
      );
      video.currentTime = 0;
    } catch {
      /* Native first-frame display remains available. */
    }
  };
  const prepare = () => {
    if (!video.paused || video.currentTime > 0 || video.poster || !Number.isFinite(video.duration)) return;
    seeking = true;
    video.currentTime = Math.min(0.1, video.duration / 2);
  };
  video.addEventListener("loadedmetadata", prepare, { once: true });
  video.addEventListener("seeked", capture);
  if (video.readyState >= 1) prepare();
  return () => {
    disposed = true;
    video.removeEventListener("loadedmetadata", prepare);
    video.removeEventListener("seeked", capture);
    video.pause();
    if (poster) URL.revokeObjectURL(poster);
  };
}

export function disposeMedia(root: HTMLElement) {
  for (const [element, dispose] of mounted)
    if (root === element || root.contains(element)) {
      dispose();
      mounted.delete(element);
    }
  root.querySelectorAll<HTMLMediaElement>("audio,video").forEach((media) => {
    media.pause();
    media.removeAttribute("src");
    media.load();
  });
}

export function observeMedia() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  const scan = () => {
    for (const [element, dispose] of mounted)
      if (!element.isConnected) {
        dispose();
        mounted.delete(element);
      }
    document.querySelectorAll<HTMLElement>(".pdf-inline[data-pdf], .attachment-view video, .attachment-view audio").forEach((element) => {
      if (mounted.has(element)) return;
      if (element instanceof HTMLVideoElement) mounted.set(element, mountVideo(element));
      else if (element instanceof HTMLAudioElement) {
        const label = element.closest("figure")?.querySelector<HTMLElement>("[data-media-duration]");
        const update = () => {
          if (!label) return;
          const duration = element.duration;
          label.textContent = Number.isFinite(duration) ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}` : "Duration unavailable";
        };
        element.addEventListener("loadedmetadata", update);
        element.addEventListener("durationchange", update);
        if (element.readyState >= 1) update();
        mounted.set(element, () => {
          element.pause();
          element.removeEventListener("loadedmetadata", update);
          element.removeEventListener("durationchange", update);
        });
      } else {
        let dispose: (() => void) | undefined;
        let closed = false;
        const observer = new IntersectionObserver(
          (entries) => {
            if (!entries.some((e) => e.isIntersecting)) return;
            observer.disconnect();
            void import("../scripts/pdf-reader")
              .then(({ mountPdf }) => {
                if (!closed && element.isConnected) {
                  let reader = mountPdf(element, element.dataset.pdf!);
                  let width = element.clientWidth;
                  const resize = new ResizeObserver(() => {
                    if (element.clientWidth === width || !element.clientWidth) return;
                    width = element.clientWidth;
                    reader();
                    reader = mountPdf(element, element.dataset.pdf!);
                  });
                  resize.observe(element);
                  dispose = () => {
                    resize.disconnect();
                    reader();
                  };
                }
              })
              .catch(() => {
                if (!closed) element.textContent = "Could not load PDF. Open in new tab to read it.";
              });
          },
          { rootMargin: "300px" }
        );
        observer.observe(element);
        mounted.set(element, () => {
          closed = true;
          observer.disconnect();
          dispose?.();
        });
      }
    });
  };
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
}
