/**
 * Travel Journal - app.js (ES Module)
 * - 1단계에서 작성된 index.html의 모든 id 및 data-action과 100% 일치
 * - DOMContentLoaded 이후 addEventListener 및 전역 이벤트 위임으로 버튼 먹통 원천 차단
 * - Firebase Firestore v10 모듈형 SDK + LocalStorage 하이브리드 동기화
 * - 실시간 환율 API (1순위: open.er-api.com -> 2순위: fawazahmed0 currency-api -> 3순위: 오프라인 기본 환율)
 * - 개인 예산(myBudget) 기기 localStorage 비공개 분리 저장 & 1/N 최소 송금 정산 계산
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
// apiKey가 비어 있으면 에러 없이 자동으로 '오프라인(로컬 저장)' 모드로 동작합니다.
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
const STORAGE_TRIPS_KEY = 'TRAVEL_JOURNAL_TRIPS_V2';
const STORAGE_PRIVATE_KEY = 'TRAVEL_JOURNAL_PRIVATE_V2';
const STORAGE_DEVICE_UID_KEY = 'TRAVEL_JOURNAL_DEVICE_UID_V2';

// 실시간 매매기준율 캐시 (1 외화 단위당 KRW 가치)
const liveRatesToKrw = {
  KRW: 1,
  JPY: 9.15,
  USD: 1380.0,
  EUR: 1490.0
};

let db = null;
let isCloudOnline = false;
let unsubscribeTripsListener = null;

let trips = [];
let privateStore = {}; // { [tripId]: { myBudget: number, myNickname: string } }
let currentTripId = null;
let currentDetailTab = 'schedule';

// ============================================================================
// 2. 방어형 DOM 헬퍼 및 기기 고유 식별자(userId)
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

function getOrCreateDeviceUid() {
  try {
    let uid = localStorage.getItem(STORAGE_DEVICE_UID_KEY);
    if (!uid) {
      uid = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      localStorage.setItem(STORAGE_DEVICE_UID_KEY, uid);
    }
    return uid;
  } catch (err) {
    return 'user_local_' + Math.random().toString(36).substring(2, 8);
  }
}

const deviceUserId = getOrCreateDeviceUid();

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
    const modal = $(modalId);
    if (modal) modal.classList.remove('hidden');
  } catch (err) {
    console.error('모달 열기 실패:', modalId, err);
  }
}

function closeModalSafe(modalId) {
  try {
    const modal = $(modalId);
    if (modal) modal.classList.add('hidden');
  } catch (err) {
    console.error('모달 닫기 실패:', modalId, err);
  }
}

function copyToClipboardSafe(text, successMsg) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => alert(successMsg))
      .catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
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
function registerPwaServiceWorker() {
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
    isCloudOnline = false;
    updateConnectionBadge(false);
    return false;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isCloudOnline = true;
    updateConnectionBadge(true);
    return true;
  } catch (err) {
    console.error('Firebase 초기화 예외 발생 (오프라인 모드로 동작):', err);
    isCloudOnline = false;
    db = null;
    updateConnectionBadge(false);
    return false;
  }
}

function loadFromLocalStorage() {
  try {
    const rawTrips = localStorage.getItem(STORAGE_TRIPS_KEY);
    if (rawTrips) {
      const parsed = JSON.parse(rawTrips);
      if (Array.isArray(parsed)) trips = parsed;
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
        privateStore = parsedPriv;
      }
    }
  } catch (err) {
    console.error('로컬 개인 예산 로드 오류:', err);
    privateStore = {};
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_TRIPS_KEY, JSON.stringify(trips));
    localStorage.setItem(STORAGE_PRIVATE_KEY, JSON.stringify(privateStore));
  } catch (err) {
    console.error('로컬 저장 오류:', err);
  }
}

async function saveTripToFirestore(trip) {
  if (!isCloudOnline || !db || !trip) return;
  try {
    // 개인 예산(myBudget)은 절대 Firestore에 올리지 않고 공용 데이터만 저장
    const sharedPayload = {
      id: trip.id,
      inviteCode: trip.inviteCode,
      memberIds: Array.isArray(trip.memberIds) ? trip.memberIds : [deviceUserId],
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      members: Array.isArray(trip.members) ? trip.members : ['나'],
      schedules: Array.isArray(trip.schedules) ? trip.schedules : [],
      expenses: Array.isArray(trip.expenses) ? trip.expenses : [],
      checklist: Array.isArray(trip.checklist) ? trip.checklist : [],
      createdAt: trip.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'trips', trip.id), sharedPayload, { merge: true });
  } catch (err) {
    console.error('Firestore 저장 오류:', err);
  }
}

function subscribeTripsFromFirestore() {
  if (!isCloudOnline || !db) return;
  if (typeof unsubscribeTripsListener === 'function') {
    unsubscribeTripsListener();
  }

  try {
    const q = query(collection(db, 'trips'), where('memberIds', 'array-contains', deviceUserId));
    unsubscribeTripsListener = onSnapshot(
      q,
      (snapshot) => {
        const cloudTrips = [];
        snapshot.forEach((docSnap) => {
          cloudTrips.push({ id: docSnap.id, ...docSnap.data() });
        });

        // 로컬에만 있던 여행이 있다면 클라우드로 동기화
        const cloudIds = new Set(cloudTrips.map((t) => t.id));
        const localOnly = trips.filter((t) => !cloudIds.has(t.id));
        localOnly.forEach((lt) => {
          lt.memberIds = Array.from(new Set([...(lt.memberIds || []), deviceUserId]));
          saveTripToFirestore(lt);
        });

        trips = [...cloudTrips, ...localOnly];
        saveToLocalStorage();

        if (currentTripId) {
          renderDetailView();
        } else {
          renderHomeView();
        }
      },
      (err) => {
        console.error('Firestore onSnapshot 오류:', err);
        updateConnectionBadge(false);
      }
    );
  } catch (err) {
    console.error('실시간 구독 초기화 오류:', err);
  }
}

function getActiveTrip() {
  return trips.find((t) => t.id === currentTripId) || null;
}

function getMyPrivateData(trip) {
  if (!trip) return { myBudget: 0, myNickname: '나' };
  const record = privateStore[trip.id];
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

async function refreshAllMajorRates(showAlert = false) {
  const label = $('lastRateUpdatedLabel');
  if (label) label.textContent = '환율 갱신 중...';

  const targets = ['JPY', 'USD', 'EUR'];
  await Promise.all(targets.map((code) => fetchLiveExchangeRateToKrw(code)));

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  if (label) {
    label.textContent = `기준(${hh}:${mm}) JPY ${liveRatesToKrw.JPY} · USD ${liveRatesToKrw.USD}`;
  }

  if (showAlert) {
    alert(
      `실시간 매매기준율이 갱신되었습니다.\n` +
      `• 1 JPY = ${liveRatesToKrw.JPY} KRW\n` +
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
// 6. 날짜/일수 유틸리티
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
// 7. 홈 화면 및 상세 화면 전환·렌더링
// ============================================================================
function renderHomeView() {
  const container = $('homeTripListContainer');
  if (!container) return;

  // 홈에서는 헤더 초대 코드 버튼 숨김 & 타이틀 복원
  $('btnHeaderCopyInvite')?.classList.add('hidden');
  if ($('headerBrandTitle')) $('headerBrandTitle').textContent = 'Travel Journal';
  if ($('homeTripCountBadge')) $('homeTripCountBadge').textContent = String(trips.length);

  if (trips.length === 0) {
    container.innerHTML = `
      <div class="py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2">
        <div class="w-11 h-11 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
          <i class="fa-solid fa-suitcase-rolling text-lg"></i>
        </div>
        <p class="text-xs font-extrabold text-slate-700">아직 등록된 여행이 없습니다.</p>
        <p class="text-[11px] text-slate-400">위 [새 여행 만들기] 버튼으로 첫 여행을 등록해 보세요!</p>
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
      <div data-action="enter-trip" data-trip-id="${escapeHtml(trip.id)}" class="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs hover:border-sky-300 active:scale-[0.99] transition cursor-pointer space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <span class="inline-block text-[10px] font-mono font-bold text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded mb-1">${escapeHtml(trip.inviteCode || 'TR-0000')}</span>
            <h4 class="text-sm font-extrabold text-slate-800 truncate">${escapeHtml(trip.title)}</h4>
            <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(trip.startDate)} ~ ${escapeHtml(trip.endDate)}</p>
          </div>
          <button type="button" data-action="remove-trip" data-trip-id="${escapeHtml(trip.id)}" class="touch-target flex items-center justify-center rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition shrink-0" title="여행 삭제">
            <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
          </button>
        </div>
        <div class="flex items-center justify-between pt-2 border-t border-slate-100">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="text-[11px] text-slate-400 mr-1"><i class="fa-solid fa-users text-[10px] mr-1"></i>${members.length}명</span>
            ${memberBadges}
          </div>
          <span class="text-xs font-extrabold text-sky-600 shrink-0">입장 <i class="fa-solid fa-chevron-right text-[10px]"></i></span>
        </div>
      </div>
    `;
  }).join('');
}

function enterTripDetail(tripId) {
  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return;

  currentTripId = tripId;
  currentDetailTab = 'schedule';

  $('homeView')?.classList.add('hidden');
  $('tripDetailView')?.classList.remove('hidden');

  // 헤더에 초대 코드 복사 버튼 노출
  $('btnHeaderCopyInvite')?.classList.remove('hidden');
  if ($('headerInviteCodeLabel')) $('headerInviteCodeLabel').textContent = trip.inviteCode || 'TR-0000';
  if ($('headerBrandTitle')) $('headerBrandTitle').textContent = trip.title;

  switchDetailTab('schedule');
  renderDetailView();
}

function goHomeView() {
  currentTripId = null;
  $('tripDetailView')?.classList.add('hidden');
  $('homeView')?.classList.remove('hidden');
  renderHomeView();
}

function switchDetailTab(tabKey) {
  currentDetailTab = tabKey;

  const panels = {
    schedule: $('panelSchedule'),
    expenses: $('panelExpenses'),
    checklist: $('panelChecklistBackup')
  };

  Object.keys(panels).forEach((k) => {
    if (panels[k]) {
      panels[k].classList.toggle('hidden', k !== tabKey);
    }
  });

  document.querySelectorAll('.detail-nav-btn').forEach((btn) => {
    const isMatch = btn.getAttribute('data-nav-tab') === tabKey;
    btn.className = isMatch
      ? 'detail-nav-btn touch-target flex flex-col items-center justify-center rounded-xl bg-sky-50 text-sky-600 font-extrabold text-xs transition'
      : 'detail-nav-btn touch-target flex flex-col items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50 font-bold text-xs transition';
  });
}

function renderDetailView() {
  const trip = getActiveTrip();
  if (!trip) {
    goHomeView();
    return;
  }

  const members = Array.isArray(trip.members) ? trip.members : ['나'];
  if ($('headerBrandTitle')) $('headerBrandTitle').textContent = trip.title;
  if ($('headerInviteCodeLabel')) $('headerInviteCodeLabel').textContent = trip.inviteCode || 'TR-0000';
  if ($('detailTripTitle')) $('detailTripTitle').textContent = trip.title;
  if ($('detailTripMeta')) $('detailTripMeta').textContent = `${trip.startDate} ~ ${trip.endDate} · ${members.length}명`;

  renderPrivateBudgetCard(trip);
  populateScheduleDayFilter(trip);
  renderSchedulePanel(trip);
  renderExpensesPanel(trip);
  renderChecklistPanel(trip);
}

function renderPrivateBudgetCard(trip) {
  const priv = getMyPrivateData(trip);
  const me = priv.myNickname;
  const totalBudget = priv.myBudget;

  let mySpentKrw = 0;
  (trip.expenses || []).forEach((exp) => {
    const amount = Number(exp.amount) || 0;
    const rate = Number(exp.rateToKrw) || 1;
    const totalKrw = amount * rate;

    const participants = Array.isArray(exp.participants) && exp.participants.length > 0
      ? exp.participants
      : [exp.payer || me];
    const perPersonKrw = totalKrw / participants.length;

    if (participants.includes(me)) {
      mySpentKrw += perPersonKrw;
    }
  });

  const remainKrw = totalBudget - mySpentKrw;
  const remainRatio = totalBudget > 0 ? Math.min(Math.max((remainKrw / totalBudget) * 100, 0), 100) : 100;

  if ($('detailMyTotalBudget')) $('detailMyTotalBudget').textContent = `${Math.round(totalBudget).toLocaleString()} KRW`;
  if ($('detailMyRemainBudget')) {
    $('detailMyRemainBudget').textContent = `${Math.round(remainKrw).toLocaleString()} KRW`;
    $('detailMyRemainBudget').className = remainKrw < 0 ? 'text-base font-extrabold text-rose-600' : 'text-base font-extrabold text-sky-600';
  }
  if ($('detailMySpentAmount')) $('detailMySpentAmount').textContent = `${Math.round(mySpentKrw).toLocaleString()} KRW`;
  if ($('detailRemainPercentText')) $('detailRemainPercentText').textContent = `잔여 ${Math.round(remainRatio)}%`;

  const bar = $('detailBudgetProgressBar');
  if (bar) {
    bar.style.width = `${remainRatio}%`;
    bar.className = remainRatio >= 50
      ? 'bg-sky-500 h-full rounded-full transition-all duration-300'
      : remainRatio >= 20
        ? 'bg-amber-500 h-full rounded-full transition-all duration-300'
        : 'bg-rose-500 h-full rounded-full transition-all duration-300';
  }
}

function populateScheduleDayFilter(trip) {
  const sel = $('selectScheduleDayFilter');
  if (!sel) return;
  const totalDays = calculateTripDays(trip);
  const current = Number(sel.value) || 1;

  sel.innerHTML = '';
  for (let i = 1; i <= totalDays; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Day ${i} (${getDateStrForDay(trip, i)})`;
    sel.appendChild(opt);
  }
  sel.value = String(current <= totalDays ? current : 1);
}

function renderSchedulePanel(trip) {
  const listEl = $('scheduleTimelineList');
  if (!listEl) return;

  const selectedDay = Number($('selectScheduleDayFilter')?.value) || 1;
  const items = (trip.schedules || [])
    .filter((s) => Number(s.day) === selectedDay)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="py-10 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-regular fa-calendar-xmark text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">Day ${selectedDay}에 등록된 일정이 없습니다.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = items.map((item, idx) => `
    <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs flex items-start gap-3">
      <span class="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
        ${idx + 1}
      </span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-extrabold text-sky-600">${escapeHtml(item.time)}</span>
          <button type="button" data-action="delete-schedule" data-id="${escapeHtml(item.id)}" class="touch-target flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 transition" title="일정 삭제">
            <i class="fa-solid fa-trash-can text-xs pointer-events-none"></i>
          </button>
        </div>
        <h4 class="text-sm font-bold text-slate-800 truncate">${escapeHtml(item.place)}</h4>
        ${item.memo ? `<p class="text-xs text-slate-500 mt-1 bg-slate-50 p-2 rounded-lg break-words">${escapeHtml(item.memo)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function renderExpensesPanel(trip) {
  const summaryEl = $('settlementSummaryList');
  const cardsEl = $('expenseCardsList');
  if (!summaryEl || !cardsEl) return;

  const expenses = trip.expenses || [];
  const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : ['나'];

  // 1/N 정산 계산 (KRW 환산 기준)
  const netBalance = {};
  members.forEach((m) => { netBalance[m] = 0; });
  let totalKrwSum = 0;

  expenses.forEach((exp) => {
    const amount = Number(exp.amount) || 0;
    const rate = Number(exp.rateToKrw) || 1;
    const krwTotal = amount * rate;
    totalKrwSum += krwTotal;

    const participants = Array.isArray(exp.participants) && exp.participants.length > 0
      ? exp.participants
      : [exp.payer];
    const perPersonShare = krwTotal / participants.length;
    const payer = exp.payer;

    if (netBalance[payer] === undefined) netBalance[payer] = 0;
    netBalance[payer] += krwTotal;

    participants.forEach((p) => {
      if (netBalance[p] === undefined) netBalance[p] = 0;
      netBalance[p] -= perPersonShare;
    });
  });

  if ($('totalExpenseKrwBadge')) {
    $('totalExpenseKrwBadge').textContent = `총 지출 ${Math.round(totalKrwSum).toLocaleString()}원`;
  }

  // 최소 송금 매칭
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

  if (transfers.length === 0) {
    summaryEl.innerHTML = `<p class="text-emerald-300 font-semibold py-1">정산할 차액이 없습니다.</p>`;
  } else {
    summaryEl.innerHTML = transfers.map((t) => `
      <div class="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-xl">
        <span><strong class="text-amber-300">${escapeHtml(t.from)}</strong> ➔ <strong class="text-sky-300">${escapeHtml(t.to)}</strong></span>
        <span class="font-extrabold text-white">${Math.round(t.amount).toLocaleString()}원</span>
      </div>
    `).join('');
  }

  // 지출 내역 카드 렌더링
  if (expenses.length === 0) {
    cardsEl.innerHTML = `
      <div class="py-10 text-center bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
        <i class="fa-solid fa-receipt text-2xl mb-1.5 text-slate-300"></i>
        <p class="text-xs">등록된 지출 내역이 없습니다. 우측 상단 [지출 추가]를 눌러보세요.</p>
      </div>
    `;
    return;
  }

  cardsEl.innerHTML = [...expenses].reverse().map((exp) => {
    const amt = Number(exp.amount) || 0;
    const curr = (exp.currency || 'KRW').toUpperCase();
    const rate = Number(exp.rateToKrw) || 1;
    const krwConverted = Math.round(amt * rate);
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
            ${curr !== 'KRW' ? `<p class="text-[10px] text-slate-400 mt-0.5">적용 환율 1 ${curr} = ${rate.toFixed(2)} KRW (환산 ${krwConverted.toLocaleString()}원)</p>` : ''}
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

function renderChecklistPanel(trip) {
  const listEl = $('checklistItemsList');
  if (!listEl) return;

  const list = trip.checklist || [];
  const doneCount = list.filter((c) => c.checked).length;
  if ($('checklistCountLabel')) {
    $('checklistCountLabel').textContent = `${doneCount} / ${list.length} 완료`;
  }

  if (list.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-slate-400 text-center py-6">등록된 준비물이 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = list.map((item) => `
    <div class="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/60">
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
// 8. JSON 백업 내보내기 / 불러오기 공통 함수
// ============================================================================
function exportAllDataAsJson() {
  try {
    const payload = {
      app: 'Travel Journal',
      version: 2,
      exportedAt: new Date().toISOString(),
      trips,
      privateStore
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `travel-journal-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('JSON 백업 오류:', err);
    alert('JSON 내보내기 중 오류가 발생했습니다.');
  }
}

function importDataFromJsonFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed && Array.isArray(parsed.trips)) {
        trips = parsed.trips;
        if (parsed.privateStore && typeof parsed.privateStore === 'object') {
          privateStore = { ...privateStore, ...parsed.privateStore };
        }
        saveToLocalStorage();
        if (isCloudOnline && db) {
          trips.forEach((t) => saveTripToFirestore(t));
        }
        if (currentTripId) {
          renderDetailView();
        } else {
          renderHomeView();
        }
        alert(`총 ${trips.length}개의 여행 기록을 성공적으로 불러왔습니다.`);
      } else {
        alert('올바른 Travel Journal 백업 파일이 아닙니다.');
      }
    } catch (err) {
      console.error('JSON 복원 오류:', err);
      alert('JSON 파일을 해석하는 중 오류가 발생했습니다.');
    }
  };
  reader.readAsText(file);
}

// ============================================================================
// 9. DOMContentLoaded 이후 모든 이벤트 리스너 및 위임 바인딩 (버튼 먹통 원천 차단)
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  try {
    registerPwaServiceWorker();
    loadFromLocalStorage();
    const cloudConnected = initFirebaseSafely();
    renderHomeView();
    refreshAllMajorRates(false);
    if (cloudConnected) {
      subscribeTripsFromFirestore();
    }
  } catch (err) {
    console.error('앱 초기 로드 예외:', err);
  }

  // --------------------------------------------------------------------------
  // [A] 전역 이벤트 위임 (모달 닫기, 여행 입장/삭제, 일정/지출/체크리스트 삭제 및 토글)
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

      // 2) 동적 요소 액션 ([data-action])
      const actionTarget = e.target.closest('[data-action]');
      if (!actionTarget) return;

      const action = actionTarget.getAttribute('data-action');
      const id = actionTarget.getAttribute('data-id');
      const tripId = actionTarget.getAttribute('data-trip-id');

      if (action === 'enter-trip' && tripId) {
        enterTripDetail(tripId);
      } else if (action === 'remove-trip' && tripId) {
        e.stopPropagation();
        const target = trips.find((t) => t.id === tripId);
        if (target && confirm(`'${target.title}' 여행을 삭제하시겠습니까?`)) {
          trips = trips.filter((t) => t.id !== tripId);
          delete privateStore[tripId];
          saveToLocalStorage();
          if (isCloudOnline && db) {
            deleteDoc(doc(db, 'trips', tripId)).catch((err) => console.warn(err));
          }
          renderHomeView();
        }
      } else if (action === 'delete-schedule' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 일정을 삭제하시겠습니까?')) {
          trip.schedules = (trip.schedules || []).filter((s) => s.id !== id);
          saveToLocalStorage();
          saveTripToFirestore(trip);
          renderDetailView();
        }
      } else if (action === 'delete-expense' && id) {
        const trip = getActiveTrip();
        if (trip && confirm('이 지출 내역을 삭제하시겠습니까?')) {
          trip.expenses = (trip.expenses || []).filter((ex) => ex.id !== id);
          saveToLocalStorage();
          saveTripToFirestore(trip);
          renderDetailView();
        }
      } else if (action === 'delete-checklist' && id) {
        const trip = getActiveTrip();
        if (trip) {
          trip.checklist = (trip.checklist || []).filter((c) => c.id !== id);
          saveToLocalStorage();
          saveTripToFirestore(trip);
          renderChecklistPanel(trip);
        }
      }
    } catch (err) {
      console.error('전역 클릭 위임 예외:', err);
    }
  });

  document.addEventListener('change', (e) => {
    try {
      const target = e.target;
      if (target && target.getAttribute('data-action') === 'toggle-checklist') {
        const id = target.getAttribute('data-id');
        const trip = getActiveTrip();
        if (trip) {
          const found = (trip.checklist || []).find((c) => c.id === id);
          if (found) {
            found.checked = target.checked;
            saveToLocalStorage();
            saveTripToFirestore(trip);
            renderChecklistPanel(trip);
          }
        }
      }
    } catch (err) {
      console.error('체크리스트 토글 예외:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [B] 공통 상단 헤더 버튼 바인딩
  // --------------------------------------------------------------------------
  $('btnHeaderCopyInvite')?.addEventListener('click', () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      copyToClipboardSafe(trip.inviteCode, `초대 코드 [${trip.inviteCode}]가 클립보드에 복사되었습니다!`);
    } catch (err) {
      console.error('초대 코드 복사 오류:', err);
    }
  });

  $('btnHeaderRefreshRates')?.addEventListener('click', async () => {
    try {
      await refreshAllMajorRates(true);
    } catch (err) {
      console.error('상단 환율 갱신 오류:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [C] 홈 화면 버튼 바인딩 (새 여행 만들기 & 초대 코드로 참여)
  // --------------------------------------------------------------------------
  $('btnOpenNewTripModal')?.addEventListener('click', () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      if ($('inputCreateTripTitle')) $('inputCreateTripTitle').value = '';
      if ($('inputCreateTripStart')) $('inputCreateTripStart').value = today;
      if ($('inputCreateTripEnd')) $('inputCreateTripEnd').value = today;
      if ($('inputCreateTripMembers')) $('inputCreateTripMembers').value = '나, 동행1';
      if ($('inputCreateTripBudget')) $('inputCreateTripBudget').value = '1500000';
      openModalSafe('modalNewTrip');
    } catch (err) {
      console.error('새 여행 모달 열기 예외:', err);
    }
  });

  $('formCreateNewTrip')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const title = ($('inputCreateTripTitle')?.value || '').trim() || '나의 여행';
      const startDate = $('inputCreateTripStart')?.value || new Date().toISOString().split('T')[0];
      const endDate = $('inputCreateTripEnd')?.value || startDate;
      const rawMembers = $('inputCreateTripMembers')?.value || '나';
      const myBudget = Number($('inputCreateTripBudget')?.value) || 0;

      let members = rawMembers.split(',').map((m) => m.trim()).filter(Boolean);
      if (members.length === 0) members = ['나'];

      const newTripId = 'trip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const newTrip = {
        id: newTripId,
        inviteCode: generateInviteCode(),
        memberIds: [deviceUserId],
        title,
        startDate,
        endDate,
        members,
        schedules: [],
        expenses: [],
        checklist: [
          { id: 'ck_init_1', text: '여권 및 항공권 e-티켓', checked: false },
          { id: 'ck_init_2', text: '보조배터리 및 충전 케이블', checked: false }
        ],
        createdAt: new Date().toISOString()
      };

      // 개인 예산은 localStorage에만 격리 저장
      privateStore[newTripId] = {
        myBudget,
        myNickname: members[0]
      };

      trips.unshift(newTrip);
      saveToLocalStorage();
      closeModalSafe('modalNewTrip');
      enterTripDetail(newTripId);
      await saveTripToFirestore(newTrip);
    } catch (err) {
      console.error('새 여행 생성 예외:', err);
      alert('여행 생성 중 오류가 발생했습니다.');
    }
  });

  $('formJoinByInviteCode')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const code = ($('inputHomeJoinCode')?.value || '').trim().toUpperCase();
      const nickname = ($('inputHomeJoinNickname')?.value || '').trim();
      if (!code || !nickname) return;

      // 1) 로컬 보관함 내 동일 코드 확인
      const localFound = trips.find((t) => (t.inviteCode || '').toUpperCase() === code);
      if (localFound) {
        if (!localFound.members.includes(nickname)) {
          localFound.members.push(nickname);
        }
        privateStore[localFound.id] = {
          myBudget: privateStore[localFound.id]?.myBudget || 0,
          myNickname: nickname
        };
        saveToLocalStorage();
        if ($('inputHomeJoinCode')) $('inputHomeJoinCode').value = '';
        if ($('inputHomeJoinNickname')) $('inputHomeJoinNickname').value = '';
        enterTripDetail(localFound.id);
        return;
      }

      // 2) Firestore 클라우드 조회 및 합류
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
      const tripData = targetDoc.data();
      const updatedMembers = Array.from(new Set([...(tripData.members || []), nickname]));

      await updateDoc(doc(db, 'trips', targetDoc.id), {
        memberIds: arrayUnion(deviceUserId),
        members: updatedMembers
      });

      privateStore[targetDoc.id] = {
        myBudget: 0,
        myNickname: nickname
      };

      const joinedTrip = { id: targetDoc.id, ...tripData, members: updatedMembers };
      trips = [joinedTrip, ...trips.filter((t) => t.id !== targetDoc.id)];
      saveToLocalStorage();

      if ($('inputHomeJoinCode')) $('inputHomeJoinCode').value = '';
      if ($('inputHomeJoinNickname')) $('inputHomeJoinNickname').value = '';
      enterTripDetail(targetDoc.id);
    } catch (err) {
      console.error('초대 코드 합류 예외:', err);
      alert('여행 합류 중 오류가 발생했습니다.');
    }
  });

  // --------------------------------------------------------------------------
  // [D] 여행 상세 화면 네비게이션 & 개인 예산 수정 바인딩
  // --------------------------------------------------------------------------
  $('btnBackToHome')?.addEventListener('click', goHomeView);

  document.querySelectorAll('.detail-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabKey = btn.getAttribute('data-nav-tab');
      if (tabKey) switchDetailTab(tabKey);
    });
  });

  $('btnToggleBudgetEdit')?.addEventListener('click', () => {
    const trip = getActiveTrip();
    const form = $('formInlineBudgetEdit');
    if (!trip || !form) return;
    const priv = getMyPrivateData(trip);
    if ($('inputInlineMyBudget')) $('inputInlineMyBudget').value = String(priv.myBudget);
    form.classList.toggle('hidden');
  });

  $('formInlineBudgetEdit')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const trip = getActiveTrip();
    if (!trip) return;
    const newBudget = Number($('inputInlineMyBudget')?.value) || 0;
    const prev = getMyPrivateData(trip);
    privateStore[trip.id] = {
      myBudget: newBudget,
      myNickname: prev.myNickname
    };
    saveToLocalStorage();
    $('formInlineBudgetEdit')?.classList.add('hidden');
    renderPrivateBudgetCard(trip);
  });

  // --------------------------------------------------------------------------
  // [E] 일정 패널 바인딩
  // --------------------------------------------------------------------------
  $('selectScheduleDayFilter')?.addEventListener('change', () => {
    const trip = getActiveTrip();
    if (trip) renderSchedulePanel(trip);
  });

  $('formAddScheduleItem')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const day = Number($('selectScheduleDayFilter')?.value) || 1;
      const time = $('inputScheduleTime')?.value || '10:00';
      const place = ($('inputSchedulePlace')?.value || '').trim();
      const memo = ($('inputScheduleMemo')?.value || '').trim();
      if (!place) return;

      if (!Array.isArray(trip.schedules)) trip.schedules = [];
      trip.schedules.push({
        id: 'sc_' + Date.now(),
        day,
        time,
        place,
        memo
      });

      if ($('inputSchedulePlace')) $('inputSchedulePlace').value = '';
      if ($('inputScheduleMemo')) $('inputScheduleMemo').value = '';

      saveToLocalStorage();
      renderSchedulePanel(trip);
      await saveTripToFirestore(trip);
    } catch (err) {
      console.error('일정 추가 예외:', err);
    }
  });

  // --------------------------------------------------------------------------
  // [F] 지출 추가 모달 열기, 실시간 환율 연동, 저장 바인딩
  // --------------------------------------------------------------------------
  $('btnOpenAddExpenseModal')?.addEventListener('click', async () => {
    try {
      const trip = getActiveTrip();
      if (!trip) return;

      const priv = getMyPrivateData(trip);
      const members = Array.isArray(trip.members) && trip.members.length > 0 ? trip.members : [priv.myNickname];

      if ($('inputExpTitle')) $('inputExpTitle').value = '';
      if ($('selectExpCurrency')) $('selectExpCurrency').value = 'KRW';
      if ($('inputExpAmount')) $('inputExpAmount').value = '';
      if ($('inputExpAppliedRate')) $('inputExpAppliedRate').value = '1';
      if ($('expRateSourceText')) $('expRateSourceText').textContent = '적용 환율 (1 KRW = 1 KRW)';
      if ($('expRateUnitPrefix')) $('expRateUnitPrefix').textContent = '1 KRW =';
      if ($('expConvertedKrwPreview')) $('expConvertedKrwPreview').textContent = '0 KRW';

      // 결제자 드롭다운 구성
      const payerSelect = $('selectExpPayer');
      if (payerSelect) {
        payerSelect.innerHTML = members.map((m) =>
          `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`
        ).join('');
        if (members.includes(priv.myNickname)) {
          payerSelect.value = priv.myNickname;
        }
      }

      // 분담 인원 체크박스 구성
      const groupEl = $('expParticipantsCheckboxGroup');
      if (groupEl) {
        groupEl.innerHTML = members.map((m) => `
          <label class="flex items-center gap-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer">
            <input type="checkbox" value="${escapeHtml(m)}" checked class="exp-member-checkbox w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
            <span>${escapeHtml(m)}</span>
          </label>
        `).join('');
      }

      openModalSafe('modalAddExpense');
    } catch (err) {
      console.error('지출 추가 모달 열기 예외:', err);
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

      const checkedInputs = document.querySelectorAll('.exp-member-checkbox:checked');
      const participants = Array.from(checkedInputs).map((cb) => cb.value.trim()).filter(Boolean);

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

      saveToLocalStorage();
      closeModalSafe('modalAddExpense');
      renderDetailView();
      await saveTripToFirestore(trip);
    } catch (err) {
      console.error('지출 내역 저장 예외:', err);
      alert('지출 저장 중 오류가 발생했습니다.');
    }
  });

  // --------------------------------------------------------------------------
  // [G] 체크리스트 & JSON 백업/복원 바인딩
  // --------------------------------------------------------------------------
  $('formAddChecklistItem')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const trip = getActiveTrip();
      if (!trip) return;
      const text = ($('inputChecklistItemText')?.value || '').trim();
      if (!text) return;

      if (!Array.isArray(trip.checklist)) trip.checklist = [];
      trip.checklist.unshift({
        id: 'ck_' + Date.now(),
        text,
        checked: false
      });

      if ($('inputChecklistItemText')) $('inputChecklistItemText').value = '';
      saveToLocalStorage();
      renderChecklistPanel(trip);
      await saveTripToFirestore(trip);
    } catch (err) {
      console.error('체크리스트 추가 예외:', err);
    }
  });

  $('btnExportBackupJson')?.addEventListener('click', exportAllDataAsJson);

  $('btnTriggerImportJson')?.addEventListener('click', () => {
    $('inputBackupFilePicker')?.click();
  });

  $('inputBackupFilePicker')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importDataFromJsonFile(file);
    e.target.value = '';
  });
});
