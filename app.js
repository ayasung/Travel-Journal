/**
 * Travel Journal - app.js (ES Module)
 * - 100% matched with index.html IDs, data-actions, and 6-tab structure
 * - All event listeners & event delegation wrapped in DOMContentLoaded + try-catch
 * - Firebase Firestore v10 modular SDK + LocalStorage hybrid mode
 * - Photo upload with HTML5 Canvas resize (max width 800px, JPEG 0.7) -> Base64
 * - Live exchange rate APIs (1st: open.er-api.com -> 2nd: fawazahmed0 currency-api -> 3rd: fallback)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
// 1. 상수 및 전역 상태
// ============================================================================
const STORAGE_TRIPS_KEY = 'TRAVEL_JOURNAL_TRIPS_V3';
const STORAGE_PRIVATE_KEY = 'TRAVEL_JOURNAL_PRIVATE_V3';
const STORAGE_UID_KEY = 'TRAVEL_JOURNAL_DEVICE_UID_V3';

const liveRatesToKrw = {
  KRW: 1,
  JPY: 9.15,
  USD: 1380.0,
  EUR: 1490.0
};

let db = null;
let isCloudConnected = false;
let unsubscribeTripsSnapshot = null;

let trips = [];
let privateBudgets = {}; // { [tripId]: { myBudget: number, myNickname: string } }
let currentTripId = null;
let currentMainTab = 'itinerary';
let currentBookingFilter = '전체';
let currentReviewFilter = '전체';
let viewingPhotoId = null;

// ============================================================================
// 2. 방어형 DOM 헬퍼 및 유틸리티
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
    return 'uid_guest_' + Math.random().toString(36).substring(2, 8);
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

function copyTextSafe(text, successMsg) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => alert(successMsg))
      .catch(() => fallbackCopyText(text, successMsg));
  } else {
    fallbackCopyText(text, successMsg);
  }
}

function fallbackCopyText(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    alert(successMsg);
  } catch (e) {
    alert(`복사할 내용: ${text}`);
  }
  ta.remove();
}

// ============================================================================
// 3. Service Worker 등록 (PWA 지원)
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
// 4. Firebase 초기화 & 하이브리드 스토리지 동기화
// ============================================================================
function updateConnectionBadge(online) {
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
  const hasApiKey = firebaseConfig && typeof firebaseConfig.apiKey === 'string' && firebaseConfig.apiKey.trim() !== '';
  if (!hasApiKey) {
    isCloudConnected = false;
    updateConnectionBadge(false);
    return false;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isCloudConnected = true;
    updateConnectionBadge(true);
    return true;
  } catch (err) {
    console.error('Firebase 초기화 실패 (오프라인 모드로 전환):', err);
    isCloudConnected = false;
    db = null;
    updateConnectionBadge(false);
    return false;
  }
}

function normalizeTripData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id || 'trip_' + Date.now(),
    inviteCode: raw.inviteCode || generateInviteCode(),
    memberIds: Array.isArray(raw.memberIds) ? raw.memberIds : [deviceUid],
    title: raw.title || '나의 여행',
    destination: raw.destination || '미정',
    startDate: raw.startDate || '2026-11-12',
    endDate: raw.endDate || '2026-11-15',
    baseCurrency: raw.baseCurrency || 'KRW',
    members: Array.isArray(raw.members) && raw.members.length > 0 ? raw.members : ['나'],
    itineraries: Array.isArray(raw.itineraries) ? raw.itineraries : [],
    bookings: Array.isArray(raw.bookings) ? raw.bookings : [],
    expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
    checklists: Array.isArray(raw.checklists) ? raw.checklists : [],
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

function loadLocalStore() {
  try {
    const rawTrips = localStorage.getItem(STORAGE_TRIPS_KEY);
    if (rawTrips) {
      const parsed = JSON.parse(rawTrips);
      if (Array.isArray(parsed)) {
        trips = parsed.map(normalizeTripData).filter(Boolean);
      }
    }
  } catch (err) {
    console.error('로컬 여행 데이터 로드 오류:', err);
    trips = [];
  }

  try {
    const rawPriv = localStorage.getItem(STORAGE_PRIVATE_KEY);
    if (rawPriv) {
      const parsedPriv = JSON.parse(rawPriv);
      if (parsedPriv && typeof parsedPriv === 'object') {
        privateBudgets = parsedPriv;
      }
    }
  } catch (err) {
    console.error('개인 예산 로드 오류:', err);
    privateBudgets = {};
  }
}

function saveLocalStore() {
  try {
    localStorage.setItem(STORAGE_TRIPS_KEY, JSON.stringify(trips));
    localStorage.setItem(STORAGE_PRIVATE_KEY, JSON.stringify(privateBudgets));
  } catch (err) {
    console.error('로컬 저장 용량 초과 또는 오류:', err);
    alert('기기 저장 공간이 부족합니다. 불필요한 사진을 일부 정리해주세요.');
  }
}

async function syncTripToFirestore(trip) {
  if (!isCloudConnected || !db || !trip) return;
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
      checklists: trip.checklists || [],
      createdAt: trip.createdAt,
      updatedAt: new Date().toISOString()
    };

    const byteSize = new Blob([JSON.stringify(payload)]).size;
    if (byteSize > 950000) {
      alert('클라우드 문서 용량(1MB) 한도에 근접하여 클라우드 동기화가 보류되었습니다. 사진 수를 조금 줄여주세요.');
      return;
    }

    await setDoc(doc(db, 'trips', trip.id), payload, { merge: true });
  } catch (err) {
    console.error('Firestore 저장 오류:', err);
  }
}

function startFirestoreRealtimeSync() {
  if (!isCloudConnected || !db) return;
  if (typeof unsubscribeTripsSnapshot === 'function') {
    unsubscribeTripsSnapshot();
  }

  try {
    const q = query(collection(db, 'trips'), where('memberIds', 'array-contains', deviceUid));
    unsubscribeTripsSnapshot = onSnapshot(
      q,
      (snapshot) => {
        const cloudTrips = [];
        snapshot.forEach((docSnap) => {
          const normalized = normalizeTripData({ id: docSnap.id, ...docSnap.data() });
          if (normalized) cloudTrips.push(normalized);
        });

        const cloudIds = new Set(cloudTrips.map((t) => t.id));
        const localOnly = trips.filter((t) => !cloudIds.has(t.id));
        localOnly.forEach((lt) => {
          lt.memberIds = Array.from(new Set([...(lt.memberIds || []), deviceUid]));
          syncTripToFirestore(lt);
        });

        trips = [...cloudTrips, ...localOnly];
        saveLocalStore();

        if (currentTripId) {
          renderDetailView();
        } else {
          renderHomeView();
        }
      },
      (err) => {
        console.error('Firestore 실시간 구독 오류:', err);
        updateConnectionBadge(false);
      }
    );
  } catch (err) {
    console.error('실시간 구독 시작 실패:', err);
  }
}

function getActiveTrip() {
  return trips.find((t) => t.id === currentTripId) || null;
}

function getMyPrivateInfo(trip) {
  if (!trip) return { myBudget: 0, myNickname: '나' };
  const record = privateBudgets[trip.id];
  const defaultName = (Array.isArray(trip.members) && trip.members[0]) ? trip.members[0] : '나';
  if (!record) {
    return { myBudget: 0, myNickname: defaultName };
  }
  return {
    myBudget: Number(record.myBudget) || 0,
    myNickname: (record.myNickname && record.myNickname.trim()) ? record.myNickname.trim() : defaultName
  };
}

// ============================================================================
// 5. 실시간 환율 조회 API (1순위: open.er-api.com -> 2순위: fawazahmed0 -> 3순위: 기본값)
// ============================================================================
async function fetchLiveExchangeRateToKrw(currencyCode) {
  const upper = (currencyCode || 'KRW').trim().toUpperCase();
  if (upper === 'KRW') {
    return { rate: 1, source: '기준 통화' };
  }

  // 1순위 API: https://open.er-api.com/v6/latest/{통화코드}
  try {
    const res1 = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(upper)}`);
    if (res1.ok) {
      const data1 = await res1.json();
      const krwRate = data1?.rates?.KRW;
      if (typeof krwRate === 'number' && krwRate > 0) {
        const rounded = Number(krwRate.toFixed(2));
        liveRatesToKrw[upper] = rounded;
        return { rate: rounded, source: 'open.er-api.com' };
      }
    }
  } catch (err) {
    console.warn(`1순위 환율 API 실패 (${upper}):`, err);
  }

  // 2순위 API: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{소문자통화코드}.json
  try {
    const lower = upper.toLowerCase();
    const res2 = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${encodeURIComponent(lower)}.json`);
    if (res2.ok) {
      const data2 = await res2.json();
      const krwRate2 = data2?.[lower]?.krw;
      if (typeof krwRate2 === 'number' && krwRate2 > 0) {
        const rounded2 = Number(krwRate2.toFixed(2));
        liveRatesToKrw[upper] = rounded2;
        return { rate: rounded2, source: 'currency-api' };
      }
    }
  } catch (err) {
    console.warn(`2순위 환율 API 실패 (${upper}):`, err);
  }

  // 3순위 오프라인 Fallback
  const fallback = Number((liveRatesToKrw[upper] || 1).toFixed(2));
  return { rate: fallback, source: '기본 환율' };
}

async function refreshAllRates(showAlert = false) {
  const label = $('headerRateTimestamp');
  if (label) label.textContent = '환율 갱신 중...';

  await Promise.all(['JPY', 'USD', 'EUR'].map((code) => fetchLiveExchangeRateToKrw(code)));

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  if (label) {
    label.textContent = `기준(${hh}:${mm}) JPY ${liveRatesToKrw.JPY} · USD ${liveRatesToKrw.USD}`;
  }

  if (showAlert) {
    alert(
      `실시간 매매기준율이 갱신되었습니다.\n` +
      `• 1 JPY = ${liveRatesToKrw.JPY.toFixed(2)} KRW\n` +
      `• 1 USD = ${liveRatesToKrw.USD.toLocaleString()} KRW\n` +
      `• 1 EUR = ${liveRatesToKrw.EUR.toLocaleString()} KRW`
    );
  }
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
  } catch (err) {
    console.error('원화 환산 미리보기 계산 오류:', err);
  }
}

async function syncExpenseModalRateFromApi() {
  try {
    const curr = ($('selectExpCurrency')?.value || 'KRW').toUpperCase();
    const statusText = $('expRateSourceText');
    const rateInput = $('inputExpAppliedRate');

    if (curr === 'KRW') {
      if (rateInput) rateInput.value = '1';
      if (statusText) statusText.textContent = '적용 환율 (1 KRW = 1 KRW)';
      updateExpenseModalRatePreview();
      return;
    }

    if (statusText) statusText.textContent = `${curr} 실시간 환율 조회 중...`;
    const result = await fetchLiveExchangeRateToKrw(curr);

    if (rateInput) rateInput.value = result.rate.toFixed(2);
    if (statusText) {
      statusText.textContent = `적용 환율 (1 ${curr} = ${result.rate.toFixed(2)} KRW · ${result.source})`;
    }
    updateExpenseModalRatePreview();
  } catch (err) {
    console.error('지출 모달 환율 조회 오류:', err);
  }
}

// ============================================================================
// 6. HTML5 Canvas 이미지 리사이징·압축 유틸리티 (최대 가로 800px, JPEG 0.7 -> Base64)
// ============================================================================
function compressImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_WIDTH = 800;
          let width = img.width;
          let height = img.height;

          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const base64DataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(base64DataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('이미지 로드에 실패했습니다.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('파일 읽기에 실패했습니다.'));
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 7. 날짜/일수 유틸리티
// ============================================================================
function calculateTripDays(trip) {
  if (!trip || !trip.startDate || !trip.endDate) return 1;
  const s = new Date(trip.startDate + 'T00:00:00');
  const e = new Date(trip.endDate + 'T00:00:00');
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 1;
  return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

function getDateStrForDay(trip, dayNum) {
  if (!trip || !trip.startDate) return '';
  const d = new Date(trip.startDate + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (dayNum - 1));
  return d.toISOString().split('T')[0];
}

// ============================================================================
// 8. 홈 화면 렌더링 및 여행 상세 전환
// ============================================================================
function renderHomeView() {
  const container = $('homeTripCardsContainer');
  if (!container) return;

  // 홈 헤더 상태 복원
  $('btnHeaderBackToHome')?.classList.add('hidden');
  $('btnHeaderCopyInvite')?.classList.add('hidden');
  $('headerBrandIcon')?.classList.remove('hidden');
  if ($('headerTitleText')) $('headerTitleText').textContent = 'Travel Journal';
  if ($('homeTripCountLabel')) $('homeTripCountLabel').textContent = String(trips.length);

  if (trips.length === 0) {
    container.innerHTML = `
      <div class="py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2">
        <div class="w-11 h-11 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
          <i class="fa-solid fa-suitcase-rolling text-lg"></i>
        </div>
        <p class="text-xs font-extrabold text-slate-700">등록된 여행이 없습니다.</p>
        <p class="text-[11px] text-slate-400">상단의 [새 여행 만들기] 버튼을 눌러 첫 여행을 등록해 보세요!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = trips.map((trip) => {
    const members = Array.isArray(trip.members) ? trip.members : ['나'];
    const memberBadges = members.map((m) =>
      `<span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-semibold">${escapeHtml(m)}</span>`
    ).join('');

    return `
      <div data-action="open-trip" data-trip-id="${escapeHtml(trip.id)}" class="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-sky-300 active:scale-[0.99] transition cursor-pointer space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 mb-1">
              <span class="text-[10px] font-mono font-bold text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded">${escapeHtml(trip.inviteCode)}</span>
              <span class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">${escapeHtml(trip.destination || '여행지')}</span>
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
            ${memberBadges}
          </div>
          <span class="text-xs font-extrabold text-sky-600 shrink-0">열기 <i class="fa-solid fa-chevron-right text-[10px]"></i></span>
        </div>
      </div>
    `;
  }).join('');
}

function enterTripDetail(tripId) {
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return;

  currentTripId = tripId;
  currentMainTab = 'itinerary';
  currentBookingFilter = '전체';
  currentReviewFilter = '전체';

  $('homeView')?.classList.add('hidden');
  $('tripDetailView')?.classList.remove('hidden');

  // 상단 헤더 상세 모드 전환
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
  currentMainTab = tabName;

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
}

// ============================================================================
// 9. 상세 화면 6개 탭 통합 렌더링
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
    const prevVal = Number(sel.value) || 1;
    sel.innerHTML = '';
    for (let i = 1; i <= totalDays; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Day ${i} (${getDateStrForDay(trip, i)})`;
      sel.appendChild(opt);
    }
    sel.value = String(prevVal <= totalDays ? prevVal : 1);
  });

  // 사진 일차 필터 셀렉트 (ALL 옵션 유지)
  const photoFilterSel = $('selectPhotoDayFilter');
  if (photoFilterSel) {
    const prevFilter = photoFilterSel.value || 'ALL';
    photoFilterSel.innerHTML = '<option value="ALL">전체 일차 보기</option>';
    for (let i = 1; i <= totalDays; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Day ${i} (${getDateStrForDay(trip, i)})`;
      photoFilterSel.appendChild(opt);
    }
    photoFilterSel.value = prevFilter;
  }
}

// [탭 1] 일정 렌더링
function renderItineraryTab(trip) {
  const container = $('itineraryTimelineContainer');
  if (!container) return;

  const selectedDay = Number($('selectItineraryDay')?.value) || 1;
  const items = (trip.itineraries || [])
    .filter((s) => Number(s.day) === selectedDay)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  if (items.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-regular fa-calendar-xmark text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">Day ${selectedDay}에 등록된 일정이 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item, idx) => `
    <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs flex items-start gap-3">
      <span class="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
        ${idx + 1}
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-extrabold text-sky-600">${escapeHtml(item.time)}</span>
          <button type="button" data-action="delete-itinerary" data-id="${escapeHtml(item.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="일정 삭제">
            <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
          </button>
        </div>
        <h4 class="text-sm font-bold text-slate-800 truncate">${escapeHtml(item.place)}</h4>
        ${item.memo ? `<p class="text-xs text-slate-500 mt-1 bg-slate-50 p-2 rounded-lg break-words">${escapeHtml(item.memo)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

// [탭 2] 예약 렌더링
function renderBookingsTab(trip) {
  const container = $('bookingCardsContainer');
  if (!container) return;

  const allBookings = trip.bookings || [];
  const filtered = currentBookingFilter === '전체'
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
    '항공': 'bg-sky-100 text-sky-700',
    '숙소': 'bg-indigo-100 text-indigo-700',
    '렌터카': 'bg-amber-100 text-amber-700',
    '티켓/투어': 'bg-emerald-100 text-emerald-700'
  };

  container.innerHTML = [...filtered].reverse().map((b) => {
    const colorCls = badgeColors[b.category] || 'bg-slate-100 text-slate-700';
    return `
      <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] font-extrabold px-2 py-0.5 rounded ${colorCls}">${escapeHtml(b.category)}</span>
              <span class="text-[11px] font-semibold text-slate-400">${escapeHtml(b.date || '')} ${escapeHtml(b.time || '')}</span>
            </div>
            <h4 class="text-sm font-extrabold text-slate-800 mt-1 truncate">${escapeHtml(b.title)}</h4>
          </div>
          <button type="button" data-action="delete-booking" data-id="${escapeHtml(b.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="예약 삭제">
            <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
          </button>
        </div>
        ${b.code ? `<div class="inline-block font-mono text-[11px] bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg">예약번호: <strong>${escapeHtml(b.code)}</strong></div>` : ''}
        ${b.memo ? `<p class="text-xs text-slate-500 bg-slate-50 p-2.5 rounded-xl break-words">${escapeHtml(b.memo)}</p>` : ''}
      </div>
    `;
  }).join('');
}

// [탭 3] 지출/정산 렌더링 (개인 예산 + 1/N 정산 계산)
function renderExpensesTab(trip) {
  const priv = getMyPrivateInfo(trip);
  const me = priv.myNickname;
  const totalBudget = priv.myBudget;
  const expenses = trip.expenses || [];
  const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : [me];

  // 1) 개인 예산 지출 분담액 & 공용 1/N 차액 계산
  let mySpentKrw = 0;
  let groupTotalKrw = 0;
  const netBalance = {};
  members.forEach((m) => { netBalance[m] = 0; });

  expenses.forEach((exp) => {
    const amount = Number(exp.amount) || 0;
    const rate = Number(exp.rateToKrw) || 1;
    const krwTotal = amount * rate;
    groupTotalKrw += krwTotal;

    const participants = Array.isArray(exp.participants) && exp.participants.length > 0
      ? exp.participants
      : [exp.payer || me];
    const perPersonKrw = krwTotal / participants.length;
    const payer = exp.payer || me;

    if (participants.includes(me)) {
      mySpentKrw += perPersonKrw;
    }

    if (netBalance[payer] === undefined) netBalance[payer] = 0;
    netBalance[payer] += krwTotal;

    participants.forEach((p) => {
      if (netBalance[p] === undefined) netBalance[p] = 0;
      netBalance[p] -= perPersonKrw;
    });
  });

  // 개인 예산 카드 UI 반영
  const remainKrw = totalBudget - mySpentKrw;
  const remainPercent = totalBudget > 0 ? Math.min(Math.max((remainKrw / totalBudget) * 100, 0), 100) : 100;

  if ($('myBudgetTotalText')) $('myBudgetTotalText').textContent = `${Math.round(totalBudget).toLocaleString()} KRW`;
  if ($('myBudgetRemainText')) {
    $('myBudgetRemainText').textContent = `${Math.round(remainKrw).toLocaleString()} KRW`;
    $('myBudgetRemainText').className = remainKrw < 0 ? 'text-base font-extrabold text-rose-600' : 'text-base font-extrabold text-sky-600';
  }
  if ($('myBudgetSpentText')) $('myBudgetSpentText').textContent = `${Math.round(mySpentKrw).toLocaleString()} KRW`;
  if ($('myBudgetRemainPercent')) $('myBudgetRemainPercent').textContent = `잔여 ${Math.round(remainPercent)}%`;

  const gaugeBar = $('myBudgetGaugeBar');
  if (gaugeBar) {
    gaugeBar.style.width = `${remainPercent}%`;
    gaugeBar.className = remainPercent >= 50
      ? 'bg-sky-500 h-full rounded-full transition-all duration-300'
      : remainPercent >= 20
        ? 'bg-amber-500 h-full rounded-full transition-all duration-300'
        : 'bg-rose-500 h-full rounded-full transition-all duration-300';
  }

  // 2) 1/N 최소 송금 요약 카드 반영
  if ($('groupTotalExpenseKrw')) {
    $('groupTotalExpenseKrw').textContent = `총 ${Math.round(groupTotalKrw).toLocaleString()}원`;
  }

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
    if (transfers.length === 0) {
      summaryEl.innerHTML = `<p class="text-emerald-300 font-semibold py-1">정산할 송금 차액이 없습니다.</p>`;
    } else {
      summaryEl.innerHTML = transfers.map((t) => `
        <div class="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-xl">
          <span><strong class="text-amber-300">${escapeHtml(t.from)}</strong> ➔ <strong class="text-sky-300">${escapeHtml(t.to)}</strong>에게 송금</span>
          <span class="font-extrabold text-white">${Math.round(t.amount).toLocaleString()}원</span>
        </div>
      `).join('');
    }
  }

  // 3) 공용 지출 내역 리스트
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

  listEl.innerHTML = [...expenses].reverse().map((exp) => {
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
              <h4 class="text-xs font-extrabold text-slate-800 truncate">${escapeHtml(exp.title)}</h4>
            </div>
            <p class="text-[11px] text-slate-500 mt-1">
              결제: <strong class="text-slate-700">${escapeHtml(exp.payer)}</strong> · 참여: ${escapeHtml(participants.join(', '))}
            </p>
            ${curr !== 'KRW' ? `<p class="text-[10px] text-slate-400 mt-0.5">적용 환율 1 ${curr} = ${rate.toFixed(2)} KRW (원화 ${krwVal.toLocaleString()}원)</p>` : ''}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-xs font-extrabold text-slate-800">${amt.toLocaleString()} ${curr}</span>
            <button type="button" data-action="delete-expense" data-id="${escapeHtml(exp.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="지출 삭제">
              <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// [탭 4] 사진 갤러리 렌더링
function renderPhotosTab(trip) {
  const grid = $('photoGalleryGrid');
  if (!grid) return;

  const allPhotos = trip.photos || [];
  const dayFilter = $('selectPhotoDayFilter')?.value || 'ALL';
  const filtered = dayFilter === 'ALL'
    ? allPhotos
    : allPhotos.filter((p) => String(p.day) === String(dayFilter));

  if ($('photoTotalCountBadge')) {
    $('photoTotalCountBadge').textContent = `총 ${filtered.length}장`;
  }

  if (filtered.length === 0) {
    grid.className = 'py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400';
    grid.innerHTML = `
      <i class="fa-solid fa-camera text-2xl mb-1.5 text-slate-300"></i>
      <p class="text-xs">등록된 여행 사진이 없습니다. [사진 추가]로 추억을 남겨보세요!</p>
    `;
    return;
  }

  grid.className = 'grid grid-cols-3 gap-2';
  grid.innerHTML = [...filtered].reverse().map((photo) => `
    <div data-action="view-photo" data-id="${escapeHtml(photo.id)}" class="relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200/60 cursor-pointer group shadow-2xs">
      <img src="${photo.dataUrl}" alt="${escapeHtml(photo.place)}" class="w-full h-full object-cover pointer-events-none" />
      <div class="absolute top-1 left-1 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded pointer-events-none">
        Day ${photo.day}
      </div>
      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-1.5 pointer-events-none">
        <p class="text-[10px] font-bold text-white truncate">${escapeHtml(photo.place || '장소')}</p>
      </div>
    </div>
  `).join('');
}

// [탭 5] 리뷰 렌더링 (평균 별점 + 리뷰 목록 + 수정/삭제)
function renderReviewsTab(trip) {
  const container = $('reviewCardsContainer');
  if (!container) return;

  const allReviews = trip.reviews || [];
  const filtered = currentReviewFilter === '전체'
    ? allReviews
    : allReviews.filter((r) => r.category === currentReviewFilter);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-solid fa-star text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">작성된 리뷰가 없습니다. [리뷰 작성]을 눌러 기록을 남겨보세요!</p>
      </div>
    `;
    return;
  }

  const avgScore = (filtered.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / filtered.length).toFixed(1);

  const summaryBanner = `
    <div class="bg-amber-50/80 border border-amber-200/80 rounded-2xl px-4 py-2.5 flex items-center justify-between">
      <span class="text-xs font-extrabold text-amber-900">평균 만족도 (${filtered.length}건)</span>
      <span class="text-sm font-extrabold text-amber-600">★ ${avgScore} / 5.0</span>
    </div>
  `;

  const cardsHtml = [...filtered].reverse().map((rv) => {
    const ratingNum = Number(rv.rating) || 5;
    const starsStr = '★'.repeat(ratingNum) + '☆'.repeat(5 - ratingNum);
    return `
      <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] font-extrabold px-2 py-0.5 rounded bg-sky-100 text-sky-700">${escapeHtml(rv.category)}</span>
              <span class="text-[10px] font-bold text-slate-400">Day ${rv.day || 1}</span>
              ${rv.revisit ? '<span class="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">재방문 의사 👍</span>' : ''}
              ${rv.author ? `<span class="text-[10px] text-slate-400">by ${escapeHtml(rv.author)}</span>` : ''}
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
      </div>
    `;
  }).join('');

  container.innerHTML = summaryBanner + cardsHtml;
}

// [탭 6] 체크리스트 렌더링
function renderChecklistTab(trip) {
  const container = $('checklistItemsContainer');
  if (!container) return;

  const list = trip.checklists || [];
  const doneCount = list.filter((c) => c.checked).length;
  if ($('checklistSummaryLabel')) {
    $('checklistSummaryLabel').textContent = `${doneCount} / ${list.length} 완료`;
  }

  if (list.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">등록된 준비물이 없습니다.</p>`;
    return;
  }

  container.innerHTML = list.map((item) => `
    <div class="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/70">
      <label class="touch-target flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
        <input type="checkbox" data-action="toggle-checklist" data-id="${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
        <span class="text-xs font-semibold truncate ${item.checked ? 'line-through text-slate-400' : 'text-slate-800'}">${escapeHtml(item.text)}</span>
      </label>
      <button type="button" data-action="delete-checklist" data-id="${escapeHtml(item.id)}" class="touch-target flex items-center justify-center text-slate-300 hover:text-rose-500 transition">
        <i class="fa-solid fa-xmark text-sm pointer-events-none"></i>
      </button>
    </div>
  `).join('');
}

// ============================================================================
// 10. 리뷰 별점 UI 제어 헬퍼
// ============================================================================
function setReviewModalStarRating(ratingVal) {
  const val = Math.min(Math.max(Number(ratingVal) || 5, 1), 5);
  if ($('inputReviewRatingValue')) $('inputReviewRatingValue').value = String(val);

  document.querySelectorAll('.star-rate-btn').forEach((btn) => {
    const btnVal = Number(btn.getAttribute('data-star-val'));
    if (btnVal === val) {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-amber-400 bg-amber-400 text-white text-xs font-extrabold shadow-2xs';
    } else if (btnVal < val) {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-amber-300 bg-amber-50 text-amber-500 text-xs font-extrabold';
    } else {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-xs font-bold';
    }
  });
}

// ============================================================================
// 11. DOMContentLoaded 이후 모든 이벤트 리스너 및 위임 바인딩 (버튼 먹통 원천 차단)
// ============================================================================
let editingReviewId = null;

document.addEventListener('DOMContentLoaded', () => {
  try {
    registerServiceWorkerSafe();
    loadLocalStore();
    const cloudReady = initFirebaseSafely();
    renderHomeView();
    refreshAllRates(false);
    if (cloudReady) {
      startFirestoreRealtimeSync();
    }
  } catch (err) {
    console.error('초기화 예외:', err);
  }

  // --------------------------------------------------------------------------
  // [A] 전역 이벤트 위임 (모달 닫기, 여행 입장/삭제, 항목 삭제, 사진 보기, 리뷰 수정/삭제, 별점 선택)
  // --------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    try {
      // 1) 모든 모달 닫기 버튼 ([data-close-modal])
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        const modalId = closeBtn.getAttribute('data-close-modal');
        closeModalSafe(modalId);
        return;
      }

      // 2) 하단 6개 메인 탭 전환 ([data-main-tab])
      const mainTabBtn = e.target.closest('[data-main-tab]');
      if (mainTabBtn) {
        const tabName = mainTabBtn.getAttribute('data-main-tab');
        if (tabName) switchMainTab(tabName);
        return;
      }

      // 3) 예약 카테고리 필터 칩 ([data-booking-filter])
      const bookingFilterBtn = e.target.closest('[data-booking-filter]');
      if (bookingFilterBtn) {
        currentBookingFilter = bookingFilterBtn.getAttribute('data-booking-filter') || '전체';
        document.querySelectorAll('.booking-filter-chip').forEach((chip) => {
          const active = chip.getAttribute('data-booking-filter') === currentBookingFilter;
          chip.className = active
            ? 'booking-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-extrabold bg-slate-800 text-white'
            : 'booking-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600';
        });
        const trip = getActiveTrip();
        if (trip) renderBookingsTab(trip);
        return;
      }

      // 4) 리뷰 카테고리 필터 칩 ([data-review-filter])
      const reviewFilterBtn = e.target.closest('[data-review-filter]');
      if (reviewFilterBtn) {
        currentReviewFilter = reviewFilterBtn.getAttribute('data-review-filter') || '전체';
        document.querySelectorAll('.review-filter-chip').forEach((chip) => {
          const active = chip.getAttribute('data-review-filter') === currentReviewFilter;
          chip.className = active
            ? 'review-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-extrabold bg-slate-800 text-white'
            : 'review-filter-chip touch-target shrink-0 px-3 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-600';
        });
        const trip = getActiveTrip();
        if (trip) renderReviewsTab(trip);
        return;
      }

      // 5) 리뷰 별점 선택 버튼 ([data-star-val])
      const starBtn = e.target.closest('[data-star-val]');
      if (starBtn) {
        setReviewModalStarRating(starBtn.getAttribute('data-star-val'));
        return;
      }

      // 6) 동적 카드 액션 ([data-action])
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
          saveLocalStore();
          if (isCloudConnected && db) {
            deleteDoc(doc(db, 'trips', tripId)).catch((err) => console.warn(err));
          }
          renderHomeView();
        }
      } else if (action === 'delete-itinerary' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 일정을 삭제하시겠습니까?')) {
          trip.itineraries = (trip.itineraries || []).filter((s) => s.id !== id);
          saveLocalStore();
          syncTripToFirestore(trip);
          renderItineraryTab(trip);
        }
      } else if (action === 'delete-booking' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 예약 내역을 삭제하시겠습니까?')) {
          trip.bookings = (trip.bookings || []).filter((b) => b.id !== id);
          saveLocalStore();
          syncTripToFirestore(trip);
          renderBookingsTab(trip);
        }
      } else if (action === 'delete-expense' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 지출 내역을 삭제하시겠습니까?')) {
          trip.expenses = (trip.expenses || []).filter((ex) => ex.id !== id);
          saveLocalStore();
          syncTripToFirestore(trip);
          renderExpensesTab(trip);
        }
      } else if (action === 'view-photo' && id) {
        const trip = getActiveTrip();
        const photo = trip?.photos?.find((p) => p.id === id);
        if (photo) {
          viewingPhotoId = photo.id;
          if ($('viewPhotoDayAndDate')) $('viewPhotoDayAndDate').textContent = `Day ${photo.day} ${photo.date ? `· ${photo.date}` : ''}`;
          if ($('viewPhotoPlaceTitle')) $('viewPhotoPlaceTitle').textContent = photo.place || '장소 기록';
          if ($('viewPhotoFullImg')) $('viewPhotoFullImg').src = photo.dataUrl;
          if ($('viewPhotoMemoText')) $('viewPhotoMemoText').textContent = photo.memo || '등록된 메모가 없습니다.';
          openModalSafe('modalViewPhoto');
        }
      } else if (action === 'edit-review' && id) {
        const trip = getActiveTrip();
        const rv = trip?.reviews?.find((r) => r.id === id);
        if (rv) {
          editingReviewId = rv.id;
          populateAllDaySelectors(trip);
          if ($('inputReviewPlaceName')) $('inputReviewPlaceName').value = rv.place || '';
          if ($('selectReviewCategory')) $('selectReviewCategory').value = rv.category || '맛집/카페';
          if ($('selectReviewDay')) $('selectReviewDay').value = String(rv.day || 1);
          setReviewModalStarRating(rv.rating || 5);
          if ($('chkReviewRevisit')) $('chkReviewRevisit').checked = Boolean(rv.revisit);
          if ($('inputReviewContent')) $('inputReviewContent').value = rv.content || '';
          openModalSafe('modalAddReview');
        }
      } else if (action === 'delete-review' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 리뷰를 삭제하시겠습니까?')) {
          trip.reviews = (trip.reviews || []).filter((r) => r.id !== id);
          saveLocalStore();
          syncTripToFirestore(trip);
          renderReviewsTab(trip);
        }
      } else if (action === 'delete-checklist' && id) {
        const trip = getActiveTrip();
        if (trip) {
          trip.checklists = (trip.checklists || []).filter((c) => c.id !== id);
          saveLocalStore();
          syncTripToFirestore(trip);
          renderChecklistTab(trip);
        }
      }
    } catch (err) {
      console.error('전역 클릭 이벤트 위임 오류:', err);
    }
  });

  // 체크리스트 체크박스 토글 위임
  document.addEventListener('change', (e) => {
    try {
      const target = e.target;
      if (target && target.getAttribute('data-action') === 'toggle-checklist') {
        const id = target.getAttribute('data-id');
        const trip = getActiveTrip();
        if (trip) {
          const item = (trip.checklists || []).find((c) => c.id === id);
          if (item) {
            item.checked = target.checked;
            saveLocalStore();
            syncTripToFirestore(trip);
            renderChecklistTab(trip);
          }
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
    copyTextSafe(trip.inviteCode, `초대 코드 [${trip.inviteCode}]가 클립보드에 복사되었습니다!`);
  });

  $('btnHeaderRefreshRates')?.addEventListener('click', async () => {
    try {
      await refreshAllRates(true);
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
      const newTrip = normalizeTripData({
        id: newTripId,
        inviteCode: generateInviteCode(),
        memberIds: [deviceUid],
        title,
        destination,
        startDate,
        endDate,
        baseCurrency,
        members,
        itineraries: [],
        bookings: [],
        expenses: [],
        photos: [],
        reviews: [],
        checklists: [
          { id: 'ck_1', text: '여권 및 항공권 e-티켓', checked: false },
          { id: 'ck_2', text: '보조배터리 및 충전 케이블', checked: false }
        ]
      });

      // 개인 예산은 localStorage에만 저장하여 일행과 격리
      privateBudgets[newTripId] = {
        myBudget,
        myNickname: members[0]
      };

      trips.unshift(newTrip);
      saveLocalStore();
      closeModalSafe('modalNewTrip');
      enterTripDetail(newTripId);
      await syncTripToFirestore(newTrip);
    } catch (err) {
      console.error('새 여행 생성 예외:', err);
      alert('여행을 생성하는 중 오류가 발생했습니다.');
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
        if (!localFound.members.includes(nickname)) {
          localFound.members.push(nickname);
        }
        privateBudgets[localFound.id] = {
          myBudget: privateBudgets[localFound.id]?.myBudget || 0,
          myNickname: nickname
        };
        saveLocalStore();
        if ($('inputJoinInviteCode')) $('inputJoinInviteCode').value = '';
        if ($('inputJoinUserNickname')) $('inputJoinUserNickname').value = '';
        enterTripDetail(localFound.id);
        return;
      }

      if (!isCloudConnected || !db) {
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

      const joinedTrip = normalizeTripData({ id: targetDoc.id, ...data, members: updatedMembers });
      trips = [joinedTrip, ...trips.filter((t) => t.id !== targetDoc.id)];
      saveLocalStore();

      if ($('inputJoinInviteCode')) $('inputJoinInviteCode').value = '';
      if ($('inputJoinUserNickname')) $('inputJoinUserNickname').value = '';
      enterTripDetail(targetDoc.id);
    } catch (err) {
      console.error('초대 코드 합류 예외:', err);
      alert('여행 합류 중 오류가 발생했습니다.');
    }
  });

  // --------------------------------------------------------------------------
  // [D] 탭 1: 일정(Itinerary) 바인딩
  // --------------------------------------------------------------------------
  $('selectItineraryDay')?.addEventListener('change', () => {
    const trip = getActiveTrip();
    if (trip) renderItineraryTab(trip);
  });

  $('btnOpenAddScheduleModal')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      populateAllDaySelectors(trip);
      const selectedDay = $('selectItineraryDay')?.value || '1';
      if ($('selectModalScheduleDay')) $('selectModalScheduleDay').value = selectedDay;
      if ($('inputModalScheduleTime')) $('inputModalScheduleTime').value = '10:00';
      if ($('inputModalSchedulePlace')) $('inputModalSchedulePlace').value = '';
      if ($('inputModalScheduleMemo')) $('inputModalScheduleMemo').value = '';
      openModalSafe('modalAddSchedule');
    } catch (err) {
      console.error('일정 추가 모달 열기 예외:', err);
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
      trip.itineraries.push({
        id: 'it_' + Date.now(),
        day,
        time,
        place,
        memo
      });

      if ($('selectItineraryDay')) $('selectItineraryDay').value = String(day);
      saveLocalStore();
      closeModalSafe('modalAddSchedule');
      renderItineraryTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('일정 저장 예외:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [E] 탭 2: 예약(Bookings) 바인딩
  // --------------------------------------------------------------------------
  $('btnOpenAddBookingModal')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      if ($('selectBookingCategory')) $('selectBookingCategory').value = '항공';
      if ($('inputBookingDate')) $('inputBookingDate').value = trip.startDate || '';
      if ($('inputBookingTitle')) $('inputBookingTitle').value = '';
      if ($('inputBookingTime')) $('inputBookingTime').value = '10:00';
      if ($('inputBookingCode')) $('inputBookingCode').value = '';
      if ($('inputBookingMemo')) $('inputBookingMemo').value = '';
      openModalSafe('modalAddBooking');
    } catch (err) {
      console.error('예약 추가 모달 열기 예외:', err);
    }
  });

  $('formCreateBooking')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const category = $('selectBookingCategory')?.value || '항공';
      const date = $('inputBookingDate')?.value || '';
      const title = ($('inputBookingTitle')?.value || '').trim();
      const time = $('inputBookingTime')?.value || '';
      const code = ($('inputBookingCode')?.value || '').trim().toUpperCase();
      const memo = ($('inputBookingMemo')?.value || '').trim();
      if (!title) return;

      if (!Array.isArray(trip.bookings)) trip.bookings = [];
      trip.bookings.push({
        id: 'bk_' + Date.now(),
        category,
        date,
        title,
        time,
        code,
        memo
      });

      saveLocalStore();
      closeModalSafe('modalAddBooking');
      renderBookingsTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('예약 저장 예외:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [F] 탭 3: 지출/정산(Expenses) & 개인 예산 바인딩
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
    saveLocalStore();
    $('formUpdatePrivateBudget')?.classList.add('hidden');
    renderExpensesTab(trip);
  });

  $('btnOpenAddExpenseModal')?.addEventListener('click', async () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;

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
        payerSel.innerHTML = members.map((m) =>
          `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`
        ).join('');
        if (members.includes(priv.myNickname)) {
          payerSel.value = priv.myNickname;
        }
      }

      const groupEl = $('expParticipantsCheckboxGroup');
      if (groupEl) {
        groupEl.innerHTML = members.map((m) => `
          <label class="flex items-center gap-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer">
            <input type="checkbox" value="${escapeHtml(m)}" checked class="exp-participant-chk w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
            <span>${escapeHtml(m)}</span>
          </label>
        `).join('');
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
      const rateToKrw = currency === 'KRW' ? 1 : (Number($('inputExpAppliedRate')?.value) || 1);
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

      saveLocalStore();
      closeModalSafe('modalAddExpense');
      renderExpensesTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('지출 저장 예외:', err);
      alert('지출 내역 저장 중 오류가 발생했습니다.');
    }
  });

  // --------------------------------------------------------------------------
  // [G] 탭 4: 사진(Photos) 바인딩 (Canvas 최대 가로 800px, JPEG 0.7 압축 -> Base64)
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
      if ($('inputPhotoDate')) $('inputPhotoDate').value = trip.startDate || new Date().toISOString().split('T')[0];
      if ($('inputPhotoPlace')) $('inputPhotoPlace').value = '';
      if ($('inputPhotoMemo')) $('inputPhotoMemo').value = '';
      openModalSafe('modalAddPhoto');
    } catch (err) {
      console.error('사진 추가 모달 열기 예외:', err);
    }
  });

  // 파일 선택 시 즉시 미리보기 표시
  $('inputPhotoFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const previewDataUrl = await compressImageToBase64(file);
      if ($('imgPhotoUploadPreview')) $('imgPhotoUploadPreview').src = previewDataUrl;
      $('photoPreviewWrapper')?.classList.remove('hidden');
    } catch (err) {
      console.error('이미지 미리보기 생성 오류:', err);
    }
  });

  $('formCreatePhoto')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const fileInput = $('inputPhotoFile');
      const file = fileInput?.files?.[0];
      if (!file) {
        alert('업로드할 사진 파일을 선택해주세요.');
        return;
      }

      const submitBtn = $('btnSubmitCreatePhoto');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '압축 및 저장 중...';
      }

      const compressedBase64 = await compressImageToBase64(file);
      const day = Number($('selectPhotoDay')?.value) || 1;
      const date = $('inputPhotoDate')?.value || '';
      const place = ($('inputPhotoPlace')?.value || '').trim() || '여행 스냅';
      const memo = ($('inputPhotoMemo')?.value || '').trim();

      if (!Array.isArray(trip.photos)) trip.photos = [];
      trip.photos.push({
        id: 'ph_' + Date.now(),
        day,
        date,
        place,
        memo,
        dataUrl: compressedBase64,
        createdAt: new Date().toISOString()
      });

      saveLocalStore();
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

  $('btnDeleteViewingPhoto')?.addEventListener('click', async () => {
    const trip = getActiveTrip();
    if (!trip || !viewingPhotoId) return;
    if (confirm('이 사진을 삭제하시겠습니까?')) {
      trip.photos = (trip.photos || []).filter((p) => p.id !== viewingPhotoId);
      viewingPhotoId = null;
      saveLocalStore();
      closeModalSafe('modalViewPhoto');
      renderPhotosTab(trip);
      await syncTripToFirestore(trip);
    }
  });

  // --------------------------------------------------------------------------
  // [H] 탭 5: 리뷰(Reviews) 바인딩 (등록 / 수정 / 삭제)
  // --------------------------------------------------------------------------
  $('btnOpenAddReviewModal')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      editingReviewId = null;
      populateAllDaySelectors(trip);
      if ($('inputReviewPlaceName')) $('inputReviewPlaceName').value = '';
      if ($('selectReviewCategory')) $('selectReviewCategory').value = '맛집/카페';
      if ($('selectReviewDay')) $('selectReviewDay').value = '1';
      setReviewModalStarRating(5);
      if ($('chkReviewRevisit')) $('chkReviewRevisit').checked = true;
      if ($('inputReviewContent')) $('inputReviewContent').value = '';
      openModalSafe('modalAddReview');
    } catch (err) {
      console.error('리뷰 작성 모달 열기 예외:', err);
    }
  });

  $('formCreateReview')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const priv = getMyPrivateInfo(trip);
      const place = ($('inputReviewPlaceName')?.value || '').trim();
      const category = $('selectReviewCategory')?.value || '맛집/카페';
      const day = Number($('selectReviewDay')?.value) || 1;
      const rating = Number($('inputReviewRatingValue')?.value) || 5;
      const revisit = Boolean($('chkReviewRevisit')?.checked);
      const content = ($('inputReviewContent')?.value || '').trim();

      if (!place || !content) return;
      if (!Array.isArray(trip.reviews)) trip.reviews = [];

      if (editingReviewId) {
        const idx = trip.reviews.findIndex((r) => r.id === editingReviewId);
        if (idx !== -1) {
          trip.reviews[idx] = {
            ...trip.reviews[idx],
            place,
            category,
            day,
            rating,
            revisit,
            content
          };
        }
        editingReviewId = null;
      } else {
        trip.reviews.push({
          id: 'rv_' + Date.now(),
          place,
          category,
          day,
          rating,
          revisit,
          content,
          author: priv.myNickname,
          createdAt: new Date().toISOString()
        });
      }

      saveLocalStore();
      closeModalSafe('modalAddReview');
      renderReviewsTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('리뷰 저장 예외:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [I] 탭 6: 체크리스트 / JSON 백업·복원 / 인쇄·PDF 저장 바인딩
  // --------------------------------------------------------------------------
  $('formAddChecklistItem')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      const text = ($('inputNewChecklistText')?.value || '').trim();
      if (!text) return;

      if (!Array.isArray(trip.checklists)) trip.checklists = [];
      trip.checklists.unshift({
        id: 'ck_' + Date.now(),
        text,
        checked: false
      });

      if ($('inputNewChecklistText')) $('inputNewChecklistText').value = '';
      saveLocalStore();
      renderChecklistTab(trip);
      await syncTripToFirestore(trip);
    } catch (err) {
      console.error('체크리스트 추가 예외:', err);
    }
  });

  $('btnExportJsonData')?.addEventListener('click', () => {
    try {
      const exportObj = {
        app: 'Travel Journal',
        version: 3,
        exportedAt: new Date().toISOString(),
        trips,
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
      console.error('JSON 백업 내보내기 오류:', err);
      alert('JSON 파일 생성 중 오류가 발생했습니다.');
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
          trips = parsed.trips.map(normalizeTripData).filter(Boolean);
          if (parsed.privateBudgets && typeof parsed.privateBudgets === 'object') {
            privateBudgets = { ...privateBudgets, ...parsed.privateBudgets };
          }
          saveLocalStore();
          if (isCloudConnected && db) {
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
        console.error('JSON 복원 오류:', err);
        alert('JSON 파일을 읽는 중 오류가 발생했습니다.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('btnPrintTripReport')?.addEventListener('click', () => {
    try {
      window.print();
    } catch (err) {
      console.error('인쇄 호출 오류:', err);
    }
  });
});
