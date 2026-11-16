/**
 * Travel Journal PWA - app.js (ES Module)
 * Firebase Firestore v10 실시간 동기화 + LocalStorage 영구 보존 안정성 (마이그레이션 방어)
 * document.body 이벤트 위임(addEventListener)으로 모든 버튼·탭 동작 100% 보장
 * [최종 반영]
 * 1. 여행 인원 참여 상태 UI 어색함 해결 ([참여 완료 ✓] / [대기 중] 배지 적용)
 * 2. 여행 기본정보 닉네임 변경 시 기존 참여자 자동 반영 연동
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
  getCachedRateToKrw,
  AIRPORT_KO_MAP,
  calcDistance,
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

// 초대 코드 합류 대기 중인 여행 객체
let pendingJoinTrip = null;

let leafletMap = null;
let leafletLayerGroup = null;

// ============================================================================
// 2. 방어형 DOM 헬퍼 및 유틸리티
// ============================================================================
function $(id) {
  return document.getElementById(id);
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
// 3. index.html 수정 없이 UI 구조를 자동 보정·주입하는 헬퍼 함수
// ============================================================================
function setupDynamicDomEnhancements() {
  const oldDaySelect = $('selectItineraryDay');
  if (oldDaySelect) {
    oldDaySelect.classList.add('hidden');
    oldDaySelect.style.display = 'none';
  }

  const joinNameInput = $('inputJoinUserNickname');
  const joinCodeInput = $('inputJoinInviteCode');
  if (joinNameInput) {
    joinNameInput.required = false;
    joinNameInput.classList.add('hidden');
    joinNameInput.style.display = 'none';
  }
  if (joinCodeInput) {
    joinCodeInput.classList.remove('col-span-3');
    joinCodeInput.classList.add('col-span-5', 'w-full');
    joinCodeInput.placeholder = '초대 코드 입력 (예: TR-XXXX)';
  }

  const membersInput = $('inputNewTripMembers');
  if (membersInput && !$('inputNewTripHeadcount')) {
    const wrapper = membersInput.parentElement;
    if (wrapper) {
      const hcDiv = document.createElement('div');
      hcDiv.className = 'mb-3';
      hcDiv.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs font-semibold text-slate-600">총 참여 인원수 (생성자 포함)</label>
          <span class="text-[10px] font-bold text-sky-600">지정된 인원만 참여 가능</span>
        </div>
        <input id="inputNewTripHeadcount" type="number" min="1" max="30" value="2" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-extrabold outline-none focus:border-sky-500" required />
      `;
      wrapper.parentNode.insertBefore(hcDiv, wrapper);
      const labelEl = wrapper.querySelector('label');
      if (labelEl) {
        labelEl.textContent = '참여자 닉네임 목록 (첫 번째가 생성자 본인, 쉼표 구분)';
      }
    }
  }

  if (!$('modalSelectJoinMember')) {
    const modalsHtml = `
      <div id="modalSelectJoinMember" class="hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white w-full max-w-sm rounded-2xl p-5 border border-slate-200 shadow-xl space-y-4">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 id="joinModalTripTitle" class="text-sm font-extrabold text-slate-800">여행 합류하기</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">생성자가 지정한 동행자 중 본인의 이름을 체크하세요.</p>
            </div>
            <button type="button" data-close-modal="modalSelectJoinMember" class="touch-target text-slate-400 hover:text-slate-600">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <form id="formConfirmJoinMember" class="space-y-3">
            <div id="joinMemberCheckboxList" class="space-y-2 max-h-60 overflow-y-auto no-scrollbar py-1"></div>
            <div>
              <label class="text-xs font-semibold text-slate-600 block mb-1">내 개인 예산 설정 (KRW, 나만 보기)</label>
              <input id="inputJoinMemberBudget" type="number" min="0" step="1000" value="1000000" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-bold outline-none focus:border-sky-500" />
            </div>
            <div class="pt-2 flex justify-end gap-2">
              <button type="button" data-close-modal="modalSelectJoinMember" class="touch-target px-4 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100">취소</button>
              <button id="btnConfirmJoinMemberSubmit" type="submit" class="touch-target px-5 rounded-xl text-xs font-extrabold text-white bg-sky-600 hover:bg-sky-700">선택 완료 및 합류</button>
            </div>
          </form>
        </div>
      </div>

      <div id="modalEditTripInfo" class="hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white w-full max-w-sm rounded-2xl p-5 border border-slate-200 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div>
              <h3 class="text-sm font-extrabold text-slate-800">⚙️ 여행 기본 정보 및 인원 수정</h3>
              <p class="text-[11px] text-slate-500">생성자(방장) 전용 설정입니다.</p>
            </div>
            <button type="button" data-close-modal="modalEditTripInfo" class="touch-target text-slate-400 hover:text-slate-600">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <form id="formEditTripInfo" class="space-y-3">
            <div>
              <label class="text-xs font-semibold text-slate-600 block mb-1">여행 제목</label>
              <input id="inputEditTripTitle" type="text" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-medium outline-none focus:border-sky-500" required />
            </div>
            <div>
              <label class="text-xs font-semibold text-slate-600 block mb-1">여행지 (도시 / 국가)</label>
              <input id="inputEditTripDestination" type="text" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-medium outline-none focus:border-sky-500" required />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-xs font-semibold text-slate-600 block mb-1">시작일</label>
                <input id="inputEditTripStartDate" type="date" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-medium outline-none focus:border-sky-500" required />
              </div>
              <div>
                <label class="text-xs font-semibold text-slate-600 block mb-1">종료일</label>
                <input id="inputEditTripEndDate" type="date" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-medium outline-none focus:border-sky-500" required />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-xs font-semibold text-slate-600 block mb-1">기본 통화</label>
                <select id="selectEditTripCurrency" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-bold outline-none focus:border-sky-500">
                  <option value="KRW">KRW (원)</option>
                  <option value="JPY">JPY (엔)</option>
                  <option value="USD">USD (달러)</option>
                  <option value="EUR">EUR (유로)</option>
                </select>
              </div>
              <div>
                <label class="text-xs font-semibold text-slate-600 block mb-1">총 참여 인원수(명)</label>
                <input id="inputEditTripHeadcount" type="number" min="1" max="30" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-extrabold outline-none focus:border-sky-500" required />
              </div>
            </div>
            <div>
              <label class="text-xs font-semibold text-slate-600 block mb-1">참여자 닉네임 목록 (첫 번째가 생성자, 쉼표 구분)</label>
              <input id="inputEditTripMembers" type="text" placeholder="예: 나, 동행1, 동행2" class="touch-target w-full bg-slate-50 border border-slate-200 rounded-xl px-3 text-xs font-medium outline-none focus:border-sky-500" required />
              <p class="text-[10px] text-slate-400 mt-1">※ 닉네임 변경 시 기존 참여 상태가 자동 승계됩니다.</p>
            </div>
            <div class="pt-2 flex justify-end gap-2">
              <button type="button" data-close-modal="modalEditTripInfo" class="touch-target px-4 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100">취소</button>
              <button type="submit" class="touch-target px-5 rounded-xl text-xs font-extrabold text-white bg-sky-600 hover:bg-sky-700">수정 내용 저장</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalsHtml);
  }
}

// ============================================================================
// 4. Firebase 초기화 & 데이터 유실 방지 로컬 마이그레이션 스토리지
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
  const members = Array.isArray(raw.members) && raw.members.length > 0 ? raw.members : ['나'];
  const ownerUid = raw.ownerUid || raw.memberIds?.[0] || deviceUid;

  const claimedMembers =
    raw.claimedMembers && typeof raw.claimedMembers === 'object'
      ? { ...raw.claimedMembers }
      : {};
  if (members[0] && !claimedMembers[members[0]]) {
    claimedMembers[members[0]] = ownerUid;
  }

  return {
    id: raw.id || 'trip_' + Date.now(),
    inviteCode: raw.inviteCode || generateInviteCode(),
    ownerUid,
    memberIds: Array.isArray(raw.memberIds) ? raw.memberIds : [ownerUid],
    title: raw.title || '나의 여행',
    destination: raw.destination || '여행지',
    startDate: raw.startDate || '2026-11-12',
    endDate: raw.endDate || '2026-11-15',
    baseCurrency: raw.baseCurrency || 'KRW',
    maxMembers: Number(raw.maxMembers) || members.length,
    members,
    claimedMembers,
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
  const tripKeys = [
    STORAGE_TRIPS_KEY,
    'TJ_TRIPS_ARCHIVE_V7',
    'TJ_TRIPS_ARCHIVE_V6',
    'TJ_TRIPS_ARCHIVE_V5',
    'TRAVEL_JOURNAL_TRIPS_V1'
  ];

  const mergedTripsMap = new Map();
  for (const k of tripKeys) {
    try {
      const data = localStorage.getItem(k);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            const norm = normalizeTrip(item);
            if (norm && !mergedTripsMap.has(norm.id)) {
              mergedTripsMap.set(norm.id, norm);
            }
          });
        }
      }
    } catch (err) {}
  }
  trips = Array.from(mergedTripsMap.values());

  const privKeys = [
    STORAGE_PRIVATE_KEY,
    'TJ_PRIVATE_BUDGETS_V7',
    'TJ_PRIVATE_BUDGETS_V6',
    'TJ_PRIVATE_BUDGETS_V5',
    'TRAVEL_JOURNAL_PRIVATE_BUDGETS_V1'
  ];
  for (const pk of privKeys) {
    try {
      const pData = localStorage.getItem(pk);
      if (pData) {
        const parsedPriv = JSON.parse(pData);
        if (parsedPriv && typeof parsedPriv === 'object') {
          privateBudgets = { ...parsedPriv, ...privateBudgets };
        }
      }
    } catch (e) {}
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
    const payload = normalizeTrip(trip);
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
// 5. 날짜/일수 및 환율 미리보기 유틸리티
// ============================================================================
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const parts = String(dateStr).split('T')[0].split('-');
  if (parts.length === 3) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  return new Date(dateStr);
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  d.setDate(d.getDate() + (Number(dayNum) - 1));
  return formatLocalDate(d);
}

function inferDayNumberFromDate(trip, dateStr) {
  if (!trip || !trip.startDate || !dateStr) return 1;
  const s = parseLocalDate(trip.startDate);
  const target = parseLocalDate(dateStr);
  const diffTime = target.getTime() - s.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  const total = calculateTripDays(trip);
  if (diffDays < 1) return 1;
  if (diffDays > total) return total;
  return diffDays;
}

function updateHotelStayDurationBadge() {
  const badge = $('hotelStayDurationBadge');
  const inDateStr = $('inputHotelCheckInDate')?.value;
  const outDateStr = $('inputHotelCheckOutDate')?.value;
  if (!badge || !inDateStr || !outDateStr) return;

  const s = parseLocalDate(inDateStr);
  const e = parseLocalDate(outDateStr);
  const diffNights = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  if (diffNights > 0) {
    badge.textContent = `${diffNights}박 ${diffNights + 1}일`;
  } else {
    badge.textContent = '당일 / 일정 확인';
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
        const claimed = trip.claimedMembers || {};
        
        // [항목 1 반영] 인원 닉네임 옆에 슬래시 대신 [참여 완료 ✓] / [대기 중] 배지로 깔끔하게 분리
        const memberTags = members
          .map((m, idx) => {
            const isClaimed = idx === 0 || Boolean(claimed[m]);
            return `
              <span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold ${
                isClaimed
                  ? 'bg-sky-50 text-sky-700 border border-sky-200'
                  : 'bg-slate-100 text-slate-400 border border-slate-200'
              }">
                ${escapeHtml(m)} <span class="text-[9px] font-semibold">${isClaimed ? '✓ 참여' : '대기'}</span>
              </span>
            `;
          })
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
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[11px] text-slate-500 font-bold mr-1"><i class="fa-solid fa-users text-[10px] text-sky-600 mr-1"></i>정원 ${members.length}명</span>
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

  const combinedReviews = [...allReviews];
  trips.forEach((t) => {
    if (Array.isArray(t.reviews)) {
      t.reviews.forEach((rv) => {
        if (!combinedReviews.find((r) => r.id === rv.id)) {
          combinedReviews.push({ ...rv, tripId: t.id, tripTitle: t.title });
        }
      });
    }
  });

  if ($('homeAllReviewsCount')) $('homeAllReviewsCount').textContent = String(combinedReviews.length);
  if (combinedReviews.length === 0) {
    if ($('homeAllReviewsAvg')) $('homeAllReviewsAvg').textContent = '평균 ★ 0.0';
    container.innerHTML = `<div class="py-8 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400"><p class="text-xs">아직 작성된 전체 리뷰가 없습니다. 여행 상세에서 리뷰를 남겨보세요!</p></div>`;
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
function populateAllDaySelectors(trip) {
  const totalDays = calculateTripDays(trip);
  const selectors = ['selectModalScheduleDay', 'selectReviewDay', 'selectPhotoDay'];
  selectors.forEach((selId) => {
    const el = $(selId);
    if (!el) return;
    const prevVal = el.value;
    el.innerHTML = '';
    for (let i = 1; i <= totalDays; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Day ${i} (${getDateForTripDay(trip, i)})`;
      el.appendChild(opt);
    }
    el.value = prevVal && Number(prevVal) <= totalDays ? prevVal : '1';
  });
}

function renderDetailView() {
  const trip = getActiveTrip();
  if (!trip) {
    exitTripDetailToHome();
    return;
  }

  const priv = getMyPrivateInfo(trip);
  const members = Array.isArray(trip.members) ? trip.members : ['나'];
  const totalDays = calculateTripDays(trip);
  if (currentItineraryDay > totalDays) currentItineraryDay = 1;

  if ($('headerTitleText')) $('headerTitleText').textContent = trip.title;
  if ($('headerInviteCodeValue')) $('headerInviteCodeValue').textContent = trip.inviteCode || 'TR-0000';
  if ($('detailDestinationBadge')) $('detailDestinationBadge').textContent = trip.destination || '여행지';
  if ($('detailBaseCurrencyBadge')) $('detailBaseCurrencyBadge').textContent = trip.baseCurrency || 'KRW';
  if ($('detailTripTitle')) $('detailTripTitle').textContent = trip.title;

  const claimed = trip.claimedMembers || {};
  const membersStatusStr = members
    .map((m, idx) => `${m} ${idx === 0 || claimed[m] ? '✓' : '(대기)'}`)
    .join(', ');

  if ($('detailTripPeriodAndMembers')) {
    $('detailTripPeriodAndMembers').textContent = `${trip.startDate} ~ ${trip.endDate} · 정원 ${members.length}명 (${membersStatusStr})`;
  }
  if ($('detailMyNicknameLabel')) $('detailMyNicknameLabel').textContent = priv.myNickname;

  const isCreator =
    !trip.ownerUid ||
    trip.ownerUid === deviceUid ||
    priv.myNickname === members[0];
  const titleEl = $('detailTripTitle');
  if (titleEl && titleEl.parentElement) {
    let editBtn = $('btnOpenEditTripInfoModal');
    if (!editBtn) {
      editBtn = document.createElement('button');
      editBtn.id = 'btnOpenEditTripInfoModal';
      editBtn.type = 'button';
      editBtn.setAttribute('data-action', 'open-edit-trip-modal');
      editBtn.className =
        'mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-sky-50 text-slate-700 hover:text-sky-700 border border-slate-200 text-[11px] font-extrabold transition';
      editBtn.innerHTML = '<i class="fa-solid fa-gear text-sky-600 pointer-events-none"></i><span class="pointer-events-none">여행 기본 정보 · 인원 수정</span>';
      titleEl.parentElement.appendChild(editBtn);
    }
    editBtn.classList.toggle('hidden', !isCreator);
  }

  populateAllDaySelectors(trip);
  renderDayChipsBar(trip);
  renderItineraryTab(trip);
  renderBookingsTab(trip);
  renderExpensesTab(trip);
  renderPhotosTab(trip);
  renderReviewsTab(trip);
  renderChecklistTab(trip);

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

  const oldSelect = $('selectItineraryDay');
  if (oldSelect) {
    oldSelect.classList.add('hidden');
    oldSelect.style.display = 'none';
  }

  let chipBar = $('itineraryDayChipsBar');
  if (!chipBar) {
    chipBar = document.createElement('div');
    chipBar.id = 'itineraryDayChipsBar';
    chipBar.className = 'flex-1 flex overflow-x-auto no-scrollbar gap-1.5 py-0.5';
    if (oldSelect && oldSelect.parentElement) {
      oldSelect.parentElement.insertBefore(chipBar, oldSelect);
    } else {
      panel.insertBefore(chipBar, panel.firstChild);
    }
  }

  const totalDays = calculateTripDays(trip);
  const chipsHtml = [];
  for (let i = 1; i <= totalDays; i++) {
    const dateStr = getDateForTripDay(trip, i).slice(5);
    const isSelected = Number(currentItineraryDay) === i;
    chipsHtml.push(`
      <button type="button" data-action="select-day-chip" data-day="${i}" class="touch-target shrink-0 px-3 py-1.5 rounded-xl text-xs transition ${
        isSelected
          ? 'bg-sky-600 text-white font-extrabold shadow-2xs'
          : 'bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50'
      }">
        Day ${i} <span class="text-[10px] opacity-80 ml-0.5">(${dateStr})</span>
      </button>
    `);
  }
  chipBar.innerHTML = chipsHtml.join('');
}

function extractCleanPlaceForRoute(rawPlaceStr) {
  const raw = String(rawPlaceStr || '').trim();
  if (!raw) return '';

  if (raw.includes('➔') || raw.includes('->') || raw.includes('→')) {
    const parts = raw.split(/➔|->|→/);
    const arrivalPart = (parts[parts.length - 1] || '').trim();

    const iataMatches = arrivalPart.toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
    for (const code of iataMatches) {
      if (AIRPORT_KO_MAP && AIRPORT_KO_MAP[code]) {
        return AIRPORT_KO_MAP[code].name;
      }
    }

    const cleanedArrival = arrivalPart
      .replace(/\([A-Z]{3}\)/gi, '')
      .replace(/[()[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanedArrival) return cleanedArrival;
  }

  if (raw.startsWith('[항공]')) {
    const iataMatches = raw.toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
    if (iataMatches.length > 0) {
      const lastCode = iataMatches[iataMatches.length - 1];
      if (AIRPORT_KO_MAP && AIRPORT_KO_MAP[lastCode]) {
        return AIRPORT_KO_MAP[lastCode].name;
      }
    }
  }

  let clean = raw
    .replace(/^\[.*?\]\s*/, '')
    .replace(/\b[A-Z]{2}\d{3,4}\b/gi, '')
    .replace(/\([A-Z]{3}\)/gi, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clean || raw;
}

function renderRouteMapAndLinks(trip, dayItems) {
  try {
    const mapContainer = $('leafletRouteMapContainer');
    const linksContainer = $('localRouteLinksList');

    const localStops = (dayItems || [])
      .map((item) => {
        const cleanPlace = extractCleanPlaceForRoute(item.place);
        return {
          ...item,
          cleanPlace
        };
      })
      .filter((s) => Boolean(s.cleanPlace));

    const matchedAirports = [];
    (dayItems || []).forEach((it) => {
      const codes = String(it.place || '').toUpperCase().match(/\b[A-Z]{3}\b/g) || [];
      codes.forEach((code) => {
        if (AIRPORT_KO_MAP && AIRPORT_KO_MAP[code] && !matchedAirports.find((a) => a.code === code)) {
          matchedAirports.push({ code, ...AIRPORT_KO_MAP[code] });
        }
      });
    });

    if (matchedAirports.length === 0) {
      (trip.bookings || []).forEach((bk) => {
        if (bk.category === '항공') {
          const bText = `${bk.title || ''} ${bk.memo || ''} ${JSON.stringify(bk.segments || [])}`.toUpperCase();
          const bCodes = bText.match(/\b[A-Z]{3}\b/g) || [];
          bCodes.forEach((code) => {
            if (AIRPORT_KO_MAP && AIRPORT_KO_MAP[code] && !matchedAirports.find((a) => a.code === code)) {
              matchedAirports.push({ code, ...AIRPORT_KO_MAP[code] });
            }
          });
        }
      });
    }

    if (mapContainer && window.L) {
      if (!leafletMap) {
        leafletMap = window.L.map(mapContainer).setView([35.4922, 133.2364], 6);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap'
        }).addTo(leafletMap);
        leafletLayerGroup = window.L.layerGroup().addTo(leafletMap);
      }

      leafletLayerGroup.clearLayers();
      const latLngs = [];

      matchedAirports.forEach((ap) => {
        if (ap.lat && ap.lng) {
          const marker = window.L.marker([ap.lat, ap.lng]).bindPopup(`✈️ ${ap.name} (${ap.code})`);
          leafletLayerGroup.addLayer(marker);
          latLngs.push([ap.lat, ap.lng]);
        }
      });

      if (latLngs.length > 1) {
        const poly = window.L.polyline(latLngs, { color: '#0284c7', weight: 3, dashArray: '5, 5' });
        leafletLayerGroup.addLayer(poly);
        leafletMap.fitBounds(poly.getBounds(), { padding: [20, 20] });
      } else if (latLngs.length === 1) {
        leafletMap.setView(latLngs[0], 10);
      }
    }

    if (linksContainer) {
      if (localStops.length === 0) {
        linksContainer.innerHTML = `<p class="text-[11px] text-slate-400 text-center py-1">일정을 추가하면 도착 공항 및 장소별 Google Maps 길찾기 바로가기가 생성됩니다.</p>`;
      } else {
        const origin = encodeURIComponent(localStops[0].cleanPlace);
        const dest = encodeURIComponent(localStops[localStops.length - 1].cleanPlace);
        let multiUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=transit`;
        if (localStops.length > 2) {
          const wps = localStops
            .slice(1, -1)
            .map((s) => encodeURIComponent(s.cleanPlace))
            .join('|');
          multiUrl += `&waypoints=${wps}`;
        }

        const singleLinksHtml = localStops
          .map(
            (s, idx) => `
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.cleanPlace)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-[11px] bg-slate-50 hover:bg-sky-50 text-slate-700 hover:text-sky-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold transition">
              <span class="text-sky-600 font-extrabold">${idx + 1}.</span> ${escapeHtml(s.cleanPlace)}
            </a>
          `
          )
          .join('');

        linksContainer.innerHTML = `
          <div class="flex flex-wrap gap-1.5 pb-1">${singleLinksHtml}</div>
          ${
            localStops.length >= 2
              ? `<a href="${multiUrl}" target="_blank" rel="noopener noreferrer" class="block w-full text-center py-2 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-700 text-xs font-extrabold transition">
                  🗺️ Day ${currentItineraryDay} 전체 경로 길찾기 (${escapeHtml(localStops[0].cleanPlace)} ➔ ${escapeHtml(localStops[localStops.length - 1].cleanPlace)})
                </a>`
              : ''
          }
        `;
      }
    }
  } catch (err) {
    console.warn('지도 및 길찾기 렌더링 경고:', err);
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
        <p class="text-xs">Day ${selectedDay}에 등록된 일정이 없습니다. [일정 추가]를 눌러보세요.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items
    .map(
      (item, idx) => `
      <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs flex items-start gap-3">
        <span class="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">${idx + 1}</span>
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
  const totalBudget = priv.myBudget;
  const expenses = trip.expenses || [];
  const members = Array.isArray(trip.members) ? trip.members : ['나'];

  let mySpentKrw = 0;
  let groupTotalKrw = 0;

  expenses.forEach((ex) => {
    const amt = Number(ex.amount) || 0;
    const rate = Number(ex.rateToKrw) || 1;
    const krwVal = Math.round(amt * rate);
    groupTotalKrw += krwVal;

    const parts = Array.isArray(ex.participants) && ex.participants.length > 0 ? ex.participants : [ex.payer];
    if (parts.includes(priv.myNickname)) {
      mySpentKrw += Math.round(krwVal / parts.length);
    }
  });

  const remainKrw = totalBudget - mySpentKrw;
  const remainPercent = totalBudget > 0 ? Math.max(0, Math.min(100, (remainKrw / totalBudget) * 100)) : 100;

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
    let transfers = [];
    try {
      const settled = calculateOneOverNSettlement(expenses, members, priv.myNickname);
      if (settled && Array.isArray(settled.transfers)) {
        transfers = settled.transfers;
      }
    } catch (e) {}

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

  const dayFilter = $('selectPhotoDayFilter')?.value || 'ALL';
  const allPhotos = trip.photos || [];
  let filtered = dayFilter === 'ALL' ? allPhotos : allPhotos.filter((p) => String(p.day) === dayFilter);

  if (currentPhotoFilter !== '전체') {
    filtered = filtered.filter((p) => p.category === currentPhotoFilter);
  }

  if ($('photoTotalCountBadge')) $('photoTotalCountBadge').textContent = `총 ${allPhotos.length}장`;

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

// ============================================================================
// 8. 모달 열기 헬퍼 함수들
// ============================================================================
function syncMemberNamesWithHeadcount(headcountInputId, membersInputId) {
  const hcEl = $(headcountInputId);
  const memEl = $(membersInputId);
  if (!hcEl || !memEl) return;

  const targetCount = Math.max(1, Math.min(30, Number(hcEl.value) || 1));
  let currentList = memEl.value
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  if (currentList.length === 0) currentList = ['나'];

  while (currentList.length < targetCount) {
    currentList.push(`동행${currentList.length}`);
  }
  if (currentList.length > targetCount) {
    currentList = currentList.slice(0, targetCount);
  }
  memEl.value = currentList.join(', ');
}

function openNewTripModal() {
  const today = new Date().toISOString().split('T')[0];
  if ($('inputNewTripTitle')) $('inputNewTripTitle').value = '';
  if ($('inputNewTripDestination')) $('inputNewTripDestination').value = '';
  if ($('inputNewTripStartDate')) $('inputNewTripStartDate').value = today;
  if ($('inputNewTripEndDate')) $('inputNewTripEndDate').value = today;
  if ($('selectNewTripCurrency')) $('selectNewTripCurrency').value = 'KRW';
  if ($('inputNewTripMyBudget')) $('inputNewTripMyBudget').value = '1500000';
  if ($('inputNewTripHeadcount')) $('inputNewTripHeadcount').value = '2';
  if ($('inputNewTripMembers')) $('inputNewTripMembers').value = '나, 동행1';
  openModalSafe('modalNewTrip');
}

function openEditTripInfoModal() {
  const trip = getActiveTrip();
  if (!trip) return;
  const members = Array.isArray(trip.members) ? trip.members : ['나'];

  if ($('inputEditTripTitle')) $('inputEditTripTitle').value = trip.title || '';
  if ($('inputEditTripDestination')) $('inputEditTripDestination').value = trip.destination || '';
  if ($('inputEditTripStartDate')) $('inputEditTripStartDate').value = trip.startDate || '';
  if ($('inputEditTripEndDate')) $('inputEditTripEndDate').value = trip.endDate || '';
  if ($('selectEditTripCurrency')) $('selectEditTripCurrency').value = trip.baseCurrency || 'KRW';
  if ($('inputEditTripHeadcount')) $('inputEditTripHeadcount').value = String(members.length);
  if ($('inputEditTripMembers')) $('inputEditTripMembers').value = members.join(', ');

  openModalSafe('modalEditTripInfo');
}

function openJoinMemberSelectionModal(trip) {
  pendingJoinTrip = trip;
  const members = Array.isArray(trip.members) ? trip.members : ['나'];
  const creatorName = members[0];
  const companionNames = members.slice(1);
  const claimed = trip.claimedMembers || {};

  if ($('joinModalTripTitle')) {
    $('joinModalTripTitle').textContent = `[${trip.title}] 참여자 선택`;
  }

  const listEl = $('joinMemberCheckboxList');
  const submitBtn = $('btnConfirmJoinMemberSubmit');
  if (!listEl) return;

  if (companionNames.length === 0) {
    listEl.innerHTML = `
      <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
        이 여행은 1인 여행(${escapeHtml(creatorName)})으로 설정되어 있어 추가 합류할 수 있는 동행자 명단이 없습니다.<br/>
        <span class="text-[11px] font-normal text-rose-600">여행 생성자에게 [여행 기본 정보 · 인원 수정]에서 인원 추가를 요청하세요.</span>
      </div>
    `;
    if (submitBtn) submitBtn.disabled = true;
    openModalSafe('modalSelectJoinMember');
    return;
  }

  let availableCount = 0;
  let precheckedDone = false;

  const itemsHtml = companionNames
    .map((name) => {
      const holderUid = claimed[name];
      const isTakenByOther = Boolean(holderUid && holderUid !== deviceUid);
      const isMine = holderUid === deviceUid;

      if (!isTakenByOther) availableCount++;

      let checkedAttr = '';
      if (!isTakenByOther && (isMine || !precheckedDone)) {
        checkedAttr = 'checked';
        precheckedDone = true;
      }

      return `
        <label class="flex items-center justify-between p-3 rounded-xl border transition ${
          isTakenByOther
            ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed'
            : 'bg-slate-50 hover:bg-sky-50/60 border-slate-200 cursor-pointer'
        }">
          <div class="flex items-center gap-2.5">
            <input
              type="checkbox"
              name="joinMemberCheckbox"
              value="${escapeHtml(name)}"
              ${checkedAttr}
              ${isTakenByOther ? 'disabled' : ''}
              class="join-member-chk w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span class="text-xs font-extrabold ${isTakenByOther ? 'line-through text-slate-400' : 'text-slate-800'}">
              ${escapeHtml(name)}
            </span>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded ${
            isTakenByOther
              ? 'bg-slate-200 text-slate-500'
              : isMine
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-sky-100 text-sky-700'
          }">
            ${isTakenByOther ? '참여 완료 (선택 불가)' : isMine ? '내 기존 선택' : '선택 가능'}
          </span>
        </label>
      `;
    })
    .join('');

  listEl.innerHTML = `
    <div class="px-2 py-1.5 rounded-lg bg-slate-100 text-[11px] text-slate-600 flex items-center justify-between">
      <span>👑 여행 생성자(방장): <strong>${escapeHtml(creatorName)}</strong></span>
      <span>동행 정원: ${companionNames.length}명</span>
    </div>
    ${itemsHtml}
  `;

  if (submitBtn) {
    submitBtn.disabled = availableCount === 0;
  }

  openModalSafe('modalSelectJoinMember');
}

function renderBookingDynamicFields(category, existingData = null) {
  const trip = getActiveTrip();
  const flightMultiBox = $('bookingFlightMultiBox');
  const hotelStayBox = $('bookingHotelStayBox');
  const standardDateBox = $('bookingStandardDateBox');

  if (flightMultiBox || hotelStayBox || standardDateBox) {
    if (flightMultiBox) flightMultiBox.classList.toggle('hidden', category !== '항공');
    if (hotelStayBox) hotelStayBox.classList.toggle('hidden', category !== '숙소');
    if (standardDateBox) standardDateBox.classList.toggle('hidden', category === '항공' || category === '숙소');

    if (category === '항공') {
      const segContainer = $('flightSegmentsContainer') || $('flightSegmentsListContainer');
      if (!segContainer) return;

      const segments = existingData?.segments || [
        {
          flightNo: existingData?.code || '',
          airline: existingData?.airline || '',
          dep: existingData?.dep || '',
          arr: existingData?.arr || '',
          date: existingData?.date || trip?.startDate || '',
          time: existingData?.time || '10:00'
        }
      ];

      segContainer.innerHTML = segments
        .map(
          (seg, idx) => `
          <div class="flight-segment-row bg-white border border-sky-200 rounded-xl p-2.5 space-y-2 relative" data-index="${idx}">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold text-sky-800">구간 ${idx + 1}</span>
              ${segments.length > 1 ? '<button type="button" data-action="remove-flight-segment" class="text-rose-500 text-xs px-1 hover:underline">삭제</button>' : ''}
            </div>
            <div class="flex gap-1.5">
              <input type="text" placeholder="편명 (예: RS471)" value="${escapeHtml(seg.flightNo || '')}" class="seg-flight-code touch-target flex-1 uppercase font-mono bg-slate-50 border border-slate-200 rounded-lg px-2.5 text-xs font-bold outline-none" />
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
        .join('');
    } else if (category === '숙소') {
      if ($('inputHotelCheckInDate')) {
        $('inputHotelCheckInDate').value =
          existingData?.hotel?.checkInDate || existingData?.date || trip?.startDate || '';
      }
      if ($('inputHotelCheckOutDate')) {
        $('inputHotelCheckOutDate').value =
          existingData?.hotel?.checkOutDate || trip?.endDate || trip?.startDate || '';
      }
      if ($('inputHotelCheckInTime')) {
        $('inputHotelCheckInTime').value = existingData?.hotel?.checkInTime || '15:00';
      }
      if ($('inputHotelCheckOutTime')) {
        $('inputHotelCheckOutTime').value = existingData?.hotel?.checkOutTime || '11:00';
      }
      updateHotelStayDurationBadge();
    } else {
      if ($('inputBookingDate')) {
        $('inputBookingDate').value = existingData?.date || trip?.startDate || '';
      }
      if ($('inputBookingTime')) {
        $('inputBookingTime').value = existingData?.time || '10:00';
      }
    }
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
  renderBookingDynamicFields('항공', { date: trip.startDate || '' });

  if ($('inputBookingTitle')) $('inputBookingTitle').value = '';
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

function openAddExpenseModal() {
  const trip = getActiveTrip();
  if (!trip) return;
  editingExpenseId = null;
  if ($('modalExpenseHeading')) $('modalExpenseHeading').textContent = '지출 내역 추가';

  const priv = getMyPrivateInfo(trip);
  const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : [priv.myNickname];

  if ($('inputExpTitle')) $('inputExpTitle').value = '';
  if ($('selectExpCurrency')) $('selectExpCurrency').value = trip.baseCurrency || 'KRW';
  if ($('inputExpAmount')) $('inputExpAmount').value = '';
  if ($('inputExpAppliedRate')) $('inputExpAppliedRate').value = '1';
  if ($('expRateStatusText')) $('expRateStatusText').textContent = '적용 환율 (1 KRW = 1 KRW)';
  if ($('expRateUnitPrefix')) $('expRateUnitPrefix').textContent = '1 KRW =';
  if ($('expConvertedKrwPreview')) $('expConvertedKrwPreview').textContent = '0 KRW';

  if ($('selectExpPayer')) {
    $('selectExpPayer').innerHTML = members
      .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
      .join('');
    $('selectExpPayer').value = priv.myNickname;
  }
  if ($('expParticipantsCheckboxGroup')) {
    $('expParticipantsCheckboxGroup').innerHTML = members
      .map(
        (m) => `
        <label class="flex items-center gap-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer">
          <input type="checkbox" value="${escapeHtml(m)}" checked class="exp-participant-chk w-4 h-4 rounded border-slate-300 text-sky-600" />
          <span>${escapeHtml(m)}</span>
        </label>
      `
      )
      .join('');
  }

  openModalSafe('modalAddExpense');
  syncExpenseModalRateFromApi();
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

function setReviewStarRating(ratingVal) {
  const num = Number(ratingVal) || 5;
  if ($('inputReviewRatingValue')) $('inputReviewRatingValue').value = String(num);
  const starBtns = document.querySelectorAll('.star-rate-btn');
  starBtns.forEach((btn) => {
    const val = Number(btn.getAttribute('data-star-val'));
    if (val <= num) {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-amber-400 bg-amber-400 text-white text-xs font-extrabold shadow-2xs';
    } else {
      btn.className = 'star-rate-btn touch-target rounded-xl border border-amber-300 bg-amber-50 text-amber-500 text-xs font-extrabold';
    }
  });
}

function renderReviewPhotoThumbnails(trip) {
  const grid = $('reviewPhotoThumbnailsGrid');
  const countBadge = $('reviewAttachedPhotoCount');
  if (!grid) return;

  const photos = trip.photos || [];
  if (countBadge) countBadge.textContent = `${selectedReviewPhotoIds.length}장 첨부됨`;

  if (photos.length === 0) {
    grid.innerHTML = '<p class="text-[11px] text-slate-400 col-span-4 text-center py-2">등록된 여행 사진이 없습니다. [사진] 탭에서 사진을 먼저 추가해보세요!</p>';
    return;
  }

  grid.innerHTML = photos
    .map((p) => {
      const isSelected = selectedReviewPhotoIds.includes(p.id);
      return `
        <div data-action="toggle-review-photo" data-id="${escapeHtml(p.id)}" class="relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer ${isSelected ? 'border-sky-600 ring-2 ring-sky-300' : 'border-slate-200 opacity-70'}">
          <img src="${p.dataUrl}" class="w-full h-full object-cover pointer-events-none" />
          ${isSelected ? '<div class="absolute inset-0 bg-sky-600/20 flex items-center justify-center"><i class="fa-solid fa-check text-white text-xs font-bold drop-shadow"></i></div>' : ''}
        </div>
      `;
    })
    .join('');
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

async function lookupFlightWithSharedCache(code) {
  if (localFlightCache[code]) return localFlightCache[code];
  const res = await lookupFlightWithAirLabs(code);
  if (res) {
    localFlightCache[code] = res;
    saveLocalData();
  }
  return res;
}

// ============================================================================
// 9. 앱 초기화 및 document.body 통합 이벤트 위임 바인딩
// ============================================================================
function initializeAppAndEvents() {
  try {
    setupDynamicDomEnhancements();
    registerServiceWorkerSafe();
    loadLocalData();
    const cloudReady = initFirebaseSafely();
    renderHomeView();
    if (cloudReady) {
      startRealtimeListeners();
    }
    bindDynamicModalForms();
  } catch (err) {
    console.error('초기화 예외:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAppAndEvents);
} else {
  initializeAppAndEvents();
}

// --------------------------------------------------------------------------
// [A] document.body 클릭(click) 이벤트 위임
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
      const segContainer = $('flightSegmentsContainer') || $('flightSegmentsListContainer');
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
            <input type="text" placeholder="편명 (예: RS471)" class="seg-flight-code touch-target flex-1 uppercase font-mono bg-slate-50 border border-slate-200 rounded-lg px-2.5 text-xs font-bold outline-none" />
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

      case 'open-edit-trip-modal':
        openEditTripInfoModal();
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
        alert(`최신 매매기준율이 갱신되었습니다.\n• ${jpy.displayUnit}\n• ${usd.displayUnit}\n• ${eur.displayUnit}`);
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
        const text = [`💸 [${trip.title}] 1/N 정산 안내`, `━━━━━━━━━━━━━━━━━━`, `• ${totalText}`, summaryText.trim()].join('\n');
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
          if ($('viewPhotoDayAndDate')) {
            $('viewPhotoDayAndDate').textContent = `Day ${photo.day} · ${photo.category || '기타'} ${photo.date ? `(${photo.date})` : ''}`;
          }
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
          version: 8,
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
// [B] document.body 변경(change) 이벤트 위임
// --------------------------------------------------------------------------
document.body.addEventListener('change', async (e) => {
  try {
    const target = e.target;
    if (!target) return;

    if (target.classList.contains('join-member-chk')) {
      if (target.checked) {
        document.querySelectorAll('.join-member-chk').forEach((chk) => {
          if (chk !== target) chk.checked = false;
        });
      }
      return;
    }

    if (target.id === 'inputNewTripHeadcount') {
      syncMemberNamesWithHeadcount('inputNewTripHeadcount', 'inputNewTripMembers');
      return;
    }
    if (target.id === 'inputEditTripHeadcount') {
      syncMemberNamesWithHeadcount('inputEditTripHeadcount', 'inputEditTripMembers');
      return;
    }

    if (target.id === 'inputHotelCheckInDate' || target.id === 'inputHotelCheckOutDate') {
      updateHotelStayDurationBadge();
      return;
    }

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
        $('selectReviewCategory').value =
          bk.category === '숙소' ? '숙소' : bk.category === '렌터카' ? '쇼핑/기타' : '관광지';
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

// --------------------------------------------------------------------------
// [C] 입력(input) 및 모든 폼 제출(submit) 이벤트 바인딩
// --------------------------------------------------------------------------
document.body.addEventListener('input', (e) => {
  const target = e.target;
  if (!target) return;
  if (target.id === 'inputExpAmount' || target.id === 'inputExpAppliedRate') {
    updateExpenseModalRatePreview();
  }
});

function bindDynamicModalForms() {
  $('formConfirmJoinMember')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (!pendingJoinTrip) return;
      const checkedEl = document.querySelector('.join-member-chk:checked');
      if (!checkedEl) {
        alert('참여할 본인의 이름을 체크해주세요.');
        return;
      }

      const selectedName = checkedEl.value.trim();
      const myBudget = Number($('inputJoinMemberBudget')?.value) || 1000000;

      if (!pendingJoinTrip.claimedMembers) pendingJoinTrip.claimedMembers = {};
      const existingHolder = pendingJoinTrip.claimedMembers[selectedName];
      if (existingHolder && existingHolder !== deviceUid) {
        alert(`'${selectedName}'님은 이미 다른 참여자가 선택했습니다. 다른 이름을 선택해주세요.`);
        openJoinMemberSelectionModal(pendingJoinTrip);
        return;
      }

      Object.keys(pendingJoinTrip.claimedMembers).forEach((k) => {
        if (k !== pendingJoinTrip.members[0] && pendingJoinTrip.claimedMembers[k] === deviceUid) {
          delete pendingJoinTrip.claimedMembers[k];
        }
      });

      pendingJoinTrip.claimedMembers[selectedName] = deviceUid;
      pendingJoinTrip.memberIds = Array.from(new Set([...(pendingJoinTrip.memberIds || []), deviceUid]));

      const existingIdx = trips.findIndex((t) => t.id === pendingJoinTrip.id);
      if (existingIdx >= 0) {
        trips[existingIdx] = pendingJoinTrip;
      } else {
        trips.unshift(pendingJoinTrip);
      }

      privateBudgets[pendingJoinTrip.id] = {
        myBudget,
        myNickname: selectedName
      };

      const joinedTripId = pendingJoinTrip.id;
      const joinedTripTitle = pendingJoinTrip.title;
      saveLocalData();
      closeModalSafe('modalSelectJoinMember');
      await syncTripToFirestore(pendingJoinTrip);
      pendingJoinTrip = null;

      enterTripDetail(joinedTripId);
      alert(`'${joinedTripTitle}' 여행에 [${selectedName}]님으로 합류했습니다!`);
    } catch (err) {
      console.error('동행자 선택 합류 오류:', err);
    }
  });

  // [항목 2 반영] 닉네임 목록을 수정했을 때 기존 참여 상태(claimedMembers)를 새 닉네임과 매끄럽게 승계
  $('formEditTripInfo')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const title = ($('inputEditTripTitle')?.value || '').trim() || trip.title;
      const destination = ($('inputEditTripDestination')?.value || '').trim() || trip.destination;
      const startDate = $('inputEditTripStartDate')?.value || trip.startDate;
      const endDate = $('inputEditTripEndDate')?.value || startDate;
      const baseCurrency = ($('selectEditTripCurrency')?.value || 'KRW').toUpperCase();
      const headcount = Math.max(1, Number($('inputEditTripHeadcount')?.value) || 1);
      const rawMembers = $('inputEditTripMembers')?.value || '나';

      let newMembers = rawMembers
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);

      if (newMembers.length === 0) newMembers = ['나'];
      while (newMembers.length < headcount) {
        newMembers.push(`동행${newMembers.length}`);
      }
      if (newMembers.length > headcount) {
        newMembers = newMembers.slice(0, headcount);
      }

      // 기존 claimedMembers 맵핑 안전 승계
      const oldClaimed = trip.claimedMembers || {};
      const newClaimed = {};
      const oldMembers = Array.isArray(trip.members) ? trip.members : [];

      // 첫 번째 생성자는 방장 UID 고정
      newClaimed[newMembers[0]] = trip.ownerUid || deviceUid;

      // 기존에 매핑되어 있던 기기 UID를 순서 혹은 이름 일치 여부에 따라 새 닉네임에 연결
      newMembers.slice(1).forEach((newM, i) => {
        const oldM = oldMembers[i + 1];
        if (oldM && oldClaimed[oldM]) {
          newClaimed[newM] = oldClaimed[oldM];
        } else if (oldClaimed[newM]) {
          newClaimed[newM] = oldClaimed[newM];
        }
      });

      trip.title = title;
      trip.destination = destination;
      trip.startDate = startDate;
      trip.endDate = endDate;
      trip.baseCurrency = baseCurrency;
      trip.maxMembers = newMembers.length;
      trip.members = newMembers;
      trip.claimedMembers = newClaimed;

      // 현재 접속 중인 내 닉네임이 목록에 여전히 포함되어 있는지 확인 후 동기화
      const priv = getMyPrivateInfo(trip);
      if (!newMembers.includes(priv.myNickname)) {
        if (privateBudgets[trip.id]) {
          privateBudgets[trip.id].myNickname = newMembers[0];
        }
      }

      saveLocalData();
      closeModalSafe('modalEditTripInfo');
      renderDetailView();
      await syncTripToFirestore(trip);
      alert('여행 기본 정보 및 참여자 닉네임이 성공적으로 수정되었습니다!');
    } catch (err) {
      console.error('여행 기본 정보 수정 오류:', err);
    }
  });
}

$('formJoinTripByCode')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const code = ($('inputJoinInviteCode')?.value || '').trim().toUpperCase();
    if (!code) {
      alert('초대 코드를 입력해주세요.');
      return;
    }

    let foundTrip = trips.find((t) => (t.inviteCode || '').toUpperCase() === code);

    if (isCloudOnline && db) {
      const q = query(collection(db, 'trips'), where('inviteCode', '==', code));
      const snap = await getDocs(q);
      snap.forEach((docSnap) => {
        foundTrip = normalizeTrip({ id: docSnap.id, ...docSnap.data() });
      });
    }

    if (!foundTrip) {
      alert('일치하는 초대 코드의 여행을 찾지 못했습니다. 코드를 다시 확인해주세요.');
      return;
    }

    if (foundTrip.ownerUid === deviceUid) {
      if (!trips.find((t) => t.id === foundTrip.id)) trips.unshift(foundTrip);
      saveLocalData();
      enterTripDetail(foundTrip.id);
      return;
    }

    openJoinMemberSelectionModal(foundTrip);
  } catch (err) {
    console.error('초대 코드 조회 오류:', err);
    alert('초대 코드를 확인하는 중 오류가 발생했습니다.');
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
    const headcount = Math.max(1, Number($('inputNewTripHeadcount')?.value) || 1);
    const rawMembers = $('inputNewTripMembers')?.value || '나';

    let members = rawMembers
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (members.length === 0) members.push('나');

    while (members.length < headcount) {
      members.push(`동행${members.length}`);
    }
    if (members.length > headcount) {
      members = members.slice(0, headcount);
    }

    const newTrip = normalizeTrip({
      id: 'trip_' + Date.now(),
      title,
      destination,
      startDate,
      endDate,
      baseCurrency,
      maxMembers: members.length,
      members,
      claimedMembers: { [members[0]]: deviceUid },
      ownerUid: deviceUid,
      memberIds: [deviceUid]
    });

    trips.unshift(newTrip);
    privateBudgets[newTrip.id] = { myBudget, myNickname: members[0] };
    saveLocalData();

    closeModalSafe('modalNewTrip');
    enterTripDetail(newTrip.id);
    await syncTripToFirestore(newTrip);
  } catch (err) {
    console.error('여행 생성 오류:', err);
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
    const payer = $('selectBookingPayer')?.value || getMyPrivateInfo(trip).myNickname;

    const participantChks = document.querySelectorAll('.bk-part-chk');
    const participants =
      participantChks.length > 0
        ? Array.from(participantChks)
            .filter((c) => c.checked)
            .map((c) => c.value)
        : [payer];

    const bookingId = editingBookingId || 'bk_' + Date.now();
    let title = ($('inputBookingTitle')?.value || '').trim();

    trip.itineraries = (trip.itineraries || []).filter((s) => s.bookingId !== bookingId);
    trip.expenses = (trip.expenses || []).filter((ex) => ex.bookingId !== bookingId);

    const newBookingObj = {
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
      const idx = (trip.bookings || []).findIndex((b) => b.id === editingBookingId);
      if (idx >= 0) {
        trip.bookings[idx] = newBookingObj;
      } else {
        trip.bookings.push(newBookingObj);
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
  privateBudgets[trip.id] = { myBudget: val, myNickname: prev.myNickname };
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
    const payer = ($('selectExpPayer')?.value || '').trim() || getMyPrivateInfo(trip).myNickname;

    const checkedBoxes = document.querySelectorAll('.exp-participant-chk:checked');
    const participants = Array.from(checkedBoxes)
      .map((cb) => cb.value.trim())
      .filter(Boolean);

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
  try {
    const trip = getActiveTrip();
    if (!trip) return;

    const fileInput = $('inputPhotoFile');
    const file = fileInput?.files?.[0];
    const place = ($('inputPhotoPlace')?.value || '').trim();
    const category = $('selectPhotoCategory')?.value || '관광지';
    const day = Number($('selectPhotoDay')?.value) || 1;
    const date = $('inputPhotoDate')?.value || getDateForTripDay(trip, day);
    const memo = ($('inputPhotoMemo')?.value || '').trim();

    if (!file && !$('imgPhotoUploadPreview')?.src) {
      alert('사진 파일을 선택해주세요.');
      return;
    }

    let dataUrl = $('imgPhotoUploadPreview')?.src || '';
    if (file && file.size > 0) {
      dataUrl = await compressImageFileToBase64(file, 800, 0.7);
    }

    const newPhoto = {
      id: 'photo_' + Date.now(),
      day,
      date,
      category,
      place,
      memo,
      dataUrl
    };

    if (!Array.isArray(trip.photos)) trip.photos = [];
    trip.photos.unshift(newPhoto);

    saveLocalData();
    closeModalSafe('modalAddPhoto');
    renderPhotosTab(trip);
    await syncTripToFirestore(trip);
  } catch (err) {
    console.error('사진 저장 오류:', err);
  }
});

$('formCreateReview')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const targetTrip = trips.find((t) => t.id === editingReviewTripId) || getActiveTrip();
    if (!targetTrip) return;

    const place = ($('inputReviewPlaceName')?.value || '').trim();
    const category = $('selectReviewCategory')?.value || '맛집/카페';
    const day = Number($('selectReviewDay')?.value) || 1;
    const rating = Number($('inputReviewRatingValue')?.value) || 5;
    const revisit = $('chkReviewRevisit')?.checked;
    const content = ($('inputReviewContent')?.value || '').trim();

    if (!place || !content) {
      alert('장소명과 리뷰 내용을 입력해주세요.');
      return;
    }

    const reviewId = editingReviewId || 'rv_' + Date.now();
    const reviewObj = {
      id: reviewId,
      tripId: targetTrip.id,
      tripTitle: targetTrip.title,
      place,
      category,
      day,
      rating,
      revisit,
      content,
      priceMemo: currentReviewPriceMemo,
      photoIds: [...selectedReviewPhotoIds],
      createdAt: new Date().toISOString()
    };

    if (!Array.isArray(targetTrip.reviews)) targetTrip.reviews = [];
    if (editingReviewId) {
      const idx = targetTrip.reviews.findIndex((r) => r.id === editingReviewId);
      if (idx !== -1) {
        targetTrip.reviews[idx] = reviewObj;
      } else {
        targetTrip.reviews.push(reviewObj);
      }
      editingReviewId = null;
    } else {
      targetTrip.reviews.unshift(reviewObj);
    }

    saveLocalData();
    closeModalSafe('modalAddReview');
    if (currentTripId) {
      renderReviewsTab(targetTrip);
    } else {
      renderHomeArchiveReviews();
    }
    await syncTripToFirestore(targetTrip);
    await syncReviewToGlobalCollection(reviewObj);
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
