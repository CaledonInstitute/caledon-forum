import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Paperclip, X, RotateCcw } from "lucide-react";
import { filePolicy, fileUrl, MAX_FILES, MAX_TOTAL, type Attachment, type UploadPurpose, type PrivateAttachment } from "../lib/upload-policy";
import { uploadFile, uploadRequest } from "../lib/client-uploads";
import EditorAttachment from "./EditorAttachment";
type Item = { key: string; file: File; preview?: string; progress: number; error?: string; assetId?: string; controller: AbortController };
export default function FileUpload({
  purpose,
  inline = false,
  value,
  onChange,
  onBusy,
  onAvailability,
  disabled = false,
  imagesOnly = false,
  conversationId,
  onUploadStart,
  onUploadComplete,
  onUploadCancel,
  onInsert,
  onRemove,
}: {
  purpose: UploadPurpose;
  inline?: boolean;
  value: (Attachment | PrivateAttachment)[];
  onChange: (files: (Attachment | PrivateAttachment)[]) => void;
  onBusy?: (busy: boolean) => void;
  onAvailability?: (enabled: boolean) => void;
  disabled?: boolean;
  imagesOnly?: boolean;
  conversationId?: string;
  onUploadStart?: (files: { key: string; file: File }[]) => void;
  onUploadComplete?: (key: string, file: Attachment | PrivateAttachment) => void;
  onUploadCancel?: (key: string) => void;
  onInsert?: (file: Attachment) => void;
  onRemove?: (file: Attachment) => void;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [error, setError] = useState(""),
    [enabled, setEnabled] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    current = useRef(items),
    values = useRef(value),
    change = useRef(onChange);
  values.current = value;
  change.current = onChange;
  current.current = items;
  const single = purpose === "avatar" || purpose === "cover";
  useEffect(() => {
    alive.current = true;
    void uploadRequest("", "GET")
      .then((r) => {
        if (alive.current) setEnabled(r.enabled);
      })
      .catch(() => {
        if (alive.current) setEnabled(false);
      });
    return () => {
      alive.current = false;
      for (const i of current.current) {
        i.controller.abort();
        if (i.preview) URL.revokeObjectURL(i.preview);
        if (i.assetId) void uploadRequest(`/${i.assetId}`, "DELETE").catch(() => {});
      }
    };
  }, []);
  const update = (key: string, patch: Partial<Item>) => {
    if (alive.current) setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  };
  function removeItem(item: Item) {
    onUploadCancel?.(item.key);
    item.controller.abort();
    if (item.preview) URL.revokeObjectURL(item.preview);
    if (item.assetId) void uploadRequest(`/${item.assetId}`, "DELETE").catch(() => {});
    setItems((list) => list.filter((i) => i.key !== item.key));
  }
  async function transfer(item: Item) {
    try {
      const result = await uploadFile(
        item.file,
        purpose,
        conversationId,
        item.controller.signal,
        (n) => update(item.key, { progress: n }),
        (id) => {
          item.assetId = id;
          update(item.key, { assetId: id });
        }
      );
      if (!alive.current || item.controller.signal.aborted) {
        if (item.assetId) void uploadRequest(`/${item.assetId}`, "DELETE").catch(() => {});
        return;
      }
      const next = single ? [result] : [...values.current, result];
      values.current = next;
      change.current(next);
      onUploadComplete?.(item.key, result);
      if (item.preview) URL.revokeObjectURL(item.preview);
      setItems((list) => list.filter((i) => i.key !== item.key));
    } catch (e) {
      if (alive.current && !item.controller.signal.aborted) update(item.key, { error: (e as Error).message });
    }
  }
  function choose(files: File[]) {
    if (!enabled || disabled || items.some((i) => !i.error)) return;
    setError("");
    const chosen = single ? files.slice(0, 1) : files;
    try {
      if (!single && value.length + items.length + chosen.length > MAX_FILES) throw new Error("Attach up to four files.");
      if (!single && [...value, ...items.map((i) => i.file), ...chosen].reduce((n, f) => n + f.size, 0) > MAX_TOTAL) throw new Error("Keep attachments within 100 MB in total.");
      for (const file of chosen) {
        const mime = filePolicy(file.name, file.size, purpose);
        if (imagesOnly && !mime.startsWith("image/")) throw new Error("Choose JPEG, PNG, GIF, or WebP photos.");
      }
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const next = chosen.map((file) => ({
      key: inline ? `pending-${crypto.randomUUID()}` : crypto.randomUUID(),
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      progress: 0,
      controller: new AbortController(),
    }));
    onUploadStart?.(next);
    setItems((list) => [...list, ...next]);
    // Serialize files; multiple widgets/devices are still limited server-side.
    void (async () => {
      for (const item of next) {
        if (!alive.current) break;
        if (item.controller.signal.aborted) continue;
        await transfer(item);
      }
    })();
  }
  useEffect(() => {
    const host = root.current?.closest(".composer, .dm-compose");
    const paste = (event: Event) => {
      const e = event as ClipboardEvent;
      if (root.current?.contains(e.target as Node) || !enabled) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        e.preventDefault();
        choose(files);
      }
    };
    const dragover = (event: Event) => {
      if ((event as DragEvent).dataTransfer?.types.includes("Files") && enabled) event.preventDefault();
    };
    const drop = (event: Event) => {
      if (root.current?.contains(event.target as Node) || !enabled) return;
      const files = Array.from((event as DragEvent).dataTransfer?.files || []);
      if (files.length) {
        event.preventDefault();
        choose(files);
      }
    };
    host?.addEventListener("paste", paste);
    host?.addEventListener("dragover", dragover);
    host?.addEventListener("drop", drop);
    return () => {
      host?.removeEventListener("paste", paste);
      host?.removeEventListener("dragover", dragover);
      host?.removeEventListener("drop", drop);
    };
  });
  useEffect(() => {
    onAvailability?.(enabled === true);
  }, [enabled]);
  const working = items.some((i) => !i.error);
  useEffect(() => {
    onBusy?.(items.length > 0);
  }, [items.length]);
  const present = (key: string, content: React.ReactNode) => {
    if (!inline) return content;
    const node = root.current?.closest(".composer")?.querySelector<HTMLElement>(`[data-attachment="${key}"]`);
    return node ? createPortal(content, node) : null;
  };
  return (
    <div
      ref={root}
      className={`file-upload${inline ? " file-upload-inline" : ""}${single ? " file-upload-single" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (enabled) choose(Array.from(e.dataTransfer.files));
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length && enabled) {
          e.preventDefault();
          choose(files);
        }
      }}
    >
      <input
        ref={input}
        className="sr-only"
        type="file"
        tabIndex={-1}
        aria-label={single ? "Choose image" : "Choose attachments"}
        multiple={!single}
        accept={single || imagesOnly ? ".jpg,.jpeg,.png,.gif,.webp" : ".jpg,.jpeg,.png,.gif,.webp,.pdf,.zip,.txt,.mp4,.webm,.mp3,.m4a,.ogg,.wav"}
        onChange={(e) => {
          choose(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      {!inline && (
        <button
          type="button"
          className="button secondary attachment-add"
          disabled={disabled || working || !enabled || (!single && value.length >= MAX_FILES)}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={16} />
          {single ? (purpose === "cover" ? "Choose cover" : "Choose photo") : "Add files"}
        </button>
      )}
      {!inline && (
        <>
          <span className="help">
            {enabled === false ? "Uploads are not configured yet." : single ? "JPEG, PNG, GIF or WebP · up to 2 MB" : "Drop files or paste an image · up to 4 files / 100 MB"}
          </span>
        </>
      )}
      {value.length > 0 && !single && (
        <div className="attachment-list">
          {value.map((file) =>
            present(
              file.id,
              inline && purpose === "post" ? (
                <EditorAttachment
                  key={file.id}
                  file={file}
                  disabled={disabled || working}
                  onRemove={() => {
                    onRemove?.(file);
                    onChange(value.filter((v) => v.id !== file.id));
                  }}
                />
              ) : (
                <div key={file.id} className="attachment-draft">
                  {file.mime.startsWith("image/") && purpose !== "dm" && <img src={fileUrl(file.id)} alt="" />}
                  <span>
                    <strong>{file.name}</strong>
                    <small>{(file.size / 1048576).toFixed(1)} MB</small>
                  </span>
                  {onInsert && !inline && (
                    <button type="button" className="text-button small" disabled={disabled || working} onClick={() => onInsert(file)}>
                      Insert
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    disabled={disabled || working}
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      onRemove?.(file);
                      onChange(value.filter((v) => v.id !== file.id));
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
              )
            )
          )}
        </div>
      )}
      {items.map((item) =>
        present(
          item.key,
          <div key={item.key} className="attachment-draft">
            {item.preview && <img src={item.preview} alt="" />}
            <span>
              <strong>{item.file.name}</strong>
              {item.error ? (
                <small className="error" role="alert">
                  {item.error}
                </small>
              ) : (
                <>
                  <progress max="100" value={item.progress} aria-label={`Uploading ${item.file.name}`} />
                  <small role="status">{item.progress}% uploaded</small>
                </>
              )}
            </span>
            {item.error && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Retry ${item.file.name}`}
                disabled={working || disabled}
                onClick={() => {
                  if (item.assetId) void uploadRequest(`/${item.assetId}`, "DELETE").catch(() => {});
                  item.controller = new AbortController();
                  item.assetId = undefined;
                  update(item.key, { error: undefined, progress: 0, controller: item.controller, assetId: undefined });
                  void transfer(item);
                }}
              >
                <RotateCcw size={17} />
              </button>
            )}
            <button type="button" className="icon-button editor-attachment-remove" aria-label={`Cancel ${item.file.name}`} onClick={() => removeItem(item)}>
              <X size={17} />
            </button>
          </div>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
