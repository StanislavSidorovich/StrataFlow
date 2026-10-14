// Service worker: makes StrataFlow work offline after the first visit.
// The build (vite.config.ts → pwaPlugin) replaces the two placeholders below
// with the build hash and the list of every emitted file.
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = `strataflow-${VERSION}`

self.addEventListener('install', (event) => {
  // Not skipWaiting(): an open tab may still lazy-load chunks of its own version.
  // The page shows "Update" and sends SKIP_WAITING when the user agrees.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('strataflow-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // The page itself: network first so a new deploy is noticed, the cached shell when offline.
    event.respondWith(fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true, ignoreVary: true })))
    return
  }
  // Hashed assets never change: cache first. ignoreVary: module scripts send Origin, and servers may answer Vary: Origin.
  event.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit ?? fetch(req)))
})
