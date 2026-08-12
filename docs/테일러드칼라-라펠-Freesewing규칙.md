# 테일러드 칼라·라펠 제도 규칙 — Freesewing Carlton 에서 추출

출처: `freesewing/freesewing` `designs/carlton/src/` (develop 브랜치, MIT)
파일: `front.mjs` · `collarstand.mjs` · `collar.mjs`

Carlton 은 **노치드 라펠 코트**(셜록 계열)다. 우리가 만들 「Barjacke doppelreihig」(더블 재킷)와
칼라 구조가 같다 — 꺾임선 · 칼라 스탠드 · slash&spread 벌림.
**단, Carlton 은 코트라 칼라·라펠이 재킷보다 크다.** 아래 비율은 그대로 쓰지 말고
36호 도면(정답지)에 맞춰 재적합해야 한다.

> ⚠ 로컬 Freesewing MCP(`/Users/ybr/FreeseawingMCP`)에는 재킷이 없다
> (aaron·bella·brian·simon·teagan 만 설치돼 있다). 이 규칙은 GitHub 원본에서 읽었다.

---

## 1. 여밈선 (front closure edge)

```
buttonW      = waist.x × buttonSpacingHorizontal        [기본 43.5%]   # 좌우 단추 간격
buttonH      = (허리 → 힙) / 1.5                                        # 단추 세로 간격
button1      = 힙선 높이, 앞중심에서 좌우 buttonW/2
button2·3    = button1 에서 buttonH 씩 위로

collarEdge.x = button1Left.x − 허리둘레 × frontOverlap  [기본 1.5%]
collarEdge.y = cfNeck.y                                                 # 앞목점 높이
hemEdge      = (collarEdge.x, hem.y)
```

더블 여밈이면 단추가 좌우 2열 — `buttonSpacingHorizontal` 이 그 간격이다.
Barjacke 는 도면상 **3쌍**이라 `button1~3` 구조가 그대로 맞는다.

## 2. 라펠 꺾임선 (roll line) ★ 이게 골격이다

```
rollLineStart = (collarEdge.x, button3Left.y)          # 맨 윗단추 높이의 여밈선 위
rollLineEdge  = shoulder 에서 neck 쪽으로 **1.15 배** 연장   # 어깨선 밖으로 15% 나간 점
rollLineEnd   = 직선(rollLineStart → rollLineEdge) ∩ 앞목둘레 곡선
```

**꺾임선 = 「맨 윗단추 ↔ 목옆점 바깥 15%」를 잇는 직선.** 목선과 만나는 자리가 꺾임 끝.
테일러드 칼라의 모든 것이 이 선에서 나온다 — 라펠 폭도, 칼라 눕는 각도도.

`1.15` 가 칼라가 목을 감싸는 여유다. 값이 크면 칼라가 더 눕고, 작으면 선다.

## 3. 라펠 외곽

```
collarTip           = collarEdge 에서 cfNeck 쪽으로 lapelReduction [기본 5%] 이동
lapelStraightEnd    = (collarEdge.x, armhole.y)        # 곡선이 직선으로 바뀌는 자리
lapelStraightEndCp1 = lapelStraightEnd 에서 collarEdge 쪽 0.7
```

→ 여밈선은 **진동 높이(armhole.y)까지 곡선**, 그 아래는 **직선**.
`collarTip` 이 라펠 끝점(노치 위쪽 꼭짓점)이다.

앞판 외곽선 순서:
```
… 암홀 → s3CollarSplit(어깨선 3등분점) → 앞목둘레 → collarTip
  →(곡선) lapelStraightEnd →(직선) hemEdge → 밑단
```

## 4. 칼라 스탠드 (collarStand)

```
height = 가슴둘레 × collarHeight  [기본 9.6% · 범위 8~11]
length = 앞목둘레길이 + 뒷목둘레길이      ← **실측값**(frontCollarLength + backCollarLength)

topLeft    = (0, 0)                    bottomLeft  = (0, height)
topRight   = (length, −height × collarFlare [기본 20% · 0~40])
bottomRight= (length, height)

standTop   = bottomLeft → topLeft 의 25% 자리          # 스탠드 높이 = height × 0.25
standTip   = ( topRight.x × 0.75 , bottomLeft.y + topRight.x / 8.5 )
standTopCp = standTop 에서 x+ 로 standTip.x × 0.9
standTipCp = standTip 에서 180° 로 (standTop~bottomLeft 의 y차)
bottomLeftCp = bottomLeft 에서 x+ 로 bottomRight.x × 0.4
```

좌우 대칭이므로 `standTopCp · standTip · standTipCp · bottomLeftCp` 를 `flipX()` 해서 왼쪽을 만든다.
**골선은 `topLeft → standTop`** (뒤중심).

## 5. 칼라 — slash & spread ★

종이로는 가위질, 코드로는 회전+이동이다.

```
윗변(topLeft→topRight) 을 5등분 → cutTop1~4
아랫변(standTop→standTip 곡선) 을 4등분 → cutBottom1~3
각 조각을 collarSpread [기본 4° · 범위 2~6] 씩 **차례로 회전**해 벌린다
   4번 조각부터 거꾸로 (pivot: standTip → cutBottom3 → cutBottom2 → cutBottom1)
회전 뒤 각 판을 이전 판에 **붙여 이동**한다
```

총 벌림 = `collarSpread × 4` = 기본 **16°**.

최종 외곽선은 **자르기 전 매끈한 곡선**을 쓴다 (조각난 선을 이으면 각진다):

```
standTop →(곡선, standTopCp) rot3standTip → rot4bottomRight → rot4topRight
        →(곡선, topLeftCp) topLeft → standTop 닫기
topLeftCp = topLeft 에서 x+ 로 rot4topRight.x × 0.6
```

재단: 겉감 2장 + **심지(canvas) 1장**. 스탠드도 겉감 2 + 심지 1.

---

## 우리 스위트에 옮길 때

### 그대로 쓸 수 있는 것
- 꺾임선 정의 (§2) — 구조가 보편적이다
- 칼라 스탠드 골격 (§4) — `length` 가 **우리 엔진의 목둘레 실측**이면 그대로 맞는다
- slash&spread (§5) — 회전·이동은 이미 `rotAbout`/`rotSegsBelow` 가 있다

### 재적합이 필요한 것
| 값 | Carlton 기본 | 왜 |
|---|---|---|
| `collarHeight` 9.6% | 코트용 | 재킷은 더 낮다. 36호 도면에서 실측해 맞춘다 |
| `collarSpread` 4°×4 | 코트용 | 재킷 라펠 각도에 맞춰 재적합 |
| `frontOverlap` 1.5% | 싱글 기준 | **더블**은 겹침이 훨씬 크다 — Barjacke 도면에서 실측 |
| `lapelReduction` 5% | — | 노치 위치에 따라 다르다 |

### Carlton 에 **없는 것**
- **노치(V자 홈)** — Carlton 은 칼라와 라펠이 매끈하게 이어진다.
  Barjacke 는 노치드 라펠이라 **고지선(gorge line) 각도와 노치 깊이를 따로 정의**해야 한다.
  → 이건 36호 도면에서 각도를 실측해 상수로 넣고, 전 호수에 **각도**로 적용한다
    (길이로 넣으면 66호만 맞는 그 함정이다).
- 언더칼라/멜톤 분리, 칼라 세움분 여유

---

## 다음 단계

1. Barjacke 36호 PDF 벡터에서 **칼라·라펠 좌표 추출** → 정답지
2. 우리 몸판(토르소 프린세스라인/암홀라인) 위에 §2 꺾임선을 얹어 라펠 생성
3. §4·§5 로 칼라 제도, 36호 정답지에 재적합
4. 2장소매는 **숙녀복기본원형2** 것을 가져온다 (그레이딩 이미 잡혀 있다)
