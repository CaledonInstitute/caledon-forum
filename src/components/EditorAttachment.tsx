import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { fileUrl, type Attachment } from "../lib/upload-policy";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / 1048576).toFixed(1))} MB`;
}

export default function EditorAttachment({ file, disabled, onRemove }: { file: Attachment; disabled: boolean; onRemove: () => void }) {
  const [failed, setFailed] = useState(false);
  const player = useRef<HTMLMediaElement | null>(null);
  const image = file.mime.startsWith("image/");
  const video = file.mime.startsWith("video/");
  const audio = file.mime.startsWith("audio/");
  const media = image || video || audio;
  useEffect(() => {
    const element = player.current;
    return () => {
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, []);
  const remove = (
    <button type="button" className="icon-button editor-attachment-remove" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={onRemove}>
      <X size={17} />
    </button>
  );
  const details = (
    <span className="editor-file-details">
      <strong title={file.name}>{file.name}</strong>
      <small>{fileSize(file.size)}</small>
    </span>
  );
  if (!media)
    return (
      <div className="editor-file-card">
        <FileText size={19} aria-hidden="true" />
        {details}
        {remove}
      </div>
    );
  const src = fileUrl(file.id);
  return (
    <figure className={`editor-media editor-media-${image ? "image" : video ? "video" : "audio"}`}>
      {failed ? (
        <span className="editor-media-error" role="status">
          Preview unavailable. Remove the file and upload it again.
        </span>
      ) : image ? (
        <img src={src} alt={file.name} onError={() => setFailed(true)} />
      ) : video ? (
        <video
          ref={(element) => {
            player.current = element;
          }}
          src={src}
          controls
          preload="metadata"
          playsInline
          aria-label={file.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <audio
          ref={(element) => {
            player.current = element;
          }}
          src={src}
          controls
          preload="metadata"
          aria-label={file.name}
          onError={() => setFailed(true)}
        />
      )}
      <figcaption>{details}</figcaption>
      {remove}
    </figure>
  );
}
