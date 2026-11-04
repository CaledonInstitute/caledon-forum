import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = worker;
export async function openPdf(url: string, name: string, opener: HTMLElement) {
  const dialog = document.createElement("dialog");
  dialog.className = "pdf-reader";
  dialog.setAttribute("aria-label", name);
  const head = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = name;
  const controls = document.createElement("div");
  controls.className = "pdf-controls";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const stage = document.createElement("div");
  stage.className = "pdf-stage";
  const sheet = document.createElement("div");
  sheet.className = "pdf-sheet";
  const canvas = document.createElement("canvas");
  const text = document.createElement("div");
  text.className = "textLayer";
  sheet.appendChild(canvas);
  sheet.appendChild(text);
  stage.appendChild(sheet);
  let pdf: PDFDocumentProxy | undefined,
    page = 1,
    zoom = 1,
    renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined,
    textTask: TextLayer | undefined,
    renderId = 0,
    closed = false;
  const button = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.onclick = fn;
    controls.appendChild(b);
    return b;
  };
  const previous = button("Previous", () => {
    if (page > 1) {
      page--;
      void render();
    }
  });
  const pageLabel = document.createElement("span");
  controls.appendChild(pageLabel);
  const next = button("Next", () => {
    if (pdf && page < pdf.numPages) {
      page++;
      void render();
    }
  });
  button("Zoom out", () => {
    zoom = Math.max(0.5, zoom - 0.25);
    void render();
  });
  button("Zoom in", () => {
    zoom = Math.min(3, zoom + 0.25);
    void render();
  });
  const download = document.createElement("a");
  download.href = url;
  download.download = name;
  download.textContent = "Download";
  controls.appendChild(download);
  const direct = document.createElement("a");
  direct.href = url + "?inline=1";
  direct.target = "_blank";
  direct.rel = "noopener";
  direct.textContent = "Open directly";
  controls.appendChild(direct);
  button("Close", () => dialog.close());
  head.appendChild(title);
  head.appendChild(controls);
  dialog.appendChild(head);
  dialog.appendChild(status);
  dialog.appendChild(stage);
  document.body.appendChild(dialog);
  previous.disabled = next.disabled = true;
  const loading = getDocument({
    url,
    enableXfa: false,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  });
  dialog.addEventListener("close", () => {
    closed = true;
    renderId++;
    renderTask?.cancel();
    textTask?.cancel();
    void loading.destroy().catch(() => {});
    dialog.remove();
    opener.focus();
  });
  dialog.showModal();
  status.textContent = "Loading PDF…";
  async function render() {
    if (!pdf || closed) return;
    const id = ++renderId;
    renderTask?.cancel();
    textTask?.cancel();
    previous.disabled = page <= 1;
    next.disabled = page >= pdf.numPages;
    pageLabel.textContent = `${page} / ${pdf.numPages}`;
    try {
      const pdfPage = await pdf.getPage(page);
      if (id !== renderId || closed) return;
      const original = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(1.5, (stage.clientWidth - 32) / original.width) * zoom;
      const viewport = pdfPage.getViewport({ scale });
      sheet.style.width = `${viewport.width}px`;
      sheet.style.height = `${viewport.height}px`;
      sheet.style.setProperty("--scale-factor", String(scale));
      sheet.style.setProperty("--total-scale-factor", String(scale));
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable.");
      renderTask = pdfPage.render({ canvas, canvasContext: ctx, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await renderTask.promise;
      if (id !== renderId || closed) return;
      const content = await pdfPage.getTextContent();
      if (id !== renderId || closed) return;
      text.replaceChildren();
      textTask = new TextLayer({ textContentSource: content, container: text, viewport });
      await textTask.render();
      if (id === renderId) status.textContent = "";
    } catch (e) {
      if (id === renderId && !closed) status.textContent = "Could not display this page. Use Download or Open directly.";
    }
  }
  try {
    pdf = await loading.promise;
    if (!closed) await render();
  } catch (e) {
    if (!closed)
      status.textContent =
        (e as Error).name === "PasswordException" ? "This PDF requires a password. Download it or open it directly." : "Could not read this PDF. Download it or open it directly.";
  }
}
