const CACHE = "six-shell-v9";
const BASE = "/Mortimer-player/";
const BUILD_ASSETS = [];
const SHELL = [
  BASE,
  `${BASE}manifest.webmanifest`,
  `${BASE}favicon.png`,
  `${BASE}logo.png`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const urls = [...new Set([...SHELL, ...BUILD_ASSETS.map((asset) => BASE + asset)])];
      await Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url, { cache: "reload" });
          if (response.ok && response.type === "basic") await cache.put(url, response);
        } catch {}
      }));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("six-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const staticAsset = ["script", "style", "font", "image", "manifest", "worker"].includes(request.destination);
  const wasmAsset = sameOrigin && url.pathname.endsWith(".wasm");

  const cacheResponse = (response) => {
    if (sameOrigin && response.ok && response.type === "basic") {
      const copy = response.clone();
      void caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  };

  event.respondWith(
    staticAsset || wasmAsset
      ? caches.match(request).then((cached) => cached || fetch(request).then(cacheResponse))
      : fetch(request).then(cacheResponse).catch(() =>
          caches.match(request).then((cached) => cached || caches.match(BASE))
        )
  );
});
