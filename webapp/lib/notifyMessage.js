// 카카오톡 알림 메시지 본문 생성 (순수 문자열 포맷 — LLM/AI 미사용).
const fmtWon = (n) => n == null ? '-' : Math.round(n).toLocaleString('ko-KR') + '원';
const fmtWonShort = (n) => {
  if (n == null) return '-';
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억원';
  if (n >= 10_000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만원';
  return Math.round(n).toLocaleString('ko-KR') + '원';
};
const bidAmount = (it) => it.기초금액 || it.추정가격 || null;
const bidDeadline = (it) => it.등록마감일 || it.투찰마감일 || it.개찰일 || '-';

// (구) 진행중 입찰 전체 요약 — server.js의 테스트 발송에서 계속 사용.
function buildOpenBidsMessage(cachedOpenBids, dashboardUrl) {
  const items = cachedOpenBids?.items || [];
  if (!items.length) {
    return `[케이알에스건설 입찰 알림]\n현재 부산/경남 진행중 입찰 항목이 없습니다.\n(마지막 확인: ${cachedOpenBids?.updatedAt ? new Date(cachedOpenBids.updatedAt).toLocaleString('ko-KR') : '없음'})`;
  }
  const top = items.slice(0, 5);
  const lines = top.map((it, i) =>
    `${i + 1}. ${it.title.replace(/^기초\s*/, '').slice(0, 30)} (${it.지역 || it.지역약칭 || '-'}, ${fmtWonShort(bidAmount(it))}, 마감 ${bidDeadline(it)})`
  );
  const more = items.length > top.length ? `\n...외 ${items.length - top.length}건` : '';
  return `[케이알에스건설 입찰 알림]\n부산/경남 진행중 입찰 ${items.length}건\n\n${lines.join('\n')}${more}\n\n전체 목록과 추천 입찰가는 대시보드에서 확인하세요.`;
}

// 예정가격 분포에서 확률 밴드(P10~P90) 문자열을 만든다. 없으면 null.
function jeonggaBandText(recommendation) {
  const dist = recommendation?.예정가격분포;
  if (!Array.isArray(dist) || !dist.length) return null;
  const p10 = dist.find((d) => d.pct === 10);
  const p90 = dist.find((d) => d.pct === 90);
  if (!p10 || !p90) return null;
  return `${fmtWon(p10.예정가격)} ~ ${fmtWon(p90.예정가격)}`;
}

// 신규 공고 1건 + 분석 결과 요약. reportUrl은 해당 공고 분석 리포트 페이지(analysis.html?id=...).
// 2026-07-23 개선: 기준을 기초금액으로 명시(추정가격 환산 시 표기), 예정가격 확률 분포(P10~P90),
// A값 적용 투찰금액 공식 안내를 반영.
function buildBidAnalysisMessage(item, recommendation, reportUrl) {
  const lines = [];
  lines.push('[케이알에스건설 신규 입찰]');
  lines.push(item.title || '(제목 없음)');
  lines.push(`발주처 ${item.발주처 || '-'} · ${item.지역 || item.지역약칭 || '-'}`);

  const baseSuffix = item.기초금액추정 ? '(추정가격×1.1 환산)' : '';
  lines.push(`기준 기초금액 ${fmtWon(recommendation?.기초금액 ?? bidAmount(item))}${baseSuffix}`);
  lines.push(`추정 예정가격 ${fmtWon(recommendation?.추정예정가격)}`);
  const band = jeonggaBandText(recommendation);
  if (band) lines.push(`예정가격 분포(P10~P90) ${band}`);

  const tier80 = recommendation?.tiers?.find((t) => t.probability === 80);
  if (tier80?.추천금액) lines.push(`추천가(낙찰80%) ${fmtWon(tier80.추천금액)}`);
  const sr = recommendation?.stableRegression;
  if (sr?.중앙값) lines.push(`안정회귀 중앙값 ${fmtWon(sr.중앙값)}`);

  const adj = recommendation?.appliedAdjustments || [];
  if (adj.length) {
    const parts = adj.map((a) => `${a.value} ${(a.delta * 100 >= 0 ? '+' : '')}${(a.delta * 100).toFixed(2)}%p`);
    lines.push(`반영 편차: ${parts.join(', ')}`);
  }
  lines.push('※ 실제 투찰금액=(예정가격−A값)×낙찰하한율+A값 (A값은 공고문 확인, 리포트 계산기 이용)');
  lines.push('');
  lines.push('▸ 상세 분석 리포트를 확인하세요.');
  return lines.join('\n');
}

// 이메일용 HTML 본문. 카카오 텍스트보다 풍부하게 예정가격 분포 표·A값 투찰금액 계산식을 담는다.
function buildBidAnalysisEmailHtml(item, recommendation, reportUrl) {
  const rec = recommendation || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const baseSuffix = item.기초금액추정 ? ' <span style="color:#888">(추정가격×1.1 환산)</span>' : '';
  const tier80 = rec.tiers?.find((t) => t.probability === 80);
  const sr = rec.stableRegression;

  const distRows = (rec.예정가격분포 || []).map((d) => {
    const sign = d.사정률 != null && d.사정률 >= 0 ? '+' : '';
    return `<tr><td style="padding:2px 10px;border:1px solid #eee">P${d.pct}</td>`
      + `<td style="padding:2px 10px;border:1px solid #eee;text-align:right">${fmtWon(d.예정가격)}</td>`
      + `<td style="padding:2px 10px;border:1px solid #eee;text-align:right;color:#888">${d.사정률 == null ? '-' : sign + (d.사정률 * 100).toFixed(2) + '%'}</td></tr>`;
  }).join('');

  const adj = rec.appliedAdjustments || [];
  const adjHtml = adj.length
    ? `<p style="margin:8px 0 0;font-size:13px;color:#555">반영 편차: ${adj.map((a) => `${esc(a.value)} ${(a.delta * 100 >= 0 ? '+' : '')}${(a.delta * 100).toFixed(2)}%p`).join(', ')}</p>`
    : '';

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,'Malgun Gothic',sans-serif;max-width:560px;color:#222;line-height:1.6">
  <h2 style="margin:0 0 4px;font-size:18px">🏗️ 케이알에스건설 신규 입찰 분석</h2>
  <p style="margin:0 0 2px;font-weight:700">${esc(item.title || '(제목 없음)')}</p>
  <p style="margin:0 0 12px;font-size:13px;color:#555">발주처 ${esc(item.발주처 || '-')} · ${esc(item.지역 || item.지역약칭 || '-')} · 마감 ${esc(bidDeadline(item))}</p>

  <table style="border-collapse:collapse;font-size:14px;margin-bottom:6px">
    <tr><td style="padding:3px 10px 3px 0;color:#555">기준 기초금액</td><td style="padding:3px 0;font-weight:700">${fmtWon(rec.기초금액 ?? bidAmount(item))}${baseSuffix}</td></tr>
    <tr><td style="padding:3px 10px 3px 0;color:#555">추정 예정가격</td><td style="padding:3px 0;font-weight:700">${fmtWon(rec.추정예정가격)}</td></tr>
    <tr><td style="padding:3px 10px 3px 0;color:#555">추천가(낙찰 80%)</td><td style="padding:3px 0">${fmtWon(tier80?.추천금액)}</td></tr>
    <tr><td style="padding:3px 10px 3px 0;color:#555">안정회귀 중앙값</td><td style="padding:3px 0">${fmtWon(sr?.중앙값)}</td></tr>
  </table>
  ${adjHtml}

  ${distRows ? `<p style="margin:14px 0 4px;font-weight:700;font-size:14px">예정가격 확률 분포 <span style="font-weight:400;color:#888;font-size:12px">— 복수예비가격 15개 중 다빈도 4개 평균의 확률 구간</span></p>
  <table style="border-collapse:collapse;font-size:13px">
    <tr style="background:#f6f6f6"><th style="padding:2px 10px;border:1px solid #eee;text-align:left">구간</th><th style="padding:2px 10px;border:1px solid #eee">예정가격</th><th style="padding:2px 10px;border:1px solid #eee">사정률</th></tr>
    ${distRows}
  </table>` : ''}

  <p style="margin:14px 0 4px;font-weight:700;font-size:14px">투찰금액(낙찰하한가) 계산식</p>
  <p style="margin:0;font-size:13px;color:#333;background:#f6f6f6;padding:8px 10px;border-radius:6px">
    투찰금액 = (예정가격 − <b>A값</b>) × 낙찰하한율 + <b>A값</b><br>
    <span style="color:#888">A값(노무비·보험료·산업안전보건관리비 등 낙찰률 할인 제외 고정 실비)은 공고문에서 확인해 리포트의 계산기에 입력하세요.</span>
  </p>

  ${reportUrl ? `<p style="margin:16px 0 0"><a href="${esc(reportUrl)}" style="display:inline-block;background:#2b6cb0;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:14px">▸ 상세 분석 리포트 열기</a></p>` : ''}
  <p style="margin:14px 0 0;font-size:11px;color:#aaa">내부 분석용 · 실제 투찰 결정은 최신 공고 조건을 반드시 재확인하세요.</p>
</div>`;
}

// 신규가 많을 때(>5건) 개별 발송 대신 1건 합본 요약.
function buildNewBidsSummaryMessage(newItems, dashboardUrl) {
  const lines = [];
  lines.push('[케이알에스건설 신규 입찰]');
  lines.push(`새로 올라온 입찰 ${newItems.length}건`);
  lines.push('');
  newItems.slice(0, 8).forEach((it, i) => {
    lines.push(`${i + 1}. ${(it.title || '').slice(0, 30)} (${it.지역 || it.지역약칭 || '-'}, ${fmtWonShort(bidAmount(it))})`);
  });
  if (newItems.length > 8) lines.push(`...외 ${newItems.length - 8}건`);
  lines.push('');
  lines.push('▸ 대시보드에서 전체 목록과 추천 입찰가를 확인하세요.');
  return lines.join('\n');
}

module.exports = { buildOpenBidsMessage, buildBidAnalysisMessage, buildBidAnalysisEmailHtml, buildNewBidsSummaryMessage };
