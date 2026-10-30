import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import { createIdentity, unlockPrivate, rememberIdentity, recalledIdentity, forgetIdentity, encryptMessage, decryptMessage, type Identity, type Payload } from "../lib/dm-crypto";

import QuoteCard from "./QuoteCard";
import UserAvatar from "./UserAvatar";
import { Info, X, LockKeyhole, UserRound, ShieldBan, ArrowLeft } from "lucide-react";

import type { QuotedPost } from "../lib/types";
import { refreshInbox, subscribeInbox, type InboxItem } from "../lib/dm-inbox";

export async function dmRequest(action: string, data: Record<string, unknown> = {}, write = false) {
  const query = new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const response = await fetch(
    `/api/dm/${action}${write ? "" : "?" + query}`,
    write ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : { cache: "no-store" }
  );
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load messages. Try again.");
  return result;
}

function SharedPost({ path }: { path: string }) {
  const [quote, setQuote] = useState<QuotedPost | null>(null);
  useEffect(() => {
    let active = true;
    import("../lib/client-content")
      .then((m) => m.clientQuote(new URL(path, location.origin).href))
      .then((q) => {
        if (active) setQuote(q);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [path]);
  return quote ? (
    <QuoteCard quote={quote} />
  ) : (
    <a className="text-link" href={path}>
      Open shared post
    </a>
  );
}

function MessageText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} className="text-link" href={part} target="_blank" rel="noopener noreferrer nofollow">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

type InboxProps = {
  inbox: InboxItem[];
  conversationId?: string;
  sharedPost?: string;
  query: string;
  setQuery: (value: string) => void;
  users: any[];
  busy: boolean;
  onOpen: (username: string) => void;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
};
const ConversationRow = memo(function ConversationRow({
  item,
  selected,
  sharedPost,
  onNavigate,
}: {
  item: InboxItem;
  selected: boolean;
  sharedPost?: string;
  onNavigate: InboxProps["onNavigate"];
}) {
  return (
    <a href={`/dm/${item.id}${sharedPost ? "?share=" + encodeURIComponent(sharedPost) : ""}`} onClick={onNavigate} aria-current={selected ? "page" : undefined}>
      <UserAvatar name={item.name} username={item.username} image={item.image} />
      <span className="dm-person-copy">
        <strong>{item.name}</strong>
        <span className="muted small">@{item.username}</span>
      </span>
      {!!item.unread && (
        <span className="dm-unread-count" aria-label={`${item.unread} unread messages`}>
          {item.unread}
        </span>
      )}
    </a>
  );
});
const ConversationList = memo(function ConversationList({ inbox, conversationId, sharedPost, query, setQuery, users, busy, onOpen, onNavigate }: InboxProps) {
  return (
    <aside className="dm-inbox" aria-label="Inbox">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (users[0]) onOpen(users[0].username);
        }}
      >
        <label>
          New message
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a username" maxLength={30} />
        </label>
      </form>

      {query && (
        <div className="dm-user-results">
          {users.length ? (
            users.map((u) => (
              <button key={u.id} disabled={busy} onClick={() => onOpen(u.username)}>
                <UserAvatar name={u.name} username={u.username} image={u.image} />
                <span className="dm-person-copy">
                  <strong>{u.name}</strong>
                  <span className="muted small">@{u.username}</span>
                </span>
              </button>
            ))
          ) : (
            <p className="small muted">No users with DM enabled found.</p>
          )}
        </div>
      )}

      <nav aria-label="Conversations">
        {inbox.map((item) => (
          <ConversationRow key={item.id} item={item} selected={item.id === conversationId} sharedPost={sharedPost} onNavigate={onNavigate} />
        ))}
      </nav>
      {!inbox.length && <p className="muted small">Find someone to start a conversation.</p>}
    </aside>
  );
});

export default function DirectMessages({ conversationId: initialConversationId }: { conversationId?: string }) {
  const [route, setRoute] = useState(() =>
    typeof location === "undefined" ? `/dm${initialConversationId ? "/" + initialConversationId : ""}` : location.pathname + location.search
  );
  const routeUrl = new URL(route, "https://dm.local");
  const conversationId = routeUrl.pathname.match(/^\/dm\/([^/]+)$/)?.[1];
  const [loading, setLoading] = useState(false);
  const drafts = useRef(new Map<string, string>());
  const pendingMessages = useRef(new Map<string, any>());
  const epoch = useRef(0);
  const loadSerial = useRef(0);
  const selected = useRef(conversationId);
  const inboxRef = useRef<InboxItem[]>([]);
  const messagesRef = useRef<any[]>([]);
  const refreshRunning = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const [vault, setVault] = useState<any>(null),
    [identity, setIdentity] = useState<Identity | null>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [inbox, setInbox] = useState<InboxItem[]>([]),
    [peer, setPeer] = useState<any>(null),
    [messages, setMessages] = useState<any[]>([]),
    [text, setText] = useState(""),
    [query, setQuery] = useState(""),
    [users, setUsers] = useState<any[]>([]),
    [blocked, setBlocked] = useState(false),
    [ownBlocked, setOwnBlocked] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [keyChanged, setKeyChanged] = useState(false),
    [fingerprint, setFingerprint] = useState(""),
    [ownFingerprint, setOwnFingerprint] = useState("");

  const detailsRef = useRef<HTMLDialogElement>(null);
  const detailsOpener = useRef<HTMLButtonElement | null>(null);
  function openDetails(button: HTMLButtonElement) {
    detailsOpener.current = button;
    detailsRef.current?.showModal();
  }
  const historyRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const identityRef = useRef<Identity | null>(null);
  inboxRef.current = inbox;
  messagesRef.current = messages;

  const shared = routeUrl.searchParams.get("share");

  const sharedPost = shared && /^\/p\/[1-9][0-9]*$/.test(shared) ? shared : undefined;

  const changeRoute = useCallback((url: string, push = true) => {
    const target = new URL(url, location.origin);
    const id = target.pathname.match(/^\/dm\/([^/]+)$/)?.[1];
    if (id === selected.current) {
      if (push) history.pushState(null, "", target.pathname + target.search);
      setRoute(target.pathname + target.search);
      return;
    }
    epoch.current++;
    selected.current = id;
    detailsRef.current?.close();
    setPeer(null);
    setMessages([]);
    messagesRef.current = [];
    setHasMore(false);
    setBlocked(false);
    setOwnBlocked(false);
    setKeyChanged(false);
    setFingerprint("");
    setError("");
    setText(id ? drafts.current.get(id) || "" : "");
    setLoading(!!id);
    follow.current = true;
    if (push) history.pushState(null, "", target.pathname + target.search);
    setRoute(target.pathname + target.search);
  }, []);
  const onNavigate = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      event.preventDefault();
      const target = new URL(event.currentTarget.href);
      if (target.pathname + target.search !== location.pathname + location.search) changeRoute(target.href);
    },
    [changeRoute]
  );
  const openRef = useRef<(username: string) => Promise<void>>(async () => {});
  const onOpen = useCallback((username: string) => {
    void openRef.current(username);
  }, []);

  function clearPrivateState() {
    epoch.current++;
    identityRef.current = null;
    drafts.current.clear();
    pendingMessages.current.clear();
    setIdentity(null);
    setMessages([]);
    messagesRef.current = [];
    setPeer(null);
    setPassword("");
    setText("");
    setOwnFingerprint("");
    setFingerprint("");
    setLoading(false);
    detailsRef.current?.close();
  }

  async function perform(work: () => Promise<void>) {
    if (busy) return;
    const operationEpoch = epoch.current;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (operationEpoch === epoch.current) setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMessages(key: Identity, older = false) {
    const id = selected.current;
    if (!id) return;
    const generation = epoch.current;
    const serial = ++loadSerial.current;
    const valid = () => generation === epoch.current && serial === loadSerial.current && identityRef.current === key && selected.current === id;
    if (older) follow.current = false;
    try {
      const result = await dmRequest("messages", {
        conversationId: id,
        ...(older && messagesRef.current.length ? { before: Math.min(...messagesRef.current.map((m) => m.seq)) } : {}),
      });
      if (!valid()) return;
      const fp = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.peer.publicKey || ""))), (n) =>
        n.toString(16).padStart(2, "0")
      ).join("");
      const known = new Map(messagesRef.current.map((message) => [message.id, message]));
      const items = await Promise.all(
        result.items
          .slice(0, 50)
          .reverse()
          .map(async (m: any) => {
            const previous = known.get(m.id);
            if (
              previous &&
              previous.envelopes === m.envelopes &&
              previous.sender_public_key === m.sender_public_key &&
              previous.sender_id === m.sender_id &&
              previous.conversation_id === m.conversation_id &&
              previous.sender_version === m.sender_version &&
              previous.recipient_version === m.recipient_version
            )
              return previous;
            try {
              return { ...m, payload: await decryptMessage(key, m, result.peer.id) };
            } catch {
              return { ...m, unavailable: true };
            }
          })
      );
      if (!valid()) return;
      const pinned = localStorage.getItem(`dm-peer-${key.userId}-${result.peer.id}`);
      setPeer(result.peer);
      setBlocked(result.blocked);
      setOwnBlocked(result.ownBlocked);
      setFingerprint(fp);
      setKeyChanged(!!pinned && pinned !== fp);
      if (!pinned) localStorage.setItem(`dm-peer-${key.userId}-${result.peer.id}`, fp);
      setMessages((previous) => {
        const merged = new Map([...previous, ...items].map((m) => [m.id, m]));
        const next = [...merged.values()].sort((a, b) => a.seq - b.seq);
        return next.length === previous.length && next.every((item, i) => item === previous[i]) ? previous : next;
      });
      setHasMore(result.items.length > 50);
      setLoading(false);
      const entry = inboxRef.current.find((item) => item.id === id);
      if (!older && items.length && document.visibilityState === "visible" && (!entry || entry.unread > 0)) {
        await dmRequest("read", { conversationId: id, seq: items.at(-1).seq }, true);
        await refreshInbox(true);
      }
    } catch (error) {
      if (valid()) {
        setLoading(false);
        throw error;
      }
    }
  }

  async function refresh() {
    if (document.visibilityState !== "visible") return;
    if (refreshRunning.current) {
      refreshAgain.current = true;
      return refreshRunning.current;
    }
    const generation = epoch.current;
    const work = async () => {
      const [state] = await Promise.all([dmRequest("vault"), refreshInbox()]);
      if (generation !== epoch.current) return;
      setVault(state);
      if (!state.publicKey || (identityRef.current && (identityRef.current.version !== state.version || identityRef.current.userId !== state.userId))) {
        clearPrivateState();
        await forgetIdentity(state.userId);
        return;
      }
      const existing = identityRef.current;
      const key = existing || (await recalledIdentity(state.userId, state.version, state.publicKey));
      if (generation !== epoch.current) return;
      if (key) {
        identityRef.current = key;
        setIdentity(key);
        if (existing) await loadMessages(key);
      }
    };
    refreshRunning.current = work().finally(() => {
      refreshRunning.current = null;
      if (refreshAgain.current) {
        refreshAgain.current = false;
        void refreshRef.current().catch((e) => setError(e.message));
      }
    });
    return refreshRunning.current;
  }
  refreshRef.current = refresh;

  useEffect(() => {
    const unsubscribe = subscribeInbox((result) => {
      inboxRef.current = result.items;
      setInbox(result.items);
    });
    const refreshEvent = () => {
      void refreshRef.current().catch(async (e) => {
        if (/Sign in|active account/.test(e.message)) {
          clearPrivateState();
          await forgetIdentity();
        }
        setError(e.message);
      });
    };
    refreshEvent();
    const locked = () => clearPrivateState();
    const pop = () => changeRoute(location.href, false);
    const timer = setInterval(() => {
      if (document.body.dataset.realtimeConnected !== "true") refreshEvent();
    }, 30000);
    document.addEventListener("visibilitychange", refreshEvent);
    document.addEventListener("forum:dm-updated", refreshEvent);
    document.addEventListener("forum:dm-locked", locked);
    window.addEventListener("popstate", pop);
    return () => {
      epoch.current++;
      unsubscribe();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshEvent);
      document.removeEventListener("forum:dm-updated", refreshEvent);
      document.removeEventListener("forum:dm-locked", locked);
      window.removeEventListener("popstate", pop);
      identityRef.current = null;
    };
  }, [changeRoute]);

  useEffect(() => {
    if (!identity || !conversationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadMessages(identity).catch((e) => setError(e.message));
  }, [conversationId, identity]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      dmRequest("users", { query })
        .then((r) => {
          if (active) setUsers(r.items);
        })
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (follow.current && historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    let active = true;
    if (identity)
      void crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity.publicKey))).then((hash) => {
        if (active) setOwnFingerprint(Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join(""));
      });
    return () => {
      active = false;
    };
  }, [identity]);
  async function openConversation(username: string) {
    const generation = epoch.current;
    const result = await dmRequest("conversation", { username }, true);
    if (generation !== epoch.current) return;
    changeRoute(`/dm/${result.id}${sharedPost ? "?share=" + encodeURIComponent(sharedPost) : ""}`);
    await refreshInbox(true);
  }

  openRef.current = (username) => perform(() => openConversation(username));

  useEffect(() => {
    if (!identity || conversationId) return;
    const to = new URLSearchParams(location.search).get("to");
    if (to) void perform(() => openConversation(to));
  }, [identity]);

  async function unlock() {
    if (!vault) return;
    const generation = epoch.current;

    let key: Identity;

    if (vault.vault) key = { userId: vault.userId, version: vault.version, publicKey: vault.publicKey, privateKey: await unlockPrivate(vault.vault, password) };
    else {
      const created = await createIdentity(vault.userId, vault.version, password);
      await dmRequest("vault", { password, version: vault.version, publicKey: created.identity.publicKey, vault: created.vault }, true);
      key = created.identity;
    }

    if (generation !== epoch.current) return;
    await rememberIdentity(key);
    if (generation !== epoch.current) {
      await forgetIdentity(key.userId);
      return;
    }
    const state = await dmRequest("vault");
    if (generation !== epoch.current) return;
    if (!state.publicKey || state.version !== key.version) {
      clearPrivateState();
      await forgetIdentity(key.userId);
      throw new Error("Your encryption key changed. Unlock DM again.");
    }
    setVault(state);
    identityRef.current = key;
    setIdentity(key);
    setPassword("");
    await refreshInbox(true);
  }

  async function lock() {
    clearPrivateState();
    await forgetIdentity(vault?.userId);
  }

  async function send() {
    if (!identity || !peer || !conversationId) return;
    const id = conversationId;
    const generation = epoch.current;
    const key = identity;
    const draft = text;
    const state = await dmRequest("vault");
    if (identityRef.current !== key) return;
    if (state.version !== key.version || !state.vault) {
      await lock();
      throw new Error("Your encryption key changed. Unlock DM again.");
    }
    let outgoing = pendingMessages.current.get(id);
    if (!outgoing) {
      const context = { id: crypto.randomUUID(), conversationId: id, senderId: key.userId, recipientId: peer.id, senderVersion: key.version, recipientVersion: peer.version };
      const payload: Payload = { text: draft, ...(sharedPost ? { post: sharedPost } : {}) };
      outgoing = { ...context, envelopes: await encryptMessage(key, JSON.parse(peer.publicKey), context, payload) };
      if (identityRef.current !== key) return;
      pendingMessages.current.set(id, outgoing);
    }
    await dmRequest("send", outgoing, true);
    if (identityRef.current !== key) return;
    pendingMessages.current.delete(id);
    if (drafts.current.get(id) === draft) drafts.current.delete(id);
    if (selected.current === id) {
      setText((current) => (current === draft ? "" : current));
      if (sharedPost && generation === epoch.current) {
        history.replaceState(null, "", location.pathname);
        setRoute(location.pathname);
      }
      await loadMessages(key);
    }
    await refreshInbox(true);
  }

  return (
    <section className={`dm-page ${conversationId ? "dm-has-conversation" : ""}`}>
      {!conversationId && (
        <header className="page-header">
          <div>
            <h1>Direct messages</h1>
            <p className="muted small">Private conversations</p>
          </div>
          {identity && !conversationId && (
            <button className="dm-detail-trigger" aria-label="Message settings" onClick={(e) => openDetails(e.currentTarget)}>
              <Info size={21} />
            </button>
          )}
        </header>
      )}

      <p className="error dm-status" role="alert">
        {error}
      </p>

      {!vault ? (
        <p className="section-pad">Loading messages…</p>
      ) : !vault.hasPassword ? (
        <section className="empty">
          <h2>Set a password to enable DM</h2>
          <p>Your password protects your encryption key.</p>
          <a className="button secondary" href="/settings?category=security">
            Set account password
          </a>
        </section>
      ) : !identity ? (
        <form
          className="form section-pad"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(unlock);
          }}
        >
          <h2>{vault.vault ? "Unlock your messages" : "Enable encrypted messages"}</h2>
          <p className="muted small">Access is remembered on this device until you lock DM or sign out. Resetting your account password removes access to previous messages.</p>
          <label>
            Account password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "Opening…" : vault.vault ? "Unlock DM" : "Enable DM"}
          </button>
        </form>
      ) : (
        <div className="dm-layout">
          <ConversationList
            inbox={inbox}
            conversationId={conversationId}
            sharedPost={sharedPost}
            query={query}
            setQuery={setQuery}
            users={users}
            busy={busy}
            onOpen={onOpen}
            onNavigate={onNavigate}
          />

          <section className="dm-conversation" aria-label="Messages">
            {conversationId ? (
              <>
                <header className="dm-peer">
                  <a className="dm-detail-trigger dm-back" href="/dm" onClick={onNavigate} aria-label="Back to inbox">
                    <ArrowLeft size={21} />
                  </a>
                  {peer && (
                    <a className="dm-peer-avatar" href={`/${peer.username}`} aria-label={`${peer.name}'s profile`}>
                      <UserAvatar name={peer.name} username={peer.username} image={peer.image} />
                    </a>
                  )}
                  <div className="dm-person-copy">
                    <h1>{peer?.name || "Conversation"}</h1>
                    {peer && (
                      <a className="muted small" href={`/${peer.username}`}>
                        @{peer.username}
                      </a>
                    )}
                  </div>
                  <button className="dm-detail-trigger" aria-label="Conversation details" onClick={(e) => openDetails(e.currentTarget)}>
                    <Info size={21} />
                  </button>
                </header>

                {keyChanged && (
                  <div className="notice">
                    This person's encryption key changed. Verify their key before continuing.
                    <button className="text-button" onClick={(e) => openDetails(e.currentTarget)}>
                      Review details
                    </button>
                  </div>
                )}

                <div
                  className="dm-history"
                  ref={historyRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                  }}
                  role="log"
                  aria-label="Message history"
                >
                  {loading && <p role="status">Loading messages…</p>}
                  {hasMore && (
                    <button className="text-button" disabled={busy} onClick={() => void perform(() => loadMessages(identity, true))}>
                      Load earlier messages
                    </button>
                  )}
                  {messages.map((m) => (
                    <article key={m.id} className={`dm-message ${m.sender_id === identity.userId ? "dm-sent" : "dm-received"}`}>
                      <span className="sr-only">{m.sender_id === identity.userId ? "You" : peer?.name}</span>
                      <div className="dm-message-row">
                        {m.sender_id !== identity.userId && peer && (
                          <a className="dm-message-avatar" href={`/${peer.username}`} aria-label={`${peer.name}'s profile`}>
                            <UserAvatar name={peer.name} username={peer.username} image={peer.image} />
                          </a>
                        )}
                        <div className="dm-message-stack">
                          <div className="dm-bubble">
                            {m.unavailable ? (
                              <p>This message could not be opened. Its key may have changed.</p>
                            ) : (
                              <>
                                {m.payload.text && (
                                  <p className="dm-message-text">
                                    <MessageText text={m.payload.text} />
                                  </p>
                                )}
                                {m.payload.post && <SharedPost path={m.payload.post} />}
                              </>
                            )}
                          </div>
                          <time
                            className="small muted"
                            dateTime={new Date(m.created_at).toISOString()}
                            title={`${new Date(m.created_at).toLocaleString("en-GB", { timeZone: "Asia/Jakarta" })} GMT+7`}
                          >
                            {new Date(m.created_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}
                          </time>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!messages.length && <p className="muted">Start your conversation.</p>}
                </div>

                <form
                  className="dm-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(send);
                  }}
                >
                  {sharedPost && (
                    <div className="notice">
                      Share post{" "}
                      <a className="text-link" href={sharedPost}>
                        {sharedPost}
                      </a>
                    </div>
                  )}
                  {blocked && <p className="notice">Messaging is blocked.</p>}
                  <label className="sr-only" htmlFor="dm-message">
                    Message
                  </label>
                  <textarea
                    id="dm-message"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      drafts.current.set(conversationId!, e.target.value);
                      pendingMessages.current.delete(conversationId!);
                    }}
                    placeholder="Write a message"
                    rows={3}
                    maxLength={10000}
                    disabled={loading || blocked || busy}
                  />
                  <div className="composer-foot">
                    <span className="small muted">{Array.from(text).length} / 5,000</span>
                    <button
                      className="button"
                      disabled={
                        loading ||
                        busy ||
                        blocked ||
                        keyChanged ||
                        !peer?.publicKey ||
                        peer?.invalidated ||
                        peer?.suspended ||
                        !peer?.emailVerified ||
                        (!text.trim() && !sharedPost) ||
                        Array.from(text).length > 5000
                      }
                    >
                      {busy ? "Sending…" : "Send"}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="empty">
                <h2>Your conversations</h2>
                <p>Choose a conversation or find someone to message.</p>
              </div>
            )}
          </section>
        </div>
      )}
      <dialog
        ref={detailsRef}
        className="dm-details-dialog"
        aria-labelledby="dm-details-title"
        onClose={() => detailsOpener.current?.focus()}
        onClick={(e) => {
          if (e.target === e.currentTarget) detailsRef.current?.close();
        }}
      >
        <header className="dm-details-heading">
          <h2 id="dm-details-title">{conversationId ? "Conversation details" : "Message settings"}</h2>
          <button className="dm-detail-trigger" aria-label="Close details" onClick={() => detailsRef.current?.close()}>
            <X size={20} />
          </button>
        </header>
        {peer && conversationId && (
          <>
            <a className="dm-details-person" href={`/${peer.username}`}>
              <UserAvatar name={peer.name} username={peer.username} image={peer.image} large />
              <span className="dm-person-copy">
                <strong>{peer.name}</strong>
                <span className="muted small">@{peer.username}</span>
              </span>
            </a>
            <a className="dm-detail-option" href={`/${peer.username}`}>
              <UserRound size={18} />
              View profile
            </a>
            <details className="dm-key">
              <summary>Encryption key</summary>
              <p className="small">Compare this fingerprint with @{peer.username} through another channel.</p>
              <code>{fingerprint.match(/.{1,4}/g)?.join(" ")}</code>
              {keyChanged && (
                <div className="notice">
                  This person's key changed.
                  <button
                    className="text-button"
                    onClick={() => {
                      localStorage.setItem(`dm-peer-${identity!.userId}-${peer.id}`, fingerprint);
                      setKeyChanged(false);
                    }}
                  >
                    Trust new key
                  </button>
                </div>
              )}
            </details>
            <button
              className="dm-detail-option dm-block-option"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await dmRequest("block", { userId: peer.id, blocked: !ownBlocked }, true);
                  await refresh();
                  detailsRef.current?.close();
                })
              }
            >
              <ShieldBan size={18} />
              {ownBlocked ? "Unblock" : "Block"}
            </button>
          </>
        )}
        <details className="dm-key">
          <summary>Your encryption key</summary>
          <code>{ownFingerprint.match(/.{1,4}/g)?.join(" ")}</code>
        </details>
        {identity && (
          <details className="dm-key">
            <summary>Blocked accounts</summary>
            <BlockedAccounts key={String(ownBlocked)} onChange={refresh} />
          </details>
        )}
        <button className="dm-detail-option" disabled={busy} onClick={() => void perform(lock)}>
          <LockKeyhole size={18} />
          Lock DM
        </button>
      </dialog>
    </section>
  );
}

function BlockedAccounts({ onChange }: { onChange: () => Promise<void> }) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    dmRequest("blocks")
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      <p role="status">{error}</p>
      {items.map((u) => (
        <p key={u.id}>
          @{u.username}{" "}
          <button
            className="text-button"
            onClick={async () => {
              try {
                await dmRequest("block", { userId: u.id, blocked: false }, true);
                setItems(items.filter((i) => i.id !== u.id));
                await onChange();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Try again.");
              }
            }}
          >
            Unblock
          </button>
        </p>
      ))}
      {!items.length && <p className="small muted">No blocked accounts.</p>}
    </div>
  );
}
