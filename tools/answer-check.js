/* ============================================================================
 * answer-check.js — 도면에서 찍은 **정답지**로 엔진을 대조한다
 *
 *   `tools/도면-좌표찍기.html` 이 만든 docs/answer/*.json 을 읽어
 *     ① 번호점 좌표      — 거리
 *     ② 곡선            — 양방향 하우스도르프
 *   를 잰다. **거울·회전·모양이 한 번에 잡힌다** — 길이 검사로는 못 잡는 것들이다.
 *
 *   쓰는 법 (모듈 검산기 안에서):
 *     var AC = require('../tools/answer-check.js');
 *     AC.run('원피스-뒤판', { 12: g.p12, 42: g.p42 }, { bArm: g.bArm }, U, bad);
 *
 *   정답지가 없으면 **조용히 건너뛴다** — 있는 모듈만 검사한다.
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var DIR = path.join(__dirname, '..', 'docs', 'answer');

function load(name) {
  var f = path.join(DIR, name + '.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { return { _err: e.message }; }
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
/** 양방향 하우스도르프 — 한 방향만 재면 곡선이 밖으로 튀어도 안 걸린다 */
function hausdorff(A, B) {
  function one(P, Q) {
    var m = 0;
    P.forEach(function (p) {
      var d = 1e9;
      Q.forEach(function (q) { d = Math.min(d, dist(p, q)); });
      m = Math.max(m, d);
    });
    return m;
  }
  return Math.max(one(A, B), one(B, A));
}

/**
 * @param name    docs/answer/<name>.json
 * @param points  { '12': [x,y], … }  엔진이 낸 번호점
 * @param curves  { 'bArm': segs }    엔진이 낸 곡선 (U.sampleSegs 로 점열화)
 * @param U       engine.util
 * @param bad     실패 메시지를 담을 배열
 * @param tol     { pt: 0.15, curve: 0.25 }
 */
function run(name, points, curves, U, bad, tol) {
  var A = load(name);
  if (!A) return { skipped: true };
  if (A._err) { bad.push('정답지 ' + name + ' 를 못 읽는다: ' + A._err); return { skipped: true }; }
  tol = tol || {}; var tp = tol.pt || 0.15, tc = tol.curve || 0.25;

  /* 정답지 자체의 품질부터 본다 — 잔차가 크면 클릭이 틀린 것이다 */
  var tr = A.transform || {};
  if (tr.residual_cm !== undefined && tr.residual_cm > 0.25)
    bad.push('정답지 ' + name + ' 잔차 ' + tr.residual_cm + ' — 보정점 좌표를 다시 볼 것');

  var n = 0, worst = 0, worstK = null;
  Object.keys(A.points || {}).forEach(function (k) {
    var got = points[k]; if (!got) return;
    n++; var d = dist(got, A.points[k]);
    if (d > worst) { worst = d; worstK = k; }
    if (d > tp) bad.push('[정답지] ' + k + '번 ' + got.map(f2).join(',') +
      ' ≠ 도면 ' + A.points[k].map(f2).join(',') + ' (차 ' + d.toFixed(2) + ')');
  });
  var cn = 0, cworst = 0;
  Object.keys(A.curves || {}).forEach(function (k) {
    var segs = curves[k]; if (!segs) return;
    cn++; var d = hausdorff(U.sampleSegs(segs, 0.05), A.curves[k]);
    if (d > cworst) cworst = d;
    if (d > tc) bad.push('[정답지] 곡선 ' + k + ' 하우스도르프 ' + d.toFixed(2) + ' > ' + tc);
  });
  return { n: n, worst: worst, worstK: worstK, cn: cn, cworst: cworst,
           mirrored: tr.mirrored, residual: tr.residual_cm };
  function f2(v) { return (+v).toFixed(2); }
}
module.exports = { run: run, load: load, hausdorff: hausdorff, DIR: DIR };
