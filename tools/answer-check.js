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
/** 점 → 선분열 최단거리. 점끼리만 재면 두 곡선의 점 간격이 다를 때 그 차이가
 *  그대로 오차로 잡힌다 (샘플이 성긴 쪽이 늘 손해를 본다). */
function toPoly(p, Q) {
  var best = 1e9;
  for (var i = 1; i < Q.length; i++) {
    var a = Q[i - 1], b = Q[i], dx = b[0] - a[0], dy = b[1] - a[1];
    var L2 = dx * dx + dy * dy;
    var t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < best) best = d;
  }
  return best;
}
/** 양방향 하우스도르프 — 한 방향만 재면 곡선이 밖으로 튀어도 안 걸린다 */
function hausdorff(A, B) {
  function one(P, Q) { var m = 0; P.forEach(function (p) { m = Math.max(m, toPoly(p, Q)); }); return m; }
  return Math.max(one(A, B), one(B, A));
}
/** 정답지가 **닿는 구간**으로 엔진 곡선을 자른다.
 *  도면에서 곡선의 끝이 다른 선과 겹쳐 못 딴 경우가 있다 (원피스 앞목선은 54 쪽
 *  2cm 를 못 땄다). 그대로 재면 정답지에 자료가 없는 구간까지 벌점이 붙어
 *  하우스도르프가 0.18 → 1.76 으로 튄다 — 곡선이 틀린 게 아니라 자료가 없는 것이다. */
function clipToRef(A, R) {
  function nearest(q) { var bi = 0, bd = 1e9;
    for (var i = 0; i < A.length; i++) { var d = dist(A[i], q); if (d < bd) { bd = d; bi = i; } }
    return bi; }
  var i0 = nearest(R[0]), i1 = nearest(R[R.length - 1]);
  if (i0 > i1) { var t = i0; i0 = i1; i1 = t; }
  return (i1 - i0 >= 3) ? A.slice(i0, i1 + 1) : A;
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
  /* 허용치는 **정답지 파일이 먼저**다 — 도면 자체가 원문과 충돌하는 자리가 있고
     (원피스 뒤 암홀 42번이 그렇다) 그 사연은 파일의 note 에 적어 둔다.
     느슨하게 두더라도 실측 하우스도르프는 반환값으로 매번 찍히므로
     숫자가 눈앞에서 사라지지는 않는다. */
  tol = Object.assign({}, tol || {}, A.tol || {});
  var tp = tol.pt || 0.15, tc = tol.curve || 0.25;

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
    /* 곡선마다 사연이 다르므로 `tol_<이름>` 으로 따로 줄 수 있다 —
       도면이 원문과 충돌하는 곡선(뒤 암홀)과 잘 맞는 곡선(앞 목선)을
       한 허용치로 묶으면 잘 맞는 쪽 검사가 무력해진다. */
    var t = A['tol_' + k] !== undefined ? A['tol_' + k] : tc;
    cn++; var d = hausdorff(clipToRef(U.sampleSegs(segs, 0.05), A.curves[k]), A.curves[k]);
    if (d > cworst) cworst = d;
    if (d > t) bad.push('[정답지] 곡선 ' + k + ' 하우스도르프 ' + d.toFixed(2) + ' > ' + t);
  });
  return { n: n, worst: worst, worstK: worstK, cn: cn, cworst: cworst,
           mirrored: tr.mirrored, residual: tr.residual_cm };
  function f2(v) { return (+v).toFixed(2); }
}
module.exports = { run: run, load: load, hausdorff: hausdorff, clipToRef: clipToRef, DIR: DIR };
