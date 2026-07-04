// 카카오톡 "나에게 보내기" API 연동
// 1회성 OAuth 인가(사용자가 직접 카카오 로그인 후 동의)로 refresh_token을 발급받아 저장해두고,
// 이후에는 refresh_token으로 access_token을 자동 갱신하며 본인 카카오톡으로 메시지를 보낸다.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'kakao.local.md');
const TOKEN_PATH = path.join(__dirname, '..', 'data', 'kakao_token.json');
const REDIRECT_URI = 'http://localhost:4173/oauth/kakao/callback';

function readConfig() {
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  const restApiKey = text.match(/REST API 키:\s*(\S+)/)?.[1];
  if (!restApiKey) throw new Error('kakao.local.md에서 REST API 키를 찾을 수 없습니다.');
  return { restApiKey };
}

function readTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 1), 'utf8');
}

function getAuthorizeUrl() {
  const { restApiKey } = readConfig();
  const params = new URLSearchParams({
    client_id: restApiKey,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'talk_message',
  });
  return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const { restApiKey } = readConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: restApiKey,
    redirect_uri: REDIRECT_URI,
    code,
  });
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
  saveTokens({ ...data, obtained_at: Date.now() });
  return data;
}

async function refreshAccessToken() {
  const { restApiKey } = readConfig();
  const tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error('저장된 refresh_token이 없습니다. 최초 1회 인가(/oauth/kakao/start)가 필요합니다.');
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
  saveTokens(merged);
  return merged;
}

async function getValidAccessToken() {
  const tokens = readTokens();
  if (!tokens) throw new Error('저장된 토큰이 없습니다. 최초 1회 인가(/oauth/kakao/start)가 필요합니다.');
  const ageSec = (Date.now() - tokens.obtained_at) / 1000;
  const expiresIn = tokens.expires_in || 21599;
  if (ageSec > expiresIn - 300) {
    const refreshed = await refreshAccessToken();
    return refreshed.access_token;
  }
  return tokens.access_token;
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

module.exports = { getAuthorizeUrl, exchangeCodeForToken, sendToMe, REDIRECT_URI };
