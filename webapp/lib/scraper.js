// 아이건설넷 로그인 + 진행중 입찰정보(실시간) 스크래핑
// credentials.local.md 에 저장된 ID/PW 사용, Playwright(headless chromium)로 로그인 후
// /bid/conditional_search 폼(select 필드)을 직접 채워 제출하고 결과 테이블을 파싱한다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { isGyeongnamCityRestricted } = require('./localFilter');

const CRED_PATH = path.join(__dirname, '..', '..', 'credentials.local.md');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'open_bids.json');
const MYBID_CACHE_PATH = path.join(__dirname, '..', 'data', 'mybid_list.json');

const PART_CODES = { '지반조성.포장': 'B001', '상.하수도': 'B008' };
const TARGET_REGIONS = ['부산', '경남'];

function readCredentials() {
  const text = fs.readFileSync(CRED_PATH, 'utf8');
  const id = text.match(/아이디:\s*(\S+)/)?.[1];
  const pw = text.match(/비밀번호:\s*(\S+)/)?.[1];
  if (!id || !pw) throw new Error('credentials.local.md에서 아이디/비밀번호를 찾을 수 없습니다.');
  return { id, pw };
}

async function login(page) {
  const { id, pw } = readCredentials();
  await page.goto('https://www.igunsul.net/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: '아이디 입력' }).fill(id);
  await page.getByRole('textbox', { name: '비밀번호 입력' }).fill(pw);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForSelector('a[href="/login/logout_process"]', { timeout: 15000 });
}

async function rowCount(page) {
  try {
    return await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let best = 0;
      for (const t of tables) best = Math.max(best, t.querySelectorAll('tbody tr').length);
      return best;
    });
  } catch (e) {
    return 0; // 네비게이션 중이라 컨텍스트가 파괴된 경우 등 - 아직 준비 안 된 것으로 간주
  }
}

// 검색 결과 테이블이 JS로 점진적으로 채워지므로, row 수가 더 이상 늘지 않을 때까지 대기한다.
async function waitForStableRowCount(page, { timeoutMs = 20000, stableChecks = 3, intervalMs = 400 } = {}) {
  const start = Date.now();
  let last = -1;
  let stableCount = 0;
  while (Date.now() - start < timeoutMs) {
    const n = await rowCount(page);
    if (n > 0 && n === last) {
      stableCount++;
      if (stableCount >= stableChecks) return n;
    } else {
      stableCount = 0;
    }
    last = n;
    await page.waitForTimeout(intervalMs);
  }
  return last;
}

function extractRowsFromPage(rowsRaw) {
  // 컬럼 순서: 선택,나의방,번호,공사명,종목,대업종,기초금액 추정가격,발주처,지역,현설일,등록마감일,협정마감일,투찰시작일,투찰마감일,개찰일,입력일
  return rowsRaw.map(cells => {
    const [, , , title, category, majorCategory, amountCombined, org, region, siteVisit,
      regDeadline, agreeDeadline, bidStart, bidDeadline, openDate, inputDate] = cells;
    const idMatch = title.match(/\[([^\]]+)\]/g);
    const postingId = idMatch ? idMatch[idMatch.length - 1] : title;
    const [baseAmountStr, estAmountStr] = (amountCombined || '').split(' ');
    return {
      posting_id: postingId,
      title,
      종목: category,
      대업종: majorCategory,
      기초금액: baseAmountStr && baseAmountStr !== '-' ? Number(baseAmountStr.replace(/,/g, '')) : null,
      추정가격: estAmountStr && estAmountStr !== '-' ? Number(estAmountStr.replace(/,/g, '')) : null,
      발주처: org,
      지역: region,
      현설일: siteVisit || null,
      등록마감일: regDeadline || null,
      협정마감일: agreeDeadline || null,
      투찰시작일: bidStart || null,
      투찰마감일: bidDeadline || null,
      개찰일: openDate || null,
      입력일: inputDate || null,
    };
  });
}

async function scrapeOpenBids(page) {
  await page.goto('https://www.igunsul.net/bid/conditional_search', { waitUntil: 'domcontentloaded' });

  await page.evaluate(({ part1, part2 }) => {
    const f = document.querySelector('#search_form');
    f.querySelector('select[name="part"]').value = part1;
    f.querySelector('select[name="part2"]').value = part2;
    f.querySelector('select[name="local"]').value = '0'; // 모든지역, 이후 코드에서 부산/경남만 필터링
    f.submit();
  }, { part1: PART_CODES['지반조성.포장'], part2: PART_CODES['상.하수도'] });

  await waitForStableRowCount(page);

  const allRows = [];
  let pageNum = 1;
  // 최대 20페이지까지 안전장치 (진행중 공고는 보통 수백 건 이내)
  while (pageNum <= 20) {
    const rowsRaw = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let best = null, bestRows = 0;
      for (const t of tables) {
        const n = t.querySelectorAll('tbody tr').length;
        if (n > bestRows) { bestRows = n; best = t; }
      }
      if (!best) return [];
      return Array.from(best.querySelectorAll('tbody tr')).map(r =>
        Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim().replace(/\s+/g, ' '))
      ).filter(cells => cells.length > 5);
    });
    allRows.push(...rowsRaw);

    const hasNext = await page.evaluate((next) => {
      const links = Array.from(document.querySelectorAll('a.list2pageAnchor'));
      const el = links.find(l => l.getAttribute('page_num') === String(next));
      if (!el) return false;
      el.click();
      return true;
    }, pageNum + 1);

    if (!hasNext) break;
    await waitForStableRowCount(page);
    pageNum++;
  }

  const parsed = extractRowsFromPage(allRows);
  const seen = new Set();
  const deduped = [];
  for (const r of parsed) {
    if (seen.has(r.posting_id)) continue;
    seen.add(r.posting_id);
    deduped.push(r);
  }

  return deduped
    .filter(r => TARGET_REGIONS.some(region => (r.지역 || '').includes(region)))
    .filter(r => !isGyeongnamCityRestricted(r.발주처));
}

// "맞춤정보"(/mybid) — 계정에 저장된 검색조건(종목/지역 등)에 맞춰 아이건설넷이 자동으로 매칭해주는 개인화 목록.
// 페이지네이션 없이 한 페이지에 전부 나옴, 우리쪽 부산/경남 필터는 적용하지 않고(계정 설정을 그대로 신뢰)
// 경남 시/군 관내 제한 필터만 동일하게 적용한다.
async function scrapeMyBidList(page) {
  await page.goto('https://www.igunsul.net/mybid', { waitUntil: 'domcontentloaded' });
  await waitForStableRowCount(page);

  const rowsRaw = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    let best = null, bestRows = 0;
    for (const t of tables) {
      const n = t.querySelectorAll('tbody tr').length;
      if (n > bestRows) { bestRows = n; best = t; }
    }
    if (!best) return [];
    return Array.from(best.querySelectorAll('tbody tr')).map(r =>
      Array.from(r.querySelectorAll('td')).map(c => c.innerText.trim().replace(/\s+/g, ' '))
    ).filter(cells => cells.length > 5);
  });

  const parsed = extractRowsFromPage(rowsRaw);
  const seen = new Set();
  const deduped = [];
  for (const r of parsed) {
    if (seen.has(r.posting_id)) continue;
    seen.add(r.posting_id);
    deduped.push(r);
  }
  return deduped.filter(r => !isGyeongnamCityRestricted(r.발주처));
}

async function refreshAll() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await login(page);
    const [openItems, myBidItems] = [await scrapeOpenBids(page), await scrapeMyBidList(page)];

    const openPayload = { updatedAt: new Date().toISOString(), count: openItems.length, items: openItems };
    const myBidPayload = { updatedAt: new Date().toISOString(), count: myBidItems.length, items: myBidItems };

    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(openPayload, null, 1), 'utf8');
    fs.writeFileSync(MYBID_CACHE_PATH, JSON.stringify(myBidPayload, null, 1), 'utf8');

    return { openBids: openPayload, myBidList: myBidPayload };
  } finally {
    await browser.close();
  }
}

// 기존 호출부(server.js, scripts/notify.js)와의 호환을 위해 이름은 유지하되,
// 내부적으로는 진행중 입찰 + 맞춤정보를 한 번의 로그인으로 함께 갱신하고 진행중 입찰 결과를 반환한다.
async function refreshOpenBids() {
  const { openBids } = await refreshAll();
  return openBids;
}

function readCachedOpenBids() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
}

function readCachedMyBidList() {
  if (!fs.existsSync(MYBID_CACHE_PATH)) return null;
  return JSON.parse(fs.readFileSync(MYBID_CACHE_PATH, 'utf8'));
}

module.exports = { refreshOpenBids, readCachedOpenBids, readCachedMyBidList };
