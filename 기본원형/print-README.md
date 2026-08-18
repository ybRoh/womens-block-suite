# print.js / print.css — 출력팀 인수인계

기본 무다트 원형(문화식)의 **1:1 실물 크기 출력** 담당. SPEC.md §6 · §8 구현.

| 파일 | 역할 |
|---|---|
| `print.js` | 출력 레이아웃 엔진. `window.NoDartPrint` 로 노출 |
| `print.css` | `@page` / `@media print` 규칙, 화면 미리보기 스타일 |
| `print-verify.js` | 수치 검산 (`node print-verify.js`) |

외부 라이브러리·CDN·ES module 없음. 단일 HTML 인라인 통합 가능
(`typeof module` 가드가 있어 node/브라우저 양쪽에서 로드됨).

---

## 1. API

```js
const layout = window.NoDartPrint.buildPrintLayout(draft, opt);
// → { pagesSvg: string[], layoutPreviewSvg: string, pageCount: number, info: {...} }
```

`draft` 는 SPEC §8 의 Draft 객체 그대로. **좌표는 cm**, mm 변환은 print.js 안에서만 한다.

### opt (전부 선택, 괄호는 기본값)

| 키 | 기본 | 설명 |
|---|---|---|
| `mode` | `'a4'` | `'a4'` 타일 / `'roll'` 롤지 한 장 |
| `seamLabels` | `true` | 시접선 위에 부위별 폭 병기(공간 되는 구간만) |
| `rollWidthMm` | `594` | 롤 폭. A1=594, 광폭=914 |
| `overlapMm` | `10` | A4 페이지 겹침 |
| `seam` | `0` | 시접. **숫자(균일 cm) / 0 / `{role: cm}` 부위별** — 아래 §3 |
| `calibMm` | `50` | **인쇄 보정** — 지난 인쇄물의 5cm 눈금을 자로 잰 값(mm) |
| `grid` | `'major'` | `false` / `'major'`(5cm) / `'full'`(1cm+5cm) |
| `allowRotate` | `true` | 네스팅 90° 회전 허용 |
| `overview` | `true` | A4 1페이지에 사용법 + 전체배치 축소도 |
| `title` | `''` | 페이지 하단 머리말 (호수·치수 요약 등) |
| `marginMm` `footerMm` `gapMm` `padMm` `maxCols` `rollMarginMm` | 8 / 16 / 12 / 4 / 8 / 15 | 레이아웃 미세조정 |

### 반환 `info` 주요 항목

`mode` `scaleFactor(k)` `cols` `rows` `tilePages` `overviewPages` `pageIds[][]`
`contentWidthMm/HeightMm`(declared) `worldContentWidthMm/HeightMm` `stepXMm/stepYMm`
`overlapMm` `coverage{wMm,hMm}` `canvas{wMm,hMm}` `calibration{worldMm,declaredMm}`
`placements[]`(조각별 x/y/w/h/rotated) `pieces[]`(bbox 대조·면적·너치수) `pageCss` `warnings[]`

> **`pageCount` = `overviewPages` + `tilePages`** 입니다. 타일 격자 장수만 필요하면 `info.tilePages` 를 쓰세요.

### 브라우저 헬퍼

```js
NoDartPrint.print(draft, opt);          // 빌드 → @page 주입 → #ndp-print-area 삽입 → window.print()
// 또는 단계별로
const L = NoDartPrint.buildPrintLayout(draft, opt);
NoDartPrint.applyPageCss(L);            // 롤지는 용지크기가 가변이라 필수
NoDartPrint.renderTo(L);                // #ndp-print-area 자동 생성
document.getElementById('preview').innerHTML = L.layoutPreviewSvg;
```

UI 쪽에서 필요한 것은 두 가지뿐입니다.
1. `print.css` 를 로드할 것 (인라인 통합 시 `<style>` 로 붙여넣기).
2. 인쇄 영역 `div#ndp-print-area` 는 `renderTo()` 가 없으면 만들어 줍니다. **`body` 직속**이어야 `@media print` 의 `body > *:not(#ndp-print-area){display:none}` 이 먹습니다.

---

## 2. 1:1 이 깨지지 않게 하는 구조

1. 페이지 SVG 는 `width="210mm" height="297mm" viewBox="0 0 210 297"` →
   **1 SVG user unit = 1 mm**. 상대 크기(`100%`)를 쓰면 즉시 깨지므로 print.css 가
   `.ndp-page > svg { position:absolute; max-width:none }` 로 눌러 둡니다.
2. `@page { size:210mm 297mm; margin:0 }` — `A4 portrait` 대신 실치수로 못 박습니다.
3. `.ndp-page` 높이를 용지보다 **0.1mm 작게** 넣습니다(`renderTo`). 브라우저 반올림으로
   빈 페이지가 끼는 것을 막기 위한 것이고, SVG 는 절대배치 + `overflow:hidden` 이라
   배율에는 영향이 없습니다.
4. 조각·모눈은 `translate(...) scale(k)` 그룹 안에만 들어가고, 클리핑은 **변환 없는 부모
   그룹**에 겁니다(SVG 의 clip-path 좌표계 혼동 회피).
5. 모든 페이지 하단에 **5cm 캘리브레이션 눈금**. 안내 페이지에는 5cm 정사각형도.

### 인쇄 보정(calibMm) 동작

프린터가 96% 로 줄여 찍으면 5cm 눈금이 48mm 로 나옵니다. 그 48을 `calibMm` 에 넣으면
`k = 50/48 = 1.0417` 이 되어 **world → declared 변환에 k 를 곱합니다.**
용지 크기(210×297mm)는 그대로, 페이지 한 장이 담는 패턴 폭만 194mm → 186.2mm 로 줄어듭니다.
눈금 자체도 52.08mm 로 커지므로 96% 축소 후 정확히 50.00mm 로 찍힙니다.
`calibMm` 이 30~70 범위 밖이면 무시하고 k=1 로 갑니다.

### 사용자에게 반드시 보여야 하는 경고

출력물(안내 페이지 + 모든 타일 하단)에 이미 들어 있지만, 화면에도 같은 문구를 띄우세요.
`print.css` 의 `.ndp-warn` 클래스를 쓰면 됩니다.

> 인쇄 배율 **100%(실제 크기)** · **"용지에 맞춤 / Fit to page" 반드시 해제** ·
> 여백 없음 · 머리글/바닥글 끄기. 뽑은 뒤 5cm 눈금을 자로 재서 50mm 인지 확인.

---

## 3. 부위별 시접 (SPEC §11-1)

`opt.seam` 은 세 형태를 받습니다. 셋 다 `fold` 는 **항상 0으로 강제**되며,
0 이 아닌 값을 주면 무시하고 경고합니다.

```js
opt.seam = 0                       // 시접 없음 (seamMode 'none')
opt.seam = 1.0                     // 전 부위 균일 (seamMode 'uniform') — 기존 동작 그대로
opt.seam = { neck:1.0, shoulder:1.0, armhole:1.0,
             side:1.5, hem:3.0, sleeveHem:2.5, fold:0 }   // 부위별 (seamMode 'perRole')
```

기본값: `neck/shoulder/armhole 1.0 · side 1.5 · hem 3.0 · sleeveHem 3.0 · fold 0`.
객체에서 빠진 부위는 이 기본값을 씁니다. 실제 적용값은 `info.seamByRole` 로 돌려줍니다.

### 시접선을 어디서 얻는가 — 3단계

| 단계 | 조건 | 동작 |
|---|---|---|
| **T1** | `seamline` + `seamFoldEdges`(또는 `seamEdges`) | 엔진 것 그대로 사용. 정답 경로 |
| **T2** | `seamline` 만 (구버전 엔진) | 그대로 쓰되 골선 구간을 **기하적으로** 판별 + 경고 |
| **T3** | `seamline` 없음 | `edges[].role` 로 **변마다 다른 폭** 오프셋을 자체 생성 + 경고 |

`info.pieces[].seamSource`(`'draft'`/`'computed'`)와 `seamTier` 로 어느 경로였는지 알 수 있습니다.
통합 완료 후에는 전부 `draft` / `T1` 이어야 정상입니다.

### 폭이 다른 두 변이 만나는 모서리

각 변을 자기 폭만큼 평행이동한 뒤 **이웃한 두 오프셋 직선의 교점**으로 잇습니다.
교점이 너무 멀면(miter limit 3배 초과) bevel 로 자르고, 오목 모서리에 생긴 국소 고리는
제거합니다(`info.pieces[].seamLoopsRemoved` / `seamSelfIntersections`).

- 66호 앞판 **옆선(1.5) ↔ 밑단(3.0)** = 완성선 (23.400, 38.500) → 시접선 **(24.900, 41.500)**
  (옆선 방향 +1.5000 / 밑단 방향 +3.0000, 편차 0.00000mm)
- 폭 0인 골선과 만나는 모서리는 교점이 골선 위에 떨어져 "골선 유지 + 시접만큼 연장"이 자동 성립.

### edges[] 경계 세그먼트 (주의)

`edges[]` 는 **점(point) 범위**입니다. `start..end` 가 덮는 세그먼트는 `start→start+1` …
`end-1→end` 이므로, **이웃한 두 변을 잇는 경계 세그먼트는 어느 변에도 속하지 않습니다**
(변 개수만큼 발생). 이건 자료구조의 성질이지 엔진 결함이 아니므로 경고하지 않고
**직전 변의 시접**으로 귀속시킵니다(직전이 골선이면 다음 변). 점 자체가 빠졌을 때만 경고합니다.

### 종이에 표기되는 것

- 조각 라벨: `시접  목 1 · 어깨 1 · 진동 1 · 옆선 1.5 · 밑단 3` (`data-ndp-seamsummary`)
- 페이지 하단 정보띠 / 안내 페이지 / 롤지 머리띠: 같은 문구 (`data-ndp-seamnote`)
- 시접선 위 부위별 폭 병기 — 길이 45mm 이상인 구간만 (`data-ndp-seamlabel="side"` 등)

---

## 4. A4 타일 레이아웃 수치 (기본값 기준)

```
용지            210 × 297 mm
여백            좌·우·상 8mm, 하단 정보띠 16mm
유효 인쇄영역    194 × 273 mm
겹침            10 mm
페이지 간 step   184 × 263 mm
```

재조립 검산: `cols×194 − (cols−1)×10 = 10 + cols×184` = `info.coverage.wMm`.
페이지마다 `data-ndp-world-origin="x,y"` 로 자기 world 원점(mm)을 기록해 두었으니
통합 후에도 외부에서 검증할 수 있습니다.

정합 보조물: 페이지 테두리(파선) · 겹침 시작선(점선 + "✂ 여기서 잘라 B1 위에 겹쳐 붙이기") ·
정합 십자 최대 9개(내용창 네 귀 + step 격자점, 각각 world cm 좌표 라벨) · 5cm 모눈 좌표.

## 5. 롤지 모드

폭 `rollWidthMm`(594 / 914), 길이는 조각에 맞춰 가변. 분할 없음.
`@page` 크기가 가변이므로 **`applyPageCss(layout)` 을 반드시 호출**하세요.
머리띠에 제목·경고·가로 눈금, 하단에 가로 눈금 하나 더, 우하단에 세로 눈금
(롤 프린터의 길이방향 이송 오차 확인용).
조각 폭이 유효폭을 넘으면 `info.warnings` 에 경고를 넣고 그대로 출력합니다(잘릴 수 있음).

## 6. 네스팅

높이 내림차순 shelf packing + 90° 회전. A4 모드는 캔버스 폭 후보(1~`maxCols` 열)를 모두
돌려보고 ① 페이지 수 ② 사용 면적 ③ 회전 조각 수 순으로 최적을 고릅니다
(같은 값이면 조각을 눕히지 않습니다).
회전 시 식서선·라벨·너치가 함께 돌아가므로 재단 방향은 유지됩니다.

## 7. 선 규약

| 대상 | 색 | 선 |
|---|---|---|
| 시접선(재단선) | 검정 | 실선 0.55mm |
| 완성선 | 검정 | 파선 0.38mm (`4 2.2`) — 시접 0 이면 완성선이 실선 |
| 골선(CB·CF) | 검정 | 실선 0.55mm (완성선 = 재단선이므로 파선을 겹쳐 그리지 않음) |
| 기초선·품선·BL | 회색 `#7d8794` | 0.28mm, `type:'dashed'` 면 파선 |
| 식서·골선 표시·치수 라벨 | 파랑 `#1a4f9c` | 0.35~0.45mm |
| 정합마크·페이지 테두리 | 회색 `#8a8a8a` | 0.2~0.3mm |

### 너치 — 부위마다 길이가 다름 (SPEC §8.1 · §11-1)

`notches[].angle` 은 **도(°)**. `0° = +x`, 시계방향 +, **조각 안쪽을 향하는 방향**.
라디안 자동판별 휴리스틱은 없습니다 — 들어온 값을 그대로 도로 씁니다.

표시선 = **안쪽 0.5cm 고정 + 바깥으로 "그 너치가 놓인 변의 부위 시접"만큼**.
부위를 아는 방법은 ① `notches[].role` ② 없으면 `edges[].role` 중 그 점에 가장 가까운 변.
둘 다 없으면 최대 시접을 쓰고 경고합니다.

| 너치 | 부위 | 시접 | 그려지는 길이 |
|---|---|---|---|
| 목옆점 | `neck` 1.0 | 10mm | 15mm |
| 어깨점 | `shoulder` 1.0 | 10mm | 15mm |
| 옆선 BL | `side` 1.5 | 15mm | **20mm** |
| 소매 밑단 2등분 | `sleeveHem` 3.0 | 30mm | **35mm** |
| (시접 0일 때) | — | 0 | 5mm |

### 골선(CB·CF) — 시접 0

- `piece.foldEdges`(**outline 인덱스**)는 완성선 쪽 골선 표시용,
  `piece.seamFoldEdges`(**seamline 인덱스**)는 시접선 쪽 판정용입니다.
- **`seamFoldEdges` 는 거의 항상 여러 구간입니다.** 골선이 인덱스 0 을 감싸기 때문에
  `[[0,0],[2132,3076]]` 처럼 쪼개집니다. print.js 는 배열 전체를 순회합니다.
  `foldEdges` 도 `end < start` 인 되감기(wrap) 범위를 지원합니다.
- 골선 구간에는 시접이 붙지 않고, **양 끝은 이웃 변의 시접만큼 골선을 따라 연장**됩니다.
  예) 66호 뒷판 CB: 완성선 y −0.3~37.5 → 시접선 y **−1.30 ~ 40.50** (목 1.0 위 / 밑단 3.0 아래), x 는 0 유지.
- **재단선은 조각당 닫힌 path 1개**로 그립니다. 시접선 폐곡선을 통째로 그리면 골선 구간은
  오프셋 0 이라 저절로 골선 위에 놓이고 연장분까지 이어집니다.
  골선 구간을 빼고 완성선으로 대체하면 그 **연장분(목 1.0 / 밑단 3.0)만큼 재단선에 틈**이
  생깁니다 — 브라우저 실측에서 실제로 잡혔던 결함이니 되돌리지 마세요.
- 완성선(파선)은 골선을 뺀 구간만 그립니다(골선에서는 완성선 = 재단선).
  추가로 **양방향 화살표 + "골선 · 시접 없음"** 라벨(`data-ndp-fold="1"`)을 조각 안쪽에 넣습니다.

## 8. 검증

```
$ node print-verify.js      →  PASS 168  FAIL 0
```

목업 Draft는 **44·55·66·77호 × 앞판·뒷판·소매 3조각**을 SPEC §3 계산식(BL=B/4+0.6,
옆선 뒤 B/4+1.9 · 앞 B/4+1.5, 앞 밑단 곡선, 소매산 AH/4+2)으로 생성합니다.

검증 항목: SVG 단위 · 눈금 길이 · 조각 bbox · 타일 재조립 · 배치 범위 · 네스팅 겹침 ·
**부위별 오프셋 거리(구간마다)** · **골선 시접 0** · **옆선↔밑단 모서리 교점** ·
**너치 각도(도)와 부위별 길이** · 롤지 폭 · 인쇄보정 · 4개 호수 · 예외.
`transform` 문자열과 너치 선 좌표를 직접 파싱해 배치·각도 수식을 독립 재검증합니다.

**시접 경로 5가지를 전부 검증합니다.**

| 경로 | 조건 | 기대 |
|---|---|---|
| A | `seamline` + `seamEdges`/`seamFoldEdges` | `T1`, 폴백 경고 0, 골선 이탈 0.000mm |
| C | `edges[].role` 만 (seamline 없음) | `T3` 부위별 오프셋, A 와 면적 오차 **0.0000%** |
| D | 아무 메타도 없음 | 최대폭 균일 + "부위 구분 못함" 경고 |
| E | `seamline` 만 (구버전 엔진) | `T2` 기하 판별, 골선 이탈 0.000mm |
| F | `edges[]` 가 점을 나눠 갖는 형태(실제 엔진) | 경계 세그먼트를 직전 변에 귀속, **경고 0건** |

부위별 오프셋 실측(66호, 경로 A): 목 10.0000 · 어깨 10.0000 · 진동 10.0000~10.0249 ·
옆선 15.0000 · 밑단 30.0000 · 소매부리 25.0000~25.0003 · 골선 0.000 mm.
전 호수 시접선 자기교차 0.

### 브라우저 실측 (Chrome, 1mm = 3.779528 CSS px, 콘솔 에러 0) — 41/41

- 5cm 눈금 188.9751px (오차 **−0.0003mm**), 전 11페이지 편차 ≤0.0013px
- 뒷판 완성선 238mm/410mm → 화면 237.9999 / 410.0000mm
- 페이지 간격 정확히 184.00000 / 263.00000mm, 겹침 정확히 10.00000mm
- `getPointAtLength` 로 재단선·완성선을 샘플링해 **부위별 간격 군집**을 직접 확인:
  뒷판 10 / 15 / 30mm, 소매 10 / 15 / 25mm 군집이 모두 실재
- 골선: 재단선 왼쪽 x 편차 0.0000mm, 위끝 −13.007mm / 아래끝 404.930mm (기대 −13 / 405)
- 4개 호수 전부 페이지 폭 210mm

## 9. 통합 시 주의 / 남은 과제

1. **`print.css` 의 `body > *:not(#ndp-print-area)` 규칙** — SPEC §8.1 에 명문화됨.
   인쇄 영역은 `body` 직속이어야 하고, 앱 전체를 wrapper `div` 로 감싸면 안 됩니다.
2. **너치가 비어 있으면** `info.warnings` 에 경고가 쌓입니다. SPEC §6.3 대로 엔진이
   어깨점·옆선 BL·목옆점 너치를 채워 주어야 합니다.
3. **인덱스 기반 필드는 좌표 배열과 함께 움직여야 합니다.** `foldEdges`/`edges[]` 는
   `outline` 기준, `seamFoldEdges`/`seamEdges` 는 `seamline` 기준입니다. 엔진이 점 순서를
   바꾸면 같이 바뀌어야 합니다. 범위를 벗어난 인덱스는 경고 후 무시합니다.
   **`seamline` 과 `outline` 의 인덱스 1:1 규약은 폐기되었습니다**(모서리에서 점이 증감).
4. `draft.bbox` 와 실측 outline bbox 가 0.05mm 넘게 다르면 경고를 남깁니다. 엔진 회귀
   탐지에 쓰세요.
5. SVG 내부 `id`(clipPath)는 `ndpClip{호출번호}_{행}_{열}` 로 호출마다 달라집니다.
   한 문서에 여러 레이아웃을 넣어도 충돌하지 않습니다.
6. UI 는 `info.pieces[].seamSource === 'computed'` 일 때 "엔진 시접이 아직 없어
   출력 쪽에서 근사 생성함" 안내를 띄워 주세요. 통합 완료 후에는 `'draft'` / `T1` 이어야 정상입니다.

### 용지 소모 — 부위별 시접 도입 영향 (목업 기준)

| 호수 | A4 균일1.0 → 부위별 | 롤지 594mm 균일1.0 → 부위별 |
|---|---|---|
| 44호 | 9장 → **9장** | 82.2 → 85.0cm (+2.8) |
| 55호 | 9장 → **10장** | 85.8 → 88.6cm (+2.8) |
| 66호 | 10장 → **10장** | 89.5 → 92.3cm (+2.8) |
| 77호 | 10장 → **10장** | 93.3 → **141.8cm (+48.5)** |

- 롤지 증가분 2.8cm 는 밑단 3.0−1.0 = 2.0cm 가 세로로 두 조각에 걸친 결과입니다.
- **77호만 롤지가 급증합니다.** 부위별 시접으로 몸판 두 장을 나란히 놓는 폭이
  555.9 → **565.9mm** 가 되어 594mm 롤의 배치 가능 폭 556.0mm 를 10mm 초과하고,
  네스팅이 줄바꿈해 3줄이 됩니다.
  → **77호는 914mm 롤을 쓰세요** (141.8cm → 96.1cm). 또는 `gapMm` 을 12 → 2 로 줄이면
  594mm 에서도 한 줄에 들어갑니다(재단 여유가 줄어드니 권장하지는 않습니다).
- A4 는 타일이라 폭 제약이 없어 이 문제가 없습니다.
