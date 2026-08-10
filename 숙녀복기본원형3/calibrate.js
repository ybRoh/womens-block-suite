/* calibrate.js — 정답지(dxf-66-groundtruth.json)에 곡선 장력을 적합한다.
   실행: node calibrate.js   → 결과를 engine.js 의 CAL 에 옮겨 적는다. */
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));
var C = {}; GT.curves.forEach(function (c) { C[c.name] = c; });
var m = E.measuresForSize('66호');
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
function fit(name, keys, ranges, pick, gtName, gtName2) {
  var best = null, K = E.CAL[name];
  function rec(i, cur) {
    if (i === keys.length) {
      keys.forEach(function (k, q) { K[k] = cur[q]; });
      var g = E.geom(m), segs = pick(g);
      var gt = C[gtName].local.concat(gtName2 ? C[gtName2].local : []);
      var arc = C[gtName].arc + (gtName2 ? C[gtName2].arc : 0);
      var d = dev(segs, gt), L = U.sLen(segs), s = d + Math.abs(L - arc) * 0.5;
      if (!best || s < best.s) best = { s: s, v: cur.slice(), d: +d.toFixed(4), L: +L.toFixed(4), arc: arc };
      return;
    }
    ranges[i].forEach(function (v) { rec(i + 1, cur.concat([v])); });
  }
  rec(0, []);
  keys.forEach(function (k, q) { K[k] = best.v[q]; });
  console.log('  ' + name.padEnd(10) + keys.map(function (k, q) { return k + ' ' + best.v[q]; }).join(' · ') +
    '   편차 ' + best.d + ' · 길이 ' + best.L + ' (도면 ' + best.arc + ')');
  return best;
}
function R(a, b, s) { var o = []; for (var v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(3)); return o; }
console.log('── 곡선 적합 (66호 정답지) ──');
fit('backNeck', ['mx', 'my', 'a0', 'k0', 'k1'],
    [R(0.4, 0.9, 0.1), R(0.0, 0.5, 0.1), R(0, 30, 5), R(0.6, 1.6, 0.2), R(0.2, 1.2, 0.2)],
    function (g) { return g.backNeck; }, '뒷목둘레');
fit('frontNeck', ['a0', 'a1', 'k0', 'k1'],
    [R(-12, 4, 2), R(-12, 6, 2), R(0.6, 1.6, 0.2), R(0.6, 1.6, 0.2)],
    function (g) { return g.frontNeck; }, '앞목둘레');
fit('backArm', ['a0', 'k0', 'kA', 'kB', 'k1'],
    [R(-30, 10, 2.5), R(0.5, 1.8, 0.15), R(0.5, 1.8, 0.15), R(0.4, 1.6, 0.15), R(0.6, 2.0, 0.2)],
    function (g) { return g.backArm; }, '뒤 암홀');
fit('frontArm', ['a0', 'k0', 'kA', 'kB', 'k1'],
    [R(-8, 8, 4), R(0.6, 1.6, 0.25), R(0.6, 1.6, 0.25), R(0.6, 1.6, 0.25), R(0.6, 1.6, 0.25)],
    function (g) { return g.frontArm; }, '앞 암홀 (어깨~중심)', '앞 암홀 (중심~겨드랑)');
fit('side', ['k0', 'k1'],
    [R(0.1, 2.0, 0.05), R(0.1, 2.0, 0.05)],
    function (g) { return g.backSide; }, '뒤 옆선');
console.log('\nCAL = ' + JSON.stringify(E.CAL, null, 2));
