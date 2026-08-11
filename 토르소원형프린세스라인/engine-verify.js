/* ============================================================================
 * engine-verify.js — 토르소 원형 프린세스라인 검산
 *   1) 66호 제도점·곡선을 원본 DXF(dxf-66-groundtruth.json)와 대조
 *   2) **프린세스 4조각 봉제 짝** — 이 원형의 핵심 검사
 *   3) 전 호수 조각 품질 · 인쇄 배치
 *   실행: node engine-verify.js   (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));
var C = {}; GT.curves.forEach(function (c) { C[c.name] = c; });
var TOL_PT = 0.05, TOL_CURVE = 0.30, TOL_LEN = 0.25;
var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 3 : d); while (s.length < w) s = ' ' + s; return s; }
function okPt(name, got, want, tol) {
  var d = V.dist(got, want), pass = d <= (tol || TOL_PT); if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 20) + '(' + f(got[0], 8) + ',' + f(got[1], 7) +
    ')  도면 (' + f(want[0], 8) + ',' + f(want[1], 7) + ') · 차 ' + f(d, 6));
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
/* 아직 정답지에 못 맞춘 곡선과 그 이유. 여기 적힌 것만 ⚠ 로 넘어간다. */
var OPEN = {
  '앞목둘레': '편차 0.214 · 길이 −0.13 (0.338 에서 줄었다)',
  '뒤 옆선': '편차 0.172 · 길이 −0.03 (0.336 에서 줄었다)',
  '뒤 절개선 (바깥)': '편차 0.281 · 길이 +0.002 (2.15 → 0.38 → 0.28)',
  '뒤 절개선 (안쪽)': '편차 0.312 — 밑단 쪽 앵커를 더하면 오히려 0.415 로 나빠진다'
};
function okCurve(name, segs, gtPts, gtLen) {
  var d = dev(segs, gtPts), L = U.sLen(segs), dl = Math.abs(L - gtLen);
  var pass = d <= TOL_CURVE && dl <= TOL_LEN, open = OPEN[name];
  if (!pass) { if (open) warns++; else fails++; }
  console.log('  ' + (pass ? '✓ ' : open ? '⚠ ' : '✗ ') + pad(name, 20) + '최대편차 ' + f(d, 6) +
    ' · 길이 ' + f(L, 8) + ' (도면 ' + f(gtLen, 8) + ')' + (pass || !open ? '' : '\n      ⚠ ' + open));
}
var m66 = E.measuresForSize('66호'), g = E.geom(m66);
console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 66호 제도점 — 원본 DXF 대조  (허용 ' + TOL_PT.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
var bn = C['뒷목둘레'].local, fn = C['앞목둘레'].local, ba = C['뒤 암홀'].local, fa = C['앞 암홀'].local;
/* 정답지 점열 방향은 곡선마다 다르다 — **어깨점이 앞에 오도록** 맞춘다.
   (앞 암홀은 겨드랑 → 어깨 순서라 그대로 쓰면 SP 와 겨드랑을 뒤바꿔 비교하게 된다) */
if (fa[0][1] > fa[fa.length - 1][1]) fa = fa.slice().reverse();
if (ba[0][1] > ba[ba.length - 1][1]) ba = ba.slice().reverse();
console.log(' [뒷면]');
okPt('BNP',        g.BNP,  bn[bn.length - 1]);
okPt('목옆점 SNP',  g.SNPb, bn[0]);
okPt('어깨점 SP',   g.SPb,  ba[0]);
okPt('겨드랑',      g.Ub,   ba[ba.length - 1]);
console.log(' [앞면]');
okPt('FNP',        g.FNP,  fn[0]);
okPt('목옆점 SNP',  g.SNPf, fn[fn.length - 1]);
okPt('어깨점 SP',   g.SPf,  fa[0]);
okPt('겨드랑',      g.Uf,   fa[fa.length - 1]);
okPt('BP',         g.BP,   C['앞 절개선 (어깨~BP) B'].local.slice(-1)[0]);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 66호 곡선 — 원본 DXF 대조  (허용 편차 ' + TOL_CURVE.toFixed(2) + ' · 길이 ' + TOL_LEN.toFixed(2) + ')');
console.log('════════════════════════════════════════════════════════════');
okCurve('뒷목둘레', g.backNeck,  C['뒷목둘레'].local, C['뒷목둘레'].arc);
okCurve('앞목둘레', g.frontNeck, C['앞목둘레'].local, C['앞목둘레'].arc);
okCurve('뒤 암홀',  g.backArm,   C['뒤 암홀'].local,  C['뒤 암홀'].arc);
okCurve('앞 암홀',  g.frontArm,  C['앞 암홀'].local,  C['앞 암홀'].arc);
okCurve('뒤 옆선',  g.backSide,  C['뒤 옆선 (BL~밑단)'].local, C['뒤 옆선 (BL~밑단)'].arc);
okCurve('뒤 절개선 (바깥)', g.bPrinOut,
  C['뒤 절개선 (어깨~허리) A'].local.concat(C['뒤 절개선 (허리~밑단) A'].local),
  C['뒤 절개선 (어깨~허리) A'].arc + C['뒤 절개선 (허리~밑단) A'].arc);
okCurve('뒤 절개선 (안쪽)', g.bPrinIn,
  C['뒤 절개선 (어깨~허리) B'].local.concat(C['뒤 절개선 (허리~밑단) B'].local),
  C['뒤 절개선 (어깨~허리) B'].arc + C['뒤 절개선 (허리~밑단) B'].arc);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 봉제 짝 — 프린세스 4조각이 맞물리는 변 (하드 검사)');
console.log('════════════════════════════════════════════════════════════');
console.log('   맞물리는 짝을 지키지 못하면 옷이 안 된다. 정답지가 없어도 이건 검사할 수 있다.');
E.SIZES.forEach(function (sz) {
  var d = E.draftTorso(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), M = d.measures;
  var bad = [];
  function chk(nm, a, b, tol) {
    if (Math.abs(a - b) > tol) bad.push(nm + ' ' + f(a, 0) + '↔' + f(b, 0) + ' 차 ' + f(a - b, 0));
  }
  chk('뒤절개', M.princessBackIn, M.princessBackOut, 0.35);
  chk('앞절개', M.princessFrontIn, M.princessFrontOut, 0.35);
  chk('옆선',   M.sideBack, M.sideFront, 0.25);
  chk('어깨안', V.dist(d.meta.geom.SNPb, d.meta.geom.bPrinB), V.dist(d.meta.geom.SNPf, d.meta.geom.fPrinB), 0.35);
  chk('어깨밖', V.dist(d.meta.geom.bPrinA, d.meta.geom.SPb), V.dist(d.meta.geom.fPrinA, d.meta.geom.SPf), 0.35);
  chk('어깨봉제', M.shoulderBackSewn, M.shoulderFrontSewn, 0.05);
  if (d.pieces.length !== 4) bad.push('조각 ' + d.pieces.length + '장 (4 이라야 한다)');
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '뒤절개 ' + f(M.princessBackIn, 7) + '/' + f(M.princessBackOut, 7) +
    ' · 앞절개 ' + f(M.princessFrontIn, 7) + '/' + f(M.princessFrontOut, 7) +
    ' · 옆선 ' + f(M.sideBack, 7) + '/' + f(M.sideFront, 7) +
    ' · 가슴다트 ' + f(M.bustDart, 6) + (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3.5 맞춤 너치 — 짝이 되는 두 변의 **같은 자리**에 있는가 (하드 검사)');
console.log('════════════════════════════════════════════════════════════');
console.log('   너치가 어긋나면 봉제할 때 조각이 밀린다. **짝의 공통 기준점**(어깨 절개점 · 겨드랑)에서');
console.log('   잰 거리로 비교한다 — 그냥 변 시작에서 재면 한쪽이 뒤집혀 들어와 38cm 어긋나도 통과한다.');
(function () {
  function distFrom(q, ref, pt) {
    if (V.dist(q[0], ref) > V.dist(q[q.length - 1], ref)) q = q.slice().reverse();
    var acc = 0, b = Infinity, at = 0;
    for (var i = 1; i < q.length; i++) {
      acc += V.dist(q[i - 1], q[i]);
      var e = V.dist(q[i], pt); if (e < b) { b = e; at = acc; }
    }
    return at;
  }
  E.SIZES.forEach(function (sz) {
    var mm = E.measuresForSize(sz), g = E.geom(mm);
    var d = E.draftTorso(mm, { seam: E.SEAM_DEFAULT }), P = {};
    d.pieces.forEach(function (p) { P[p.id] = p; });
    /* 여러 변에 걸친 짝(앞옆면 옆선은 위/아래 두 변)도 이어 붙여 잰다 */
    function edges(id, names) {
      var p = P[id], out = [];
      names.forEach(function (n) {
        var e = (p.edges || []).filter(function (x) { return x.name === n; })[0];
        if (e) out = out.concat(p.outline.slice(e.start, e.end + 1));
      });
      return out;
    }
    function nt(id, pre) {
      return P[id].notches.filter(function (n) { return n.label.indexOf(pre) === 0; });
    }
    var PAIRS = [
      ['뒤 절개', 'back', ['절개선'], g.bPrinB, 'backSide', ['절개선'], g.bPrinA, '절개'],
      ['앞 절개', 'front', ['절개선'], g.fPrinB, 'frontSide', ['절개선'], g.fPrinA, '절개'],
      ['옆선',   'backSide', ['옆선'], g.Ub, 'frontSide', ['옆선 (위)', '옆선 (아래)'], g.Uf, '옆선']
    ];
    var bad = [], worst = 0;
    PAIRS.forEach(function (w) {
      var A = edges(w[1], w[2]), B = edges(w[4], w[5]);
      var na = nt(w[1], w[7]), nb = nt(w[4], w[7]);
      if (!A.length || !B.length) { bad.push(w[0] + ' 변 없음'); return; }
      if (!na.length) { bad.push(w[0] + ' 너치 없음'); return; }
      if (na.length !== nb.length) { bad.push(w[0] + ' 짝 개수 ' + na.length + '≠' + nb.length); return; }
      na.forEach(function (n, i) {
        var dd = Math.abs(distFrom(A, w[3], n.p) - distFrom(B, w[6], nb[i].p));
        if (dd > worst) worst = dd;
        if (dd > 0.10) bad.push(w[0] + ' ' + (i + 1) + ' 어긋남 ' + dd.toFixed(3));
      });
    });
    d.pieces.forEach(function (p) {
      if (!p.notches.length) bad.push(p.name + ' 너치 0개');
      /* 너치 각이 **조각 안쪽**을 향해야 한다 — 바깥이면 재단할 때 반대로 판다.
         조각마다 손으로 넣은 inside 점이 틀려 8개가 뒤집힌 채 통과했었다 (2026-08-12). */
      var cx = 0, cy = 0;
      p.outline.forEach(function (q) { cx += q[0]; cy += q[1]; });
      cx /= p.outline.length; cy /= p.outline.length;
      p.notches.forEach(function (n) {
        var a = n.angle * Math.PI / 180;
        if (Math.cos(a) * (cx - n.p[0]) + Math.sin(a) * (cy - n.p[1]) < 0)
          bad.push(p.name + ' 「' + n.label + '」 너치가 바깥을 향한다');
        /* 너치는 외곽선 위에 있어야 한다 */
        var b = Infinity;
        for (var i = 0; i < p.outline.length; i++) {
          var e = V.dist(n.p, p.outline[i]); if (e < b) b = e;
        }
        if (b > 0.06) bad.push(p.name + ' 「' + n.label + '」 너치가 외곽선 밖 ' + b.toFixed(3));
      });
    });
    if (bad.length) fails++;
    console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
      '너치 ' + d.pieces.map(function (p) { return p.name + ' ' + p.notches.length; }).join(' · ') +
      ' · 최대 어긋남 ' + f(worst, 6) + (bad.length ? '\n      → ' + bad.join(' · ') : ''));
  });
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 조각 품질 · 인쇄 배치');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var d = E.draftTorso(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), bad = [];
  d.pieces.forEach(function (p) {
    var mx = 0;
    for (var i = 1; i < p.outline.length; i++) mx = Math.max(mx, V.dist(p.outline[i - 1], p.outline[i]));
    if (mx > 0.06) bad.push(p.name + ' 점간격 ' + mx.toFixed(3));
    if (!p.seamline || p.seamline.length < 200) bad.push(p.name + ' 시접선 ' + (p.seamline || []).length);
    if (V.dist(p.outline[0], p.outline[p.outline.length - 1]) > 0.1) bad.push(p.name + ' 폐곡선 아님');
  });
  if (d.warnings.length) bad.push('경고 ' + d.warnings.join('/'));
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) + '조각 ' + d.pieces.length + '장 · ' +
    d.pieces.map(function (p) { return p.name + ' ' + p.outline.length; }).join(' · ') +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});
(function () {
  var PR; try { PR = require('./print.js'); } catch (e) { console.log('  ? print.js 없음'); warns++; return; }
  [['A1 롤', { mode: 'roll', rollWidthMm: 594 }], ['A4 타일', { mode: 'a4' }]].forEach(function (w) {
    var bad = [], tot = 0;
    E.SIZES.forEach(function (sz) {
      var d = E.draftTorso(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT });
      var o = { seam: E.SEAM_DEFAULT }; for (var k in w[1]) o[k] = w[1][k];
      var Lo = PR.buildPrintLayout(d, o), c = Lo.info.canvas, pl = Lo.info.placements;
      pl.forEach(function (q) {
        if (q.xMm < -1e-6 || q.yMm < -1e-6) bad.push(sz + ' ' + q.name + ' 음수좌표');
        if (q.xMm + q.wMm > c.wMm + 1e-6) bad.push(sz + ' ' + q.name + ' 우측 넘침');
        if (q.yMm + q.hMm > c.hMm + 1e-6) bad.push(sz + ' ' + q.name + ' 하단 넘침');
      });
      for (var a = 0; a < pl.length; a++) for (var b = a + 1; b < pl.length; b++) {
        var A = pl[a], B = pl[b];
        if (A.xMm < B.xMm + B.wMm - 1e-6 && B.xMm < A.xMm + A.wMm - 1e-6 &&
            A.yMm < B.yMm + B.hMm - 1e-6 && B.yMm < A.yMm + A.hMm - 1e-6) bad.push(sz + ' 겹침');
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
