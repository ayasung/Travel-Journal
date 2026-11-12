/**
 * 반응형 올인원 여행 플래너 웹 앱 - app.js (실시간 환율 API 2중화 + Firebase 하이브리드 완결판)
 * - Playcode / Web 전역 실행 보장 (모든 상호작용 함수 window 바인딩)
 * - 실시간 환율 조회 2중 API:
 *   1순위: https://open.er-api.com/v6/latest/{통화코드}
 *   2순위: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{소문자통화코드}.json
 * - 모든 외화 '1 외화 = OOO.OO 대표통화(KRW 등)' 소수점 둘째 자리(toFixed(2)) 통일
 * - 지출/예약 모달 통화 변경 및 [최신 환율 불러오기] 즉시 API 호출 & 자동 입력
 * - 상단 환율 스냅샷 갱신 시각(MM/DD HH:mm 기준) 표시 및 Firestore 즉시 동기화
 */

// ==========================================
// 0. Firebase 설정 템플릿 (발급받은 키를 붙여넣으면 즉시 실시간 동기화 모드로 전환됩니다)
// ==========================================
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// ==========================================
// 0-1. 동적 PWA Web App Manifest 등록 (Android / iOS 홈 화면 추가 시 standalone 앱 모드)
// ==========================================
(function registerDynamicPwaManifest() {
  try {
    const svgIcon = encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0%' stop-color='#0284c7'/><stop offset='100%' stop-color='#0f172a'/>` +
      `</linearGradient></defs>` +
      `<rect width='512' height='512' rx='112' fill='url(#g)'/>` +
      `<rect x='136' y='96' width='240' height='320' rx='28' fill='#ffffff' fill-opacity='0.14' stroke='#ffffff' stroke-width='16'/>` +
      `<circle cx='256' cy='228' r='56' fill='none' stroke='#38bdf8' stroke-width='14'/>` +
      `<path d='M256 172v112M200 228h112' stroke='#38bdf8' stroke-width='10'/>` +
      `<path d='M180 340l76-36 76 36-76-14z' fill='#ffffff'/>` +
      `</svg>`
    );
    const iconDataUri = `data:image/svg+xml;utf8,${svgIcon}`;

    const manifestObj = {
      name: 'Travel Log - 나의 여행 아카이브',
      short_name: 'Travel Log',
      description: '오프라인 및 실시간 동기화를 지원하는 올인원 반응형 여행 플래너',
      start_url: window.location.href,
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f8fafc',
      theme_color: '#0f172a',
      icons: [
        {
          src: iconDataUri,
          sizes: '192x192 512x512',
          type: 'image/svg+xml',
          purpose: 'any maskable'
        }
      ]
    };

    const blob = new Blob([JSON.stringify(manifestObj)], { type: 'application/manifest+json' });
    const manifestUrl = URL.createObjectURL(blob);

    let linkEl = document.querySelector('link[rel="manifest"]');
    if (!linkEl) {
      linkEl = document.createElement('link');
      linkEl.rel = 'manifest';
      document.head.appendChild(linkEl);
    }
    linkEl.href = manifestUrl;
  } catch (e) {
    console.warn('동적 PWA Manifest 생성 건너뜀:', e);
  }
})();

// ==========================================
// 1. 공통 상수 및 환율/항공사 데이터베이스
// ==========================================
const MULTI_TRIP_STORAGE_KEY = 'ALL_IN_ONE_MULTI_TRIP_ARCHIVE_V2';
const LEGACY_SINGLE_STORAGE_KEY = 'ALL_IN_ONE_TRAVEL_PLANNER_DATA';
const DEVICE_USER_ID_KEY = 'ALL_IN_ONE_TRAVEL_DEVICE_USER_ID';

// 오프라인 최후 Fallback 전용 기본 환율 테이블 (1 외화 = OOO.OO KRW)
const FALLBACK_RATES_TO_KRW = {
  KRW: 1.00,
  JPY: 9.15,
  USD: 1395.50,
  EUR: 1490.00,
  GBP: 1750.00,
  TWD: 43.00,
  THB: 38.50,
  VND: 0.06,
  CNY: 193.00
};

// 세션 내 조회된 실시간 환율 캐시 (통화쌍 -> 소수점 2자리 숫자)
const liveRateCache = {};

const AIRLINE_PREFIX_MAP = {
  'RS': '에어서울',
  'KE': '대한항공',
  'OZ': '아시아나항공',
  '7C': '제주항공',
  'LJ': '진에어',
  'TW': '티웨이항공',
  'ZE': '이스타항공',
  'BX': '에어부산',
  'RF': '에어로케이',
  'YP': '에어프레미아',
  'JL': '일본항공',
  'NH': '전일본공수(ANA)',
  'MM': '피치항공',
  'CI': '중화항공',
  'BR': '에바항공',
  'CX': '캐세이퍼시픽',
  'SQ': '싱가포르항공',
  'VN': '베트남항공',
  'VJ': '비엣젯항공',
  'TG': '타이항공',
  'MH': '말레이시아항공',
  'PR': '필리핀항공',
  '5J': '세부퍼시픽',
  'TR': '스코트',
  'UO': '홍콩익스프레스',
  'MU': '중국동방항공',
  'CZ': '중국남방항공',
  'CA': '중국국제항공',
  'DL': '델타항공',
  'UA': '유나이티드항공',
  'AA': '아메리칸항공',
  'AC': '에어캐나다',
  'HA': '하와이안항공',
  'LH': '루프트한자',
  'AF': '에어프랑스',
  'KL': 'KLM 네덜란드항공',
  'AY': '핀에어',
  'EK': '에미레이트항공',
  'QR': '카타르항공',
  'EY': '에티하드항공'
};

const FLIGHT_SCHEDULE_DATABASE = {
  'RS471': { airline: '에어서울', dep: '인천 ICN', arr: '요나고 YGJ', depTime: '13:20', arrTime: '14:50', memo: '제1여객터미널 탑승' },
  'RS472': { airline: '에어서울', dep: '요나고 YGJ', arr: '인천 ICN', depTime: '15:50', arrTime: '17:30', memo: '요나고 기타로 공항' },
  'RS701': { airline: '에어서울', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '08:05', arrTime: '10:35', memo: '제1여객터미널 탑승' },
  'RS702': { airline: '에어서울', dep: '도쿄 나리타 NRT', arr: '인천 ICN', depTime: '11:35', arrTime: '14:25', memo: '나리타 1터미널' },
  'RS711': { airline: '에어서울', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '07:15', arrTime: '09:05', memo: '제1여객터미널 탑승' },
  'RS712': { airline: '에어서울', dep: '오사카 간사이 KIX', arr: '인천 ICN', depTime: '10:05', arrTime: '12:00', memo: '간사이 1터미널' },
  'RS731': { airline: '에어서울', dep: '인천 ICN', arr: '후쿠오카 FUK', depTime: '09:00', arrTime: '10:30', memo: '제1여객터미널' },
  'RS741': { airline: '에어서울', dep: '인천 ICN', arr: '다낭 DAD', depTime: '18:40', arrTime: '21:50', memo: '제1여객터미널' },
  'RS761': { airline: '에어서울', dep: '인천 ICN', arr: '보라카이 칼리보 KLO', depTime: '08:20', arrTime: '12:05', memo: '제1여객터미널' },
  'RS901': { airline: '에어서울', dep: '김포 GMP', arr: '제주 CJU', depTime: '06:10', arrTime: '07:20', memo: '국내선 청사' },
  'KE703': { airline: '대한항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '10:10', arrTime: '12:45', memo: '제2여객터미널 탑승' },
  'KE704': { airline: '대한항공', dep: '도쿄 나리타 NRT', arr: '인천 ICN', depTime: '13:55', arrTime: '16:35', memo: '나리타 1터미널' },
  'KE721': { airline: '대한항공', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '09:00', arrTime: '10:50', memo: '제2여객터미널' },
  'KE781': { airline: '대한항공', dep: '인천 ICN', arr: '후쿠오카 FUK', depTime: '08:00', arrTime: '09:30', memo: '제2여객터미널' },
  'KE081': { airline: '대한항공', dep: '인천 ICN', arr: '뉴욕 JFK', depTime: '10:00', arrTime: '11:20', memo: '제2여객터미널' },
  'KE017': { airline: '대한항공', dep: '인천 ICN', arr: '로스앤젤레스 LAX', depTime: '14:30', arrTime: '09:40', memo: '제2여객터미널' },
  'KE901': { airline: '대한항공', dep: '인천 ICN', arr: '파리 CDG', depTime: '12:15', arrTime: '18:30', memo: '제2여객터미널' },
  'KE1201': { airline: '대한항공', dep: '김포 GMP', arr: '제주 CJU', depTime: '06:10', arrTime: '07:20', memo: '국내선' },
  'OZ102': { airline: '아시아나항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '09:00', arrTime: '11:30', memo: '제1여객터미널' },
  'OZ101': { airline: '아시아나항공', dep: '도쿄 나리타 NRT', arr: '인천 ICN', depTime: '12:30', arrTime: '15:10', memo: '나리타 1터미널' },
  'OZ112': { airline: '아시아나항공', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '08:00', arrTime: '09:40', memo: '제1여객터미널' },
  'OZ132': { airline: '아시아나항공', dep: '인천 ICN', arr: '후쿠오카 FUK', depTime: '09:00', arrTime: '10:30', memo: '제1여객터미널' },
  'OZ202': { airline: '아시아나항공', dep: '인천 ICN', arr: '로스앤젤레스 LAX', depTime: '14:40', arrTime: '09:50', memo: '제1여객터미널' },
  'OZ541': { airline: '아시아나항공', dep: '인천 ICN', arr: '프랑크푸르트 FRA', depTime: '10:35', arrTime: '16:30', memo: '제1여객터미널' },
  '7C1102': { airline: '제주항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '06:55', arrTime: '09:30', memo: '제1여객터미널' },
  '7C1101': { airline: '제주항공', dep: '도쿄 나리타 NRT', arr: '인천 ICN', depTime: '11:45', arrTime: '14:30', memo: '나리타 3터미널' },
  '7C1302': { airline: '제주항공', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '09:10', arrTime: '11:00', memo: '제1여객터미널' },
  '7C1402': { airline: '제주항공', dep: '인천 ICN', arr: '후쿠오카 FUK', depTime: '06:15', arrTime: '07:45', memo: '제1여객터미널' },
  '7C2605': { airline: '제주항공', dep: '인천 ICN', arr: '타이베이 TPE', depTime: '09:05', arrTime: '10:55', memo: '제1여객터미널' },
  'LJ201': { airline: '진에어', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '07:25', arrTime: '10:00', memo: '제2여객터미널' },
  'LJ211': { airline: '진에어', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '08:00', arrTime: '09:45', memo: '제2여객터미널' },
  'LJ221': { airline: '진에어', dep: '인천 ICN', arr: '후쿠오카 FUK', depTime: '07:15', arrTime: '08:45', memo: '제2여객터미널' },
  'LJ641': { airline: '진에어', dep: '인천 ICN', arr: '괌 GUM', depTime: '09:00', arrTime: '14:30', memo: '제2여객터미널' },
  'TW211': { airline: '티웨이항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '07:45', arrTime: '10:20', memo: '제1여객터미널' },
  'TW281': { airline: '티웨이항공', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '07:55', arrTime: '09:45', memo: '제1여객터미널' },
  'TW401': { airline: '티웨이항공', dep: '인천 ICN', arr: '파리 CDG', depTime: '10:10', arrTime: '18:10', memo: '제1여객터미널' },
  'TW405': { airline: '티웨이항공', dep: '인천 ICN', arr: '로마 FCO', depTime: '12:35', arrTime: '19:15', memo: '제1여객터미널' },
  'ZE601': { airline: '이스타항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '08:00', arrTime: '10:30', memo: '제1여객터미널' },
  'BX112': { airline: '에어부산', dep: '부산 PUS', arr: '도쿄 나리타 NRT', depTime: '08:05', arrTime: '10:10', memo: '김해국제공항' },
  'RF312': { airline: '에어로케이', dep: '청주 CJJ', arr: '도쿄 나리타 NRT', depTime: '09:30', arrTime: '11:50', memo: '청주국제공항' },
  'YP101': { airline: '에어프레미아', dep: '인천 ICN', arr: '로스앤젤레스 LAX', depTime: '13:30', arrTime: '08:30', memo: '제1여객터미널' },
  'YP731': { airline: '에어프레미아', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '08:30', arrTime: '11:00', memo: '제1여객터미널' },
  'JL090': { airline: '일본항공', dep: '김포 GMP', arr: '도쿄 하네다 HND', depTime: '08:00', arrTime: '10:10', memo: '김포국제선' },
  'NH862': { airline: '전일본공수(ANA)', dep: '김포 GMP', arr: '도쿄 하네다 HND', depTime: '07:45', arrTime: '09:55', memo: '김포국제선' },
  'MM708': { airline: '피치항공', dep: '인천 ICN', arr: '도쿄 하네다 HND', depTime: '22:40', arrTime: '00:55', memo: '제1여객터미널' },
  'CI161': { airline: '중화항공', dep: '인천 ICN', arr: '타이베이 TPE', depTime: '12:35', arrTime: '14:10', memo: '제2여객터미널' },
  'BR169': { airline: '에바항공', dep: '인천 ICN', arr: '타이베이 TPE', depTime: '12:00', arrTime: '13:40', memo: '제1여객터미널' },
  'CX415': { airline: '캐세이퍼시픽', dep: '인천 ICN', arr: '홍콩 HKG', depTime: '08:40', arrTime: '11:35', memo: '제1여객터미널' },
  'SQ607': { airline: '싱가포르항공', dep: '인천 ICN', arr: '싱가포르 SIN', depTime: '09:00', arrTime: '14:30', memo: '제1여객터미널' },
  'VN431': { airline: '베트남항공', dep: '인천 ICN', arr: '다낭 DAD', depTime: '11:20', arrTime: '14:15', memo: '제1여객터미널' },
  'TG657': { airline: '타이항공', dep: '인천 ICN', arr: '방콕 BKK', depTime: '10:50', arrTime: '14:45', memo: '제1여객터미널' },
  'DL198': { airline: '델타항공', dep: '인천 ICN', arr: '애틀랜타 ATL', depTime: '18:40', arrTime: '18:35', memo: '제2여객터미널' },
  'UA892': { airline: '유나이티드항공', dep: '인천 ICN', arr: '샌프란시스코 SFO', depTime: '16:50', arrTime: '11:30', memo: '제1여객터미널' },
  'LH713': { airline: '루프트한자', dep: '인천 ICN', arr: '프랑크푸르트 FRA', depTime: '14:35', arrTime: '21:05', memo: '제1여객터미널' },
  'AF267': { airline: '에어프랑스', dep: '인천 ICN', arr: '파리 CDG', depTime: '09:05', arrTime: '15:55', memo: '제2여객터미널' },
  'EK323': { airline: '에미레이트항공', dep: '인천 ICN', arr: '두바이 DXB', depTime: '23:55', arrTime: '04:55', memo: '제1여객터미널' }
};

// ==========================================
// 2. 기기 고유 식별자(userId) & Firebase 하이브리드 상태
// ==========================================
function getOrCreateDeviceUserId() {
  try {
    let uid = localStorage.getItem(DEVICE_USER_ID_KEY);
    if (!uid) {
      uid = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      localStorage.setItem(DEVICE_USER_ID_KEY, uid);
    }
    return uid;
  } catch (e) {
    return 'user_temp_' + Math.random().toString(36).substr(2, 6);
  }
}

const currentUserId = getOrCreateDeviceUserId();
let db = null;
let isCloudMode = false;
let unsubscribeTripsSnapshot = null;
const privateDocsCache = {};

let trips = [];
let currentTripId = null;

let currentMainMode = 'items';
let currentSubTab = 'timeline';
let currentDatesDay = 1;
let currentChecklistType = 'packing';
let currentPhotoFilter = '전체';
let currentReviewFilter = '전체';
let currentLightboxPhotoId = null;
let selectedReviewPhotoIds = [];
let isExchangeSectionOpen = true;

// ==========================================
// 3. 실시간 환율 API 조회 엔진 (1순위 open.er-api.com -> 2순위 jsdelivr currency-api)
// ==========================================
/**
 * 1 외화(foreignCurr) = OOO.OO 기준통화(baseCurr, 기본 KRW) 실시간 환율 조회
 * - 1순위: https://open.er-api.com/v6/latest/{통화코드}
 * - 2순위: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{소문자통화코드}.json
 * - 반환값: 소수점 둘째 자리 반올림 숫자 (예: 9.15, 1395.50)
 */
async function fetchLiveExchangeRate(foreignCurr, baseCurr = 'KRW') {
  const fromCode = (foreignCurr || 'KRW').trim().toUpperCase();
  const toCode = (baseCurr || 'KRW').trim().toUpperCase();

  if (fromCode === toCode) return 1.00;

  const cacheKey = `${fromCode}_${toCode}`;
  let fetchedRate = null;

  // [1순위] open.er-api.com 호출
  try {
    const res1 = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(fromCode)}`, {
      cache: 'no-store'
    });
    if (res1.ok) {
      const data1 = await res1.json();
      if (data1 && data1.result === 'success' && data1.rates && typeof data1.rates[toCode] === 'number') {
        fetchedRate = data1.rates[toCode];
      }
    }
  } catch (err1) {
    console.warn(`[환율 1순위 API 실패: ${fromCode}->${toCode}]`, err1);
  }

  // [2순위] jsdelivr currency-api 호출 (1순위 실패 시 Fallback)
  if (!(fetchedRate > 0)) {
    try {
      const lowerFrom = fromCode.toLowerCase();
      const lowerTo = toCode.toLowerCase();
      const res2 = await fetch(
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${encodeURIComponent(lowerFrom)}.json`,
        { cache: 'no-store' }
      );
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2 && data2[lowerFrom] && typeof data2[lowerFrom][lowerTo] === 'number') {
          fetchedRate = data2[lowerFrom][lowerTo];
        }
      }
    } catch (err2) {
      console.warn(`[환율 2순위 API 실패: ${fromCode}->${toCode}]`, err2);
    }
  }

  // API 모두 실패 시 내장 기본값 사용
  if (!(fetchedRate > 0)) {
    fetchedRate = getFallbackRateToBase(fromCode, toCode);
  }

  const roundedRate = Number(Number(fetchedRate).toFixed(2));
  liveRateCache[cacheKey] = roundedRate;
  return roundedRate;
}

function getFallbackRateToBase(foreignCurr, baseCurr = 'KRW') {
  const f = (foreignCurr || 'KRW').trim().toUpperCase();
  const b = (baseCurr || 'KRW').trim().toUpperCase();
  if (f === b) return 1.00;

  const cacheKey = `${f}_${b}`;
  if (Number(liveRateCache[cacheKey]) > 0) {
    return Number(Number(liveRateCache[cacheKey]).toFixed(2));
  }

  const fInKrw = FALLBACK_RATES_TO_KRW[f] || 1;
  const bInKrw = FALLBACK_RATES_TO_KRW[b] || 1;
  const rate = fInKrw / bInKrw;
  return Number(rate.toFixed(2));
}

function formatShortSyncTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} 기준`;
}

// ==========================================
// 4. Firebase 초기화 및 동기화 상태 배지 제어
// ==========================================
function updateSyncStatusBadges(cloudConnected) {
  const badges = ['homeSyncStatusBadge', 'detailSyncStatusBadge'];
  badges.forEach(id => {
    const el = getEl(id);
    if (!el) return;
    if (cloudConnected) {
      el.className = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700';
      el.textContent = '🟢 실시간 동기화 중';
    } else {
      el.className = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500';
      el.textContent = '⚪ 로컬 모드 (클라우드 미연결)';
    }
  });
}

function initFirebaseHybrid() {
  const hasApiKey = firebaseConfig && typeof firebaseConfig.apiKey === 'string' && firebaseConfig.apiKey.trim() !== '';
  const hasFirebaseSdk = (typeof window.firebase !== 'undefined') && typeof window.firebase.firestore === 'function';

  if (!hasApiKey || !hasFirebaseSdk) {
    isCloudMode = false;
    db = null;
    updateSyncStatusBadges(false);
    return false;
  }

  try {
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(firebaseConfig);
    }
    db = window.firebase.firestore();
    isCloudMode = true;
    updateSyncStatusBadges(true);
    return true;
  } catch (e) {
    console.warn('Firebase 초기화 실패, 로컬 모드로 자동 전환됩니다:', e);
    isCloudMode = false;
    db = null;
    updateSyncStatusBadges(false);
    return false;
  }
}

// ==========================================
// 5. 방어형 DOM 접근 및 클립보드·환율 헬퍼
// ==========================================
function getEl(id) {
  return document.getElementById(id);
}

function getVal(id) {
  const el = getEl(id);
  return el ? el.value : '';
}

function setVal(id, val) {
  const el = getEl(id);
  if (el) el.value = val;
}

function setText(id, str) {
  const el = getEl(id);
  if (el) el.textContent = str;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeParam(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function copyTextToClipboard(textStr, successMsg) {
  if (!textStr) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textStr).then(() => {
      alert(successMsg);
    }).catch(() => {
      fallbackCopyText(textStr, successMsg);
    });
  } else {
    fallbackCopyText(textStr, successMsg);
  }
}

function fallbackCopyText(textStr, successMsg) {
  const temp = document.createElement('textarea');
  temp.value = textStr;
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    alert(successMsg);
  } catch (e) {
    alert('클립보드 복사에 실패했습니다.');
  }
  temp.remove();
}

function getNowTimestampStr() {
  return formatShortSyncTimestamp();
}

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TR-${suffix}`;
}

function getActiveTrip() {
  if (!currentTripId) return null;
  return trips.find(t => t.id === currentTripId) || null;
}

function getMeName(trip) {
  if (!trip) return '나';
  if (trip.myMemberName && String(trip.myMemberName).trim() !== '') {
    return String(trip.myMemberName).trim();
  }
  const members = trip?.shared?.members;
  if (Array.isArray(members) && members.length > 0 && String(members[0]).trim() !== '') {
    return String(members[0]).trim();
  }
  return '나';
}

function getAverageExchangeRateForCurrency(trip, foreignCurr) {
  const exchanges = trip?.privateBudget?.exchanges || [];
  const target = (foreignCurr || '').trim().toUpperCase();
  const matching = exchanges.filter(ex => (ex.currency || '').trim().toUpperCase() === target);
  if (matching.length === 0) return null;

  let totalForeign = 0;
  let totalBase = 0;
  matching.forEach(ex => {
    totalForeign += Number(ex.foreignAmount) || 0;
    totalBase += Number(ex.baseAmount) || 0;
  });
  if (totalForeign <= 0) return null;
  const avg = totalBase / totalForeign;
  return Number(avg.toFixed(2));
}

function getItemConvertedAmount(item, baseCurr) {
  const amount = Number(item.amount) || 0;
  const curr = (item.currency || baseCurr || 'KRW').trim().toUpperCase();
  const base = (baseCurr || 'KRW').trim().toUpperCase();

  if (curr === base) return amount;

  const rate = (Number(item.appliedRate) > 0)
    ? Number(item.appliedRate)
    : getFallbackRateToBase(curr, base);

  return amount * rate;
}

function getItemConvertedToKRW(exp, baseCurr) {
  const amount = Number(exp.amount) || 0;
  const curr = (exp.currency || baseCurr || 'KRW').trim().toUpperCase();
  if (curr === 'KRW') return amount;

  const base = (baseCurr || 'KRW').trim().toUpperCase();
  if (base === 'KRW') {
    const rateToKrw = (Number(exp.appliedRate) > 0)
      ? Number(exp.appliedRate)
      : (FALLBACK_RATES_TO_KRW[curr] || 1);
    return amount * rateToKrw;
  }

  const rateToBase = (Number(exp.appliedRate) > 0)
    ? Number(exp.appliedRate)
    : getFallbackRateToBase(curr, base);
  const inBase = amount * rateToBase;
  const baseToKrw = FALLBACK_RATES_TO_KRW[base] || 1;
  return inBase * baseToKrw;
}

function ensureExpenseSchema(exp, defaultMe = '나', baseCurr = 'KRW') {
  const payerClean = String(exp.payer || defaultMe).trim();

  let rawParticipants = [];
  if (Array.isArray(exp.participants) && exp.participants.length > 0) {
    rawParticipants = exp.participants;
  } else if (Array.isArray(exp.splits) && exp.splits.length > 0) {
    rawParticipants = exp.splits.map(s => s.member);
  } else {
    rawParticipants = [payerClean];
  }
  const participants = Array.from(new Set(rawParticipants.map(m => String(m).trim()).filter(Boolean)));

  if (!exp.settledMembers || typeof exp.settledMembers !== 'object') {
    const migratedMap = {};
    if (Array.isArray(exp.splits)) {
      exp.splits.forEach(s => {
        const m = String(s.member || '').trim();
        if (m && s.checked === true) {
          migratedMap[m] = true;
        }
      });
    }
    exp.settledMembers = migratedMap;
  }

  if (exp.splits) {
    delete exp.splits;
  }

  const curr = (exp.currency || baseCurr).trim().toUpperCase();
  if (!(Number(exp.appliedRate) > 0)) {
    exp.appliedRate = getFallbackRateToBase(curr, baseCurr);
  }
  if (!exp.rateTimestamp) {
    exp.rateTimestamp = formatShortSyncTimestamp();
  }
  exp.convertedAmount = Math.round((Number(exp.amount) || 0) * Number(exp.appliedRate));

  exp.payer = payerClean;
  exp.participants = participants;
  return exp;
}

function createTripObject({
  id = null,
  inviteCode = null,
  memberIds = null,
  myMemberName = null,
  createdAt = null,
  title = '나의 여행',
  startDate = '2026-11-12',
  endDate = '2026-11-15',
  members = ['나'],
  baseCurrency = 'KRW',
  totalBudget = 0,
  ratesSyncTime = null,
  latestSnapshotText = '',
  schedules = [],
  spots = [],
  reservations = [],
  expenses = [],
  photos = [],
  reviews = [],
  checklists = { packing: [], shopping: [] },
  exchanges = []
} = {}) {
  const cleanMembers = Array.isArray(members) && members.length > 0
    ? members.map(m => String(m).trim()).filter(Boolean)
    : ['나'];
  const resolvedMyName = (myMemberName && String(myMemberName).trim()) ? String(myMemberName).trim() : (cleanMembers[0] || '나');
  const cleanBaseCurr = (baseCurrency || 'KRW').trim().toUpperCase();
  const cleanMemberIds = Array.isArray(memberIds) && memberIds.length > 0
    ? Array.from(new Set([...memberIds, currentUserId]))
    : [currentUserId];

  const cleanExpenses = Array.isArray(expenses)
    ? expenses.map(ex => ensureExpenseSchema({ ...ex }, resolvedMyName, cleanBaseCurr))
    : [];

  const cleanReservations = Array.isArray(reservations)
    ? reservations.map(r => {
        const resCurr = (r.currency || cleanBaseCurr).trim().toUpperCase();
        const appliedRate = (Number(r.appliedRate) > 0)
          ? Number(r.appliedRate)
          : getFallbackRateToBase(resCurr, cleanBaseCurr);
        return {
          ...r,
          appliedRate,
          rateTimestamp: r.rateTimestamp || ratesSyncTime || formatShortSyncTimestamp(),
          convertedAmount: Math.round((Number(r.amount) || 0) * appliedRate)
        };
      })
    : [];

  return {
    id: id || 'trip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    inviteCode: inviteCode || generateInviteCode(),
    memberIds: cleanMemberIds,
    myMemberName: resolvedMyName,
    createdAt: createdAt || new Date().toISOString(),
    shared: {
      title,
      startDate,
      endDate,
      members: cleanMembers,
      baseCurrency: cleanBaseCurr,
      currencies: ['KRW', 'JPY', 'USD', 'EUR'],
      ratesSyncTime: ratesSyncTime || formatShortSyncTimestamp(),
      latestSnapshotText: latestSnapshotText || '',
      schedules: Array.isArray(schedules) ? schedules : [],
      spots: Array.isArray(spots) ? spots : [],
      reservations: cleanReservations,
      expenses: cleanExpenses,
      photos: Array.isArray(photos) ? photos : [],
      reviews: Array.isArray(reviews) ? reviews : [],
      checklists: {
        packing: Array.isArray(checklists?.packing) ? checklists.packing : [],
        shopping: Array.isArray(checklists?.shopping) ? checklists.shopping : []
      }
    },
    privateBudget: {
      totalBudget: Number(totalBudget) || 0,
      currency: cleanBaseCurr,
      categoryBudgets: {},
      exchanges: Array.isArray(exchanges) ? exchanges : []
    }
  };
}

function normalizeTripSchema(rawTrip) {
  if (!rawTrip || typeof rawTrip !== 'object') return null;

  if (rawTrip.shared) {
    const privCache = privateDocsCache[rawTrip.id];
    const privSource = rawTrip.privateBudget || privCache?.privateBudget || { totalBudget: 0, currency: rawTrip.shared.baseCurrency || 'KRW', exchanges: [] };
    const resolvedMyName = rawTrip.myMemberName || privCache?.myMemberName || (rawTrip.shared.members?.[0] || '나');

    const normalized = createTripObject({
      id: rawTrip.id,
      inviteCode: rawTrip.inviteCode,
      memberIds: rawTrip.memberIds,
      myMemberName: resolvedMyName,
      createdAt: rawTrip.createdAt,
      title: rawTrip.shared.title,
      startDate: rawTrip.shared.startDate,
      endDate: rawTrip.shared.endDate,
      members: rawTrip.shared.members,
      baseCurrency: privSource.currency || rawTrip.shared.baseCurrency || 'KRW',
      totalBudget: privSource.totalBudget || 0,
      ratesSyncTime: rawTrip.shared.ratesSyncTime || formatShortSyncTimestamp(),
      latestSnapshotText: rawTrip.shared.latestSnapshotText || '',
      schedules: rawTrip.shared.schedules || [],
      spots: rawTrip.shared.spots || rawTrip.shared.candidates || [],
      reservations: rawTrip.shared.reservations || [],
      expenses: rawTrip.shared.expenses || [],
      photos: rawTrip.shared.photos || [],
      reviews: rawTrip.shared.reviews || [],
      checklists: rawTrip.shared.checklists || { packing: [], shopping: [] },
      exchanges: Array.isArray(privSource.exchanges) ? privSource.exchanges : []
    });
    normalized.shared.photos.forEach(p => { if (!p.category) p.category = '기타'; });
    normalized.shared.reviews.forEach(r => { if (!Array.isArray(r.photoIds)) r.photoIds = []; });
    return normalized;
  }

  if (rawTrip.tripInfo) {
    const migrated = createTripObject({
      title: rawTrip.tripInfo.title || '기존 여행 기록',
      startDate: rawTrip.tripInfo.startDate || '2026-11-12',
      endDate: rawTrip.tripInfo.endDate || '2026-11-15',
      members: rawTrip.tripInfo.members || ['나'],
      baseCurrency: rawTrip.budget?.baseCurrency || 'KRW',
      totalBudget: rawTrip.budget?.amount || 0,
      ratesSyncTime: rawTrip.budget?.ratesSyncTime || formatShortSyncTimestamp(),
      schedules: rawTrip.schedules || [],
      spots: rawTrip.candidates || [],
      reservations: rawTrip.reservations || [],
      expenses: rawTrip.expenses || [],
      photos: rawTrip.photos || [],
      reviews: rawTrip.reviews || [],
      checklists: rawTrip.checklists || { packing: [], shopping: [] },
      exchanges: []
    });
    migrated.shared.photos.forEach(p => { if (!p.category) p.category = '기타'; });
    migrated.shared.reviews.forEach(r => { if (!Array.isArray(r.photoIds)) r.photoIds = []; });
    return migrated;
  }

  return null;
}

// ==========================================
// 6. 하이브리드 저장소 동기화 (LocalStorage + Firestore 실시간 구독)
// ==========================================
function loadLocalTripsFromStorage() {
  try {
    const multiRaw = localStorage.getItem(MULTI_TRIP_STORAGE_KEY);
    if (multiRaw) {
      const parsed = JSON.parse(multiRaw);
      if (Array.isArray(parsed)) {
        trips = parsed.map(normalizeTripSchema).filter(Boolean);
        return;
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_SINGLE_STORAGE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      const migratedTrip = normalizeTripSchema(legacyParsed);
      if (migratedTrip) {
        trips = [migratedTrip];
        saveLocalTripsToStorage();
        return;
      }
    }

    trips = [];
  } catch (e) {
    trips = [];
  }
}

function saveLocalTripsToStorage() {
  try {
    localStorage.setItem(MULTI_TRIP_STORAGE_KEY, JSON.stringify(trips));
  } catch (e) {
    alert('로컬 저장 용량 한도 초과 또는 저장 중 오류가 발생했습니다.');
  }
}

async function syncTripToFirestore(trip) {
  if (!isCloudMode || !db || !trip) return;

  const publicPayload = {
    id: trip.id,
    inviteCode: trip.inviteCode,
    memberIds: Array.isArray(trip.memberIds) ? trip.memberIds : [currentUserId],
    createdAt: trip.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    shared: trip.shared
  };

  const privatePayload = {
    myMemberName: getMeName(trip),
    privateBudget: trip.privateBudget,
    updatedAt: new Date().toISOString()
  };

  const approxByteSize = new Blob([JSON.stringify(publicPayload)]).size;
  if (approxByteSize > 950000) {
    alert('클라우드 문서 용량 한도(1MB)에 근접하여 동기화가 제한되었습니다. 불필요한 사진을 일부 삭제한 후 다시 시도해주세요.');
    return;
  }

  try {
    const tripRef = db.collection('trips').doc(trip.id);
    const privateRef = tripRef.collection('private').doc(currentUserId);

    await Promise.all([
      tripRef.set(publicPayload, { merge: true }),
      privateRef.set(privatePayload, { merge: true })
    ]);
  } catch (err) {
    console.error('Firestore 동기화 오류:', err);
    if (err && (err.code === 'invalid-argument' || String(err.message).includes('exceeds the maximum allowed size'))) {
      alert('사진 용량이 너무 커서 클라우드 문서 제한(1MB)을 초과했습니다. 사진 개수를 줄여주세요.');
    }
  }
}

function saveAllTripsToStorage(targetTrip = null) {
  saveLocalTripsToStorage();
  const active = targetTrip || getActiveTrip();
  if (isCloudMode && db && active) {
    syncTripToFirestore(active);
  }
}

function startFirestoreRealtimeSubscription() {
  if (!isCloudMode || !db) return;

  if (typeof unsubscribeTripsSnapshot === 'function') {
    unsubscribeTripsSnapshot();
  }

  unsubscribeTripsSnapshot = db
    .collection('trips')
    .where('memberIds', 'array-contains', currentUserId)
    .onSnapshot(
      async snapshot => {
        const cloudTrips = [];

        for (const doc of snapshot.docs) {
          const data = doc.data();
          const tripId = doc.id;

          if (!privateDocsCache[tripId]) {
            try {
              const privSnap = await db.collection('trips').doc(tripId).collection('private').doc(currentUserId).get();
              if (privSnap.exists) {
                privateDocsCache[tripId] = privSnap.data();
              } else {
                const localMatch = trips.find(t => t.id === tripId);
                if (localMatch) {
                  privateDocsCache[tripId] = {
                    myMemberName: localMatch.myMemberName,
                    privateBudget: localMatch.privateBudget
                  };
                }
              }
            } catch (e) {
              console.warn('개인 예산 문서 로드 경고:', e);
            }
          }

          const normalized = normalizeTripSchema({ ...data, id: tripId });
          if (normalized) {
            cloudTrips.push(normalized);
          }
        }

        const cloudIds = new Set(cloudTrips.map(t => t.id));
        const localOnlyTrips = trips.filter(t => !cloudIds.has(t.id));
        localOnlyTrips.forEach(lt => {
          lt.memberIds = Array.from(new Set([...(lt.memberIds || []), currentUserId]));
          syncTripToFirestore(lt);
        });

        trips = [...cloudTrips, ...localOnlyTrips];
        saveLocalTripsToStorage();

        if (currentTripId) {
          window.renderAll();
        } else {
          window.renderHomeView();
        }
      },
      err => {
        console.error('Firestore 실시간 구독 오류:', err);
        updateSyncStatusBadges(false);
      }
    );
}

// ==========================================
// 7. [신규] 상단 환율 스냅샷 실시간 갱신 (`refreshTopExchangeSnapshot`)
// ==========================================
window.refreshTopExchangeSnapshot = async function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const baseCurr = (trip.privateBudget.currency || trip.shared.baseCurrency || 'KRW').trim().toUpperCase();
  const syncEl = getEl('exchangeRateSyncTime');
  if (syncEl) syncEl.textContent = '실시간 환율 조회 중...';

  // 현재 여행에서 사용 중인 주요 통화들(JPY, USD, EUR 등)의 실시간 환율 일괄 조회
  const targetCurrencies = ['JPY', 'USD', 'EUR'].filter(c => c !== baseCurr);
  const summaryParts = [];

  for (const curr of targetCurrencies) {
    const rate = await fetchLiveExchangeRate(curr, baseCurr);
    summaryParts.push(`1 ${curr} = ${rate.toFixed(2)} ${baseCurr}`);
  }

  const timeLabel = formatShortSyncTimestamp();
  const snapshotText = `${timeLabel} (${summaryParts.join(' · ')})`;

  trip.shared.ratesSyncTime = timeLabel;
  trip.shared.latestSnapshotText = snapshotText;

  saveAllTripsToStorage(trip);
  renderExchangeSnapshotHeader(trip);
};

function renderExchangeSnapshotHeader(trip) {
  const syncEl = getEl('exchangeRateSyncTime');
  if (!syncEl || !trip) return;

  const sh = trip.shared;
  const displayStr = sh.latestSnapshotText
    ? `환율: ${sh.latestSnapshotText}`
    : `환율: ${sh.ratesSyncTime || formatShortSyncTimestamp()}`;

  syncEl.innerHTML = `
    <span class="inline-flex items-center gap-1.5 flex-wrap">
      <span>${escapeHtml(displayStr)}</span>
      <button type="button" onclick="window.refreshTopExchangeSnapshot()" class="px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded text-[10px] font-bold transition" title="최신 실시간 환율 스냅샷 갱신">
        갱신 🔄
      </button>
    </span>
  `;
}

// ==========================================
// 8. [전역 바인딩] 뷰 전환: 홈(#homeView) <-> 상세(#tripDetailView)
// ==========================================
window.goBackToHome = function() {
  currentTripId = null;
  const homeEl = getEl('homeView');
  const detailEl = getEl('tripDetailView');
  if (detailEl) detailEl.classList.add('hidden');
  if (homeEl) homeEl.classList.remove('hidden');
  window.renderHomeView();
};

window.enterTripDetail = function(tripId) {
  const target = trips.find(t => t.id === tripId);
  if (!target) return;

  currentTripId = tripId;
  currentMainMode = 'items';
  currentSubTab = 'timeline';
  currentDatesDay = 1;
  currentPhotoFilter = '전체';
  currentReviewFilter = '전체';

  const homeEl = getEl('homeView');
  const detailEl = getEl('tripDetailView');
  if (homeEl) homeEl.classList.add('hidden');
  if (detailEl) detailEl.classList.remove('hidden');

  const bItems = getEl('tabModeItems');
  const bDates = getEl('tabModeDates');
  if (bItems) bItems.className = 'py-2.5 rounded-lg bg-white text-sky-600 shadow-xs transition';
  if (bDates) bDates.className = 'py-2.5 rounded-lg text-slate-500 transition';

  window.renderAll();

  // 상세 진입 시 스냅샷 텍스트가 비어있으면 백그라운드에서 최신 환율 자동 조회
  if (!target.shared.latestSnapshotText) {
    window.refreshTopExchangeSnapshot();
  }
};

// ==========================================
// 9. [전역 바인딩] 홈 화면 (#homeView) 렌더링 & 새 여행/초대 합류/삭제
// ==========================================
function getTripStatusBadge(startDateStr, endDateStr) {
  const todayStr = new Date().toISOString().split('T')[0];
  if (!startDateStr || !endDateStr) {
    return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">일정 미정</span>';
  }
  if (todayStr < startDateStr) {
    return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">예정</span>';
  } else if (todayStr >= startDateStr && todayStr <= endDateStr) {
    return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">여행중</span>';
  } else {
    return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">완료</span>';
  }
}

window.renderHomeView = function() {
  const container = getEl('tripArchiveListContainer');
  if (!container) return;

  setText('homeTripCount', String(trips.length));

  if (trips.length === 0) {
    container.innerHTML = `
      <div class="py-16 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2.5">
        <div class="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
          <i class="fa-solid fa-suitcase-rolling text-xl"></i>
        </div>
        <p class="text-xs font-bold text-slate-700">등록된 여행이 없습니다. 새 여행을 만들어보세요!</p>
        <p class="text-[11px] text-slate-400">일정, 예약, 다중 통화 정산, 사진과 리뷰까지 한 곳에서 관리할 수 있습니다.</p>
      </div>`;
    return;
  }

  const sortType = getVal('homeSortSelector') || 'latest';
  const sortedTrips = [...trips].sort((a, b) => {
    if (sortType === 'startDateDesc') {
      return (b.shared.startDate || '').localeCompare(a.shared.startDate || '');
    }
    if (sortType === 'startDateAsc') {
      return (a.shared.startDate || '').localeCompare(b.shared.startDate || '');
    }
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  container.innerHTML = '';

  sortedTrips.forEach(trip => {
    const sh = trip.shared;
    const statusBadge = getTripStatusBadge(sh.startDate, sh.endDate);
    const periodFormatted = (sh.startDate && sh.endDate)
      ? `${sh.startDate.replace(/-/g, '.')} ~ ${sh.endDate.replace(/-/g, '.')}`
      : '날짜 미설정';
    const members = sh.members || ['나'];

    const memberBadgesHtml = members.map(m =>
      `<span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">${escapeHtml(m)}</span>`
    ).join('');

    const card = document.createElement('div');
    card.className = 'bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-sky-300 transition cursor-pointer space-y-3';
    card.onclick = function() {
      window.enterTripDetail(trip.id);
    };

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="space-y-1 min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            ${statusBadge}
            <span class="text-[10px] font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">${escapeHtml(trip.inviteCode)}</span>
          </div>
          <h3 class="text-sm font-extrabold text-slate-800 truncate">${escapeHtml(sh.title)}</h3>
          <p class="text-xs text-slate-500 font-medium">${escapeHtml(periodFormatted)}</p>
        </div>
        <button type="button" onclick="event.stopPropagation(); window.deleteTripFromArchive('${trip.id}')" class="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition shrink-0" title="여행 삭제">
          <i class="fa-solid fa-trash-can text-xs"></i>
        </button>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-slate-100">
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[11px] text-slate-400 mr-0.5"><i class="fa-solid fa-users text-[10px] mr-1"></i>${members.length}명</span>
          ${memberBadgesHtml}
        </div>
        <span class="text-[11px] font-bold text-sky-600 shrink-0">열기 <i class="fa-solid fa-chevron-right text-[9px]"></i></span>
      </div>
    `;

    container.appendChild(card);
  });
};

window.openNewTripModal = function() {
  const form = getEl('formNewTrip');
  if (form) form.reset();
  const today = new Date().toISOString().split('T')[0];
  setVal('inputNewTripStartDate', today);
  setVal('inputNewTripEndDate', today);
  setVal('inputNewTripCurrency', 'KRW');
  setVal('inputNewTripMembers', '나, 동행1');
  window.openModal('newTripModal');
};

window.createNewTrip = function(e) {
  e.preventDefault();
  const title = getVal('inputNewTripTitle').trim();
  const startDate = getVal('inputNewTripStartDate');
  const endDate = getVal('inputNewTripEndDate');
  const currency = getVal('inputNewTripCurrency') || 'KRW';
  const budget = Number(getVal('inputNewTripBudget')) || 0;
  const rawMembers = getVal('inputNewTripMembers');

  let members = rawMembers.split(',').map(m => m.trim()).filter(Boolean);
  if (members.length === 0) members = ['나'];

  const newTrip = createTripObject({
    title,
    startDate,
    endDate,
    members,
    myMemberName: members[0],
    memberIds: [currentUserId],
    baseCurrency: currency,
    totalBudget: budget
  });

  privateDocsCache[newTrip.id] = {
    myMemberName: newTrip.myMemberName,
    privateBudget: newTrip.privateBudget
  };

  trips.unshift(newTrip);
  saveAllTripsToStorage(newTrip);
  window.closeModal('newTripModal');
  window.enterTripDetail(newTrip.id);
};

window.deleteTripFromArchive = async function(tripId) {
  const target = trips.find(t => t.id === tripId);
  if (!target) return;
  if (!confirm(`'${target.shared.title}' 여행 기록을 목록에서 삭제하시겠습니까?`)) return;

  if (isCloudMode && db) {
    try {
      const tripRef = db.collection('trips').doc(tripId);
      const remainingMembers = (target.memberIds || []).filter(uid => uid !== currentUserId);
      if (remainingMembers.length === 0) {
        await tripRef.delete();
      } else {
        await tripRef.update({
          memberIds: window.firebase.firestore.FieldValue.arrayRemove(currentUserId)
        });
      }
    } catch (e) {
      console.warn('Firestore 여행 삭제/탈퇴 처리 경고:', e);
    }
  }

  trips = trips.filter(t => t.id !== tripId);
  delete privateDocsCache[tripId];
  saveLocalTripsToStorage();
  window.renderHomeView();
};

window.openJoinTripModal = function() {
  const form = getEl('formJoinTrip');
  if (form) form.reset();
  window.openModal('joinTripModal');
};

window.joinTripByCode = async function(e) {
  e.preventDefault();
  const code = getVal('inputJoinInviteCode').trim().toUpperCase();
  const myNickname = getVal('inputJoinMyNickname').trim();

  if (!code || !myNickname) {
    alert('초대 코드와 내 표시 닉네임을 모두 입력해주세요.');
    return;
  }

  const localExisting = trips.find(t => (t.inviteCode || '').toUpperCase() === code);
  if (localExisting) {
    localExisting.myMemberName = myNickname;
    if (!localExisting.shared.members.includes(myNickname)) {
      localExisting.shared.members.push(myNickname);
    }
    privateDocsCache[localExisting.id] = {
      myMemberName: myNickname,
      privateBudget: localExisting.privateBudget
    };
    saveAllTripsToStorage(localExisting);
    window.closeModal('joinTripModal');
    window.enterTripDetail(localExisting.id);
    return;
  }

  if (isCloudMode && db) {
    try {
      const querySnap = await db.collection('trips').where('inviteCode', '==', code).limit(1).get();
      if (querySnap.empty) {
        alert('유효하지 않은 초대 코드입니다. 코드를 다시 확인해주세요.');
        return;
      }

      const doc = querySnap.docs[0];
      const tripId = doc.id;
      const data = doc.data();
      const sharedData = data.shared || {};
      const existingMembers = Array.isArray(sharedData.members) ? [...sharedData.members] : [];

      if (!existingMembers.includes(myNickname)) {
        existingMembers.push(myNickname);
      }

      await db.collection('trips').doc(tripId).update({
        memberIds: window.firebase.firestore.FieldValue.arrayUnion(currentUserId),
        'shared.members': existingMembers
      });

      const initialPrivateBudget = {
        totalBudget: 0,
        currency: sharedData.baseCurrency || 'KRW',
        categoryBudgets: {},
        exchanges: []
      };

      await db.collection('trips').doc(tripId).collection('private').doc(currentUserId).set({
        myMemberName: myNickname,
        privateBudget: initialPrivateBudget,
        joinedAt: new Date().toISOString()
      }, { merge: true });

      privateDocsCache[tripId] = {
        myMemberName: myNickname,
        privateBudget: initialPrivateBudget
      };

      const joinedTrip = normalizeTripSchema({
        ...data,
        id: tripId,
        memberIds: Array.from(new Set([...(data.memberIds || []), currentUserId])),
        myMemberName: myNickname,
        shared: { ...sharedData, members: existingMembers },
        privateBudget: initialPrivateBudget
      });

      if (joinedTrip) {
        trips = [joinedTrip, ...trips.filter(t => t.id !== tripId)];
        saveLocalTripsToStorage();
      }

      window.closeModal('joinTripModal');
      alert(`'${joinedTrip.shared.title}' 여행에 [${myNickname}] 님으로 합류했습니다!`);
      window.enterTripDetail(tripId);
      return;
    } catch (err) {
      console.error('초대 코드 합류 오류:', err);
      alert('여행 합류 처리 중 오류가 발생했습니다. 네트워크 상태를 확인해주세요.');
      return;
    }
  }

  alert('유효하지 않은 초대 코드입니다.\n(다른 기기의 여행에 합류하려면 app.js 상단의 firebaseConfig에 클라우드 키를 먼저 연결해주세요.)');
};

window.copyCurrentInviteCode = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const code = trip.inviteCode;
  const shareText = `[${trip.shared.title}] 여행 플래너에 초대합니다!\n• 초대 코드: ${code}\n• 앱 홈 화면에서 [초대 코드로 참여 🎟️] 버튼을 눌러 코드를 입력해 주세요.`;
  copyTextToClipboard(shareText, `초대 코드 [${code}]와 안내 문구가 클립보드에 복사되었습니다!`);
};

// ==========================================
// 10. [전역 바인딩] 전체 백업 / 복원
// ==========================================
window.backupAllData = function() {
  const payload = {
    version: '4.1-multi-trip-live-fx',
    exportedAt: new Date().toISOString(),
    trips
  };
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
  const dlAnchor = document.createElement('a');
  dlAnchor.setAttribute('href', dataStr);
  dlAnchor.setAttribute('download', `travel_archive_backup_${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(dlAnchor);
  dlAnchor.click();
  dlAnchor.remove();
};

window.triggerRestoreFile = function() {
  const fileInput = getEl('restoreFileInput');
  if (fileInput) fileInput.click();
};

window.handleRestoreFile = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      let restoredTrips = [];

      if (parsed && Array.isArray(parsed.trips)) {
        restoredTrips = parsed.trips.map(normalizeTripSchema).filter(Boolean);
      } else if (Array.isArray(parsed)) {
        restoredTrips = parsed.map(normalizeTripSchema).filter(Boolean);
      } else if (parsed && parsed.tripInfo) {
        const singleMigrated = normalizeTripSchema(parsed);
        if (singleMigrated) restoredTrips = [singleMigrated];
      }

      if (restoredTrips.length > 0) {
        trips = restoredTrips;
        saveLocalTripsToStorage();
        if (isCloudMode && db) {
          trips.forEach(t => syncTripToFirestore(t));
        }
        window.goBackToHome();
        alert(`총 ${trips.length}개의 여행 기록 복원이 완료되었습니다.`);
      } else {
        alert('복원할 수 있는 유효한 여행 데이터가 없습니다.');
      }
    } catch (err) {
      alert('백업 파일을 읽는 중 오류가 발생했습니다.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

// ==========================================
// 11. 여행 리포트 인쇄 / PDF 아카이브 생성 (`printTripReport`)
// ==========================================
window.printTripReport = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const container = getEl('printReportContainer');
  if (!container) {
    window.print();
    return;
  }

  const sh = trip.shared;
  const me = getMeName(trip);
  const baseCurr = (trip.privateBudget.currency || sh.baseCurrency || 'KRW').trim().toUpperCase();
  const totalDays = calculateTotalDays();

  let schedulesHtml = '';
  for (let d = 1; d <= totalDays; d++) {
    const dayDate = getDateStringForDay(d);
    const dayItems = sh.schedules
      .filter(s => Number(s.day) === d)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    schedulesHtml += `
      <div style="margin-bottom: 10px;">
        <div style="font-weight: 700; font-size: 10.5pt; color: #0369a1; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin-bottom: 5px;">
          Day ${d} (${dayDate})
        </div>
        ${dayItems.length === 0
          ? '<p style="font-size: 9.5pt; color: #94a3b8; margin: 2px 0;">등록된 일정 없음</p>'
          : dayItems.map(s => `
              <div style="font-size: 9.5pt; margin-bottom: 3px;">
                <strong>[${escapeHtml(s.time)}]</strong> ${escapeHtml(s.place)}
                ${s.memo ? `<span style="color: #475569;"> — ${escapeHtml(s.memo)}</span>` : ''}
              </div>
            `).join('')
        }
      </div>
    `;
  }

  const reservationsHtml = sh.reservations.length === 0
    ? '<p style="font-size: 9.5pt; color: #94a3b8;">등록된 예약 내역 없음</p>'
    : sh.reservations.map(r => {
        const title = r.category === '항공'
          ? `[항공] ${r.airline || ''} ${r.flightNo || ''} (${r.depAirport || ''} ➔ ${r.arrAirport || ''}) ${r.depDate || ''} ${r.depTime || ''}`
          : `[${r.category}] ${r.placeName || ''} (${r.resDate || ''} ${r.resTime || ''})`;
        const codeInfo = r.pnr || r.bookingCode ? ` / 예약번호: ${r.pnr || r.bookingCode}` : '';
        const amtInfo = r.amount > 0 ? ` / ${Number(r.amount).toLocaleString()} ${r.currency}` : '';
        return `<div style="font-size: 9.5pt; margin-bottom: 4px;">• ${escapeHtml(title)}${escapeHtml(codeInfo)}${escapeHtml(amtInfo)}</div>`;
      }).join('');

  const settlementCalc = computeMinimumTransfersKRW(trip);
  const transfersHtml = settlementCalc.transfers.length === 0
    ? '<p style="font-size: 9.5pt; color: #059669;">모든 정산이 완료되었습니다.</p>'
    : settlementCalc.transfers.map(t =>
        `<div style="font-size: 9.5pt; font-weight: 700; color: #be123c; margin-bottom: 3px;">• ${escapeHtml(t.from)} ➔ ${escapeHtml(t.to)}에게 ${Math.round(t.amount).toLocaleString()}원 송금</div>`
      ).join('');

  const expensesHtml = sh.expenses.length === 0
    ? '<p style="font-size: 9.5pt; color: #94a3b8;">등록된 지출 내역 없음</p>'
    : sh.expenses.map(ex => {
        ensureExpenseSchema(ex, me, baseCurr);
        const krwVal = Math.round(getItemConvertedToKRW(ex, baseCurr));
        return `<div style="font-size: 9.5pt; margin-bottom: 3px;">• ${escapeHtml(ex.title)} — ${Number(ex.amount).toLocaleString()} ${ex.currency} (약 ${krwVal.toLocaleString()}원 / 결제: ${escapeHtml(ex.payer)} / 참여: ${escapeHtml(ex.participants.join(', '))})</div>`;
      }).join('');

  const reviewsHtml = sh.reviews.length === 0
    ? '<p style="font-size: 9.5pt; color: #94a3b8;">등록된 리뷰 기록 없음</p>'
    : sh.reviews.map(rv => {
        const stars = '★'.repeat(rv.rating || 5);
        return `
          <div style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #e2e8f0;">
            <div style="font-size: 10pt; font-weight: 700;">[${escapeHtml(rv.category)}] ${escapeHtml(rv.place)} <span style="color: #d97706;">${stars}</span> <span style="font-weight: 400; font-size: 9pt; color: #64748b;">${escapeHtml(rv.date || '')}</span></div>
            <div style="font-size: 9.5pt; color: #334155; margin-top: 2px; white-space: pre-line;">${escapeHtml(rv.content)}</div>
          </div>
        `;
      }).join('');

  container.innerHTML = `
    <div class="print-section">
      <div style="font-size: 11pt; font-weight: 800; margin-bottom: 6px; color: #0f172a;">📅 일차별 전체 일정표</div>
      ${schedulesHtml}
    </div>

    <div class="print-section">
      <div style="font-size: 11pt; font-weight: 800; margin-bottom: 6px; color: #0f172a;">🎫 예약 및 티켓 내역</div>
      ${reservationsHtml}
    </div>

    <div class="print-section">
      <div style="font-size: 11pt; font-weight: 800; margin-bottom: 6px; color: #0f172a;">💸 지출 및 최종 송금 정산서 (원화 환산 기준)</div>
      <div style="background: #f8fafc; padding: 8px; border-radius: 6px; margin-bottom: 8px;">
        <div style="font-size: 9.5pt; font-weight: 700; margin-bottom: 4px;">[최소 이체 정산 결과] 총 공용 지출: ${Math.round(settlementCalc.totalSharedKRW).toLocaleString()}원</div>
        ${transfersHtml}
      </div>
      ${expensesHtml}
    </div>

    <div class="print-section">
      <div style="font-size: 11pt; font-weight: 800; margin-bottom: 6px; color: #0f172a;">✍️ 장소 리뷰 및 방문 아카이브</div>
      ${reviewsHtml}
    </div>
  `;

  window.print();
};

// ==========================================
// 12. 최소 송금 횟수 기반 '최종 정산 계산기' & 카톡 정산서 복사
// ==========================================
function computeMinimumTransfersKRW(trip) {
  const me = getMeName(trip);
  const baseCurr = (trip.privateBudget.currency || trip.shared.baseCurrency || 'KRW').trim().toUpperCase();
  const members = Array.isArray(trip.shared.members) ? trip.shared.members.map(m => String(m).trim()).filter(Boolean) : [me];

  const netBalance = {};
  members.forEach(m => { netBalance[m] = 0; });

  let totalAllExpensesKRW = 0;
  let totalSharedKRW = 0;

  (trip.shared.expenses || []).forEach(rawExp => {
    const exp = ensureExpenseSchema(rawExp, me, baseCurr);
    const totalKRW = getItemConvertedToKRW(exp, baseCurr);
    if (totalKRW <= 0) return;

    totalAllExpensesKRW += totalKRW;

    const participants = exp.participants;
    const count = participants.length > 0 ? participants.length : 1;
    const isShared = count > 1;
    if (isShared) {
      totalSharedKRW += totalKRW;
    }

    const perPersonKRW = totalKRW / count;
    const payerClean = String(exp.payer || '').trim();
    const settledMap = exp.settledMembers || {};

    if (netBalance[payerClean] === undefined) netBalance[payerClean] = 0;

    participants.forEach(memberClean => {
      if (netBalance[memberClean] === undefined) netBalance[memberClean] = 0;
      if (memberClean === payerClean) return;

      const isAlreadySettled = (settledMap[memberClean] === true);
      if (!isAlreadySettled) {
        netBalance[payerClean] += perPersonKRW;
        netBalance[memberClean] -= perPersonKRW;
      }
    });
  });

  const debtors = [];
  const creditors = [];

  Object.keys(netBalance).forEach(person => {
    const bal = Math.round(netBalance[person]);
    if (bal < -10) {
      debtors.push({ name: person, amount: Math.abs(bal) });
    } else if (bal > 10) {
      creditors.push({ name: person, amount: bal });
    }
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const sendAmt = Math.min(debtor.amount, creditor.amount);

    if (sendAmt > 0) {
      transfers.push({
        from: debtor.name,
        to: creditor.name,
        amount: sendAmt
      });
    }

    debtor.amount -= sendAmt;
    creditor.amount -= sendAmt;

    if (debtor.amount <= 10) i++;
    if (creditor.amount <= 10) j++;
  }

  const memberCount = members.length > 0 ? members.length : 1;
  const perMemberAvgKRW = totalSharedKRW / memberCount;

  return {
    totalAllExpensesKRW,
    totalSharedKRW,
    perMemberAvgKRW,
    memberCount,
    transfers
  };
}

window.renderSettlementSummary = function() {
  const trip = getActiveTrip();
  const box = getEl('settlementSummaryBox');
  if (!trip || !box) return;

  const calc = computeMinimumTransfersKRW(trip);

  if (calc.transfers.length === 0) {
    box.innerHTML = `
      <div class="py-2 text-center text-emerald-300 font-semibold text-xs">
        <i class="fa-solid fa-circle-check mr-1"></i>현재 미정산 송금 내역이 없습니다!
      </div>
      <div class="flex justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/70">
        <span>공용 지출 합계: ${Math.round(calc.totalSharedKRW).toLocaleString()}원</span>
        <span>1인 평균 부담: ${Math.round(calc.perMemberAvgKRW).toLocaleString()}원</span>
      </div>
    `;
    return;
  }

  const transferRowsHtml = calc.transfers.map(t => `
    <div class="flex items-center justify-between bg-slate-800/90 border border-slate-700/80 rounded-xl px-3 py-2">
      <span class="text-xs text-slate-200">
        <strong class="text-amber-300">${escapeHtml(t.from)}</strong> ➔ <strong class="text-sky-300">${escapeHtml(t.to)}</strong>에게
      </span>
      <span class="text-xs font-extrabold text-white">${Math.round(t.amount).toLocaleString()}원 송금</span>
    </div>
  `).join('');

  box.innerHTML = `
    <div class="space-y-1.5">
      ${transferRowsHtml}
    </div>
    <div class="flex justify-between text-[11px] text-slate-400 pt-1.5 border-t border-slate-700/70">
      <span>공용 지출 합계: ${Math.round(calc.totalSharedKRW).toLocaleString()}원</span>
      <span>1인 평균 부담: ${Math.round(calc.perMemberAvgKRW).toLocaleString()}원</span>
    </div>
  `;
};

window.copySettlementToClipboard = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const sh = trip.shared;
  const calc = computeMinimumTransfersKRW(trip);

  const lines = [
    `💸 [${sh.title}] 최종 여행 정산서`,
    `━━━━━━━━━━━━━━━━━━`,
    `• 총 공용 지출액: ${Math.round(calc.totalSharedKRW).toLocaleString()}원`,
    `• 1인당 평균 부담액 (${calc.memberCount}명): ${Math.round(calc.perMemberAvgKRW).toLocaleString()}원`,
    ``,
    `📌 [최종 송금 안내 (최소 이체)]`
  ];

  if (calc.transfers.length === 0) {
    lines.push(`✅ 모든 정산 및 송금이 완료되었습니다!`);
  } else {
    calc.transfers.forEach(t => {
      lines.push(`• ${t.from}님 ➔ ${t.to}님 : ${Math.round(t.amount).toLocaleString()}원`);
    });
  }

  lines.push(`━━━━━━━━━━━━━━━━━━`);
  lines.push(`* 개별 정산 완료 체크 항목은 제외된 미정산 기준 금액입니다.`);

  copyTextToClipboard(lines.join('\n'), '정산 내역이 카카오톡 공유 포맷으로 클립보드에 복사되었습니다! 💸');
};

window.copySettlementText = window.copySettlementToClipboard;

// ==========================================
// 13. 날짜/일차 계산 유틸리티
// ==========================================
function calculateTotalDays() {
  const trip = getActiveTrip();
  if (!trip) return 1;
  const start = new Date(trip.shared.startDate);
  const end = new Date(trip.shared.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 1;
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function getDateStringForDay(dayNumber) {
  const trip = getActiveTrip();
  if (!trip) return '';
  const start = new Date(trip.shared.startDate);
  if (isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + (dayNumber - 1));
  return start.toISOString().split('T')[0];
}

function analyzeDateAndTimeAgainstTrip(dateStr, timeStr = '09:00') {
  const trip = getActiveTrip();
  const totalDays = calculateTotalDays();
  let cleanDate = '';
  let cleanTime = '09:00';

  if (dateStr && dateStr.includes('T')) {
    const parts = dateStr.split('T');
    cleanDate = parts[0];
    cleanTime = parts[1] ? parts[1].substring(0, 5) : '09:00';
  } else {
    cleanDate = (dateStr || '').trim();
    cleanTime = (timeStr || '09:00').trim().substring(0, 5) || '09:00';
  }

  if (!trip || !cleanDate || !trip.shared.startDate) {
    return { day: 1, timing: 'pre', time: cleanTime };
  }

  const targetDate = new Date(cleanDate + 'T00:00:00');
  const startDate = new Date(trip.shared.startDate + 'T00:00:00');
  const endDate = new Date(trip.shared.endDate + 'T00:00:00');

  if (isNaN(targetDate.getTime()) || isNaN(startDate.getTime())) {
    return { day: 1, timing: 'pre', time: cleanTime };
  }

  const diffDays = Math.round((targetDate - startDate) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { day: 1, timing: 'pre', time: cleanTime };
  } else if (!isNaN(endDate.getTime()) && targetDate > endDate) {
    return { day: totalDays, timing: 'post', time: cleanTime };
  } else {
    const clampedDay = Math.min(Math.max(diffDays + 1, 1), totalDays);
    return { day: clampedDay, timing: 'during', time: cleanTime };
  }
}

// ==========================================
// 14. ✨ AI 일정 추천 프롬프트 생성 & JSON 파싱 일괄 등록
// ==========================================
window.openAiScheduleModal = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  window.openModal('aiScheduleModal');
};

window.generateAndCopyAiPrompt = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const sh = trip.shared;
  const totalDays = calculateTotalDays();
  const concept = getVal('inputAiTripConcept').trim() || '여유롭고 알찬 현지 미식 및 주요 명소 탐방';

  const flightLines = [];
  const hotelLines = [];

  (sh.reservations || []).forEach(res => {
    if (res.category === '항공') {
      const depInfo = [res.depDate, res.depTime].filter(Boolean).join(' ');
      const arrInfo = [res.arrDate, res.arrTime].filter(Boolean).join(' ');
      flightLines.push(`- 항공편: ${res.airline || ''} ${res.flightNo || ''} (${res.depAirport || '출발'} ${depInfo} -> ${res.arrAirport || '도착'} ${arrInfo})`);
    } else if (res.category === '숙소') {
      const dtInfo = [res.resDate, res.resTime].filter(Boolean).join(' ');
      hotelLines.push(`- 숙소: ${res.placeName || res.title || ''} (${dtInfo}${res.memo ? ' / ' + res.memo : ''})`);
    }
  });

  const fixedContext = [];
  if (flightLines.length > 0) fixedContext.push(...flightLines);
  if (hotelLines.length > 0) fixedContext.push(...hotelLines);

  const fixedSummary = fixedContext.length > 0
    ? fixedContext.join('\n')
    : '- (사전 등록된 항공/숙소 예약 없음: 1일차 오전 도착, 마지막 날 오후 출발 기준으로 구성)';

  const promptText = [
    `당신은 전문 여행 플래너입니다. 아래 조건에 맞춰 ${totalDays}일간의 최적 여행 일정을 설계해 주세요.`,
    ``,
    `[여행 기본 정보]`,
    `- 여행명: ${sh.title}`,
    `- 여행 기간: ${sh.startDate} ~ ${sh.endDate} (총 ${totalDays}일간)`,
    `- 여행 컨셉/취향: ${concept}`,
    ``,
    `[이미 확정된 항공 및 숙소 정보]`,
    fixedSummary,
    ``,
    `[출력 형식 엄수 규칙]`,
    `- 위 확정된 항공 출도착 시간과 숙소 위치를 동선에 반드시 반영하고, 확정 일정 외에 방문할 추천 장소들을 구성해 주세요.`,
    `- 추천 스폿 중 시간이 여유로울 때 들를 만한 예비 후보지는 "isSpot": true 로, 핵심 추천 일정은 "isSpot": false 로 구분해 주세요.`,
    `- 다른 설명이나 인사말 없이 반드시 아래 JSON 배열 포맷으로만 응답해 주세요:`,
    `[`,
    `  { "day": 1, "time": "10:00", "place": "장소명", "memo": "이동수단 및 핵심 팁", "isSpot": false },`,
    `  { "day": 1, "time": "15:30", "place": "예비 후보 장소명", "memo": "시간 여유 시 방문 추천", "isSpot": true }`,
    `]`
  ].join('\n');

  setVal('textareaAiPromptPreview', promptText);
  copyTextToClipboard(promptText, 'AI 질문용 맞춤형 프롬프트가 생성되어 클립보드에 복사되었습니다!');
};

window.importAiSchedulesFromJson = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const rawText = getVal('textareaAiJsonInput').trim();
  if (!rawText) {
    alert('AI가 생성한 JSON 코드를 먼저 붙여넣어 주세요.');
    return;
  }

  let cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }

  let parsedList;
  try {
    parsedList = JSON.parse(cleaned);
  } catch (e) {
    alert('JSON 형식을 해석할 수 없습니다. AI가 출력한 대괄호([ ... ]) 형태의 JSON 전체가 올바르게 붙여넣어졌는지 확인해주세요.');
    return;
  }

  if (!Array.isArray(parsedList) || parsedList.length === 0) {
    alert('등록할 유효한 일정 항목 배열이 비어 있습니다.');
    return;
  }

  const totalDays = calculateTotalDays();
  let addedScheduleCount = 0;
  let addedSpotCount = 0;

  parsedList.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const place = String(item.place || '').trim();
    if (!place) return;

    const rawDay = Number(item.day) || 1;
    const day = Math.min(Math.max(rawDay, 1), totalDays);
    const time = String(item.time || '10:00').trim().substring(0, 5) || '10:00';
    const memo = String(item.memo || '').trim();
    const isSpot = Boolean(item.isSpot);

    if (isSpot) {
      trip.shared.spots.push({
        id: 'cd_ai_' + Date.now() + '_' + idx,
        day,
        place,
        memo
      });
      addedSpotCount++;
    } else {
      trip.shared.schedules.push({
        id: 'sc_ai_' + Date.now() + '_' + idx,
        day,
        time,
        place,
        memo,
        type: 'general'
      });
      addedScheduleCount++;
    }
  });

  if (addedScheduleCount === 0 && addedSpotCount === 0) {
    alert('유효한 장소 데이터가 없어 등록되지 않았습니다.');
    return;
  }

  saveAllTripsToStorage(trip);
  setVal('textareaAiJsonInput', '');
  window.closeModal('aiScheduleModal');
  window.renderAll();

  alert(`AI 추천 일정 등록 완료!\n- 확정 일정표 추가: ${addedScheduleCount}건\n- 유동 후보 스폿 추가: ${addedSpotCount}건`);
};

// ==========================================
// 15. 카톡/메신저 공유용 당일 일정 텍스트 복사
// ==========================================
window.copyDayScheduleText = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const sh = trip.shared;
  const day = currentDatesDay;
  const dateStr = getDateStringForDay(day);

  const daySchedules = sh.schedules
    .filter(s => Number(s.day) === day)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const daySpots = sh.spots.filter(c => Number(c.day) === day);

  const lines = [
    `✈️ [${sh.title}] Day ${day} 일정 (${dateStr})`,
    `━━━━━━━━━━━━━━━━━━`
  ];

  if (daySchedules.length === 0) {
    lines.push(`• 등록된 확정 일정이 없습니다.`);
  } else {
    daySchedules.forEach(s => {
      lines.push(`⏰ ${s.time} | ${s.place}`);
      if (s.memo) lines.push(`   └ ${s.memo}`);
    });
  }

  if (daySpots.length > 0) {
    lines.push(``);
    lines.push(`💡 [유동 후보 스폿]`);
    daySpots.forEach(c => {
      lines.push(`• ${c.place}${c.memo ? ` (${c.memo})` : ''}`);
    });
  }

  copyTextToClipboard(lines.join('\n'), '일정이 복사되었습니다!');
};

// ==========================================
// 16. 개인 예산 내 환전 내역(privateBudget.exchanges) 관리
// ==========================================
window.toggleExchangeSection = function() {
  isExchangeSectionOpen = !isExchangeSectionOpen;
  const wrapper = getEl('exchangeHistoryWrapper');
  const icon = getEl('exchangeToggleIcon');
  if (wrapper) {
    if (isExchangeSectionOpen) {
      wrapper.classList.remove('hidden');
      if (icon) icon.style.transform = 'rotate(0deg)';
    } else {
      wrapper.classList.add('hidden');
      if (icon) icon.style.transform = 'rotate(-90deg)';
    }
  }
};

window.openExchangeModal = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const form = getEl('formExchange');
  if (form) form.reset();

  setText('exBaseCurrencyLabel', baseCurr);
  setVal('inputExCurrency', baseCurr === 'JPY' ? 'USD' : 'JPY');
  setVal('inputExDate', new Date().toISOString().split('T')[0]);
  window.updateExchangeCalcPreview();
  window.openModal('exchangeModal');
};

window.updateExchangeCalcPreview = function() {
  const trip = getActiveTrip();
  const baseCurr = (trip?.privateBudget?.currency || 'KRW').trim().toUpperCase();
  const fCurr = (getVal('inputExCurrency') || 'JPY').trim().toUpperCase();
  const fAmt = Number(getVal('inputExForeignAmount')) || 0;
  const bAmt = Number(getVal('inputExBaseAmount')) || 0;

  let calcRate = 0;
  if (fAmt > 0 && bAmt > 0) {
    calcRate = bAmt / fAmt;
  }

  setText('exCalculatedRateText', `1 ${fCurr} = ${calcRate.toFixed(2)} ${baseCurr}`);
};

window.saveExchangeRecord = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const currency = (getVal('inputExCurrency') || 'JPY').trim().toUpperCase();
  const date = getVal('inputExDate');
  const foreignAmount = Number(getVal('inputExForeignAmount')) || 0;
  const baseAmount = Number(getVal('inputExBaseAmount')) || 0;
  const memo = getVal('inputExMemo').trim();

  if (foreignAmount <= 0 || baseAmount <= 0) {
    alert('받은 외화 금액과 지불한 대표 통화 금액을 모두 0보다 크게 입력해주세요.');
    return;
  }

  const appliedRate = Number((baseAmount / foreignAmount).toFixed(2));

  if (!Array.isArray(trip.privateBudget.exchanges)) {
    trip.privateBudget.exchanges = [];
  }

  trip.privateBudget.exchanges.unshift({
    id: 'exc_' + Date.now(),
    currency,
    date,
    foreignAmount,
    baseAmount,
    baseCurrency: baseCurr,
    appliedRate,
    memo
  });

  privateDocsCache[trip.id] = {
    myMemberName: getMeName(trip),
    privateBudget: trip.privateBudget
  };

  saveAllTripsToStorage(trip);
  window.closeModal('exchangeModal');
  window.renderAll();
};

window.deleteExchangeRecord = function(excId) {
  const trip = getActiveTrip();
  if (!trip || !Array.isArray(trip.privateBudget.exchanges)) return;
  if (confirm('이 환전 기록을 삭제하시겠습니까?')) {
    trip.privateBudget.exchanges = trip.privateBudget.exchanges.filter(ex => ex.id !== excId);
    privateDocsCache[trip.id] = {
      myMemberName: getMeName(trip),
      privateBudget: trip.privateBudget
    };
    saveAllTripsToStorage(trip);
    window.renderAll();
  }
};

function renderExchangeHistory(trip) {
  const listEl = getEl('exchangeHistoryList');
  if (!listEl) return;

  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const exchanges = Array.isArray(trip.privateBudget.exchanges) ? trip.privateBudget.exchanges : [];
  setText('exchangeCountBadge', String(exchanges.length));

  if (exchanges.length === 0) {
    listEl.innerHTML = `
      <p class="text-[11px] text-slate-400 bg-slate-50 rounded-xl p-2.5 text-center">
        등록된 환전 기록이 없습니다. 실제 환전 환율을 기록해 예산을 투명하게 관리하세요.
      </p>`;
    return;
  }

  const currencySummary = {};
  exchanges.forEach(ex => {
    const c = (ex.currency || 'JPY').toUpperCase();
    if (!currencySummary[c]) {
      currencySummary[c] = { totalForeign: 0, totalBase: 0 };
    }
    currencySummary[c].totalForeign += Number(ex.foreignAmount) || 0;
    currencySummary[c].totalBase += Number(ex.baseAmount) || 0;
  });

  let summaryHtml = '<div class="grid grid-cols-1 gap-1.5">';
  Object.keys(currencySummary).forEach(c => {
    const s = currencySummary[c];
    const avgRate = s.totalForeign > 0 ? (s.totalBase / s.totalForeign) : 0;
    summaryHtml += `
      <div class="bg-sky-50/70 border border-sky-100 rounded-xl px-2.5 py-2 flex items-center justify-between text-[11px]">
        <div>
          <span class="font-bold text-sky-900">${c} 총 환전: ${s.totalForeign.toLocaleString()} ${c}</span>
          <span class="text-[10px] text-sky-600 block">평균 환율: 1 ${c} = ${avgRate.toFixed(2)} ${baseCurr}</span>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-slate-400 block">지불 합계</span>
          <span class="font-bold text-slate-700">${Math.round(s.totalBase).toLocaleString()} ${baseCurr}</span>
        </div>
      </div>
    `;
  });
  summaryHtml += '</div>';

  let rowsHtml = '<div class="space-y-1 pt-1">';
  exchanges.forEach(ex => {
    const rateVal = Number(ex.appliedRate) || 0;
    rowsHtml += `
      <div class="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 text-[11px]">
        <div class="min-w-0 flex-1 pr-2">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-700">${Number(ex.foreignAmount).toLocaleString()} ${escapeHtml(ex.currency)}</span>
            <span class="text-[10px] text-slate-400">(${Math.round(Number(ex.baseAmount)).toLocaleString()} ${baseCurr})</span>
            <span class="text-[10px] font-mono text-sky-600 bg-sky-50 px-1 rounded">1 ${escapeHtml(ex.currency)} = ${rateVal.toFixed(2)} ${baseCurr}</span>
          </div>
          <div class="text-[10px] text-slate-400 truncate">
            ${ex.date ? escapeHtml(ex.date) : ''} ${ex.memo ? `· ${escapeHtml(ex.memo)}` : ''}
          </div>
        </div>
        <button type="button" onclick="window.deleteExchangeRecord('${ex.id}')" class="text-slate-300 hover:text-rose-500 p-1 shrink-0" title="삭제">
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>
    `;
  });
  rowsHtml += '</div>';

  listEl.innerHTML = summaryHtml + rowsHtml;
}

// ==========================================
// 17. 개인 여행 예산 & 잔여 비율(100% -> 0%) 게이지 계산
// ==========================================
window.renderBudget = function(tripParam = null) {
  const trip = tripParam || getActiveTrip();
  if (!trip) return 0;

  const priv = trip.privateBudget;
  const sh = trip.shared;
  const baseCurr = (priv.currency || sh.baseCurrency || 'KRW').trim().toUpperCase();
  const totalBudget = Number(priv.totalBudget) || 0;
  const me = getMeName(trip);

  renderExchangeSnapshotHeader(trip);
  setText('baseCurrencyDisplay', baseCurr);
  setText('remainCurrencyDisplay', baseCurr);
  setText('budgetTotalDisplay', totalBudget.toLocaleString());

  let totalMySpent = 0;

  (sh.expenses || []).forEach(exp => {
    const rawAmount = Number(exp.amount) || 0;
    if (rawAmount <= 0) return;

    const convertedTotal = getItemConvertedAmount(exp, baseCurr);

    const participants = Array.isArray(exp.participants) && exp.participants.length > 0
      ? exp.participants.map(m => String(m).trim())
      : [String(exp.payer || me).trim()];
    const count = participants.length;
    const perPerson = convertedTotal / count;

    const payerName = String(exp.payer || '').trim();
    const isPayerMe = (payerName === me);
    const settledMap = exp.settledMembers || {};

    let myExpense = 0;

    if (isPayerMe) {
      const settledOthersCount = participants.filter(m => {
        return (m !== me) && (settledMap[m] === true);
      }).length;

      myExpense = convertedTotal - (perPerson * settledOthersCount);
      if (myExpense < 0) myExpense = 0;
    } else {
      if (!participants.includes(me)) {
        myExpense = 0;
      } else {
        const isMySettled = (settledMap[me] === true);
        myExpense = isMySettled ? perPerson : 0;
      }
    }

    totalMySpent += myExpense;
  });

  const remainingBudget = totalBudget - totalMySpent;

  const rawRemainRatio = totalBudget > 0 ? (remainingBudget / totalBudget) * 100 : 100;
  const clampedRemainRatio = Math.min(Math.max(rawRemainRatio, 0), 100);
  const roundedPercent = Math.round(clampedRemainRatio);

  setText('spentAmountDisplay', `${Math.round(totalMySpent).toLocaleString()} ${baseCurr}`);

  const remainPctEl = getEl('remainPercentDisplay');
  if (remainPctEl) {
    remainPctEl.textContent = `잔여 예산 ${roundedPercent}%`;
  }

  const barEl = getEl('budgetProgressBar');
  if (barEl) {
    barEl.style.width = `${clampedRemainRatio}%`;
    if (clampedRemainRatio >= 50) {
      barEl.className = 'bg-sky-500 h-full rounded-full transition-all duration-300';
      if (remainPctEl) remainPctEl.className = 'font-bold text-sky-600';
    } else if (clampedRemainRatio >= 20) {
      barEl.className = 'bg-amber-500 h-full rounded-full transition-all duration-300';
      if (remainPctEl) remainPctEl.className = 'font-bold text-amber-600';
    } else {
      barEl.className = 'bg-rose-500 h-full rounded-full transition-all duration-300';
      if (remainPctEl) remainPctEl.className = 'font-bold text-rose-600';
    }
  }

  const remainEl = getEl('budgetRemainDisplay');
  if (remainEl) {
    remainEl.textContent = Math.round(remainingBudget).toLocaleString();
    remainEl.className = remainingBudget < 0 ? 'text-lg font-bold text-rose-600' : 'text-lg font-bold text-sky-600';
  }

  renderExchangeHistory(trip);

  return remainingBudget;
};

// ==========================================
// 18. 상세 화면 렌더링 총괄 파이프라인
// ==========================================
window.renderAll = function() {
  const trip = getActiveTrip();
  if (!trip) {
    window.goBackToHome();
    return;
  }

  renderTripHeader(trip);
  window.renderBudget(trip);
  updateDaySelectors();

  const itemsSec = getEl('viewModeItemsSection');
  const datesSec = getEl('viewModeDatesSection');

  if (currentMainMode === 'items') {
    if (itemsSec) itemsSec.classList.remove('hidden');
    if (datesSec) datesSec.classList.add('hidden');
    renderActiveSubView();
  } else {
    if (itemsSec) itemsSec.classList.add('hidden');
    if (datesSec) datesSec.classList.remove('hidden');
    window.renderDatesView();
  }
};

function renderTripHeader(trip) {
  const sh = trip.shared;
  const me = getMeName(trip);
  setText('tripTitleDisplay', sh.title || '나의 여행 플래너');
  setText('tripInviteCodeBadge', `코드: ${trip.inviteCode}`);
  setText('currentUserIdentityBadge', `내 기준 닉네임: ${me}`);

  const start = sh.startDate || '';
  const end = sh.endDate || '';
  const totalDays = calculateTotalDays();
  const members = sh.members || ['나'];

  setText(
    'tripPeriodDisplay',
    start && end ? `${start} ~ ${end} (${totalDays}일간) · ${members.length}명` : '일정을 등록해주세요'
  );
}

function updateDaySelectors() {
  const totalDays = calculateTotalDays();
  const selectors = ['timelineDaySelector', 'inputScheduleDay', 'inputCandidateDay', 'inputExpenseDay', 'inputPhotoUploadDay'];

  selectors.forEach(id => {
    const el = getEl(id);
    if (!el) return;
    const currentVal = Number(el.value) || 1;
    el.innerHTML = '';
    for (let i = 1; i <= totalDays; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Day ${i} (${getDateStringForDay(i)})`;
      el.appendChild(opt);
    }
    el.value = currentVal <= totalDays ? currentVal : 1;
  });
}

function renderActiveSubView() {
  const views = {
    timeline: getEl('subViewTimeline'),
    reservations: getEl('subViewReservations'),
    checklist: getEl('subViewChecklist'),
    expenses: getEl('subViewExpenses'),
    photos: getEl('subViewPhotos'),
    reviews: getEl('subViewReviews')
  };
  const tabs = {
    timeline: getEl('subTabTimeline'),
    reservations: getEl('subTabReservations'),
    checklist: getEl('subTabChecklist'),
    expenses: getEl('subTabExpenses'),
    photos: getEl('subTabPhotos'),
    reviews: getEl('subTabReviews')
  };

  Object.keys(views).forEach(key => {
    if (views[key]) {
      if (key === currentSubTab) {
        views[key].classList.remove('hidden');
        if (tabs[key]) tabs[key].className = 'shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold bg-sky-600 text-white';
      } else {
        views[key].classList.add('hidden');
        if (tabs[key]) tabs[key].className = 'shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold bg-white border border-slate-200 text-slate-600';
      }
    }
  });

  if (currentSubTab === 'timeline') window.renderTimeline();
  if (currentSubTab === 'reservations') window.renderReservations();
  if (currentSubTab === 'checklist') window.renderChecklist();
  if (currentSubTab === 'expenses') window.renderExpensesAndSettlement();
  if (currentSubTab === 'photos') window.renderPhotos();
  if (currentSubTab === 'reviews') window.renderReviews();
}

// ==========================================
// 19. [전역 바인딩] 모달 & 뷰/서브탭 전환
// ==========================================
window.openModal = function(modalId) {
  const el = getEl(modalId);
  if (el) el.classList.remove('hidden');
};

window.closeModal = function(modalId) {
  const el = getEl(modalId);
  if (el) el.classList.add('hidden');
};

window.switchMainMode = function(mode) {
  currentMainMode = mode;
  const bItems = getEl('tabModeItems');
  const bDates = getEl('tabModeDates');

  if (mode === 'items') {
    if (bItems) bItems.className = 'py-2.5 rounded-lg bg-white text-sky-600 shadow-xs transition';
    if (bDates) bDates.className = 'py-2.5 rounded-lg text-slate-500 transition';
  } else {
    if (bDates) bDates.className = 'py-2.5 rounded-lg bg-white text-sky-600 shadow-xs transition';
    if (bItems) bItems.className = 'py-2.5 rounded-lg text-slate-500 transition';
  }
  window.renderAll();
};

window.switchSubTab = function(tabName) {
  currentSubTab = tabName;
  renderActiveSubView();
};

// ==========================================
// 20. [전역 바인딩] 상세 화면 여행 정보 & 개인 예산 설정
// ==========================================
window.openTripInfoModal = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  setVal('inputTripTitle', trip.shared.title || '');
  setVal('inputTripStartDate', trip.shared.startDate || '');
  setVal('inputTripEndDate', trip.shared.endDate || '');
  setVal('inputTripMembers', (trip.shared.members || []).join(', '));
  setVal('inputTripMyIdentity', getMeName(trip));
  window.openModal('modalTripInfo');
};

window.saveTripInfo = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const title = getVal('inputTripTitle').trim();
  const startDate = getVal('inputTripStartDate');
  const endDate = getVal('inputTripEndDate');
  const rawMembers = getVal('inputTripMembers');
  const customMyIdentity = getVal('inputTripMyIdentity').trim();

  let members = rawMembers.split(',').map(m => m.trim()).filter(Boolean);
  if (members.length === 0) members = ['나'];

  if (customMyIdentity && !members.includes(customMyIdentity)) {
    members.push(customMyIdentity);
  }

  trip.shared.title = title;
  trip.shared.startDate = startDate;
  trip.shared.endDate = endDate;
  trip.shared.members = members;
  trip.myMemberName = customMyIdentity || members[0];

  privateDocsCache[trip.id] = {
    myMemberName: trip.myMemberName,
    privateBudget: trip.privateBudget
  };

  saveAllTripsToStorage(trip);
  window.closeModal('modalTripInfo');
  window.renderAll();
};

window.openBudgetModal = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  setVal('inputBaseCurrency', trip.privateBudget.currency || 'KRW');
  setVal('inputBudgetAmount', trip.privateBudget.totalBudget || 0);
  window.openModal('modalBudget');
};

window.saveBudget = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const curr = getVal('inputBaseCurrency') || 'KRW';
  const amt = Number(getVal('inputBudgetAmount')) || 0;

  trip.privateBudget.currency = curr;
  trip.privateBudget.totalBudget = amt;
  trip.shared.baseCurrency = curr;

  privateDocsCache[trip.id] = {
    myMemberName: getMeName(trip),
    privateBudget: trip.privateBudget
  };

  saveAllTripsToStorage(trip);
  window.closeModal('modalBudget');
  window.renderAll();
};

// ==========================================
// 21. [전역 바인딩] 일정표 & 동선 지도 & 후보 스폿
// ==========================================
window.renderTimeline = function() {
  const trip = getActiveTrip();
  const container = getEl('timelineContainer');
  if (!trip || !container) return;
  container.innerHTML = '';

  const selector = getEl('timelineDaySelector');
  const day = selector ? Number(selector.value) || 1 : 1;

  const dayItems = trip.shared.schedules
    .filter(s => Number(s.day) === day)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  if (dayItems.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
        <i class="fa-solid fa-map-pin text-3xl mb-2 text-slate-300"></i>
        <p class="text-xs">등록된 일정이 없습니다. 일정을 추가해보세요.</p>
      </div>`;
    return;
  }

  dayItems.forEach((item, idx) => {
    const isFlight = item.type === 'flight';
    const card = document.createElement('div');
    card.className = 'flex items-start gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs';
    card.innerHTML = `
      <div class="flex flex-col items-center">
        <span class="w-6 h-6 rounded-full ${isFlight ? 'bg-indigo-100 text-indigo-700' : 'bg-sky-100 text-sky-700'} text-[11px] font-bold flex items-center justify-center shrink-0">
          ${isFlight ? '<i class="fa-solid fa-plane text-[10px]"></i>' : idx + 1}
        </span>
        ${idx < dayItems.length - 1 ? '<div class="w-0.5 h-10 bg-slate-200 my-1"></div>' : ''}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold ${isFlight ? 'text-indigo-600' : 'text-sky-600'}">${escapeHtml(item.time)}</span>
            ${item.linkedReservationId ? '<span class="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-semibold">예약연동</span>' : ''}
          </div>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="window.openSinglePlaceMap('${escapeParam(isFlight && item.arrAirport ? item.arrAirport : item.place)}')" class="text-xs text-slate-400 hover:text-sky-600 p-1" title="지도 보기">
              지도 🗺️
            </button>
            <button type="button" onclick="window.editScheduleItem('${item.id}')" class="text-xs text-slate-400 hover:text-slate-600 p-1" title="수정">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
        </div>
        <h4 class="text-xs font-bold text-slate-800 mt-0.5 truncate">${escapeHtml(item.place)}</h4>
        ${item.memo ? `<p class="text-[11px] text-slate-500 mt-1 bg-slate-50 p-2 rounded-lg break-words">${escapeHtml(item.memo)}</p>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
};

window.openSinglePlaceMap = function(placeName) {
  if (!placeName) return;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName)}`, '_blank');
};

window.openDayMultiRoute = function(dayNumber, includeCandidates = false) {
  const trip = getActiveTrip();
  if (!trip) return;

  const daySchedules = trip.shared.schedules
    .filter(s => Number(s.day) === dayNumber)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const groundPlaces = [];

  daySchedules.forEach(item => {
    if (item.type === 'flight') {
      if (item.arrAirport && item.arrAirport.trim() !== '') {
        groundPlaces.push(item.arrAirport.trim());
      }
    } else {
      if (item.place && item.place.trim() !== '') {
        groundPlaces.push(item.place.trim());
      }
    }
  });

  if (includeCandidates) {
    const dayCandidates = trip.shared.spots
      .filter(c => Number(c.day) === dayNumber)
      .map(c => c.place.trim())
      .filter(Boolean);
    groundPlaces.push(...dayCandidates);
  }

  const deduplicatedPlaces = groundPlaces.filter((place, index) => {
    return index === 0 || place !== groundPlaces[index - 1];
  });

  if (deduplicatedPlaces.length === 0) {
    alert(`Day ${dayNumber}에 연결할 지상 방문지가 없습니다.`);
    return;
  }

  if (deduplicatedPlaces.length === 1) {
    window.openSinglePlaceMap(deduplicatedPlaces[0]);
    return;
  }

  const origin = encodeURIComponent(deduplicatedPlaces[0]);
  const destination = encodeURIComponent(deduplicatedPlaces[deduplicatedPlaces.length - 1]);
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=transit`;

  if (deduplicatedPlaces.length > 2) {
    const waypoints = deduplicatedPlaces.slice(1, -1).map(p => encodeURIComponent(p)).join('|');
    url += `&waypoints=${waypoints}`;
  }

  window.open(url, '_blank');
};

window.openDayRouteMapFromTimeline = function() {
  const selector = getEl('timelineDaySelector');
  const day = selector ? Number(selector.value) || 1 : 1;
  const chk = getEl('chkIncludeCandidatesMap');
  const includeCand = chk ? chk.checked : false;
  window.openDayMultiRoute(day, includeCand);
};

window.openDayRouteMapFromDates = function() {
  window.openDayMultiRoute(currentDatesDay, false);
};

window.openScheduleModal = function() {
  setText('modalScheduleTitle', '일정 추가');
  const form = getEl('formSchedule');
  if (form) form.reset();
  setVal('inputScheduleId', '');
  const selector = getEl('timelineDaySelector');
  setVal('inputScheduleDay', selector ? selector.value : 1);
  const delBtn = getEl('btnDeleteSchedule');
  if (delBtn) delBtn.classList.add('hidden');
  window.openModal('modalSchedule');
};

window.editScheduleItem = function(scheduleId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const item = trip.shared.schedules.find(s => s.id === scheduleId);
  if (!item) return;

  setText('modalScheduleTitle', '일정 수정');
  setVal('inputScheduleId', item.id);
  setVal('inputScheduleDay', item.day);
  setVal('inputScheduleTime', item.time);
  setVal('inputSchedulePlace', item.place);
  setVal('inputScheduleMemo', item.memo || '');

  const delBtn = getEl('btnDeleteSchedule');
  if (delBtn) delBtn.classList.remove('hidden');

  window.openModal('modalSchedule');
};

window.saveSchedule = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const id = getVal('inputScheduleId');
  const day = Number(getVal('inputScheduleDay'));
  const time = getVal('inputScheduleTime');
  const place = getVal('inputSchedulePlace').trim();
  const memo = getVal('inputScheduleMemo').trim();

  if (id) {
    const idx = trip.shared.schedules.findIndex(s => s.id === id);
    if (idx !== -1) {
      trip.shared.schedules[idx] = { ...trip.shared.schedules[idx], day, time, place, memo };
    }
  } else {
    trip.shared.schedules.push({ id: 'sc_' + Date.now(), day, time, place, memo, type: 'general' });
  }

  saveAllTripsToStorage(trip);
  window.closeModal('modalSchedule');
  window.renderAll();
};

window.deleteCurrentSchedule = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const id = getVal('inputScheduleId');
  if (id && confirm('이 일정을 삭제하시겠습니까?')) {
    trip.shared.schedules = trip.shared.schedules.filter(s => s.id !== id);
    saveAllTripsToStorage(trip);
    window.closeModal('modalSchedule');
    window.renderAll();
  }
};

// 유동 후보 스폿
window.openCandidateModal = function() {
  window.renderCandidateList();
  window.openModal('modalCandidate');
};

window.renderCandidateList = function() {
  const trip = getActiveTrip();
  const container = getEl('candidateListContainer');
  if (!trip || !container) return;
  container.innerHTML = '';

  if (trip.shared.spots.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-slate-400 text-xs">
        보관된 후보 스폿이 없습니다.
      </div>`;
    return;
  }

  trip.shared.spots.forEach(cand => {
    const card = document.createElement('div');
    card.className = 'bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2 shadow-xs';
    card.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Day ${cand.day}</span>
          <span class="text-xs font-bold text-slate-800 truncate">${escapeHtml(cand.place)}</span>
        </div>
        ${cand.memo ? `<p class="text-[11px] text-slate-500 mt-1 truncate">${escapeHtml(cand.memo)}</p>` : ''}
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button type="button" onclick="window.openSinglePlaceMap('${escapeParam(cand.place)}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-semibold" title="지도">
          지도 🗺️
        </button>
        <button type="button" onclick="window.promoteCandidateToSchedule('${cand.id}')" class="px-2 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold" title="일정에 추가">
          일정에 추가 ➕
        </button>
        <button type="button" onclick="window.deleteCandidate('${cand.id}')" class="p-1 text-slate-300 hover:text-rose-500" title="삭제">
          <i class="fa-solid fa-trash-can text-xs"></i>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
};

window.saveCandidate = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const day = Number(getVal('inputCandidateDay'));
  const place = getVal('inputCandidatePlace').trim();
  const memo = getVal('inputCandidateMemo').trim();

  if (!place) return;
  trip.shared.spots.push({ id: 'cd_' + Date.now(), day, place, memo });
  saveAllTripsToStorage(trip);
  setVal('inputCandidatePlace', '');
  setVal('inputCandidateMemo', '');
  window.renderCandidateList();
};

window.promoteCandidateToSchedule = function(candidateId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const cand = trip.shared.spots.find(c => c.id === candidateId);
  if (!cand) return;

  trip.shared.schedules.push({
    id: 'sc_' + Date.now(),
    day: cand.day,
    time: '12:00',
    place: cand.place,
    memo: cand.memo || '',
    type: 'general'
  });
  trip.shared.spots = trip.shared.spots.filter(c => c.id !== candidateId);
  saveAllTripsToStorage(trip);
  window.renderCandidateList();
  window.renderAll();
  alert(`'${cand.place}'을(를) Day ${cand.day} 일정표에 추가했습니다.`);
};

window.deleteCandidate = function(candidateId) {
  const trip = getActiveTrip();
  if (!trip) return;
  if (!confirm('이 후보 스폿을 삭제하시겠습니까?')) return;
  trip.shared.spots = trip.shared.spots.filter(c => c.id !== candidateId);
  saveAllTripsToStorage(trip);
  window.renderCandidateList();
};

// ==========================================
// 22. [전역 바인딩] 예약 등록/수정 & 실시간 환율 API 조회/갱신
// ==========================================
window.handleReservationCategoryChange = function(category) {
  const flightWrap = getEl('resFlightFieldsWrapper');
  const generalWrap = getEl('resGeneralFieldsWrapper');

  if (category === '항공') {
    if (flightWrap) flightWrap.classList.remove('hidden');
    if (generalWrap) generalWrap.classList.add('hidden');
  } else {
    if (flightWrap) flightWrap.classList.add('hidden');
    if (generalWrap) generalWrap.classList.remove('hidden');
  }
};

/**
 * 예약 모달 내 적용 환율 안내 박스 동기화 및 실시간 API 자동 조회
 */
window.updateReservationRatePreview = async function(autoFetchLive = false) {
  const trip = getActiveTrip();
  if (!trip) return;

  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const resCurr = (getVal('inputResCurrency') || 'KRW').trim().toUpperCase();
  const amount = Number(getVal('inputResAmount')) || 0;
  const rateBox = getEl('resExchangeRateBox');

  if (resCurr === baseCurr) {
    if (rateBox) rateBox.classList.add('hidden');
    setVal('inputResAppliedRate', '1');
    return;
  }

  if (rateBox) rateBox.classList.remove('hidden');
  setText('resRateUnitLabel', `1 ${resCurr} =`);
  setText('resRateBaseUnitLabel', baseCurr);

  let rate = Number(getVal('inputResAppliedRate'));
  if (autoFetchLive || !(rate > 0)) {
    setText('resRateSummaryText', `실시간 환율 조회 중... (1 ${resCurr} ➔ ${baseCurr})`);
    rate = await fetchLiveExchangeRate(resCurr, baseCurr);
    setVal('inputResAppliedRate', rate.toFixed(2));
  }

  const converted = Math.round(amount * rate);
  setText('resRateSummaryText', `기준: 1 ${resCurr} = ${Number(rate).toFixed(2)} ${baseCurr}`);
  setText('resConvertedPreviewText', `${converted.toLocaleString()} ${baseCurr}`);
};

window.fetchLatestReservationRate = async function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const resCurr = (getVal('inputResCurrency') || 'KRW').trim().toUpperCase();

  setText('resRateSummaryText', `최신 환율 조회 중...`);
  const latestRate = await fetchLiveExchangeRate(resCurr, baseCurr);

  setVal('inputResAppliedRate', latestRate.toFixed(2));
  await window.updateReservationRatePreview(false);
  alert(`최신 실시간 환율 (1 ${resCurr} = ${latestRate.toFixed(2)} ${baseCurr})을 불러왔습니다.`);
};

window.refreshSingleReservationRate = async function(resId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const item = trip.shared.reservations.find(r => r.id === resId);
  if (!item) return;

  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const resCurr = (item.currency || 'KRW').trim().toUpperCase();
  if (resCurr === baseCurr) return;

  const latestLiveRate = await fetchLiveExchangeRate(resCurr, baseCurr);
  const avgExRate = getAverageExchangeRateForCurrency(trip, resCurr);

  const inputStr = prompt(
    `[${resCurr} ➔ ${baseCurr}] 적용할 새 환율을 입력하세요.\n• 실시간 조회 환율: 1 ${resCurr} = ${latestLiveRate.toFixed(2)} ${baseCurr}\n• 현재 저장된 환율: ${Number(item.appliedRate).toFixed(2)} ${baseCurr}${avgExRate ? `\n• 내 환전 평균 환율: ${avgExRate.toFixed(2)} ${baseCurr}` : ''}`,
    latestLiveRate.toFixed(2)
  );

  if (inputStr === null) return;
  const newRate = Number(Number(inputStr).toFixed(2));
  if (!(newRate > 0)) {
    alert('유효한 환율 숫자를 입력해주세요.');
    return;
  }

  const nowTs = getNowTimestampStr();
  item.appliedRate = newRate;
  item.rateTimestamp = nowTs;
  item.convertedAmount = Math.round((Number(item.amount) || 0) * newRate);

  const linkedExp = trip.shared.expenses.find(ex => ex.linkedReservationId === resId);
  if (linkedExp) {
    linkedExp.appliedRate = newRate;
    linkedExp.rateTimestamp = nowTs;
    linkedExp.convertedAmount = Math.round((Number(linkedExp.amount) || 0) * newRate);
  }

  saveAllTripsToStorage(trip);
  window.renderAll();
};

window.lookupFlightNumber = function() {
  const trip = getActiveTrip();
  const rawInput = getVal('inputResFlightNo');
  const code = (rawInput || '').replace(/\s+/g, '').toUpperCase();

  if (!code) {
    alert('조회할 항공편명을 입력해주세요. (예: RS471, KE703, OZ102)');
    return;
  }

  setVal('inputResFlightNo', code);

  const baseDate = trip?.shared?.startDate || new Date().toISOString().split('T')[0];
  const exact = FLIGHT_SCHEDULE_DATABASE[code];

  if (exact) {
    setVal('inputResAirline', exact.airline);
    setVal('inputResDepAirport', exact.dep);
    setVal('inputResArrAirport', exact.arr);

    if (!getVal('inputResDepDate')) setVal('inputResDepDate', baseDate);
    if (exact.depTime) setVal('inputResDepTime', exact.depTime);

    if (!getVal('inputResArrDate')) setVal('inputResArrDate', baseDate);
    if (exact.arrTime) setVal('inputResArrTime', exact.arrTime);

    if (exact.memo && !getVal('inputResMemo').trim()) {
      setVal('inputResMemo', exact.memo);
    }
    alert(`[${exact.airline} ${code}] 출도착지 및 정규 시간 정보가 자동 입력되었습니다. 예약번호(PNR)와 달력 날짜를 확인해주세요.`);
    return;
  }

  const prefix = code.substring(0, 2);
  const airlineName = AIRLINE_PREFIX_MAP[prefix];

  if (airlineName) {
    setVal('inputResAirline', airlineName);
    setVal('inputResDepAirport', '');
    setVal('inputResArrAirport', '');
    if (!getVal('inputResDepDate')) setVal('inputResDepDate', baseDate);
    if (!getVal('inputResArrDate')) setVal('inputResArrDate', baseDate);
    alert(`[${airlineName}] 항공사명이 입력되었습니다. 출발/도착 공항 및 상세 일정을 입력해주세요.`);
  } else {
    alert('등록된 항공사 코드에 없는 편명입니다. 항공사명과 출도착 정보를 직접 입력해주세요.');
  }
};

window.openReservationModal = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const tripStart = trip.shared.startDate || new Date().toISOString().split('T')[0];
  const baseCurr = trip.privateBudget.currency || 'KRW';

  setText('modalReservationTitle', '예약 등록');
  const form = getEl('formReservation');
  if (form) form.reset();

  setVal('inputReservationId', '');
  setVal('inputReservationCategory', '항공');
  setVal('inputResCurrency', baseCurr);
  setVal('inputResAppliedRate', '1');

  setVal('inputResDepDate', tripStart);
  setVal('inputResArrDate', tripStart);
  setVal('inputResDate', tripStart);

  const chkSched = getEl('chkResAutoSchedule');
  const chkExp = getEl('chkResAutoExpense');
  if (chkSched) chkSched.checked = true;
  if (chkExp) chkExp.checked = true;

  const delBtn = getEl('btnDeleteReservation');
  if (delBtn) delBtn.classList.add('hidden');

  window.handleReservationCategoryChange('항공');
  window.updateReservationRatePreview(true);
  window.openModal('modalReservation');
};

window.editReservation = function(resId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const item = trip.shared.reservations.find(r => r.id === resId);
  if (!item) return;

  const tripStart = trip.shared.startDate || new Date().toISOString().split('T')[0];

  setText('modalReservationTitle', '예약 정보 수정');
  setVal('inputReservationId', item.id);
  const cat = item.category || '기타';
  setVal('inputReservationCategory', cat);
  window.handleReservationCategoryChange(cat);

  if (cat === '항공') {
    setVal('inputResFlightNo', item.flightNo || '');
    setVal('inputResAirline', item.airline || '');
    setVal('inputResPnr', item.pnr || '');
    setVal('inputResDepAirport', item.depAirport || '');
    setVal('inputResArrAirport', item.arrAirport || '');

    const depDateVal = item.depDate || (item.depTime && item.depTime.includes('T') ? item.depTime.split('T')[0] : tripStart);
    const depTimeVal = item.depTime && item.depTime.includes('T') ? item.depTime.split('T')[1]?.substring(0, 5) : (item.depTime || '');
    const arrDateVal = item.arrDate || (item.arrTime && item.arrTime.includes('T') ? item.arrTime.split('T')[0] : tripStart);
    const arrTimeVal = item.arrTime && item.arrTime.includes('T') ? item.arrTime.split('T')[1]?.substring(0, 5) : (item.arrTime || '');

    setVal('inputResDepDate', depDateVal);
    setVal('inputResDepTime', depTimeVal);
    setVal('inputResArrDate', arrDateVal);
    setVal('inputResArrTime', arrTimeVal);
  } else {
    setVal('inputResPlaceName', item.placeName || '');

    const resDateVal = item.resDate || (item.datetime && item.datetime.includes('T') ? item.datetime.split('T')[0] : tripStart);
    const resTimeVal = item.resTime || (item.datetime && item.datetime.includes('T') ? item.datetime.split('T')[1]?.substring(0, 5) : '');

    setVal('inputResDate', resDateVal);
    setVal('inputResTime', resTimeVal);
    setVal('inputResBookingCode', item.bookingCode || '');
  }

  setVal('inputResMemo', item.memo || '');
  setVal('inputResCurrency', item.currency || 'KRW');
  setVal('inputResAmount', item.amount || '');

  if (Number(item.appliedRate) > 0) {
    setVal('inputResAppliedRate', Number(item.appliedRate).toFixed(2));
  }
  window.updateReservationRatePreview(false);

  const chkSched = getEl('chkResAutoSchedule');
  const chkExp = getEl('chkResAutoExpense');
  if (chkSched) chkSched.checked = item.autoSchedule !== false;
  if (chkExp) chkExp.checked = item.autoExpense !== false;

  const delBtn = getEl('btnDeleteReservation');
  if (delBtn) delBtn.classList.remove('hidden');

  window.openModal('modalReservation');
};

window.saveReservation = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const me = getMeName(trip);
  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const existingId = getVal('inputReservationId');
  const resId = existingId || 'res_' + Date.now();
  const category = getVal('inputReservationCategory');

  const flightNo = getVal('inputResFlightNo').trim().toUpperCase();
  const airline = getVal('inputResAirline').trim();
  const pnr = getVal('inputResPnr').trim().toUpperCase();
  const depAirport = getVal('inputResDepAirport').trim();
  const arrAirport = getVal('inputResArrAirport').trim();

  const depDate = getVal('inputResDepDate');
  const depTime = getVal('inputResDepTime');
  const arrDate = getVal('inputResArrDate');
  const arrTime = getVal('inputResArrTime');

  const placeName = getVal('inputResPlaceName').trim();
  const resDate = getVal('inputResDate');
  const resTime = getVal('inputResTime');
  const bookingCode = getVal('inputResBookingCode').trim();
  const memo = getVal('inputResMemo').trim();

  const currency = (getVal('inputResCurrency') || 'KRW').trim().toUpperCase();
  const amount = Number(getVal('inputResAmount')) || 0;

  let appliedRate = 1;
  if (currency !== baseCurr) {
    const inputRate = Number(getVal('inputResAppliedRate'));
    appliedRate = inputRate > 0 ? Number(inputRate.toFixed(2)) : getFallbackRateToBase(currency, baseCurr);
  }
  const convertedAmount = Math.round(amount * appliedRate);
  const rateTimestamp = getNowTimestampStr();

  const chkSched = getEl('chkResAutoSchedule');
  const chkExp = getEl('chkResAutoExpense');
  const autoSchedule = chkSched ? chkSched.checked : false;
  const autoExpense = chkExp ? chkExp.checked : false;

  if (category === '항공') {
    if (!flightNo && !airline && !depAirport && !arrAirport) {
      alert('항공편명 또는 출도착 공항 정보를 입력해주세요.');
      return;
    }
  } else {
    if (!placeName) {
      alert('장소/업체명을 입력해주세요.');
      return;
    }
  }

  const reservationObj = {
    id: resId,
    category,
    flightNo,
    airline,
    pnr,
    depAirport,
    arrAirport,
    depDate,
    depTime,
    arrDate,
    arrTime,
    placeName,
    resDate,
    resTime,
    bookingCode,
    memo,
    currency,
    amount,
    appliedRate,
    convertedAmount,
    rateTimestamp,
    autoSchedule,
    autoExpense
  };

  if (existingId) {
    const idx = trip.shared.reservations.findIndex(r => r.id === existingId);
    if (idx !== -1) trip.shared.reservations[idx] = reservationObj;
  } else {
    trip.shared.reservations.unshift(reservationObj);
  }

  trip.shared.schedules = trip.shared.schedules.filter(s => s.linkedReservationId !== resId);

  if (autoSchedule) {
    if (category === '항공') {
      const targetDate = depDate || arrDate;
      const targetTime = depTime || arrTime || '09:00';
      const analyzed = analyzeDateAndTimeAgainstTrip(targetDate, targetTime);

      const flightTitle = `[항공] ${airline} ${flightNo} (${depAirport || '출발'} ➔ ${arrAirport || '도착'})`.trim();
      const flightMemoParts = [];
      if (depTime || arrTime) {
        flightMemoParts.push(`운항: ${depDate || ''} ${depTime || ''} 출발 ~ ${arrDate || ''} ${arrTime || ''} 도착`.trim());
      }
      if (pnr) flightMemoParts.push(`예약번호: ${pnr}`);
      if (memo) flightMemoParts.push(memo);

      trip.shared.schedules.push({
        id: 'sc_res_' + Date.now(),
        day: analyzed.day,
        time: analyzed.time,
        place: flightTitle,
        memo: flightMemoParts.join(' / '),
        type: 'flight',
        depAirport,
        arrAirport,
        linkedReservationId: resId
      });
    } else {
      const analyzed = analyzeDateAndTimeAgainstTrip(resDate, resTime || '12:00');
      const memoParts = [];
      if (bookingCode) memoParts.push(`예약번호: ${bookingCode}`);
      if (memo) memoParts.push(memo);

      trip.shared.schedules.push({
        id: 'sc_res_' + Date.now(),
        day: analyzed.day,
        time: analyzed.time,
        place: `[${category}] ${placeName}`,
        memo: memoParts.join(' / '),
        type: 'general',
        linkedReservationId: resId
      });
    }
  }

  const prevLinkedExpense = trip.shared.expenses.find(ex => ex.linkedReservationId === resId);
  trip.shared.expenses = trip.shared.expenses.filter(ex => ex.linkedReservationId !== resId);

  if (autoExpense && amount > 0) {
    const targetDate = category === '항공' ? (depDate || arrDate) : resDate;
    const targetTime = category === '항공' ? (depTime || '09:00') : (resTime || '12:00');
    const analyzed = analyzeDateAndTimeAgainstTrip(targetDate, targetTime);

    const members = (trip.shared.members || [me]).map(m => String(m).trim()).filter(Boolean);
    const payer = prevLinkedExpense ? prevLinkedExpense.payer : me;

    const expTitle = category === '항공'
      ? `[항공] ${airline} ${flightNo} (${depAirport}-${arrAirport})`.trim()
      : `[${category}] ${placeName}`;

    const settledMembers = {};
    if (prevLinkedExpense && prevLinkedExpense.settledMembers) {
      members.forEach(cleanM => {
        if (prevLinkedExpense.settledMembers[cleanM] === true) {
          settledMembers[cleanM] = true;
        }
      });
    }

    const newExpense = ensureExpenseSchema({
      id: prevLinkedExpense ? prevLinkedExpense.id : 'ex_res_' + Date.now(),
      timing: prevLinkedExpense ? prevLinkedExpense.timing : analyzed.timing,
      day: prevLinkedExpense ? prevLinkedExpense.day : analyzed.day,
      title: expTitle,
      currency,
      amount,
      appliedRate,
      convertedAmount,
      rateTimestamp,
      payer,
      participants: members,
      settledMembers,
      linkedReservationId: resId
    }, me, baseCurr);

    trip.shared.expenses.push(newExpense);
  }

  saveAllTripsToStorage(trip);
  window.closeModal('modalReservation');
  window.renderAll();
};

window.deleteCurrentReservation = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const id = getVal('inputReservationId');
  if (id && confirm('이 예약을 삭제하시겠습니까? (연동된 일정 및 지출 내역도 함께 삭제됩니다)')) {
    trip.shared.reservations = trip.shared.reservations.filter(r => r.id !== id);
    trip.shared.schedules = trip.shared.schedules.filter(s => s.linkedReservationId !== id);
    trip.shared.expenses = trip.shared.expenses.filter(e => e.linkedReservationId !== id);
    saveAllTripsToStorage(trip);
    window.closeModal('modalReservation');
    window.renderAll();
  }
};

window.renderReservations = function() {
  const trip = getActiveTrip();
  const container = getEl('reservationContainer');
  if (!trip || !container) return;
  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  container.innerHTML = '';

  if (trip.shared.reservations.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
        <i class="fa-solid fa-ticket text-3xl mb-2 text-slate-300"></i>
        <p class="text-xs">등록된 예약 내역이 없습니다.</p>
      </div>`;
    return;
  }

  const categoryStyles = {
    '항공': { icon: 'fa-plane', color: 'text-sky-600 bg-sky-50' },
    '숙소': { icon: 'fa-hotel', color: 'text-indigo-600 bg-indigo-50' },
    '식당': { icon: 'fa-utensils', color: 'text-rose-600 bg-rose-50' },
    '교통/패스': { icon: 'fa-train', color: 'text-amber-600 bg-amber-50' },
    '투어/티켓': { icon: 'fa-ticket', color: 'text-emerald-600 bg-emerald-50' },
    '기타': { icon: 'fa-bookmark', color: 'text-slate-600 bg-slate-100' }
  };

  trip.shared.reservations.forEach(res => {
    const cat = res.category || '기타';
    const style = categoryStyles[cat] || categoryStyles['기타'];
    const card = document.createElement('div');
    card.className = 'bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2';

    const resCurr = (res.currency || baseCurr).trim().toUpperCase();
    const isForeign = (res.amount > 0) && (resCurr !== baseCurr);
    const appliedRate = Number(res.appliedRate) || getFallbackRateToBase(resCurr, baseCurr);
    const converted = Math.round((Number(res.amount) || 0) * appliedRate);

    const amountBadgeHtml = res.amount > 0
      ? `<div class="text-right">
          <span class="font-bold text-slate-800">${Number(res.amount).toLocaleString()} ${escapeHtml(resCurr)}</span>
          ${isForeign ? `
            <div class="flex items-center justify-end gap-1 text-[10px] text-slate-500 mt-0.5">
              <span>(1 ${escapeHtml(resCurr)} = ${appliedRate.toFixed(2)} ${baseCurr} / 환산: ${converted.toLocaleString()} ${baseCurr})</span>
              <button type="button" onclick="window.refreshSingleReservationRate('${res.id}')" class="text-sky-600 hover:text-sky-800 font-bold px-1 py-0.2 bg-sky-50 rounded" title="환율 갱신">
                환율 갱신 🔄
              </button>
            </div>` : ''}
        </div>`
      : '<span></span>';

    if (cat === '항공') {
      const depStr = [res.depDate, res.depTime].filter(Boolean).join(' ').replace('T', ' ');
      const arrStr = [res.arrDate, res.arrTime].filter(Boolean).join(' ').replace('T', ' ');

      card.innerHTML = `
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg ${style.color} flex items-center justify-center shrink-0">
              <i class="fa-solid ${style.icon} text-xs"></i>
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">${escapeHtml(res.airline || '항공')}</span>
                <span class="text-xs font-bold text-slate-800">${escapeHtml(res.flightNo)}</span>
              </div>
              <p class="text-xs font-bold text-slate-700 mt-0.5">${escapeHtml(res.depAirport || '출발지')} ➔ ${escapeHtml(res.arrAirport || '도착지')}</p>
            </div>
          </div>
          <button type="button" onclick="window.editReservation('${res.id}')" class="text-xs text-slate-400 hover:text-slate-600 p-1">
            <i class="fa-solid fa-pen"></i>
          </button>
        </div>

        ${(depStr || arrStr) ? `
          <div class="grid grid-cols-2 gap-1.5 text-[11px] bg-slate-50 p-2 rounded-lg text-slate-600">
            <div><span class="text-slate-400 block text-[10px]">출발</span>${escapeHtml(depStr || '-')}</div>
            <div><span class="text-slate-400 block text-[10px]">도착</span>${escapeHtml(arrStr || '-')}</div>
          </div>` : ''}

        <div class="flex flex-wrap items-start justify-between gap-1 text-[11px]">
          ${res.pnr ? `<span class="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">PNR: <strong>${escapeHtml(res.pnr)}</strong></span>` : '<span></span>'}
          ${amountBadgeHtml}
        </div>
        ${res.memo ? `<p class="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg break-words">${escapeHtml(res.memo)}</p>` : ''}
      `;
    } else {
      const dtStr = [res.resDate, res.resTime].filter(Boolean).join(' ') || (res.datetime ? res.datetime.replace('T', ' ') : '');
      card.innerHTML = `
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-lg ${style.color} flex items-center justify-center shrink-0">
              <i class="fa-solid ${style.icon} text-xs"></i>
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">${escapeHtml(cat)}</span>
                <h4 class="text-xs font-bold text-slate-800">${escapeHtml(res.placeName || res.title || '')}</h4>
              </div>
              ${dtStr ? `<span class="text-[10px] text-slate-400 block mt-0.5">${escapeHtml(dtStr)}</span>` : ''}
            </div>
          </div>
          <button type="button" onclick="window.editReservation('${res.id}')" class="text-xs text-slate-400 hover:text-slate-600 p-1">
            <i class="fa-solid fa-pen"></i>
          </button>
        </div>

        <div class="flex flex-wrap items-start justify-between gap-1 text-[11px]">
          ${res.bookingCode ? `<span class="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">예약번호: <strong>${escapeHtml(res.bookingCode)}</strong></span>` : '<span></span>'}
          ${amountBadgeHtml}
        </div>
        ${res.memo ? `<p class="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg break-words">${escapeHtml(res.memo)}</p>` : ''}
      `;
    }

    container.appendChild(card);
  });
};

// ==========================================
// 23. [전역 바인딩] 체크리스트 (준비물 / 쇼핑리스트)
// ==========================================
window.switchChecklistType = function(type) {
  currentChecklistType = type;
  const btnPacking = getEl('btnChecklistTypePacking');
  const btnShopping = getEl('btnChecklistTypeShopping');

  if (type === 'packing') {
    if (btnPacking) btnPacking.className = 'py-2 rounded-lg bg-white text-sky-600 shadow-2xs transition';
    if (btnShopping) btnShopping.className = 'py-2 rounded-lg text-slate-500 transition';
    const inp = getEl('inputChecklistTitle');
    if (inp) inp.placeholder = '새 준비물 입력 (예: 여권, 보조배터리)...';
  } else {
    if (btnShopping) btnShopping.className = 'py-2 rounded-lg bg-white text-sky-600 shadow-2xs transition';
    if (btnPacking) btnPacking.className = 'py-2 rounded-lg text-slate-500 transition';
    const inp = getEl('inputChecklistTitle');
    if (inp) inp.placeholder = '새 쇼핑 품목 입력 (예: 위스키, 사케, 선물)...';
  }
  window.renderChecklist();
};

window.addChecklistItem = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const title = getVal('inputChecklistTitle').trim();
  if (!title) return;

  if (!trip.shared.checklists[currentChecklistType]) {
    trip.shared.checklists[currentChecklistType] = [];
  }

  trip.shared.checklists[currentChecklistType].unshift({
    id: 'ck_' + Date.now(),
    title,
    checked: false
  });

  saveAllTripsToStorage(trip);
  setVal('inputChecklistTitle', '');
  window.renderChecklist();
};

