const CACHE_NAME = 'travel-journal-v6';

const CORE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './services.js',
  './manifest.json'
];

// 1. 설치(install): 핵심 에셋을 v6 캐시에 저장하고 대기 없이 즉시 활성화
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// 2. 활성화(activate): 이전 버전의 모든 캐시를 삭제하고 즉시 클라이언트 제어권 획득
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

// 3. 요청 가로채기(fetch): 네트워크 우선(Network-First) 전략
// 온라인일 때는 브라우저 HTTP 캐시를 우회(no-store)해 최신 index.html, app.js, services.js, manifest.json을 먼저 가져와 캐시를 갱신하고,
// 오프라인일 때만 캐시된 버전을 반환합니다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Firebase Firestore 실시간 스트림 및 외부 API 인증 통신은 서비스 워커 캐시에서 제외
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
