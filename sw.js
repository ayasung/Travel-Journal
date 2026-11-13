const CACHE_NAME = 'travel-journal-v6';

const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './services.js',
  './manifest.json'
];

// 설치 단계: 핵심 파일들을 새 캐시(v5)에 저장하고 대기 없이 즉시 활성화
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// 활성화 단계: 이전 버전(v1~v4 등)의 모든 구버전 캐시를 완전히 삭제하고 즉시 제어권 획득
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

// 요청 가로채기: 네트워크 우선(Network-First) 전략
// 온라인 상태에서는 항상 최신 코드(index.html, app.js, services.js)를 먼저 불러와 캐시를 갱신하고,
// 오프라인 상태일 때만 캐시된 파일을 반환하여 구버전 캐시 고착 문제를 방지합니다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Firebase Firestore 실시간 스트림 및 외부 API 인증 통신은 캐시 제외
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('airlabs.co')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
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
