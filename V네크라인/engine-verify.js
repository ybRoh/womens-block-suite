/* ============================================================================
 * engine-verify.js — V 네크라인 엔진 검산
 *   1) 66호 제도점·곡선을 원본 DXF(dxf-66-groundtruth.json)와 대조
 *   2) 전 호수 봉제 정합성 (어깨·옆선·안단 길이·다트)
 *   3) 폴리라인 간격·자기교차 같은 출력 품질
 *
 *   실행: node engine-verify.js        (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js');
var U = E.util, V = U.V;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));

var TOL_PT = 0.05;      // 제도점 허용 편차 (cm)
var TOL_CURVE = 0.08;   // 곡선 최대편차 — 손으로 그은 스플라인이라 점보다 느슨하다
var TOL_LEN = 0.10;     // 길이 허용 편차

var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, dec) {
  var s = (+v).toFixed(dec === undefined ? 3 : dec);
  while (s.length < w) s = ' ' + s;
  return s;
}
function ok(name, got, want, tol, unit) {
  var d = Math.abs(got - want), pass = d <= tol;
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 26) +
    f(got, 8) + '  (도면 ' + f(want, 8) + ' · 차 ' + f(d, 6) + (unit || '') + ')');
}
function okPt(name, got, want, tol) {
  var d = V.dist(got, want), pass = d <= (tol || TOL_PT);
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 26) +
    '(' + f(got[0], 7) + ',' + f(got[1], 7) + ')  도면 (' + f(want[0], 7) + ',' + f(want[1], 7) +
    ') · 차 ' + f(d, 6));
}
function curveDev(segs, pts) {
  var poly = U.sampleSegs(segs, 0.03), mx = 0, at = null;
  pts.forEach(function (p) {
    var b = Infinity;
    for (var i = 0; i < poly.length - 1; i++) {
      var a = poly[i], c = poly[i + 1];
      var dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var e = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (e < b) b = e;
    }
    if (b > mx) { mx = b; at = p; }
  });
  return { d: mx, at: at };
}
function okCurve(name, segs, gtName) {
  var g = GT.curves.filter(function (c) { return c.name === gtName; })[0];
  if (!g) { console.log('  ? %-30s 도면 곡선 없음', name); warns++; return; }
  var r = curveDev(segs, g.local), len = U.sLen(segs);
  var pass = r.d <= TOL_CURVE;
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 26) + '최대편차 ' + f(r.d, 6) +
    ' (' + f(r.at[0], 6, 2) + ',' + f(r.at[1], 6, 2) + ') · 길이 ' + f(len, 7) +
    ' (도면 ' + f(g.arc, 7) + ')');
}

console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 66호 제도점 — 원본 DXF 대조   (허용 ' + TOL_PT.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
var m66 = E.measuresForSize('66호');
/* ⚠ 원본 66호 DXF 는 진동올림 3.0 으로 그려졌다. 앱 기본값은 0.5 라 정답지 대조에서는
   반드시 도면값을 명시한다 — 안 그러면 겨드랑·다트·암홀이 2.5 씩 어긋난다. */
var DXF_ARM = (E.K && E.K.armRiseDxf !== undefined) ? E.K.armRiseDxf : 3.0;
var g = E.geom(m66, { armRise: DXF_ARM });

console.log(' [뒷면]');
okPt('BNP',            g.BNP,          [0, -0.3]);
okPt('뒷목 사각 모서리',  g.bNeckCorner,  [7.3, -3.5]);
okPt('목옆점 SNP',      g.SNPb,         [8.226, -3.123]);
okPt('어깨점 SP',       g.SPb,          [20.378, 1.827]);
okPt('겨드랑',          g.Ub,           [23.8, 18.9]);
okPt('허리 옆점',       g.bWaist,       [23.8, 37.5]);
ok  ('등품선 x',        g.bPitchX,      18.4,  TOL_PT);
ok  ('가슴선 BL',       g.BL,           21.9,  TOL_PT);
ok  ('어깨선 길이',      g.shLenBackSeam, 13.121, TOL_LEN);

console.log(' [앞면]');
okPt('목옆점 SNP',      g.SNPf,         [7.3, -0.6]);
okPt('FNP (기본 원형)',  g.FNP,          [0, 7.6]);
okPt('어깨점 SP',       g.SPf,          [19.625, 3.960]);
okPt('겨드랑',          g.Uf,           [23.5, 18.9]);
okPt('BP',             g.BP,           [9.5, 24.2]);
okPt('V 통과점 (1(3/8))', g.vMark,      [5.559, 5.788]);
okPt('앞중심 V 점',      g.Vcf,          [0, 14.6]);
okPt('자락 끝',         g.Vend,         [-23.5, 28.2]);
/* 다트 위치는 B/8 = 10.95 인데 도면에는 10.9 로 반올림해 그려져 있다
   (기본원형의 앞 옆선 23.4 → 23.5 반올림과 같은 경우). 그래서 이 두 점만 0.06 을 준다. */
okPt('다트 아래 다리',    g.dartLo,      [23.5, 26.6],  0.06);
okPt('다트 위 다리',      g.dartHi,      [23.675, 25.111], 0.06);
ok  ('다트 다리 길이',    g.dartLeg,     14.2042, TOL_PT);
ok  ('앞품선 x',        g.fPitchX,      17.15, TOL_PT);
ok  ('어깨선 길이',      g.shLenFrontSeam, 13.091, TOL_LEN);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 66호 곡선 — 원본 DXF 대조   (허용 ' + TOL_CURVE.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
okCurve('뒷목둘레',   g.backNeck, '뒷목둘레');
okCurve('뒤 암홀',    g.backArm,  '뒤 암홀');
okCurve('앞 암홀',    g.frontArm, '앞 암홀');
okCurve('V 네크라인',  g.vNeck,    'V 네크라인');

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 안단선 (조각 안쪽 4.0 평행선) — 원본 DXF 대조');
console.log('════════════════════════════════════════════════════════════');
var d66 = E.draftVNeck(m66, { seam: 0, armRise: DXF_ARM });   // 정답지 대조 — 위 DXF_ARM 주석 참고
function facingInner(pieceId) {
  var p = d66.pieces.filter(function (x) { return x.id === pieceId; })[0];
  var e = p.edges.filter(function (x) { return x.role === 'facing'; })[0];
  return p.outline.slice(e.start, e.end + 1);
}
function polyDev(poly, pts) {
  var mx = 0;
  pts.forEach(function (p) {
    var b = Infinity;
    for (var i = 0; i < poly.length - 1; i++) {
      var a = poly[i], c = poly[i + 1];
      var dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var e = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      if (e < b) b = e;
    }
    if (b > mx) mx = b;
  });
  return mx;
}
[['backNeckFacing', '뒤 목둘레 안단선'], ['backArmFacing', '뒤 암홀 안단선'],
 ['frontArmFacing', '앞 암홀 안단선'],   ['frontNeckFacing', 'V 네크라인 안단선']]
.forEach(function (w) {
  var gt = GT.curves.filter(function (c) { return c.name === w[1]; })[0];
  if (!gt) { console.log('  ? %s 도면 없음', w[1]); warns++; return; }
  var poly = facingInner(w[0]);
  var d = polyDev(poly, gt.local), pass = d <= TOL_CURVE + 0.04;
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(w[1], 22) + '최대편차 ' + f(d, 6) +
    ' · 길이 ' + f(U.polyLen(poly), 7) + ' (도면 ' + f(gt.arc, 7) + ')');
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 전 호수 봉제 정합성');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var mm = E.measuresForSize(sz), d = E.draftVNeck(mm, { seam: 0 }), M = d.measures, gg = E.geom(mm);
  var shDiff = Math.abs(M.shoulderBackSeam - M.shoulderFrontSeam);
  var sideCut = Math.abs(M.sideBack - M.sideFront);
  var line = [];
  function chk(cond, msg) { if (!cond) { line.push(msg); fails++; } }
  var sideSewn = Math.abs(M.sideBack - M.sideFrontSewn);
  chk(shDiff <= 0.10, '어깨 ' + shDiff.toFixed(2));
  /* 트루잉 켬 → 봉제 후 옆선이 뒤와 같아야 한다 · 끔 → 교재 도면대로 재단 길이가 같다 */
  if (M.sideTrue) chk(sideSewn <= 0.05, '옆선(봉제) ' + sideSewn.toFixed(3));
  else            chk(sideCut  <= 0.10, '옆선(재단) ' + sideCut.toFixed(3));
  chk(gg.armY > 0 && gg.armY < gg.WL, '겨드랑 위치');
  chk(M.vDepth < gg.WL, 'V 깊이');
  /* 다트가 겨드랑에 붙으면 암홀 안단이 못 들어가고 봉제도 나쁘다 —
     옆선 비율로 잡았으므로 전 호수에서 안단너비 이상이어야 한다 */
  chk(gg.sideUpper >= M.facing, '겨드랑~다트 ' + gg.sideUpper.toFixed(2) + ' < 안단 ' + M.facing);
  /* 안단 길이 = 대응 몸판 변 길이 (안단은 겉과 같은 변에 붙는다) */
  var nf = d.pieces.filter(function (p) { return p.id === 'frontNeckFacing'; })[0];
  chk(!!nf, '앞 목둘레 안단 없음');
  console.log('  ' + (line.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '어깨 뒤 ' + f(M.shoulderBackSeam, 6) + ' 앞 ' + f(M.shoulderFrontSeam, 6) + ' (차 ' + f(shDiff, 5) + ')' +
    ' · 옆선 뒤 ' + f(M.sideBack, 6, 2) + ' 앞 재단 ' + f(M.sideFront, 6, 2) +
    ' 앞 봉제 ' + f(M.sideFrontSewn, 6, 2) + ' (밑단 내림 ' + f(M.hemDrop, 5, 2) + ')' +
    ' · 암홀 ' + f(M.armholeTotal, 6, 2) + ' · 목둘레 ' + f(M.neckTotal, 6, 2) +
    ' · 겨드랑~다트 ' + f(gg.sideUpper, 5, 2));
  if (line.length) console.log('      → ' + line.join(' · '));
});

/* 트루잉을 끈 상태(= 교재 도면 그대로)도 함께 확인 */
console.log('');
E.SIZES.forEach(function (sz) {
  var M = E.draftVNeck(E.measuresForSize(sz), { seam: 0, sideTrue: false }).measures;
  var d1 = Math.abs(M.sideBack - M.sideFront);
  var pass = d1 <= 0.10;
  if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(sz, 5) + '트루잉 끔(교재 도면) — 재단 뒤 ' +
    f(M.sideBack, 6, 2) + ' 앞 ' + f(M.sideFront, 6, 2) +
    ' · 봉제 앞 ' + f(M.sideFrontSewn, 6, 2) +
    ' → 뒤보다 ' + f(M.sideBack - M.sideFrontSewn, 5, 2) + ' 부족');
});
console.log('\n  ※ 기본은 트루잉 켬 — 다트 아래 옆선을 늘리고 밑단을 다시 그려 봉제 후 뒤와 맞춘다.');
console.log('     교재 도면 그대로 보려면 UI 의 「옆선 트루잉」을 끄면 된다.');
warns++;

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5. 출력 품질 (폴리라인 간격 · 시접)');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var d = E.draftVNeck(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT });
  d.pieces.forEach(function (p) {
    var mx = 0;
    for (var i = 1; i < p.outline.length; i++) mx = Math.max(mx, V.dist(p.outline[i - 1], p.outline[i]));
    var bad = mx > 0.06 || !p.seamline || p.seamline.length < 8;
    if (bad) { fails++; console.log('  ✗ %s %s  최대 점간격 %.3f · 시접선 %d점', sz, p.name, mx, p.seamline ? p.seamline.length : 0); }
  });
});
console.log('  ✓ 전 호수 7조각 점간격 ≤ 0.06 cm · 시접선 생성 확인');

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5-1. 안단 너치 — 붙을 몸판에 같은 자리 너치가 있어야 한다');
console.log('════════════════════════════════════════════════════════════');
var PAIR = {
  backNeckFacing:      ['back'],
  backArmFacing:       ['back'],
  frontArmFacing:      ['front', 'frontPlain'],
  frontNeckFacing:     ['front']
};
E.SIZES.forEach(function (sz) {
  var d = E.draftVNeck(E.measuresForSize(sz), { seam: 0 });
  var by = {};
  d.pieces.forEach(function (p) { by[p.id] = p; });
  var bad = [], n = 0;
  Object.keys(PAIR).forEach(function (fid) {
    var fp = by[fid];
    if (!fp) { bad.push(fid + ' 없음'); return; }
    if (!fp.notches.length) bad.push(fid + ' 너치 0개');
    fp.notches.forEach(function (nt) {
      n++;
      var found = PAIR[fid].every(function (bid) {
        var bp = by[bid];
        return bp && bp.notches.some(function (m) {
          return m.label === nt.label && V.dist(m.p, nt.p) <= 0.001;
        });
      });
      if (!found) bad.push(fid + ':' + nt.label);
    });
  });
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '안단 너치 ' + n + '개 모두 몸판과 같은 좌표' + (bad.length ? ' — 어긋남: ' + bad.join(', ') : ''));
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5-2. 안단 변 시접 = 붙을 몸판 변 시접 · 골선은 0');
console.log('════════════════════════════════════════════════════════════');
var WANT = {
  backNeckFacing:      { 가장자리: 'neck',    뒤중심: 'fold',  어깨선: 'shoulder' },
  backArmFacing:       { 가장자리: 'armhole', 옆선: 'side',    어깨선: 'shoulder' },
  frontArmFacing:      { 가장자리: 'armhole', 옆선: 'side',    어깨선: 'shoulder' },
  frontNeckFacing:     { 가장자리: 'neck',    '자락 끝': 'side', 어깨선: 'shoulder' }
};
(function () {
  var SD = E.SEAM_DEFAULT, d = E.draftVNeck(m66, { seam: SD }), bad = [];
  Object.keys(WANT).forEach(function (id) {
    var p = d.pieces.filter(function (x) { return x.id === id; })[0];
    if (!p) { bad.push(id + ' 없음'); return; }
    Object.keys(WANT[id]).forEach(function (nm) {
      var e = p.edges.filter(function (x) { return x.name === nm; })[0];
      var want = WANT[id][nm];
      if (!e) { bad.push(id + '/' + nm + ' 변 없음'); return; }
      if (e.role !== want) bad.push(id + '/' + nm + ' role ' + e.role + ' ≠ ' + want);
      if (Math.abs(e.seam - SD[want]) > 1e-9)
        bad.push(id + '/' + nm + ' 시접 ' + e.seam + ' ≠ ' + SD[want]);
    });
  });
  /* 골선이 있는 조각은 시접선이 골선을 넘어가면 안 된다 (SPEC §11-2) */
  [0, 1.0, 3.0, SD].forEach(function (sm) {
    E.SIZES.forEach(function (sz) {
      E.draftVNeck(E.measuresForSize(sz), { seam: sm }).pieces.forEach(function (p) {
        if (!(p.edges || []).some(function (e) { return e.role === 'fold'; })) return;
        var mo = Math.min.apply(null, p.outline.map(function (q) { return q[0]; }));
        var ms = Math.min.apply(null, p.seamline.map(function (q) { return q[0]; }));
        if (ms < mo - 1e-6) bad.push(sz + '/' + p.name + ' 시접선이 골선 밖 ' + (mo - ms).toFixed(3));
      });
    });
  });
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') +
    '안단 5조각 변 role·시접 일치 · 골선 넘어가는 시접선 없음' +
    (bad.length ? '\n      → ' + bad.slice(0, 6).join('\n      → ') : ''));
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5-3. 극단 옵션 스윕 — 예외·NaN·자기교차·조각 폭주');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var OPT = {
    facing:     [2, 4, 8],
    armRise:    [0, 3, 6],
    dartAmount: [0, 1.5, 4],
    dartRise:   [4, 10.95, 20],
    vDepth:     [8, 14.6, 30],
    wrapUp:     [2, 9.3, 20],
    sideTrue:   [true, false]
  };
  var keys = Object.keys(OPT), n = 0, bad = [];
  function selfX(p) {
    var c = 0;
    for (var i = 0; i < p.length - 1; i++)
      for (var j = i + 2; j < p.length - 1; j++) {
        if (i === 0 && j === p.length - 2) continue;
        if (segX(p[i], p[i + 1], p[j], p[j + 1])) c++;
      }
    return c;
  }
  function segX(p1, p2, p3, p4) {
    var dd = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(dd) < 1e-12) return null;
    var t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / dd;
    var u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / dd;
    return (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) ? 1 : null;
  }
  E.SIZES.forEach(function (sz) {
    var mm = E.measuresForSize(sz);
    keys.forEach(function (k) {
      OPT[k].forEach(function (v) {
        var o = { seam: E.SEAM_DEFAULT }; o[k] = v; n++;
        var d;
        try { d = E.draftVNeck(mm, o); }
        catch (e) { bad.push(sz + ' ' + k + '=' + v + ' 예외 ' + e.message); return; }
        /* 설정끼리 모순인 조합(안단이 들어갈 자리보다 넓음)은 엔진이 경고로 알린다 —
           도형을 억지로 맞추지 않으므로 크기 검사에서 제외하고 경고 유무만 본다. */
        if (d.warnings.length) {
          if (!/안단/.test(d.warnings[0])) bad.push(sz + ' ' + k + '=' + v + ' 경고 문구 이상');
          return;
        }
        var body = d.pieces.filter(function (p) { return p.id === 'front'; })[0];
        d.pieces.forEach(function (p) {
          var nan = p.outline.some(function (q) { return !isFinite(q[0]) || !isFinite(q[1]); });
          if (nan) bad.push(sz + ' ' + k + '=' + v + ' ' + p.name + ' NaN');
          if (p.kind === 'facing' && (p.bbox.w > body.bbox.w + 0.01 || p.bbox.h > body.bbox.h + 0.01))
            bad.push(sz + ' ' + k + '=' + v + ' ' + p.name + ' 폭주 ' +
                     p.bbox.w.toFixed(1) + '×' + p.bbox.h.toFixed(1));
          var x = selfX(p.seamline);
          if (x) bad.push(sz + ' ' + k + '=' + v + ' ' + p.name + ' 시접 자기교차 ' + x);
        });
      });
    });
  });
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + n + '개 조합 · 예외 0 · NaN 0 · 안단 폭주 0 · 시접 자기교차 0' +
    (bad.length ? '\n      → ' + bad.slice(0, 8).join('\n      → ') +
      (bad.length > 8 ? '\n      → 외 ' + (bad.length - 8) + '건' : '') : ''));
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5-4. 인쇄 배치 — 캔버스 밖으로 나가는 조각이 없어야 한다');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var PR;
  try { PR = require('./print.js'); } catch (e) { console.log('  ? print.js 로드 실패 — 건너뜀'); warns++; return; }
  [['roll', { mode: 'roll', rollWidthMm: 594 }], ['a4', { mode: 'a4' }]].forEach(function (w) {
    var bad = [], tot = 0;
    E.SIZES.forEach(function (sz) {
      var d = E.draftVNeck(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT });
      var o = { seam: E.SEAM_DEFAULT };
      for (var kk in w[1]) o[kk] = w[1][kk];
      var L = PR.buildPrintLayout(d, o), c = L.info.canvas;
      L.info.placements.forEach(function (q) {
        if (q.xMm < -1e-6 || q.yMm < -1e-6) bad.push(sz + ' ' + q.name + ' 음수좌표');
        if (q.xMm + q.wMm > c.wMm + 1e-6) bad.push(sz + ' ' + q.name + ' 우측 넘침 ' + (q.xMm + q.wMm - c.wMm).toFixed(2));
        if (q.yMm + q.hMm > c.hMm + 1e-6) bad.push(sz + ' ' + q.name + ' 하단 넘침 ' + (q.yMm + q.hMm - c.hMm).toFixed(2));
      });
      /* 조각끼리 겹치면 안 된다 */
      var pls = L.info.placements;
      for (var a = 0; a < pls.length; a++) for (var b2 = a + 1; b2 < pls.length; b2++) {
        var A = pls[a], B = pls[b2];
        if (A.xMm < B.xMm + B.wMm - 1e-6 && B.xMm < A.xMm + A.wMm - 1e-6 &&
            A.yMm < B.yMm + B.hMm - 1e-6 && B.yMm < A.yMm + A.hMm - 1e-6)
          bad.push(sz + ' ' + A.name + ' ↔ ' + B.name + ' 겹침');
      }
      tot += L.pageCount;
    });
    if (bad.length) fails++;
    console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(w[0] === 'roll' ? 'A1 롤' : 'A4 타일', 8) +
      '전 호수 배치 정상 · 총 ' + tot + '장' + (bad.length ? '\n      → ' + bad.slice(0, 5).join('\n      → ') : ''));
  });
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 6. 자락 없는 앞면 — 자락 앞면과 같은 변을 써야 한다');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var mm = E.measuresForSize(sz), gg = E.geom(mm), dd = E.draftVNeck(mm, { seam: 0 });
  var pl = dd.pieces.filter(function (p) { return p.id === 'frontPlain'; })[0];
  var wr = dd.pieces.filter(function (p) { return p.id === 'front'; })[0];
  var line = [];
  function chk(c, m) { if (!c) { line.push(m); fails++; } }
  chk(!!pl, '조각 없음');
  if (pl) {
    /* 앞중심은 골선(시접 0) 이어야 하고, 폭은 옆선 x 와 같아야 한다 */
    var fold = pl.edges.filter(function (e) { return e.role === 'fold'; })[0];
    chk(!!fold, '앞중심 골선 없음');
    /* 다트 위 다리는 옆선보다 조금 바깥으로 나간다 (접으면 들어온다) — 그 값까지 폭에 든다 */
    var wMax = Math.max(gg.fSideX, gg.dartHi[0]);
    chk(Math.abs(pl.bbox.w - wMax) <= 0.05,
        '폭 ' + pl.bbox.w.toFixed(2) + ' ≠ max(옆선 ' + gg.fSideX.toFixed(2) + ', 다트 위 다리 ' + gg.dartHi[0].toFixed(2) + ')');
    chk(Math.abs(pl.bbox.h - wr.bbox.h) <= 0.01, '높이가 자락 앞판과 다름');
    /* V 네크라인 위쪽 길이 = 자락 앞판 목둘레 − 앞중심 아래쪽 */
    var upLen = U.sLen(gg.vNeckUp), allLen = U.sLen(gg.vNeck);
    chk(upLen > 0 && upLen < allLen, 'V 위쪽 곡선 길이');
    console.log('  ' + (line.length ? '✗ ' : '✓ ') + pad(sz, 5) +
      '폭 ' + f(pl.bbox.w, 6, 2) + ' (옆선 ' + f(gg.fSideX, 5, 2) + ' + 다트다리 튀어나옴 ' +
      f(gg.dartHi[0] - gg.fSideX, 4, 2) + ') · 높이 ' + f(pl.bbox.h, 6, 2) +
      ' · V 위쪽 ' + f(upLen, 6, 2) + ' (자락 전체 ' + f(allLen, 6, 2) + ')' +
      ' · 앞중심 시접 ' + f(fold ? fold.seam : -1, 4, 1));
  }
  if (line.length) console.log('      → ' + line.join(' · '));
});

console.log('\n════════════════════════════════════════════════════════════');
console.log((fails ? ' 실패 ' + fails + '건' : ' 전체 통과') + ' · 참고 ' + warns + '건');
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
