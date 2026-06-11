const CACHE = 'review-app-v1';
const FILES = [
  '.',
  'index.html',
  'js/app.js',
  'js/chat.js',
  'js/config.js',
  'js/db.js',
  'js/pdf.min.js',
  'js/tailwind.js',
  'manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
