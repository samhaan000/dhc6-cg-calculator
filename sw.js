const CACHE_NAME = 'dhc6-load-balance-v14';
const APP_VERSION = '20260828.3';
const CORE_ASSETS = [
  './',
  './index.html',
  './config.js?v=' + APP_VERSION,
  './engine.js?v=' + APP_VERSION,
  './seating.js?v=' + APP_VERSION,
  './parsers.js?v=' + APP_VERSION,
  './app.js?v=' + APP_VERSION,
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/seaplane-logo.svg',
  './vendor/tesseract/tesseract.min.js?v=' + APP_VERSION,
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/lang/eng.traineddata.gz'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(CORE_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(event.request, { cache: 'reload' }))
        .then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put('./index.html', copy); });
          return response;
        })
        .catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // Application code is network-first so a new OCR/parser release cannot be
  // mixed with an older cached file. Large, pinned OCR assets stay cache-first.
  if (/\/(?:config|engine|seating|parsers|app)\.js$/.test(url.pathname) || /\/tesseract\.min\.js$/.test(url.pathname)) {
    event.respondWith(
      fetch(new Request(event.request, { cache: 'reload' }))
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
          }
          return response;
        })
        .catch(function () { return caches.match(event.request); })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      });
    })
  );
});
