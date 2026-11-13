const CACHE_NAME = 'travel-journal-v4';

const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './services.js',
  './manifest.json'
];

// 설치 단계: 핵심 4개 파일 사전 캐싱 및 즉시 대기 해제
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// 활성화 단계: 구버전 캐시 정리 및 열린 클라이언트 즉시 제어
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
          return null;
        })
      )
    )
  );
  self.clients.claim();
});

// 네트워크 우선(Network-First) 전략:
// 온라인일 때는 index.html, app.js, services.js, manifest.json 및 실시간 API의 최신 응답을 먼저 가져와 캐시를 갱신하고,
// 오프라인일 때만 캐시된 폴백을 반환합니다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Firebase Firestore 실시간 스트리밍 통신은 서비스 워커 캐시 대상에서 제외
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebaseio.com')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (url.origin === self.location.origin ||
            url.hostname.includes('er-api.com') ||
            url.hostname.includes('currency-api'))
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return null;
        })
      )
  );
});
