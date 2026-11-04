import { observeMedia, disposeMedia } from "../lib/media-runtime";
import { useEffect, useState, useRef } from "react";
import { fileUrl, type Attachment, type PrivateAttachment } from "../lib/upload-policy";
import { decryptAttachment } from "../lib/client-uploads";
function AttachmentView({ file, url = fileUrl(file.id) }: { file: Attachment; url?: string }) {
  useEffect(() => {
    observeMedia();
  }, []);
  return (
    <figure className="attachment-view">
      {file.mime === "application/pdf" ? (
        <div className="pdf-inline" data-pdf={url} aria-label={file.name} />
      ) : file.mime.startsWith("image/") ? (
        <a href={url} target="_blank" rel="noopener" aria-label={`Open ${file.name}`}>
          <img src={url} alt={file.name} loading="lazy" />
        </a>
      ) : file.mime.startsWith("video/") ? (
        <video src={url} controls preload="metadata" playsInline aria-label={file.name} />
      ) : file.mime.startsWith("audio/") ? (
        <>
          <audio src={url} controls preload="metadata" aria-label={file.name} />
          <span className="media-duration" data-media-duration aria-label="Duration">
            Loading duration…
          </span>
        </>
      ) : null}
      <figcaption>
        {file.mime === "application/pdf" ? (
          <>
            <span>{file.name}</span>
            <a href={url.startsWith("blob:") ? url : `${url}?inline=1`} target="_blank" rel="noopener">
              Open in new tab
            </a>
          </>
        ) : (
          <a href={url} download={file.name}>
            {file.name}
          </a>
        )}
        <span>{(file.size / 1048576).toFixed(1)} MB</span>
      </figcaption>
    </figure>
  );
}
export function PrivateFile({ file }: { file: PrivateAttachment }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const openRef = useRef<() => void>(() => {});
  const active = useRef<AbortController | null>(null);
  const resource = useRef("");
  const locked = useRef(false);
  const media = /^(image|audio|video)\//.test(file.mime) || file.mime === "application/pdf";
  useEffect(() => {
    locked.current = false;
    const host = root.current;
    const clear = () => {
      locked.current = true;
      active.current?.abort();
      if (host) disposeMedia(host);
      if (resource.current) URL.revokeObjectURL(resource.current);
      resource.current = "";
      setUrl("");
    };
    const observer = new IntersectionObserver((entries) => {
      if (media && entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        openRef.current();
      }
    });
    if (root.current) observer.observe(root.current);
    document.addEventListener("forum:dm-locked", clear);
    return () => {
      observer.disconnect();
      document.removeEventListener("forum:dm-locked", clear);
      clear();
    };
  }, [file.id, media]);
  async function open() {
    if (locked.current || active.current || resource.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(fileUrl(file.id), { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("This attachment is unavailable.");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.size + 16) throw new Error("This attachment is incomplete.");
      const plain = await decryptAttachment(file, bytes);
      if (!controller.signal.aborted) {
        resource.current = URL.createObjectURL(new Blob([plain], { type: file.mime }));
        setUrl(resource.current);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  openRef.current = () => {
    void open();
  };
  return (
    <div className="private-attachment" ref={root}>
      {url ? (
        <AttachmentView file={file} url={url} />
      ) : busy || (media && !error) ? (
        <p className="small muted" role="status">
          Loading {file.name}...
        </p>
      ) : (
        <button type="button" className="text-button" disabled={busy || locked.current} onClick={() => void open()}>
          {error ? `Retry ${file.name}` : `Open ${file.name}`}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
