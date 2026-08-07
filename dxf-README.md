# dxf.js — DXF 내보내기 인수인계

기본 무다트 원형(문화식)을 **CAD·플로터·공장으로 넘길 DXF** 로 내보냅니다. SPEC.md §13 구현.

| 파일 | 역할 |
|---|---|
| `dxf.js` | 내보내기 엔진. `window.NoDartDXF` 로 노출 |
| `dxf-verify.js` | 수치 검산 (`node dxf-verify.js`) |

`print.js` / `print.css` 와는 완전히 독립입니다. 외부 라이브러리·CDN·ES module 없음
(`typeof module` 가드가 있어 node/브라우저 양쪽에서 로드됩니다).

---

## 1. API

```js
const dxf  = window.NoDartDXF.buildDXF(draft, opt);   // → DXF 문자열
const r    = window.NoDartDXF.build(draft, opt);      // → { dxf, info }
window.NoDartDXF.download(draft, opt);                // Blob + a[download] 저장
window.NoDartDXF.lastInfo();                          // 마지막 호출의 info
window.NoDartDXF.suggestName(draft, opt);             // "기본무다트원형_66호_cm.dxf"
```

`draft` 는 SPEC §12 Draft 객체 그대로. **좌표는 cm**, 변환은 dxf.js 안에서만 합니다.

### opt (전부 선택, 괄호는 기본값)

| 키 | 기본 | 설명 |
|---|---|---|
| `unit` | `'cm'` | `'cm'`(1유닛=1cm, `$INSUNITS` 5) / `'mm'`(좌표 ×10, `$INSUNITS` 4) |
| `includeSeam` | `true` | 시접선 레이어 포함 |
| `includeInternal` | `true` | 기준선(BL·등품선·BP) 포함 |
| `includeText` | `true` | 문자 레이어 포함 |
| `layout` | `'row'` | `'row'` 가로 나열 / `'origin'` 로컬 원점 그대로(좌표 확인용) |
| `gapCm` | `5` | row 배치 간격 |
| `simplifyTolCm` | `0.01` | Douglas–Peucker 허용 편차 — 아래 §4 |
| `textHeightCm` | `0.8` | 문자 높이 |
| `filename` | — | `download()` 파일명 override |

### info 주요 항목

`acadver` `unit` `unitScale` `insunits` `layout` `simplifyTolCm` **`simplifyDevCm`**
`extMin` `extMax` `layers` `layersUsed` `entities`(종류별 개수)
**`outlineOrder`**(완성선 폴리라인이 어느 조각인지 — 검증·후처리용) `pieces[]` `warnings[]`

`pieces[]`: `outlinePts` → `outlineSimplified`, `outlineDevCm`, `outlineMode`,
`seamPts`/`seamSimplified`/`seamDevCm`, `foldRanges`, `notches`, `internal`, `grainline`.

---

## 2. 파일 형식

- **`$ACADVER = AC1021` (R2007).** R2007+ 는 문자열이 UTF-8 이라 **한글 레이어명이 그대로**
  들어갑니다. 원본은 AC1027 + `ANSI_949`(EUC-KR)이지만 브라우저에서 EUC-KR 인코딩이
  번거로워 UTF-8 을 택했습니다. **BOM 은 붙이지 않습니다**(일부 리더가 첫 그룹코드를 못 읽음).
- 섹션은 `HEADER` · `TABLES` · `ENTITIES` · `EOF` 만. TABLES 에는 `LTYPE`(CONTINUOUS) ·
  `LAYER` · `STYLE`(Standard) 를 넣습니다 — 레이어가 참조하는 선종과 TEXT 가 참조하는
  스타일이 선언돼 있어야 리더가 불평하지 않습니다.
- `$EXTMIN`/`$EXTMAX` 를 실제 도형 범위로 채웁니다 (CAD 의 Zoom Extents 동작).

### ★ y축 뒤집기

**엔진은 y 아래+, DXF 는 y 위+ → `y_dxf = −y_engine`.** 안 뒤집으면 조각이 상하 반전됩니다.
검산: 66호 뒷목이 엔진 y −3.1227 → DXF y **+3.1227**, 허리선 엔진 +37.5 → DXF **−37.5**.

---

## 3. 레이어 (SPEC §13-3)

| 레이어 | ACI | 내용 |
|---|---|---|
| `완성선` | 7 | `outline` 폐곡선 (LWPOLYLINE, 70=1) |
| `시접선` | 5 | `seamline` 폐곡선 (LWPOLYLINE, 70=1) |
| `골선` | 3 | `foldEdges` 구간을 열린 LWPOLYLINE 으로 한 번 더 |
| `너치` | 1 | 각 너치를 `angle`(도) 방향 0.5cm LINE |
| `기준선` | 8 | `internal` — LINE / POINT |
| `식서` | 6 | `grainline` — 화살표 없이 LINE |
| `문자` | 2 | `66호 뒷판 · 2매` + 부위별 시접 요약 (TEXT, 높이 0.8cm) |

`notches[].angle` 은 **도(°)** 입니다 (SPEC §8.1). 180° 너치가 DXF 에서 −x 수평으로
나가는 것을 검산에 걸어 두었습니다.

---

## 4. 외곽선 단순화 — 허용 편차를 왜 0.01 로 잡았나

엔진 outline 은 조각당 **약 3000점**입니다. 그대로 내보내면 CAD 가 무겁고, 원본 DXF 의
스플라인 fit 정점(17~65점)과 성격이 달라집니다. 그래서 Douglas–Peucker 로 줄입니다.

**변(edge) 구간마다 따로** 줄입니다(`edges[]` / `seamEdges` 의 점 범위 사용).
통짜로 줄이면 모서리 정점이 사라져 부위 경계가 뭉개집니다. `info.pieces[].outlineMode`
가 `perEdge` 면 구간별, `whole` 이면 구간정보가 없어 통짜로 처리된 것입니다.

SPEC 상한은 0.05cm 이지만 **그 예산을 내보내기가 다 쓰면 안 됩니다.**
엔진 outline 자체가 원본 DXF 와 이미 최대 **0.066cm** 벌어져 있기 때문입니다(§6 참고).
`simplifyTolCm = 0.01` 이면 조각당 50~77점이면서 내보내기 기여분이 **≤0.0056cm** 로
억제됩니다.

| tol | 뒷판 점수 | 원본 대조 최대(앞옆선 제외) |
|---|---|---|
| 0 (무손실) | 1649 | 0.0657 (= 엔진 자체 편차) |
| **0.01 (기본)** | **52** | **0.0612** |
| 0.02 | 44 | 0.0612 |
| 0.03 | 33 | 0.0530 |

`simplifyTolCm: 0` 을 주면 편차 0(형상 무손실)이 되고, 정확히 일직선 위에 있는
공선점만 제거되어 3077 → 1649점이 됩니다.

---

## 5. 조각 배치

- `layout:'row'`(기본) — **시접선 포함 bbox** 기준으로 가로 나열, 간격 `gapCm`.
  시접 3.0cm 를 무시하면 조각이 겹치므로 반드시 `outline ∪ seamline` 로 잡습니다.
- `layout:'origin'` — 각 조각을 로컬 원점 그대로. 조각끼리 겹치지만
  **원본 DXF 와 좌표를 대조할 때 이 모드를 씁니다.**

---

## 6. 검증

```
$ node dxf-verify.js      →  PASS 67  FAIL 0  WARN 1
```

실제 엔진(`engine.js`)으로 제도한 draft 를 쓰고, 내보낸 DXF 를 **자체 파서로 다시 읽어**
대조합니다.

### 원본 대조 (SPEC §13-6-2) — 66호 / origin / cm / 시접 0

편차를 **엔진 기준선**(단순화 전)과 **내보내기 기여분**으로 나눠 잽니다.

| 곡선 | 엔진 기준선 | 내보낸 DXF | 내보내기 기여 |
|---|---|---|---|
| back 뒷목둘레 (fit 17점) | 0.0044 | 0.0100 | +0.0056 |
| back 뒤 암홀 (65점) | 0.0325 | 0.0380 | +0.0055 |
| front 앞 밑단 (17점) | 0.0337 | 0.0339 | +0.0001 |
| front 앞목둘레 (18점) | 0.0108 | 0.0128 | +0.0020 |
| front 앞 암홀 (57점) | **0.0657** | 0.0612 | −0.0045 |

- **내보내기 기여 최대 +0.0056cm** — 허용 편차 0.01 안.
- **앞 옆선(x≈23.5) 0.0995cm** 는 SPEC §4·§9-6 이 명시적으로 허용한 값입니다
  (계산식 23.4 채택 vs 원본 DXF 23.5).
- ⚠ **`front 앞 암홀` 은 엔진 outline 자체가 0.0657cm 벌어져 있어** 단순화를 완전히
  꺼도(tol=0) 0.05 를 넘습니다. 겨드랑 끝에서 **3.4cm 떨어진 중하단 구간**이라
  §9-6 의 "겨드랑 끝 1cm" 허용에 해당하지 않습니다. **dxf.js 로는 고칠 수 없으며
  엔진팀 확인이 필요합니다.** 검산은 이 항목을 WARN 으로 표시합니다.

### 그 밖에 확인한 것

- 왕복 검증(내보낸 DXF 재파싱 ↔ 원좌표): 내보낸 점 → 원곡선 **0.0000cm**,
  원곡선 → 내보낸 선 **0.0099cm**. 4호수 전부 ≤0.0099cm. mm 단위도 동일.
- 레이어 7개 선언·색 일치, ENTITIES 의 미선언 레이어 참조 **0건**.
- `$EXTMIN`/`$EXTMAX` 가 실제 좌표와 일치.
- y 뒤집기 (위 §2).
- 4호수 × 3프리셋 × 2단위 = **24조합 무예외·NaN 0·경고 0**.
- 완성선·시접선이 닫힌 폴리라인(70=1), 정점 수(90)와 실제 정점 일치.
- 너치 길이 0.5cm, 180° 너치가 −x 수평.
- row 배치 간격 정확히 5.00cm, 조각 겹침 없음.

브라우저에서도 **독립 파서**로 다시 읽어 같은 수치(0.0612 / 앞옆선 0.0995)를 확인하고,
SVG 로 렌더해 원본 ground-truth 곡선(빨강 파선)이 내보낸 외곽선 위에 겹치는 것과
조각이 상하 정방향(목이 위)인 것을 눈으로 확인했습니다.

---

## 7. 통합 시 주의

1. **UI 버튼은 디자인팀 담당.** `NoDartDXF.download(draft, opt)` 한 줄이면 됩니다.
   호수·시접 프리셋은 현재 화면 상태를 그대로 넘기세요.
2. `info.outlineOrder` 는 완성선 LWPOLYLINE 의 출력 순서(= `draft.pieces` 순서)입니다.
   DXF 에는 조각 이름을 담을 표준 필드가 없어, 후처리로 조각을 구분하려면 이 순서를 쓰세요.
3. **`layout:'origin'` 은 조각이 겹칩니다.** 좌표 대조 전용이며, 실제 재단용으로는
   `'row'` 를 쓰세요.
4. 원본과 완전히 같은 파일을 원하면 AC1027 + EUC-KR 이 필요하지만, 브라우저 단독
   실행 제약 때문에 UTF-8 R2007 을 택했습니다. 한글 레이어명이 깨지는 리더가 있으면
   그 리더가 R2007 미만인 것이니 확인이 필요합니다.
5. 엔진이 `edges[]` / `seamEdges` 를 주지 않으면 구간별 단순화가 불가능해 통짜로
   처리되고, 부위 경계 정점이 사라질 수 있습니다 (`outlineMode: 'whole'` 로 드러남).
