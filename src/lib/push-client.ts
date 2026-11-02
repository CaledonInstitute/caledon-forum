/** Detach this browser while the current account session still exists. */
export async function detachBrowserPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const response = await fetch("/api/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!response.ok) throw new Error("Could not disable notifications. Try signing out again.");
    if (!(await subscription.unsubscribe())) throw new Error("Could not disable browser notifications. Try again.");
  }
  for (const notification of (await registration?.getNotifications()) || []) notification.close();
}
