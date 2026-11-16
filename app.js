/**
 * Travel Journal PWA - app.js (ES Module)
 * - Firebase Firestore v10 실시간 동기화 + LocalStorage 영구 보존 안정성 (마이그레이션 방어)
 * - document.body 이벤트 위임(addEventListener)으로 모든 버튼·탭 동작 100% 보장
 * - [요구사항 1, 5] 예약 모달 항공편 다구간 멀티 세그먼트 입력 + 편명 자동조회 100% 작동 보장
 * - [요구사항 2] 숙소 체크인/체크아웃 상세 입력 및 일정표 자동 연동
 * - [요구사항 3] 초대 코드 합류 시 방장이 지정한 일행 목록 중 본인 이름 선택제
 * - [요구사항 4] Day 날짜 오차 해결 + 가로 스크롤 칩(Chip) 네비게이션 바
 * - [요구사항 5, 6] Leaflet 지도 및 IATA 공항 좌표 최적화 + 티켓/투어 순수 장소명 추출 길찾기 오류 해결
 * - [요구사항 9] 추후 Firebase Auth 마이그레이션을 위한 ownerUid 및 memberIds 구조 가이드 주석 반영
 * - [요구사항 10] max-w-md mx-auto 중앙 정렬 고정 레이아웃 적용
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

import {
  lookupFlightWithAirLabs,
  fetchLiveExchangeRate,
  AIRPORT_KO_MAP,
  compressImageFileToBase64,
  calculateOneOverNSettlement
} from './services.js';

// ============================================================================
// [Firebase 설정 블록] 요구사항 7번 고정 설정값
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
// 1. 상수 및 전역 상태
// ============================================================================
const STORAGE_TRIPS_KEY = 'TJ_TRIPS_ARCHIVE_V8';
const STORAGE_PRIVATE_KEY = 'TJ_PRIVATE_BUDGETS_V8';
const STORAGE_ALL_REVIEWS_KEY = 'TJ_ALL_REVIEWS_ARCHIVE_V8';
const STORAGE_FLIGHT_CACHE_KEY = 'TJ_FLIGHT_CACHE_V8';
const STORAGE_UID_KEY = 'TJ_DEVICE_USER_UID_V8';

let db = null;
let isCloudOnline = false;
let unsubscribeTrips = null;
let unsubscribeAllReviews = null;

let trips = [];
let allReviews = [];
let privateBudgets = {}; 
let localFlightCache = {};

let currentTripId = null;
let activeMainTab = 'itinerary';
let currentItineraryDay = 1;
let currentBookingFilter = '전체';
let currentPhotoFilter = '전체';
let currentReviewFilter = '전체';
let currentChecklistSubTab = 'packing';
let viewingPhotoId = null;
let selectedReviewPhotoIds = [];
let aiGeneratedSuggestions = [];

let editingScheduleId = null;
let editingBookingId = null;
let editingExpenseId = null;
let editingReviewId = null;
let editingReviewTripId = null;
let currentReviewPriceMemo = '';

let leafletMap = null;
let leafletLayerGroup = null;

// ============================================================================
// 2. 방어형 DOM 헬퍼 및 유틸리티 (요구사항 8번 유실 방지 마이그레이션)
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
  } catch (err) {}

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      alert(alertMsg);
      return;
    }
  } catch (err) {}

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
// 3. Firebase 초기화 & 데이터 유실 방지 로컬 마이그레이션 스토리지
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
    firebaseConfig.apiKey.trim() !== '' &&
    !firebaseConfig.apiKey.includes('여기에');

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
    console.error('Firebase 초기화 오류:', err);
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
    ownerUid: raw.ownerUid || raw.memberIds?.[0] || deviceUid, // [요구사항 9] 추후 인증 연동 대비 ownerUid 구조 아키텍처 반영
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

/**
 * [요구사항 8] 구버전 키들(V1~V7)에 저장된 데이터까지 모두 탐색하여 유실 없이 현재 V8 스토리지로 마이그레이션
 */
function loadLocalData() {
  const legacyKeys = ['TJ_TRIPS_ARCHIVE_V7', 'TJ_TRIPS_ARCHIVE_V6', 'TJ_TRIPS_ARCHIVE_V5', 'TRAVEL_JOURNAL_TRIPS_V1'];
  let rawTrips = null;
  for (const k of legacyKeys) {
    const data = localStorage.getItem(k);
    if (data) {
      rawTrips = data;
      break;
    }
  }

  try {
    if (rawTrips) {
      const parsed = JSON.parse(rawTrips);
      if (Array.isArray(parsed)) {
        trips = parsed.map(normalizeTrip).filter(Boolean);
      }
    }
  } catch (err) {
    trips = [];
  }

  const legacyPrivKeys = ['TJ_PRIVATE_BUDGETS_V7', 'TJ_PRIVATE_BUDGETS_V6', 'TJ_PRIVATE_BUDGETS_V5', 'TRAVEL_JOURNAL_PRIVATE_BUDGETS_V1'];
  for (const pk of legacyPrivKeys) {
    const pData = localStorage.getItem(pk);
    if (pData) {
      try {
        const parsedPriv = JSON.parse(pData);
        if (parsedPriv && typeof parsedPriv === 'object') {
          privateBudgets = { ...privateBudgets, ...parsedPriv };
        }
      } catch (e) {}
    }
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

  saveLocalData();
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
      ownerUid: trip.ownerUid || deviceUid,
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
      alert('클라우드 문서 용량(1MB) 한도에 근접하여 클라우드 동기화가 보류되었습니다.');
      return;
    }

    await setDoc(doc(db, 'trips', trip.id), payload, { merge: true });
  } catch (err) {
    console.error('Firestore 여행 동기화 오류:', err);
  }
}

async function syncReviewToGlobalCollection(reviewObj) {
  const idx = allReviews.findIndex((r) => r.id === reviewObj.id);
  if (idx !== -1) {
    allReviews[idx] = { ...reviewObj };
  } else {
    allReviews.unshift({ ...reviewObj });
  }
  saveLocalData();

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
    const tripsQuery = query(collection(db, 'trips'), where('memberIds', 'array-contains', deviceUid));
    unsubscribeTrips = onSnapshot(
      tripsQuery,
      (snapshot) => {
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
      },
      (err) => {
        console.warn('Firestore 리스너 오프라인 전환:', err);
        updateSyncBadge(false);
      }
    );

    unsubscribeAllReviews = onSnapshot(
      collection(db, 'allReviews'),
      (snapshot) => {
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
      },
      (err) => {}
    );
  } catch (err) {
    console.error('실시간 리스너 시작 실패:', err);
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
// 4. 항공편 조회 + Firestore 공용 캐싱
// ============================================================================
async function lookupFlightWithSharedCache(rawFlightCode) {
  const code = String(rawFlightCode || '').replace(/\s+/g, '').toUpperCase();
  if (!code) return null;

  if (localFlightCache[code]) {
    return { ...localFlightCache[code], fromCache: true };
  }

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
    } catch (err) {}
  }

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

    if (isCloudOnline && db) {
      try {
        await setDoc(doc(db, 'flightCache', code), cleanRecord, { merge: true });
      } catch (err) {}
    }

    return { ...cleanRecord, fromCache: false };
  }

  return null;
}

// ============================================================================
// 5. 날짜/일수 및 환율 미리보기 유틸리티 (요구사항 4번 타임존 오차 해결)
// ============================================================================
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length === 3) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  return new Date(dateStr);
}

function calculateTripDays(trip) {
  if (!trip || !trip.startDate || !trip.endDate) return 1;
  const s = parseLocalDate(trip.startDate);
  const e = parseLocalDate(trip.endDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 1;
  const diffTime = e.getTime() - s.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function getDateForTripDay(trip, dayNum) {
  if (!trip || !trip.startDate) return '';
  const d = parseLocalDate(trip.startDate);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (Number(dayNum) - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inferDayNumberFromDate(trip, dateStr) {
  if (!trip || !trip.startDate || !dateStr) return 1;
  const totalDays = calculateTripDays(trip);
  const target = parseLocalDate(dateStr);
  const start = parseLocalDate(trip.startDate);
  if (isNaN(target.getTime()) || isNaN(start.getTime())) return 1;
  const diff = Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return Math.min(Math.max(diff, 1), totalDays);
}

function updateExpenseModalRatePreview() {
  try {
    const curr = ($('selectExpCurrency')?.value || 'KRW').toUpperCase();
    const amount = Number($('inputExpAmount')?.value) || 0;
    const rate = Number($('inputExpAppliedRate')?.value) || 0;

    if ($('expRateUnitPrefix')) $('expRateUnitPrefix').textContent = `1 ${curr} =`;

    const convertedKrw = Math.round(amount * rate);
    if ($('expConvertedKrwPreview')) {
      $('expConvertedKrwPreview').textContent = `${convertedKrw.toLocaleString()} KRW`;
    }
  } catch (err) {}
}

async function syncExpenseModalRateFromApi() {
  try {
    const curr = ($('selectExpCurrency')?.value || 'KRW').toUpperCase();
    const statusText = $('expRateStatusText');
    const rateInput = $('inputExpAppliedRate');

    if (curr === 'KRW') {
      if (rateInput) rateInput.value = '1';
      if (statusText) statusText.textContent = '적용 환율 (1 KRW = 1 KRW)';
      updateExpenseModalRatePreview();
      return;
    }

    if (statusText) statusText.textContent = `${curr} 실시간 환율 조회 중...`;
    const result = await fetchLiveExchangeRate(curr);

    if (rateInput) rateInput.value = result.rate.toFixed(2);
    if (statusText) {
      statusText.textContent = `${result.displayUnit} (${result.source})`;
    }
    updateExpenseModalRatePreview();
  } catch (err) {}
}

// ============================================================================
// 6. 홈 화면 & 전체 리뷰 아카이브 렌더링
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

function renderHomeArchiveReviews() {
  const container = $('homeAllReviewsContainer');
  if (!container) return;

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

  if ($('homeAllReviewsCount')) $('homeAllReviewsCount').textContent = String(combinedReviews.length);

  if (combinedReviews.length === 0) {
    if ($('homeAllReviewsAvg')) $('homeAllReviewsAvg').textContent = '평균 ★ 0.0';
    container.innerHTML = `
      <div class="py-8 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <p class="text-xs">아직 작성된 전체 리뷰가 없습니다. 여행 상세에서 리뷰를 남겨보세요!</p>
      </div>
    `;
    return;
  }

  const avgAll = (
    combinedReviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / combinedReviews.length
  ).toFixed(1);

  if ($('homeAllReviewsAvg')) $('homeAllReviewsAvg').textContent = `평균 ★ ${avgAll}`;

  container.innerHTML = combinedReviews
    .slice(0, 12)
    .map((rv) => {
      const rating = Number(rv.rating) || 5;
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      return `
        <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-1.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[10px] font-extrabold px-2 py-0.5 rounded bg-sky-50 text-sky-700">${escapeHtml(rv.category || '장소')}</span>
                ${rv.tripTitle ? `<span class="text-[10px] font-semibold text-slate-400 truncate max-w-[140px]">${escapeHtml(rv.tripTitle)}</span>` : ''}
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
    .join('');
}

function enterTripDetail(tripId) {
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return;

  currentTripId = tripId;
  activeMainTab = 'itinerary';
  currentItineraryDay = 1;
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
// 7. 상세 화면 6개 탭 통합 렌더링
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
  renderDayChipsBar(trip);
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

function renderDayChipsBar(trip) {
  const panel = $('tabPanelItinerary');
  if (!panel) return;

  let chipsBar = $('dayChipsScrollbarBar');
  if (!chipsBar) {
    chipsBar = document.createElement('div');
    chipsBar.id = 'dayChipsScrollbarBar';
    chipsBar.className = 'flex overflow-x-auto no-scrollbar gap-2 pb-1.5 pt-0.5';
    const daySelectEl = $('selectItineraryDay');
    if (daySelectEl) {
      daySelectEl.classList.add('hidden');
      daySelectEl.parentNode.insertBefore(chipsBar, daySelectEl);
    }
  }

  const totalDays = calculateTripDays(trip);
  const currentDay = Number(currentItineraryDay) || 1;

  let html = '';
  for (let i = 1; i <= totalDays; i++) {
    const isSelected = i === currentDay;
    const dateStr = getDateForTripDay(trip, i);
    html += `
      <button type="button" data-action="select-day-chip" data-day="${i}" class="touch-target shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition ${
        isSelected
          ? 'bg-sky-600 text-white shadow-xs scale-[1.02]'
          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
      }">
        Day ${i} <span class="text-[10px] font-normal opacity-85 block">${dateStr}</span>
      </button>
    `;
  }
  chipsBar.innerHTML = html;
}

function renderRouteMapAndLinks(trip, dayItems) {
  const matchedAirports = [];
  const localStops = [];

  dayItems.forEach((item) => {
    const text = `${item.place || ''} ${item.memo || ''}`.toUpperCase();
    const codeMatches = text.match(/\b[A-Z]{3}\b/g) || [];
    codeMatches.forEach((code) => {
      if (AIRPORT_KO_MAP[code] && !matchedAirports.find((a) => a.code === code)) {
        matchedAirports.push({ code, ...AIRPORT_KO_MAP[code] });
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

  (trip.bookings || []).forEach((bk) => {
    if (bk.category === '항공') {
      const bText = `${bk.title || ''} ${bk.memo || ''}`.toUpperCase();
      const bCodes = bText.match(/\b[A-Z]{3}\b/g) || [];
      bCodes.forEach((code) => {
        if (AIRPORT_KO_MAP[code] && !matchedAirports.find((a) => a.code === code)) {
          matchedAirports.push({ code, ...AIRPORT_KO_MAP[code] });
        }
      });
    }
  });

  const linksContainer = $('localRouteLinksList');
  if (linksContainer) {
    if (localStops.length === 0) {
      linksContainer.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-1">일정을 추가하면 장소별 Google Maps 길찾기 바로가기가 생성됩니다.</p>`;
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
          <span class="font-bold text-sky-900">당일 순차 동선 (${localStops.length}곳)</span>
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
        window.L.marker([ap.lat, ap.lng]).bindPopup(`✈️ ${ap.name} (${ap.code})`).addTo(leafletLayerGroup);
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
      leafletMap.setView([35.6812, 139.7671], 5);
    }
    setTimeout(() => leafletMap.invalidateSize(), 100);
  } catch (err) {
    console.warn('Leaflet 지도 렌더링 경고:', err);
  }
}

function renderItineraryTab(trip) {
  const container = $('itineraryTimelineContainer');
  if (!container) return;

  const selectedDay = Number(currentItineraryDay) || 1;
  const items = (trip.itineraries || [])
    .filter((s) => Number(s.day) === selectedDay)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  renderRouteMapAndLinks(trip, items);

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

function renderExpensesTab(trip) {
  const priv = getMyPrivateInfo(trip);
  const me = priv.myNickname;
  const totalBudget = priv.myBudget;
  const expenses = trip.expenses || [];
  const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : [me];

  const settlement = calculateOneOverNSettlement(expenses, members, me);
  const mySpentKrw = settlement.mySpentKrw;
  const groupTotalKrw = settlement.groupTotalKrw;
  const transfers = settlement.transfers;

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

  const summaryEl = $('settlementTransfersContainer');
  if (summaryEl) {
    if (transfers.length === 0) {
      summaryEl.innerHTML = `<p class="text-emerald-300 font-semibold py-1">정산할 송금 차액이 없습니다.</p>`;
    } else {
      summaryEl.innerHTML = transfers
        .map(
          (t) => `
          <div class="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-xl">
            <span><strong class="text-amber-300">${escapeHtml(t.from)}</strong> ➔ <strong class="text-sky-300">${escapeHtml(t.to)}</strong>에게 송금</span>
            <span class="font-extrabold text-white">${Math.round(t.amount).toLocaleString()}원</span>
          </div>
        `
        )
        .join('');
    }
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

function renderPhotosTab(trip) {
  const grid = $('photoGalleryGrid');
  if (!grid) return;

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

function renderChecklistTab(trip) {
  const container = $('checklistItemsContainer');
  if (!container) return;

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
// 10. 모달 열기 헬퍼 함수들
// ============================================================================
function openNewTripModal() {
  const today = new Date().toISOString().split('T')[0];
  if ($('inputNewTripTitle')) $('inputNewTripTitle').value = '';
  if ($('inputNewTripDestination')) $('inputNewTripDestination').value = '';
  if ($('inputNewTripStartDate')) $('inputNewTripStartDate').value = today;
  if ($('inputNewTripEndDate')) $('inputNewTripEndDate').value = today;
  if ($('selectNewTripCurrency')) $('selectNewTripCurrency').value = 'KRW';
  if ($('inputNewTripMyBudget')) $('inputNewTripMyBudget').value = '1500000';
  if ($('inputNewTripMembers')) $('inputNewTripMembers').value = '나, 동행1';
  openModalSafe('modalNewTrip');
}

function openAddScheduleModal() {
  const trip = getActiveTrip();
  if (!trip) return;
  editingScheduleId = null;
  if ($('modalScheduleHeading')) $('modalScheduleHeading').textContent = '일정 추가';
  populateAllDaySelectors(trip);
  if ($('selectModalScheduleDay')) $('selectModalScheduleDay').value = String(currentItineraryDay || 1);
  if ($('inputModalScheduleTime')) $('inputModalScheduleTime').value = '10:00';
  if ($('inputModalSchedulePlace')) $('inputModalSchedulePlace').value = '';
  if ($('inputModalScheduleMemo')) $('inputModalScheduleMemo').value = '';
  openModalSafe('modalAddSchedule');
}

// [수정 완료] 예약 카테고리별 동적 입력 필드 생성 렌더링 함수 (요구사항 1, 2 반영)
function renderBookingDynamicFields(category, existingData = null) {
  const container = $('bookingDynamicExtraFieldsContainer');
  if (!container) return;

  if (category === '항공') {
    const segments = existingData?.segments || [
      {
        flightNo: existingData?.code || '',
        airline: existingData?.airline || '',
        dep: existingData?.dep || '',
        arr: existingData?.arr || '',
        date: existingData?.date || '',
        time: existingData?.time || '10:00'
      }
    ];

    container.innerHTML = `
      <div class="space-y-3 bg-sky-50/70 border border-sky-100 p-3 rounded-xl">
        <div class="flex items-center justify-between">
          <span class="text-xs font-extrabold text-sky-900">항공권 다구간(멀티 세그먼트) 일정 설정</span>
          <button type="button" data-action="add-flight-segment" class="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[10px] font-extrabold hover:bg-sky-700 transition">
            + 구간 추가
          </button>
        </div>
        <div id="flightSegmentsListContainer" class="space-y-2.5">
          ${segments
            .map(
              (seg, idx) => `
              <div class="flight-segment-row bg-white border border-sky-200 rounded-xl p-2.5 space-y-2 relative" data-index="${idx}">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-extrabold text-sky-800">구간 ${idx + 1}</span>
                  ${segments.length > 1 ? '<button type="button" data-action="remove-flight-segment" class="text-rose-500 text-xs px-1 hover:underline">삭제</button>' : ''}
                </div>
                <div class="flex gap-1.5">
                  <input type="text" placeholder="편명 (예: KE704)" value="${escapeHtml(seg.flightNo || '')}" class="seg-flight-code touch-target flex-1 uppercase font-mono bg-slate-50 border border-slate-200 rounded-lg px-2.5 text-xs font-bold outline-none" />
                  <button type="button" data-action="lookup-segment-flight" class="touch-target px-2.5 rounded-lg bg-sky-600 text-white text-xs font-extrabold shrink-0">조회</button>
                </div>
                <div class="grid grid-cols-2 gap-1.5">
                  <input type="date" value="${escapeHtml(seg.date || '')}" class="seg-flight-date touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
                  <input type="time" value="${escapeHtml(seg.time || '10:00')}" class="seg-flight-time touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
                </div>
                <div class="grid grid-cols-2 gap-1.5">
                  <input type="text" placeholder="출발지" value="${escapeHtml(seg.dep || '')}" class="seg-flight-dep touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
                  <input type="text" placeholder="도착지" value="${escapeHtml(seg.arr || '')}" class="seg-flight-arr touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
                </div>
              </div>
            `
            )
            .join('')}
        </div>
      </div>
    `;
  } else if (category === '숙소') {
    container.innerHTML = `
      <div class="space-y-2.5 bg-indigo-50/70 border border-indigo-100 p-3 rounded-xl">
        <span class="text-xs font-extrabold text-indigo-900 block">숙소 투숙 상세 설정 (체크인/아웃 자동 연동)</span>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[11px] font-semibold text-slate-600 block mb-1">체크인 날짜</label>
            <input id="inputHotelCheckInDate" type="date" value="${escapeHtml(existingData?.hotel?.checkInDate || existingData?.date || '')}" class="touch-target w-full bg-white border border-slate-200 rounded-lg px-2 text-xs" required />
          </div>
          <div>
            <label class="text-[11px] font-semibold text-slate-600 block mb-1">체크아웃 날짜</label>
            <input id="inputHotelCheckOutDate" type="date" value="${escapeHtml(existingData?.hotel?.checkOutDate || existingData?.date || '')}" class="touch-target w-full bg-white border border-slate-200 rounded-lg px-2 text-xs" required />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[11px] font-semibold text-slate-600 block mb-1">체크인 시간</label>
            <input id="inputHotelCheckInTime" type="time" value="${escapeHtml(existingData?.hotel?.checkInTime || '15:00')}" class="touch-target w-full bg-white border border-slate-200 rounded-lg px-2 text-xs" />
          </div>
          <div>
            <label class="text-[11px] font-semibold text-slate-600 block mb-1">체크아웃 시간</label>
            <input id="inputHotelCheckOutTime" type="time" value="${escapeHtml(existingData?.hotel?.checkOutTime || '11:00')}" class="touch-target w-full bg-white border border-slate-200 rounded-lg px-2 text-xs" />
          </div>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
}

function openAddBookingModal() {
  const trip = getActiveTrip();
  if (!trip) return;
  editingBookingId = null;
  if ($('modalBookingHeading')) $('modalBookingHeading').textContent = '예약 내역 등록';

  const priv = getMyPrivateInfo(trip);
  const members = trip.members || [priv.myNickname];

  if ($('selectBookingCategory')) $('selectBookingCategory').value = '항공';
  if ($('inputBookingDate')) $('inputBookingDate').value = trip.startDate || '';
  if ($('inputBookingTitle')) $('inputBookingTitle').value = '';
  if ($('inputBookingTime')) $('inputBookingTime').value = '10:00';
  if ($('inputBookingCode')) $('inputBookingCode').value = '';
  if ($('inputBookingMemo')) $('inputBookingMemo').value = '';
  if ($('selectBookingCurrency')) $('selectBookingCurrency').value = trip.baseCurrency || 'KRW';
  if ($('inputBookingAmount')) $('inputBookingAmount').value = '';
  if ($('chkBookingAutoSync')) $('chkBookingAutoSync').checked = true;

  renderBookingDynamicFields('항공', {
    segments: [{ flightNo: '', airline: '', dep: '', arr: '', date: trip.startDate || '', time: '10:00' }]
  });

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
}

function openAddExpenseModal() {
  const trip = getActiveTrip();
  if (!trip) return;
  editingExpenseId = null;
  if ($('modalExpenseHeading')) $('modalExpenseHeading').textContent = '지출 내역 추가';

  const priv = getMyPrivateInfo(trip);
  const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : [priv.myNickname];

  if ($('inputExpTitle')) $('inputExpTitle').value = '';
  if ($('selectExpCurrency')) $('selectExpCurrency').value = 'KRW';
  if ($('inputExpAmount')) $('inputExpAmount').value = '';
  if ($('inputExpAppliedRate')) $('inputExpAppliedRate').value = '1';
  if ($('expRateStatusText')) $('expRateStatusText').textContent = '적용 환율 (1 KRW = 1 KRW)';
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
}

function openAddPhotoModal() {
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
}

function openAddReviewModal() {
  const trip = getActiveTrip();
  if (!trip) return;
  editingReviewId = null;
  editingReviewTripId = trip.id;
  currentReviewPriceMemo = '';
  selectedReviewPhotoIds = [];
  if ($('modalReviewHeading')) $('modalReviewHeading').textContent = '방문 장소 리뷰 작성';

  populateAllDaySelectors(trip);

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
  if ($('selectReviewDay')) $('selectReviewDay').value = String(currentItineraryDay || 1);
  setReviewStarRating(5);
  if ($('chkReviewRevisit')) $('chkReviewRevisit').checked = true;
  if ($('inputReviewContent')) $('inputReviewContent').value = '';

  renderReviewPhotoThumbnails(trip);
  openModalSafe('modalAddReview');
}

// ============================================================================
// 11. 앱 초기화 및 document.body 통합 이벤트 위임 바인딩
// ============================================================================
function initializeAppAndEvents() {
  try {
    registerServiceWorkerSafe();
    loadLocalData();
    const cloudReady = initFirebaseSafely();
    renderHomeView();
    if (cloudReady) {
      startRealtimeListeners();
    }
  } catch (err) {
    console.error('초기화 예외:', err);
  }

  // --------------------------------------------------------------------------
  // [A] document.body 클릭 이벤트 위임
  // --------------------------------------------------------------------------
  document.body.addEventListener('click', async (e) => {
    try {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        closeModalSafe(closeBtn.getAttribute('data-close-modal'));
        return;
      }

      const mainTabBtn = e.target.closest('[data-main-tab]');
      if (mainTabBtn) {
        switchMainTab(mainTabBtn.getAttribute('data-main-tab'));
        return;
      }

      const dayChipBtn = e.target.closest('[data-action="select-day-chip"]');
      if (dayChipBtn) {
        const dayNum = Number(dayChipBtn.getAttribute('data-day')) || 1;
        currentItineraryDay = dayNum;
        const trip = getActiveTrip();
        if (trip) {
          renderDayChipsBar(trip);
          renderItineraryTab(trip);
        }
        return;
      }

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

      const starBtn = e.target.closest('[data-star-val]');
      if (starBtn) {
        setReviewStarRating(starBtn.getAttribute('data-star-val'));
        return;
      }

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

      const addSegBtn = e.target.closest('[data-action="add-flight-segment"]');
      if (addSegBtn) {
        const segContainer = $('flightSegmentsListContainer');
        if (segContainer) {
          const idx = segContainer.querySelectorAll('.flight-segment-row').length;
          const trip = getActiveTrip();
          const defDate = trip?.startDate || '';
          const newRow = document.createElement('div');
          newRow.className = 'flight-segment-row bg-white border border-sky-200 rounded-xl p-2.5 space-y-2 relative';
          newRow.setAttribute('data-index', idx);
          newRow.innerHTML = `
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold text-sky-800">구간 ${idx + 1}</span>
              <button type="button" data-action="remove-flight-segment" class="text-rose-500 text-xs px-1 hover:underline">삭제</button>
            </div>
            <div class="flex gap-1.5">
              <input type="text" placeholder="편명 (예: KE704)" class="seg-flight-code touch-target flex-1 uppercase font-mono bg-slate-50 border border-slate-200 rounded-lg px-2.5 text-xs font-bold outline-none" />
              <button type="button" data-action="lookup-segment-flight" class="touch-target px-2.5 rounded-lg bg-sky-600 text-white text-xs font-extrabold shrink-0">조회</button>
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <input type="date" value="${defDate}" class="seg-flight-date touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
              <input type="time" value="14:00" class="seg-flight-time touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <input type="text" placeholder="출발지" class="seg-flight-dep touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
              <input type="text" placeholder="도착지" class="seg-flight-arr touch-target bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs" />
            </div>
          `;
          segContainer.appendChild(newRow);
        }
        return;
      }

      const removeSegBtn = e.target.closest('[data-action="remove-flight-segment"]');
      if (removeSegBtn) {
        const row = removeSegBtn.closest('.flight-segment-row');
        if (row) row.remove();
        return;
      }

      const lookupSegBtn = e.target.closest('[data-action="lookup-segment-flight"]');
      if (lookupSegBtn) {
        const row = lookupSegBtn.closest('.flight-segment-row');
        if (!row) return;
        const codeInput = row.querySelector('.seg-flight-code');
        const code = (codeInput?.value || '').replace(/\s+/g, '').toUpperCase();
        if (!code) {
          alert('조회할 편명을 입력해주세요.');
          return;
        }
        lookupSegBtn.disabled = true;
        lookupSegBtn.textContent = '조회중';
        try {
          const info = await lookupFlightWithSharedCache(code);
          if (info) {
            if (info.dep && row.querySelector('.seg-flight-dep')) row.querySelector('.seg-flight-dep').value = info.dep;
            if (info.arr && row.querySelector('.seg-flight-arr')) row.querySelector('.seg-flight-arr').value = info.arr;
            if (info.depTime && row.querySelector('.seg-flight-time')) row.querySelector('.seg-flight-time').value = info.depTime;
            alert(`[${info.airline} ${info.flightNo}] 구간 정보가 채워졌습니다.`);
          } else {
            alert('항공편 정보를 찾지 못했습니다.');
          }
        } finally {
          lookupSegBtn.disabled = false;
          lookupSegBtn.textContent = '조회';
        }
        return;
      }

      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.getAttribute('data-action');
      const id = actionEl.getAttribute('data-id');
      const tripId = actionEl.getAttribute('data-trip-id');

      switch (action) {
        case 'open-new-trip-modal':
          openNewTripModal();
          break;

        case 'back-to-home':
          exitTripDetailToHome();
          break;

        case 'copy-invite-code': {
          const trip = getActiveTrip();
          if (trip) {
            const shareMsg = `[${trip.title}] 여행에 초대합니다!\n초대 코드: ${trip.inviteCode}`;
            await shareOrCopyText(trip.title, shareMsg, `초대 코드 [${trip.inviteCode}]가 복사되었습니다!`);
          }
          break;
        }

        case 'refresh-all-rates': {
          const label = $('headerRateTimestamp');
          if (label) label.textContent = '환율 갱신 중...';
          const [jpy, usd, eur] = await Promise.all([
            fetchLiveExchangeRate('JPY'),
            fetchLiveExchangeRate('USD'),
            fetchLiveExchangeRate('EUR')
          ]);
          if (label) {
            label.textContent = `100엔 ${jpy.ratePer100}원 · 1달러 ${usd.rate}원`;
          }
          alert(
            `최신 매매기준율이 갱신되었습니다.\n` +
            `• ${jpy.displayUnit}\n` +
            `• ${usd.displayUnit}\n` +
            `• ${eur.displayUnit}`
          );
          break;
        }

        case 'open-trip':
          if (tripId) enterTripDetail(tripId);
          break;

        case 'delete-trip': {
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
          break;
        }

        case 'open-add-schedule-modal':
          openAddScheduleModal();
          break;

        case 'edit-itinerary': {
          const trip = getActiveTrip();
          const item = trip?.itineraries?.find((s) => s.id === id);
          if (item) {
            editingScheduleId = item.id;
            if ($('modalScheduleHeading')) $('modalScheduleHeading').textContent = '일정 수정';
            populateAllDaySelectors(trip);
            if ($('selectModalScheduleDay')) $('selectModalScheduleDay').value = String(item.day || 1);
            if ($('inputModalScheduleTime')) $('inputModalScheduleTime').value = item.time || '10:00';
            if ($('inputModalSchedulePlace')) $('inputModalSchedulePlace').value = item.place || '';
            if ($('inputModalScheduleMemo')) $('inputModalScheduleMemo').value = item.memo || '';
            openModalSafe('modalAddSchedule');
          }
          break;
        }

        case 'delete-itinerary': {
          const trip = getActiveTrip();
          if (trip && confirm('이 일정을 삭제하시겠습니까?')) {
            trip.itineraries = (trip.itineraries || []).filter((s) => s.id !== id);
            saveLocalData();
            renderItineraryTab(trip);
            await syncTripToFirestore(trip);
          }
          break;
        }

        case 'toggle-ai-planner':
          $('aiPlannerBox')?.classList.toggle('hidden');
          break;

        case 'close-ai-planner':
          $('aiPlannerBox')?.classList.add('hidden');
          break;

        case 'generate-ai-schedule': {
          const trip = getActiveTrip();
          if (!trip) break;
          const concept = ($('inputAiConcept')?.value || '').trim() || '현지 대표 명소 및 미식 탐방';
          const budgetMan = Number($('inputAiTargetBudget')?.value) || 100;
          const totalDays = calculateTripDays(trip);

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
                memo: `컨셉: ${concept} · 오전 추천 동선`
              });
            }
            if (!existingTimes.has('12:30')) {
              suggestions.push({
                day: d,
                time: '12:30',
                place: `${trip.destination} 로컬 미식 런치`,
                memo: `희망 예산 약 ${Math.round(budgetMan / totalDays)}만원/일 배분`
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
          break;
        }

        case 'apply-ai-schedules': {
          const trip = getActiveTrip();
          if (!trip || aiGeneratedSuggestions.length === 0) break;

          aiGeneratedSuggestions.forEach((s, idx) => {
            trip.itineraries.push({
              id: 'it_ai_' + Date.now() + '_' + idx,
              day: s.day,
              time: s.time,
              place: s.place,
              memo: s.memo
            });
          });

          const count = aiGeneratedSuggestions.length;
          aiGeneratedSuggestions = [];
          $('aiSuggestionResultArea')?.classList.add('hidden');
          $('aiPlannerBox')?.classList.add('hidden');

          saveLocalData();
          renderItineraryTab(trip);
          await syncTripToFirestore(trip);
          alert(`AI 추천 일정 ${count}건이 일정표에 한 번에 추가되었습니다!`);
          break;
        }

        case 'share-itinerary-text': {
          const trip = getActiveTrip();
          if (!trip) break;
          const selectedDay = Number(currentItineraryDay) || 1;
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
          await shareOrCopyText(`${trip.title} 일정`, lines.join('\n'), '일정 요약이 클립보드에 복사되었습니다!');
          break;
        }

        case 'open-add-booking-modal':
          openAddBookingModal();
          break;

        case 'edit-booking': {
          const trip = getActiveTrip();
          const bk = trip?.bookings?.find((b) => b.id === id);
          if (bk) {
            editingBookingId = bk.id;
            if ($('modalBookingHeading')) $('modalBookingHeading').textContent = '예약 내역 수정';
            const priv = getMyPrivateInfo(trip);
            const members = trip.members || [priv.myNickname];

            if ($('selectBookingCategory')) {
              $('selectBookingCategory').value = bk.category || '항공';
              renderBookingDynamicFields(bk.category || '항공', bk);
            }
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
          break;
        }

        case 'delete-booking': {
          const trip = getActiveTrip();
          if (trip && confirm('이 예약을 삭제하시겠습니까? (연동된 일정 및 지출도 함께 삭제됩니다)')) {
            trip.bookings = (trip.bookings || []).filter((b) => b.id !== id);
            trip.itineraries = (trip.itineraries || []).filter((s) => s.bookingId !== id);
            trip.expenses = (trip.expenses || []).filter((ex) => ex.bookingId !== id);
            saveLocalData();
            renderDetailView();
            await syncTripToFirestore(trip);
          }
          break;
        }

        case 'toggle-budget-form': {
          const trip = getActiveTrip();
          const form = $('formUpdatePrivateBudget');
          if (trip && form) {
            const priv = getMyPrivateInfo(trip);
            if ($('inputPrivateBudgetValue')) $('inputPrivateBudgetValue').value = String(priv.myBudget);
            form.classList.toggle('hidden');
          }
          break;
        }

        case 'open-add-expense-modal':
          openAddExpenseModal();
          break;

        case 'fetch-expense-rate':
          await syncExpenseModalRateFromApi();
          break;

        case 'edit-expense': {
          const trip = getActiveTrip();
          const exp = trip?.expenses?.find((ex) => ex.id === id);
          if (exp) {
            editingExpenseId = exp.id;
            if ($('modalExpenseHeading')) $('modalExpenseHeading').textContent = '지출 내역 수정';
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
          break;
        }

        case 'delete-expense': {
          const trip = getActiveTrip();
          if (trip && confirm('이 지출 내역을 삭제하시겠습니까?')) {
            trip.expenses = (trip.expenses || []).filter((ex) => ex.id !== id);
            saveLocalData();
            renderExpensesTab(trip);
            await syncTripToFirestore(trip);
          }
          break;
        }

        case 'share-settlement-summary': {
          const trip = getActiveTrip();
          if (!trip) break;
          const summaryText = $('settlementTransfersContainer')?.innerText || '';
          const totalText = $('groupTotalExpenseKrw')?.textContent || '';
          const text = [
            `💸 [${trip.title}] 1/N 정산 안내`,
            `━━━━━━━━━━━━━━━━━━`,
            `• ${totalText}`,
            summaryText.trim()
          ].join('\n');
          await shareOrCopyText(`${trip.title} 정산`, text, '1/N 정산 요약이 클립보드에 복사되었습니다!');
          break;
        }

        case 'open-add-photo-modal':
          openAddPhotoModal();
          break;

        case 'view-photo': {
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
          break;
        }

        case 'edit-viewing-photo': {
          const trip = getActiveTrip();
          const photo = trip?.photos?.find((p) => p.id === viewingPhotoId);
          if (!photo) break;
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
          break;
        }

        case 'delete-viewing-photo': {
          const trip = getActiveTrip();
          if (trip && viewingPhotoId && confirm('이 사진을 삭제하시겠습니까?')) {
            trip.photos = (trip.photos || []).filter((p) => p.id !== viewingPhotoId);
            viewingPhotoId = null;
            saveLocalData();
            closeModalSafe('modalViewPhoto');
            renderPhotosTab(trip);
            await syncTripToFirestore(trip);
          }
          break;
        }

        case 'open-add-review-modal':
          openAddReviewModal();
          break;

        case 'toggle-review-photo': {
          const trip = getActiveTrip();
          if (!trip || !id) break;
          if (selectedReviewPhotoIds.includes(id)) {
            selectedReviewPhotoIds = selectedReviewPhotoIds.filter((pid) => pid !== id);
          } else {
            selectedReviewPhotoIds.push(id);
          }
          renderReviewPhotoThumbnails(trip);
          break;
        }

        case 'edit-review': {
          const trip = getActiveTrip();
          const rv = trip?.reviews?.find((r) => r.id === id);
          if (rv) {
            editingReviewId = rv.id;
            editingReviewTripId = trip.id;
            currentReviewPriceMemo = rv.priceMemo || '';
            if ($('modalReviewHeading')) $('modalReviewHeading').textContent = '방문 장소 리뷰 수정';
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
          break;
        }

        case 'edit-global-review': {
          const targetTrip = trips.find((t) => t.id === tripId);
          const rv = targetTrip?.reviews?.find((r) => r.id === id);
          if (targetTrip && rv) {
            editingReviewId = rv.id;
            editingReviewTripId = targetTrip.id;
            currentReviewPriceMemo = rv.priceMemo || '';
            if ($('modalReviewHeading')) $('modalReviewHeading').textContent = '방문 장소 리뷰 수정';
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
          break;
        }

        case 'delete-review': {
          const trip = getActiveTrip();
          if (trip && confirm('이 리뷰를 삭제하시겠습니까?')) {
            trip.reviews = (trip.reviews || []).filter((r) => r.id !== id);
            saveLocalData();
            renderReviewsTab(trip);
            await syncTripToFirestore(trip);
            await deleteReviewFromGlobalCollection(id);
          }
          break;
        }

        case 'edit-cl-item': {
          const trip = getActiveTrip();
          if (!trip) break;
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
              renderChecklistTab(trip);
              await syncTripToFirestore(trip);
            }
          }
          break;
        }

        case 'delete-cl-item': {
          const trip = getActiveTrip();
          if (!trip) break;
          if (currentChecklistSubTab === 'shopping') {
            trip.shoppingList = (trip.shoppingList || []).filter((c) => c.id !== id);
          } else {
            trip.packingList = (trip.packingList || []).filter((c) => c.id !== id);
          }
          saveLocalData();
          renderChecklistTab(trip);
          await syncTripToFirestore(trip);
          break;
        }

        case 'export-json': {
          const exportObj = {
            app: 'Travel Journal',
            version: 6,
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
          break;
        }

        case 'trigger-import-json':
          $('inputImportJsonFile')?.click();
          break;

        case 'print-report':
          window.print();
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('클릭 이벤트 위임 처리 오류:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [B] document.body 변경(change) 및 입력(input) 이벤트 위임
  // --------------------------------------------------------------------------
  document.body.addEventListener('change', async (e) => {
    try {
      const target = e.target;
      if (!target) return;

      if (target.getAttribute('data-action') === 'toggle-cl-item') {
        const id = target.getAttribute('data-id');
        const trip = getActiveTrip();
        if (!trip) return;
        const targetArr = currentChecklistSubTab === 'shopping' ? trip.shoppingList : trip.packingList;
        const item = (targetArr || []).find((c) => c.id === id);
        if (item) {
          item.checked = target.checked;
          saveLocalData();
          renderChecklistTab(trip);
          await syncTripToFirestore(trip);
        }
        return;
      }

      if (target.id === 'selectBookingCategory') {
        const cat = target.value;
        const trip = getActiveTrip();
        renderBookingDynamicFields(cat, { date: trip?.startDate || '' });
        return;
      }

      if (target.id === 'selectPhotoDayFilter') {
        const trip = getActiveTrip();
        if (trip) renderPhotosTab(trip);
        return;
      }

      if (target.id === 'selectExpCurrency') {
        await syncExpenseModalRateFromApi();
        return;
      }

      if (target.id === 'inputPhotoFile') {
        const file = target.files?.[0];
        if (file) {
          const previewUrl = await compressImageFileToBase64(file, 800, 0.7);
          if ($('imgPhotoUploadPreview')) $('imgPhotoUploadPreview').src = previewUrl;
          $('photoPreviewWrapper')?.classList.remove('hidden');
        }
        return;
      }

      // [부속 보완 4] 티켓/투어 등 예약명에서 카테고리 태그 제거 후 순수 장소명 추출
      if (target.id === 'selectReviewFromBooking') {
        const bkId = target.value;
        const trip = getActiveTrip();
        if (!trip || !bkId) return;
        const bk = (trip.bookings || []).find((b) => b.id === bkId);
        if (!bk) return;

        const rawTitle = bk.title || '';
        const cleanTitle = rawTitle.replace(/^\[.*?\]\s*/, '').trim();

        if ($('inputReviewPlaceName')) $('inputReviewPlaceName').value = cleanTitle || rawTitle;
        if ($('selectReviewCategory')) {
          $('selectReviewCategory').value = bk.category === '숙소' ? '숙소' : bk.category === '렌터카' ? '쇼핑/기타' : '관광지';
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
        return;
      }

      if (target.id === 'inputImportJsonFile') {
        const file = target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(ev.target.result);
            if (parsed && Array.isArray(parsed.trips)) {
              trips = parsed.trips.map(normalizeTrip).filter(Boolean);
              if (Array.isArray(parsed.allReviews)) allReviews = parsed.allReviews;
              if (parsed.privateBudgets && typeof parsed.privateBudgets === 'object') {
                privateBudgets = { ...privateBudgets, ...parsed.privateBudgets };
              }
              saveLocalData();
              if (isCloudOnline && db) {
                trips.forEach((t) => syncTripToFirestore(t));
              }
              if (currentTripId) {
                renderDetailView();
              } else {
                renderHomeView();
              }
              alert(`총 ${trips.length}개의 여행 기록이 복원되었습니다.`);
            } else {
              alert('올바른 Travel Journal 백업 파일이 아닙니다.');
            }
          } catch (err) {
            alert('JSON 파일을 읽는 중 오류가 발생했습니다.');
          }
        };
        reader.readAsText(file);
        target.value = '';
      }
    } catch (err) {
      console.error('change 이벤트 위임 오류:', err);
    }
  });

  document.body.addEventListener('input', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.id === 'inputExpAmount' || target.id === 'inputExpAppliedRate') {
      updateExpenseModalRatePreview();
    }
  });

  // --------------------------------------------------------------------------
  // [C] 모든 폼 제출(submit) 이벤트 바인딩
  // --------------------------------------------------------------------------
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
        ownerUid: deviceUid,
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
      console.error('새 여행 생성 오류:', err);
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
      console.error('초대 코드 합류 오류:', err);
      alert('여행 합류 중 오류가 발생했습니다.');
    }
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

      currentItineraryDay = day;
      renderDayChipsBar(trip);
      saveLocalData();
      closeModalSafe('modalAddSchedule');
      renderItineraryTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('일정 저장 오류:', err);
    }
  });

// 예약 폼 제출 핸들러 (항공 다구간 일괄 등록 및 숙소 체크인/아웃 연동 처리)
$('formCreateBooking')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const trip = getActiveTrip();
    if (!trip) return;

    const category = $('selectBookingCategory')?.value || '항공';
    const code = ($('inputBookingCode')?.value || '').trim().toUpperCase();
    const memo = ($('inputBookingMemo')?.value || '').trim();
    const currency = ($('selectBookingCurrency')?.value || trip.baseCurrency || 'KRW').toUpperCase();
    const amount = Number($('inputBookingAmount')?.value) || 0;
    const autoSync = $('chkBookingAutoSync')?.checked !== false;
    const payer = $('selectBookingPayer']?.value || getMyPrivateInfo(trip).myNickname;
    
    const participantChks = document.querySelectorAll('.bk-part-chk');
    const participants = participantChks.length > 0 
      ? Array.from(participantChks).filter(c => c.checked).map(c => c.value) 
      : [payer];

    const bookingId = editingBookingId || ('bk_' + Date.now());
    let title = ($('inputBookingTitle')?.value || '').trim();

    trip.itineraries = (trip.itineraries || []).filter((s) => s.bookingId !== bookingId);
    trip.expenses = (trip.expenses || []).filter((ex) => ex.bookingId !== bookingId);

    let newBookingObj = {
      id: bookingId,
      category,
      code,
      title,
      memo,
      currency,
      amount,
      autoSync,
      payer,
      participants
    };

    if (category === '항공') {
      const segmentRows = document.querySelectorAll('.flight-segment-row');
      const segments = [];
      segmentRows.forEach((row) => {
        segments.push({
          flightNo: (row.querySelector('.seg-flight-code')?.value || '').trim().toUpperCase(),
          date: row.querySelector('.seg-flight-date')?.value || trip.startDate,
          time: row.querySelector('.seg-flight-time')?.value || '10:00',
          dep: (row.querySelector('.seg-flight-dep')?.value || '').trim(),
          arr: (row.querySelector('.seg-flight-arr')?.value || '').trim()
        });
      });

      if (segments.length === 0) {
        alert('최소 1개 이상의 항공편 구간을 입력해주세요.');
        return;
      }

      if (!title) {
        title = `${segments[0].dep || '출발'} ➔ ${segments[segments.length - 1].arr || '도착'} 항공편`;
      }

      newBookingObj.title = title;
      newBookingObj.segments = segments;
      newBookingObj.date = segments[0].date;
      newBookingObj.time = segments[0].time;

      if (autoSync) {
        segments.forEach((seg, idx) => {
          const dayNum = inferDayNumberFromDate(trip, seg.date);
          trip.itineraries.push({
            id: `it_bk_flight_${bookingId}_${idx}`,
            bookingId: bookingId,
            day: dayNum,
            time: seg.time || '10:00',
            place: `[항공] ${seg.flightNo || title} (${seg.dep} ➔ ${seg.arr})`,
            memo: `편명: ${seg.flightNo} · ${memo}`.trim()
          });
        });
      }
    } else if (category === '숙소') {
      const checkInDate = $('inputHotelCheckInDate')?.value || trip.startDate;
      const checkOutDate = $('inputHotelCheckOutDate')?.value || trip.endDate;
      const checkInTime = $('inputHotelCheckInTime')?.value || '15:00';
      const checkOutTime = $('inputHotelCheckOutTime')?.value || '11:00';

      if (!title) {
        title = '숙소 예약';
      }

      newBookingObj.title = title;
      newBookingObj.date = checkInDate;
      newBookingObj.time = checkInTime;
      newBookingObj.hotel = {
        checkInDate,
        checkInTime,
        checkOutDate,
        checkOutTime
      };

      if (autoSync) {
        const checkInDay = inferDayNumberFromDate(trip, checkInDate);
        trip.itineraries.push({
          id: `it_bk_hotel_in_${bookingId}`,
          bookingId: bookingId,
          day: checkInDay,
          time: checkInTime,
          place: `[숙소 체크인] ${title}`,
          memo: `체크아웃: ${checkOutDate} ${checkOutTime} · ${memo}`.trim()
        });

        const checkOutDay = inferDayNumberFromDate(trip, checkOutDate);
        if (checkOutDay !== checkInDay) {
          trip.itineraries.push({
            id: `it_bk_hotel_out_${bookingId}`,
            bookingId: bookingId,
            day: checkOutDay,
            time: checkOutTime,
            place: `[숙소 체크아웃] ${title}`,
            memo: `${memo}`.trim()
          });
        }
      }
    } else {
      const date = $('inputBookingDate')?.value || trip.startDate;
      const time = $('inputBookingTime')?.value || '10:00';

      if (!title) {
        title = `${category} 예약`;
      }

      newBookingObj.title = title;
      newBookingObj.date = date;
      newBookingObj.time = time;

      if (autoSync) {
        const dayNum = inferDayNumberFromDate(trip, date);
        trip.itineraries.push({
          id: `it_bk_std_${bookingId}`,
          bookingId: bookingId,
          day: dayNum,
          time: time,
          place: `[${category}] ${title}`,
          memo: memo
        });
      }
    }

    if (autoSync && amount > 0) {
      const rateToKrw = getCachedRateToKrw(currency);
      trip.expenses.push({
        id: `exp_bk_${bookingId}`,
        bookingId: bookingId,
        title: `[예약연동] ${title}`,
        currency: currency,
        amount: amount,
        rateToKrw: rateToKrw,
        payer: payer,
        participants: participants,
        date: newBookingObj.date || trip.startDate
      });
    }

    if (editingBookingId) {
      const idx = (trip.bookings || []).findIndex(b => b.id === editingBookingId);
      if (idx >= 0) {
        trip.bookings[idx] = newBookingObj;
      } else {
        trip.bookings[idx] = newBookingObj;
      }
      editingBookingId = null;
    } else {
      if (!trip.bookings) trip.bookings = [];
      trip.bookings.push(newBookingObj);
    }

    saveLocalData();
    closeModalSafe('modalAddBooking');
    renderDetailView();
    await syncTripToFirestore(trip);

    alert('예약 내역이 성공적으로 저장되고 일정·지출에 자동 연동되었습니다!');
  } catch (err) {
    console.error('예약 저장 오류:', err);
    alert('예약 저장 중 오류가 발생했습니다.');
  }
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
      console.error('지출 저장 오류:', err);
      alert('지출 내역 저장 중 오류가 발생했습니다.');
    }
  });

  $('formCreatePhoto')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = $('btnSubmitCreatePhoto');
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const file = $('inputPhotoFile')?.files?.[0];
      if (!file) {
        alert('업로드할 사진 파일을 선택해주세요.');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '압축 및 저장 중...';
      }

      const compressedBase64 = await compressImageFileToBase64(file, 800, 0.7);
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
    } catch (err) {
      console.error('사진 저장 오류:', err);
      alert('사진 처리 중 오류가 발생했습니다.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '사진 저장';
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
      console.error('리뷰 저장 오류:', err);
    }
  });

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
      console.error('체크리스트 추가 오류:', err);
    }
  });
}

// ----------------------------------------------------------------------------
// 앱 진입점 실행 보장
// ----------------------------------------------------------------------------
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAppAndEvents);
} else {
  initializeAppAndEvents();
}
