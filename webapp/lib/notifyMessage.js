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

// 신규 공고 1건 + 분석 결과 요약. reportUrl은 해당 공고 분석 리포트 페이지(analysis.html?id=...).
function buildBidAnalysisMessage(item, recommendation, reportUrl) {
  const lines = [];
  lines.push('[케이알에스건설 신규 입찰]');
  lines.push(item.title || '(제목 없음)');
  lines.push(`발주처 ${item.발주처 || '-'} · ${item.지역 || item.지역약칭 || '-'}`);
  lines.push(`추정 예정가격 ${fmtWon(recommendation?.추정예정가격)}`);

  const tier80 = recommendation?.tiers?.find((t) => t.probability === 80);
  if (tier80?.추천금액) lines.push(`추천가(낙찰80%) ${fmtWon(tier80.추천금액)}`);
  const sr = recommendation?.stableRegression;
  if (sr?.중앙값) lines.push(`안정회귀 중앙값 ${fmtWon(sr.중앙값)}`);

  const adj = recommendation?.appliedAdjustments || [];
  if (adj.length) {
    const parts = adj.map((a) => `${a.value} ${(a.delta * 100 >= 0 ? '+' : '')}${(a.delta * 100).toFixed(2)}%p`);
    lines.push(`반영 편차: ${parts.join(', ')}`);
  }
  lines.push('');
  lines.push('▸ 상세 분석 리포트를 확인하세요.');
  return lines.join('\n');
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

module.exports = { buildOpenBidsMessage, buildBidAnalysisMessage, buildNewBidsSummaryMessage };
