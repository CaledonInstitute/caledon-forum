import { fileUrl, type Attachment } from "./upload-policy";
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function attachmentHtml(file: Attachment) {
  const url = fileUrl(file.id),
    name = escape(file.name);
  const media =
    file.mime === "application/pdf"
      ? `<div class="pdf-inline" data-pdf="${url}" aria-label="${name}"></div>`
      : file.mime.startsWith("image/")
        ? `<a href="${url}" target="_blank" rel="noopener" aria-label="Open ${name}"><img src="${url}" alt="${name}" loading="lazy"></a>`
        : file.mime.startsWith("video/")
          ? `<video src="${url}" controls preload="metadata" playsinline aria-label="${name}"></video>`
          : file.mime.startsWith("audio/")
            ? `<audio src="${url}" controls preload="metadata" aria-label="${name}"></audio><span class="media-duration" data-media-duration aria-label="Duration">Loading duration…</span>`
            : "";
  return `<figure class="attachment-view">${media}<figcaption>${file.mime === "application/pdf" ? `<span>${name}</span><a href="${url}?inline=1" target="_blank" rel="noopener">Open in new tab</a>` : `<a href="${url}" download="${name}">${name}</a>`}<span>${(file.size / 1048576).toFixed(1)} MB</span></figcaption></figure>`;
}
