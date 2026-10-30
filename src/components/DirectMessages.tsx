import { useEffect, useRef, useState } from "react";

import { createIdentity, unlockPrivate, rememberIdentity, recalledIdentity, forgetIdentity, encryptMessage, decryptMessage, type Identity, type Payload } from "../lib/dm-crypto";

import QuoteCard from "./QuoteCard";
import UserAvatar from "./UserAvatar";
import { Info, X, LockKeyhole, UserRound, ShieldBan, ArrowLeft } from "lucide-react";

import type { QuotedPost } from "../lib/types";

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

export default function DirectMessages({ conversationId }: { conversationId?: string }) {
  const [vault, setVault] = useState<any>(null),
    [identity, setIdentity] = useState<Identity | null>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [inbox, setInbox] = useState<any[]>([]),
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
  const pending = useRef<any>(null);
  const identityRef = useRef<Identity | null>(null);
  identityRef.current = identity;

  const shared = typeof location !== "undefined" ? new URLSearchParams(location.search).get("share") : null;

  const sharedPost = shared && /^\/p\/[1-9][0-9]*$/.test(shared) ? shared : undefined;

  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMessages(key: Identity, older = false) {
    if (!conversationId) return;

    if (older) follow.current = false;
    const result = await dmRequest("messages", { conversationId, ...(older && messages.length ? { before: Math.min(...messages.map((m) => m.seq)) } : {}) });

    setPeer(result.peer);
    setBlocked(result.blocked);
    setOwnBlocked(result.ownBlocked);

    const fp = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.peer.publicKey || ""))), (n) =>
      n.toString(16).padStart(2, "0")
    ).join("");
    setFingerprint(fp);

    const pinned = localStorage.getItem(`dm-peer-${key.userId}-${result.peer.id}`);
    setKeyChanged(!!pinned && pinned !== fp);
    if (!pinned) localStorage.setItem(`dm-peer-${key.userId}-${result.peer.id}`, fp);

    const items = await Promise.all(
      result.items
        .slice(0, 50)
        .reverse()
        .map(async (m: any) => {
          try {
            return { ...m, payload: await decryptMessage(key, m, result.peer.id) };
          } catch {
            return { ...m, unavailable: true };
          }
        })
    );

    if (identityRef.current?.version !== key.version || identityRef.current?.userId !== key.userId) return;

    setMessages((previous) => {
      const merged = new Map([...previous, ...items].map((m) => [m.id, m]));
      return [...merged.values()].sort((a, b) => a.seq - b.seq);
    });
    setHasMore(result.items.length > 50);

    if (!older && items.length) await dmRequest("read", { conversationId, seq: items.at(-1).seq }, true);
  }

  async function refresh() {
    if (document.visibilityState !== "visible") return;

    const state = await dmRequest("vault");
    setVault(state);

    if (!state.publicKey || (identityRef.current && identityRef.current.version !== state.version)) {
      await forgetIdentity(state.userId);
      identityRef.current = null;
      setIdentity(null);
      setMessages([]);
      return;
    }

    const key = identityRef.current || (await recalledIdentity(state.userId, state.version, state.publicKey));

    if (key) {
      identityRef.current = key;
      setIdentity(key);
      await loadMessages(key);
    }

    const result = await dmRequest("inbox");
    setInbox(result.items);
  }

  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const locked = () => {
      identityRef.current = null;
      setIdentity(null);
      setMessages([]);
      setPassword("");
      setText("");
      pending.current = null;
      detailsRef.current?.close();
    };
    const refreshEvent = () => {
      void refresh().catch(async (e) => {
        if (/Sign in|active account/.test(e.message)) {
          identityRef.current = null;
          setIdentity(null);
          setMessages([]);
          await forgetIdentity();
        }
        setError(e.message);
      });
    };
    const timer = setInterval(() => {
      if (document.body.dataset.realtimeConnected !== "true") refreshEvent();
    }, 30000);
    document.addEventListener("visibilitychange", refreshEvent);
    document.addEventListener("forum:dm-updated", refreshEvent);
    document.addEventListener("forum:dm-locked", locked);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshEvent);
      document.removeEventListener("forum:dm-updated", refreshEvent);
      document.removeEventListener("forum:dm-locked", locked);
      identityRef.current = null;
    };
  }, [conversationId]);

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
    if (identity)
      void crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity.publicKey)))
        .then((hash) => setOwnFingerprint(Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("")));
  }, [identity]);
  async function openConversation(username: string) {
    const result = await dmRequest("conversation", { username }, true);
    location.assign(`/dm/${result.id}${sharedPost ? "?share=" + encodeURIComponent(sharedPost) : ""}`);
  }

  useEffect(() => {
    if (!identity || conversationId) return;
    const to = new URLSearchParams(location.search).get("to");
    if (to) void perform(() => openConversation(to));
  }, [identity]);

  async function unlock() {
    if (!vault) return;

    let key: Identity;

    if (vault.vault) key = { userId: vault.userId, version: vault.version, publicKey: vault.publicKey, privateKey: await unlockPrivate(vault.vault, password) };
    else {
      const created = await createIdentity(vault.userId, vault.version, password);
      await dmRequest("vault", { password, version: vault.version, publicKey: created.identity.publicKey, vault: created.vault }, true);
      key = created.identity;
    }

    await rememberIdentity(key);
    identityRef.current = key;
    setIdentity(key);
    setPassword("");
    await refresh();
  }

  async function lock() {
    identityRef.current = null;
    setIdentity(null);
    setMessages([]);
    setText("");
    pending.current = null;
    detailsRef.current?.close();
    await forgetIdentity(vault?.userId);
  }

  async function send() {
    if (!identity || !peer) return;
    const state = await dmRequest("vault");
    if (state.version !== identity.version || !state.vault) {
      await lock();
      throw new Error("Your encryption key changed. Unlock DM again.");
    }

    if (!pending.current) {
      const id = crypto.randomUUID();
      const context = { id, conversationId: conversationId!, senderId: identity.userId, recipientId: peer.id, senderVersion: identity.version, recipientVersion: peer.version };
      const payload: Payload = { text, ...(sharedPost ? { post: sharedPost } : {}) };
      pending.current = { ...context, envelopes: await encryptMessage(identity, JSON.parse(peer.publicKey), context, payload) };
    }

    await dmRequest("send", pending.current, true);
    pending.current = null;
    setText("");
    if (sharedPost) history.replaceState(null, "", location.pathname);
    await refresh();
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
          <aside className="dm-inbox" aria-label="Inbox">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (users[0]) void perform(() => openConversation(users[0].username));
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
                    <button key={u.id} disabled={busy} onClick={() => void perform(() => openConversation(u.username))}>
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
                <a
                  key={item.id}
                  href={`/dm/${item.id}${sharedPost ? "?share=" + encodeURIComponent(sharedPost) : ""}`}
                  aria-current={item.id === conversationId ? "page" : undefined}
                >
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
              ))}
            </nav>
            {!inbox.length && <p className="muted small">Find someone to start a conversation.</p>}
          </aside>

          <section className="dm-conversation" aria-label="Messages">
            {conversationId ? (
              <>
                <header className="dm-peer">
                  <a className="dm-detail-trigger dm-back" href="/dm" aria-label="Back to inbox">
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
                      pending.current = null;
                    }}
                    placeholder="Write a message"
                    rows={3}
                    maxLength={10000}
                    disabled={blocked || busy}
                  />
                  <div className="composer-foot">
                    <span className="small muted">{Array.from(text).length} / 5,000</span>
                    <button
                      className="button"
                      disabled={
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
