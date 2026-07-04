// 카카오톡 알림 메시지 본문 생성 (server.js의 테스트 발송, scripts/notify.js의 예약 발송 공용)
const fmtWon = (n) => n == null ? '-' : Math.round(n).toLocaleString('ko-KR') + '원';

function buildOpenBidsMessage(cachedOpenBids, dashboardUrl) {
  const items = cachedOpenBids?.items || [];
  if (!items.length) {
    return `[케이알에스건설 입찰 알림]\n현재 부산/경남 진행중 입찰 항목이 없습니다.\n(마지막 확인: ${cachedOpenBids?.updatedAt ? new Date(cachedOpenBids.updatedAt).toLocaleString('ko-KR') : '없음'})`;
  }
  const top = items.slice(0, 5);
  const lines = top.map((it, i) =>
    `${i + 1}. ${it.title.replace(/^기초\s*/, '').slice(0, 30)} (${it.지역}, 기초금액 ${fmtWon(it.기초금액)}, 투찰마감 ${it.투찰마감일 || '-'})`
  );
  const more = items.length > top.length ? `\n...외 ${items.length - top.length}건` : '';
  return `[케이알에스건설 입찰 알림]\n부산/경남 진행중 입찰 ${items.length}건\n\n${lines.join('\n')}${more}\n\n전체 목록과 추천 입찰가는 대시보드에서 확인하세요.`;
}

module.exports = { buildOpenBidsMessage };
