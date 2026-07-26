// GitHub Actions(및 로컬)에서 나라장터를 조회해 커밋되는 스냅샷 파일을 갱신한다.
// data/open_bids.json(gitignore, 로컬 라이브 캐시)과 달리, data/snapshot/*.snapshot.json은
// 레포에 커밋되는 정적 폴백 + 최신 공고 가시성 확보용이다. 인증키는 파일이 아니라 env로 주입.
const fs = require('fs');
const path = require('path');
const g2b = require('../lib/g2b');

const KEY = process.env.G2B_SERVICE_KEY;
if (!KEY) { console.error('G2B_SERVICE_KEY 환경변수가 없습니다.'); process.exit(1); }

const DIR = path.join(__dirname, '..', 'data', 'snapshot');
const DAYS = Number(process.env.SNAPSHOT_DAYS || 30);

(async () => {
  const raw = await g2b.fetchRecentCnstwkBids({ serviceKey: KEY, days: DAYS });
  const { openPayload, myBidPayload } = g2b.buildBidLists(raw);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'open_bids.snapshot.json'), JSON.stringify(openPayload, null, 1), 'utf8');
  fs.writeFileSync(path.join(DIR, 'mybid_list.snapshot.json'), JSON.stringify(myBidPayload, null, 1), 'utf8');
  console.log(`스냅샷 갱신: 진행중 ${openPayload.count}건 / 수주가능 ${myBidPayload.count}건 (최근 ${DAYS}일)`);
})().catch((e) => { console.error('나라장터 조회 실패:', e.message); process.exit(1); });
