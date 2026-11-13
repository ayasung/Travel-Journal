// ============================================================================
// [1. 설정 상수] 실제 AirLabs API 키 적용
// ============================================================================
export const AIRLABS_API_KEY = 'dc8d88c8-6aa7-4aee-b549-e9d291f1f2a2';

// ============================================================================
// [2. 기본 기준 환율 테이블] (1 외화 단위당 KRW 기준 오프라인 Fallback)
// ============================================================================
export const FALLBACK_RATES_TO_KRW = {
  KRW: 1,
  JPY: 9.15,   // 1 JPY = 9.15 KRW (100 JPY = 915 KRW)
  USD: 1380.0,
  EUR: 1490.0,
  GBP: 1750.0,
  TWD: 43.0,
  THB: 38.0,
  VND: 0.055,
  CNY: 192.0
};

const cachedRatesToKrw = { ...FALLBACK_RATES_TO_KRW };

// ============================================================================
// [3. 실시간 환율 조회 서비스] (이중 백업 + 엔화 100엔 기준 표시 정보 포함)
// - 1순위: https://open.er-api.com/v6/latest/{통화코드}
// - 2순위: https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{소문자통화코드}.json
// - 3순위: 내장 오프라인 매매기준율 Fallback
// ============================================================================
export async function fetchLiveExchangeRate(currencyCode) {
  const upper = String(currencyCode || 'KRW').trim().toUpperCase();
  if (upper === 'KRW') {
    return {
      currency: 'KRW',
      rate: 1,
      ratePer100: 100,
      displayUnit: '1 KRW = 1 KRW',
      source: '기준 통화'
    };
  }

  let unitRate = null;
  let sourceName = '기본 환율';

  // 1순위 API 호출: open.er-api.com
  try {
    const res1 = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(upper)}`);
    if (res1.ok) {
      const data1 = await res1.json();
      const krwVal = data1?.rates?.KRW;
      if (typeof krwVal === 'number' && krwVal > 0) {
        unitRate = krwVal;
        sourceName = 'open.er-api.com';
      }
    }
  } catch (err) {
    console.warn(`1순위 환율 API 호출 실패 (${upper}):`, err);
  }

  // 2순위 API 호출: fawazahmed0 currency-api
  if (unitRate === null) {
    try {
      const lower = upper.toLowerCase();
      const res2 = await fetch(
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${encodeURIComponent(lower)}.json`
      );
      if (res2.ok) {
        const data2 = await res2.json();
        const krwVal2 = data2?.[lower]?.krw;
        if (typeof krwVal2 === 'number' && krwVal2 > 0) {
          unitRate = krwVal2;
          sourceName = 'currency-api';
        }
      }
    } catch (err) {
      console.warn(`2순위 환율 API 호출 실패 (${upper}):`, err);
    }
  }

  // 3순위 Fallback
  if (unitRate === null) {
    unitRate = cachedRatesToKrw[upper] || 1;
    sourceName = '오프라인 기본값';
  }

  // 엔화(JPY)는 100엔 기준 환율과 1엔 단위 환율을 모두 정밀 계산
  const roundedUnitRate = upper === 'VND' ? Number(unitRate.toFixed(4)) : Number(unitRate.toFixed(2));
  const ratePer100 = Number((unitRate * 100).toFixed(2));
  cachedRatesToKrw[upper] = roundedUnitRate;

  const displayUnit =
    upper === 'JPY'
      ? `100 JPY = ${ratePer100.toLocaleString()} KRW (1 JPY = ${roundedUnitRate} KRW)`
      : `1 ${upper} = ${roundedUnitRate.toLocaleString()} KRW`;

  return {
    currency: upper,
    rate: roundedUnitRate,      // 1단위당 원화 환율 (지출 금액 × rate 계산용)
    ratePer100,                 // 100단위당 원화 환율 (엔화 100엔 표기용)
    displayUnit,                // UI 표시용 텍스트
    source: sourceName
  };
}

// app.js 호환용 별칭 export
export const fetchLiveRateToKrw = fetchLiveExchangeRate;

export async function refreshMajorRates(targets = ['JPY', 'USD', 'EUR']) {
  const results = await Promise.all(targets.map((code) => fetchLiveExchangeRate(code)));
  return {
    rates: { ...cachedRatesToKrw },
    details: results
  };
}

export function getCachedRateToKrw(currencyCode) {
  const upper = String(currencyCode || 'KRW').trim().toUpperCase();
  return cachedRatesToKrw[upper] || 1;
}

// ============================================================================
// [4. 항공편 조회 서비스] (한국 공항·항공사 한글 매핑 + AirLabs API + 내장 DB Fallback)
// ============================================================================
export const AIRLINE_KO_MAP = {
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
  JL: '일본항공(JAL)',
  NH: '전일본공수(ANA)',
  MM: '피치항공',
  NQ: '에어재팬',
  ZG: '집에어(ZIPAIR)',
  CI: '중화항공',
  BR: '에바항공',
  JX: '스타럭스항공',
  CX: '캐세이퍼시픽',
  UO: '홍콩익스프레스',
  SQ: '싱가포르항공',
  TR: '스쿠트',
  VN: '베트남항공',
  VJ: '비엣젯항공',
  TG: '타이항공',
  MH: '말레이시아항공',
  PR: '필리핀항공',
  '5J': '세부퍼시픽',
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
  KL: 'KLM네덜란드항공',
  AY: '핀에어',
  EK: '에미레이트항공',
  QR: '카타르항공',
  EY: '에티하드항공'
};

export const AIRPORT_KO_MAP = {
  ICN: { name: '인천국제공항', city: '인천', lat: 37.4602, lng: 126.4407 },
  GMP: { name: '김포국제공항', city: '서울/김포', lat: 37.5583, lng: 126.7906 },
  PUS: { name: '김해국제공항', city: '부산', lat: 35.1796, lng: 128.9382 },
  CJU: { name: '제주국제공항', city: '제주', lat: 33.5104, lng: 126.4914 },
  CJJ: { name: '청주국제공항', city: '청주', lat: 36.7166, lng: 127.4991 },
  TAE: { name: '대구국제공항', city: '대구', lat: 35.8941, lng: 128.6589 },
  YGJ: { name: '요나고 기타로 공항', city: '요나고(돗토리)', lat: 35.4922, lng: 133.2364 },
  NRT: { name: '도쿄 나리타 국제공항', city: '도쿄(나리타)', lat: 35.7720, lng: 140.3929 },
  HND: { name: '도쿄 하네다 국제공항', city: '도쿄(하네다)', lat: 35.5494, lng: 139.7798 },
  KIX: { name: '오사카 간사이 국제공항', city: '오사카', lat: 34.4320, lng: 135.2304 },
  FUK: { name: '후쿠오카 공항', city: '후쿠오카', lat: 33.5859, lng: 130.4507 },
  CTS: { name: '삿포로 신치토세 공항', city: '삿포로', lat: 42.7752, lng: 141.6923 },
  NGO: { name: '나고야 주부 국제공항', city: '나고야', lat: 34.8584, lng: 136.8054 },
  OKA: { name: '오키나와 나하 공항', city: '오키나와', lat: 26.1958, lng: 127.6458 },
  TAK: { name: '다카마쓰 공항', city: '다카마쓰', lat: 34.2142, lng: 134.0156 },
  MYJ: { name: '마쓰야마 공항', city: '마쓰야마', lat: 33.8272, lng: 132.6997 },
  OIT: { name: '오이타 공항', city: '오이타', lat: 33.4794, lng: 131.7372 },
  KMJ: { name: '구마모토 공항', city: '구마모토', lat: 32.8373, lng: 130.8551 },
  KOJ: { name: '가고시마 공항', city: '가고시마', lat: 31.8034, lng: 130.7194 },
  TPE: { name: '타이베이 타오위안 공항', city: '타이베이', lat: 25.0797, lng: 121.2342 },
  TSA: { name: '타이베이 송산 공항', city: '타이베이(송산)', lat: 25.0694, lng: 121.5525 },
  HKG: { name: '홍콩 첵랍콕 국제공항', city: '홍콩', lat: 22.3080, lng: 113.9185 },
  DAD: { name: '다낭 국제공항', city: '다낭', lat: 16.0439, lng: 108.1992 },
  CXR: { name: '나트랑 깜란 국제공항', city: '나트랑', lat: 11.9982, lng: 109.2194 },
  SGN: { name: '호치민 떤선녓 국제공항', city: '호치민', lat: 10.8188, lng: 106.6520 },
  HAN: { name: '하노이 노이바이 국제공항', city: '하노이', lat: 21.2212, lng: 105.8072 },
  BKK: { name: '방콕 수완나품 국제공항', city: '방콕', lat: 13.6900, lng: 100.7501 },
  SIN: { name: '싱가포르 창이 국제공항', city: '싱가포르', lat: 1.3644, lng: 103.9915 },
  GUM: { name: '괌 안토니오 B. 원 팻 국제공항', city: '괌', lat: 13.4834, lng: 144.7960 },
  CDG: { name: '파리 샤를드골 공항', city: '파리', lat: 49.0097, lng: 2.5479 },
  FRA: { name: '프랑크푸르트 공항', city: '프랑크푸르트', lat: 50.0379, lng: 8.5622 },
  FCO: { name: '로마 피우미치노 공항', city: '로마', lat: 41.8003, lng: 12.2389 },
  LAX: { name: '로스앤젤레스 국제공항', city: '로스앤젤레스', lat: 33.9416, lng: -118.4085 },
  JFK: { name: '뉴욕 존 F. 케네디 국제공항', city: '뉴욕', lat: 40.6413, lng: -73.7781 },
  SFO: { name: '샌프란시스코 국제공항', city: '샌프란시스코', lat: 37.6213, lng: -122.3790 }
};

const LOCAL_FLIGHT_SCHEDULE_DB = {
  RS471: { airline: '에어서울', depIata: 'ICN', arrIata: 'YGJ', depTime: '13:20', arrTime: '14:50', memo: '인천 제1여객터미널 출발' },
  RS472: { airline: '에어서울', depIata: 'YGJ', arrIata: 'ICN', depTime: '15:50', arrTime: '17:30', memo: '요나고 기타로 공항 출발' },
  RS701: { airline: '에어서울', depIata: 'ICN', arrIata: 'NRT', depTime: '08:05', arrTime: '10:35', memo: '인천 제1여객터미널 출발' },
  RS702: { airline: '에어서울', depIata: 'NRT', arrIata: 'ICN', depTime: '11:35', arrTime: '14:25', memo: '나리타 제1터미널 출발' },
  RS711: { airline: '에어서울', depIata: 'ICN', arrIata: 'KIX', depTime: '07:15', arrTime: '09:05', memo: '인천 제1여객터미널 출발' },
  RS712: { airline: '에어서울', depIata: 'KIX', arrIata: 'ICN', depTime: '10:05', arrTime: '12:00', memo: '간사이 제1터미널 출발' },
  RS731: { airline: '에어서울', depIata: 'ICN', arrIata: 'FUK', depTime: '09:00', arrTime: '10:30', memo: '인천 제1여객터미널 출발' },
  KE703: { airline: '대한항공', depIata: 'ICN', arrIata: 'NRT', depTime: '10:10', arrTime: '12:45', memo: '인천 제2여객터미널 출발' },
  KE704: { airline: '대한항공', depIata: 'NRT', arrIata: 'ICN', depTime: '13:55', arrTime: '16:35', memo: '나리타 제1터미널 출발' },
  KE721: { airline: '대한항공', depIata: 'ICN', arrIata: 'KIX', depTime: '09:00', arrTime: '10:50', memo: '인천 제2여객터미널 출발' },
  KE781: { airline: '대한항공', depIata: 'ICN', arrIata: 'FUK', depTime: '08:00', arrTime: '09:30', memo: '인천 제2여객터미널 출발' },
  OZ102: { airline: '아시아나항공', depIata: 'ICN', arrIata: 'NRT', depTime: '09:00', arrTime: '11:30', memo: '인천 제1여객터미널 출발' },
  OZ101: { airline: '아시아나항공', depIata: 'NRT', arrIata: 'ICN', depTime: '12:30', arrTime: '15:10', memo: '나리타 제1터미널 출발' },
  OZ112: { airline: '아시아나항공', depIata: 'ICN', arrIata: 'KIX', depTime: '08:00', arrTime: '09:40', memo: '인천 제1여객터미널 출발' },
  '7C1102': { airline: '제주항공', depIata: 'ICN', arrIata: 'NRT', depTime: '06:55', arrTime: '09:30', memo: '인천 제1여객터미널 출발' },
  LJ201: { airline: '진에어', depIata: 'ICN', arrIata: 'NRT', depTime: '07:25', arrTime: '10:00', memo: '인천 제2여객터미널 출발' },
  TW211: { airline: '티웨이항공', depIata: 'ICN', arrIata: 'NRT', depTime: '07:45', arrTime: '10:20', memo: '인천 제1여객터미널 출발' },
  JL090: { airline: '일본항공(JAL)', depIata: 'GMP', arrIata: 'HND', depTime: '08:00', arrTime: '10:10', memo: '김포 국제선 청사 출발' },
  NH862: { airline: '전일본공수(ANA)', depIata: 'GMP', arrIata: 'HND', depTime: '07:45', arrTime: '09:55', memo: '김포 국제선 청사 출발' }
};

function formatAirportLabel(iataCode, fallbackName = '') {
  const code = String(iataCode || '').trim().toUpperCase();
  if (!code) return fallbackName || '';
  const ko = AIRPORT_KO_MAP[code];
  if (ko) {
    return `${ko.city} (${code})`;
  }
  return fallbackName ? `${fallbackName} (${code})` : code;
}

export async function lookupFlightWithAirLabs(flightCodeInput) {
  const code = String(flightCodeInput || '').replace(/\s+/g, '').toUpperCase();
  if (!code) return null;

  const prefix = code.substring(0, 2);
  const mappedAirlineKo = AIRLINE_KO_MAP[prefix] || '';

  // 1) AirLabs 실시간 API 호출
  if (AIRLABS_API_KEY && AIRLABS_API_KEY.trim() !== '') {
    try {
      const apiUrl = `https://airlabs.co/api/v9/flight?flight_iata=${encodeURIComponent(code)}&api_key=${encodeURIComponent(AIRLABS_API_KEY.trim())}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const json = await res.json();
        const f = json?.response;
        if (f && (f.dep_iata || f.arr_iata)) {
          const depIata = String(f.dep_iata || '').toUpperCase();
          const arrIata = String(f.arr_iata || '').toUpperCase();
          const airline = mappedAirlineKo || AIRLINE_KO_MAP[f.airline_iata] || f.airline_name || prefix;

          const depLabel = formatAirportLabel(depIata, f.dep_city || f.dep_name);
          const arrLabel = formatAirportLabel(arrIata, f.arr_city || f.arr_name);

          const extractHHMM = (str) => {
            if (!str) return '';
            const match = String(str).match(/(\d{2}:\d{2})/);
            return match ? match[1] : '';
          };

          const depTime = extractHHMM(f.dep_time);
          const arrTime = extractHHMM(f.arr_time);
          const memoParts = [];
          if (f.dep_terminal) memoParts.push(`출발 터미널: ${f.dep_terminal}`);
          if (f.arr_terminal) memoParts.push(`도착 터미널: ${f.arr_terminal}`);
          if (depTime && arrTime) memoParts.push(`운항 시간: ${depTime} ~ ${arrTime}`);

          return {
            flightNo: code,
            airline,
            depIata,
            arrIata,
            dep: depLabel,
            arr: arrLabel,
            depTime: depTime || '09:00',
            arrTime: arrTime || '',
            memo: memoParts.join(' · '),
            source: 'AirLabs 실시간 API'
          };
        }
      }
    } catch (err) {
      console.warn('AirLabs API 호출 실패, 내장 항공편 DB로 폴백:', err);
    }
  }

  // 2) 내장 항공편 스케줄 DB 조회
  const localHit = LOCAL_FLIGHT_SCHEDULE_DB[code];
  if (localHit) {
    return {
      flightNo: code,
      airline: localHit.airline,
      depIata: localHit.depIata,
      arrIata: localHit.arrIata,
      dep: formatAirportLabel(localHit.depIata),
      arr: formatAirportLabel(localHit.arrIata),
      depTime: localHit.depTime,
      arrTime: localHit.arrTime,
      memo: `${localHit.memo} (${localHit.depTime} 출발 ~ ${localHit.arrTime} 도착)`,
      source: '내장 스케줄 DB'
    };
  }

  // 3) 항공사 2글자 코드만 매칭된 경우
  if (mappedAirlineKo) {
    return {
      flightNo: code,
      airline: mappedAirlineKo,
      depIata: '',
      arrIata: '',
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

// app.js 호환용 별칭 export
export const lookupFlightInfo = lookupFlightWithAirLabs;

// ============================================================================
// [5. 장소 좌표 변환(Geocoding) 및 두 좌표 간 거리 계산(Haversine) 서비스]
// ============================================================================
const PLACE_COORDS_CACHE = {
  인천국제공항: { lat: 37.4602, lng: 126.4407, displayName: '인천국제공항 (ICN)' },
  김포국제공항: { lat: 37.5583, lng: 126.7906, displayName: '김포국제공항 (GMP)' },
  요나고공항: { lat: 35.4922, lng: 133.2364, displayName: '요나고 기타로 공항 (YGJ)' },
  요나고: { lat: 35.4281, lng: 133.3309, displayName: '일본 돗토리현 요나고시' },
  사카이미나토: { lat: 35.5457, lng: 133.2319, displayName: '일본 사카이미나토 (미즈키 시게루 로드)' },
  마쓰에: { lat: 35.4681, lng: 133.0484, displayName: '일본 시마네현 마쓰에시' },
  마쓰에성: { lat: 35.4751, lng: 133.0507, displayName: '마쓰에성 천수각' },
  아다치미술관: { lat: 35.3775, lng: 133.1904, displayName: '아다치 미술관 (야스기)' },
  이즈모타이샤: { lat: 35.4020, lng: 132.6853, displayName: '이즈모 대사 (이즈모타이샤)' },
  다이센: { lat: 35.3711, lng: 133.5389, displayName: '다이센 산 (돗토리)' },
  돗토리사구: { lat: 35.5401, lng: 134.2286, displayName: '돗토리 사구' },
  도쿄타워: { lat: 35.6586, lng: 139.7454, displayName: '도쿄 타워' },
  아사쿠사: { lat: 35.7148, lng: 139.7967, displayName: '도쿄 아사쿠사 센소지' },
  시부야: { lat: 35.6595, lng: 139.7004, displayName: '도쿄 시부야' },
  신주쿠: { lat: 35.6896, lng: 139.6995, displayName: '도쿄 신주쿠' },
  도톤보리: { lat: 34.6687, lng: 135.5013, displayName: '오사카 도톤보리' },
  교토역: { lat: 34.9858, lng: 135.7588, displayName: '교토역' },
  하카타역: { lat: 33.5902, lng: 130.4207, displayName: '후쿠오카 하카타역' }
};

export async function geocodePlace(placeQuery) {
  const clean = String(placeQuery || '').trim();
  if (!clean) return null;

  // 1) 3자리 공항 IATA 코드 포함 여부 먼저 확인
  const upper = clean.toUpperCase();
  const codeMatches = upper.match(/\b[A-Z]{3}\b/g) || [];
  for (const code of codeMatches) {
    if (AIRPORT_KO_MAP[code]) {
      const ap = AIRPORT_KO_MAP[code];
      return {
        lat: ap.lat,
        lng: ap.lng,
        displayName: `${ap.name} (${code})`
      };
    }
  }

  // 2) 내장 주요 관광지/도시 캐시 매칭
  const compactKey = clean.replace(/\s+/g, '');
  for (const key of Object.keys(PLACE_COORDS_CACHE)) {
    if (compactKey.includes(key) || key.includes(compactKey)) {
      return { ...PLACE_COORDS_CACHE[key] };
    }
  }

  // 3) OpenStreetMap Nominatim 무료 지오코딩 API 호출
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(clean)}`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'ko,en' }
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const hit = list[0];
        const coords = {
          lat: parseFloat(hit.lat),
          lng: parseFloat(hit.lon),
          displayName: hit.display_name || clean
        };
        PLACE_COORDS_CACHE[compactKey] = coords;
        return coords;
      }
    }
  } catch (err) {
    console.warn(`장소 좌표 변환 실패 (${clean}):`, err);
  }

  return null;
}

export function calcDistance(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // 지구 반지름 (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
}

// ============================================================================
// [6. 이미지 리사이징·압축 및 1/N 정산 보조 유틸리티]
// ============================================================================
export function compressImageFileToBase64(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('파일이 선택되지 않았습니다.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.width;
          let h = img.height;
          if (w > maxWidth) {
            h = Math.round((h * maxWidth) / w);
            w = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

export function calculateOneOverNSettlement(expenses = [], members = ['나'], myNickname = '나') {
  const cleanMembers =
    Array.isArray(members) && members.length > 0
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

    const participants =
      Array.isArray(exp.participants) && exp.participants.length > 0
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
