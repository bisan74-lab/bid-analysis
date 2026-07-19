// analysis.html 전용 스크립트 — 진행중 입찰 카드를 새 탭으로 열면 이 페이지가 뜬다.
// 렌더 함수(renderAnalysisBody 등)는 analysis-render.js 공용 모듈에서 가져다 쓴다.
const fmtWonShort = (n) => {
  if (n == null) return '-';
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억원';
  if (n >= 10_000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만원';
  return Math.round(n).toLocaleString('ko-KR') + '원';
};

async function loadMe() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) return null;
  return res.json();
}

function metaLine(item) {
  const parts = [];
  const amount = item.기초금액 || item.추정가격;
  if (amount) parts.push(`기초금액(추정) ${fmtWonShort(amount)}`);
  if (item.발주처) parts.push(`발주처 ${item.발주처}`);
  if (item.지역 || item.지역약칭) parts.push(`지역 ${item.지역 || item.지역약칭}`);
  if (item.등록마감일) parts.push(`마감 ${item.등록마감일}`);
  if (item.개찰일) parts.push(`개찰 ${item.개찰일}`);
  return parts.join(' · ');
}

async function init() {
  const me = await loadMe();
  if (!me) { location.href = '/login.html'; return; }

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const bodyEl = document.getElementById('analysis-body');
  if (!id) {
    bodyEl.innerHTML = '<div class="empty-note">공고 ID가 없습니다.</div>';
    return;
  }

  try {
    const res = await fetch(`/api/analysis/${encodeURIComponent(id)}.json`);
    const data = await res.json();
    if (data.item) {
      document.getElementById('page-title').textContent = data.item.title || '공고 분석';
      document.getElementById('page-meta').textContent = metaLine(data.item);
      if (data.item.원문링크) {
        const link = document.getElementById('notice-link');
        link.href = data.item.원문링크;
        document.getElementById('notice-link-wrap').style.display = 'block';
      }
    }
    bodyEl.innerHTML = renderAnalysisBody(data);
  } catch (e) {
    bodyEl.innerHTML = '<div class="empty-note">분석 실패: ' + e.message + '</div>';
  }
}

init();
