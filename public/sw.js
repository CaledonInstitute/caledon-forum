self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    data = {};
  }
  const raw = typeof data.url === "string" ? data.url : "/notifications";
  const target = new URL(raw, self.location.origin);
  const url = target.origin === self.location.origin && /^\/p\/[1-9][0-9]{0,18}$/.test(target.pathname) ? target.pathname : "/notifications";
  event.waitUntil(
    self.registration.showNotification("Caledon Forum", {
      body: typeof data.body === "string" ? data.body.slice(0, 120) : "You have a new notification.",
      tag: typeof data.tag === "string" ? data.tag.slice(0, 120) : "caledon-notification",
      icon: "/icon-192.png",
      data: { url },
    })
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin);
  const target = url.origin === self.location.origin ? url.href : new URL("/notifications", self.location.origin).href;
  event.waitUntil(self.clients.openWindow(target));
});
