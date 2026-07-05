// AI 추론 기반 예정가격 예측 배치 실행 스크립트.
//
// 탐색 결과(explore-jeongga-patterns.js): 예가율(예정가격÷기초금액)은 종목군(포장/상하수도)이나
// 금액대별로는 거의 차이가 없다(평균 0.999 부근, 표준편차 0.007 부근으로 전 구간 균일) — 복수예비가격
// 추첨 매커니즘이 설계대로 종목/금액과 무관하게 작동한다는 뜻. 반면 "발주처" 단위로는 평균이 미세하게
// (약 0.998~1.002 범위) 갈리고, 일부 발주처(예: 국토관리사무소, 국군재정관리단 등)는 표준편차가 눈에
// 띄게 작아(0.005대) 그 기관의 예정가격 산정 관행이 상대적으로 더 "일관적"임을 시사한다.
//
// 이 신호는 실제로 존재하지만 표본이 작은 발주처에서는 노이즈일 수 있으므로, 베이지안 축소추정
// (shrinkage)으로 발주처 평균과 종목군 평균을 표본수 비례로 blend한다. 이것이 기존 recommendBid()
// 모델(발주처 구분 없이 종목군 평균만 사용)보다 나은 지점이 있는지 확인하는 것이 이 실험의 핵심이다.
//
// 정답(answers.json)은 전혀 참조하지 않는다 — 오직 "이 건을 제외한" 나머지 이력의 발주처/종목군 통계만
// 사용한다(leave-one-out).
const fs = require('fs');
const path = require('path');
const analysis = require('../lib/analysis');

const OUT_DIR = path.join(__dirname, '..', 'data', 'ai-prediction');
const SHRINKAGE_K = 20; // 축소추정 강도(가상표본수) — 발주처 표본이 이 수치보다 적으면 종목군 평균 쪽으로 더 당겨짐

function categoryOf(r) {
  if (r.is포장군 && r.is상하수도군) return '중복';
  if (r.is포장군) return '포장';
  if (r.is상하수도군) return '상하수도';
  return '기타';
}

function mean(arr) { return arr.reduce((s, x) => s + x, 0) / arr.length; }
function sd(arr, m) { return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length); }

function main() {
  const features = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'sample_features.json'), 'utf8'));
  const allRows = analysis.loadHistory().filter(r => r.예가율 != null);

  const predictions = [];
  for (const f of features) {
    const cat = categoryOf({
      is포장군: f.대업종.includes('지반조성.포장'),
      is상하수도군: f.대업종.includes('상.하수도'),
    });

    const categoryRatios = allRows
      .filter(r => r.posting_id !== f.posting_id)
      .filter(r => categoryOf(r) === cat || cat === '기타')
      .map(r => r.예가율);
    const categoryMean = categoryRatios.length ? mean(categoryRatios) : mean(allRows.map(r => r.예가율));

    const orgRatios = allRows
      .filter(r => r.posting_id !== f.posting_id && r.발주처 === f.발주처)
      .map(r => r.예가율);
    const orgN = orgRatios.length;
    const orgMean = orgN ? mean(orgRatios) : null;
    const orgSd = orgN >= 2 ? sd(orgRatios, orgMean) : null;

    const shrunkRatio = orgN
      ? (orgN / (orgN + SHRINKAGE_K)) * orgMean + (SHRINKAGE_K / (orgN + SHRINKAGE_K)) * categoryMean
      : categoryMean;

    const 예측예정가격 = Math.round(f.기초금액 * shrunkRatio);

    const 근거 = orgN >= 3
      ? `발주처 "${f.발주처}" 과거 ${orgN}건 평균예가율 ${(orgMean * 100).toFixed(2)}%(표준편차 ${orgSd != null ? (orgSd * 100).toFixed(2) : '-'}%p) vs 종목군(${cat}) 평균 ${(categoryMean * 100).toFixed(2)}% → 축소추정(k=${SHRINKAGE_K}) 결합비율 ${(shrunkRatio * 100).toFixed(3)}% 적용`
      : `발주처 이력 부족(${orgN}건) → 종목군(${cat}) 평균예가율 ${(categoryMean * 100).toFixed(3)}%를 사실상 그대로 적용`;

    predictions.push({ posting_id: f.posting_id, 예측예정가격, 근거 });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'predictions.json'), JSON.stringify(predictions, null, 1), 'utf8');
  console.log(`예측 ${predictions.length}건 생성 완료 -> predictions.json`);
}

main();
