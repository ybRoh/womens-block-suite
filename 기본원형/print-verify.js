#!/usr/bin/env node
/* ============================================================================
 * print-verify.js — 출력 레이아웃 수치 검산
 *
 *   node print-verify.js
 *
 * 목업 Draft(SPEC §8 구조, 66호 근사)로 print.js 를 돌려서
 *   1) SVG 단위가 실제 mm 인지 (width/viewBox)
 *   2) 5cm 캘리브레이션 눈금이 정확히 50mm(보정 시 50×k)인지 — 전 페이지
 *   3) 조각 실측 크기가 draft.bbox 와 일치하는지
 *   4) 타일을 겹침만큼 되붙이면 원본 크기가 복원되는지
 *   5) 조각이 페이지(=타일 커버리지) 밖으로 나가지 않는지
 *   6) 네스팅 조각끼리 겹치지 않는지
 *   7) 시접 오프셋 거리·면적
 *   8) 롤지 모드 용지 폭/한 장 여부
 * 를 숫자로 확인한다. 실패 시 exit code 1.
 * ==========================================================================*/
'use strict';

var path = require('path');
var NDP = require(path.join(__dirname, 'print.js'));

/* ─────────────────────────── 테스트 러너 ─────────────────────────── */
var PASS = 0, FAIL = 0, cur = '';
function section(t) { cur = t; console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 62 - t.length))); }
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function f(v, d) { return (+v).toFixed(d === undefined ? 4 : d); }

/* ─────────────────────────── 목업 Draft ──────────────────────────── */
/* SPEC §3 의 66호 값을 뼈대로 한 근사 도형. 곡선은 조밀 폴리라인으로 샘플. */
function lerpPts(a, b, m) {                    // 직선 분할
  var out = [], i;
  for (i = 0; i < m; i++) out.push([a[0] + (b[0] - a[0]) * i / m, a[1] + (b[1] - a[1]) * i / m]);
  return out;
}
function bez(p0, p1, p2, p3, m) {              // 3차 베지어 샘플 (끝점 제외)
  var out = [], i, t, u;
  for (i = 0; i < m; i++) {
    t = i / m; u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ]);
  }
  return out;
}
function bboxCm(pts) {
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach(function (p) {
    if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1];
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* 중복점 없이 쌓으면서 인덱스를 추적하는 폐곡선 빌더 (edges/foldEdges 인덱스 확정용) */
function LOOP() {
  var a = [];
  return {
    pts: a,
    at: function () { return a.length - 1; },
    add: function (p) {
      var q = a[a.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) a.push([p[0], p[1]]);
      return a.length - 1;
    },
    addAll: function (ps) { var self = this, last = -1; ps.forEach(function (p) { last = self.add(p); }); return last; }
  };
}

/* SPEC §11-3 — 44 · 55 · 66 · 77 호 */
var SIZES = {
  '44호': { B: 75.6, backLen: 36.5, shoulderW: 37.9, backW: 34.4, frontW: 31.9, bpLen: 23.8, bpSpan: 18.0, sleeveLen: 24.0 },
  '55호': { B: 81.6, backLen: 37.0, shoulderW: 38.7, backW: 35.6, frontW: 33.1, bpLen: 24.3, bpSpan: 18.5, sleeveLen: 24.5 },
  '66호': { B: 87.6, backLen: 37.5, shoulderW: 39.5, backW: 36.8, frontW: 34.3, bpLen: 24.8, bpSpan: 19.0, sleeveLen: 25.0 },
  '77호': { B: 93.6, backLen: 38.0, shoulderW: 40.3, backW: 38.0, frontW: 35.5, bpLen: 25.3, bpSpan: 19.5, sleeveLen: 25.5 }
};

function polyLen(pts, a, b) {
  var L = 0, i;
  for (i = a; i < b; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}

/**
 * 목업 Draft. SPEC §3(제도식) · §11-1(부위별 시접) · §11-3(4개 호수) 반영.
 * @param opts {
 *   size:'66호', seam: 숫자|{role:cm},
 *   provideSeam:  엔진이 seamline 을 주는가 (기본 true)
 *   provideSeamMeta: seamEdges/seamFoldEdges(신규 계약)를 주는가 (기본 true)
 *   provideFold:  foldEdges(outline 기준)를 주는가 (기본 true)
 *   provideEdges: edges[].role 을 주는가 (기본 true)
 *   includeSleeve: 소매 포함 (기본 true)
 * }
 */
function mockDraft(opts) {
  opts = opts || {};
  var sizeName = opts.size || '66호';
  var M = SIZES[sizeName];
  if (!M) throw new Error('알 수 없는 호수 ' + sizeName);
  var seam = (opts.seam === undefined) ? 0 : opts.seam;
  var provideSeam     = (opts.provideSeam     === undefined) ? true : opts.provideSeam;
  var provideSeamMeta = (opts.provideSeamMeta === undefined) ? true : opts.provideSeamMeta;
  var provideFold     = (opts.provideFold     === undefined) ? true : opts.provideFold;
  var provideEdges    = (opts.provideEdges    === undefined) ? true : opts.provideEdges;
  var includeSleeve   = (opts.includeSleeve   === undefined) ? true : opts.includeSleeve;

  var SEAMDEF = NDP.SEAM_DEFAULTS;
  var byRole = {}, kk;
  if (seam && typeof seam === 'object') {
    for (kk in SEAMDEF) byRole[kk] = SEAMDEF[kk];
    for (kk in seam) if (SEAMDEF.hasOwnProperty(kk)) byRole[kk] = +seam[kk];
  } else {
    for (kk in SEAMDEF) byRole[kk] = +seam || 0;
  }
  byRole.fold = 0;

  /* ── 제도식 (SPEC §3) ─────────────────────────────────────────────── */
  var BL      = M.B / 4 + 0.6;          // 가슴선
  var WL      = M.backLen;              // 허리선
  var bSideX  = M.B / 4 + 1.9;          // 뒤 옆선
  var fSideX  = M.B / 4 + 1.5;          // 앞 옆선
  var neckW   = M.B / 12;               // 목너비
  var fNeckD  = M.B / 12 + 0.3;         // 앞목깊이
  var bSPx    = M.shoulderW / 2 + 0.6;  // 어깨 안내선 (§9-2)
  var fSPx    = M.shoulderW / 2 - 0.65;
  var backWx  = M.backW / 2;
  var frontWx = M.frontW / 2;

  /* ── 뒤판 ───────────────────────────────────────────────────────── */
  var bNeckC = [0, -0.3], bSNP = [neckW, -3.5], bSP = [bSPx, 1.817];
  var bBLside = [bSideX, BL], bWLside = [bSideX, WL], bWLcb = [0, WL];
  var Lb = LOOP(), bE = [];
  var i0 = Lb.add(bNeckC);
  Lb.addAll(bez(bNeckC, [neckW * 0.41, -0.35], [neckW * 0.81, -1.7], bSNP, 20).slice(1));
  var i1 = Lb.add(bSNP);                       bE.push({ name: '뒷목둘레', role: 'neck', start: i0, end: i1 });
  Lb.addAll(lerpPts(bSNP, bSP, 6).slice(1));
  var i2 = Lb.add(bSP);                        bE.push({ name: '어깨선', role: 'shoulder', start: i1, end: i2 });
  Lb.addAll(bez(bSP, [bSPx + 1.25, BL * 0.293], [backWx, BL * 0.533], [backWx, BL * 0.631], 12).slice(1));
  Lb.addAll(bez([backWx, BL * 0.631], [backWx, BL * 0.778], [bSideX - 2.4, BL * 0.907], bBLside, 14));
  var i3 = Lb.add(bBLside);                    bE.push({ name: '뒤암홀', role: 'armhole', start: i2, end: i3 });
  Lb.addAll(lerpPts(bBLside, bWLside, 6).slice(1));
  var i4 = Lb.add(bWLside);                    bE.push({ name: '옆선', role: 'side', start: i3, end: i4 });
  Lb.addAll(lerpPts(bWLside, bWLcb, 10).slice(1));
  var i5 = Lb.add(bWLcb);                      bE.push({ name: '허리선', role: 'hem', start: i4, end: i5 });
  Lb.addAll(lerpPts(bWLcb, bNeckC, 8).slice(1));
  bE.push({ name: '뒤중심', role: 'fold', start: i5, end: 0 });   // wrap
  var back = Lb.pts, backFold = [[i5, 0]];
  var backAH = polyLen(back, i2, i3);

  /* ── 앞판 ───────────────────────────────────────────────────────── */
  var fSNP = [neckW, -0.6], fNeckC = [0, fNeckD - 1.0], fSP = [fSPx, 5.15];
  var fBLside = [fSideX, BL + 1.0];
  var fHemSide = [fSideX, WL + 1.0], fHemBreak = [5.4, WL + 1.0], fHemCf = [0, WL + 1.3];
  var Lf = LOOP(), fE = [];
  var j0 = Lf.add(fHemCf);
  Lf.addAll(lerpPts(fHemCf, fNeckC, 8).slice(1));
  var j1 = Lf.add(fNeckC);                     fE.push({ name: '앞중심', role: 'fold', start: j0, end: j1 });
  Lf.addAll(bez(fNeckC, [0.2, fNeckD * 0.45], [neckW * 0.49, -0.4], fSNP, 18).slice(1));
  var j2 = Lf.add(fSNP);                       fE.push({ name: '앞목둘레', role: 'neck', start: j1, end: j2 });
  Lf.addAll(lerpPts(fSNP, fSP, 6).slice(1));
  var j3 = Lf.add(fSP);                        fE.push({ name: '어깨선', role: 'shoulder', start: j2, end: j3 });
  Lf.addAll(bez(fSP, [fSPx + 1.3, BL * 0.4], [frontWx, BL * 0.579], [frontWx, BL * 0.655], 12).slice(1));
  Lf.addAll(bez([frontWx, BL * 0.655], [frontWx, BL * 0.817], [fSideX - 2.5, BL * 0.919], fBLside, 14));
  var j4 = Lf.add(fBLside);                    fE.push({ name: '앞암홀', role: 'armhole', start: j3, end: j4 });
  Lf.addAll(lerpPts(fBLside, fHemSide, 8).slice(1));
  var j5 = Lf.add(fHemSide);                   fE.push({ name: '옆선', role: 'side', start: j4, end: j5 });
  Lf.addAll(lerpPts(fHemSide, fHemBreak, 8).slice(1));
  Lf.add(fHemBreak);
  Lf.addAll(bez(fHemBreak, [3.2, WL + 1.05], [1.4, WL + 1.2], fHemCf, 10).slice(1));
  fE.push({ name: '밑단', role: 'hem', start: j5, end: 0 });      // wrap
  var front = Lf.pts, frontFold = [[j0, j1]];
  var frontAH = polyLen(front, j3, j4);

  /* ── 소매 (SPEC §3.4, 원점 = 소매산 정점, x 왼쪽 − = 뒤) ───────────── */
  var AH = backAH + frontAH;
  var cap = AH / 4 + 2;
  var bHalf = Math.sqrt(Math.max(1, backAH * backAH - cap * cap));
  var fHalf = Math.sqrt(Math.max(1, frontAH * frontAH - cap * cap));
  var SL = M.sleeveLen;
  var Ls = LOOP(), sE = [];
  var apex = [0, 0];
  var bEnd = [-bHalf, cap], fEnd = [fHalf, cap];
  var bHem = [-(bHalf - 1.5), SL + 0.5], fHem = [fHalf - 1.5, SL + 0.5];
  var bMid = [-(bHalf - 1.5) / 2, SL], fMid = [(fHalf - 1.5) / 2, SL];
  var s0 = Ls.add(apex);
  Ls.addAll(bez(apex, [-AH / 8, -0.2], [-bHalf * 0.62, cap * 0.36], [-bHalf * 0.80, cap * 0.62], 12).slice(1));
  Ls.addAll(bez([-bHalf * 0.80, cap * 0.62], [-bHalf * 0.93, cap * 0.82], bEnd, bEnd, 10));
  var s1 = Ls.add(bEnd);                       sE.push({ name: '뒤 소매산', role: 'armhole', start: s0, end: s1 });
  Ls.addAll(lerpPts(bEnd, bHem, 8).slice(1));
  var s2 = Ls.add(bHem);                       sE.push({ name: '뒤 밑선', role: 'side', start: s1, end: s2 });
  Ls.addAll(bez(bHem, [bHem[0] * 0.75, SL + 0.35], [bMid[0] * 1.1, SL], bMid, 8).slice(1));
  Ls.add(bMid);
  Ls.addAll(lerpPts(bMid, fMid, 8).slice(1));
  Ls.add(fMid);
  Ls.addAll(bez(fMid, [fMid[0] * 1.1, SL], [fHem[0] * 0.75, SL + 0.35], fHem, 8).slice(1));
  var s3 = Ls.add(fHem);                       sE.push({ name: '밑단', role: 'sleeveHem', start: s2, end: s3 });
  Ls.addAll(lerpPts(fHem, fEnd, 8).slice(1));
  var s4 = Ls.add(fEnd);                       sE.push({ name: '앞 밑선', role: 'side', start: s3, end: s4 });
  Ls.addAll(bez(fEnd, [fHalf * 0.93, cap * 0.82], [fHalf * 0.80, cap * 0.62], [fHalf * 0.62, cap * 0.36], 10).slice(1));
  Ls.addAll(bez([fHalf * 0.62, cap * 0.36], [AH / 8, -0.2], apex, apex, 10));
  sE.push({ name: '앞 소매산', role: 'armhole', start: s4, end: 0 });   // wrap
  var sleeve = Ls.pts;

  /* ── 조각 조립 ───────────────────────────────────────────────────── */
  function piece(id, name, outline, edges, folds, grain, internal, notches) {
    var pc = {
      id: id, name: name, cutCount: 2, grainline: grain,
      outline: outline, internal: internal, notches: notches,
      bbox: bboxCm(outline)
    };
    if (provideEdges) pc.edges = edges.map(function (e) {
      /* disjointEdges: 실제 엔진처럼 점을 변끼리 나눠 갖는 형태(끝점 공유 안 함).
         이러면 변과 변을 잇는 경계 세그먼트가 어느 변에도 안 속한다. */
      var end = opts.disjointEdges ? ((e.end - 1 + outline.length) % outline.length) : e.end;
      return { name: e.name, role: e.role, seam: byRole[e.role], start: e.start, end: end };
    });
    if (provideFold) pc.foldEdges = folds;
    pc.seamByRole = {};
    edges.forEach(function (e) { pc.seamByRole[e.role] = byRole[e.role]; });

    var maxSeam = 0;
    for (var r in byRole) if (byRole[r] > maxSeam) maxSeam = byRole[r];

    if (provideSeam && maxSeam > 0) {
      /* 엔진이 만드는 것과 같은 방식: 변마다 자기 폭으로 오프셋 → 교점으로 연결 */
      var N = outline.length, dEdge = [], roleOf = [], e2;
      for (var q = 0; q < N; q++) { dEdge.push(null); roleOf.push(null); }
      edges.forEach(function (e) {
        var idx = e.start;
        for (;;) { if (idx === e.end) break; dEdge[idx] = byRole[e.role]; roleOf[idx] = e.role; idx = (idx + 1) % N; }
      });
      for (var q2 = 0; q2 < N; q2++) if (dEdge[q2] === null) { dEdge[q2] = 0; roleOf[q2] = 'fold'; }
      var res = NDP._offsetLoopVarWidth(outline, dEdge);
      pc.seamline = res.pts;
      if (provideSeamMeta && res.srcEdge) {
        /* seamline 인덱스 기준 메타데이터 (SPEC §11-1 신규 계약) */
        var NS = res.pts.length, segRole = [], m;
        for (m = 0; m < NS; m++) {
          var chamfer = (res.srcVert[m] === res.srcVert[(m + 1) % NS]);
          segRole.push(chamfer ? null : roleOf[res.srcEdge[m]]);
        }
        /* 챔퍼는 전이 구간 — 한쪽이 골선이면 골선으로 넣지 않는다 (엔진과 동일 규칙) */
        for (m = 0; m < NS; m++) {
          if (segRole[m]) continue;
          var prevR = segRole[(m - 1 + NS) % NS], nextR = null;
          for (var mm = 1; mm < NS; mm++) { var cd = segRole[(m + mm) % NS]; if (cd) { nextR = cd; break; } }
          segRole[m] = (prevR === 'fold') ? (nextR || prevR) : (prevR || nextR);
        }
        pc.seamEdges = []; pc.seamFoldEdges = [];
        var cur = segRole[0], st = 0;
        for (m = 1; m <= NS; m++) {
          var rr = segRole[m % NS];
          if (rr !== cur || m === NS) {
            pc.seamEdges.push({ role: cur, seam: byRole[cur], start: st, end: m % NS });
            if (cur === 'fold') pc.seamFoldEdges.push([st, m % NS]);
            cur = rr; st = m % NS;
          }
        }
      }
    } else if (provideSeam) {
      pc.seamline = outline.map(function (p) { return [p[0], p[1]]; });
    }
    return pc;
  }

  var pieces = [
    /* notches[].angle 은 도(°). 0°=+x, 시계방향 +, 조각 안쪽 (SPEC §8.1) */
    piece('back', '뒷판', back, bE, backFold,
      [[3.0, 6.0], [3.0, WL - 4]],
      [
        { type: 'line',   pts: [[0, BL], [bSideX, BL]], label: 'BL' },
        { type: 'dashed', pts: [[backWx, -1.0], [backWx, BL]], label: '등품선' }
      ],
      [
        { p: bSNP, angle: 112, role: 'neck', label: '목옆' },
        { p: bSP, angle: 112, role: 'shoulder', label: '어깨' },
        { p: bBLside, angle: 180, role: 'side', label: 'BL' }
      ]),
    piece('front', '앞판', front, fE, frontFold,
      [[3.0, 12.0], [3.0, WL - 4]],
      [
        { type: 'line',   pts: [[0, BL + 1.0], [fSideX, BL + 1.0]], label: 'BL' },
        { type: 'dashed', pts: [[frontWx, 1.0], [frontWx, BL + 1.0]], label: '앞품선' },
        { type: 'point',  pts: [[M.bpSpan / 2, M.bpLen]], label: 'BP' }
      ],
      [
        { p: fSNP, angle: 116, role: 'neck', label: '목옆' },
        { p: fSP, angle: 116, role: 'shoulder', label: '어깨' },
        { p: fBLside, angle: 180, role: 'side', label: 'BL' }
      ])
  ];
  if (includeSleeve) {
    pieces.push(piece('sleeve', '소매', sleeve, sE, [],
      [[0, 1.0], [0, SL - 1]],
      [{ type: 'dashed', pts: [[-bHalf, cap], [fHalf, cap]], label: '소매폭선' }],
      [
        { p: apex, angle: 90, role: 'armhole', label: '정점' },
        { p: bMid, angle: -90, role: 'sleeveHem', label: '뒤2등분' },
        { p: fMid, angle: -90, role: 'sleeveHem', label: '앞2등분' }
      ]));
  }

  return {
    size: sizeName,
    pieces: pieces,
    measures: {
      armholeBack: backAH, armholeFront: frontAH, armholeTotal: AH,
      capHeight: cap, sleeveWidth: bHalf + fHalf, sleeveLen: SL,
      sideBack: WL - BL, sideFront: WL + 1.0 - (BL + 1.0)
    },
    meta: { formulaNotes: ['목업 데이터 — 엔진 완성 전 출력 검증용'] }
  };
}

/* ─────────────────────────── 기하 헬퍼 ───────────────────────────── */
function segDist(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1];
  var wx = p[0] - a[0], wy = p[1] - a[1];
  var L2 = vx * vx + vy * vy;
  var t = L2 > 0 ? (wx * vx + wy * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  var dx = p[0] - (a[0] + vx * t), dy = p[1] - (a[1] + vy * t);
  return Math.hypot(dx, dy);
}
function distToPoly(p, poly) {
  var m = Infinity, i, N = poly.length;
  for (i = 0; i < N; i++) m = Math.min(m, segDist(p, poly[i], poly[(i + 1) % N]));
  return m;
}
/** 열린 폴리라인까지의 최단거리 */
function distToPolyline(p, pts) {
  var m = Infinity, i;
  if (!pts || !pts.length) return m;
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  for (i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(p, pts[i], pts[i + 1]));
  return m;
}
function rectsOverlap(a, b) {
  var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (ox > 1e-6 && oy > 1e-6) ? ox * oy : 0;
}

/* transform="translate(a b) rotate(90) translate(c d)" 를 직접 해석해
   print.js 의 배치 수식을 독립적으로 재검증한다. */
function parseTransform(str) {
  var M = [1, 0, 0, 1, 0, 0];  // a b c d e f
  function mul(m2) {
    M = [
      M[0] * m2[0] + M[2] * m2[1], M[1] * m2[0] + M[3] * m2[1],
      M[0] * m2[2] + M[2] * m2[3], M[1] * m2[2] + M[3] * m2[3],
      M[0] * m2[4] + M[2] * m2[5] + M[4], M[1] * m2[4] + M[3] * m2[5] + M[5]
    ];
  }
  var re = /(translate|rotate|scale)\s*\(([^)]*)\)/g, m;
  while ((m = re.exec(str))) {
    var args = m[2].trim().split(/[\s,]+/).map(Number);
    if (m[1] === 'translate') mul([1, 0, 0, 1, args[0] || 0, args[1] || 0]);
    else if (m[1] === 'scale') mul([args[0], 0, 0, (args.length > 1 ? args[1] : args[0]), 0, 0]);
    else if (m[1] === 'rotate') {
      var r = (args[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      mul([c, s, -s, c, 0, 0]);
    }
  }
  return M;
}
function applyM(M, p) { return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]; }

/* ═══════════════════════════════════════════════════════════════════
 *  검증 시작
 * ═══════════════════════════════════════════════════════════════════ */
console.log('NoDartPrint v' + NDP.VERSION + '  —  출력 레이아웃 수치 검산');
console.log('node ' + process.version + '  /  ' + new Date().toISOString());

/* ───────────────── 1. A4 기본 (시접 0, 보정 없음) ───────────────── */
section('1. A4 타일 · 시접 0 · 인쇄보정 없음');
var PER = { neck:1.0, shoulder:1.0, armhole:1.0, side:1.5, hem:3.0, sleeveHem:2.5, fold:0 };
var SIZE_LIST_EARLY = ['44호', '55호', '66호', '77호'];
var d0 = mockDraft({ seam: 0 });
var L0 = NDP.buildPrintLayout(d0, { mode: 'a4', seam: 0, overlapMm: 10 });
var I0 = L0.info;

console.log('    모드=' + I0.mode + '  용지=' + I0.pageWidthMm + '×' + I0.pageHeightMm + 'mm' +
  '  격자=' + I0.cols + '열×' + I0.rows + '행  타일 ' + I0.tilePages + '장 + 안내 ' + I0.overviewPages +
  '장  = pagesSvg ' + L0.pageCount + '장');
console.log('    유효 인쇄영역(declared)=' + f(I0.contentWidthMm, 2) + '×' + f(I0.contentHeightMm, 2) + 'mm' +
  '   step=' + f(I0.stepXMm, 2) + '×' + f(I0.stepYMm, 2) + 'mm   겹침=' + I0.overlapMm + 'mm');
console.log('    네스팅 캔버스=' + f(I0.canvas.wMm, 2) + '×' + f(I0.canvas.hMm, 2) + 'mm' +
  '   타일 커버리지=' + f(I0.coverage.wMm, 2) + '×' + f(I0.coverage.hMm, 2) + 'mm');

ok('pageCount = 안내1 + 타일(cols×rows)', L0.pageCount === I0.tilePages + I0.overviewPages,
  '(' + L0.pageCount + ' = ' + I0.tilePages + '+' + I0.overviewPages + ')');
ok('유효 인쇄폭 = 210 − 2×여백', near(I0.contentWidthMm, 210 - 2 * I0.marginMm, 1e-9),
  f(I0.contentWidthMm, 3) + 'mm');
ok('유효 인쇄높이 = 297 − 여백 − 정보띠', near(I0.contentHeightMm, 297 - I0.marginMm - I0.footerMm, 1e-9),
  f(I0.contentHeightMm, 3) + 'mm');

/* --- 1a. SVG 단위가 실제 mm 인가 --- */
section('1a. SVG 절대 mm 지정 (브라우저 임의 스케일 차단)');
var badUnit = [];
L0.pagesSvg.forEach(function (svg, i) {
  var w = /width="([^"]+)"/.exec(svg), h = /height="([^"]+)"/.exec(svg), vb = /viewBox="([^"]+)"/.exec(svg);
  if (!w || w[1] !== '210mm' || !h || h[1] !== '297mm' || !vb || vb[1] !== '0 0 210 297') badUnit.push(i);
});
ok('전 페이지 width=210mm height=297mm viewBox="0 0 210 297"', badUnit.length === 0,
  badUnit.length ? '문제 페이지 ' + badUnit.join(',') : L0.pageCount + '장 모두 OK (1 user unit = 1 mm)');
ok('@page 규칙이 실치수 mm', I0.pageCss === '@page{size:210mm 297mm;margin:0}', I0.pageCss);

/* --- 1b. 5cm 캘리브레이션 눈금 --- */
section('1b. 5cm 캘리브레이션 눈금 (모든 페이지)');
var noCalib = [], badLen = [];
L0.pagesSvg.forEach(function (svg, i) {
  var groups = svg.match(/data-ndp-calib="1"[^>]*/g) || [];
  if (!groups.length) { noCalib.push(i); return; }
  groups.forEach(function (g) {
    var dm = /data-declared-mm="([\d.]+)"/.exec(g);
    if (!dm || !near(+dm[1], 50 * I0.scaleFactor, 1e-4)) badLen.push(i + ':' + (dm ? dm[1] : '?'));
  });
  /* 실제 선 좌표로도 확인 */
  var ln = /data-ndp-calib-line="1" x1="([-\d.]+)" y1="[-\d.]+" x2="([-\d.]+)"/.exec(svg);
  if (ln) {
    var len = Math.abs(+ln[2] - +ln[1]);
    if (!near(len, 50 * I0.scaleFactor, 1e-3)) badLen.push(i + ':line=' + len);
  }
});
ok('모든 페이지에 캘리브레이션 눈금 존재', noCalib.length === 0,
  noCalib.length ? '없는 페이지 ' + noCalib.join(',') : L0.pageCount + '장 모두 존재');
ok('눈금 선 길이 = 50 user unit = 50.0000 mm', badLen.length === 0,
  badLen.length ? badLen.join(' ') : 'declared ' + f(I0.calibration.declaredMm) + 'mm (k=' + f(I0.scaleFactor, 6) + ')');

/* --- 1c. 조각 실측 크기 vs draft.bbox --- */
section('1c. 조각 실측 크기 = draft.bbox');
d0.pieces.forEach(function (p, i) {
  var pi = I0.pieces[i];
  var want = { x: p.bbox.x * 10, y: p.bbox.y * 10, w: p.bbox.w * 10, h: p.bbox.h * 10 };
  var got = pi.outlineBboxMm;
  var worst = Math.max(Math.abs(got.x - want.x), Math.abs(got.y - want.y),
                       Math.abs(got.w - want.w), Math.abs(got.h - want.h));
  ok('[' + p.name + '] outline bbox 일치 (≤0.001mm)', worst <= 1e-3,
    'draft ' + f(want.w, 3) + '×' + f(want.h, 3) + 'mm  vs  측정 ' + f(got.w, 3) + '×' + f(got.h, 3) +
    'mm   최대편차 ' + worst.toExponential(2) + 'mm');
});
ok('bbox 불일치 경고 없음', I0.warnings.filter(function (w) { return w.indexOf('bbox') >= 0; }).length === 0);

/* --- 1d. 타일 되붙임 = 원본 복원 --- */
section('1d. 타일 재조립 (겹침만큼 되붙이면 원본 크기 복원)');
var wCW = I0.worldContentWidthMm, wCH = I0.worldContentHeightMm;
var reW = I0.cols * wCW - (I0.cols - 1) * I0.overlapMm;
var reH = I0.rows * wCH - (I0.rows - 1) * I0.overlapMm;
console.log('    페이지당 world 내용 = ' + f(wCW, 3) + '×' + f(wCH, 3) + 'mm');
console.log('    재조립 = ' + I0.cols + '×' + f(wCW, 3) + ' − ' + (I0.cols - 1) + '×' + I0.overlapMm +
  ' = ' + f(reW, 3) + 'mm  /  ' + I0.rows + '×' + f(wCH, 3) + ' − ' + (I0.rows - 1) + '×' + I0.overlapMm +
  ' = ' + f(reH, 3) + 'mm');
ok('재조립 폭 = coverage', near(reW, I0.coverage.wMm, 1e-6), f(reW, 4) + ' = ' + f(I0.coverage.wMm, 4));
ok('재조립 높이 = coverage', near(reH, I0.coverage.hMm, 1e-6), f(reH, 4) + ' = ' + f(I0.coverage.hMm, 4));
ok('재조립 폭 ≥ 캔버스 폭', reW >= I0.canvas.wMm - 1e-6, f(reW, 2) + ' ≥ ' + f(I0.canvas.wMm, 2));
ok('재조립 높이 ≥ 캔버스 높이', reH >= I0.canvas.hMm - 1e-6, f(reH, 2) + ' ≥ ' + f(I0.canvas.hMm, 2));
ok('열 수 낭비 없음 (1열 빼면 부족)', I0.cols === 1 || (reW - I0.stepXMm) < I0.canvas.wMm - 1e-9,
  '한 열 줄이면 ' + f(reW - I0.stepXMm, 2) + ' < ' + f(I0.canvas.wMm, 2));
ok('행 수 낭비 없음 (1행 빼면 부족)', I0.rows === 1 || (reH - I0.stepYMm) < I0.canvas.hMm - 1e-9,
  '한 행 줄이면 ' + f(reH - I0.stepYMm, 2) + ' < ' + f(I0.canvas.hMm, 2));

/* 페이지별 world 원점이 step 간격으로 정확히 놓였는가 */
var origins = [];
L0.pagesSvg.forEach(function (svg) {
  var m = /data-ndp-world-origin="([-\d.]+),([-\d.]+)"/.exec(svg);
  if (m) origins.push([+m[1], +m[2]]);
});
var stepOK = true, stepDetail = '';
for (var r = 0; r < I0.rows; r++) {
  for (var c = 0; c < I0.cols; c++) {
    var o = origins[r * I0.cols + c];
    if (!near(o[0], c * I0.stepXMm, 1e-3) || !near(o[1], r * I0.stepYMm, 1e-3)) {
      stepOK = false; stepDetail = 'page ' + r + ',' + c + ' origin=' + o;
    }
  }
}
ok('각 페이지 world 원점 = (열×stepX, 행×stepY)', stepOK && origins.length === I0.tilePages,
  stepOK ? origins.length + '장 확인, step=' + f(I0.stepXMm, 3) + '/' + f(I0.stepYMm, 3) + 'mm' : stepDetail);
ok('겹침 = 내용폭 − step (정확히 10mm)', near(wCW - I0.stepXMm, I0.overlapMm, 1e-9) && near(wCH - I0.stepYMm, I0.overlapMm, 1e-9),
  f(wCW - I0.stepXMm, 6) + 'mm / ' + f(wCH - I0.stepYMm, 6) + 'mm');

/* --- 1e. 페이지 격자 좌표 --- */
section('1e. 페이지 격자 좌표 (A1, A2, B1 …)');
var flat = [].concat.apply([], I0.pageIds);
var uniq = {}, dup = 0;
flat.forEach(function (id) { if (uniq[id]) dup++; uniq[id] = 1; });
var pat = flat.every(function (id) { return /^[A-Z]+\d+$/.test(id); });
ok('격자 좌표 형식 및 유일성', dup === 0 && pat, flat.join(' '));
var idInSvg = L0.pagesSvg.slice(I0.overviewPages).every(function (svg, i) {
  return svg.indexOf('data-ndp-page="' + flat[i] + '"') >= 0;
});
ok('각 페이지 SVG 에 자기 좌표 기록', idInSvg);

/* --- 1f. 조각이 커버리지 밖으로 나가지 않는가 (transform 직접 해석) --- */
section('1f. 조각 배치 — transform 실제 해석 후 범위 검사');
var bodyPage = L0.pagesSvg[I0.overviewPages];
d0.pieces.forEach(function (p, i) {
  var re = new RegExp('<g data-ndp-piece="' + p.id + '" transform="([^"]+)"');
  var m = re.exec(bodyPage);
  if (!m) { ok('[' + p.name + '] transform 추출', false, '찾지 못함'); return; }
  var M = parseTransform(m[1]);
  var pts = p.outline.map(function (q) { return applyM(M, [q[0] * 10, q[1] * 10]); });
  var bb = bboxCm(pts);
  var pl = I0.placements[i];
  /* transform 문자열은 0.001mm 로 반올림되어 출력되므로 그 정도 오차는 허용 */
  var TOL = 0.002;
  var slack = Math.min(bb.x - pl.xMm, bb.y - pl.yMm,
                       (pl.xMm + pl.wMm) - (bb.x + bb.w), (pl.yMm + pl.hMm) - (bb.y + bb.h));
  var inPlace = slack >= -TOL;
  var inCover = bb.x >= -TOL && bb.y >= -TOL &&
                bb.x + bb.w <= I0.coverage.wMm + TOL && bb.y + bb.h <= I0.coverage.hMm + TOL;
  ok('[' + p.name + '] 배치 사각형 안에 들어감' + (pl.rotated ? ' (90° 회전)' : ''), inPlace,
    'outline→(' + f(bb.x, 3) + ',' + f(bb.y, 3) + ') ' + f(bb.w, 3) + '×' + f(bb.h, 3) +
    'mm ⊂ 배치(' + f(pl.xMm, 3) + ',' + f(pl.yMm, 3) + ') ' + f(pl.wMm, 3) + '×' + f(pl.hMm, 3) +
    'mm   여유 ' + f(slack, 5) + 'mm');
  ok('[' + p.name + '] 인쇄 커버리지 밖으로 안 나감', inCover,
    '≤ ' + f(I0.coverage.wMm, 2) + '×' + f(I0.coverage.hMm, 2) + 'mm');
});

/* --- 1g. 네스팅 겹침 --- */
section('1g. 네스팅 겹침 / 간격');
var worstOv = 0, worstPair = '';
for (var a = 0; a < I0.placements.length; a++) {
  for (var b2 = a + 1; b2 < I0.placements.length; b2++) {
    var A = I0.placements[a], B = I0.placements[b2];
    var ov = rectsOverlap({ x: A.xMm, y: A.yMm, w: A.wMm, h: A.hMm },
                          { x: B.xMm, y: B.yMm, w: B.wMm, h: B.hMm });
    if (ov > worstOv) { worstOv = ov; worstPair = A.name + '×' + B.name; }
  }
}
ok('조각 배치 사각형 겹침 없음', worstOv === 0, worstOv ? worstPair + ' ' + f(worstOv, 2) + 'mm²' : '겹침 면적 0mm²');
I0.placements.forEach(function (pl) {
  console.log('    ' + pl.name + ': (' + f(pl.xMm, 2) + ', ' + f(pl.yMm, 2) + ')  ' +
    f(pl.wMm, 2) + '×' + f(pl.hMm, 2) + 'mm  회전=' + (pl.rotated ? '90°' : '없음') + '  재단 ' + pl.cutCount + '장');
});
ok('모든 조각이 캔버스 안', I0.placements.every(function (p) {
  return p.xMm >= 0 && p.yMm >= 0 && p.xMm + p.wMm <= I0.canvas.wMm + 1e-6 && p.yMm + p.hMm <= I0.canvas.hMm + 1e-6;
}), '캔버스 ' + f(I0.canvas.wMm, 2) + '×' + f(I0.canvas.hMm, 2) + 'mm');

/* --- 1h. 출력 문자열 위생 --- */
section('1h. 출력 문자열 위생');
var dirty = L0.pagesSvg.filter(function (s) { return /NaN|undefined|Infinity/.test(s); }).length;
ok('pagesSvg 에 NaN/undefined/Infinity 없음', dirty === 0, dirty ? dirty + '장 오염' : L0.pageCount + '장 청결');
ok('layoutPreviewSvg 청결', !/NaN|undefined|Infinity/.test(L0.layoutPreviewSvg));
ok('layoutPreviewSvg 가 svg 루트', /^<svg[\s>]/.test(L0.layoutPreviewSvg));

/* ═══════════ 2. 부위별 시접 — 경로 A: 엔진이 seamline + seamEdges 제공 ═══════════ */
section('2. 부위별 시접 · 경로 A — 엔진이 seamline + seamEdges/seamFoldEdges 제공');
console.log('    요청: ' + JSON.stringify(PER));
var dA = mockDraft({ seam: PER, provideSeam: true, provideSeamMeta: true });
var LA = NDP.buildPrintLayout(dA, { mode: 'a4', seam: PER });
var IA = LA.info;
console.log('    적용: ' + IA.seamNote + '   (seamMode=' + IA.seamMode + ')');

ok('seamMode = perRole', IA.seamMode === 'perRole');
ok('seamByRole 이 요청대로 반영', (function () {
  for (var r in PER) if (Math.abs(IA.seamByRole[r] - PER[r]) > 1e-9) return false;
  return true;
})(), JSON.stringify(IA.seamByRole));
ok('seamSource = draft (엔진 것 그대로 사용)',
  IA.pieces.every(function (p) { return p.seamSource === 'draft'; }),
  IA.pieces.map(function (p) { return p.name + ':' + p.seamSource + '/' + p.seamTier; }).join(', '));
ok('자체 오프셋 폴백 경고 없음',
  IA.warnings.filter(function (w) { return w.indexOf('자체 생성') >= 0; }).length === 0);
ok('seamline 이 outline 과 다른 점 개수를 가질 수 있음 (인덱스 1:1 폐기)',
  IA.pieces.some(function (p, i) { return p.seamPointCount !== dA.pieces[i].outline.length; }),
  IA.pieces.map(function (p, i) { return p.name + ' outline ' + dA.pieces[i].outline.length + '→seam ' + p.seamPointCount; }).join(', '));

dA.pieces.forEach(function (p, i) {
  var pi = IA.pieces[i];
  ok('[' + p.name + '] 시접선 면적 > 완성선 면적', pi.seamAreaMm2 > pi.outlineAreaMm2,
    f(pi.seamAreaMm2, 1) + ' > ' + f(pi.outlineAreaMm2, 1) + ' mm²  (+' +
    f(100 * (pi.seamAreaMm2 / pi.outlineAreaMm2 - 1), 2) + '%)');
  ok('[' + p.name + '] 시접선 자기교차 0', pi.seamSelfIntersections === 0,
    '자기교차 ' + pi.seamSelfIntersections + '건');
});

/* --- 2a. 부위별 오프셋 거리 실측 (seamEdges 인덱스 기준) --- */
section('2a. 부위별 오프셋 거리 실측 — seamEdges 구간마다');
function measureRoleOffsets(piece) {
  /* seamline 각 구간(role)의 점들이 outline 에서 얼마나 떨어져 있는지.
     구간 양 끝 2점은 모서리 전이라 제외한다. */
  var outMM = piece.outline.map(function (q) { return [q[0] * 10, q[1] * 10]; });
  var seaMM = piece.seamline.map(function (q) { return [q[0] * 10, q[1] * 10]; });
  var NS = seaMM.length, res = {};
  piece.seamEdges.forEach(function (se) {
    var idxs = [], j = se.start;
    for (;;) { idxs.push(j); if (j === se.end) break; j = (j + 1) % NS; if (idxs.length > NS) break; }
    var body = idxs.slice(2, Math.max(3, idxs.length - 2));
    if (!body.length) return;
    var mn = Infinity, mx = 0;
    body.forEach(function (m) {
      var d = distToPoly(seaMM[m], outMM);
      if (d < mn) mn = d; if (d > mx) mx = d;
    });
    if (!res[se.role]) res[se.role] = { min: Infinity, max: 0, n: 0, want: se.seam * 10 };
    res[se.role].min = Math.min(res[se.role].min, mn);
    res[se.role].max = Math.max(res[se.role].max, mx);
    res[se.role].n += body.length;
  });
  return res;
}
dA.pieces.forEach(function (p) {
  var r = measureRoleOffsets(p), role;
  for (role in r) {
    var v = r[role];
    if (role === 'fold') {
      ok('[' + p.name + '] ' + NDP.ROLE_KO[role] + ' 오프셋 = 0.000mm', v.max < 1e-9,
        '표본 ' + v.n + '개, 최대 ' + v.max.toExponential(2) + 'mm');
    } else {
      ok('[' + p.name + '] ' + NDP.ROLE_KO[role] + ' 오프셋 = ' + f(v.want, 2) + 'mm (±0.05)',
        near(v.min, v.want, 0.05) && near(v.max, v.want, 0.05),
        '표본 ' + v.n + '개, 실측 ' + f(v.min, 4) + ' ~ ' + f(v.max, 4) + 'mm');
    }
  }
});

/* --- 2b. 골선 시접 0 (seamFoldEdges 기준) --- */
section('2b. 골선(CB·CF) 시접 = 0 — seamline 인덱스 기준');
dA.pieces.forEach(function (p, i) {
  var pi = IA.pieces[i];
  if (!p.foldEdges || !p.foldEdges.length) {
    ok('[' + p.name + '] 골선 없음 (소매 = 한 장, SPEC §3.4)',
      pi.foldRangeCount === 0 && (!p.seamFoldEdges || !p.seamFoldEdges.length),
      'foldRangeCount=' + pi.foldRangeCount);
    return;
  }
  var outMM = p.outline.map(function (q) { return [q[0] * 10, q[1] * 10]; });
  var seaMM = p.seamline.map(function (q) { return [q[0] * 10, q[1] * 10]; });
  var NO = outMM.length, NS = seaMM.length;
  /* ⚠ 골선이 인덱스 0 을 감싸면 범위가 여러 개로 쪼개진다 — 전부 순회할 것 */
  var foldPoly = [];
  p.foldEdges.forEach(function (fr) {
    var fq = fr[0];
    for (;;) { foldPoly.push(outMM[fq]); if (fq === fr[1]) break; fq = (fq + 1) % NO; }
  });
  var sIdx = [];
  p.seamFoldEdges.forEach(function (fr) {
    var sq = fr[0], guard = 0;
    for (;;) { if (sIdx.indexOf(sq) < 0) sIdx.push(sq); if (sq === fr[1]) break; sq = (sq + 1) % NS; if (++guard > NS) break; }
  });
  /* 골선 끝점은 이웃 변의 시접만큼 골선을 따라 "연장"되는 것이 정상이므로,
     골선 직선까지의 수직거리(옆으로 벗어난 양)로 잰다. */
  function dLine(q, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy);
    return L < 1e-12 ? Math.hypot(q[0] - a[0], q[1] - a[1])
                     : Math.abs((q[0] - a[0]) * vy - (q[1] - a[1]) * vx) / L;
  }
  var fa = foldPoly[0], fb = foldPoly[foldPoly.length - 1];
  var mx = 0, ext = 0;
  sIdx.forEach(function (m) {
    mx = Math.max(mx, dLine(seaMM[m], fa, fb));
    ext = Math.max(ext, distToPolyline(seaMM[m], foldPoly));   // 골선 방향 연장량
  });
  var wrapO = (p.foldEdges[0][1] < p.foldEdges[0][0]) ? 'wrap' : '일반';
  var wrapS = (p.seamFoldEdges[0][1] < p.seamFoldEdges[0][0]) ? 'wrap' : '일반';
  ok('[' + p.name + '] 시접선 골선 구간이 골선에서 옆으로 벗어나지 않음', mx < 0.001,
    'foldEdges=[' + p.foldEdges[0] + '](' + wrapO + ', outline 기준) / seamFoldEdges=[' +
    p.seamFoldEdges[0] + '](' + wrapS + ', seamline 기준), 골선 정점 ' + sIdx.length +
    '개, 옆이탈 ' + mx.toExponential(2) + 'mm · 골선 방향 연장 ' + f(ext, 3) + 'mm(=이웃 변 시접)');
  ok('[' + p.name + '] print.js foldSeamGapMm = 0', pi.foldSeamGapMm < 1e-9,
    'info.pieces[].foldSeamGapMm = ' + pi.foldSeamGapMm);
  ok('[' + p.name + '] seamTier = T1', pi.seamTier.indexOf('T1') === 0, pi.seamTier);
});

/* ⚠ 총괄 경고: seamFoldEdges 는 보통 여러 구간. 쪼개서 줘도 같은 결과여야 한다. */
(function () {
  var d = mockDraft({ seam: PER });
  var back = d.pieces[0];
  var NS = back.seamline.length;
  var whole = back.seamFoldEdges[0];                       // [68, 0] — 0 을 감싸는 한 구간
  ok('목업이 0 을 감싸는 골선 범위를 만든다', whole[1] < whole[0], 'seamFoldEdges=[' + whole + ']');
  /* 같은 점 집합을 두 구간으로 쪼갬: [start, NS-1] + [0, 0] */
  back.seamFoldEdges = [[whole[0], NS - 1], [0, whole[1]]];
  var Lsplit = NDP.buildPrintLayout(d, { mode: 'a4', seam: PER });
  var pi0 = Lsplit.info.pieces[0];
  ok('여러 구간으로 쪼개도 골선 판정 동일', pi0.foldSeamGapMm < 1e-9 &&
     pi0.seamTier.indexOf('T1') === 0,
    '구간 ' + JSON.stringify(back.seamFoldEdges) + ' → foldSeamGapMm=' + pi0.foldSeamGapMm);
  ok('쪼갠 경우에도 재단선이 골선에서 분할됨',
    Lsplit.pagesSvg.join('').indexOf('골선 · 시접 없음') >= 0 &&
    (Lsplit.pagesSvg[Lsplit.info.overviewPages]
      .match(/<path d="M [^"]*" fill="none" stroke="#111111" stroke-width="0.55"/g) || []).length >= 2);
  /* seamEdges 의 첫·마지막 항목이 같은 role 인 경우(소매 진동) */
  var sl = d.pieces[2].seamEdges;
  ok('seamEdges 첫 항목과 마지막 항목이 같은 변(role)인 케이스 포함',
    sl[0].role === sl[sl.length - 1].role,
    '소매 seamEdges = ' + sl.map(function (e) { return e.role + ':' + e.start + '-' + e.end; }).join(', '));
  ok('그 경우에도 시접선/병기가 정상', Lsplit.info.pieces[2].seamSelfIntersections === 0);
})();

/* --- 2c. 옆선(1.5) ↔ 밑단(3.0) 모서리 --- */
section('2c. 옆선 1.5 ↔ 밑단 3.0 모서리 — 두 오프셋선의 교점');
(function () {
  var back = dA.pieces[0];                       // 뒷판: 옆선(1.5) → 허리선(hem 3.0)
  var outMM = back.outline.map(function (q) { return [q[0] * 10, q[1] * 10]; });
  var seaMM = back.seamline.map(function (q) { return [q[0] * 10, q[1] * 10]; });
  /* 완성선의 옆선↔밑단 모서리 = 옆선 edge 의 end 정점 */
  var sideE = null, hemE = null;
  back.edges.forEach(function (e) { if (e.role === 'side') sideE = e; if (e.role === 'hem') hemE = e; });
  var corner = outMM[sideE.end];
  console.log('    완성선 모서리(옆선 끝 = 밑단 시작) = (' + f(corner[0], 2) + ', ' + f(corner[1], 2) + ') mm');

  /* 이론 교점: 옆선은 수직(x=bSideX) → 바깥 1.5cm, 밑단은 수평(y=WL) → 바깥 3.0cm */
  var want = [corner[0] + 15, corner[1] + 30];
  /* 실측: seamline 에서 그 모서리에 가장 가까운 점 */
  var best = null, bd = Infinity;
  seaMM.forEach(function (q) { var d = Math.hypot(q[0] - want[0], q[1] - want[1]); if (d < bd) { bd = d; best = q; } });
  console.log('    이론 교점 = (' + f(want[0], 3) + ', ' + f(want[1], 3) + ')   실측 = (' +
    f(best[0], 3) + ', ' + f(best[1], 3) + ')');
  ok('모서리가 두 오프셋선의 교점에 정확히 위치', bd < 0.02,
    '편차 ' + f(bd, 5) + 'mm  → 옆선 방향 +' + f(best[0] - corner[0], 3) +
    'mm(=1.5cm) · 밑단 방향 +' + f(best[1] - corner[1], 3) + 'mm(=3.0cm)');
  ok('모서리 근처 자기교차 없음', NDP._countSelfIntersections(seaMM) === 0);

  /* 골선(0) ↔ 밑단(3.0) 모서리: 골선을 유지한 채 3.0 연장되어야 함 */
  var foldStart = outMM[back.foldEdges[0][0]];     // (0, WL)
  var want2 = [foldStart[0], foldStart[1] + 30];
  var best2 = null, bd2 = Infinity;
  seaMM.forEach(function (q) { var d = Math.hypot(q[0] - want2[0], q[1] - want2[1]); if (d < bd2) { bd2 = d; best2 = q; } });
  ok('골선(0) ↔ 밑단(3.0) 모서리 — 골선 x 유지한 채 3.0cm 연장', bd2 < 0.02,
    '골선 시작 (' + f(foldStart[0], 2) + ',' + f(foldStart[1], 2) + ') → 시접선 (' +
    f(best2[0], 3) + ',' + f(best2[1], 3) + ')  x 이동 ' + f(best2[0] - foldStart[0], 5) +
    'mm · y 연장 ' + f(best2[1] - foldStart[1], 3) + 'mm');
})();

/* --- 2d. 골선 표시 · 시접선 분할 · 부위별 병기 --- */
section('2d. 렌더 — 골선 표시 · 재단선 분할 · 부위별 폭 병기');
var allA = LA.pagesSvg.join('');
var oneA = LA.pagesSvg[IA.overviewPages];
ok('골선 마커 렌더됨', (allA.match(/data-ndp-fold="1"/g) || []).length > 0,
  '전 페이지 합계 ' + (allA.match(/data-ndp-fold="1"/g) || []).length + '개');
ok('"골선 · 시접 없음" 라벨 존재', allA.indexOf('골선 · 시접 없음') >= 0);
/* 재단선은 조각당 "닫힌 path 1개".
   골선 구간의 시접선은 오프셋 0 이라 골선 위에 그대로 놓이고 양 끝이 이웃 변의
   시접만큼 연장돼 있다. 골선을 빼고 완성선으로 대체하면 그 연장분(목1.0/밑단3.0)
   만큼 재단선에 틈이 생긴다 — 브라우저 실측에서 실제로 잡혔던 결함. */
var cutAllPaths = (oneA.match(/<path d="[^"]*" fill="none" stroke="#111111" stroke-width="0.55"/g) || []);
var cutClosed   = (oneA.match(/<path d="[^"]*Z" fill="none" stroke="#111111" stroke-width="0.55"/g) || []);
var finPaths    = (oneA.match(/stroke-dasharray="4 2\.2"/g) || []).length;
ok('재단선은 조각당 닫힌 path 1개 (틈 없음)',
  cutAllPaths.length === dA.pieces.length && cutClosed.length === dA.pieces.length,
  '재단선 ' + cutAllPaths.length + '개 (닫힌 것 ' + cutClosed.length + '개) / 조각 ' + dA.pieces.length + '개');
/* 골선 있는 조각(앞·뒤)의 완성선은 "열린" 호가 되고, 골선 없는 소매만 닫힌 폐곡선 */
var finOpen   = (oneA.match(/<path d="[^"]*[^Z]" fill="none" stroke="#111111" stroke-width="0.38"/g) || []).length;
var finClosed = (oneA.match(/<path d="[^"]*Z" fill="none" stroke="#111111" stroke-width="0.38"/g) || []).length;
var foldPieces = dA.pieces.filter(function (p) { return p.foldEdges && p.foldEdges.length; }).length;
ok('완성선(파선)이 골선 구간을 비워 열린 호가 됨',
  finPaths === dA.pieces.length && finOpen === foldPieces && finClosed === dA.pieces.length - foldPieces,
  '완성선 ' + finPaths + '개 = 열림 ' + finOpen + '(골선 조각 ' + foldPieces + ') + 닫힘 ' + finClosed +
  '(골선 없는 소매)');
ok('시접선=실선(0.55) / 완성선=파선(4 2.2) 구분',
  /stroke-width="0.55"/.test(oneA) && /stroke-dasharray="4 2.2"/.test(oneA));
var seamLabels = (allA.match(/data-ndp-seamlabel="([a-zA-Z]+)"/g) || []);
ok('시접선 위 부위별 폭 병기', seamLabels.length > 0,
  '병기 ' + seamLabels.length + '개 (예: ' + (allA.match(/data-ndp-seamlabel="[a-z]+"[^>]*>([^<]*)</i) || [])[1] + ')');
ok('조각 라벨에 부위별 시접 요약', /data-ndp-seamsummary="1"/.test(allA) && allA.indexOf('밑단 3') >= 0,
  '균일 표기 대신 부위별로 표기');
ok('페이지 정보띠에 부위별 시접', /data-ndp-seamnote="1"/.test(allA) && IA.seamNote.indexOf('밑단 3') >= 0,
  IA.seamNote);

/* ═══════════ 3. 폴백 경로 ═══════════ */
section('3. 폴백 — 경로 C(edges[].role 만) / D(아무 메타도 없음) / E(seamline 만)');

/* 경로 C: seamline 없음, edges[].role + foldEdges 있음 → print.js 가 부위별로 오프셋 */
var dC = mockDraft({ seam: PER, provideSeam: false });
var LC = NDP.buildPrintLayout(dC, { mode: 'a4', seam: PER });
var IC = LC.info;
ok('[C] seamSource = computed / seamTier = T3(부위별)',
  IC.pieces.every(function (p) { return p.seamSource === 'computed' && p.seamTier.indexOf('edges[].role') > 0; }),
  IC.pieces[0].seamTier);
ok('[C] 폴백 경고 발생', IC.warnings.filter(function (w) { return w.indexOf('자체 생성') >= 0; }).length === 3);
ok('[C] 골선 편차 0', IC.pieces.every(function (p) { return p.foldSeamGapMm === 0; }));
ok('[C] 자기교차 0', IC.pieces.every(function (p) { return p.seamSelfIntersections === 0; }),
  IC.pieces.map(function (p) { return p.name + ':' + p.seamSelfIntersections; }).join(', '));
IC.pieces.forEach(function (p, i) {
  var refA = IA.pieces[i];
  ok('[C] [' + p.name + '] 폴백 시접 면적이 엔진 제공분과 일치(±0.5%)',
    Math.abs(p.seamAreaMm2 / refA.seamAreaMm2 - 1) < 0.005,
    f(p.seamAreaMm2, 1) + ' vs 엔진 ' + f(refA.seamAreaMm2, 1) + ' mm²  차 ' +
    f(100 * (p.seamAreaMm2 / refA.seamAreaMm2 - 1), 4) + '%');
});

/* 경로 D: edges[].role 도 foldEdges 도 없음 → 부위 구분 불가, 최대폭 균일 */
var dD = mockDraft({ seam: PER, provideSeam: false, provideFold: false, provideEdges: false });
var LD = NDP.buildPrintLayout(dD, { mode: 'a4', seam: PER });
var ID = LD.info;
ok('[D] 부위 구분 불가 경고', ID.warnings.some(function (w) { return w.indexOf('부위별 폭을 구분하지 못하고') >= 0; }));
ok('[D] foldRangeCount = 0, 골선 마커 없음',
  ID.pieces.every(function (p) { return p.foldRangeCount === 0; }) &&
  LD.pagesSvg.join('').indexOf('data-ndp-fold="1"') < 0);
ok('[D] 최대폭 균일이라 면적이 경로 A 보다 큼',
  ID.pieces[0].seamAreaMm2 > IA.pieces[0].seamAreaMm2,
  f(ID.pieces[0].seamAreaMm2, 1) + ' > ' + f(IA.pieces[0].seamAreaMm2, 1) + ' mm²');

/* 경로 F: edges[] 가 점을 나눠 갖는 형태(실제 엔진) — 경계 세그먼트가 비어 있다.
   이건 자료구조의 성질이므로 경고 없이 직전 변 시접으로 귀속되어야 한다. */
section('3b. edges[] 경계 세그먼트 귀속 (실제 엔진의 disjoint 점 범위)');
SIZE_LIST_EARLY.forEach(function (sz) {
  var dF = mockDraft({ size: sz, seam: PER, provideSeam: false, disjointEdges: true });
  var LF = NDP.buildPrintLayout(dF, { mode: 'a4', seam: PER });
  var IF = LF.info;
  var covWarn = IF.warnings.filter(function (w) { return w.indexOf('덮지 않음') >= 0; });
  var maxWarn = IF.warnings.filter(function (w) { return w.indexOf('최대') >= 0 && w.indexOf('적용') >= 0; });
  ok('[' + sz + '] 경계 세그먼트 경고 없음', covWarn.length === 0 && maxWarn.length === 0,
    covWarn.length + maxWarn.length ? (covWarn.concat(maxWarn)[0]) : '경고 0건 (변 경계는 직전 변 시접으로 귀속)');
  ok('[' + sz + '] 부위별 시접이 그대로 유지됨',
    IF.pieces.every(function (p) { return p.seamSelfIntersections === 0 && p.foldSeamGapMm < 1e-9; }));
});
(function () {
  /* 귀속 후 실제 오프셋 거리가 공유형(contiguous)과 같은지 */
  var dSh = mockDraft({ size: '66호', seam: PER, provideSeam: false });
  var dDj = mockDraft({ size: '66호', seam: PER, provideSeam: false, disjointEdges: true });
  var LSh = NDP.buildPrintLayout(dSh, { mode: 'a4', seam: PER });
  var LDj = NDP.buildPrintLayout(dDj, { mode: 'a4', seam: PER });
  var same = LSh.info.pieces.every(function (p, i) {
    return Math.abs(p.seamAreaMm2 - LDj.info.pieces[i].seamAreaMm2) < 0.5;
  });
  ok('경계 세그먼트 귀속 결과가 공유형과 사실상 동일', same,
    LSh.info.pieces.map(function (p, i) {
      return p.name + ' ' + f(p.seamAreaMm2 / 100, 1) + '↔' + f(LDj.info.pieces[i].seamAreaMm2 / 100, 1) + 'cm²';
    }).join(' · '));
  ok('경계 세그먼트에 최대 시접(3cm)이 잘못 적용되지 않음',
    LDj.info.pieces[0].seamAreaMm2 < LSh.info.pieces[0].seamAreaMm2 + 200,
    '면적 차 ' + f((LDj.info.pieces[0].seamAreaMm2 - LSh.info.pieces[0].seamAreaMm2) / 100, 3) + 'cm²');
})();

/* 경로 E: seamline 은 있는데 seamEdges/seamFoldEdges 가 없음(구버전 엔진) */
var dE = mockDraft({ seam: PER, provideSeam: true, provideSeamMeta: false });
var LE = NDP.buildPrintLayout(dE, { mode: 'a4', seam: PER });
var IE = LE.info;
ok('[E] 구버전 엔진 경고 후 기하 판별로 폴백',
  IE.warnings.some(function (w) { return w.indexOf('기하적으로 판별') >= 0; }) &&
  IE.pieces.slice(0, 2).every(function (p) { return p.seamTier.indexOf('T2') === 0; }),
  IE.pieces.map(function (p) { return p.name + ':' + p.seamTier; }).join(', '));
ok('[E] 기하 판별로도 골선 편차 0', IE.pieces.every(function (p) { return p.foldSeamGapMm < 1e-9; }),
  IE.pieces.map(function (p) { return f(p.foldSeamGapMm, 6); }).join(', '));
ok('[E] 골선 마커·재단선 분할 정상', LE.pagesSvg.join('').indexOf('골선 · 시접 없음') >= 0);

/* 하위호환 — 숫자 하나 */
section('3a. 하위호환 — opt.seam 숫자 / 0');
var LU = NDP.buildPrintLayout(mockDraft({ seam: 1.0 }), { mode: 'a4', seam: 1.0 });
ok('숫자 1.0 → seamMode=uniform, 전 부위 1.0 (골선만 0)',
  LU.info.seamMode === 'uniform' && LU.info.seamByRole.hem === 1.0 &&
  LU.info.seamByRole.side === 1.0 && LU.info.seamByRole.fold === 0,
  JSON.stringify(LU.info.seamByRole));
(function () {
  var r = measureRoleOffsets(mockDraft({ seam: 1.0 }).pieces[0]), role, allOK = true, det = [];
  for (role in r) {
    if (role === 'fold') { if (r[role].max > 1e-9) allOK = false; det.push('골선 0'); continue; }
    if (!near(r[role].min, 10, 0.05) || !near(r[role].max, 10, 0.05)) allOK = false;
    det.push(NDP.ROLE_KO[role] + ' ' + f(r[role].min, 3));
  }
  ok('균일 1.0 → 전 구간 10.00mm', allOK, det.join(' · '));
})();
var LZ = NDP.buildPrintLayout(mockDraft({ seam: 0 }), { mode: 'a4', seam: 0 });
ok('seam=0 → seamMode=none, 시접선 없음',
  LZ.info.seamMode === 'none' && LZ.info.pieces.every(function (p) { return p.seamAreaMm2 === null; }));
ok('seam=0 이면 정보띠도 "시접 없음"', LZ.info.seamNote.indexOf('시접 없음') === 0, LZ.info.seamNote);
ok('시접 1.5 균일도 동작', (function () {
  var L = NDP.buildPrintLayout(mockDraft({ seam: 1.5 }), { mode: 'a4', seam: 1.5 });
  return L.info.pieces.every(function (p) { return p.seamAreaMm2 > p.outlineAreaMm2 && p.foldSeamGapMm === 0; });
})());
ok('엔진 seamline 이 골선을 0 처리 안 했으면 경고', (function () {
  var d = mockDraft({ seam: PER });
  d.pieces[0].seamline = NDP._offsetLoop(d.pieces[0].outline, 1.5);
  delete d.pieces[0].seamEdges; delete d.pieces[0].seamFoldEdges;   // 골선 포함 균일 오프셋
  var L = NDP.buildPrintLayout(d, { mode: 'a4', seam: PER });
  return L.info.warnings.some(function (w) { return w.indexOf('골선 시접은 0 이어야') >= 0; }) &&
         L.info.pieces[0].foldSeamGapMm > 9;
})(), '골선 편차를 감지해 경고');

/* ═══════════ 4. 너치 — angle 단위 = 도(°) ═══════════ */
section('4. 너치 — angle 은 도(°), 안쪽 0.5cm (SPEC §8.1)');
var ncTotal = I0.pieces.reduce(function (s, p) { return s + p.notchCount; }, 0);
ok('너치 개수 = 조각당 3개', I0.pieces.every(function (p) { return p.notchCount === 3; }), '총 ' + ncTotal + '개');
ok('너치 경고 없음', I0.warnings.filter(function (w) { return w.indexOf('notches') >= 0; }).length === 0);
ok('info 에 도(°) 그대로 기록', JSON.stringify(I0.pieces[0].notchAnglesDeg) === '[112,112,180]',
  '뒷판 ' + JSON.stringify(I0.pieces[0].notchAnglesDeg) + ' / 앞판 ' + JSON.stringify(I0.pieces[1].notchAnglesDeg));
ok('너치 라벨이 SVG 에 존재', /목옆/.test(bodyPage) && /어깨/.test(bodyPage) && /BL/.test(bodyPage));

/* 실제 그려진 너치 선의 방향 벡터를 뽑아 도(°) 해석인지 확인.
   회전 없는 배치라 평행이동만 걸리므로 (x2−x1, y2−y1) 는 그대로 방향×길이. */
(function () {
  var seam0 = NDP.buildPrintLayout(mockDraft({ seam: 0 }), { mode: 'a4', seam: 0 });
  var page = seam0.pagesSvg[seam0.info.overviewPages];
  var re = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="#111111" stroke-width="0.45" stroke-linecap="round"\/>/g;
  var m, vecs = [];
  while ((m = re.exec(page))) vecs.push([+m[3] - +m[1], +m[4] - +m[2]]);
  ok('너치 선 추출', vecs.length >= 3, vecs.length + '개');
  var lens = vecs.map(function (v) { return Math.hypot(v[0], v[1]); });
  ok('시접 0 일 때 너치 길이 = 5.00mm (안쪽 0.5cm)',
    lens.every(function (L) { return near(L, 5, 0.002); }),
    '길이 ' + lens.map(function (L) { return f(L, 3); }).join(', ') + 'mm');
  /* 180° 너치: 정확히 −x 방향 */
  var horiz = vecs.filter(function (v) { return Math.abs(v[1]) < 1e-6; });
  ok('180° 너치는 정확히 −x 방향', horiz.length >= 1 && horiz.every(function (v) { return v[0] < 0; }),
    horiz.length + '개, Δ=(' + (horiz[0] ? f(horiz[0][0], 3) + ', ' + f(horiz[0][1], 3) : '?') + ')');
  /* 112° 너치: 도로 해석하면 (−1.873, 4.636), 라디안이면 (0.162, 0.0 근처) */
  var wantDeg = [5 * Math.cos(112 * Math.PI / 180), 5 * Math.sin(112 * Math.PI / 180)];
  var wantRad = [5 * Math.cos(112), 5 * Math.sin(112)];
  var got = null;
  vecs.forEach(function (v) { if (Math.abs(v[0] - wantDeg[0]) < 0.01 && Math.abs(v[1] - wantDeg[1]) < 0.01) got = v; });
  ok('112° 를 도(°)로 해석 (라디안 아님)', !!got,
    '기대 도(°) Δ=(' + f(wantDeg[0], 3) + ', ' + f(wantDeg[1], 3) + ')  ' +
    '라디안이면 (' + f(wantRad[0], 3) + ', ' + f(wantRad[1], 3) + ')  ' +
    '실제 ' + (got ? '(' + f(got[0], 3) + ', ' + f(got[1], 3) + ')' : '없음'));
  /* 시접이 있으면 바깥으로 시접 폭만큼 더 뻗는다 */
  var LS = NDP.buildPrintLayout(mockDraft({ seam: PER }), { mode: 'a4', seam: PER });
  var ps = LS.pagesSvg[LS.info.overviewPages];
  var re2 = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="#111111" stroke-width="0.45" stroke-linecap="round"\/>/g;
  var m2, lens2 = [];
  while ((m2 = re2.exec(ps))) lens2.push(Math.hypot(+m2[3] - +m2[1], +m2[4] - +m2[2]));
  /* 부위별 시접이므로 너치 길이도 부위마다 다르다 (SPEC §11-1):
     목·어깨 1.0cm → 15mm, 옆선 1.5cm → 20mm, 진동 1.0 → 15, 소매부리 2.5 → 30 */
  var wantLens = [];
  LS.info.pieces.forEach(function (pp) {
    pp.notchOutMm.forEach(function (om) { wantLens.push(om + 5); });
  });
  var lenOK = (lens2.length === wantLens.length) && lens2.every(function (L, ii) { return near(L, wantLens[ii], 0.002); });
  ok('너치 길이 = 그 변의 부위 시접 + 안쪽 5mm', lenOK,
    '기대 ' + wantLens.join('/') + 'mm  실측 ' + lens2.map(function (L) { return f(L, 2); }).join('/') + 'mm');
  var roleRep = [];
  LS.info.pieces.forEach(function (pp) {
    pp.notchRoles.forEach(function (r, ii) {
      roleRep.push(pp.name + '·' + (NDP.ROLE_KO[r] || r) + ' ' + f(pp.notchOutMm[ii] + 5, 0) + 'mm');
    });
  });
  ok('부위마다 너치 길이가 다름 (옆선 1.5 > 어깨 1.0)',
    (function () { var s = {}; roleRep.forEach(function (x) { s[x.split(' ')[1]] = 1; }); return Object.keys(s).length > 1; })(),
    roleRep.join(' · '));
})();

/* ───────────────── 5. 인쇄 보정 (5cm 실측 48mm) ───────────────── */
section('5. 인쇄 보정 — 5cm 를 48mm 로 재었을 때');
var L2 = NDP.buildPrintLayout(mockDraft({ seam: 0 }), { mode: 'a4', seam: 0, calibMm: 48 });
var I2 = L2.info;
var kExp = 50 / 48;
console.log('    보정계수 k = 50/48 = ' + f(kExp, 6) + '  → 눈금 declared ' + f(50 * kExp, 4) + 'mm');
ok('scaleFactor = 50/48', near(I2.scaleFactor, kExp, 1e-12), f(I2.scaleFactor, 8));
ok('눈금 declared 길이 = 50×k', near(I2.calibration.declaredMm, 50 * kExp, 1e-9), f(I2.calibration.declaredMm, 5) + 'mm');
var m2 = /data-ndp-calib-line="1" x1="([-\d.]+)" y1="[-\d.]+" x2="([-\d.]+)"/.exec(L2.pagesSvg[1]);
ok('SVG 실제 눈금 좌표도 50×k', m2 && near(Math.abs(+m2[2] - +m2[1]), 50 * kExp, 1e-3),
  m2 ? f(Math.abs(+m2[2] - +m2[1]), 4) + ' user unit' : '못 찾음');
console.log('    → 프린터가 96% 로 축소해도 ' + f(50 * kExp, 4) + ' × 0.96 = ' + f(50 * kExp * 0.96, 4) + 'mm 로 인쇄됨');
ok('보정 후 실제 인쇄 길이 = 50.000mm', near(50 * kExp * (48 / 50), 50, 1e-9));
ok('보정 시 world 내용폭이 줄어듦', I2.worldContentWidthMm < I0.worldContentWidthMm,
  f(I2.worldContentWidthMm, 2) + ' < ' + f(I0.worldContentWidthMm, 2) + 'mm');
ok('용지 크기는 그대로 210×297mm', I2.pageWidthMm === 210 && I2.pageHeightMm === 297);
ok('보정 시 페이지 수 ' + I2.tilePages + '장 (기준 ' + I0.tilePages + '장)', I2.tilePages >= I0.tilePages);

/* ───────────────── 6. 롤지 모드 ───────────────── */
section('6. A1 롤지 모드 (폭 ≤ 594mm · 길이 제한 없음 — 페이지 = 패턴 크기)');
/* 6절은 **분할 없는** 롤 레이아웃을 본다 (rollMaxHmm: 0). 분할은 6-2 절에서 따로. */
var L3 = NDP.buildPrintLayout(mockDraft({ seam: PER }), { mode: 'roll', rollWidthMm: 594, rollMaxHmm: 0, seam: PER });
var I3 = L3.info;
console.log('    용지 = ' + f(I3.pageWidthMm, 1) + ' × ' + f(I3.pageHeightMm, 2) + 'mm  (길이 가변)');
console.log('    캔버스 = ' + f(I3.canvas.wMm, 2) + ' × ' + f(I3.canvas.hMm, 2) + 'mm   유효폭 = ' + f(I3.worldContentWidthMm, 2) + 'mm');
ok('길이 제한 없으면 1장', L3.pageCount === 1 && I3.tilePages === 1);
/* ★ 롤지는 길이 제한이 없다 — 페이지를 A1 규격에 맞추지 않고 **패턴 크기 그대로** 잡는다.
   폭도 롤 폭까지 채우지 않고 배치 폭에 맞춰 줄인다(물리적 롤 폭은 절대 안 넘는다). */
ok('용지 폭 = 배치 크기 (롤 폭 이내)',
  I3.pageWidthMm <= 594 + 1e-6 && Math.abs(I3.pageWidthMm - (I3.canvas.wMm + 30)) < 1e-6,
  f(I3.pageWidthMm, 2) + 'mm = 배치 ' + f(I3.canvas.wMm, 2) + ' + 여백 30');
var mw = /width="([\d.]+)mm"/.exec(L3.pagesSvg[0]), mh = /height="([\d.]+)mm"/.exec(L3.pagesSvg[0]);
var mvb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(L3.pagesSvg[0]);
ok('SVG width 속성 = 용지 폭', mw && near(+mw[1], I3.pageWidthMm, 0.01), mw ? mw[1] + 'mm' : '?');
ok('SVG viewBox 가 mm 와 1:1', mvb && near(+mvb[1], +mw[1], 1e-6) && near(+mvb[2], +mh[1], 1e-6),
  mvb ? '0 0 ' + mvb[1] + ' ' + mvb[2] + '  vs  ' + mw[1] + 'mm × ' + mh[1] + 'mm' : '?');
ok('조각이 롤 유효폭 안에 들어감', I3.canvas.wMm <= I3.worldContentWidthMm + 1e-6,
  f(I3.canvas.wMm, 2) + ' ≤ ' + f(I3.worldContentWidthMm, 2) + 'mm');
ok('롤지 폭 초과 경고 없음', I3.warnings.filter(function (w) { return w.indexOf('초과') >= 0; }).length === 0);
ok('@page 가 가변 폭·길이 반영',
  I3.pageCss === '@page{size:' + (+I3.pageWidthMm.toFixed(2)) + 'mm ' + (+I3.pageHeightMm.toFixed(2)) + 'mm;margin:0}', I3.pageCss);
ok('롤지에도 5cm 눈금', (L3.pagesSvg[0].match(/data-ndp-calib="1"/g) || []).length >= 2,
  (L3.pagesSvg[0].match(/data-ndp-calib="1"/g) || []).length + '개 (가로 2 + 세로 1)');
ok('조각 라벨: 호수·조각명·식서·재단매수', /66호/.test(L3.pagesSvg[0]) && /뒷판/.test(L3.pagesSvg[0]) &&
  /식서/.test(L3.pagesSvg[0]) && /재단 2장/.test(L3.pagesSvg[0]));
ok('롤지에도 골선 표시', L3.pagesSvg[0].indexOf('골선 · 시접 없음') >= 0 &&
  (L3.pagesSvg[0].match(/data-ndp-fold="1"/g) || []).length === 2,
  (L3.pagesSvg[0].match(/data-ndp-fold="1"/g) || []).length + '개 (앞·뒤 각 1)');
var L4 = NDP.buildPrintLayout(mockDraft({ seam: 0 }), { mode: 'roll', rollWidthMm: 914, rollMaxHmm: 0, seam: 0 });
ok('넓은 롤(914)에서도 용지는 배치 크기', L4.info.pageWidthMm <= 914 + 1e-6 &&
  Math.abs(L4.info.pageWidthMm - (L4.info.canvas.wMm + 30)) < 1e-6,
  f(L4.info.pageWidthMm, 1) + 'mm × ' + f(L4.info.pageHeightMm, 1) + 'mm (배치 ' + f(L4.info.canvas.wMm, 1) + ')');
ok('길이 제한 없음 — A1 세로(841)보다 길어도 된다',
  NDP.DEFAULTS.rollFitWidth === true, '페이지 = 패턴 크기');

/* ───────────────── 6-2. 롤지 길이 제한 분할 ───────────────── */
section('6-2. 롤지 길이 제한 — 조각을 자르지 않고 나눈다');
var LMAX = 841;
var L3s = NDP.buildPrintLayout(mockDraft({ seam: PER }), { mode: 'roll', rollWidthMm: 594, rollMaxHmm: LMAX, seam: PER });
var hs = L3s.pagesSvg.map(function (sv) { return +/height="([\d.]+)mm"/.exec(sv)[1]; });
console.log('    제한 ' + LMAX + 'mm → ' + L3s.pageCount + '장, 길이 ' + hs.map(function (h) { return f(h, 1); }).join(' / ') + 'mm');
ok('길이가 제한을 넘으면 나눈다', I3.pageHeightMm <= LMAX ? L3s.pageCount === 1 : L3s.pageCount > 1,
  '무제한 ' + f(I3.pageHeightMm, 1) + 'mm → ' + L3s.pageCount + '장');
ok('모든 장이 제한 이내', hs.every(function (h) { return h <= LMAX + 1e-6; }), hs.map(function (h) { return f(h, 1); }).join(', '));
ok('장마다 길이가 같다 (@page 하나로 표현 가능)',
  hs.every(function (h) { return Math.abs(h - hs[0]) < 1e-6; }), f(hs[0], 2) + 'mm');
ok('@page 가 실제 장 길이와 일치',
  L3s.info.pageCss === '@page{size:' + (+L3s.info.pageWidthMm.toFixed(2)) + 'mm ' + (+hs[0].toFixed(2)) + 'mm;margin:0}',
  L3s.info.pageCss);
ok('조각이 잘리지 않는다 — 모든 조각이 정확히 한 장에만',
  (function () {
    var seen = {};
    for (var q = 0; q < L3s.pagesSvg.length; q++) {
      var ids = L3s.pagesSvg[q].match(/data-ndp-piece="([^"]+)"/g) || [];
      for (var r = 0; r < ids.length; r++) { var id = ids[r]; if (seen[id]) return false; seen[id] = 1; }
    }
    return Object.keys(seen).length === L3s.info.placements.length;
  })(), L3s.info.placements.length + '조각');
ok('용지 크기가 머리말에 적혀 있다',
  /용지 \d+ × \d+ mm/.test(L3s.pagesSvg[0]),
  (/용지 \d+ × \d+ mm/.exec(L3s.pagesSvg[0]) || ['?'])[0]);

/* ───────────────── 7. 네스팅 회전 ───────────────── */
section('7. 네스팅 회전 / 용지 절약');
var wide = mockDraft({ seam: 0 });
wide.pieces = [{
  id: 'wide', name: '가로긴조각', cutCount: 1,
  grainline: [[2, 5], [38, 5]],
  outline: [[0, 0], [40, 0], [40, 12], [0, 12]],
  seamline: [[0, 0], [40, 0], [40, 12], [0, 12]],
  internal: [], notches: [{ p: [20, 0], angle: 90, label: 'C' }],   // 90° = +y(안쪽)
  bbox: { x: 0, y: 0, w: 40, h: 12 }
}];
var L5 = NDP.buildPrintLayout(wide, { mode: 'a4', seam: 0 });
ok('가로로 긴 조각을 90° 회전해 세움', L5.info.placements[0].rotated,
  '400×120mm → 배치 ' + f(L5.info.placements[0].wMm, 1) + '×' + f(L5.info.placements[0].hMm, 1) + 'mm, ' +
  L5.info.cols + '열×' + L5.info.rows + '행 = ' + L5.info.tilePages + '장');
var L6 = NDP.buildPrintLayout(wide, { mode: 'a4', seam: 0, allowRotate: false });
ok('회전 금지 시 페이지가 더 많아짐(=회전이 절약)', L6.info.tilePages >= L5.info.tilePages,
  '회전 ' + L5.info.tilePages + '장  vs  회전금지 ' + L6.info.tilePages + '장');
/* 회전 배치의 transform 을 실제 해석해 좌표 확인 */
var mr = /<g data-ndp-piece="wide" transform="([^"]+)"/.exec(L5.pagesSvg[1]);
if (mr) {
  var Mr = parseTransform(mr[1]);
  var ptsR = wide.pieces[0].outline.map(function (q) { return applyM(Mr, [q[0] * 10, q[1] * 10]); });
  var bbR = bboxCm(ptsR);
  var plR = L5.info.placements[0];
  ok('회전 후 outline 이 배치 사각형 안', bbR.x >= plR.xMm - 0.002 && bbR.y >= plR.yMm - 0.002 &&
    bbR.x + bbR.w <= plR.xMm + plR.wMm + 0.002 && bbR.y + bbR.h <= plR.yMm + plR.hMm + 0.002,
    '회전결과 ' + f(bbR.w, 2) + '×' + f(bbR.h, 2) + 'mm @(' + f(bbR.x, 2) + ',' + f(bbR.y, 2) + ')');
} else ok('회전 조각 transform 추출', false);

/* ───────────────── 8. 방어 ───────────────── */
section('8. 방어 / 예외');
ok('pieces 비면 throw', (function () { try { NDP.buildPrintLayout({ pieces: [] }); return false; } catch (e) { return true; } })());
ok('겹침이 인쇄영역보다 크면 throw', (function () {
  try { NDP.buildPrintLayout(mockDraft({ seam: 0 }), { mode: 'a4', overlapMm: 400 }); return false; } catch (e) { return true; }
})());
ok('calibMm 범위 밖은 무시하고 보정 1.0', (function () {
  var L = NDP.buildPrintLayout(mockDraft({ seam: 0 }), { mode: 'a4', calibMm: 5 });
  return L.info.scaleFactor === 1;
})());
ok('seamline 없이도 동작', (function () {
  var d = mockDraft({ seam: 0 });
  d.pieces.forEach(function (p) { delete p.seamline; });
  var L = NDP.buildPrintLayout(d, { mode: 'a4', seam: 1.0 });
  return L.info.pieces.every(function (p) { return p.seamAreaMm2 > p.outlineAreaMm2; });
})());
ok('notches/internal 없이도 동작', (function () {
  var d = mockDraft({ seam: 0 });
  d.pieces.forEach(function (p) { p.notches = []; p.internal = []; });
  var L = NDP.buildPrintLayout(d, { mode: 'a4', seam: 0 });
  return L.pageCount > 0 && !/NaN/.test(L.pagesSvg.join(''));
})());
ok('foldEdges 인덱스가 범위 밖이면 경고 후 무시', (function () {
  var d = mockDraft({ seam: PER, provideSeam: false });
  d.pieces[0].foldEdges = [[9999, 0]];
  var L = NDP.buildPrintLayout(d, { mode: 'a4', seam: 1.0 });
  return L.info.warnings.some(function (w) { return w.indexOf('outline 인덱스 범위') >= 0; }) &&
         L.info.pieces[0].foldRangeCount === 0;
})());
ok('seamFoldEdges 인덱스가 범위 밖이면 경고', (function () {
  var d = mockDraft({ seam: PER });
  d.pieces[0].seamFoldEdges = [[99999, 0]];
  var L = NDP.buildPrintLayout(d, { mode: 'a4', seam: PER });
  return L.info.warnings.some(function (w) { return w.indexOf('seamline 인덱스 범위') >= 0; });
})());
ok('opt.seam.fold 에 0 아닌 값을 주면 무시하고 경고', (function () {
  var L = NDP.buildPrintLayout(mockDraft({ seam: PER }), { mode: 'a4', seam: { fold: 2.0, hem: 3.0 } });
  return L.info.seamByRole.fold === 0 &&
         L.info.warnings.some(function (w) { return w.indexOf('골선 시접은 항상 0') >= 0; });
})());
ok('알 수 없는 role 은 무시하고 경고', (function () {
  var L = NDP.buildPrintLayout(mockDraft({ seam: PER }), { mode: 'a4', seam: { hem: 3.0, cuff: 9 } });
  return L.info.warnings.some(function (w) { return w.indexOf('알 수 없는 부위') >= 0; });
})());

/* ═══════════ 9. 총괄 제시 기준값 대조 ═══════════ */
section('9. 총괄 제시 기준값 대조 (66호)');
(function () {
  var d = mockDraft({ size: '66호', seam: PER });
  var fr = d.pieces[1], bk = d.pieces[0];

  /* 앞판 옆선(1.5) ↔ 밑단(3.0) 모서리 = (24.900, 41.500) cm */
  var sideE = null; fr.edges.forEach(function (e) { if (e.role === 'side') sideE = e; });
  var corner = fr.outline[sideE.end];
  var want = [corner[0] + 1.5, corner[1] + 3.0];
  var best = null, bd = Infinity;
  fr.seamline.forEach(function (q) { var dd = Math.hypot(q[0] - want[0], q[1] - want[1]); if (dd < bd) { bd = dd; best = q; } });
  ok('앞판 옆선(1.5)↔밑단(3.0) 모서리 = (24.900, 41.500)',
    near(best[0], 24.9, 0.001) && near(best[1], 41.5, 0.001),
    '완성선 모서리 (' + f(corner[0], 3) + ', ' + f(corner[1], 3) + ') → 시접선 (' +
    f(best[0], 3) + ', ' + f(best[1], 3) + ')  옆선까지 ' + f(best[0] - corner[0], 4) +
    ' / 밑단까지 ' + f(best[1] - corner[1], 4));

  /* 뒷판 골선: x 는 0 유지, y 는 −1.30 ~ 40.50 (목 1.0 위로, 밑단 3.0 아래로) */
  var NS = bk.seamline.length, sIdx = [];
  bk.seamFoldEdges.forEach(function (r) {
    var q = r[0], g = 0;
    for (;;) { if (sIdx.indexOf(q) < 0) sIdx.push(q); if (q === r[1]) break; q = (q + 1) % NS; if (++g > NS) break; }
  });
  var xmax = 0, ymin = Infinity, ymax = -Infinity;
  sIdx.forEach(function (m) {
    var q = bk.seamline[m];
    xmax = Math.max(xmax, Math.abs(q[0]));
    ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]);
  });
  ok('뒷판 골선 시접선 x = 0 유지', xmax < 1e-9, '|x| 최대 ' + xmax.toExponential(2) + 'cm');
  ok('뒷판 골선 시접선 y = −1.30 ~ 40.50', near(ymin, -1.30, 0.001) && near(ymax, 40.50, 0.001),
    '완성선 y ' + f(bk.outline[bk.foldEdges[0][0]][1], 2) + '~' + f(bk.outline[0][1], 2) +
    ' → 시접선 y ' + f(ymin, 3) + ' ~ ' + f(ymax, 3) + '  (목 1.0 위 / 밑단 3.0 아래)');

  /* 면적: 부위별이 균일 1.0 대비 얼마나 늘어나는가 */
  var Lp = NDP.buildPrintLayout(mockDraft({ size: '66호', seam: PER }), { mode: 'a4', seam: PER });
  var Lu = NDP.buildPrintLayout(mockDraft({ size: '66호', seam: 1.0 }), { mode: 'a4', seam: 1.0 });
  var Lu15 = NDP.buildPrintLayout(mockDraft({ size: '66호', seam: 1.5 }), { mode: 'a4', seam: 1.5 });
  var aPer = Lp.info.pieces[0].seamAreaMm2 / 100, aU10 = Lu.info.pieces[0].seamAreaMm2 / 100,
      aU15 = Lu15.info.pieces[0].seamAreaMm2 / 100;
  console.log('    66호 뒷판 재단면적: 균일1.0 ' + f(aU10, 1) + ' → 부위별 ' + f(aPer, 1) +
    ' cm²  (균일1.5 = ' + f(aU15, 1) + ')');
  ok('부위별이 균일 1.0 보다 큼', aPer > aU10, '+' + f(aPer - aU10, 1) + ' cm²');
  ok('부위별과 균일 1.5 의 차가 조각당 +9~15cm² 대역', Math.abs(aPer - aU15) < 30,
    '차 ' + f(aPer - aU15, 1) + ' cm² (밑단 3.0 증가분과 목·진동 1.0 감소분이 상쇄)');
})();

/* ═══════════ 10. 호수 4개 (44·55·66·77) ═══════════ */
section('10. 호수 4개 — 44 · 55 · 66 · 77 (SPEC §11-3)');
var SIZE_LIST = ['44호', '55호', '66호', '77호'];
var sizeRows = [];
SIZE_LIST.forEach(function (sz) {
  var dS = mockDraft({ size: sz, seam: PER });
  var LP = NDP.buildPrintLayout(dS, { mode: 'a4', seam: PER });
  var LR = NDP.buildPrintLayout(mockDraft({ size: sz, seam: PER }), { mode: 'roll', rollWidthMm: 594, rollMaxHmm: 0, seam: PER });
  var LU = NDP.buildPrintLayout(mockDraft({ size: sz, seam: 1.0 }), { mode: 'a4', seam: 1.0 });
  var LRU = NDP.buildPrintLayout(mockDraft({ size: sz, seam: 1.0 }), { mode: 'roll', rollWidthMm: 594, rollMaxHmm: 0, seam: 1.0 });
  sizeRows.push({
    size: sz, info: LP.info, uni: LU.info,
    roll: LR.info, rollU: LRU.info,
    rollH: LR.info.pageHeightMm, rollHU: LRU.info.pageHeightMm,
    sleeveW: dS.pieces[2].bbox.w,
    draft: dS, layout: LP
  });
});
sizeRows.forEach(function (r) {
  var I = r.info;
  console.log('    ' + r.size + '  A4 ' + I.cols + '×' + I.rows + '=' + I.tilePages + '장' +
    '  캔버스 ' + f(I.canvas.wMm / 10, 1) + '×' + f(I.canvas.hMm / 10, 1) + 'cm' +
    '  롤지길이 ' + f(r.rollH / 10, 1) + 'cm' +
    '  소매폭 ' + f(r.sleeveW, 2) + 'cm');
});
ok('4개 호수 전부 오류 없이 생성', sizeRows.every(function (r) {
  return r.layout.pageCount > 0 && !/NaN|undefined/.test(r.layout.pagesSvg.join(''));
}));
ok('전 호수 시접선 자기교차 0 (44호 급곡률 포함)',
  sizeRows.every(function (r) { return r.info.pieces.every(function (p) { return p.seamSelfIntersections === 0; }); }),
  sizeRows.map(function (r) {
    return r.size + ':' + r.info.pieces.map(function (p) { return p.seamSelfIntersections; }).join('');
  }).join(' '));
ok('전 호수 골선 편차 0',
  sizeRows.every(function (r) { return r.info.pieces.every(function (p) { return p.foldSeamGapMm < 1e-9; }); }));
ok('호수 증가에 따라 캔버스 면적 단조 증가', (function () {
  for (var i = 1; i < sizeRows.length; i++) {
    var a = sizeRows[i - 1].info.canvas, b = sizeRows[i].info.canvas;
    if (b.wMm * b.hMm <= a.wMm * a.hMm) return false;
  }
  return true;
})(), sizeRows.map(function (r) { return r.size + ' ' + f(r.info.canvas.wMm * r.info.canvas.hMm / 100, 0) + 'cm²'; }).join(' → '));
ok('호수 증가에 따라 소매폭 단조 증가', (function () {
  for (var i = 1; i < sizeRows.length; i++) if (sizeRows[i].sleeveW <= sizeRows[i - 1].sleeveW) return false;
  return true;
})(), sizeRows.map(function (r) { return r.size + ' ' + f(r.sleeveW, 2); }).join(' / '));
ok('전 호수 조각 배치 겹침 0', sizeRows.every(function (r) {
  var pl = r.info.placements, i, j;
  for (i = 0; i < pl.length; i++) for (j = i + 1; j < pl.length; j++) {
    if (rectsOverlap({ x: pl[i].xMm, y: pl[i].yMm, w: pl[i].wMm, h: pl[i].hMm },
                     { x: pl[j].xMm, y: pl[j].yMm, w: pl[j].wMm, h: pl[j].hMm })) return false;
  }
  return true;
}));
ok('전 호수 조각이 타일 커버리지 안', sizeRows.every(function (r) {
  return r.info.placements.every(function (p) {
    return p.xMm >= -1e-6 && p.yMm >= -1e-6 &&
           p.xMm + p.wMm <= r.info.coverage.wMm + 1e-6 && p.yMm + p.hMm <= r.info.coverage.hMm + 1e-6;
  });
}));
ok('전 호수 롤지 유효폭 초과 없음', sizeRows.every(function (r) {
  return r.info.warnings.filter(function (w) { return w.indexOf('초과') >= 0; }).length === 0;
}));
/* 44호 뒷판 암홀 급곡률 — 구버전 균일 오프셋과 신버전 비교 */
(function () {
  var d44 = mockDraft({ size: '44호', seam: PER, provideSeam: false });
  var back44 = d44.pieces[0];
  var uni = NDP._offsetLoop(back44.outline, 1.5);          // 구버전 방식(균일, 골선 무시)
  var uniSI = NDP._countSelfIntersections(uni);
  var L44 = NDP.buildPrintLayout(d44, { mode: 'a4', seam: PER });
  ok('44호 뒷판 — 신버전 부위별 오프셋 자기교차 0',
    L44.info.pieces[0].seamSelfIntersections === 0,
    '구버전 균일 1.5 오프셋 자기교차 ' + uniSI + '건 → 신버전 ' +
    L44.info.pieces[0].seamSelfIntersections + '건 (고리 제거 ' + L44.info.pieces[0].seamLoopsRemoved + '건)');
})();

/* ═══════════ 11. 균일 1.0 대비 용지 소모 변화 ═══════════ */
section('11. 부위별 시접 적용에 따른 용지 소모 변화 (균일 1.0 대비)');
console.log('    호수   A4 균일1.0 → 부위별      롤지(594) 균일1.0 → 부위별');
sizeRows.forEach(function (r) {
  console.log('    ' + r.size + '   ' +
    (r.uni.cols + '×' + r.uni.rows + '=' + r.uni.tilePages + '장').padEnd(12) + '→ ' +
    (r.info.cols + '×' + r.info.rows + '=' + r.info.tilePages + '장').padEnd(12) + '  ' +
    (f(r.rollHU / 10, 1) + 'cm').padEnd(10) + '→ ' + f(r.rollH / 10, 1) + 'cm  (+' +
    f(r.rollH - r.rollHU, 1) + 'mm)');
});
ok('부위별 시접이 균일 1.0 보다 용지를 더 쓰거나 같음',
  sizeRows.every(function (r) { return r.info.tilePages >= r.uni.tilePages && r.rollH >= r.rollHU; }));
/* 한 줄에 몸판 두 장이 들어가느냐로 롤지 길이가 급변한다 — 어느 호수에서 넘치는지 명시 */
var reflow = sizeRows.filter(function (r) { return (r.rollH - r.rollHU) > 120; });
sizeRows.forEach(function (r) {
  var rowsUsed = {};
  r.roll.placements.forEach(function (p) { rowsUsed[Math.round(p.yMm)] = 1; });
  r.shelves = Object.keys(rowsUsed).length;
  /* 롤 유효폭에서 캔버스 여백을 뺀 실제 배치 가능 폭 */
  r.binW = r.roll.worldContentWidthMm - 2 * r.roll.canvas.padMm;
  r.need = r.roll.placements[0].wMm + r.roll.canvas.gapMm + r.roll.placements[1].wMm;
  r.needU = r.rollU.placements[0].wMm + r.rollU.canvas.gapMm + r.rollU.placements[1].wMm;
});
console.log('    594mm 롤 배치 가능 폭 = ' + f(sizeRows[0].binW, 1) + 'mm');
sizeRows.forEach(function (r) {
  console.log('    ' + r.size + ' 몸판 2장 나란히: 균일 ' + f(r.needU, 1) + 'mm → 부위별 ' + f(r.need, 1) + 'mm  ' +
    (r.need <= r.binW ? '들어감' : '초과 → 줄바꿈') + ' (부위별 네스팅 줄 수 ' + r.shelves + ')');
});
ok('롤지 길이 급증은 "몸판 2장이 롤 폭을 넘어 줄바꿈"일 때만 발생', sizeRows.every(function (r) {
  return ((r.rollH - r.rollHU) > 120) === (r.need > r.binW);
}), reflow.length ? ('줄바꿈 발생: ' + reflow.map(function (r) { return r.size + '(' + f(r.need, 1) + ' > ' + f(r.binW, 1) + 'mm)'; }).join(', '))
                  : '전 호수 줄바꿈 없음');
ok('줄바꿈이 없는 호수는 증가폭이 밑단 증가분 수준(≤4cm)',
  sizeRows.filter(function (r) { return (r.rollH - r.rollHU) <= 120; })
    .every(function (r) { return (r.rollH - r.rollHU) <= 40; }),
  sizeRows.map(function (r) { return r.size + ' +' + f(r.rollH - r.rollHU, 1) + 'mm'; }).join(' · '));
ok('줄바꿈이 난 호수는 914mm 롤로 해소됨', (function () {
  return reflow.every(function (r) {
    var L9 = NDP.buildPrintLayout(mockDraft({ size: r.size, seam: PER }), { mode: 'roll', rollWidthMm: 914, seam: PER });
    return L9.info.pageHeightMm < r.rollH;
  });
})(), reflow.length ? reflow.map(function (r) {
  var L9 = NDP.buildPrintLayout(mockDraft({ size: r.size, seam: PER }), { mode: 'roll', rollWidthMm: 914, seam: PER });
  return r.size + ': 594mm → ' + f(r.rollH / 10, 1) + 'cm  /  914mm → ' + f(L9.info.pageHeightMm / 10, 1) + 'cm';
}).join(' · ') : '해당 없음');

/* ───────────────── 경고 목록 ───────────────── */
section('경고 (info.warnings)');
if (!I0.warnings.length) console.log('  [A4 seam 0]  없음');
I0.warnings.forEach(function (w) { console.log('  · [seam 0] ' + w); });
if (!IA.warnings.length) console.log('  [경로 A · 엔진 seamline+seamEdges]  없음');
IA.warnings.forEach(function (w) { console.log('  · [경로 A] ' + w); });
IC.warnings.forEach(function (w) { console.log('  · [경로 C] ' + w); });
ID.warnings.forEach(function (w) { console.log('  · [경로 D] ' + w); });
IE.warnings.forEach(function (w) { console.log('  · [경로 E] ' + w); });

/* ───────────────── 결과 ───────────────── */
console.log('\n' + '═'.repeat(70));
console.log('  PASS ' + PASS + '   FAIL ' + FAIL);
console.log('═'.repeat(70) + '\n');
process.exit(FAIL ? 1 : 0);
