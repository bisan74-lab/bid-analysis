// Cloudflare Worker 진입점. 정적 자산(webapp/dist, ASSETS 바인딩)은 그대로 서빙하되,
// "/"와 "/api/*"(로그인 관련 제외)는 세션 쿠키 인증을 통과해야만 서빙한다.
// 관리자 계정/세션비밀키는 KV(ADMIN_KV 바인딩)에 저장 — 로컬 Express의 파일 저장을 KV로 바꾼 것과 동일한 로직.
const authHandlers = require('../lib/authHandlers');
const authCore = require('../lib/auth-core');

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

export default {
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

    return env.ASSETS.fetch(request);
  },
};
