// Bump VERSION whenever app files change. A new worker waits until old tabs close.
const VERSION = 'v5';
const CACHE_PREFIX = `stackr:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SHELL = ['./', './index.html', './styles.css', './js/app.js', './js/renderer.js',
  './js/media.js', './js/export.js', './js/video-timing.js', './js/mp4.js', './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    // Include caches under previous app names, limited to this exact deployment scope.
    const scopeMarker = `:${self.registration.scope}:`;
    await Promise.all(names.filter(name => name.includes(scopeMarker) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // Cache only the app shell, never user-selected media, downloads, or other pages.
  const shellURLs = SHELL.map(path => new URL(path, self.registration.scope).href);
  const requestURL = new URL(event.request.url);
  requestURL.search = '';
  if (!shellURLs.includes(requestURL.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(requestURL.href);
    return cached || fetch(event.request);
  })());
});
