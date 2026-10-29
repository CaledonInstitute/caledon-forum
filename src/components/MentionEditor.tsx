import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { activeMention, type MentionUser } from "../lib/mention-input";
import UserAvatar from "./UserAvatar";

export default function MentionEditor({ value, onChange, disabled, reply }: { value: string; onChange: (value: string) => void; disabled: boolean; reply: boolean }) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const dismissed = useRef(false);
  const nextCaret = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const listId = useId();
  const [range, setRange] = useState<ReturnType<typeof activeMention>>(null);
  const [users, setUsers] = useState<MentionUser[]>([]);
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("");
  const open = !!range && !disabled;
  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    const caret = nextCaret.current;
    nextCaret.current = null;
    editor.current?.focus();
    editor.current?.setSelectionRange(caret, caret);
  }, [value]);
  useEffect(() => {
    setUsers([]);
    setSelected(0);
    if (!range || disabled) return;
    const controller = new AbortController();
    setStatus("Looking for people…");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/forum/mentions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: range.query }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const result = (await response.json()) as { users: MentionUser[] };
        if (controller.signal.aborted) return;
        setUsers(result.users);
        setStatus(result.users.length ? "" : "No matching people. Try another username.");
      } catch {
        if (!controller.signal.aborted) setStatus("Suggestions unavailable. You can still type @username.");
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [range?.query, disabled]);

  function updateRange() {
    if (dismissed.current) return;
    const input = editor.current;
    setRange(input && input.selectionStart === input.selectionEnd ? activeMention(input.value, input.selectionStart) : null);
  }
  function choose(user: MentionUser) {
    if (!range) return;
    const inserted = `@${user.username} `;
    nextCaret.current = range.start + inserted.length;
    onChange(value.slice(0, range.start) + inserted + value.slice(range.end));
    dismissed.current = true;
    setRange(null);
  }
  return (
    <div className="mention-editor">
      <textarea
        ref={editor}
        disabled={disabled || !ready}
        aria-label={reply ? "Your reply" : "Your post"}
        placeholder={reply ? "Share a thought, ask a question…" : "An idea, a discovery, a question…"}
        value={value}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && users[selected] ? `${listId}-${selected}` : undefined}
        onChange={(e) => {
          dismissed.current = false;
          onChange(e.target.value);
          updateRange();
        }}
        onSelect={updateRange}
        onClick={() => {
          dismissed.current = false;
          updateRange();
        }}
        onBlur={() => setRange(null)}
        onKeyDown={(e) => {
          if (!open || e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            dismissed.current = true;
            setRange(null);
          }
          if (users.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            setSelected((index) => (index + (e.key === "ArrowDown" ? 1 : users.length - 1)) % users.length);
          }
          if (users[selected] && e.key === "Enter") {
            e.preventDefault();
            choose(users[selected]);
          }
        }}
      />
      {open && (
        <div className="mention-picker">
          <div className="mention-picker-heading">
            Mention someone <span>↑ ↓ to choose · Enter to add · Esc to close</span>
          </div>
          <div id={listId} role="listbox" aria-label="People to mention">
            {users.map((user, index) => (
              <div
                key={user.username}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected === index}
                className="mention-option"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSelected(index)}
                onClick={() => choose(user)}
              >
                <UserAvatar name={user.name} username={user.username} image={user.image} />
                <span>
                  <strong>{user.name}</strong>
                  <span className="mention-handle">@{user.username}</span>
                </span>
              </div>
            ))}
          </div>
          {status && (
            <p role="status" className="mention-status">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
