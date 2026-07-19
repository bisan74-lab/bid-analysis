const SERIES = ['--series-1','--series-2','--series-3','--series-4','--series-5','--series-6','--series-7','--series-8'];
function seriesColor(i) { return getComputedStyle(document.documentElement).getPropertyValue(SERIES[i % SERIES.length]).trim(); }
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

const fmtWon = (n) => n == null ? '-' : Math.round(n).toLocaleString('ko-KR') + '원';
const fmtWonShort = (n) => {
  if (n == null) return '-';
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억원';
  if (n >= 10_000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만원';
  return Math.round(n).toLocaleString('ko-KR') + '원';
};
const fmtPctDiff = (r) => { // ratio(=낙찰률) -> "+1.23%" / "-1.23%" (예정가격 대비 차이)
  if (r == null) return '-';
  const pct = (r - 1) * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
};
const fmtRatioAsPct = (r) => r == null ? '-' : (r * 100).toFixed(1) + '%';
const fmtWonDiff = (n) => n == null ? '-' : (n < 0 ? '-' : '+') + fmtWonShort(Math.abs(n));

// ---------- tooltip ----------
const tooltipEl = document.getElementById('tooltip');
function showTooltip(x, y, html) {
  tooltipEl.innerHTML = html;
  tooltipEl.style.left = x + 'px';
  tooltipEl.style.top = y + 'px';
  tooltipEl.classList.add('show');
}
function hideTooltip() { tooltipEl.classList.remove('show'); }

// ---------- svg helpers ----------
function svg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const CHART_W = 600, CHART_H = 300;
const PAD = { l: 46, r: 16, t: 14, b: 34 };

function baseSvg() {
  const root = svg('svg', { viewBox: `0 0 ${CHART_W} ${CHART_H}`, style: 'display:block;width:100%;height:auto' });
  return root;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  let step;
  if (norm <= 1) step = 1; else if (norm <= 2) step = 2; else if (norm <= 5) step = 5; else step = 10;
  return step * mag;
}

function yTicks(maxV, n = 4) {
  const ticks = [];
  for (let i = 0; i <= n; i++) ticks.push((maxV / n) * i);
  return ticks;
}

function barChart(container, data, opts) {
  const { xKey, yKey, color = seriesColor(0), yFormat = (v) => v, xFormat = (v) => v, tooltipFormat } = opts;
  const root = baseSvg();
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const values = data.map(d => d[yKey]);
  const dataMax = Math.max(...values, 0);
  const dataMin = Math.min(...values, 0);
  const maxV = dataMax > 0 ? niceMax(dataMax) : 0;
  const minV = dataMin < 0 ? -niceMax(-dataMin) : 0;
  const range = (maxV - minV) || 1;
  const zeroY = PAD.t + innerH - ((0 - minV) / range) * innerH;
  const gy = svg('g');
  for (const t of yTicks(maxV - minV).map(v => v + minV)) {
    const y = PAD.t + innerH - ((t - minV) / range) * innerH;
    gy.appendChild(svg('line', { x1: PAD.l, x2: CHART_W - PAD.r, y1: y, y2: y, stroke: cssVar('--grid'), 'stroke-width': 1 }));
    const label = svg('text', { x: PAD.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: cssVar('--text-muted') });
    label.textContent = yFormat(t);
    gy.appendChild(label);
  }
  root.appendChild(gy);

  const n = data.length;
  const bw = Math.max(2, innerW / n * 0.62);
  const gap = innerW / n;
  data.forEach((d, i) => {
    const y0 = PAD.t + innerH - ((d[yKey] - minV) / range) * innerH;
    const top = Math.min(y0, zeroY);
    const h = Math.abs(zeroY - y0);
    const x = PAD.l + i * gap + (gap - bw) / 2;
    const rect = svg('rect', { x, y: top, width: bw, height: h, rx: 3, fill: color });
    rect.addEventListener('mousemove', (e) => {
      showTooltip(e.clientX, e.clientY, tooltipFormat ? tooltipFormat(d) : `${d[xKey]}: ${d[yKey]}`);
    });
    rect.addEventListener('mouseleave', hideTooltip);
    root.appendChild(rect);
    if (n <= 14 || i % Math.ceil(n / 14) === 0) {
      const label = svg('text', { x: x + bw / 2, y: CHART_H - PAD.b + 14, 'text-anchor': 'middle', 'font-size': 9.5, fill: cssVar('--text-muted') });
      label.textContent = xFormat(d[xKey]);
      root.appendChild(label);
    }
  });
  root.appendChild(svg('line', { x1: PAD.l, x2: CHART_W - PAD.r, y1: zeroY, y2: zeroY, stroke: cssVar('--baseline'), 'stroke-width': 1 }));
  container.appendChild(root);
}

function hBarChart(container, data, opts) {
  const { labelKey, valueKey, color = seriesColor(0), valueFormat = (v) => v } = opts;
  const rowH = 22;
  const h = data.length * rowH + 10;
  const w = CHART_W;
  const labelW = 150;
  const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, style: 'display:block;width:100%;height:auto' });
  const maxV = niceMax(Math.max(...data.map(d => d[valueKey]), 0));
  const innerW = w - labelW - 50;
  data.forEach((d, i) => {
    const y = i * rowH + 6;
    const label = svg('text', { x: labelW - 8, y: y + 13, 'text-anchor': 'end', 'font-size': 11, fill: cssVar('--text-secondary') });
    label.textContent = d[labelKey].length > 18 ? d[labelKey].slice(0, 17) + '…' : d[labelKey];
    root.appendChild(label);
    const bw = maxV > 0 ? (d[valueKey] / maxV) * innerW : 0;
    const rect = svg('rect', { x: labelW, y, width: Math.max(2, bw), height: 14, rx: 3, fill: color });
    rect.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, `${d[labelKey]}: <b>${d[valueKey].toLocaleString('ko-KR')}건</b>`));
    rect.addEventListener('mouseleave', hideTooltip);
    root.appendChild(rect);
    const vLabel = svg('text', { x: labelW + bw + 6, y: y + 13, 'font-size': 10.5, fill: cssVar('--text-muted') });
    vLabel.textContent = d[valueKey].toLocaleString('ko-KR');
    root.appendChild(vLabel);
  });
  container.appendChild(root);
}

function lineChart(container, data, opts) {
  const { xKey, yKey, color = seriesColor(0), yFormat = (v) => v, tooltipFormat } = opts;
  const root = baseSvg();
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const maxV = niceMax(Math.max(...data.map(d => d[yKey]), 0));
  const gy = svg('g');
  for (const t of yTicks(maxV)) {
    const y = PAD.t + innerH - (t / maxV) * innerH;
    gy.appendChild(svg('line', { x1: PAD.l, x2: CHART_W - PAD.r, y1: y, y2: y, stroke: cssVar('--grid'), 'stroke-width': 1 }));
    const label = svg('text', { x: PAD.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: cssVar('--text-muted') });
    label.textContent = yFormat(t);
    gy.appendChild(label);
  }
  root.appendChild(gy);

  const n = data.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const pts = data.map((d, i) => [PAD.l + i * stepX, PAD.t + innerH - (maxV > 0 ? (d[yKey] / maxV) * innerH : 0)]);
  const path = svg('path', { d: 'M ' + pts.map(p => p.join(',')).join(' L '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  root.appendChild(path);

  data.forEach((d, i) => {
    const [x, y] = pts[i];
    const dot = svg('circle', { cx: x, cy: y, r: 3, fill: color, opacity: n > 24 && i % 2 !== 0 ? 0 : 1 });
    dot.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, tooltipFormat ? tooltipFormat(d) : `${d[xKey]}: ${d[yKey]}`));
    dot.addEventListener('mouseleave', hideTooltip);
    root.appendChild(dot);
    if (n <= 16 || i % Math.ceil(n / 12) === 0) {
      const label = svg('text', { x, y: CHART_H - PAD.b + 14, 'text-anchor': 'middle', 'font-size': 9, fill: cssVar('--text-muted') });
      label.textContent = d[xKey];
      root.appendChild(label);
    }
  });
  root.appendChild(svg('line', { x1: PAD.l, x2: CHART_W - PAD.r, y1: PAD.t + innerH, y2: PAD.t + innerH, stroke: cssVar('--baseline'), 'stroke-width': 1 }));
  container.appendChild(root);
}

function scatterChart(container, data, opts) {
  const { xKey, yKey, color = seriesColor(0) } = opts;
  const root = baseSvg();
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const xMax = niceMax(Math.max(...data.map(d => d[xKey]), 0));
  const yMin = Math.min(...data.map(d => d[yKey]), 0);
  const yMax = Math.max(...data.map(d => d[yKey]), 0);
  const yRange = Math.max(Math.abs(yMin), Math.abs(yMax), 1);

  for (const t of yTicks(yRange * 2, 4)) {
    const val = t - yRange;
    const y = PAD.t + innerH - ((val + yRange) / (yRange * 2)) * innerH;
    root.appendChild(svg('line', { x1: PAD.l, x2: CHART_W - PAD.r, y1: y, y2: y, stroke: cssVar('--grid'), 'stroke-width': 1 }));
    const label = svg('text', { x: PAD.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: cssVar('--text-muted') });
    label.textContent = val.toFixed(1) + '%';
    root.appendChild(label);
  }
  data.forEach(d => {
    const x = PAD.l + (d[xKey] / xMax) * innerW;
    const y = PAD.t + innerH - ((d[yKey] + yRange) / (yRange * 2)) * innerH;
    const dot = svg('circle', { cx: x, cy: y, r: 3, fill: color, opacity: 0.55 });
    dot.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, `참여업체수 ${d[xKey]}개 · 낙찰률 ${d[yKey].toFixed(2)}%`));
    dot.addEventListener('mouseleave', hideTooltip);
    root.appendChild(dot);
  });
  root.appendChild(svg('line', { x1: PAD.l, x2: CHART_W - PAD.r, y1: PAD.t + innerH / 1, y2: PAD.t + innerH, stroke: cssVar('--baseline'), 'stroke-width': 1 }));
  const xLabel = svg('text', { x: CHART_W - PAD.r, y: CHART_H - 6, 'text-anchor': 'end', 'font-size': 10, fill: cssVar('--text-muted') });
  xLabel.textContent = `참여업체수 → (최대 ${Math.round(xMax)}개)`;
  root.appendChild(xLabel);
  container.appendChild(root);
}

// 값 차이가 작아 0 기준 막대그래프로는 추세가 안 보이는 데이터용 — 실제 값 범위로 확대(zoom)하고
// 각 점 위에 값 라벨을 직접 표시해 항목 간 비교가 가능하게 한다.
function trendChart(container, data, opts) {
  const { xKey, yKey, color = seriesColor(0), yFormat = (v) => v.toFixed(2) + '%', tooltipFormat } = opts;
  const root = baseSvg();
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const values = data.map(d => d[yKey]);
  const dataMax = Math.max(...values);
  const dataMin = Math.min(...values);
  const pad = (dataMax - dataMin) * 0.6 || Math.abs(dataMax) * 0.1 || 1;
  const maxV = dataMax + pad;
  const minV = dataMin - pad;
  const range = (maxV - minV) || 1;

  for (const t of yTicks(range, 4).map(v => v + minV)) {
    const y = PAD.t + innerH - ((t - minV) / range) * innerH;
    root.appendChild(svg('line', { x1: PAD.l, x2: CHART_W - PAD.r, y1: y, y2: y, stroke: cssVar('--grid'), 'stroke-width': 1 }));
    const label = svg('text', { x: PAD.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: cssVar('--text-muted') });
    label.textContent = yFormat(t);
    root.appendChild(label);
  }

  const n = data.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const pts = data.map((d, i) => [PAD.l + i * stepX, PAD.t + innerH - ((d[yKey] - minV) / range) * innerH]);
  const path = svg('path', { d: 'M ' + pts.map(p => p.join(',')).join(' L '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  root.appendChild(path);

  data.forEach((d, i) => {
    const [x, y] = pts[i];
    const dot = svg('circle', { cx: x, cy: y, r: 4, fill: color });
    dot.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, tooltipFormat ? tooltipFormat(d) : `${d[xKey]}: ${yFormat(d[yKey])}`));
    dot.addEventListener('mouseleave', hideTooltip);
    root.appendChild(dot);

    const valueLabel = svg('text', { x, y: y - 10, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 700, fill: cssVar('--text-primary') });
    valueLabel.textContent = yFormat(d[yKey]);
    root.appendChild(valueLabel);

    const label = svg('text', { x, y: CHART_H - PAD.b + 14, 'text-anchor': 'middle', 'font-size': 9.5, fill: cssVar('--text-muted') });
    label.textContent = d[xKey];
    root.appendChild(label);
  });
  container.appendChild(root);
}

// ---------- data loading & rendering ----------
async function loadStats() {
  const res = await fetch('/api/history/stats.json');
  return res.json();
}

function renderStatTiles(stats) {
  const el = document.getElementById('stat-tiles');
  const from = new Date(stats.dateRange.from);
  const to = new Date(stats.dateRange.to);
  const fmtDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const tiles = [
    { label: '전체 표본 (낙찰 이력)', value: stats.totalCount.toLocaleString('ko-KR') + '건', sub: `${fmtDate(from)} ~ ${fmtDate(to)}` },
    { label: '부산', value: (stats.byRegion['부산'] || 0).toLocaleString('ko-KR') + '건', sub: '검색 지역 기준' },
    { label: '경남', value: (stats.byRegion['경남'] || 0).toLocaleString('ko-KR') + '건', sub: '검색 지역 기준' },
    { label: '낙찰률 중앙값 (가중)', value: fmtRatioAsPct(stats.weightedStats.낙찰률_중앙값), sub: '1순위금액 ÷ 예정가격' },
  ];
  el.innerHTML = '';
  for (const t of tiles) {
    const div = document.createElement('div');
    div.className = 'stat-tile';
    div.innerHTML = `<div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub}</div>`;
    el.appendChild(div);
  }
}

function renderMethodology(stats) {
  const el = document.getElementById('methodology-weights');
  const w = stats.weights;
  el.innerHTML = `
    <span class="weight-chip" style="background:${seriesColor(0)}22;color:${seriesColor(0)}">최근1년 ${(w['최근1년']*100).toFixed(0)}%</span>
    <span class="weight-chip" style="background:${seriesColor(1)}22;color:${seriesColor(1)}">1~2년전 ${(w['1~2년전']*100).toFixed(0)}%</span>
    <span class="weight-chip" style="background:${seriesColor(2)}22;color:${seriesColor(2)}">2~3년전 ${(w['2~3년전']*100).toFixed(0)}%</span>
  `;
}

function renderCharts(stats) {
  // 연차별 건수
  const bucketOrder = ['최근1년', '1~2년전', '2~3년전'];
  barChart(document.getElementById('chart-bucket'),
    bucketOrder.map((k, i) => ({ label: k, count: stats.byBucket[k] || 0, i })),
    { xKey: 'label', yKey: 'count', color: seriesColor(0), tooltipFormat: (d) => `${d.label}: <b>${d.count.toLocaleString('ko-KR')}건</b>` });

  // 지역별
  hBarChart(document.getElementById('chart-region'),
    Object.entries(stats.byRegion).map(([label, count]) => ({ label, count })),
    { labelKey: 'label', valueKey: 'count', color: seriesColor(1) });

  // 업종별
  hBarChart(document.getElementById('chart-category'),
    Object.entries(stats.byCategory).map(([label, count]) => ({ label, count })),
    { labelKey: 'label', valueKey: 'count', color: seriesColor(2) });

  // 월별 추이
  const months = Object.keys(stats.byMonth).sort();
  lineChart(document.getElementById('chart-month'),
    months.map(m => ({ month: m.slice(2), count: stats.byMonth[m] })),
    { xKey: 'month', yKey: 'count', color: seriesColor(0), tooltipFormat: (d) => `${d.month}: <b>${d.count}건</b>` });

  // 낙찰률 히스토그램
  barChart(document.getElementById('chart-winratio'),
    stats.winRatioHist.map(d => ({ bucket: d.bucket.toFixed(1) + '%', count: d.count })),
    { xKey: 'bucket', yKey: 'count', color: seriesColor(4), tooltipFormat: (d) => `${d.bucket}: <b>${d.count}건</b>` });

  // 금액 구간별
  barChart(document.getElementById('chart-amount'),
    stats.amountDist,
    { xKey: 'label', yKey: 'count', color: seriesColor(5), tooltipFormat: (d) => `${d.label}: <b>${d.count}건</b>` });

  // Top 발주처
  hBarChart(document.getElementById('chart-orgs'), stats.topOrgs, { labelKey: 'name', valueKey: 'count', color: seriesColor(3) });

  // Top 시군구
  hBarChart(document.getElementById('chart-locals'), stats.topLocals, { labelKey: 'name', valueKey: 'count', color: seriesColor(6) });

  // 산점도
  scatterChart(document.getElementById('chart-scatter'), stats.scatter, { xKey: '참여업체수', yKey: '낙찰률', color: seriesColor(7) });
  const corr = stats.scatterCorrelation;
  const corrLabel = corr == null ? '' : (Math.abs(corr) < 0.1 ? '거의 무관' : (corr > 0 ? '약한 양의 상관' : '약한 음의 상관'));
  document.getElementById('scatter-sub').textContent =
    `최근 1년, 표본 ${stats.scatterSampleTotal.toLocaleString('ko-KR')}건 중 최대 400개 표시 · 상관계수 ${corr != null ? corr.toFixed(3) : '-'} (${corrLabel})`;

  // 참여업체수 구간별 평균 낙찰률 (값 차이가 작아 실제 범위로 확대해서 추세를 비교)
  trendChart(document.getElementById('chart-participant-bins'),
    stats.participantBins.map(b => ({ label: b.label, avg: (b.평균낙찰률 - 1) * 100 })),
    { xKey: 'label', yKey: 'avg', color: seriesColor(7),
      tooltipFormat: (d) => `참여 ${d.label}: 평균 낙찰률 <b>${d.avg.toFixed(2)}%</b>` });
  const bins = stats.participantBins;
  if (bins.length >= 2) {
    const first = bins[0], last = bins[bins.length - 1];
    const diff = ((last.평균낙찰률 - first.평균낙찰률) * 100).toFixed(2);
    const direction = diff > 0 ? '높아지는' : '낮아지는';
    document.getElementById('participant-bins-note').textContent =
      `참여업체가 ${first.label}일 때 평균 ${((first.평균낙찰률 - 1) * 100).toFixed(2)}% → ${last.label}일 때 평균 ${((last.평균낙찰률 - 1) * 100).toFixed(2)}%로, 경쟁이 치열해질수록 낙찰률이 ${Math.abs(diff)}%p ${direction} 경향입니다.`;
  }
}

function renderRawTable(stats) {
  // 원자료 테이블은 별도 API 없이, top 발주처/월별 요약을 접근성용 표로 제공
  const el = document.getElementById('raw-table-body');
  const months = Object.keys(stats.byMonth).sort().reverse();
  el.innerHTML = months.map(m => `<tr><td>${m}</td><td>${stats.byMonth[m]}건</td></tr>`).join('');
}

// ---------- open bids ----------
async function loadOpenBids() {
  const res = await fetch('/api/open-bids.json');
  return res.json();
}
async function loadMyBidList() {
  const res = await fetch('/api/mybid-list.json');
  return res.json();
}

function renderStrategyTiles(rec) {
  const sr = rec.stableRegression;
  const ac = rec.aggressiveCluster;
  if (!sr && !ac) return '';
  const srColor = seriesColor(4); // violet
  const acColor = seriesColor(6); // magenta
  return `
    <div class="strategy-block">
      ${sr ? `
        <div class="strategy-group">
          <p class="strategy-title" style="color:${srColor}">안정회귀형 <span class="strategy-sub">— 가중평균 낙찰률의 표준오차(SEM) 구간, 평균 회귀 기대</span></p>
          <div class="tier-grid">
            <div class="tier-tile" style="border-color:${srColor}55">
              <div class="p">하한선</div>
              <div class="amt">${fmtWon(sr.하한선)}</div>
              <div class="ratio">예정가격 대비 ${fmtRatioAsPct(sr.사정률하한)}</div>
            </div>
            <div class="tier-tile" style="border-color:${srColor}55">
              <div class="p">중앙값</div>
              <div class="amt">${fmtWon(sr.중앙값)}</div>
              <div class="ratio">예정가격 대비 ${fmtRatioAsPct(sr.사정률중앙)}</div>
            </div>
            <div class="tier-tile" style="border-color:${srColor}55">
              <div class="p">상한선</div>
              <div class="amt">${fmtWon(sr.상한선)}</div>
              <div class="ratio">예정가격 대비 ${fmtRatioAsPct(sr.사정률상한)}</div>
            </div>
          </div>
        </div>` : ''}
      ${ac ? `
        <div class="strategy-group">
          <p class="strategy-title" style="color:${acColor}">공격밀집형 <span class="strategy-sub">— 과거 낙찰률 최다빈도 구간(표본 ${(ac.구간표본비중*100).toFixed(1)}% 집중)</span></p>
          <div class="tier-grid">
            <div class="tier-tile" style="border-color:${acColor}55">
              <div class="p">하한선</div>
              <div class="amt">${fmtWon(ac.하한선)}</div>
              <div class="ratio">예정가격 대비 ${fmtRatioAsPct(ac.사정률하한)}</div>
            </div>
            <div class="tier-tile" style="border-color:${acColor}55">
              <div class="p">상한선</div>
              <div class="amt">${fmtWon(ac.상한선)}</div>
              <div class="ratio">예정가격 대비 ${fmtRatioAsPct(ac.사정률상한)}</div>
            </div>
          </div>
        </div>` : ''}
    </div>
  `;
}

function renderCompanyPredictions(topCompanies) {
  if (!topCompanies || !topCompanies.length) return '';
  return `
    <div class="strategy-block">
      <div class="strategy-group">
        <p class="strategy-title">TOP5 업체 예측 입찰가 <span class="strategy-sub">— 각 업체의 과거 낙찰이력(가중평균 낙찰률) 기준 예측치</span></p>
        <div class="tier-grid">
          ${topCompanies.map((c, i) => `
            <div class="tier-tile" style="border-color:${seriesColor(i)}55">
              <div class="p">${c.companyName}${c.신뢰도.includes('낮음') ? ' ·표본부족' : ''}</div>
              <div class="amt">${fmtWon(c.예측입찰가)}</div>
              <div class="ratio">예정가격 대비 ${fmtRatioAsPct(c.예측낙찰률)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function bidMetaLine(item) {
  const parts = [];
  if (item.기초금액) parts.push(`기초금액 <b>${fmtWonShort(item.기초금액)}</b>`);
  parts.push(`발주처 <b>${item.발주처 || '-'}</b>`);
  parts.push(`지역 <b>${item.지역 || '-'}</b>`);
  if (item.투찰마감일) parts.push(`투찰마감 <b>${item.투찰마감일}</b>`);
  if (item.개찰일) parts.push(`개찰일 <b>${item.개찰일}</b>`);
  return parts.map(p => `<span>${p}</span>`).join('');
}

async function loadItemAnalysis(analysisEl, postingId) {
  if (analysisEl.dataset.loaded === '1') return;
  analysisEl.innerHTML = '<div class="empty-note">분석 중…</div>';
  try {
    const res = await fetch(`/api/analysis/${encodeURIComponent(postingId)}.json`);
    const data = await res.json();
    if (data.error) { analysisEl.innerHTML = `<div class="empty-note">${data.error}</div>`; return; }
    const rec = data.recommendation;
    analysisEl.innerHTML = `
      <div style="font-size:12.5px;color:var(--text-secondary)">
        추정 예정가격 <b style="color:var(--text-primary)">${fmtWon(rec.추정예정가격)}</b>
        (기초금액 대비 ${(rec.추정예가율 * 100).toFixed(2)}%, 표본 ${rec.표본수.toLocaleString('ko-KR')}건)
      </div>
      <div class="tier-grid">
        ${rec.tiers.map((t, i) => `
          <div class="tier-tile" style="border-color:${seriesColor(i)}55">
            <div class="p">낙찰 확률 ${t.probability}%</div>
            <div class="amt">${fmtWon(t.추천금액)}</div>
            <div class="ratio">예정가격 대비 ${fmtRatioAsPct(t.낙찰률)}</div>
          </div>
        `).join('')}
      </div>
      ${renderStrategyTiles(rec)}
      ${renderCompanyPredictions(data.topCompanies)}
    `;
    analysisEl.dataset.loaded = '1';
  } catch (e) {
    analysisEl.innerHTML = '<div class="empty-note">분석 실패: ' + e.message + '</div>';
  }
}

function renderBidList(listElId, data, { emptyMsg, updatedElId, countLabel } = {}) {
  const el = document.getElementById(listElId);
  const updatedEl = updatedElId ? document.getElementById(updatedElId) : null;
  if (!data.items || !data.items.length) {
    el.innerHTML = `<div class="empty-note">${emptyMsg || '항목이 없습니다.'}</div>`;
    if (updatedEl) updatedEl.textContent = data.updatedAt ? `마지막 갱신: ${new Date(data.updatedAt).toLocaleString('ko-KR')}` : '아직 갱신 전';
    return;
  }
  if (updatedEl) {
    updatedEl.textContent = `마지막 갱신: ${new Date(data.updatedAt).toLocaleString('ko-KR')} · ${countLabel || ''} ${data.count}건`;
  }
  el.innerHTML = '';
  for (const item of data.items) {
    const card = document.createElement('div');
    card.className = 'bid-card';
    card.innerHTML = `
      <div class="row1">
        <div class="title">${item.title}</div>
        <div class="badge">${item.종목 || ''}</div>
      </div>
      <div class="meta">${bidMetaLine(item)}</div>
      <div class="bid-analysis" data-loaded="0"></div>
    `;
    const analysisEl = card.querySelector('.bid-analysis');
    card.addEventListener('click', () => {
      const isOpen = analysisEl.classList.contains('open');
      document.querySelectorAll('.bid-analysis.open').forEach(o => { if (o !== analysisEl) o.classList.remove('open'); });
      if (isOpen) { analysisEl.classList.remove('open'); return; }
      analysisEl.classList.add('open');
      loadItemAnalysis(analysisEl, item.posting_id);
    });
    el.appendChild(card);
  }
}

async function doRefresh() {
  // 아이건설넷 자동 로그인 중단(2026-07-19) — 나라장터 연동으로 대체 전까지 비활성화.
  alert('아이건설넷 자동 로그인은 중단되었습니다.\n진행중 입찰 정보는 나라장터 연동으로 대체될 예정입니다.');
}

async function loadTopCompanies() {
  const res = await fetch('/api/top-companies.json');
  return res.json();
}

function renderTopCompanies(companies) {
  const el = document.getElementById('top-companies-list');
  el.innerHTML = '';
  companies.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'bid-card';
    card.innerHTML = `
      <div class="row1">
        <div class="title">#${i + 1} ${c.name}</div>
        <div class="badge">낙찰 ${c.총낙찰건수}건 · 평균낙찰률 ${fmtRatioAsPct(c.평균낙찰률)}</div>
      </div>
      <div class="meta">
        <span>평균 예정가격 <b>${fmtWonShort(c.평균예정가격)}</b></span>
        <span>평균 낙찰금액(=입찰가) <b>${fmtWonShort(c.평균낙찰금액)}</b> <span style="color:var(--text-muted)">(예정가격 대비 ${fmtRatioAsPct(c.평균낙찰률)})</span></span>
        <span>평균 차액 <b style="color:${c.평균차액 < 0 ? 'var(--series-6)' : 'var(--good)'}">${fmtWonDiff(c.평균차액)} (${fmtPctDiff(c.평균낙찰률)})</b></span>
        <span>차액 범위 <b>${fmtWonDiff(c.최대차액)} (${fmtPctDiff(c.최대낙찰률)}) ~ ${fmtWonDiff(c.최소차액)} (${fmtPctDiff(c.최소낙찰률)})</b></span>
      </div>
      <div class="meta" style="margin-top:2px"><span>클릭하면 건별 낙찰 이력 상세를 볼 수 있습니다</span></div>
      <div class="bid-analysis" data-loaded="0"></div>
    `;
    const analysisEl = card.querySelector('.bid-analysis');
    card.addEventListener('click', () => {
      const isOpen = analysisEl.classList.contains('open');
      document.querySelectorAll('#top-companies-list .bid-analysis.open').forEach(o => { if (o !== analysisEl) o.classList.remove('open'); });
      if (isOpen) { analysisEl.classList.remove('open'); return; }
      analysisEl.classList.add('open');
      if (analysisEl.dataset.loaded === '1') return;
      analysisEl.innerHTML = `
        <div class="table-scroll" style="max-height:320px">
          <table class="data-table">
            <thead><tr><th>공사명</th><th>발주처</th><th>개찰일</th><th>기초금액</th><th>예정가격</th><th>낙찰금액(=입찰가)</th><th>차액</th><th>낙찰률</th></tr></thead>
            <tbody>
              ${c.records.map(r => `
                <tr>
                  <td>${r.title}</td>
                  <td>${r.발주처}</td>
                  <td>${r.개찰일 ? new Date(r.개찰일).toLocaleDateString('ko-KR') : '-'}</td>
                  <td>${fmtWonShort(r.기초금액)}</td>
                  <td>${fmtWonShort(r.예정가격)}</td>
                  <td>${fmtWonShort(r.낙찰금액)}</td>
                  <td style="color:${r.차액 < 0 ? 'var(--series-6)' : 'var(--good)'}">${fmtWonDiff(r.차액)} (${fmtPctDiff(r.낙찰률)})</td>
                  <td>${fmtRatioAsPct(r.낙찰률)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      analysisEl.dataset.loaded = '1';
    });
    el.appendChild(card);
  });
}

// ---------- AI 예정가격 예측 검증 ----------
async function loadAiPredictionReport() {
  try {
    const res = await fetch('/api/ai-prediction/report.json');
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

function renderAiPrediction(report) {
  const section = document.getElementById('ai-prediction-summary').closest('section');
  if (!report || report.error || !report.ai) {
    if (section) section.style.display = 'none';
    return;
  }

  const el = document.getElementById('ai-prediction-summary');
  const tiles = [
    { label: '채점 표본', value: report.scoredCount.toLocaleString('ko-KR') + '건', sub: `전체 샘플 ${report.sampleTotal}건 중` },
    { label: 'AI 추론 오차율(MAE)', value: (report.ai.mae * 100).toFixed(3) + '%', sub: '평균 절대 오차율' },
    { label: '기존모델 오차율(MAE)', value: (report.baseline.mae * 100).toFixed(3) + '%', sub: '종목군 평균 예가율만 적용' },
    { label: 'AI ±1% 이내 적중률', value: (report.ai.hitRates['±1.0%'] * 100).toFixed(1) + '%', sub: `기존모델 ${(report.baseline.hitRates['±1.0%'] * 100).toFixed(1)}%` },
  ];
  el.innerHTML = '';
  for (const t of tiles) {
    const div = document.createElement('div');
    div.className = 'stat-tile';
    div.innerHTML = `<div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub}</div>`;
    el.appendChild(div);
  }

  const bands = Object.keys(report.ai.hitRates);
  const chartData = bands.map(b => ({
    band: b,
    AI: report.ai.hitRates[b] * 100,
    기존모델: report.baseline.hitRates[b] * 100,
  }));
  const container = document.getElementById('chart-ai-hitrate');
  container.innerHTML = '';
  const rowH = 46;
  const w = CHART_W, h = chartData.length * rowH + 10;
  const labelW = 60, innerW = w - labelW - 50;
  const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, style: 'display:block;width:100%;height:auto' });
  chartData.forEach((d, i) => {
    const y0 = i * rowH + 6;
    const label = svg('text', { x: labelW - 8, y: y0 + 26, 'text-anchor': 'end', 'font-size': 11, fill: cssVar('--text-secondary') });
    label.textContent = d.band;
    root.appendChild(label);
    [['AI', d.AI, seriesColor(0)], ['기존모델', d.기존모델, seriesColor(3)]].forEach(([name, val, color], j) => {
      const y = y0 + j * 18;
      const bw = (val / 100) * innerW;
      const rect = svg('rect', { x: labelW, y, width: Math.max(2, bw), height: 14, rx: 3, fill: color });
      rect.addEventListener('mousemove', (e) => showTooltip(e.clientX, e.clientY, `${name} ${d.band} 이내 적중: <b>${val.toFixed(1)}%</b>`));
      rect.addEventListener('mouseleave', hideTooltip);
      root.appendChild(rect);
      const vLabel = svg('text', { x: labelW + bw + 6, y: y + 11, 'font-size': 10, fill: cssVar('--text-muted') });
      vLabel.textContent = `${name} ${val.toFixed(1)}%`;
      root.appendChild(vLabel);
    });
  });
  container.appendChild(root);

  const body = document.getElementById('ai-table-body');
  body.innerHTML = report.rows.map(r => `
    <tr>
      <td>${r.posting_id}</td>
      <td>${fmtWonShort(r.기초금액)}</td>
      <td>${fmtWonShort(r.실제예정가격)}</td>
      <td>${fmtWonShort(r.AI예측예정가격)}</td>
      <td style="color:${Math.abs(r.AI오차율) < Math.abs(r.기존모델오차율) ? 'var(--good)' : 'var(--text-muted)'}">${(r.AI오차율 * 100).toFixed(2)}%</td>
      <td>${(r.기존모델오차율 * 100).toFixed(2)}%</td>
      <td style="max-width:320px;white-space:normal">${r.근거 || '-'}</td>
    </tr>`).join('');

  document.getElementById('ai-table-toggle').addEventListener('click', () => {
    const box = document.getElementById('ai-table-wrap');
    const open = box.style.display !== 'none';
    box.style.display = open ? 'none' : 'block';
    document.getElementById('ai-table-toggle').textContent = open ? '샘플 상세 결과 보기' : '표 숨기기';
  });
}

// ---------- 인증 ----------
async function loadMe() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  return res.json();
}

function renderAdminBar(me) {
  const el = document.getElementById('admin-bar');
  el.innerHTML = `
    <span>관리자 <b>${me.id}</b></span>
    <button id="change-pw-btn" type="button">비밀번호 변경</button>
    <button id="logout-btn" type="button">로그아웃</button>
  `;
  document.getElementById('change-pw-btn').addEventListener('click', () => openPasswordModal(false));
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });
}

function openPasswordModal(forced) {
  const modal = document.getElementById('password-modal');
  document.getElementById('password-modal-note').style.display = forced ? 'block' : 'none';
  document.getElementById('pw-cancel').style.display = forced ? 'none' : 'inline-block';
  document.getElementById('password-error').style.display = 'none';
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value = '';
  modal.classList.add('open');
  modal.dataset.forced = forced ? '1' : '0';
}

function closePasswordModal() {
  document.getElementById('password-modal').classList.remove('open');
}

function setupPasswordModal() {
  document.getElementById('pw-cancel').addEventListener('click', () => closePasswordModal());
  document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('password-error');
    errorEl.style.display = 'none';
    const currentPassword = document.getElementById('pw-current').value;
    const newPassword = document.getElementById('pw-new').value;
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!data.ok) {
        errorEl.textContent = data.error || '변경에 실패했습니다.';
        errorEl.style.display = 'block';
        return;
      }
      closePasswordModal();
    } catch (err) {
      errorEl.textContent = '요청 중 오류가 발생했습니다: ' + err.message;
      errorEl.style.display = 'block';
    }
  });
}

async function init() {
  const me = await loadMe();
  if (!me) { location.href = '/login.html'; return; }
  renderAdminBar(me);
  setupPasswordModal();
  if (me.mustChangePassword) openPasswordModal(true);

  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.textContent = '실시간 새로고침 (중단됨)';
  refreshBtn.classList.add('secondary');
  if (window.__SNAPSHOT_MODE__) {
    const banner = document.createElement('p');
    banner.className = 'section-sub';
    banner.style.cssText = 'margin:-10px 0 16px;color:var(--warning)';
    const t = window.__SNAPSHOT_TIME__ ? new Date(window.__SNAPSHOT_TIME__).toLocaleString('ko-KR') : '알 수 없음';
    banner.textContent = `⚠ 정적 스냅샷 버전입니다 (스냅샷 시각: ${t}).`;
    document.querySelector('header.top').insertAdjacentElement('afterend', banner);
  }
  document.getElementById('refresh-btn').addEventListener('click', doRefresh);
  document.getElementById('table-toggle').addEventListener('click', () => {
    const box = document.getElementById('raw-table-wrap');
    const open = box.style.display !== 'none';
    box.style.display = open ? 'none' : 'block';
    document.getElementById('table-toggle').textContent = open ? '월별 원자료 표 보기' : '표 숨기기';
  });

  const [stats, openBids, myBidList, topCompanies, aiReport] = await Promise.all([
    loadStats(), loadOpenBids(), loadMyBidList(), loadTopCompanies(), loadAiPredictionReport(),
  ]);
  renderStatTiles(stats);
  renderMethodology(stats);
  renderCharts(stats);
  renderRawTable(stats);
  renderBidList('mybid-list', myBidList, { emptyMsg: '맞춤정보에 등록된 항목이 없습니다. "새로고침"을 눌러보세요.', updatedElId: 'mybid-updated', countLabel: '전체' });
  renderBidList('open-bids-list', openBids, { emptyMsg: '진행중인 입찰 항목이 없습니다. "새로고침"을 눌러 최신 데이터를 가져오세요.', updatedElId: 'open-bids-updated', countLabel: '부산/경남' });
  renderTopCompanies(topCompanies);
  renderAiPrediction(aiReport);
}

init();
