/**
 * Travel Journal - app.js (ES Module)
 * - Firebase Firestore v10 모듈형 SDK + LocalStorage 하이브리드 동기화
 * - DOMContentLoaded 이후 addEventListener & 이벤트 위임(Event Delegation)으로 버튼 먹통 원천 차단
 * - flightCache/{편명} Firestore 공용 캐싱 + services.js 연동
 * - 예약 ➔ 일정 & 지출 3중 자동 연동 + 전 항목 수정(Edit) + 1/N 정산 + Leaflet 지도 + 사진·통합 리뷰(allReviews) + AI 맞춤 일정 추천
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import * as Services from './services.js';

// ============================================================================
// [Firebase 설정 블록] 발급받은 본인의 Firebase 프로젝트 설정값 6줄을 아래에 붙여넣으세요.
// apiKey가 비어 있으면 에러 없이 자동으로 '⚪ 오프라인(로컬 저장)' 모드로 동작합니다.
// ============================================================================
const firebaseConfig = {
  apiKey: "AIzaSyBp6NVo7O-ya5MfcmI1_NvnKKLnH3tGF3k",
  authDomain: "travel-journal-8dfd3.firebaseapp.com",
  projectId: "travel-journal-8dfd3",
  storageBucket: "travel-journal-8dfd3.firebasestorage.app",
  messagingSenderId: "210219932082",
  appId: "1:210219932082:web:5afb3349cab5e09725acab"
};

// ============================================================================
// 1. services.js 함수 호환 어댑터 및 상수 정의
// ============================================================================
const lookupFlightWithAirLabs =
  Services.lookupFlightWithAirLabs ||
  Services.lookupFlightInfo ||
  (async () => null);

const fetchLiveExchangeRate =
  Services.fetchLiveExchangeRate ||
  Services.fetchLiveRateToKrw ||
  (async (curr) => ({ rate: curr === 'KRW' ? 1 : 1000, source: 'fallback' }));

const compressImageToBase64 =
  Services.compressImageFileToBase64 ||
  ((file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX_W = 800;
          let w = img.width;
          let h = img.height;
          if (w > MAX_W) {
            h = Math.round((h * MAX_W) / w);
            w = MAX_W;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }));

const STORAGE_TRIPS_KEY = 'TJ_TRIPS_ARCHIVE_V4';
const STORAGE_PRIVATE_KEY = 'TJ_PRIVATE_BUDGETS_V4';
const STORAGE_ALL_REVIEWS_KEY = 'TJ_ALL_REVIEWS_ARCHIVE_V4';
const STORAGE_FLIGHT_CACHE_KEY = 'TJ_FLIGHT_CACHE_V4';
const STORAGE_UID_KEY = 'TJ_DEVICE_USER_UID_V4';

// 주요 공항 좌표 사전 (Leaflet 항공 노선 점선 연결용)
const AIRPORT_COORDS = {
  ICN: { name: '인천국제공항 (ICN)', lat: 37.4602, lng: 126.4407 },
  GMP: { name: '김포국제공항 (GMP)', lat: 37.5583, lng: 126.7906 },
  PUS: { name: '김해국제공항 (PUS)', lat: 35.1796, lng: 128.9382 },
  CJU: { name: '제주국제공항 (CJU)', lat: 33.5104, lng: 126.4914 },
  NRT: { name: '도쿄 나리타 (NRT)', lat: 35.7720, lng: 140.3929 },
  HND: { name: '도쿄 하네다 (HND)', lat: 35.5494, lng: 139.7798 },
  KIX: { name: '오사카 간사이 (KIX)', lat: 34.4320, lng: 135.2304 },
  FUK: { name: '후쿠오카공항 (FUK)', lat: 33.5859, lng: 130.4507 },
  YGJ: { name: '요나고 기타로 (YGJ)', lat: 35.4922, lng: 133.2364 },
  CTS: { name: '삿포로 신치토세 (CTS)', lat: 42.7752, lng: 141.6923 },
  OKA: { name: '오키나와 나하 (OKA)', lat: 26.1958, lng: 127.6458 },
  TPE: { name: '타이베이 타오위안 (TPE)', lat: 25.0797, lng: 121.2342 },
  HKG: { name: '홍콩 첵랍콕 (HKG)', lat: 22.3080, lng: 113.9185 },
  DAD: { name: '다낭국제공항 (DAD)', lat: 16.0439, lng: 108.1992 },
  BKK: { name: '방콕 수완나품 (BKK)', lat: 13.6900, lng: 100.7501 },
  SIN: { name: '싱가포르 창이 (SIN)', lat: 1.3644, lng: 103.9915 },
  CDG: { name: '파리 샤를드골 (CDG)', lat: 49.0097, lng: 2.5479 },
  LAX: { name: '로스앤젤레스 (LAX)', lat: 33.9416, lng: -118.4085 },
  JFK: { name: '뉴욕 JFK (JFK)', lat: 40.6413, lng: -73.7781 }
};

// ============================================================================
// 2. 전역 앱 상태
// ============================================================================
let db = null;
let isCloudOnline = false;
let unsubscribeTrips = null;
let unsubscribeAllReviews = null;

let trips = [];
let allReviews = [];
let privateBudgets = {}; // { [tripId]: { myBudget: number, myNickname: string } }
let localFlightCache = {};

let currentTripId = null;
let activeMainTab = 'itinerary';
let currentBookingFilter = '전체';
let currentPhotoFilter = '전체';
let currentReviewFilter = '전체';
let currentChecklistSubTab = 'packing'; // 'packing' | 'shopping'
let viewingPhotoId = null;
let selectedReviewPhotoIds = [];
let aiGeneratedSuggestions = [];

// Leaflet 지도 인스턴스 및 레이어 그룹
let leafletMap = null;
let leafletLayerGroup = null;

// ============================================================================
// 3. 방어형 DOM 유틸리티 및 기기 고유 식별자
// ============================================================================
const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getDeviceUid() {
  try {
    let uid = localStorage.getItem(STORAGE_UID_KEY);
    if (!uid) {
      uid = 'uid_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      localStorage.setItem(STORAGE_UID_KEY, uid);
    }
    return uid;
  } catch (err) {
    return 'uid_temp_' + Math.random().toString(36).substring(2, 8);
  }
}

const deviceUid = getDeviceUid();

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TR-${suffix}`;
}

function openModalSafe(modalId) {
  try {
    const el = $(modalId);
    if (el) el.classList.remove('hidden');
  } catch (err) {
    console.error('모달 열기 오류:', modalId, err);
  }
}

function closeModalSafe(modalId) {
  try {
    const el = $(modalId);
    if (el) el.classList.add('hidden');
  } catch (err) {
    console.error('모달 닫기 오류:', modalId, err);
  }
}

async function shareOrCopyText(title, text, alertMsg = '클립보드에 복사되었습니다!') {
  if (!text) return;
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return;
    }
  } catch (err) {
    // 사용자가 공유 창을 취소했거나 미지원 환경일 경우 클립보드 복사로 폴백
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      alert(alertMsg);
      return;
    }
  } catch (err) {
    // 폴백 진행
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    alert(alertMsg);
  } catch (e) {
    alert(text);
  }
  ta.remove();
}

// ============================================================================
// 4. Service Worker 등록
// ============================================================================
function registerServiceWorkerSafe() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service Worker 등록 생략:', err);
      });
    });
  }
}

// ============================================================================
// 5. Firebase 초기화 & 하이브리드 스토리지 동기화
// ============================================================================
function updateSyncBadge(online) {
  const badge = $('connectionStatusBadge');
  if (!badge) return;
  if (online) {
    badge.textContent = '🟢 실시간 동기화';
    badge.className = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700';
  } else {
    badge.textContent = '⚪ 오프라인';
    badge.className = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600';
  }
}

function initFirebaseSafely() {
  const hasApiKey =
    firebaseConfig &&
    typeof firebaseConfig.apiKey === 'string' &&
    firebaseConfig.apiKey.trim() !== '';

  if (!hasApiKey) {
    isCloudOnline = false;
    updateSyncBadge(false);
    return false;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isCloudOnline = true;
    updateSyncBadge(true);
    return true;
  } catch (err) {
    console.error('Firebase 초기화 오류 (오프라인 모드로 계속 동작):', err);
    isCloudOnline = false;
    db = null;
    updateSyncBadge(false);
    return false;
  }
}

function normalizeTrip(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id || 'trip_' + Date.now(),
    inviteCode: raw.inviteCode || generateInviteCode(),
    memberIds: Array.isArray(raw.memberIds) ? raw.memberIds : [deviceUid],
    title: raw.title || '나의 여행',
    destination: raw.destination || '여행지',
    startDate: raw.startDate || '2026-11-12',
    endDate: raw.endDate || '2026-11-15',
    baseCurrency: raw.baseCurrency || 'KRW',
    members: Array.isArray(raw.members) && raw.members.length > 0 ? raw.members : ['나'],
    itineraries: Array.isArray(raw.itineraries) ? raw.itineraries : [],
    bookings: Array.isArray(raw.bookings) ? raw.bookings : [],
    expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    packingList: Array.isArray(raw.packingList)
      ? raw.packingList
      : Array.isArray(raw.checklists)
        ? raw.checklists
        : [],
    shoppingList: Array.isArray(raw.shoppingList) ? raw.shoppingList : [],
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

function loadLocalData() {
  try {
    const tRaw = localStorage.getItem(STORAGE_TRIPS_KEY);
    if (tRaw) {
      const parsed = JSON.parse(tRaw);
      if (Array.isArray(parsed)) {
        trips = parsed.map(normalizeTrip).filter(Boolean);
      }
    }
  } catch (err) {
    trips = [];
  }

  try {
    const pRaw = localStorage.getItem(STORAGE_PRIVATE_KEY);
    if (pRaw) {
      const parsedPriv = JSON.parse(pRaw);
      if (parsedPriv && typeof parsedPriv === 'object') privateBudgets = parsedPriv;
    }
  } catch (err) {
    privateBudgets = {};
  }

  try {
    const rRaw = localStorage.getItem(STORAGE_ALL_REVIEWS_KEY);
    if (rRaw) {
      const parsedRev = JSON.parse(rRaw);
      if (Array.isArray(parsedRev)) allReviews = parsedRev;
    }
  } catch (err) {
    allReviews = [];
  }

  try {
    const fRaw = localStorage.getItem(STORAGE_FLIGHT_CACHE_KEY);
    if (fRaw) {
      const parsedFc = JSON.parse(fRaw);
      if (parsedFc && typeof parsedFc === 'object') localFlightCache = parsedFc;
    }
  } catch (err) {
    localFlightCache = {};
  }
}

function saveLocalData() {
  try {
    localStorage.setItem(STORAGE_TRIPS_KEY, JSON.stringify(trips));
    localStorage.setItem(STORAGE_PRIVATE_KEY, JSON.stringify(privateBudgets));
    localStorage.setItem(STORAGE_ALL_REVIEWS_KEY, JSON.stringify(allReviews));
    localStorage.setItem(STORAGE_FLIGHT_CACHE_KEY, JSON.stringify(localFlightCache));
  } catch (err) {
    console.error('로컬 스토리지 저장 오류:', err);
  }
}

async function syncTripToFirestore(trip) {
  if (!isCloudOnline || !db || !trip) return;
  try {
    const payload = {
      id: trip.id,
      inviteCode: trip.inviteCode,
      memberIds: Array.isArray(trip.memberIds) ? trip.memberIds : [deviceUid],
      title: trip.title,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      baseCurrency: trip.baseCurrency,
      members: trip.members,
      itineraries: trip.itineraries || [],
      bookings: trip.bookings || [],
      expenses: trip.expenses || [],
      photos: trip.photos || [],
      reviews: trip.reviews || [],
      packingList: trip.packingList || [],
      shoppingList: trip.shoppingList || [],
      createdAt: trip.createdAt,
      updatedAt: new Date().toISOString()
    };

    const byteSize = new Blob([JSON.stringify(payload)]).size;
    if (byteSize > 950000) {
      alert('클라우드 문서 용량(1MB) 한도에 근접하여 클라우드 동기화가 보류되었습니다. 사진 수를 줄여주세요.');
      return;
    }

    await setDoc(doc(db, 'trips', trip.id), payload, { merge: true });
  } catch (err) {
    console.error('Firestore 여행 동기화 오류:', err);
  }
}

async function syncReviewToGlobalCollection(reviewObj) {
  // 로컬 통합 아카이브 반영
  const idx = allReviews.findIndex((r) => r.id === reviewObj.id);
  if (idx !== -1) {
    allReviews[idx] = { ...reviewObj };
  } else {
    allReviews.unshift({ ...reviewObj });
  }
  saveLocalData();

  // Firestore 최상위 allReviews 컬렉션 동기화
  if (!isCloudOnline || !db) return;
  try {
    await setDoc(doc(db, 'allReviews', reviewObj.id), reviewObj, { merge: true });
  } catch (err) {
    console.error('allReviews 컬렉션 동기화 오류:', err);
  }
}

async function deleteReviewFromGlobalCollection(reviewId) {
  allReviews = allReviews.filter((r) => r.id !== reviewId);
  saveLocalData();

  if (!isCloudOnline || !db) return;
  try {
    await deleteDoc(doc(db, 'allReviews', reviewId));
  } catch (err) {
    console.warn('allReviews 삭제 오류:', err);
  }
}

function startRealtimeListeners() {
  if (!isCloudOnline || !db) return;

  if (typeof unsubscribeTrips === 'function') unsubscribeTrips();
  if (typeof unsubscribeAllReviews === 'function') unsubscribeAllReviews();

  try {
    // 1) 내가 속한 여행 목록 실시간 구독
    const tripsQuery = query(collection(db, 'trips'), where('memberIds', 'array-contains', deviceUid));
    unsubscribeTrips = onSnapshot(tripsQuery, (snapshot) => {
      const cloudTrips = [];
      snapshot.forEach((docSnap) => {
        const norm = normalizeTrip({ id: docSnap.id, ...docSnap.data() });
        if (norm) cloudTrips.push(norm);
      });

      const cloudIds = new Set(cloudTrips.map((t) => t.id));
      const localOnly = trips.filter((t) => !cloudIds.has(t.id));
      localOnly.forEach((lt) => {
        lt.memberIds = Array.from(new Set([...(lt.memberIds || []), deviceUid]));
        syncTripToFirestore(lt);
      });

      trips = [...cloudTrips, ...localOnly];
      saveLocalData();

      if (currentTripId) {
        renderDetailView();
      } else {
        renderHomeView();
      }
    });

    // 2) 최상위 통합 리뷰 아카이브(allReviews) 실시간 구독
    unsubscribeAllReviews = onSnapshot(collection(db, 'allReviews'), (snapshot) => {
      const cloudRevs = [];
      snapshot.forEach((docSnap) => {
        cloudRevs.push({ id: docSnap.id, ...docSnap.data() });
      });
      if (cloudRevs.length > 0) {
        allReviews = cloudRevs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        saveLocalData();
        if (!currentTripId) {
          renderHomeArchiveReviews();
        }
      }
    });
  } catch (err) {
    console.error('실시간 구독 시작 오류:', err);
  }
}

function getActiveTrip() {
  return trips.find((t) => t.id === currentTripId) || null;
}

function getMyPrivateInfo(trip) {
  if (!trip) return { myBudget: 0, myNickname: '나' };
  const record = privateBudgets[trip.id];
  const defaultName = Array.isArray(trip.members) && trip.members[0] ? trip.members[0] : '나';
  if (!record) return { myBudget: 0, myNickname: defaultName };
  return {
    myBudget: Number(record.myBudget) || 0,
    myNickname: record.myNickname && record.myNickname.trim() ? record.myNickname.trim() : defaultName
  };
}

// ============================================================================
// 6. 항공편 조회 + Firestore 공용 캐싱 (flightCache/{편명})
// ============================================================================
async function lookupFlightWithSharedCache(rawFlightCode) {
  const code = String(rawFlightCode || '').replace(/\s+/g, '').toUpperCase();
  if (!code) return null;

  // 1) 로컬 메모리/스토리지 캐시 확인
  if (localFlightCache[code]) {
    return { ...localFlightCache[code], fromCache: true };
  }

  // 2) Firestore 공용 캐시(flightCache/{편명}) 조회
  if (isCloudOnline && db) {
    try {
      const cacheRef = doc(db, 'flightCache', code);
      const cacheSnap = await getDoc(cacheRef);
      if (cacheSnap.exists()) {
        const cachedData = cacheSnap.data();
        localFlightCache[code] = cachedData;
        saveLocalData();
        return { ...cachedData, fromCache: true };
      }
    } catch (err) {
      console.warn('flightCache 조회 실패, API 직접 호출 진행:', err);
    }
  }

  // 3) 캐시 미스 시 services.js의 lookupFlightWithAirLabs 호출
  const apiResult = await lookupFlightWithAirLabs(code);
  if (apiResult) {
    const cleanRecord = {
      flightNo: code,
      airline: apiResult.airline || '',
      dep: apiResult.dep || '',
      arr: apiResult.arr || '',
      depTime: apiResult.depTime || '',
      arrTime: apiResult.arrTime || '',
      memo: apiResult.memo || '',
      cachedAt: new Date().toISOString()
    };

    localFlightCache[code] = cleanRecord;
    saveLocalData();

    // Firestore 공용 캐시에 저장
    if (isCloudOnline && db) {
      try {
        await setDoc(doc(db, 'flightCache', code), cleanRecord, { merge: true });
      } catch (err) {
        console.warn('flightCache 저장 경고:', err);
      }
    }

    return { ...cleanRecord, fromCache: false };
  }

  return null;
}

// ============================================================================
// 7. 날짜/일차 계산 유틸리티
// ============================================================================
function calculateTripDays(trip) {
  if (!trip || !trip.startDate || !trip.endDate) return 1;
  const s = new Date(`${trip.startDate}T00:00:00`);
  const e = new Date(`${trip.endDate}T00:00:00`);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 1;
  return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

function getDateForTripDay(trip, dayNum) {
  if (!trip || !trip.startDate) return '';
  const d = new Date(`${trip.startDate}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (Number(dayNum) - 1));
  return d.toISOString().split('T')[0];
}

function inferDayNumberFromDate(trip, dateStr) {
  if (!trip || !trip.startDate || !dateStr) return 1;
  const totalDays = calculateTripDays(trip);
  const target = new Date(`${dateStr}T00:00:00`);
  const start = new Date(`${trip.startDate}T00:00:00`);
  if (isNaN(target.getTime()) || isNaN(start.getTime())) return 1;
  const diff = Math.round((target - start) / (1000 * 60 * 60 * 24)) + 1;
  return Math.min(Math.max(diff, 1), totalDays);
}

// ============================================================================
// 8. 홈 화면 렌더링 및 여행 상세 전환 (전체 리뷰 아카이브 포함)
// ============================================================================
function renderHomeView() {
  const container = $('homeTripCardsContainer');
  if (!container) return;

  $('btnHeaderBackToHome')?.classList.add('hidden');
  $('btnHeaderCopyInvite')?.classList.add('hidden');
  $('headerBrandIcon')?.classList.remove('hidden');
  if ($('headerTitleText')) $('headerTitleText').textContent = 'Travel Journal';
  if ($('homeTripCountLabel')) $('homeTripCountLabel').textContent = String(trips.length);

  if (trips.length === 0) {
    container.innerHTML = `
      <div class="py-10 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2">
        <div class="w-11 h-11 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
          <i class="fa-solid fa-suitcase-rolling text-lg"></i>
        </div>
        <p class="text-xs font-extrabold text-slate-700">등록된 여행이 없습니다.</p>
        <p class="text-[11px] text-slate-400">상단의 [새 여행 만들기] 버튼으로 첫 여행을 시작해 보세요!</p>
      </div>
    `;
  } else {
    container.innerHTML = trips
      .map((trip) => {
        const members = Array.isArray(trip.members) ? trip.members : ['나'];
        const memberTags = members
          .map((m) => `<span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-semibold">${escapeHtml(m)}</span>`)
          .join('');

        return `
          <div data-action="open-trip" data-trip-id="${escapeHtml(trip.id)}" class="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-sky-300 active:scale-[0.99] transition cursor-pointer space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 mb-1">
                  <span class="text-[10px] font-mono font-bold text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded">${escapeHtml(trip.inviteCode)}</span>
                  <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">${escapeHtml(trip.destination)}</span>
                </div>
                <h4 class="text-sm font-extrabold text-slate-800 truncate">${escapeHtml(trip.title)}</h4>
                <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(trip.startDate)} ~ ${escapeHtml(trip.endDate)}</p>
              </div>
              <button type="button" data-action="delete-trip" data-trip-id="${escapeHtml(trip.id)}" class="touch-target flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition shrink-0" title="여행 삭제">
                <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
              </button>
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-slate-100">
              <div class="flex items-center gap-1 flex-wrap">
                <span class="text-[11px] text-slate-400 mr-1"><i class="fa-solid fa-users text-[10px] mr-1"></i>${members.length}명</span>
                ${memberTags}
              </div>
              <span class="text-xs font-extrabold text-sky-600 shrink-0">입장 <i class="fa-solid fa-chevron-right text-[10px]"></i></span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  renderHomeArchiveReviews();
}

/**
 * 홈 화면 하단 [전체 리뷰 아카이브] 동적 주입 및 렌더링 (allReviews 기반)
 */
function renderHomeArchiveReviews() {
  const homeEl = $('homeView');
  if (!homeEl) return;

  let archiveSection = $('homeAllReviewsSection');
  if (!archiveSection) {
    archiveSection = document.createElement('section');
    archiveSection.id = 'homeAllReviewsSection';
    archiveSection.className = 'space-y-2.5 pt-2';
    homeEl.appendChild(archiveSection);
  }

  // 모든 여행의 리뷰와 allReviews 병합 중복 제거
  const mergedMap = new Map();
  allReviews.forEach((r) => mergedMap.set(r.id, r));
  trips.forEach((t) => {
    (t.reviews || []).forEach((r) => {
      if (!mergedMap.has(r.id)) {
        mergedMap.set(r.id, { ...r, tripId: t.id, tripTitle: t.title });
      }
    });
  });

  const combinedReviews = Array.from(mergedMap.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );

  if (combinedReviews.length === 0) {
    archiveSection.innerHTML = `
      <div class="flex items-center justify-between px-1">
        <h3 class="text-xs font-extrabold text-slate-700">전체 리뷰 아카이브 <span class="text-amber-600 ml-1">0</span></h3>
      </div>
      <div class="py-8 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <p class="text-xs">아직 작성된 전체 리뷰가 없습니다. 여행 상세에서 리뷰를 남겨보세요!</p>
      </div>
    `;
    return;
  }

  const avgAll = (
    combinedReviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / combinedReviews.length
  ).toFixed(1);

  archiveSection.innerHTML = `
    <div class="flex items-center justify-between px-1">
      <h3 class="text-xs font-extrabold text-slate-700">전체 리뷰 아카이브 <span class="text-amber-600 ml-1">${combinedReviews.length}</span></h3>
      <span class="text-[11px] font-bold text-amber-600">평균 ★ ${avgAll}</span>
    </div>
    <div class="space-y-2.5">
      ${combinedReviews
        .slice(0, 10)
        .map((rv) => {
          const rating = Number(rv.rating) || 5;
          const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
          return `
            <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-[10px] font-extrabold px-2 py-0.5 rounded bg-sky-50 text-sky-700">${escapeHtml(rv.category || '장소')}</span>
                    ${rv.tripTitle ? `<span class="text-[10px] font-semibold text-slate-400 truncate max-w-[130px]">${escapeHtml(rv.tripTitle)}</span>` : ''}
                  </div>
                  <h4 class="text-xs font-extrabold text-slate-800 mt-1 truncate">${escapeHtml(rv.place)}</h4>
                  <span class="text-[11px] text-amber-500 font-bold">${stars}</span>
                </div>
                ${
                  rv.tripId
                    ? `<button type="button" data-action="edit-global-review" data-trip-id="${escapeHtml(rv.tripId)}" data-id="${escapeHtml(rv.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 transition" title="리뷰 수정">
                        <i class="fa-solid fa-pen text-xs pointer-events-none"></i>
                      </button>`
                    : ''
                }
              </div>
              <p class="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl line-clamp-2">${escapeHtml(rv.content)}</p>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function enterTripDetail(tripId) {
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return;

  currentTripId = tripId;
  activeMainTab = 'itinerary';
  currentBookingFilter = '전체';
  currentPhotoFilter = '전체';
  currentReviewFilter = '전체';

  $('homeView')?.classList.add('hidden');
  $('tripDetailView')?.classList.remove('hidden');

  $('headerBrandIcon')?.classList.add('hidden');
  $('btnHeaderBackToHome')?.classList.remove('hidden');
  $('btnHeaderCopyInvite')?.classList.remove('hidden');

  switchMainTab('itinerary');
  renderDetailView();
}

function exitTripDetailToHome() {
  currentTripId = null;
  $('tripDetailView')?.classList.add('hidden');
  $('homeView')?.classList.remove('hidden');
  renderHomeView();
}

function switchMainTab(tabName) {
  activeMainTab = tabName;

  const panels = {
    itinerary: $('tabPanelItinerary'),
    bookings: $('tabPanelBookings'),
    expenses: $('tabPanelExpenses'),
    photos: $('tabPanelPhotos'),
    reviews: $('tabPanelReviews'),
    checklist: $('tabPanelChecklist')
  };

  Object.keys(panels).forEach((key) => {
    if (panels[key]) {
      panels[key].classList.toggle('hidden', key !== tabName);
    }
  });

  document.querySelectorAll('.main-tab-btn').forEach((btn) => {
    const isMatch = btn.getAttribute('data-main-tab') === tabName;
    btn.className = isMatch
      ? 'main-tab-btn touch-target flex-1 min-w-[58px] flex flex-col items-center justify-center rounded-xl bg-sky-50 text-sky-600 font-extrabold text-[11px] transition'
      : 'main-tab-btn touch-target flex-1 min-w-[58px] flex flex-col items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50 font-bold text-[11px] transition';
  });

  if (tabName === 'itinerary') {
    setTimeout(() => {
      if (leafletMap) leafletMap.invalidateSize();
    }, 80);
  }
}

// ============================================================================
// 9. 상세 화면 6개 탭 통합 렌더링 + Leaflet 동선 지도 + AI 추천 일정
// ============================================================================
function renderDetailView() {
  const trip = getActiveTrip();
  if (!trip) {
    exitTripDetailToHome();
    return;
  }

  const priv = getMyPrivateInfo(trip);
  const members = Array.isArray(trip.members) ? trip.members : ['나'];

  if ($('headerTitleText')) $('headerTitleText').textContent = trip.title;
  if ($('headerInviteCodeValue')) $('headerInviteCodeValue').textContent = trip.inviteCode || 'TR-0000';
  if ($('detailDestinationBadge')) $('detailDestinationBadge').textContent = trip.destination || '여행지';
  if ($('detailBaseCurrencyBadge')) $('detailBaseCurrencyBadge').textContent = trip.baseCurrency || 'KRW';
  if ($('detailTripTitle')) $('detailTripTitle').textContent = trip.title;
  if ($('detailTripPeriodAndMembers')) $('detailTripPeriodAndMembers').textContent = `${trip.startDate} ~ ${trip.endDate} · ${members.length}명`;
  if ($('detailMyNicknameLabel')) $('detailMyNicknameLabel').textContent = priv.myNickname;

  populateAllDaySelectors(trip);
  renderItineraryTab(trip);
  renderBookingsTab(trip);
  renderExpensesTab(trip);
  renderPhotosTab(trip);
  renderReviewsTab(trip);
  renderChecklistTab(trip);
}

function populateAllDaySelectors(trip) {
  const totalDays = calculateTripDays(trip);
  const daySelects = [
    $('selectItineraryDay'),
    $('selectModalScheduleDay'),
    $('selectPhotoDay'),
    $('selectReviewDay')
  ];

  daySelects.forEach((sel) => {
    if (!sel) return;
    const prev = Number(sel.value) || 1;
    sel.innerHTML = '';
    for (let i = 1; i <= totalDays; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Day ${i} (${getDateForTripDay(trip, i)})`;
      sel.appendChild(opt);
    }
    sel.value = String(prev <= totalDays ? prev : 1);
  });

  const photoFilterSel = $('selectPhotoDayFilter');
  if (photoFilterSel) {
    const prevFilter = photoFilterSel.value || 'ALL';
    photoFilterSel.innerHTML = '<option value="ALL">전체 일차 보기</option>';
    for (let i = 1; i <= totalDays; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Day ${i} (${getDateForTripDay(trip, i)})`;
      photoFilterSel.appendChild(opt);
    }
    photoFilterSel.value = prevFilter;
  }
}

// ============================================================================
// [탭 1] 일정(Itinerary) + Leaflet 지도 + AI 맞춤 일정 추천 패널
// ============================================================================
function ensureLeafletAssetsAndRenderMap(trip, dayItems) {
  const panel = $('tabPanelItinerary');
  if (!panel) return;

  let mapBox = $('itineraryMapWrapper');
  if (!mapBox) {
    mapBox = document.createElement('div');
    mapBox.id = 'itineraryMapWrapper';
    mapBox.className = 'bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-2xs space-y-2.5';
    mapBox.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-extrabold text-slate-800"><i class="fa-solid fa-route text-sky-600 mr-1"></i>일자별 동선 지도 & 길찾기</span>
        <div class="flex items-center gap-1">
          <button id="btnOpenAiPlannerPanel" type="button" class="px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-extrabold hover:bg-indigo-100 transition">
            ✨ AI 추천 일정
          </button>
          <button id="btnShareItineraryText" type="button" class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold hover:bg-slate-200 transition">
            공유 📤
          </button>
        </div>
      </div>

      <!-- AI 맞춤 일정 추천 접이식 패널 -->
      <div id="aiPlannerBox" class="hidden bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-extrabold text-indigo-900">✨ 기존 예약·일정 기반 AI 맞춤 코스 생성</span>
          <button id="btnCloseAiPlannerBox" type="button" class="text-slate-400 hover:text-slate-600 text-xs px-1"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <input id="inputAiConcept" type="text" placeholder="컨셉 (예: 미식·온천)" class="col-span-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs outline-none" />
          <input id="inputAiTargetBudget" type="number" placeholder="예산(만원)" class="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none" />
        </div>
        <button id="btnGenerateAiSchedule" type="button" class="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition">
          추천 일정 생성하기
        </button>
        <div id="aiSuggestionResultArea" class="hidden space-y-2 pt-1 border-t border-indigo-100">
          <div id="aiSuggestionItemsList" class="space-y-1 text-[11px] text-slate-700 max-h-40 overflow-y-auto no-scrollbar"></div>
          <button id="btnApplyAllAiSchedules" type="button" class="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold transition">
            내 일정에 한 번에 추가 ➕
          </button>
        </div>
      </div>

      <div id="leafletRouteMapContainer" class="w-full h-44 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden z-10"></div>
      <div id="localRouteLinksList" class="space-y-1.5 pt-1"></div>
    `;
    const timelineEl = $('itineraryTimelineContainer');
    if (timelineEl && timelineEl.parentNode) {
      timelineEl.parentNode.insertBefore(mapBox, timelineEl);
    }
  }

  // 공항 좌표 매칭 및 현지 장소 Google Maps 길찾기 리스트 구성
  const matchedAirports = [];
  const localStops = [];

  dayItems.forEach((item) => {
    const text = `${item.place || ''} ${item.memo || ''}`.toUpperCase();
    const codeMatches = text.match(/\b[A-Z]{3}\b/g) || [];
    codeMatches.forEach((code) => {
      if (AIRPORT_COORDS[code] && !matchedAirports.find((a) => a.code === code)) {
        matchedAirports.push({ code, ...AIRPORT_COORDS[code] });
      }
    });

    if (item.place) {
      localStops.push({
        time: item.time || '',
        place: item.place,
        memo: item.memo || ''
      });
    }
  });

  // 예약 내역의 항공편 공항 코드도 함께 확인
  (trip.bookings || []).forEach((bk) => {
    if (bk.category === '항공') {
      const bText = `${bk.title || ''} ${bk.memo || ''}`.toUpperCase();
      const bCodes = bText.match(/\b[A-Z]{3}\b/g) || [];
      bCodes.forEach((code) => {
        if (AIRPORT_COORDS[code] && !matchedAirports.find((a) => a.code === code)) {
          matchedAirports.push({ code, ...AIRPORT_COORDS[code] });
        }
      });
    }
  });

  // 현지 숙소·관광지·식당 중심 일자별 이동 동선 & Google Maps 길찾기 링크 렌더링
  const linksContainer = $('localRouteLinksList');
  if (linksContainer) {
    if (localStops.length === 0) {
      linksContainer.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-1">일정을 추가하면 장소별 Google Maps 길찾기 링크가 자동 생성됩니다.</p>`;
    } else {
      const origin = encodeURIComponent(localStops[0].place);
      const dest = encodeURIComponent(localStops[localStops.length - 1].place);
      let multiUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=transit`;
      if (localStops.length > 2) {
        const wps = localStops.slice(1, -1).map((s) => encodeURIComponent(s.place)).join('|');
        multiUrl += `&waypoints=${wps}`;
      }

      linksContainer.innerHTML = `
        <div class="flex items-center justify-between bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-1.5 text-[11px]">
          <span class="font-bold text-sky-900">당일 전체 순차 동선 (${localStops.length}곳)</span>
          <a href="${multiUrl}" target="_blank" rel="noopener noreferrer" class="font-extrabold text-sky-700 hover:underline">
            구글 지도 경로 열기 🗺️
          </a>
        </div>
        <div class="space-y-1">
          ${localStops
            .map(
              (st, idx) => `
              <div class="flex items-center justify-between text-[11px] bg-slate-50 px-2.5 py-1.5 rounded-lg">
                <span class="truncate pr-2 text-slate-700"><strong>${idx + 1}. [${escapeHtml(st.time)}]</strong> ${escapeHtml(st.place)}</span>
                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(st.place)}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-sky-600 font-bold hover:underline">
                  길찾기 ↗
                </a>
              </div>
            `
            )
            .join('')}
        </div>
      `;
    }
  }

  // Leaflet CSS/JS 동적 로드 및 지도 렌더링 (공항 간 점선 노선 연결)
  const renderLeaflet = () => {
    try {
      if (typeof window.L === 'undefined') return;
      const mapDiv = $('leafletRouteMapContainer');
      if (!mapDiv) return;

      if (!leafletMap) {
        leafletMap = window.L.map(mapDiv, { zoomControl: false }).setView([35.6812, 139.7671], 5);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap'
        }).addTo(leafletMap);
        leafletLayerGroup = window.L.layerGroup().addTo(leafletMap);
      }

      leafletLayerGroup.clearLayers();

      if (matchedAirports.length >= 1) {
        const latLngs = matchedAirports.map((ap) => [ap.lat, ap.lng]);
        matchedAirports.forEach((ap) => {
          window.L.marker([ap.lat, ap.lng]).bindPopup(`✈️ ${ap.name}`).addTo(leafletLayerGroup);
        });
        if (latLngs.length >= 2) {
          window.L.polyline(latLngs, {
            color: '#0284c7',
            weight: 3,
            dashArray: '8, 8'
          }).addTo(leafletLayerGroup);
          leafletMap.fitBounds(window.L.latLngBounds(latLngs), { padding: [24, 24] });
        } else {
          leafletMap.setView(latLngs[0], 8);
        }
      } else {
        // 공항 좌표가 없는 현지 일정 위주일 경우 기본 중심 뷰 유지
        leafletMap.setView([35.6812, 139.7671], 5);
      }
      setTimeout(() => leafletMap.invalidateSize(), 100);
    } catch (err) {
      console.warn('Leaflet 지도 렌더링 경고:', err);
    }
  };

  if (typeof window.L !== 'undefined') {
    renderLeaflet();
  } else {
    if (!document.querySelector('link[href*="leaflet.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[src*="leaflet.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = renderLeaflet;
      document.head.appendChild(script);
    }
  }
}

function renderItineraryTab(trip) {
  const container = $('itineraryTimelineContainer');
  if (!container) return;

  const selectedDay = Number($('selectItineraryDay')?.value) || 1;
  const items = (trip.itineraries || [])
    .filter((s) => Number(s.day) === selectedDay)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  ensureLeafletAssetsAndRenderMap(trip, items);

  if (items.length === 0) {
    container.innerHTML = `
      <div class="py-10 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-regular fa-calendar-xmark text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">Day ${selectedDay}에 등록된 일정이 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items
    .map(
      (item, idx) => `
      <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs flex items-start gap-3">
        <span class="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
          ${idx + 1}
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-extrabold text-sky-600">${escapeHtml(item.time)}</span>
              ${item.bookingId ? '<span class="text-[9px] font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">예약연동</span>' : ''}
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button type="button" data-action="edit-itinerary" data-id="${escapeHtml(item.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 transition" title="일정 수정">
                <i class="fa-solid fa-pen text-xs pointer-events-none"></i>
              </button>
              <button type="button" data-action="delete-itinerary" data-id="${escapeHtml(item.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="일정 삭제">
                <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
              </button>
            </div>
          </div>
          <h4 class="text-sm font-bold text-slate-800 truncate">${escapeHtml(item.place)}</h4>
          ${item.memo ? `<p class="text-xs text-slate-500 mt-1 bg-slate-50 p-2 rounded-lg break-words">${escapeHtml(item.memo)}</p>` : ''}
        </div>
      </div>
    `
    )
    .join('');
}

// ============================================================================
// [탭 2] 예약(Bookings) - 편명 자동조회 + 3중 연동 + 수정/삭제
// ============================================================================
function renderBookingsTab(trip) {
  const container = $('bookingCardsContainer');
  if (!container) return;

  const allBookings = trip.bookings || [];
  const filtered =
    currentBookingFilter === '전체'
      ? allBookings
      : allBookings.filter((b) => b.category === currentBookingFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-solid fa-ticket text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">등록된 예약 내역이 없습니다.</p>
      </div>
    `;
    return;
  }

  const badgeColors = {
    항공: 'bg-sky-100 text-sky-700',
    숙소: 'bg-indigo-100 text-indigo-700',
    렌터카: 'bg-amber-100 text-amber-700',
    '티켓/투어': 'bg-emerald-100 text-emerald-700'
  };

  container.innerHTML = [...filtered]
    .reverse()
    .map((b) => {
      const colorCls = badgeColors[b.category] || 'bg-slate-100 text-slate-700';
      const costInfo =
        Number(b.amount) > 0
          ? `<span class="text-xs font-extrabold text-slate-700">${Number(b.amount).toLocaleString()} ${escapeHtml(b.currency || 'KRW')}</span>`
          : '';

      return `
        <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-extrabold px-2 py-0.5 rounded ${colorCls}">${escapeHtml(b.category)}</span>
                <span class="text-[11px] font-semibold text-slate-400">${escapeHtml(b.date || '')} ${escapeHtml(b.time || '')}</span>
                ${b.autoSync ? '<span class="text-[9px] font-bold bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded">일정·지출 연동됨</span>' : ''}
              </div>
              <h4 class="text-sm font-extrabold text-slate-800 mt-1 truncate">${escapeHtml(b.title)}</h4>
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button type="button" data-action="edit-booking" data-id="${escapeHtml(b.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 transition" title="예약 수정">
                <i class="fa-solid fa-pen text-xs pointer-events-none"></i>
              </button>
              <button type="button" data-action="delete-booking" data-id="${escapeHtml(b.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="예약 삭제">
                <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2">
            ${b.code ? `<span class="font-mono text-[11px] bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg">예약번호: <strong>${escapeHtml(b.code)}</strong></span>` : '<span></span>'}
            ${costInfo}
          </div>
          ${b.memo ? `<p class="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl break-words">${escapeHtml(b.memo)}</p>` : ''}
        </div>
      `;
    })
    .join('');
}

// ============================================================================
// [탭 3] 지출/정산(Expenses) - 개인 예산 + 1/N 정산 + 공유 + 수정/삭제
// ============================================================================
function renderExpensesTab(trip) {
  const priv = getMyPrivateInfo(trip);
  const me = priv.myNickname;
  const totalBudget = priv.myBudget;
  const expenses = trip.expenses || [];
  const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : [me];

  let mySpentKrw = 0;
  let groupTotalKrw = 0;
  const netBalance = {};
  members.forEach((m) => {
    netBalance[m] = 0;
  });

  expenses.forEach((exp) => {
    const amount = Number(exp.amount) || 0;
    const rate = Number(exp.rateToKrw) || 1;
    const totalKrw = amount * rate;
    groupTotalKrw += totalKrw;

    const participants =
      Array.isArray(exp.participants) && exp.participants.length > 0
        ? exp.participants
        : [exp.payer || me];
    const perPersonKrw = totalKrw / participants.length;
    const payer = exp.payer || me;

    if (participants.includes(me)) {
      mySpentKrw += perPersonKrw;
    }

    if (netBalance[payer] === undefined) netBalance[payer] = 0;
    netBalance[payer] += totalKrw;

    participants.forEach((p) => {
      if (netBalance[p] === undefined) netBalance[p] = 0;
      netBalance[p] -= perPersonKrw;
    });
  });

  const remainKrw = totalBudget - mySpentKrw;
  const remainPercent =
    totalBudget > 0 ? Math.min(Math.max((remainKrw / totalBudget) * 100, 0), 100) : 100;

  if ($('myBudgetTotalText')) $('myBudgetTotalText').textContent = `${Math.round(totalBudget).toLocaleString()} KRW`;
  if ($('myBudgetRemainText')) {
    $('myBudgetRemainText').textContent = `${Math.round(remainKrw).toLocaleString()} KRW`;
    $('myBudgetRemainText').className =
      remainKrw < 0 ? 'text-base font-extrabold text-rose-600' : 'text-base font-extrabold text-sky-600';
  }
  if ($('myBudgetSpentText')) $('myBudgetSpentText').textContent = `${Math.round(mySpentKrw).toLocaleString()} KRW`;
  if ($('myBudgetRemainPercent')) $('myBudgetRemainPercent').textContent = `잔여 ${Math.round(remainPercent)}%`;

  const gaugeBar = $('myBudgetGaugeBar');
  if (gaugeBar) {
    gaugeBar.style.width = `${remainPercent}%`;
    gaugeBar.className =
      remainPercent >= 50
        ? 'bg-sky-500 h-full rounded-full transition-all duration-300'
        : remainPercent >= 20
          ? 'bg-amber-500 h-full rounded-full transition-all duration-300'
          : 'bg-rose-500 h-full rounded-full transition-all duration-300';
  }

  if ($('groupTotalExpenseKrw')) {
    $('groupTotalExpenseKrw').textContent = `총 ${Math.round(groupTotalKrw).toLocaleString()}원`;
  }

  // 최소 이체 정산 계산
  const debtors = [];
  const creditors = [];
  Object.keys(netBalance).forEach((name) => {
    const diff = Math.round(netBalance[name]);
    if (diff < -10) debtors.push({ name, amount: Math.abs(diff) });
    else if (diff > 10) creditors.push({ name, amount: diff });
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const send = Math.min(debtors[i].amount, creditors[j].amount);
    if (send > 0) {
      transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: send });
    }
    debtors[i].amount -= send;
    creditors[j].amount -= send;
    if (debtors[i].amount <= 10) i++;
    if (creditors[j].amount <= 10) j++;
  }

  const summaryEl = $('settlementTransfersContainer');
  if (summaryEl) {
    const transferHtml =
      transfers.length === 0
        ? `<p class="text-emerald-300 font-semibold py-1">정산할 송금 차액이 없습니다.</p>`
        : transfers
            .map(
              (t) => `
              <div class="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-xl">
                <span><strong class="text-amber-300">${escapeHtml(t.from)}</strong> ➔ <strong class="text-sky-300">${escapeHtml(t.to)}</strong>에게 송금</span>
                <span class="font-extrabold text-white">${Math.round(t.amount).toLocaleString()}원</span>
              </div>
            `
            )
            .join('');

    summaryEl.innerHTML = `
      ${transferHtml}
      <div class="pt-1.5 flex justify-end">
        <button id="btnShareSettlementSummary" type="button" class="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-extrabold transition">
          정산 내역 카톡 공유 💸
        </button>
      </div>
    `;
  }

  const listEl = $('expenseListContainer');
  if (!listEl) return;

  if (expenses.length === 0) {
    listEl.innerHTML = `
      <div class="py-10 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-solid fa-receipt text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">등록된 지출 내역이 없습니다. [지출 추가] 버튼을 눌러보세요.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = [...expenses]
    .reverse()
    .map((exp) => {
      const amt = Number(exp.amount) || 0;
      const curr = (exp.currency || 'KRW').toUpperCase();
      const rate = Number(exp.rateToKrw) || 1;
      const krwVal = Math.round(amt * rate);
      const participants = Array.isArray(exp.participants) ? exp.participants : [exp.payer];
      const isPersonal = participants.length === 1;

      return `
        <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${isPersonal ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}">
                  ${isPersonal ? '개인 지출' : `1/${participants.length} 분담`}
                </span>
                ${exp.bookingId ? '<span class="text-[9px] font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">예약연동</span>' : ''}
                <h4 class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(exp.title)}</h4>
              </div>
              <p class="text-[11px] text-slate-500 mt-1">
                결제: <strong class="text-slate-700">${escapeHtml(exp.payer)}</strong> · 참여: ${escapeHtml(participants.join(', '))}
              </p>
              ${curr !== 'KRW' ? `<p class="text-[10px] text-slate-400 mt-0.5">적용 환율 1 ${curr} = ${rate.toFixed(2)} KRW (원화 ${krwVal.toLocaleString()}원)</p>` : ''}
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <span class="text-xs font-extrabold text-slate-800 mr-1">${amt.toLocaleString()} ${curr}</span>
              <button type="button" data-action="edit-expense" data-id="${escapeHtml(exp.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 transition" title="지출 수정">
                <i class="fa-solid fa-pen text-xs pointer-events-none"></i>
              </button>
              <button type="button" data-action="delete-expense" data-id="${escapeHtml(exp.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="지출 삭제">
                <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// ============================================================================
// [탭 4] 사진(Photos) - 카테고리 필터 + 크게 보기 + 수정/삭제
// ============================================================================
function renderPhotosTab(trip) {
  const grid = $('photoGalleryGrid');
  if (!grid) return;

  // 카테고리 필터 바 동적 삽입 (숙소, 관광지, 식당, 이동/풍경, 기타)
  const panel = $('tabPanelPhotos');
  if (panel && !$('photoCategoryChipsBar')) {
    const bar = document.createElement('div');
    bar.id = 'photoCategoryChipsBar';
    bar.className = 'flex overflow-x-auto no-scrollbar gap-1.5 pb-1';
    const cats = ['전체', '숙소', '관광지', '식당', '이동/풍경', '기타'];
    bar.innerHTML = cats
      .map(
        (c) =>
          `<button type="button" data-photo-cat="${c}" class="photo-cat-chip touch-target shrink-0 px-3 rounded-xl text-xs font-bold ${
            c === '전체' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }">${c}</button>`
      )
      .join('');
    grid.parentNode.insertBefore(bar, grid);
  }

  const allPhotos = trip.photos || [];
  const dayFilter = $('selectPhotoDayFilter')?.value || 'ALL';

  const filtered = allPhotos.filter((p) => {
    const dayOk = dayFilter === 'ALL' || String(p.day) === String(dayFilter);
    const catOk = currentPhotoFilter === '전체' || (p.category || '기타') === currentPhotoFilter;
    return dayOk && catOk;
  });

  if ($('photoTotalCountBadge')) {
    $('photoTotalCountBadge').textContent = `총 ${filtered.length}장`;
  }

  if (filtered.length === 0) {
    grid.className = 'py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400';
    grid.innerHTML = `
      <i class="fa-solid fa-camera text-2xl mb-1.5 text-slate-300"></i>
      <p class="text-xs">조건에 맞는 사진이 없습니다. [사진 추가]로 추억을 남겨보세요!</p>
    `;
    return;
  }

  grid.className = 'grid grid-cols-3 gap-2';
  grid.innerHTML = [...filtered]
    .reverse()
    .map(
      (photo) => `
      <div data-action="view-photo" data-id="${escapeHtml(photo.id)}" class="relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/60 cursor-pointer group shadow-2xs">
        <img src="${photo.dataUrl}" alt="${escapeHtml(photo.place)}" class="w-full h-full object-cover pointer-events-none" />
        <div class="absolute top-1 left-1 flex gap-1 pointer-events-none">
          <span class="bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">Day ${photo.day}</span>
          <span class="bg-sky-600/85 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">${escapeHtml(photo.category || '기타')}</span>
        </div>
        <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-1.5 pointer-events-none">
          <p class="text-[10px] font-bold text-white truncate">${escapeHtml(photo.place || '장소')}</p>
        </div>
      </div>
    `
    )
    .join('');
}

// ============================================================================
// [탭 5] 리뷰(Reviews) - 첨부 사진 표시 + 예약 불러오기 + 수정/삭제
// ============================================================================
function renderReviewsTab(trip) {
  const container = $('reviewCardsContainer');
  if (!container) return;

  const allTripReviews = trip.reviews || [];
  const filtered =
    currentReviewFilter === '전체'
      ? allTripReviews
      : allTripReviews.filter((r) => r.category === currentReviewFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-solid fa-star text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">작성된 리뷰가 없습니다. [리뷰 작성]을 눌러 기록을 남겨보세요!</p>
      </div>
    `;
    return;
  }

  const avgScore = (
    filtered.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / filtered.length
  ).toFixed(1);

  const summaryBanner = `
    <div class="bg-amber-50/80 border border-amber-200/80 rounded-2xl px-4 py-2.5 flex items-center justify-between">
      <span class="text-xs font-extrabold text-amber-900">평균 만족도 (${filtered.length}건)</span>
      <span class="text-sm font-extrabold text-amber-600">★ ${avgScore} / 5.0</span>
    </div>
  `;

  const cardsHtml = [...filtered]
    .reverse()
    .map((rv) => {
      const ratingNum = Number(rv.rating) || 5;
      const starsStr = '★'.repeat(ratingNum) + '☆'.repeat(5 - ratingNum);
      const attachedPhotos = Array.isArray(rv.photoIds)
        ? rv.photoIds.map((pid) => (trip.photos || []).find((p) => p.id === pid)).filter(Boolean)
        : [];

      const photosRowHtml =
        attachedPhotos.length > 0
          ? `<div class="grid grid-cols-3 gap-1.5 pt-1">
              ${attachedPhotos
                .map(
                  (p) =>
                    `<img src="${p.dataUrl}" data-action="view-photo" data-id="${escapeHtml(p.id)}" class="aspect-square object-cover rounded-lg border border-slate-100 cursor-pointer" />`
                )
                .join('')}
            </div>`
          : '';

      return `
        <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-extrabold px-2 py-0.5 rounded bg-sky-100 text-sky-700">${escapeHtml(rv.category)}</span>
                <span class="text-[10px] font-bold text-slate-400">Day ${rv.day || 1}</span>
                ${rv.priceMemo ? `<span class="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">${escapeHtml(rv.priceMemo)}</span>` : ''}
                ${rv.revisit ? '<span class="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">재방문 의사 👍</span>' : ''}
              </div>
              <h4 class="text-sm font-extrabold text-slate-800 mt-1 truncate">${escapeHtml(rv.place)}</h4>
              <div class="text-xs text-amber-500 font-bold tracking-tight mt-0.5">${starsStr} (${ratingNum}.0)</div>
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button type="button" data-action="edit-review" data-id="${escapeHtml(rv.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-400 hover:text-sky-600 transition" title="리뷰 수정">
                <i class="fa-solid fa-pen text-xs pointer-events-none"></i>
              </button>
              <button type="button" data-action="delete-review" data-id="${escapeHtml(rv.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="리뷰 삭제">
                <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
              </button>
            </div>
          </div>
          <p class="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl leading-relaxed whitespace-pre-line break-words">${escapeHtml(rv.content)}</p>
          ${photosRowHtml}
        </div>
      `;
    })
    .join('');

  container.innerHTML = summaryBanner + cardsHtml;
}

// ============================================================================
// [탭 6] 체크리스트 & 쇼핑리스트 분리 렌더링
// ============================================================================
function renderChecklistTab(trip) {
  const container = $('checklistItemsContainer');
  if (!container) return;

  // 서브 탭(여행 준비물 vs 쇼핑 목록) UI 동적 구성
  const formEl = $('formAddChecklistItem');
  if (formEl && !$('checklistSubTabSwitch')) {
    const switchDiv = document.createElement('div');
    switchDiv.id = 'checklistSubTabSwitch';
    switchDiv.className = 'grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-xl mb-2';
    switchDiv.innerHTML = `
      <button type="button" data-checklist-mode="packing" class="cl-mode-btn py-2 rounded-lg text-xs font-extrabold bg-white text-sky-600 shadow-2xs transition">
        🧳 여행 준비물
      </button>
      <button type="button" data-checklist-mode="shopping" class="cl-mode-btn py-2 rounded-lg text-xs font-bold text-slate-500 transition">
        🛍️ 쇼핑 목록
      </button>
    `;
    formEl.parentNode.insertBefore(switchDiv, formEl);

    // 쇼핑 가격 입력칸 추가
    const priceInput = document.createElement('input');
    priceInput.id = 'inputShoppingExpectedPrice';
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.placeholder = '예상가';
    priceInput.className = 'hidden touch-target w-24 bg-slate-50 border border-slate-200 rounded-xl px-2.5 text-xs font-bold outline-none focus:border-sky-500';
    formEl.insertBefore(priceInput, $('btnAddChecklistSubmit'));
  }

  const isShopping = currentChecklistSubTab === 'shopping';
  const activeList = isShopping ? trip.shoppingList || [] : trip.packingList || [];
  const doneCount = activeList.filter((item) => item.checked).length;

  if ($('checklistSummaryLabel')) {
    $('checklistSummaryLabel').textContent = `${doneCount} / ${activeList.length} ${isShopping ? '구매 완료' : '준비 완료'}`;
  }

  if (activeList.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">${isShopping ? '등록된 쇼핑 품목이 없습니다.' : '등록된 여행 준비물이 없습니다.'}</p>`;
    return;
  }

  container.innerHTML = activeList
    .map((item) => {
      const priceBadge =
        isShopping && Number(item.expectedPrice) > 0
          ? `<span class="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded ml-1.5">${Number(item.expectedPrice).toLocaleString()}</span>`
          : '';

      return `
        <div class="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/70">
          <label class="touch-target flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
            <input type="checkbox" data-action="toggle-cl-item" data-id="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
            <span class="text-xs font-semibold truncate ${item.checked ? 'line-through text-slate-400' : 'text-slate-800'}">
              ${escapeHtml(item.text)}${priceBadge}
            </span>
          </label>
          <div class="flex items-center gap-0.5 shrink-0">
            <button type="button" data-action="edit-cl-item" data-id="${escapeHtml(item.id)}" class="touch-target flex items-center justify-center text-slate-400 hover:text-sky-600 transition" title="수정">
              <i class="fa-solid fa-pen text-[11px] pointer-events-none"></i>
            </button>
            <button type="button" data-action="delete-cl-item" data-id="${escapeHtml(item.id)}" class="touch-target flex items-center justify-center text-slate-300 hover:text-rose-500 transition" title="삭제">
              <i class="fa-solid fa-xmark text-sm pointer-events-none"></i>
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

// ============================================================================
// 10. 모달 내부 동적 UI 확장 (항공편 자동조회, 예약 ➔ 일정/지출 3중 연동, 리뷰 불러오기)
// ============================================================================
function enhanceModalsOnStartup() {
  // 1) 예약 모달에 [편명 자동조회] + 비용·결제자·분담·자동연동 체크박스 주입
  const bookingForm = $('formCreateBooking');
  if (bookingForm && !$('bookingAutoSyncSection')) {
    const titleInput = $('inputBookingTitle');
    if (titleInput && titleInput.parentNode) {
      const lookupRow = document.createElement('div');
      lookupRow.className = 'flex gap-1.5 mt-1.5';
      lookupRow.innerHTML = `
        <input id="inputBookingFlightLookupCode" type="text" placeholder="항공편명 입력 (예: RS471, KE703)" class="touch-target flex-1 uppercase font-mono bg-sky-50/70 border border-sky-200 rounded-xl px-3 text-xs font-bold outline-none" />
        <button id="btnLookupBookingFlight" type="button" class="touch-target px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold shrink-0 transition">
          편명 자동조회 ✈️
        </button>
      `;
      titleInput.parentNode.appendChild(lookupRow);
    }

    const syncBox = document.createElement('div');
    syncBox.id = 'bookingAutoSyncSection';
    syncBox.className = 'bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5';
    syncBox.innerHTML = `
      <span class="text-xs font-extrabold text-slate-700 block">예약 비용 및 일정·지출 3중 자동 연동</span>
      <div class="grid grid-cols-3 gap-2">
        <select id="selectBookingCurrency" class="touch-target bg-white border border-slate-200 rounded-xl px-2 text-xs font-extrabold outline-none">
          <option value="KRW">KRW</option>
          <option value="JPY">JPY</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
        <input id="inputBookingAmount" type="number" step="any" min="0" placeholder="예약 결제 금액 (선택)" class="touch-target col-span-2 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold outline-none" />
      </div>
      <div>
        <label class="text-[11px] font-semibold text-slate-500 block mb-1">결제자</label>
        <select id="selectBookingPayer" class="touch-target w-full bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold outline-none"></select>
      </div>
      <div>
        <span class="text-[11px] font-semibold text-slate-500 block mb-1">분담 인원</span>
        <div id="bookingParticipantsGroup" class="flex flex-wrap gap-2"></div>
      </div>
      <label class="flex items-center gap-2 text-xs font-bold text-sky-800 cursor-pointer pt-1">
        <input id="chkBookingAutoSync" type="checkbox" checked class="w-4 h-4 rounded border-slate-300 text-sky-600" />
        <span>일정 및 지출 자동 반영</span>
      </label>
    `;

    const submitBtnRow = $('btnSubmitCreateBooking')?.parentNode;
    if (submitBtnRow) {
      bookingForm.insertBefore(syncBox, submitBtnRow);
    }
  }

  // 2) 사진 추가 모달에 카테고리 셀렉트 주입
  const photoForm = $('formCreatePhoto');
  if (photoForm && !$('selectPhotoCategory')) {
    const placeInput = $('inputPhotoPlace');
    if (placeInput && placeInput.parentNode) {
      const catDiv = document.createElement('div');
      catDiv.innerHTML = `
        <label class="text-xs font-semibold text-slate-600 block mb-1">사진 카테고리</label>
        <select id="selectPhotoCategory" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-bold outline-none focus:border-sky-500">
          <option value="숙소">숙소</option>
          <option value="관광지" selected>관광지</option>
          <option value="식당">식당</option>
          <option value="이동/풍경">이동/풍경</option>
          <option value="기타">기타</option>
        </select>
      `;
      photoForm.insertBefore(catDiv, placeInput.parentNode);
    }
  }

  // 3) 사진 크게 보기 모달에 [사진 정보 수정] 버튼 추가
  const deletePhotoBtn = $('btnDeleteViewingPhoto');
  if (deletePhotoBtn && !$('btnEditViewingPhoto')) {
    const editBtn = document.createElement('button');
    editBtn.id = 'btnEditViewingPhoto';
    editBtn.type = 'button';
    editBtn.className = 'touch-target flex items-center justify-center rounded-xl text-sky-300 hover:bg-white/10 transition';
    editBtn.title = '사진 정보 수정';
    editBtn.innerHTML = '<i class="fa-solid fa-pen text-sm pointer-events-none"></i>';
    deletePhotoBtn.parentNode.insertBefore(editBtn, deletePhotoBtn);
  }

  // 4) 리뷰 작성 모달에 [예약 내역 불러오기] & [여행 사진에서 불러오기] 주입
  const reviewForm = $('formCreateReview');
  if (reviewForm && !$('selectReviewFromBooking')) {
    const topBox = document.createElement('div');
    topBox.className = 'bg-sky-50/70 border border-sky-100 rounded-xl p-2.5 space-y-1.5';
    topBox.innerHTML = `
      <label class="text-[11px] font-extrabold text-sky-900 block"><i class="fa-solid fa-bookmark text-sky-600 mr-1"></i>예약 내역 불러오기 (장소·카테고리·가격 자동 입력)</label>
      <select id="selectReviewFromBooking" class="touch-target w-full bg-white border border-slate-200 rounded-lg px-2.5 text-xs font-medium text-slate-700 outline-none">
        <option value="">직접 입력 (또는 예약 내역 선택)</option>
      </select>
    `;
    reviewForm.insertBefore(topBox, reviewForm.firstChild);

    const photoAttachBox = document.createElement('div');
    photoAttachBox.className = 'bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-2';
    photoAttachBox.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-extrabold text-slate-700"><i class="fa-solid fa-images text-sky-600 mr-1"></i>여행 사진에서 불러오기</span>
        <span id="reviewAttachedPhotoCount" class="text-[10px] font-bold text-sky-600">0장 첨부됨</span>
      </div>
      <div id="reviewPhotoThumbnailsGrid" class="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto no-scrollbar"></div>
    `;
    const submitRow = $('btnSubmitCreateReview')?.parentNode;
    if (submitRow) {
      reviewForm.insertBefore(photoAttachBox, submitRow);
    }
  }
}

function setReviewStarRating(val) {
  const num = Math.min(Math.max(Number(val) || 5, 1), 5);
  if ($('inputReviewRatingValue')) $('inputReviewRatingValue').value = String(num);

  document.querySelectorAll('.star-rate-btn').forEach((btn) => {
    const bVal = Number(btn.getAttribute('data-star-val'));
    if (bVal === num) {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-amber-400 bg-amber-400 text-white text-xs font-extrabold shadow-2xs';
    } else if (bVal < num) {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-amber-300 bg-amber-50 text-amber-500 text-xs font-extrabold';
    } else {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-xs font-bold';
    }
  });
}

function renderReviewPhotoThumbnails(trip) {
  const grid = $('reviewPhotoThumbnailsGrid');
  if (!grid || !trip) return;

  const photos = trip.photos || [];
  if ($('reviewAttachedPhotoCount')) {
    $('reviewAttachedPhotoCount').textContent = `${selectedReviewPhotoIds.length}장 첨부됨`;
  }

  if (photos.length === 0) {
    grid.className = 'text-center py-2 text-[11px] text-slate-400';
    grid.innerHTML = '업로드된 여행 사진이 없습니다.';
    return;
  }

  grid.className = 'grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto no-scrollbar';
  grid.innerHTML = photos
    .map((p) => {
      const selected = selectedReviewPhotoIds.includes(p.id);
      return `
        <div data-action="toggle-review-photo" data-id="${escapeHtml(p.id)}" class="relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 ${
          selected ? 'border-sky-500 ring-2 ring-sky-200' : 'border-transparent opacity-75'
        }">
          <img src="${p.dataUrl}" class="w-full h-full object-cover pointer-events-none" />
          ${selected ? '<span class="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-sky-600 text-white text-[9px] flex items-center justify-center"><i class="fa-solid fa-check"></i></span>' : ''}
        </div>
      `;
    })
    .join('');
}

// ============================================================================
// 11. DOMContentLoaded 이후 모든 이벤트 리스너 & 위임 바인딩 (버튼 먹통 원천 차단)
// ============================================================================
let editingScheduleId = null;
let editingBookingId = null;
let editingExpenseId = null;
let editingReviewId = null;
let editingReviewTripId = null;
let currentReviewPriceMemo = '';

document.addEventListener('DOMContentLoaded', () => {
  try {
    registerServiceWorkerSafe();
    enhanceModalsOnStartup();
    loadLocalData();
    const cloudOk = initFirebaseSafely();
    renderHomeView();
    if (cloudOk) {
      startFirestoreRealtimeSync();
    }
  } catch (err) {
    console.error('초기화 예외:', err);
  }

  // --------------------------------------------------------------------------
  // [A] 전역 이벤트 위임 (모달 닫기, 6개 메인 탭, 필터, 전 항목 수정/삭제)
  // --------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    try {
      // 1) 모든 모달 닫기 ([data-close-modal])
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        closeModalSafe(closeBtn.getAttribute('data-close-modal'));
        return;
      }

      // 2) 하단 6개 메인 탭 전환 ([data-main-tab])
      const mainTabBtn = e.target.closest('[data-main-tab]');
      if (mainTabBtn) {
        switchMainTab(mainTabBtn.getAttribute('data-main-tab'));
        return;
      }

      // 3) 예약 카테고리 필터 칩
      const bkChip = e.target.closest('[data-booking-filter]');
      if (bkChip) {
        currentBookingFilter = bkChip.getAttribute('data-booking-filter') || '전체';
        document.querySelectorAll('.booking-filter-chip').forEach((c) => {
          const on = c.getAttribute('data-booking-filter') === currentBookingFilter;
          c.className = on
            ? 'booking-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-extrabold bg-slate-800 text-white'
            : 'booking-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600';
        });
        const trip = getActiveTrip();
        if (trip) renderBookingsTab(trip);
        return;
      }

      // 4) 사진 카테고리 필터 칩
      const phChip = e.target.closest('[data-photo-cat]');
      if (phChip) {
        currentPhotoFilter = phChip.getAttribute('data-photo-cat') || '전체';
        document.querySelectorAll('.photo-cat-chip').forEach((c) => {
          const on = c.getAttribute('data-photo-cat') === currentPhotoFilter;
          c.className = on
            ? 'photo-cat-chip touch-target shrink-0 px-3 rounded-xl text-xs font-bold bg-slate-800 text-white'
            : 'photo-cat-chip touch-target shrink-0 px-3 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600';
        });
        const trip = getActiveTrip();
        if (trip) renderPhotosTab(trip);
        return;
      }

      // 5) 리뷰 카테고리 필터 칩
      const rvChip = e.target.closest('[data-review-filter]');
      if (rvChip) {
        currentReviewFilter = rvChip.getAttribute('data-review-filter') || '전체';
        document.querySelectorAll('.review-filter-chip').forEach((c) => {
          const on = c.getAttribute('data-review-filter') === currentReviewFilter;
          c.className = on
            ? 'review-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-extrabold bg-slate-800 text-white'
            : 'review-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600';
        });
        const trip = getActiveTrip();
        if (trip) renderReviewsTab(trip);
        return;
      }

      // 6) 리뷰 별점 선택
      const starBtn = e.target.closest('[data-star-val]');
      if (starBtn) {
        setReviewStarRating(starBtn.getAttribute('data-star-val'));
        return;
      }

      // 7) 체크리스트 vs 쇼핑리스트 서브탭 전환
      const clModeBtn = e.target.closest('[data-checklist-mode]');
      if (clModeBtn) {
        currentChecklistSubTab = clModeBtn.getAttribute('data-checklist-mode') || 'packing';
        document.querySelectorAll('.cl-mode-btn').forEach((b) => {
          const on = b.getAttribute('data-checklist-mode') === currentChecklistSubTab;
          b.className = on
            ? 'cl-mode-btn py-2 rounded-lg text-xs font-extrabold bg-white text-sky-600 shadow-2xs transition'
            : 'cl-mode-btn py-2 rounded-lg text-xs font-bold text-slate-500 transition';
        });
        const isShop = currentChecklistSubTab === 'shopping';
        if ($('inputNewChecklistText')) {
          $('inputNewChecklistText').placeholder = isShop
            ? '쇼핑 품목 입력 (예: 위스키, 손수건)'
            : '준비물 입력 (예: 여권, E-SIM, 상비약)';
        }
        $('inputShoppingExpectedPrice')?.classList.toggle('hidden', !isShop);
        const trip = getActiveTrip();
        if (trip) renderChecklistTab(trip);
        return;
      }

      // 8) 동적 생성 요소의 [data-action] 처리
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.getAttribute('data-action');
      const id = actionEl.getAttribute('data-id');
      const tripId = actionEl.getAttribute('data-trip-id');

      if (action === 'open-trip' && tripId) {
        enterTripDetail(tripId);
      } else if (action === 'delete-trip' && tripId) {
        e.stopPropagation();
        const target = trips.find((t) => t.id === tripId);
        if (target && confirm(`'${target.title}' 여행을 삭제하시겠습니까?`)) {
          trips = trips.filter((t) => t.id !== tripId);
          delete privateBudgets[tripId];
          saveLocalData();
          if (isCloudOnline && db) {
            deleteDoc(doc(db, 'trips', tripId)).catch((err) => console.warn(err));
          }
          renderHomeView();
        }
      } else if (action === 'edit-itinerary' && id) {
        const trip = getActiveTrip();
        const item = trip?.itineraries?.find((s) => s.id === id);
        if (item) {
          editingScheduleId = item.id;
          populateAllDaySelectors(trip);
          if ($('selectModalScheduleDay')) $('selectModalScheduleDay').value = String(item.day || 1);
          if ($('inputModalScheduleTime')) $('inputModalScheduleTime').value = item.time || '10:00';
          if ($('inputModalSchedulePlace')) $('inputModalSchedulePlace').value = item.place || '';
          if ($('inputModalScheduleMemo')) $('inputModalScheduleMemo').value = item.memo || '';
          openModalSafe('modalAddSchedule');
        }
      } else if (action === 'delete-itinerary' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 일정을 삭제하시겠습니까?')) {
          trip.itineraries = (trip.itineraries || []).filter((s) => s.id !== id);
          saveLocalData();
          syncTripToFirestore(trip);
          renderItineraryTab(trip);
        }
      } else if (action === 'edit-booking' && id) {
        const trip = getActiveTrip();
        const bk = trip?.bookings?.find((b) => b.id === id);
        if (bk) {
          editingBookingId = bk.id;
          const priv = getMyPrivateInfo(trip);
          const members = trip.members || [priv.myNickname];

          if ($('selectBookingCategory')) $('selectBookingCategory').value = bk.category || '항공';
          if ($('inputBookingDate')) $('inputBookingDate').value = bk.date || '';
          if ($('inputBookingTitle')) $('inputBookingTitle').value = bk.title || '';
          if ($('inputBookingTime')) $('inputBookingTime').value = bk.time || '';
          if ($('inputBookingCode')) $('inputBookingCode').value = bk.code || '';
          if ($('inputBookingMemo')) $('inputBookingMemo').value = bk.memo || '';
          if ($('selectBookingCurrency')) $('selectBookingCurrency').value = bk.currency || 'KRW';
          if ($('inputBookingAmount')) $('inputBookingAmount').value = bk.amount || '';
          if ($('chkBookingAutoSync')) $('chkBookingAutoSync').checked = bk.autoSync !== false;

          if ($('selectBookingPayer')) {
            $('selectBookingPayer').innerHTML = members
              .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
              .join('');
            $('selectBookingPayer').value = bk.payer || priv.myNickname;
          }
          if ($('bookingParticipantsGroup')) {
            const activeParts = Array.isArray(bk.participants) ? bk.participants : members;
            $('bookingParticipantsGroup').innerHTML = members
              .map(
                (m) => `
                <label class="inline-flex items-center gap-1 text-xs bg-white border border-slate-200 px-2 py-1 rounded-lg">
                  <input type="checkbox" value="${escapeHtml(m)}" ${activeParts.includes(m) ? 'checked' : ''} class="bk-part-chk" />
                  <span>${escapeHtml(m)}</span>
                </label>
              `
              )
              .join('');
          }
          openModalSafe('modalAddBooking');
        }
      } else if (action === 'delete-booking' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 예약을 삭제하시겠습니까? (연동된 일정 및 지출 내역도 함께 정리됩니다)')) {
          trip.bookings = (trip.bookings || []).filter((b) => b.id !== id);
          trip.itineraries = (trip.itineraries || []).filter((s) => s.bookingId !== id);
          trip.expenses = (trip.expenses || []).filter((ex) => ex.bookingId !== id);
          saveLocalData();
          syncTripToFirestore(trip);
          renderDetailView();
        }
      } else if (action === 'edit-expense' && id) {
        const trip = getActiveTrip();
        const exp = trip?.expenses?.find((ex) => ex.id === id);
        if (exp) {
          editingExpenseId = exp.id;
          const priv = getMyPrivateInfo(trip);
          const members = trip.members || [priv.myNickname];

          if ($('inputExpTitle')) $('inputExpTitle').value = exp.title || '';
          if ($('selectExpCurrency')) $('selectExpCurrency').value = exp.currency || 'KRW';
          if ($('inputExpAmount')) $('inputExpAmount').value = exp.amount || '';
          if ($('inputExpAppliedRate')) $('inputExpAppliedRate').value = exp.rateToKrw || 1;
          updateExpenseModalRatePreview();

          if ($('selectExpPayer')) {
            $('selectExpPayer').innerHTML = members
              .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
              .join('');
            $('selectExpPayer').value = exp.payer || priv.myNickname;
          }
          if ($('expParticipantsCheckboxGroup')) {
            const activeParts = Array.isArray(exp.participants) ? exp.participants : members;
            $('expParticipantsCheckboxGroup').innerHTML = members
              .map(
                (m) => `
                <label class="flex items-center gap-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input type="checkbox" value="${escapeHtml(m)}" ${activeParts.includes(m) ? 'checked' : ''} class="exp-participant-chk w-4 h-4 rounded border-slate-300 text-sky-600" />
                  <span>${escapeHtml(m)}</span>
                </label>
              `
              )
              .join('');
          }
          openModalSafe('modalAddExpense');
        }
      } else if (action === 'delete-expense' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 지출 내역을 삭제하시겠습니까?')) {
          trip.expenses = (trip.expenses || []).filter((ex) => ex.id !== id);
          saveLocalData();
          syncTripToFirestore(trip);
          renderExpensesTab(trip);
        }
      } else if (action === 'view-photo' && id) {
        const trip = getActiveTrip();
        const photo = trip?.photos?.find((p) => p.id === id);
        if (photo) {
          viewingPhotoId = photo.id;
          if ($('viewPhotoDayAndDate')) $('viewPhotoDayAndDate').textContent = `Day ${photo.day} · ${photo.category || '기타'} ${photo.date ? `(${photo.date})` : ''}`;
          if ($('viewPhotoPlaceTitle')) $('viewPhotoPlaceTitle').textContent = photo.place || '장소 기록';
          if ($('viewPhotoFullImg')) $('viewPhotoFullImg').src = photo.dataUrl;
          if ($('viewPhotoMemoText')) $('viewPhotoMemoText').textContent = photo.memo || '등록된 메모가 없습니다.';
          openModalSafe('modalViewPhoto');
        }
      } else if (action === 'toggle-review-photo' && id) {
        const trip = getActiveTrip();
        if (!trip) return;
        if (selectedReviewPhotoIds.includes(id)) {
          selectedReviewPhotoIds = selectedReviewPhotoIds.filter((pid) => pid !== id);
        } else {
          selectedReviewPhotoIds.push(id);
        }
        renderReviewPhotoThumbnails(trip);
      } else if (action === 'edit-review' && id) {
        const trip = getActiveTrip();
        const rv = trip?.reviews?.find((r) => r.id === id);
        if (rv) {
          editingReviewId = rv.id;
          editingReviewTripId = trip.id;
          currentReviewPriceMemo = rv.priceMemo || '';
          populateAllDaySelectors(trip);
          if ($('inputReviewPlaceName')) $('inputReviewPlaceName').value = rv.place || '';
          if ($('selectReviewCategory')) $('selectReviewCategory').value = rv.category || '맛집/카페';
          if ($('selectReviewDay')) $('selectReviewDay').value = String(rv.day || 1);
          setReviewStarRating(rv.rating || 5);
          if ($('chkReviewRevisit')) $('chkReviewRevisit').checked = Boolean(rv.revisit);
          if ($('inputReviewContent')) $('inputReviewContent').value = rv.content || '';
          selectedReviewPhotoIds = Array.isArray(rv.photoIds) ? [...rv.photoIds] : [];
          renderReviewPhotoThumbnails(trip);
          openModalSafe('modalAddReview');
        }
      } else if (action === 'edit-global-review' && tripId && id) {
        const targetTrip = trips.find((t) => t.id === tripId);
        const rv = targetTrip?.reviews?.find((r) => r.id === id);
        if (targetTrip && rv) {
          editingReviewId = rv.id;
          editingReviewTripId = targetTrip.id;
          currentReviewPriceMemo = rv.priceMemo || '';
          populateAllDaySelectors(targetTrip);
          if ($('inputReviewPlaceName')) $('inputReviewPlaceName').value = rv.place || '';
          if ($('selectReviewCategory')) $('selectReviewCategory').value = rv.category || '맛집/카페';
          if ($('selectReviewDay')) $('selectReviewDay').value = String(rv.day || 1);
          setReviewStarRating(rv.rating || 5);
          if ($('chkReviewRevisit')) $('chkReviewRevisit').checked = Boolean(rv.revisit);
          if ($('inputReviewContent')) $('inputReviewContent').value = rv.content || '';
          selectedReviewPhotoIds = Array.isArray(rv.photoIds) ? [...rv.photoIds] : [];
          renderReviewPhotoThumbnails(targetTrip);
          openModalSafe('modalAddReview');
        }
      } else if (action === 'delete-review' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 리뷰를 삭제하시겠습니까?')) {
          trip.reviews = (trip.reviews || []).filter((r) => r.id !== id);
          saveLocalData();
          syncTripToFirestore(trip);
          await deleteReviewFromGlobalCollection(id);
          renderReviewsTab(trip);
        }
      } else if (action === 'edit-cl-item' && id) {
        const trip = getActiveTrip();
        if (!trip) return;
        const targetArr = currentChecklistSubTab === 'shopping' ? trip.shoppingList : trip.packingList;
        const item = (targetArr || []).find((c) => c.id === id);
        if (item) {
          const newText = prompt('항목명을 수정하세요:', item.text);
          if (newText !== null && newText.trim() !== '') {
            item.text = newText.trim();
            if (currentChecklistSubTab === 'shopping') {
              const newPrice = prompt('예상 가격을 수정하세요 (숫자):', String(item.expectedPrice || 0));
              if (newPrice !== null) item.expectedPrice = Number(newPrice) || 0;
            }
            saveLocalData();
            syncTripToFirestore(trip);
            renderChecklistTab(trip);
          }
        }
      } else if (action === 'delete-cl-item' && id) {
        const trip = getActiveTrip();
        if (!trip) return;
        if (currentChecklistSubTab === 'shopping') {
          trip.shoppingList = (trip.shoppingList || []).filter((c) => c.id !== id);
        } else {
          trip.packingList = (trip.packingList || []).filter((c) => c.id !== id);
        }
        saveLocalData();
        syncTripToFirestore(trip);
        renderChecklistTab(trip);
      }
    } catch (err) {
      console.error('전역 클릭 위임 처리 오류:', err);
    }
  });

  // 체크리스트/쇼핑리스트 체크박스 토글 위임
  document.addEventListener('change', (e) => {
    try {
      const target = e.target;
      if (target && target.getAttribute('data-action') === 'toggle-cl-item') {
        const id = target.getAttribute('data-id');
        const trip = getActiveTrip();
        if (!trip) return;
        const targetArr = currentChecklistSubTab === 'shopping' ? trip.shoppingList : trip.packingList;
        const item = (targetArr || []).find((c) => c.id === id);
        if (item) {
          item.checked = target.checked;
          saveLocalData();
          syncTripToFirestore(trip);
          renderChecklistTab(trip);
        }
      }
    } catch (err) {
      console.error('체크리스트 토글 오류:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [B] 공통 상단 헤더 버튼 바인딩
  // --------------------------------------------------------------------------
  $('btnHeaderBackToHome')?.addEventListener('click', exitTripDetailToHome);

  $('btnHeaderCopyInvite')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (!trip) return;
    const shareMsg = `[${trip.title}] 여행에 초대합니다!\n초대 코드: ${trip.inviteCode}`;
    shareOrCopyText(trip.title, shareMsg, `초대 코드 [${trip.inviteCode}]가 복사되었습니다!`);
  });

  $('btnHeaderRefreshRates')?.addEventListener('click', async () => {
    try {
      const label = $('headerRateTimestamp');
      if (label) label.textContent = '환율 갱신 중...';
      const [jpy, usd, eur] = await Promise.all([
        fetchLiveExchangeRate('JPY'),
        fetchLiveExchangeRate('USD'),
        fetchLiveExchangeRate('EUR')
      ]);
      if (label) {
        label.textContent = `JPY ${jpy.rate} · USD ${usd.rate} · EUR ${eur.rate}`;
      }
      alert(
        `최신 원화(KRW) 매매기준율이 반영되었습니다.\n` +
        `• 1 JPY = ${jpy.rate.toFixed(2)} KRW\n` +
        `• 1 USD = ${usd.rate.toLocaleString()} KRW\n` +
        `• 1 EUR = ${eur.rate.toLocaleString()} KRW`
      );
    } catch (err) {
      console.error('환율 갱신 오류:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [C] 홈 화면: 새 여행 만들기 & 초대 코드 참여
  // --------------------------------------------------------------------------
  $('btnOpenNewTripModal')?.addEventListener('click', () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      if ($('inputNewTripTitle')) $('inputNewTripTitle').value = '';
      if ($('inputNewTripDestination')) $('inputNewTripDestination').value = '';
      if ($('inputNewTripStartDate')) $('inputNewTripStartDate').value = today;
      if ($('inputNewTripEndDate')) $('inputNewTripEndDate').value = today;
      if ($('selectNewTripCurrency')) $('selectNewTripCurrency').value = 'KRW';
      if ($('inputNewTripMyBudget')) $('inputNewTripMyBudget').value = '1500000';
      if ($('inputNewTripMembers')) $('inputNewTripMembers').value = '나, 동행1';
      openModalSafe('modalNewTrip');
    } catch (err) {
      console.error('새 여행 모달 열기 예외:', err);
    }
  });

  $('formCreateNewTrip')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const title = ($('inputNewTripTitle')?.value || '').trim() || '나의 여행';
      const destination = ($('inputNewTripDestination')?.value || '').trim() || '여행지';
      const startDate = $('inputNewTripStartDate')?.value || new Date().toISOString().split('T')[0];
      const endDate = $('inputNewTripEndDate')?.value || startDate;
      const baseCurrency = ($('selectNewTripCurrency')?.value || 'KRW').toUpperCase();
      const myBudget = Number($('inputNewTripMyBudget')?.value) || 0;
      const rawMembers = $('inputNewTripMembers')?.value || '나';

      let members = rawMembers.split(',').map((m) => m.trim()).filter(Boolean);
      if (members.length === 0) members = ['나'];

      const newTripId = 'trip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const newTrip = normalizeTrip({
        id: newTripId,
        inviteCode: generateInviteCode(),
        memberIds: [deviceUid],
        title,
        destination,
        startDate,
        endDate,
        baseCurrency,
        members,
        packingList: [
          { id: 'pk_1', text: '여권 및 항공권 e-티켓', checked: false },
          { id: 'pk_2', text: '보조배터리 및 충전 케이블', checked: false }
        ],
        shoppingList: []
      });

      privateBudgets[newTripId] = {
        myBudget,
        myNickname: members[0]
      };

      trips.unshift(newTrip);
      saveLocalData();
      closeModalSafe('modalNewTrip');
      enterTripDetail(newTripId);
      await syncTripToFirestore(newTrip);
    } catch (err) {
      console.error('새 여행 생성 예외:', err);
      alert('여행 생성 중 오류가 발생했습니다.');
    }
  });

  $('formJoinTripByCode')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const code = ($('inputJoinInviteCode')?.value || '').trim().toUpperCase();
      const nickname = ($('inputJoinUserNickname')?.value || '').trim();
      if (!code || !nickname) return;

      const localFound = trips.find((t) => (t.inviteCode || '').toUpperCase() === code);
      if (localFound) {
        if (!localFound.members.includes(nickname)) localFound.members.push(nickname);
        privateBudgets[localFound.id] = {
          myBudget: privateBudgets[localFound.id]?.myBudget || 0,
          myNickname: nickname
        };
        saveLocalData();
        if ($('inputJoinInviteCode')) $('inputJoinInviteCode').value = '';
        if ($('inputJoinUserNickname')) $('inputJoinUserNickname').value = '';
        enterTripDetail(localFound.id);
        return;
      }

      if (!isCloudOnline || !db) {
        alert('유효하지 않은 초대 코드입니다.\n(다른 기기의 여행에 합류하려면 app.js 상단의 firebaseConfig를 설정해주세요.)');
        return;
      }

      const q = query(collection(db, 'trips'), where('inviteCode', '==', code));
      const snap = await getDocs(q);
      if (snap.empty) {
        alert('해당 초대 코드를 가진 여행을 찾을 수 없습니다.');
        return;
      }

      const targetDoc = snap.docs[0];
      const data = targetDoc.data();
      const updatedMembers = Array.from(new Set([...(data.members || []), nickname]));

      await updateDoc(doc(db, 'trips', targetDoc.id), {
        memberIds: arrayUnion(deviceUid),
        members: updatedMembers
      });

      privateBudgets[targetDoc.id] = {
        myBudget: 0,
        myNickname: nickname
      };

      const joinedTrip = normalizeTrip({ id: targetDoc.id, ...data, members: updatedMembers });
      trips = [joinedTrip, ...trips.filter((t) => t.id !== targetDoc.id)];
      saveLocalData();

      if ($('inputJoinInviteCode')) $('inputJoinInviteCode').value = '';
      if ($('inputJoinUserNickname')) $('inputJoinUserNickname').value = '';
      enterTripDetail(targetDoc.id);
    } catch (err) {
      console.error('초대 코드 합류 예외:', err);
      alert('여행 합류 중 오류가 발생했습니다.');
    }
  });

  // --------------------------------------------------------------------------
  // [D] 탭 1: 일정(Itinerary) + AI 맞춤 추천 + 카톡 일정 공유 바인딩
  // --------------------------------------------------------------------------
  $('selectItineraryDay')?.addEventListener('change', () => {
    const trip = getActiveTrip();
    if (trip) renderItineraryTab(trip);
  });

  $('btnOpenAddScheduleModal')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    if (!trip) return;
    editingScheduleId = null;
    populateAllDaySelectors(trip);
    if ($('selectModalScheduleDay')) $('selectModalScheduleDay').value = $('selectItineraryDay')?.value || '1';
    if ($('inputModalScheduleTime')) $('inputModalScheduleTime').value = '10:00';
    if ($('inputModalSchedulePlace')) $('inputModalSchedulePlace').value = '';
    if ($('inputModalScheduleMemo')) $('inputModalScheduleMemo').value = '';
    openModalSafe('modalAddSchedule');
  });

  $('formCreateSchedule')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const day = Number($('selectModalScheduleDay')?.value) || 1;
      const time = $('inputModalScheduleTime')?.value || '10:00';
      const place = ($('inputModalSchedulePlace')?.value || '').trim();
      const memo = ($('inputModalScheduleMemo')?.value || '').trim();
      if (!place) return;

      if (!Array.isArray(trip.itineraries)) trip.itineraries = [];

      if (editingScheduleId) {
        const idx = trip.itineraries.findIndex((s) => s.id === editingScheduleId);
        if (idx !== -1) {
          trip.itineraries[idx] = { ...trip.itineraries[idx], day, time, place, memo };
        }
        editingScheduleId = null;
      } else {
        trip.itineraries.push({
          id: 'it_' + Date.now(),
          day,
          time,
          place,
          memo
        });
      }

      if ($('selectItineraryDay')) $('selectItineraryDay').value = String(day);
      saveLocalData();
      closeModalSafe('modalAddSchedule');
      renderItineraryTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('일정 저장 예외:', err);
    }
  });

  // AI 맞춤 추천 패널 및 공유 버튼 이벤트 위임
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#btnOpenAiPlannerPanel')) {
      $('aiPlannerBox')?.classList.toggle('hidden');
      return;
    }
    if (e.target.closest('#btnCloseAiPlannerBox')) {
      $('aiPlannerBox')?.classList.add('hidden');
      return;
    }
    if (e.target.closest('#btnGenerateAiSchedule')) {
      const trip = getActiveTrip();
      if (!trip) return;
      const concept = ($('inputAiConcept')?.value || '').trim() || '현지 대표 명소 및 미식 탐방';
      const budgetMan = Number($('inputAiTargetBudget')?.value) || 100;
      const totalDays = calculateTripDays(trip);

      // 기존 확정된 예약 및 일정을 분석해 빈 시간대 맞춤 일정 생성
      const suggestions = [];
      for (let d = 1; d <= totalDays; d++) {
        const existingTimes = new Set(
          (trip.itineraries || []).filter((s) => Number(s.day) === d).map((s) => s.time)
        );
        if (!existingTimes.has('10:30')) {
          suggestions.push({
            day: d,
            time: '10:30',
            place: `${trip.destination} 핵심 명소 산책 (Day ${d})`,
            memo: `컨셉: ${concept} · 오전 여유 동선`
          });
        }
        if (!existingTimes.has('12:30')) {
          suggestions.push({
            day: d,
            time: '12:30',
            place: `${trip.destination} 현지 로컬 맛집 런치`,
            memo: `예산 약 ${Math.round(budgetMan / totalDays)}만원/일 배분 추천`
          });
        }
        if (!existingTimes.has('15:30')) {
          suggestions.push({
            day: d,
            time: '15:30',
            place: `${trip.destination} 감성 카페 & 전망 스폿`,
            memo: `${concept} 테마 추천 코스`
          });
        }
      }

      aiGeneratedSuggestions = suggestions;
      const listEl = $('aiSuggestionItemsList');
      if (listEl) {
        listEl.innerHTML = suggestions
          .map(
            (s) =>
              `<div class="bg-white px-2.5 py-1.5 rounded-lg border border-indigo-100">
                <strong>[Day ${s.day} ${s.time}]</strong> ${escapeHtml(s.place)}
                <span class="block text-[10px] text-slate-400">${escapeHtml(s.memo)}</span>
              </div>`
          )
          .join('');
      }
      $('aiSuggestionResultArea')?.classList.remove('hidden');
      return;
    }
    if (e.target.closest('#btnApplyAllAiSchedules')) {
      const trip = getActiveTrip();
      if (!trip || aiGeneratedSuggestions.length === 0) return;

      aiGeneratedSuggestions.forEach((s, idx) => {
        trip.itineraries.push({
          id: 'it_ai_' + Date.now() + '_' + idx,
          day: s.day,
          time: s.time,
          place: s.place,
          memo: s.memo
        });
      });

      const addedCount = aiGeneratedSuggestions.length;
      aiGeneratedSuggestions = [];
      $('aiSuggestionResultArea')?.classList.add('hidden');
      $('aiPlannerBox')?.classList.add('hidden');

      saveLocalData();
      renderItineraryTab(trip);
      await syncTripToFirestore(trip);
      alert(`AI 맞춤 추천 일정 ${addedCount}건이 내 일정표에 한 번에 추가되었습니다!`);
      return;
    }
    if (e.target.closest('#btnShareItineraryText')) {
      const trip = getActiveTrip();
      if (!trip) return;
      const selectedDay = Number($('selectItineraryDay')?.value) || 1;
      const dateStr = getDateForTripDay(trip, selectedDay);
      const dayItems = (trip.itineraries || [])
        .filter((s) => Number(s.day) === selectedDay)
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

      const lines = [
        `✈️ [${trip.title}] Day ${selectedDay} 일정 (${dateStr})`,
        `━━━━━━━━━━━━━━━━━━`,
        ...(dayItems.length === 0
          ? ['• 등록된 일정이 없습니다.']
          : dayItems.map((s) => `⏰ ${s.time} | ${s.place}${s.memo ? `\n   └ ${s.memo}` : ''}`))
      ];
      shareOrCopyText(`${trip.title} 일정`, lines.join('\n'), '일정 요약 텍스트가 복사되었습니다!');
      return;
    }
    if (e.target.closest('#btnShareSettlementSummary')) {
      const trip = getActiveTrip();
      if (!trip) return;
      const summaryText = $('settlementTransfersContainer')?.innerText || '';
      const totalText = $('groupTotalExpenseKrw')?.textContent || '';
      const text = [
        `💸 [${trip.title}] 1/N 정산 안내`,
        `━━━━━━━━━━━━━━━━━━`,
        `• ${totalText}`,
        summaryText.replace('정산 내역 카톡 공유 💸', '').trim()
      ].join('\n');
      shareOrCopyText(`${trip.title} 정산`, text, '1/N 정산 요약이 클립보드에 복사되었습니다!');
    }
  });

  // --------------------------------------------------------------------------
  // [E] 탭 2: 예약(Bookings) - 편명 자동조회 + 3중 자동 연동 바인딩
  // --------------------------------------------------------------------------
  $('btnOpenAddBookingModal')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      editingBookingId = null;

      const priv = getMyPrivateInfo(trip);
      const members = trip.members || [priv.myNickname];

      if ($('selectBookingCategory')) $('selectBookingCategory').value = '항공';
      if ($('inputBookingDate')) $('inputBookingDate').value = trip.startDate || '';
      if ($('inputBookingTitle')) $('inputBookingTitle').value = '';
      if ($('inputBookingFlightLookupCode')) $('inputBookingFlightLookupCode').value = '';
      if ($('inputBookingTime')) $('inputBookingTime').value = '10:00';
      if ($('inputBookingCode')) $('inputBookingCode').value = '';
      if ($('inputBookingMemo')) $('inputBookingMemo').value = '';
      if ($('selectBookingCurrency')) $('selectBookingCurrency').value = trip.baseCurrency || 'KRW';
      if ($('inputBookingAmount')) $('inputBookingAmount').value = '';
      if ($('chkBookingAutoSync')) $('chkBookingAutoSync').checked = true;

      if ($('selectBookingPayer')) {
        $('selectBookingPayer').innerHTML = members
          .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
          .join('');
        $('selectBookingPayer').value = priv.myNickname;
      }
      if ($('bookingParticipantsGroup')) {
        $('bookingParticipantsGroup').innerHTML = members
          .map(
            (m) => `
            <label class="inline-flex items-center gap-1 text-xs bg-white border border-slate-200 px-2 py-1 rounded-lg">
              <input type="checkbox" value="${escapeHtml(m)}" checked class="bk-part-chk" />
              <span>${escapeHtml(m)}</span>
            </label>
          `
          )
          .join('');
      }

      openModalSafe('modalAddBooking');
    } catch (err) {
      console.error('예약 모달 열기 예외:', err);
    }
  });

  // [편명 자동조회] 버튼 클릭 시 Firestore flightCache/{편명} 우선 조회 후 API 호출
  document.addEventListener('click', async (e) => {
    const lookupBtn = e.target.closest('#btnLookupBookingFlight');
    if (!lookupBtn) return;

    try {
      const codeInput = $('inputBookingFlightLookupCode');
      const code = (codeInput?.value || '').replace(/\s+/g, '').toUpperCase();
      if (!code) {
        alert('조회할 항공편명을 입력해주세요. (예: RS471, KE703)');
        return;
      }

      lookupBtn.disabled = true;
      lookupBtn.textContent = '조회 중...';

      const info = await lookupFlightWithSharedCache(code);
      if (info) {
        const routePart = info.dep && info.arr ? ` (${info.dep} ➔ ${info.arr})` : '';
        if ($('inputBookingTitle')) {
          $('inputBookingTitle').value = `${info.airline} ${info.flightNo}${routePart}`.trim();
        }
        if (info.depTime && $('inputBookingTime')) {
          $('inputBookingTime').value = info.depTime;
        }
        if (info.memo && $('inputBookingMemo') && !$('inputBookingMemo').value.trim()) {
          $('inputBookingMemo').value = info.memo;
        }
        alert(
          `[${info.airline} ${info.flightNo}] 정보가 입력되었습니다. (${info.fromCache ? '공용 캐시' : '실시간 조회'})`
        );
      } else {
        alert('일치하는 항공편 정보를 찾지 못했습니다. 직접 입력해주세요.');
      }
    } catch (err) {
      console.error('편명 자동조회 오류:', err);
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = '편명 자동조회 ✈️';
    }
  });

  $('formCreateBooking')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const priv = getMyPrivateInfo(trip);
      const bookingId = editingBookingId || 'bk_' + Date.now();
      const category = $('selectBookingCategory')?.value || '항공';
      const date = $('inputBookingDate')?.value || trip.startDate || '';
      const title = ($('inputBookingTitle')?.value || '').trim();
      const time = $('inputBookingTime')?.value || '10:00';
      const code = ($('inputBookingCode')?.value || '').trim().toUpperCase();
      const memo = ($('inputBookingMemo')?.value || '').trim();

      const currency = ($('selectBookingCurrency')?.value || 'KRW').toUpperCase();
      const amount = Number($('inputBookingAmount')?.value) || 0;
      const payer = ($('selectBookingPayer')?.value || priv.myNickname).trim();
      const checkedParts = document.querySelectorAll('.bk-part-chk:checked');
      const participants = Array.from(checkedParts).map((cb) => cb.value.trim()).filter(Boolean);
      const autoSync = Boolean($('chkBookingAutoSync')?.checked);

      if (!title) return;

      const bookingObj = {
        id: bookingId,
        category,
        date,
        title,
        time,
        code,
        memo,
        currency,
        amount,
        payer,
        participants: participants.length > 0 ? participants : [payer],
        autoSync
      };

      if (!Array.isArray(trip.bookings)) trip.bookings = [];
      if (editingBookingId) {
        const idx = trip.bookings.findIndex((b) => b.id === editingBookingId);
        if (idx !== -1) trip.bookings[idx] = bookingObj;
      } else {
        trip.bookings.push(bookingObj);
      }

      // 3중 자동 연동: 동일 bookingId를 가진 일정 & 지출 항목 생성/수정/삭제
      trip.itineraries = (trip.itineraries || []).filter((s) => s.bookingId !== bookingId);
      trip.expenses = (trip.expenses || []).filter((ex) => ex.bookingId !== bookingId);

      if (autoSync) {
        const dayNum = inferDayNumberFromDate(trip, date);
        const schedMemo = [code ? `예약번호: ${code}` : '', memo].filter(Boolean).join(' / ');

        trip.itineraries.push({
          id: 'it_bk_' + Date.now(),
          bookingId,
          day: dayNum,
          time,
          place: `[${category}] ${title}`,
          memo: schedMemo
        });

        if (amount > 0) {
          const fx = await fetchLiveExchangeRate(currency);
          trip.expenses.push({
            id: 'ex_bk_' + Date.now(),
            bookingId,
            title: `[${category}] ${title}`,
            currency,
            amount,
            rateToKrw: fx.rate,
            payer,
            participants: participants.length > 0 ? participants : [payer],
            createdAt: new Date().toISOString()
          });
        }
      }

      editingBookingId = null;
      saveLocalData();
      closeModalSafe('modalAddBooking');
      renderDetailView();
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('예약 저장 예외:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [F] 탭 3: 지출/정산(Expenses) - 환율 조회, 원화 환산 미리보기, 수정/저장
  // --------------------------------------------------------------------------
  $('btnTogglePrivateBudgetForm')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    const form = $('formUpdatePrivateBudget');
    if (!trip || !form) return;
    const priv = getMyPrivateInfo(trip);
    if ($('inputPrivateBudgetValue')) $('inputPrivateBudgetValue').value = String(priv.myBudget);
    form.classList.toggle('hidden');
  });

  $('formUpdatePrivateBudget')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const trip = getActiveTrip();
    if (!trip) return;
    const val = Number($('inputPrivateBudgetValue')?.value) || 0;
    const prev = getMyPrivateInfo(trip);
    privateBudgets[trip.id] = {
      myBudget: val,
      myNickname: prev.myNickname
    };
    saveLocalData();
    $('formUpdatePrivateBudget')?.classList.add('hidden');
    renderExpensesTab(trip);
  });

  $('btnOpenAddExpenseModal')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      editingExpenseId = null;

      const priv = getMyPrivateInfo(trip);
      const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : [priv.myNickname];

      if ($('inputExpTitle')) $('inputExpTitle').value = '';
      if ($('selectExpCurrency')) $('selectExpCurrency').value = 'KRW';
      if ($('inputExpAmount')) $('inputExpAmount').value = '';
      if ($('inputExpAppliedRate')) $('inputExpAppliedRate').value = '1';
      if ($('expRateSourceText')) $('expRateSourceText').textContent = '적용 환율 (1 KRW = 1 KRW)';
      if ($('expRateUnitPrefix')) $('expRateUnitPrefix').textContent = '1 KRW =';
      if ($('expConvertedKrwPreview')) $('expConvertedKrwPreview').textContent = '0 KRW';

      const payerSel = $('selectExpPayer');
      if (payerSel) {
        payerSel.innerHTML = members
          .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
          .join('');
        if (members.includes(priv.myNickname)) {
          payerSel.value = priv.myNickname;
        }
      }

      const groupEl = $('expParticipantsCheckboxGroup');
      if (groupEl) {
        groupEl.innerHTML = members
          .map(
            (m) => `
            <label class="flex items-center gap-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer">
              <input type="checkbox" value="${escapeHtml(m)}" checked class="exp-participant-chk w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
              <span>${escapeHtml(m)}</span>
            </label>
          `
          )
          .join('');
      }

      openModalSafe('modalAddExpense');
    } catch (err) {
      console.error('지출 모달 열기 예외:', err);
    }
  });

  $('selectExpCurrency')?.addEventListener('change', syncExpenseModalRateFromApi);
  $('btnFetchLatestExchangeRate')?.addEventListener('click', syncExpenseModalRateFromApi);
  $('inputExpAmount')?.addEventListener('input', updateExpenseModalRatePreview);
  $('inputExpAppliedRate')?.addEventListener('input', updateExpenseModalRatePreview);

  $('formCreateExpense')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const title = ($('inputExpTitle')?.value || '').trim();
      const currency = ($('selectExpCurrency')?.value || 'KRW').toUpperCase();
      const amount = Number($('inputExpAmount')?.value) || 0;
      const rateToKrw = currency === 'KRW' ? 1 : Number($('inputExpAppliedRate')?.value) || 1;
      const payer = ($('selectExpPayer')?.value || '').trim();

      const checkedBoxes = document.querySelectorAll('.exp-participant-chk:checked');
      const participants = Array.from(checkedBoxes).map((cb) => cb.value.trim()).filter(Boolean);

      if (!title || amount <= 0) {
        alert('지출 항목명과 금액을 올바르게 입력해주세요.');
        return;
      }
      if (participants.length === 0) {
        alert('분담 인원을 최소 1명 이상 선택해주세요.');
        return;
      }

      if (!Array.isArray(trip.expenses)) trip.expenses = [];

      if (editingExpenseId) {
        const idx = trip.expenses.findIndex((ex) => ex.id === editingExpenseId);
        if (idx !== -1) {
          trip.expenses[idx] = {
            ...trip.expenses[idx],
            title,
            currency,
            amount,
            rateToKrw,
            payer,
            participants
          };
        }
        editingExpenseId = null;
      } else {
        trip.expenses.push({
          id: 'ex_' + Date.now(),
          title,
          currency,
          amount,
          rateToKrw,
          payer,
          participants,
          createdAt: new Date().toISOString()
        });
      }

      saveLocalData();
      closeModalSafe('modalAddExpense');
      renderExpensesTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('지출 저장 예외:', err);
      alert('지출 내역 저장 중 오류가 발생했습니다.');
    }
  });

  // --------------------------------------------------------------------------
  // [G] 탭 4: 사진(Photos) - Canvas 최대 가로 800px, JPEG 0.7 압축 + 정보 수정
  // --------------------------------------------------------------------------
  $('selectPhotoDayFilter')?.addEventListener('change', () => {
    const trip = getActiveTrip();
    if (trip) renderPhotosTab(trip);
  });

  $('btnOpenAddPhotoModal')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      populateAllDaySelectors(trip);
      if ($('inputPhotoFile')) $('inputPhotoFile').value = '';
      $('photoPreviewWrapper')?.classList.add('hidden');
      if ($('imgPhotoUploadPreview')) $('imgPhotoUploadPreview').src = '';
      if ($('selectPhotoCategory')) $('selectPhotoCategory').value = '관광지';
      if ($('inputPhotoDate')) $('inputPhotoDate').value = trip.startDate || new Date().toISOString().split('T')[0];
      if ($('inputPhotoPlace')) $('inputPhotoPlace').value = '';
      if ($('inputPhotoMemo')) $('inputPhotoMemo').value = '';
      openModalSafe('modalAddPhoto');
    } catch (err) {
      console.error('사진 추가 모달 열기 예외:', err);
    }
  });

  $('inputPhotoFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const previewUrl = await compressImageToBase64(file, 800, 0.7);
      if ($('imgPhotoUploadPreview')) $('imgPhotoUploadPreview').src = previewUrl;
      $('photoPreviewWrapper')?.classList.remove('hidden');
    } catch (err) {
      console.error('이미지 미리보기 오류:', err);
    }
  });

  $('formCreatePhoto')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const file = $('inputPhotoFile')?.files?.[0];
      if (!file) {
        alert('업로드할 사진 파일을 선택해주세요.');
        return;
      }

      const submitBtn = $('btnSubmitCreatePhoto');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '압축 및 저장 중...';
      }

      const compressedBase64 = await compressImageToBase64(file, 800, 0.7);
      const category = $('selectPhotoCategory')?.value || '기타';
      const day = Number($('selectPhotoDay')?.value) || 1;
      const date = $('inputPhotoDate')?.value || '';
      const place = ($('inputPhotoPlace')?.value || '').trim() || '여행 스냅';
      const memo = ($('inputPhotoMemo')?.value || '').trim();

      if (!Array.isArray(trip.photos)) trip.photos = [];
      trip.photos.push({
        id: 'ph_' + Date.now(),
        category,
        day,
        date,
        place,
        memo,
        dataUrl: compressedBase64,
        createdAt: new Date().toISOString()
      });

      saveLocalData();
      closeModalSafe('modalAddPhoto');
      renderPhotosTab(trip);
      await syncTripToFirestore(trip);

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '사진 저장';
      }
    } catch (err) {
      console.error('사진 저장 예외:', err);
      alert('사진 처리 중 오류가 발생했습니다.');
      const submitBtn = $('btnSubmitCreatePhoto');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '사진 저장';
      }
    }
  });

  document.addEventListener('click', async (e) => {
    if (e.target.closest('#btnEditViewingPhoto')) {
      const trip = getActiveTrip();
      const photo = trip?.photos?.find((p) => p.id === viewingPhotoId);
      if (!photo) return;
      const newPlace = prompt('장소명을 수정하세요:', photo.place || '');
      if (newPlace !== null && newPlace.trim() !== '') {
        photo.place = newPlace.trim();
      }
      const newMemo = prompt('메모를 수정하세요:', photo.memo || '');
      if (newMemo !== null) {
        photo.memo = newMemo.trim();
      }
      if ($('viewPhotoPlaceTitle')) $('viewPhotoPlaceTitle').textContent = photo.place;
      if ($('viewPhotoMemoText')) $('viewPhotoMemoText').textContent = photo.memo || '등록된 메모가 없습니다.';
      saveLocalData();
      renderPhotosTab(trip);
      await syncTripToFirestore(trip);
    }
  });

  $('btnDeleteViewingPhoto')?.addEventListener('click', async () => {
    const trip = getActiveTrip();
    if (!trip || !viewingPhotoId) return;
    if (confirm('이 사진을 삭제하시겠습니까?')) {
      trip.photos = (trip.photos || []).filter((p) => p.id !== viewingPhotoId);
      viewingPhotoId = null;
      saveLocalData();
      closeModalSafe('modalViewPhoto');
      renderPhotosTab(trip);
      await syncTripToFirestore(trip);
    }
  });

  // --------------------------------------------------------------------------
  // [H] 탭 5: 리뷰(Reviews) - 예약 불러오기 + 여행 사진 불러오기 + 통합 아카이브(allReviews)
  // --------------------------------------------------------------------------
  $('btnOpenAddReviewModal')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      editingReviewId = null;
      editingReviewTripId = trip.id;
      currentReviewPriceMemo = '';
      selectedReviewPhotoIds = [];

      populateAllDaySelectors(trip);

      // 예약 내역 불러오기 드롭다운 채우기
      const bkSelect = $('selectReviewFromBooking');
      if (bkSelect) {
        bkSelect.innerHTML = '<option value="">직접 입력 (또는 예약 내역 선택)</option>';
        (trip.bookings || []).forEach((b) => {
          const opt = document.createElement('option');
          opt.value = b.id;
          const costStr = Number(b.amount) > 0 ? ` · ${Number(b.amount).toLocaleString()} ${b.currency}` : '';
          opt.textContent = `[${b.category}] ${b.title}${costStr}`;
          bkSelect.appendChild(opt);
        });
      }

      if ($('inputReviewPlaceName')) $('inputReviewPlaceName').value = '';
      if ($('selectReviewCategory')) $('selectReviewCategory').value = '맛집/카페';
      if ($('selectReviewDay')) $('selectReviewDay').value = '1';
      setReviewStarRating(5);
      if ($('chkReviewRevisit')) $('chkReviewRevisit').checked = true;
      if ($('inputReviewContent')) $('inputReviewContent').value = '';

      renderReviewPhotoThumbnails(trip);
      openModalSafe('modalAddReview');
    } catch (err) {
      console.error('리뷰 모달 열기 예외:', err);
    }
  });

  // 예약 내역 선택 시 장소명·카테고리·가격 자동 입력
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'selectReviewFromBooking') {
      const bkId = e.target.value;
      const trip = getActiveTrip();
      if (!trip || !bkId) return;
      const bk = (trip.bookings || []).find((b) => b.id === bkId);
      if (!bk) return;

      if ($('inputReviewPlaceName')) $('inputReviewPlaceName').value = bk.title || '';
      if ($('selectReviewCategory')) {
        $('selectReviewCategory').value = bk.category === '숙소' ? '숙소' : '관광지';
      }
      if (bk.date && $('selectReviewDay')) {
        $('selectReviewDay').value = String(inferDayNumberFromDate(trip, bk.date));
      }
      if (Number(bk.amount) > 0) {
        currentReviewPriceMemo = `${Number(bk.amount).toLocaleString()} ${bk.currency || 'KRW'}`;
      }
      if (bk.memo && $('inputReviewContent') && !$('inputReviewContent').value.trim()) {
        $('inputReviewContent').value = bk.memo;
      }
    }
  });

  $('formCreateReview')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const targetTrip = trips.find((t) => t.id === (editingReviewTripId || currentTripId));
      if (!targetTrip) return;

      const priv = getMyPrivateInfo(targetTrip);
      const place = ($('inputReviewPlaceName')?.value || '').trim();
      const category = $('selectReviewCategory')?.value || '맛집/카페';
      const day = Number($('selectReviewDay')?.value) || 1;
      const rating = Number($('inputReviewRatingValue')?.value) || 5;
      const revisit = Boolean($('chkReviewRevisit')?.checked);
      const content = ($('inputReviewContent')?.value || '').trim();

      if (!place || !content) return;
      if (!Array.isArray(targetTrip.reviews)) targetTrip.reviews = [];

      const reviewId = editingReviewId || 'rv_' + Date.now();
      const reviewRecord = {
        id: reviewId,
        tripId: targetTrip.id,
        tripTitle: targetTrip.title,
        place,
        category,
        day,
        rating,
        revisit,
        priceMemo: currentReviewPriceMemo,
        content,
        photoIds: [...selectedReviewPhotoIds],
        author: priv.myNickname,
        createdAt: new Date().toISOString()
      };

      if (editingReviewId) {
        const idx = targetTrip.reviews.findIndex((r) => r.id === editingReviewId);
        if (idx !== -1) targetTrip.reviews[idx] = reviewRecord;
      } else {
        targetTrip.reviews.push(reviewRecord);
      }

      editingReviewId = null;
      editingReviewTripId = null;
      saveLocalData();
      closeModalSafe('modalAddReview');

      if (currentTripId === targetTrip.id) {
        renderReviewsTab(targetTrip);
      } else {
        renderHomeArchiveReviews();
      }

      await syncTripToFirestore(targetTrip);
      await syncReviewToGlobalCollection(reviewRecord);
    } catch (err) {
      console.error('리뷰 저장 예외:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [I] 탭 6: 체크리스트 / 쇼핑리스트 / JSON 백업·복원 / 인쇄·PDF 저장
  // --------------------------------------------------------------------------
  $('formAddChecklistItem')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      const text = ($('inputNewChecklistText')?.value || '').trim();
      if (!text) return;

      if (currentChecklistSubTab === 'shopping') {
        const expectedPrice = Number($('inputShoppingExpectedPrice')?.value) || 0;
        if (!Array.isArray(trip.shoppingList)) trip.shoppingList = [];
        trip.shoppingList.unshift({
          id: 'sh_' + Date.now(),
          text,
          expectedPrice,
          checked: false
        });
        if ($('inputShoppingExpectedPrice')) $('inputShoppingExpectedPrice').value = '';
      } else {
        if (!Array.isArray(trip.packingList)) trip.packingList = [];
        trip.packingList.unshift({
          id: 'pk_' + Date.now(),
          text,
          checked: false
        });
      }

      if ($('inputNewChecklistText')) $('inputNewChecklistText').value = '';
      saveLocalData();
      renderChecklistTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('체크리스트/쇼핑리스트 추가 예외:', err);
    }
  });

  $('btnExportJsonData')?.addEventListener('click', () => {
    try {
      const exportObj = {
        app: 'Travel Journal',
        version: 4,
        exportedAt: new Date().toISOString(),
        trips,
        allReviews,
        privateBudgets
      };
      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `travel-journal-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('JSON 백업 내보내기 중 오류가 발생했습니다.');
    }
  });

  $('btnImportJsonTrigger')?.addEventListener('click', () => {
    $('inputImportJsonFile')?.click();
  });

  $('inputImportJsonFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed && Array.isArray(parsed.trips)) {
          trips = parsed.trips.map(normalizeTrip).filter(Boolean);
          if (Array.isArray(parsed.allReviews)) allReviews = parsed.allReviews;
          if (parsed.privateBudgets && typeof parsed.privateBudgets === 'object') {
            
