// Imported by the service worker. The app used to precache everything (cache-first);
// it is network-first now, so drop the leftover precache on activation.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('workbox-precache')).map((k) => caches.delete(k)))),
  );
});
