// Only the public offline page is cached. HR responses, salaries and attendance
// writes always go to the server and are never queued or stored by this worker.
const OFFLINE_CACHE = "hr-offline-v1";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add("/offline.html")));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => (key.startsWith("hr-offline-") || key.startsWith("sanad-offline-")) && key !== OFFLINE_CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () =>
    (await caches.match("/offline.html")) || Response.error()));
});
