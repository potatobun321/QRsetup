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
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn("Some assets failed to pre-cache:", err);
      });
    })
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
    return;
  }
  if (url.indexOf("script.google.com") !== -1 || url.indexOf("script.googleusercontent.com") !== -1) {
    return;
  }

  // Network-First with Cache Fallback for App Shell assets.
  // This ensures online devices always get the latest GitHub code,
  // while offline devices at the venue fall back seamlessly to cache.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          event.request.method === "GET"
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Network failed (offline or venue drop) — use cached copy.
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("Offline", { status: 503, statusText: "Offline" });
        });
      })
  );
});

