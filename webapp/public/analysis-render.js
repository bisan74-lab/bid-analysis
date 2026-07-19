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
  return `
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
    ${renderAppliedAdjustments(rec.appliedAdjustments)}
    ${renderCompanyPredictions(data.topCompanies)}
  `;
}
