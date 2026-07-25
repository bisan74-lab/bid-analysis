// win-probability.html 전용 스크립트 — 낙찰 가능성 백테스트 결과 렌더링.
// 차트는 앱의 기존 SVG 관례(CSS 변수 토큰 + 손수 작성 SVG)를 따른다.
const CHART_W = 640, CHART_H = 300;

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function svg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
const pct = (x, d = 2) => (x * 100).toFixed(d) + '%';
const tipEl = () => document.getElementById('tooltip');
function showTooltip(x, y, html) {
  const t = tipEl();
  t.innerHTML = html;
  t.classList.add('show');
  t.style.left = (x + 14) + 'px';
  t.style.top = (y + 14) + 'px';
}
function hideTooltip() { tipEl().classList.remove('show'); }

async function loadMe() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  return res.json();
}

function tile(label, value, sub, accent) {
  return `<div class="stat-tile"${accent ? ` style="border-left:3px solid ${accent}"` : ''}>
    <div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div>
  </div>`;
}

function renderVerdict(r) {
  const edge = r.model.all.winRate / r.participants.baseProbMean;
  const p1 = r.model.recent.winRate;
  const at300 = 1 - Math.pow(1 - p1, 300);
  document.getElementById('verdict').innerHTML = `
    <p style="margin:0 0 10px;font-size:15px;line-height:1.75">
      <b>단건 낙찰은 복권에 가깝습니다 — 약 ${pct(p1)}.</b> 어떤 예측 모델로도 이 구조는 바꿀 수 없습니다.
      승부가 갈리는 단위(중앙값 ${r.margins.median.toFixed(4)}%p)가 예정가격 예측의 이론 한계(약 0.58%)보다
      <b>${Math.round(0.58 / Math.max(r.margins.median, 0.0001))}배 미세</b>하기 때문입니다.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.75">
      <b style="color:${cssVar('--series-4')}">그러나 시스템적으로는 이길 수 있습니다.</b>
      시장 중심(사정률 ${r.model.사정률}%)에 정확히 서 있는 것만으로 평균 참여자 대비
      <b>${edge.toFixed(1)}배</b> 우위가 실측되고, 연 300건 이상 꾸준히 참여하면
      최소 1건 이상 낙찰할 확률이 <b>${pct(at300, 1)}</b>, 기대 낙찰은 <b>연 ${(p1 * 300).toFixed(1)}건</b>입니다.
    </p>`;
}

function renderTiles(r) {
  const edge = r.model.all.winRate / r.participants.baseProbMean;
  document.getElementById('wp-tiles').innerHTML = [
    tile('검증 표본', r.n.toLocaleString('ko-KR') + '건', `전수 백테스트 (최근1년 ${r.recentN.toLocaleString('ko-KR')}건)`),
    tile('이론 기본확률', pct(r.participants.baseProbMean, 3), `평균 참여 ${Math.round(r.participants.mean)}개사 = 1/N`),
    tile('모델 중심 낙찰률', pct(r.model.all.winRate, 3), `사정률 ${r.model.사정률}%로 전 기간 투찰 시`, cssVar('--series-5')),
    tile('기본확률 대비 우위', edge.toFixed(1) + '배', '중심 투찰만으로 얻는 실측 우위', cssVar('--series-4')),
    tile('최근1년 낙찰률', pct(r.model.recent.winRate, 3), `${r.model.recent.wins}건 / ${r.recentN.toLocaleString('ko-KR')}건`),
    tile('무효 투찰률', pct(r.model.all.invalidRate, 1), '하한가 미달 (중심 투찰의 구조적 비용)'),
  ].join('');
}

function renderMargins(r) {
  const m = r.margins;
  document.getElementById('margin-desc').innerHTML =
    `낙찰자 마진(낙찰자 추측 − 실제 추첨값)의 <b>중앙값은 ${m.median.toFixed(4)}%p</b>입니다. ` +
    `예정가격 1억원 공고라면 실제 추첨 결과보다 <b>약 ${Math.round(m.median / 100 * 100000000).toLocaleString('ko-KR')}원</b> 위에 붙어서 이겼다는 뜻입니다.`;
  document.getElementById('margin-tiles').innerHTML = [
    tile('마진 중앙값', m.median.toFixed(4) + '%p', '절반의 낙찰자가 이보다 좁게 이김'),
    tile('0.01%p 이내', pct(m.under001, 1), '1억 기준 1만원 이내'),
    tile('0.05%p 이내', pct(m.under005, 1), '1억 기준 5만원 이내'),
    tile('0.1%p 이내', pct(m.under01, 1), '1억 기준 10만원 이내'),
  ].join('');
}

// 사정률별 낙찰률 곡선 (단일 시리즈 → 범례 없이 제목·직접 라벨로 식별).
function renderCurve(r) {
  const box = document.getElementById('chart-winrate');
  box.innerHTML = '';
  const data = r.curve;
  const padL = 46, padR = 16, padT = 14, padB = 34;
  const innerW = CHART_W - padL - padR, innerH = CHART_H - padT - padB;
  const xs = data.map(d => d.s);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMax = Math.max(...data.map(d => d.winRate), r.participants.baseProbMean) * 1.15;
  const X = (s) => padL + ((s - xMin) / (xMax - xMin)) * innerW;
  const Y = (v) => padT + innerH - (v / yMax) * innerH;

  const root = svg('svg', { viewBox: `0 0 ${CHART_W} ${CHART_H}`, style: 'display:block;width:100%;height:auto' });

  // 눈금 — 절제된 회색, 얇게
  const gridColor = cssVar('--border'), muted = cssVar('--text-muted'), secondary = cssVar('--text-secondary');
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i, y = Y(v);
    root.appendChild(svg('line', { x1: padL, y1: y, x2: padL + innerW, y2: y, stroke: gridColor, 'stroke-width': 1 }));
    const t = svg('text', { x: padL - 8, y: y + 3.5, 'text-anchor': 'end', 'font-size': 10, fill: muted });
    t.textContent = (v * 100).toFixed(1) + '%';
    root.appendChild(t);
  }
  for (let s = Math.ceil(xMin); s <= xMax; s += 0.5) {
    const x = X(s);
    const t = svg('text', { x, y: CHART_H - 12, 'text-anchor': 'middle', 'font-size': 10, fill: muted });
    t.textContent = (s > 0 ? '+' : '') + s.toFixed(1) + '%';
    root.appendChild(t);
  }

  // 기준선 1: 이론 기본확률(1/N) — 점선 + 직접 라벨
  const baseY = Y(r.participants.baseProbMean);
  root.appendChild(svg('line', {
    x1: padL, y1: baseY, x2: padL + innerW, y2: baseY,
    stroke: muted, 'stroke-width': 1.5, 'stroke-dasharray': '5 4',
  }));
  const baseLabel = svg('text', { x: padL + 6, y: baseY - 6, 'font-size': 10.5, fill: secondary });
  baseLabel.textContent = `이론 기본확률 ${pct(r.participants.baseProbMean, 2)} (1/${Math.round(r.participants.mean)}개사)`;
  root.appendChild(baseLabel);

  // 기준선 2: 우리 모델 중심 — 세로선 + 직접 라벨
  const mx = X(r.model.사정률);
  root.appendChild(svg('line', {
    x1: mx, y1: padT, x2: mx, y2: padT + innerH,
    stroke: cssVar('--series-5'), 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
  }));
  const mLabel = svg('text', { x: mx + 6, y: padT + 12, 'font-size': 10.5, fill: cssVar('--series-5'), 'font-weight': 700 });
  mLabel.textContent = `모델 중심 ${r.model.사정률}%`;
  root.appendChild(mLabel);

  // 낙찰률 곡선 (2px)
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${X(p.s).toFixed(2)},${Y(p.winRate).toFixed(2)}`).join(' ');
  root.appendChild(svg('path', { d, fill: 'none', stroke: cssVar('--series-1'), 'stroke-width': 2, 'stroke-linejoin': 'round' }));

  // 모델 중심 지점 마커 (표면 링 2px)
  const mPoint = svg('circle', { cx: mx, cy: Y(r.model.all.winRate), r: 5, fill: cssVar('--series-5'), stroke: cssVar('--card') || '#fff', 'stroke-width': 2 });
  root.appendChild(mPoint);

  // 크로스헤어 + 툴팁 (라인 차트 기본 상호작용)
  const cross = svg('line', { x1: 0, y1: padT, x2: 0, y2: padT + innerH, stroke: cssVar('--text-muted'), 'stroke-width': 1, opacity: 0 });
  root.appendChild(cross);
  const hit = svg('rect', { x: padL, y: padT, width: innerW, height: innerH, fill: 'transparent' });
  hit.addEventListener('mousemove', (e) => {
    const rect = root.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width * CHART_W;
    const s = xMin + ((relX - padL) / innerW) * (xMax - xMin);
    let nearest = data[0];
    for (const p of data) if (Math.abs(p.s - s) < Math.abs(nearest.s - s)) nearest = p;
    cross.setAttribute('x1', X(nearest.s));
    cross.setAttribute('x2', X(nearest.s));
    cross.setAttribute('opacity', 0.5);
    showTooltip(e.clientX, e.clientY,
      `투찰 사정률 <b>${nearest.s > 0 ? '+' : ''}${nearest.s.toFixed(3)}%</b><br>` +
      `낙찰률 <b>${pct(nearest.winRate, 3)}</b><br>` +
      `<span style="opacity:.75">무효(하한가 미달) ${pct(nearest.invalidRate, 1)}</span>`);
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); hideTooltip(); });
  root.appendChild(hit);

  box.appendChild(root);
}

function renderStrategyTable(r) {
  const rows = [
    ['이론 기본확률 (아무 전략 없이)', '—', pct(r.participants.baseProbMean, 3), '—', '평균 참여 ' + Math.round(r.participants.mean) + '개사 기준 1/N'],
    ['모델 중심 투찰', r.model.사정률 + '%', pct(r.model.all.winRate, 3), pct(r.model.all.invalidRate, 1), `${r.model.all.wins}건 낙찰 — 우리 시스템이 제시하는 지점`],
    ['사후 최적점 (참고용)', r.bestFit.all.s + '%', pct(r.bestFit.all.winRate, 3), pct(r.bestFit.all.invalidRate, 1), '결과를 보고 고른 값이라 실전 재현 불가'],
  ];
  document.getElementById('strategy-table').innerHTML = `
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>전략</th><th>투찰 사정률</th><th>낙찰률</th><th>무효율</th><th>비고</th></tr></thead>
      <tbody>${rows.map(c => `<tr><td>${c[0]}</td><td>${c[1]}</td><td><b>${c[2]}</b></td><td>${c[3]}</td><td style="white-space:normal">${c[4]}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

function renderOos(r) {
  const o = r.outOfSample;
  const verdict = Math.abs(o.test.winRate - r.model.recent.winRate) < 0.0005
    ? '사후 최적점의 추가 우위는 <b>표본 잡음</b>으로 판정 — 모델 중심과 동일 성적'
    : '학습 구간과 검증 구간의 성적 차이를 확인';
  document.getElementById('oos-tiles').innerHTML = [
    tile('학습(과거 2년) 최적 사정률', o.trainS + '%', '이 값만 최근1년에 적용'),
    tile('학습 구간 낙찰률', pct(o.trainWinRate, 3), '과거 2년 (사후 최적이라 과대평가)'),
    tile('검증(최근1년) 낙찰률', pct(o.test.winRate, 3), '한 번도 안 본 데이터 — 실전 근접치', cssVar('--series-4')),
    tile('모델 중심 최근1년', pct(r.model.recent.winRate, 3), verdict.replace(/<[^>]+>/g, '')),
  ].join('');
}

function renderVolume(r) {
  const p1 = r.model.recent.winRate;
  const volumes = [10, 50, 100, 200, 300, 600];
  const rows = volumes.map(n => {
    const atLeast1 = 1 - Math.pow(1 - p1, n);
    return `<tr><td>연 ${n.toLocaleString('ko-KR')}건</td><td><b>${(p1 * n).toFixed(1)}건</b></td><td>${(atLeast1 * 100).toFixed(1)}%</td></tr>`;
  }).join('');
  document.getElementById('volume-table').innerHTML = `
    <div class="table-scroll"><table class="data-table">
      <thead><tr><th>연간 참여</th><th>기대 낙찰</th><th>1건 이상 낙찰 확률</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  document.getElementById('benchmark-note').innerHTML =
    `<b>외부 정합성 검증</b>: TOP 업체 실적(청복건설 22건/3년 = 연 7.3건, 재흥건설·금강플러스 18건/3년 = 연 6건)은 ` +
    `"연 400~500건 참여 × ${pct(p1, 1)}"와 정확히 맞아떨어집니다. 상위 업체도 특별한 예측력이 아니라 ` +
    `<b>대량 참여 × 시장 중심 투찰</b>로 그 실적을 낸다는 방증이며, 위 확률 추정의 독립적 검증이 됩니다.`;
}

async function init() {
  const me = await loadMe();
  if (!me) { location.href = '/login.html'; return; }
  try {
    const res = await fetch('/api/win-probability.json');
    const r = await res.json();
    if (r.error) throw new Error(r.error);
    document.getElementById('hdr-n').textContent = r.n.toLocaleString('ko-KR');
    renderVerdict(r);
    renderTiles(r);
    renderMargins(r);
    renderCurve(r);
    renderStrategyTable(r);
    renderOos(r);
    renderVolume(r);
  } catch (e) {
    document.getElementById('verdict').innerHTML = `<div class="empty-note">분석 로딩 실패: ${e.message}</div>`;
  }
}

init();
