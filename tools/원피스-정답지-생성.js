/* 원피스 도면 → 정답지 확충 — ⚠ **지금 이대로는 못 쓴다.** 사연을 먼저 읽을 것.
 *
 * ══ 2026-08-15 실패 기록 ═══════════════════════════════════════════════
 *   조끼에서 통한 파이프라인을 그대로 옮겼는데 **정답지가 오염됐다**:
 *     뒤 암홀 849점 = 102cm  (실제 암홀 22cm — 5배)
 *     등솔선 1279점 = 153cm  (실제 38cm — 4배)
 *     뒤 옆선  189점 =  23cm  (실제 56cm — 오히려 부족)
 *   원인 둘:
 *     ① **번호·치수선이 외곽선과 같은 빨강**이다. 조끼 도면은 번호가 검정이라
 *        색분류만으로 갈렸는데, 원피스는 25개 번호와 치수 화살표가 전부 빨강이라
 *        2cm 캡 안에서 아무 곡선에나 붙는다. 국소 중앙값 2패스로도 안 걸러진다
 *        (곡선을 따라 촘촘히 붙어 있어 중앙값 자체를 끌어당긴다).
 *     ② 도면 이미지가 **길이의 81%(y 0~80.6cm)만** 담고 있다. 엔진 원피스는 100cm 라
 *        스커트 하부(밑단·옆선 아래)는 대조할 자료가 아예 없다.
 *   → 이 상태의 결과를 커밋하면 **거짓 정답지**가 된다. 되돌렸다.
 *
 *   다시 하려면 둘 중 하나가 필요하다:
 *     · 번호·치수선이 **다른 색**이거나 없는 도면 (또는 스커트까지 담긴 원본)
 *     · 색분류 대신 **선 추종**(연결성 기반 세선화 + 분기점 분할)으로 곡선을 뽑기
 *   기존 정답지(bArm·fArm·fNeck)는 사람이 다익스트라로 딴 것이라 신뢰할 수 있다 —
 *   덮어쓰지 말 것.
 * ══════════════════════════════════════════════════════════════════════
 *
 *   실행:  node tools/원피스-정답지-생성.js
 *   ⚠ 축척은 **기존 정답지가 확정해 둔 값**을 그대로 쓴다 (residual 0.05~0.08).
 *     도면은 90° 눕혀 있어 이미지 x = 길이(y), 이미지 y = 폭(x) 이다:
 *       뒤  x = (803 − py)/23.09 · y = (1863 − px)/23.09
 *       앞  x = (799 − py)/22.70 · y = (1892 − px)/22.70
 *   방법은 조끼와 같다 — 색분류 → 엔진 최근접 배정 → 국소 중앙값 2패스 → 0.12 데시메이션.
 *   (스킬 pattern-drawing-diff · references/pipeline.md)
 */
'use strict';
var fs = require('fs'), path = require('path');
var BM = require(__dirname + '/bmp-lite.js');
var E = require(__dirname + '/../원피스/engine.js');
var U = E.util, V = U.V;

var SRC = process.argv[2] || '/private/tmp/claude-501/-Users-ybr---------QMS-Suite/193a494e-cabf-4f85-8a91-78b55aa06de8/scratchpad';
var PAN = {
  B: { bmp: SRC + '/dressB.bmp', sc: 23.09, ox: 1863, oy: 803, out: '원피스-뒤판' },
  F: { bmp: SRC + '/dressF.bmp', sc: 22.70, ox: 1892, oy: 799, out: '원피스-앞판' }
};

function cls(PX, W, x, y) {
  var o = (y * W + x) * 3, r = PX[o], g = PX[o + 1], b = PX[o + 2];
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx - mn;
  if (sat >= 45) {
    if (r > g + 45 && r > b + 30) return 'R';
    if (g > r + 25 && g > b + 15) return 'G';
    if (b > g + 25 && b > r + 25) return 'B';
  }
  return null;
}

var m = E.measuresForSize('55호');
var g = E.geom(m, {});
/* 대조할 곡선 — [이름, 패널, 마스크색, segs]
   뒤판은 외곽이 빨강·절개가 초록, 앞판은 외곽이 파랑이다 (도면 색 프로파일로 확인). */
var CURVES = [
  ['cbSegs',   'B', 'R', g.cbSegs],
  ['bNeck',    'B', 'R', g.bNeck],
  ['bArm',     'B', 'R', g.bArm],
  ['bSide',    'B', 'R', g.bSide],
  ['bHem',     'B', 'R', g.bHem],
  ['bPrinIn',  'B', 'G', g.bPrinIn],
  ['bPrinOut', 'B', 'G', g.bPrinOut],
  ['fNeck',    'F', 'B', g.fNeck],
  ['fArm',     'F', 'B', g.fArm],
  ['fSide',    'F', 'B', g.fSide],
  ['fHem',     'F', 'B', g.fHem],
  ['fPrinIn',  'F', 'B', g.fPrinIn],
  ['fPrinOut', 'F', 'B', g.fPrinOut]
];
CURVES.forEach(function (C) { C.eng = U.sampleSegs(C[3], 0.05); C.px = []; });

Object.keys(PAN).forEach(function (pk) {
  var P = PAN[pk];
  if (!fs.existsSync(P.bmp)) { console.log('  · ' + P.bmp + ' 없음 — 건너뜀'); return; }
  var im = BM.readBMP(P.bmp), W = im.w, H = im.h, PX = im.px;
  function toCm(px, py) { return [(P.oy - py) / P.sc, (P.ox - px) / P.sc]; }
  var byColor = {};
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var c = cls(PX, W, x, y); if (!c) continue;
    (byColor[c] = byColor[c] || []).push(toCm(x, y));
  }
  Object.keys(byColor).forEach(function (col) {
    var grp = CURVES.filter(function (C) { return C[1] === pk && C[2] === col; });
    if (!grp.length) return;
    byColor[col].forEach(function (q) {
      var bi = -1, bt = -1, bd = 4;                       // 2cm 캡
      for (var k = 0; k < grp.length; k++) {
        var A = grp[k].eng;
        for (var t = 0; t < A.length; t++) {
          var dx = A[t][0] - q[0], dy = A[t][1] - q[1], d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bi = k; bt = t; }
        }
      }
      if (bi >= 0) grp[bi].px.push({ q: q, t: bt, d: Math.sqrt(bd) });
    });
  });
});

/* 라벨·번호·보조선 픽셀 걸러내기 — 국소 중앙값 2패스 (조끼와 같은 이유) */
function medianPass(px, W2, thr) {
  var kept = [];
  for (var i = 0; i < px.length; i++) {
    var t0 = px[i].t, win = [];
    for (var j = i; j >= 0 && px[j].t >= t0 - W2; j--) win.push(px[j].d);
    for (var j2 = i + 1; j2 < px.length && px[j2].t <= t0 + W2; j2++) win.push(px[j2].d);
    win.sort(function (a, b) { return a - b; });
    kept.push({ p: px[i], med: win[win.length >> 1] });
  }
  return kept.filter(function (e) { return Math.abs(e.p.d - e.med) <= thr; }).map(function (e) { return e.p; });
}
function decimate(pts) {
  var out = [], last = null;
  pts.forEach(function (p) {
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.12) { out.push(p); last = p; }
  });
  return out;
}

var built = { B: {}, F: {} };
CURVES.forEach(function (C) {
  if (C.px.length < 20) return;
  C.px.sort(function (a, b) { return a.t - b.t; });
  C.px = medianPass(C.px, 40, 0.35);
  C.px = medianPass(C.px, 60, 0.30);
  var pts = decimate(C.px.map(function (e) { return [+e.q[0].toFixed(3), +e.q[1].toFixed(3)]; }));
  if (pts.length >= 8) built[C[1]][C[0]] = pts;
});

/* 기존 정답지에 **덧붙인다** — points·tol·note 는 손대지 않는다
   (그 값들은 사람이 근거를 적어 둔 것이다) */
var DIR = __dirname + '/../docs/answer';
[['B', PAN.B.out], ['F', PAN.F.out]].forEach(function (r) {
  var f = DIR + '/' + r[1] + '.json';
  var A = JSON.parse(fs.readFileSync(f, 'utf8'));
  var before = Object.keys(A.curves || {});
  A.curves = A.curves || {};
  Object.keys(built[r[0]]).forEach(function (k) { A.curves[k] = built[r[0]][k]; });
  fs.writeFileSync(f, JSON.stringify(A));
  console.log(r[1] + ' 곡선 ' + before.length + ' → ' + Object.keys(A.curves).length +
    '  (' + Object.keys(built[r[0]]).map(function (k) { return k + ':' + built[r[0]][k].length; }).join(' ') + ')');
});
