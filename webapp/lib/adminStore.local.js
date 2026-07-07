// 로컬 Express 서버용 관리자 저장소 (파일 기반). admins.json/session-secret 둘 다 git에는 올리지 않음.
const fs = require('fs');
const path = require('path');
const auth = require('./auth-core');

const ADMINS_PATH = path.join(__dirname, '..', 'data', 'admins.json');
const SECRET_PATH = path.join(__dirname, '..', 'data', 'session-secret');

async function loadAdmins() {
  if (!fs.existsSync(ADMINS_PATH)) return [];
  return JSON.parse(fs.readFileSync(ADMINS_PATH, 'utf8'));
}

async function saveAdmins(admins) {
  fs.mkdirSync(path.dirname(ADMINS_PATH), { recursive: true });
  fs.writeFileSync(ADMINS_PATH, JSON.stringify(admins, null, 1), 'utf8');
}

async function getSessionSecret() {
  if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  const secret = auth.randomHex(32);
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, 'utf8');
  return secret;
}

module.exports = { loadAdmins, saveAdmins, getSessionSecret };
