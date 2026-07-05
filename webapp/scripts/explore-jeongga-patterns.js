// AI 추론에 참고할 "발주처별/종목별 예가율(예정가격÷기초금액) 기초 통계" 조회 스크립트.
// 특정 posting_id의 정답을 직접 알려주는 게 아니라, 발주처/종목 단위의 집계 패턴(평균/표준편차/건수)만
// 보여준다 — 실제 입찰 담당자가 "이 발주처는 보통 이 정도 사정률로 나온다"를 파악하는 것과 동일한 방식.
const analysis = require('../lib/analysis');

const rows = analysis.loadHistory().filter(r => r.예가율 != null);

function stats(items) {
  const n = items.length;
  if (!n) return null;
  const mean = items.reduce((s, x) => s + x, 0) / n;
  const variance = items.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return { n, mean, sd: Math.sqrt(variance), min: Math.min(...items), max: Math.max(...items) };
}

const args = process.argv.slice(2);
const mode = args[0]; // 'org' | 'category' | 'org-name'

if (mode === 'category') {
  const byCat = {};
  for (const r of rows) {
    const key = r.is포장군 && r.is상하수도군 ? '중복' : r.is포장군 ? '포장' : r.is상하수도군 ? '상하수도' : '기타';
    (byCat[key] ||= []).push(r.예가율);
  }
  for (const [k, v] of Object.entries(byCat)) {
    console.log(k, JSON.stringify(stats(v)));
  }
} else if (mode === 'org') {
  const byOrg = {};
  for (const r of rows) (byOrg[r.발주처] ||= []).push(r.예가율);
  const result = Object.entries(byOrg)
    .filter(([, v]) => v.length >= 3)
    .map(([name, v]) => ({ name, ...stats(v) }))
    .sort((a, b) => b.n - a.n);
  console.log(JSON.stringify(result, null, 1));
} else if (mode === 'org-name') {
  const target = args[1];
  const items = rows.filter(r => r.발주처 === target).map(r => r.예가율);
  console.log(target, JSON.stringify(stats(items)));
} else if (mode === 'amount-band') {
  const bands = [
    [0, 50_000_000], [50_000_000, 100_000_000], [100_000_000, 300_000_000],
    [300_000_000, 500_000_000], [500_000_000, 1_000_000_000], [1_000_000_000, Infinity],
  ];
  for (const [lo, hi] of bands) {
    const items = rows.filter(r => r.기초금액 >= lo && r.기초금액 < hi).map(r => r.예가율);
    console.log(`${lo}~${hi}`, JSON.stringify(stats(items)));
  }
} else {
  console.log('usage: node explore-jeongga-patterns.js [category|org|org-name <발주처>|amount-band]');
}
