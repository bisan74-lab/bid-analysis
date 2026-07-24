// 낙찰 이력 데이터 로딩 + 통계/입찰가 추천 모델
//
// 가중치 정의 (반감기 1년 지수가중, 최신 데이터를 더 신뢰):
//   최근1년(0~1년전)  raw=1
//   1~2년전           raw=0.5
//   2~3년전           raw=0.25
//   정규화: 57.1% / 28.6% / 14.3%
const RECENCY_WEIGHTS = {
  '최근1년': 4 / 7,
  '1~2년전': 2 / 7,
  '2~3년전': 1 / 7,
};

const fs = require('fs');
const path = require('path');
const { isGyeongnamCityRestricted } = require('./localFilter');

// 파일 경로는 Node에서만 쓰인다(Worker는 loadHistoryFromText로 CSV를 주입). __dirname을 top-level에서
// 실행하면 번들 환경에 따라 문제될 수 있어, 지연 계산으로 둔다.
function historyCsvPath() {
  return path.join(__dirname, '..', '..', 'data', 'raw', 'nbid_busan_gyeongnam_3y_20260704.csv');
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function toNumber(s) {
  if (s == null || s === '' || s === '-') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseOpenDate(s) {
  // "26/07/03 11:00" -> Date
  const m = String(s || '').match(/^(\d\d)\/(\d\d)\/(\d\d)\s+(\d\d):(\d\d)/);
  if (!m) return null;
  const [, yy, mm, dd, hh, mi] = m;
  return new Date(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
}

let _cache = null;

// CSV 텍스트를 파싱해 이력 row 배열로 변환 (fs 비의존 — Node/Worker 공용).
function parseHistory(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < header.length) continue;
    const 기초금액 = toNumber(cols[idx['기초금액']]);
    const 예정가격 = toNumber(cols[idx['예정가격']]);
    const 일순위금액 = toNumber(cols[idx['1순위금액']]);
    const 참여업체수 = toNumber(cols[idx['참여업체수']]);
    const 개찰일 = parseOpenDate(cols[idx['개찰일']]);
    const row = {
      posting_id: cols[idx['posting_id']],
      title: cols[idx['공사명']],
      종목: cols[idx['종목']],
      대업종: cols[idx['대업종']],
      발주처: cols[idx['발주처']],
      지역약칭: cols[idx['지역약칭']],
      기초금액,
      예정가격,
      일순위금액,
      일순위업체: cols[idx['1순위업체']],
      참여업체수,
      개찰일,
      검색지역: cols[idx['검색지역']],
      연차구분: cols[idx['연차구분']],
      weight: RECENCY_WEIGHTS[cols[idx['연차구분']]] || 0,
    };
    if (기초금액 && 예정가격) row.예가율 = 예정가격 / 기초금액;
    if (예정가격 && 일순위금액) row.낙찰률 = 일순위금액 / 예정가격;
    row.is포장군 = row.대업종.includes('지반조성.포장');
    row.is상하수도군 = row.대업종.includes('상.하수도');
    // 경남 시/군(관내 제한 추정) 발주처는 부산 소재 회사가 입찰 불가하므로 전체 데이터에서 제외
    if (isGyeongnamCityRestricted(row.발주처)) continue;
    rows.push(row);
  }
  return rows;
}

// Worker 등 fs가 없는 환경에서 번들된 CSV 텍스트로 이력 캐시를 채운다.
function loadHistoryFromText(csvText) {
  _cache = parseHistory(csvText);
  return _cache;
}

// Node 환경: 파일에서 CSV를 읽어 캐시 (Worker에서 loadHistoryFromText로 이미 채웠으면 그걸 재사용).
function loadHistory() {
  if (_cache) return _cache;
  _cache = parseHistory(fs.readFileSync(historyCsvPath(), 'utf8'));
  return _cache;
}

function weightedPercentile(items, percentile) {
  // items: [{value, weight}], percentile: 0~100
  const valid = items.filter(i => Number.isFinite(i.value) && i.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!valid.length) return null;
  const totalWeight = valid.reduce((s, i) => s + i.weight, 0);
  const target = (percentile / 100) * totalWeight;
  let cum = 0;
  for (const it of valid) {
    cum += it.weight;
    if (cum >= target) return it.value;
  }
  return valid[valid.length - 1].value;
}

function weightedMean(items) {
  const valid = items.filter(i => Number.isFinite(i.value) && i.weight > 0);
  if (!valid.length) return null;
  const totalWeight = valid.reduce((s, i) => s + i.weight, 0);
  const sum = valid.reduce((s, i) => s + i.value * i.weight, 0);
  return sum / totalWeight;
}

// 가중 표준오차(SEM): 평균이 "다음 관측값의 기대 중심"으로서 얼마나 안정적인지 나타내는 밴드 폭 산출에 사용.
// 유효표본수(effective n) = (Σw)^2 / Σ(w^2) 로 가중치 쏠림을 보정.
function weightedMeanAndSem(items) {
  const valid = items.filter(i => Number.isFinite(i.value) && i.weight > 0);
  if (!valid.length) return { mean: null, sem: null, n: 0 };
  const totalWeight = valid.reduce((s, i) => s + i.weight, 0);
  const mean = valid.reduce((s, i) => s + i.value * i.weight, 0) / totalWeight;
  const variance = valid.reduce((s, i) => s + i.weight * (i.value - mean) ** 2, 0) / totalWeight;
  const effectiveN = (totalWeight ** 2) / valid.reduce((s, i) => s + i.weight ** 2, 0);
  const sem = Math.sqrt(variance / Math.max(effectiveN, 1));
  return { mean, sem, n: valid.length, effectiveN };
}

// 가중 히스토그램에서 가장 밀도가 높은(최다빈도) 구간(bin)을 찾는다. binWidth는 낙찰률(비율) 단위.
function findDensestBin(items, binWidth) {
  const valid = items.filter(i => Number.isFinite(i.value) && i.weight > 0);
  if (!valid.length) return null;
  const bins = new Map();
  for (const it of valid) {
    const binIndex = Math.floor(it.value / binWidth);
    bins.set(binIndex, (bins.get(binIndex) || 0) + it.weight);
  }
  let bestIndex = null, bestWeight = -1;
  for (const [idx, w] of bins) {
    if (w > bestWeight) { bestWeight = w; bestIndex = idx; }
  }
  const totalWeight = valid.reduce((s, i) => s + i.weight, 0);
  return {
    lower: bestIndex * binWidth,
    upper: (bestIndex + 1) * binWidth,
    weight: bestWeight,
    share: bestWeight / totalWeight,
  };
}

// 종목 조합 문자열(예: "지반조성.포장/도장.습식.방수.석공/철콘")을 보고
// 어느 이력 그룹과 비교할지 결정한다.
function pickGroup(rows, 대업종) {
  const wantPojang = !대업종 || 대업종.includes('지반조성.포장');
  const wantSudo = !대업종 || 대업종.includes('상.하수도');
  let filtered;
  if (wantPojang && !wantSudo) filtered = rows.filter(r => r.is포장군);
  else if (wantSudo && !wantPojang) filtered = rows.filter(r => r.is상하수도군);
  else filtered = rows; // 전체(둘 다 해당하거나 정보 없음)
  if (filtered.length < 30) filtered = rows; // 표본 부족시 전체 풀로 폴백
  return filtered;
}

// group(이미 포장/상하수도로 걸러진 비교풀) 중 matcher를 만족하는 서브셋의 가중평균 낙찰률이
// baselineMean과 얼마나 다른지(delta)를 구한다. 표본이 minSample 미만이면 편차를 신뢰할 수 없으므로
// null(미적용) — pickGroup()의 "표본 부족 시 폴백" 사상과 동일.
function computeCategoryDeviation(group, matcher, baselineMean, { minSample = 15 } = {}) {
  if (baselineMean == null) return null;
  const subset = group.filter(r => r.낙찰률 != null && matcher(r));
  if (subset.length < minSample) return null;
  const subsetMean = weightedMean(subset.map(r => ({ value: r.낙찰률, weight: r.weight })));
  if (subsetMean == null) return null;
  return { delta: subsetMean - baselineMean, sampleSize: subset.length };
}

// 투찰금액(낙찰하한가) 계산. A값(국민연금·건강보험료·퇴직공제부금·산업안전보건관리비 등 낙찰률과
// 무관하게 실비로 보전되는 고정비)은 낙찰률 할인 대상에서 제외되므로, 예정가격에서 A값을 먼저 빼고
// 낙찰하한율을 곱한 뒤 A값을 그대로 다시 더한다. A값이 없거나 0이면 단순 곱셈으로 자동 축약된다.
//   A값 적용:  (예정가격 − A값) × 낙찰하한율 + A값
//   A값 미적용: 예정가격 × 낙찰하한율
// 낙찰하한율/예가율/낙찰률은 모두 비율(소수, 예: 0.89745) 단위로 다룬다.
function computeTuchalAmount(예정가격, 낙찰하한율, A값 = 0) {
  if (예정가격 == null || 낙찰하한율 == null) return null;
  const a = Number(A값) || 0;
  return Math.round((예정가격 - a) * 낙찰하한율 + a);
}

// 복수예비가격 → 예정가격 확률 분포.
// 실제 예정가격은 (기초금액 ±2~3% 범위에서 난수로 생성된) 15개 복수예비가격 중, 전체 입찰자가 가장 많이
// 선택한 다빈도 4개의 산술평균으로 정해진다. 개별 추첨 결과는 관측할 수 없지만, 과거 실현된 예가율(예정가격
// ÷기초금액) 분포가 "이번 기초금액에서 예정가격이 확률적으로 어느 구간에 떨어지는가"의 경험적 근사가 된다.
// 단일 점(평균)보다 이 확률 밴드로 보는 것이 난수 성격을 반영한다.
function computeJeonggaDistribution(group, 기초금액, pcts = [10, 25, 50, 75, 90]) {
  const items = group.filter(r => r.예가율 != null).map(r => ({ value: r.예가율, weight: r.weight }));
  return pcts.map(p => {
    const ratio = weightedPercentile(items, p);
    return {
      pct: p,
      예가율: ratio,
      사정률: ratio == null ? null : ratio - 1, // 기초금액 대비 편차(±). 보통 ±2~3% 이내
      예정가격: ratio == null ? null : Math.round(기초금액 * ratio),
    };
  });
}

// 종목: 진행중 공고의 세분화 종목 태그 조합 문자열(예: "포장/토공"). 대업종보다 세밀한 축이라, 같은
// 포장/상하수도군 안에서도 세부 공종에 따라 낙찰률이 조금씩 다른 경향을 잡아내는 데 쓴다.
// 발주처: 같은 발주처가 비슷한 공사를 반복 발주하는 경우(예: 특정 학교/기관) 그 발주처만의 성향을 잡는다.
function recommendBid(기초금액, 대업종, { 종목, 발주처 } = {}) {
  const rows = loadHistory();
  const group = pickGroup(rows, 대업종);

  const priceRatioItems = group.filter(r => r.예가율 != null)
    .map(r => ({ value: r.예가율, weight: r.weight }));
  const estRatio = weightedMean(priceRatioItems) ?? 1;
  const estimatedApprovedPrice = Math.round(기초금액 * estRatio);

  const winRatioItems = group.filter(r => r.낙찰률 != null)
    .map(r => ({ value: r.낙찰률, weight: r.weight }));
  const baselineWinMean = weightedMean(winRatioItems);

  // 카테고리 편차 반영: 종목 세부 태그 하나(가장 먼저 표본이 충분한 것) + 발주처(있으면, 가중치 절반)를
  // 낙찰률에 더해서 tiers/전략밴드 전체를 같은 방향으로 이동시킨다.
  const appliedAdjustments = [];
  let totalDelta = 0;

  if (종목) {
    for (const tag of 종목.split('/').filter(Boolean)) {
      const dev = computeCategoryDeviation(
        group, r => (r.종목 || '').split('/').includes(tag), baselineWinMean, { minSample: 15 }
      );
      if (dev) {
        appliedAdjustments.push({ dimension: '종목', value: tag, delta: dev.delta, sampleSize: dev.sampleSize });
        totalDelta += dev.delta;
        break; // 종목 축은 과다 누적 방지를 위해 하나만 적용
      }
    }
  }
  if (발주처) {
    const dev = computeCategoryDeviation(group, r => r.발주처 === 발주처, baselineWinMean, { minSample: 8 });
    if (dev) {
      const weighted = dev.delta * 0.5;
      appliedAdjustments.push({ dimension: '발주처', value: 발주처, delta: weighted, sampleSize: dev.sampleSize });
      totalDelta += weighted;
    }
  }
  const shift = (ratio) => (ratio == null ? null : ratio + totalDelta);

  const tiers = [100, 80, 65, 50].map(p => {
    const ratio = shift(weightedPercentile(winRatioItems, p));
    return {
      probability: p,
      낙찰률: ratio,
      추천금액: ratio != null ? Math.round(estimatedApprovedPrice * ratio) : null,
    };
  });

  // 안정회귀형: 가중평균(낙찰률)으로 "평균 회귀" 기대 중심값을 잡고, 그 평균의 표준오차(SEM) 범위를
  // 상/하한으로 삼는다 — 평균 추정 자체의 통계적 불확실성 범위이므로 "안정적인" 밴드가 된다.
  const { mean: stableMeanRaw, sem: stableSem, n: stableN } = weightedMeanAndSem(winRatioItems);
  const stableMean = shift(stableMeanRaw);
  const stableRegression = stableMean == null ? null : {
    사정률중앙: stableMean,
    사정률상한: stableMean + stableSem,
    사정률하한: stableMean - stableSem,
    중앙값: Math.round(estimatedApprovedPrice * stableMean),
    상한선: Math.round(estimatedApprovedPrice * (stableMean + stableSem)),
    하한선: Math.round(estimatedApprovedPrice * (stableMean - stableSem)),
    표본수: stableN,
  };

  // 공격밀집형: 낙찰률 히스토그램(0.25%p 단위)에서 가중치 기준 가장 밀도가 높은 구간을 찾아 그 구간의
  // 상/하한을 그대로 추천 밴드로 사용한다 — 평균과 무관하게 "실제로 가장 많이 낙찰된 지점"을 노리는 전략.
  const densest = findDensestBin(winRatioItems, 0.0025); // 0.25%p = 0.0025 (비율 단위)
  const aggressiveCluster = densest == null ? null : {
    사정률하한: densest.lower + totalDelta,
    사정률상한: densest.upper + totalDelta,
    하한선: Math.round(estimatedApprovedPrice * (densest.lower + totalDelta)),
    상한선: Math.round(estimatedApprovedPrice * (densest.upper + totalDelta)),
    구간표본비중: densest.share,
  };

  // 복수예비가격 기반 예정가격 확률 분포(경험적). tiers/전략밴드는 이 분포의 중앙(추정예정가격)을 기준으로
  // 낙찰률을 곱한 값이지만, 예정가격 자체가 난수로 흔들리므로 분포도 함께 제공해 상·하방 위험을 보여준다.
  const 예정가격분포 = computeJeonggaDistribution(group, 기초금액);

  return {
    기초금액,
    추정예정가격: estimatedApprovedPrice,
    추정예가율: estRatio,
    표본수: winRatioItems.length,
    예정가격분포,
    tiers,
    stableRegression,
    aggressiveCluster,
    weights: RECENCY_WEIGHTS,
    appliedAdjustments,
  };
}

function computeOverviewStats() {
  const rows = loadHistory();

  const byBucket = {};
  for (const r of rows) byBucket[r.연차구분] = (byBucket[r.연차구분] || 0) + 1;

  const byRegion = {};
  for (const r of rows) byRegion[r.검색지역] = (byRegion[r.검색지역] || 0) + 1;

  const byMonth = {};
  for (const r of rows) {
    if (!r.개찰일) continue;
    const key = `${r.개찰일.getFullYear()}-${String(r.개찰일.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  }

  const byCategory = { '지반조성.포장': 0, '상.하수도': 0, '중복(둘다)': 0 };
  for (const r of rows) {
    if (r.is포장군 && r.is상하수도군) byCategory['중복(둘다)']++;
    else if (r.is포장군) byCategory['지반조성.포장']++;
    else if (r.is상하수도군) byCategory['상.하수도']++;
  }

  const orgCount = {};
  for (const r of rows) orgCount[r.발주처] = (orgCount[r.발주처] || 0) + 1;
  const topOrgs = Object.entries(orgCount).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const localCount = {};
  for (const r of rows) localCount[r.지역약칭] = (localCount[r.지역약칭] || 0) + 1;
  const topLocals = Object.entries(localCount).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  // 낙찰률 히스토그램 (0.01 단위 bucket, -10%~+10% 범위)
  const winRatioHist = {};
  for (const r of rows) {
    if (r.낙찰률 == null) continue;
    const pct = Math.round((r.낙찰률 - 1) * 1000) / 10; // %, 소수1자리
    const bucket = Math.round(pct * 2) / 2; // 0.5% 단위로 묶기
    winRatioHist[bucket] = (winRatioHist[bucket] || 0) + 1;
  }
  const winRatioHistArr = Object.entries(winRatioHist)
    .map(([k, v]) => ({ bucket: Number(k), count: v }))
    .sort((a, b) => a.bucket - b.bucket);

  // 금액 구간별 분포
  const amountBuckets = [
    [0, 50_000_000, '5천만 이하'],
    [50_000_000, 100_000_000, '5천만~1억'],
    [100_000_000, 300_000_000, '1억~3억'],
    [300_000_000, 500_000_000, '3억~5억'],
    [500_000_000, 1_000_000_000, '5억~10억'],
    [1_000_000_000, Infinity, '10억 초과'],
  ];
  const amountDist = amountBuckets.map(([lo, hi, label]) => ({
    label,
    count: rows.filter(r => r.기초금액 != null && r.기초금액 >= lo && r.기초금액 < hi).length,
  }));

  // 참여업체수 vs 낙찰률 산점도용 샘플 (최근1년만, 과밀 방지 위해 최대 400개)
  const scatterAll = rows.filter(r => r.연차구분 === '최근1년' && r.참여업체수 != null && r.낙찰률 != null)
    .map(r => ({ 참여업체수: r.참여업체수, 낙찰률: Math.round((r.낙찰률 - 1) * 1000) / 10 }));
  const scatterSample = scatterAll.length > 400
    ? scatterAll.filter((_, i) => i % Math.ceil(scatterAll.length / 400) === 0)
    : scatterAll;

  // 피어슨 상관계수 (참여업체수 vs 낙찰률, 산점도와 같은 최근1년 표본 기준)
  function pearson(pairs) {
    const n = pairs.length;
    if (n < 2) return null;
    const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
    const my = pairs.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    const denom = Math.sqrt(sxx * syy);
    return denom === 0 ? null : sxy / denom;
  }
  const scatterCorrelation = pearson(scatterAll.map(d => [d.참여업체수, d.낙찰률]));

  // 참여업체수 구간별 평균 낙찰률 (전체 3년치, 가중치 반영) — 경쟁이 치열할수록 낙찰률이 어떻게 움직이는지
  const participantBuckets = [
    [1, 20, '1~20개'],
    [21, 50, '21~50개'],
    [51, 100, '51~100개'],
    [101, 200, '101~200개'],
    [201, 400, '201~400개'],
    [401, Infinity, '400개 초과'],
  ];
  const participantBins = participantBuckets.map(([lo, hi, label]) => {
    const items = rows.filter(r => r.참여업체수 != null && r.낙찰률 != null && r.참여업체수 >= lo && r.참여업체수 <= hi)
      .map(r => ({ value: r.낙찰률, weight: r.weight }));
    return {
      label,
      count: items.length,
      평균낙찰률: items.length ? weightedMean(items) : null,
    };
  }).filter(b => b.count > 0);

  const 예가율Items = rows.filter(r => r.예가율 != null).map(r => ({ value: r.예가율, weight: r.weight }));
  const 낙찰률Items = rows.filter(r => r.낙찰률 != null).map(r => ({ value: r.낙찰률, weight: r.weight }));

  return {
    totalCount: rows.length,
    dateRange: {
      from: rows.reduce((min, r) => (r.개찰일 && (!min || r.개찰일 < min) ? r.개찰일 : min), null),
      to: rows.reduce((max, r) => (r.개찰일 && (!max || r.개찰일 > max) ? r.개찰일 : max), null),
    },
    byBucket,
    byRegion,
    byMonth,
    byCategory,
    topOrgs,
    topLocals,
    winRatioHist: winRatioHistArr,
    amountDist,
    scatter: scatterSample,
    scatterCorrelation,
    scatterSampleTotal: scatterAll.length,
    participantBins,
    weightedStats: {
      예가율_평균: weightedMean(예가율Items),
      낙찰률_중앙값: weightedPercentile(낙찰률Items, 50),
      낙찰률_P80: weightedPercentile(낙찰률Items, 80),
      낙찰률_P65: weightedPercentile(낙찰률Items, 65),
      낙찰률_최대: weightedPercentile(낙찰률Items, 100),
    },
    weights: RECENCY_WEIGHTS,
  };
}

// 낙찰 건수 기준 상위 업체(=자주 낙찰받는 "유명 업체") N곳과, 그 업체들의 낙찰 이력(공고별 기초금액/예정가격/
// 낙찰금액/낙찰률)을 반환한다.
//
// 선정 기준: 단순히 낙찰건수가 많은 업체가 아니라, "낙찰건수도 많으면서 평균낙찰률도 높은" 업체를 고른다.
// (건수 최소 기준을 넘긴 업체 풀 안에서) 건수 순위 + 평균낙찰률 순위를 더한 종합순위가 낮을수록(=둘 다 상위권) 우선한다.
function getTopCompanies(n = 5, { minCount = 10 } = {}) {
  const rows = loadHistory();
  const byCompany = {};
  for (const r of rows) {
    // 낙찰률이 계산 안 된 행은 "유찰"(입찰 실패) 등 실제 낙찰자가 없는 경우이므로 제외
    if (!r.일순위업체 || r.낙찰률 == null) continue;
    (byCompany[r.일순위업체] ||= []).push(r);
  }
  let companies = Object.entries(byCompany).map(([name, records]) => {
    const 낙찰률Items = records.filter(r => r.낙찰률 != null).map(r => ({ value: r.낙찰률, weight: r.weight }));
    const sorted = records.slice().sort((a, b) => (b.개찰일?.getTime() || 0) - (a.개찰일?.getTime() || 0));

    // 입찰가(=낙찰금액, 낙찰자 본인의 투찰가) vs 예정가격(발주처 기준가) 차이 — 원 단위로 얼마나 차이나는지
    const diffs = records.map(r => r.일순위금액 - r.예정가격);
    const avgDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    const avgEstPrice = records.reduce((s, r) => s + r.예정가격, 0) / records.length;
    const avgWinPrice = records.reduce((s, r) => s + r.일순위금액, 0) / records.length;
    const ratios = records.filter(r => r.낙찰률 != null).map(r => r.낙찰률);

    return {
      name,
      총낙찰건수: records.length,
      평균낙찰률: weightedMean(낙찰률Items),
      최소낙찰률: ratios.length ? Math.min(...ratios) : null,
      최대낙찰률: ratios.length ? Math.max(...ratios) : null,
      평균예정가격: Math.round(avgEstPrice),
      평균낙찰금액: Math.round(avgWinPrice),
      평균차액: Math.round(avgDiff),
      최소차액: Math.min(...diffs),
      최대차액: Math.max(...diffs),
      records: sorted.map(r => ({
        posting_id: r.posting_id,
        title: r.title,
        발주처: r.발주처,
        지역약칭: r.지역약칭,
        개찰일: r.개찰일,
        대업종: r.대업종,
        기초금액: r.기초금액,
        예정가격: r.예정가격,
        낙찰금액: r.일순위금액,
        낙찰률: r.낙찰률,
        차액: r.일순위금액 - r.예정가격,
      })),
    };
  });

  const pool = companies.filter(c => c.총낙찰건수 >= minCount);
  const base = pool.length >= n ? pool : companies; // 최소건수 기준을 만족하는 업체가 부족하면 전체 풀로 완화

  const byCount = base.slice().sort((a, b) => b.총낙찰건수 - a.총낙찰건수);
  const byRatio = base.slice().sort((a, b) => b.평균낙찰률 - a.평균낙찰률);
  const countRank = new Map(byCount.map((c, i) => [c.name, i]));
  const ratioRank = new Map(byRatio.map((c, i) => [c.name, i]));

  return base
    .map(c => ({ ...c, 종합순위점수: countRank.get(c.name) + ratioRank.get(c.name) }))
    .sort((a, b) => a.종합순위점수 - b.종합순위점수 || b.총낙찰건수 - a.총낙찰건수)
    .slice(0, n);
}

// 특정 업체가 새 공고(기초금액, 대업종)에 얼마로 투찰할지, 그 업체의 과거 낙찰이력만으로 예측한다.
// 예정가격 추정치는 (업체와 무관하게 발주처가 정하므로) 시장 전체의 가중평균 예가율을 사용하고,
// 투찰가는 해당 업체 본인의 가중평균 낙찰률을 곱해서 산출한다.
function predictCompanyBid(companyName, 기초금액, 대업종) {
  const rows = loadHistory();
  const companyRows = rows.filter(r => r.일순위업체 === companyName);

  const wantPojang = !대업종 || 대업종.includes('지반조성.포장');
  const wantSudo = !대업종 || 대업종.includes('상.하수도');
  let group = companyRows;
  if (wantPojang && !wantSudo) group = companyRows.filter(r => r.is포장군);
  else if (wantSudo && !wantPojang) group = companyRows.filter(r => r.is상하수도군);
  if (group.length < 5) group = companyRows; // 종목별 표본이 부족하면 해당 업체의 전체 낙찰이력으로 대체

  const 예가율Items = rows.filter(r => r.예가율 != null).map(r => ({ value: r.예가율, weight: r.weight }));
  const estRatio = weightedMean(예가율Items) ?? 1;
  const estimatedApprovedPrice = Math.round(기초금액 * estRatio);

  const 낙찰률Items = group.filter(r => r.낙찰률 != null).map(r => ({ value: r.낙찰률, weight: r.weight }));
  const companyRatio = weightedMean(낙찰률Items);

  return {
    companyName,
    표본수: group.length,
    신뢰도: group.length >= 5 ? '보통' : '낮음(표본 부족)',
    추정예정가격: estimatedApprovedPrice,
    예측낙찰률: companyRatio,
    예측입찰가: companyRatio != null ? Math.round(estimatedApprovedPrice * companyRatio) : null,
  };
}

// 개선 통계모델: 예정가격(예가율) 예측에 발주처별 편차를 축소추정(James–Stein식 shrinkage)으로 반영한다.
// 기존 baseline(recommendBid의 추정예정가격)은 종목군 전체 가중평균 예가율만 곱하는데, 실제로는 발주처마다
// 기초금액 산정·버림 관행 차이로 예가율에 미세한 계통 편차가 있을 수 있다. 발주처 표본이 많을수록 그 발주처
// 평균을, 적을수록 종목군 평균을 신뢰하도록 n/(n+k)로 가중결합한다(k=20). AI가 수동으로 하던 "발주처 과거
// 평균예가율 vs 종목군 평균 → 축소추정 결합" 추론을 코드로 재현·검증 가능하게 만든 것.
// 채점 공정성을 위해 대상 posting_id 자신은 통계에서 제외(leave-one-out)한다.
function predictJeonggaPrice(feature, { k = 20 } = {}) {
  const rows = loadHistory();
  const group = pickGroup(rows, feature.대업종);
  const groupItems = group
    .filter(r => r.예가율 != null && r.posting_id !== feature.posting_id)
    .map(r => ({ value: r.예가율, weight: r.weight }));
  const groupMean = weightedMean(groupItems) ?? 1;

  let ratio = groupMean;
  let 근거 = `종목군 평균 예가율 ${(groupMean * 100).toFixed(3)}% 적용(발주처 표본 없음)`;
  if (feature.발주처) {
    const orgRows = group.filter(r =>
      r.발주처 === feature.발주처 && r.예가율 != null && r.posting_id !== feature.posting_id);
    if (orgRows.length > 0) {
      const orgMean = weightedMean(orgRows.map(r => ({ value: r.예가율, weight: r.weight })));
      const n = orgRows.length;
      const shrink = n / (n + k);
      ratio = groupMean + (orgMean - groupMean) * shrink;
      근거 = `발주처 "${feature.발주처}" ${n}건 예가율 ${(orgMean * 100).toFixed(2)}% vs 종목군 ${(groupMean * 100).toFixed(2)}% → 축소추정(k=${k}, 가중 ${(shrink * 100).toFixed(0)}%) 결합 ${(ratio * 100).toFixed(3)}%`;
    }
  }
  return {
    예측예가율: ratio,
    예측예정가격: Math.round(feature.기초금액 * ratio),
    근거,
  };
}

module.exports = { loadHistory, loadHistoryFromText, parseHistory, recommendBid, computeOverviewStats, getTopCompanies, predictCompanyBid, predictJeonggaPrice, computeCategoryDeviation, computeTuchalAmount, computeJeonggaDistribution, RECENCY_WEIGHTS };
