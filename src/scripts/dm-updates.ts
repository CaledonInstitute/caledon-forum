let running = false;
async function update() {
  if (running || document.visibilityState !== "visible" || !document.body.dataset.viewerId) return;
  running = true;
  try {
    const r = await fetch("/api/dm/inbox", { cache: "no-store" });
    if (!r.ok) {
      if (r.status === 401) {
        await (await import("../lib/dm-crypto")).forgetIdentity();
        document.dispatchEvent(new Event("forum:dm-locked"));
      }
      return;
    }
    const result: any = await r.json();
    document.querySelectorAll('a[href="/dm"]').forEach((nav) => {
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
  } catch {
  } finally {
    running = false;
  }
}
if (document.body.dataset.viewerId) {
  void update();
  setInterval(() => {
    if (document.body.dataset.realtimeConnected !== "true") void update();
  }, 30000);
  document.addEventListener("forum:dm-updated", () => void update());
  document.addEventListener("visibilitychange", () => void update());
} else {
  void import("../lib/dm-crypto").then((m) => m.forgetIdentity()).catch(() => {});
}
export {};
