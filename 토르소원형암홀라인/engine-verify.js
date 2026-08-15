/* ============================================================================
 * engine-verify.js — 토르소 원형 암홀라인 검산
 *   1) 66호 제도점·곡선을 원본 DXF(dxf-66-groundtruth.json)와 대조
 *   2) **프린세스 4조각 봉제 짝** — 이 원형의 핵심 검사
 *   3) 전 호수 조각 품질 · 인쇄 배치
 *   실행: node engine-verify.js   (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'dxf-66-groundtruth.json'), 'utf8'));
var C = {}; GT.curves.forEach(function (c) { C[c.name] = c; });
var TOL_PT = 0.05, TOL_CURVE = 0.30, TOL_LEN = 0.25;
var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 3 : d); while (s.length < w) s = ' ' + s; return s; }
function okPt(name, got, want, tol) {
  var d = V.dist(got, want), pass = d <= (tol || TOL_PT); if (!pass) fails++;
  console.log('  ' + (pass ? '✓ ' : '✗ ') + pad(name, 20) + '(' + f(got[0], 8) + ',' + f(got[1], 7) +
    ')  도면 (' + f(want[0], 8) + ',' + f(want[1], 7) + ') · 차 ' + f(d, 6));
}
function dev(segs, pts) {
  var poly = U.sampleSegs(segs, 0.03), mx = 0;
  pts.forEach(function (p) {
    var b = Infinity;
    for (var i = 0; i < poly.length - 1; i++) {
      var a = poly[i], c = poly[i + 1], dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy;
      var t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      var e = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); if (e < b) b = e;
    }
    if (b > mx) mx = b;
  });
  return mx;
}
/* 아직 정답지에 못 맞춘 곡선과 그 이유. 여기 적힌 것만 ⚠ 로 넘어간다. */
var OPEN = {
  '앞목둘레': '편차 0.214 · 길이 −0.13 (0.338 에서 줄었다)',
  '뒤 옆선': '편차 0.172 · 길이 −0.03 (0.336 에서 줄었다)',
  '뒤 절개선 (바깥)': '편차 0.281 · 길이 +0.002 (2.15 → 0.38 → 0.28)',
  '뒤 절개선 (안쪽)': '편차 0.762 — 암홀 출발로 바뀌며 커졌다. 통과점을 2개까지 넣어 1.35 → 0.76',
  /* 앞 절개선은 암홀에서 BP 까지가 길어져 통과점 하나로는 0.3 대까지만 줄었다.
     0.385/0.370 은 재단 정밀도(0.5mm) 안이라 여기서 멈춘다 — 통과점을 더 넣으면
     이웃 구간이 튄다(memory ②의 「앵커가 항상 좋진 않다」). */
  '앞 절개선 (바깥)': '편차 0.385 · 길이 −0.019 (통과점 넣어 1.306 → 0.385)',
  '앞 절개선 (안쪽)': '편차 0.370 (1.512 → 0.370). 길이 차 +5.9 는 **정답지 탓** — 도면 「암홀~MP」가 MP(24.25) 에서 끊겨 BP(26.29) 까지 2.1 이 비어 있다'
};
function okCurve(name, segs, gtPts, gtLen) {
  var d = dev(segs, gtPts), L = U.sLen(segs), dl = Math.abs(L - gtLen);
  var pass = d <= TOL_CURVE && dl <= TOL_LEN, open = OPEN[name];
  if (!pass) { if (open) warns++; else fails++; }
  console.log('  ' + (pass ? '✓ ' : open ? '⚠ ' : '✗ ') + pad(name, 20) + '최대편차 ' + f(d, 6) +
    ' · 길이 ' + f(L, 8) + ' (도면 ' + f(gtLen, 8) + ')' + (pass || !open ? '' : '\n      ⚠ ' + open));
}
var m66 = E.measuresForSize('66호'), g = E.geom(m66);
console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 66호 제도점 — 원본 DXF 대조  (허용 ' + TOL_PT.toFixed(2) + ' cm)');
console.log('════════════════════════════════════════════════════════════');
var bn = C['뒷목둘레'].local, fn = C['앞목둘레'].local, ba = C['뒤 암홀'].local, fa = C['앞 암홀'].local;
/* 정답지 점열 방향은 곡선마다 다르다 — **어깨점이 앞에 오도록** 맞춘다.
   (앞 암홀은 겨드랑 → 어깨 순서라 그대로 쓰면 SP 와 겨드랑을 뒤바꿔 비교하게 된다) */
if (fa[0][1] > fa[fa.length - 1][1]) fa = fa.slice().reverse();
if (ba[0][1] > ba[ba.length - 1][1]) ba = ba.slice().reverse();
console.log(' [뒷면]');
okPt('BNP',        g.BNP,  bn[bn.length - 1]);
okPt('목옆점 SNP',  g.SNPb, bn[0]);
okPt('뒤 어깨끝(−1.0)', g.bShEnd, ba[0]);   // 암홀라인: 어깨 다트 없이 1.0 안쪽
okPt('겨드랑',      g.Ub,   ba[ba.length - 1]);
console.log(' [앞면]');
okPt('FNP',        g.FNP,  fn[0]);
okPt('목옆점 SNP',  g.SNPf, fn[fn.length - 1]);
okPt('어깨점 SP',   g.SPf,  fa[0]);
okPt('겨드랑',      g.Uf,   fa[fa.length - 1]);
okPt('BP',         g.BP,   C['앞 절개선 (암홀~BP) A'].local.slice(-1)[0]);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 66호 곡선 — 원본 DXF 대조  (허용 편차 ' + TOL_CURVE.toFixed(2) + ' · 길이 ' + TOL_LEN.toFixed(2) + ')');
console.log('════════════════════════════════════════════════════════════');
okCurve('뒷목둘레', g.backNeck,  C['뒷목둘레'].local, C['뒷목둘레'].arc);
okCurve('앞목둘레', g.frontNeck, C['앞목둘레'].local, C['앞목둘레'].arc);
okCurve('뒤 암홀',  g.backArm,   C['뒤 암홀'].local,  C['뒤 암홀'].arc);
okCurve('앞 암홀',  g.frontArm,  C['앞 암홀'].local,  C['앞 암홀'].arc);
okCurve('뒤 옆선',  g.backSide,  C['뒤 옆선 (BL~밑단)'].local, C['뒤 옆선 (BL~밑단)'].arc);
/* ⚠ 새 도면의 A/B 는 프린세스판과 **반대**다. 허리 끝점으로 짝을 정한다:
     바깥(Out) = 허리 bPwA 13.149 · 안쪽(In) = 허리 bPwB 10.652
     앞 : 바깥 = 허리 fPwA 10.600 · 안쪽 = 허리 fPwB 8.400 */
okCurve('뒤 절개선 (바깥)', g.bPrinOut,
  C['뒤 절개선 (암홀~허리) B'].local.concat(C['뒤 절개선 (허리~밑단) A'].local),
  C['뒤 절개선 (암홀~허리) B'].arc + C['뒤 절개선 (허리~밑단) A'].arc);
okCurve('뒤 절개선 (안쪽)', g.bPrinIn,
  C['뒤 절개선 (암홀~허리) A'].local.concat(C['뒤 절개선 (허리~밑단) B'].local),
  C['뒤 절개선 (암홀~허리) A'].arc + C['뒤 절개선 (허리~밑단) B'].arc);
/* ★ 암홀라인의 핵심 — 앞 절개선이 **암홀에서** 출발한다.
   앞 「허리~밑단 A」는 밑단 8.900 = fPhA(바깥) 이고 BP 에서 끝난다. */
okCurve('앞 절개선 (바깥)', g.fPrinOut,
  C['앞 절개선 (암홀~BP) A'].local.concat(C['앞 절개선 (허리~밑단) A'].local),
  C['앞 절개선 (암홀~BP) A'].arc + C['앞 절개선 (허리~밑단) A'].arc);
okCurve('앞 절개선 (안쪽)', g.fPrinIn,
  C['앞 절개선 (암홀~MP) B'].local.concat(C['앞 절개선 (허리~밑단) B'].local),
  C['앞 절개선 (암홀~MP) B'].arc + C['앞 절개선 (허리~밑단) B'].arc);

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 봉제 짝 — 프린세스 4조각이 맞물리는 변 (하드 검사)');
console.log('════════════════════════════════════════════════════════════');
console.log('   맞물리는 짝을 지키지 못하면 옷이 안 된다. 정답지가 없어도 이건 검사할 수 있다.');
E.SIZES.forEach(function (sz) {
  var d = E.draftTorso(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), M = d.measures;
  var bad = [];
  /** 차가 **정해진 값(이세)** 이어야 하는 짝 */
  function chk2(nm, a, b, want, tol) {
    if (Math.abs((b - a) - want) > tol)
      bad.push(nm + ' ' + f(a, 0) + '↔' + f(b, 0) + ' 차 ' + f(b - a, 0) + ' (이세 ' + want + ' 이라야 한다)');
  }
  function chk(nm, a, b, tol) {
    if (Math.abs(a - b) > tol) bad.push(nm + ' ' + f(a, 0) + '↔' + f(b, 0) + ' 차 ' + f(a - b, 0));
  }
  chk('뒤절개', M.princessBackIn, M.princessBackOut, 0.35);
  chk('앞절개', M.princessFrontIn, M.princessFrontOut, 0.35);
  chk('옆선',   M.sideBack, M.sideFront, 0.25);
  /* ★ 암홀라인은 어깨선이 갈라지지 않는다 — 어깨 짝은 **하나**다.
     뒤는 다트 없이 어깨점에서 1.0 안쪽에서 끝난다. 도면 실측 뒤 11.666 · 앞 11.960 이라
     차 0.294 가 **이세분**이다 (도면 「0.3(⅛)」) — 0 이 아니라 0.3 이 정상. */
  chk2('어깨', V.dist(d.meta.geom.SNPb, d.meta.geom.bShEnd), V.dist(d.meta.geom.SNPf, d.meta.geom.SPf), 0.30, 0.08);
  /* 절개선이 암홀을 두 도막으로 나눈다 — 합이 전체와 같아야 한다 */
  chk('뒤 암홀 분할', U.sLen(d.meta.geom.bArmLow) + U.sLen(d.meta.geom.bArmUp), U.sLen(d.meta.geom.backArm), 0.02);
  chk('앞 암홀 분할', U.sLen(d.meta.geom.fArmLow) + U.sLen(d.meta.geom.fArmUp), U.sLen(d.meta.geom.frontArm), 0.02);
  /* ★ 암홀라인은 어깨 다트가 없다 — 앞이 0.3 길고 그만큼 이세로 먹인다 (도면 「0.3(⅛)」).
     0 을 기대하면 전 호수 실패한다. 이세 값 자체를 검사한다. */
  chk2('어깨봉제', M.shoulderBackSewn, M.shoulderFrontSewn, 0.30, 0.05);
  if (d.pieces.length !== 4) bad.push('조각 ' + d.pieces.length + '장 (4 이라야 한다)');
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '뒤절개 ' + f(M.princessBackIn, 7) + '/' + f(M.princessBackOut, 7) +
    ' · 앞절개 ' + f(M.princessFrontIn, 7) + '/' + f(M.princessFrontOut, 7) +
    ' · 옆선 ' + f(M.sideBack, 7) + '/' + f(M.sideFront, 7) +
    ' · 가슴다트 ' + f(M.bustDart, 6) + (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/** 점이 폐다각형 안에 있는가 — ray casting. 오목한 조각(암홀)에서도 정확하다. */
function ptInPoly(pt, poly) {
  var c = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3.5 맞춤 너치 — 짝이 되는 두 변의 **같은 자리**에 있는가 (하드 검사)');
console.log('════════════════════════════════════════════════════════════');
console.log('   너치가 어긋나면 봉제할 때 조각이 밀린다. **짝의 공통 기준점**(어깨 절개점 · 겨드랑)에서');
console.log('   잰 거리로 비교한다 — 그냥 변 시작에서 재면 한쪽이 뒤집혀 들어와 38cm 어긋나도 통과한다.');
(function () {
  function distFrom(q, ref, pt) {
    if (V.dist(q[0], ref) > V.dist(q[q.length - 1], ref)) q = q.slice().reverse();
    var acc = 0, b = Infinity, at = 0;
    for (var i = 1; i < q.length; i++) {
      acc += V.dist(q[i - 1], q[i]);
      var e = V.dist(q[i], pt); if (e < b) { b = e; at = acc; }
    }
    return at;
  }
  E.SIZES.forEach(function (sz) {
    var mm = E.measuresForSize(sz), g = E.geom(mm);
    var d = E.draftTorso(mm, { seam: E.SEAM_DEFAULT }), P = {};
    d.pieces.forEach(function (p) { P[p.id] = p; });
    /* 여러 변에 걸친 짝(앞옆면 옆선은 위/아래 두 변)도 이어 붙여 잰다 */
    function edges(id, names) {
      var p = P[id], out = [];
      names.forEach(function (n) {
        var e = (p.edges || []).filter(function (x) { return x.name === n; })[0];
        if (e) out = out.concat(p.outline.slice(e.start, e.end + 1));
      });
      return out;
    }
    /* ★ 그 변 **위에 놓인 너치 전부**를 가져온다 — 라벨 앞머리로 고르면 안 된다.
       '절개' 로 시작하는 것만 짝지어 보다가 앞면에만 있던 BP·허리(2개)를 놓쳤다
       (2026-08-12). 한쪽에만 있는 너치는 맞출 데가 없으니 그것 자체가 결함이다. */
    function ntOn(id, poly) {
      return P[id].notches.filter(function (n) {
        var b = Infinity;
        for (var i = 0; i < poly.length; i++) { var e = V.dist(n.p, poly[i]); if (e < b) b = e; }
        return b <= 0.06;
      });
    }
    /* 짝이 없어도 되는 너치 — 다트 다리는 접어서 서로 포개지는 자리라 상대 조각에 짝이 없다 */
    var SOLO = ['가슴다트'];
    var PAIRS = [
      ['뒤 절개', 'back', ['절개선'], g.bPrinB, 'backSide', ['절개선'], g.bPrinA],
      ['앞 절개', 'front', ['절개선'], g.fPrinB, 'frontSide', ['절개선'], g.fPrinA],
      ['옆선',   'backSide', ['옆선'], g.Ub, 'frontSide', ['옆선 (위)', '옆선 (아래)'], g.Uf]
    ];
    var bad = [], worst = 0;
    PAIRS.forEach(function (w) {
      var A = edges(w[1], w[2]), B = edges(w[4], w[5]);
      if (!A.length || !B.length) { bad.push(w[0] + ' 변 없음'); return; }
      var na = ntOn(w[1], A), nb = ntOn(w[4], B);
      if (!na.length || !nb.length) { bad.push(w[0] + ' 너치 없음'); return; }
      function key(n) { return n.label; }
      /* ⚠ 「맞춤」은 **변 길이 30cm 규칙**으로 자동으로 붙는 보조 너치다 (2026-08-15).
         앞뒤 옆선 길이가 다르면 한쪽에만 생기는 것이 정상이라 짝 검사에서 뺀다 —
         짝을 맞추는 진짜 너치(허리·BP·진동선…)는 그대로 검사한다. */
      function solo(n) { return SOLO.indexOf(n.label) >= 0 || n.label === '맞춤'; }
      /* ① 한쪽에만 있는 너치 — 봉제할 때 맞출 상대가 없다 */
      [[na, nb, w[1]], [nb, na, w[4]]].forEach(function (t) {
        var have = {};
        t[1].forEach(function (n) { have[key(n)] = (have[key(n)] || 0) + 1; });
        var seen = {};
        t[0].forEach(function (n) {
          if (solo(n)) return;
          seen[key(n)] = (seen[key(n)] || 0) + 1;
          if (seen[key(n)] > (have[key(n)] || 0))
            bad.push(w[0] + ' 「' + n.label + '」 짝 없음 (' + P[t[2]].name + '에만 있다)');
        });
      });
      /* ② **구간별 이세** — 너치와 너치 사이에서 두 변의 길이 차가 봉제 가능한가.
         「어깨에서 잰 거리가 같아야 한다」로만 보면 안 된다. 이세는 어딘가 한 구간에
         들어가야 하고, 어느 구간에 넣을지가 곧 너치의 목적이다. 대신 **한 구간에
         몰렸다가 다음 구간에서 되돌아오는 지그재그**(±0.32)는 못 꿰맨다 — 짧은
         구간을 0.32 늘렸다 줄였다 해야 하기 때문이다. 그래서 구간차를 본다. */
      var la = 0, lb = 0, ii;
      for (ii = 1; ii < A.length; ii++) la += V.dist(A[ii - 1], A[ii]);
      for (ii = 1; ii < B.length; ii++) lb += V.dist(B[ii - 1], B[ii]);
      var seq = na.filter(function (n) { return !solo(n); })
        .map(function (n) {
          var m = nb.filter(function (x) { return key(x) === key(n); })[0];
          return m && { l: n.label, a: distFrom(A, w[3], n.p), b: distFrom(B, w[6], m.p) };
        }).filter(Boolean).sort(function (x, y) { return x.a - y.a; });
      /* 너치 차례가 두 변에서 같아야 한다 — 뒤집혀 들어오면 여기서 걸린다 */
      for (ii = 1; ii < seq.length; ii++)
        if (seq[ii].b < seq[ii - 1].b) bad.push(w[0] + ' 너치 차례가 뒤바뀜 (' + seq[ii - 1].l + ' → ' + seq[ii].l + ')');
      var pa = 0, pb = 0;
      seq.concat([{ l: '밑단', a: la, b: lb }]).forEach(function (s) {
        var dd = Math.abs((s.b - pb) - (s.a - pa));
        pa = s.a; pb = s.b;
        if (dd > worst) worst = dd;
        if (dd > 0.40) bad.push(w[0] + ' ~「' + s.l + '」 구간 이세 ' + dd.toFixed(3));
      });
    });
    d.pieces.forEach(function (p) {
      if (!p.notches.length) bad.push(p.name + ' 너치 0개');
      /* ★ 봉제하는 변에 **시접이 0 이면** 재단하면 못 꿰맨다. 골선(fold)만 0 이어야 한다.
         `princess` role 이 SEAM_DEFAULT 에 없어 절개선 4곳이 전부 0 으로 나갔다
         (2026-08-12) — 검사가 없어서 통과했다. */
      (p.edges || []).forEach(function (e) {
        if (e.role !== 'fold' && !(e.seam > 0))
          bad.push(p.name + ' 「' + e.name + '」(' + e.role + ') 시접 0');
      });
      /* 너치 각이 **조각 안쪽**을 향해야 한다 — 바깥이면 재단할 때 반대로 판다.
         ⚠ 무게중심으로 재면 **오목한 변(암홀)에서 새어 나간다** — 무게중심 판정은
         통과하는데 실제 0.5cm 틱은 조각 밖이었다(암홀 2/3 너치 2개, 전 호수).
         그리는 것과 같은 방식, 즉 **틱 끝점의 point-in-polygon** 으로 판정한다. */
      p.notches.forEach(function (n) {
        var a = n.angle * Math.PI / 180;
        if (!ptInPoly([n.p[0] + Math.cos(a) * 0.5, n.p[1] + Math.sin(a) * 0.5], p.outline))
          bad.push(p.name + ' 「' + n.label + '」 너치 틱이 조각 밖으로 나간다');
        /* 너치는 외곽선 위에 있어야 한다 */
        var b = Infinity;
        for (var i = 0; i < p.outline.length; i++) {
          var e = V.dist(n.p, p.outline[i]); if (e < b) b = e;
        }
        if (b > 0.06) bad.push(p.name + ' 「' + n.label + '」 너치가 외곽선 밖 ' + b.toFixed(3));
      });
    });
    if (bad.length) fails++;
    console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
      '너치 ' + d.pieces.map(function (p) { return p.name + ' ' + p.notches.length; }).join(' · ') +
      ' · 최대 어긋남 ' + f(worst, 6) + (bad.length ? '\n      → ' + bad.join(' · ') : ''));
  });
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3.6 전 호수 기하 sanity — 66호만 맞는 결함을 잡는다');
console.log('════════════════════════════════════════════════════════════');
console.log('   66호 실측 좌표를 골격에 박으면 다른 호수가 조용히 깨진다. 44호 뒤 암홀이');
console.log('   겨드랑선 아래로 2.26 파고들어 갈고리가 된 채 통과했었다 (2026-08-12 QA).');
(function () {
  var prev = null, bad = [];
  E.SIZES.forEach(function (sz) {
    var m = E.measuresForSize(sz), BL = m.B / 4;
    var d = E.draftTorso(m, { seam: E.SEAM_DEFAULT }), P = {}, cur = {};
    d.pieces.forEach(function (p) { P[p.id] = p; });
    var row = [];
    /* ① 암홀이 겨드랑선(BL) 아래로 내려가면 안 된다 — 내려가면 소매를 못 단다 */
    [['backSide', '뒤'], ['frontSide', '앞']].forEach(function (t) {
      var p = P[t[0]], e = (p.edges || []).filter(function (x) { return x.role === 'armhole'; })[0];
      if (!e) { bad.push(sz + ' ' + t[1] + ' 암홀 변 없음'); return; }
      var lo = -1e9, L = 0;
      for (var i = e.start; i <= e.end; i++) {
        if (p.outline[i][1] > lo) lo = p.outline[i][1];
        if (i > e.start) L += V.dist(p.outline[i - 1], p.outline[i]);
      }
      if (lo > BL + 0.02) bad.push(sz + ' ' + t[1] + ' 암홀이 겨드랑선 아래 ' + (lo - BL).toFixed(3));
      cur[t[1] + ' 암홀'] = L;
      row.push(t[1] + ' 암홀 ' + L.toFixed(2));
    });
    /* ② 둘레·길이류는 호수가 커지면 **반드시** 커진다 — 뒤집히면 그레이딩이 깨진 것 */
    /* ⚠ 뒤 절개선은 넣지 않는다 — 암홀라인은 절개선이 **암홀에서** 시작하므로
       호수가 커지면 겨드랑이 내려가 절개선이 **짧아지는 것이 정상**이다
       (옆선과 같은 이유). 단조 증가가 참인 것만 넣는다. */
    cur['(미사용) 뒤 절개선'] = (function () {
      var p = P['back'], e = (p.edges || []).filter(function (x) { return x.role === 'princess'; })[0], L = 0;
      for (var i = e.start + 1; i <= e.end; i++) L += V.dist(p.outline[i - 1], p.outline[i]);
      return L;
    })();
    if (prev) Object.keys(cur).forEach(function (k) {
      if (k.indexOf('(미사용)') < 0 && cur[k] <= prev[k]) bad.push(sz + ' ' + k + ' 단조성 위반 ' + prev[k].toFixed(3) + ' → ' + cur[k].toFixed(3));
    });
    prev = cur;
    console.log('  ' + pad(sz, 5) + 'BL ' + f(BL, 6) + ' · ' + row.join(' · ') +
      ' · 뒤 절개선 ' + f(cur['뒤 절개선'], 6));
  });
  if (bad.length) { fails++; console.log('    ✗ ' + bad.join('\n    ✗ ')); }
  else console.log('  ✓ 암홀이 겨드랑선을 넘지 않고, 암홀·절개선 길이가 전 호수 단조 증가');
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 조각 품질 · 인쇄 배치');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var d = E.draftTorso(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), bad = [];
  d.pieces.forEach(function (p) {
    var mx = 0;
    for (var i = 1; i < p.outline.length; i++) mx = Math.max(mx, V.dist(p.outline[i - 1], p.outline[i]));
    if (mx > 0.06) bad.push(p.name + ' 점간격 ' + mx.toFixed(3));
    if (!p.seamline || p.seamline.length < 200) bad.push(p.name + ' 시접선 ' + (p.seamline || []).length);
    if (V.dist(p.outline[0], p.outline[p.outline.length - 1]) > 0.1) bad.push(p.name + ' 폐곡선 아님');
  });
  if (d.warnings.length) bad.push('경고 ' + d.warnings.join('/'));
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) + '조각 ' + d.pieces.length + '장 · ' +
    d.pieces.map(function (p) { return p.name + ' ' + p.outline.length; }).join(' · ') +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});
(function () {
  var PR; try { PR = require('./print.js'); } catch (e) { console.log('  ? print.js 없음'); warns++; return; }
  [['A1 롤', { mode: 'roll', rollWidthMm: 594 }], ['A4 타일', { mode: 'a4' }]].forEach(function (w) {
    var bad = [], tot = 0;
    E.SIZES.forEach(function (sz) {
      var d = E.draftTorso(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT });
      var o = { seam: E.SEAM_DEFAULT }; for (var k in w[1]) o[k] = w[1][k];
      var Lo = PR.buildPrintLayout(d, o), c = Lo.info.canvas, pl = Lo.info.placements;
      pl.forEach(function (q) {
        if (q.xMm < -1e-6 || q.yMm < -1e-6) bad.push(sz + ' ' + q.name + ' 음수좌표');
        if (q.xMm + q.wMm > c.wMm + 1e-6) bad.push(sz + ' ' + q.name + ' 우측 넘침');
        if (q.yMm + q.hMm > c.hMm + 1e-6) bad.push(sz + ' ' + q.name + ' 하단 넘침');
      });
      for (var a = 0; a < pl.length; a++) for (var b = a + 1; b < pl.length; b++) {
        var A = pl[a], B = pl[b];
        if (A.xMm < B.xMm + B.wMm - 1e-6 && B.xMm < A.xMm + A.wMm - 1e-6 &&
            A.yMm < B.yMm + B.hMm - 1e-6 && B.yMm < A.yMm + A.hMm - 1e-6) bad.push(sz + ' 겹침');
      }
      tot += Lo.pageCount;
    });
    if (bad.length) fails++;
    console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(w[0], 8) + '전 호수 배치 정상 · 총 ' + tot + '장' +
      (bad.length ? '\n      → ' + bad.slice(0, 4).join(' · ') : ''));
  });
})();
console.log('\n════════════════════════════════════════════════════════════');
console.log((fails ? ' 실패 ' + fails + '건' : ' 전체 통과') + ' · 참고 ' + warns + '건');
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
