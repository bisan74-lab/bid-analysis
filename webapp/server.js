const express = require('express');
const path = require('path');
const analysis = require('./lib/analysis');
const scraper = require('./lib/scraper');
const kakao = require('./lib/kakao');
const { buildOpenBidsMessage } = require('./lib/notifyMessage');
const adminStore = require('./lib/adminStore.local');
const authHandlers = require('./lib/authHandlers');

const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.json());

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(p => {
    const idx = p.indexOf('=');
    return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1))];
  }));
}

async function getSession(req) {
  const cookies = parseCookies(req);
  if (!cookies.session) return null;
  return authHandlers.verifySession(adminStore, cookies.session);
}

const SESSION_COOKIE_MAX_AGE = 7 * 24 * 3600;

// 로그인 관련 API(등록/로그인/비밀번호변경/내정보)는 인증 없이도 호출 가능해야 함.
// 그 외 페이지(/)와 /api/*(데이터) 는 로그인해야만 접근 가능.
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/auth/')) return next();
  const needsAuth = req.path === '/' || req.path.startsWith('/api/');
  if (!needsAuth) return next();
  const session = await getSession(req);
  if (!session) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인이 필요합니다.' });
    return res.redirect('/login.html');
  }
  req.adminId = session.id;
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/login', async (req, res) => {
  const result = await authHandlers.handleLogin(adminStore, req.body?.id, req.body?.password);
  if (!result.ok) return res.status(401).json(result);
  res.setHeader('Set-Cookie', `session=${result.token}; HttpOnly; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax`);
  res.json({ ok: true, id: result.id, mustChangePassword: result.mustChangePassword, registered: !!result.registered });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthenticated' });
  const admins = await adminStore.loadAdmins();
  const me = admins.find(a => a.id === session.id);
  if (!me) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ id: session.id, mustChangePassword: !!me.mustChangePassword });
});

app.post('/api/auth/change-password', async (req, res) => {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const result = await authHandlers.handleChangePassword(adminStore, session.id, req.body?.currentPassword, req.body?.newPassword);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/history/stats.json', (req, res) => {
  try {
    res.json(analysis.computeOverviewStats());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/open-bids.json', (req, res) => {
  const cached = scraper.readCachedOpenBids();
  if (!cached) return res.json({ updatedAt: null, count: 0, items: [] });
  res.json(cached);
});

app.get('/api/mybid-list.json', (req, res) => {
  const cached = scraper.readCachedMyBidList();
  if (!cached) return res.json({ updatedAt: null, count: 0, items: [] });
  res.json(cached);
});

app.post('/api/open-bids/refresh', async (req, res) => {
  // 아이건설넷이 자동 로그인을 감지하고 경고를 띄운 이후로 로그인 스크래핑을 전면 중단함 (2026-07-19).
  // 대체 데이터 소스(나라장터 OpenAPI) 연동 전까지는 비활성 상태로 둔다.
  res.status(410).json({ error: '아이건설넷 자동 로그인은 중단되었습니다. 나라장터 연동으로 대체 예정입니다.' });
});

app.get('/api/analysis/:postingId', (req, res) => {
  // 정적 배포본(Cloudflare)과 경로를 맞추기 위해 클라이언트는 .json 접미사를 붙여 요청함 —
  // Express 라우트 패턴 자체에 .json을 넣지 않고 핸들러에서 떼어내서, 공고번호 자체에
  // 마침표가 들어있는 경우에도 안전하게 동작하게 한다.
  const postingId = req.params.postingId.endsWith('.json')
    ? req.params.postingId.slice(0, -5)
    : req.params.postingId;
  const openCached = scraper.readCachedOpenBids();
  const myBidCached = scraper.readCachedMyBidList();
  const item = openCached?.items.find(i => i.posting_id === postingId)
    || myBidCached?.items.find(i => i.posting_id === postingId);
  if (!item) return res.status(404).json({ error: '해당 공고를 찾을 수 없습니다. 새로고침을 먼저 실행하세요.' });
  const baseAmount = item.기초금액 || item.추정가격;
  if (!baseAmount) return res.status(400).json({ error: '기초금액 정보가 없어 분석할 수 없습니다 (예: 현필/협정 건).' });
  const rec = analysis.recommendBid(baseAmount, item.대업종);
  const topCompanies = analysis.getTopCompanies(5)
    .map(c => analysis.predictCompanyBid(c.name, baseAmount, item.대업종));
  res.json({ item, recommendation: rec, topCompanies });
});

app.get('/api/top-companies.json', (req, res) => {
  try {
    res.json(analysis.getTopCompanies(5));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/ai-prediction/report.json', (req, res) => {
  try {
    const p = path.join(__dirname, 'data', 'ai-prediction', 'score_report.json');
    if (!require('fs').existsSync(p)) return res.status(404).json({ error: 'AI 예측 채점 결과가 아직 없습니다.' });
    res.json(JSON.parse(require('fs').readFileSync(p, 'utf8')));
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
