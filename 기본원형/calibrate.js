#!/usr/bin/env node
/* ============================================================================
 * 기본 무다트 원형 — 곡선 상수(CAL) 재적합
 *
 *   node calibrate.js        재적합 후 engine.js 의 CAL 블록을 직접 갱신
 *
 * 곡선은 전부 **C2 연속 스플라인**(SPEC §22)이라 조정할 것은
 * 앵커 위치(무차원 비율)와 끝 접선 크기 k0·k1 뿐이다.
 *
 * ⚠ 적합 비용은 세 가지를 함께 본다 — 하나라도 빼면 사고가 난다.
 *   ① 편차는 **양방향(하우스도르프)**. 한 방향만 재면 곡선이 밖으로 튀거나
 *      고리를 만들어도 편차가 안 늘어 "합격"이 나온다.
 *   ② **곡선길이** 가 도면과 맞아야 한다 (봉제에 실제로 쓰는 값).
 *   ③ **곡률 급변** 벌점 — 편차만 보면 눈에 꺾여 보이는 해가 뽑힌다.
 *   그리고 **자기교차가 있으면 실격**.
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js');
var U = E.util, V = U.V;

var HERE = __dirname;
var GT = JSON.parse(fs.readFileSync(path.join(HERE, 'dxf-66-groundtruth.json'), 'utf8'));
var REF = GT.ref;
var toFront = function (p) { return [p[0] - REF.CF, REF.TOP_FRONT - p[1]]; };

function GTC(id) {
  var c = GT.curves.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!c) throw new Error('정답지 curves[' + id + '] 없음');
  return c.local.map(function (p) { return [p[0], p[1]]; });
}
/* 앞목둘레는 도면에서 원호 + 스플라인 두 조각이라 이어 붙여 쓴다 */
function frontNeckRef() {
  var a = GT.arcs[0], out = [];
  for (var i = 0; i <= 80; i++) {
    var t = (a.a0 + (a.a1 - a.a0) * i / 80) * Math.PI / 180;
    out.push(toFront([a.c[0] + a.r * Math.cos(t), a.c[1] + a.r * Math.sin(t)]));
  }
  return out.concat(GTC(3));
}
function polyLenOf(pts) { return U.polyLen(pts); }

/* ── 지표 ─────────────────────────────────────────────────────────── */
function distToSeg(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
  var t = L2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}
function devTo(pts, poly) {
  var w = 0;
  for (var i = 0; i < pts.length; i++) {
    var d = Infinity;
    for (var j = 0; j < poly.length - 1; j++) {
      var dd = distToSeg(pts[i], poly[j], poly[j + 1]);
      if (dd < d) d = dd;
    }
    if (d > w) w = d;
  }
  return w;
}
function hausdorff(a, b) { return Math.max(devTo(a, b), devTo(b, a)); }
function segCross(p1, p2, p3, p4) {
  var d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return false;
  var t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  var u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}
function selfInt(pts) {
  var n = 0;
  for (var i = 0; i < pts.length - 1; i++)
    for (var j = i + 2; j < pts.length - 1; j++)
      if (segCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) n++;
  return n;
}
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

/* ── 적합 대상 ────────────────────────────────────────────────────── */
var M66 = E.measuresForSize('66호');
/* DXF 대조용 제도 — 앞 옆선을 도면의 반올림값(B/4+1.6)으로 맞춘다 (SPEC §3.2 ※) */
var GOPT = { shoulderEase: 0.95, frontSideEase: 1.6, hemStyle: 'curve' };
function build(name) { return E.geom(M66, GOPT)[name]; }

var SPECS = {
  /* 목선 끝접선도 **어깨선 수직 고정**(§5-7)이라 et 를 넣지 않는다 */
  backNeck:  ['mx', 'my', 'k0', 'k1'],
  frontNeck: ['k0', 'k1'],
  /* 암홀 끝접선은 **어깨선 수직 고정**(SPEC §5-7 봉제 규칙)이라 et 를 넣지 않는다 */
  backArm:   ['pdx', 'pky', 'hdx', 'hdy', 'k0', 'k1'],
  frontArm:  ['pdx', 'pky', 'hdx', 'hdy', 'k0', 'k1']
};
var BOUND = {
  k0: [0.15, 3.0], k1: [0.15, 3.0],
  mx: [0.05, 0.95], my: [0.02, 0.98],
  et: [-45, 45], hdx: [0.02, 0.98], hdy: [-0.4, 0.6],
  pdx: [-0.15, 0.15], pky: [0.10, 0.90]
};
var REFS = {
  backNeck:  GTC(0),
  backArm:   GTC(1),
  frontNeck: frontNeckRef(),
  frontArm:  GTC(4)
};

function cost(name, ref, refLen) {
  var poly = U.sampleSegs(build(name), 0.05);
  var len = polyLenOf(poly);
  if (Math.abs(len - refLen) > 1.0) return 50 + Math.abs(len - refLen);
  if (selfInt(poly)) return Infinity;
  return hausdorff(ref, poly) + Math.abs(len - refLen) * 0.5 + maxCurvatureJump(poly) * 0.20;
}

console.log('\n곡선 재적합 (66호 DXF 기준) — C2 스플라인\n');
var seed = 20260807;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

Object.keys(SPECS).forEach(function (name) {
  var ref = REFS[name], refLen = polyLenOf(ref), keys = SPECS[name], C = E.CAL[name];
  var scale = {};
  keys.forEach(function (k) { scale[k] = (k === 'et') ? 40 : 1; });

  function descend() {
    var best = cost(name, ref, refLen);
    for (var step = 0.12; step > 2e-7; step *= 0.55) {
      for (var pass = 0; pass < 80; pass++) {
        var improved = false;
        for (var ki = 0; ki < keys.length; ki++) {
          var k = keys[ki];
          for (var s = 0; s < 2; s++) {
            var d = (s ? -step : step) * scale[k], save = C[k], nv = save + d;
            var b = BOUND[k];
            if (b && (nv < b[0] || nv > b[1])) continue;
            C[k] = nv;
            var c = cost(name, ref, refLen);
            if (c < best - 1e-10) { best = c; improved = true; }
            else C[k] = save;
          }
        }
        if (!improved) break;
      }
    }
    return best;
  }

  var best = descend(), bestC = JSON.parse(JSON.stringify(C));
  for (var r = 0; r < 16; r++) {                 // 다중 시작점 — 좌표하강은 로컬 미니멈에 잘 걸린다
    keys.forEach(function (k) {
      var b = BOUND[k] || [0, 1];
      C[k] = b[0] + (b[1] - b[0]) * rnd();
    });
    var d2 = descend();
    if (d2 < best - 1e-9) { best = d2; bestC = JSON.parse(JSON.stringify(C)); }
  }
  keys.forEach(function (k) { C[k] = bestC[k]; });

  var poly = U.sampleSegs(build(name), 0.02);
  console.log('  ' + name.padEnd(10) +
    ' 최대편차 ' + hausdorff(ref, poly).toFixed(3) + ' cm' +
    ' · 길이 ' + polyLenOf(poly).toFixed(3) + ' (도면 ' + refLen.toFixed(3) + ')' +
    ' · 자기교차 ' + selfInt(poly) +
    ' · 곡률급변 ' + maxCurvatureJump(poly).toFixed(3));
});

/* ── engine.js 의 CAL 블록을 실제로 갈아 끼운다 ──
   출력만 하고 붙여넣기를 잊으면 "적합했는데 편차가 그대로"인 사고가 난다. */
var block = '  var CAL = {\n' +
  '    /* 앵커 위치(무차원 비율) + **끝 접선 크기 계수 k0·k1** 뿐이다.\n' +
  '       구간별 장력·접선회전은 곡률을 튀게 만들어 없앴다 — 사이는 C2 스플라인이 정한다.\n' +
  '       재적합: node calibrate.js */\n' +
  Object.keys(SPECS).map(function (name) {
    var C = E.CAL[name];
    return '    ' + name + (name.length < 9 ? new Array(10 - name.length).join(' ') : '') + ': { ' +
      SPECS[name].map(function (k) { return k + ': ' + C[k].toFixed(6); }).join(', ') + ' }';
  }).join(',\n') + '\n  };';

var file = path.join(HERE, 'engine.js');
var src = fs.readFileSync(file, 'utf8');
var re = /^  var CAL = \{[\s\S]*?^  \};$/m;
if (!re.test(src)) {
  console.log('\n! engine.js 에서 CAL 블록을 찾지 못했습니다. 아래를 직접 붙여넣으세요.\n');
  console.log(block + '\n');
} else {
  fs.writeFileSync(file, src.replace(re, block), 'utf8');
  console.log('\n→ engine.js 의 CAL 블록을 갱신했습니다. 다시 실행하면 이어서 더 좋아질 수 있습니다.\n');
}
