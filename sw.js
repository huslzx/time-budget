/*
 * Бюджет часу — робота без інтернету (service worker).
 *
 * Зберігає ФАЙЛИ програми в кеші браузера й віддає їх звідти, навіть коли
 * інтернету немає. Справи й налаштування сюди не потрапляють: вони, як і раніше,
 * лише в localStorage на пристрої.
 *
 * Оновлення: щоразу, коли програму відкривають з інтернетом, у фоні всі файли
 * звіряються із сайтом. Якщо щось змінилось — кеш оновлюється цілком, а програма
 * показує «Є нова версія — Оновити».
 *
 * Працює лише на сайті (https) або на localhost — не для файлу, відкритого з диска.
 */
const CACHE = 'time-budget-v1';

// Усі файли програми. Додаєш новий файл — додай його й сюди (це перевіряє тест)
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/time.js',
  './js/calc.js',
  './js/store.js',
  './js/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

// Прибираємо лише свої старі кеші: на тому самому сайті можуть жити інші програми
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('time-budget-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Відкриття програми: одразу збережена сторінка, а в фоні — перевірка оновлень
    event.respondWith(caches.match('./index.html').then((cached) => cached || fetch(request)));
    event.waitUntil(refresh());
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

// Звіряє всі файли із сайтом. Якщо хоч один змінився — оновлює кеш цілком
// (щоб старі й нові файли не змішались) і повідомляє відкриті вікна програми.
async function refresh() {
  let fresh;
  try {
    fresh = await Promise.all(FILES.map((file) => fetch(file, { cache: 'no-cache' })));
  } catch (error) {
    return; // немає інтернету — працюємо з тим, що є
  }
  if (fresh.some((response) => !response.ok)) return;
  const cache = await caches.open(CACHE);
  let changed = false;
  for (let i = 0; i < FILES.length && !changed; i++) {
    const cached = await cache.match(FILES[i]);
    if (!cached) {
      changed = true;
    } else {
      const [now, before] = await Promise.all([fresh[i].clone().arrayBuffer(), cached.arrayBuffer()]);
      changed = !sameBytes(now, before);
    }
  }
  if (!changed) return;
  await Promise.all(FILES.map((file, i) => cache.put(file, fresh[i])));
  const windows = await self.clients.matchAll({ type: 'window' });
  windows.forEach((client) => client.postMessage({ type: 'update-ready' }));
}
