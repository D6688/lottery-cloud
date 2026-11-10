/* 彩智 · 云端选号助手 Service Worker */
'use strict';

const CACHE = 'caizhi-cloud-v0.5.0';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css?v=0.5.0',
  './assets/data.js?v=0.5.0',
  './assets/snapshot.js?v=0.5.0',
  './assets/analyzer.js?v=0.5.0',
  './assets/bets.js?v=0.5.0',
  './assets/generator.js?v=0.5.0',
  './assets/app.js?v=0.5.0',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './data/latest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key !== CACHE ? caches.delete(key) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 开奖数据：网络优先，失败时用缓存
  if (url.pathname.indexOf('/data/latest.json') >= 0) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
          return response;
        })
        .catch(function () { return caches.match(request); })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put('./index.html', copy); });
          return response;
        })
        .catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // 页面脚本/样式：网络优先，保证发版后不会一直吃旧缓存
  if (url.pathname.indexOf('/assets/') >= 0) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        })
        .catch(function () { return caches.match(request); })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      });
    })
  );
});
