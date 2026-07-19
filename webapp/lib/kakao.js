// 카카오톡 "나에게 보내기" API 연동
// 1회성 OAuth 인가(사용자가 직접 카카오 로그인 후 동의)로 refresh_token을 발급받아 저장해두고,
// 이후에는 refresh_token으로 access_token을 자동 갱신하며 본인 카카오톡으로 메시지를 보낸다.
//
// fs 의존을 제거하기 위해 createKakaoClient({ restApiKey, loadTokens, saveTokens }) 팩토리로 감쌌다.
// - Node(로컬 server.js): kakao.local.md의 REST 키 + data/kakao_token.json 파일 store (아래 기본 export).
// - Worker(Cloudflare): env secret 키 + KV token store를 주입 (createKakaoClient 직접 사용).
const fs = require('fs');
const path = require('path');

const REDIRECT_URI = 'http://localhost:4173/oauth/kakao/callback';
// 파일 경로는 Node(로컬)에서만 사용 — top-level __dirname 실행을 피하려 지연 계산.
const configPath = () => path.join(__dirname, '..', 'kakao.local.md');
const tokenPath = () => path.join(__dirname, '..', 'data', 'kakao_token.json');

function readConfig() {
  const text = fs.readFileSync(configPath(), 'utf8');
  const restApiKey = text.match(/REST API 키:\s*(\S+)/)?.[1];
  if (!restApiKey) throw new Error('kakao.local.md에서 REST API 키를 찾을 수 없습니다.');
  return { restApiKey };
}

function readTokens() {
  const p = tokenPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveTokensToFile(tokens) {
  const p = tokenPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(tokens, null, 1), 'utf8');
}

// restApiKey(문자열) + loadTokens/saveTokens(동기 또는 async) 주입식 카카오 클라이언트.
// access_token은 인스턴스에 메모이즈 → 한 번의 실행(cron run 등)에서 refresh는 최대 1회.
function createKakaoClient({ restApiKey, loadTokens, saveTokens, redirectUri = REDIRECT_URI }) {
  let memoToken = null;
  let memoExpiresAtMs = 0;

  function getAuthorizeUrl() {
    const params = new URLSearchParams({
      client_id: restApiKey,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'talk_message',
    });
    return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
  }

  async function exchangeCodeForToken(code) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: restApiKey,
      redirect_uri: redirectUri,
      code,
    });
    const res = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
    const saved = { ...data, obtained_at: Date.now() };
    await saveTokens(saved);
    return saved;
  }

  async function refreshAccessToken() {
    const tokens = await loadTokens();
    if (!tokens?.refresh_token) throw new Error('저장된 refresh_token이 없습니다. 최초 1회 인가가 필요합니다.');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: restApiKey,
      refresh_token: tokens.refresh_token,
    });
    const res = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error('토큰 갱신 실패: ' + JSON.stringify(data));
    // 카카오는 refresh_token을 항상 새로 내려주지 않을 수 있으므로 기존 값 유지
    const merged = { ...tokens, ...data, obtained_at: Date.now() };
    await saveTokens(merged);
    return merged;
  }

  async function getValidAccessToken() {
    if (memoToken && Date.now() < memoExpiresAtMs) return memoToken;
    const tokens = await loadTokens();
    if (!tokens) throw new Error('저장된 토큰이 없습니다. 최초 1회 인가가 필요합니다.');
    const ageSec = (Date.now() - tokens.obtained_at) / 1000;
    const expiresIn = tokens.expires_in || 21599;
    let active = tokens;
    if (ageSec > expiresIn - 300) active = await refreshAccessToken();
    memoToken = active.access_token;
    // 안전하게 남은 유효시간의 절반만 메모 유효로 간주
    const remainSec = (active.expires_in || 21599) - (Date.now() - active.obtained_at) / 1000;
    memoExpiresAtMs = Date.now() + Math.max(remainSec * 500, 0);
    return memoToken;
  }

  async function sendToMe({ text, linkUrl, buttonTitle = '대시보드 열기' }) {
    const accessToken = await getValidAccessToken();
    const templateObject = {
      object_type: 'text',
      text,
      link: { web_url: linkUrl, mobile_web_url: linkUrl },
      button_title: buttonTitle,
    };
    const body = new URLSearchParams({ template_object: JSON.stringify(templateObject) });
    const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error('메시지 발송 실패: ' + JSON.stringify(data));
    return data;
  }

  return { getAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, getValidAccessToken, sendToMe };
}

// ---- Node(로컬) 기본 클라이언트: 파일 기반. 설정 파일이 없어도 import 시엔 안 터지도록 지연 초기화. ----
let _nodeClient = null;
function nodeClient() {
  if (_nodeClient) return _nodeClient;
  _nodeClient = createKakaoClient({
    restApiKey: readConfig().restApiKey,
    loadTokens: async () => readTokens(),
    saveTokens: async (t) => saveTokensToFile(t),
  });
  return _nodeClient;
}

module.exports = {
  createKakaoClient,
  getAuthorizeUrl: () => nodeClient().getAuthorizeUrl(),
  exchangeCodeForToken: (code) => nodeClient().exchangeCodeForToken(code),
  sendToMe: (opts) => nodeClient().sendToMe(opts),
  REDIRECT_URI,
};
