function notificationUrl(raw) {
  try {
    const target = new URL(typeof raw === "string" ? raw : "/notifications", self.location.origin);
    return target.origin === self.location.origin &&
      (/^\/p\/[1-9][0-9]{0,18}$/.test(target.pathname) || /^\/dm\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.pathname))
      ? target.pathname
      : "/notifications";
  } catch {
    return "/notifications";
  }
}
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data.json() || {};
  } catch {
    data = {};
  }
  const url = notificationUrl(data?.url);
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
  const target = new URL(notificationUrl(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(self.clients.openWindow(target));
});
