// 예정가격 AI 추론 예측 실험용 샘플 생성 스크립트.
// data/raw CSV 전체(로컬 필터 적용된 loadHistory() 결과)에서 층화추출로 100~200건을 뽑아
// - sample_features.json: AI가 볼 수 있는 필드만 (예정가격/낙찰금액/낙찰률/예가율/일순위업체 제외)
// - answers.json: 정답(실제 예정가격, 채점용 부가정보 포함) — 예측 중에는 열어보지 않을 것
// 두 파일로 나눠 저장한다. 재실행하면 샘플이 새로 뽑히므로, 이미 predictions.json이 쌓인 뒤에는
// 다시 실행하지 말 것.
const fs = require('fs');
const path = require('path');
const analysis = require('../lib/analysis');

const OUT_DIR = path.join(__dirname, '..', 'data', 'ai-prediction');
const TARGET_SAMPLE_SIZE = 150;

function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function amountBucket(기초금액) {
  if (기초금액 < 50_000_000) return '5천만 이하';
  if (기초금액 < 100_000_000) return '5천만~1억';
  if (기초금액 < 300_000_000) return '1억~3억';
  if (기초금액 < 500_000_000) return '3억~5억';
  if (기초금액 < 1_000_000_000) return '5억~10억';
  return '10억 초과';
}

function categoryGroup(r) {
  if (r.is포장군 && r.is상하수도군) return '중복';
  if (r.is포장군) return '포장';
  if (r.is상하수도군) return '상하수도';
  return '기타';
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rows = analysis.loadHistory().filter(r => r.기초금액 && r.예정가격);

  // 층화 키: 종목군 x 금액대 x 연차구분
  const strata = new Map();
  for (const r of rows) {
    const key = [categoryGroup(r), amountBucket(r.기초금액), r.연차구분].join('|');
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(r);
  }

  const strataKeys = Array.from(strata.keys());
  const totalRows = rows.length;
  const picked = [];
  for (const key of strataKeys) {
    const group = strata.get(key);
    const quota = Math.max(1, Math.round((group.length / totalRows) * TARGET_SAMPLE_SIZE));
    const shuffled = seededShuffle(group, key.length * 7919 + group.length);
    picked.push(...shuffled.slice(0, quota));
  }

  // 쿼터 반올림 때문에 목표치와 다를 수 있으니 목표치에 맞춰 자르거나 보충
  let finalPicked = picked;
  if (picked.length > TARGET_SAMPLE_SIZE) {
    finalPicked = seededShuffle(picked, 42).slice(0, TARGET_SAMPLE_SIZE);
  } else if (picked.length < TARGET_SAMPLE_SIZE) {
    const pickedIds = new Set(picked.map(r => r.posting_id));
    const remaining = rows.filter(r => !pickedIds.has(r.posting_id));
    const extra = seededShuffle(remaining, 99).slice(0, TARGET_SAMPLE_SIZE - picked.length);
    finalPicked = [...picked, ...extra];
  }

  const features = finalPicked.map(r => ({
    posting_id: r.posting_id,
    title: r.title,
    종목: r.종목,
    대업종: r.대업종,
    발주처: r.발주처,
    지역약칭: r.지역약칭,
    검색지역: r.검색지역,
    기초금액: r.기초금액,
    참여업체수: r.참여업체수,
    개찰일: r.개찰일 ? r.개찰일.toISOString().slice(0, 10) : null,
    연차구분: r.연차구분,
  }));

  const answers = finalPicked.map(r => ({
    posting_id: r.posting_id,
    기초금액: r.기초금액,
    예정가격: r.예정가격,
    예가율: r.예가율,
    일순위금액: r.일순위금액,
    일순위업체: r.일순위업체,
    낙찰률: r.낙찰률,
  }));

  fs.writeFileSync(path.join(OUT_DIR, 'sample_features.json'), JSON.stringify(features, null, 1), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'answers.json'), JSON.stringify(answers, null, 1), 'utf8');
  if (!fs.existsSync(path.join(OUT_DIR, 'predictions.json'))) {
    fs.writeFileSync(path.join(OUT_DIR, 'predictions.json'), '[]', 'utf8');
  }

  console.log(`샘플 ${finalPicked.length}건 생성 완료 (전체 ${totalRows}건 중, 층화 ${strataKeys.length}개 그룹).`);
  console.log(`- sample_features.json: AI 예측용 (정답 없음)`);
  console.log(`- answers.json: 정답 (채점 전까지 열람 금지)`);
}

main();
