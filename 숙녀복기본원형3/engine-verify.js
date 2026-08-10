/* ============================================================================
 * engine-verify.js — 숙녀복 기본원형 III 검산
 *   1) 66호 제도점·곡선을 원본 DXF(dxf-66-groundtruth.json)와 대조
 *   2) 전 호수 봉제 정합성 · 출력 품질 · 인쇄 배치
 *   실행: node engine-verify.js   (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));
var C = {}; GT.curves.forEach(function (c) { C[c.name] = c; });
var M = GT.marks;
var TOL_PT = 0.05, TOL_CURVE = 0.09, TOL_LEN = 0.12;
var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 3 : d); while (s.length < w) s = ' ' + s; return s; }
function okPt(name, got, want, tol) {
  var d = V.dist(got, want), pass = d <= (tol || TOL_PT); if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 20) + '(' + f(got[0], 8) + ',' + f(got[1], 7) +
    ')  도면 (' + f(want[0], 8) + ',' + f(want[1], 7) + ') · 차 ' + f(d, 6));
}
function ok(name, got, want, tol) {
  var d = Math.abs(got - want), pass = d <= tol; if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 20) + f(got, 9) + '  (도면 ' + f(want, 9) + ' · 차 ' + f(d, 6) + ')');
}
function dev(segs, pts) {
  var poly = U.sampleSegs(segs, 0.03), mx = 0;
  pts.forEach(function (p) {
    var b = Infinity;
    for (var i = 0; i < poly.length - 1; i++) {
      var a = poly[i], c = poly[i + 1], dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var e = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); if (e < b) b = e;
    }
    if (b > mx) mx = b;
  });
  return mx;
}
function okCurve(name, segs, gtPts, gtLen) {
  var d = dev(segs, gtPts), L = U.sLen(segs);
  var pass = d <= TOL_CURVE && Math.abs(L - gtLen) <= TOL_LEN; if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 20) + '최대편차 ' + f(d, 6) +
    ' · 길이 ' + f(L, 8) + ' (도면 ' + f(gtLen, 8) + ')');
}
var m66 = E.measuresForSize('66호'), g = E.geom(m66);
console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 66호 제도점 — 원본 DXF 대조  (허용 ' + TOL_PT.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
console.log(' [뒷면]');
okPt('BNP',            g.BNP,       M.back.BNP);
okPt('목옆점 SNP',      g.SNPb,      M.back.SNP);
okPt('어깨 안내선 끝',   g.bShGuide,  M.back.shGuideEnd);
okPt('어깨다트 다리 A',  g.shDartA,   M.back.shDartA);
okPt('어깨다트 다리 B',  g.shDartB,   M.back.shDartB);
okPt('어깨다트 꼭지',    g.shDartTip, M.back.shDartTip);
okPt('어깨점 SP',       g.SPb,       M.back.SP);
okPt('겨드랑',          g.Ub,        M.back.U);
okPt('허리 옆점',       g.bWaistSide, M.back.waistSide);
okPt('허리다트 꼭지',    g.bDartTip,  M.back.wDartTip);
okPt('허리다트 다리 A',  g.bDartA,    M.back.wDartA);
okPt('허리다트 다리 B',  g.bDartB,    M.back.wDartB);
ok  ('어깨선 길이',      g.shLen,     V.dist(M.back.SNP, M.back.shGuideEnd), TOL_PT);
ok  ('등품선 x',        g.bPitchX,   18.4, TOL_PT);
console.log(' [앞면]');
okPt('FNP',            g.FNP,       M.front.FNP);
okPt('목옆점 SNP',      g.SNPf,      M.front.SNP);
okPt('어깨점 SP',       g.SPf,       M.front.SP, 0.05);
okPt('겨드랑',          g.Uf,        M.front.U);
okPt('BP',             g.BP,        M.front.BP);
okPt('허리 옆점',       g.fWaistSide, M.front.waistSide);
okPt('허리다트 다리 A',  g.fDartA,    M.front.wDartA);
okPt('허리다트 다리 B',  g.fDartB,    M.front.wDartB);
ok  ('앞품선 x',        g.fPitchX,   17.15, TOL_PT);
ok  ('앞품선 2등분(중심)', (g.fPitchTop + g.BL) / 2, M.front.armCenter[1], TOL_PT);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 66호 곡선 — 원본 DXF 대조  (허용 ' + TOL_CURVE.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
okCurve('뒷목둘레', g.backNeck,  C['뒷목둘레'].local, C['뒷목둘레'].arc);
okCurve('뒤 암홀',  g.backArm,   C['뒤 암홀'].local,  C['뒤 암홀'].arc);
okCurve('앞목둘레', g.frontNeck, C['앞목둘레'].local, C['앞목둘레'].arc);
okCurve('앞 암홀',  g.frontArm,
  C['앞 암홀 (어깨~중심)'].local.concat(C['앞 암홀 (중심~겨드랑)'].local),
  C['앞 암홀 (어깨~중심)'].arc + C['앞 암홀 (중심~겨드랑)'].arc);
okCurve('뒤 옆선',  g.backSide,  C['뒤 옆선'].local,  C['뒤 옆선'].arc);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 전 호수 봉제 정합성 · 출력 품질');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var d = E.draftBodice3(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), Me = d.measures;
  var bad = [];
  if (Math.abs(Me.shoulderBack - Me.shoulderFront) > 0.02) bad.push('어깨 앞뒤 ' + Me.shoulderBack + '/' + Me.shoulderFront);
  if (d.warnings.length) bad.push('경고 ' + d.warnings.join('/'));
  d.pieces.forEach(function (p) {
    var mx = 0;
    for (var i = 1; i < p.outline.length; i++) mx = Math.max(mx, V.dist(p.outline[i - 1], p.outline[i]));
    if (mx > 0.06) bad.push(p.name + ' 점간격 ' + mx.toFixed(3));
    if (!p.seamline || p.seamline.length < 200) bad.push(p.name + ' 시접선 ' + (p.seamline || []).length);
  });
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '어깨 ' + f(Me.shoulderBack, 7) + ' · 암홀 ' + f(Me.armholeTotal, 7, 2) +
    ' · 목둘레 ' + f(Me.neckTotal, 7, 2) + ' · 옆선 뒤 ' + f(Me.sideBack, 6, 1) + ' 앞 ' + f(Me.sideFront, 6, 1) +
    ' · 허리 ' + f(Me.waistTotal, 6, 1) + (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});
/* 가슴다트 벌림은 파생값이다 — 앞 옆선을 벌리고 남는 길이가 뒤 옆선과 같아야 한다.
   도면 실측 벌림 1.4877 을 그대로 쓰면 앞이 1.03 길어 안 맞는다. */
console.log('  ── 옆선 짝 (앞 = 뒤 라야 봉제된다)');
E.SIZES.forEach(function (sz) {
  var d = E.draftBodice3(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), Me = d.measures;
  var bad = Math.abs(Me.sideBack - Me.sideFront) > 0.03; if (bad) fails++;
  console.log('  ' + (bad ? '✗ ' : '✓ ') + pad(sz, 5) + '뒤 ' + f(Me.sideBack, 8) + ' 앞 ' + f(Me.sideFront, 8) +
    ' · 차 ' + f(Me.sideFront - Me.sideBack, 7) + '  (가슴다트 벌림 ' + f(Me.bustDart, 6) + ')');
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 인쇄 배치 — 캔버스 밖 이탈 · 조각 겹침');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var PR; try { PR = require('./print.js'); } catch (e) { console.log('  ? print.js 없음'); warns++; return; }
  [['A1 롤', { mode: 'roll', rollWidthMm: 594 }], ['A4 타일', { mode: 'a4' }]].forEach(function (w) {
    var bad = [], tot = 0;
    E.SIZES.forEach(function (sz) {
      var d = E.draftBodice3(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT });
      var o = { seam: E.SEAM_DEFAULT }; for (var k in w[1]) o[k] = w[1][k];
      var Lo = PR.buildPrintLayout(d, o), c = Lo.info.canvas, pl = Lo.info.placements;
      pl.forEach(function (q) {
        if (q.xMm < -1e-6 || q.yMm < -1e-6) bad.push(sz + ' ' + q.name + ' 음수좌표');
        if (q.xMm + q.wMm > c.wMm + 1e-6) bad.push(sz + ' ' + q.name + ' 우측 넘침');
        if (q.yMm + q.hMm > c.hMm + 1e-6) bad.push(sz + ' ' + q.name + ' 하단 넘침');
      });
      for (var a = 0; a < pl.length; a++) for (var b = a + 1; b < pl.length; b++) {
        var A = pl[a], Bq = pl[b];
        if (A.xMm < Bq.xMm + Bq.wMm - 1e-6 && Bq.xMm < A.xMm + A.wMm - 1e-6 &&
            A.yMm < Bq.yMm + Bq.hMm - 1e-6 && Bq.yMm < A.yMm + A.hMm - 1e-6) bad.push(sz + ' 겹침');
      }
      tot += Lo.pageCount;
    });
    if (bad.length) fails++;
    console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(w[0], 8) + '전 호수 배치 정상 · 총 ' + tot + '장' +
      (bad.length ? '\n      → ' + bad.slice(0, 4).join(' · ') : ''));
  });
})();
console.log('\n════════════════════════════════════════════════════════════');
console.log((fails ? ' 실패 ' + fails + '건' : ' 전체 통과') + ' · 참고 ' + warns + '건');
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
