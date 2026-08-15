# 측정 파이프라인 — 코드 수준

PIL·numpy 없이 순수 Node/Python 으로 돌아간다. 실제로 쓴 코드는
`여성복원형Suite/tools/조끼-정답지-생성.js` 와 `조끼/검증/겹침만들기.js` 가 완성본이다.

## ① 이미지 → BMP

```bash
sips -s format bmp ~/Downloads/도면/15_완성이미지.jpg --out /tmp/ref.bmp
```
BMP 는 헤더만 읽으면 되므로 디코더가 20줄이면 끝난다 (`tools/bmp-lite.js`).

## ② 색분류

교재가 앞판/뒤판/안단을 색으로 갈라 그렸으면 그대로 마스크가 된다.

```js
function cls(x, y) {
  var o = (y*W+x)*3, r = PX[o], g = PX[o+1], b = PX[o+2];
  var mx = Math.max(r,g,b), mn = Math.min(r,g,b), sat = mx - mn;
  if (sat >= 40) {
    if (b > g+25 && r > g+10 && b > 60) return 'P';   // 보라 (안단·밑단)
    if (g > r+25 && g > b+15) return 'G';             // 초록 (앞판)
    if (r > g+45 && r > b+30) return 'R';             // 빨강 (뒤판)
  }
  if (mx < 130 && sat < 45) return 'K';               // 검정 (기초선)
  return null;
}
```

## ③ 축척

격자선·기초선의 **긴 직선 픽셀**을 세로/가로로 투영해 찾는다.
**세 점 이상**으로 최소제곱. 두 점으로 세우면 0.1cm 씩 어긋난다.

```
가로 검정선 py 191 / 243 / 704.19 / 1028 / 1438  ↔  엔진 y −2.5 / 0 / 22.5 / 38 / 58
세로 검정선 px 1251 / 889 / 764.5 ↔ 뒤 x 0 / 17.75 / 24
→ sx 20.301  sy 20.620  ox 1250.84  oy 242.42   (최대 어긋남 0.11cm)
```

⚠ 기준선을 잘못 고르면 전부 틀어진다. **비율이 딱 떨어지는 성질**로 검산하라
(예: BL/목너비 = 3.000 이 전 호수에서 성립).

## ④ 엔진 곡선에 배정 + 주석 걸러내기

```js
// 마스크 픽셀 → 가장 가까운 엔진 곡선 (2cm 캡)
// 그 뒤 국소 중앙값 2패스로 라벨·브래킷·예시선 픽셀을 버린다
function medianPass(px, W2, thr) {          // W2 = 호 창 (샘플 수), thr = 0.30~0.35
  return px.filter(function (p, i) {
    var win = px.filter(q => Math.abs(q.t - p.t) <= W2).map(q => q.d).sort((a,b)=>a-b);
    return Math.abs(p.d - win[win.length>>1]) <= thr;
  });
}
px = medianPass(px, 40, 0.35);   // ±2cm
px = medianPass(px, 60, 0.30);   // ±3cm · 더 엄격
```
**2패스라야 한다.** 폭 넓은 주석은 1패스의 창 중앙값을 저 자신이 끌어당겨 살아남는다.

## ⑤ 데시메이션

8-연결 픽셀 경로는 길이가 ~7% 부푼다. **0.12cm 로 솎으면** 사라진다.
반드시 **직선 구간으로 검산**하라 (알려진 길이의 기준선을 재 본다).

## ⑥ 비교

```js
// 점 → 선분 거리라야 한다. 점끼리 재면 샘플 간격 차가 그대로 오차로 잡힌다
function toPoly(p, Q) { … }
function hausdorff(A, B) { return Math.max(one(A,B), one(B,A)); }   // 양방향
```
- **clipToRef** — 정답지가 닿는 구간으로 엔진 곡선을 자른다. 도면에서 못 딴 구간까지
  벌점을 주면 0.18 → 1.76 으로 튄다 (곡선이 틀린 게 아니라 자료가 없는 것이다)
- **스캔라인 표** — 높이별 x 를 나란히 찍으면 「어디서부터 벌어지는지」가 보인다.
  하우스도르프 한 숫자보다 원인을 빨리 찾는다

## ⑦ 겹친 그림

도면을 배경(투명도 0.45)으로 깔고 엔진 선을 얹은 SVG.
사람이 5초에 확인하고, 주석(callout)으로 「무엇이 얼마나 다른지」를 적어 둔다.
⚠ **outline(완성선)** 을 얹어라. seamline(시접선)을 얹으면 통째로 밖으로 나가
「많이 다르다」로 보인다.

## 정답지로 굳히기

```json
{ "image": "15_완성이미지.jpg", "unit": "cm", "size": "55호",
  "transform": { "sx": 20.301, "sy": 20.62, "oxB": 1250.84, "oy": 242.42 },
  "curves": { "bNeck": [[x,y], …] },
  "tol": { "curve": 0.4 }, "tol_bNeck": 0.6,
  "note": "왜 이 곡선만 tol 이 넓은지" }
```
모듈 검산기에서 `AC.run(name, points, curves, U, bad)` 로 걸면
다음에 곡선을 건드리는 사람이 **모양 변화를 즉시** 안다.
