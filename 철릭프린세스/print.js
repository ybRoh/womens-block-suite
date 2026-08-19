/* ============================================================================
 * print.js — 철릭 프린세스(문화식) 1:1 출력 레이아웃 엔진
 * 출력팀 / SPEC.md §6 · §8 준수
 *
 * 노출:  window.NoDartPrint.buildPrintLayout(draft, opt)
 *
 * 좌표 규약
 *   draft 입력 좌표 : cm  (SPEC §1)
 *   내부 계산       : mm  ("world mm") — cm × 10, 이 파일 안에서만 변환
 *   SVG user unit   : mm  ("declared mm") — 루트 svg 가 width="210mm"
 *                     viewBox="0 0 210 297" 이므로 1 user unit == 1 mm
 *   배율보정 k       : world → declared 로 갈 때 곱하는 값 (기본 1.0)
 *
 * 외부 라이브러리/CDN/ES module 사용 없음. 단일 HTML 인라인 통합 대상.
 * ==========================================================================*/
;(function (global) {
'use strict';

var VERSION = '1.0.0';

/* A4 세로 실치수 (mm) */
var A4_W = 210, A4_H = 297;

/* buildPrintLayout 호출마다 증가 — SVG 내부 id 충돌 방지
   (여러 svg 가 같은 HTML 문서에 들어가므로 id 는 문서 전역에서 유일해야 함) */
var UID = 0;

/* ── 기본 옵션 ─────────────────────────────────────────────────────────── */
var DEFAULTS = {
  mode: 'a4',            // 'a4' | 'roll'
  rollWidthMm: 594,      // A1 폭 594 고정 (UI 는 A1 만 제공). 넘치면 pack() 이 줄바꿈
  overlapMm: 10,         // A4 타일 겹침 (world mm)
  seam: 0,               // 시접: 숫자(균일 cm) | 0 | {role: cm} 부위별 — SPEC §11-1
  seamLabels: true,      // 시접선 위에 부위별 폭 병기 (공간 되는 구간만)

  marginMm: 8,           // A4 좌·우·상 여백 (프린터 비인쇄 영역 회피)
  footerMm: 16,          // A4 하단 정보띠(캘리브레이션 눈금·페이지좌표)
  gapMm: 6,              // 네스팅 조각 간격 (world mm) — 종이 낭비를 줄이려 12 → 6
  padMm: 4,              // 네스팅 캔버스 바깥 여백 (world mm)
  calibMm: 50,           // 지난 인쇄에서 5cm 눈금을 자로 잰 값(mm). 50 이면 보정 없음
  grid: 'major',         // false | 'major'(5cm) | 'full'(1cm+5cm)
  allowRotate: true,     // 네스팅 시 90° 회전 허용
  overview: true,        // A4 모드 1페이지에 전체배치 축소도 + 사용법
  maxCols: 8,            // 네스팅 후보 열 수 탐색 상한
  title: '',             // 페이지 머리말(호수·치수 요약 등)
  pieces: null,          // 인쇄할 조각 — null/빈 배열이면 전부. [id…] 이면 그 조각만 (SPEC §17-1)
  stamp: '',             // 앱 버전·빌드시각. 종이에 찍어 어느 판으로 뽑았는지 남긴다 (SPEC §17-2)
  rollMarginMm: 15,      // 롤지 상하좌우 여백
  rollFitWidth: true,    // 롤지 페이지를 배치 크기로 줄인다
  rollMaxHmm: 0          // 롤지 한 장의 최대 길이(mm). 0 = 연속 롤(안 나눔) — 기본.
                         //   나누면 장마다 길이를 가장 긴 장에 맞춰 통일해서 종이가 크게 남는다.
                         // 0 이면 제한 없음 — 프린터가 받는 최대 길이로 두세요.
};

/* ── 부위별 시접 (SPEC §11-1) ─────────────────────────────────────────── */
var SEAM_DEFAULTS = {
  neck: 1.0, shoulder: 1.0, armhole: 1.0,
  side: 1.5, hem: 3.0, sleeveHem: 3.0, dart: 1.5, fold: 0
};
var ROLE_KO = {
  neck: '목', shoulder: '어깨', armhole: '진동',
  side: '옆선', hem: '밑단', sleeveHem: '소매 밑단', dart: '다트', fold: '골선'
};
var ROLE_ORDER = ['neck', 'shoulder', 'armhole', 'side', 'hem', 'sleeveHem', 'dart', 'fold'];
var MITER_LIMIT = 3.0;      // 볼록 모서리 교점이 이보다 멀면 bevel

/* ── 색/선 규약 (스킬 색 약속: 검정=패턴, 파랑=치수/보조정보, 회색=인쇄보조) ── */
var INK      = '#111111';   // 완성선·시접선
var INK_SOFT = '#555555';   // 조각 라벨
var BLUE     = '#1a4f9c';   // 식서·치수/계산식
var GUIDE    = '#7d8794';   // 기초선(BL, 품선 등)
var REG      = '#8a8a8a';   // 정합마크·페이지테두리
var GRIDMIN  = '#c9d4e2';
var GRIDMAJ  = '#95a9c2';

/* =========================================================================
 * 0. 유틸
 * =======================================================================*/
function n(v, d) {
  if (typeof v !== 'number' || !isFinite(v)) return '0';
  var s = v.toFixed(d === undefined ? 3 : d);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return (s === '-0') ? '0' : s;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* 컬럼 라벨: 0→A, 25→Z, 26→AA */
function colLabel(i) {
  var s = '';
  i = i | 0;
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
  return s;
}

/* cm 좌표 배열 → mm 좌표 배열 */
function toMM(pts) {
  var out = [], i;
  for (i = 0; i < pts.length; i++) out.push([pts[i][0] * 10, pts[i][1] * 10]);
  return out;
}

/* 폐곡선 정리: 중복점/끝=시작 제거 */
function cleanLoop(pts) {
  var out = [], i, p, q;
  if (!pts || !pts.length) return out;
  for (i = 0; i < pts.length; i++) {
    p = pts[i];
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
    q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) continue;
    out.push([p[0], p[1]]);
  }
  while (out.length > 1) {
    var a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) out.pop(); else break;
  }
  return out;
}

function bboxOf(pts) {
  var i, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (i = 0; i < pts.length; i++) {
    if (pts[i][0] < x0) x0 = pts[i][0];
    if (pts[i][1] < y0) y0 = pts[i][1];
    if (pts[i][0] > x1) x1 = pts[i][0];
    if (pts[i][1] > y1) y1 = pts[i][1];
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function bboxUnion(a, b) {
  if (!a) return b; if (!b) return a;
  var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  var x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function segDistTo(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1];
  var L2 = vx * vx + vy * vy;
  var t = L2 > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}
/** 열린 폴리라인까지의 최단거리 */
function distToPolyline(p, pts) {
  var m = Infinity, i;
  if (!pts || pts.length === 0) return m;
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  for (i = 0; i < pts.length - 1; i++) m = Math.min(m, segDistTo(p, pts[i], pts[i + 1]));
  return m;
}
/** 닫힌 폐곡선까지의 최단거리 */
function distToPoly(p, pts) {
  var m = Infinity, i, N = pts.length;
  for (i = 0; i < N; i++) m = Math.min(m, segDistTo(p, pts[i], pts[(i + 1) % N]));
  return m;
}
/** 점 → 무한직선(ab) 수직거리 */
function distPointLine(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1], L = Math.hypot(vx, vy);
  if (L < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * vy - (p[1] - a[1]) * vx) / L;
}
/**
 * 골선 이탈량 — 시접선의 골선 구간이 완성선 골선에서 옆으로 벗어난 최대거리.
 * 골선 끝점은 이웃 변의 시접만큼 "골선을 따라 연장"되는 것이 정상이므로
 * (SPEC §11-1) 유한 폴리라인 거리가 아니라 **골선 직선까지의 수직거리**로 잰다.
 */
function foldDeviation(seamPts, seamFoldMask, foldRanges, outline) {
  if (!foldRanges || !foldRanges.length || !seamFoldMask) return 0;
  var lines = [], i, j, k;
  for (i = 0; i < foldRanges.length; i++) {
    var poly = [];
    for (j = 0; j < foldRanges[i].length; j++) poly.push(outline[foldRanges[i][j]]);
    if (poly.length < 2) continue;
    var a = poly[0], b = poly[poly.length - 1];
    var straight = Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9;
    if (straight) {
      for (k = 0; k < poly.length; k++) if (distPointLine(poly[k], a, b) > 0.05) { straight = false; break; }
    }
    lines.push({ poly: poly, a: a, b: b, straight: straight });
  }
  var worst = 0;
  for (i = 0; i < seamPts.length; i++) {
    if (!seamFoldMask[i]) continue;
    var best = Infinity;
    for (j = 0; j < lines.length; j++) {
      var d = lines[j].straight ? distPointLine(seamPts[i], lines[j].a, lines[j].b)
                                : distToPolyline(seamPts[i], lines[j].poly);
      if (d < best) best = d;
    }
    if (isFinite(best) && best > worst) worst = best;
  }
  return worst;
}
function polyArea(pts) {
  var a = 0, i, N = pts.length, p, q;
  for (i = 0; i < N; i++) { p = pts[i]; q = pts[(i + 1) % N]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
function sameLoop(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > 0.05 || Math.abs(a[i][1] - b[i][1]) > 0.05) return false;
  }
  return true;
}

/* 닫힌 루프 바깥쪽 오프셋(시접). 항상 면적이 커지는 쪽으로.
   ㄱ자 꺾임은 마이터 클램프. 조각 전체 루프에만 적용할 것(pitfalls #7).
   dIn 은 스칼라 또는 정점별 배열 — 골선 정점에 0 을 넣으면 그 구간은 시접이 붙지 않는다. */
function offsetLoopSigned(pts, dIn) {
  var N = pts.length, out = [], i;
  var scalar = (typeof dIn === 'number');
  for (i = 0; i < N; i++) {
    var d = scalar ? dIn : dIn[i];
    var p  = pts[i];
    var pv = pts[(i - 1 + N) % N];
    var nx = pts[(i + 1) % N];
    var e1 = [p[0] - pv[0], p[1] - pv[1]], l1 = Math.hypot(e1[0], e1[1]);
    var e2 = [nx[0] - p[0], nx[1] - p[1]], l2 = Math.hypot(e2[0], e2[1]);
    if (l1 < 1e-12) { e1 = e2; l1 = l2; }
    if (l2 < 1e-12) { e2 = e1; l2 = l1; }
    if (l1 < 1e-12) { out.push([p[0], p[1]]); continue; }
    e1 = [e1[0] / l1, e1[1] / l1];
    e2 = [e2[0] / l2, e2[1] / l2];
    var n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    var dot = n1[0] * n2[0] + n1[1] * n2[1];
    var m = [n1[0] + n2[0], n1[1] + n2[1]];
    var den = 1 + dot;
    var v;
    if (den < 1e-6) {                       // 180° 되꺾임 → 단순 법선
      v = [n1[0], n1[1]];
    } else {
      v = [m[0] / den, m[1] / den];
      var vl = Math.hypot(v[0], v[1]);
      if (vl > 4) { v = [v[0] / vl * 4, v[1] / vl * 4]; }   // 마이터 클램프
    }
    out.push([p[0] + v[0] * d, p[1] + v[1] * d]);
  }
  return out;
}
function offsetLoop(pts, dist) {
  if (!pts || pts.length < 3) return pts ? pts.slice() : [];
  var scalar = (typeof dist === 'number');
  if (scalar ? !(dist > 0) : !dist.length) return pts.slice();
  var neg = scalar ? -dist : dist.map(function (v) { return -v; });
  var A = offsetLoopSigned(pts, dist);
  var B = offsetLoopSigned(pts, neg);
  var aA = Math.abs(polyArea(A)), aB = Math.abs(polyArea(B));
  return (aA >= aB) ? A : B;   // 면적이 커지는 쪽이 바깥
}

/* ── 변(edge)마다 폭이 다른 오프셋 — SPEC §11-1 핵심 ──────────────────────
   각 변을 자기 폭만큼 평행이동한 뒤, 이웃한 두 오프셋 직선의 **교점**으로 잇는다.
   교점이 지나치게 멀면(miter limit 초과) bevel 로 자른다.
   폭 0인 골선과 폭 있는 변이 만나면 교점이 골선 위로 떨어져
   "골선을 유지한 채 시접 폭만큼 연장"이 자동으로 성립한다.
   dEdge[i] = 정점 i → i+1 변의 시접 폭. 반환 점에는 srcEdge(원본 변 인덱스)가 붙는다. */
function offsetVarSigned(pts, dEdge, sign) {
  var N = pts.length, i;
  var A = [], U = [], NRM = [];
  for (i = 0; i < N; i++) {
    var p = pts[i], q = pts[(i + 1) % N];
    var ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey);
    if (L < 1e-12) { A.push(null); U.push(null); NRM.push(null); continue; }
    var ux = ex / L, uy = ey / L, nx = uy, ny = -ux;
    var d = sign * (dEdge[i] || 0);
    A.push([p[0] + nx * d, p[1] + ny * d]);
    U.push([ux, uy]);
    NRM.push([nx * d, ny * d]);
  }
  var out = [];
  for (i = 0; i < N; i++) {
    var i0 = (i - 1 + N) % N;
    var a0 = A[i0], u0 = U[i0], a1 = A[i], u1 = U[i];
    if (!a0 && !a1) { out.push({ p: [pts[i][0], pts[i][1]], e: i, v: i }); continue; }
    if (!a0) { out.push({ p: [pts[i][0] + NRM[i][0], pts[i][1] + NRM[i][1]], e: i, v: i }); continue; }
    if (!a1) { out.push({ p: [pts[i][0] + NRM[i0][0], pts[i][1] + NRM[i0][1]], e: i0, v: i }); continue; }

    var cross = u0[0] * u1[1] - u0[1] * u1[0];
    var d0 = dEdge[i0] || 0, d1 = dEdge[i] || 0;
    var pt = null;
    if (Math.abs(cross) > 1e-9) {
      var wx = a1[0] - a0[0], wy = a1[1] - a0[1];
      var t = (wx * u1[1] - wy * u1[0]) / cross;
      pt = [a0[0] + u0[0] * t, a0[1] + u0[1] * t];
    } else if (Math.abs(d0 - d1) < 1e-9) {
      /* 두 변이 일직선(=오프셋선이 같은 직선)이고 폭도 같다 → 점 하나로 충분.
         여기서 bevel 로 빠지면 같은 자리에 점이 두 개 생겨 구간 인덱스가 부풀어
         seamEdges/seamFoldEdges 가 실제보다 넓게 잡힌다. */
      out.push({ p: [pts[i][0] + NRM[i][0], pts[i][1] + NRM[i][1]], e: i, v: i });
      continue;
    }
    /* 일직선인데 폭이 다르면(계단) bevel 이 정답 */
    var dref = Math.max(Math.abs(d0), Math.abs(d1));
    var far = pt ? Math.hypot(pt[0] - pts[i][0], pt[1] - pts[i][1]) : Infinity;
    if (!pt || (dref > 1e-9 && far > MITER_LIMIT * dref) || (dref <= 1e-9 && far > 1e-6)) {
      /* bevel — 두 오프셋선 끝점을 그대로 잇는다 */
      out.push({ p: [pts[i][0] + NRM[i0][0], pts[i][1] + NRM[i0][1]], e: i0, v: i });
      out.push({ p: [pts[i][0] + NRM[i][0],  pts[i][1] + NRM[i][1]],  e: i,  v: i });
    } else {
      out.push({ p: pt, e: i, v: i });
    }
  }
  return out;
}

/* 선분 교차 (끝점 공유 제외) */
function segInt(p1, p2, p3, p4) {
  var d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  var d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  var den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  var t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  var u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { t: t, u: u, p: [p1[0] + d1x * t, p1[1] + d1y * t] };
}
function countSelfIntersections(pts) {
  var N = pts.length, c = 0, i, j;
  for (i = 0; i < N; i++) {
    for (j = i + 2; j < N; j++) {
      if (i === 0 && j === N - 1) continue;
      if (segInt(pts[i], pts[(i + 1) % N], pts[j], pts[(j + 1) % N])) c++;
    }
  }
  return c;
}
/* 오목 모서리에서 생긴 국소 고리 제거: 가까운 인덱스끼리의 교차를 찾아
   사이 구간을 교점 하나로 접는다. */
function removeLocalLoops(pts, window) {
  var W = window || 30, guard = 0;
  for (;;) {
    var N = pts.length, found = null, i, j;
    for (i = 0; i < N && !found; i++) {
      for (j = i + 2; j <= i + W && j < N; j++) {
        if (i === 0 && j === N - 1) continue;
        var X = segInt(pts[i], pts[i + 1], pts[j], pts[(j + 1) % N]);
        if (X) { found = { i: i, j: j, p: X.p }; break; }
      }
    }
    if (!found || ++guard > 200) break;
    pts = pts.slice(0, found.i + 1).concat([found.p], pts.slice(found.j + 1));
    if (pts.length < 4) break;
  }
  return pts;
}

/**
 * 부위별 폭 오프셋. 항상 면적이 커지는(바깥) 쪽을 고른다.
 * @returns {{pts:Array, srcEdge:Array, loopsRemoved:number, selfInt:number}}
 */
function offsetLoopVarWidth(pts, dEdge) {
  var A = offsetVarSigned(pts, dEdge, +1);
  var B = offsetVarSigned(pts, dEdge, -1);
  var pa = A.map(function (o) { return o.p; }), pb = B.map(function (o) { return o.p; });
  var pick = (Math.abs(polyArea(pa)) >= Math.abs(polyArea(pb))) ? A : B;
  var raw = pick.map(function (o) { return o.p; });
  var before = countSelfIntersections(raw);
  var cleaned = before ? removeLocalLoops(raw) : raw;
  var after = countSelfIntersections(cleaned);
  return {
    pts: cleaned,
    /* 고리 제거로 점이 바뀌면 인덱스 대응이 깨지므로 그때는 srcEdge 를 버린다 */
    srcEdge: (cleaned.length === raw.length) ? pick.map(function (o) { return o.e; }) : null,
    srcVert: (cleaned.length === raw.length) ? pick.map(function (o) { return o.v; }) : null,
    loopsRemoved: before - after,
    selfInt: after
  };
}

/** opt.seam 정규화 — 숫자 | 0 | {role:cm} 모두 받아 role 맵으로. SPEC §11-1 */
function normalizeSeamOpt(seam, warn) {
  var byRole = {}, k, mode;
  if (seam && typeof seam === 'object') {
    mode = 'perRole';
    for (k in SEAM_DEFAULTS) if (SEAM_DEFAULTS.hasOwnProperty(k)) byRole[k] = SEAM_DEFAULTS[k];
    for (k in seam) {
      if (!seam.hasOwnProperty(k)) continue;
      if (!SEAM_DEFAULTS.hasOwnProperty(k)) { warn.push('opt.seam 에 알 수 없는 부위 "' + k + '" — 무시'); continue; }
      var v = +seam[k];
      if (!isFinite(v) || v < 0) { warn.push('opt.seam.' + k + ' 값이 잘못됨(' + seam[k] + ') — 기본값 사용'); continue; }
      byRole[k] = v;
    }
    if (+seam.fold) warn.push('opt.seam.fold = ' + seam.fold + ' → 골선 시접은 항상 0 이므로 무시합니다 (SPEC §11-1)');
  } else {
    var num = +seam || 0;
    mode = (num > 0) ? 'uniform' : 'none';
    for (k in SEAM_DEFAULTS) if (SEAM_DEFAULTS.hasOwnProperty(k)) byRole[k] = num;
  }
  byRole.fold = 0;                                   // 항상 0 강제
  var max = 0;
  for (k in byRole) if (byRole[k] > max) max = byRole[k];
  return { byRole: byRole, mode: mode, maxCm: max };
}

/** "목 1.0 · 어깨 1.0 · 진동 1.0 · 옆선 1.5 · 밑단 3.0" */
function seamSummary(byRole, rolesUsed) {
  var out = [], i, r;
  for (i = 0; i < ROLE_ORDER.length; i++) {
    r = ROLE_ORDER[i];
    if (r === 'fold') continue;
    if (rolesUsed && rolesUsed.indexOf(r) < 0) continue;
    if (!rolesUsed && !(byRole[r] > 0)) continue;
    out.push(ROLE_KO[r] + ' ' + n(byRole[r], 2));
  }
  if (!out.length) return '시접 없음';
  return out.join(' · ');
}

/* 정점 마스크 → 그릴 변(edge) 목록으로 나눠 열린 path 문자열 배열을 만든다.
   edgeDrawn[i] = 정점 i → i+1 변을 그릴지. 전부 그리면 닫힌 path 하나. */
function pathRuns(pts, edgeDrawn) {
  var N = pts.length, i, all = true;
  for (i = 0; i < N; i++) if (!edgeDrawn[i]) { all = false; break; }
  if (all) return [pathFrom(pts, true)];
  var start = -1;
  for (i = 0; i < N; i++) if (edgeDrawn[i] && !edgeDrawn[(i - 1 + N) % N]) { start = i; break; }
  if (start < 0) return [];
  var out = [], run = null, j = start, cnt = 0;
  while (cnt < N) {
    if (edgeDrawn[j]) {
      if (!run) run = [pts[j]];
      run.push(pts[(j + 1) % N]);
    } else if (run) { out.push(pathFrom(run, false)); run = null; }
    j = (j + 1) % N; cnt++;
  }
  if (run) out.push(pathFrom(run, false));
  return out;
}

function pathFrom(pts, close) {
  if (!pts || !pts.length) return '';
  var d = 'M ' + n(pts[0][0], 3) + ' ' + n(pts[0][1], 3), i;
  for (i = 1; i < pts.length; i++) d += ' L ' + n(pts[i][0], 3) + ' ' + n(pts[i][1], 3);
  if (close) d += ' Z';
  return d;
}

/* =========================================================================
 * 1. Draft 정규화 (cm → world mm)
 * =======================================================================*/
/* [start,end] 범위(양끝 포함, end<start 면 wrap)를 인덱스 배열로 */
function rangeIdx(a, b, N) {
  var out = [], i = a;
  if (a < 0 || a >= N || b < 0 || b >= N) return null;
  for (;;) { out.push(i); if (i === b) break; i = (i + 1) % N; if (out.length > N) return null; }
  return out;
}

/* ── 조각별 인쇄 선택 (SPEC §17-1) ─────────────────────────────────────
   o.pieces 가 비어 있지 않은 배열이면 그 안에 든 조각만 인쇄한다.
   id 를 먼저 보고, id 가 없는 조각은 name 으로 맞춘다.
   비었거나 배열이 아니면 전부 인쇄 — 옵션을 안 준 기존 호출과 동작이 같다.
   ⚠ 걸러내기는 normalizePieces 루프 첫머리에서 해야 한다. 그래야 배치(pack)·
     개요 축소도·페이지 수·info.pieces 가 전부 걸러진 배열 기준으로 따라온다. */
function wantPiece(want, p) {
  if (!want || !want.length || typeof want.length !== 'number') return true;
  var id = (p && p.id != null) ? String(p.id) : '';
  var nm = (p && p.name != null) ? String(p.name) : '';
  for (var q = 0; q < want.length; q++) {
    var w = String(want[q]);
    if (w && (w === id || w === nm)) return true;
  }
  return false;
}

/** 계산식 주석 하나가 **종이에 찍을 수 있는 모양**인가.
 *  ⚠ `if (!n.anchor)` 로는 못 거른다 — **문자열도 통과한다.**
 *    `String.prototype.anchor` 가 레거시 메서드라 `'글자'.anchor` 가 함수이고,
 *    그 뒤 `n.anchor[0] * 10` 이 NaN 이 되어 종이에 「undefined  undefined = 0」이
 *    9장 찍혔다 (2026-08-18 · print-verify 의 「출력 문자열 위생」이 잡았다).
 *    formulaNotes 를 **문자열 배열**로 넘기는 모듈이 실제로 있다. */
function isDrawableNote(n) {
  return !!n && typeof n === 'object' && !Array.isArray(n) &&
         Array.isArray(n.anchor) && n.anchor.length >= 2 &&
         isFinite(n.anchor[0]) && isFinite(n.anchor[1]);
}
/** 조각에 딸린 계산식 주석 (draft.meta.formulaNotes) — cm → world mm.
 *  못 그릴 주석은 **버리고 경고**한다 — 종이에 undefined 를 찍느니 빠지는 게 낫다. */
function dimsOf(draft, pieceId, warn) {
  var src = (draft && draft.meta && draft.meta.formulaNotes) || [], out = [], skipped = 0;
  for (var i = 0; i < src.length; i++) {
    var n = src[i];
    if (!isDrawableNote(n)) { skipped++; continue; }
    if (n.piece && n.piece !== 'both' && n.piece !== pieceId) continue;
    if (n.piece === 'both') continue;          // 조각 공통값은 하단 정보띠에 이미 나간다
    out.push({ id: n.id, label: n.label, formula: n.formula, value: n.value,
               at: [n.anchor[0] * 10, n.anchor[1] * 10] });
  }
  /* 조각마다 불리므로 **같은 경고를 한 번만** 남긴다 */
  if (skipped && warn) {
    var msg = '계산식 주석 ' + skipped + '개가 anchor 없는 모양이라 건너뜀 ' +
      '(draft.meta.formulaNotes 는 {label, formula, value, anchor:[x,y], piece} 객체여야 합니다)';
    if (warn.indexOf(msg) < 0) warn.push(msg);
  }
  return out;
}

function normalizePieces(draft, o, warn) {
  var SEAM = o._seam;                    // normalizeSeamOpt 결과
  var pieces = [], i;
  var src = (draft && draft.pieces) || [];

  for (i = 0; i < src.length; i++) {
    var p = src[i] || {};
    if (!wantPiece(o.pieces, p)) continue;              // 조각별 인쇄 선택 (SPEC §17-1)
    var outlineCm = cleanLoop(p.outline || []);
    if (outlineCm.length < 3) { warn.push('조각 #' + i + '(' + (p.name || p.id || '?') + ') outline 점이 3개 미만 — 건너뜀'); continue; }
    var outline = toMM(outlineCm);

    var NP = outline.length;
    var pname = p.name || p.id || ('조각' + (i + 1));

    /* ── 골선(CB·CF) 구간: SPEC §8.1 piece.foldEdges = [[startIdx, endIdx], ...]
       outline 인덱스 범위(양끝 포함). endIdx < startIdx 이면 0 을 지나 되감긴다.
       골선에는 시접이 붙지 않는다. ─────────────────────────────────────── */
    var foldMask = [], foldRanges = [];
    for (var fz = 0; fz < NP; fz++) foldMask.push(false);
    var srcFold = p.foldEdges || [];
    for (var fi = 0; fi < srcFold.length; fi++) {
      var fr = srcFold[fi];
      if (!fr || fr.length < 2) continue;
      var a0 = fr[0] | 0, b0 = fr[1] | 0;
      if (a0 < 0 || a0 >= NP || b0 < 0 || b0 >= NP) {
        warn.push('조각 "' + pname + '": foldEdges [' + fr + '] 가 outline 인덱스 범위(0~' + (NP - 1) + ') 밖 — 무시');
        continue;
      }
      var idxs = [], ii = a0;
      for (;;) { idxs.push(ii); if (ii === b0) break; ii = (ii + 1) % NP; if (idxs.length > NP) break; }
      for (var iz = 0; iz < idxs.length; iz++) foldMask[idxs[iz]] = true;
      foldRanges.push(idxs);
    }

    /* ── outline 변별 role (SPEC §11-1: piece.edges[] 에 role 추가됨) ────
       edges[] 는 **점(point) 범위**다. start..end 가 덮는 세그먼트는
       start→start+1 … end-1→end 이므로, 이웃한 두 변을 잇는 경계 세그먼트
       (앞 변의 끝점 → 다음 변의 시작점)는 어느 변에도 속하지 않는다.
       이건 엔진 결함이 아니라 자료구조의 성질이므로 경고하지 않고
       **직전 변의 시접**으로 귀속시킨다. 정말로 점이 빠졌을 때만 경고. */
    var edgeRole = [], rolesUsed = [], roleCovered = 0;
    var ptCovered = [];
    for (var er = 0; er < NP; er++) { edgeRole.push(null); ptCovered.push(false); }
    var srcEdges = p.edges || [];
    for (var ei = 0; ei < srcEdges.length; ei++) {
      var ed = srcEdges[ei] || {};
      var role = ed.role || null;
      if (!role || !SEAM_DEFAULTS.hasOwnProperty(role)) {
        if (role) warn.push('조각 "' + pname + '": edges[' + ei + '].role="' + role + '" 은 알 수 없는 부위 — 무시');
        continue;
      }
      if (rolesUsed.indexOf(role) < 0) rolesUsed.push(role);
      if (!isFinite(ed.start) || !isFinite(ed.end)) continue;
      var rIdx = rangeIdx(ed.start | 0, ed.end | 0, NP);
      if (!rIdx) { warn.push('조각 "' + pname + '": edges[' + ei + '] 인덱스 [' + ed.start + ',' + ed.end + '] 가 범위 밖 — 무시'); continue; }
      for (var rj = 0; rj < rIdx.length; rj++) {
        ptCovered[rIdx[rj]] = true;
        if (rj < rIdx.length - 1) { edgeRole[rIdx[rj]] = role; roleCovered++; }
      }
    }
    var hasEdgeRoles = roleCovered > 0;

    if (hasEdgeRoles) {
      /* 경계 세그먼트 귀속: 직전 변의 role.
         단 직전이 골선이면 다음 변을 쓴다 — 골선을 한 칸 늘리면 골선 판정이 흐려진다. */
      var firstRole = -1, zz;
      for (zz = 0; zz < NP; zz++) if (edgeRole[zz]) { firstRole = zz; break; }
      if (firstRole >= 0) {
        for (var st2 = 0; st2 < NP; st2++) {
          var z2 = (firstRole + st2) % NP;
          if (edgeRole[z2]) continue;
          var prevR2 = edgeRole[(z2 - 1 + NP) % NP];
          var nextR2 = null;
          for (var z3 = 1; z3 < NP; z3++) { var c3 = edgeRole[(z2 + z3) % NP]; if (c3) { nextR2 = c3; break; } }
          edgeRole[z2] = (prevR2 === 'fold') ? (nextR2 || prevR2) : (prevR2 || nextR2);
        }
      }
      /* 점 자체가 빠진 경우만 진짜 결손 */
      var missPts = 0;
      for (var mp = 0; mp < NP; mp++) if (!ptCovered[mp]) missPts++;
      if (missPts) {
        warn.push('조각 "' + pname + '": edges[] 가 outline 점 ' + missPts + '/' + NP +
                  '개를 덮지 않음 — 그 구간은 인접 변의 시접으로 처리');
      }
    }
    /* 골선 변은 role 이 없어도 fold 로 확정 */
    for (var fm = 0; fm < NP; fm++) if (foldMask[fm] && foldMask[(fm + 1) % NP]) edgeRole[fm] = 'fold';

    /* ── 시접선 ─────────────────────────────────────────────────────────
       T1 엔진 seamline + seamFoldEdges/seamEdges  (seamline 인덱스 기준)
       T2 엔진 seamline 만 → 골선 구간을 기하적으로(완성선과 겹치는 점) 판별
       T3 seamline 없음 → 부위별 폭 오프셋으로 자체 생성 */
    var seamline = null, seamSource = 'none', seamTier = '';
    var seamEdges = null, seamFoldMask = null, seamEdgeIsFold = null;
    var seamSelfInt = 0, seamLoopsRemoved = 0;
    var wantSeam = SEAM.maxCm > 1e-9;

    if (wantSeam) {
      var givenCm = cleanLoop(p.seamline || []);
      var given = givenCm.length > 2 ? toMM(givenCm) : null;

      if (given && !sameLoop(given, outline)) {
        seamline = given; seamSource = 'draft';
        var NS = seamline.length;
        seamFoldMask = []; for (var sz = 0; sz < NS; sz++) seamFoldMask.push(false);

        /* seamline 인덱스 기준 메타데이터 */
        var sfRanges = p.seamFoldEdges || null;
        if (!sfRanges && p.seamEdges) {
          sfRanges = [];
          for (var se = 0; se < p.seamEdges.length; se++) {
            var s1 = p.seamEdges[se];
            if (s1 && s1.role === 'fold' && isFinite(s1.start) && isFinite(s1.end)) sfRanges.push([s1.start, s1.end]);
          }
          if (!sfRanges.length) sfRanges = null;
        }
        if (p.seamEdges) {
          seamEdges = [];
          for (var se2 = 0; se2 < p.seamEdges.length; se2++) {
            var s2 = p.seamEdges[se2] || {};
            if (!isFinite(s2.start) || !isFinite(s2.end)) continue;
            seamEdges.push({
              role: s2.role || null,
              seamCm: isFinite(s2.seam) ? +s2.seam : (s2.role ? SEAM.byRole[s2.role] : null),
              start: s2.start | 0, end: s2.end | 0
            });
            if (s2.role && rolesUsed.indexOf(s2.role) < 0) rolesUsed.push(s2.role);
          }
        }

        if (sfRanges) {
          seamTier = 'T1(seamFoldEdges)';
          for (var sr = 0; sr < sfRanges.length; sr++) {
            var sIdx = rangeIdx(sfRanges[sr][0] | 0, sfRanges[sr][1] | 0, NS);
            if (!sIdx) { warn.push('조각 "' + pname + '": seamFoldEdges [' + sfRanges[sr] + '] 가 seamline 인덱스 범위(0~' + (NS - 1) + ') 밖 — 무시'); continue; }
            for (var sk = 0; sk < sIdx.length; sk++) seamFoldMask[sIdx[sk]] = true;
          }
        } else if (foldRanges.length) {
          /* T2 — 골선 점은 오프셋되지 않으므로 완성선 골선 폴리라인 위에 그대로 놓인다.
             인덱스 대응이 깨져도 기하로 찾을 수 있다. */
          seamTier = 'T2(기하 판별)';
          warn.push('조각 "' + pname + '": seamFoldEdges/seamEdges 가 없어 골선 구간을 기하적으로 판별했습니다 ' +
                    '(SPEC §11-1 에서 엔진이 seamline 기준 인덱스를 제공하기로 확정됨)');
          var foldPoly = [];
          for (var fp = 0; fp < foldRanges.length; fp++) {
            var seg = [];
            for (var fq = 0; fq < foldRanges[fp].length; fq++) seg.push(outline[foldRanges[fp][fq]]);
            foldPoly.push(seg);
          }
          for (var sm = 0; sm < NS; sm++) {
            for (var fpo = 0; fpo < foldPoly.length; fpo++) {
              if (distToPolyline(seamline[sm], foldPoly[fpo]) < 0.05) { seamFoldMask[sm] = true; break; }
            }
          }
        } else {
          seamTier = 'T2(골선 정보 없음)';
        }

        /* 골선 구간이 정말 골선 위에 있는지 검산 (끝점의 정상 연장은 이탈로 세지 않음) */
        var foldSeamGap = foldDeviation(seamline, seamFoldMask, foldRanges, outline);
        if (foldRanges.length && !seamFoldMask.some(function (v) { return v; })) {
          /* 엔진이 골선을 0 처리하지 않은 경우 */
          var probe = 0;
          for (var pz = 0; pz < foldRanges.length; pz++) {
            for (var pq = 0; pq < foldRanges[pz].length; pq++) {
              probe = Math.max(probe, distToPoly(outline[foldRanges[pz][pq]], seamline));
            }
          }
          foldSeamGap = probe;
          if (probe > 0.01) {
            warn.push('조각 "' + pname + '": 골선 구간의 seamline 이 outline 과 ' + probe.toFixed(3) +
                      'mm 어긋남 — 골선 시접은 0 이어야 합니다');
          }
        }
        seamSelfInt = countSelfIntersections(seamline);
        if (seamSelfInt) warn.push('조각 "' + pname + '": 엔진 seamline 에 자기교차 ' + seamSelfInt + '건');
        p._foldSeamGap = foldSeamGap;

      } else {
        /* ── T3 폴백: 부위별 폭으로 직접 오프셋 ── */
        seamSource = 'computed';
        var dEdge = [], usedMax = false;
        for (var de = 0; de < NP; de++) {
          var rl = edgeRole[de];
          if (rl) dEdge.push(SEAM.byRole[rl] * 10);
          else if (foldMask[de] && foldMask[(de + 1) % NP]) dEdge.push(0);
          else { dEdge.push(SEAM.maxCm * 10); usedMax = true; }
        }
        var res = offsetLoopVarWidth(outline, dEdge);
        seamline = res.pts;
        seamSelfInt = res.selfInt;
        seamLoopsRemoved = res.loopsRemoved;
        seamTier = hasEdgeRoles ? 'T3(edges[].role 로 부위별 오프셋)'
                                : (foldRanges.length ? 'T3(골선만 0, 나머지 최대폭)' : 'T3(전 둘레 균일)');
        warn.push('조각 "' + pname + '": draft.seamline 이 없거나 outline 과 동일 — print.js 가 ' + seamTier +
                  ' 로 자체 생성함' +
                  (usedMax && SEAM.mode === 'perRole'
                    ? ' ※ edges[].role 이 없어 부위별 폭을 구분하지 못하고 최대 ' + n(SEAM.maxCm, 2) + 'cm 를 적용했습니다'
                    : ''));
        if (seamSelfInt) warn.push('조각 "' + pname + '": 생성된 시접선에 자기교차 ' + seamSelfInt + '건 남음');

        /* 생성한 seamline 의 각 변이 어느 부위인지: 변 m(점 m→m+1)은
           outline 변 srcEdge[m] 의 오프셋 위에 놓인다. 단 같은 원본 정점에서
           나온 두 점 사이(=bevel 챔퍼)는 예외이며 앞 구간에 붙인다. */
        var NS3 = seamline.length;
        seamEdgeIsFold = [];
        var segRole = [];
        for (var sq = 0; sq < NS3; sq++) { seamEdgeIsFold.push(false); segRole.push(null); }
        if (res.srcEdge) {
          for (var sq2 = 0; sq2 < NS3; sq2++) {
            var nx2 = (sq2 + 1) % NS3;
            var chamfer = (res.srcVert[sq2] === res.srcVert[nx2]);
            var rl2 = edgeRole[res.srcEdge[sq2]];
            segRole[sq2] = chamfer ? null : rl2;
            seamEdgeIsFold[sq2] = (rl2 === 'fold') && !chamfer;
          }
          /* 챔퍼(폭이 바뀌는 모서리의 경사 구간)는 전이 구간이다.
             한쪽이 골선이면 절대 골선으로 넣지 않는다 — 넣으면 시접 폭만큼
             옆으로 나간 점이 "골선"으로 분류되어 골선 판정이 깨진다. */
          for (var sq4 = 0; sq4 < NS3; sq4++) {
            if (segRole[sq4]) continue;
            var prevR = segRole[(sq4 - 1 + NS3) % NS3];
            var nextR = null;
            for (var sq5 = 1; sq5 < NS3; sq5++) {
              var cand = segRole[(sq4 + sq5) % NS3];
              if (cand) { nextR = cand; break; }
            }
            segRole[sq4] = (prevR === 'fold') ? (nextR || prevR) : (prevR || nextR);
          }
          for (var sq6 = 0; sq6 < NS3; sq6++) seamEdgeIsFold[sq6] = (segRole[sq6] === 'fold');
          seamEdges = [];
          var curRole = segRole[0], curStart = 0;
          for (var sq3 = 1; sq3 <= NS3; sq3++) {
            var rr = segRole[sq3 % NS3];
            if (rr !== curRole || sq3 === NS3) {
              if (curRole) seamEdges.push({ role: curRole, seamCm: SEAM.byRole[curRole], start: curStart, end: sq3 % NS3 });
              curRole = rr; curStart = sq3 % NS3;
            }
          }
        } else {
          warn.push('조각 "' + pname + '": 시접선 자기교차 정리로 인덱스 대응이 깨져 부위별 병기를 생략합니다');
        }
        /* 생성한 것도 같은 잣대로 검산 */
        var sfm3 = [];
        for (var sm3 = 0; sm3 < NS3; sm3++) {
          sfm3.push(seamEdgeIsFold[sm3] || seamEdgeIsFold[(sm3 - 1 + NS3) % NS3]);
        }
        p._foldSeamGap = foldDeviation(seamline, sfm3, foldRanges, outline);
      }
    }
    var foldSeamGapOut = p._foldSeamGap || 0;

    /* T1/T2 는 점 마스크에서 변 마스크로 환산 (T3 는 위에서 직접 만듦) */
    if (seamline && !seamEdgeIsFold && seamFoldMask) {
      seamEdgeIsFold = [];
      for (var sf = 0; sf < seamline.length; sf++) {
        seamEdgeIsFold.push(!!(seamFoldMask[sf] && seamFoldMask[(sf + 1) % seamline.length]));
      }
    }

    var internal = [];
    var srcInt = p.internal || [];
    for (var j = 0; j < srcInt.length; j++) {
      var it = srcInt[j] || {};
      var ipts = (it.pts || []).filter(function (q) { return q && isFinite(q[0]) && isFinite(q[1]); });
      if (!ipts.length) continue;
      internal.push({ type: it.type || 'line', pts: toMM(ipts), label: it.label || '' });
    }

    var notches = [];
    var srcN = p.notches || [];
    var notchRoleGuessed = 0;
    for (var q2 = 0; q2 < srcN.length; q2++) {
      var nt = srcN[q2] || {};
      if (!nt.p || !isFinite(nt.p[0]) || !isFinite(nt.p[1])) continue;
      var ang = +nt.angle;
      if (!isFinite(ang)) ang = 0;
      /* SPEC §8.1 확정: angle 단위는 도(°). 0°=+x, 시계방향 +, 조각 안쪽 방향. */
      var rad = ang * Math.PI / 180;
      var np0 = [nt.p[0] * 10, nt.p[1] * 10];

      /* 너치가 놓인 변의 role → 그 부위의 시접폭만큼 바깥으로 뻗는다 (SPEC §11-1) */
      var nRole = (nt.role && SEAM_DEFAULTS.hasOwnProperty(nt.role)) ? nt.role : null;
      if (!nRole && hasEdgeRoles) {
        var bestD = Infinity, bestE = -1;
        for (var ne = 0; ne < NP; ne++) {
          var dd2 = segDistTo(np0, outline[ne], outline[(ne + 1) % NP]);
          if (dd2 < bestD) { bestD = dd2; bestE = ne; }
        }
        if (bestE >= 0 && edgeRole[bestE]) { nRole = edgeRole[bestE]; notchRoleGuessed++; }
      }
      var nSeamMm = (nRole ? SEAM.byRole[nRole] : SEAM.maxCm) * 10;
      notches.push({
        p: np0, deg: ang, rad: rad, label: nt.label || '',
        role: nRole, seamMm: nSeamMm
      });
    }
    if (!notches.length) warn.push('조각 "' + pname + '": notches 가 비어 있음 (SPEC §6.3 어깨점·옆선BL·목옆점 필요)');
    if (!hasEdgeRoles && notches.length && SEAM.mode === 'perRole') {
      warn.push('조각 "' + pname + '": edges[].role 이 없어 너치의 부위를 알 수 없습니다 — 최대 시접(' +
                n(SEAM.maxCm, 2) + 'cm) 길이로 그립니다');
    }

    var grain = null;
    if (p.grainline && p.grainline.length >= 2) grain = toMM(p.grainline);

    /* 실측 bbox (기하에서 직접) */
    var bbOutline = bboxOf(outline);
    var bb = bbOutline;
    if (seamline) bb = bboxUnion(bb, bboxOf(seamline));
    for (var k = 0; k < internal.length; k++) bb = bboxUnion(bb, bboxOf(internal[k].pts));
    if (grain) bb = bboxUnion(bb, bboxOf(grain));
    for (var k2 = 0; k2 < notches.length; k2++) {
      var np = notches[k2].p, nr = notches[k2].seamMm + 6;
      bb = bboxUnion(bb, { x: np[0] - nr, y: np[1] - nr, w: 2 * nr, h: 2 * nr });
    }

    /* draft 가 준 bbox 와 대조 (cm → mm) */
    var declared = null, delta = null;
    if (p.bbox && isFinite(p.bbox.w)) {
      declared = { x: p.bbox.x * 10, y: p.bbox.y * 10, w: p.bbox.w * 10, h: p.bbox.h * 10 };
      delta = {
        x: bbOutline.x - declared.x, y: bbOutline.y - declared.y,
        w: bbOutline.w - declared.w, h: bbOutline.h - declared.h
      };
      var worst = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.w), Math.abs(delta.h));
      if (worst > 0.05) {
        warn.push('조각 "' + pname + '": draft.bbox 와 outline 실측 bbox 가 ' +
                  worst.toFixed(3) + 'mm 어긋남');
      }
    }

    /* 조각 무게중심 — 골선 라벨을 안쪽으로 밀 때 사용 */
    var cx = 0, cy = 0;
    for (var cz = 0; cz < NP; cz++) { cx += outline[cz][0]; cy += outline[cz][1]; }
    var centroid = [cx / NP, cy / NP];

    /* 이 조각이 실제로 쓰는 부위별 시접 (엔진이 seamByRole 을 주면 그것을 우선) */
    var byRolePiece = {}, rz;
    if (p.seamByRole && typeof p.seamByRole === 'object') {
      for (rz in p.seamByRole) if (SEAM_DEFAULTS.hasOwnProperty(rz)) byRolePiece[rz] = +p.seamByRole[rz];
      byRolePiece.fold = 0;
      for (rz in byRolePiece) {
        if (rz !== 'fold' && rolesUsed.indexOf(rz) < 0) rolesUsed.push(rz);
        if (SEAM.byRole[rz] !== undefined && Math.abs(SEAM.byRole[rz] - byRolePiece[rz]) > 1e-9) {
          warn.push('조각 "' + pname + '": 엔진이 적용한 ' + (ROLE_KO[rz] || rz) + ' 시접 ' + n(byRolePiece[rz], 2) +
                    'cm 가 opt.seam 요청값 ' + n(SEAM.byRole[rz], 2) + 'cm 와 다릅니다 — 엔진 값을 표기합니다');
        }
      }
    } else {
      for (rz = 0; rz < rolesUsed.length; rz++) byRolePiece[rolesUsed[rz]] = SEAM.byRole[rolesUsed[rz]];
      byRolePiece.fold = 0;
    }
    var rolesShown = rolesUsed.filter(function (r) { return r !== 'fold'; });

    pieces.push({
      id: p.id || ('piece' + i),
      name: pname,
      cutCount: (p.cutCount == null ? 2 : p.cutCount),
      outline: outline, seamline: seamline, seamSource: seamSource, seamTier: seamTier,
      seamEdges: seamEdges, seamEdgeIsFold: seamEdgeIsFold,
      seamSelfInt: seamSelfInt, seamLoopsRemoved: seamLoopsRemoved,
      edgeRole: edgeRole, hasEdgeRoles: hasEdgeRoles,
      byRole: byRolePiece, rolesUsed: rolesShown,
      maxSeamMm: SEAM.maxCm * 10,
      foldMask: foldMask, foldRanges: foldRanges, foldSeamGapMm: foldSeamGapOut,
      centroid: centroid,
      internal: internal, notches: notches, grainline: grain,
      /* 계산식 주석 — 이 Suite 의 존재 이유가 1:1 종이인데 계산식이 종이에 한 개도
         안 찍히고 있었다 (5개 모듈 공통). draft.meta.formulaNotes 에서 이 조각 것만
         골라 world mm 로 옮겨 싣는다. SPEC §8.1 의 piece/anchor 규약을 그대로 쓴다. */
      dims: dimsOf(draft, p.id || ('piece' + i), warn),
      bbox: bb,                 // 배치용(라벨/시접 포함) world mm
      outlineBbox: bbOutline,   // 검산용 world mm
      declaredBbox: declared, bboxDelta: delta
    });
  }
  return pieces;
}

/* =========================================================================
 * 2. 네스팅 (shelf packing + 90° 회전)
 * =======================================================================*/
function pack(pieces, binW, gap, allowRotate, pageH) {
  /* 스카이라인(bottom-left) 배치.
     예전 선반(shelf) 방식은 한 줄의 높이를 그 줄에서 제일 큰 조각이 정해서,
     낮은 조각 아래가 통째로 비었다 (A1 롤에서 종이가 크게 낭비됐다).
     스카이라인은 이미 놓인 조각들의 윗선을 기억했다가 **가장 낮은 자리**에 채워 넣는다.
     조각 간격 gap 은 조각 크기에 미리 더해 두고(w+gap, h+gap) 자리만 찾는다. */
  var items = [], i;
  for (i = 0; i < pieces.length; i++)
    items.push({ idx: i, w0: pieces[i].bbox.w, h0: pieces[i].bbox.h });
  /* 큰 것부터 — 작은 조각이 큰 조각 옆 빈틈을 메우게 된다 */
  items.sort(function (a, b) {
    return (Math.max(b.w0, b.h0) - Math.max(a.w0, a.h0)) || (b.w0 * b.h0 - a.w0 * a.h0);
  });

  var W = binW + gap;                       // 오른쪽 끝 조각도 gap 을 붙여 계산
  var sky = [{ x: 0, w: W, y: 0 }];         // 윗선 — x 오름차순, 서로 겹치지 않는다
  var placed = [], usedW = 0, usedH = 0;

  function fitAt(k, w) {                    // sky[k] 왼쪽 끝에 폭 w 를 놓을 때의 y
    var x = sky[k].x;
    if (x + w > W + 1e-9) return null;
    var y = sky[k].y, rest = w, j = k;
    while (rest > 1e-9) {
      if (j >= sky.length) return null;
      if (sky[j].y > y) y = sky[j].y;
      rest -= sky[j].w; j++;
    }
    return y;
  }
  function place(x, w, y, h) {              // 윗선 갱신
    var ns = [], t = { x: x, w: w, y: y + h }, k;
    for (k = 0; k < sky.length; k++) {
      var sg = sky[k], a = sg.x, b = sg.x + sg.w;
      if (b <= x + 1e-9 || a >= x + w - 1e-9) { ns.push(sg); continue; }
      if (a < x - 1e-9) ns.push({ x: a, w: x - a, y: sg.y });
      if (b > x + w + 1e-9) ns.push({ x: x + w, w: b - (x + w), y: sg.y });
    }
    ns.push(t);
    ns.sort(function (p1, p2) { return p1.x - p2.x; });
    var mg = [];                            // 같은 높이 이웃은 합친다
    for (k = 0; k < ns.length; k++) {
      var last = mg[mg.length - 1];
      if (last && Math.abs(last.y - ns[k].y) < 1e-9 && Math.abs(last.x + last.w - ns[k].x) < 1e-9)
        last.w += ns[k].w;
      else mg.push({ x: ns[k].x, w: ns[k].w, y: ns[k].y });
    }
    sky = mg;
  }

  for (i = 0; i < items.length; i++) {
    var it = items[i], best = null;
    var forms = [{ w: it.w0 + gap, h: it.h0 + gap, rot: false }];
    if (allowRotate) forms.push({ w: it.h0 + gap, h: it.w0 + gap, rot: true });
    for (var f = 0; f < forms.length; f++) {
      for (var k2 = 0; k2 < sky.length; k2++) {
        var y = fitAt(k2, forms[f].w);
        if (y === null) continue;
        /* 롤을 여러 장으로 자를 때 조각이 장 경계를 걸치면 안 된다 —
           걸치면 다음 장 머리로 내린다. 그래야 장마다 꽉 차고 장수가 준다. */
        if (pageH > 0 && forms[f].h <= pageH + 1e-9) {
          var pg = Math.floor(y / pageH + 1e-9);
          if (y + forms[f].h > (pg + 1) * pageH + 1e-9) y = (pg + 1) * pageH;
        }
        var cand = { x: sky[k2].x, y: y, f: forms[f] };
        /* ① 놓았을 때 위쪽 끝이 가장 낮은 자리 ② 같으면 왼쪽 ③ 같으면 회전 안 한 쪽 */
        if (!best || y + forms[f].h < best.y + best.f.h - 1e-9 ||
            (Math.abs((y + forms[f].h) - (best.y + best.f.h)) < 1e-9 &&
             (cand.x < best.x - 1e-9 ||
              (Math.abs(cand.x - best.x) < 1e-9 && !forms[f].rot && best.f.rot))))
          best = cand;
      }
    }
    if (!best) {                            // 어떤 자리에도 안 들어가면 맨 위에 새 줄
      var hAll = 0;
      for (var z = 0; z < sky.length; z++) if (sky[z].y > hAll) hAll = sky[z].y;
      best = { x: 0, y: hAll, f: forms[0] };
      sky = [{ x: 0, w: W, y: hAll }];
    }
    place(best.x, best.f.w, best.y, best.f.h);
    placed.push({ idx: it.idx, x: best.x, y: best.y,
                  w: best.f.w - gap, h: best.f.h - gap, rot: best.f.rot });
    if (best.x + best.f.w - gap > usedW) usedW = best.x + best.f.w - gap;
    if (best.y + best.f.h - gap > usedH) usedH = best.y + best.f.h - gap;
  }
  placed.sort(function (a, b) { return a.idx - b.idx; });
  return { placed: placed, w: usedW, h: usedH };
}

/* A4 타일: 페이지 수가 최소가 되는 캔버스 폭을 탐색 */
function bestPackA4(pieces, o, worldContentW, worldContentH, worldStepX, worldStepY) {
  var best = null;
  for (var cols = 1; cols <= o.maxCols; cols++) {
    var binW = worldContentW + (cols - 1) * worldStepX - 2 * o.padMm;
    if (binW <= 0) continue;
    var r = pack(pieces, binW, o.gapMm, o.allowRotate);
    var cw = r.w + 2 * o.padMm, ch = r.h + 2 * o.padMm;
    var c = Math.max(1, Math.ceil((cw - o.overlapMm) / worldStepX - 1e-9));
    var rr = Math.max(1, Math.ceil((ch - o.overlapMm) / worldStepY - 1e-9));
    var pages = c * rr;
    var rots = 0;
    for (var z = 0; z < r.placed.length; z++) if (r.placed[z].rot) rots++;
    var cand = { res: r, cols: c, rows: rr, pages: pages, cw: cw, ch: ch, rots: rots, tried: cols };
    /* 우선순위: ① 페이지 수 ② 사용 면적 ③ 회전 조각 수(같은 값이면 세우지 말고 그대로) */
    var better = !best ||
      pages < best.pages ||
      (pages === best.pages && cw * ch < best.cw * best.ch - 1e-6) ||
      (pages === best.pages && Math.abs(cw * ch - best.cw * best.ch) <= 1e-6 && rots < best.rots);
    if (better) best = cand;
  }
  return best;
}

/* =========================================================================
 * 3. 조각 렌더 (world mm 좌표계에서 그림)
 * =======================================================================*/
function renderPiece(pc, o, sizeLabel) {
  var g = [], i;
  var hasSeam = !!pc.seamline;
  var N = pc.outline.length;

  /* 변 마스크: 양끝 정점이 모두 골선이면 그 변은 골선 변 */
  var edgeSeam = [], edgeFold = [], anyFold = false;
  for (i = 0; i < N; i++) {
    var isFold = pc.foldMask[i] && pc.foldMask[(i + 1) % N];
    if (isFold) anyFold = true;
    edgeFold.push(isFold);
    edgeSeam.push(!isFold);
  }

  /* 시접선(재단선) = 실선, 완성선 = 파선 — SPEC §6.3
     골선 변에는 시접선을 그리지 않고, 대신 outline 을 실선으로 이어
     재단 경계가 끊기지 않게 한다(골선에서는 완성선 = 재단선). */
  if (hasSeam) {
    /* 재단선 = 시접선 폐곡선 **전체**를 한 번에 그린다.
       골선 구간의 시접선은 오프셋 0 이라 골선 위에 그대로 놓이고, 양 끝은 이웃 변의
       시접만큼 골선을 따라 연장돼 있다. 여기서 골선 구간을 빼고 완성선 골선으로
       대체하면 그 연장분(목 1.0 / 밑단 3.0)만큼 재단선에 틈이 생긴다. */
    g.push('<path d="' + pathFrom(pc.seamline, true) + '" fill="none" stroke="' + INK +
           '" stroke-width="0.55" stroke-linejoin="round"/>');
    /* 완성선(파선)은 골선을 뺀 구간만 — 골선에서는 완성선 = 재단선이라 겹쳐 그리면 지저분하다 */
    var fin = anyFold ? pathRuns(pc.outline, edgeSeam) : [pathFrom(pc.outline, true)];
    for (i = 0; i < fin.length; i++) {
      g.push('<path d="' + fin[i] + '" fill="none" stroke="' + INK +
             '" stroke-width="0.38" stroke-dasharray="4 2.2" stroke-linejoin="round"/>');
    }
  } else {
    g.push('<path d="' + pathFrom(pc.outline, true) + '" fill="none" stroke="' + INK +
           '" stroke-width="0.55" stroke-linejoin="round"/>');
  }

  /* 골선 표시 — 양쪽 화살표 + "골선 · 시접 없음" */
  for (var fr = 0; fr < pc.foldRanges.length; fr++) {
    g.push(foldMarker(pc, pc.foldRanges[fr]));
  }

  /* 시접선 위 부위별 폭 병기 — 공간 되는 구간만 (SPEC §11-1 요청) */
  if (hasSeam && o.seamLabels && pc.seamEdges && pc.seamEdges.length) {
    for (var se = 0; se < pc.seamEdges.length; se++) {
      var sed = pc.seamEdges[se];
      if (!sed.role || sed.role === 'fold') continue;
      var w = (sed.seamCm != null ? sed.seamCm : pc.byRole[sed.role]);
      if (!(w > 0)) continue;
      var idxs = rangeIdx(sed.start, sed.end, pc.seamline.length);
      if (!idxs || idxs.length < 2) continue;
      /* 구간 길이 확인 — 짧으면 생략 */
      var segLen = 0, mi;
      for (mi = 0; mi < idxs.length - 1; mi++) {
        segLen += Math.hypot(pc.seamline[idxs[mi + 1]][0] - pc.seamline[idxs[mi]][0],
                             pc.seamline[idxs[mi + 1]][1] - pc.seamline[idxs[mi]][1]);
      }
      if (segLen < 45) continue;
      var mid = pc.seamline[idxs[Math.floor(idxs.length / 2)]];
      var mid2 = pc.seamline[idxs[Math.min(idxs.length - 1, Math.floor(idxs.length / 2) + 1)]];
      var tx = mid2[0] - mid[0], ty = mid2[1] - mid[1], tl = Math.hypot(tx, ty) || 1;
      /* 조각 안쪽으로 살짝 들여서 배치 */
      var inx = pc.centroid[0] - mid[0], iny = pc.centroid[1] - mid[1], il = Math.hypot(inx, iny) || 1;
      var lx2 = mid[0] + (inx / il) * 4.5, ly2 = mid[1] + (iny / il) * 4.5;
      var dg = Math.atan2(ty / tl, tx / tl) * 180 / Math.PI;
      if (dg > 90) dg -= 180; if (dg < -90) dg += 180;
      g.push('<text data-ndp-seamlabel="' + esc(sed.role) + '" x="' + n(lx2) + '" y="' + n(ly2) +
        '" font-size="3" font-family="sans-serif" fill="' + BLUE + '"' + halo(0.8) +
        ' text-anchor="middle" transform="rotate(' + n(dg, 2) + ' ' + n(lx2) + ' ' + n(ly2) + ')">' +
        esc(ROLE_KO[sed.role] || sed.role) + ' ' + n(w, 2) + '</text>');
    }
  }

  /* 계산식 주석 — 치수선 대신 앵커 자리에 `이름 식 = 값` 을 찍는다 (SPEC §8.1).
     조각 안쪽 좌표라 A4 분할·네스팅에서 잘려 나가지 않는다. */
  var dms = pc.dims || [];
  for (i = 0; i < dms.length; i++) {
    var dm = dms[i];
    /* 빠진 조각은 **빼고** 잇는다 — 없는 값을 문자열로 이으면 종이에 undefined 가 찍힌다 */
    var dparts = [];
    if (dm.label) dparts.push(String(dm.label));
    if (dm.formula) dparts.push(String(dm.formula));
    var dtxt = dparts.join('  ') + (isFinite(dm.value) ? ' = ' + n(dm.value, 2) : '');
    if (!dtxt) continue;
    g.push('<text x="' + n(dm.at[0]) + '" y="' + n(dm.at[1]) + '" font-size="2.6" ' +
           'font-family="sans-serif" fill="#2b6cd4" text-anchor="middle">' + esc(dtxt) + '</text>');
  }

  /* 기초선 / 내부선 */
  for (i = 0; i < pc.internal.length; i++) {
    var it = pc.internal[i];
    if (it.type === 'point') {
      var p = it.pts[0];
      g.push('<circle cx="' + n(p[0]) + '" cy="' + n(p[1]) + '" r="1.1" fill="' + INK + '"/>');
      if (it.label) g.push('<text x="' + n(p[0] + 2.2) + '" y="' + n(p[1] - 1.6) +
        '" font-size="3.2" font-family="sans-serif" fill="' + BLUE + '">' + esc(it.label) + '</text>');
    } else {
      var dash = (it.type === 'dashed') ? ' stroke-dasharray="3 2"' : '';
      /* 'edge' = 외곽선과 같은 색·굵기 (다트 다리처럼 접어 꿰매는 선) */
      var isEdge = (it.type === 'edge');
      g.push('<path d="' + pathFrom(it.pts, false) + '" fill="none" stroke="' + (isEdge ? INK : GUIDE) +
             '" stroke-width="' + (isEdge ? '0.55' : '0.28') + '"' + dash + '/>');
      if (it.label) {
        var a = it.pts[0], b = it.pts[it.pts.length - 1];
        g.push('<text x="' + n((a[0] + b[0]) / 2) + '" y="' + n((a[1] + b[1]) / 2 - 1.4) +
          '" font-size="3.2" font-family="sans-serif" fill="' + BLUE +
          '" text-anchor="middle">' + esc(it.label) + '</text>');
      }
    }
  }

  /* 너치 — SPEC §8.1: angle 은 도(°), 0°=+x, 시계방향 +, 조각 안쪽 방향.
     안쪽으로 0.5cm. 시접이 있으면 재단선(시접선)까지 바깥으로도 이어 그린다. */
  for (i = 0; i < pc.notches.length; i++) {
    var nt = pc.notches[i];
    var dx = Math.cos(nt.rad), dy = Math.sin(nt.rad);
    var inLen  = 5;                              // 안쪽 0.5cm (확정 규약)
    var outLen = hasSeam ? nt.seamMm : 0;        // 바깥은 그 변의 부위 시접만큼 (SPEC §11-1)
    g.push('<line x1="' + n(nt.p[0] - dx * outLen) + '" y1="' + n(nt.p[1] - dy * outLen) +
           '" x2="' + n(nt.p[0] + dx * inLen) + '" y2="' + n(nt.p[1] + dy * inLen) +
           '" stroke="' + INK + '" stroke-width="0.45" stroke-linecap="round"/>');
    if (nt.label) {
      g.push('<text x="' + n(nt.p[0] + dx * (inLen + 2.6)) + '" y="' + n(nt.p[1] + dy * (inLen + 2.6) + 1) +
             '" font-size="2.8" font-family="sans-serif" fill="' + INK_SOFT + '"' + halo(0.7) +
             ' text-anchor="middle">' + esc(nt.label) + '</text>');
    }
  }

  /* 식서(grainline) — 양끝 화살표 */
  if (pc.grainline) {
    var a2 = pc.grainline[0], b2 = pc.grainline[pc.grainline.length - 1];
    var vx = b2[0] - a2[0], vy = b2[1] - a2[1], L = Math.hypot(vx, vy) || 1;
    var ux = vx / L, uy = vy / L, HL = 6, HW = 2.2;
    g.push('<line x1="' + n(a2[0]) + '" y1="' + n(a2[1]) + '" x2="' + n(b2[0]) + '" y2="' + n(b2[1]) +
           '" stroke="' + BLUE + '" stroke-width="0.45"/>');
    g.push('<path d="M ' + n(b2[0]) + ' ' + n(b2[1]) +
           ' L ' + n(b2[0] - ux * HL + uy * HW) + ' ' + n(b2[1] - uy * HL - ux * HW) +
           ' M ' + n(b2[0]) + ' ' + n(b2[1]) +
           ' L ' + n(b2[0] - ux * HL - uy * HW) + ' ' + n(b2[1] - uy * HL + ux * HW) +
           '" fill="none" stroke="' + BLUE + '" stroke-width="0.45"/>');
    g.push('<path d="M ' + n(a2[0]) + ' ' + n(a2[1]) +
           ' L ' + n(a2[0] + ux * HL + uy * HW) + ' ' + n(a2[1] + uy * HL - ux * HW) +
           ' M ' + n(a2[0]) + ' ' + n(a2[1]) +
           ' L ' + n(a2[0] + ux * HL - uy * HW) + ' ' + n(a2[1] + uy * HL + ux * HW) +
           '" fill="none" stroke="' + BLUE + '" stroke-width="0.45"/>');
    var mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
    var deg = Math.atan2(uy, ux) * 180 / Math.PI;
    if (deg > 90) deg -= 180; if (deg < -90) deg += 180;
    g.push('<text x="' + n(mx) + '" y="' + n(my - 1.8) + '" font-size="3.4" font-family="sans-serif" fill="' +
           BLUE + '" text-anchor="middle" transform="rotate(' + n(deg, 2) + ' ' + n(mx) + ' ' + n(my) + ')">식서</text>');
  }

  /* 조각 라벨 — 반드시 조각 안쪽 (pitfalls: 바깥에 두면 타일/네스팅에서 잘림) */
  var bb = pc.outlineBbox;
  var lx = bb.x + bb.w * 0.5, ly = bb.y + bb.h * 0.42;   // 기본값 — 아래에서 더 나은 자리를 찾는다
  var l1 = pc.name + (sizeLabel ? '  ' + sizeLabel : '');
  var l2 = '재단 ' + pc.cutCount + '장';
  /* 시접은 부위별로 다르므로 균일 표기 금지 — 종이만 보고 알 수 있어야 함 (SPEC §11-1) */
  var l3 = pc.seamline ? ('시접  ' + seamSummary(pc.byRole, pc.rolesUsed)) : '시접 없음';
  var l4 = '1:1 실물크기' + (pc.foldRanges.length ? ' · 골선 시접 0' : '');
  var boxW = Math.max(l1.length * 2.9, l3.length * 1.85, 34) + 10;
  var boxH = 25;
  (function () {
    var lines = [pc.outline].concat((pc.internal || []).map(function (it) { return it.pts; }));
    if (pc.seamline) lines.push(pc.seamline);
    function clearance(cx, cy) {                 // 라벨 상자와 모든 선의 최소 거리
      var x0 = cx - boxW / 2, x1 = cx + boxW / 2, y0 = cy - 8, y1 = cy + boxH - 8;
      var best = Infinity;
      for (var li = 0; li < lines.length; li++) {
        var L = lines[li]; if (!L) continue;
        for (var i = 0; i < L.length; i++) {
          var px = L[i][0], py = L[i][1];
          var dx = px < x0 ? x0 - px : (px > x1 ? px - x1 : 0);
          var dy = py < y0 ? y0 - py : (py > y1 ? py - y1 : 0);
          var d = (dx === 0 && dy === 0) ? -1 : Math.hypot(dx, dy);
          if (d < best) best = d;
          if (best < 0) return -1;               // 상자 안을 선이 지난다 — 즉시 탈락
        }
      }
      return best;
    }
    function allIn(cx, cy) {                     // 상자 네 귀 + 중앙이 조각 안인가
      var x0 = cx - boxW / 2, x1 = cx + boxW / 2, y0 = cy - 8, y1 = cy + boxH - 8;
      return ptInPolyMM([x0, y0], pc.outline) && ptInPolyMM([x1, y0], pc.outline) &&
             ptInPolyMM([x0, y1], pc.outline) && ptInPolyMM([x1, y1], pc.outline) &&
             ptInPolyMM([cx, cy], pc.outline);
    }
    var bestC = null, bestV = -1, gx, gy;
    for (gy = 0.12; gy <= 0.88; gy += 0.04) {
      for (gx = 0.15; gx <= 0.85; gx += 0.05) {
        var cx = bb.x + bb.w * gx, cy = bb.y + bb.h * gy;
        if (!allIn(cx, cy)) continue;
        var v = clearance(cx, cy);
        if (v > bestV) { bestV = v; bestC = [cx, cy]; }
      }
    }
    if (bestC && bestV >= 0) { lx = bestC[0]; ly = bestC[1]; }
  })();
  g.push('<rect x="' + n(lx - boxW / 2) + '" y="' + n(ly - 8) + '" width="' + n(boxW) +
         '" height="' + n(25) + '" fill="#ffffff" fill-opacity="0.82" stroke="none"/>');
  g.push('<text x="' + n(lx) + '" y="' + n(ly) + '" font-size="5.4" font-weight="700" font-family="sans-serif" fill="' +
         INK + '" text-anchor="middle">' + esc(l1) + '</text>');
  g.push('<text x="' + n(lx) + '" y="' + n(ly + 5.4) + '" font-size="3.4" font-family="sans-serif" fill="' +
         INK_SOFT + '" text-anchor="middle">' + esc(l2) + '</text>');
  g.push('<text data-ndp-seamsummary="1" x="' + n(lx) + '" y="' + n(ly + 10.4) +
         '" font-size="3.2" font-family="sans-serif" fill="' + INK +
         '" text-anchor="middle">' + esc(l3) + '</text>');
  g.push('<text x="' + n(lx) + '" y="' + n(ly + 15) + '" font-size="2.9" font-family="sans-serif" fill="' +
         INK_SOFT + '" text-anchor="middle">' + esc(l4) + '</text>');

  return g.join('');
}

/** 점이 폴리곤(mm 좌표) 안인가 — 라벨 자리 찾기에 쓴다 */
function ptInPolyMM(pt, poly) {
  var c = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/* 골선(CB·CF) 표시 — 구간 양끝을 잇는 양방향 화살표 + "골선 · 시접 없음".
   시접이 0 인 변이라는 것을 재단하는 사람이 바로 알 수 있어야 한다. */
function foldMarker(pc, idxs) {
  if (!idxs || idxs.length < 2) return '';
  var A = pc.outline[idxs[0]], B = pc.outline[idxs[idxs.length - 1]];
  var vx = B[0] - A[0], vy = B[1] - A[1], L = Math.hypot(vx, vy);
  if (L < 8) return '';
  var ux = vx / L, uy = vy / L;
  var inset = Math.min(L * 0.15, 22);
  var a = [A[0] + ux * inset, A[1] + uy * inset];
  var b = [B[0] - ux * inset, B[1] - uy * inset];

  /* 조각 안쪽(무게중심 쪽) 법선 */
  var nx = -uy, ny = ux;
  var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  if ((pc.centroid[0] - mx) * nx + (pc.centroid[1] - my) * ny < 0) { nx = -nx; ny = -ny; }
  var off = 4.5;
  var ax = a[0] + nx * off, ay = a[1] + ny * off;
  var bx = b[0] + nx * off, by = b[1] + ny * off;

  var HL = 5, HW = 1.9, s = [];
  s.push('<g data-ndp-fold="1">');
  s.push('<line x1="' + n(ax) + '" y1="' + n(ay) + '" x2="' + n(bx) + '" y2="' + n(by) +
         '" stroke="' + BLUE + '" stroke-width="0.35"/>');
  s.push('<path d="M ' + n(bx) + ' ' + n(by) +
         ' L ' + n(bx - ux * HL + nx * HW) + ' ' + n(by - uy * HL + ny * HW) +
         ' M ' + n(bx) + ' ' + n(by) +
         ' L ' + n(bx - ux * HL - nx * HW) + ' ' + n(by - uy * HL - ny * HW) +
         ' M ' + n(ax) + ' ' + n(ay) +
         ' L ' + n(ax + ux * HL + nx * HW) + ' ' + n(ay + uy * HL + ny * HW) +
         ' M ' + n(ax) + ' ' + n(ay) +
         ' L ' + n(ax + ux * HL - nx * HW) + ' ' + n(ay + uy * HL - ny * HW) +
         '" fill="none" stroke="' + BLUE + '" stroke-width="0.35"/>');
  var lx = (ax + bx) / 2 + nx * 3.4, ly = (ay + by) / 2 + ny * 3.4;
  var deg = Math.atan2(uy, ux) * 180 / Math.PI;
  if (deg > 90) deg -= 180; if (deg < -90) deg += 180;
  s.push('<text x="' + n(lx) + '" y="' + n(ly) + '" font-size="3.4" font-family="sans-serif" fill="' + BLUE +
         '"' + halo(0.9) + ' text-anchor="middle" transform="rotate(' + n(deg, 2) + ' ' + n(lx) + ' ' + n(ly) +
         ')">골선 · 시접 없음</text>');
  s.push('</g>');
  return s.join('');
}

/* 배치 변환 문자열 (world mm) */
function placeTransform(pc, pl, originPad) {
  var px = pl.x + originPad, py = pl.y + originPad;
  var bb = pc.bbox;
  if (pl.rot) {
    /* 로컬을 (0,0)-(w,h) 로 옮긴 뒤 +90° 회전 → x∈[-h,0] 이므로 h 만큼 되돌림 */
    return 'translate(' + n(px + bb.h) + ' ' + n(py) + ') rotate(90) translate(' + n(-bb.x) + ' ' + n(-bb.y) + ')';
  }
  return 'translate(' + n(px - bb.x) + ' ' + n(py - bb.y) + ')';
}

/* =========================================================================
 * 4. 공통 부품: 캘리브레이션 눈금 / 모눈 / 정합 십자
 * =======================================================================*/
/**
 * 5cm 캘리브레이션 눈금.
 * declared mm 좌표계에 그리되 길이는 50 * k 로 잡는다.
 * → 프린터가 1/k 로 축소해도 실측 정확히 50mm 가 된다.
 */
function calibRuler(x, y, k, note) {
  var L = 50 * k, i, s = [];
  s.push('<g data-ndp-calib="1" data-world-mm="50" data-declared-mm="' + L.toFixed(4) + '" data-k="' + k.toFixed(6) + '">');
  s.push('<line data-ndp-calib-line="1" x1="' + n(x, 4) + '" y1="' + n(y, 4) +
         '" x2="' + n(x + L, 4) + '" y2="' + n(y, 4) + '" stroke="#000" stroke-width="0.4"/>');
  for (i = 0; i <= 5; i++) {
    var tx = x + (L / 5) * i;
    var th = (i === 0 || i === 5) ? 4.4 : (i === 2 || i === 3 ? 2.4 : 1.8);
    s.push('<line x1="' + n(tx, 4) + '" y1="' + n(y, 4) + '" x2="' + n(tx, 4) + '" y2="' + n(y - th, 4) +
           '" stroke="#000" stroke-width="0.4"/>');
  }
  s.push('<text x="' + n(x, 4) + '" y="' + n(y + 3.4, 4) + '" font-size="2.9" font-family="sans-serif" fill="#000">0</text>');
  s.push('<text x="' + n(x + L, 4) + '" y="' + n(y + 3.4, 4) + '" font-size="2.9" font-family="sans-serif" fill="#000" text-anchor="end">5cm</text>');
  s.push('<text x="' + n(x + L + 3, 4) + '" y="' + n(y + 0.6, 4) + '" font-size="2.9" font-family="sans-serif" fill="#000">' +
         esc(note || '↔ 자로 재서 정확히 50mm 여야 1:1') + '</text>');
  s.push('</g>');
  return s.join('');
}

/* 모눈 (world mm). w/h 는 world mm */
function gridLines(x0, y0, w, h, mode) {
  if (!mode) return '';
  var g = [], x, y;
  var sx = Math.floor(x0 / 10) * 10, sy = Math.floor(y0 / 10) * 10;
  for (x = sx; x <= x0 + w + 1e-6; x += 10) {
    var maj = Math.abs(x / 50 - Math.round(x / 50)) < 1e-6;
    if (!maj && mode !== 'full') continue;
    g.push('<line x1="' + n(x) + '" y1="' + n(y0) + '" x2="' + n(x) + '" y2="' + n(y0 + h) +
           '" stroke="' + (maj ? GRIDMAJ : GRIDMIN) + '" stroke-width="' + (maj ? 0.25 : 0.12) + '"/>');
  }
  for (y = sy; y <= y0 + h + 1e-6; y += 10) {
    var majY = Math.abs(y / 50 - Math.round(y / 50)) < 1e-6;
    if (!majY && mode !== 'full') continue;
    g.push('<line x1="' + n(x0) + '" y1="' + n(y) + '" x2="' + n(x0 + w) + '" y2="' + n(y) +
           '" stroke="' + (majY ? GRIDMAJ : GRIDMIN) + '" stroke-width="' + (majY ? 0.25 : 0.12) + '"/>');
  }
  /* 5cm 교차점 좌표 라벨 (이웃 페이지 정합 확인용) */
  for (x = Math.ceil(x0 / 50) * 50; x <= x0 + w + 1e-6; x += 50) {
    for (y = Math.ceil(y0 / 50) * 50; y <= y0 + h + 1e-6; y += 50) {
      g.push('<text x="' + n(x + 1.2) + '" y="' + n(y - 1.2) + '" font-size="2.6" font-family="sans-serif" fill="' +
             GRIDMAJ + '">' + (x / 10) + ',' + (y / 10) + '</text>');
    }
  }
  return '<g>' + g.join('') + '</g>';
}

/* 흰 테두리(halo) 글자 — 패턴선 위에 겹쳐도 읽히도록 */
function halo(sw) {
  return ' stroke="#ffffff" stroke-width="' + (sw || 0.8) + '" stroke-linejoin="round" paint-order="stroke"';
}

/* 정합 십자 (declared mm). below=true 면 좌표 라벨을 아래쪽에 붙인다
   (겹침 밴드의 두 십자 라벨이 서로 부딪히지 않게) */
function cross(x, y, label, below) {
  var s = '<g stroke="' + REG + '" stroke-width="0.3">' +
    '<line x1="' + n(x - 3.5, 4) + '" y1="' + n(y, 4) + '" x2="' + n(x + 3.5, 4) + '" y2="' + n(y, 4) + '"/>' +
    '<line x1="' + n(x, 4) + '" y1="' + n(y - 3.5, 4) + '" x2="' + n(x, 4) + '" y2="' + n(y + 3.5, 4) + '"/>' +
    '<circle cx="' + n(x, 4) + '" cy="' + n(y, 4) + '" r="1.4" fill="none"/></g>';
  if (label) {
    /* 오른쪽 끝 십자는 라벨이 용지 밖으로 나가므로 왼쪽으로 뒤집는다 */
    var right = (x > A4_W - 22);
    s += '<text x="' + n(x + (right ? -4.2 : 4.2), 4) + '" y="' + n(y + (below ? 4.2 : -1.6), 4) +
      '" font-size="2.4" font-family="sans-serif" fill="' + REG + '"' + halo(0.7) +
      (right ? ' text-anchor="end"' : '') + '>' + esc(label) + '</text>';
  }
  return s;
}

/* =========================================================================
 * 5. A4 타일 페이지
 * =======================================================================*/
function buildA4Pages(ctx) {
  var o = ctx.opt, k = ctx.k, uid = ctx.uid;
  var ML = o.marginMm, MT = o.marginMm;
  var CW = ctx.contentWmm, CH = ctx.contentHmm;          // declared mm
  var wStepX = ctx.worldStepX, wStepY = ctx.worldStepY;  // world mm
  var pages = [], pageIds = [];

  for (var r = 0; r < ctx.rows; r++) {
    var rowIds = [];
    for (var c = 0; c < ctx.cols; c++) {
      var id = colLabel(c) + (r + 1);
      rowIds.push(id);
      var ox = c * wStepX, oy = r * wStepY;              // 이 페이지 content 창의 world 원점
      var clipId = 'ndpClip' + uid + '_' + r + '_' + c;
      var s = [];

      s.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
        'width="' + A4_W + 'mm" height="' + A4_H + 'mm" viewBox="0 0 ' + A4_W + ' ' + A4_H + '" ' +
        'preserveAspectRatio="xMidYMid meet" ' +
        'data-ndp-page="' + id + '" data-ndp-mode="a4" data-ndp-unit="mm" ' +
        'data-ndp-world-origin="' + n(ox, 4) + ',' + n(oy, 4) + '">');
      s.push('<defs><clipPath id="' + clipId + '"><rect x="' + n(ML) + '" y="' + n(MT) +
             '" width="' + n(CW) + '" height="' + n(CH) + '"/></clipPath></defs>');
      s.push('<rect x="0" y="0" width="' + A4_W + '" height="' + A4_H + '" fill="#ffffff"/>');

      /* 내용: clip 은 변환 없는 그룹에, 변환은 자식에 (좌표계 혼동 방지) */
      s.push('<g clip-path="url(#' + clipId + ')">');
      s.push('<g transform="translate(' + n(ML - ox * k, 5) + ' ' + n(MT - oy * k, 5) + ') scale(' + n(k, 6) + ')">');
      s.push(gridLines(ox, oy, CW / k, CH / k, o.grid));
      s.push(ctx.bodyMarkup);
      s.push('</g></g>');

      /* 페이지 테두리(= content 창) */
      s.push('<rect x="' + n(ML) + '" y="' + n(MT) + '" width="' + n(CW) + '" height="' + n(CH) +
             '" fill="none" stroke="' + REG + '" stroke-width="0.2" stroke-dasharray="2 1.6"/>');

      /* 재단선(겹침 시작 위치) — 오른쪽/아래에 이웃이 있을 때 */
      var stepXd = wStepX * k, stepYd = wStepY * k;
      if (c < ctx.cols - 1) {
        s.push('<line x1="' + n(ML + stepXd, 4) + '" y1="' + n(MT) + '" x2="' + n(ML + stepXd, 4) +
               '" y2="' + n(MT + CH) + '" stroke="' + REG + '" stroke-width="0.25" stroke-dasharray="1 1"/>');
        s.push('<text x="' + n(ML + stepXd - 1.5, 4) + '" y="' + n(MT + CH / 2, 3) +
               '" font-size="2.6" font-family="sans-serif" fill="' + REG + '"' + halo(0.9) +
               ' text-anchor="middle" transform="rotate(-90 ' + n(ML + stepXd - 1.5, 4) + ' ' + n(MT + CH / 2, 3) +
               ')">✂ 여기서 잘라 ' + esc(colLabel(c + 1) + (r + 1)) + ' 위에 겹쳐 붙이기</text>');
      }
      if (r < ctx.rows - 1) {
        s.push('<line x1="' + n(ML) + '" y1="' + n(MT + stepYd, 4) + '" x2="' + n(ML + CW) +
               '" y2="' + n(MT + stepYd, 4) + '" stroke="' + REG + '" stroke-width="0.25" stroke-dasharray="1 1"/>');
        s.push('<text x="' + n(ML + CW / 2, 3) + '" y="' + n(MT + stepYd - 1.5, 4) +
               '" font-size="2.6" font-family="sans-serif" fill="' + REG + '"' + halo(0.9) +
               ' text-anchor="middle">✂ 여기서 잘라 ' + esc(colLabel(c) + (r + 2)) + ' 위에 겹쳐 붙이기</text>');
      }

      /* 정합 십자: content 창 네 귀 + step 격자점 (이웃 페이지와 동일한 world 좌표) */
      /* [x, y, 라벨을 아래에 붙일지] — 겹침 밴드의 두 십자는 위/아래로 나눠 라벨 충돌 방지 */
      var marks = [[0, 0, 0], [CW, 0, 0], [0, CH, 0], [CW, CH, 0]];
      if (c < ctx.cols - 1) { marks.push([stepXd, 0, 1]); marks.push([stepXd, CH, 1]); }
      if (r < ctx.rows - 1) { marks.push([0, stepYd, 1]); marks.push([CW, stepYd, 1]); }
      if (c < ctx.cols - 1 && r < ctx.rows - 1) marks.push([stepXd, stepYd, 1]);
      for (var mi = 0; mi < marks.length; mi++) {
        var mx = marks[mi][0], my = marks[mi][1];
        var wx = ox + mx / k, wy = oy + my / k;
        s.push(cross(ML + mx, MT + my, (wx / 10).toFixed(1) + ',' + (wy / 10).toFixed(1), !!marks[mi][2]));
      }

      /* 하단 정보띠 */
      var fy = A4_H - o.footerMm;
      s.push('<line x1="' + n(ML) + '" y1="' + n(fy) + '" x2="' + n(A4_W - ML) + '" y2="' + n(fy) +
             '" stroke="#dddddd" stroke-width="0.25"/>');
      s.push(calibRuler(ML, fy + 6.5, k, '↔ 자로 재서 50mm 여야 1:1 (아니면 인쇄보정 값 수정)'));
      s.push('<text x="' + n(A4_W - ML) + '" y="' + n(fy + 5.2) + '" font-size="5.2" font-weight="700" ' +
             'font-family="sans-serif" fill="#000" text-anchor="end">' + esc(id) + '</text>');
      s.push('<text x="' + n(A4_W - ML) + '" y="' + n(fy + 10) + '" font-size="2.8" font-family="sans-serif" ' +
             'fill="#444" text-anchor="end">' + (r * ctx.cols + c + 1) + ' / ' + (ctx.cols * ctx.rows) +
             '장 (' + ctx.cols + '열 × ' + ctx.rows + '행) · 겹침 ' + n(o.overlapMm, 1) + 'mm' +
             (o.stamp ? ' · ' + esc(o.stamp) : '') + '</text>');
      s.push('<text x="' + n(A4_W - ML) + '" y="' + n(fy + 14) + '" font-size="2.8" font-family="sans-serif" ' +
             'fill="#a11" text-anchor="end">인쇄 배율 100%(실제 크기) · &quot;용지에 맞춤&quot; 반드시 해제</text>');
      /* 머리말·부위별 시접은 하단 정보띠에 — 상단 여백은 정합 십자 좌표 라벨 전용 */
      if (ctx.seamNote) {
        s.push('<text data-ndp-seamnote="1" x="' + n(ML) + '" y="' + n(fy + 10) +
               '" font-size="2.8" font-family="sans-serif" fill="#222">' + esc(ctx.seamNote) + '</text>');
      }
      if (o.title) {
        s.push('<text x="' + n(ML) + '" y="' + n(fy + 14) + '" font-size="2.8" font-family="sans-serif" fill="#666">' +
               esc(String(o.title).slice(0, 60)) + '</text>');
      }
      s.push('</svg>');
      pages.push(s.join(''));
    }
    pageIds.push(rowIds);
  }
  return { pages: pages, pageIds: pageIds };
}

/* =========================================================================
 * 6. 개요(안내) 페이지 — A4 1장, 전체 배치 축소도 포함
 * =======================================================================*/
function buildOverviewPage(ctx, previewInner) {
  var o = ctx.opt, k = ctx.k, ML = o.marginMm;
  var s = [];
  s.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + A4_W + 'mm" height="' + A4_H +
    'mm" viewBox="0 0 ' + A4_W + ' ' + A4_H + '" preserveAspectRatio="xMidYMid meet" ' +
    'data-ndp-page="OVERVIEW" data-ndp-mode="a4" data-ndp-unit="mm">');
  s.push('<rect x="0" y="0" width="' + A4_W + '" height="' + A4_H + '" fill="#ffffff"/>');

  s.push('<text x="' + n(ML) + '" y="18" font-size="7" font-weight="700" font-family="sans-serif" fill="#000">' +
         '철릭 프린세스 — 1:1 A4 분할 출력</text>');
  if (o.title) s.push('<text x="' + n(ML) + '" y="25" font-size="3.6" font-family="sans-serif" fill="#444">' + esc(o.title) + '</text>');
  if (o.stamp) s.push('<text x="' + n(A4_W - ML) + '" y="18" font-size="3.2" font-family="sans-serif" ' +
    'fill="#888" text-anchor="end">' + esc(o.stamp) + '</text>');
  if (ctx.seamNote) s.push('<text data-ndp-seamnote="1" x="' + n(ML) + '" y="30" font-size="3.6" ' +
    'font-family="sans-serif" fill="#000">' + esc(ctx.seamNote) + '</text>');

  var ty = 38, lines = [
    '① 먼저 이 장을 인쇄해 아래 5cm 눈금을 자로 재세요. 정확히 50mm 면 그대로 전부 인쇄하면 됩니다.',
    '② 50mm 가 아니면 잰 값(mm)을 화면의 "인쇄 보정" 에 넣고 다시 인쇄하세요. 프린터 축소를 상쇄합니다.',
    '③ 인쇄 대화상자: 배율 = 100%(실제 크기). "용지에 맞춤 / Fit to page / 축소하여 맞춤" 을 반드시 끄세요.',
    '④ 여백 = 없음(기본값), 용지 = A4 세로, 머리글·바닥글 끄기.',
    '⑤ 각 장의 ✂ 선을 따라 자르고, 정합 십자(+)와 좌표숫자를 이웃 장과 맞춰 겹쳐 붙이세요. 겹침 ' + n(o.overlapMm, 1) + 'mm.',
    '⑥ 붙인 뒤 아무 5cm 눈금이나 다시 재서 50mm 인지 최종 확인.'
  ];
  for (var i = 0; i < lines.length; i++) {
    s.push('<text x="' + n(ML) + '" y="' + n(ty + i * 5.4) + '" font-size="3.4" font-family="sans-serif" fill="#222">' +
           esc(lines[i]) + '</text>');
  }

  /* 캘리브레이션: 눈금 + 5cm 정사각형 */
  var cy = ty + lines.length * 5.4 + 8;
  s.push('<text x="' + n(ML) + '" y="' + n(cy) + '" font-size="4" font-weight="700" font-family="sans-serif" fill="#000">배율 확인</text>');
  s.push(calibRuler(ML, cy + 10, k, ''));
  var sq = 50 * k;
  s.push('<g data-ndp-calib="1" data-world-mm="50" data-declared-mm="' + sq.toFixed(4) + '" data-shape="square">' +
    '<rect x="' + n(ML, 4) + '" y="' + n(cy + 15, 4) + '" width="' + n(sq, 4) + '" height="' + n(sq, 4) +
    '" fill="none" stroke="#000" stroke-width="0.4"/></g>');
  s.push('<text x="' + n(ML + sq + 5, 4) + '" y="' + n(cy + 15 + sq / 2, 4) +
    '" font-size="3.4" font-family="sans-serif" fill="#000">← 이 정사각형이 자로 5.0cm × 5.0cm 이면 1:1 정상</text>');
  s.push('<text x="' + n(ML + sq + 5, 4) + '" y="' + n(cy + 20 + sq / 2, 4) +
    '" font-size="3" font-family="sans-serif" fill="#666">현재 인쇄보정: 5cm 실측 ' + n(o.calibMm, 2) +
    'mm → 보정계수 ' + k.toFixed(4) + '</text>');

  /* 전체 배치 축소도 */
  var py = cy + 15 + sq + 12;
  s.push('<text x="' + n(ML) + '" y="' + n(py) + '" font-size="4" font-weight="700" font-family="sans-serif" fill="#000">' +
    '전체 배치 (축소 미리보기 — 1:1 아님)</text>');
  var availW = A4_W - 2 * ML, availH = A4_H - py - 12;
  var sc = Math.min(availW / ctx.previewW, availH / ctx.previewH);
  s.push('<g transform="translate(' + n(ML) + ' ' + n(py + 4) + ') scale(' + n(sc, 6) + ')">' + previewInner + '</g>');
  s.push('</svg>');
  return s.join('');
}

/* =========================================================================
 * 7. 롤지(A1 등) 한 장 출력
 * =======================================================================*/
/** 롤지 페이지 분할 — 조각을 자르지 않고 **선반 경계에서만** 끊는다. */
function splitRollPages(placed, canvasH, o, k) {
  var M = o.rollMarginMm, chrome = 2 * M + 26 + 8;
  var all = { y0: -o.padMm, h: canvasH, idx: placed.map(function (_, i) { return i; }) };
  var maxH = +o.rollMaxHmm || 0;
  if (!maxH || chrome + canvasH * k <= maxH + 1e-6) return [all];
  var usable = (maxH - chrome) / k;
  var order = placed.map(function (p, i) { return { i: i, y: p.y, b: p.y + p.h }; })
                    .sort(function (a, b) { return (a.y - b.y) || (a.b - b.b); });
  var pages = [], cur = null;
  for (var q = 0; q < order.length; q++) {
    var it = order[q];
    if (cur && (it.b + o.padMm) - cur.y0 <= usable + 1e-6) {
      cur.idx.push(it.i); cur.h = Math.max(cur.h, (it.b + o.padMm) - cur.y0); continue;
    }
    if (cur) pages.push(cur);
    cur = { y0: it.y - o.padMm, h: (it.b - it.y) + 2 * o.padMm, idx: [it.i] };
  }
  if (cur) pages.push(cur);
  return pages;
}

function buildRollPage(ctx, page, idx, total) {
  var o = ctx.opt, k = ctx.k;
  var M = o.rollMarginMm, headH = 26;
  page = page || { y0: -o.padMm, h: ctx.canvasH, idx: null };
  var W = ctx.rollWmm;
  var H = 2 * M + headH + page.h * k + 8;     // ★ 페이지마다 자기 길이
  total = total || 1; idx = idx || 0;
  var s = [];
  s.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + n(W, 3) + 'mm" height="' + n(H, 3) +
    'mm" viewBox="0 0 ' + n(W, 3) + ' ' + n(H, 3) + '" preserveAspectRatio="xMidYMid meet" ' +
    'data-ndp-page="ROLL" data-ndp-mode="roll" data-ndp-unit="mm" data-ndp-roll-width="' + n(W, 3) + '">');
  s.push('<rect x="0" y="0" width="' + n(W, 3) + '" height="' + n(H, 3) + '" fill="#ffffff"/>');

  s.push('<text x="' + n(M) + '" y="' + n(M + 6) + '" font-size="7" font-weight="700" font-family="sans-serif" fill="#000">' +
    '철릭 프린세스 — 1:1 롤지 출력 · 용지 ' + n(W, 0) + ' × ' + n(H, 0) + ' mm' +
    (total > 1 ? '  (' + (idx + 1) + '/' + total + '장)' : '') + '</text>');
  if (o.title) s.push('<text x="' + n(M) + '" y="' + n(M + 13) + '" font-size="3.6" font-family="sans-serif" fill="#444">' +
    esc(o.title) + '</text>');
  if (o.stamp) s.push('<text x="' + n(W - M) + '" y="' + n(M + 6) + '" font-size="3.2" font-family="sans-serif" ' +
    'fill="#888" text-anchor="end">' + esc(o.stamp) + '</text>');
  s.push('<text x="' + n(M) + '" y="' + n(M + 19) + '" font-size="3.4" font-family="sans-serif" fill="#a11">' +
    '플로터/프린터 배율 100% 필수 — &quot;용지에 맞춤&quot; 해제. 아래 눈금이 50mm 여야 1:1 입니다.</text>');
  if (ctx.seamNote) {
    s.push('<text data-ndp-seamnote="1" x="' + n(M) + '" y="' + n(M + 24.5) +
      '" font-size="3.4" font-family="sans-serif" fill="#222">' + esc(ctx.seamNote) + '</text>');
  }
  s.push(calibRuler(M + 120, M + 18, k, ''));

  s.push('<g transform="translate(' + n(M, 4) + ' ' + n(M + headH, 4) + ') scale(' + n(k, 6) + ')">');
  s.push(gridLines(0, 0, ctx.canvasW, page.h, o.grid));
  s.push('<g transform="translate(0 ' + n(-(page.y0 + o.padMm), 4) + ')">' +
    (page.idx ? page.idx.map(function (q) { return ctx.pieceMarkup[q]; }).join('') : ctx.bodyMarkup) + '</g>');
  s.push('</g>');

  /* 하단에도 눈금 하나 더 (긴 출력물의 길이방향 왜곡 확인용) */
  s.push(calibRuler(M, H - M - 2, k, '↕ 길이방향 확인용 — 이것도 50mm'));
  /* 세로 방향 50mm 눈금 */
  var vL = 50 * k, vx = W - M - 6, vy = H - M - 10;
  s.push('<g data-ndp-calib="1" data-world-mm="50" data-declared-mm="' + vL.toFixed(4) + '" data-axis="y">' +
    '<line x1="' + n(vx, 4) + '" y1="' + n(vy - vL, 4) + '" x2="' + n(vx, 4) + '" y2="' + n(vy, 4) +
    '" stroke="#000" stroke-width="0.4"/>' +
    '<line x1="' + n(vx - 3, 4) + '" y1="' + n(vy - vL, 4) + '" x2="' + n(vx + 3, 4) + '" y2="' + n(vy - vL, 4) + '" stroke="#000" stroke-width="0.4"/>' +
    '<line x1="' + n(vx - 3, 4) + '" y1="' + n(vy, 4) + '" x2="' + n(vx + 3, 4) + '" y2="' + n(vy, 4) + '" stroke="#000" stroke-width="0.4"/>' +
    '<text x="' + n(vx - 4, 4) + '" y="' + n(vy - vL / 2, 4) + '" font-size="2.9" font-family="sans-serif" fill="#000" text-anchor="end">5cm</text></g>');

  s.push('</svg>');
  return s.join('');
}

/* =========================================================================
 * 8. 전체 배치 축소 미리보기
 * =======================================================================*/
function buildPreview(ctx, forEmbed) {
  var o = ctx.opt, s = [];
  var gridW = ctx.previewW, gridH = ctx.previewH;

  s.push('<rect x="0" y="0" width="' + n(gridW) + '" height="' + n(gridH) + '" fill="#ffffff" stroke="#dddddd" stroke-width="0.4"/>');

  if (ctx.mode === 'a4') {
    for (var r = 0; r < ctx.rows; r++) {
      for (var c = 0; c < ctx.cols; c++) {
        var x = c * ctx.worldStepX, y = r * ctx.worldStepY;
        var w = ctx.contentWmm / ctx.k, h = ctx.contentHmm / ctx.k;
        s.push('<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) +
               '" fill="none" stroke="#9bb0c9" stroke-width="0.7" stroke-dasharray="4 3"/>');
        s.push('<text x="' + n(x + w / 2) + '" y="' + n(y + h / 2) + '" font-size="' + n(Math.min(w, h) * 0.22) +
               '" font-family="sans-serif" fill="#c3d0e0" font-weight="700" text-anchor="middle">' +
               esc(colLabel(c) + (r + 1)) + '</text>');
      }
    }
  } else {
    s.push('<rect x="0" y="0" width="' + n(gridW) + '" height="' + n(gridH) +
           '" fill="none" stroke="#9bb0c9" stroke-width="0.8"/>');
  }

  /* 조각 실루엣 */
  for (var i = 0; i < ctx.pieces.length; i++) {
    var pc = ctx.pieces[i], pl = ctx.placed[i];
    s.push('<g transform="' + placeTransform(pc, pl, ctx.padMm) + '">' +
      '<path d="' + pathFrom(pc.seamline || pc.outline, true) + '" fill="#eef3f9" stroke="#3a566f" stroke-width="1.2"/>' +
      '</g>');
    var cx = pl.x + ctx.padMm + pl.w / 2, cy = pl.y + ctx.padMm + pl.h / 2;
    s.push('<text x="' + n(cx) + '" y="' + n(cy) + '" font-size="9" font-family="sans-serif" fill="#2b3d4f" ' +
      'font-weight="700" text-anchor="middle">' + esc(pc.name) + (pl.rot ? ' (90°)' : '') + '</text>');
  }

  var inner = s.join('');
  if (forEmbed) return inner;

  var maxPx = 820;
  var scale = Math.min(maxPx / gridW, 1.6);
  return '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ' +
    'width="' + Math.round(gridW * scale) + '" height="' + Math.round(gridH * scale) + '" ' +
    'viewBox="0 0 ' + n(gridW) + ' ' + n(gridH) + '" preserveAspectRatio="xMidYMid meet" ' +
    'data-ndp-preview="1" style="max-width:100%;height:auto">' + inner + '</svg>';
}

/* =========================================================================
 * 9. 메인 — buildPrintLayout
 * =======================================================================*/
function buildPrintLayout(draft, opt) {
  var o = {}, key;
  for (key in DEFAULTS) if (DEFAULTS.hasOwnProperty(key)) o[key] = DEFAULTS[key];
  if (opt) for (key in opt) if (opt.hasOwnProperty(key) && opt[key] !== undefined) o[key] = opt[key];

  var warnings = [];
  var uid = ++UID;

  if (!draft || !draft.pieces || !draft.pieces.length) {
    throw new Error('NoDartPrint.buildPrintLayout: draft.pieces 가 비어 있습니다.');
  }

  /* 인쇄 보정계수 k : world mm → declared mm */
  var cal = +o.calibMm;
  if (!isFinite(cal) || cal < 30 || cal > 70) { if (isFinite(cal) && cal !== 50) warnings.push('calibMm ' + cal + ' 은 허용범위(30~70mm) 밖 — 보정 무시'); cal = 50; }
  var k = 50 / cal;

  /* 부위별 시접 정규화 (SPEC §11-1) */
  o._seam = normalizeSeamOpt(o.seam, warnings);

  var pieces = normalizePieces(draft, o, warnings);
  if (!pieces.length) throw new Error('NoDartPrint.buildPrintLayout: 유효한 조각이 없습니다.');

  var sizeLabel = draft.size || '';
  var mode = (o.mode === 'roll') ? 'roll' : 'a4';

  /* 전 조각이 쓰는 부위 합집합 → 페이지 정보띠 문구 */
  var allRoles = [], rq, pz2;
  for (pz2 = 0; pz2 < pieces.length; pz2++) {
    for (rq = 0; rq < pieces[pz2].rolesUsed.length; rq++) {
      if (allRoles.indexOf(pieces[pz2].rolesUsed[rq]) < 0) allRoles.push(pieces[pz2].rolesUsed[rq]);
    }
  }
  var seamNote = (o._seam.maxCm > 0)
    ? ('시접  ' + seamSummary(o._seam.byRole, allRoles.length ? allRoles : null) + '  · 골선 0')
    : '시접 없음 (완성선 그대로)';

  var ctx = {
    opt: o, k: k, uid: uid, pieces: pieces, mode: mode,
    padMm: o.padMm, warnings: warnings, seamNote: seamNote
  };

  var placed, canvasW, canvasH;
  var cols = 1, rows = 1;
  var contentWmm = 0, contentHmm = 0, worldStepX = 0, worldStepY = 0;
  var rollWmm = 0, rollHmm = 0;

  if (mode === 'a4') {
    contentWmm = A4_W - 2 * o.marginMm;            // declared mm
    contentHmm = A4_H - o.marginMm - o.footerMm;   // declared mm
    var worldContentW = contentWmm / k;
    var worldContentH = contentHmm / k;
    worldStepX = worldContentW - o.overlapMm;
    worldStepY = worldContentH - o.overlapMm;
    if (worldStepX <= 1 || worldStepY <= 1) {
      throw new Error('겹침(overlapMm=' + o.overlapMm + ')이 유효 인쇄영역보다 큽니다.');
    }
    var best = bestPackA4(pieces, o, worldContentW, worldContentH, worldStepX, worldStepY);
    placed = best.res.placed;
    canvasW = best.cw; canvasH = best.ch;
    cols = best.cols; rows = best.rows;
    ctx.contentWmm = contentWmm; ctx.contentHmm = contentHmm;
    ctx.worldStepX = worldStepX; ctx.worldStepY = worldStepY;
    ctx.cols = cols; ctx.rows = rows;
    ctx.previewW = o.overlapMm + cols * worldStepX;   // 페이지가 덮는 전체 world 폭
    ctx.previewH = o.overlapMm + rows * worldStepY;
  } else {
    rollWmm = +o.rollWidthMm || 594;
    var usableW = (rollWmm - 2 * o.rollMarginMm) / k;   // world mm
    /* 장 경계를 걸치지 않게 — 프린터 최대 길이가 있으면 그 안쪽 높이를 넘겨 준다 */
    var pageUsable = (+o.rollMaxHmm > 0)
      ? ((+o.rollMaxHmm - (2 * o.rollMarginMm + 26 + 8)) / k) - 2 * o.padMm : 0;
    var res = pack(pieces, usableW - 2 * o.padMm, o.gapMm, o.allowRotate, pageUsable);
    placed = res.placed;
    canvasW = res.w + 2 * o.padMm; canvasH = res.h + 2 * o.padMm;
    if (canvasW > usableW + 1e-6) {
      warnings.push('조각 폭 ' + (canvasW / 10).toFixed(1) + 'cm 가 롤지 유효폭 ' + (usableW / 10).toFixed(1) +
                    'cm 를 초과합니다. 조각 하나가 A1 폭보다 넓어 잘립니다 — A4 타일 모드를 쓰세요.');
    }
    /* ★ 롤지는 **길이 제한이 없다** — 페이지를 A1 규격(594×841)에 맞추지 않고
       **패턴이 차지하는 크기 그대로** 잡는다. 폭도 롤 폭까지 채우지 않고 배치 폭에
       맞춰 줄인다 (594 로 고정하면 좌우가 비어 롤이 낭비되고, 뷰어가 A1 로 인식해
       841 에서 잘리기도 한다). 폭은 물리적 롤 폭을 절대 넘지 않는다. */
    rollHmm = 2 * o.rollMarginMm + 26 + canvasH * k + 8;
    if (o.rollFitWidth !== false) {
      rollWmm = Math.min(rollWmm, 2 * o.rollMarginMm + canvasW * k);
    }
    ctx.previewW = canvasW; ctx.previewH = canvasH;
    ctx.rollWmm = rollWmm; ctx.rollHmm = rollHmm;
    /* ★ 프린터가 받는 최대 길이를 넘으면 **여러 장으로 나눈다** — 안 나누면
       뷰어·드라이버가 규격 용지로 잡아 뒤쪽(대개 소매)을 잘라 버린다. */
    ctx.rollPages = splitRollPages(placed, canvasH, o, k);
    /* 장마다 길이가 다르면 @page 로 표현할 수 없다 — **가장 긴 장에 맞춰 통일**한다.
       짧은 장은 아래가 비는 것뿐이고, 프린터에는 한 가지 용지 크기만 넣으면 된다. */
    var hMax = 0;
    ctx.rollPages.forEach(function (pg) { if (pg.h > hMax) hMax = pg.h; });
    ctx.rollPages.forEach(function (pg) { pg.h = hMax; });
    rollHmm = 2 * o.rollMarginMm + 26 + hMax * k + 8;
    ctx.rollHmm = rollHmm;
    if (ctx.rollPages.length > 1) {
      warnings.push('롤지 길이 ' + (rollHmm / 10).toFixed(1) + 'cm 가 최대 ' +
        (o.rollMaxHmm / 10).toFixed(1) + 'cm 를 넘어 ' + ctx.rollPages.length + '장으로 나눴습니다.');
    }
  }

  ctx.placed = placed;
  ctx.canvasW = canvasW;
  ctx.canvasH = canvasH;

  /* 조각 배치 마크업 (world mm) */
  var body = [], i;
  for (i = 0; i < pieces.length; i++) {
    body.push('<g data-ndp-piece="' + esc(pieces[i].id) + '" transform="' +
      placeTransform(pieces[i], placed[i], o.padMm) + '">' +
      renderPiece(pieces[i], o, sizeLabel) + '</g>');
  }
  ctx.bodyMarkup = body.join('');
  ctx.pieceMarkup = body;          // 롤지 분할에서 페이지별로 골라 쓴다

  /* 페이지 생성 */
  var pagesSvg = [], pageIds = [];
  var previewInner = buildPreview(ctx, true);
  var layoutPreviewSvg = buildPreview(ctx, false);

  if (mode === 'a4') {
    if (o.overview) pagesSvg.push(buildOverviewPage(ctx, previewInner));
    var built = buildA4Pages(ctx);
    pagesSvg = pagesSvg.concat(built.pages);
    pageIds = built.pageIds;
  } else {
    var rp = ctx.rollPages || [{ y0: -o.padMm, h: ctx.canvasH, idx: null }];
    for (var rpi = 0; rpi < rp.length; rpi++) {
      pagesSvg.push(buildRollPage(ctx, rp[rpi], rpi, rp.length));
      pageIds.push(['ROLL' + (rp.length > 1 ? String(rpi + 1) : '')]);
    }
  }

  /* 배치 정보 */
  var placements = [];
  for (i = 0; i < pieces.length; i++) {
    placements.push({
      id: pieces[i].id, name: pieces[i].name, cutCount: pieces[i].cutCount,
      xMm: placed[i].x + o.padMm, yMm: placed[i].y + o.padMm,
      wMm: placed[i].w, hMm: placed[i].h, rotated: !!placed[i].rot,
      seamSource: pieces[i].seamSource
    });
  }
  var pieceInfo = [];
  for (i = 0; i < pieces.length; i++) {
    pieceInfo.push({
      id: pieces[i].id, name: pieces[i].name,
      outlineBboxMm: pieces[i].outlineBbox,
      declaredBboxMm: pieces[i].declaredBbox,
      deltaMm: pieces[i].bboxDelta,
      outlineAreaMm2: Math.abs(polyArea(pieces[i].outline)),
      seamAreaMm2: pieces[i].seamline ? Math.abs(polyArea(pieces[i].seamline)) : null,
      notchCount: pieces[i].notches.length,
      notchAnglesDeg: pieces[i].notches.map(function (q) { return q.deg; }),
      notchRoles: pieces[i].notches.map(function (q) { return q.role; }),
      notchOutMm: pieces[i].notches.map(function (q) { return q.seamMm; }),
      seamSource: pieces[i].seamSource,
      seamTier: pieces[i].seamTier,
      seamPointCount: pieces[i].seamline ? pieces[i].seamline.length : 0,
      seamSelfIntersections: pieces[i].seamSelfInt,
      seamLoopsRemoved: pieces[i].seamLoopsRemoved,
      byRole: pieces[i].byRole,
      rolesUsed: pieces[i].rolesUsed,
      hasEdgeRoles: pieces[i].hasEdgeRoles,
      foldRangeCount: pieces[i].foldRanges.length,
      foldVertexCount: pieces[i].foldMask.filter(function (v) { return v; }).length,
      foldSeamGapMm: pieces[i].foldSeamGapMm   // 골선에서 seamline 이 outline 과 벌어진 최대거리(0 이어야 함)
    });
  }

  var pageCss = (mode === 'a4')
    ? '@page{size:' + A4_W + 'mm ' + A4_H + 'mm;margin:0}'
    : '@page{size:' + n(rollWmm, 2) + 'mm ' + n(rollHmm, 2) + 'mm;margin:0}';

  var info = {
    version: VERSION,
    appStamp: o.stamp || '',            // 앱 버전·빌드시각 (SPEC §17-2)
    mode: mode,
    size: sizeLabel,
    seamMode: o._seam.mode,              // 'none' | 'uniform' | 'perRole'
    seamByRole: o._seam.byRole,          // 실제 적용된 부위별 시접 (cm)
    seamMaxCm: o._seam.maxCm,
    seamNote: seamNote,
    rolesUsed: allRoles,
    seamCm: (o._seam.mode === 'uniform') ? o._seam.maxCm : null,   // 하위호환
    scaleFactor: k,
    calibMm: cal,
    pageWidthMm:  (mode === 'a4') ? A4_W : rollWmm,
    pageHeightMm: (mode === 'a4') ? A4_H : rollHmm,
    marginMm: o.marginMm,
    footerMm: (mode === 'a4') ? o.footerMm : 0,
    contentWidthMm:  contentWmm,          // declared mm (A4 만)
    contentHeightMm: contentHmm,
    worldContentWidthMm:  (mode === 'a4') ? contentWmm / k : (rollWmm - 2 * o.rollMarginMm) / k,
    worldContentHeightMm: (mode === 'a4') ? contentHmm / k : null,
    overlapMm: (mode === 'a4') ? o.overlapMm : 0,
    stepXMm: worldStepX, stepYMm: worldStepY,
    cols: cols, rows: rows,
    tilePages: (mode === 'a4') ? cols * rows : 1,
    overviewPages: (mode === 'a4' && o.overview) ? 1 : 0,
    pageIds: pageIds,
    canvas: { wMm: canvasW, hMm: canvasH, padMm: o.padMm, gapMm: o.gapMm },
    coverage: (mode === 'a4')
      ? { wMm: o.overlapMm + cols * worldStepX, hMm: o.overlapMm + rows * worldStepY }
      : { wMm: canvasW, hMm: canvasH },
    calibration: { worldMm: 50, declaredMm: 50 * k },
    placements: placements,
    pieces: pieceInfo,
    pageCss: pageCss,
    warnings: warnings
  };

  return {
    pagesSvg: pagesSvg,
    layoutPreviewSvg: layoutPreviewSvg,
    pageCount: pagesSvg.length,
    info: info
  };
}

/* =========================================================================
 * 10. 브라우저 헬퍼 (window.print 기반)
 * =======================================================================*/
function ensureArea() {
  if (typeof document === 'undefined') return null;
  var el = document.getElementById('ndp-print-area');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ndp-print-area';
    document.body.appendChild(el);
  }
  return el;
}

/** 생성된 레이아웃을 인쇄 영역에 심는다. */
function renderTo(layout, container) {
  var el = container || ensureArea();
  if (!el) return null;
  var w = layout.info.pageWidthMm, h = layout.info.pageHeightMm;
  var html = [], i;
  for (i = 0; i < layout.pagesSvg.length; i++) {
    /* height 를 0.1mm 줄여 브라우저 반올림에 의한 빈 페이지 발생을 막는다.
       svg 는 절대배치 + overflow:hidden 이므로 1:1 배율에는 영향 없음. */
    html.push('<div class="ndp-page" style="width:' + n(w, 3) + 'mm;height:' + n(h - 0.1, 3) + 'mm">' +
              layout.pagesSvg[i] + '</div>');
  }
  el.innerHTML = html.join('');
  return el;
}

/** @page 크기 규칙 주입 (롤지는 크기가 가변이므로 CSS 파일로 못 박을 수 없음) */
function applyPageCss(layout) {
  if (typeof document === 'undefined') return;
  var st = document.getElementById('ndp-page-size');
  if (!st) {
    st = document.createElement('style');
    st.id = 'ndp-page-size';
    document.head.appendChild(st);
  }
  st.textContent = layout.info.pageCss;
}

/** 빌드 → 삽입 → 인쇄. 반환값은 layout. */
function printDraft(draft, opt) {
  var layout = buildPrintLayout(draft, opt);
  applyPageCss(layout);
  renderTo(layout);
  if (typeof window !== 'undefined' && window.print) {
    /* 레이아웃 반영 뒤 인쇄 */
    if (window.requestAnimationFrame) window.requestAnimationFrame(function () { window.print(); });
    else window.print();
  }
  return layout;
}

/* =========================================================================
 * 노출
 * =======================================================================*/
var NoDartPrint = {
  VERSION: VERSION,
  DEFAULTS: DEFAULTS,
  buildPrintLayout: buildPrintLayout,
  renderTo: renderTo,
  applyPageCss: applyPageCss,
  print: printDraft,
  SEAM_DEFAULTS: SEAM_DEFAULTS,
  ROLE_KO: ROLE_KO,
  normalizeSeamOpt: function (s) { return normalizeSeamOpt(s, []); },
  /* 내부 유틸 — 테스트/검증용 */
  _offsetLoop: offsetLoop,
  _offsetLoopVarWidth: offsetLoopVarWidth,
  _countSelfIntersections: countSelfIntersections,
  _distToPoly: distToPoly,
  _seamSummary: seamSummary,
  _polyArea: polyArea,
  _bboxOf: bboxOf,
  _pack: pack,
  _colLabel: colLabel
};

if (typeof global !== 'undefined') global.NoDartPrint = NoDartPrint;
if (typeof module !== 'undefined' && module.exports) module.exports = NoDartPrint;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
