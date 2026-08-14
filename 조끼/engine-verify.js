/* ============================================================================
 * engine-verify.js — 조끼 검산 (백영례 번호점 제도법)
 *
 *   제도법: docs/조끼-제도법-백영례.md · 원본 이미지 ~/Downloads/조끼패턴/ 14장
 *
 *   ★ 이 모듈에는 **DXF/PDF 정답지가 없다.** 원문 텍스트와 도면 이미지만 있다.
 *     그래서 검사는 네 갈래다:
 *       ① 원문이 「재서 확인하라」고 시킨 자리          (§1)
 *       ② 원문이 하나로 못 박은 값·식 그대로인가        (§2 §3)
 *       ③ 조각이 실제로 꿰매지는가 — 닫힘·짝·시접       (§4~§7)
 *       ④ 종이에 그려진 것이 코드가 말하는 것과 같은가   (§8~§10)
 *
 *   ★ 기대값 규칙 (2026-08-14 재작성)
 *     · 원문이 **하나로 못 박은 값**(1.5 · 5 · 7 · 4.5 · B/12 …)은 **리터럴**로 쓴다.
 *       K 를 기대값에 쓰면 K 를 고칠 때 기대값이 따라 움직여 영원히 통과한다.
 *     · 「1.5~2」처럼 **폭이 있는 값**만 K 를 쓰되, §2 에서 **그 폭 자체를 리터럴로**
 *       검사한다. 그래야 K 를 원문 밖으로 옮기면 §2 가 먼저 걸린다.
 *
 *   ⚠ NaN 은 모든 부등식을 통과한다 — 값을 쓰기 전에 반드시 finiteOr 를 지난다.
 *
 *   실행: node engine-verify.js      (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V, K = E.K;

var fails = 0, warns = 0, SIZES = E.SIZES;

/* ── 출력 도구 ─────────────────────────────────────────────────────────── */
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 2 : d); while (s.length < w) s = ' ' + s; return s; }
function head(t) {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(' ' + t);
  console.log('════════════════════════════════════════════════════════════');
}
function row(sz, bad, soft, text) {
  if (bad.length) fails++;
  if (soft.length) warns++;
  console.log('  ' + (bad.length ? '✗ ' : soft.length ? '⚠ ' : '✓ ') + pad(sz, 6) + text +
    (bad.length ? '\n      ✗ ' + bad.join('\n      ✗ ') : '') +
    (soft.length ? '\n      ⚠ ' + soft.join('\n      ⚠ ') : ''));
}

/* ── 자(尺) ────────────────────────────────────────────────────────────── */
/** 곡선 위에서 점 P 까지의 최단거리 — 「이 점을 지나야 한다」를 재는 자 */
function nearest(segs, P) {
  var q = U.sampleSegs(segs, 0.02), b = Infinity;
  for (var i = 0; i < q.length; i++) { var d = V.dist(q[i], P); if (d < b) b = d; }
  return b;
}
/** 점 → 폴리라인 최단거리 (선분까지 잰다 — 점끼리 재면 샘플 간격만큼 과대평가된다) */
function distPoly(P, poly, closed) {
  var b = Infinity, n = poly.length, lim = closed ? n : n - 1;
  for (var i = 0; i < lim; i++) {
    var a = poly[i], c = poly[(i + 1) % n];
    var dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy;
    var t = L2 ? ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var e = V.dist(P, [a[0] + t * dx, a[1] + t * dy]);
    if (e < b) b = e;
  }
  return b;
}
function ptInPoly(pt, poly) {
  var c = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** 폐곡선 자기교차 개수 (64점 블록 bbox 로 미리 거른다 — 4천 점이라 전수는 못 돈다) */
function selfHits(pts) {
  var n = pts.length, hits = 0, BS = 64, nb = Math.ceil(n / BS), blk = [], b, q;
  for (b = 0; b < nb; b++) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (q = b * BS; q < Math.min(n, (b + 1) * BS + 1); q++) {
      var p = pts[q % n];
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    blk.push([x0, y0, x1, y1]);
  }
  for (var i = 0; i < n; i++) {
    var a1 = pts[i], a2 = pts[(i + 1) % n];
    var ax0 = Math.min(a1[0], a2[0]), ax1 = Math.max(a1[0], a2[0]);
    var ay0 = Math.min(a1[1], a2[1]), ay1 = Math.max(a1[1], a2[1]);
    for (b = Math.floor((i + 2) / BS); b < nb; b++) {
      var B = blk[b];
      if (B[0] > ax1 || B[2] < ax0 || B[1] > ay1 || B[3] < ay0) continue;
      for (var j = Math.max(i + 2, b * BS); j <= Math.min(n - 1, (b + 1) * BS - 1); j++) {
        if (i === 0 && j === n - 1) continue;
        if (segX(a1, a2, pts[j], pts[(j + 1) % n])) hits++;
      }
    }
  }
  return hits;
}
function segX(p1, p2, p3, p4) {
  var d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return null;
  var t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  var u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9)
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  return null;
}
/** 곡선 위 점 P 까지의 **호길이** (너치 짝은 높이가 아니라 호길이로 맞아야 꿰매진다) */
function arcAt(segs, P) {
  var q = U.sampleSegs(segs, 0.01), acc = [0], L = 0, bi = 0, bd = Infinity;
  for (var i = 1; i < q.length; i++) { L += V.dist(q[i - 1], q[i]); acc.push(L); }
  for (i = 0; i < q.length; i++) { var e = V.dist(q[i], P); if (e < bd) { bd = e; bi = i; } }
  return { s: acc[bi], total: L, snap: bd };
}
function finiteOr(bad, label, v) {
  if (!isFinite(v)) { bad.push(label + ' = ' + v + ' (NaN/Infinity — 부등식 검사를 그냥 통과한다)'); return false; }
  return true;
}
function readFile(rel) {
  try { return fs.readFileSync(path.join(__dirname, rel), 'utf8'); } catch (e) { return null; }
}

/* ══════════════════════════════════════════════════════════════════════
 * §0. 필요치수표 · 호수별 등급 — 원문 「1_필요치수」 그대로인가
 *     ★ 여기가 무너지면 아래 전부가 무의미하다. 값은 전부 **리터럴**이다.
 * ════════════════════════════════════════════════════════════════════ */
head('0. 필요치수표 (원문 55 Size) 와 호수별 등급');
(function () {
  var bad = [], soft = [];
  /* 원문 1_필요치수 — 55 Size */
  var WANT55 = { backLen: 38, shoulderW: 38, backW: 34, B: 84, '유B': 86,
                 frontW: 32, bustLen: 25, bustW: 16, W: 68, H: 90 };
  var m55 = E.measuresForSize('55호');
  Object.keys(WANT55).forEach(function (k) {
    if (!finiteOr(bad, '55호 ' + k, m55[k])) return;
    if (Math.abs(m55[k] - WANT55[k]) > 1e-9)
      bad.push('55호 ' + k + ' = ' + m55[k] + ' ≠ 원문 ' + WANT55[k]);
  });
  /* [11] 참고 · 27 참고 — 유차는 호수별로 못 박혀 있다 */
  var WANT유차 = { '44호': 2.5, '55호': 2.5, '66호': 2.5, '77호': 2.8, '88호': 2.8 };
  SIZES.forEach(function (sz) {
    var g = E.geom(E.measuresForSize(sz));
    if (!finiteOr(bad, sz + ' 유차', g['유차'])) return;
    if (Math.abs(g['유차'] - WANT유차[sz]) > 1e-9)
      bad.push(sz + ' 유차 ' + g['유차'] + ' ≠ 원문 ' + WANT유차[sz]);
  });
  /* [27] 참고 — 유장 55"=25 · 66"=25.5 · 77"=26 */
  var WANT유장 = { '55호': 25, '66호': 25.5, '77호': 26 };
  Object.keys(WANT유장).forEach(function (sz) {
    var v = E.measuresForSize(sz).bustLen;
    if (Math.abs(v - WANT유장[sz]) > 1e-9)
      bad.push(sz + ' 유장 ' + v + ' ≠ 원문 ' + WANT유장[sz]);
  });
  /* 원문 「등품 :34(2분의등품=17) 참고:Size별로 0.5씩증가시킴」
     ⚠ 0.5 가 **등품**인지 **2분의등품**인지 원문이 붙어 있어 갈린다. 엔진은 등품 1.0
       (= 2분의등품 0.5) 로 읽었다. 다른 읽기라면 88호에서 등품이 1.5 작아진다 —
       암홀·절개선이 통째로 움직이는 크기라 그냥 넘기지 않고 남긴다. */
  var bwStep = E.measuresForSize('66호').backW - E.measuresForSize('55호').backW;
  if (Math.abs(bwStep - 0.5) > 1e-9 && Math.abs(bwStep - 1.0) > 1e-9)
    bad.push('등품 등급 ' + bwStep + ' — 원문이 말한 0.5 도 그 배(1.0)도 아니다');
  else if (Math.abs(bwStep - 1.0) < 1e-9)
    soft.push('등품 등급 1.0 (= 2분의등품 0.5). 원문 「Size별로 0.5씩증가」를 **등품**으로 읽으면 0.5 여야 한다 — 88호에서 등품 37 vs 35.5');
  /* 원문 0. 「뒤품이 앞품보다 1.5cm 정도 많은 것이 정상」 */
  SIZES.forEach(function (sz) {
    var m = E.measuresForSize(sz), d = m.backW - m.frontW;
    if (d < 1.0 || d > 2.5) bad.push(sz + ' 등품−앞품 ' + d + ' (원문 「1.5 정도」)');
  });
  row('치수표', bad, soft, '55호 10항목 · 유차 5호수 · 유장 3호수 · 등품−앞품 ' +
    (E.measuresForSize('55호').backW - E.measuresForSize('55호').frontW));
})();

/* ══════════════════════════════════════════════════════════════════════
 * §1. 원문이 「재서 확인하라」고 한 자리 — 그 문장이 곧 검사다
 * ════════════════════════════════════════════════════════════════════ */
head('1. 원문 확인 절차 (전 호수)');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), d = E.draftVest(m, { seam: E.SEAM_DEFAULT });
  var M = d.measures, bad = [], soft = [];

  /* [12] 「2번점과 21번까지의 치수를 재서 2분의어깨치수와 다트분 1.5cm 를 다시한번 확인」 */
  var d221 = V.dist(g.p2, g.p21);
  if (finiteOr(bad, '[12] 2~21', d221) && Math.abs(d221 - (m.shoulderW / 2 + 1.5)) > 0.02)
    bad.push('[12] 2~21 ' + d221.toFixed(3) + ' ≠ 어깨/2 + 1.5 = ' + (m.shoulderW / 2 + 1.5).toFixed(2));

  /* [20] 참고 「유차의치수인 빨간색 별표시한 부분들은 치수가 같아야합니다」 */
  [['13→41', g.p13[1] - g.f41[1]], ['2→44', g.p2[1] - g.f44[1]], ['23→24', g.p23[1] - g.p24[1]]]
  .forEach(function (r) {
    if (finiteOr(bad, '[20] ' + r[0], r[1]) && Math.abs(r[1] - g['유차']) > 0.001)
      bad.push('[20] 유차 별표 ' + r[0] + ' = ' + r[1].toFixed(3) + ' ≠ 유차 ' + g['유차']);
  });

  /* [23] 「오려놓은 뒤판을 가져와서 어깨선을대고 뒤다트분이나 이세분을 뺀 어깨 길이가 같은지 확인」
     ★ [23] 참고는 「51번과 52번의 길이가 같은지」라고 쓰지만, 실제로 꿰매지는 변은
       **53~52** 다(53 = 앞 목옆점). 51~52 로 재면 차가 −1.22 로 오히려 커진다
       (전 호수 측정값). 그래서 봉제선 53~52 로 잰다.
     0.05 는 못 맞춘다(작도가 다르다). 이세로 먹을 수 있는 0.3 을 상한으로 둔다. */
  if (finiteOr(bad, '[23] 어깨 짝', M.shoulderGap)) {
    if (Math.abs(M.shoulderGap) > 0.30)
      bad.push('[23] 어깨 짝 뒤(다트뺀) ' + M.shoulderBackSewn.toFixed(3) + ' vs 앞 ' +
               M.shoulderFront.toFixed(3) + ' — 차 ' + M.shoulderGap.toFixed(3) + ' (이세로 먹기엔 크다)');
    else if (Math.abs(M.shoulderGap) > 0.05)
      soft.push('[23] 어깨 짝 차 ' + M.shoulderGap.toFixed(3) + ' — 뒤가 길다(이세로 넣는다). 26·52 해석이 남은 원인 (이어서-할-일.md 2번)');
  }

  /* [13] 「26번에서부터 암홀자로 암홀선을 그리는데 27번 등품에서 0.5~1 정도 떨어지게」
     ★ 원문은 「26번등품에서」라고 쓰지만 등품선 위의 점은 **27** 이다(26 은 어깨끝).
       원문의 번호 오기로 보고 27 로 잰다 — 도면도 27 자리에서 부푼다. */
  var d27 = nearest(g.bArm, g.p27);
  if (finiteOr(bad, '[13] 암홀↔27', d27) && (d27 < 0.5 - 0.02 || d27 > 1.0 + 0.02))
    bad.push('[13] 뒤 암홀↔27 ' + d27.toFixed(3) + ' (원문 0.5~1)');

  /* [25] 「52번에서부터 암홀을 그리는데 49번점 앞품에서 0.5cm정도 떨어지게」 */
  var d49 = nearest(g.fArm, g.f49);
  if (finiteOr(bad, '[25] 암홀↔49', d49) && Math.abs(d49 - 0.5) > 0.15)
    bad.push('[25] 앞 암홀↔49 ' + d49.toFixed(3) + ' (원문 0.5)');

  /* [16] 「27번점위로 올라가서그리면 안된다」 · [28] 「69번점위로 올라가면 안되며」 */
  if (finiteOr(bad, '[16] 뒤 절개시작', g.p27a[1]) && g.p27a[1] < g.p27[1] - 1e-6)
    bad.push('[16] 뒤 절개선 시작이 27 위로 올라갔다 (' + g.p27a[1].toFixed(2) + ' < ' + g.p27[1].toFixed(2) + ')');
  if (finiteOr(bad, '[28] 앞 절개시작', g.f67[1]) && g.f67[1] < g.f69[1] - 1e-6)
    bad.push('[28] 앞 절개선 시작 67 y=' + g.f67[1].toFixed(2) + ' 이 69 y=' + g.f69[1].toFixed(2) + ' 위로 올라갔다');

  /* [17] 「암홀쪽 적당한곳 35점에서 다트쪽으로 선을 그리고 … MP 해야할 36번을 그립니다」
     ★ 35 는 **암홀선 위**의 점이다. 도면(9_뒤판이미지2)에서도 MP 두 줄이 암홀 위에서
       시작해 33(다트) 으로 내려간다. 암홀에서 떨어져 있으면 접을 자리가 종이에 없다. */
  var d35 = nearest(g.bArm, g.p35);
  if (finiteOr(bad, '[17] 35↔암홀', d35) && d35 > 0.05)
    bad.push('[17] MP 시작점 35 가 암홀선에서 ' + d35.toFixed(3) + 'cm 떨어져 있다 — 35 는 암홀 위의 점이다(26~11 현이 아니라)');
  /* MP 분량은 [17] 0.5~0.8 · [39] 0.5~1 — 실제로 그 길이로 그렸는가 */
  var mpB = V.dist(g.p35, g.p36), mpF = V.dist(g.fMp, g.fMpTo);
  if (finiteOr(bad, '뒤 MP 길이', mpB) && Math.abs(mpB - K.mpBack) > 0.02)
    bad.push('뒤 MP 선 길이 ' + mpB.toFixed(3) + ' ≠ mpBack ' + K.mpBack);
  if (finiteOr(bad, '앞 MP 길이', mpF) && Math.abs(mpF - K.mpFront) > 0.02)
    bad.push('앞 MP 선 길이 ' + mpF.toFixed(3) + ' ≠ mpFront ' + K.mpFront);

  /* [19] 「38번에서 22번까지의 치수를 2등분하여 다트 중심선인 39번점」
     — 계산한 39 와 **실제로 그린 다트 중심**이 같은가 (계산만 하고 딴 데 그리면 거짓말) */
  var drawn = null;
  d.pieces.forEach(function (p) {
    (p.internal || []).forEach(function (it) { if (it.id === 'shDartB') drawn = it.pts; });
  });
  if (!drawn) bad.push('[19] 뒤 어깨 다트(shDartB)가 어느 조각에도 안 그려졌다');
  else {
    var dc = [(drawn[0][0] + drawn[2][0]) / 2, (drawn[0][1] + drawn[2][1]) / 2];
    var legs = V.dist(drawn[0], drawn[2]), lenD = V.dist(dc, drawn[1]);
    if (Math.abs(legs - 1.5) > 0.02) bad.push('[19] 어깨 다트 벌린 폭 ' + legs.toFixed(3) + ' ≠ [10] 다트 1.5');
    if (Math.abs(lenD - 7.0) > 0.02) bad.push('[19] 어깨 다트 길이 ' + lenD.toFixed(3) + ' ≠ 원문 7');
    if (distPoly(dc, [g.p38, g.p26]) > 0.02)
      bad.push('[19] 어깨 다트 중심이 어깨선(38~26) 위에 없다 — 다트가 봉제선 밖에 선다');
    if (V.dist(dc, g.p39) > 0.05)
      soft.push('[19] 그린 다트 중심과 39(38~22 의 2등분)가 ' + V.dist(dc, g.p39).toFixed(3) +
                'cm 다르다 — 원문의 39 는 어깨선 위가 아니어서(' + distPoly(g.p39, [g.p38, g.p26]).toFixed(2) +
                ' 밖) 엔진은 어깨선의 2등분점에 그린다');
  }

  /* 원문 0. 「뒤품이 앞품보다 1.5 정도 많은 것이 정상」의 귀결 — 뒤 AH ≥ 앞 AH */
  if (finiteOr(bad, 'AH', M.ahBack) && M.ahBack < M.ahFront)
    bad.push('뒤 AH ' + M.ahBack.toFixed(2) + ' < 앞 AH ' + M.ahFront.toFixed(2) + ' — 뒤가 커야 한다');

  row(sz, bad, soft,
    '2~21 ' + f(d221, 6) + ' · 어깨 뒤 ' + f(M.shoulderBackSewn, 6) + ' 앞 ' + f(M.shoulderFront, 6) +
    ' 차 ' + f(M.shoulderGap, 6, 3) + ' · AH 뒤 ' + f(M.ahBack, 6) + ' 앞 ' + f(M.ahFront, 6) +
    ' · ↔27 ' + f(d27, 5) + ' ↔49 ' + f(d49, 5) + ' · 35↔암홀 ' + f(d35, 5));
});

/* ══════════════════════════════════════════════════════════════════════
 * §2. 제도 상수 K 가 원문이 허용한 폭 안에 있는가 (전부 리터럴)
 *     ★ §3 의 번호점 식이 K 를 쓰는 자리는 여기가 지킨다. 여기가 없으면
 *       K 를 아무 값으로 바꿔도 §3 이 따라 움직여 늘 통과한다.
 * ════════════════════════════════════════════════════════════════════ */
head('2. 제도 상수 K 가 원문 범위 안인가 (리터럴 범위)');
(function () {
  var bad = [], soft = [];
  /* [키, 최소, 최대, 원문] — 최소=최대면 원문이 하나로 못 박은 값 */
  var R = [
    ['armDepthAdd',  1.5, 1.5, '[2] 4분의B더하기 1.5'],
    ['cbIn',         1.5, 1.5, '[5] 1.5씩 나간곳 7·8·9'],
    ['chestEase',    1.5, 2.0, '[7] 4분의유B 더하기 (1.5~2)'],
    ['hipEase',      1.0, 1.5, '[8] 여유분 1.5 (도면 H/4+여유 1~1.5)'],
    ['waistEase',    1.5, 2.0, '[9] 여유분 (1.5~2)'],
    ['backDart',     2.0, 2.5, '[9] 다트분 (2~2.5)'],
    ['shDart',       1.5, 1.5, '[10] 20번에서 다트 1.5'],
    ['shSlope',      1.3, 1.5, '[10] 어깨기울기 1.3~1.5'],
    ['shScoop',      1.5, 1.5, '[12] 21번에서 1.5'],
    ['armFromBW',    0.5, 1.0, '[13] 0.5~1 정도 떨어지게'],
    ['splitIn',      2.0, 3.0, '[14] 11번에서 2~3 안쪽'],
    ['hemUp',        5.0, 5.0, '[14] 29번에서 5cm · [27] 59번에서 5cm'],
    ['mpAt',         0.0, 1.0, '[17] 암홀쪽 적당한곳 (비율)'],
    ['mpBack',       0.5, 0.8, '[17] 약 0.5~0.8'],
    ['mpFront',      0.5, 1.0, '[39] 0.5~1'],
    ['neckOut',      1.5, 1.5, '[18] 24번에서 1.5'],
    ['shDartLen',    7.0, 7.0, '[19] 다트길이 7'],
    ['frontShDrop',  4.5, 4.5, '[21] 47번 아래로 4.5'],
    ['fNeckDrop',    1.0, 1.0, '[22] 50번에서 1 내려온곳'],
    ['fShScoop',     1.5, 1.5, '[23] 20번점에서 1.5'],
    ['fNeckOut',     1.5, 1.5, '[23] 51번점에서 1.5'],
    ['bpOut',        1.5, 2.0, '[26] 57번에서 1.5~2'],
    ['frontDart',    2.0, 3.0, '[24] 참고 「보통 앞다트가 2~3」 (기본은 남는 양이라 안 쓰인다)'],
    ['frontDrop',    2.5, 2.5, '[38] 앞처짐분량 2.5'],
    ['frontWrap',    2.0, 2.5, '[38] 앞여밈분 얇은원단 2 · 두꺼운원단 2.5'],
    ['frontArmGap',  0.5, 0.5, '[25] 49번 앞품에서 0.5']
  ];
  R.forEach(function (r) {
    var v = K[r[0]];
    if (v === undefined) { bad.push('K.' + r[0] + ' 가 없다 — ' + r[3]); return; }
    if (!finiteOr(bad, 'K.' + r[0], v)) return;
    if (v < r[1] - 1e-9 || v > r[2] + 1e-9)
      bad.push('K.' + r[0] + ' = ' + v + ' 이 원문 ' +
        (r[1] === r[2] ? r[1] : r[1] + '~' + r[2]) + ' 밖이다 — ' + r[3]);
  });
  /* 원문에 없는 K 가 늘어나면 알려 준다 (죽은 상수·원피스 잔재 감시) */
  var known = {}; R.forEach(function (r) { known[r[0]] = 1; }); known.splitPanels = 1;
  Object.keys(K).forEach(function (k) {
    if (!known[k]) soft.push('K.' + k + ' 는 이 검산기가 모르는 상수다 (원문 근거를 §2 표에 추가하라)');
  });
  row('K ' + Object.keys(K).length + '개', bad, soft, '원문 범위 대조 ' + R.length + '항목');
})();

/* ══════════════════════════════════════════════════════════════════════
 * §3. 번호점 좌표 — 원문 **식** 그대로인가 (전 호수)
 *     기대값은 식을 다시 쓴 것이지 엔진 값의 사본이 아니다.
 * ════════════════════════════════════════════════════════════════════ */
head('3. 번호점 좌표 — 원문 식 그대로인가');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), bad = [], soft = [];
  var B = m.B, uB = m['유B'], W = m.W, H = m.H;
  var BL = B / 4 + 1.5, WL = m.backLen, HL = m.backLen + m.hipLen;   // [2][3][4] 리터럴
  var yc = (B < 90) ? 2.5 : 2.8;                                     // [11] 참고
  var sh = m.shoulderW, bw = m.backW, fw = m.frontW, cb = 1.5;       // [5] 리터럴 1.5
  var x11 = cb / 2 + bw / 2, x13 = cb / 2 + uB / 4 + K.chestEase;
  var x16 = cb + H / 4 + K.hipEase, x28 = x11 - K.splitIn;
  var halfHem = (x16 - x13) / 2, x59 = m.bustW / 2 + K.bpOut;
  var fHalf = (x16 - x13) / 2;                                       // [27] (42~16)/2
  /* [24] 56 = 41 에서 「뒤판이 들어온 만큼(13→19)」 = 결국 19번의 x 다.
     그래서 앞 다트분(56−55)은 1.5(등솔선 나간 양) + 뒤 다트분이 된다 — 엔진 값을
     베끼지 않고 여기서 따로 세운다. */
  var x19 = cb + W / 4 + K.waistEase + K.backDart, x55 = W / 4 + K.waistEase;
  var fDart = x19 - x55;
  /* [38][40] 앞 밑단은 앞처짐 때문에 **기울어진 직선** 71~16 — 59·60·61·62·66 이 그 위다 */
  /* 앞 밑단 = 71(−여밈, HL+앞처짐) → **42**(x13, HL) 직선. 원문 [40] 의 「16」은
     앞판에선 42 다 — 뒤판 16(H/4+여유를 뒤중심에서 잰 것)을 쓰면 여밈분만큼
     더 나가 완성 엉덩이가 H 보다 커진다 (2026-08-14 사용자 지적 → 엔진 수정).
     ⚠ 엔진을 42 로 옮긴 뒤에도 **이 식이 16 을 보고 있어** 59·60·61 이 0.06
       어긋난 채 85건이 실패했다. 검사 기대값도 같이 옮겨야 한다. */
  function hemY(x) { return (HL + 2.5) + (HL - (HL + 2.5)) * (x - (-K.frontWrap)) / (x13 - (-K.frontWrap)); }
  var T = [
    ['[2] 4',   g.p4,  [0, BL],                          '2에서 B/4+1.5'],
    ['[3] 5',   g.p5,  [0, m.backLen],                   '2에서 등길이'],
    ['[4] 3',   g.p3,  [0, HL],                          '5에서 엉덩이길이'],
    ['[5] 6',   g.p6,  [0, BL / 3],                      '2~4 의 3등분'],
    ['[5] 7',   g.p7,  [cb, BL],                         '4에서 1.5'],
    ['[5] 8',   g.p8,  [cb, WL],                         '5에서 1.5'],
    ['[5] 9',   g.p9,  [cb, HL],                         '3에서 1.5'],
    ['[7] 10',  g.p10, [cb / 2, BL],                     '4~7 의 2등분'],
    ['[7] 11',  g.p11, [x11, BL],                        '10에서 등품/2'],
    ['[7] 12',  g.p12, [x11, 0],                         '11에서 직선으로 올려'],
    ['[7] 13',  g.p13, [x13, BL],                        '10에서 유B/4+(1.5~2)'],
    ['[7] 14',  g.p14, [x13, HL],                        '13에서 직선으로 내려'],
    ['[8] 15',  g.p15, [cb + H / 4, HL],                 '9에서 H/4'],
    ['[8] 16',  g.p16, [x16, HL],                        '15에서 여유'],
    ['[9] 17',  g.p17, [cb + W / 4, WL],                 '8에서 W/4'],
    ['[9] 18',  g.p18, [cb + W / 4 + K.waistEase, WL],   '17에서 여유'],
    ['[9] 19',  g.p19, [cb + W / 4 + K.waistEase + K.backDart, WL], '18에서 다트분'],
    ['[10] 20', g.p20, [sh / 2, 0],                      '2에서 어깨/2'],
    ['[10] 21', g.p21, [sh / 2 + 1.5, 0],                '20에서 다트 1.5'],
    ['[10] 22', g.p22, [x11, K.shSlope],                 '12에서 어깨기울기'],
    ['[11] 23', g.p23, [B / 12, 0],                      '2에서 B/12'],
    ['[11] 24', g.p24, [B / 12, -yc],                    '23에서 유차 올라간 곳'],
    ['[11] 25', g.p25, [B / 12 + 1.0, -yc],              '24 직각 표시'],
    ['[12] 26', g.p26, [sh / 2 + 1.5, 1.5],              '21에서 1.5 (어깨를 판다)'],
    ['[13] 27', g.p27, [x11, (K.shSlope + BL) / 2],      '22~11 의 2등분'],
    ['[14] 28', g.p28, [x28, BL],                        '11에서 2~3 안쪽'],
    ['[14] 29', g.p29, [x28, HL],                        '28에서 직선으로 내려'],
    ['[14] 30', g.p30, [x28, HL - 5],                    '29에서 5 올라간 곳'],
    ['[15] 31', g.p31, [x28 + halfHem, HL],              '29 양쪽으로 (14~16)/2'],
    ['[15] 32', g.p32, [x28 - halfHem, HL],              '29 양쪽으로 (14~16)/2'],
    ['[16] 33', g.p33, [x28 + K.backDart / 2, WL],       'W 다트분을 양쪽으로'],
    ['[16] 34', g.p34, [x28 - K.backDart / 2, WL],       'W 다트분을 양쪽으로'],
    ['[17] 36', g.p36, [g.p35[0] - K.mpBack, g.p35[1]],  '35에서 MP 분량'],
    ['[18] 37', g.p37, [B / 12 / 3, 0],                  '2~23 의 3등분'],
    ['[18] 38', g.p38, [B / 12 + 1.5, -yc],              '24에서 1.5 나간 곳'],
    ['[19] 39', g.p39, [(B / 12 + 1.5 + x11) / 2, (-yc + K.shSlope) / 2], '38~22 의 2등분'],
    /* ── 앞판 ── */
    ['[20] 41', g.f41, [x13, BL - yc],                   '13에서 유차 올라간 곳'],
    ['[20] 42', g.f42, [x13, HL],                        '41에서 직각으로 내린 곳'],
    ['[20] 43', g.f43, [0, BL - yc],                     '41 높이의 앞중심'],
    ['[20] 44', g.f44, [0, -yc],                         '2에서 유차 올라간 곳'],
    ['[21] 46', g.f46, [fw / 2, BL - yc],                '43에서 앞품/2'],
    ['[21] 47', g.f47, [fw / 2, -yc],                    '46에서 직선으로 올린 곳(45선)'],
    ['[21] 48', g.f48, [fw / 2, -yc + 4.5],              '47 아래로 4.5'],
    ['[21] 49', g.f49, [fw / 2, (BL - yc) - BL / 3],     '46~47 의 3등분'],
    ['[22] 50', g.f50, [B / 12, -yc],                    '23에서 직선으로 올린 곳'],
    ['[22] 51', g.f51, [B / 12, -yc + 1.0],              '50에서 1 내려온 곳'],
    ['[23] 52', g.f52, [sh / 2, 1.5],                    '20에서 1.5 내려온 곳'],
    ['[23] 53', g.f53, [B / 12 + 1.5, -yc + 1.0],        '51에서 1.5 나간 곳'],
    ['[24] 54', g.f54, [W / 4, WL],                      '5에서 W/4'],
    ['[24] 55', g.f55, [x55, WL],                        '54에서 여유'],
    ['[24] 56', g.f56, [x19, WL],                        '41에서 뒤판(13→19)만큼 들어온 곳 = 19번의 x'],
    ['[26] 57', g.f57, [m.bustW / 2, m.bustLen],         'BP = (유폭/2, 유장)'],
    ['[26] 58', g.f58, [x59, m.bustLen],                 '57에서 1.5~2'],
    ['[27] 59', g.f59, [x59, hemY(x59)],                 '58에서 밑단까지 직선으로 내린 곳'],
    ['[27] 60', g.f60, [x59 + fHalf, hemY(x59 + fHalf)], '59 양쪽으로 (42~16)/2'],
    ['[27] 61', g.f61, [x59 - fHalf, hemY(x59 - fHalf)], '59 양쪽으로 (42~16)/2'],
    ['[27] 62', g.f62, [x59, hemY(x59) - 5],             '59에서 5 올라간 곳'],
    ['[27] 63', g.f63, [x59 + fDart / 2, WL],            'W선에서 앞다트분(56−55) 양쪽'],
    ['[27] 64', g.f64, [x59 - fDart / 2, WL],            'W선에서 앞다트분(56−55) 양쪽'],
    ['[27] 65', g.f65, [x13, BL - yc + 5],               '41에서 5 내려간 곳'],
    ['[27] 66', g.f66, [x59, hemY(x59) + yc],            '59에서 유차 내려간 곳'],
    ['[28] 68', g.f68, [x59, m.bustLen],                 '68 = 58 (앞절개선이 BP 로)'],
    ['[28] 69', g.f69, [fw / 2, ((BL - yc) + (-yc + 4.5)) / 2], '46~48 의 2등분'],
    ['[38] 70', g.f70, [0, HL + 2.5],                    '3에서 앞처짐 2.5'],
    ['[38] 71', g.f71, [-K.frontWrap, HL + 2.5],         '70에서 앞여밈분'],
    ['[38] 72', g.f72, [-K.frontWrap, BL - yc],          '71에서 위로 (앞목선과 만난다)']
  ];
  var worst = 0, worstName = '';
  T.forEach(function (r) {
    if (!r[1] || !isFinite(r[1][0]) || !isFinite(r[1][1])) { bad.push(r[0] + ' 가 없다/NaN'); return; }
    var e = Math.max(Math.abs(r[1][0] - r[2][0]), Math.abs(r[1][1] - r[2][1]));
    if (e > worst) { worst = e; worstName = r[0]; }
    if (e > 0.001) bad.push(r[0] + ' (' + r[1][0].toFixed(3) + ',' + r[1][1].toFixed(3) + ') ≠ (' +
      r[2][0].toFixed(3) + ',' + r[2][1].toFixed(3) + ')  ← ' + r[3]);
  });
  /* 앞 다트분은 「정해진 치수」가 아니라 **남는 양**이라야 한다 ([24] 참고) */
  if (finiteOr(bad, '앞 다트분', g.frontDart) && Math.abs(g.frontDart - fDart) > 0.002)
    bad.push('[24] 앞 다트분 ' + g.frontDart.toFixed(3) + ' ≠ 56−55 = ' + fDart.toFixed(3) + ' (남는 양)');
  else if (g.frontDart < 2 || g.frontDart > 3)
    soft.push('[24] 참고 「보통 앞다트가 2~3」인데 남는 양이 ' + g.frontDart.toFixed(2) + ' 이다 (= 1.5 + 뒤다트분)');
  row(sz, bad, soft, '번호점 ' + T.length + '개 · 최대 오차 ' + f(worst, 7, 4) + (worstName ? ' (' + worstName + ')' : ''));
});

/* ══════════════════════════════════════════════════════════════════════
 * §4. 조각 구성 · 닫힘 — 통짜 2조각 · 암홀라인 절개 4조각
 * ════════════════════════════════════════════════════════════════════ */
head('4. 조각 구성과 닫힘');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), bad = [], soft = [], worstGap = 0, worstStep = 0;
  var WANT = {
    0: [['back', '뒤판'], ['front', '앞판']],
    1: [['back', '뒤중심'], ['backSide', '뒤옆'], ['front', '앞중심'], ['frontSide', '앞옆']]
  };
  [0, 1].forEach(function (sp) {
    var d = E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: sp });
    var want = WANT[sp];
    if (d.pieces.length !== want.length)
      bad.push('sp' + sp + ' 조각 ' + d.pieces.length + '장 (원문 ' + want.length + '장)');
    want.forEach(function (w, i) {
      var p = d.pieces[i];
      if (!p) { bad.push('sp' + sp + ' ' + w[0] + ' 조각이 없다'); return; }
      if (p.id !== w[0] || p.name !== w[1])
        bad.push('sp' + sp + ' 조각 ' + i + ' 이 ' + p.id + '/' + p.name + ' — ' + w[0] + '/' + w[1] + ' 이라야 한다');
    });
    d.pieces.forEach(function (p) {
      var n = p.edges.length;
      for (var i = 0; i < n; i++) {
        var a = p.outline[p.edges[i].end], b = p.outline[p.edges[(i + 1) % n].start];
        var gp = V.dist(a, b);
        if (gp > worstGap) worstGap = gp;
        if (gp > E.FLATTEN * 2)
          bad.push('sp' + sp + ' ' + p.id + ' 「' + p.edges[i].name + '」→「' +
                   p.edges[(i + 1) % n].name + '」 ' + gp.toFixed(3) + 'cm 벌어짐');
        if (p.edges[i].end <= p.edges[i].start)
          bad.push('sp' + sp + ' ' + p.id + ' 「' + p.edges[i].name + '」 가 길이 0 이다');
      }
      /* 골선이 없으면 좌우 2장. 조끼 뒤중심은 굽은 등솔선이라 접을 수 없다 */
      if (p.foldEdges.length === 0 && p.cutCount < 2)
        bad.push('sp' + sp + ' ' + p.id + ' 골선이 없는데 재단 ' + p.cutCount + '장 — 좌우 2장이라야 한다');
      /* 재단선 점 간격 (SPEC: 곡선 0.5mm 이하) */
      for (i = 1; i < p.outline.length; i++) {
        var st = V.dist(p.outline[i - 1], p.outline[i]);
        if (st > worstStep) worstStep = st;
      }
      p.outline.forEach(function (q) {
        if (!isFinite(q[0]) || !isFinite(q[1])) bad.push('sp' + sp + ' ' + p.id + ' outline 에 NaN');
      });
      p.seamline.forEach(function (q) {
        if (!isFinite(q[0]) || !isFinite(q[1])) bad.push('sp' + sp + ' ' + p.id + ' seamline 에 NaN');
      });
      var h1 = selfHits(p.outline), h2 = selfHits(p.seamline);
      if (h1) bad.push('sp' + sp + ' ' + p.id + ' 재단선이 스스로 ' + h1 + '번 교차한다');
      if (h2) bad.push('sp' + sp + ' ' + p.id + ' 시접선이 스스로 ' + h2 + '번 교차한다');
    });
  });
  if (worstStep > 0.06) bad.push('재단선 점 간격 ' + worstStep.toFixed(3) + 'cm (SPEC 0.06 이하)');
  row(sz, bad, soft, '최대 틈 ' + f(worstGap, 7, 4) + 'cm · 최대 점간격 ' + f(worstStep, 6, 4) + 'cm');
});

/* ══════════════════════════════════════════════════════════════════════
 * §5. 봉제 짝 — 맞물리는 변의 길이와 너치가 맞는가
 * ════════════════════════════════════════════════════════════════════ */
head('5. 봉제 짝 (옆선 · 절개선 · 너치 호길이)');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m);
  var d = E.draftVest(m, { seam: E.SEAM_DEFAULT }), M = d.measures;
  var bad = [], soft = [];

  [['뒤', M.splitBackIn, M.splitBackOut], ['앞', M.splitFrontIn, M.splitFrontOut]].forEach(function (r) {
    var dd = r[1] - r[2];
    if (!finiteOr(bad, r[0] + ' 절개선', dd)) return;
    if (Math.abs(dd) > 0.6) bad.push(r[0] + ' 절개선 두 변 차 ' + dd.toFixed(3) + ' — 이세로 보기엔 크다');
    else if (Math.abs(dd) > 0.3) soft.push(r[0] + ' 절개선 두 변 차 ' + dd.toFixed(3));
  });

  /* 옆선 — 아직 못 고친 자리. 유차만큼 어긋나는 것은 원문 구조 그대로이고
     (41 이 13 에서 유차 올라간 점 [20]), 그 이상 어긋나면 작도가 깨진 것이다.
     ★ 도면 11_앞판이미지 는 41 에서 5 내려간 65 와 거기서 **유차만큼 더** 내려간
       점을 둘 다 BP 로 이어 놓고 그 사이를 빨간 별(유차)로 묶었다 — 즉 원문이
       예로 든 옆다트의 분량이 곧 유차다. 그 다트를 넣으면 이 경고가 사라진다. */
  if (finiteOr(bad, '옆선 차', M.sideGap)) {
    if (Math.abs(M.sideGap - M['유차']) > 0.1)
      bad.push('옆선 차 ' + M.sideGap.toFixed(3) + ' 가 유차 ' + M['유차'] + ' 와 다르다 — 유차 말고 다른 이유로 어긋났다');
    else
      soft.push('옆선 차 ' + M.sideGap.toFixed(3) + ' = 유차 ' + M['유차'] +
                ' — [27] 이 열어 둔 앞 다트(65 옆다트 / 66 밑단다트)를 아직 안 넣었다');
  }

  /* 너치 짝 — **호길이**로 맞아야 한다. 높이(y)로만 잡으면 곡률이 다른 쪽에서 밀린다 */
  var P = {}; d.pieces.forEach(function (p) { P[p.id] = p; });
  [['뒤', 'back', 'backSide', g.bSplitIn, g.bSplitOut, ['진동선', '허리', '엉덩이']],
   ['앞', 'front', 'frontSide', g.fSplitIn, g.fSplitOut, ['BP', '허리', '엉덩이']]].forEach(function (r) {
    var A = P[r[1]], Bp = P[r[2]];
    if (!A || !Bp) { bad.push(r[0] + ' 절개 조각이 없다'); return; }
    r[5].forEach(function (lab) {
      var na = A.notches.filter(function (n) { return n.label === lab; })[0];
      var nb = Bp.notches.filter(function (n) { return n.label === lab; })[0];
      if (!na || !nb) { bad.push(r[0] + ' 절개선 너치 「' + lab + '」 가 한쪽에만 있다'); return; }
      var a = arcAt(r[3], na.p), b = arcAt(r[4], nb.p);
      if (a.snap > 0.05 || b.snap > 0.05)
        bad.push(r[0] + ' 너치 「' + lab + '」 가 절개선 위에 없다 (' + a.snap.toFixed(2) + '/' + b.snap.toFixed(2) + ')');
      var dd = a.s - b.s;
      if (Math.abs(dd) > 0.5) bad.push(r[0] + ' 너치 「' + lab + '」 호길이 짝 차 ' + dd.toFixed(3) + 'cm');
      else if (Math.abs(dd) > 0.25) soft.push(r[0] + ' 너치 「' + lab + '」 호길이 짝 차 ' + dd.toFixed(3) + 'cm');
    });
  });

  /* 엔진이 스스로 낸 경고는 반드시 화면에 나와야 한다 */
  d.warnings.forEach(function (w) { soft.push('엔진 경고: ' + w); });

  row(sz, bad, soft,
    '옆선 뒤 ' + f(M.sideBack, 6) + ' 앞 ' + f(M.sideFront, 6) + ' 차 ' + f(M.sideGap, 6, 3) +
    ' · 절개선 뒤 ' + f(M.splitBackIn, 6) + '/' + f(M.splitBackOut, 6) +
    ' 앞 ' + f(M.splitFrontIn, 6) + '/' + f(M.splitFrontOut, 6));
});

/* ══════════════════════════════════════════════════════════════════════
 * §6. 절개선 연결 규칙 — [16] 33→32 · 34→31 · [29] 63→61 · 64→60
 *     ★ 원문이 번호를 짝지어 **열거**한 자리다. 도면(9_뒤판이미지2 · 11_앞판이미지)
 *       에도 두 곡선이 30(앞은 62)에서 **X 자로 교차**한다.
 *       교차하지 않으면 밑단이 벌어지는 대신 좁아져 치마폭이 사라진다.
 * ════════════════════════════════════════════════════════════════════ */
head('6. 절개선 연결 — 허리에서 밑단으로 건너가며 교차하는가');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), bad = [], soft = [], info = [];
  [['뒤', g.bSplitIn, g.bSplitOut, g.p34, g.p33, g.p31, g.p32, g.p30, g.p29,
    '[16] 34번에서 31번을 연결 · 33번에서 32번을 연결 (30에서 교차)'],
   ['앞', g.fSplitIn, g.fSplitOut, g.f64, g.f63, g.f60, g.f61, g.f62, g.f59,
    '[29] 64번과 60번을 연결 · 63번과 61번을 연결 (62에서 교차)']].forEach(function (r) {
    var inn = r[1], out = r[2], wIn = r[3], wOut = r[4], hFar = r[5], hNear = r[6], tip = r[7], mid = r[8];
    var pIn = U.sampleSegs(inn, 0.02), pOut = U.sampleSegs(out, 0.02);
    var endIn = pIn[pIn.length - 1], endOut = pOut[pOut.length - 1];
    /* 중심 쪽 변은 허리에서 **안쪽**(34·64)에 있다가 밑단에서 **바깥쪽**(31·60) 으로 건너간다 */
    var sIn = (wIn[0] - mid[0]) * (endIn[0] - mid[0]);
    var sOut = (wOut[0] - mid[0]) * (endOut[0] - mid[0]);
    if (sIn > 0)
      bad.push(r[0] + ' 중심쪽 절개선이 허리(' + wIn[0].toFixed(2) + ')와 밑단(' + endIn[0].toFixed(2) +
        ')에서 같은 쪽이다 — 밑단 끝이 ' + hFar[0].toFixed(2) + ' 라야 한다. ' + r[8 + 1]);
    if (sOut > 0)
      bad.push(r[0] + ' 옆쪽 절개선이 허리(' + wOut[0].toFixed(2) + ')와 밑단(' + endOut[0].toFixed(2) +
        ')에서 같은 쪽이다 — 밑단 끝이 ' + hNear[0].toFixed(2) + ' 라야 한다');
    /* 「30번이 교차되게」 — 스치듯 만나든 가로지르든 **두 선이 30 에서 붙어야** 한다.
       엄밀한 선분교차만 보면 30 을 공통 앵커로 지나갈 때(정확히 접할 때) 0 이 나와
       고친 제도를 도로 실패시킨다. 그래서 **두 곡선의 최단거리와 그 자리**로 잰다. */
    /* ⚠ 두 곡선은 **시작점(27a·67)을 공유**한다 — 그 자리를 빼지 않으면 최단거리가
       늘 0 이 나와 검사가 통째로 무의미해진다. 만나야 할 곳은 허리 아래다. */
    var yFloor = wIn[1] + 0.5;
    var qa = U.sampleSegs(inn, 0.05).filter(function (p) { return p[1] > yFloor; });
    var qb = U.sampleSegs(out, 0.05).filter(function (p) { return p[1] > yFloor; });
    var md = Infinity, at = null;
    for (var i = 0; i < qa.length; i++) for (var j = 0; j < qb.length; j++) {
      var dd = V.dist(qa[i], qb[j]);
      if (dd < md) { md = dd; at = qa[i]; }
    }
    if (!finiteOr(bad, r[0] + ' 절개선 최단거리', md)) return;
    if (md > 0.15)
      bad.push(r[0] + ' 두 절개선이 ' + (r[0] === '뒤' ? '30' : '62') + ' 에서 만나지 않는다 — 가장 가까운 자리도 ' +
               md.toFixed(2) + 'cm 벌어져 있다 (원문: 30번이 교차되게)');
    else if (V.dist(at, tip) > 0.5)
      bad.push(r[0] + ' 절개선이 만나는 자리가 ' + (r[0] === '뒤' ? '30' : '62') + ' 에서 ' +
               V.dist(at, tip).toFixed(2) + 'cm 떨어졌다');
    else if (V.dist(at, tip) > 0.15)
      soft.push(r[0] + ' 절개선 교차점이 ' + V.dist(at, tip).toFixed(2) + 'cm 어긋났다');
    info.push(r[0] + ' 밑단끝 ' + f(endIn[0], 6) + '/' + f(endOut[0], 6) + ' 최단 ' + f(md, 5));
  });
  row(sz, bad, soft, info.join(' · '));
});

/* ══════════════════════════════════════════════════════════════════════
 * §7. 시접 — 선언한 폭이 **실제로** 나갔는가
 *     ★ 시접선이 재단선에 붙어 버리면(뾰족한 모서리에서 잘 생긴다) 그 자리는
 *       꿰맬 수가 없다. 「시접을 줬다」는 선언이 아니라 잰 값으로 확인한다.
 * ════════════════════════════════════════════════════════════════════ */
head('7. 시접 실측 (선언값 대비)');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), bad = [], soft = [], worst = { v: 9, s: '' };
  [0, 1].forEach(function (sp) {
    var d = E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: sp });
    d.pieces.forEach(function (p) {
      /* 시접선은 재단선을 **감싸야** 한다 */
      var outCnt = 0;
      p.outline.forEach(function (q) { if (!ptInPoly(q, p.seamline)) outCnt++; });
      if (outCnt) bad.push('sp' + sp + ' ' + p.id + ' 재단선 ' + outCnt + '점이 시접선 밖으로 나갔다');
      /* ★ 변의 **속살**과 **모서리**를 나눠 잰다.
         모서리는 이웃 변과 시접을 나눠 가지므로 좁은 쪽(min) 이 한계다 — 3cm 밑단이
         1.5cm 옆선과 만나는 자리를 3cm 잣대로 재면 멀쩡한 조각이 전부 걸린다.
         속살은 자기 시접이 그대로 나와야 한다. */
      var n = p.edges.length;
      p.edges.forEach(function (e, k) {
        var want = e.seam, MARGIN = 1.2;      // 모서리 영향권(cm) — 이만큼은 속살에서 뺀다
        if (e.role === 'fold') {
          for (var i = e.start; i <= e.end; i++)
            if (distPoly(p.outline[i], p.seamline, true) > 0.01) {
              bad.push('sp' + sp + ' ' + p.id + ' 골선 「' + e.name + '」 에 시접이 붙었다'); break;
            }
          return;
        }
        if (want <= 0) return;
        /* ── 속살 */
        var mn = Infinity, acc = 0, tot = 0, i;
        for (i = e.start + 1; i <= e.end; i++) tot += V.dist(p.outline[i - 1], p.outline[i]);
        for (i = e.start + 1; i <= e.end; i++) {
          acc += V.dist(p.outline[i - 1], p.outline[i]);
          if (acc < MARGIN || tot - acc < MARGIN) continue;
          var v = distPoly(p.outline[i], p.seamline, true);
          if (v < mn) mn = v;
        }
        if (isFinite(mn)) {
          if (mn < worst.v) { worst.v = mn; worst.s = 'sp' + sp + ' ' + p.id + ' ' + e.name; }
          if (mn < 0.3 || mn < want * 0.3)
            bad.push('sp' + sp + ' ' + p.id + ' 「' + e.name + '」 시접이 ' + mn.toFixed(2) +
                     'cm 까지 얇아진다 (선언 ' + want + ') — 그 자리는 못 꿰맨다');
          else if (mn < want * 0.7)
            soft.push('sp' + sp + ' ' + p.id + ' 「' + e.name + '」 시접 최소 ' + mn.toFixed(2) + ' (선언 ' + want + ')');
        }
        /* ── 모서리 (이 변의 끝점 = 다음 변의 시작점) */
        var nx = p.edges[(k + 1) % n], lim = Math.min(want, nx.seam);
        if (lim <= 0) return;
        var cd = distPoly(p.outline[e.end], p.seamline, true);
        if (!finiteOr(bad, 'sp' + sp + ' ' + p.id + ' ' + e.name + ' 모서리', cd)) return;
        if (cd < worst.v) { worst.v = cd; worst.s = 'sp' + sp + ' ' + p.id + ' ' + e.name + '↔' + nx.name + ' 모서리'; }
        if (cd < 0.3 || cd < lim * 0.3)
          bad.push('sp' + sp + ' ' + p.id + ' 「' + e.name + '」↔「' + nx.name + '」 모서리 시접이 ' +
                   cd.toFixed(2) + 'cm 밖에 안 된다 (두 변 중 좁은 쪽 ' + lim + ') — 그 모서리는 못 꿰맨다');
        else if (cd < lim * 0.7)
          soft.push('sp' + sp + ' ' + p.id + ' 「' + e.name + '」↔「' + nx.name + '」 모서리 시접 ' + cd.toFixed(2) + ' (좁은 쪽 ' + lim + ')');
      });
    });
  });
  row(sz, bad, soft, '가장 얇은 시접 ' + f(worst.v, 5) + 'cm  (' + worst.s + ')');
});

/* ══════════════════════════════════════════════════════════════════════
 * §8. 종이 위에 있는가 — 너치와 제도 표시
 *     ★ 이 프로젝트에서 이미 두 번 터진 자리다 (BP 너치가 허공에 10cm,
 *       어깨 다트를 계산만 하고 안 그림). 「그렸다」를 좌표로 확인한다.
 * ════════════════════════════════════════════════════════════════════ */
head('8. 너치·제도 표시가 자기 조각 위에 있는가');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), bad = [], soft = [], worstN = 0;
  /* 전폭으로 긋는 안내선은 조각 밖으로 나가는 것이 정상이다 — 접거나 표시하는
     것만 본다. dashed 안내선 중에서도 MP 는 **접는 지시**라 종이에 있어야 한다. */
  var GUIDE = { blB: 1, wlB: 1, hlB: 1, bwB: 1, cbB: 1, blF: 1, wlF: 1, hlF: 1, fwF: 1, snF: 1, cfF: 1 };
  [0, 1].forEach(function (sp) {
    var d = E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: sp });
    d.pieces.forEach(function (p) {
      (p.notches || []).forEach(function (n) {
        var e = distPoly(n.p, p.outline, true);
        if (e > worstN) worstN = e;
        if (e > 0.05) bad.push('sp' + sp + ' ' + p.id + ' 너치 「' + n.label + '」 가 재단선에서 ' + e.toFixed(2) + 'cm 떨어져 있다');
        if (!isFinite(n.angle)) bad.push('sp' + sp + ' ' + p.id + ' 너치 「' + n.label + '」 각도가 NaN');
      });
      (p.internal || []).forEach(function (it) {
        if (GUIDE[it.id]) return;
        var on = it.pts.some(function (q) { return ptInPoly(q, p.outline) || distPoly(q, p.outline, true) < 0.05; });
        if (on) return;
        var far = Math.min.apply(null, it.pts.map(function (q) { return distPoly(q, p.outline, true); }));
        /* 0.5 를 넘으면 **딴 조각의 표시**가 딸려온 것이다 (공통 guide 를 두 조각에 다
           붙였을 때 생긴다). 그 아래는 절개선을 걸친 표시가 선 밖으로 조금 나간 것 —
           고쳐야 하지만 재단을 망치지는 않으므로 경고로 둔다. */
        if (far > 0.5)
          bad.push('sp' + sp + ' ' + p.id + ' 제도 표시 「' + it.label + '」(' + it.id + ') 가 조각 밖 ' +
                   far.toFixed(2) + 'cm 허공에 있다 — 이 조각의 표시가 아니다');
        else
          soft.push('sp' + sp + ' ' + p.id + ' 제도 표시 「' + it.label + '」(' + it.id + ') 가 재단선 밖 ' +
                    far.toFixed(2) + 'cm 에 걸쳐 있다');
      });
    });
  });
  row(sz, bad, soft, '너치 최대 이탈 ' + f(worstN, 6, 3) + 'cm');
});

/* ══════════════════════════════════════════════════════════════════════
 * §9. 완성 치수 · 그레이딩
 *     ★ 실측 상수가 섞이면 여기서 무너진다. 단조 증가만 보면 못 잡는다 —
 *       **치수를 흔들어 완성치수가 따라오는지**까지 본다.
 * ════════════════════════════════════════════════════════════════════ */
head('9. 완성 치수와 그레이딩');
var prev = null, gradeRec = [];
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), d = E.draftVest(m, { seam: E.SEAM_DEFAULT }), M = d.measures;
  var bad = [], soft = [];
  [['가슴', M.chestFinish, m['유B']], ['허리', M.waistFinish, m.W], ['엉덩이', M.hipFinish, m.H]].forEach(function (r) {
    if (!finiteOr(bad, '완성 ' + r[0], r[1])) return;
    if (r[1] <= r[2]) bad.push('완성 ' + r[0] + ' ' + r[1] + ' ≤ 치수 ' + r[2] + ' (여유가 없다)');
    if (r[1] > r[2] + 15) bad.push('완성 ' + r[0] + ' ' + r[1] + ' 이 치수 ' + r[2] + ' 보다 15 이상 크다');
  });
  /* 앞뒤가 같은 식이라야 한다 — 앞 다트를 「남는 양」으로 잡았는지의 검사 */
  var wantW = m.W + 4 * K.waistEase, wantB = m['유B'] + 4 * K.chestEase;
  if (finiteOr(bad, '완성 허리', M.waistFinish) && Math.abs(M.waistFinish - wantW) > 0.02)
    bad.push('완성 허리 ' + M.waistFinish + ' ≠ W + 여유×4 = ' + wantW.toFixed(2) + ' — 앞 다트를 「남는 양」으로 안 잡았다');
  if (finiteOr(bad, '완성 가슴', M.chestFinish) && Math.abs(M.chestFinish - wantB) > 0.02)
    bad.push('완성 가슴 ' + M.chestFinish + ' ≠ 유B + 여유×4 = ' + wantB.toFixed(2));
  /* ★ 보고한 완성 엉덩이가 **실제로 그린 밑단**과 같은가.
     식으로만 계산해 두면 조각을 바꿔도 숫자가 안 따라온다 — 화면의 요약표가
     종이와 다른 말을 하게 된다. 밑단 변의 x 폭을 직접 더해서 맞춰 본다
     (앞여밈분 x<0 은 몸통 둘레가 아니므로 뺀다). */
  var hemSum = 0;
  E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: 1 }).pieces.forEach(function (p) {
    p.edges.forEach(function (e) {
      if (e.role !== 'hem') return;
      /* ⚠ 변의 start 는 **두 번째** 샘플점이다(첫 점은 앞 변이 갖는다). 그대로 쓰면
         모서리 하나만큼 짧게 재서 0.3 쯤 어긋난다 — 앞 변의 끝점을 가져온다. */
      var a = p.outline[e.start === 0 ? 0 : e.start - 1], b = p.outline[e.end];
      hemSum += Math.abs(Math.max(0, b[0]) - Math.max(0, a[0]));
    });
  });
  if (finiteOr(bad, '밑단 실측', hemSum) && Math.abs(M.hipFinish - hemSum * 2) > 0.05)
    bad.push('완성 엉덩이 ' + M.hipFinish + ' 가 실제로 그린 밑단(' + (hemSum * 2).toFixed(2) +
             ') 과 다르다 — 요약표가 조각과 다른 말을 한다');
  if (prev) {
    ['ahBack', 'ahFront', 'shoulderBack', 'shoulderFront', 'chestFinish', 'waistFinish', 'hipFinish']
    .forEach(function (k) {
      if (!(M[k] > prev.M[k]))
        bad.push('그레이딩: ' + k + ' 가 ' + prev.sz + ' ' + prev.M[k] + ' → ' + sz + ' ' + M[k] + ' 로 안 커진다');
    });
    /* ★ 옆선은 **커지지 않는 것이 정상**이다 — 진동깊이(B/4+1.5)와 등길이가 둘 다
       호수당 1.0 씩 자라 (HL − BL) 이 상수다. 「단조 증가」를 기계적으로 걸면 여기서
       멀쩡한 제도가 걸린다. 줄어들기만 안 하면 된다. */
    ['sideBack', 'sideFront'].forEach(function (k) {
      if (M[k] < prev.M[k] - 1e-6)
        bad.push('그레이딩: ' + k + ' 가 ' + prev.sz + ' ' + prev.M[k] + ' → ' + sz + ' ' + M[k] + ' 로 줄었다');
    });
  }
  prev = { sz: sz, M: M };
  gradeRec.push(M);
  row(sz, bad, soft, '가슴 ' + f(M.chestFinish, 6) + ' 허리 ' + f(M.waistFinish, 6) +
    ' 엉덩이 ' + f(M.hipFinish, 6) + ' · 다트 뒤 ' + f(M.backDart, 5) + ' 앞 ' + f(M.frontDart, 5) +
    ' · AH ' + f(M.AH, 6));
});
(function () {
  var bad = [], soft = [];
  /* 등간격인가 — 44~66 과 77~88 은 유차가 달라 완전 등간격일 수는 없으므로 폭을 본다 */
  ['chestFinish', 'waistFinish', 'hipFinish', 'ahBack', 'ahFront'].forEach(function (k) {
    var st = [];
    for (var i = 1; i < gradeRec.length; i++) st.push(gradeRec[i][k] - gradeRec[i - 1][k]);
    var mn = Math.min.apply(null, st), mx = Math.max.apply(null, st);
    if (!isFinite(mn) || !isFinite(mx)) { bad.push(k + ' 등급 폭이 NaN'); return; }
    if (mx - mn > 0.5) bad.push(k + ' 호수별 증가폭이 들쭉날쭉하다: ' + st.map(function (v) { return v.toFixed(2); }).join(' · ') +
      ' — 실측 상수가 섞였을 때 나오는 모양이다');
  });
  /* 치수를 흔들면 완성치수가 따라와야 한다 (단조 증가만으로는 못 잡는다) */
  var m = E.measuresForSize('55호');
  function fin(o) { var x = {}; Object.keys(o).forEach(function (k) { x[k] = o[k]; }); x.seam = E.SEAM_DEFAULT;
                    return E.draftVest(m, x).measures; }
  var base = fin({});
  [['유B', 'chestFinish'], ['W', 'waistFinish'], ['H', 'hipFinish']].forEach(function (r) {
    var o = {}; o[r[0]] = m[r[0]] + 6;
    var got = fin(o)[r[1]] - base[r[1]];
    if (!finiteOr(bad, r[0] + ' 흔들기', got)) return;
    if (Math.abs(got - 6) > 0.5)
      bad.push(r[0] + ' 를 +6 했는데 완성 ' + r[1] + ' 는 ' + got.toFixed(2) + ' 만 움직였다 — 그 치수가 완성치수에 안 닿는다');
  });
  row('그레이딩', bad, soft, '증가폭 가슴 ' +
    (gradeRec[1].chestFinish - gradeRec[0].chestFinish).toFixed(2) + ' 허리 ' +
    (gradeRec[1].waistFinish - gradeRec[0].waistFinish).toFixed(2) + ' 엉덩이 ' +
    (gradeRec[1].hipFinish - gradeRec[0].hipFinish).toFixed(2));
})();

/* ══════════════════════════════════════════════════════════════════════
 * §10. UI · 빌드 계약
 *      ★ 「UI/엔진 목록 불일치」는 이 프로젝트에서 반복해 터졌다.
 *        정규식으로 이름만 맞춰 보면 속는다 — **흔들어서 도면이 변하는지**로 본다.
 * ════════════════════════════════════════════════════════════════════ */
head('10. UI·빌드 계약 (흔들어서 확인한다)');
(function () {
  var bad = [], soft = [], m = E.measuresForSize('55호');
  function sig(D) {
    var s = 0;
    D.pieces.forEach(function (p) {
      p.outline.forEach(function (q) { s += q[0] * 1.7 + q[1] * 2.3; });
      (p.internal || []).forEach(function (it) { it.pts.forEach(function (q) { s += q[0] * 3.1 + q[1] * 5.9; }); });
      (p.notches || []).forEach(function (n) { s += n.p[0] * 7.1 + n.p[1] * 11.3; });
    });
    return s;
  }
  var base = sig(E.draftVest(m, { seam: E.SEAM_DEFAULT }));
  function moves(key, delta) {
    var o = { seam: E.SEAM_DEFAULT }; o[key] = (E.K[key] !== undefined ? E.K[key] : m[key]) + delta;
    return Math.abs(sig(E.draftVest(m, o)) - base) > 1e-9;
  }
  /* ① 화면에 내건 치수는 전부 살아 있어야 한다 */
  E.MEAS_KEYS.forEach(function (k) {
    if (!moves(k, 2)) bad.push('치수 「' + (E.MEAS_LABEL[k] || k) + '」(' + k + ') 를 바꿔도 도면이 안 변한다 — 입력란이 거짓말한다');
  });
  /* ② 스타일 상수도 마찬가지 */
  Object.keys(E.K).forEach(function (k) {
    if (k === 'splitPanels') return;
    if (!moves(k, 0.7)) bad.push('K.' + k + ' 를 바꿔도 도면이 안 변한다 (죽은 상수)');
  });
  /* ③ ui.js STYLE_KEYS 가 엔진이 읽는 키인가 */
  var uiSrc = readFile('ui.js'), uiHtml = readFile('ui.html'), engSrc = readFile('engine.js');
  if (!uiSrc || !uiHtml || !engSrc) soft.push('ui.js/ui.html/engine.js 를 못 읽어 UI 검사를 건너뛴다');
  else {
    var block = uiSrc.match(/var STYLE_KEYS\s*=\s*\[([\s\S]*?)\n\s*\];/);
    if (!block) soft.push('ui.js 에서 STYLE_KEYS 를 못 찾았다');
    else {
      var keys = [], mm, re = /\{\s*k:\s*'([^']+)'/g;
      while ((mm = re.exec(block[1]))) keys.push(mm[1]);
      keys.forEach(function (k) {
        if (E.K[k] === undefined && E.MEAS_KEYS.indexOf(k) < 0)
          bad.push('ui.js STYLE_KEYS 의 「' + k + '」 는 엔진 상수가 아니다');
        else if (!moves(k, 0.7))
          bad.push('ui.js STYLE_KEYS 의 「' + k + '」 를 움직여도 도면이 안 변한다');
      });
      if (keys.length < Object.keys(E.K).length - 3)
        soft.push('STYLE_KEYS ' + keys.length + '개 < 엔진 상수 ' + Object.keys(E.K).length + '개 — 화면에 없는 손잡이가 있다');
    }
    /* ④ 호수 목록이 엔진과 같은가 */
    var tabs = (uiHtml.match(/data-size="([^"]+)"/g) || []).map(function (s) { return s.slice(11, -1); });
    if (tabs.length !== SIZES.length || tabs.some(function (t, i) { return t !== SIZES[i]; }))
      bad.push('ui.html 호수 탭 [' + tabs.join(',') + '] ≠ 엔진 SIZES [' + SIZES.join(',') + ']');
    /* ⑤ 소매 잔재 — 조끼에는 소매가 없다 (주석이 아니라 실제로 읽고 쓰는 자리만 본다) */
    if (/(state|els|opt)\.sleeveType|\$\('ndSleeveType'\)/.test(uiSrc))
      bad.push('ui.js 가 sleeveType 을 읽거나 쓴다 — 조끼는 소매가 없다');
    if (/ndSleeveType/.test(uiHtml)) bad.push('ui.html 에 「소매 종류」 선택 상자가 남아 있다');
    if (/function\s+(sleeveGeom|twoSleeveGeom)|var\s+K_OLD/.test(engSrc))
      bad.push('engine.js 에 소매/원피스 죽은 코드가 되살아났다');
    /* 같은 이름을 두 번 선언하면 **뒤엣것만 산다** — 앞엣것을 고치는 사람은 아무 일도
       일어나지 않는 이유를 못 찾는다. (실제로 bustDiffOf 가 두 번 정의돼 있었다.) */
    /* ⚠ 들여쓰기 2칸 = 모듈 최상위만 본다. 안쪽 함수(fixNotches 의 ok, draftVest 의 ok)는
       각자 다른 스코프라 이름이 같아도 중복이 아니다 — 스코프를 모르는 검사가
       멀쩡한 코드를 잡는 일이 없게 한다. */
    var seen = {}, dup = {}, mf, rf = /^ {2}function\s+([A-Za-z0-9_$]+)\s*\(/gm;
    while ((mf = rf.exec(engSrc))) { if (seen[mf[1]]) dup[mf[1]] = 1; seen[mf[1]] = 1; }
    Object.keys(dup).forEach(function (k) {
      bad.push('engine.js 에 function ' + k + ' 가 두 번 정의돼 있다 — 앞엣것은 죽은 코드다(고쳐도 안 먹는다)');
    });
  }
  /* ⑥ 빌드 산출물이 소스와 같은가 — build.py 는 원본을 그대로 인라인한다 */
  var built = readFile('조끼.html');
  if (!built) soft.push('조끼.html 이 없다 — python3 build.py 를 돌려라');
  else {
    ['ui.html', 'ui.css', 'print.css', 'engine.js', 'print.js', 'dxf.js', 'pdf.js', 'ui.js'].forEach(function (n) {
      var src = readFile(n);
      if (src === null) { bad.push(n + ' 을 못 읽었다'); return; }
      if (built.indexOf(src) < 0)
        bad.push('조끼.html 안의 ' + n + ' 이 지금 소스와 다르다 — python3 조끼/build.py 로 다시 빌드하라');
    });
  }
  /* ⑦ 스위트에 등록돼 있는가 (빠지면 포터블 빌드·통합검산에서 통째로 사라진다) */
  var rootBuild = readFile('../build.py'), suiteV = readFile('../suite-verify.js');
  if (rootBuild === null) soft.push('../build.py 를 못 읽어 등록 검사를 건너뛴다');
  else if (!/\(\s*'조끼'\s*,/.test(rootBuild)) bad.push('루트 build.py 의 APPS 에 조끼가 없다');
  if (suiteV === null) soft.push('../suite-verify.js 를 못 읽어 등록 검사를 건너뛴다');
  else if (!/dir:\s*'조끼'/.test(suiteV)) bad.push('suite-verify.js 에 조끼가 등록돼 있지 않다');

  row('UI/빌드', bad, soft, '치수 ' + E.MEAS_KEYS.length + '개 · K ' + Object.keys(E.K).length + '개를 흔들어 확인');
})();

/* ══════════════════════════════════════════════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(fails ? ' ✗ 실패 ' + fails + '건 · 경고 ' + warns + '건'
                  : ' ✓ 전부 통과 (경고 ' + warns + '건)');
/* ══ 다트 — dart-verify.js 를 그대로 불러 쓴다 ═══════════════════════════
 *   복붙하지 않는다. 복붙하면 한쪽만 고쳐지고 다른 쪽은 낡은 채 통과한다.
 *   단독으로도 돌아간다: node dart-verify.js
 * ==========================================================================*/
console.log('');
console.log('════════════════════════════════════════════════════════════');
console.log(' 다트 — 원문 5종 (dart-verify.js)');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var DV = require('./dart-verify.js'), r = DV.run();
  fails += r.fails; warns += r.warns;
})();

console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
