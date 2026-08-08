/**
 * service-worker.js
 * ---------------------------------------------------------------
 * Caches the app shell so the scanner UI + camera still load with
 * zero connectivity. It NEVER caches calls to the Apps Script API —
 * those always go straight to the network (or fail and get queued
 * by offlineQueue.js, which is a separate, app-level concern).
 *
 * Bump Config.APP_VERSION on every deploy that changes any cached
 * file, so returning devices pick up the new files instead of
 * serving a stale bundle.
 * ---------------------------------------------------------------
 */
importScripts("./js/config.js");

const CACHE_NAME = `emd-scanner-${Config.APP_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/offlineQueue.js",
  "./js/api.js",
  "./js/auth.js",
  "./js/scanner.js",
  "./js/ui.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Never intercept/cache calls to the Apps Script API — always live.
  if (Config.API_URL && url.indexOf(Config.API_URL) === 0) {
    return; // let the browser handle it normally
  }
  if (url.indexOf("script.google.com") !== -1 || url.indexOf("script.googleusercontent.com") !== -1) {
    return;
  }

  // Cache-first for the app shell; fall back to network, and cache
  // successful same-origin GETs opportunistically as they're seen.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (
            response &&
            response.ok &&
            event.request.method === "GET" &&
            response.type !== "opaque"
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
