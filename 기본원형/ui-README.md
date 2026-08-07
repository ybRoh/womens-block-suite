# ui.html / ui.css / ui.js — 인수인계 노트 (디자인팀)

기본 무다트 원형 앱의 **화면**만 담당합니다. `engine.js` · `print.js` · `print.css` 는 건드리지 않았습니다.

## 통합 방법 (순서 중요)

```html
<head>
  <style> ui.css </style>
  <style> print.css </style>   <!-- ui.css 뒤. 인쇄 규칙은 print.css 가 이겨야 함 -->
</head>
<body>
  ui.html                        <!-- 루트가 2개: .app 과 #ndp-print-area -->
  <script> engine.js </script>   <!-- ui.js 보다 먼저 -->
  <script> print.js  </script>
  <script> ui.js     </script>   <!-- 마지막 -->
</body>
```

### ★ `#ndp-print-area` 는 반드시 `body` 직속
`print.css` 의 `@media print { body > *:not(#ndp-print-area){display:none!important} }` 때문에
인쇄 컨테이너가 다른 요소 안에 들어가면 **인쇄가 빈 종이로 나옵니다** (SPEC §8.1).
`ui.html` 은 `.app` 과 `#ndp-print-area` 를 형제로 두고 있으니 **통합 시 앱 전체를 wrapper 로 감싸지 마세요.**
`ui.js` 는 init 때 부모를 확인해 body 직속이 아니면 경고를 찍고 body 로 옮깁니다(보험).

`ui.css` 에는 `@media print` 블록이 **없습니다.** 추가하지 마세요 — 위 규칙과 충돌합니다.
(`#ndp-print-area{display:none}` 한 줄만 있고, print.css 의 같은 규칙과 중복돼도 무해합니다.)

## 엔진 / 출력 모듈 연동

### 제도
```js
window.NoDartEngine.measuresForSize(size)   // 표준 치수 — ★ 유일한 출처
window.NoDartEngine.draftNoDart(m, {
  seam, shoulderEase, capReduce, sleeveLen, size
})
```
- **이 파일에는 SPEC §2 치수표 사본이 없습니다.** 표준값은 항상 `measuresForSize()` 에서 읽습니다.
- **소매길이(`sleeveLen`)는 measurements 가 아니라 opt 입니다.** 엔진의 `measuresForSize()` 에 없으므로,
  UI 는 `sleeveLen` 을 뺀 채 한 번 제도해서 엔진이 스스로 만든 기본값(`measures.sleeveLen`)을 읽어
  입력란 표준값으로 씁니다 (`probeEngineDefault`). **숫자 사본 없음** — 55/66/77 = 24.5/25.0/25.5 전부 엔진 값입니다.
- `splitMeasures()` 가 `state.m` 을 `NoDartEngine.MEAS_KEYS` 기준으로 나눠 measurements 와 opt 로 보냅니다.
  엔진이 나중에 `sleeveLen` 을 `MEAS_KEYS` 에 편입해도 UI 수정 없이 그대로 동작합니다.
- **엔진이 없거나 예외를 던지면 그리지 않습니다.** 캔버스에 "제도 엔진이 없습니다 + 사유"를 띄우고
  인쇄 버튼을 비활성화합니다. (구버전에 있던 목업 제도 170줄은 삭제했습니다.)

### 인쇄
```js
var layout = NoDartPrint.buildPrintLayout(draft, opt);
NoDartPrint.applyPageCss(layout);          // ★ 롤지 @page 크기 주입 — 빼먹으면 A4 로 잘림
NoDartPrint.renderTo(layout, #ndp-print-area);
requestAnimationFrame(window.print);
```
`applyPageCss` 가 없는 print.js 버전이면 콘솔 경고를 찍고 진행합니다.
`renderTo` 가 없으면 `.ndp-page` div 를 직접 만들어 넣는 폴백이 있습니다.
`layout.info.warnings` 는 토스트와 콘솔에 함께 보여줍니다.
`opt` 로 넘기는 것: `mode · rollWidthMm · overlapMm · seam · calibMm · title`.

## Draft 사용 범위

| 필드 | 용도 |
|---|---|
| `pieces[].id / name / cutCount` | 라벨·조각 카드 |
| `pieces[].outline` | 완성선 (`Z` 로 닫아 그림) |
| `pieces[].seamline` | 시접선(파선). `seam=0` 이면 표시 안 함 |
| `pieces[].foldEdges` | **골선** — `[[startIdx,endIdx],…]` 구간을 초록 일점쇄선 + "골선" 라벨로 표시. `[]` 면 아무것도 그리지 않음 (소매) |
| `pieces[].internal[]` | 기준선·BP. `label` 은 `치수선` 토글에 묶임. 13자 넘으면 줄이고 `<title>` 툴팁 + `계산식 주석` 켜면 전문 |
| `pieces[].notches[]` | `angle`(도, 0°=+x, 시계+, 안쪽)이 있으면 그 방향 0.5cm 선, 없으면 X 마크 |
| `pieces[].grainline` · `bbox` | 식서 화살표 / 조각 배치·치수선 |
| `measures.*` | 우측 요약 (아래 표) |
| `meta.formulaNotes[]` | `계산식 주석` 토글 |

`formulaNotes` 는 SPEC §8.1 구조 `{id,label,formula,value,piece,anchor}` 를 기본으로 읽고,
구버전 `{p,text}` 와 문자열도 계속 받습니다.

### 요약에서 읽는 measures 키
`shoulderBack/Front/Ease`, `shoulderBackSeam/FrontSeam`(§9-3 1차검사),
`armholeBack/Front/Total`, `neckBack/Front/Total`, `sideBack/Front`,
소매는 `capHeight` · `sleeveWidth` · `sleeveHemWidth` · `sleeveCapLenTotal` · `sleeveCapEase`.
소매 키는 SPEC §8 에 명시가 없어 **후보 이름 여러 개를 순서대로 찾는 방식**(`pick()`)으로 읽습니다.
§8 에 확정 표기를 넣어 주시면 후보 목록을 지우겠습니다.

**좌표는 cm 그대로.** 조각 좌표를 변형하지 않고 화면 배치는 `translate()` 오프셋(조각 간격 8cm)으로만 처리합니다.
확대/축소는 `#ndWorld` 그룹의 `scale()`, 선폭은 `vector-effect:non-scaling-stroke`,
글자는 그룹 `font-size = 12/scale` + `em` 으로 배율을 상쇄합니다.

## 화면 구성

| 요구 | 위치 |
|---|---|
| 44/55/66/77호 탭 | 상단 바. `measuresForSize()` 가 실제로 받아주는 호수만 가슴둘레 순으로 자동 생성 (단축키 1~4) |
| 치수 편집 | 좌측 — 엔진 치수 키로 자동 생성. 현재 7개 + `소매길이` = 8개. **앞길이·AH 입력란 없음** |
| 표준값 복원 | 좌측. 표준과 다르면 행 주황 + 차이값, 상단 배지 `사용자 지정` |
| 소매산 이세 조절 (`capReduce`) | 좌측 슬라이더 0~1, 0.1 단위, 기본 **0** |
| 부위별 시접 | 좌측 — 프리셋 3종(시접없음·표준·균일1.0) + role 6칸 입력. 골선은 항상 0(입력란 없음). 아래에 **엔진 적용값** 표시 |
| 출력 모드 · 용지폭 · 겹침 · 인쇄 보정 | 좌측 (모드에 따라 관련 행만 노출) |
| SVG 미리보기 | 중앙. 드래그 이동 · 커서기준 휠 확대 · 더블클릭 맞춤 · `F` `+` `-` |
| 치수선 / 계산식 주석 토글 | 중앙 툴바 칩 (+ 시접선·너치·기준선·모눈) |
| 계산 결과 요약 | 우측 (≤1100px 에서는 도면 아래로) |
| 인쇄 + 1:1 주의 | 좌측 하단 |

### 경고 표시
- **옆선 < 14.5cm** (SPEC §9-5) → 옆선 값 빨강 + 빨간 경고 박스 "진동이 깊습니다 — 등길이 치수를 확인하세요"
  + 정합성 목록에 항목 추가. 표준 77호(14.00)가 여기에 걸립니다.
- **소매산 이세분** (SPEC §3.4) → `<0.5 또는 >2.5` 빨강 / `0.5~1.0` 주황 / `1.0~2.5` 초록,
  주황·빨강일 때 경고 박스에 조치 안내.
- 어깨 이세분 0.6~1.0, 실제 어깨 솔기 차 ≤0.10, 앞뒤 옆선 일치도 정합성 목록에 표시.

## 공개 API — `window.NoDartUI`

```js
NoDartUI.refresh(refit)      // 강제 재제도
NoDartUI.setSize('77호')
NoDartUI.setSeam(1.5)
NoDartUI.setCapReduce(0.3)
NoDartUI.setMeasure('sleeveLen', 27)
NoDartUI.fit() / NoDartUI.print() / NoDartUI.toast(msg)
NoDartUI.getState()          // {size,custom,measures,seam,capReduce,printMode,rollWidthMm,overlapMm,calibMm,engineOk,lastError,zoom}
NoDartUI.getDraft()
NoDartUI.easeGrade(v)        // 'pass'|'warn'|'fail'|null
NoDartUI.SIDE_WARN_CM        // 14.5
```


## SPEC §11 대응 (2026-08-07)

### §11-1 부위별 시접
- 좌측 패널을 `0/1.0/1.5` 세그먼트에서 **프리셋 3종 + role 6칸 입력**으로 교체했습니다.
  프리셋: `시접 없음`(전부 0) · `표준`(기본) · `균일 1.0`. 값을 직접 고치면 프리셋 배지가 `사용자 지정`으로 바뀝니다.
- **role 목록과 기본 수치는 전부 엔진에서 읽습니다** — `NoDartEngine.SEAM_ROLES` / `SEAM_DEFAULT`.
  둘 다 없으면 `seam:{}` 로 한 번 제도해 되돌아오는 `piece.seamByRole` 을 읽고, 그것도 없을 때만
  `SEAM_FALLBACK` 을 씁니다. (엔진이 값을 주는 지금은 fallback 이 쓰이지 않습니다.)
- `opt.seam` 은 **객체**로 넘깁니다. `fold` 는 UI 가 항상 0으로 덮어씁니다
  (`NoDartUI.setSeam({fold:2})` 를 호출해도 엔진 적용값은 0 — 실측 확인).
- **입력값을 믿지 않고 엔진 적용값을 표시합니다.** 시접 섹션 아래 "엔진 적용값" 상자가
  `piece.seamByRole`(없으면 `edges[].seam`)을 그대로 보여주고, 요청값과 다르면 빨간 `(요청 x.x)` 로 표시합니다.
  엔진이 둘 다 안 주면 "요청값이며 실제 적용 여부는 확인되지 않았습니다"라고 명시합니다.
- 하단 상태바 범례에 부위별 폭 요약(`1.0/1.0/1.0/1.5/3.0/2.5, 골선 0`)을 넣었습니다.
- **미리보기 bbox 를 `outline ∪ seamline` 합집합으로 바꿨습니다.** 밑단 3.0 처럼 큰 시접이 있으면
  `piece.bbox`(=outline 기준)만 쓰면 시접선이 잘립니다. 조각 간격·화면맞춤 모두 이 합집합을 씁니다.
- 인쇄: print.js 가 `normalizeSeamOpt`/`SEAM_DEFAULTS` 를 노출하면 객체를 그대로 넘기고,
  숫자만 받는 구버전이면 최댓값을 넘깁니다.

### §11-2 라벨 충돌 회피
`renderSvg()` 가 라벨을 바로 찍지 않고 수집한 뒤 `placeLabels()` 가 화면 px 공간에서 배치합니다.
- 배치된 라벨 사각형과 겹침 검사 → 겹치면 수직으로 밀어냄. `0 → ±1 → ±2 → ±3` **3라운드**.
- 글자 폭은 canvas `measureText` 로 실측(캐시). canvas 가 없는 환경(jsdom)은 한글 1.0em/그 외 0.55em 근사.
- 비용 함수: 라벨 겹침 ×10, 고정요소(조각 배지·치수 글자·골선 라벨) 겹침 ×6,
  **인접 조각 영역 ×0.02(약한 벌점 — 피할 수 있으면 피하되 그 때문에 숨기지는 않음)**, 이동거리 ×0.6.
- 밀려난 라벨은 **얇은 회색 지시선**(`.leader`)으로 앵커점과 연결하고 앵커에 점을 찍습니다.
- 3라운드로도 자리가 없으면 숨기고 **호버 시에만 표시** — 앵커에 회색 점 + `<title>` 툴팁 +
  hover 시 흰 배경 박스와 함께 글자가 뜹니다(`.lblhide`).
- **배율이 바뀌면 재배치합니다.** 글자 크기가 `12/scale` 고정이라 축소하면 겹침이 급증하기 때문입니다.
  `zoomAt()` 은 즉시 `applyTransform()` 만 하고(부드럽게), **90ms 디바운스 후 `renderSvg()`** 로 재배치합니다.
- 검증용 API: `NoDartUI.labelStats()` → `{total, placed, displaced, hidden, overlaps}`,
  `NoDartUI.setCollisionAvoidance(false)` 로 회피 전/후 비교.

### §11-3 44호
호수 탭을 `measuresForSize()` 가 실제로 받아주는 이름만 골라 가슴둘레 오름차순으로 만듭니다
(후보: 44·55·66·77·88호). **숫자는 UI 에 없습니다** — 44호 치수 75.6/36.5/37.9/34.4/31.9/23.8/18.0 은
전부 엔진에서 읽은 값이고 SPEC §11-3 표와 일치함을 실측 확인했습니다.
엔진이 88호를 추가하면 탭이 저절로 5개가 됩니다.

---

## 실제로 확인한 것 (스크래치패드 임시 파일, `pattern-Pro/` 에는 남기지 않음)

`ui.css + print.css + ui.html + engine.js + print.js + ui.js` 를 합쳐 브라우저에서 실행.

- **콘솔 에러/경고 0건** (엔진·출력 모듈 정상 로드 시).
- **결함 1 (인쇄 빈 종이)** — DOM 과 CSSOM 으로 판정:
  - `#ndp-print-area.parentNode === BODY`
  - `#ndp-print-area.matches('body > *:not(#ndp-print-area)')` → **false** (숨김 규칙에 안 걸림)
  - `.app.matches(...)` → **true** (정상적으로 숨겨짐)
  - `@media print` 안에서 `.app` 을 건드리는 ui.css 규칙 수 = **0**
- **결함 2 (롤지 잘림)** — `NoDartPrint.applyPageCss` 호출 후 `<style id="ndp-page-size">` 내용:
  - A4 → `@page{size:210mm 297mm;margin:0}` · 11장 · 첫 장 `width:210mm;height:296.9mm`
  - 롤 → `@page{size:594mm 918.17mm;margin:0}` · 1장 · 첫 장 `width:594mm;height:918.073mm`
  - `window.print()` 실제 호출 확인 (스텁으로 카운트 2회).
  - **실제 종이 출력의 1:1 여부는 확인하지 못했습니다.** 브라우저 인쇄 대화상자까지만 확인했고,
    자로 재는 검증은 출력팀/QA팀 몫입니다.
- **결함 3 (§9-5 옆선 경고)** — 55호 16.00 / 66호 15.00 / 77호 **14.00 → 경고 ON**, 값 빨강, 정합성 목록 항목 추가.
- **3조각 렌더** — 전 호수에서 `back / front / sleeve` 3개. 소매길이 24.5 / 25.0 / 25.5 (전부 엔진 값).
  골선 path 2개(뒷판·앞판)만 그려지고 **소매는 `foldEdges: []` 라 0개**, 조각 카드에 "골선 없음" 표기.
- **이세분 색상** — capReduce 0→1 스윕:
  | capReduce | 이세분 | 판정 | 표시 |
  |---|---|---|---|
  | 0.0 | 2.00 | PASS | 초록 ✓ |
  | 0.3 | 1.47 | PASS | 초록 ✓ |
  | 0.5 | 1.12 | PASS | 초록 ✓ |
  | 0.7 | 0.77 | WARN | 주황 ! + 경고 박스 |
  | 1.0 | 0.25 | FAIL | 빨강 ! + 빨간 경고 박스 |
- 시접 0 / 1.0 / 1.5 전환, 호수 탭, 치수 편집, 확대/축소/이동, 표시 토글 6종, 1180·1140·570px 폭.
- **엔진 없는 경우** — 배지 `엔진 없음`, 캔버스에 사유 표시, 인쇄 버튼 비활성, 콘솔 에러 0건.

### 이번에 같이 고친 것 (자체 발견)
`hidden` 속성이 먹지 않고 있었습니다. `.field{display:flex}` · `.canvas-empty{display:flex}` 가
UA 의 `[hidden]{display:none}` 을 이겨서, **A4 모드인데 "용지 폭" 행이 계속 보이고**
**도면 위에 "엔진 없음" 오버레이가 항상 덮여 있었습니다.** `ui.css` 최상단에
`[hidden]{display:none !important}` 를 넣어 해결했습니다.

---

## SPEC §11 검증 결과 (2026-08-07, 브라우저 실측)

빌드: `ui.css + print.css + ui.html + engine.js + print.js + ui.js` (스크래치패드 임시 파일).
겹침 수치는 내부 모델이 아니라 **렌더된 `<text>` 의 `getBoundingClientRect()` 를 직접 재서** 셌습니다.

### 라벨 충돌 (뷰포트 1400×880, 화면맞춤)
| | 보이는 라벨 | **겹침 쌍** | 호버전용 | 지시선 |
|---|---|---|---|---|
| 회피 OFF (기존 동작) | 50 | **61** | 0 | 0 |
| 회피 ON (§11-2) | 48 | **0** | 2 | 33 |

OFF 일 때 겹치던 쌍 예: `뒷목너비 ↔ 뒷목 올림` · `뒷목너비 ↔ SNP` · `뒷목너비 ↔ 목옆점 연장` ·
`뒷목너비 ↔ 뒷목둘레` — 사용자가 지목한 조각 상단 y≈0 클러스터 그대로입니다.

배율별 (회피 ON):
| 배율 | 겹침 (OFF→ON) | 표시/전체 | 숨김 |
|---|---|---|---|
| 19% (화면맞춤) | 62 → **0** | 48/50 | 2 |
| 30% | 43 → **0** | 49/50 | 1 |
| 47% | 40 → **0** | 50/50 | 0 |
| 74% | 39 → **0** | 50/50 | 0 |
| 115% | 33 → **0** | 50/50 | 0 |

4호수 × 3프리셋 = 12조합 전수 (화면맞춤):
**11조합 겹침 0**, 1조합(`66호 × 시접없음`)만 겹침 1쌍 (`어깨선 ↔ 어깨선 연장`).
그 1건은 숨기는 대신 1px 남짓 스치도록 둔 결과입니다(숨김보다 낫다고 판단).
4% 까지 축소해도 겹침 0 · 호버전용 18개로 유지됩니다.

### 4호수 전환 (치수는 전부 엔진 값)
| 호수 | 치수 (B/등길이/어깨/등품/앞품/유장/유폭/소매길이) | 조각 | 옆선 | 이세분 | 전체 |
|---|---|---|---|---|---|
| 44호 | 75.6/36.5/37.9/34.4/31.9/23.8/18.0/24.0 | 3 | 17.0 | 1.79 | 95.1×44.0 |
| 55호 | 81.6/37.0/38.7/35.6/33.1/24.3/18.5/24.5 | 3 | 16.0 | 1.90 | 101.3×44.4 |
| 66호 | 87.6/37.5/39.5/36.8/34.3/24.8/19.0/25.0 | 3 | 15.0 | 2.00 | 107.6×44.9 |
| 77호 | 93.6/38.0/40.3/38.0/35.5/25.3/19.5/25.5 | 3 | 14.0 | 2.11 | 114.0×45.4 |

SPEC §11-3 표와 전부 일치. 44호 옆선 17.0 — 경고 임계(14.0) 위라 경고 없음 ✓

### 부위별 시접
| 프리셋 | 입력 | 엔진 적용 (`piece.seamByRole`) | 전체 크기 |
|---|---|---|---|
| 시접 없음 | 0/0/0/0/0/0 | 전부 0 | 101.5×40.6 |
| 표준 | 1.0/1.0/1.0/1.5/3.0/2.5 | 동일 | 107.6×44.9 |
| 균일 1.0 | 1.0×6 | 동일 | 105.7×42.9 |
| 사용자 지정(밑단 5.0) | hem=5.0 | hem 5.0 반영, 배지 `사용자 지정` | — |

- `NoDartUI.setSeam({fold:2.0})` → 엔진 적용 `fold = 0` (강제 확인 ✓)
- 시접이 커질수록 전체 bbox 가 커지고(40.6 → 44.9cm) 화면맞춤이 따라갑니다 — 밑단 3.0 잘림 없음 ✓

### 인쇄
- A4 11장 `@page{size:210mm 297mm;margin:0}` / 롤 1장 `@page{size:594mm 950.64mm;margin:0}`
- `#ndp-print-area` body 직속 유지 ✓, `window.print()` 실제 호출 확인
- `opt.seam` 을 객체로 넘기도록 고친 뒤 print.js 경고 **18건 → 3건**

### 콘솔
새 탭에서 새로 로드 → **에러·경고 0건**. (인쇄를 실행하면 print.js 경고 3건을 의도적으로 `console.warn` 합니다.)

---

## SPEC / 다른 팀에 남기는 의견

1. **print.js 경고 3건이 남아 있습니다 (엔진↔출력 계약 문제, UI 아님).**
   `조각 "뒷판": edges[] 가 outline 변 6/3077개를 덮지 않음 — 그 구간은 최대 시접(3cm)으로 처리`
   (앞판 6/2951, 소매 7/2708 동일). 엔진의 `edges[]` role 구간이 outline 정점을 전부 덮지 않아
   print.js 가 남는 변에 최대 시접을 적용하고 있습니다. 밑단 3.0 이 엉뚱한 변에 붙을 수 있으니
   개발팀·출력팀이 맞춰 주세요.
2. **SPEC §8 Draft 구조에 §11-1 필드가 아직 반영돼 있지 않습니다.**
   엔진은 이미 `piece.seamByRole` · `piece.edges[].role/seam` · `piece.seamEdges` · `piece.seamFoldEdges` 를
   내보내고 `SEAM_ROLES` / `SEAM_DEFAULT` 도 노출하는데, §8 코드블록에는 없습니다. 문서화 필요.
3. **소매 `measures` 키도 여전히 §8 에 없습니다.** 현재 `capHeight` / `sleeveWidth` / `sleeveHemWidth` /
   `sleeveCapLenTotal` / `sleeveCapEase`. UI 는 후보 이름을 훑어 읽는 중입니다.
4. **`sleeveLen` 이 measurements 가 아니라 opt** 인 점도 §8 에 없습니다. UI 는 표준값을 얻으려고
   엔진을 한 번 더 호출합니다(`measures.sleeveLen` 역참조). `measuresForSize` 가 포함해 주면 사라집니다.
5. **§11-2 "인접 조각과 겹치지 않게" 는 약한 벌점으로만 구현했습니다.** 하드 금지로 하면
   조각 오른쪽 끝 라벨이 전부 숨겨져 오히려 못 읽게 됩니다. 조각 간격이 8cm 라 실제 침범은
   거의 없고, 침범하더라도 그 때문에 라벨을 버리지는 않도록 했습니다.
6. **라벨이 많습니다(조각 3개에 50개).** 회피로 읽히게는 했지만, 낮은 배율에서는 일부가
   호버 전용으로 내려갑니다. 엔진 `internal[].label` 중 도면에 꼭 필요하지 않은 항목
   (예: 보조 대각선·마크류)을 `formulaNotes` 로 옮기면 화면이 훨씬 편해집니다.
