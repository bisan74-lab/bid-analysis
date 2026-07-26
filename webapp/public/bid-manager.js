// bid-manager.html 전용 — 앞으로 분석·투찰할 입찰을 한 곳에서 목록·정렬·필터·관심표시로 관리.
// 데이터: /api/open-bids.json(진행중 전체) + /api/mybid-list.json(수주 가능 규모). 각 항목엔 v2판정 부착됨.
// 관심(★)은 localStorage에 저장(사용자별 서버 저장 없이 브라우저에 유지).

const WATCH_KEY = 'krs_watch_v1';
const fmtWon = (n) => n == null ? '-' : Math.round(n).toLocaleString('ko-KR') + '원';
const fmtWonShort = (n) => {
  if (n == null) return '-';
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(2) + '억';
  if (n >= 10_000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만';
  return Math.round(n).toLocaleString('ko-KR');
};

function getWatch() { try { return new Set(JSON.parse(localStorage.getItem(WATCH_KEY) || '[]')); } catch (e) { return new Set(); } }
function setWatch(set) { localStorage.setItem(WATCH_KEY, JSON.stringify([...set])); }

let ALL = [];              // 정규화된 전체 목록
let state = { 업종: '전체', 판정: '전체', 관심만: false, sort: '마감임박' };

async function loadMe() { const r = await fetch('/api/auth/me'); return r.ok ? r.json() : null; }
async function getJson(u) { try { const r = await fetch(u); return r.ok ? r.json() : null; } catch (e) { return null; } }

function parseDeadline(item) {
  const s = item.등록마감일 || item.투찰마감일 || item.개찰일;
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + '+09:00');
  return isNaN(d.getTime()) ? null : d;
}
function dday(deadline) {
  if (!deadline) return null;
  return Math.ceil((deadline.getTime() - Date.now()) / 86400000);
}

const 판정색 = { 유리: '#12855a', 보통: '#8a7f2e', 불리: '#d24444', 판정불가: '#7d8c95' };
function v2ChipHtml(v2) {
  if (!v2 || !v2.종합판정) return '<span class="muted">-</span>';
  const 배수 = v2.확률배수 != null ? ` ${v2.확률배수.toFixed(1)}x` : '';
  return `<span class="v2-chip" style="background:${판정색[v2.종합판정] || '#6b3fd6'}">${v2.종합판정}${배수}</span>`;
}

function normalize(openData, myData) {
  const mySet = new Set((myData?.items || []).map(i => i.posting_id));
  const seen = new Map();
  for (const it of (openData?.items || [])) {
    if (seen.has(it.posting_id)) continue;
    const deadline = parseDeadline(it);
    seen.set(it.posting_id, {
      ...it,
      수주가능: mySet.has(it.posting_id),
      deadline, dday: dday(deadline),
      배수: (it.v2판정 && it.v2판정.확률배수 != null) ? it.v2판정.확률배수 : -1,
    });
  }
  return [...seen.values()];
}

function apply() {
  const watch = getWatch();
  let rows = ALL.filter(r => {
    if (state.업종 === '포장' && !(r.대업종 || '').includes('지반조성.포장')) return false;
    if (state.업종 === '상하수도' && !(r.대업종 || '').includes('상.하수도')) return false;
    if (state.판정 !== '전체' && (!r.v2판정 || r.v2판정.종합판정 !== state.판정)) return false;
    if (state.관심만 && !watch.has(r.posting_id)) return false;
    return true;
  });
  rows.sort((a, b) => {
    if (state.sort === '마감임박') return (a.dday ?? 9999) - (b.dday ?? 9999);
    if (state.sort === 'V2유리') return b.배수 - a.배수;
    if (state.sort === '금액') return (b.기초금액 || 0) - (a.기초금액 || 0);
    return 0;
  });
  renderTable(rows, watch);
  renderSummary();
}

function renderSummary() {
  const watch = getWatch();
  const total = ALL.length;
  const 유리 = ALL.filter(r => r.v2판정 && r.v2판정.종합판정 === '유리').length;
  const 수주 = ALL.filter(r => r.수주가능).length;
  const 임박 = ALL.filter(r => r.dday != null && r.dday >= 0 && r.dday <= 3).length;
  const 관심 = ALL.filter(r => watch.has(r.posting_id)).length;
  const tile = (l, v, s, c) => `<div class="stat-tile"${c ? ` style="border-left:3px solid ${c}"` : ''}><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`;
  document.getElementById('mgr-summary').innerHTML = [
    tile('전체 진행중', total + '건', '부산·경남 + 우리 업종'),
    tile('수주 가능 규모', 수주 + '건', '시공능력 이내', '#2a78d6'),
    tile('V2 유리', 유리 + '건', '경쟁 적어 낙찰 유리', '#12855a'),
    tile('마감 임박', 임박 + '건', '3일 이내', '#d24444'),
    tile('관심 ★', 관심 + '건', '내가 표시한 건'),
  ].join('');
}

function renderTable(rows, watch) {
  const tb = document.getElementById('mgr-tbody');
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="9" class="empty-note">조건에 맞는 입찰이 없습니다.</td></tr>'; return; }
  tb.innerHTML = rows.map(r => {
    const starred = watch.has(r.posting_id);
    const dd = r.dday;
    const ddText = dd == null ? '-' : dd < 0 ? '마감' : dd === 0 ? '오늘' : `D-${dd}`;
    const ddColor = dd != null && dd >= 0 && dd <= 3 ? '#d24444' : 'var(--text-secondary)';
    return `<tr data-id="${r.posting_id}">
      <td class="star ${starred ? 'on' : ''}" data-star="${r.posting_id}" title="관심 표시">${starred ? '★' : '☆'}</td>
      <td class="ttl"><a href="/analysis.html?id=${encodeURIComponent(r.posting_id)}">${r.title || '-'}</a>${r.수주가능 ? '<span class="tagfit">수주가능</span>' : ''}</td>
      <td>${r.발주처 || '-'}</td>
      <td>${r.지역 || r.지역약칭 || '-'}</td>
      <td class="num">${fmtWonShort(r.기초금액)}${r.기초금액추정 ? '<span class="est">추정</span>' : ''}</td>
      <td class="num" style="color:${ddColor};font-weight:600">${ddText}</td>
      <td>${v2ChipHtml(r.v2판정)}</td>
      <td class="num">${r.v2판정 && r.v2판정.예상참여업체수 != null ? r.v2판정.예상참여업체수 + '개사' : '-'}</td>
      <td>${r.원문링크 ? `<a href="${r.원문링크}" target="_blank" rel="noopener" onclick="event.stopPropagation()">원문↗</a>` : '-'}</td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('[data-star]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-star');
      const w = getWatch();
      if (w.has(id)) w.delete(id); else w.add(id);
      setWatch(w);
      apply();
    });
  });
  tb.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => { window.open(`/analysis.html?id=${encodeURIComponent(tr.getAttribute('data-id'))}`, '_blank'); });
  });
}

function wireControls() {
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [k, v] = btn.getAttribute('data-filter').split(':');
      state[k] = v;
      document.querySelectorAll(`[data-filter^="${k}:"]`).forEach(b => b.classList.toggle('active', b === btn));
      apply();
    });
  });
  const watchToggle = document.getElementById('watch-toggle');
  watchToggle.addEventListener('click', () => { state.관심만 = !state.관심만; watchToggle.classList.toggle('active', state.관심만); apply(); });
  document.getElementById('sort-select').addEventListener('change', (e) => { state.sort = e.target.value; apply(); });
}

async function init() {
  const me = await loadMe();
  if (!me) { location.href = '/login.html'; return; }
  wireControls();
  const [open, my] = await Promise.all([getJson('/api/open-bids.json'), getJson('/api/mybid-list.json')]);
  ALL = normalize(open, my);
  const upd = open?.updatedAt ? new Date(open.updatedAt).toLocaleString('ko-KR') : '없음';
  document.getElementById('mgr-updated').textContent = `마지막 갱신: ${upd} · 총 ${ALL.length}건`;
  apply();
}
init();
