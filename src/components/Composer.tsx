import UserAvatar from "./UserAvatar";
import MentionEditor from "./MentionEditor";
import PublishToast from "./PublishToast";
import QuoteCard from "./QuoteCard";
import { useCallback, useEffect, useRef, useState } from "react";
import { showPublishedPost } from "../lib/published-post";
import { countCharacters, MAX_CHARACTERS } from "../lib/content";
import type { LinkPreview, QuotedPost } from "../lib/types";
export default function Composer({
  parentId,
  initial = "",
  editId,
  name = "You",
  username,
  image,
}: {
  parentId?: string;
  initial?: string;
  editId?: string;
  name?: string;
  username?: string | null;
  image?: string | null;
}) {
  const [body, setBody] = useState(initial),
    [tab, setTab] = useState("write"),
    [html, setHtml] = useState(""),
    [links, setLinks] = useState<LinkPreview[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
  const [quoteStatus, setQuoteStatus] = useState("");
  useEffect(() => {
    setQuote(null);
    setQuoteStatus("");
    if (!/\/p\/[0-9]+/.test(body)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoteStatus("Loading quoted post…");
      try {
        const result = { quote: await (await import("../lib/client-content")).clientQuote(body) };
        if (controller.signal.aborted) return;
        setQuote(result.quote);
        setQuoteStatus("");
      } catch {
        if (!controller.signal.aborted) setQuoteStatus("Could not load the quote. Use Preview to try again.");
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body]);
  const count = countCharacters(body);
  async function request(action: string, data: unknown) {
    const response = await fetch(`/api/forum/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = (await response.json()) as any;
    if (!response.ok) throw new Error(result.error || "Please try again.");
    return result;
  }
  async function preview() {
    setBusy(true);
    setError("");
    try {
      if (body.trim()) {
        const r = await request("preview-data", { body });
        const rendered = await (await import("../lib/client-content")).clientRender(body, r.links);
        setHtml(rendered.html);
        setLinks(r.links);
        setQuote(rendered.quote);
        setQuoteStatus("");
      } else {
        setHtml("");
        setLinks([]);
        setQuote(null);
      }
      setTab("preview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (pending.current || busy) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await request(editId ? "edit" : "publish", { body, parentId, id: editId });
      if (editId) {
        location.assign(r.url || "/");
        return;
      }
      setBody("");
      setHtml("");
      setLinks([]);
      setQuote(null);
      setQuoteStatus("");
      setTab("write");
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
        <div className="composer-tabs" role="tablist">
          <button role="tab" disabled={busy} aria-selected={tab === "write"} onClick={() => setTab("write")}>
            Write
          </button>
          <button role="tab" disabled={busy} aria-selected={tab === "preview"} onClick={preview}>
            Preview
          </button>
        </div>
      </div>
      {tab === "write" ? (
        <MentionEditor value={body} onChange={setBody} disabled={busy} reply={!!parentId} />
      ) : (
        <div className="preview">
          <div className="post-content" dangerouslySetInnerHTML={{ __html: html }} />
          {!body.trim() && <p className="muted small">Your preview will appear here.</p>}
          {links
            .filter((p) => p.kind !== "image")
            .map((p) => (
              <a key={p.id} className="link-card" href={p.url} target="_blank" rel="ugc nofollow noopener">
                {p.image && <img src={`/api/media/${p.id}`} alt="" />}
                <div className="link-card-copy">
                  <small>{p.site}</small>
                  <strong>{p.title}</strong>
                  <p>{p.description}</p>
                </div>
              </a>
            ))}
        </div>
      )}
      {quote && <QuoteCard quote={quote} />}
      {quoteStatus && (
        <p className="quote-status" role="status">
          {quoteStatus}
        </p>
      )}
      <details className="composer-guide">
        <summary>Formatting help</summary>
        <pre>
          <code>
            {
              '**Bold** and *italic*\n<a href="https://example.com">Link</a>\n\n```python\nprint("Hello, Caledon")\n```\n\nInline math: $E = mc^2$\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$'
            }
          </code>
        </pre>
        <p>
          Type @username to mention someone. Paste a Caledon post or reply link to quote it. Use a language after the opening code fence for syntax highlighting. Basic HTML is
          supported; scripts and embedded content are removed.
        </p>
      </details>
      <p className="error" role="alert">
        {error}
      </p>
      <div className="composer-foot">
        <span className="composer-hint">Markdown, HTML, code & LaTeX</span>
        <span className="counter" aria-live="polite">
          {count.toLocaleString("en")} / 25,000
        </span>
        <button className="button" disabled={busy || !body.trim() || count > MAX_CHARACTERS} onClick={publish}>
          {busy ? "Working…" : editId ? "Save changes" : parentId ? "Reply" : "Post"}
        </button>
      </div>
      {notice && <PublishToast key={notice.url} {...notice} onClose={closeNotice} />}
    </section>
  );
}
