// 낙찰 가능성 백테스트 결과를 data/ai-prediction/win_probability_report.json으로 저장한다.
// 순수 통계 계산(~0.4초, 토큰 소비 없음). 해설 문서: BIDDING_WIN_PROBABILITY.md
const fs = require('fs');
const path = require('path');
const analysis = require('../lib/analysis');

const OUT = path.join(__dirname, '..', 'data', 'ai-prediction', 'win_probability_report.json');
const t0 = Date.now();
const report = { scoredAt: new Date().toISOString(), ...analysis.computeWinProbability() };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1), 'utf8');

const pct = (x, d = 3) => (x * 100).toFixed(d) + '%';
console.log(`=== 낙찰 가능성 백테스트 완료: ${report.n}건 (${Date.now() - t0}ms) ===`);
console.log(`기본확률(1/평균참여 ${report.participants.mean.toFixed(0)}개사): ${pct(report.participants.baseProbMean)}`);
console.log(`모델 중심(${report.model.사정률}%) 낙찰률: ${pct(report.model.all.winRate)} (최근1년 ${pct(report.model.recent.winRate)})`);
console.log(`아웃오브샘플 검증: ${pct(report.outOfSample.test.winRate)}`);
console.log(`저장: ${OUT}`);
