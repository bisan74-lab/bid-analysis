// Cloudflare Worker 진입점.
// - 정적 자산(webapp/dist, ASSETS 바인딩) 서빙 + "/"·"/api/*" 세션 인증 (기존).
// - 진행중 입찰/맞춤정보/공고별 분석 데이터는 KV에서 서빙 (cron이 채움, 없으면 정적 폴백).
// - scheduled(cron, 매일 08시 KST): 나라장터 조회 → KV 갱신 → 신규 입찰 시 카카오 알림.
// 관리자 계정/세션·카카오 토큰·입찰 데이터는 모두 KV(ADMIN_KV 바인딩)에 저장.
const authHandlers = require('../lib/authHandlers');
const authCore = require('../lib/auth-core');
const analysis = require('../lib/analysis');
const g2b = require('../lib/g2b');
const kakao = require('../lib/kakao');
const notify = require('../lib/notifyMessage');

// 과거 낙찰 이력 CSV를 번들에 내장(Text 임포트) → 분석 캐시 1회 초기화 (fs 미사용).
import historyCsv from '../../data/raw/nbid_busan_gyeongnam_3y_20260704.csv';
analysis.loadHistoryFromText(historyCsv);

const DASHBOARD_URL = 'https://bid-analysis.bisan74.workers.dev';

function makeKvStore(env) {
  return {
    async loadAdmins() {
      const raw = await env.ADMIN_KV.get('admins');
      return raw ? JSON.parse(raw) : [];
    },
    async saveAdmins(admins) {
      await env.ADMIN_KV.put('admins', JSON.stringify(admins));
    },
    async getSessionSecret() {
      let secret = await env.ADMIN_KV.get('session_secret');
      if (!secret) {
        secret = authCore.randomHex(32);
        await env.ADMIN_KV.put('session_secret', secret);
      }
      return secret;
    },
  };
}

function makeKakaoClient(env) {
  return kakao.createKakaoClient({
    restApiKey: env.KAKAO_REST_KEY,
    loadTokens: async () => {
      const raw = await env.ADMIN_KV.get('kakao_token');
      return raw ? JSON.parse(raw) : null;
    },
    saveTokens: async (t) => env.ADMIN_KV.put('kakao_token', JSON.stringify(t)),
  });
}

async function kvGetJson(env, key) {
  const raw = await env.ADMIN_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(p => {
    const idx = p.indexOf('=');
    return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1))];
  }));
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extraHeaders } });
}

const SESSION_COOKIE_MAX_AGE = 7 * 24 * 3600;

async function getSession(request, store) {
  const cookies = parseCookies(request);
  if (!cookies.session) return null;
  return authHandlers.verifySession(store, cookies.session);
}

// ---- 나라장터 조회 → KV 갱신(목록 + 공고별 분석 사전계산). notify=true면 신규건 카카오 발송. ----
async function refreshBids(env, { notify: doNotify } = {}) {
  const raw = await g2b.fetchRecentCnstwkBids({ serviceKey: env.G2B_SERVICE_KEY });
  const { openPayload, myBidPayload } = g2b.buildBidLists(raw);

  const prev = await kvGetJson(env, 'open_bids');
  const prevIds = new Set((prev?.items || []).map(i => i.posting_id));
  const newItems = openPayload.items.filter(i => !prevIds.has(i.posting_id));

  await env.ADMIN_KV.put('open_bids', JSON.stringify(openPayload));
  await env.ADMIN_KV.put('mybid_list', JSON.stringify(myBidPayload));

  // 공고별 분석을 미리 계산해 KV에 저장 → /api/analysis/:id는 계산 없이 읽기만(요청당 CPU 최소화).
  const top5 = analysis.getTopCompanies(5);
  const seen = new Set();
  for (const item of [...openPayload.items, ...myBidPayload.items]) {
    if (seen.has(item.posting_id)) continue;
    seen.add(item.posting_id);
    const base = item.기초금액 || item.추정가격;
    let result;
    if (!base) {
      result = { item, error: '기초금액 정보가 없어 분석할 수 없습니다 (예: 전자견적/더미금액 건).' };
    } else {
      const rec = analysis.recommendBid(base, item.대업종, { 종목: item.종목, 발주처: item.발주처 });
      const topCompanies = top5.map(c => analysis.predictCompanyBid(c.name, base, item.대업종));
      result = { item, recommendation: rec, topCompanies };
    }
    await env.ADMIN_KV.put('analysis:' + item.posting_id, JSON.stringify(result));
  }

  if (doNotify && prev && newItems.length > 0) {
    await notifyNewBids(env, newItems);
  }
  return { count: openPayload.count, newCount: newItems.length, firstRun: !prev };
}

// 신규 입찰 카카오 알림. 개별(≤5건)은 분석 요약 + 리포트 링크, 다수(>5건)는 합본 요약 1건.
async function notifyNewBids(env, newItems) {
  const client = makeKakaoClient(env);
  if (newItems.length <= 5) {
    for (const item of newItems) {
      const base = item.기초금액 || item.추정가격;
      let rec = null;
      if (base) rec = analysis.recommendBid(base, item.대업종, { 종목: item.종목, 발주처: item.발주처 });
      const url = `${DASHBOARD_URL}/analysis.html?id=${encodeURIComponent(item.posting_id)}`;
      const text = notify.buildBidAnalysisMessage(item, rec, url);
      await client.sendToMe({ text, linkUrl: url, buttonTitle: '분석 리포트 열기' });
    }
  } else {
    const text = notify.buildNewBidsSummaryMessage(newItems, DASHBOARD_URL);
    await client.sendToMe({ text, linkUrl: DASHBOARD_URL + '/', buttonTitle: '대시보드 열기' });
  }
}

// KV에 데이터가 있으면 그걸, 없으면 정적 자산(빌드 시 생성된 폴백)을 서빙.
async function serveKvOrAsset(env, request, key) {
  const raw = await env.ADMIN_KV.get(key);
  if (raw) return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
  return env.ASSETS.fetch(request);
}

async function serveAnalysis(env, request, url) {
  let id = url.pathname.slice('/api/analysis/'.length);
  if (id.endsWith('.json')) id = id.slice(0, -5);
  id = decodeURIComponent(id);
  const raw = await env.ADMIN_KV.get('analysis:' + id);
  if (raw) return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
  return env.ASSETS.fetch(request); // 정적 사전생성 폴백(스냅샷 공고)
}

export default {
  async scheduled(event, env, ctx) {
    try {
      const r = await refreshBids(env, { notify: true });
      console.log(`[cron] 나라장터 ${r.count}건, 신규 ${r.newCount}건${r.firstRun ? ' (최초 실행 — 알림 생략)' : ''}`);
    } catch (e) {
      console.error('[cron] 실패:', (e && e.message) || e);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const store = makeKvStore(env);

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const result = await authHandlers.handleLogin(store, body.id, body.password);
      if (!result.ok) return json(result, 401);
      const cookie = `session=${result.token}; HttpOnly; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
      return json({ ok: true, id: result.id, mustChangePassword: result.mustChangePassword, registered: !!result.registered }, 200, { 'Set-Cookie': cookie });
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure' });
    }

    if (url.pathname === '/api/auth/me') {
      const session = await getSession(request, store);
      if (!session) return json({ error: 'unauthenticated' }, 401);
      const admins = await store.loadAdmins();
      const me = admins.find(a => a.id === session.id);
      if (!me) return json({ error: 'unauthenticated' }, 401);
      return json({ id: session.id, mustChangePassword: !!me.mustChangePassword });
    }

    if (url.pathname === '/api/auth/change-password' && request.method === 'POST') {
      const session = await getSession(request, store);
      if (!session) return json({ error: '로그인이 필요합니다.' }, 401);
      const body = await request.json().catch(() => ({}));
      const result = await authHandlers.handleChangePassword(store, session.id, body.currentPassword, body.newPassword);
      return json(result, result.ok ? 200 : 400);
    }

    const needsAuth = url.pathname === '/' || url.pathname.startsWith('/api/');
    if (needsAuth) {
      const session = await getSession(request, store);
      if (!session) {
        if (url.pathname.startsWith('/api/')) return json({ error: '로그인이 필요합니다.' }, 401);
        return Response.redirect(url.origin + '/login.html', 302);
      }
    }

    // ---- 데이터 라우트 (인증 통과 후): KV 우선, 없으면 정적 폴백 ----
    if (url.pathname === '/api/open-bids/refresh' && request.method === 'POST') {
      // 수동 새로고침: 데이터만 갱신, 카카오 발송은 안 함(cron 전용).
      try {
        await refreshBids(env, { notify: false });
        const openBids = await kvGetJson(env, 'open_bids');
        return json(openBids || { updatedAt: null, count: 0, items: [] });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }
    if (url.pathname === '/api/open-bids.json') return serveKvOrAsset(env, request, 'open_bids');
    if (url.pathname === '/api/mybid-list.json') return serveKvOrAsset(env, request, 'mybid_list');
    if (url.pathname.startsWith('/api/analysis/')) return serveAnalysis(env, request, url);

    return env.ASSETS.fetch(request);
  },
};
