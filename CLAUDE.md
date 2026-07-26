# CLAUDE.md

이 프로젝트에 대해 Claude Code가 알아야 할 내용을 적어두는 곳입니다.

> **먼저 `PROJECT_STATE.md`를 읽으세요.** 데이터 파이프라인/통계 모델/웹앱 아키텍처/현재 미해결 이슈를 한 번에 파악할 수 있는 종합 스냅샷입니다. 이 파일(`CLAUDE.md`)은 짧은 포인터 위주이고, 세부 시행착오 이력은 `PROGRESS.md`에 세션별로 있습니다.

## 프로젝트 개요

(주)케이알에스건설이 보유한 면허(지반조성포장/토공, 상하수도설비)를 기준으로, 공공 토목공사 입찰에서 낙찰 확률이 높은 입찰가(사정율/투찰률)를 추정하는 분석 프로젝트입니다. 아이건설넷(igunsul.net)의 과거 낙찰 데이터와 우리 회사의 시공능력평가액·신용등급·재무비율을 결합해 "이번 공고에 얼마로 투찰해야 낙찰 확률이 높은가"에 답하는 것이 최종 목표입니다.

## 발주처(회사) 정보

- 상호: (주)케이알에스건설 / 대표자: 박지선
- 사업자등록번호: 515-81-31362 / 법인번호: 174811-0043474
- 소재지: 부산광역시 수영구 광일로29번길 25 (광안동)
- 보유 면허(업종): 지반조성포장(토공), 상하수도설비

## 데이터 소스 및 제약사항

- **아이건설넷 접근 규칙 (2026-07-25 개정)**: "전면 금지"는 해제. 아이건설넷은 사용자 본인이 정식 구독한 계정이고 데이터도 사용자 권한 내 자료이므로, 접근이 필요하면 **① 무엇을 어떻게 시도할지 사용자에게 먼저 확인받고 ② 대량 데이터 수집은 두 번 확인받은 뒤** 진행한다(무단 진행 금지). 접근은 **실제 브라우저 + 정상 로그인 + 사람이 쓰는 수준의 정상 속도**로만 한다. **단, 봇탐지를 속이기 위한 정교한 스텔스/시그널 위조(navigator.webdriver 패치, 탐지 회피 목적의 가짜 마우스 궤적 등)는 하지 않는다** — 정상 접근이 탐지로 막히면 수동 캡처 또는 나라장터 공식 API로 폴백한다. (2026-07-19 자동화 감지 팝업 경위는 `PROJECT_STATE.md` 5.5장.)
- 과거 낙찰 이력(`data/raw/*.csv`, 최근 3년치, 부산+경남)은 중단 이전에 이미 수집된 것이라 계속 사용 가능. 문제가 된 건 "진행중 입찰"/"맞춤정보"를 실시간으로 긁어오던 로그인 세션 부분뿐.
- **신규 데이터 소스로 전환 완료: 나라장터(www.g2b.go.kr) OpenAPI** (2026-07-19). `webapp/lib/g2b.js`가 조달청_나라장터 입찰공고정보서비스(`getBidPblancListInfoCnstwk`)를 호출해 부산·경남 + 토공/지반조성포장·상하수도설비 관련 공고만 필터링, 기존 `data/open_bids.json`/`mybid_list.json` 캐시 포맷 그대로 채운다. **중요**: 이 API는 curl로 호출하면 data.go.kr WAF가 403을 반환하지만 Node 내장 `fetch`로는 정상 동작함 — 반드시 fetch 사용. 인증키는 `webapp/g2b.local.md`(gitignore). 상세는 `PROJECT_STATE.md` 5.6장 참고.

## 분석 철학 및 버전 체계 (2026-07-25 개정)

- **"사실 기반만" → "복합 요소 기반 확률 추론"으로 전환.** 이 프로젝트는 예측 시스템이다. 검증된 사실·평균만 쓰는 소극적 분석에 머물지 말고, **입찰 과정·결과의 유사 패턴/특이 패턴, 데이터 변화, 투찰에 반영 가능한 복합 요소를 적극 발굴·결합해 낙찰 확률을 높이는 추론**을 지향한다. (단, 지켜야 할 선: **데이터를 지어내지 않는다. 검증 안 된 추론을 검증된 사실처럼 단정하지 않는다** — 신호는 적극 쓰되, 검증 상태는 투명하게 표시한다. 이건 정직성의 문제이지 소극성의 이유가 아니다.)
- **버전 체계**:
  - **Version_1** = 지금까지 만든 검증 중심 모델(기초금액 기준, AI최종 가중중앙값 예정가격 예측, 예정가격 확률분포, A값 계산기 등). 대시보드에서 기존 "NEW" 아이콘을 **`Version_1`** 로 표기.
  - **Version_2** = 복합 요소 기반 확률 추론 모델(예상 경쟁강도 예측, 발주처·공사종류별 낙찰 패턴, 유사/특이 패턴 반영 등으로 낙찰 확률을 끌어올리는 추론). 대시보드에서 **`Version_2`** 아이콘으로 표기.
  - **★ AI최종 = Version_2** (2026-07-26 확정). "가장 낙찰 확률 높은 최종 사용 버전"은 Version_2 — 예정가격 예측(V1)은 준-랜덤이라 아무리 정확해도 낙찰률을 못 올리지만(MAE ~0.58% 한계), V2의 경쟁강도 선별이 낙찰률을 최대 8.6배 올림(실측). V2는 V1의 정밀 가격계산 위에서 동작(계층 관계). 대시보드 `AI최종`+`Version_2` 배지 병기.

## 최종 버전 구조 (bid-agent 참고)

> **전체 구조·함수·API·수치·자동화는 `PROJECT_STATE.md` 0장에 종합 정리됨 — 후속 에이전트는 거기부터 읽을 것.** 아래는 이번 세션 추가분 포인터만.

- **낙찰 가능성/전략 (신규)**: `lib/analysis.js`의 `computeWinProbability()`(사정률 2종 백테스트)·`computeV2Inference()`(공고별 V2 추론)·`computeV2Strategy()`(경쟁강도 세그먼트·저경쟁 니치)·`validateFullHistory()`(예정가격 4,157건 전수 LOO). CSV `예정가격사정률`/`일순위사정률` 파싱 추가. 상세는 `BIDDING_WIN_PROBABILITY.md`·`BIDDING_STRATEGY_GUIDE.md`.
- **탭 3개**: `index.html`(대시보드) / `win-probability.html`(낙찰가능성 V1 백테스트) / `win-probability-v2.html`(낙찰전략 V2). API: `/api/win-probability.json`·`/api/v2-strategy.json` (server.js·build-static.js·worker 공통, 파일 없으면 즉석 계산).
- **자동화 (신규)**: `.github/workflows/deploy.yml`(main push→자동 `wrangler deploy`, 검증 완료)·`refresh-bids.yml`(매일 07시 나라장터 스냅샷). Secrets: `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`·`G2B_SERVICE_KEY`. **이제 main 병합/푸시하면 자동 배포됨.**

## 회사 핵심 지표 (최신 확인서 기준)

`data/company-profile.md` 참고. 요약:
- 신용평가등급: C (2025-10-02 평가, 2026-07-31까지 유효) — 직전 B(2024-07-24) → CC(2025-07-03) → C로 하락 추세
- 부채비율 52.06%, 유동비율 712.06%
- 지반조성포장(토공) 시공능력평가액: 927,892천원
- 상하수도설비 시공능력평가액: 1,877,206천원

## 실행 방법

`webapp/` 폴더에 Node.js/Express 기반 로컬 대시보드 웹앱이 있습니다.

```
cd webapp
npm install                      # 최초 1회 (완료됨)
npx playwright install chromium  # 최초 1회 (완료됨)
npm start                        # http://localhost:4173
```

- `lib/analysis.js`: `data/raw/*.csv` 낙찰 이력을 로딩해 통계/입찰가 추천 모델 계산 (가중치·모델 정의는 PROGRESS.md 2026-07-04 세션3 참고). 경남 시/군 단위(관내 제한 추정) 발주처는 `lib/localFilter.js`로 전량 제외 (default-exclude/화이트리스트 방식 — 지명 문자열 겹침 버그 이력 있으니 새 화이트리스트 패턴 추가 시 PROGRESS.md 2026-07-05 기록 참고).
- **TOP5 우수 업체 분석** (2026-07-05 완성): 낙찰건수 10건 이상 업체 중 건수+낙찰률 종합순위 TOP5의 낙찰이력을 대시보드 하단에 표시 (`getTopCompanies`/`predictCompanyBid` in `lib/analysis.js`). 이 TOP5 업체의 예측 입찰가는 별도 섹션이 아니라 "맞춤정보"/"진행중 입찰" 리스트의 항목별 클릭-상세패널 안에 함께 표시됨.
- **맞춤정보 리스트** (2026-07-05 추가): 아이건설넷 `/mybid`(계정에 저장된 검색조건 기준 자동매칭 목록)를 `lib/scraper.js`의 `scrapeMyBidList()`로 함께 스크래핑, `data/mybid_list.json`에 캐시(gitignore). "진행중 입찰 항목" 바로 위에 표시되며 동일한 클릭-상세분석 UI 공유.
- `lib/scraper.js`: 아이건설넷 로그인 + 진행중 입찰(`/bid`) 실시간 스크래핑 코드 — **더 이상 어디서도 호출되지 않음** (2026-07-19 중단). 참고용으로만 남겨둠. `readCachedOpenBids()`/`readCachedMyBidList()`(순수 캐시파일 읽기 함수)만 계속 재사용됨.
- `lib/g2b.js`: 나라장터 OpenAPI 기반 진행중 입찰 수집(위 참고). `/api/open-bids/refresh` 클릭 시 호출됨.
- `public/`: 바닐라 JS + 손수 작성 SVG 차트 대시보드. `analysis-render.js`(공용 렌더 함수)가 `app.js`/`analysis.js` 양쪽에서 쓰임 — `index.html`/`analysis.html` 모두 `app.js`/`analysis.js`보다 먼저 로드해야 함.
- **공고별 분석 새 탭** (2026-07-19): "진행중 입찰 항목" 카드를 클릭하면 `analysis.html?id={posting_id}`가 새 탭으로 열림(`window.open`). "맞춤정보 등록 항목"은 기존처럼 인라인 확장 유지. 두 경로 모두 `/api/analysis/:postingId`를 공유.
- **맞춤정보 재정의** (2026-07-19): 로그인 계정 저장검색 개념이 사라져서, "기초금액(추정가격)이 해당 업종 시공능력평가액 이하인 진행중 입찰"로 재정의(`lib/g2b.js`의 `fitsCapacity()`). 즉 "실제로 수주 가능한 규모"의 공고만 모음.
- **기초금액 기준 정립 + 복수예비가격 예정가격 분포 + A값 투찰금액** (2026-07-23, `BIDDING_PRICE_METHOD.md` + `PROJECT_STATE.md` 5.8장): 실제 입찰은 기초금액(부가세 포함)에서 난수 15개 복수예비가격→다빈도 4개 평균=예정가격→(예정가격−A값)×낙찰하한율+A값=투찰금액 순. 반영 3건 — (1) 나라장터가 추정가격(부가세 제외)만 주므로 `lib/g2b.js`에서 **기초금액=추정가격×1.1**로 복원(과거이력 94.7%가 정확히 1.1). 추정가격 그대로 쓰던 ~10% 괴리 제거. (2) `lib/analysis.js` `computeJeonggaDistribution()`로 `recommendBid` 반환에 `예정가격분포`(P10~P90) 추가. (3) `computeTuchalAmount()` 순수함수 + 상세분석 A값 투찰금액 계산기(`analysis-render.js`).
- **카테고리 편차 반영 모델** (2026-07-19): `lib/analysis.js`의 `recommendBid(기초금액, 대업종, {종목, 발주처})` — 세부 종목 태그(CSV의 `종목` 컬럼, 처음 활용됨)와 발주처 단위로 낙찰률이 대업종 평균에서 얼마나 벗어나는지(표본 15건/8건 이상일 때만) 계산해서 tiers/전략밴드에 반영. 결과의 `appliedAdjustments` 필드로 UI에 표시됨.
- `data/open_bids.json`: 로컬 나라장터 캐시(로컬 "실시간 새로고침" 클릭 시 갱신). 배포 환경은 이 파일이 아니라 **KV**를 씀(아래).
- **완전 클라우드 자동 갱신 + 카카오 알림** (2026-07-19, `PROJECT_STATE.md` 5.7장): 배포된 Cloudflare Worker가 **매일 08시(KST) cron**으로 나라장터를 조회해 KV(`open_bids`/`mybid_list`/`analysis:{id}`)를 갱신하고, 이전 대비 신규 공고가 있으면 각 공고 분석 요약 + 리포트 링크를 **카카오톡으로 자동 발송**한다. 공용 lib(analysis/g2b/kakao/notifyMessage)는 fs 의존을 주입식으로 리팩터링해 로컬(server.js)·Worker가 공유. 과거 이력 CSV는 Worker 번들에 Text로 내장(`loadHistoryFromText`). 분석·요약은 순수 통계·문자열(=AI 토큰 0). 카카오 access_token은 run당 1회만 refresh. Windows 작업 스케줄러 `BidAnalysis-KakaoNotify`는 계속 비활성(클라우드 cron이 대체). `scripts/notify.js`도 계속 비활성.

## 참고 사항

- 신용등급이 하락 추세이므로, 입찰 가능 금액 산정 시 최신(C등급) 기준을 우선 적용할 것.
- 두 면허의 시공능력평가액은 별개로 관리 (업종별로 입찰 가능한 공사 규모가 다름).
