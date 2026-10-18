// Service worker for builder alerts: shows the push notification and opens the customer on tap.
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'New customer', body: event.data?.text() || '' }; }
    event.waitUntil(self.registration.showNotification(data.title || 'New customer', {
        body: data.body || '', tag: data.tag || 'lead', renotify: true, data: { url: data.url || '/admin/' },
        icon: '/admin/icon.png', badge: '/admin/icon.png', vibrate: [120, 60, 120],
    }));
});
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/admin/';
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        const open = list.find(c => c.url.includes('/admin'));
        if (open) { open.focus(); return open.navigate(url); }
        return self.clients.openWindow(url);
    }));
});
