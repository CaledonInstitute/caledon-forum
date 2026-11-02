import { useEffect, useState } from "react";
import { fileUrl, type Attachment, type PrivateAttachment } from "../lib/upload-policy";
import { decryptAttachment } from "../lib/client-uploads";
export function AttachmentView({ file, url = fileUrl(file.id) }: { file: Attachment; url?: string }) {
  return (
    <figure className="attachment-view">
      {file.mime.startsWith("image/") ? (
        <a href={url} target="_blank" rel="noopener" aria-label={`Open ${file.name}`}>
          <img src={url} alt={file.name} loading="lazy" />
        </a>
      ) : file.mime.startsWith("video/") ? (
        <video src={url} controls preload="none" playsInline aria-label={file.name} />
      ) : file.mime.startsWith("audio/") ? (
        <audio src={url} controls preload="none" aria-label={file.name} />
      ) : null}
      <figcaption>
        <a href={url} download={file.name}>
          {file.name}
        </a>
        <span>{(file.size / 1048576).toFixed(1)} MB</span>
      </figcaption>
    </figure>
  );
}
export default function Attachments({ files }: { files: Attachment[] }) {
  return (
    <div className="post-attachments">
      {files.map((file) => (
        <AttachmentView key={file.id} file={file} />
      ))}
    </div>
  );
}
export function PrivateFile({ file }: { file: PrivateAttachment }) {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    const clear = () => {
      controller.abort();
      setUrl("");
    };
    document.addEventListener("forum:dm-locked", clear);
    return () => {
      controller.abort();
      document.removeEventListener("forum:dm-locked", clear);
    };
  }, [controller]);
  useEffect(() => {
    if (url) return () => URL.revokeObjectURL(url);
  }, [url]);
  async function open() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(fileUrl(file.id), { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("This attachment is unavailable.");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.size + 16) throw new Error("This attachment is incomplete.");
      const plain = await decryptAttachment(file, bytes);
      if (!controller.signal.aborted) setUrl(URL.createObjectURL(new Blob([plain], { type: file.mime })));
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="private-attachment">
      {url ? (
        <AttachmentView file={file} url={url} />
      ) : (
        <button type="button" className="text-button" disabled={busy} onClick={() => void open()}>
          {busy ? "Opening attachment…" : `Open ${file.name}`}
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
