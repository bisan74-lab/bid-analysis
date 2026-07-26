// Cloudflare Workers(정적 자산 전용, Node/Playwright 실행 불가) 배포용 빌드 스크립트.
// webapp/data/snapshot/*.snapshot.json(커밋된 시점 스냅샷)을 기준으로 API 응답을 전부 정적 JSON
// 파일로 미리 만들어 dist/에 출력한다. public/의 정적 자산도 함께 복사하고, index.html에는
// "정적 스냅샷 모드" 플래그를 주입해서 새로고침 버튼 등이 실시간 기능이 없음을 알 수 있게 한다.
const fs = require('fs');
const path = require('path');
const analysis = require('./lib/analysis');

const SNAPSHOT_DIR = path.join(__dirname, 'data', 'snapshot');
const DIST_DIR = path.join(__dirname, 'dist');

function readSnapshot(name) {
  const p = path.join(SNAPSHOT_DIR, name);
  if (!fs.existsSync(p)) return { updatedAt: null, count: 0, items: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(relPath, data) {
  const full = path.join(DIST_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data, null, 1), 'utf8');
}

function buildItemAnalysis(item) {
  const baseAmount = item.기초금액 || item.추정가격;
  if (!baseAmount) return { item, error: '기초금액 정보가 없어 분석할 수 없습니다 (예: 현필/협정 건).' };
  const rec = analysis.recommendBid(baseAmount, item.대업종, { 종목: item.종목, 발주처: item.발주처 });
  const topCompanies = analysis.getTopCompanies(5).map(c => analysis.predictCompanyBid(c.name, baseAmount, item.대업종));
  return { item, recommendation: rec, topCompanies };
}

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 1) public/ 정적 자산 복사
  const publicDir = path.join(__dirname, 'public');
  for (const f of fs.readdirSync(publicDir)) {
    fs.copyFileSync(path.join(publicDir, f), path.join(DIST_DIR, f));
  }

  const openBids = readSnapshot('open_bids.snapshot.json');
  const myBidList = readSnapshot('mybid_list.snapshot.json');
  const snapshotTime = openBids.updatedAt || myBidList.updatedAt || new Date().toISOString();

  // 목록 항목에 경량 Version_2 판정(종합판정·경쟁강도)을 붙여, 대시보드 목록에서 클릭 없이 유리/불리 스캔 가능.
  for (const it of (openBids.items || [])) it.v2판정 = analysis.summarizeV2ForItem(it);
  for (const it of (myBidList.items || [])) it.v2판정 = analysis.summarizeV2ForItem(it);

  // 2) (구) 정적 스냅샷 모드 플래그 주입은 제거됨. 이제 배포본은 Worker + KV(cron 자동갱신) 기반으로
  //    실시간 동작하므로 "실시간 새로고침" 버튼도 정상 작동한다. 아래 정적 JSON들은 KV가 비어있는
  //    최초 상태의 폴백 용도로만 생성한다.

  // 3) 통계/TOP5 정적 JSON (.json 확장자 필수 — Cloudflare Workers 정적 자산이 확장자 없는
  // 파일을 안정적으로 서빙하지 못해 빈 응답을 준 사례가 있었음)
  writeJson('api/history/stats.json', analysis.computeOverviewStats());
  writeJson('api/top-companies.json', analysis.getTopCompanies(5));
  writeJson('api/open-bids.json', openBids);
  writeJson('api/mybid-list.json', myBidList);

  // AI 예정가격 예측 채점 결과 (미리 생성된 정적 파일을 그대로 복사)
  const aiReportPath = path.join(__dirname, 'data', 'ai-prediction', 'score_report.json');
  if (fs.existsSync(aiReportPath)) {
    writeJson('api/ai-prediction/report.json', JSON.parse(fs.readFileSync(aiReportPath, 'utf8')));
  }

  // 전수(4,157건) 검증 결과: 정적 파일이 있으면 복사, 없으면 빌드 시점에 계산해서 생성(순수계산, 1초 이내).
  const fullReportPath = path.join(__dirname, 'data', 'ai-prediction', 'full_history_report.json');
  writeJson('api/ai-prediction/full-report.json',
    fs.existsSync(fullReportPath) ? JSON.parse(fs.readFileSync(fullReportPath, 'utf8')) : analysis.validateFullHistory());

  // 낙찰 가능성 백테스트: 위와 동일 방식.
  const winProbPath = path.join(__dirname, 'data', 'ai-prediction', 'win_probability_report.json');
  writeJson('api/win-probability.json',
    fs.existsSync(winProbPath) ? JSON.parse(fs.readFileSync(winProbPath, 'utf8')) : analysis.computeWinProbability());

  // Version_2 낙찰 전략(경쟁강도 세그먼트·저경쟁 니치) — 순수계산으로 빌드 시점 생성.
  writeJson('api/v2-strategy.json', analysis.computeV2Strategy());

  // 4) 항목별 상세분석 (진행중입찰 + 맞춤정보 합쳐서, posting_id 중복 제거)
  const seen = new Set();
  const allItems = [...openBids.items, ...myBidList.items].filter(it => {
    if (seen.has(it.posting_id)) return false;
    seen.add(it.posting_id);
    return true;
  });
  let generated = 0;
  for (const item of allItems) {
    const result = buildItemAnalysis(item);
    // Cloudflare 정적 자산 서빙은 요청 경로를 디코딩한 뒤 파일을 찾으므로, 파일명은
    // encodeURIComponent 하지 않고 원문 그대로(예: "[R26BK...]") 저장해야 매칭된다.
    writeJson(`api/analysis/${item.posting_id}.json`, result);
    generated++;
  }

  // 5) Cloudflare 정적 자산이 /api/* 경로도 파일 그대로 서빙하도록 헤더 힌트 (없어도 fetch().json()엔 문제 없음)
  fs.writeFileSync(path.join(DIST_DIR, '_headers'), '/api/*\n  Content-Type: application/json\n', 'utf8');

  console.log(`정적 빌드 완료: dist/ (스냅샷 시각 ${snapshotTime}, 공고 분석 ${generated}건)`);
}

main();
