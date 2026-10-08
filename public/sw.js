const CACHE = "six-shell-v7";
const SHELL = [
  "/Mortimer-player/",
  "/Mortimer-player/manifest.webmanifest",
  "/Mortimer-player/favicon.png",
  "/Mortimer-player/logo.png",
  "/Mortimer-player/icon-192.png",
  "/Mortimer-player/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(SHELL.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response.ok) await cache.put(url, response);
        } catch {}
      }));
    }).then(() => self.skipWaiting())
  );
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

  const sameOrigin = new URL(request.url).origin === self.location.origin;
  const staticAsset = ["script", "style", "font", "image", "manifest", "worker"].includes(request.destination);

  const cacheResponse = (response) => {
    if (sameOrigin && response.ok && response.type === "basic") {
      const copy = response.clone();
      void caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  };

  event.respondWith(
    staticAsset
      ? caches.match(request).then((cached) => cached || fetch(request).then(cacheResponse))
      : fetch(request).then(cacheResponse).catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/Mortimer-player/"))
        )
  );
});
