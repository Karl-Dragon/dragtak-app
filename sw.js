// Arrêt du service : vide les caches de l'appli et se désinstalle.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) {}
  try {
    if (self.indexedDB && indexedDB.databases) {
      for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name);
    }
  } catch (_) {}
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
