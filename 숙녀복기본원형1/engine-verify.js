#!/usr/bin/env node
/* ============================================================================
 * 숙녀복 기본원형 I — 엔진 검증 / 곡선 캘리브레이션
 *
 *   node engine-verify.js              검증 (66호 DXF 대조 + 봉제 정합 + 전 호수)
 *   node engine-verify.js --calibrate  곡선 상수 재적합 후 새 CAL 블록 출력
 *
 * 정답지
 *   dxf-66-groundtruth.json      몸판 66호 (숙녀복기본원형1.dxf)
 *   dxf-sleeve-groundtruth.json  반소매 66호 (반소매원형 (1).dxf)
 *
 * ⚠ 뒤 허리선 위치 — 도면은 앞뒤를 **한 사각형(앞길이 40)** 에 그렸지만,
 *   엔진은 뒤 허리선을 **등길이(37.5)** 로 둡니다. 그래야 앞뒤 옆선이 15.94 로
 *   일치해 실제로 봉제됩니다 (SPEC §19-2). 그래서 허리선 아래 요소를 도면과
 *   비교할 때는 도면 y 에서 (앞길이 − 등길이) 를 빼고 봅니다.
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js');
var V = E.util.V, sampleSegs = E.util.sampleSegs;

var HERE = __dirname;
var GT = JSON.parse(fs.readFileSync(path.join(HERE, 'dxf-66-groundtruth.json'), 'utf8'));
var SGT = (function () {
  var f = path.join(HERE, 'dxf-sleeve-groundtruth.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
})();

var TOL_PT = 0.05;      // 제도점 허용 편차 (cm) — SPEC §13-6
var TOL_CURVE = 0.05;   // 곡선 최대편차 (cm)
/* 곡선별 허용치 — 앞 암홀만 0.10.
   원본 DXF 의 앞 암홀 스플라인은 **자기가 표시한 앞품선 2등분점 (16, 12.5) 을
   0.10 cm 벗어나** 지나간다(최근접 (16.020, 12.401)). 즉 도면 자체의 정밀도가
   그 정도라, 이보다 더 좁히는 것은 도면의 오차를 따라 그리는 것이 된다.
   뒤 암홀은 같은 규칙점을 0.0003 cm 로 지나므로 0.05 를 그대로 쓴다. */
var CURVE_TOL = { frontArm: 0.10 };
var TOL_SEW = 0.10;     // 봉제되는 두 변의 길이 차 허용 (cm)

var fails = [], warns = [];
function ok(cond, msg, detail) {
  if (cond) { console.log('  ✓ ' + msg + (detail ? '   ' + detail : '')); }
  else { console.log('  ✗ ' + msg + (detail ? '   ' + detail : '')); fails.push(msg); }
}
function note(msg) { console.log('  · ' + msg); }
function warn(msg) { console.log('  ! ' + msg); warns.push(msg); }
var f2 = function (v) { return (Math.round(v * 1000) / 1000).toFixed(3); };

/* ── 정답지 곡선 꺼내기 ─────────────────────────────────────────────── */
function gtCurve(i) {
  var c = GT.curves.filter(function (x) { return x.i === i; })[0];
  if (!c) throw new Error('정답지에 curves[' + i + '] 가 없습니다');
  return c.pts.map(function (p) { return [p[0], p[1]]; });
}
function rev(pts) { return pts.slice().reverse(); }

/* 정답지 곡선 인덱스 (SPEC §19-4)
 *   i0  뒷목둘레   (0,0) → (8,-2.5)
 *   i10 뒤 암홀    (21,21.6) → (19,1.206)          [겨드랑 → 어깨점]
 *   i3  앞목둘레   (7,0) → (0,7)                    [목옆점 → CF]  ⇒ 뒤집어 쓴다
 *   i4  앞 암홀    (17.864,4.105) → (21,21.6)       [어깨점 → 겨드랑] ⇒ 뒤집어 쓴다
 */
var GTC = {
  backNeck:  function () { return gtCurve(0); },
  backArm:   function () { return gtCurve(10); },
  frontNeck: function () { return rev(gtCurve(3)); },
  frontArm:  function () { return rev(gtCurve(4)); }
};

/* ── 점 ↔ 폴리라인 최대편차 ──────────────────────────────────────────── */
function distToSeg(p, a, b) {
  var vx = b[0] - a[0], vy = b[1] - a[1];
  var L2 = vx * vx + vy * vy;
  var t = L2 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}
function maxDev(gtPts, segs) {
  var poly = sampleSegs(segs, 0.02), worst = 0;
  for (var i = 0; i < gtPts.length; i++) {
    var d = Infinity;
    for (var j = 0; j < poly.length - 1; j++) {
      var dd = distToSeg(gtPts[i], poly[j], poly[j + 1]);
      if (dd < d) d = dd;
    }
    if (d > worst) worst = d;
  }
  return worst;
}

/* ══ 캘리브레이션 ═══════════════════════════════════════════════════════
 * 좌표하강 — 파라미터 하나씩 스텝을 줄여가며 최대편차를 낮춘다.
 * 전부 무차원 비율/각도라 다른 호수에서도 같은 형상이 유지된다.        */
var SPECS = {
  backNeck:  ['mx', 'my', 'mt', 'et', 'h0', 'h1', 'h2', 'h3'],
  frontNeck: ['mt', 'et', 'h0', 'h1', 'h2', 'h3'],
  backArm:   ['pdx', 'pdy', 'pt', 'hdx', 'hdy', 'hth', 'tR', 'h0', 'h1', 'h2', 'h3', 'h4', 'h5'],
  frontArm:  ['pdx', 'pdy', 'pt', 'hdx', 'hdy', 'hth', 'tR', 'h0', 'h1', 'h2', 'h3', 'h4', 'h5']
};

/* 파라미터 하한/상한 — 핸들 길이가 음수가 되면 끝점에서 곡선이 되꺾여 첨점이 생긴다.
   앵커 비율도 구간 밖으로 나가면 곡선이 뒤집히므로 막는다. */
var BOUND = {
  h0: [0.02, 1.2], h1: [0.02, 1.2], h2: [0.02, 1.2], h3: [0.005, 1.2],
  h4: [0.02, 1.2], h5: [0.005, 0.8],
  mx: [0.05, 0.95], my: [0.02, 0.98], hdx: [0.02, 0.98],
  mt: [-60, 60], et: [-45, 45], hth: [-80, 80], tR: [0.05, 0.9], pt: [-25, 25],
  /* 품점은 품선 2등분점에 **고정**이 원칙이라 보정폭을 좁게 묶는다 */
  pdx: [-0.06, 0.06], pdy: [-0.10, 0.10], hdy: [-0.4, 0.6]
};
function clampOK(k, v) {
  var b = BOUND[k];
  return !b || (v >= b[0] && v <= b[1]);
}

function buildCurve(name, m) {
  var g = E.geom(m, {});
  return g[name];
}

function calibrate() {
  var m = E.measuresForSize('66호');
  console.log('\n곡선 재적합 (66호 DXF 기준)\n');
  /* 결정적 난수 (재현 가능한 재적합) */
  var seed = 20260807;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

  Object.keys(SPECS).forEach(function (name) {
    var gt = GTC[name](), keys = SPECS[name], C = E.CAL[name];
    var scale = {};                              // 파라미터별 스텝 배율 (각도는 크게)
    keys.forEach(function (k) { scale[k] = (k === 'mt' || k === 'hth' || k === 'et') ? 40 : 1; });

    /* 좌표하강 — 스텝을 크게 잡아 시작해 0.55 배씩 줄인다.
       각 스텝에서는 개선이 멈출 때까지 전 파라미터를 반복 훑는다. */
    function descend() {
      var best = maxDev(gt, buildCurve(name, m));
      for (var step = 0.12; step > 2e-7; step *= 0.55) {
        for (var pass = 0; pass < 80; pass++) {
          var improved = false;
          for (var ki = 0; ki < keys.length; ki++) {
            var k = keys[ki], d0 = step * scale[k];
            for (var s = 0; s < 2; s++) {
              var d = s ? -d0 : d0, save = C[k];
              if (!clampOK(k, save + d)) continue;
              C[k] = save + d;
              var dev = maxDev(gt, buildCurve(name, m));
              if (dev < best - 1e-10) { best = dev; improved = true; }
              else C[k] = save;
            }
          }
          if (!improved) break;
        }
      }
      return best;
    }

    /* 다중 시작점 — 좌표하강은 로컬 미니멈에 잘 걸린다.
       현재값에서 한 번, 그다음 경계 안 무작위 시작점에서 여러 번 돌려 최선을 남긴다. */
    var best = descend(), bestC = JSON.parse(JSON.stringify(C));
    for (var r = 0; r < 24; r++) {
      keys.forEach(function (k) {
        var b = BOUND[k] || [0, 1];
        var lo = Math.max(b[0], -3), hi = Math.min(b[1], 3);
        C[k] = lo + (hi - lo) * rnd();
      });
      var dev = descend();
      if (dev < best - 1e-9) { best = dev; bestC = JSON.parse(JSON.stringify(C)); }
    }
    keys.forEach(function (k) { C[k] = bestC[k]; });
    console.log('  ' + name.padEnd(10) + ' 최대편차 ' + f2(best) + ' cm');
  });
  /* ── engine.js 의 CAL 블록을 실제로 갈아 끼운다 ──
     출력만 하고 붙여넣기를 잊으면 "적합했는데 편차가 그대로"인 사고가 난다. */
  var block = '  var CAL = {\n' + Object.keys(SPECS).map(function (name) {
    var C = E.CAL[name];
    var body = SPECS[name].map(function (k) { return k + ': ' + C[k].toFixed(6); }).join(', ');
    return '    ' + name + (name.length < 9 ? ' '.repeat(9 - name.length) : '') + ': { ' + body + ' }';
  }).join(',\n') + '\n  };';

  var file = path.join(HERE, 'engine.js');
  var src = fs.readFileSync(file, 'utf8');
  var re = /^  var CAL = \{[\s\S]*?^  \};$/m;
  if (!re.test(src)) {
    console.log('\n! engine.js 에서 CAL 블록을 찾지 못했습니다. 아래를 직접 붙여넣으세요.\n');
    console.log(block + '\n');
    return;
  }
  fs.writeFileSync(file, src.replace(re, block), 'utf8');
  console.log('\n→ engine.js 의 CAL 블록을 갱신했습니다. 다시 실행하면 이어서 더 좋아질 수 있습니다.\n');
  console.log(block + '\n');
}

/* ══ 검증 ═════════════════════════════════════════════════════════════ */
function sectionSkeleton(m, d) {
  console.log('\n[1] 66호 제도점 — 도면 대조 (허용 ' + TOL_PT + ' cm)');
  var P = d.points, dy = m.frontLen - m.backLen;      // 뒤 허리선 보정량 (§19-2)
  var want = [
    ['뒤 목옆점 SNP',  P.back.SNP,    [8.0, -2.5]],
    ['뒤 어깨점 SP',   P.back.SP,     [19.0, 1.2063]],
    ['뒤 겨드랑 U',    P.back.U,      [21.0, 21.6]],
    ['뒤 다트끝',      P.back.dartTip, [10.3403, 16.6291]],
    ['뒤 다트 CF쪽',   P.back.dartL,  [8.7998, 40.0 - dy]],
    ['뒤 다트 옆선쪽', P.back.dartR,  [10.7998, 40.0 - dy]],
    ['뒤 허리 옆점',   P.back.waist,  [19.8, 40.0 - dy]],
    ['앞 목옆점 SNP',  P.front.SNP,   [7.0, 0.0]],
    ['앞 어깨점 SP',   P.front.SP,    [17.864, 4.105]],
    ['앞 겨드랑 U',    P.front.U,     [21.0, 21.6]],
    ['앞 BP',          P.front.BP,    [9.0, 23.916]],
    ['가슴다트 위끝',  P.front.dartUp,  [20.678, 26.528]],
    ['가슴다트 아래끝', P.front.dartLow, [20.516, 29.023]],
    ['허리다트끝',     P.front.waistDartTip, [9.0, 26.4163]],
    ['허리다트 CF쪽',  P.front.waistDartL,   [8.0, 40.0]],
    ['허리다트 옆선쪽', P.front.waistDartR,  [10.5, 40.0]],
    ['앞 허리 옆점',   P.front.waist, [19.8, 40.0]]
  ];
  want.forEach(function (w) {
    var e = V.dist(w[1], w[2]);
    ok(e <= TOL_PT, w[0], '편차 ' + f2(e) + '  엔진(' + f2(w[1][0]) + ', ' + f2(w[1][1]) + ')');
  });
}

function sectionCurves(m) {
  console.log('\n[2] 66호 곡선 — 도면 대조 (허용 ' + TOL_CURVE + ' cm)');
  Object.keys(SPECS).forEach(function (name) {
    var dev = maxDev(GTC[name](), buildCurve(name, m));
    var tol = CURVE_TOL[name] || TOL_CURVE;
    ok(dev <= tol, name, '최대편차 ' + f2(dev) + ' cm (허용 ' + tol + ')');
  });
  var g = E.geom(m, {});
  var A = E.util.sLen(g.backArm), F = E.util.sLen(g.frontArm);
  ok(Math.abs(A - GT.annotated['뒤암홀길이']) <= 0.10, '뒤 암홀 길이',
     f2(A) + '  도면 문자 ' + GT.annotated['뒤암홀길이']);
  ok(Math.abs(F - GT.annotated['앞암홀길이']) <= 0.10, '앞 암홀 길이',
     f2(F) + '  도면 문자 ' + GT.annotated['앞암홀길이']);
}

function sectionSew(m, d) {
  console.log('\n[3] 봉제 정합 — 맞물리는 두 변의 길이 (허용 ' + TOL_SEW + ' cm)');
  var M = d.measures;
  ok(Math.abs(M.sideBack - M.sideFront) <= TOL_SEW, '옆선 (뒤 = 앞)',
     '뒤 ' + f2(M.sideBack) + ' / 앞 ' + f2(M.sideFront) + '  차 ' + f2(Math.abs(M.sideBack - M.sideFront)));
  ok(Math.abs(M.shoulderBack - M.shoulderFront) <= TOL_SEW, '어깨선 (뒤 = 앞)',
     '뒤 ' + f2(M.shoulderBack) + ' / 앞 ' + f2(M.shoulderFront));
  ok(Math.abs(M.bustDartOpen - (m.frontLen - m.backLen)) <= 0.02, '가슴다트 = 앞길이 − 등길이',
     f2(M.bustDartOpen) + ' / ' + f2(m.frontLen - m.backLen));
  if (M.sleeveCapEase !== null) {
    ok(M.sleeveCapEase > 0.8 && M.sleeveCapEase <= 3.0, '소매산 이세분 (0.8 ~ 3.0)',
       f2(M.sleeveCapEase) + '  도면 실측 2.279');
    ok(Math.abs(M.sleeveUnderLenBack - M.sleeveUnderLenFront) <= TOL_SEW, '소매 밑선 (뒤 = 앞)',
       f2(M.sleeveUnderLenBack) + ' / ' + f2(M.sleeveUnderLenFront));
    ok(M.sleeveCapLenBack >= M.armholeBack && M.sleeveCapLenFront >= M.armholeFront,
       '소매산 곡선 ≥ 각 암홀',
       '뒤 ' + f2(M.sleeveCapLenBack) + '≥' + f2(M.armholeBack) +
       ' / 앞 ' + f2(M.sleeveCapLenFront) + '≥' + f2(M.armholeFront));
  }
  // 다트 다리 — 도면과 같은 트루잉이라 0.6 정도 차이가 정상 (BP 에서 잰 길이)
  note('가슴다트 다리 위 ' + f2(M.bustDartLegUp) + ' / 아래 ' + f2(M.bustDartLegLow) +
       '  (도면과 같은 ±0.3 트루잉 — 바깥 끝에서 맞춰 봉제)');
}

function sectionSleeve(m, d) {
  if (!SGT || !d.sleeve) return;
  console.log('\n[4] 반소매 — 도면 대조');
  var s = d.sleeve;
  var want = SGT.expected || SGT.values || SGT;
  var pairs = [
    ['소매산 높이', s.capH, 12.706],
    ['뒤 반폭',     s.halfB, 18.422],
    ['앞 반폭',     s.halfF, 16.016],
    ['소매길이',    s.sleeveLen, 23.0]
  ];
  pairs.forEach(function (p) {
    var e = Math.abs(p[1] - p[2]);
    ok(e <= 0.20, p[0], f2(p[1]) + '  도면 ' + p[2] + '  차 ' + f2(e));
  });
  void want;
}

function sectionSizes() {
  console.log('\n[5] 전 호수 (44~88호) 정상 제도');
  E.SIZES.forEach(function (sz) {
    var m = E.measuresForSize(sz);
    var d, err = null;
    try { d = E.draftLady1(m, { seam: 0 }); } catch (e) { err = e.message; }
    if (err) { ok(false, sz, err); return; }
    var M = d.measures;
    var bad = [];
    if (Math.abs(M.sideBack - M.sideFront) > TOL_SEW) bad.push('옆선 불일치');
    if (M.sideBack < 10) bad.push('옆선 ' + f2(M.sideBack) + ' 너무 짧음');
    if (M.sleeveCapEase !== null && (M.sleeveCapEase <= 0.5 || M.sleeveCapEase > 3.0))
      bad.push('이세분 ' + f2(M.sleeveCapEase));
    d.pieces.forEach(function (p) {
      if (p.outline.length < 100) bad.push(p.id + ' 외곽선 점 부족');
      if (!isFinite(p.bbox.w) || p.bbox.w <= 0) bad.push(p.id + ' bbox 이상');
    });
    ok(bad.length === 0, sz,
       'B ' + m.B + ' · 옆선 ' + f2(M.sideBack) + ' · AH ' + f2(M.armholeTotal) +
       ' · 이세분 ' + (M.sleeveCapEase === null ? '-' : f2(M.sleeveCapEase)) +
       (bad.length ? '  → ' + bad.join(', ') : ''));
  });
}

function sectionSeam() {
  console.log('\n[6] 부위별 시접 — 골선·다트 시접 0 강제');
  var m = E.measuresForSize('66호');
  var d = E.draftLady1(m, { seam: { neck: 1, shoulder: 1, armhole: 1, side: 1.5, hem: 3, sleeveHem: 2.5, fold: 2, dart: 2 } });
  d.pieces.forEach(function (p) {
    ok(p.seamByRole.fold === 0, p.name + ' 골선 시접 0', '입력 2 → ' + p.seamByRole.fold);
    ok(p.seamByRole.dart === 0, p.name + ' 다트 시접 0', '입력 2 → ' + p.seamByRole.dart);
    ok(p.seamline.length > 50, p.name + ' 시접선 생성', p.seamline.length + '점');
  });
}

/* ══ 실행 ══════════════════════════════════════════════════════════════ */
if (process.argv.indexOf('--calibrate') >= 0) {
  calibrate();
} else {
  var m = E.measuresForSize('66호');
  var d = E.draftLady1(m, { seam: 0 });
  console.log('숙녀복 기본원형 I — 검증  (66호: B ' + m.B + ' · 등길이 ' + m.backLen + ' · 앞길이 ' + m.frontLen + ')');
  sectionSkeleton(m, d);
  sectionCurves(m);
  sectionSew(m, d);
  sectionSleeve(m, d);
  sectionSizes();
  sectionSeam();
  console.log('\n' + (fails.length ? '실패 ' + fails.length + '건:\n  - ' + fails.join('\n  - ')
                                   : '전 항목 통과') +
              (warns.length ? '\n경고 ' + warns.length + '건' : ''));
  process.exit(fails.length ? 1 : 0);
}
