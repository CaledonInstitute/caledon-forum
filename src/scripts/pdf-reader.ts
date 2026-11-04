import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = worker;

export function mountPdf(host: HTMLElement, url: string) {
  let closed = false;
  const tasks = new Set<{ cancel(): void }>();
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = "Loading PDF...";
  host.appendChild(status);
  const loading = getDocument({
    url,
    enableXfa: false,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  });
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          void renderPage(entry.target as HTMLElement);
        }
    },
    { root: host, rootMargin: "240px" }
  );
  async function renderPage(sheet: HTMLElement) {
    try {
      const pdf = await loading.promise;
      if (closed) return;
      const page = await pdf.getPage(Number(sheet.dataset.page));
      if (closed) return;
      const scale = Math.max(1, host.clientWidth - 16) / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      sheet.style.height = `${viewport.height}px`;
      sheet.style.setProperty("--total-scale-factor", String(scale));
      const canvas = document.createElement("canvas");
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      sheet.appendChild(canvas);
      const task = page.render({ canvas, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      tasks.add(task);
      await task.promise;
      tasks.delete(task);
      if (closed) return;
      const text = document.createElement("div");
      text.className = "textLayer";
      sheet.appendChild(text);
      const layer = new TextLayer({ textContentSource: await page.getTextContent(), container: text, viewport });
      if (closed) return;
      tasks.add(layer);
      await layer.render();
      tasks.delete(layer);
    } catch {
      if (!closed) sheet.textContent = "Could not display this page. Open in new tab to read it.";
    }
  }
  void loading.promise
    .then(async (pdf) => {
      if (closed) return;
      const first = await pdf.getPage(1);
      if (closed) return;
      const viewport = first.getViewport({ scale: 1 });
      status.remove();
      for (let i = 1; i <= pdf.numPages; i++) {
        const sheet = document.createElement("div");
        sheet.className = "pdf-sheet";
        sheet.dataset.page = String(i);
        sheet.setAttribute("aria-label", `Page ${i}`);
        sheet.style.height = `${(Math.max(1, host.clientWidth - 16) * viewport.height) / viewport.width}px`;
        host.appendChild(sheet);
        observer.observe(sheet);
      }
    })
    .catch(() => {
      if (!closed) status.textContent = "Could not read this PDF. Open in new tab to read it.";
    });
  return () => {
    closed = true;
    observer.disconnect();
    for (const task of tasks) task.cancel();
    tasks.clear();
    void loading.destroy().catch(() => {});
    host.replaceChildren();
  };
}
