// AI(Claude) 예정가격 추론 예측 채점 스크립트.
// predictions.json(AI 예측) vs answers.json(실제 예정가격)을 비교해서 오차율/적중률을 계산하고,
// 기존 단순 통계모델(analysis.recommendBid의 "추정예정가격" = 전체 가중평균 예가율 x 기초금액)과도 비교한다.
const fs = require('fs');
const path = require('path');
const analysis = require('../lib/analysis');

const OUT_DIR = path.join(__dirname, '..', 'data', 'ai-prediction');

function pct(n, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
}

function summarizeErrors(errors) {
  const n = errors.length;
  if (!n) return null;
  const abs = errors.map(e => Math.abs(e));
  const mae = abs.reduce((s, e) => s + e, 0) / n; // 평균 절대 오차율
  const mape = mae; // 여기서 errors는 이미 상대오차(비율)이므로 MAE=MAPE
  const bands = [0.005, 0.01, 0.02, 0.03];
  const hitRates = Object.fromEntries(bands.map(b => [
    `±${(b * 100).toFixed(1)}%`,
    abs.filter(e => e <= b).length / n,
  ]));
  return { n, mae, mape, hitRates };
}

function main() {
  const featuresPath = path.join(OUT_DIR, 'sample_features.json');
  const answersPath = path.join(OUT_DIR, 'answers.json');
  const predictionsPath = path.join(OUT_DIR, 'predictions.json');

  const features = JSON.parse(fs.readFileSync(featuresPath, 'utf8'));
  const answers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
  const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));

  const answerMap = new Map(answers.map(a => [a.posting_id, a]));
  const featureMap = new Map(features.map(f => [f.posting_id, f]));
  const predMap = new Map();
  for (const p of predictions) {
    predMap.set(p.posting_id, p); // 나중 항목이 이전 것을 덮어씀 (재예측 시 최신값 사용)
  }

  const rows = [];
  for (const [postingId, pred] of predMap) {
    const answer = answerMap.get(postingId);
    const feature = featureMap.get(postingId);
    if (!answer || !feature) continue;

    const aiError = (pred.예측예정가격 - answer.예정가격) / answer.예정가격;

    const baseline = analysis.recommendBid(feature.기초금액, feature.대업종);
    const baselineError = (baseline.추정예정가격 - answer.예정가격) / answer.예정가격;

    rows.push({
      posting_id: postingId,
      기초금액: answer.기초금액,
      실제예정가격: answer.예정가격,
      AI예측예정가격: pred.예측예정가격,
      AI오차율: aiError,
      기존모델예측예정가격: baseline.추정예정가격,
      기존모델오차율: baselineError,
      근거: pred.근거 || null,
    });
  }

  const aiSummary = summarizeErrors(rows.map(r => r.AI오차율));
  const baselineSummary = summarizeErrors(rows.map(r => r.기존모델오차율));

  const report = {
    scoredAt: new Date().toISOString(),
    sampleTotal: features.length,
    predictedCount: predMap.size,
    scoredCount: rows.length,
    remaining: features.length - predMap.size,
    ai: aiSummary,
    baseline: baselineSummary,
    rows,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'score_report.json'), JSON.stringify(report, null, 1), 'utf8');

  console.log(`=== 예정가격 예측 채점 결과 ===`);
  console.log(`전체 샘플: ${features.length}건 / 예측 완료: ${predMap.size}건 / 채점 가능: ${rows.length}건`);
  if (aiSummary) {
    console.log(`\n[AI(Claude) 추론 예측]`);
    console.log(`  평균 절대 오차율(MAE): ${pct(aiSummary.mae, 3)}`);
    for (const [band, rate] of Object.entries(aiSummary.hitRates)) {
      console.log(`  ${band} 이내 적중: ${pct(rate)} (${Math.round(rate * aiSummary.n)}/${aiSummary.n}건)`);
    }
  }
  if (baselineSummary) {
    console.log(`\n[기존 통계모델(전체 가중평균 예가율)]`);
    console.log(`  평균 절대 오차율(MAE): ${pct(baselineSummary.mae, 3)}`);
    for (const [band, rate] of Object.entries(baselineSummary.hitRates)) {
      console.log(`  ${band} 이내 적중: ${pct(rate)} (${Math.round(rate * baselineSummary.n)}/${baselineSummary.n}건)`);
    }
  }
  console.log(`\n상세 결과: webapp/data/ai-prediction/score_report.json`);
}

main();
