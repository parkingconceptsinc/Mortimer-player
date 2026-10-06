const CACHE = "mortimer-shell-v2";
const SHELL = [
  "/Mortimer-player/",
  "/Mortimer-player/manifest.webmanifest",
  "/Mortimer-player/icon.svg",
  "/Mortimer-player/icon-192.svg",
  "/Mortimer-player/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request).then((response) => {
      if (new URL(request.url).origin === self.location.origin) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(() =>
      caches.match(request).then((cached) =>
        cached || caches.match("/Mortimer-player/")
      )
    )
  );
});
