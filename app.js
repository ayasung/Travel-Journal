/**
 * 반응형 올인원 여행 플래너 웹 앱 - app.js (로드맵 4단계 완결판)
 * - Playcode / Web 전역 실행 보장 (모든 상호작용 함수 window 바인딩)
 * - 동적 PWA Web App Manifest Blob URL 자동 등록 (Android Chrome / iOS Safari 독립 앱 실행 지원)
 * - 최소 송금 횟수(Greedy Debt Simplification) 기반 최종 정산 계산기 (#settlementSummaryBox)
 * - 원클릭 카톡 정산서 복사 (copySettlementToClipboard / copySettlementText)
 * - A4 여행 리포트 통합 생성 및 인쇄 / PDF 내보내기 (printTripReport)
 * - Firebase 실시간 동기화 + 로컬 Fallback 하이브리드 & 공용/개인 데이터 분리 아키텍처 완비
 */

// ==========================================
// 0. Firebase 설정 템플릿 (발급받은 키를 붙여넣으면 즉시 실시간 동기화 모드로 전환됩니다)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBp6NVo7O-ya5MfcmI1_NvnKKLnH3tGF3k",
  authDomain: "travel-journal-8dfd3.firebaseapp.com",
  projectId: "travel-journal-8dfd3",
  storageBucket: "travel-journal-8dfd3.firebasestorage.app",
  messagingSenderId: "210219932082",
  appId: "1:210219932082:web:5afb3349cab5e09725acab"
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

const DEFAULT_RATES_TO_KRW = {
  KRW: 1,
  JPY: 9.15,
  USD: 1380.0,
  EUR: 1490.0,
  GBP: 1750.0,
  TWD: 43.0,
  THB: 38.0,
  VND: 0.055,
  CNY: 192.0
};

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
// 3. Firebase 초기화 및 동기화 상태 배지 제어
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
// 4. 방어형 DOM 접근 및 클립보드·환율 헬퍼
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
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
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

function getDefaultRateToBase(foreignCurr, baseCurr) {
  const f = (foreignCurr || 'KRW').trim().toUpperCase();
  const b = (baseCurr || 'KRW').trim().toUpperCase();
  if (f === b) return 1;
  const fInKrw = DEFAULT_RATES_TO_KRW[f] || 1;
  const bInKrw = DEFAULT_RATES_TO_KRW[b] || 1;
  const rate = fInKrw / bInKrw;
  return rate >= 1 ? Number(rate.toFixed(2)) : Number(rate.toFixed(4));
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
  return avg >= 1 ? Number(avg.toFixed(2)) : Number(avg.toFixed(4));
}

function getItemConvertedAmount(item, baseCurr) {
  const amount = Number(item.amount) || 0;
  const curr = (item.currency || baseCurr || 'KRW').trim().toUpperCase();
  const base = (baseCurr || 'KRW').trim().toUpperCase();

  if (curr === base) return amount;

  const rate = (Number(item.appliedRate) > 0)
    ? Number(item.appliedRate)
    : getDefaultRateToBase(curr, base);

  return amount * rate;
}

/**
 * 모든 지출 항목을 원화(KRW) 환산 금액으로 변환 (최소 송금 정산 계산기용)
 */
function getItemConvertedToKRW(exp, baseCurr) {
  const amount = Number(exp.amount) || 0;
  const curr = (exp.currency || baseCurr || 'KRW').trim().toUpperCase();
  if (curr === 'KRW') return amount;

  const base = (baseCurr || 'KRW').trim().toUpperCase();
  if (base === 'KRW') {
    const rateToKrw = (Number(exp.appliedRate) > 0)
      ? Number(exp.appliedRate)
      : (DEFAULT_RATES_TO_KRW[curr] || 1);
    return amount * rateToKrw;
  }

  const rateToBase = (Number(exp.appliedRate) > 0)
    ? Number(exp.appliedRate)
    : getDefaultRateToBase(curr, base);
  const inBase = amount * rateToBase;
  const baseToKrw = DEFAULT_RATES_TO_KRW[base] || 1;
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
    exp.appliedRate = getDefaultRateToBase(curr, baseCurr);
  }
  if (!exp.rateTimestamp) {
    exp.rateTimestamp = '2026-11-12 00:00';
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
  ratesSyncTime = '2026-11-12 00:00',
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
          : getDefaultRateToBase(resCurr, cleanBaseCurr);
        return {
          ...r,
          appliedRate,
          rateTimestamp: r.rateTimestamp || ratesSyncTime || '2026-11-12 00:00',
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
      ratesSyncTime: ratesSyncTime || '2026-11-12 00:00',
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
      ratesSyncTime: rawTrip.shared.ratesSyncTime || '2026-11-12 00:00',
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
      ratesSyncTime: rawTrip.budget?.ratesSyncTime || '2026-11-12 00:00',
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
// 5. 하이브리드 저장소 동기화 (LocalStorage + Firestore 실시간 구독)
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
// 6. [전역 바인딩] 뷰 전환: 홈(#homeView) <-> 상세(#tripDetailView)
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
};

// ==========================================
// 7. [전역 바인딩] 홈 화면 (#homeView) 렌더링 & 새 여행/초대 합류/삭제
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
// 8. [전역 바인딩] 전체 백업 / 복원
// ==========================================
window.backupAllData = function() {
  const payload = {
    version: '4.0-multi-trip-pwa',
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
// 9. [신규 4단계] 여행 리포트 인쇄 / PDF 아카이브 생성 (`printTripReport`)
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

  // 1) 일차별 일정 요약 HTML
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

  // 2) 예약 요약 HTML
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

  // 3) 지출 및 최종 정산 요약 HTML
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

  // 4) 장소 리뷰 아카이브 HTML
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
// 10. [신규 4단계] 최소 송금 횟수 기반 '최종 정산 계산기' & 카톡 정산서 복사
// ==========================================
/**
 * 미정산 지출 내역을 기반으로 멤버별 실제 결제 총액과 1/N 분담 부담액의 차액(순채권/순채무)을
 * 원화(KRW) 환산 기준으로 집계하고, 최소 송금 횟수(Greedy 매칭) 이체 리스트를 산출합니다.
 */
function computeMinimumTransfersKRW(trip) {
  const me = getMeName(trip);
  const baseCurr = (trip.privateBudget.currency || trip.shared.baseCurrency || 'KRW').trim().toUpperCase();
  const members = Array.isArray(trip.shared.members) ? trip.shared.members.map(m => String(m).trim()).filter(Boolean) : [me];

  // 멤버별 순 잔액(netBalance): +면 받을 돈(채권자), -면 보낼 돈(채무자)
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

    // 미정산된 참여자들에 대해서만 결제자와 참여자 간 채권/채무 반영
    participants.forEach(memberClean => {
      if (netBalance[memberClean] === undefined) netBalance[memberClean] = 0;
      if (memberClean === payerClean) return; // 본인 몫은 상계

      const isAlreadySettled = (settledMap[memberClean] === true);
      if (!isAlreadySettled) {
        // 결제자는 perPersonKRW 만큼 돌려받을 권리(+), 참여자는 보낼 의무(-)
        netBalance[payerClean] += perPersonKRW;
        netBalance[memberClean] -= perPersonKRW;
      }
    });
  });

  // 채무자(보낼 사람)와 채권자(받을 사람) 분리 후 Greedy 최소 이체 매칭
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

/**
 * 지출 탭 상단 [최종 송금 정산 요약] 카드(#settlementSummaryBox) 렌더링
 */
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

/**
 * 원클릭 [정산 내역 카톡 복사 💸] 핸들러
 */
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

// 기존 버튼 연결명 하위 호환 유지
window.copySettlementText = window.copySettlementToClipboard;

// ==========================================
// 11. 날짜/일차 계산 유틸리티
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
// 12. ✨ AI 일정 추천 프롬프트 생성 & JSON 파싱 일괄 등록
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
// 13. 카톡/메신저 공유용 당일 일정 텍스트 복사
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
// 14. 개인 예산 내 환전 내역(privateBudget.exchanges) 관리
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

  const formattedRate = calcRate >= 1 ? calcRate.toFixed(2) : calcRate.toFixed(4);
  setText('exCalculatedRateText', `1 ${fCurr} = ${formattedRate} ${baseCurr}`);
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

  const rawRate = baseAmount / foreignAmount;
  const appliedRate = rawRate >= 1 ? Number(rawRate.toFixed(2)) : Number(rawRate.toFixed(4));

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
    const avgStr = avgRate >= 1 ? avgRate.toFixed(2) : avgRate.toFixed(4);
    summaryHtml += `
      <div class="bg-sky-50/70 border border-sky-100 rounded-xl px-2.5 py-2 flex items-center justify-between text-[11px]">
        <div>
          <span class="font-bold text-sky-900">${c} 총 환전: ${s.totalForeign.toLocaleString()} ${c}</span>
          <span class="text-[10px] text-sky-600 block">평균 환율: 1 ${c} = ${avgStr} ${baseCurr}</span>
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
    const rateStr = rateVal >= 1 ? rateVal.toFixed(2) : rateVal.toFixed(4);
    rowsHtml += `
      <div class="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-1.5 text-[11px]">
        <div class="min-w-0 flex-1 pr-2">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-700">${Number(ex.foreignAmount).toLocaleString()} ${escapeHtml(ex.currency)}</span>
            <span class="text-[10px] text-slate-400">(${Math.round(Number(ex.baseAmount)).toLocaleString()} ${baseCurr})</span>
            <span class="text-[10px] font-mono text-sky-600 bg-sky-50 px-1 rounded">@${rateStr}</span>
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
// 15. 개인 여행 예산 & 잔여 비율(100% -> 0%) 게이지 계산
// ==========================================
window.renderBudget = function(tripParam = null) {
  const trip = tripParam || getActiveTrip();
  if (!trip) return 0;

  const priv = trip.privateBudget;
  const sh = trip.shared;
  const baseCurr = (priv.currency || sh.baseCurrency || 'KRW').trim().toUpperCase();
  const totalBudget = Number(priv.totalBudget) || 0;
  const me = getMeName(trip);

  setText('exchangeRateSyncTime', `환율 기준: ${sh.ratesSyncTime || '2026-11-12 00:00'}`);
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
// 16. 상세 화면 렌더링 총괄 파이프라인
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
// 17. [전역 바인딩] 모달 & 뷰/서브탭 전환
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
// 18. [전역 바인딩] 상세 화면 여행 정보 & 개인 예산 설정
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
// 19. [전역 바인딩] 일정표 & 동선 지도 & 후보 스폿
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
// 20. [전역 바인딩] 예약 등록/수정 & 적용 환율 스냅샷/개별 갱신
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

window.updateReservationRatePreview = function(resetRateToDefault = false) {
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
  if (resetRateToDefault || !(rate > 0)) {
    const avgExRate = getAverageExchangeRateForCurrency(trip, resCurr);
    rate = avgExRate || getDefaultRateToBase(resCurr, baseCurr);
    setVal('inputResAppliedRate', rate);
  }

  const converted = Math.round(amount * rate);
  setText('resRateSummaryText', `기준: 1 ${resCurr} = ${rate} ${baseCurr}`);
  setText('resConvertedPreviewText', `${converted.toLocaleString()} ${baseCurr}`);
};

window.fetchLatestReservationRate = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const resCurr = (getVal('inputResCurrency') || 'KRW').trim().toUpperCase();
  const latestRate = getDefaultRateToBase(resCurr, baseCurr);

  setVal('inputResAppliedRate', latestRate);
  window.updateReservationRatePreview(false);
  alert(`최신 기준 환율 (1 ${resCurr} = ${latestRate} ${baseCurr})을 불러왔습니다.`);
};

window.refreshSingleReservationRate = function(resId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const item = trip.shared.reservations.find(r => r.id === resId);
  if (!item) return;

  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const resCurr = (item.currency || 'KRW').trim().toUpperCase();
  if (resCurr === baseCurr) return;

  const avgExRate = getAverageExchangeRateForCurrency(trip, resCurr);
  const suggestedRate = avgExRate || getDefaultRateToBase(resCurr, baseCurr);
  const inputStr = prompt(
    `[${resCurr} ➔ ${baseCurr}] 적용할 새 환율을 입력하세요.\n(현재: ${item.appliedRate} / 최신기준: ${getDefaultRateToBase(resCurr, baseCurr)}${avgExRate ? ` / 내 환전평균: ${avgExRate}` : ''})`,
    String(suggestedRate)
  );

  if (inputStr === null) return;
  const newRate = Number(inputStr);
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
    setVal('inputResAppliedRate', item.appliedRate);
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
    appliedRate = inputRate > 0 ? inputRate : getDefaultRateToBase(currency, baseCurr);
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
    const appliedRate = Number(res.appliedRate) || getDefaultRateToBase(resCurr, baseCurr);
    const converted = Math.round((Number(res.amount) || 0) * appliedRate);

    const amountBadgeHtml = res.amount > 0
      ? `<div class="text-right">
          <span class="font-bold text-slate-800">${Number(res.amount).toLocaleString()} ${escapeHtml(resCurr)}</span>
          ${isForeign ? `
            <div class="flex items-center justify-end gap-1 text-[10px] text-slate-500 mt-0.5">
              <span>(적용 환율: ${appliedRate} / 환산: ${converted.toLocaleString()} ${baseCurr})</span>
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
// 21. [전역 바인딩] 체크리스트 (준비물 / 쇼핑리스트)
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

window.toggleChecklistItem = function(itemId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const list = trip.shared.checklists[currentChecklistType] || [];
  const item = list.find(i => i.id === itemId);
  if (item) {
    item.checked = !item.checked;
    saveAllTripsToStorage(trip);
    window.renderChecklist();
  }
};

window.deleteChecklistItem = function(itemId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const list = trip.shared.checklists[currentChecklistType] || [];
  trip.shared.checklists[currentChecklistType] = list.filter(i => i.id !== itemId);
  saveAllTripsToStorage(trip);
  window.renderChecklist();
};

window.clearCompletedChecklist = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const list = trip.shared.checklists[currentChecklistType] || [];
  const completedCount = list.filter(i => i.checked).length;
  if (completedCount === 0) {
    alert('완료된 항목이 없습니다.');
    return;
  }
  if (confirm(`완료된 ${completedCount}개 항목을 비우시겠습니까?`)) {
    trip.shared.checklists[currentChecklistType] = list.filter(i => !i.checked);
    saveAllTripsToStorage(trip);
    window.renderChecklist();
  }
};

window.renderChecklist = function() {
  const trip = getActiveTrip();
  const container = getEl('checklistContainer');
  if (!trip || !container) return;
  container.innerHTML = '';

  const list = trip.shared.checklists[currentChecklistType] || [];
  const completedCount = list.filter(i => i.checked).length;
  setText('checklistSummaryText', `완료 ${completedCount} / 전체 ${list.length}`);

  if (list.length === 0) {
    container.innerHTML = `
      <div class="py-10 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
        <i class="fa-solid fa-check-double text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">등록된 항목이 없습니다. 위 입력창에서 추가해보세요.</p>
      </div>`;
    return;
  }

  const sortedList = [...list].sort((a, b) => Number(a.checked) - Number(b.checked));

  sortedList.forEach(item => {
    const row = document.createElement('div');
    row.className = `flex items-center justify-between p-3 rounded-xl border transition ${
      item.checked ? 'bg-slate-50 border-slate-100 opacity-70' : 'bg-white border-slate-200/80 shadow-2xs'
    }`;

    row.innerHTML = `
      <label class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
        <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="window.toggleChecklistItem('${item.id}')" class="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 shrink-0">
        <span class="text-xs font-medium truncate ${item.checked ? 'line-through text-slate-400' : 'text-slate-800'}">
          ${escapeHtml(item.title)}
        </span>
      </label>
      <button type="button" onclick="window.deleteChecklistItem('${item.id}')" class="text-slate-300 hover:text-rose-500 p-1 shrink-0" title="삭제">
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    `;
    container.appendChild(row);
  });
};

// ==========================================
// 22. [전역 바인딩] 지출 및 통화별 정밀 정산 & 개별 환율 스냅샷/갱신
// ==========================================
function getTimingOrder(timing) {
  if (timing === 'pre') return 1;
  if (timing === 'during') return 2;
  return 3;
}

function getCurrencyOrder(curr, baseCurr) {
  const upper = (curr || '').toUpperCase();
  if (upper === baseCurr.toUpperCase()) return 1;
  if (upper === 'USD') return 2;
  if (upper === 'EUR') return 3;
  if (upper === 'JPY') return 4;
  return 5;
}

window.handleExpenseTimingChange = function(timing) {
  const wrapper = getEl('expenseDaySelectorWrapper');
  if (wrapper) {
    if (timing === 'during') {
      wrapper.classList.remove('hidden');
    } else {
      wrapper.classList.add('hidden');
    }
  }
};

function getSelectedExpenseCurrency() {
  let curr = getVal('inputExpenseCurrency');
  if (curr === 'CUSTOM') {
    curr = (getVal('inputCustomCurrencyCode').trim() || 'KRW').toUpperCase();
  }
  return (curr || 'KRW').trim().toUpperCase();
}

window.handleCurrencyChange = function(val) {
  const customWrapper = getEl('customCurrencyWrapper');
  if (customWrapper) {
    if (val === 'CUSTOM') {
      customWrapper.classList.remove('hidden');
    } else {
      customWrapper.classList.add('hidden');
    }
  }
  window.updateExpenseRatePreview(true);
};

window.updateExpenseRatePreview = function(resetRateToDefault = false) {
  const trip = getActiveTrip();
  if (!trip) return;

  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const expCurr = getSelectedExpenseCurrency();
  const amount = Number(getVal('inputExpenseAmount')) || 0;
  const rateBox = getEl('expenseExchangeRateBox');

  if (expCurr === baseCurr) {
    if (rateBox) rateBox.classList.add('hidden');
    setVal('inputExpenseAppliedRate', '1');
    return;
  }

  if (rateBox) rateBox.classList.remove('hidden');
  setText('expenseRateUnitLabel', `1 ${expCurr} =`);
  setText('expenseRateBaseUnitLabel', baseCurr);

  let rate = Number(getVal('inputExpenseAppliedRate'));
  if (resetRateToDefault || !(rate > 0)) {
    const avgExRate = getAverageExchangeRateForCurrency(trip, expCurr);
    rate = avgExRate || getDefaultRateToBase(expCurr, baseCurr);
    setVal('inputExpenseAppliedRate', rate);
  }

  const converted = Math.round(amount * rate);
  setText('expenseRateSummaryText', `기준: 1 ${expCurr} = ${rate} ${baseCurr}`);
  setText('expenseConvertedPreviewText', `${converted.toLocaleString()} ${baseCurr}`);
};

window.fetchLatestExpenseRate = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();
  const expCurr = getSelectedExpenseCurrency();
  const latestRate = getDefaultRateToBase(expCurr, baseCurr);

  setVal('inputExpenseAppliedRate', latestRate);
  window.updateExpenseRatePreview(false);
  alert(`최신 기준 환율 (1 ${expCurr} = ${latestRate} ${baseCurr})을 불러왔습니다.`);
};

window.refreshSingleExpenseRate = function(expId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const me = getMeName(trip);
  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();

  const exp = trip.shared.expenses.find(e => e.id === expId);
  if (!exp) return;
  ensureExpenseSchema(exp, me, baseCurr);

  const expCurr = (exp.currency || baseCurr).trim().toUpperCase();
  if (expCurr === baseCurr) return;

  const avgExRate = getAverageExchangeRateForCurrency(trip, expCurr);
  const suggestedRate = avgExRate || getDefaultRateToBase(expCurr, baseCurr);

  const inputStr = prompt(
    `[${expCurr} ➔ ${baseCurr}] 적용할 새 환율을 입력하세요.\n(현재: ${exp.appliedRate} / 최신기준: ${getDefaultRateToBase(expCurr, baseCurr)}${avgExRate ? ` / 내 환전평균: ${avgExRate}` : ''})`,
    String(suggestedRate)
  );

  if (inputStr === null) return;
  const newRate = Number(inputStr);
  if (!(newRate > 0)) {
    alert('유효한 환율 숫자를 입력해주세요.');
    return;
  }

  const nowTs = getNowTimestampStr();
  exp.appliedRate = newRate;
  exp.rateTimestamp = nowTs;
  exp.convertedAmount = Math.round((Number(exp.amount) || 0) * newRate);

  if (exp.linkedReservationId) {
    const linkedRes = trip.shared.reservations.find(r => r.id === exp.linkedReservationId);
    if (linkedRes) {
      linkedRes.appliedRate = newRate;
      linkedRes.rateTimestamp = nowTs;
      linkedRes.convertedAmount = Math.round((Number(linkedRes.amount) || 0) * newRate);
    }
  }

  saveAllTripsToStorage(trip);
  window.renderAll();
};

function populateExpenseMemberControls(selectedPayer = null, existingParticipants = null) {
  const trip = getActiveTrip();
  const me = getMeName(trip);
  const members = trip?.shared?.members || [me];

  const payerSelect = getEl('inputExpensePayer');
  if (payerSelect) {
    payerSelect.innerHTML = '';
    members.forEach(m => {
      const cleanM = String(m).trim();
      const opt = document.createElement('option');
      opt.value = cleanM;
      opt.textContent = cleanM;
      payerSelect.appendChild(opt);
    });
    if (selectedPayer) payerSelect.value = String(selectedPayer).trim();
  }

  const splitContainer = getEl('expenseParticipantsCheckboxes');
  if (splitContainer) {
    splitContainer.innerHTML = '';
    members.forEach(m => {
      const cleanM = String(m).trim();
      const isChecked = Array.isArray(existingParticipants)
        ? existingParticipants.includes(cleanM)
        : true;

      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 text-xs text-slate-700 cursor-pointer';
      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(cleanM)}" ${isChecked ? 'checked' : ''} class="expense-split-member-chk rounded border-slate-300 text-sky-600 focus:ring-sky-500">
        <span>${escapeHtml(cleanM)}</span>
      `;
      splitContainer.appendChild(label);
    });
  }
}

window.openExpenseModal = function() {
  const trip = getActiveTrip();
  const me = getMeName(trip);
  const baseCurr = trip?.privateBudget?.currency || 'KRW';

  setText('modalExpenseTitle', '지출 내역 등록');
  const form = getEl('formExpense');
  if (form) form.reset();
  setVal('inputExpenseId', '');
  setVal('inputExpenseCurrency', baseCurr);
  setVal('inputExpenseAppliedRate', '1');

  const delBtn = getEl('btnDeleteExpense');
  if (delBtn) delBtn.classList.add('hidden');
  const customWrapper = getEl('customCurrencyWrapper');
  if (customWrapper) customWrapper.classList.add('hidden');

  window.handleExpenseTimingChange('pre');
  populateExpenseMemberControls(me);
  window.updateExpenseRatePreview(true);
  window.openModal('modalExpense');
};

window.editExpense = function(expId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const me = getMeName(trip);
  const baseCurr = trip.privateBudget.currency || 'KRW';
  const exp = trip.shared.expenses.find(e => e.id === expId);
  if (!exp) return;
  ensureExpenseSchema(exp, me, baseCurr);

  setText('modalExpenseTitle', '지출 내역 수정');
  setVal('inputExpenseId', exp.id);
  setVal('inputExpenseTitle', exp.title);
  setVal('inputExpenseAmount', exp.amount);

  document.querySelectorAll('input[name="expenseTiming"]').forEach(r => {
    r.checked = r.value === exp.timing;
  });
  window.handleExpenseTimingChange(exp.timing);
  if (exp.day) setVal('inputExpenseDay', exp.day);

  const currSelect = getEl('inputExpenseCurrency');
  const customWrapper = getEl('customCurrencyWrapper');

  if (['KRW', 'JPY', 'USD', 'EUR'].includes(exp.currency)) {
    if (currSelect) currSelect.value = exp.currency;
    if (customWrapper) customWrapper.classList.add('hidden');
  } else {
    if (currSelect) currSelect.value = 'CUSTOM';
    if (customWrapper) customWrapper.classList.remove('hidden');
    setVal('inputCustomCurrencyCode', exp.currency);
  }

  if (Number(exp.appliedRate) > 0) {
    setVal('inputExpenseAppliedRate', exp.appliedRate);
  }
  window.updateExpenseRatePreview(false);

  populateExpenseMemberControls(exp.payer, exp.participants);
  const delBtn = getEl('btnDeleteExpense');
  if (delBtn) delBtn.classList.remove('hidden');

  window.openModal('modalExpense');
};

window.saveExpense = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;
  const me = getMeName(trip);
  const baseCurr = (trip.privateBudget.currency || 'KRW').trim().toUpperCase();

  const id = getVal('inputExpenseId');
  const timingRadio = document.querySelector('input[name="expenseTiming"]:checked');
  const timing = timingRadio ? timingRadio.value : 'pre';
  const day = Number(getVal('inputExpenseDay')) || 1;
  const title = getVal('inputExpenseTitle').trim();
  const amount = Number(getVal('inputExpenseAmount')) || 0;

  const currency = getSelectedExpenseCurrency();

  let appliedRate = 1;
  if (currency !== baseCurr) {
    const inputRate = Number(getVal('inputExpenseAppliedRate'));
    appliedRate = inputRate > 0 ? inputRate : getDefaultRateToBase(currency, baseCurr);
  }
  const convertedAmount = Math.round(amount * appliedRate);
  const rateTimestamp = getNowTimestampStr();

  const payer = getVal('inputExpensePayer').trim();
  const splitCheckboxes = document.querySelectorAll('.expense-split-member-chk:checked');
  const selectedMembers = Array.from(splitCheckboxes).map(c => c.value.trim());

  if (selectedMembers.length === 0) {
    alert('정산 참여자를 최소 1명 이상 선택해주세요.');
    return;
  }

  let prevSettledMap = {};
  let linkedResId = null;
  if (id) {
    const exist = trip.shared.expenses.find(x => x.id === id);
    if (exist) {
      ensureExpenseSchema(exist, me, baseCurr);
      prevSettledMap = { ...exist.settledMembers };
      linkedResId = exist.linkedReservationId || null;
    }
  }

  const settledMembers = {};
  selectedMembers.forEach(m => {
    if (prevSettledMap[m] === true) {
      settledMembers[m] = true;
    }
  });

  const updatedObj = ensureExpenseSchema({
    id: id || 'ex_' + Date.now(),
    timing,
    day,
    title,
    currency,
    amount,
    appliedRate,
    convertedAmount,
    rateTimestamp,
    payer,
    participants: selectedMembers,
    settledMembers,
    ...(linkedResId ? { linkedReservationId: linkedResId } : {})
  }, me, baseCurr);

  if (id) {
    const idx = trip.shared.expenses.findIndex(x => x.id === id);
    if (idx !== -1) trip.shared.expenses[idx] = updatedObj;

    if (linkedResId) {
      const linkedRes = trip.shared.reservations.find(r => r.id === linkedResId);
      if (linkedRes) {
        linkedRes.currency = currency;
        linkedRes.amount = amount;
        linkedRes.appliedRate = appliedRate;
        linkedRes.convertedAmount = convertedAmount;
        linkedRes.rateTimestamp = rateTimestamp;
      }
    }
  } else {
    trip.shared.expenses.push(updatedObj);
  }

  saveAllTripsToStorage(trip);
  window.closeModal('modalExpense');
  window.renderAll();
};

window.deleteCurrentExpense = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const id = getVal('inputExpenseId');
  if (id && confirm('이 지출 내역을 삭제하시겠습니까?')) {
    trip.shared.expenses = trip.shared.expenses.filter(e => e.id !== id);
    saveAllTripsToStorage(trip);
    window.closeModal('modalExpense');
    window.renderAll();
  }
};

window.toggleSettlement = function(expenseId, memberName) {
  const trip = getActiveTrip();
  if (!trip) return;
  const me = getMeName(trip);
  const baseCurr = trip.privateBudget.currency || 'KRW';

  const exp = trip.shared.expenses.find(e => e.id === expenseId);
  if (!exp) return;
  ensureExpenseSchema(exp, me, baseCurr);

  const targetName = String(memberName || '').trim();
  const nextVal = !exp.settledMembers[targetName];

  if (nextVal) {
    exp.settledMembers[targetName] = true;
  } else {
    delete exp.settledMembers[targetName];
  }

  saveAllTripsToStorage(trip);
  window.renderAll();
};

window.toggleSplitCheck = window.toggleSettlement;

window.renderExpensesAndSettlement = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const me = getMeName(trip);
  const baseCurr = (trip.privateBudget.currency || trip.shared.baseCurrency || 'KRW').trim().toUpperCase();

  trip.shared.expenses.forEach(e => ensureExpenseSchema(e, me, baseCurr));

  // 상단 [최종 송금 정산 요약] 카드 렌더링
  window.renderSettlementSummary();

  const sortedExpenses = [...trip.shared.expenses].sort((a, b) => {
    const timingA = getTimingOrder(a.timing);
    const timingB = getTimingOrder(b.timing);
    if (timingA !== timingB) return timingA - timingB;

    if (a.timing === 'during' && b.timing === 'during') {
      const dayA = Number(a.day) || 1;
      const dayB = Number(b.day) || 1;
      if (dayA !== dayB) return dayA - dayB;
    }

    const currA = getCurrencyOrder(a.currency, baseCurr);
    const currB = getCurrencyOrder(b.currency, baseCurr);
    return currA - currB;
  });

  const currencyBuckets = {};
  sortedExpenses.forEach(exp => {
    const c = (exp.currency || 'KRW').toUpperCase();
    if (!currencyBuckets[c]) {
      currencyBuckets[c] = { total: 0, settled: 0, unsettled: 0 };
    }
    const amt = Number(exp.amount) || 0;
    currencyBuckets[c].total += amt;

    const participants = exp.participants;
    const splitCount = participants.length > 0 ? participants.length : 1;
    const perSplit = amt / splitCount;
    const payerClean = String(exp.payer || '').trim();
    const settledMap = exp.settledMembers || {};

    participants.forEach(m => {
      const isSettled = (m === payerClean) || (settledMap[m] === true);
      if (isSettled) {
        currencyBuckets[c].settled += perSplit;
      } else {
        currencyBuckets[c].unsettled += perSplit;
      }
    });
  });

  const dashContainer = getEl('currencyDashboardContainer');
  if (dashContainer) {
    dashContainer.innerHTML = '';
    const activeCurrencies = Object.keys(currencyBuckets);
    if (activeCurrencies.length === 0) {
      dashContainer.innerHTML = `
        <div class="py-6 text-center text-xs text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
          등록된 지출 내역이 없습니다.
        </div>`;
    } else {
      activeCurrencies.forEach(curr => {
        const b = currencyBuckets[curr];
        const card = document.createElement('div');
        card.className = 'bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs space-y-2';
        card.innerHTML = `
          <div class="flex items-center justify-between border-b border-slate-100 pb-1.5">
            <span class="text-xs font-bold text-slate-800">${curr}</span>
            <span class="text-[11px] text-slate-400">총 정산 대상: <strong class="text-slate-700">${Math.round(b.total).toLocaleString()} ${curr}</strong></span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-emerald-50/70 border border-emerald-100 p-2 rounded-xl">
              <span class="text-[10px] text-emerald-700 font-semibold block">정산 완료 항목</span>
              <span class="text-xs font-bold text-emerald-800">${Math.round(b.settled).toLocaleString()} ${curr}</span>
            </div>
            <div class="bg-rose-50/70 border border-rose-100 p-2 rounded-xl">
              <span class="text-[10px] text-rose-700 font-semibold block">정산 필요 항목</span>
              <span class="text-xs font-bold text-rose-800">${Math.round(b.unsettled).toLocaleString()} ${curr}</span>
            </div>
          </div>
        `;
        dashContainer.appendChild(card);
      });
    }
  }

  window.renderSettlementDetails();

  const listContainer = getEl('expenseListContainer');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  sortedExpenses.forEach(exp => {
    const card = document.createElement('div');
    card.className = 'bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2.5';

    let timingBadge = '';
    if (exp.timing === 'pre') timingBadge = '<span class="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">사전 준비</span>';
    else if (exp.timing === 'during') timingBadge = `<span class="text-[10px] bg-sky-100 text-sky-700 font-bold px-1.5 py-0.5 rounded">Day ${exp.day}</span>`;
    else timingBadge = '<span class="text-[10px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded">사후 정산</span>';

    const participants = exp.participants;
    const splitCount = participants.length > 0 ? participants.length : 1;
    const perAmount = (Number(exp.amount) || 0) / splitCount;
    const isPersonal = participants.length === 1;
    const payerClean = String(exp.payer || '').trim();
    const settledMap = exp.settledMembers || {};

    const expCurr = (exp.currency || baseCurr).trim().toUpperCase();
    const isForeign = expCurr !== baseCurr;
    const appliedRate = Number(exp.appliedRate) || getDefaultRateToBase(expCurr, baseCurr);
    const converted = Math.round((Number(exp.amount) || 0) * appliedRate);

    let splitsHtml = '<div class="flex flex-wrap gap-1.5 pt-1">';
    participants.forEach(memberName => {
      if (memberName === payerClean) {
        splitsHtml += `
          <span class="inline-flex items-center gap-1 text-[11px] bg-sky-50 border border-sky-200 px-2 py-1 rounded-lg">
            <span class="font-bold text-sky-800">${escapeHtml(memberName)}</span>
            <span class="text-[10px] text-sky-600 font-semibold">결제자</span>
          </span>
        `;
      } else {
        const isSettled = (settledMap[memberName] === true);
        const statusBadge = isSettled
          ? '<span class="text-[10px] text-emerald-600 font-semibold">정산 완료</span>'
          : '<span class="text-[10px] text-slate-400 font-semibold">정산 필요</span>';

        splitsHtml += `
          <label class="inline-flex items-center gap-1 text-[11px] bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg cursor-pointer">
            <input type="checkbox" onchange="window.toggleSettlement('${exp.id}', '${escapeParam(memberName)}')" ${isSettled ? 'checked' : ''} class="rounded border-slate-300 text-sky-600 focus:ring-sky-500">
            <span class="font-medium text-slate-700">${escapeHtml(memberName)}</span>
            ${statusBadge}
          </label>
        `;
      }
    });
    splitsHtml += '</div>';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="space-y-0.5 min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            ${timingBadge}
            ${isPersonal ? '<span class="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded">개인 지출</span>' : ''}
            ${exp.linkedReservationId ? '<span class="text-[9px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded">예약연동</span>' : ''}
            <span class="text-xs font-bold text-slate-800">${escapeHtml(exp.title)}</span>
          </div>
          <p class="text-[11px] text-slate-400">결제: <strong class="text-slate-600">${escapeHtml(exp.payer)}</strong> (1인당: ${Math.round(perAmount).toLocaleString()} ${expCurr})</p>
          ${isForeign ? `
            <div class="flex items-center gap-1.5 text-[10px] text-slate-500 pt-0.5">
              <span>(적용 환율: ${appliedRate} / 환산: ${converted.toLocaleString()} ${baseCurr})</span>
              <button type="button" onclick="window.refreshSingleExpenseRate('${exp.id}')" class="text-sky-600 hover:text-sky-800 font-bold px-1.5 py-0.2 bg-sky-50 rounded" title="환율 갱신">
                환율 갱신 🔄
              </button>
            </div>` : ''}
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <span class="text-xs font-bold text-slate-800">${Number(exp.amount).toLocaleString()} ${expCurr}</span>
          <button type="button" onclick="window.editExpense('${exp.id}')" class="text-xs text-slate-400 hover:text-slate-600 p-1">
            <i class="fa-solid fa-pen"></i>
          </button>
        </div>
      </div>
      ${splitsHtml}
    `;
    listContainer.appendChild(card);
  });
};

window.renderSettlementDetails = function() {
  const trip = getActiveTrip();
  const container = getEl('settlementDetailContainer');
  if (!trip || !container) return;
  const me = getMeName(trip);
  const baseCurr = trip.privateBudget.currency || 'KRW';
  container.innerHTML = '';

  const debts = [];

  trip.shared.expenses.forEach(rawExp => {
    const exp = ensureExpenseSchema(rawExp, me, baseCurr);
    const participants = exp.participants;
    const splitCount = participants.length > 0 ? participants.length : 1;
    const perAmount = (Number(exp.amount) || 0) / splitCount;
    const payerClean = String(exp.payer || '').trim();
    const settledMap = exp.settledMembers || {};

    participants.forEach(memberClean => {
      if (memberClean !== payerClean && settledMap[memberClean] !== true) {
        debts.push({
          from: memberClean,
          to: payerClean,
          amount: perAmount,
          currency: exp.currency
        });
      }
    });
  });

  const summary = {};
  debts.forEach(d => {
    const key = `${d.from}->${d.to}|${d.currency}`;
    if (!summary[key]) summary[key] = { from: d.from, to: d.to, currency: d.currency, total: 0 };
    summary[key].total += d.amount;
  });

  const keys = Object.keys(summary);
  if (keys.length === 0) {
    container.innerHTML = '<p class="text-[11px] text-emerald-600 py-1">모든 송금 및 정산이 완료되었습니다.</p>';
    return;
  }

  keys.forEach(k => {
    const item = summary[k];
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between py-1 border-b border-slate-50 last:border-0';
    row.innerHTML = `
      <span class="text-[11px] text-slate-700"><strong>${escapeHtml(item.from)}</strong> ➔ <strong>${escapeHtml(item.to)}</strong></span>
      <span class="text-xs font-bold text-rose-600">${Math.round(item.total).toLocaleString()} ${escapeHtml(item.currency)}</span>
    `;
    container.appendChild(row);
  });
};

window.refreshSettlementView = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  window.renderExpensesAndSettlement();
  window.renderBudget(trip);
};

// ==========================================
// 23. [전역 바인딩] 사진 기록 & 카테고리 필터 (350px 압축 + 1MB 방어)
// ==========================================
function compressImage(file, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxDimension = 350;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      callback(compressedDataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

window.openPhotoUploadModal = function() {
  const form = getEl('formPhotoUpload');
  if (form) form.reset();
  const selector = getEl('timelineDaySelector');
  setVal('inputPhotoUploadDay', selector ? selector.value : 1);
  setVal('inputPhotoUploadCategory', '관광지');
  setVal('inputPhotoUploadMemo', '');
  window.openModal('modalPhotoUpload');
};

window.submitPhotoUploadModal = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const fileInput = getEl('photoFileInput');
  const files = fileInput ? fileInput.files : null;
  if (!files || files.length === 0) {
    alert('업로드할 사진 파일을 선택해주세요.');
    return;
  }

  const day = Number(getVal('inputPhotoUploadDay')) || 1;
  const category = getVal('inputPhotoUploadCategory') || '기타';
  const memo = getVal('inputPhotoUploadMemo').trim();

  let remaining = files.length;

  Array.from(files).forEach(file => {
    compressImage(file, dataUrl => {
      trip.shared.photos.unshift({
        id: 'ph_' + Date.now() + Math.random().toString(36).substr(2, 4),
        day,
        category,
        dataUrl,
        caption: memo,
        timestamp: new Date().toISOString()
      });
      remaining--;
      if (remaining === 0) {
        saveAllTripsToStorage(trip);
        window.closeModal('modalPhotoUpload');
        window.renderAll();
      }
    });
  });
};

window.filterPhotosByCategory = function(category) {
  currentPhotoFilter = category;
  document.querySelectorAll('.photo-filter-btn').forEach(btn => {
    const targetCat = btn.getAttribute('data-photo-filter');
    if (targetCat === category) {
      btn.className = 'photo-filter-btn shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 text-white';
    } else {
      btn.className = 'photo-filter-btn shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-600';
    }
  });
  window.renderPhotos();
};

window.openLightbox = function(photoId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const photo = trip.shared.photos.find(p => p.id === photoId);
  if (!photo) return;

  currentLightboxPhotoId = photo.id;
  const imgEl = getEl('lightboxImg');
  const dateEl = getEl('lightboxDateText');
  const catBadge = getEl('lightboxCategoryBadge');

  const cat = photo.category || '기타';
  if (imgEl) imgEl.src = photo.dataUrl;
  if (catBadge) catBadge.textContent = cat;
  if (dateEl) dateEl.textContent = `Day ${photo.day} · ${photo.timestamp ? photo.timestamp.split('T')[0] : ''}`;

  setVal('inputPhotoCategory', cat);
  setVal('inputPhotoCaption', photo.caption || '');

  window.openModal('modalLightbox');
};

window.saveCurrentPhotoCaption = function() {
  const trip = getActiveTrip();
  if (!trip || !currentLightboxPhotoId) return;
  const photo = trip.shared.photos.find(p => p.id === currentLightboxPhotoId);
  if (photo) {
    photo.category = getVal('inputPhotoCategory') || '기타';
    photo.caption = getVal('inputPhotoCaption').trim();
    saveAllTripsToStorage(trip);
    window.closeModal('modalLightbox');
    window.renderAll();
  }
};

window.deleteCurrentPhoto = function() {
  const trip = getActiveTrip();
  if (!trip || !currentLightboxPhotoId) return;
  if (confirm('이 사진을 삭제하시겠습니까?')) {
    trip.shared.photos = trip.shared.photos.filter(p => p.id !== currentLightboxPhotoId);
    trip.shared.reviews.forEach(rv => {
      if (Array.isArray(rv.photoIds)) {
        rv.photoIds = rv.photoIds.filter(pid => pid !== currentLightboxPhotoId);
      }
    });
    saveAllTripsToStorage(trip);
    window.closeModal('modalLightbox');
    window.renderAll();
  }
};

window.renderPhotos = function() {
  const trip = getActiveTrip();
  const container = getEl('photoGridContainer');
  if (!trip || !container) return;
  container.innerHTML = '';

  const filteredPhotos = currentPhotoFilter === '전체'
    ? trip.shared.photos
    : trip.shared.photos.filter(p => (p.category || '기타') === currentPhotoFilter);

  if (filteredPhotos.length === 0) {
    container.className = 'py-12 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200';
    container.innerHTML = `
      <i class="fa-solid fa-camera text-3xl mb-2 text-slate-300"></i>
      <p class="text-xs">해당 카테고리에 등록된 여행 사진이 없습니다.</p>`;
    return;
  }

  container.className = 'grid grid-cols-3 gap-2';

  filteredPhotos.forEach(photo => {
    const cat = photo.category || '기타';
    const item = document.createElement('div');
    item.className = 'relative aspect-square rounded-xl overflow-hidden bg-slate-100 cursor-pointer group shadow-2xs';
    item.onclick = function() { window.openLightbox(photo.id); };
    item.innerHTML = `
      <img src="${photo.dataUrl}" alt="사진" class="w-full h-full object-cover pointer-events-none">
      <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1.5 pointer-events-none">
        <p class="text-[10px] text-white truncate">${escapeHtml(photo.caption || '메모 없음')}</p>
      </div>
      <div class="absolute top-1 left-1 flex gap-1 pointer-events-none">
        <span class="bg-black/60 text-white text-[9px] font-semibold px-1 rounded">Day ${photo.day}</span>
        <span class="bg-sky-600/80 text-white text-[9px] font-semibold px-1 rounded">${escapeHtml(cat)}</span>
      </div>
    `;
    container.appendChild(item);
  });
};

// ==========================================
// 24. [전역 바인딩] 장소 리뷰 & '예약된 항목에서 불러오기' 연동
// ==========================================
function populateReviewReservationDropdown() {
  const trip = getActiveTrip();
  const selectEl = getEl('selectReviewFromReservation');
  if (!trip || !selectEl) return;

  selectEl.innerHTML = '<option value="">직접 입력 (또는 예약 내역 선택)</option>';

  const reservations = trip.shared.reservations || [];
  reservations.forEach(res => {
    const labelName = res.category === '항공'
      ? `${res.airline || '항공'} ${res.flightNo || ''} (${res.arrAirport || ''})`
      : (res.placeName || res.title || '예약 항목');
    const dtText = res.resDate || res.depDate || '';

    const opt = document.createElement('option');
    opt.value = res.id;
    opt.textContent = `[${res.category}] ${labelName}${dtText ? ` (${dtText})` : ''}`;
    selectEl.appendChild(opt);
  });
}

window.applyReservationToReview = function(resId) {
  if (!resId) return;
  const trip = getActiveTrip();
  if (!trip) return;

  const res = trip.shared.reservations.find(r => r.id === resId);
  if (!res) return;

  let mappedCat = '관광지';
  if (res.category === '숙소') mappedCat = '숙소';
  else if (res.category === '식당') mappedCat = '식당';
  else mappedCat = '관광지';

  const placeName = res.category === '항공'
    ? `${res.airline || ''} ${res.flightNo || ''} (${res.arrAirport || ''})`.trim()
    : (res.placeName || res.title || '');

  const rawDate = res.resDate || res.depDate || '';
  let formattedDate = rawDate;
  if (rawDate) {
    const analyzed = analyzeDateAndTimeAgainstTrip(rawDate, '12:00');
    formattedDate = `Day ${analyzed.day} (${rawDate})`;
  }

  setVal('inputReviewCategory', mappedCat);
  setVal('inputReviewPlace', placeName);
  if (formattedDate) setVal('inputReviewDate', formattedDate);
  if (res.memo && !getVal('inputReviewContent').trim()) {
    setVal('inputReviewContent', res.memo);
  }

  window.renderReviewPhotoPicker(mappedCat);
};

window.filterReviewsByCategory = function(category) {
  currentReviewFilter = category;
  document.querySelectorAll('.review-filter-btn').forEach(btn => {
    const targetCat = btn.getAttribute('data-review-filter');
    if (targetCat === category) {
      btn.className = 'review-filter-btn shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-800 text-white';
    } else {
      btn.className = 'review-filter-btn shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-600';
    }
  });
  window.renderReviews();
};

window.renderReviewPhotoPicker = function(category) {
  const trip = getActiveTrip();
  const grid = getEl('reviewPhotoPickerGrid');
  if (!trip || !grid) return;
  grid.innerHTML = '';

  const matchingPhotos = trip.shared.photos.filter(p => (p.category || '기타') === category);
  setText('reviewSelectedPhotoCount', `${selectedReviewPhotoIds.length}장 선택됨`);

  if (matchingPhotos.length === 0) {
    grid.className = 'text-center py-3 text-[11px] text-slate-400';
    grid.innerHTML = `[${escapeHtml(category)}] 카테고리로 등록된 사진이 없습니다.`;
    return;
  }

  grid.className = 'grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto no-scrollbar';

  matchingPhotos.forEach(photo => {
    const isSelected = selectedReviewPhotoIds.includes(photo.id);
    const thumb = document.createElement('div');
    thumb.className = `relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition ${
      isSelected ? 'border-sky-500 ring-2 ring-sky-200' : 'border-transparent opacity-75 hover:opacity-100'
    }`;
    thumb.onclick = function() {
      window.toggleReviewPhotoSelection(photo.id, category);
    };

    thumb.innerHTML = `
      <img src="${photo.dataUrl}" class="w-full h-full object-cover pointer-events-none">
      ${isSelected ? `
        <div class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-sky-600 text-white flex items-center justify-center text-[9px]">
          <i class="fa-solid fa-check"></i>
        </div>` : ''}
    `;
    grid.appendChild(thumb);
  });
};

window.toggleReviewPhotoSelection = function(photoId, category) {
  if (selectedReviewPhotoIds.includes(photoId)) {
    selectedReviewPhotoIds = selectedReviewPhotoIds.filter(id => id !== photoId);
  } else {
    selectedReviewPhotoIds.push(photoId);
  }
  window.renderReviewPhotoPicker(category);
};

window.openReviewModal = function() {
  setText('modalReviewTitle', '장소 리뷰 & 방문 기록');
  const form = getEl('formReview');
  if (form) form.reset();
  setVal('inputReviewId', '');
  setVal('inputReviewCategory', '숙소');
  setVal('inputReviewRating', '5');
  selectedReviewPhotoIds = [];

  populateReviewReservationDropdown();

  const delBtn = getEl('btnDeleteReview');
  if (delBtn) delBtn.classList.add('hidden');

  window.renderReviewPhotoPicker('숙소');
  window.openModal('modalReview');
};

window.editReview = function(reviewId) {
  const trip = getActiveTrip();
  if (!trip) return;
  const rv = trip.shared.reviews.find(r => r.id === reviewId);
  if (!rv) return;

  setText('modalReviewTitle', '리뷰 기록 수정');
  setVal('inputReviewId', rv.id);
  const cat = rv.category || '숙소';
  setVal('inputReviewCategory', cat);
  setVal('inputReviewDate', rv.date || '');
  setVal('inputReviewPlace', rv.place || '');
  setVal('inputReviewRating', String(rv.rating || 5));
  setVal('inputReviewContent', rv.content || '');
  selectedReviewPhotoIds = Array.isArray(rv.photoIds) ? [...rv.photoIds] : [];

  populateReviewReservationDropdown();

  const delBtn = getEl('btnDeleteReview');
  if (delBtn) delBtn.classList.remove('hidden');

  window.renderReviewPhotoPicker(cat);
  window.openModal('modalReview');
};

window.saveReview = function(e) {
  e.preventDefault();
  const trip = getActiveTrip();
  if (!trip) return;

  const id = getVal('inputReviewId');
  const category = getVal('inputReviewCategory') || '숙소';
  const date = getVal('inputReviewDate').trim();
  const place = getVal('inputReviewPlace').trim();
  const rating = Number(getVal('inputReviewRating')) || 5;
  const content = getVal('inputReviewContent').trim();

  if (!place || !content) return;

  const reviewObj = {
    id: id || 'rv_' + Date.now(),
    category,
    date,
    place,
    rating,
    content,
    photoIds: [...selectedReviewPhotoIds]
  };

  if (id) {
    const idx = trip.shared.reviews.findIndex(r => r.id === id);
    if (idx !== -1) trip.shared.reviews[idx] = reviewObj;
  } else {
    trip.shared.reviews.unshift(reviewObj);
  }

  saveAllTripsToStorage(trip);
  window.closeModal('modalReview');
  window.renderReviews();
};

window.deleteCurrentReview = function() {
  const trip = getActiveTrip();
  if (!trip) return;
  const id = getVal('inputReviewId');
  if (id && confirm('이 리뷰 기록을 삭제하시겠습니까?')) {
    trip.shared.reviews = trip.shared.reviews.filter(r => r.id !== id);
    saveAllTripsToStorage(trip);
    window.closeModal('modalReview');
    window.renderReviews();
  }
};

window.renderReviews = function() {
  const trip = getActiveTrip();
  const container = getEl('reviewListContainer');
  if (!trip || !container) return;
  container.innerHTML = '';

  const filteredReviews = currentReviewFilter === '전체'
    ? trip.shared.reviews
    : trip.shared.reviews.filter(r => r.category === currentReviewFilter);

  if (filteredReviews.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
        <i class="fa-solid fa-book-open text-3xl mb-2 text-slate-300"></i>
        <p class="text-xs">등록된 리뷰 아카이브가 없습니다. 방문 기록을 남겨보세요.</p>
      </div>`;
    return;
  }

  const categoryBadgeColors = {
    '숙소': 'bg-indigo-100 text-indigo-700',
    '식당': 'bg-rose-100 text-rose-700',
    '관광지': 'bg-emerald-100 text-emerald-700'
  };

  filteredReviews.forEach(rv => {
    const badgeClass = categoryBadgeColors[rv.category] || 'bg-slate-100 text-slate-700';
    const stars = '★'.repeat(rv.rating || 5) + '☆'.repeat(5 - (rv.rating || 5));

    let displayPhotos = [];
    if (Array.isArray(rv.photoIds) && rv.photoIds.length > 0) {
      displayPhotos = rv.photoIds
        .map(pid => trip.shared.photos.find(p => p.id === pid))
        .filter(Boolean);
    } else {
      displayPhotos = trip.shared.photos
        .filter(p => (p.category || '기타') === rv.category)
        .slice(0, 3);
    }

    let photosHtml = '';
    if (displayPhotos.length > 0) {
      photosHtml = `
        <div class="pt-2 border-t border-slate-100">
          <div class="grid grid-cols-3 gap-1.5">
            ${displayPhotos.map(p => `
              <img src="${p.dataUrl}" onclick="window.openLightbox('${p.id}')" class="aspect-square object-cover rounded-lg cursor-pointer border border-slate-100">
            `).join('')}
          </div>
        </div>
      `;
    }

    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-2.5';
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="space-y-1">
          <div class="flex items-center gap-1.5">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded ${badgeClass}">${escapeHtml(rv.category)}</span>
            ${rv.date ? `<span class="text-[11px] text-slate-400 font-medium">${escapeHtml(rv.date)}</span>` : ''}
          </div>
          <h4 class="text-sm font-bold text-slate-800">${escapeHtml(rv.place)}</h4>
          <div class="text-xs text-amber-500 tracking-tight">${stars}</div>
        </div>
        <button type="button" onclick="window.editReview('${rv.id}')" class="text-xs text-slate-400 hover:text-slate-600 p-1" title="수정">
          <i class="fa-solid fa-pen"></i>
        </button>
      </div>
      <p class="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl leading-relaxed whitespace-pre-line break-words">${escapeHtml(rv.content)}</p>
      ${photosHtml}
    `;
    container.appendChild(card);
  });
};

// ==========================================
// 25. [전역 바인딩] 날짜별 종합 피드
// ==========================================
window.renderDatesView = function() {
  const trip = getActiveTrip();
  if (!trip) return;

  const totalDays = calculateTotalDays();
  const tabBar = getEl('datesDayTabBar');
  if (tabBar) {
    tabBar.innerHTML = '';
    for (let i = 1; i <= totalDays; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = (i === currentDatesDay)
        ? 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold bg-sky-600 text-white shadow-xs'
        : 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white border border-slate-200 text-slate-600';
      btn.textContent = `Day ${i}`;
      btn.onclick = function() {
        currentDatesDay = i;
        window.renderDatesView();
      };
      tabBar.appendChild(btn);
    }
  }

  setText('dateSummaryDayTitle', `Day ${currentDatesDay} 종합 피드`);
  setText('dateSummaryDateText', getDateStringForDay(currentDatesDay));

  const tlContainer = getEl('dayFeedTimelineContainer');
  if (tlContainer) {
    tlContainer.innerHTML = '';
    const daySchedules = trip.shared.schedules
      .filter(s => Number(s.day) === currentDatesDay)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    if (daySchedules.length === 0) {
      tlContainer.innerHTML = '<p class="text-xs text-slate-400 py-3 text-center bg-white rounded-xl border border-dashed border-slate-200">등록된 동선이 없습니다.</p>';
    } else {
      daySchedules.forEach(s => {
        const isFlight = s.type === 'flight';
        const item = document.createElement('div');
        item.className = 'bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between';
        item.innerHTML = `
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold ${isFlight ? 'text-indigo-600' : 'text-sky-600'}">${escapeHtml(s.time)}</span>
              <span class="text-xs font-bold text-slate-800 truncate">${escapeHtml(s.place)}</span>
            </div>
            ${s.memo ? `<p class="text-[11px] text-slate-500 mt-0.5 truncate">${escapeHtml(s.memo)}</p>` : ''}
          </div>
          <button type="button" onclick="window.openSinglePlaceMap('${escapeParam(isFlight && s.arrAirport ? s.arrAirport : s.place)}')" class="text-xs text-slate-400 hover:text-sky-600 p-1">지도 🗺️</button>
        `;
        tlContainer.appendChild(item);
      });
    }
  }

  const phContainer = getEl('dayFeedPhotoContainer');
  if (phContainer) {
    phContainer.innerHTML = '';
    const dayPhotos = trip.shared.photos.filter(p => Number(p.day) === currentDatesDay);

    if (dayPhotos.length === 0) {
      phContainer.className = 'py-4 text-center text-xs text-slate-400 bg-white rounded-xl border border-dashed border-slate-200';
      phContainer.innerHTML = '당일 등록된 사진이 없습니다.';
    } else {
      phContainer.className = 'grid grid-cols-3 gap-2';
      dayPhotos.forEach(p => {
        const img = document.createElement('img');
        img.src = p.dataUrl;
        img.className = 'aspect-square object-cover rounded-xl cursor-pointer shadow-2xs';
        img.onclick = function() { window.openLightbox(p.id); };
        phContainer.appendChild(img);
      });
    }
  }

  const exContainer = getEl('dayFeedExpenseContainer');
  if (exContainer) {
    exContainer.innerHTML = '';
    const dayExpenses = trip.shared.expenses.filter(e => e.timing === 'during' && Number(e.day) === currentDatesDay);

    if (dayExpenses.length === 0) {
      exContainer.innerHTML = '<p class="text-xs text-slate-400 py-3 text-center bg-white rounded-xl border border-dashed border-slate-200">당일 발생한 지출이 없습니다.</p>';
    } else {
      dayExpenses.forEach(e => {
        const row = document.createElement('div');
        row.className = 'bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs';
        row.innerHTML = `
          <div>
            <span class="font-bold text-slate-800">${escapeHtml(e.title)}</span>
            <span class="text-[10px] text-slate-400 block">결제: ${escapeHtml(e.payer)}</span>
          </div>
          <span class="font-bold text-slate-700">${Number(e.amount).toLocaleString()} ${escapeHtml(e.currency)}</span>
        `;
        exContainer.appendChild(row);
      });
    }
  }
};

// ==========================================
// 26. 앱 초기화 실행 (로컬 로드 -> Firebase 하이브리드 연결 -> 홈 화면 렌더)
// ==========================================
loadLocalTripsFromStorage();
const cloudReady = initFirebaseHybrid();
window.renderHomeView();
if (cloudReady) {
  startFirestoreRealtimeSubscription();
}
