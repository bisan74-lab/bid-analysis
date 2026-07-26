// index.html(진행중 입찰 인라인 패널)과 analysis.html(공고별 새 탭 분석 페이지)이 공유하는 렌더 함수.
// app.js보다 먼저 로드되어야 한다.
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];
function seriesColor(i) { return getComputedStyle(document.documentElement).getPropertyValue(SERIES[i % SERIES.length]).trim(); }
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

const fmtWon = (n) => n == null ? '-' : Math.round(n).toLocaleString('ko-KR') + '원';
const fmtRatioAsPct = (r) => r == null ? '-' : (r * 100).toFixed(1) + '%';

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
          <p class="strategy-title" style="color:${acColor}">공격밀집형 <span class="strategy-sub">— 과거 낙찰률 최다빈도 구간(표본 ${(ac.구간표본비중 * 100).toFixed(1)}% 집중)</span></p>
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

// 복수예비가격 → 예정가격 확률 분포. 15개 예비가격 중 다빈도 4개 평균으로 정해지는 예정가격이,
// 과거 예가율 분포 기준으로 이번 기초금액에서 확률적으로 어느 구간에 떨어지는지 밴드로 보여준다.
function renderJeonggaDistribution(rec) {
  const dist = rec.예정가격분포;
  if (!dist || !dist.length) return '';
  const color = seriesColor(2); // teal/green 계열
  const label = { 10: 'P10(하방)', 25: 'P25', 50: '중앙(P50)', 75: 'P75', 90: 'P90(상방)' };
  const tiles = dist.map(d => {
    const emphasize = d.pct === 50;
    const sign = d.사정률 != null && d.사정률 >= 0 ? '+' : '';
    return `
      <div class="tier-tile" style="border-color:${color}${emphasize ? 'aa' : '55'}">
        <div class="p">${label[d.pct] || ('P' + d.pct)}</div>
        <div class="amt">${fmtWon(d.예정가격)}</div>
        <div class="ratio">사정률 ${d.사정률 == null ? '-' : sign + (d.사정률 * 100).toFixed(2) + '%'}</div>
      </div>`;
  }).join('');
  return `
    <div class="strategy-block">
      <div class="strategy-group">
        <p class="strategy-title" style="color:${color}">예정가격 확률 분포 <span class="badge-v1">Version_1</span> <span class="strategy-sub">— 복수예비가격 15개 중 다빈도 4개 평균으로 정해지는 예정가격의 확률 구간(과거 예가율 분포 기준)</span></p>
        <div class="tier-grid">${tiles}</div>
      </div>
    </div>
  `;
}

// A값 적용 투찰금액(낙찰하한가) 계산기. (예정가격 − A값) × 낙찰하한율 + A값.
// 예정가격/낙찰하한율은 추정치를 프리필하되, 실제 공고의 A값·낙찰하한율을 넣으면 즉시 재계산된다.
function renderAValueCalculator(rec) {
  const 예정가격 = rec.추정예정가격 ?? '';
  // 낙찰하한율 프리필: 안정회귀형 중앙 낙찰률(경험적 유효 낙찰하한율 근사)을 %로.
  const 하한율 = rec.stableRegression && rec.stableRegression.사정률중앙 != null
    ? (rec.stableRegression.사정률중앙 * 100).toFixed(3) : '87.745';
  const 초기투찰 = 예정가격 ? fmtWon(Math.round(예정가격 * (Number(하한율) / 100))) : '-'; // A값 0 기준 초기값
  return `
    <div class="strategy-block">
      <div class="strategy-group avalue-calc">
        <p class="strategy-title">투찰금액 계산기 (A값 적용) <span class="badge-v1">Version_1</span> <span class="strategy-sub">— (예정가격 − A값) × 낙찰하한율 + A값. A값은 노무비·보험료·산업안전보건관리비 등 낙찰률 할인 대상에서 제외되는 고정 실비</span></p>
        <div class="avalue-inputs">
          <label>예정가격(원)<input type="number" class="av-jeongga" value="${예정가격}" oninput="krsCalcTuchal(this)"></label>
          <label>낙찰하한율(%)<input type="number" step="0.001" class="av-rate" value="${하한율}" oninput="krsCalcTuchal(this)"></label>
          <label>A값(원)<input type="number" class="av-a" value="0" oninput="krsCalcTuchal(this)"></label>
        </div>
        <div class="avalue-result">투찰금액 <b class="av-out">${초기투찰}</b></div>
      </div>
    </div>
  `;
}

// 계산기 입력 변화 시 호출(인라인 oninput). 소속 그룹 내 입력값으로 투찰금액을 재계산해 표시.
function krsCalcTuchal(el) {
  const box = el.closest('.avalue-calc');
  if (!box) return;
  const 예정가격 = Number(box.querySelector('.av-jeongga').value) || 0;
  const 하한율 = (Number(box.querySelector('.av-rate').value) || 0) / 100;
  const A값 = Number(box.querySelector('.av-a').value) || 0;
  const 투찰 = Math.round((예정가격 - A값) * 하한율 + A값);
  box.querySelector('.av-out').textContent = Number.isFinite(투찰) && 예정가격 > 0 ? fmtWon(투찰) : '-';
}

// Version_2 (복합 요소 확률 추론): 예상 경쟁강도·낙찰확률·발주처 투찰성향. 확정이 아닌 추론치임을 명시.
function renderV2(rec) {
  const v = rec.v2;
  if (!v) return '';
  const pct = (x, d = 2) => x == null ? '-' : (x * 100).toFixed(d) + '%';
  const gradeColor = v.경쟁강도등급 === '저경쟁' ? '#12855a' : v.경쟁강도등급 === '고경쟁' ? '#e34948' : cssVar('--text-secondary');
  const mult = v.확률배수;
  const multTxt = mult == null ? '-' : (mult >= 1 ? '유리 ▲' : '불리 ▼') + ' ' + mult.toFixed(1) + '배';
  const v2color = '#6b3fd6';
  return `
    <div class="strategy-block">
      <div class="strategy-group">
        <p class="strategy-title" style="color:${v2color}"><span class="badge-v2">Version_2</span> 복합 요소 낙찰 확률 추론 <span class="strategy-sub">— 예상 경쟁강도·낙찰확률 추정(확정값이 아닌 확률적 추론)</span></p>
        <div class="tier-grid">
          <div class="tier-tile" style="border-color:${gradeColor}66">
            <div class="p">예상 참여업체수</div>
            <div class="amt">${v.예상참여업체수}개사</div>
            <div class="ratio" style="color:${gradeColor}">${v.경쟁강도등급}</div>
          </div>
          <div class="tier-tile" style="border-color:${v2color}66">
            <div class="p">예상 낙찰확률</div>
            <div class="amt">${pct(v.예상낙찰확률)}</div>
            <div class="ratio">시장 평균 ${pct(v.기준낙찰확률)} 대비 ${multTxt}</div>
          </div>
          <div class="tier-tile" style="border-color:${v2color}66">
            <div class="p">발주처 낙찰 투찰성향</div>
            <div class="amt">${v.발주처낙찰사정률 != null ? v.발주처낙찰사정률.toFixed(3) + '%' : '표본부족'}</div>
            <div class="ratio">그룹 평균 ${v.그룹낙찰사정률.toFixed(3)}%</div>
          </div>
        </div>
        <p style="margin:8px 0 0;font-size:11.5px;color:var(--text-muted)">근거: ${v.참여추정근거}. 예상 낙찰확률은 이 경쟁강도 구간의 과거 실측 낙찰률(모델 중심 투찰 기준)로, 실제 결과를 보장하지 않는 확률적 추정입니다. 발주처 투찰성향은 이 발주처 낙찰자들이 통상 투찰한 사정률로, 유리한 투찰점의 힌트입니다.</p>
      </div>
    </div>
  `;
}

// 공고의 세부 종목/발주처 특성이 기준 낙찰률에서 얼마나 벗어나는지(작은 편차) 반영한 경우, 그 내역을 보여준다.
function renderAppliedAdjustments(adjustments) {
  if (!adjustments || !adjustments.length) return '';
  const rows = adjustments.map(a => {
    const pct = (a.delta * 100).toFixed(2);
    const sign = a.delta >= 0 ? '+' : '';
    return `<li>${a.dimension} <b>${a.value}</b> 특성 반영: 낙찰률 ${sign}${pct}%p (표본 ${a.sampleSize.toLocaleString('ko-KR')}건)</li>`;
  }).join('');
  return `
    <div class="strategy-block">
      <div class="strategy-group">
        <p class="strategy-title">반영된 카테고리 편차 <span class="strategy-sub">— 세부 종목/발주처 특성에 따른 낙찰률 보정</span></p>
        <ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;color:var(--text-secondary)">${rows}</ul>
      </div>
    </div>
  `;
}

// /api/analysis/{postingId}.json 응답 전체를 받아, 인라인 패널/새 탭 페이지 공용 본문 HTML을 만든다.
function renderAnalysisBody(data) {
  if (data.error) return `<div class="empty-note">${data.error}</div>`;
  const rec = data.recommendation;
  const item = data.item || {};
  // 기초금액 기준 표기: 모든 사정률/예비가격/예정가격 추정은 기초금액을 기준점으로 한다.
  const baseNote = item.기초금액추정
    ? ` <span style="color:var(--text-secondary)">— 기초금액은 나라장터 추정가격 ${fmtWon(item.추정가격)} × 1.1(부가세) 환산</span>`
    : '';
  return `
    <div style="font-size:12.5px;color:var(--text-secondary)">
      기준 <b style="color:var(--text-primary)">기초금액 ${fmtWon(rec.기초금액)}</b>${item.기초금액추정 ? ' <span class="badge-v1">Version_1</span>' : ''}${baseNote}
    </div>
    <div style="font-size:12.5px;color:var(--text-secondary);margin-top:2px">
      추정 예정가격 <b style="color:var(--text-primary)">${fmtWon(rec.추정예정가격)}</b>
      (기초금액 대비 ${(rec.추정예가율 * 100).toFixed(2)}%, 표본 ${rec.표본수.toLocaleString('ko-KR')}건)
    </div>
    ${rec.aiFinal ? `
    <div class="strategy-block">
      <div class="strategy-group">
        <p class="strategy-title"><span class="badge-ai-final">AI최종</span> 예정가격 예측 <span class="strategy-sub">— 4,157건 leave-one-out 실측으로 채택/배제를 수렴한 최종 모델 (채택: 기초금액 기준 + 가중중앙값 / 배제: 발주처·종목·지역 편차)</span></p>
        <div class="tier-grid">
          <div class="tier-tile" style="border-color:#6b5bffaa">
            <div class="p">AI최종 예측 예정가격</div>
            <div class="amt">${fmtWon(rec.aiFinal.예측예정가격)}</div>
            <div class="ratio">기초금액 대비 ${(rec.aiFinal.예측예가율 * 100).toFixed(3)}% (표본 ${rec.aiFinal.표본수.toLocaleString('ko-KR')}건)</div>
          </div>
        </div>
        <p style="margin:6px 0 0;font-size:11.5px;color:var(--text-muted)">${rec.aiFinal.근거}. 점추정 오차 한계(~0.58%)는 복수예비가격 난수의 본질적 폭 — 아래 확률 분포와 함께 볼 것.</p>
      </div>
    </div>` : ''}
    ${renderV2(rec)}
    ${renderJeonggaDistribution(rec)}
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
    ${renderAppliedAdjustments(rec.appliedAdjustments)}
    ${renderAValueCalculator(rec)}
    ${renderCompanyPredictions(data.topCompanies)}
  `;
}
