// ============================================================================
// [설정 상수] AirLabs API 키를 아래에 입력하세요 (미입력 시 내장 항공사/편명 DB로 자동 동작)
// ============================================================================
export const AIRLABS_API_KEY = 'dc8d88c8-6aa7-4aee-b549-e9d291f1f2a2';

// ============================================================================
// 1. 기본 기준 환율 테이블 (1 외화 단위당 KRW 기준 오프라인 Fallback)
// ============================================================================
export const FALLBACK_RATES_TO_KRW = {
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

// ============================================================================
// 2. 실시간 환율 조회 서비스
//    - 1순위: https://open.er-api.com/v6/latest/{통화코드}
//    - 2순위: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{소문자통화코드}.json
//    - 3순위: 내장 오프라인 매매기준율 Fallback
// ============================================================================
const cachedRatesToKrw = { ...FALLBACK_RATES_TO_KRW };

export async function fetchLiveRateToKrw(currencyCode) {
  const upper = String(currencyCode || 'KRW').trim().toUpperCase();
  if (upper === 'KRW') {
    return { rate: 1, source: '기준 통화' };
  }

  // 1순위 API: open.er-api.com
  try {
    const res1 = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(upper)}`);
    if (res1.ok) {
      const data1 = await res1.json();
      const krwRate = data1?.rates?.KRW;
      if (typeof krwRate === 'number' && krwRate > 0) {
        const rounded = Number(krwRate.toFixed(2));
        cachedRatesToKrw[upper] = rounded;
        return { rate: rounded, source: 'open.er-api.com' };
      }
    }
  } catch (err) {
    console.warn(`1순위 환율 API 실패 (${upper}):`, err);
  }

  // 2순위 API: fawazahmed0 currency-api
  try {
    const lower = upper.toLowerCase();
    const res2 = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${encodeURIComponent(lower)}.json`
    );
    if (res2.ok) {
      const data2 = await res2.json();
      const krwRate2 = data2?.[lower]?.krw;
      if (typeof krwRate2 === 'number' && krwRate2 > 0) {
        const rounded2 = Number(krwRate2.toFixed(2));
        cachedRatesToKrw[upper] = rounded2;
        return { rate: rounded2, source: 'currency-api' };
      }
    }
  } catch (err) {
    console.warn(`2순위 환율 API 실패 (${upper}):`, err);
  }

  // 3순위 Fallback
  const fallback = Number((cachedRatesToKrw[upper] || 1).toFixed(2));
  return { rate: fallback, source: '기본 환율' };
}

export async function refreshMajorRates(targets = ['JPY', 'USD', 'EUR']) {
  await Promise.all(targets.map((code) => fetchLiveRateToKrw(code)));
  return { ...cachedRatesToKrw };
}

export function getCachedRateToKrw(currencyCode) {
  const upper = String(currencyCode || 'KRW').trim().toUpperCase();
  return Number((cachedRatesToKrw[upper] || 1).toFixed(2));
}

// ============================================================================
// 3. 항공편 조회 서비스 (AirLabs API 우선 + 내장 항공사/편명 데이터베이스 Fallback)
// ============================================================================
const AIRLINE_PREFIX_MAP = {
  RS: '에어서울',
  KE: '대한항공',
  OZ: '아시아나항공',
  '7C': '제주항공',
  LJ: '진에어',
  TW: '티웨이항공',
  ZE: '이스타항공',
  BX: '에어부산',
  RF: '에어로케이',
  YP: '에어프레미아',
  JL: '일본항공',
  NH: '전일본공수(ANA)',
  MM: '피치항공',
  CI: '중화항공',
  BR: '에바항공',
  CX: '캐세이퍼시픽',
  SQ: '싱가포르항공',
  VN: '베트남항공',
  VJ: '비엣젯항공',
  TG: '타이항공',
  MH: '말레이시아항공',
  PR: '필리핀항공',
  '5J': '세부퍼시픽',
  TR: '스코트',
  UO: '홍콩익스프레스',
  MU: '중국동방항공',
  CZ: '중국남방항공',
  CA: '중국국제항공',
  DL: '델타항공',
  UA: '유나이티드항공',
  AA: '아메리칸항공',
  AC: '에어캐나다',
  HA: '하와이안항공',
  LH: '루프트한자',
  AF: '에어프랑스',
  KL: 'KLM 네덜란드항공',
  AY: '핀에어',
  EK: '에미레이트항공',
  QR: '카타르항공',
  EY: '에티하드항공'
};

const LOCAL_FLIGHT_DB = {
  RS471: { airline: '에어서울', dep: '인천 ICN', arr: '요나고 YGJ', depTime: '13:20', arrTime: '14:50', memo: '제1여객터미널 탑승' },
  RS472: { airline: '에어서울', dep: '요나고 YGJ', arr: '인천 ICN', depTime: '15:50', arrTime: '17:30', memo: '요나고 기타로 공항' },
  RS701: { airline: '에어서울', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '08:05', arrTime: '10:35', memo: '제1여객터미널 탑승' },
  RS702: { airline: '에어서울', dep: '도쿄 나리타 NRT', arr: '인천 ICN', depTime: '11:35', arrTime: '14:25', memo: '나리타 1터미널' },
  RS711: { airline: '에어서울', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '07:15', arrTime: '09:05', memo: '제1여객터미널 탑승' },
  RS712: { airline: '에어서울', dep: '오사카 간사이 KIX', arr: '인천 ICN', depTime: '10:05', arrTime: '12:00', memo: '간사이 1터미널' },
  KE703: { airline: '대한항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '10:10', arrTime: '12:45', memo: '제2여객터미널 탑승' },
  KE704: { airline: '대한항공', dep: '도쿄 나리타 NRT', arr: '인천 ICN', depTime: '13:55', arrTime: '16:35', memo: '나리타 1터미널' },
  KE721: { airline: '대한항공', dep: '인천 ICN', arr: '오사카 간사이 KIX', depTime: '09:00', arrTime: '10:50', memo: '제2여객터미널' },
  KE781: { airline: '대한항공', dep: '인천 ICN', arr: '후쿠오카 FUK', depTime: '08:00', arrTime: '09:30', memo: '제2여객터미널' },
  OZ102: { airline: '아시아나항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '09:00', arrTime: '11:30', memo: '제1여객터미널' },
  OZ101: { airline: '아시아나항공', dep: '도쿄 나리타 NRT', arr: '인천 ICN', depTime: '12:30', arrTime: '15:10', memo: '나리타 1터미널' },
  '7C1102': { airline: '제주항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '06:55', arrTime: '09:30', memo: '제1여객터미널' },
  LJ201: { airline: '진에어', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '07:25', arrTime: '10:00', memo: '제2여객터미널' },
  TW211: { airline: '티웨이항공', dep: '인천 ICN', arr: '도쿄 나리타 NRT', depTime: '07:45', arrTime: '10:20', memo: '제1여객터미널' },
  JL090: { airline: '일본항공', dep: '김포 GMP', arr: '도쿄 하네다 HND', depTime: '08:00', arrTime: '10:10', memo: '김포국제선' },
  NH862: { airline: '전일본공수(ANA)', dep: '김포 GMP', arr: '도쿄 하네다 HND', depTime: '07:45', arrTime: '09:55', memo: '김포국제선' }
};

export async function lookupFlightInfo(flightIataCode) {
  const code = String(flightIataCode || '').replace(/\s+/g, '').toUpperCase();
  if (!code) return null;

  const hasValidAirLabsKey =
    typeof AIRLABS_API_KEY === 'string' &&
    AIRLABS_API_KEY.trim() !== '' &&
    !AIRLABS_API_KEY.includes('여기에_AIRLABS_API_KEY_입력');

  if (hasValidAirLabsKey) {
    try {
      const url = `https://airlabs.co/api/v9/flight?flight_iata=${encodeURIComponent(code)}&api_key=${encodeURIComponent(AIRLABS_API_KEY.trim())}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const f = json?.response;
        if (f && (f.dep_iata || f.arr_iata)) {
          const prefix = code.substring(0, 2);
          const airlineName = AIRLINE_PREFIX_MAP[prefix] || f.airline_name || f.airline_iata || '';
          const depTimeStr = f.dep_time ? String(f.dep_time).slice(-5) : '';
          const arrTimeStr = f.arr_time ? String(f.arr_time).slice(-5) : '';
          return {
            flightNo: code,
            airline: airlineName,
            dep: `${f.dep_name || ''} ${f.dep_iata || ''}`.trim(),
            arr: `${f.arr_name || ''} ${f.arr_iata || ''}`.trim(),
            depTime: depTimeStr,
            arrTime: arrTimeStr,
            memo: f.dep_terminal ? `출발 터미널 ${f.dep_terminal}` : '',
            source: 'AirLabs API'
          };
        }
      }
    } catch (err) {
      console.warn('AirLabs 항공편 조회 실패, 내장 DB로 대체:', err);
    }
  }

  // 내장 스케줄 DB 조회
  const exact = LOCAL_FLIGHT_DB[code];
  if (exact) {
    return {
      flightNo: code,
      airline: exact.airline,
      dep: exact.dep,
      arr: exact.arr,
      depTime: exact.depTime,
      arrTime: exact.arrTime,
      memo: exact.memo,
      source: '내장 스케줄 DB'
    };
  }

  // 항공사 코드 접두사 매칭
  const prefix = code.substring(0, 2);
  const airlineOnly = AIRLINE_PREFIX_MAP[prefix];
  if (airlineOnly) {
    return {
      flightNo: code,
      airline: airlineOnly,
      dep: '',
      arr: '',
      depTime: '09:00',
      arrTime: '',
      memo: '',
      source: '항공사 코드 매칭'
    };
  }

  return null;
}

// ============================================================================
// 4. HTML5 Canvas 이미지 리사이징 및 Base64 압축 유틸리티
//    - 최대 가로 800px, JPEG 품질 0.7로 압축하여 Firestore 1MB 한도 방지
// ============================================================================
export function compressImageFileToBase64(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('이미지 파일이 제공되지 않았습니다.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('이미지 디코딩에 실패했습니다.'));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// 5. 1/N 정산 및 최소 송금 이체 경로 계산 엔진 (KRW 환산 기준)
// ============================================================================
export function calculateOneOverNSettlement(expenses = [], members = ['나'], myNickname = '나') {
  const cleanMembers = Array.isArray(members) && members.length > 0
    ? members.map((m) => String(m).trim()).filter(Boolean)
    : [myNickname];

  const netBalance = {};
  cleanMembers.forEach((m) => {
    netBalance[m] = 0;
  });

  let groupTotalKrw = 0;
  let mySpentKrw = 0;

  (expenses || []).forEach((exp) => {
    const amount = Number(exp.amount) || 0;
    const rate = Number(exp.rateToKrw) || 1;
    const krwTotal = amount * rate;
    if (krwTotal <= 0) return;

    groupTotalKrw += krwTotal;

    const participants = Array.isArray(exp.participants) && exp.participants.length > 0
      ? exp.participants.map((p) => String(p).trim()).filter(Boolean)
      : [String(exp.payer || myNickname).trim()];

    const perShareKrw = krwTotal / participants.length;
    const payer = String(exp.payer || myNickname).trim();

    if (participants.includes(myNickname)) {
      mySpentKrw += perShareKrw;
    }

    if (netBalance[payer] === undefined) netBalance[payer] = 0;
    netBalance[payer] += krwTotal;

    participants.forEach((person) => {
      if (netBalance[person] === undefined) netBalance[person] = 0;
      netBalance[person] -= perShareKrw;
    });
  });

  // Greedy 최소 송금 매칭
  const debtors = [];
  const creditors = [];

  Object.keys(netBalance).forEach((name) => {
    const diff = Math.round(netBalance[name]);
    if (diff < -10) {
      debtors.push({ name, amount: Math.abs(diff) });
    } else if (diff > 10) {
      creditors.push({ name, amount: diff });
    }
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const sendAmount = Math.min(debtors[i].amount, creditors[j].amount);
    if (sendAmount > 0) {
      transfers.push({
        from: debtors[i].name,
        to: creditors[j].name,
        amount: sendAmount
      });
    }
    debtors[i].amount -= sendAmount;
    creditors[j].amount -= sendAmount;

    if (debtors[i].amount <= 10) i++;
    if (creditors[j].amount <= 10) j++;
  }

  return {
    groupTotalKrw,
    mySpentKrw,
    transfers
  };
}

// ============================================================================
// 6. 날짜 및 여행 일수 계산 유틸리티
// ============================================================================
export function calculateTripDaysCount(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 1;
  const start = new Date(`${startDateStr}T00:00:00`);
  const end = new Date(`${endDateStr}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 1;
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

export function getDateStringForTripDay(startDateStr, dayNumber) {
  if (!startDateStr) return '';
  const d = new Date(`${startDateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (Number(dayNumber) - 1));
  return d.toISOString().split('T')[0];
}
