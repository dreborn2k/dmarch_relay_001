const CACHE_NAME = 'pwa-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  // Tambahkan file CSS, JS, atau gambar kamu di sini
];

// Tahap Install: Menyimpan aset ke dalam cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Tahap Fetch: Mengambil aset dari cache jika offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
