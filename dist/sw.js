self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("./#alerts/inbox", self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const current = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (current) {
      await current.navigate(target);
      return current.focus();
    }
    return self.clients.openWindow(target);
  })());
});
