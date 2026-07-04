// Windows 작업 스케줄러에서 주기적으로 실행: 아이건설넷 진행중 입찰을 새로 긁어와서
// 본인 카카오톡으로 요약 메시지를 발송한다.
// 실행: node scripts/notify.js
const path = require('path');
const scraper = require('../lib/scraper');
const kakao = require('../lib/kakao');
const { buildOpenBidsMessage } = require('../lib/notifyMessage');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:4173/';

(async () => {
  const ts = new Date().toISOString();
  try {
    console.log(`[${ts}] 진행중 입찰 새로고침 시작`);
    const cached = await scraper.refreshOpenBids();
    console.log(`[${ts}] ${cached.count}건 확인, 카카오톡 발송 중`);
    const text = buildOpenBidsMessage(cached, DASHBOARD_URL);
    await kakao.sendToMe({ text, linkUrl: DASHBOARD_URL });
    console.log(`[${ts}] 발송 완료`);
  } catch (e) {
    console.error(`[${ts}] 실패:`, e.message || e);
    process.exitCode = 1;
  }
})();
