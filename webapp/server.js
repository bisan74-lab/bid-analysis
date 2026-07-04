const express = require('express');
const path = require('path');
const analysis = require('./lib/analysis');
const scraper = require('./lib/scraper');
const kakao = require('./lib/kakao');
const { buildOpenBidsMessage } = require('./lib/notifyMessage');

const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/history/stats', (req, res) => {
  try {
    res.json(analysis.computeOverviewStats());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/open-bids', (req, res) => {
  const cached = scraper.readCachedOpenBids();
  if (!cached) return res.json({ updatedAt: null, count: 0, items: [] });
  res.json(cached);
});

app.get('/api/mybid-list', (req, res) => {
  const cached = scraper.readCachedMyBidList();
  if (!cached) return res.json({ updatedAt: null, count: 0, items: [] });
  res.json(cached);
});

app.post('/api/open-bids/refresh', async (req, res) => {
  try {
    const result = await scraper.refreshOpenBids(); // 진행중 입찰 + 맞춤정보 함께 갱신됨
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/open-bids/:postingId/analysis', (req, res) => {
  const openCached = scraper.readCachedOpenBids();
  const myBidCached = scraper.readCachedMyBidList();
  const item = openCached?.items.find(i => i.posting_id === req.params.postingId)
    || myBidCached?.items.find(i => i.posting_id === req.params.postingId);
  if (!item) return res.status(404).json({ error: '해당 공고를 찾을 수 없습니다. 새로고침을 먼저 실행하세요.' });
  const baseAmount = item.기초금액 || item.추정가격;
  if (!baseAmount) return res.status(400).json({ error: '기초금액 정보가 없어 분석할 수 없습니다 (예: 현필/협정 건).' });
  const rec = analysis.recommendBid(baseAmount, item.대업종);
  const topCompanies = analysis.getTopCompanies(5)
    .map(c => analysis.predictCompanyBid(c.name, baseAmount, item.대업종));
  res.json({ item, recommendation: rec, topCompanies });
});

app.get('/api/top-companies', (req, res) => {
  try {
    res.json(analysis.getTopCompanies(5));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/oauth/kakao/start', (req, res) => {
  try {
    res.redirect(kakao.getAuthorizeUrl());
  } catch (e) {
    res.status(500).send('카카오 인가 URL 생성 실패: ' + String(e.message || e) + '<br>webapp/kakao.local.md에 REST API 키가 설정되어 있는지 확인하세요.');
  }
});

app.get('/oauth/kakao/callback', async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.status(400).send(`카카오 인가 실패: ${error} - ${error_description || ''}`);
  try {
    await kakao.exchangeCodeForToken(code);
    res.send('카카오 연동 완료! 이 창은 닫으셔도 됩니다. <a href="/">대시보드로 이동</a>');
  } catch (e) {
    res.status(500).send('토큰 발급 실패: ' + String(e.message || e));
  }
});

app.post('/api/notify/test', async (req, res) => {
  try {
    const cached = scraper.readCachedOpenBids();
    const dashboardUrl = `${req.protocol}://${req.get('host')}/`;
    const text = buildOpenBidsMessage(cached, dashboardUrl);
    const result = await kakao.sendToMe({ text, linkUrl: dashboardUrl });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`bid-analysis webapp listening on http://localhost:${PORT}`);
});
