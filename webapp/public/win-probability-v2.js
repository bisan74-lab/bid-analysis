// win-probability-v2.html 전용 — Version_2 낙찰 전략(경쟁강도 세그먼트·저경쟁 니치) 렌더.
const CHART_W = 640;
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function svg(tag, attrs = {}) { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; }
const pct = (x, d = 2) => x == null ? '-' : (x * 100).toFixed(d) + '%';
const tipEl = () => document.getElementById('tooltip');
function showTooltip(x, y, html) { const t = tipEl(); t.innerHTML = html; t.classList.add('show'); t.style.left = (x + 14) + 'px'; t.style.top = (y + 14) + 'px'; }
function hideTooltip() { tipEl().classList.remove('show'); }

async function loadMe() { const r = await fetch('/api/auth/me'); return r.ok ? r.json() : null; }
function tile(label, value, sub, accent) {
  return `<div class="stat-tile"${accent ? ` style="border-left:3px solid ${accent}"` : ''}><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

function renderLead(s) {
  const best = s.byComp[0];
  document.getElementById('lead').innerHTML =
    `과거 수주가능 공고 <b>${s.n.toLocaleString('ko-KR')}건</b>을 전수 분석한 결과, 낙찰률을 가르는 최대 변수는 예측 정확도가 아니라 <b>경쟁 밀도</b>였습니다. ` +
    `참여 <b>${best.label}</b> 공고의 낙찰률은 <b>${pct(best.winRate)}</b>로 전체 평균(${pct(s.overallWinRate)})의 <b>${best.배수.toFixed(1)}배</b>입니다.`;
  document.getElementById('v2-tiles').innerHTML = [
    tile('전체 낙찰률', pct(s.overallWinRate), `수주가능 ${s.n.toLocaleString('ko-KR')}건 평균`),
    tile('저경쟁(≤50) 낙찰률', pct(s.저경쟁.winRate), `${s.저경쟁.배수.toFixed(1)}배 유리`, cssVar('--series-4')),
    tile('초저경쟁(≤20) 낙찰률', pct(s.저경쟁.win20), `${s.저경쟁.n20}건`, '#12855a'),
    tile('연간 저경쟁 기회', s.저경쟁.최근1년 + '건', '최근 1년 기준 참여 50개사 이하', '#6b3fd6'),
  ].join('');
}

// 경쟁강도 구간별 낙찰률 가로 막대 (단일 시리즈 → 직접 라벨)
function renderCompChart(s) {
  const box = document.getElementById('chart-comp'); box.innerHTML = '';
  const data = s.byComp;
  const rowH = 40, padL = 96, padR = 120, top = 6;
  const w = CHART_W, h = data.length * rowH + 12, innerW = w - padL - padR;
  const max = Math.max(...data.map(d => d.winRate || 0));
  const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, style: 'display:block;width:100%;height:auto' });
  data.forEach((d, i) => {
    const y = i * rowH + top;
    const label = svg('text', { x: padL - 8, y: y + 22, 'text-anchor': 'end', 'font-size': 11.5, fill: cssVar('--text-secondary') });
    label.textContent = d.label; root.appendChild(label);
    const bw = max > 0 ? (d.winRate / max) * innerW : 0;
    const color = d.winRate >= 0.05 ? '#12855a' : d.winRate >= 0.015 ? cssVar('--series-1') : cssVar('--text-muted');
    const rect = svg('rect', { x: padL, y: y + 8, width: Math.max(2, bw), height: 20, rx: 4, fill: color });
    rect.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, `참여 ${d.label}<br>낙찰률 <b>${pct(d.winRate)}</b> (${d.n}건)${d.배수 ? `<br>전체 대비 ${d.배수.toFixed(1)}배` : ''}`));
    rect.addEventListener('mouseleave', hideTooltip);
    root.appendChild(rect);
    const vl = svg('text', { x: padL + Math.max(2, bw) + 8, y: y + 22, 'font-size': 11, fill: cssVar('--text-primary'), 'font-weight': 700 });
    vl.textContent = `${pct(d.winRate)}${d.배수 ? ` · ${d.배수.toFixed(1)}배` : ''}`;
    root.appendChild(vl);
  });
  box.appendChild(root);
}

function segTable(elId, rows, cols) {
  document.getElementById(elId).innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr>${cols.map(c => `<th${c.r ? ' style="text-align:right"' : ''}>${c.h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderSegments(s) {
  const amtRows = s.byAmt.map(b => `<tr><td>${b.label}</td><td style="text-align:right">${b.중앙참여}개사</td><td style="text-align:right"><b>${pct(b.winRate)}</b></td><td style="text-align:right" class="muted">${b.n}건</td></tr>`).join('');
  segTable('table-amt', amtRows, [{ h: '금액 규모' }, { h: '중앙 참여', r: 1 }, { h: '낙찰률', r: 1 }, { h: '표본', r: 1 }]);
  const grpRows = s.byGroup.map(b => `<tr><td>${b.label}</td><td style="text-align:right">${b.중앙참여}개사</td><td style="text-align:right"><b>${pct(b.winRate)}</b></td><td style="text-align:right" class="muted">${b.n}건</td></tr>`).join('');
  segTable('table-group', grpRows, [{ h: '업종' }, { h: '중앙 참여', r: 1 }, { h: '낙찰률', r: 1 }, { h: '표본', r: 1 }]);
}

function renderNiche(s) {
  const n = s.저경쟁;
  document.getElementById('niche-lead').innerHTML =
    `참여 <b>50개사 이하</b> 공고는 수주가능 전체의 ${(n.n / s.n * 100).toFixed(0)}%(<b>${n.n}건</b>)이지만 낙찰률이 <b>${pct(n.winRate)}</b>로 ${n.배수.toFixed(1)}배 높습니다. ` +
    `구성은 포장 ${n.포장}건 / 상하수도 ${n.상하수도}건 — <b>기회 수가 많은 포장을 주력</b>으로 삼는 것이 유리합니다.`;
  document.getElementById('niche-tiles').innerHTML = [
    tile('저경쟁 공고 수', n.n + '건', `전체의 ${(n.n / s.n * 100).toFixed(0)}%`),
    tile('최근 1년 기회', n.최근1년 + '건', '연간 실재 공략 대상'),
    tile('포장 / 상하수도', `${n.포장} / ${n.상하수도}`, '저경쟁 기회 분포'),
    tile('기대 낙찰(연 100건 참여)', (n.winRate * 100).toFixed(1) + '건', `저경쟁만 골라 참여 시`, cssVar('--series-4')),
  ].join('');
  const orgRows = n.targetOrgs.map((o, i) => `<tr><td>${i + 1}</td><td>${o.name}</td><td style="text-align:right"><b>${o.count}건</b></td></tr>`).join('');
  segTable('table-orgs', orgRows, [{ h: '#' }, { h: '발주처' }, { h: '저경쟁 건수', r: 1 }]);
}

async function init() {
  const me = await loadMe(); if (!me) { location.href = '/login.html'; return; }
  try {
    const s = await (await fetch('/api/v2-strategy.json')).json();
    if (s.error) throw new Error(s.error);
    renderLead(s); renderCompChart(s); renderSegments(s); renderNiche(s);
  } catch (e) {
    document.getElementById('lead').innerHTML = `<span style="color:#e34948">로딩 실패: ${e.message}</span>`;
  }
}
init();
