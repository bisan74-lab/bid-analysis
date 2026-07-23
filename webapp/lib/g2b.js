// 나라장터(조달청 OpenAPI, apis.data.go.kr) 기반 진행중 입찰공고 수집.
// 로그인/브라우저 자동화가 필요 없는 순수 REST 호출이다.
// 주의: curl로 이 API를 호출하면 data.go.kr WAF가 403을 반환하지만, Node 내장 fetch(undici)로는
// 정상 응답한다 — 반드시 fetch를 사용할 것 (2026-07-19 확인).
const fs = require('fs');
const path = require('path');
const { isGyeongnamCityRestricted } = require('./localFilter');

// 파일 경로/캐시 쓰기는 Node(로컬)에서만 사용. Worker는 buildBidLists 등 순수함수만 씀 →
// __dirname 실행을 top-level에서 하지 않도록 지연 계산.
const keyPath = () => path.join(__dirname, '..', 'g2b.local.md');
const cachePath = () => path.join(__dirname, '..', 'data', 'open_bids.json');
const myBidCachePath = () => path.join(__dirname, '..', 'data', 'mybid_list.json');

const ENDPOINT = 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoCnstwk';

// 2025년도 시공능력평가확인서 기준 (CLAUDE.md 참고), 원 단위로 환산.
const CAPACITY_LIMIT = {
  '지반조성.포장': 927_892_000,
  '상.하수도': 1_877_206_000,
};

// 추정가격(부가세 제외) → 기초금액(부가세 포함, 공개 금액) 환산 계수.
// 예비가격·사정률·예정가격 산정의 기준점은 반드시 "기초금액"이어야 하는데(참여자 지적: 추정가격 기준으로
// 하면 실제 산출가와 괴리가 큼), 나라장터 목록조회 API는 기초금액을 직접 주지 않고 추정가격(presmptPrce)만
// 준다. 과거 낙찰이력 9,636건에서 기초금액/추정가격 비율은 94.7%가 정확히 1.1, 중앙값·P5·P95 모두 1.1
// (공사 부가세 10%)로 확인돼, 이 계수로 기초금액을 복원한다.
const ESTIMATE_TO_BASE = 1.1;

const TARGET_REGION_PREFIXES = ['부산', '경상남도', '경남'];

// 공고명 키워드 → 대업종(기존 pickGroup()이 그대로 재사용하도록 data/raw CSV와 동일 표기) / 종목(세분화 태그,
// data/raw 실측 빈도 상위 태그만 우선 대상: 포장/토공/상.하수도/보링.그라우팅.파일/철콘/토건/토목).
const KEYWORD_RULES = [
  { pattern: /포장|아스콘|아스팔트|보도블/, 대업종: '지반조성.포장', 종목: '포장' },
  { pattern: /지반조성/, 대업종: '지반조성.포장', 종목: '포장' },
  { pattern: /토공|성토|절토|터파기/, 대업종: '지반조성.포장', 종목: '토공' },
  { pattern: /보링|그라우팅|파일항타|파일공사/, 대업종: '지반조성.포장', 종목: '보링.그라우팅.파일' },
  { pattern: /상수도|급수|정수(장|시설)/, 대업종: '상.하수도', 종목: '상.하수도' },
  { pattern: /하수도|오수|우수|하수관|관로/, 대업종: '상.하수도', 종목: '상.하수도' },
  { pattern: /철콘|철근콘크리트/, 대업종: null, 종목: '철콘' },
  { pattern: /토목/, 대업종: null, 종목: '토목' },
  { pattern: /토건/, 대업종: null, 종목: '토건' },
];

// 공고명 텍스트로 대업종/종목을 추정한다. 대업종에 하나도 안 걸리면(=우리 두 업종과 무관한 공사) null.
function classify(title) {
  const 대업종Set = new Set();
  const 종목Set = new Set();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(title)) {
      if (rule.대업종) 대업종Set.add(rule.대업종);
      if (rule.종목) 종목Set.add(rule.종목);
    }
  }
  if (!대업종Set.size) return null;
  return { 대업종: [...대업종Set].join('/'), 종목: [...종목Set].join('/') };
}

function readServiceKey() {
  const text = fs.readFileSync(keyPath(), 'utf8');
  const m = text.match(/일반 인증키\(Decoding\):\s*(\S+)/);
  if (!m) throw new Error('webapp/g2b.local.md에서 인증키를 찾을 수 없습니다.');
  return m[1];
}

function fmtDt(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}`;
}

async function fetchPage(serviceKey, { pageNo, numOfRows, bgn, end }) {
  const url = `${ENDPOINT}?serviceKey=${serviceKey}&numOfRows=${numOfRows}&pageNo=${pageNo}&inqryDiv=1&inqryBgnDt=${bgn}&inqryEndDt=${end}&type=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`나라장터 API 오류: HTTP ${res.status}`);
  const data = await res.json();
  const header = data?.response?.header;
  if (header?.resultCode !== '00') throw new Error(`나라장터 API 오류: ${header?.resultMsg || '알 수 없음'}`);
  const body = data?.response?.body || {};
  return { items: body.items || [], totalCount: body.totalCount || 0 };
}

// 최근 N일간(공고게시일시 기준) 전국 공사 입찰공고를 가져온다. 나라장터 API 자체가 지역/업종 파라미터를
// 안정적으로 지원하는지 불확실해서(공식 문서에서 명확히 확인 못함) 일단 전국을 받아 이후 단계에서
// 부산/경남 + 우리 업종으로 좁힌다.
// numOfRows는 999(최대)로 크게 잡아 페이지 수를 최소화한다 — Cloudflare Worker 무료 플랜의
// 서브리퀘스트 50개/실행 한도 때문. (14일 전국 ~5천건이면 100건씩=53페이지로 한도 초과, 999건씩=6페이지.)
// serviceKey는 인자로 받는다 (Node는 파일에서 읽어 넘기고, Worker는 env secret을 넘김 — fs 비의존).
async function fetchRecentCnstwkBids({ serviceKey, days = 14 } = {}) {
  if (!serviceKey) throw new Error('serviceKey가 필요합니다.');
  const end = new Date();
  const bgn = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const numOfRows = 999;
  let pageNo = 1;
  const all = [];
  // 안전장치: 20페이지(≈2만건) 초과 시 중단
  while (pageNo <= 20) {
    const { items, totalCount } = await fetchPage(serviceKey, { pageNo, numOfRows, bgn: fmtDt(bgn), end: fmtDt(end) });
    all.push(...items);
    if (all.length >= totalCount || items.length === 0) break;
    pageNo++;
  }
  return all;
}

function normalizeItem(raw) {
  const category = classify(raw.bidNtceNm || '');
  if (!category) return null; // 우리 업종과 무관한 공사

  const region = raw.cnstrtsiteRgnNm || '';
  if (!TARGET_REGION_PREFIXES.some((p) => region.startsWith(p))) return null;

  const 발주처 = raw.dminsttNm || raw.ntceInsttNm || '';
  if (isGyeongnamCityRestricted(발주처)) return null;

  // 나라장터 일시(bidClseDt/opengDt)는 한국시간(KST)이다. 타임존 접미사 없이 파싱하면 실행환경
  // 로컬시간으로 해석돼(로컬=KST면 맞지만 Worker=UTC면 9시간 늦게 해석) 만료 공고가 오래 남는다.
  // '+09:00'을 붙여 항상 KST로 고정 → 런타임 타임존과 무관하게 동일하게 판정.
  const toKst = (s) => s ? new Date(s.replace(' ', 'T') + '+09:00') : null;
  const closeAt = toKst(raw.bidClseDt);
  const openAt = toKst(raw.opengDt);
  const deadline = closeAt || openAt;
  if (deadline && deadline.getTime() < Date.now()) return null; // 이미 마감 — "진행중"만 남김

  const estimated = Number(raw.presmptPrce) || Number(raw.bdgtAmt) || null;
  const 추정가격 = estimated && estimated > 1 ? estimated : null; // 전자견적 등 1원 더미값 배제

  // 나라장터 목록조회는 기초금액을 직접 주지 않으므로 추정가격×1.1(부가세)로 복원한다. 모든 사정률/예비가격/
  // 예정가격 추정의 기준점을 기초금액으로 고정하기 위함(추정가격 기준일 때 생기던 ~10% 괴리 제거).
  const 기초금액 = 추정가격 ? Math.round(추정가격 * ESTIMATE_TO_BASE) : null;

  return {
    posting_id: `${raw.bidNtceNo}-${raw.bidNtceOrd}`,
    title: raw.bidNtceNm,
    종목: category.종목,
    대업종: category.대업종,
    발주처,
    지역: region,
    기초금액,             // 추정가격×1.1로 복원한 값(부가세 포함, 공개 기초금액 근사)
    기초금액추정: 기초금액 != null, // 나라장터가 직접 준 값이 아니라 환산 추정임을 표시
    추정가격,
    등록마감일: raw.bidClseDt || null,
    개찰일: raw.opengDt || null,
    원문링크: raw.bidNtceDtlUrl || null,
    계약방법: raw.cntrctCnclsMthdNm || null,
  };
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.posting_id)) continue;
    seen.add(it.posting_id);
    out.push(it);
  }
  return out;
}

// 기초금액(추정가격)이 해당 업종 시공능력평가액 이하 — "우리가 실제로 수주 가능한 규모"인 것만 추림.
// 대업종이 두 업종에 모두 걸치면 더 작은(보수적) 한도를 적용.
function fitsCapacity(item) {
  if (!item.추정가격) return false;
  const has포장 = item.대업종.includes('지반조성.포장');
  const has상하수도 = item.대업종.includes('상.하수도');
  const limit = has포장 && has상하수도
    ? Math.min(CAPACITY_LIMIT['지반조성.포장'], CAPACITY_LIMIT['상.하수도'])
    : has상하수도 ? CAPACITY_LIMIT['상.하수도'] : CAPACITY_LIMIT['지반조성.포장'];
  return item.추정가격 <= limit;
}

// 나라장터 원본 아이템 배열 → 정규화·필터링된 진행중 입찰(open) + 수주 가능 규모(mybid) 목록.
// 순수함수(fs 비의존) — Node/Worker 공용. 캐시 페이로드 포맷까지 만들어 반환.
function buildBidLists(rawItems, { now = new Date() } = {}) {
  const items = dedupe(rawItems.map(normalizeItem).filter(Boolean));
  const ts = now.toISOString();
  const openPayload = { updatedAt: ts, count: items.length, items, source: 'g2b' };
  const myBidItems = items.filter(fitsCapacity);
  const myBidPayload = { updatedAt: ts, count: myBidItems.length, items: myBidItems, source: 'g2b-capacity-fit' };
  return { openPayload, myBidPayload };
}

// Node 로컬 전용: 키를 파일에서 읽어 수집 → JSON 캐시 파일로 저장 (로컬 "실시간 새로고침" 버튼용).
async function refreshAndCache({ days = 14 } = {}) {
  const raw = await fetchRecentCnstwkBids({ serviceKey: readServiceKey(), days });
  const { openPayload, myBidPayload } = buildBidLists(raw);

  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify(openPayload, null, 1), 'utf8');
  fs.writeFileSync(myBidCachePath(), JSON.stringify(myBidPayload, null, 1), 'utf8');

  return openPayload;
}

module.exports = { refreshAndCache, fetchRecentCnstwkBids, buildBidLists, normalizeItem, classify, CAPACITY_LIMIT };
