import { splitAttachments } from "../lib/attachment-markers";
import FileUpload from "./FileUpload";
import type { VisualEditorHandle } from "./VisualEditor";
import type { EditorDocument } from "../lib/editor-document";
import type { Attachment } from "../lib/upload-policy";
import UserAvatar from "./UserAvatar";
import PublishToast from "./PublishToast";
import QuoteCard from "./QuoteCard";
import ListingPreview from "./ListingPreview";
import type { ListingPreview as ProductPreview } from "../lib/listing-dom";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { showPublishedPost } from "../lib/published-post";
import { countCharacters, MAX_CHARACTERS } from "../lib/content";
import type { QuotedPost } from "../lib/types";
const VisualEditor = lazy(() => import("./VisualEditor"));
export default function Composer({
  initialAttachments = [],
  parentId,
  initial = "",
  initialDocument,
  editId,
  name = "You",
  username,
  image,
}: {
  initialAttachments?: Attachment[];
  parentId?: string;
  initial?: string;
  initialDocument?: EditorDocument;
  editId?: string;
  name?: string;
  username?: string | null;
  image?: string | null;
}) {
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => setEditorReady(true), []);
  // Keep removed assets available to undo; only document references are published.
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [uploadAvailable, setUploadAvailable] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [body, setBody] = useState(() => {
      if (typeof window !== "undefined" && !parentId && !editId) {
        const quote = new URLSearchParams(location.search).get("quote");
        if (quote && /^\/p\/[1-9][0-9]*$/.test(quote)) return new URL(quote, location.origin).href;
      }
      return initial;
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const editor = useRef<VisualEditorHandle>(null);
  const [editorDocument, setEditorDocument] = useState<EditorDocument | undefined>(initialDocument);
  const attachmentEditor = {
    onUploadStart: (files: { key: string; file: File }[]) => files.forEach(({ key, file }) => editor.current?.insertAttachment({ id: key, name: `Uploading ${file.name}…` })),
    onUploadComplete: (key: string, file: Attachment) => editor.current?.replaceAttachment(key, file),
    onUploadCancel: (key: string) => editor.current?.removeAttachment(key),
    onRemove: (file: Attachment) => editor.current?.removeAttachment(file.id),
  };
  const pending = useRef(false);
  const [threadState, setThreadState] = useState({ locked: false, deleted: false });
  useEffect(() => {
    if (!parentId) return;
    const apply = (event: Event) => {
      const state = (event as CustomEvent).detail;
      setThreadState({ locked: !!state?.locked, deleted: !!state?.deleted });
    };
    document.addEventListener("forum:thread-state", apply);
    if (document.body.dataset.threadState) setThreadState(JSON.parse(document.body.dataset.threadState));
    return () => document.removeEventListener("forum:thread-state", apply);
  }, [parentId]);
  const [notice, setNotice] = useState<{ message: string; url: string; persistent?: boolean } | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const [quote, setQuote] = useState<QuotedPost | null>(null);
  const [listing, setListing] = useState<ProductPreview | null>(null);
  const [quoteStatus, setQuoteStatus] = useState("");
  useEffect(() => {
    setQuote(null);
    setListing(null);
    setQuoteStatus("");
    if (!/(\/p\/[0-9]+|\/marketplace\/)/.test(body)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoteStatus("Loading preview…");
      try {
        const content = await import("../lib/client-content");
        const [quote, listing] = await Promise.all([content.clientQuote(body), content.clientListing(body)]);
        if (controller.signal.aborted) return;
        setQuote(quote);
        setListing(listing);
        setQuoteStatus("");
      } catch {
        if (!controller.signal.aborted) setQuoteStatus("Could not load the preview. Check the link and try again.");
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body]);
  const activeIds = new Set(splitAttachments(body).flatMap((part) => (part.type === "attachment" ? [part.id] : [])));
  const activeAttachments = [...activeIds].map((id) => attachments.find((a) => a.id === id)).filter((a): a is Attachment => !!a);
  const count = countCharacters(body);
  async function request(action: string, data: unknown) {
    const response = await fetch(`/api/forum/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = (await response.json()) as any;
    if (!response.ok) throw new Error(result.error || "Please try again.");
    return result;
  }
  async function publish() {
    if (pending.current || busy || uploading) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await request(editId ? "edit" : "publish", { body, document: editorDocument, parentId, id: editId, attachmentIds: activeAttachments.map((a) => a.id) });
      if (editId) {
        location.assign(r.url || "/");
        return;
      }
      editor.current?.clear();
      setEditorDocument(undefined);
      setBody("");
      setAttachments([]);
      setQuote(null);
      setListing(null);
      setQuoteStatus("");
      const message = parentId ? "Reply posted." : "Post published.";
      setNotice({ message, url: r.url });
      try {
        await showPublishedPost(r.url, parentId);
      } catch {
        setNotice({ message: `${message} Could not update this page. Open your ${parentId ? "reply" : "post"} to view it.`, url: r.url, persistent: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (threadState.locked || threadState.deleted)
    return (
      <section className="composer" id="reply">
        <p className="notice">
          {threadState.deleted ? "This post is no longer available for replies." : "This thread is locked. Your draft is preserved until you leave this page."}
        </p>
      </section>
    );
  return (
    <section className="composer" id={parentId ? "reply" : "compose"} aria-label={editId ? "Edit post" : parentId ? "Write a reply" : "Start a thread"}>
      <div className="composer-head">
        <UserAvatar name={name} username={username} image={image} />
        <strong>{editId ? "Edit your post" : parentId ? "Join the conversation" : "What are you exploring?"}</strong>
      </div>
      <Suspense fallback={<p className="muted small">Loading editor…</p>}>
        {editorReady && (
          <VisualEditor
            editorRef={editor}
            initial={body}
            initialDocument={editorDocument}
            initialAttachments={initialAttachments}
            onChange={(next, doc) => {
              setBody(next);
              setEditorDocument(doc);
            }}
            disabled={busy}
            attachmentsDisabled={!uploadAvailable || uploading || activeAttachments.length >= 4}
            reply={!!parentId}
          />
        )}
      </Suspense>
      <FileUpload
        purpose="post"
        inline
        value={activeAttachments}
        onChange={(files) => setAttachments((old) => [...old.filter((a) => !files.some((f) => f.id === a.id)), ...files])}
        onBusy={setUploading}
        onAvailability={setUploadAvailable}
        disabled={busy}
        {...attachmentEditor}
      />
      {quote && <QuoteCard quote={quote} />}
      {listing && <ListingPreview preview={listing} />}
      {quoteStatus && (
        <p className="quote-status" role="status">
          {quoteStatus}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      <div className="composer-foot">
        <span className="counter" aria-live="polite">
          {count.toLocaleString("en")} / 25,000
        </span>
        <button className="button" disabled={busy || uploading || (!body.trim() && !activeAttachments.length) || count > MAX_CHARACTERS} onClick={publish}>
          {busy ? "Working…" : editId ? "Save changes" : parentId ? "Reply" : "Post"}
        </button>
      </div>
      {notice && <PublishToast key={notice.url} {...notice} onClose={closeNotice} />}
    </section>
  );
}
