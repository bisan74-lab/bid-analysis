// 로컬(파일 저장) / Cloudflare(KV 저장) 두 환경에서 동일하게 쓰는 로그인/비밀번호변경 로직.
// store 인자는 { loadAdmins(), saveAdmins(admins), getSessionSecret() } (모두 async)만 구현하면 됨.
const auth = require('./auth-core');

const MAX_ADMINS = 2;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const INITIAL_PASSWORD = '0000';

async function issueSession(store, id) {
  const secret = await store.getSessionSecret();
  return auth.createSessionToken({ id, exp: Date.now() + SESSION_TTL_MS }, secret);
}

async function verifySession(store, token) {
  const secret = await store.getSessionSecret();
  return auth.verifySessionToken(token, secret);
}

// 신규 ID면 관리자 자리(최대 2명)가 남아있을 때만, 초기 비밀번호(0000)로 등록.
// 기존 ID면 비밀번호 검증 후 로그인.
async function handleLogin(store, id, password) {
  id = String(id || '').trim();
  password = String(password || '');
  if (!id) return { ok: false, error: 'ID를 입력하세요.' };
  if (!password) return { ok: false, error: '비밀번호를 입력하세요.' };

  const admins = await store.loadAdmins();
  const existing = admins.find(a => a.id === id);

  if (existing) {
    const valid = await auth.verifyPassword(password, existing.salt, existing.hash);
    if (!valid) return { ok: false, error: '비밀번호가 올바르지 않습니다.' };
    const token = await issueSession(store, id);
    return { ok: true, token, id, mustChangePassword: !!existing.mustChangePassword };
  }

  if (admins.length >= MAX_ADMINS) {
    return { ok: false, error: `등록 가능한 관리자 자리(최대 ${MAX_ADMINS}명)가 이미 모두 사용 중입니다. 기존 ID로 로그인하세요.` };
  }
  if (password !== INITIAL_PASSWORD) {
    return { ok: false, error: `신규 등록 시 초기 비밀번호는 ${INITIAL_PASSWORD} 입니다.` };
  }
  const { salt, hash } = await auth.createPasswordRecord(INITIAL_PASSWORD);
  admins.push({ id, salt, hash, mustChangePassword: true, createdAt: new Date().toISOString() });
  await store.saveAdmins(admins);
  const token = await issueSession(store, id);
  return { ok: true, token, id, mustChangePassword: true, registered: true };
}

async function handleChangePassword(store, id, currentPassword, newPassword) {
  currentPassword = String(currentPassword || '');
  newPassword = String(newPassword || '');
  if (newPassword.length < 4) return { ok: false, error: '새 비밀번호는 4자 이상이어야 합니다.' };
  if (newPassword === INITIAL_PASSWORD) return { ok: false, error: `새 비밀번호는 초기값(${INITIAL_PASSWORD})과 달라야 합니다.` };

  const admins = await store.loadAdmins();
  const idx = admins.findIndex(a => a.id === id);
  if (idx < 0) return { ok: false, error: '계정을 찾을 수 없습니다.' };

  const valid = await auth.verifyPassword(currentPassword, admins[idx].salt, admins[idx].hash);
  if (!valid) return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };

  const { salt, hash } = await auth.createPasswordRecord(newPassword);
  admins[idx] = { ...admins[idx], salt, hash, mustChangePassword: false };
  await store.saveAdmins(admins);
  return { ok: true };
}

module.exports = { handleLogin, handleChangePassword, issueSession, verifySession, MAX_ADMINS };
