const CACHE_NAME = 'travel-journal-v2';

const APP_SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

// 설치 단계: 핵심 파일 사전 캐싱 후 즉시 대기 해제
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

// 활성화 단계: 구버전 캐시 자동 삭제 후 모든 클라이언트 즉시 제어
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
// 온라인일 때는 항상 최신 index.html, app.js, manifest.json 및 환율 데이터를 받아 캐시를 갱신하고,
// 오프라인일 때만 캐시된 버전을 반환하여 구버전 코드 고착을 방지합니다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Firebase Firestore 실시간 통신 스트림은 서비스 워커 캐시에서 제외
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
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cloned);
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
