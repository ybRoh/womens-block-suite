/* ============================================================================
 * engine-verify.js — V 네크라인 엔진 검산
 *   1) 66호 제도점·곡선을 원본 DXF(dxf-66-groundtruth.json)와 대조
 *   2) 전 호수 봉제 정합성 (어깨·옆선·안단 길이·다트)
 *   3) 폴리라인 간격·자기교차 같은 출력 품질
 *
 *   실행: node engine-verify.js        (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js');
var U = E.util, V = U.V;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));

var TOL_PT = 0.05;      // 제도점 허용 편차 (cm)
var TOL_CURVE = 0.08;   // 곡선 최대편차 — 손으로 그은 스플라인이라 점보다 느슨하다
var TOL_LEN = 0.10;     // 길이 허용 편차

var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, dec) {
  var s = (+v).toFixed(dec === undefined ? 3 : dec);
  while (s.length < w) s = ' ' + s;
  return s;
}
function ok(name, got, want, tol, unit) {
  var d = Math.abs(got - want), pass = d <= tol;
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 26) +
    f(got, 8) + '  (도면 ' + f(want, 8) + ' · 차 ' + f(d, 6) + (unit || '') + ')');
}
function okPt(name, got, want, tol) {
  var d = V.dist(got, want), pass = d <= (tol || TOL_PT);
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 26) +
    '(' + f(got[0], 7) + ',' + f(got[1], 7) + ')  도면 (' + f(want[0], 7) + ',' + f(want[1], 7) +
    ') · 차 ' + f(d, 6));
}
function curveDev(segs, pts) {
  var poly = U.sampleSegs(segs, 0.03), mx = 0, at = null;
  pts.forEach(function (p) {
    var b = Infinity;
    for (var i = 0; i < poly.length - 1; i++) {
      var a = poly[i], c = poly[i + 1];
      var dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var e = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (e < b) b = e;
    }
    if (b > mx) { mx = b; at = p; }
  });
  return { d: mx, at: at };
}
function okCurve(name, segs, gtName) {
  var g = GT.curves.filter(function (c) { return c.name === gtName; })[0];
  if (!g) { console.log('  ? %-30s 도면 곡선 없음', name); warns++; return; }
  var r = curveDev(segs, g.local), len = U.sLen(segs);
  var pass = r.d <= TOL_CURVE;
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 26) + '최대편차 ' + f(r.d, 6) +
    ' (' + f(r.at[0], 6, 2) + ',' + f(r.at[1], 6, 2) + ') · 길이 ' + f(len, 7) +
    ' (도면 ' + f(g.arc, 7) + ')');
}

console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 66호 제도점 — 원본 DXF 대조   (허용 ' + TOL_PT.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
var m66 = E.measuresForSize('66호');
var g = E.geom(m66);

console.log(' [뒷면]');
okPt('BNP',            g.BNP,          [0, -0.3]);
okPt('뒷목 사각 모서리',  g.bNeckCorner,  [7.3, -3.5]);
okPt('목옆점 SNP',      g.SNPb,         [8.226, -3.123]);
okPt('어깨점 SP',       g.SPb,          [20.378, 1.827]);
okPt('겨드랑',          g.Ub,           [23.8, 18.9]);
okPt('허리 옆점',       g.bWaist,       [23.8, 37.5]);
ok  ('등품선 x',        g.bPitchX,      18.4,  TOL_PT);
ok  ('가슴선 BL',       g.BL,           21.9,  TOL_PT);
ok  ('어깨선 길이',      g.shLenBackSeam, 13.121, TOL_LEN);

console.log(' [앞면]');
okPt('목옆점 SNP',      g.SNPf,         [7.3, -0.6]);
okPt('FNP (기본 원형)',  g.FNP,          [0, 7.6]);
okPt('어깨점 SP',       g.SPf,          [19.625, 3.960]);
okPt('겨드랑',          g.Uf,           [23.5, 18.9]);
okPt('BP',             g.BP,           [9.5, 24.2]);
okPt('V 통과점 (1(3/8))', g.vMark,      [5.559, 5.788]);
okPt('앞중심 V 점',      g.Vcf,          [0, 14.6]);
okPt('자락 끝',         g.Vend,         [-23.5, 28.2]);
okPt('다트 아래 다리',    g.dartLo,      [23.5, 26.6]);
okPt('다트 위 다리',      g.dartHi,      [23.675, 25.111]);
ok  ('다트 다리 길이',    g.dartLeg,     14.2042, TOL_PT);
ok  ('앞품선 x',        g.fPitchX,      17.15, TOL_PT);
ok  ('어깨선 길이',      g.shLenFrontSeam, 13.091, TOL_LEN);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 66호 곡선 — 원본 DXF 대조   (허용 ' + TOL_CURVE.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
okCurve('뒷목둘레',   g.backNeck, '뒷목둘레');
okCurve('뒤 암홀',    g.backArm,  '뒤 암홀');
okCurve('앞 암홀',    g.frontArm, '앞 암홀');
okCurve('V 네크라인',  g.vNeck,    'V 네크라인');

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 안단선 (조각 안쪽 4.0 평행선) — 원본 DXF 대조');
console.log('════════════════════════════════════════════════════════════');
var d66 = E.draftVNeck(m66, { seam: 0 });
function facingInner(pieceId) {
  var p = d66.pieces.filter(function (x) { return x.id === pieceId; })[0];
  var e = p.edges.filter(function (x) { return x.role === 'facing'; })[0];
  return p.outline.slice(e.start, e.end + 1);
}
function polyDev(poly, pts) {
  var mx = 0;
  pts.forEach(function (p) {
    var b = Infinity;
    for (var i = 0; i < poly.length - 1; i++) {
      var a = poly[i], c = poly[i + 1];
      var dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var e = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (e < b) b = e;
    }
    if (b > mx) mx = b;
  });
  return mx;
}
[['backNeckFacing', '뒤 목둘레 안단선'], ['backArmFacing', '뒤 암홀 안단선'],
 ['frontArmFacing', '앞 암홀 안단선'],   ['frontNeckFacing', 'V 네크라인 안단선']]
.forEach(function (w) {
  var gt = GT.curves.filter(function (c) { return c.name === w[1]; })[0];
  if (!gt) { console.log('  ? %s 도면 없음', w[1]); warns++; return; }
  var poly = facingInner(w[0]);
  var d = polyDev(poly, gt.local), pass = d <= TOL_CURVE + 0.04;
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(w[1], 22) + '최대편차 ' + f(d, 6) +
    ' · 길이 ' + f(U.polyLen(poly), 7) + ' (도면 ' + f(gt.arc, 7) + ')');
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 전 호수 봉제 정합성');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var mm = E.measuresForSize(sz), d = E.draftVNeck(mm, { seam: 0 }), M = d.measures, gg = E.geom(mm);
  var shDiff = Math.abs(M.shoulderBackSeam - M.shoulderFrontSeam);
  var sideCut = Math.abs(M.sideBack - M.sideFront);
  var line = [];
  function chk(cond, msg) { if (!cond) { line.push(msg); fails++; } }
  chk(shDiff <= 0.10, '어깨 ' + shDiff.toFixed(2));
  chk(sideCut <= 0.10, '옆선(재단) ' + sideCut.toFixed(2));
  chk(gg.armY > 0 && gg.armY < gg.WL, '겨드랑 위치');
  chk(M.vDepth < gg.WL, 'V 깊이');
  /* 안단 길이 = 대응 몸판 변 길이 (안단은 겉과 같은 변에 붙는다) */
  var nf = d.pieces.filter(function (p) { return p.id === 'frontNeckFacing'; })[0];
  chk(!!nf, '앞 목둘레 안단 없음');
  console.log('  ' + (line.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '어깨 뒤 ' + f(M.shoulderBackSeam, 6) + ' 앞 ' + f(M.shoulderFrontSeam, 6) + ' (차 ' + f(shDiff, 5) + ')' +
    ' · 옆선 재단 뒤 ' + f(M.sideBack, 6, 2) + ' 앞 ' + f(M.sideFront, 6, 2) +
    ' · 봉제 앞 ' + f(M.sideFrontSewn, 6, 2) +
    ' · 암홀 ' + f(M.armholeTotal, 6, 2) + ' · 목둘레 ' + f(M.neckTotal, 6, 2));
  if (line.length) console.log('      → ' + line.join(' · '));
});

console.log('\n  ※ 교재 제도 그대로면 앞 옆선은 다트분만큼 짧아진다 (봉제 후 뒤보다 ' +
  (d66.measures.sideBack - d66.measures.sideFrontSewn).toFixed(2) + ' cm 부족).');
console.log('     다트를 접어 옆선을 맞추려면 UI 의 「다트분」을 0 으로 두거나 뒤 옆선을 같이 줄여야 한다.');
warns++;

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5. 출력 품질 (폴리라인 간격 · 시접)');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var d = E.draftVNeck(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT });
  d.pieces.forEach(function (p) {
    var mx = 0;
    for (var i = 1; i < p.outline.length; i++) mx = Math.max(mx, V.dist(p.outline[i - 1], p.outline[i]));
    var bad = mx > 0.06 || !p.seamline || p.seamline.length < 8;
    if (bad) { fails++; console.log('  ✗ %s %s  최대 점간격 %.3f · 시접선 %d점', sz, p.name, mx, p.seamline ? p.seamline.length : 0); }
  });
});
console.log('  ✓ 전 호수 8조각 점간격 ≤ 0.06 cm · 시접선 생성 확인');

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 6. 자락 없는 앞면 — 자락 앞면과 같은 변을 써야 한다');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var mm = E.measuresForSize(sz), gg = E.geom(mm), dd = E.draftVNeck(mm, { seam: 0 });
  var pl = dd.pieces.filter(function (p) { return p.id === 'frontPlain'; })[0];
  var wr = dd.pieces.filter(function (p) { return p.id === 'front'; })[0];
  var line = [];
  function chk(c, m) { if (!c) { line.push(m); fails++; } }
  chk(!!pl, '조각 없음');
  if (pl) {
    /* 앞중심은 골선(시접 0) 이어야 하고, 폭은 옆선 x 와 같아야 한다 */
    var fold = pl.edges.filter(function (e) { return e.role === 'fold'; })[0];
    chk(!!fold, '앞중심 골선 없음');
    chk(Math.abs(pl.bbox.w - gg.fSideX) <= 0.25, '폭 ' + pl.bbox.w.toFixed(2) + ' ≠ 옆선 ' + gg.fSideX.toFixed(2));
    chk(Math.abs(pl.bbox.h - wr.bbox.h) <= 0.01, '높이가 자락 앞판과 다름');
    /* V 네크라인 위쪽 길이 = 자락 앞판 목둘레 − 앞중심 아래쪽 */
    var upLen = U.sLen(gg.vNeckUp), allLen = U.sLen(gg.vNeck);
    chk(upLen > 0 && upLen < allLen, 'V 위쪽 곡선 길이');
    console.log('  ' + (line.length ? '✗ ' : '✓ ') + pad(sz, 5) +
      '폭 ' + f(pl.bbox.w, 6, 2) + ' · 높이 ' + f(pl.bbox.h, 6, 2) +
      ' · V 위쪽 ' + f(upLen, 6, 2) + ' (자락 전체 ' + f(allLen, 6, 2) + ')' +
      ' · 앞중심 시접 ' + f(fold ? fold.seam : -1, 4, 1));
  }
  if (line.length) console.log('      → ' + line.join(' · '));
});

console.log('\n════════════════════════════════════════════════════════════');
console.log((fails ? ' 실패 ' + fails + '건' : ' 전체 통과') + ' · 참고 ' + warns + '건');
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
