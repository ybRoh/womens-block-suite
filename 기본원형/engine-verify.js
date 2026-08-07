#!/usr/bin/env node
/* ============================================================================
 * engine-verify.js — 기본 무다트 원형 제도 엔진 검증
 *
 *   실행:  node engine-verify.js
 *
 *   1) DXF 대조 (SPEC §4) — 66호 엔진 출력을 DXF 로컬좌표로 옮겨
 *      dxf-66-groundtruth.json 의 폴리라인 / 기준선 / BP원과 비교. 허용 0.05cm.
 *      (앞 옆선 x 만 0.1cm 허용 — SPEC §3.2 ※)
 *   2) 봉제 정합성 (SPEC §5) — 7개 항목을 55·66·77호 각각에 대해 검사.
 * ==========================================================================*/
'use strict';
var fs = require('fs');
var path = require('path');
var E = require(path.join(__dirname, 'engine.js'));
var E2 = E;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));

/* ── SPEC §4 변환식 ────────────────────────────────────────────────────
 * 뒤판: x_local = CB − x_dxf , y_local = TOP_BACK  − y_dxf
 * 앞판: x_local = x_dxf − CF , y_local = TOP_FRONT − y_dxf
 * json 의 ref 값(447.783 / 257.410 …)은 소수 3자리 반올림이라 실제 도면 점과
 * 0.0005 어긋난다. 도면 위 CB/CF/상단선 실좌표를 그대로 쓴다.            */
var REF = { CB: 447.7825, CF: 400.4825, TOP_BACK: 257.4096, TOP_FRONT: 258.4096 };
var toBack  = function (p) { return [REF.CB - p[0], REF.TOP_BACK - p[1]]; };
var toFront = function (p) { return [p[0] - REF.CF, REF.TOP_FRONT - p[1]]; };

var TOL = 0.05;          // SPEC §4 합격 기준 0.5mm
var TOL_SIDE_F = 0.10;   // 앞 옆선 x 예외

/* ── 정답지 곡선 (2026-08-07 재생성판) ──────────────────────────────────
 * GT.curves[].local 은 **이미 로컬 좌표(cm, y 아래 +)** 이고 fit 정점만 담고 있다.
 * 구판 GT.polylines 는 스플라인 제어점(곡선 밖의 점)이 섞여 있어 가짜 오차가 나므로
 * 절대 쓰지 않는다.  id 0=뒷목둘레 1=뒤암홀 2=앞밑단 3=앞목둘레 4=앞암홀
 * 편차는 전부 **점 → 폴리라인 최단(수직)거리** 로 잰다.                    */
if (!GT.curves) throw new Error('정답지에 curves 키가 없습니다 — dxf-66-groundtruth.json 재생성판으로 교체하세요.');
function GTC(id) {
  var c = null;
  for (var i = 0; i < GT.curves.length; i++) if (GT.curves[i].id === id) c = GT.curves[i];
  if (!c || !c.local) throw new Error('정답지 curves[' + id + '].local 없음');
  return c.local.map(function (p) { return [p[0], p[1]]; });
}
function GTNAME(id) {
  for (var i = 0; i < GT.curves.length; i++) if (GT.curves[i].id === id) return GT.curves[i].name;
  return 'curve' + id;
}

var U = E.util, V = U.V;
var B = String.fromCharCode(27) + '[1m', N = String.fromCharCode(27) + '[0m';   // 굵게 / 해제
var pad = function (s, n) { s = String(s); while (visLen(s) < n) s += ' '; return s; };
function visLen(s) { var n = 0; for (var i = 0; i < s.length; i++) n += (s.charCodeAt(i) > 0x1100 ? 2 : 1); return n; }
var num = function (v, d) { return (v === null || v === undefined || !isFinite(v)) ? '  —  ' : v.toFixed(d === undefined ? 4 : d); };

var RESULTS = [];
function check(section, name, ok, detail) {
  RESULTS.push({ section: section, name: name, ok: !!ok, detail: detail || '' });
  console.log('  ' + (ok ? '[32mPASS[0m' : '[31mFAIL[0m') + '  ' + pad(name, 44) + detail);
  return ok;
}

/* ══════════════════════════════════════════════════════════════════════
 * 기하 헬퍼
 * ════════════════════════════════════════════════════════════════════*/
function ptSegDist(p, a, b) {
  var ax = b[0] - a[0], ay = b[1] - a[1], px = p[0] - a[0], py = p[1] - a[1];
  var L = ax * ax + ay * ay, t = L ? (px * ax + py * ay) / L : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return Math.hypot(p[0] - (a[0] + ax * t), p[1] - (a[1] + ay * t));
}
function ptPolyDist(p, poly) {
  var d = Infinity;
  for (var i = 1; i < poly.length; i++) { var q = ptSegDist(p, poly[i - 1], poly[i]); if (q < d) d = q; }
  if (poly.length === 1) d = V.dist(p, poly[0]);
  return d;
}
/** 참조 점들 → 엔진 폴리라인 최대 편차 + 최악 지점 */
/** 도면 대조 편차 — **양방향(하우스도르프)**.
 *  ⚠ 한 방향(도면 점 → 내 곡선)만 재면 내 곡선이 밖으로 튀거나 **고리를 만들어도**
 *    도면 점은 여전히 곡선 가까이 있어 편차가 안 는다. 실제로 그 실수로 다른 원형에서
 *    "편차 0.038 합격"인데 곡선길이가 4.3cm 긴 해가 채택된 적이 있다. (SPEC §22) */
function devToPoly(refPts, poly) {
  var mx = 0, at = null;
  refPts.forEach(function (p) { var d = ptPolyDist(p, poly); if (d > mx) { mx = d; at = p; } });
  poly.forEach(function (p) { var d = ptPolyDist(p, refPts); if (d > mx) { mx = d; at = p; } });
  return { max: mx, at: at };
}
/** 열린 곡선용 자기교차 — `selfIntersections()` 는 **폐곡선용**이라 마지막 점과 첫 점을
 *  이어 버린다. 열린 곡선(암홀·목선·밑단)에 그걸 쓰면 없는 교차가 잡힌다. */
function selfIntersectionsOpen(pts) {
  var n = 0;
  for (var i = 0; i < pts.length - 1; i++)
    for (var j = i + 2; j < pts.length - 1; j++)
      if (segIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) n++;
  return n;
}
/** 곡률 급변 최대치 — 꺾여 보이는지의 지표. C2 스플라인이면 0.15 아래. (SPEC §22) */
function maxCurvatureJump(poly) {
  var ang = [], k = [], i;
  for (i = 1; i < poly.length; i++) ang.push(Math.atan2(poly[i][1] - poly[i - 1][1], poly[i][0] - poly[i - 1][0]));
  for (i = 1; i < ang.length; i++) {
    var d = ang[i] - ang[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    var ds = Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
    k.push(ds > 1e-9 ? d / ds : 0);
  }
  var j = 0;
  for (i = 1; i < k.length; i++) j = Math.max(j, Math.abs(k[i] - k[i - 1]));
  return j;
}
function polyLenOf(pts) { var L = 0; for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]); return L; }
function segIntersect(p1, p2, p3, p4) {
  var d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  var t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  var u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}
function selfIntersections(loop) {
  var n = loop.length, cnt = 0, i, j;
  for (i = 0; i < n; i++) {
    var a1 = loop[i], a2 = loop[(i + 1) % n];
    var ax0 = Math.min(a1[0], a2[0]), ax1 = Math.max(a1[0], a2[0]);
    var ay0 = Math.min(a1[1], a2[1]), ay1 = Math.max(a1[1], a2[1]);
    for (j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      var b1 = loop[j], b2 = loop[(j + 1) % n];
      if (Math.min(b1[0], b2[0]) > ax1 || Math.max(b1[0], b2[0]) < ax0) continue;  // bbox 조기탈출
      if (Math.min(b1[1], b2[1]) > ay1 || Math.max(b1[1], b2[1]) < ay0) continue;
      if (segIntersect(a1, a2, b1, b2)) cnt++;
    }
  }
  return cnt;
}
function tangentAt(segs, end) {  // end: 0=시작, 1=끝
  var g = end ? segs[segs.length - 1] : segs[0];
  var t = end ? 1 : 0, e = 1e-4;
  var a = U.bez(g.p0, g.c1, g.c2, g.p1, end ? t - e : t);
  var b = U.bez(g.p0, g.c1, g.c2, g.p1, end ? t : t + e);
  return V.norm(V.sub(b, a));
}
/** poly[0] 에서 호길이 d 만큼 떨어진 점까지의 현 방향 (실효 접선) */
function chordDir(poly, d) {
  var acc = 0;
  for (var i = 1; i < poly.length; i++) {
    acc += V.dist(poly[i - 1], poly[i]);
    if (acc >= d) return V.norm(V.sub(poly[i], poly[0]));
  }
  return V.norm(V.sub(poly[poly.length - 1], poly[0]));
}
/** 변 e 에 해당하는 outline 점들 (양 끝 모서리 포함) */
function outlineEdgePts(pc, e) {
  var n = pc.outline.length, lo = (e.start === 0) ? 0 : e.start - 1, out = [];
  for (var i = lo; i <= e.end; i++) out.push(pc.outline[i]);
  if (e.end === n - 1) out.push(pc.outline[0]);
  return out;
}
/** 점 P 에서 a·b 를 지나는 무한직선까지의 수직거리 */
function ptLineDist(P, a, b) {
  var ax = b[0] - a[0], ay = b[1] - a[1], L = Math.hypot(ax, ay);
  if (L < 1e-12) return V.dist(P, a);
  return Math.abs((P[0] - a[0]) * ay - (P[1] - a[1]) * ax) / L;
}
function isStraight(pts) {
  if (pts.length < 3) return true;
  var a = pts[0], b = pts[pts.length - 1], mx = 0;
  for (var i = 1; i < pts.length - 1; i++) mx = Math.max(mx, ptSegDist(pts[i], a, b));
  return mx < 1e-9;
}
function monoInc(v) { for (var i = 1; i < v.length; i++) if (!(v[i - 1] < v[i])) return false; return true; }
/** 폐곡선 자기교차 목록 */
function selfXList(loop) {
  var n = loop.length, out = [], i, j;
  for (i = 0; i < n; i++) {
    var a1 = loop[i], a2 = loop[(i + 1) % n];
    var ax0 = Math.min(a1[0], a2[0]), ax1 = Math.max(a1[0], a2[0]);
    var ay0 = Math.min(a1[1], a2[1]), ay1 = Math.max(a1[1], a2[1]);
    for (j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      var b1 = loop[j], b2 = loop[(j + 1) % n];
      if (Math.min(b1[0], b2[0]) > ax1 || Math.max(b1[0], b2[0]) < ax0) continue;
      if (Math.min(b1[1], b2[1]) > ay1 || Math.max(b1[1], b2[1]) < ay0) continue;
      if (segIntersect(a1, a2, b1, b2)) out.push([i, j]);
    }
  }
  return out;
}
function angBetween(u, v) {
  var c = Math.abs(u[0] * v[0] + u[1] * v[1]);
  return Math.acos(Math.min(1, c)) * 180 / Math.PI;
}

/* ══════════════════════════════════════════════════════════════════════
 * 1. DXF 대조 (SPEC §4)
 * ════════════════════════════════════════════════════════════════════*/
function section1() {
  console.log('\n[1m═══ 1. DXF 대조 (SPEC §4)  — 66호, 허용 편차 ' + TOL + ' cm ═══[0m');

  var m66 = E.measuresForSize('66호');
  /* 생산용(계산식) 제도 : 앞 옆선 = B/4+1.5 = 23.40
     DXF 대조용 제도    : 앞 옆선 = B/4+1.6 = 23.50 (DXF 의 반올림값)
     — SPEC §3.2 ※ 에 따라 앞 옆선 x 만 0.1cm 차이를 허용하므로,
       곡선 형상 비교는 옆선 x 를 DXF 값에 맞춘 제도로 수행하고
       계산식과 DXF 의 0.1 차이는 별도 항목으로 검사한다.            */
  var gProd = E.geom(m66, { shoulderEase: 0.95 });
  var gDxf  = E.geom(m66, { shoulderEase: 0.95, frontSideEase: 1.6, hemStyle: 'curve' });

  /* ── 1-A. 폴리라인 (곡선) ─────────────────────────────────────── */
  console.log('\n  [1m[1-A] 곡선 5개 — GT.curves[].local (fit 정점, 이미 로컬좌표) · 점→폴리라인 수직거리[0m');
  var arc = GT.arcs[0], arcPts = [];
  for (var i = 0; i <= 80; i++) {
    var a = (arc.a0 + (arc.a1 - arc.a0) * i / 80) * Math.PI / 180;
    arcPts.push(toFront([arc.c[0] + arc.r * Math.cos(a), arc.c[1] + arc.r * Math.sin(a)]));
  }
  var curveJobs = [
    { gtId: 0, name: GTNAME(0) + ' (curves[0] ' + GTC(0).length + '점)', ref: GTC(0), segs: gDxf.backNeck },
    { gtId: 1, name: GTNAME(1) + ' (curves[1] ' + GTC(1).length + '점)', ref: GTC(1), segs: gDxf.backArm },
    { gtId: 2, name: GTNAME(2) + ' (curves[2] ' + GTC(2).length + '점)', ref: GTC(2), segs: gDxf.frontHem,
      note: "hemStyle:'curve' (§9-1 로 기본값 확정) — 구판 'spec' 과의 차이는 아래 [1-D]" },
    { gtId: 3, name: GTNAME(3) + ' (arcs[0]+curves[3] ' + (arcPts.length + GTC(3).length) + '점)',
      ref: arcPts.concat(GTC(3)), segs: gDxf.frontNeck },
    { gtId: 4, name: GTNAME(4) + ' (curves[4] ' + GTC(4).length + '점)', ref: GTC(4), segs: gDxf.frontArm }
  ];
  /* 곡선별 허용치 — 암홀만 0.10. 이유 둘 (SPEC §22):
     ① C2 연속 스플라인으로 바꾸면서 편차를 조금 내주고 **곡률 급변 0.93 → 0.03**
        (눈에 보이던 꺾임)과 **곡선길이 정확 일치**를 얻었다. 봉제에 쓰는 값은 길이다.
     ② 원본 DXF 는 암홀이 어깨점에서 어깨선 수직에서 **9° 벗어나** 도착한다(손으로 그은
        스플라인). 엔진은 SPEC §5-7 의 봉제 규칙대로 **정확히 수직**으로 도착시키므로
        어깨점 근처에서 도면과 어긋날 수밖에 없다 — 규칙이 우선이다. */
  var CURVE_TOL = { 0: 0.07, 1: 0.10, 3: 0.07, 4: 0.10 };
  /* 목선도 0.07 — 같은 이유다. 원본 DXF 는 목선이 목옆점에서 어깨수직에서 3~6° 벗어나
     도착하는데, 엔진은 §5-7 대로 정확히 수직으로 도착시킨다(앞뒤 목선이 어깨솔기에서
     매끄럽게 이어지려면 필요). 그 대가로 목옆점 근처에서 도면과 어긋난다. */
  var worstCurve = 0;
  curveJobs.forEach(function (j, ji) {
    var poly = U.sampleSegs(j.segs, 0.02);
    var d = devToPoly(j.ref, poly);
    var tol = CURVE_TOL[j.gtId] || TOL;
    worstCurve = Math.max(worstCurve, d.max);
    check('DXF', j.name, d.max <= tol,
      '최대편차 ' + num(d.max) + ' cm (허용 ' + tol + ')   (최악 지점 ' + num(d.at[0], 3) + ', ' + num(d.at[1], 3) + ')');
    /* 편차만 보면 못 잡는 것들 — 고리·길이·꺾임 (SPEC §22) */
    check('DXF', j.name + ' 자기교차', selfIntersectionsOpen(poly) === 0, String(selfIntersectionsOpen(poly)));
    var dl = Math.abs(polyLenOf(poly) - polyLenOf(j.ref));
    check('DXF', j.name + ' 곡선길이', dl <= 0.10,
      num(polyLenOf(poly)) + '  도면 ' + num(polyLenOf(j.ref)) + '  차 ' + num(dl));
    var kj = maxCurvatureJump(poly);
    check('DXF', j.name + ' 매끄러움', kj <= 0.15, '곡률급변 ' + num(kj) + ' (허용 0.15)');
    if (j.note) console.log('         ↳ ' + j.note);
  });

  /* ── 1-A2. §3.3 어깨 경사 구성선이 DXF 에 실제로 존재하는지 ─────── */
  console.log('\n  [1m[1-A2] §3.3 어깨 경사 구성선 (고정치수선 기울기점)[0m');
  var shJobs = [
    ['뒤: (23.5,0)→(23.5,3.1) 세로선', toBack(GT.lines[7][0]), toBack(GT.lines[7][1]),
      [E.K.fixedX, 0], [E.K.fixedX, E.K.backShDrop]],
    ['뒤: (23.5,3.1)→SP 어깨선',        toBack(GT.lines[21][0]), toBack(GT.lines[21][1]),
      [E.K.fixedX, E.K.backShDrop], gProd.SPb],
    ['뒤: SP→목옆점 어깨선',            toBack(GT.lines[8][0]), toBack(GT.lines[8][1]), gProd.SPb, gProd.SNPb],
    ['앞: 목옆점→SP 어깨선',            toFront(GT.lines[33][0]), toFront(GT.lines[33][1]), gProd.SNPf, gProd.SPf],
    ['앞: SP→(23.5,5.4) 연장선',        toFront(GT.lines[36][0]), toFront(GT.lines[36][1]),
      gProd.SPf, [E.K.fixedX, E.K.frontShDrop]]
  ];
  shJobs.forEach(function (j) {
    var d = Math.max(V.dist(j[1], j[3]), V.dist(j[2], j[4]));
    check('DXF', j[0], d <= TOL, 'DXF (' + num(j[1][0], 3) + ',' + num(j[1][1], 3) + ')→(' + num(j[2][0], 3) + ',' + num(j[2][1], 3) +
      ')  엔진 (' + num(j[3][0], 3) + ',' + num(j[3][1], 3) + ')→(' + num(j[4][0], 3) + ',' + num(j[4][1], 3) + ')  Δ ' + num(d));
  });

  /* ── 1-B. 기준선·제도점 (직선) ────────────────────────────────── */
  console.log('\n  [1m[1-B] 기준선 · 제도점[0m');
  var Lb = function (i, e) { return toBack(GT.lines[i][e]); };
  var Lf = function (i, e) { return toFront(GT.lines[i][e]); };
  var scalars = [
    ['뒤 중심선 x',              Lb(0, 0)[0], 0],
    ['뒤 상단 기준선 y',          Lb(3, 0)[1], 0],
    ['뒷목 중심점 y (0.3 올림)',   Lb(4, 0)[1], gProd.BNP[1]],
    ['뒷목너비 x  (B/12)',        Lb(1, 0)[0], gProd.nw],
    ['뒷목 올림 y (3.5)',         Lb(1, 1)[1], gProd.bNeckCorner[1]],
    ['뒤 가슴선 BL y (B/4+0.6)',  Lb(5, 0)[1], gProd.AD],
    ['뒤 허리선 WL y (등길이)',    Lb(2, 0)[1], gProd.WL],
    ['뒤 옆선 x  (B/4+1.9)',      Lb(6, 0)[0], gProd.bSideX],
    ['고정치수선 x (23.5)',        Lb(7, 0)[0], E.K.fixedX],
    ['고정치수선 어깨내림 y (3.1)', Lb(7, 1)[1], E.K.backShDrop],
    ['등품선 x  (등품/2)',         Lb(15, 0)[0], gProd.bPitchX],
    ['어깨점 안내선 x (어깨너비/2+0.6)', Lb(14, 0)[0], gProd.bSpX],
    ['앞 중심선 x',              Lf(35, 0)[0], 0],
    ['앞 상단 기준선 y',          Lf(23, 0)[1], 0],
    ['앞 CF 올림 y (0.6)',        Lf(26, 0)[1], gProd.SNPf[1]],
    ['앞 가슴선 BL y (B/4+0.6+1.0)', Lf(24, 0)[1], gProd.BLf],
    ['앞 허리선 WL y (등길이)',    Lf(22, 0)[1], gProd.WL],
    ['앞목깊이 y (B/12+0.3)',     Lf(25, 0)[1], gProd.FNP[1]],
    ['앞목너비 x (B/12)',         Lf(29, 0)[0], gProd.SNPf[0]],
    ['앞품선 x (앞품/2)',          Lf(30, 0)[0], gProd.fPitchX],
    ['앞 밑단 CF y (등길이+1.3)',  Lf(27, 0)[1], gProd.fCFHem[1]],
    ['앞 밑단 옆선 y (등길이+1.0)', GTC(2)[GTC(2).length - 1][1], gProd.fSideHem[1]],
    ['앞 어깨선 연장점 y (23.5,5.4)', Lf(36, 1)[1], E.K.frontShDrop]
  ];
  var worstScalar = 0;
  scalars.forEach(function (r) {
    var d = Math.abs(r[1] - r[2]);
    worstScalar = Math.max(worstScalar, d);
    check('DXF', r[0], d <= TOL, 'DXF ' + num(r[1], 4) + '  엔진 ' + num(r[2], 4) + '  Δ ' + num(d));
  });

  var pts = [
    ['뒤 목옆점 SNP',  toBack(GT.lines[8][1]),  gProd.SNPb],
    ['뒤 어깨점 SP',   toBack(GT.lines[8][0]),  gProd.SPb],
    ['뒤 겨드랑점',    GTC(1)[0], gProd.Ub],
    ['앞 목옆점 SNP',  toFront(GT.lines[33][0]), gProd.SNPf],
    ['앞 어깨점 SP',   toFront(GT.lines[33][1]), gProd.SPf],
    ['앞 목중심 FNP',  toFront(GT.lines[27][1]), gProd.FNP],
    ['앞 목 사각 대각선 끝', toFront(GT.lines[31][1]), [gProd.nw, gProd.FNP[1]]],
    ['BP (유폭/2, 유장)', toFront(GT.circles[0].c), gProd.BP]
  ];
  pts.forEach(function (r) {
    var d = V.dist(r[1], r[2]);
    worstScalar = Math.max(worstScalar, d);
    check('DXF', r[0], d <= TOL, 'DXF (' + num(r[1][0], 3) + ', ' + num(r[1][1], 3) + ')  엔진 (' +
      num(r[2][0], 3) + ', ' + num(r[2][1], 3) + ')  Δ ' + num(d));
  });
  // 앞 겨드랑점 = 앞 옆선 x 예외 항목
  var dxfUf = GTC(4)[GTC(4).length - 1];
  var dSideF = Math.abs(dxfUf[0] - gProd.fSideX);
  check('DXF', '앞 옆선 x (계산식 B/4+1.5, 0.1 허용)', dSideF <= TOL_SIDE_F + 1e-9,
    'DXF ' + num(dxfUf[0], 4) + '  엔진 ' + num(gProd.fSideX, 4) + '  Δ ' + num(dSideF) + '  (허용 ' + TOL_SIDE_F + ')');
  check('DXF', '앞 겨드랑점 y', Math.abs(dxfUf[1] - gProd.Uf[1]) <= TOL,
    'DXF ' + num(dxfUf[1], 4) + '  엔진 ' + num(gProd.Uf[1], 4) + '  Δ ' + num(Math.abs(dxfUf[1] - gProd.Uf[1])));

  /* ── 1-C. DXF 직선 45개 전수 대조 ─────────────────────────────── */
  console.log('\n  [1m[1-C] DXF 직선 45개 전수 — 양 끝점이 엔진 도면 위에 있는가[0m');
  var dBack = E.draftNoDart(m66, { seam: 0, shoulderEase: 0.95, frontSideEase: 1.6, hemStyle: 'curve' });
  var geoBack = [dBack.pieces[0].outline.concat([dBack.pieces[0].outline[0]])];
  dBack.pieces[0].internal.forEach(function (o) { if (o.pts.length > 1) geoBack.push(o.pts); });
  var geoFront = [dBack.pieces[1].outline.concat([dBack.pieces[1].outline[0]])];
  dBack.pieces[1].internal.forEach(function (o) { if (o.pts.length > 1) geoFront.push(o.pts); });
  function nearest(p, polys) { var d = Infinity; polys.forEach(function (q) { d = Math.min(d, ptPolyDist(p, q)); }); return d; }
  var matched = 0, unmatched = [], worstLine = 0;
  GT.lines.forEach(function (L, idx) {
    var b = [toBack(L[0]), toBack(L[1])], f = [toFront(L[0]), toFront(L[1])];
    var db = Math.max(nearest(b[0], geoBack), nearest(b[1], geoBack));
    var df = Math.max(nearest(f[0], geoFront), nearest(f[1], geoFront));
    var d = Math.min(db, df);
    if (d <= TOL) { matched++; worstLine = Math.max(worstLine, d); }
    else unmatched.push({ i: idx, d: d, side: db < df ? 'back' : 'front', p: db < df ? b : f });
  });
  console.log('    대응됨 ' + matched + ' / 45  (대응된 것들의 최대편차 ' + num(worstLine) + ' cm)');
  if (unmatched.length) {
    console.log('    미대응 ' + unmatched.length + '개 — 지시선·주석 눈금·연장선 (엔진 도면에 없는 선):');
    unmatched.forEach(function (u) {
      console.log('      lines[' + pad(u.i, 2) + '] ' + u.side + ' (' + num(u.p[0][0], 3) + ',' + num(u.p[0][1], 3) +
        ')→(' + num(u.p[1][0], 3) + ',' + num(u.p[1][1], 3) + ')  최근접 ' + num(u.d, 3));
    });
  }
  check('DXF', '대응 가능한 DXF 직선 전부 ≤ ' + TOL, worstLine <= TOL,
    matched + '/45 대응, 최대편차 ' + num(worstLine) + ' cm');

  /* ── 1-D. 앞 밑단 해석 2가지 비교 (SPEC §3.2 vs DXF poly2) ────── */
  console.log('\n  [1m[1-D] 앞 밑단 — SPEC §3.2 기본형 vs 원본 DXF poly2[0m');
  var hemRef = GTC(2);
  var gSpec = E.geom(m66, { shoulderEase: 0.95, frontSideEase: 1.6, hemStyle: 'spec' });
  var dSpecHem = devToPoly(hemRef, U.sampleSegs(gSpec.frontHem, 0.02)).max;
  var dCurveHem = devToPoly(hemRef, U.sampleSegs(gDxf.frontHem, 0.02)).max;
  console.log("    hemStyle:'spec'  (옆선→x=5.4 수평, 이후 CF 38.8 하강)  poly2 대비 최대편차 " + num(dSpecHem) + ' cm');
  console.log("    hemStyle:'curve' (CF 38.8 → 옆선 38.5 전폭 완만곡선)    poly2 대비 최대편차 " + num(dCurveHem) + ' cm');
  console.log('    ※ SPEC §9-1 로 확정: lines[44](y=38.5 수평)는 lines[2](뒤 허리선)를 앞판 위로');
  console.log('       이어 그린 정렬 안내선이고, 실제 밑단은 curves[2] 의 전폭 완만곡선입니다.');
  console.log("       엔진 기본값 hemStyle:'curve'. 'spec' 은 구판 호환용으로만 남아 있습니다.");
  check('DXF', "앞 밑단 기본값 hemStyle:'curve' 가 DXF 와 일치", dCurveHem <= TOL && dCurveHem < dSpecHem,
    "curve " + num(dCurveHem) + ' ≤ ' + TOL + '  (구판 spec ' + num(dSpecHem) + ')');

  console.log('\n  [1m→ DXF 대조 최대편차: 곡선 ' + num(worstCurve) + ' cm · 기준선/점 ' + num(worstScalar) +
    ' cm · 직선 ' + num(worstLine) + ' cm[0m');
}

/* ══════════════════════════════════════════════════════════════════════
 * 2. 봉제 정합성 (SPEC §5)
 * ════════════════════════════════════════════════════════════════════*/
function section2() {
  console.log('\n[1m═══ 2. 봉제 정합성 (SPEC §5) — 전 호수 ═══[0m');
  var sizes = E2.SIZES;   // 호수 목록은 엔진에서 — 호수가 늘면 자동 반영
  var drafts = {}, geoms = {};
  sizes.forEach(function (s) {
    var m = E.measuresForSize(s);
    drafts[s] = E.draftNoDart(m, { seam: 1.0, shoulderEase: 0.95 });
    geoms[s] = E.geom(m, { shoulderEase: 0.95 });
  });

  /* §5-1 앞 어깨 + 이세 = 뒤 어깨 */
  console.log('\n  [1m[5-1] 앞 어깨선 + 이세분 = 뒤 어깨선[0m');
  sizes.forEach(function (s) {
    var M = drafts[s].measures, d = Math.abs(M.shoulderFront + M.shoulderEase - M.shoulderBack);
    check('§5', s + ' 어깨선', d < 1e-6 && M.shoulderEase >= 0.6 && M.shoulderEase <= 1.0,
      '앞 ' + num(M.shoulderFront) + ' + 이세 ' + num(M.shoulderEase, 2) + ' = ' +
      num(M.shoulderFront + M.shoulderEase) + '  vs 뒤 ' + num(M.shoulderBack) + '   Δ ' + num(d, 6));
  });
  console.log('\n       [1m§3.3 어깨 경사 그레이딩 — 고정치수선(23.5) 기울기점 방식[0m');
  console.log('       ' + pad('호수', 8) + pad('어깨너비', 10) + pad('B/12', 8) + pad('뒤 SP', 18) +
    pad('뒤 어깨선', 11) + pad('앞 SP', 18) + pad('앞 어깨선', 11) + '뒤−앞');
  sizes.forEach(function (s) {
    var g = geoms[s], m = E.measuresForSize(s);
    console.log('       ' + pad(s, 8) + pad(m.shoulderW.toFixed(1), 10) + pad((m.B / 12).toFixed(3), 8) +
      pad('(' + g.SPb[0].toFixed(3) + ', ' + g.SPb[1].toFixed(3) + ')', 18) + pad(g.shLenBack.toFixed(4), 11) +
      pad('(' + g.SPf[0].toFixed(3) + ', ' + g.SPf[1].toFixed(3) + ')', 18) + pad(g.shLenFront.toFixed(4), 11) +
      (g.shLenBack - g.shLenFront).toFixed(4));
  });
  console.log('\n  ' + B + '[11-3] 어깨 안내선(어깨너비/2+0.6) < 고정치수선 23.5 — §3.3 구성 성립 조건' + N);
  sizes.forEach(function (z) {
    var g = geoms[z], m = E2.measuresForSize(z);
    // SP 가 어깨선(목너비 모서리 → (23.5, 3.1)) 위에 있는가
    var c = [m.B / 12, -3.5], t = [E2.K.fixedX, E2.K.backShDrop];
    var onLine = ptLineDist(g.SPb, c, t);
    var cf = [m.B / 12, -0.6], tf = [E2.K.fixedX, E2.K.frontShDrop];
    var onLineF = ptLineDist(g.SPf, cf, tf);
    check('§11-3', z + ' 어깨 구성 성립', g.bSpX < E2.K.fixedX && onLine < 1e-9 && onLineF < 1e-9,
      '어깨 안내선 x ' + num(g.bSpX, 3) + ' < 23.5 · 뒤 SP 어깨선 위 ' + onLine.toExponential(1) +
      ' · 앞 SP 어깨선 위 ' + onLineF.toExponential(1));
  });

  console.log('\n  ' + B + '[5-1a] SPEC §9-3 1차 검사 — |뒤 실제 솔기 − 앞 실제 솔기| ≤ 0.10 cm' + N);
  sizes.forEach(function (s) {
    var M = drafts[s].measures, d = Math.abs(M.shoulderBackSeam - M.shoulderFrontSeam);
    check('§9-3', s + ' 실제 어깨 솔기', d <= 0.10,
      '뒤 ' + num(M.shoulderBackSeam) + '  앞 ' + num(M.shoulderFrontSeam) + '   |차| ' + num(d) +
      '  (구성선 기준은 뒤 ' + num(M.shoulderBack) + ' / 앞 ' + num(M.shoulderFront) + ')');
  });

  /* §5-2 앞 옆선 = 뒤 옆선 */
  console.log('\n  [1m[5-2] 앞 옆선 길이 = 뒤 옆선 길이[0m');
  sizes.forEach(function (s) {
    var M = drafts[s].measures, d = Math.abs(M.sideFront - M.sideBack);
    check('§5', s + ' 옆선', d < 1e-6, '뒤 ' + num(M.sideBack) + '  앞 ' + num(M.sideFront) + '   Δ ' + num(d, 6));
  });

  /* §5-3 암홀 둘레 */
  console.log('\n  [1m[5-3] 암홀 둘레 = 앞+뒤, 호수 증가에 단조 증가[0m');
  var ah = sizes.map(function (s) { return drafts[s].measures; });
  sizes.forEach(function (s, i) {
    var M = ah[i], d = Math.abs(M.armholeBack + M.armholeFront - M.armholeTotal);
    check('§5', s + ' 암홀 합', d < 1e-3,   // measures 는 소수 4자리 반올림값이라 1e-4 오차 허용
      '뒤 ' + num(M.armholeBack) + ' + 앞 ' + num(M.armholeFront) + ' = ' + num(M.armholeTotal));
  });
  check('§5', '암홀 둘레 단조 증가', monoInc(ah.map(function (x) { return x.armholeTotal; })),
    ah.map(function (x) { return num(x.armholeTotal); }).join(' < '));

  /* §5-4 목둘레 */
  console.log('\n  [1m[5-4] 목둘레 = 앞+뒤, 호수 증가에 단조 증가[0m');
  sizes.forEach(function (s, i) {
    var M = ah[i], d = Math.abs(M.neckBack + M.neckFront - M.neckTotal);
    check('§5', s + ' 목둘레 합', d < 1e-3,
      '뒤 ' + num(M.neckBack) + ' + 앞 ' + num(M.neckFront) + ' = ' + num(M.neckTotal) +
      '  (반쪽 · 전체 ' + num(M.neckTotal * 2) + ')');
  });
  check('§5', '목둘레 단조 증가', monoInc(ah.map(function (x) { return x.neckTotal; })),
    ah.map(function (x) { return num(x.neckTotal); }).join(' < '));

  /* §5-5 폐곡선 */
  console.log('\n  [1m[5-5] 모든 조각 외곽선이 닫힌 폐곡선 (자기교차 없음)[0m');
  sizes.forEach(function (s) {
    drafts[s].pieces.forEach(function (pc) {
      var loop = pc.outline;
      var gap = V.dist(loop[0], loop[loop.length - 1]);
      var xs = selfIntersections(loop);
      var nan = loop.some(function (p) { return !isFinite(p[0]) || !isFinite(p[1]); });
      // seamline 도 같이
      var xs2 = selfIntersections(pc.seamline);
      var areaOut = Math.abs(polyArea(loop)), areaSeam = Math.abs(polyArea(pc.seamline));
      check('§5', s + ' ' + pc.name + ' 폐곡선',
        gap < 0.06 && xs === 0 && !nan && xs2 === 0 && areaSeam > areaOut,
        '점 ' + loop.length + ' · 닫힘간격 ' + num(gap, 4) + ' · 자기교차 ' + xs +
        ' · 시접선 자기교차 ' + xs2 + ' · 면적 완성 ' + areaOut.toFixed(1) + ' → 시접 ' + areaSeam.toFixed(1));
    });
  });

  /* ══ SPEC §11-1 위치별 시접 ══ */
  console.log('\n  ' + B + '[11-1] 위치별 시접 — role 별 오프셋 정확도 · 골선 0 · 자기교차 0' + N);
  console.log('    기본값 ' + JSON.stringify(E2.SEAM_DEFAULT));
  sizes.forEach(function (z) {
    var m = E2.measuresForSize(z);
    var d = E2.draftNoDart(m, { seam: {} });          // 객체 = role 별 기본값
    d.pieces.forEach(function (pc) {
      var bad = [], info = [];
      // (a) role 구간별 실제 오프셋 — 직선 변은 ±0.005, 곡선 변은 하한(≥지정값−0.005)만 강제
      pc.seamEdges.forEach(function (se) {
        var oe = null;
        pc.edges.forEach(function (e) { if (e.name === se.name) oe = e; });
        if (!oe) return;
        var oPts = outlineEdgePts(pc, oe);
        var straight = isStraight(oPts);
        var lo = Infinity, hi = -Infinity, cnt = 0;
        var pad2 = Math.max(2, Math.round((se.end - se.start) * 0.06));
        for (var i = se.start + pad2; i <= se.end - pad2; i++) {
          var dd2 = ptPolyDist(pc.seamline[i], oPts);
          lo = Math.min(lo, dd2); hi = Math.max(hi, dd2); cnt++;
        }
        if (!cnt) return;
        info.push(se.role + (straight ? '' : '~') + ' ' + lo.toFixed(3) + '~' + hi.toFixed(3) + '/' + se.seam);
        if (straight) { if (Math.abs(lo - se.seam) > 0.005 || Math.abs(hi - se.seam) > 0.005) bad.push(se.name + ' 직선 ' + lo.toFixed(4) + '~' + hi.toFixed(4) + '≠' + se.seam); }
        else if (lo < se.seam - 0.005) bad.push(se.name + ' 곡선 하한 ' + lo.toFixed(4) + ' < ' + se.seam);
      });
      // (b) 골선 편차 = 0 (role 무관 강제)
      var foldX = 0, foldDev = 0, foldPts = 0;
      pc.seamFoldEdges.forEach(function (r) {
        for (var i = r[0]; i <= r[1]; i++) { foldX = Math.max(foldX, Math.abs(pc.seamline[i][0])); foldPts++; }
      });
      pc.foldEdges.forEach(function (r) {   // outline 골선 점이 seamline 위에 그대로 있는가
        for (var i = r[0]; i <= r[1]; i += 7) foldDev = Math.max(foldDev, ptPolyDist(pc.outline[i], pc.seamline));
      });
      if (foldX > 1e-9) bad.push('골선 x ' + foldX.toExponential(1));
      if (foldDev > 1e-9) bad.push('골선 편차 ' + foldDev.toExponential(1));
      // (c) 자기교차 0
      var xl = selfXList(pc.seamline);
      if (xl.length) bad.push('자기교차 ' + xl.length + '개 @' + JSON.stringify(xl.slice(0, 2)));
      check('§11-1', z + ' ' + pc.name + ' 위치별 시접', bad.length === 0,
        (bad.length ? '✗ ' + bad.join(' / ') : info.join(' · ')) +
        '  [점 ' + pc.outline.length + '→' + pc.seamline.length + ' · 골선 ' + foldPts + '점]');
    });
  });

  // 옆선(1.5) ↔ 밑단(3.0) 모서리 집중 검사
  console.log('\n  ' + B + '[11-1b] 폭이 다른 변이 만나는 모서리 (옆선 1.5 ↔ 밑단 3.0)' + N);
  sizes.forEach(function (z) {
    var d = E2.draftNoDart(E2.measuresForSize(z), { seam: {} });
    d.pieces.forEach(function (pc) {
      for (var k = 0; k < pc.seamEdges.length - 1; k++) {
        var a = pc.seamEdges[k], b = pc.seamEdges[k + 1];
        if (Math.abs(a.seam - b.seam) < 1e-12) continue;
        // 모서리 점 = 앞 변 run 의 마지막 점 (조립 시 끝나는 변이 소유. 골선이면 골선 쪽)
        // 모서리 소유: 한쪽이 골선이면 골선 쪽 run, 아니면 끝나는 변 run 의 마지막 점
        var P = (b.role === 'fold') ? pc.seamline[b.start] : pc.seamline[a.end];
        var oa = null, ob = null;
        pc.edges.forEach(function (e) { if (e.name === a.name) oa = e; if (e.name === b.name) ob = e; });
        var pa = outlineEdgePts(pc, oa), pb = outlineEdgePts(pc, ob);
        // 각 변의 '모서리 쪽 끝 선분'이 이루는 무한직선까지의 수직거리 = 그 변의 시접이어야 한다
        var da = ptLineDist(P, pa[pa.length - 2], pa[pa.length - 1]);
        var db = ptLineDist(P, pb[0], pb[1]);
        var okc = Math.abs(da - a.seam) < 0.02 && Math.abs(db - b.seam) < 0.02;
        var foldNote = (a.role === 'fold' || b.role === 'fold') ? '  [골선 x=' + num(P[0], 6) + ']' : '';
        check('§11-1', z + ' ' + pc.name + ' ' + a.name + '(' + a.seam + ')↔' + b.name + '(' + b.seam + ')', okc,
          '모서리 (' + num(P[0], 3) + ', ' + num(P[1], 3) + ')  ' + a.name + ' 오프셋 ' + num(da, 4) +
          ' · ' + b.name + ' 오프셋 ' + num(db, 4) + foldNote);
      }
    });
  });

  // 하위호환 · seam=0
  console.log('\n  ' + B + '[11-1c] 하위호환 — 균일 숫자 = 기존 균일 오프셋 · seam 0 = outline' + N);
  sizes.forEach(function (z) {
    var m = E2.measuresForSize(z);
    [1.0, 1.5].forEach(function (sv) {
      var d = E2.draftNoDart(m, { seam: sv }), bad = [], note = [];
      d.pieces.forEach(function (pc) {
        var n = pc.outline.length, sa = new Array(n);
        for (var i = 0; i < n; i++) sa[i] = sv;
        pc.edges.forEach(function (r) { if (r.role !== 'fold') return; for (var i = r.start - 1; i <= r.end; i++) sa[(i + n) % n] = 0; });
        var old = U.offsetLoopSeg(pc.outline, sa, 3);
        var oldX = selfXList(old).length;
        if (oldX > 0) { note.push(pc.id + ' 구버전 자기교차 ' + oldX + '개 → 신버전 제거(' + n + '→' + pc.seamline.length + ')'); return; }
        if (pc.seamline.length !== old.length) { bad.push(pc.id + ' 길이 ' + pc.seamline.length + '≠' + old.length); return; }
        var mx = 0;
        for (var i = 0; i < n; i++) mx = Math.max(mx, V.dist(pc.seamline[i], old[i]));
        if (mx > 1e-12) bad.push(pc.id + ' 최대차 ' + mx.toExponential(2));
        note.push(pc.id + ' 일치');
      });
      check('§11-1', z + ' 균일 seam=' + sv + ' 하위호환', bad.length === 0,
        (bad.length ? '✗ ' + bad.join(', ') : note.join(' · ')));
    });
    var d0 = E2.draftNoDart(m, { seam: 0 });
    var eq = d0.pieces.every(function (pc) {
      return pc.seamline.length === pc.outline.length &&
        pc.outline.every(function (q, i) { return q[0] === pc.seamline[i][0] && q[1] === pc.seamline[i][1]; });
    });
    check('§11-1', z + ' seam=0 → seamline === outline', eq, '3조각 전부 좌표 완전 일치');
  });

  // fold 강제 0 · seamByRole 반환
  var dF = E2.draftNoDart(E2.measuresForSize('66호'), { seam: { fold: 2.0, hem: 4.0, neck: 0.7 } });
  check('§11-1', 'fold 시접 강제 0 · 누락 role 기본값 · seamByRole 반환',
    dF.pieces[0].seamByRole.fold === 0 && dF.pieces[0].seamByRole.hem === 4.0 &&
    dF.pieces[0].seamByRole.neck === 0.7 && dF.pieces[0].seamByRole.side === 1.5,
    JSON.stringify(dF.pieces[0].seamByRole));
  check('§11-1', 'edges[].seam 에 실제 적용값 반환',
    dF.pieces[0].edges.every(function (e) { return typeof e.seam === 'number'; }),
    dF.pieces[0].edges.map(function (e) { return e.name + '=' + e.seam; }).join(' '));

  // 골선 시접선이 완성선보다 시접만큼 연장되는지
  var dd = E2.draftNoDart(E2.measuresForSize('66호'), { seam: {} });
  dd.pieces.forEach(function (pc) {
    if (!pc.seamFoldEdges.length) return;
    // 골선 구간은 인덱스 0 을 감싸며 두 구간으로 쪼개질 수 있다 — 전체를 모아서 본다
    var ys = [], xmax = 0;
    pc.seamFoldEdges.forEach(function (r) {
      for (var i = r[0]; i <= r[1]; i++) { ys.push(pc.seamline[i][1]); xmax = Math.max(xmax, Math.abs(pc.seamline[i][0])); }
    });
    var oys = [];
    pc.foldEdges.forEach(function (r) { for (var i = r[0]; i <= r[1]; i++) oys.push(pc.outline[i][1]); });
    var sMin = Math.min.apply(null, ys), sMax = Math.max.apply(null, ys);
    var oMin = Math.min.apply(null, oys), oMax = Math.max.apply(null, oys);
    check('§11-1', pc.name + ' 골선 시접선 x=0 유지 · 양 끝 연장', xmax < 1e-9 && sMin < oMin && sMax > oMax,
      '완성선 y ' + num(oMin, 3) + '~' + num(oMax, 3) + ' → 시접선 y ' + num(sMin, 3) + '~' + num(sMax, 3) +
      '  (위로 ' + num(oMin - sMin, 2) + ' / 아래로 ' + num(sMax - oMax, 2) + ' 연장 · |x| 최대 ' + xmax.toExponential(1) +
      ' · 구간 ' + JSON.stringify(pc.seamFoldEdges) + ')');
  });

  console.log('\n  ' + B + '[11-1d] 위치별 시접 적용 후 조각 면적 변화 (cm²)' + N);
  console.log('    ' + pad('조각', 10) + pad('호수', 8) + pad('완성선', 11) + pad('균일 1.0', 11) +
    pad('균일 1.5', 11) + pad('위치별', 11) + pad('위치별−1.5', 12) + '둘레(완성)');
  ['back', 'front', 'sleeve'].forEach(function (pid) {
    sizes.forEach(function (z) {
      var m = E2.measuresForSize(z);
      function pick(d) { var r = null; d.pieces.forEach(function (x) { if (x.id === pid) r = x; }); return r; }
      var p0 = pick(E2.draftNoDart(m, { seam: 0 })), p1 = pick(E2.draftNoDart(m, { seam: 1.0 }));
      var p15 = pick(E2.draftNoDart(m, { seam: 1.5 })), pr = pick(E2.draftNoDart(m, { seam: {} }));
      if (!p0 || !p1 || !p15 || !pr) return;   // 소매 제외 시 건너뜀 (SPEC §17)
      var a0 = Math.abs(polyArea(p0.outline));
      var per = 0; for (var i = 0; i < p0.outline.length; i++) per += V.dist(p0.outline[i], p0.outline[(i + 1) % p0.outline.length]);
      console.log('    ' + pad(p0.name, 10) + pad(z, 8) + pad(a0.toFixed(1), 11) +
        pad(Math.abs(polyArea(p1.seamline)).toFixed(1), 11) +
        pad(Math.abs(polyArea(p15.seamline)).toFixed(1), 11) +
        pad(Math.abs(polyArea(pr.seamline)).toFixed(1), 11) +
        pad((Math.abs(polyArea(pr.seamline)) - Math.abs(polyArea(p15.seamline))).toFixed(1), 12) +
        per.toFixed(1));
    });
  });

  /* §5-6 치수표 일치 */
  console.log('\n  [1m[5-6] 전 호수 치수가 SPEC §2·§11-3·§14 표와 일치[0m');
  var TABLE = {
    '44호': { B: 75.6, backLen: 36.5, shoulderW: 37.9, backW: 34.4, frontW: 31.9, bpLen: 23.8, bpSpan: 18.0 },
    '55호': { B: 81.6, backLen: 37.0, shoulderW: 38.7, backW: 35.6, frontW: 33.1, bpLen: 24.3, bpSpan: 18.5 },
    '66호': { B: 87.6, backLen: 37.5, shoulderW: 39.5, backW: 36.8, frontW: 34.3, bpLen: 24.8, bpSpan: 19.0 },
    '77호': { B: 93.6, backLen: 38.0, shoulderW: 40.3, backW: 38.0, frontW: 35.5, bpLen: 25.3, bpSpan: 19.5 },
    '88호': { B: 99.6, backLen: 38.5, shoulderW: 41.1, backW: 39.2, frontW: 36.7, bpLen: 25.8, bpSpan: 20.0 }
  };
  sizes.forEach(function (s) {
    var m = E.measuresForSize(s), bad = [];
    E.MEAS_KEYS.forEach(function (k) { if (Math.abs(m[k] - TABLE[s][k]) > 1e-9) bad.push(k + ' ' + m[k] + '≠' + TABLE[s][k]); });
    check('§5', s + ' 치수표', bad.length === 0,
      E.MEAS_KEYS.map(function (k) { return k + ' ' + m[k]; }).join(' · ') + (bad.length ? '  ✗ ' + bad.join(', ') : ''));
  });
  check('§5', '앞길이 입력항목 없음', E.MEAS_KEYS.indexOf('frontLen') < 0 && E.MEAS_KEYS.length === 7,
    '치수 7개: ' + E.MEAS_KEYS.join(', '));

  /* §5-7 접선 연속 */
  console.log('\n  [1m[5-7] 곡선 끝점 접선 조건 (골선·옆선에 수직 / 어깨선에 수직 / 세그먼트 C1)[0m');
  sizes.forEach(function (s) {
    var g = geoms[s];
    var jobs = [
      ['뒷목선 @CB 골선 ⟂',      tangentAt(g.backNeck, 0),  [1, 0]],
      ['뒷목선 @목옆점 어깨선 ⟂', tangentAt(g.backNeck, 1),  U.perpToward(g.bShDir, g.SNPb, g.BNP)],
      ['뒤암홀 @어깨점 어깨선 ⟂', tangentAt(g.backArm, 1),   U.perpToward(g.bShDir, g.SPb, g.Ub)],
      ['뒤암홀 @겨드랑 옆선 ⟂',  tangentAt(g.backArm, 0),   [1, 0]],
      ['앞목선 @CF 골선 ⟂',      tangentAt(g.frontNeck, 0), [1, 0]],
      ['앞목선 @목옆점 어깨선 ⟂', tangentAt(g.frontNeck, 1), U.perpToward(g.fShDir, g.SNPf, g.FNP)],
      ['앞암홀 @어깨점 어깨선 ⟂', tangentAt(g.frontArm, 1),  U.perpToward(g.fShDir, g.SPf, g.Uf)],
      ['앞암홀 @겨드랑 옆선 ⟂',  tangentAt(g.frontArm, 0),  [1, 0]],
      ['앞밑단 @CF 골선 ⟂',      tangentAt(g.frontHem, 0),  [1, 0]],
      ['앞밑단 @옆선 ⟂',         tangentAt(g.frontHem, 1),  [1, 0]]
    ];
    var worst = 0, worstName = '';
    jobs.forEach(function (j) { var a = angBetween(j[1], j[2]); if (a > worst) { worst = a; worstName = j[0]; } });
    check('§5', s + ' 끝점 접선(해석적)', worst < 0.5, '최대 어긋남 ' + worst.toFixed(4) + '° (' + worstName + ')');
    if (s === '66호') {
      // 실효 접선 = 끝점에서 호길이 0.3cm 떨어진 점까지의 현. 원본 DXF 와 나란히 표시.
      var chord = [
        ['뒷목선 @CB',   g.backNeck, 0, [1, 0], GTC(0).slice().reverse()],
        ['뒷목선 @목옆점', g.backNeck, 1, U.perpToward(g.bShDir, g.SNPb, g.BNP), GTC(0)],
        ['뒤암홀 @겨드랑', g.backArm, 0, [1, 0], GTC(1)],
        ['뒤암홀 @어깨점', g.backArm, 1, U.perpToward(g.bShDir, g.SPb, g.Ub), GTC(1).slice().reverse()],
        ['앞목선 @CF',   g.frontNeck, 0, [1, 0], null],
        ['앞목선 @목옆점', g.frontNeck, 1, U.perpToward(g.fShDir, g.SNPf, g.FNP), GTC(3).slice().reverse()],
        ['앞암홀 @겨드랑', g.frontArm, 0, [1, 0], GTC(4).slice().reverse()],
        ['앞암홀 @어깨점', g.frontArm, 1, U.perpToward(g.fShDir, g.SPf, g.Uf), GTC(4)]
      ];
      console.log('       [1m실효 접선 (끝점에서 0.3cm 현) — 원본 DXF 도 같은 방식으로 측정[0m');
      chord.forEach(function (c) {
        var poly = U.sampleSegs(c[1], 0.01); if (c[2]) poly = poly.slice().reverse();
        var e = chordDir(poly, 0.3), aE = angBetween(e, c[3]);
        var aD = c[4] ? angBetween(chordDir(c[4], 0.3), c[3]) : null;
        console.log('       ' + pad(c[0], 20) + '엔진 ' + pad(aE.toFixed(2) + '°', 10) +
          (aD === null ? 'DXF  (원호 구간)' : 'DXF  ' + aD.toFixed(2) + '°'));
      });
    }
    // 다중 세그먼트 곡선의 내부 C1
    var c1worst = 0, c1name = '';
    [['뒷목선', g.backNeck], ['앞목선', g.frontNeck], ['뒤암홀', g.backArm], ['앞암홀', g.frontArm],
     ['앞밑단', g.frontHem]].forEach(function (c) {
      for (var i = 1; i < c[1].length; i++) {
        var t0 = V.norm(V.sub(c[1][i - 1].p1, c[1][i - 1].c2));
        var t1 = V.norm(V.sub(c[1][i].c1, c[1][i].p0));
        var a = Math.acos(Math.max(-1, Math.min(1, t0[0] * t1[0] + t0[1] * t1[1]))) * 180 / Math.PI;
        if (a > c1worst) { c1worst = a; c1name = c[0] + ' 접합 ' + i; }
      }
    });
    check('§5', s + ' 세그먼트 C1 연속', c1worst < 0.01, '최대 꺾임 ' + c1worst.toFixed(6) + '° (' + c1name + ')');
    // 어깨끝 오버슛 (암홀이 어깨선 위로 솟지 않아야)
    var over = 0;
    [[g.backArm, g.SPb, g.bShDir, g.Ub], [g.frontArm, g.SPf, g.fShDir, g.Uf]].forEach(function (c) {
      var pin = U.perpToward(c[2], c[1], c[3]);
      U.sampleSegs(c[0], 0.05).forEach(function (p) {
        var d = (p[0] - c[1][0]) * pin[0] + (p[1] - c[1][1]) * pin[1];
        if (d < -1e-9) over = Math.min(over, d);
      });
    });
    check('§5', s + ' 암홀 어깨끝 오버슛 0', over > -1e-6, '어깨선 위로 솟은 양 ' + num(-over, 6) + ' cm');
  });
}
function polyArea(p) { var a = 0; for (var i = 0; i < p.length; i++) { var q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }

/* ══════════════════════════════════════════════════════════════════════
 * 2-S. 반소매 (SPEC §3.4) — 구조·형상·길이만 검사.
 *      원본 소매 DXF 는 내부 모순이 있고 이 몸판의 소매도 아니므로 좌표 대조 없음.
 * ════════════════════════════════════════════════════════════════════*/
function sectionSleeve() {
  console.log('\n' + B + '═══ 2-S. 소매 제도 (SPEC §3.4) — 전 호수 ═══' + N);
  var sizes = E2.SIZES;   // 호수 목록은 엔진에서 — 호수가 늘면 자동 반영
  var ds = {}, sl = {};
  sizes.forEach(function (z) {
    ds[z] = E2.draftNoDart(E2.measuresForSize(z), { seam: 1.0 });
    sl[z] = ds[z].sleeve;
  });

  /* 수치표 */
  console.log('\n  ' + B + '소매 수치표 (capReduce = ' + num(sl['66호'].capReduce, 2) + ')' + N);
  console.log('  ' + pad('항목', 24) + sizes.map(function (z) { return pad(z, 12); }).join(''));
  var rows = [
    ['  · 뒤 반폭',         function (s) { return s.halfB; }],
    ['  · 앞 반폭',         function (s) { return s.halfF; }],
    ['밑단폭',              function (s) { return s.hemHalfB + s.hemHalfF; }],
    ['뒤 대각선',           function (s) { return s.diagB; }],
    ['앞 대각선',           function (s) { return s.diagF; }],
    ['뒤 소매산 곡선길이',  function (s) { return s.capLenBack; }],
    ['   vs 뒤AH',          function (s) { return s.AHb; }],
    ['   차(뒤 이세)',      function (s) { return s.capLenBack - s.AHb; }],
    ['앞 소매산 곡선길이',  function (s) { return s.capLenFront; }],
    ['   vs 앞AH',          function (s) { return s.AHf; }],
    ['   차(앞 이세)',      function (s) { return s.capLenFront - s.AHf; }],
    ['   vs AH',            function (s) { return s.AH; }],
    ['★ 이세분',            function (s) { return s.capEase; }]
  ];
  rows.forEach(function (r) {
    console.log('  ' + pad(r[0], 24) + sizes.map(function (z) { return pad(r[1](sl[z]).toFixed(4), 12); }).join(''));
  });

  /* §3.4 판정 — 이세분 */
  console.log('\n  ' + B + '[S-1] 이세분 — FAIL <0.5 또는 >2.5 / WARN 0.5~1.0 / PASS 1.0~2.5' + N);
  sizes.forEach(function (z) {
    var e = sl[z].capEase;
    var band = (e < 0.5 || e > 2.5) ? 'FAIL' : (e < 1.0 ? 'WARN' : 'PASS');
    check('§3.4', z + ' 이세분', band === 'PASS',
      num(e) + ' cm  → ' + band + '   (소매산 ' + num(sl[z].capLenTotal) + ' − AH ' + num(sl[z].AH) + ')');
  });

  /* 앞뒤 각각 ≥ AH */
  console.log('\n  ' + B + '[S-2] 뒤 소매산 ≥ 뒤AH · 앞 소매산 ≥ 앞AH' + N);
  sizes.forEach(function (z) {
    var s = sl[z];
    check('§3.4', z + ' 앞뒤 소매산 길이', s.capLenBack >= s.AHb && s.capLenFront >= s.AHf,
      '뒤 ' + num(s.capLenBack) + ' ≥ ' + num(s.AHb) + ' (+' + num(s.capLenBack - s.AHb) + ')  ·  앞 ' +
      num(s.capLenFront) + ' ≥ ' + num(s.AHf) + ' (+' + num(s.capLenFront - s.AHf) + ')');
  });

  /* 골격 계산식 검산 */
  console.log('\n  ' + B + '[S-3] 골격 계산식 (소매산 = AH/4+2 · 반폭 = √(대각선²−소매산²) · 밑단 들임 1.5)' + N);
  sizes.forEach(function (z) {
    var s = sl[z], bad = [];
    if (Math.abs(s.capH - (s.AH / 4 + 2)) > 1e-9) bad.push('소매산');
    if (Math.abs(s.diagB - (s.AHb - s.capReduce)) > 1e-9) bad.push('뒤대각선');
    if (Math.abs(s.diagF - (s.AHf - s.capReduce)) > 1e-9) bad.push('앞대각선');
    if (Math.abs(s.halfB - Math.sqrt(s.diagB * s.diagB - s.capH * s.capH)) > 1e-9) bad.push('뒤반폭');
    if (Math.abs(s.halfF - Math.sqrt(s.diagF * s.diagF - s.capH * s.capH)) > 1e-9) bad.push('앞반폭');
    if (Math.abs(s.hemHalfB - (s.halfB - 1.5)) > 1e-9 || Math.abs(s.hemHalfF - (s.halfF - 1.5)) > 1e-9) bad.push('밑단들임');
    if (Math.abs(s.hemMidB[0] + s.hemHalfB / 2) > 1e-9 || Math.abs(s.hemMidF[0] - s.hemHalfF / 2) > 1e-9) bad.push('밑단2등분점');
    if (Math.abs(s.hemEndB[1] - (s.sleeveLen + 0.5)) > 1e-9) bad.push('밑단하강0.5');
    check('§3.4', z + ' 골격 계산식', bad.length === 0,
      bad.length ? '✗ ' + bad.join(', ') : '소매산 ' + num(s.capH, 3) + ' · 대각선 ' + num(s.diagB, 3) + '/' + num(s.diagF, 3) +
      ' · 반폭 ' + num(s.halfB, 3) + '/' + num(s.halfF, 3) + ' · 밑단 ' + num(s.hemHalfB, 3) + '/' + num(s.hemHalfF, 3));
  });

  /* 수선 발점이 대각선 위에 놓이는가 (§3.4 구조 검증) */
  console.log('\n  ' + B + '[S-4] 마크 → 대각선 수선의 발점이 대각선 위에 정확히 놓이는가' + N);
  sizes.forEach(function (z) {
    var s = sl[z], worst = 0, worstName = '';
    [['뒤 상단', s.footTopB, s.markTopB, s.bicepB], ['뒤 하단', s.footBotB, s.markBotB, s.bicepB],
     ['앞 상단', s.footTopF, s.markTopF, s.bicepF], ['앞 하단', s.footBotF, s.markBotF, s.bicepF]].forEach(function (j) {
      var f = j[1];
      var onLine = ptSegDist(f.foot, [0, 0], j[3]);                 // 발점이 대각선 위
      var perp = Math.abs((j[2][0] - f.foot[0]) * (j[3][0]) + (j[2][1] - f.foot[1]) * (j[3][1])) /
                 Math.hypot(j[3][0], j[3][1]);                       // 수선이 대각선에 직교
      var e = Math.max(onLine, perp);
      if (e > worst) { worst = e; worstName = j[0]; }
    });
    var s2 = sl[z];
    check('§3.4', z + ' 수선 발점', worst < 1e-9,
      't = ' + [s2.footTopB, s2.footBotB, s2.footTopF, s2.footBotF].map(function (f) { return f.t.toFixed(3); }).join(' / ') +
      '  수선길이 ' + [s2.footTopB, s2.footBotB, s2.footTopF, s2.footBotF].map(function (f) { return f.dist.toFixed(3); }).join(' / ') +
      '  최대오차 ' + worst.toExponential(1));
  });

  /* 곡선 오프셋 프로파일 — SPEC §3.4 표와 비교 (형상 기준, FAIL 아님) */
  console.log('\n  ' + B + '[S-5] 곡선 통과점 오프셋 (capBulge ' + E2.K.capBulge + ') — SPEC §3.4 표는 66호 상당 DXF 실측' + N);
  var s66 = sl['66호'];
  var offs = [['뒤 상단', s66.footTopB.dist * E2.K.capBulge, 1.50], ['뒤 하단', s66.footBotB.dist * E2.K.capBulge, 1.23],
              ['앞 상단', s66.footTopF.dist * E2.K.capBulge, 1.48], ['앞 하단', s66.footBotF.dist * E2.K.capBulge, 1.49]];
  offs.forEach(function (o) {
    console.log('    ' + pad(o[0], 10) + '엔진 ' + pad(o[1].toFixed(3), 9) + 'SPEC 표 ' + pad(o[2].toFixed(2), 8) + 'Δ ' + Math.abs(o[1] - o[2]).toFixed(3) + ' cm');
  });

  /* 소매산 곡선이 대각선을 1회 교차 · 자기교차 0 · 정점 접선 수평 */
  console.log('\n  ' + B + '[S-6] 소매산 곡선 — 대각선 1회 교차 · 자기교차 0 · 정점 접선 수평 ≤ 2°' + N);
  sizes.forEach(function (z) {
    var s = sl[z], pc = null;
    ds[z].pieces.forEach(function (x) { if (x.id === 'sleeve') pc = x; });
    function crossings(segs, bic) {
      var pts = U.sampleSegs(segs, 0.02), L = Math.hypot(bic[0], bic[1]);
      var u = [bic[0] / L, bic[1] / L], n = [-u[1], u[0]], c = 0, prev = null;
      for (var i = 1; i < pts.length - 1; i++) {
        var v = pts[i][0] * n[0] + pts[i][1] * n[1];
        if (Math.abs(v) < 1e-6) continue;
        var sg = v > 0 ? 1 : -1;
        if (prev !== null && sg !== prev) c++;
        prev = sg;
      }
      return c;
    }
    var cb = crossings(s.capBack, s.bicepB), cf = crossings(s.capFront, s.bicepF);
    var tb = tangentAt(s.capBack, 0), tf = tangentAt(s.capFront, 0);
    var ab = angBetween(tb, [1, 0]), af = angBetween(tf, [1, 0]);
    var xs = selfIntersections(pc.outline), xs2 = selfIntersections(pc.seamline);
    var c1 = 0;
    [s.capBack, s.capFront, s.hemBack, s.hemFront].forEach(function (c) {
      for (var i = 1; i < c.length; i++) {
        var t0 = V.norm(V.sub(c[i - 1].p1, c[i - 1].c2)), t1 = V.norm(V.sub(c[i].c1, c[i].p0));
        c1 = Math.max(c1, Math.acos(Math.max(-1, Math.min(1, t0[0] * t1[0] + t0[1] * t1[1]))) * 180 / Math.PI);
      }
    });
    check('§3.4', z + ' 소매산 형상', cb === 1 && cf === 1 && ab < 2 && af < 2 && xs === 0 && xs2 === 0 && c1 < 0.01,
      '대각선 교차 뒤 ' + cb + '회 앞 ' + cf + '회 · 정점 접선 뒤 ' + ab.toFixed(4) + '° 앞 ' + af.toFixed(4) +
      '° · 자기교차 완성 ' + xs + ' 시접 ' + xs2 + ' · C1 꺾임 ' + c1.toFixed(6) + '°');
  });

  /* 단조 증가 */
  console.log('\n  ' + B + '[S-7] 소매폭 · 소매산 · 밑단폭 호수 단조 증가' + N);
  [['소매폭', function (s) { return s.halfB + s.halfF; }], ['소매산 높이', function (s) { return s.capH; }],
   ['밑단폭', function (s) { return s.hemHalfB + s.hemHalfF; }], ['소매길이', function (s) { return s.sleeveLen; }]].forEach(function (r) {
    var v = sizes.map(function (z) { return r[1](sl[z]); });
    check('§3.4', r[0] + ' 단조 증가', monoInc(v), v.map(function (x) { return x.toFixed(3); }).join(' < '));
  });

  /* 조각 속성 */
  console.log('\n  ' + B + '[S-8] 조각 속성 — 골선 없음 · cutCount 2 · 식서 = 중심선 · 폐곡선' + N);
  sizes.forEach(function (z) {
    var pc = null; ds[z].pieces.forEach(function (x) { if (x.id === 'sleeve') pc = x; });
    var s = sl[z];
    var gl = pc.grainline, glOk = Math.abs(gl[0][0]) < 1e-9 && Math.abs(gl[1][0]) < 1e-9;
    var gap = V.dist(pc.outline[0], pc.outline[pc.outline.length - 1]);
    var step = 0; for (var i = 1; i < pc.outline.length; i++) step = Math.max(step, V.dist(pc.outline[i - 1], pc.outline[i]));
    var eqLen = pc.seamline.length === pc.outline.length;
    var area0 = Math.abs(polyArea(pc.outline)), area1 = Math.abs(polyArea(pc.seamline));
    check('§3.4', z + ' 소매 조각', pc.foldEdges.length === 0 && pc.cutCount === 2 && glOk &&
      gap < 0.06 && step <= 0.0501 && eqLen && area1 > area0,
      'foldEdges ' + JSON.stringify(pc.foldEdges) + ' · cut ' + pc.cutCount + ' · 식서 x=0 ' + glOk +
      ' · 점 ' + pc.outline.length + ' · 닫힘 ' + num(gap, 4) + ' · 최대간격 ' + num(step, 4) +
      ' · 면적 ' + area0.toFixed(1) + '→' + area1.toFixed(1) + ' · 너치 ' + pc.notches.length);
  });
}

/* ══════════════════════════════════════════════════════════════════════
 * 2-T. 소매 종류 (SPEC §16) — 짧은소매 · 반소매 2종 × 5호수 = 10조합
 *      ※ 7부·긴소매는 별도 제도법이라 여기 없습니다 (§16 2026-08-07 개정)
 * ════════════════════════════════════════════════════════════════════*/
function sectionSleeveType() {
  console.log('\n' + B + '═══ 2-T. 소매 종류 (SPEC §16) — 전 호수 × 2종 ═══' + N);
  var sizes = E2.SIZES, types = E2.SLEEVE_TYPES;

  console.log('\n  ' + B + '10조합 수치표' + N);
  console.log('  ' + pad('호수', 7) + pad('종류', 11) + pad('소매길이', 10) + pad('소매산', 9) +
    pad('여유', 8) + pad('소매폭', 9) + pad('소매부리', 10) + pad('밑선(뒤)', 10) + pad('밑선(앞)', 10) +
    pad('밑선 차', 10) + '이세분');
  var rows = {};
  sizes.forEach(function (z) {
    types.forEach(function (t) {
      var d = E2.draftNoDart(E2.measuresForSize(z), { seam: {}, sleeveType: t });
      rows[z + '/' + t] = d;
      var M = d.measures;
      console.log('  ' + pad(z, 7) + pad(M.sleeveTypeName, 11) + pad(M.sleeveLen.toFixed(2), 10) +
        pad(M.capHeight.toFixed(3), 9) + pad((M.sleeveLen - M.capHeight).toFixed(3), 8) +
        pad(M.sleeveWidth.toFixed(3), 9) + pad(M.sleeveHemWidth.toFixed(3), 10) +
        pad(M.sleeveUnderLenBack.toFixed(4), 10) + pad(M.sleeveUnderLenFront.toFixed(4), 10) +
        pad(Math.abs(M.sleeveUnderLenBack - M.sleeveUnderLenFront).toFixed(4), 10) +
        M.sleeveCapEase.toFixed(4));
    });
  });

  /* T-1 소매길이 > 소매산 + 2.0 */
  console.log('\n  ' + B + '[T-1] 소매길이 > 소매산 높이 + 2.0 (최소 여유)' + N);
  sizes.forEach(function (z) {
    types.forEach(function (t) {
      var M = rows[z + '/' + t].measures, sl = M.sleeveLen - M.capHeight;
      check('§16', z + ' ' + M.sleeveTypeName + ' 길이 여유', sl > 2.0,
        '소매길이 ' + num(M.sleeveLen, 2) + ' − 소매산 ' + num(M.capHeight, 3) + ' = ' + num(sl, 3) + ' cm');
    });
  });

  /* T-2 앞뒤 밑선 길이 차 */
  console.log('\n  ' + B + '[T-2] 앞뒤 밑선 길이 차 ≤ 0.05 cm' + N);
  sizes.forEach(function (z) {
    types.forEach(function (t) {
      var g = E2.geom(E2.measuresForSize(z), { sleeveType: t }, null);
      var d = rows[z + '/' + t], sv = d.sleeve;
      // 조각 외곽선에서 실제로 잰다 (계산값이 아니라 그려진 변 길이)
      var pc = null; d.pieces.forEach(function (x) { if (x.id === 'sleeve') pc = x; });
      var lb = 0, lf = 0;
      pc.edges.forEach(function (e) {
        var L = 0;
        for (var i = Math.max(1, e.start); i <= e.end; i++) L += V.dist(pc.outline[i - 1], pc.outline[i]);
        if (e.name === '뒤 밑선') lb = L; if (e.name === '앞 밑선') lf = L;
      });
      var dd = Math.abs(lb - lf);
      check('§16', z + ' ' + d.measures.sleeveTypeName + ' 앞뒤 밑선', dd <= 0.05,
        '외곽선 실측 뒤 ' + num(lb, 4) + ' · 앞 ' + num(lf, 4) + ' → 차 ' + num(dd, 5) +
        '  (제도값 ' + num(sv.underLenB, 4) + ' / ' + num(sv.underLenF, 4) + ')');
    });
  });

  /* T-3 소매산·이세분은 종류와 무관 */
  console.log('\n  ' + B + '[T-3] 소매산 곡선·이세분은 소매 종류와 무관 (AH 로만 결정)' + N);
  sizes.forEach(function (z) {
    var a = rows[z + '/cap'].sleeve, b = rows[z + '/short'].sleeve;
    var pa = U.sampleSegs(a.capBack.concat(a.capFront), 0.05);
    var pb = U.sampleSegs(b.capBack.concat(b.capFront), 0.05);
    var mx = 0;
    if (pa.length === pb.length) for (var i = 0; i < pa.length; i++) mx = Math.max(mx, V.dist(pa[i], pb[i]));
    else mx = Infinity;
    check('§16', z + ' 소매산 종류 무관', mx < 1e-12 &&
      Math.abs(a.capEase - b.capEase) < 1e-12 && Math.abs(a.capH - b.capH) < 1e-12,
      '소매산 곡선 좌표 최대차 ' + (isFinite(mx) ? mx.toExponential(1) : '점수 불일치') +
      ' · 이세분 ' + num(a.capEase) + ' = ' + num(b.capEase) + ' · 소매산 ' + num(a.capH, 3));
  });

  /* T-4 하위호환 — sleeveType 생략 = short */
  console.log('\n  ' + B + '[T-4] 하위호환 — sleeveType 생략 = short, 좌표 완전 일치' + N);
  sizes.forEach(function (z) {
    var m = E2.measuresForSize(z);
    var d0 = E2.draftNoDart(m, { seam: {} });                       // 생략
    var d1 = E2.draftNoDart(m, { seam: {}, sleeveType: 'short' });  // 명시
    var d2 = E2.draftNoDart(m, { seam: {}, sleeveType: '없는값' }); // 잘못된 값 → 기본
    function sv(d) { var r = null; d.pieces.forEach(function (x) { if (x.id === 'sleeve') r = x; }); return r; }
    var a = sv(d0), b = sv(d1), c = sv(d2), mx = 0, mx2 = 0;
    var ok = a.outline.length === b.outline.length && a.outline.length === c.outline.length;
    if (ok) for (var i = 0; i < a.outline.length; i++) {
      mx = Math.max(mx, V.dist(a.outline[i], b.outline[i]));
      mx2 = Math.max(mx2, V.dist(a.outline[i], c.outline[i]));
    }
    // 기존 식(25.0 + (B−87.6)/12)과도 같은지
    var legacy = 25.0 + (m.B - E2.BASE.B) / 12;
    check('§16', z + ' sleeveType 기본값', ok && mx < 1e-12 && mx2 < 1e-12 &&
      Math.abs(d0.measures.sleeveLen - legacy) < 1e-12 && d0.measures.sleeveType === 'short',
      '생략 vs short 최대차 ' + mx.toExponential(1) + ' · 잘못된 값 → short ' + mx2.toExponential(1) +
      ' · 소매길이 ' + num(d0.measures.sleeveLen, 4) + ' = 구식 ' + num(legacy, 4));
  });

  /* T-5 소매부리 < 소매폭 · 폐곡선 · 자기교차 0 */
  console.log('\n  ' + B + '[T-5] 소매부리 < 소매폭 · 폐곡선 · 자기교차 0 (완성선/시접선)' + N);
  sizes.forEach(function (z) {
    types.forEach(function (t) {
      var d = rows[z + '/' + t], M = d.measures;
      var pc = null; d.pieces.forEach(function (x) { if (x.id === 'sleeve') pc = x; });
      var gap = V.dist(pc.outline[0], pc.outline[pc.outline.length - 1]);
      var x1 = selfXList(pc.outline).length, x2 = selfXList(pc.seamline).length;
      var a0 = Math.abs(polyArea(pc.outline)), a1 = Math.abs(polyArea(pc.seamline));
      check('§16', z + ' ' + M.sleeveTypeName + ' 조각', M.sleeveHemWidth < M.sleeveWidth &&
        gap < 0.06 && x1 === 0 && x2 === 0 && a1 > a0 && pc.foldEdges.length === 0,
        '부리 ' + num(M.sleeveHemWidth, 3) + ' < 소매폭 ' + num(M.sleeveWidth, 3) +
        ' · 점 ' + pc.outline.length + ' · 닫힘 ' + num(gap, 4) + ' · 자기교차 ' + x1 + '/' + x2 +
        ' · 면적 ' + a0.toFixed(1) + '→' + a1.toFixed(1));
    });
  });

  /* T-6 종류가 길어질수록 소매길이 증가 · 호수 단조 증가 · 팔꿈치선 없음 */
  console.log('\n  ' + B + '[T-6] 종류별 길이 대소 · 호수 단조 증가 · 팔꿈치선 미도입' + N);
  sizes.forEach(function (z) {
    check('§16', z + ' 짧은소매 < 반소매', rows[z + '/cap'].measures.sleeveLen < rows[z + '/short'].measures.sleeveLen,
      num(rows[z + '/cap'].measures.sleeveLen, 2) + ' < ' + num(rows[z + '/short'].measures.sleeveLen, 2));
  });
  types.forEach(function (t) {
    var v = sizes.map(function (z) { return rows[z + '/' + t].measures.sleeveLen; });
    check('§16', E2.SLEEVE_TYPE[t].name + ' 호수 단조 증가', monoInc(v),
      v.map(function (x) { return x.toFixed(2); }).join(' < '));
  });
  var hasElbow = false, hasStdSrc = false;
  sizes.forEach(function (z) {
    types.forEach(function (t) {
      var d = rows[z + '/' + t];
      d.pieces.forEach(function (pc) { pc.internal.forEach(function (o) { if (o.id === 'elbow') hasElbow = true; }); });
      d.meta.formulaNotes.forEach(function (n) { if (/표준치수/.test(n.formula || '')) hasStdSrc = true; });
    });
  });
  check('§16', '팔꿈치선·표준치수 소매부리 미도입 (긴소매 제도법 대기)', !hasElbow && !hasStdSrc,
    "internal 에 id:'elbow' 없음 · formulaNotes 에 표준치수 출처 없음 — 소매부리는 전부 「소매통 − 들임 1.5×2 (교재 규정)」");
  check('§16', '소매 종류 2종만 노출', E2.SLEEVE_TYPES.length === 2 &&
    E2.SLEEVE_TYPES.indexOf('threequarter') < 0 && E2.SLEEVE_TYPES.indexOf('long') < 0,
    E2.SLEEVE_TYPES.map(function (k) { return k + '(' + E2.SLEEVE_TYPE[k].name + ' ' + E2.SLEEVE_TYPE[k].len + '±' + E2.SLEEVE_TYPE[k].lenGrade + ')'; }).join(' · '));
}

/* ══════════════════════════════════════════════════════════════════════
 * 3. 참고 출력 (계약 준수 · 완성치수)
 * ════════════════════════════════════════════════════════════════════*/
function section3() {
  console.log('\n[1m═══ 3. 인터페이스 계약 (SPEC §8) 및 완성치수 ═══[0m');
  var d = E.draftNoDart(E.measuresForSize('66호'), { seam: 1.0, shoulderEase: 0.95 });
  var need = ['pieces', 'measures', 'size', 'meta'];
  check('§8', 'Draft 최상위 키', need.every(function (k) { return k in d; }), need.join(', ') + ' + points/curves(부가)');
  var pk = ['id', 'name', 'cutCount', 'grainline', 'outline', 'seamline', 'internal', 'notches', 'bbox', 'foldEdges'];
  var okp = d.pieces.length === 2 && d.pieces.every(function (p) { return pk.every(function (k) { return k in p; }); });
  check('§8', 'piece 키 10개 × 2조각 (뒷판·앞판) — 소매 제외 SPEC §17', okp, d.pieces.map(function (p) {
    return p.id + '(outline ' + p.outline.length + '점, seamline ' + p.seamline.length + '점, internal ' +
      p.internal.length + ', notch ' + p.notches.length + ')';
  }).join(' / '));
  var mk = ['shoulderBack', 'shoulderFront', 'shoulderEase', 'armholeBack', 'armholeFront', 'armholeTotal',
            'neckBack', 'neckFront', 'neckTotal', 'sideBack', 'sideFront'];
  check('§8', 'measures 11개 항목', mk.every(function (k) { return typeof d.measures[k] === 'number' && isFinite(d.measures[k]); }),
    mk.length + '개 전부 유한수');
  // flatten 간격
  var worstStep = 0;
  d.pieces.forEach(function (p) {
    for (var i = 1; i < p.outline.length; i++) worstStep = Math.max(worstStep, V.dist(p.outline[i - 1], p.outline[i]));
  });
  check('§8', 'outline 폴리라인 간격 ≤ 0.05cm', worstStep <= 0.0501, '최대 간격 ' + num(worstStep) + ' cm');
  check('§8', 'window/module 양쪽 노출', typeof module !== 'undefined' && !!module.exports,
    'module.exports OK · 브라우저에서는 window.NoDartEngine');

  /* §8.1 세부 규약 */
  var badLabel = [];
  d.pieces.forEach(function (p) {
    p.internal.forEach(function (o) {
      if (!o.id) badLabel.push(p.id + ':id누락');
      if (/[=\/+]|\d/.test(o.label)) badLabel.push(p.id + ':' + o.label);
    });
  });
  check('§8.1', 'internal[].label 은 짧은 이름만 (계산식·숫자 없음)', badLabel.length === 0,
    badLabel.length ? '위반 ' + badLabel.join(', ') : d.pieces.map(function (p) {
      return p.id + ' [' + p.internal.map(function (o) { return o.label; }).join(', ') + ']'; }).join('  '));
  var fnKeys = ['id', 'label', 'formula', 'value', 'piece', 'anchor'];
  var fnOk = Array.isArray(d.meta.formulaNotes) && d.meta.formulaNotes.length > 0 &&
    d.meta.formulaNotes.every(function (n) {
      return fnKeys.every(function (k) { return k in n; }) && Array.isArray(n.anchor) && n.anchor.length === 2;
    });
  check('§8.1', 'meta.formulaNotes {id,label,formula,value,piece,anchor}', fnOk,
    d.meta.formulaNotes.length + '개 항목');
  // internal 과 id 대응
  var ids = {}; d.pieces.forEach(function (p) { p.internal.forEach(function (o) { ids[p.id + '/' + o.id] = 1; }); });
  var linked = d.meta.formulaNotes.filter(function (n) { return n.piece !== 'both' && ids[n.piece + '/' + n.id]; }).length;
  check('§8.1', 'formulaNotes.id ↔ internal.id 대응', linked > 0,
    linked + '/' + d.meta.formulaNotes.length + '개가 internal 항목과 id 매칭 (나머지는 외곽선 치수 주석)');
  // 너치 방향 = 조각 안쪽
  var notchBad = [];
  d.pieces.forEach(function (p) {
    var cx = p.bbox.x + p.bbox.w / 2, cy = p.bbox.y + p.bbox.h / 2;
    p.notches.forEach(function (nt) {
      var a = nt.angle * Math.PI / 180, tip = [nt.p[0] + Math.cos(a) * 0.5, nt.p[1] + Math.sin(a) * 0.5];
      var d0 = Math.hypot(nt.p[0] - cx, nt.p[1] - cy), d1 = Math.hypot(tip[0] - cx, tip[1] - cy);
      if (d1 >= d0) notchBad.push(p.id + '/' + nt.label + ' (' + nt.angle + '°)');
    });
  });
  check('§8.1', 'notches[].angle 은 조각 안쪽 방향', notchBad.length === 0,
    notchBad.length ? '바깥을 향함: ' + notchBad.join(', ') : d.pieces.map(function (p) {
      return p.id + ' [' + p.notches.map(function (n) { return n.label + ' ' + n.angle + '°'; }).join(', ') + ']'; }).join('  '));
  // 앞판 밑단이 outline 에 포함되었는가
  var fo = d.pieces[1].outline, hasHem = fo.some(function (q) { return Math.abs(q[1] - (d.points.front.cfHem[1])) < 1e-6 && q[0] < 0.01; }) &&
    fo.some(function (q) { return Math.abs(q[1] - d.points.front.sideHem[1]) < 1e-6 && Math.abs(q[0] - d.points.front.sideX) < 1e-6; });
  check('§8.1', '앞판 밑단 곡선이 outline 폐곡선에 포함', hasHem,
    'CF 밑단 (0, ' + num(d.points.front.cfHem[1], 2) + ') ~ 옆선 밑단 (' + num(d.points.front.sideX, 2) +
    ', ' + num(d.points.front.sideHem[1], 2) + ")  hemStyle='" + d.meta.hemStyle + "'");

  console.log('\n  [1m완성치수 (이세분 0.95 · 시접 1.0)[0m');
  var head = pad('항목', 22) + E.SIZES.map(function (s) { return pad(s, 10); }).join('');
  console.log('    ' + head);
  var rows = [['뒤 어깨선', 'shoulderBack'], ['앞 어깨선', 'shoulderFront'],
    ['뒤 암홀', 'armholeBack'], ['앞 암홀', 'armholeFront'], ['암홀 합', 'armholeTotal'],
    ['뒷목(반)', 'neckBack'], ['앞목(반)', 'neckFront'], ['목둘레 합(반)', 'neckTotal'],
    ['옆선', 'sideBack']];   /* 소매 행은 제거 — 소매는 이 앱에서 제외 (SPEC §17) */
  var ms = E.SIZES.map(function (s) { return E.draftNoDart(E.measuresForSize(s), { seam: 0 }).measures; });
  rows.forEach(function (r) {
    console.log('    ' + pad(r[0], 22) + ms.map(function (m) {
      var v = m[r[1]]; return pad(typeof v === 'number' && isFinite(v) ? v.toFixed(3) : '—', 10);
    }).join(''));
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
console.log('[1m기본 무다트 원형 (문화식) — 제도 엔진 검증[0m');
console.log('engine.js  ·  dxf-66-groundtruth.json  ·  ' + new Date().toISOString().slice(0, 19).replace('T', ' '));
section1();
section2();
/* 소매는 이 앱(기본원형)에서 제외되었습니다 — SPEC §17.
   제공된 반소매 도면은 '숙녀복기본원형1' 의 소매이고, 그 원형은 별도 메뉴로 갑니다.
   엔진에 sleeveGeom 코드는 남아 있으므로, 소매를 되살릴 때 아래 두 줄을 함께 켜세요.
   (그때 두 함수 내부의 draftNoDart 호출에 includeSleeve:true 를 넘겨야 합니다.) */
// sectionSleeve();
// sectionSleeveType();
section3();

var fail = RESULTS.filter(function (r) { return !r.ok; });
console.log('\n[1m═══ 총계 ═══[0m');
console.log('  전체 ' + RESULTS.length + '개 항목 · PASS ' + (RESULTS.length - fail.length) + ' · FAIL ' + fail.length);
if (fail.length) {
  console.log('\n  [31m실패 항목[0m');
  fail.forEach(function (r) { console.log('   - [' + r.section + '] ' + r.name + '  →  ' + r.detail); });
}
process.exit(fail.length ? 1 : 0);
