export {};
const panel = document.querySelector<HTMLElement>("[data-push-settings]");
if (panel) {
  const enable = panel.querySelector<HTMLButtonElement>("[data-push-enable]")!;
  const disable = panel.querySelector<HTMLButtonElement>("[data-push-disable]")!;
  const status = panel.querySelector<HTMLElement>("[data-push-status]")!;
  const fields = [...panel.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  let publicKey: string | null = null;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  async function api(method: string, data: unknown) {
    const response = await fetch("/api/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = (await response.json()) as any;
    if (!response.ok) throw new Error(result.error || "Please try again.");
  }
  async function registration() {
    return navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }
  async function initialize() {
    if (!supported) {
      enable.disabled = true;
      fields.forEach((f) => (f.disabled = true));
      status.textContent = "Browser notifications are unavailable on this browser. On iPhone or iPad, try the Home Screen app.";
      return;
    }
    try {
      const response = await fetch("/api/push", { cache: "no-store" });
      if (!response.ok) throw new Error("Sign in to manage notifications.");
      const data = (await response.json()) as any;
      publicKey = data.publicKey;
      panel!.querySelector<HTMLFieldSetElement>("[data-push-preferences]")!.disabled = false;
      enable.disabled = !data.enabled;
      for (const field of fields) field.checked = !!data.preferences[field.name];
      const sub = await (await registration()).pushManager.getSubscription();
      const active = !!sub && data.deviceSubscribed;
      disable.hidden = !active;
      enable.hidden = active;
      status.textContent = !data.enabled
        ? "Browser notifications are not available yet."
        : active
          ? "Notifications are enabled on this device."
          : "Notifications are off until you enable them.";
    } catch (error) {
      status.textContent = (error as Error).message;
    }
  }
  enable.onclick = async () => {
    enable.disabled = true;
    try {
      if (!publicKey) throw new Error("Browser notifications are unavailable.");
      // Permission is requested directly from this click, never on page load.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications are blocked. You can change this in browser settings.");
      const ready = await registration();
      await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const sub = (await ready.pushManager.getSubscription()) || (await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      try {
        await api("POST", sub.toJSON());
      } catch (error) {
        await sub.unsubscribe();
        throw error;
      }
      enable.hidden = true;
      disable.hidden = false;
      status.textContent = "Notifications are enabled on this device.";
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      enable.disabled = false;
    }
  };
  disable.onclick = async () => {
    disable.disabled = true;
    try {
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub) {
        await api("DELETE", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      enable.hidden = false;
      disable.hidden = true;
      status.textContent = "Notifications disabled on this device.";
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      disable.disabled = false;
    }
  };
  for (const field of fields)
    field.onchange = async () => {
      fields.forEach((f) => (f.disabled = true));
      status.textContent = "Saving notification preferences…";
      try {
        await api("PATCH", Object.fromEntries(fields.map((f) => [f.name, f.checked])));
        status.textContent = "Notification preferences saved.";
      } catch (error) {
        field.checked = !field.checked;
        status.textContent = (error as Error).message;
      } finally {
        fields.forEach((f) => (f.disabled = false));
      }
    };
  void initialize();
}
