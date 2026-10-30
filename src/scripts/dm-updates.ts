import { refreshInbox } from "../lib/dm-inbox";
let running = false;
async function update() {
  if (running || document.visibilityState !== "visible" || !document.body.dataset.viewerId) return;
  running = true;
  try {
    await refreshInbox();
  } catch (error) {
    if (error instanceof Error && /Sign in|active account/.test(error.message)) {
      await (await import("../lib/dm-crypto")).forgetIdentity();
      document.dispatchEvent(new Event("forum:dm-locked"));
    }
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
