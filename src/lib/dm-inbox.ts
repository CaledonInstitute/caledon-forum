export type InboxItem = {
  id: string;
  peerId: string;
  name: string;
  username: string;
  image: string | null;
  unread: number;
  updated_at: number;
};
type Inbox = { items: InboxItem[]; unread: number };
let current: Inbox | undefined;
let pending: Promise<Inbox> | undefined;
const listeners = new Set<(inbox: Inbox) => void>();

export function subscribeInbox(listener: (inbox: Inbox) => void) {
  listeners.add(listener);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
  };
}

// Shared by the navigation badge and the React island, including concurrent refreshes.
export async function refreshInbox(afterMutation = false): Promise<Inbox> {
  // A request started before a write may contain the old unread count.
  if (afterMutation && pending) return pending.then(() => refreshInbox());
  return (pending ||= fetch("/api/dm/inbox", { cache: "no-store" })
    .then(async (response) => {
      const result = (await response.json()) as Inbox & { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not load messages. Try again.");
      const previous = new Map(current?.items.map((item) => [item.id, item]));
      const items = result.items.map((item) => {
        const old = previous.get(item.id);
        return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
      });
      const unchanged = current && items.length === current.items.length && items.every((item, i) => item === current!.items[i]);
      current = { items: unchanged ? current!.items : items, unread: result.unread };
      document.querySelectorAll('nav a[href="/dm"]').forEach((nav) => {
        let dot = nav.querySelector("[data-dm-unread]");
        if (!result.unread) {
          dot?.remove();
          return;
        }
        if (!dot) {
          dot = document.createElement("span");
          dot.className = "dot";
          dot.setAttribute("data-dm-unread", "");
          nav.appendChild(dot);
        }
        dot.setAttribute("aria-label", `${result.unread} unread messages`);
      });
      listeners.forEach((listener) => listener(current!));
      return current;
    })
    .finally(() => {
      pending = undefined;
    }));
}
