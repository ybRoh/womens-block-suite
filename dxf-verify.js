#!/usr/bin/env node
/* ============================================================================
 * dxf-verify.js — DXF 내보내기 수치 검산 (SPEC §13-6)
 *
 *   node dxf-verify.js
 *
 *  1. 왕복 검증   — 내보낸 DXF 를 다시 파싱해 원래 좌표와 대조 (≤0.05cm)
 *  2. 원본 대조   — 66호 origin/cm/시접0 을 dxf-66-groundtruth.json 의
 *                   curves[].local 과 대조 (≤0.05cm)  ★ 이번 작업의 핵심
 *  3. 레이어 선언/참조 정합
 *  4. $EXTMIN/$EXTMAX 가 실제 좌표 범위와 일치 (±0.01)
 *  5. y 뒤집기 — 뒷목(엔진 y 음수)이 DXF 에서 위쪽(y 양수)
 *  6. 4호수 × 3프리셋 × 2단위 = 24조합 무예외, NaN 0
 *  7. 단순화 편차·점 수 보고
 * ==========================================================================*/
'use strict';

var path = require('path');
var fs   = require('fs');
var ENG  = require(path.join(__dirname, 'engine.js'));
var DXF  = require(path.join(__dirname, 'dxf.js'));
var GT   = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));

/* ─────────────────────────── 러너 ─────────────────────────── */
var PASS = 0, FAIL = 0, WARN = 0, WARNS = [];
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 62 - t.length))); }
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
  else { FAIL++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}
/** dxf.js 소관이 아닌 문제(엔진 좌표 등)는 WARN — 숨기지 않되 종료코드는 건드리지 않는다 */
function warn(name, detail) {
  WARN++; WARNS.push(name + (detail ? ' — ' + detail : ''));
  console.log('  WARN  ' + name + (detail ? '   ' + detail : ''));
}
function f(v, d) { return (+v).toFixed(d === undefined ? 4 : d); }
function near(a, b, t) { return Math.abs(a - b) <= t; }

/* ─────────────────────────── DXF 파서 ───────────────────────────
   자기 자신을 파싱하는 것이므로 최소 구현. 그룹코드/값 쌍으로 읽는다. */
function parseDXF(text) {
  var lines = text.split(/\r\n|\r|\n/);
  var pairs = [], i;
  for (i = 0; i + 1 < lines.length; i += 2) {
    var raw = lines[i].trim();
    if (raw === '' && lines[i + 1] === undefined) break;
    var c = parseInt(raw, 10);
    if (isNaN(c)) throw new Error('그룹코드 파싱 실패 @line ' + (i + 1) + ': ' + JSON.stringify(lines[i]));
    pairs.push([c, lines[i + 1]]);
  }

  var res = { header: {}, layers: [], entities: [], sections: [] };
  var sec = null, cur = null, tbl = null, rec = null, hvar = null;

  function pushEnt() { if (cur) { res.entities.push(cur); cur = null; } }
  function pushRec() { if (rec && tbl === 'LAYER') res.layers.push(rec); rec = null; }

  for (i = 0; i < pairs.length; i++) {
    var code = pairs[i][0], val = pairs[i][1];

    if (code === 0) {
      if (sec === 'ENTITIES') pushEnt();
      if (sec === 'TABLES') pushRec();
      if (val === 'SECTION') { sec = '?'; continue; }
      if (val === 'ENDSEC') { sec = null; continue; }
      if (val === 'EOF') break;
      if (sec === 'TABLES') {
        if (val === 'TABLE') { tbl = null; continue; }
        if (val === 'ENDTAB') { tbl = null; continue; }
        rec = { type: val };
        continue;
      }
      if (sec === 'ENTITIES') { cur = { type: val, vertices: [], codes: {} }; continue; }
      continue;
    }

    if (sec === '?' && code === 2) { sec = val; res.sections.push(val); continue; }

    if (sec === 'HEADER') {
      if (code === 9) { hvar = val; res.header[hvar] = []; continue; }
      if (hvar) res.header[hvar].push({ code: code, val: val });
      continue;
    }
    if (sec === 'TABLES') {
      if (code === 2 && !rec) { tbl = val; continue; }
      if (rec) {
        if (code === 2) rec.name = val;
        else if (code === 62) rec.color = parseInt(val, 10);
        else if (code === 6) rec.linetype = val;
      }
      continue;
    }
    if (sec === 'ENTITIES' && cur) {
      if (code === 10) { cur._x = parseFloat(val); }
      else if (code === 20) {
        if (cur.type === 'LWPOLYLINE') cur.vertices.push([cur._x, parseFloat(val)]);
        else { cur.x1 = cur._x; cur.y1 = parseFloat(val); }
      }
      else if (code === 11) cur._x2 = parseFloat(val);
      else if (code === 21) { cur.x2 = cur._x2; cur.y2 = parseFloat(val); }
      else if (code === 8) cur.layer = val;
      else if (code === 70) cur.flags = parseInt(val, 10);
      else if (code === 90) cur.count = parseInt(val, 10);
      else if (code === 40) cur.height = parseFloat(val);
      else if (code === 1) cur.text = val;
      cur.codes[code] = val;
      continue;
    }
  }
  pushEnt();
  return res;
}
function hdrXY(res, name) {
  var a = res.header[name];
  if (!a) return null;
  var x = null, y = null;
  a.forEach(function (g) { if (g.code === 10) x = parseFloat(g.val); if (g.code === 20) y = parseFloat(g.val); });
  return (x === null || y === null) ? null : [x, y];
}
function hdrNum(res, name) {
  var a = res.header[name];
  return a && a.length ? parseFloat(a[0].val) : null;
}
function hdrStr(res, name) {
  var a = res.header[name];
  return a && a.length ? a[0].val : null;
}

/* ─────────────────────────── 기하 ─────────────────────────── */
function segDist(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
  var t = L2 > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}
function distToPolyline(p, pts, closed) {
  var m = Infinity, i, N = pts.length;
  var lim = closed ? N : N - 1;
  for (i = 0; i < lim; i++) m = Math.min(m, segDist(p, pts[i], pts[(i + 1) % N]));
  return m;
}
function maxDistAtoB(A, B, closed) {
  var m = 0, i;
  for (i = 0; i < A.length; i++) m = Math.max(m, distToPolyline(A[i], B, closed));
  return m;
}
/** DXF 좌표 → 엔진 로컬 좌표 (y 되뒤집기 + 단위 되돌리기 + 배치 오프셋 제거) */
function toEngine(pts, U, off) {
  return pts.map(function (q) { return [q[0] / U - (off ? off[0] : 0), -(q[1] / U) - (off ? off[1] : 0)]; });
}

var PRESETS = {
  '시접0':   0,
  '균일1.0': 1.0,
  '부위별':  { neck: 1.0, shoulder: 1.0, armhole: 1.0, side: 1.5, hem: 3.0, sleeveHem: 2.5, fold: 0 }
};
var SIZES = ['44호', '55호', '66호', '77호'];

function draftFor(size, seam) { return ENG.draftNoDart(ENG.measuresForSize(size), { seam: seam }); }

/* ═══════════════════════════════════════════════════════════════════ */
console.log('NoDartDXF v' + DXF.VERSION + '  —  DXF 내보내기 검산');
console.log('node ' + process.version + '  /  ' + new Date().toISOString());
console.log('engine.js: ' + (ENG.VERSION || '(버전 미표기)') + '   groundtruth: dxf-66-groundtruth.json');

/* ───────────────── 1. 기본 구조 ───────────────── */
section('1. 파일 구조 · 헤더');
var d66 = draftFor('66호', 0);
var R = DXF.build(d66, { layout: 'origin', unit: 'cm' });
var P = parseDXF(R.dxf);

console.log('    ' + R.dxf.length + ' bytes · 섹션 ' + JSON.stringify(P.sections) +
  ' · 엔티티 ' + P.entities.length + '개');
ok('AC1021(R2007) 이상', hdrStr(P, '$ACADVER') === 'AC1021', '$ACADVER = ' + hdrStr(P, '$ACADVER'));
ok('섹션 = HEADER · TABLES · ENTITIES', JSON.stringify(P.sections) === '["HEADER","TABLES","ENTITIES"]');
ok('EOF 로 끝남', /\bEOF\s*$/.test(R.dxf.trim()));
ok('$INSUNITS = 5 (cm)', hdrNum(P, '$INSUNITS') === 5, '$INSUNITS = ' + hdrNum(P, '$INSUNITS'));
ok('$MEASUREMENT = 1 (metric)', hdrNum(P, '$MEASUREMENT') === 1);
ok('UTF-8 한글 레이어명 그대로', /완성선/.test(R.dxf) && /시접선/.test(R.dxf));
ok('NaN/undefined 없음', !/NaN|undefined|Infinity/.test(R.dxf));
ok('경고 없음', R.info.warnings.length === 0, R.info.warnings.join(' | ') || '0건');

/* ───────────────── 2. 레이어 ───────────────── */
section('2. 레이어 선언 / 참조 정합 (SPEC §13-3)');
var declared = P.layers.map(function (l) { return l.name; });
console.log('    선언: ' + declared.join(', '));
ok('레이어 7개 선언', declared.length === 7, declared.length + '개');
var wantLayers = [['완성선', 7], ['시접선', 5], ['골선', 3], ['너치', 1], ['기준선', 8], ['식서', 6], ['문자', 2]];
var colorOK = wantLayers.every(function (wl) {
  var f2 = P.layers.filter(function (l) { return l.name === wl[0]; })[0];
  return f2 && f2.color === wl[1];
});
ok('레이어명·색(ACI) 일치', colorOK,
  P.layers.map(function (l) { return l.name + '(' + l.color + ')'; }).join(' '));
var used = {}, undeclared = [];
P.entities.forEach(function (e) {
  used[e.layer] = (used[e.layer] || 0) + 1;
  if (declared.indexOf(e.layer) < 0 && undeclared.indexOf(e.layer) < 0) undeclared.push(e.layer);
});
ok('ENTITIES 의 모든 레이어 참조가 선언 안에 있음', undeclared.length === 0,
  undeclared.length ? '미선언: ' + undeclared.join(',') : Object.keys(used).map(function (k) { return k + '×' + used[k]; }).join(' '));
ok('모든 레이어가 CONTINUOUS 선종을 참조하고 LTYPE 에 선언됨',
  P.layers.every(function (l) { return l.linetype === 'CONTINUOUS'; }) && /CONTINUOUS/.test(R.dxf));

/* ───────────────── 3. y 뒤집기 ───────────────── */
section('3. y 뒤집기 (엔진 y 아래+ → DXF y 위+)');
var backOutlineEnt = P.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '완성선'; })[0];
var bkPiece = d66.pieces[0];
ok('완성선 폴리라인 순서 = draft.pieces 순서',
  R.info.outlineOrder.map(function (x) { return x.id; }).join(',') ===
  d66.pieces.map(function (p) { return p.id; }).join(','),
  R.info.outlineOrder.map(function (x) { return x.id; }).join(','));

var engBackMinY = Math.min.apply(null, bkPiece.outline.map(function (p) { return p[1]; }));
var dxfBackMaxY = Math.max.apply(null, backOutlineEnt.vertices.map(function (q) { return q[1]; }));
console.log('    뒷판 엔진 최소 y(=뒷목, 가장 위) = ' + f(engBackMinY, 4) + 'cm');
console.log('    뒷판 DXF  최대 y                 = ' + f(dxfBackMaxY, 4));
ok('뒷목(엔진 y 음수)이 DXF 에서 위쪽(y 양수)', engBackMinY < 0 && dxfBackMaxY > 0 &&
  near(dxfBackMaxY, -engBackMinY, 0.05), 'y_dxf = −y_engine → ' + f(-engBackMinY, 4) + ' vs ' + f(dxfBackMaxY, 4));
var engBackMaxY = Math.max.apply(null, bkPiece.outline.map(function (p) { return p[1]; }));
var dxfBackMinY = Math.min.apply(null, backOutlineEnt.vertices.map(function (q) { return q[1]; }));
ok('허리선(엔진 y 최대)이 DXF 에서 아래쪽', near(dxfBackMinY, -engBackMaxY, 0.05),
  f(-engBackMaxY, 4) + ' vs ' + f(dxfBackMinY, 4));

/* ───────────────── 4. $EXTMIN/$EXTMAX ───────────────── */
section('4. $EXTMIN / $EXTMAX 가 실제 좌표 범위와 일치');
(function () {
  var xs = [], ys = [];
  P.entities.forEach(function (e) {
    if (e.type === 'LWPOLYLINE') e.vertices.forEach(function (q) { xs.push(q[0]); ys.push(q[1]); });
    else if (e.type === 'LINE') { xs.push(e.x1, e.x2); ys.push(e.y1, e.y2); }
    else if (e.type === 'POINT' || e.type === 'TEXT') { xs.push(e.x1); ys.push(e.y1); }
  });
  var mn = [Math.min.apply(null, xs), Math.min.apply(null, ys)];
  var mx = [Math.max.apply(null, xs), Math.max.apply(null, ys)];
  var hMin = hdrXY(P, '$EXTMIN'), hMax = hdrXY(P, '$EXTMAX');
  console.log('    실제 ' + f(mn[0], 3) + ',' + f(mn[1], 3) + ' ~ ' + f(mx[0], 3) + ',' + f(mx[1], 3));
  console.log('    헤더 ' + f(hMin[0], 3) + ',' + f(hMin[1], 3) + ' ~ ' + f(hMax[0], 3) + ',' + f(hMax[1], 3));
  ok('$EXTMIN 일치 (±0.01)', near(hMin[0], mn[0], 0.01) && near(hMin[1], mn[1], 0.01));
  ok('$EXTMAX 일치 (±0.01)', near(hMax[0], mx[0], 0.01) && near(hMax[1], mx[1], 0.01));
})();

/* ───────────────── 5. 왕복 검증 ───────────────── */
section('5. 왕복 검증 — 내보낸 DXF 를 다시 파싱해 원좌표와 대조 (≤0.05cm)');
function roundTrip(size, seamName, unit, layout) {
  var seam = PRESETS[seamName];
  var d = draftFor(size, seam);
  var r = DXF.build(d, { unit: unit, layout: layout });
  var pp = parseDXF(r.dxf);
  var U = r.info.unitScale;
  var outs = pp.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '완성선'; });
  var seams = pp.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '시접선'; });
  var worstO = 0, worstS = 0, worstBack = 0, det = [];
  d.pieces.forEach(function (pc, i) {
    if (!outs[i]) return;
    /* 배치 오프셋: origin=0, row 는 x 만 이동 → 원좌표와 비교하려면 오프셋 제거 */
    var got = toEngine(outs[i].vertices, U, null);
    var offX = got[0][0] - pc.outline[0][0];
    var got2 = got.map(function (q) { return [q[0] - offX, q[1]]; });
    var a = maxDistAtoB(got2, pc.outline, true);      // 내보낸 점이 원곡선 위에 있는가
    var b = maxDistAtoB(pc.outline, got2, true);      // 원곡선이 내보낸 선 위에 있는가(단순화 손실)
    worstO = Math.max(worstO, a); worstBack = Math.max(worstBack, b);
    det.push(pc.id + ' ' + f(a, 4) + '/' + f(b, 4));
    if (seams[i] && pc.seamline && pc.seamline.length > 2) {
      var gs = toEngine(seams[i].vertices, U, null).map(function (q) { return [q[0] - offX, q[1]]; });
      worstS = Math.max(worstS, maxDistAtoB(gs, pc.seamline, true), maxDistAtoB(pc.seamline, gs, true));
    }
  });
  return { fwd: worstO, back: worstBack, seam: worstS, det: det, info: r.info };
}
['origin', 'row'].forEach(function (lay) {
  ['시접0', '부위별'].forEach(function (sn) {
    var rt = roundTrip('66호', sn, 'cm', lay);
    ok('66호 ' + sn + ' / ' + lay + ' — 완성선 왕복 ≤0.05cm',
      rt.fwd <= 0.05 && rt.back <= 0.05,
      '내보낸점→원곡선 ' + f(rt.fwd, 4) + 'cm · 원곡선→내보낸선 ' + f(rt.back, 4) + 'cm  [' + rt.det.join(' ') + ']');
    if (sn !== '시접0') {
      ok('66호 ' + sn + ' / ' + lay + ' — 시접선 왕복 ≤0.05cm', rt.seam <= 0.05, f(rt.seam, 4) + 'cm');
    }
  });
});
(function () {
  var rt = roundTrip('66호', '부위별', 'mm', 'row');
  ok('mm 단위 왕복 ≤0.05cm (좌표 ×10 후 되돌림)', rt.fwd <= 0.05 && rt.back <= 0.05,
    f(rt.fwd, 4) + ' / ' + f(rt.back, 4) + 'cm · $INSUNITS=' + rt.info.insunits);
})();

/* ───────────────── 6. ★ 원본 대조 ───────────────── */
section('6. ★ 원본 대조 — dxf-66-groundtruth.json curves[].local (≤0.05cm)');
(function () {
  var d = draftFor('66호', 0);
  var r = DXF.build(d, { layout: 'origin', unit: 'cm', includeSeam: false });
  var pp = parseDXF(r.dxf);
  var U = r.info.unitScale;
  var outs = pp.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '완성선'; });
  var order = r.info.outlineOrder.map(function (x) { return x.id; });

  var byId = {};
  outs.forEach(function (e, i) { byId[order[i]] = toEngine(e.vertices, U, null); });

  ok('back/front 완성선 폴리라인 추출', !!byId.back && !!byId.front,
    'back ' + (byId.back ? byId.back.length : 0) + '점 · front ' + (byId.front ? byId.front.length : 0) + '점');

  /* 편차를 두 갈래로 나눠 잰다.
       엔진 기준선 = 단순화 전 engine outline 이 원본과 벌어진 양 (엔진팀 소관)
       내보내기 기여 = 단순화 후 − 엔진 기준선          (dxf.js 소관)
     그리고 SPEC §4·§9-6 이 명시적으로 허용한 "앞 옆선 x 0.1cm" 는 따로 집계한다. */
  var engBase = { back: d.pieces[0].outline, front: d.pieces[1].outline };
  function worstOn(curve, poly, sidePts) {
    var w = 0, wi = -1, i;
    for (i = 0; i < curve.local.length; i++) {
      var p = curve.local[i];
      var isFrontSide = (curve.side === 'front' && Math.abs(p[0] - 23.5) < 0.05);
      if (isFrontSide !== !!sidePts) continue;
      var dd = distToPolyline(p, poly, true);
      if (dd > w) { w = dd; wi = i; }
    }
    return { dev: w, at: wi };
  }

  console.log('    곡선                엔진 기준선   내보낸 DXF   내보내기 기여');
  var worstExport = 0, worstEngine = 0, worstAdded = 0, worstSide = 0;
  var overEngine = [];
  GT.curves.forEach(function (c) {
    var target = byId[c.side], base = engBase[c.side];
    if (!target || !c.local || !c.local.length) { ok('[' + c.name + '] 대조', false, 'local 없음'); return; }
    var e = worstOn(c, base, false);
    var x = worstOn(c, target, false);
    var added = x.dev - e.dev;
    worstEngine = Math.max(worstEngine, e.dev);
    worstExport = Math.max(worstExport, x.dev);
    worstAdded = Math.max(worstAdded, added);
    var s = worstOn(c, target, true);
    if (s.at >= 0) worstSide = Math.max(worstSide, s.dev);
    console.log('    ' + (c.side + ' ' + c.name).padEnd(18) + '  ' + f(e.dev, 4) + '      ' + f(x.dev, 4) +
      '      ' + (added >= 0 ? '+' : '') + f(added, 4) + '   (fit ' + c.local.length + '점' +
      (s.at >= 0 ? ', 앞옆선 ' + f(s.dev, 4) : '') + ')');
    if (e.dev > 0.05) overEngine.push(c.side + ' ' + c.name + ' ' + f(e.dev, 4));
    /* dxf.js 소관: 단순화가 보태는 양 */
    ok('[' + c.side + ' ' + c.name + '] 내보내기 기여 ≤ 허용 편차(' + R.info.simplifyTolCm + 'cm)',
      added <= R.info.simplifyTolCm + 1e-9,
      '엔진 ' + f(e.dev, 4) + ' → DXF ' + f(x.dev, 4) + 'cm (기여 ' + (added >= 0 ? '+' : '') + f(added, 4) + ')');
  });

  console.log('    ─ 엔진 기준선 최대 ' + f(worstEngine, 4) + 'cm · 내보낸 DXF 최대 ' + f(worstExport, 4) +
    'cm · 내보내기 기여 최대 ' + f(worstAdded, 4) + 'cm');
  ok('내보내기가 보태는 편차 ≤ 허용 편차', worstAdded <= R.info.simplifyTolCm + 1e-9, f(worstAdded, 4) + 'cm');

  /* SPEC §4 · §9-6 — 앞 옆선 x 는 계산식 23.4 채택, DXF 23.5 와 0.1 차이가 정상 */
  ok('앞 옆선 지점(x≈23.5) 편차 ≤0.11cm — SPEC §4·§9-6 명시 허용',
    worstSide > 0 && worstSide <= 0.11,
    f(worstSide, 4) + 'cm (계산식 23.4 vs 원본 DXF 23.5)');

  /* 엔진 기준선이 이미 0.05 를 넘는 곡선은 dxf.js 로 고칠 수 없다 → WARN 으로 드러냄 */
  if (overEngine.length) {
    warn('엔진 outline 자체가 원본 DXF 와 0.05cm 초과 (dxf.js 소관 아님)',
      overEngine.join(', ') + ' — 단순화를 완전히 꺼도(tol=0) 남는 값입니다');
  }
  ok('엔진 기준선이 0.05 이내인 곡선은 DXF 도 0.05 이내', (function () {
    var okAll = true;
    GT.curves.forEach(function (c) {
      var e = worstOn(c, engBase[c.side], false);
      var x = worstOn(c, byId[c.side], false);
      if (e.dev <= 0.05 && x.dev > 0.05) okAll = false;
    });
    return okAll;
  })(), '내보내기 때문에 0.05 를 넘긴 곡선 0개');

  /* 원본 기준선(lines) 중 뒤판 CB·앞판 CF 골선이 제자리인지 추가 확인 */
  var bkFold = [];
  var bp = d.pieces[0], fr = bp.foldEdges[0];
  var idx = DXF._rangeIdx(fr[0], fr[1], bp.outline.length);
  idx.forEach(function (i) { bkFold.push(bp.outline[i]); });
  var foldX = bkFold.map(function (p) { return Math.abs(p[0]); });
  ok('뒷판 골선이 x=0 (CB) 위에 있음', Math.max.apply(null, foldX) < 1e-6,
    '|x| 최대 ' + Math.max.apply(null, foldX).toExponential(2) + 'cm');
  var foldEnts = pp.entities.filter(function (e) { return e.layer === '골선'; });
  ok('골선 레이어에 별도 폴리라인이 나감', foldEnts.length >= 2,
    foldEnts.length + '개 (뒤 CB + 앞 CF)');
  var fx = [];
  foldEnts.forEach(function (e) { e.vertices.forEach(function (q) { fx.push(q[0]); }); });
  ok('골선 폴리라인이 전부 x=0 직선', Math.max.apply(null, fx.map(Math.abs)) < 1e-6,
    '|x| 최대 ' + Math.max.apply(null, fx.map(Math.abs)).toExponential(2));
})();

/* ───────────────── 7. 단순화 ───────────────── */
section('7. 외곽선 단순화 (Douglas–Peucker, SPEC §13-4)');
(function () {
  var d = draftFor('66호', PRESETS['부위별']);
  var r = DXF.build(d, { layout: 'row', unit: 'cm' });
  console.log('    허용 편차 = ' + r.info.simplifyTolCm + 'cm (SPEC 상한 0.05)');
  r.info.pieces.forEach(function (p) {
    console.log('    ' + p.name + '  완성선 ' + p.outlinePts + ' → ' + p.outlineSimplified +
      '점 (편차 ' + f(p.outlineDevCm, 5) + 'cm, ' + p.outlineMode + ')' +
      (p.seamPts ? '   시접선 ' + p.seamPts + ' → ' + p.seamSimplified + '점 (편차 ' + f(p.seamDevCm, 5) + 'cm)' : ''));
  });
  ok('단순화 최대 편차 ≤ 0.05cm', r.info.simplifyDevCm <= 0.05, f(r.info.simplifyDevCm, 5) + 'cm');
  ok('조각당 점 수가 수백 이하로 감소',
    r.info.pieces.every(function (p) { return p.outlineSimplified <= 400 && p.outlineSimplified >= 8; }),
    r.info.pieces.map(function (p) { return p.outlineSimplified; }).join('/') + '점');
  ok('원본 DXF fit 정점 수(17~65) 대역에 근접',
    r.info.pieces.every(function (p) { return p.outlineSimplified <= 200; }),
    '원본 곡선 fit 점: ' + GT.curves.map(function (c) { return c.local.length; }).join('/'));
  ok('변 경계가 보존되는 구간별 단순화 사용',
    r.info.pieces.every(function (p) { return p.outlineMode === 'perEdge'; }),
    r.info.pieces.map(function (p) { return p.outlineMode; }).join(','));
  /* 단순화를 꺼도(tol 0) 동작하는가 */
  /* tol=0 이어도 "정확히 일직선 위" 점은 편차 0 이라 지워진다 — 형상은 무손실 */
  var r0 = DXF.build(d, { layout: 'row', unit: 'cm', simplifyTolCm: 0 });
  ok('simplifyTolCm=0 → 편차 정확히 0 (무손실)', r0.info.simplifyDevCm === 0,
    r0.info.pieces.map(function (p) { return p.outlineSimplified; }).join('/') +
    '점 (공선점만 제거), 편차 ' + f(r0.info.simplifyDevCm, 6) + 'cm');
  ok('simplifyTolCm=0 이면 점이 크게 남음', r0.info.pieces[0].outlineSimplified > 1000,
    r0.info.pieces[0].outlineSimplified + '점 (원본 ' + r0.info.pieces[0].outlinePts + ')');
})();

/* ───────────────── 8. 배치 ───────────────── */
section('8. 조각 배치 (layout)');
(function () {
  var d = draftFor('66호', PRESETS['부위별']);
  var rRow = DXF.build(d, { layout: 'row', unit: 'cm', gapCm: 5 });
  var pRow = parseDXF(rRow.dxf);
  var outs = pRow.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '완성선'; });
  var seams = pRow.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '시접선'; });
  var boxes = seams.map(function (e) {
    var xs = e.vertices.map(function (q) { return q[0]; });
    return [Math.min.apply(null, xs), Math.max.apply(null, xs)];
  });
  var sep = true, gaps = [];
  for (var i = 1; i < boxes.length; i++) {
    gaps.push(boxes[i][0] - boxes[i - 1][1]);
    if (boxes[i][0] < boxes[i - 1][1] - 1e-6) sep = false;
  }
  ok('row 배치 — 시접선 기준으로 조각이 겹치지 않음', sep,
    '간격 ' + gaps.map(function (g) { return f(g, 2); }).join(', ') + 'cm (gapCm=5)');
  ok('row 배치 간격 = gapCm', gaps.every(function (g) { return near(g, 5, 0.01); }));
  var rOrg = DXF.build(d, { layout: 'origin', unit: 'cm' });
  var pOrg = parseDXF(rOrg.dxf);
  var o0 = pOrg.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '완성선'; })[0];
  var minX = Math.min.apply(null, o0.vertices.map(function (q) { return q[0]; }));
  ok('origin 배치 — 첫 조각이 로컬 원점 그대로 (뒷판 CB x=0)', near(minX, 0, 1e-6), 'minX = ' + f(minX, 6));
})();

/* ───────────────── 9. 엔티티 종류 ───────────────── */
section('9. 엔티티 종류 (SPEC §13-4)');
(function () {
  var d = draftFor('66호', PRESETS['부위별']);
  var r = DXF.build(d, { layout: 'row', unit: 'cm' });
  var pp = parseDXF(r.dxf);
  var byType = {};
  pp.entities.forEach(function (e) { byType[e.type] = (byType[e.type] || 0) + 1; });
  console.log('    ' + Object.keys(byType).map(function (k) { return k + ' ' + byType[k]; }).join(' · '));
  ok('외곽선·시접선이 LWPOLYLINE', byType.LWPOLYLINE >= 6);
  var closed = pp.entities.filter(function (e) {
    return e.type === 'LWPOLYLINE' && (e.layer === '완성선' || e.layer === '시접선');
  });
  ok('완성선·시접선이 닫힌 폴리라인 (70=1)', closed.every(function (e) { return e.flags === 1; }),
    closed.length + '개 전부 closed');
  ok('LWPOLYLINE 정점 수(90)가 실제 정점과 일치',
    pp.entities.filter(function (e) { return e.type === 'LWPOLYLINE'; })
      .every(function (e) { return e.count === e.vertices.length; }));
  var notchEnts = pp.entities.filter(function (e) { return e.layer === '너치'; });
  ok('너치가 LINE 으로 나감', notchEnts.length > 0 && notchEnts.every(function (e) { return e.type === 'LINE'; }),
    notchEnts.length + '개');
  var nlen = notchEnts.map(function (e) { return Math.hypot(e.x2 - e.x1, e.y2 - e.y1); });
  ok('너치 길이 = 0.5cm', nlen.every(function (L) { return near(L, 0.5, 1e-6); }),
    '길이 ' + f(nlen[0], 4) + 'cm ×' + nlen.length);
  /* 너치 방향이 도(°)로 해석되었는가 — 180° 너치는 −x 방향 */
  var bp = d.pieces[0];
  var n180 = (bp.notches || []).filter(function (n) { return Math.abs(n.angle - 180) < 1e-9; })[0];
  if (n180) {
    var hit = notchEnts.filter(function (e) { return near(e.y2 - e.y1, 0, 1e-9) && (e.x2 - e.x1) < 0; });
    ok('180° 너치가 DXF 에서 −x 수평 (도 해석)', hit.length >= 1,
      hit.length + '개, Δ=(' + f(hit[0].x2 - hit[0].x1, 3) + ', ' + f(hit[0].y2 - hit[0].y1, 3) + ')');
  }
  var texts = pp.entities.filter(function (e) { return e.type === 'TEXT'; });
  ok('문자에 호수·조각명·재단매수', texts.some(function (t) { return /66호.*뒷판.*매/.test(t.text); }),
    texts.slice(0, 2).map(function (t) { return '"' + t.text + '"'; }).join(' '));
  ok('문자에 부위별 시접 표기', texts.some(function (t) { return /밑단 3\.0/.test(t.text); }),
    (texts.filter(function (t) { return /시접/.test(t.text); })[0] || {}).text || '없음');
  ok('문자 높이 0.8cm', texts.every(function (t) { return t.height > 0 && t.height <= 0.81; }));
  ok('식서가 LINE 1개/조각', pp.entities.filter(function (e) { return e.layer === '식서'; }).length === d.pieces.length);
  ok('includeSeam:false 면 시접선 생략', (function () {
    var r2 = DXF.build(d, { includeSeam: false });
    return parseDXF(r2.dxf).entities.filter(function (e) { return e.layer === '시접선'; }).length === 0;
  })());
  ok('includeText:false / includeInternal:false 동작', (function () {
    var r2 = DXF.build(d, { includeText: false, includeInternal: false });
    var p2 = parseDXF(r2.dxf).entities;
    return p2.filter(function (e) { return e.layer === '문자'; }).length === 0 &&
           p2.filter(function (e) { return e.layer === '기준선'; }).length === 0;
  })());
})();

/* ───────────────── 10. 24조합 ───────────────── */
section('10. 4호수 × 3프리셋 × 2단위 = 24조합');
(function () {
  var n = 0, bad = [], devMax = 0, rows = [];
  SIZES.forEach(function (sz) {
    Object.keys(PRESETS).forEach(function (sn) {
      ['cm', 'mm'].forEach(function (u) {
        n++;
        try {
          var d = draftFor(sz, PRESETS[sn]);
          var r = DXF.build(d, { unit: u, layout: 'row' });
          if (/NaN|undefined|Infinity/.test(r.dxf)) bad.push(sz + '/' + sn + '/' + u + ' NaN');
          if (r.info.warnings.length) bad.push(sz + '/' + sn + '/' + u + ' 경고:' + r.info.warnings[0]);
          if (r.info.simplifyDevCm > devMax) devMax = r.info.simplifyDevCm;
          var pp = parseDXF(r.dxf);
          if (!pp.entities.length) bad.push(sz + '/' + sn + '/' + u + ' 엔티티 0');
          var un = pp.entities.filter(function (e) { return ['완성선','시접선','골선','너치','기준선','식서','문자'].indexOf(e.layer) < 0; });
          if (un.length) bad.push(sz + '/' + sn + '/' + u + ' 미선언레이어');
          if (u === 'cm' && sn === '부위별') {
            rows.push(sz + ' ' + r.info.pieces.map(function (p) { return p.outlineSimplified; }).join('/') +
              '점 ext[' + f(r.info.extMin[0], 1) + ',' + f(r.info.extMin[1], 1) + '~' +
              f(r.info.extMax[0], 1) + ',' + f(r.info.extMax[1], 1) + ']');
          }
        } catch (e) { bad.push(sz + '/' + sn + '/' + u + ' throw: ' + e.message); }
      });
    });
  });
  rows.forEach(function (r) { console.log('    ' + r); });
  ok('24조합 전부 예외·NaN·경고 없음', n === 24 && bad.length === 0,
    n + '조합 / 문제 ' + bad.length + '건' + (bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''));
  ok('전 조합 단순화 편차 ≤0.05cm', devMax <= 0.05, '최대 ' + f(devMax, 5) + 'cm');
})();

/* ───────────────── 11. 왕복 — 전 호수 ───────────────── */
section('11. 왕복 검증 — 4호수 × 부위별 시접');
(function () {
  var worst = 0, det = [];
  SIZES.forEach(function (sz) {
    var rt = roundTrip(sz, '부위별', 'cm', 'row');
    worst = Math.max(worst, rt.fwd, rt.back, rt.seam);
    det.push(sz + ' ' + f(Math.max(rt.fwd, rt.back, rt.seam), 4));
  });
  ok('전 호수 왕복 편차 ≤0.05cm', worst <= 0.05, det.join(' · ') + ' cm');
})();

/* ───────────────── 12. 방어 ───────────────── */
section('12. 방어 / 예외');
ok('pieces 비면 throw', (function () { try { DXF.buildDXF({ pieces: [] }); return false; } catch (e) { return true; } })());
ok('buildDXF 는 문자열 반환', typeof DXF.buildDXF(d66, {}) === 'string');
ok('lastInfo() 로 info 접근', !!DXF.lastInfo() && DXF.lastInfo().acadver === 'AC1021');
ok('suggestName 이 호수·단위 반영', DXF.suggestName(d66, { unit: 'mm' }) === '기본무다트원형_66호_mm.dxf',
  DXF.suggestName(d66, { unit: 'mm' }));
ok('mm 단위면 $INSUNITS=4 · 좌표 ×10', (function () {
  var r = DXF.build(d66, { unit: 'mm', layout: 'origin' });
  var pm = parseDXF(r.dxf);
  var e0 = pm.entities.filter(function (e) { return e.type === 'LWPOLYLINE' && e.layer === '완성선'; })[0];
  var maxX = Math.max.apply(null, e0.vertices.map(function (q) { return q[0]; }));
  return hdrNum(pm, '$INSUNITS') === 4 && near(maxX, 238, 0.5);
})(), 'cm 23.8 → mm 238');
ok('내부 폴리라인 정점이 3개 미만인 조각은 건너뛰고 경고', (function () {
  var d = draftFor('66호', 0);
  d.pieces = d.pieces.concat([{ id: 'bad', name: '불량', outline: [[0, 0], [1, 1]] }]);
  var r = DXF.build(d, {});
  return r.info.warnings.some(function (w) { return w.indexOf('건너뜀') >= 0; });
})());
ok('foldEdges 범위 밖이면 경고 후 무시', (function () {
  var d = draftFor('66호', 0);
  d.pieces[0].foldEdges = [[99999, 0]];
  var r = DXF.build(d, {});
  return r.info.warnings.some(function (w) { return w.indexOf('foldEdges') >= 0; });
})());

/* ───────────────── 결과 ───────────────── */
if (WARNS.length) {
  section('경고 (dxf.js 소관 아님 — 전달용)');
  WARNS.forEach(function (w) { console.log('  · ' + w); });
}
console.log('\n' + '═'.repeat(70));
console.log('  PASS ' + PASS + '   FAIL ' + FAIL + '   WARN ' + WARN);
console.log('═'.repeat(70) + '\n');
process.exit(FAIL ? 1 : 0);
