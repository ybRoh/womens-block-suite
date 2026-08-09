/* ============================================================================
 * dxf.js — 숙녀복 기본원형 II(문화식) DXF 내보내기
 * 출력팀 / SPEC.md §13
 *
 * 노출:  window.NoDartDXF.buildDXF(draft, opt)  → DXF 문자열
 *        window.NoDartDXF.build(draft, opt)     → { dxf, info }
 *        window.NoDartDXF.download(draft, opt)  → Blob 저장
 *
 * 좌표 규약
 *   draft 입력 : cm, y 아래 +  (SPEC §1)
 *   DXF 출력   : y 위 +  →  y_dxf = −y_engine   (SPEC §13-2, 필수)
 *   단위       : unit:'cm' → 1 유닛 = 1cm, $INSUNITS 5
 *                unit:'mm' → 좌표 ×10,     $INSUNITS 4
 *
 * 파일 버전 AC1021(R2007). R2007+ 는 문자열이 UTF-8 이라 한글 레이어명이
 * 그대로 들어갑니다. 원본은 AC1027 + ANSI_949 이지만 브라우저에서 EUC-KR
 * 인코딩이 번거로우므로 UTF-8 을 씁니다.
 *
 * 외부 라이브러리·CDN·ES module 사용 없음.
 * ==========================================================================*/
;(function (global) {
'use strict';

var VERSION = '1.0.0';

/* ── 레이어 (SPEC §13-3) ──────────────────────────────────────────────── */
var LAYERS = [
  { name: '완성선', color: 7, desc: 'outline 폐곡선 — 재봉선' },
  { name: '시접선', color: 5, desc: 'seamline 폐곡선 — 재단선' },
  { name: '골선',   color: 3, desc: '골선 구간(foldEdges)' },
  { name: '너치',   color: 1, desc: 'notches' },
  { name: '기준선', color: 8, desc: 'internal — BL·등품선·BP 등' },
  { name: '식서',   color: 6, desc: 'grainline' },
  { name: '문자',   color: 2, desc: '조각명·호수·재단매수·시접' }
];
var LAYER_NAMES = LAYERS.map(function (l) { return l.name; });

var DEFAULTS = {
  unit: 'cm',              // 'cm' | 'mm'
  includeSeam: true,
  includeInternal: true,
  includeText: true,
  layout: 'row',           // 'row' | 'origin'
  gapCm: 5,
  /* Douglas–Peucker 허용 편차. SPEC 상한은 0.05 지만, 엔진 자체가 원본 DXF 와
     최대 0.066cm 벌어져 있어(§13-6 참고) 내보내기가 쓸 수 있는 예산이 얼마 없다.
     0.01 이면 조각당 50~70점이면서 내보내기 기여분이 ≤0.006cm 로 억제된다. */
  simplifyTolCm: 0.01,
  textHeightCm: 0.8
};

var ROLE_KO = {
  neck: '목', shoulder: '어깨', armhole: '진동',
  side: '옆선', hem: '밑단', dart: '다트', facing: '안단 안쪽', fold: '골선'
};
var ROLE_ORDER = ['neck', 'shoulder', 'armhole', 'side', 'hem', 'dart', 'facing', 'fold'];

/* =========================================================================
 * 0. 유틸
 * =======================================================================*/
function num(v, d) {
  if (typeof v !== 'number' || !isFinite(v)) return '0.0';
  var s = v.toFixed(d === undefined ? 6 : d);
  if (s === '-0.000000') s = '0.000000';
  return s;
}
function isPt(p) { return p && isFinite(p[0]) && isFinite(p[1]); }

function bboxOf(pts) {
  var i, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (i = 0; i < pts.length; i++) {
    if (pts[i][0] < x0) x0 = pts[i][0];
    if (pts[i][1] < y0) y0 = pts[i][1];
    if (pts[i][0] > x1) x1 = pts[i][0];
    if (pts[i][1] > y1) y1 = pts[i][1];
  }
  if (!isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* [start,end] 점 범위(양끝 포함, end<start 면 0 을 지나 되감김) → 인덱스 배열 */
function rangeIdx(a, b, N) {
  if (!(a >= 0 && a < N && b >= 0 && b < N)) return null;
  var out = [], i = a;
  for (;;) { out.push(i); if (i === b) break; i = (i + 1) % N; if (out.length > N) return null; }
  return out;
}

/* =========================================================================
 * 1. Douglas–Peucker 단순화 (SPEC §13-4)
 *    조각당 3000점이라 그대로 내보내면 CAD 가 무겁고 원본 도면(fit 17~65점)과
 *    성격이 달라진다. 편차를 재서 함께 보고한다.
 * =======================================================================*/
function perpDist(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1];
  var L2 = vx * vx + vy * vy;
  if (L2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  var t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}

/** 열린 폴리라인 단순화. 양 끝점은 반드시 보존. @returns {pts, dev} */
function simplifyOpen(pts, tol) {
  var N = pts.length;
  if (N <= 2) return { pts: pts.slice(), dev: 0 };
  var keep = new Array(N);
  keep[0] = keep[N - 1] = true;
  var maxDev = 0;
  var stack = [[0, N - 1]];
  while (stack.length) {
    var seg = stack.pop(), s = seg[0], e = seg[1];
    if (e <= s + 1) continue;
    var best = -1, bd = -1, i;
    for (i = s + 1; i < e; i++) {
      var d = perpDist(pts[i], pts[s], pts[e]);
      if (d > bd) { bd = d; best = i; }
    }
    if (bd > tol) { keep[best] = true; stack.push([s, best]); stack.push([best, e]); }
    else if (bd > maxDev) maxDev = bd;
  }
  var out = [];
  for (var j = 0; j < N; j++) if (keep[j]) out.push(pts[j]);
  return { pts: out, dev: maxDev };
}

/**
 * 폐곡선 단순화. edges[] 같은 구간 정보가 있으면 **구간마다 따로** 줄여서
 * 변의 경계점(모서리)이 절대 사라지지 않게 한다.
 * @param loop  폐곡선 점 배열 (마지막 점이 첫 점과 겹치지 않음)
 * @param ranges [{start,end}] 점 범위. 전체를 덮지 않으면 통짜로 처리.
 */
function simplifyLoop(loop, ranges, tol) {
  var N = loop.length;
  if (N <= 3) return { pts: loop.slice(), dev: 0, mode: 'asis' };

  var usable = false, covered = null, i, j;
  if (ranges && ranges.length) {
    covered = new Array(N);
    usable = true;
    for (i = 0; i < ranges.length; i++) {
      var idx = rangeIdx(ranges[i].start, ranges[i].end, N);
      if (!idx) { usable = false; break; }
      for (j = 0; j < idx.length; j++) covered[idx[j]] = true;
    }
    if (usable) for (i = 0; i < N; i++) if (!covered[i]) { usable = false; break; }
  }

  if (!usable) {
    /* 통짜: 0 을 고정점으로 두고 열린 폴리라인처럼 줄인 뒤 닫는다 */
    var r = simplifyOpen(loop.concat([loop[0]]), tol);
    var pts = r.pts;
    if (pts.length > 1) pts = pts.slice(0, pts.length - 1);   // 닫는 중복점 제거
    return { pts: pts, dev: r.dev, mode: 'whole' };
  }

  /* 구간별 — 구간은 서로 겹치지 않고(엔진은 disjoint 점 범위) 순서대로 이어붙인다 */
  var sorted = ranges.slice().sort(function (a, b) { return a.start - b.start; });
  var out = [], dev = 0;
  for (i = 0; i < sorted.length; i++) {
    var ii = rangeIdx(sorted[i].start, sorted[i].end, N);
    var sub = [];
    for (j = 0; j < ii.length; j++) sub.push(loop[ii[j]]);
    var rr = simplifyOpen(sub, tol);
    if (rr.dev > dev) dev = rr.dev;
    for (j = 0; j < rr.pts.length; j++) {
      var p = rr.pts[j], q = out[out.length - 1];
      if (q && Math.abs(q[0] - p[0]) < 1e-12 && Math.abs(q[1] - p[1]) < 1e-12) continue;
      out.push(p);
    }
  }
  /* 끝점이 시작점과 같으면 닫힘 중복 제거 */
  while (out.length > 2) {
    var a0 = out[0], b0 = out[out.length - 1];
    if (Math.abs(a0[0] - b0[0]) < 1e-12 && Math.abs(a0[1] - b0[1]) < 1e-12) out.pop(); else break;
  }
  return { pts: out, dev: dev, mode: 'perEdge' };
}

/* =========================================================================
 * 2. DXF 작성기
 * =======================================================================*/
function Writer() {
  this.buf = [];
  this.handle = 0x100;
}
Writer.prototype.g = function (code, val) {
  /* 관례대로 코드는 폭 3 우측정렬. 파서는 대개 trim 하므로 값만 정확하면 됨. */
  var c = String(code);
  while (c.length < 3) c = ' ' + c;
  this.buf.push(c);
  this.buf.push(String(val));
  return this;
};
Writer.prototype.h = function () {
  this.handle += 1;
  return this.handle.toString(16).toUpperCase();
};
Writer.prototype.out = function () { return this.buf.join('\n') + '\n'; };

/* =========================================================================
 * 3. 메인
 * =======================================================================*/
function build(draft, opt) {
  var o = {}, k;
  for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) o[k] = DEFAULTS[k];
  if (opt) for (k in opt) if (opt.hasOwnProperty(k) && opt[k] !== undefined) o[k] = opt[k];

  if (!draft || !draft.pieces || !draft.pieces.length) {
    throw new Error('NoDartDXF.build: draft.pieces 가 비어 있습니다.');
  }

  var warnings = [];
  var U = (o.unit === 'mm') ? 10 : 1;                 // cm → 출력 단위
  var insunits = (o.unit === 'mm') ? 4 : 5;
  var sizeLabel = draft.size || '';

  /* ── 조각 배치 ─────────────────────────────────────────────────────
     'row'  : 시접선 포함 bbox 로 가로 나열 (겹치지 않게)
     'origin': 각 조각을 자기 로컬 원점 그대로 (원본 좌표 대조용) */
  var placed = [], cursor = 0, pi;
  for (pi = 0; pi < draft.pieces.length; pi++) {
    var p = draft.pieces[pi] || {};
    var ol = (p.outline || []).filter(isPt);
    if (ol.length < 3) { warnings.push('조각 "' + (p.name || p.id) + '" outline 점이 3개 미만 — 건너뜀'); continue; }
    var all = ol.slice();
    if (o.includeSeam && p.seamline && p.seamline.length > 2) all = all.concat(p.seamline.filter(isPt));
    var bb = bboxOf(all);
    var off = { x: 0, y: 0 };
    if (o.layout !== 'origin') { off.x = cursor - bb.x; cursor += bb.w + o.gapCm; }
    placed.push({ piece: p, outline: ol, bbox: bb, off: off });
  }
  if (!placed.length) throw new Error('NoDartDXF.build: 유효한 조각이 없습니다.');

  /* 좌표 변환: 배치 오프셋 → y 뒤집기 → 단위 배율 */
  var ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  function T(pt, off) {
    var X = (pt[0] + off.x) * U;
    var Y = -(pt[1] + off.y) * U;          // ★ y 뒤집기 (SPEC §13-2)
    if (X < ext.x0) ext.x0 = X;
    if (Y < ext.y0) ext.y0 = Y;
    if (X > ext.x1) ext.x1 = X;
    if (Y > ext.y1) ext.y1 = Y;
    return [X, Y];
  }

  /* ── ENTITIES 먼저 만들어야 EXTMIN/EXTMAX 를 채울 수 있다 ───────────── */
  var ent = new Writer();
  var usedLayers = {};
  var stat = {
    pieces: [], entities: { LWPOLYLINE: 0, LINE: 0, POINT: 0, TEXT: 0 },
    order: []            // 완성선 폴리라인이 어느 조각인지 (검증용)
  };
  var maxDev = 0;

  function lwpoly(pts, layer, closed, off) {
    if (!pts || pts.length < 2) return;
    usedLayers[layer] = 1;
    ent.g(0, 'LWPOLYLINE').g(5, ent.h()).g(100, 'AcDbEntity').g(8, layer)
       .g(100, 'AcDbPolyline').g(90, pts.length).g(70, closed ? 1 : 0);
    for (var i = 0; i < pts.length; i++) {
      var q = T(pts[i], off);
      ent.g(10, num(q[0])).g(20, num(q[1]));
    }
    stat.entities.LWPOLYLINE++;
  }
  function line(a, b, layer, off) {
    if (!isPt(a) || !isPt(b)) return;
    usedLayers[layer] = 1;
    var p1 = T(a, off), p2 = T(b, off);
    ent.g(0, 'LINE').g(5, ent.h()).g(100, 'AcDbEntity').g(8, layer).g(100, 'AcDbLine')
       .g(10, num(p1[0])).g(20, num(p1[1])).g(30, '0.0')
       .g(11, num(p2[0])).g(21, num(p2[1])).g(31, '0.0');
    stat.entities.LINE++;
  }
  function point(a, layer, off) {
    if (!isPt(a)) return;
    usedLayers[layer] = 1;
    var q = T(a, off);
    ent.g(0, 'POINT').g(5, ent.h()).g(100, 'AcDbEntity').g(8, layer).g(100, 'AcDbPoint')
       .g(10, num(q[0])).g(20, num(q[1])).g(30, '0.0');
    stat.entities.POINT++;
  }
  function text(a, s, layer, off, h) {
    if (!isPt(a) || !s) return;
    usedLayers[layer] = 1;
    var q = T(a, off);
    ent.g(0, 'TEXT').g(5, ent.h()).g(100, 'AcDbEntity').g(8, layer).g(100, 'AcDbText')
       .g(10, num(q[0])).g(20, num(q[1])).g(30, '0.0')
       .g(40, num((h || o.textHeightCm) * U)).g(1, String(s)).g(7, 'Standard')
       .g(100, 'AcDbText');
    stat.entities.TEXT++;
  }

  for (pi = 0; pi < placed.length; pi++) {
    var it = placed[pi], pc = it.piece, off = it.off, ol2 = it.outline;
    var N = ol2.length;
    var pname = pc.name || pc.id || ('조각' + (pi + 1));
    var pstat = { id: pc.id, name: pname, outlinePts: N };

    /* 완성선 — edges[] 범위로 구간별 단순화 (모서리 보존) */
    var oRanges = null;
    if (pc.edges && pc.edges.length) {
      oRanges = [];
      for (var e1 = 0; e1 < pc.edges.length; e1++) {
        var ed = pc.edges[e1];
        if (ed && isFinite(ed.start) && isFinite(ed.end)) oRanges.push({ start: ed.start | 0, end: ed.end | 0 });
      }
      if (!oRanges.length) oRanges = null;
    }
    var so = simplifyLoop(ol2, oRanges, o.simplifyTolCm);
    if (so.dev > maxDev) maxDev = so.dev;
    stat.order.push({ layer: '완성선', id: pc.id, name: pname });
    lwpoly(so.pts, '완성선', true, off);
    pstat.outlineSimplified = so.pts.length;
    pstat.outlineDevCm = so.dev;
    pstat.outlineMode = so.mode;

    /* 시접선 */
    if (o.includeSeam && pc.seamline && pc.seamline.length > 2) {
      var sl = pc.seamline.filter(isPt);
      var sRanges = null;
      if (pc.seamEdges && pc.seamEdges.length) {
        sRanges = [];
        for (var e2 = 0; e2 < pc.seamEdges.length; e2++) {
          var se = pc.seamEdges[e2];
          if (se && isFinite(se.start) && isFinite(se.end)) sRanges.push({ start: se.start | 0, end: se.end | 0 });
        }
        if (!sRanges.length) sRanges = null;
      }
      var ss = simplifyLoop(sl, sRanges, o.simplifyTolCm);
      if (ss.dev > maxDev) maxDev = ss.dev;
      lwpoly(ss.pts, '시접선', true, off);
      pstat.seamPts = sl.length;
      pstat.seamSimplified = ss.pts.length;
      pstat.seamDevCm = ss.dev;
    }

    /* 골선 — foldEdges(outline 인덱스) 구간을 한 번 더, 열린 폴리라인 */
    pstat.foldRanges = 0;
    if (pc.foldEdges && pc.foldEdges.length) {
      for (var f1 = 0; f1 < pc.foldEdges.length; f1++) {
        var fr = pc.foldEdges[f1];
        if (!fr || fr.length < 2) continue;
        var fidx = rangeIdx(fr[0] | 0, fr[1] | 0, N);
        if (!fidx) { warnings.push('조각 "' + pname + '": foldEdges [' + fr + '] 가 outline 인덱스 범위 밖 — 무시'); continue; }
        var fpts = [];
        for (var f2 = 0; f2 < fidx.length; f2++) fpts.push(ol2[fidx[f2]]);
        var sf = simplifyOpen(fpts, o.simplifyTolCm);
        if (sf.dev > maxDev) maxDev = sf.dev;
        lwpoly(sf.pts, '골선', false, off);
        pstat.foldRanges++;
      }
    }

    /* 너치 — p 에서 angle(도) 방향으로 0.5cm LINE (SPEC §13-4) */
    pstat.notches = 0;
    var nt = pc.notches || [];
    for (var n1 = 0; n1 < nt.length; n1++) {
      var nn = nt[n1];
      if (!nn || !isPt(nn.p)) continue;
      var ang = +nn.angle;
      if (!isFinite(ang)) ang = 0;
      var r = ang * Math.PI / 180;           // 도(°) — SPEC §8.1 확정
      line(nn.p, [nn.p[0] + Math.cos(r) * 0.5, nn.p[1] + Math.sin(r) * 0.5], '너치', off);
      pstat.notches++;
    }

    /* 기준선 */
    pstat.internal = 0;
    if (o.includeInternal) {
      var iv = pc.internal || [];
      for (var i1 = 0; i1 < iv.length; i1++) {
        var itm = iv[i1];
        if (!itm || !itm.pts || !itm.pts.length) continue;
        var ip = itm.pts.filter(isPt);
        if (!ip.length) continue;
        if (itm.type === 'point') { point(ip[0], '기준선', off); pstat.internal++; }
        else if (ip.length >= 2) {
          var si = simplifyOpen(ip, o.simplifyTolCm);
          if (si.pts.length === 2) line(si.pts[0], si.pts[1], '기준선', off);
          else lwpoly(si.pts, '기준선', false, off);
          pstat.internal++;
        }
      }
    }

    /* 식서 — 화살표 없이 LINE */
    if (pc.grainline && pc.grainline.length >= 2 &&
        isPt(pc.grainline[0]) && isPt(pc.grainline[pc.grainline.length - 1])) {
      line(pc.grainline[0], pc.grainline[pc.grainline.length - 1], '식서', off);
      pstat.grainline = 1;
    } else pstat.grainline = 0;

    /* 문자 */
    if (o.includeText) {
      var bb2 = bboxOf(ol2);
      var tx = bb2.x + bb2.w * 0.22, ty = bb2.y + bb2.h * 0.45;
      var cut = (pc.cutCount == null ? 2 : pc.cutCount);
      text([tx, ty], (sizeLabel ? sizeLabel + ' ' : '') + pname + ' · ' + cut + '매', '문자', off);
      var sm = seamSummary(pc.seamByRole);
      if (sm) text([tx, ty + o.textHeightCm * 1.6], sm, '문자', off, o.textHeightCm * 0.75);
    }

    stat.pieces.push(pstat);
  }

  if (!isFinite(ext.x0)) { ext = { x0: 0, y0: 0, x1: 0, y1: 0 }; }

  /* ── 미선언 레이어 참조 검사 ── */
  for (var ul in usedLayers) {
    if (LAYER_NAMES.indexOf(ul) < 0) warnings.push('선언되지 않은 레이어 "' + ul + '" 를 참조함');
  }

  /* ── HEADER + TABLES + ENTITIES 조립 ─────────────────────────────── */
  var w = new Writer();
  w.g(999, 'NoDartDXF v' + VERSION + ' — 숙녀복 기본원형 II ' + (sizeLabel || '') +
        ' / unit=' + o.unit + ' / layout=' + o.layout);

  /* HEADER */
  w.g(0, 'SECTION').g(2, 'HEADER');
  w.g(9, '$ACADVER').g(1, 'AC1021');                 // R2007 — 문자열 UTF-8
  w.g(9, '$HANDSEED').g(5, 'FFFF');
  w.g(9, '$INSUNITS').g(70, insunits);               // 5=cm, 4=mm
  w.g(9, '$MEASUREMENT').g(70, 1);                   // 1 = metric
  w.g(9, '$LUNITS').g(70, 2);
  w.g(9, '$LUPREC').g(70, 4);
  w.g(9, '$EXTMIN').g(10, num(ext.x0)).g(20, num(ext.y0)).g(30, '0.0');
  w.g(9, '$EXTMAX').g(10, num(ext.x1)).g(20, num(ext.y1)).g(30, '0.0');
  w.g(9, '$LIMMIN').g(10, num(ext.x0)).g(20, num(ext.y0));
  w.g(9, '$LIMMAX').g(10, num(ext.x1)).g(20, num(ext.y1));
  w.g(0, 'ENDSEC');

  /* TABLES — LTYPE(CONTINUOUS) · LAYER · STYLE(Standard) */
  w.g(0, 'SECTION').g(2, 'TABLES');

  w.g(0, 'TABLE').g(2, 'LTYPE').g(5, '5').g(100, 'AcDbSymbolTable').g(70, 1);
  w.g(0, 'LTYPE').g(5, '14').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLinetypeTableRecord')
   .g(2, 'CONTINUOUS').g(70, 0).g(3, 'Solid line').g(72, 65).g(73, 0).g(40, '0.0');
  w.g(0, 'ENDTAB');

  w.g(0, 'TABLE').g(2, 'LAYER').g(5, '2').g(100, 'AcDbSymbolTable').g(70, LAYERS.length);
  for (var li = 0; li < LAYERS.length; li++) {
    w.g(0, 'LAYER').g(5, (0x40 + li).toString(16).toUpperCase())
     .g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLayerTableRecord')
     .g(2, LAYERS[li].name).g(70, 0).g(62, LAYERS[li].color).g(6, 'CONTINUOUS')
     .g(370, -3).g(390, 'F');
  }
  w.g(0, 'ENDTAB');

  w.g(0, 'TABLE').g(2, 'STYLE').g(5, '3').g(100, 'AcDbSymbolTable').g(70, 1);
  w.g(0, 'STYLE').g(5, '11').g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbTextStyleTableRecord')
   .g(2, 'Standard').g(70, 0).g(40, '0.0').g(41, '1.0').g(50, '0.0').g(71, 0)
   .g(42, num(o.textHeightCm * U, 3)).g(3, 'txt.shx').g(4, '');
  w.g(0, 'ENDTAB');

  w.g(0, 'ENDSEC');

  /* ENTITIES */
  w.g(0, 'SECTION').g(2, 'ENTITIES');
  w.buf = w.buf.concat(ent.buf);
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');

  var dxf = w.out();

  var info = {
    version: VERSION,
    acadver: 'AC1021',
    size: sizeLabel,
    unit: o.unit, unitScale: U, insunits: insunits,
    layout: o.layout, gapCm: o.gapCm,
    includeSeam: !!o.includeSeam, includeInternal: !!o.includeInternal, includeText: !!o.includeText,
    simplifyTolCm: o.simplifyTolCm,
    simplifyDevCm: maxDev,                        // SPEC §13-4 요구
    extMin: [ext.x0, ext.y0], extMax: [ext.x1, ext.y1],
    layers: LAYERS.map(function (l) { return l.name; }),
    layersUsed: Object.keys(usedLayers),
    entities: stat.entities,
    outlineOrder: stat.order,
    pieces: stat.pieces,
    byteLength: dxf.length,
    warnings: warnings
  };
  LAST_INFO = info;
  return { dxf: dxf, info: info };
}

function seamSummary(byRole) {
  if (!byRole) return '';
  var out = [], i, r;
  for (i = 0; i < ROLE_ORDER.length; i++) {
    r = ROLE_ORDER[i];
    if (r === 'fold') continue;
    if (byRole[r] === undefined || !(byRole[r] > 0)) continue;
    out.push(ROLE_KO[r] + ' ' + (+byRole[r]).toFixed(1));
  }
  return out.length ? ('시접 ' + out.join(' · ')) : '시접 없음';
}

var LAST_INFO = null;

/** SPEC §13-1 시그니처 — DXF 문자열만 반환. info 는 lastInfo() 로. */
function buildDXF(draft, opt) { return build(draft, opt).dxf; }

function suggestName(draft, opt) {
  var o = opt || {};
  var sz = (draft && draft.size) ? draft.size : '원형';
  return '숙녀복기본원형2_' + sz + '_' + (o.unit === 'mm' ? 'mm' : 'cm') + '.dxf';
}

/** 브라우저 저장 */
function download(draft, opt) {
  var r = build(draft, opt);
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return r;
  /* DXF R2007 은 UTF-8. BOM 은 넣지 않는다(일부 리더가 첫 그룹코드를 못 읽음). */
  var blob = new Blob([r.dxf], { type: 'application/dxf;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = (opt && opt.filename) || suggestName(draft, opt);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  return r;
}

/* =========================================================================
 * 4. 노출
 * =======================================================================*/
var NoDartDXF = {
  VERSION: VERSION,
  DEFAULTS: DEFAULTS,
  LAYERS: LAYERS,
  buildDXF: buildDXF,
  build: build,
  download: download,
  suggestName: suggestName,
  lastInfo: function () { return LAST_INFO; },
  /* 내부 유틸 — 검증용 */
  _simplifyOpen: simplifyOpen,
  _simplifyLoop: simplifyLoop,
  _perpDist: perpDist,
  _rangeIdx: rangeIdx
};

if (typeof global !== 'undefined') global.NoDartDXF = NoDartDXF;
if (typeof module !== 'undefined' && module.exports) module.exports = NoDartDXF;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
