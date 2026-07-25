// 과거 낙찰 이력 전체(4,157건)를 leave-one-out으로 AI최종(가중중앙값)·기존(가중평균) 예정가격 예측
// 정확도를 검증해 data/ai-prediction/full_history_report.json으로 저장한다. 순수 계산(1초 이내).
// 150건 표본 채점(score-ai-predictions.js)과 별개의 "전수 검증" — 표본 편향 없이 결론을 교차확인한다.
const fs = require('fs');
const path = require('path');
const analysis = require('../lib/analysis');

const OUT = path.join(__dirname, '..', 'data', 'ai-prediction', 'full_history_report.json');
const t0 = Date.now();
const report = { scoredAt: new Date().toISOString(), ...analysis.validateFullHistory() };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1), 'utf8');

const pct = (x, d = 4) => (x * 100).toFixed(d) + '%';
console.log(`=== 전수 검증 완료: ${report.n}건 (${Date.now() - t0}ms) ===`);
console.log(`[AI최종] MAE ${pct(report.aiFinal.mae)} / ±1% 적중 ${pct(report.aiFinal.hitRates['±1.0%'], 1)}`);
console.log(`[기존]   MAE ${pct(report.baseline.mae)} / ±1% 적중 ${pct(report.baseline.hitRates['±1.0%'], 1)}`);
console.log(`저장: ${OUT}`);
