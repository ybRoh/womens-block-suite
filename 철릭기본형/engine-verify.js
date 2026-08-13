/* ============================================================================
 * engine-verify.js — 철릭 기본형 검산
 *
 *   이 모듈은 **DXF 도면(`철릭기본형.dxf` · 66호반 한 벌)을 읽어 공식화한 엔진**이다.
 *   그래서 검산은 두 가지를 본다:
 *     ① 66호반에서 **도면과 같은가** (조각 크기 · 허리폭 · 주름 개수 · 랜드마크)
 *     ② 전 호수에서 **옷으로 성립하는가** (어깨 짝 · 주름 접은 뒤 허리 · 단조성)
 *
 *   ⚠ 도면이 한 호수뿐이므로 **좌표를 맞추는 것이 목적이 아니다.**
 *     엔진은 `B/4 + 상수` · `어깨너비/2` · `B/12` 같은 식으로 세워져 있고,
 *     여기서는 그 식이 66호반에서 도면을 재현하는지만 확인한다.
 *
 *   조각 품질(폐곡선·점 간격·너치·시접·제도선)은 루트의 `suite-verify.js` 가 건다.
 *
 *   실행: node engine-verify.js     (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V, K = E.K;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'cheollik-665-groundtruth.json'), 'utf8'));

var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 2 : d); while (s.length < w) s = ' ' + s; return s; }
function ok(name, pass, detail, soft) {
  if (!pass) { if (soft) warns++; else fails++; }
  console.log('  ' + (pass ? '✓ ' : soft ? '⚠ ' : '✗ ') + pad(name, 22) + detail);
}

/* ══ 1. 66호반 도면 대조 ═══════════════════════════════════════════════ */
console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 66호반 도면 대조 — 식이 도면을 재현하는가');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var m = E.measuresForSize('66호반');
  var g = E.geom(m), d = E.draftCheollik(m, { seam: E.SEAM_DEFAULT }), M = d.measures;
  var P = {}; d.pieces.forEach(function (p) { P[p.name] = p; });
  ['뒷판', '앞판', '긴소매', '깃', '앞치마판', '뒷치마판'].forEach(function (k) {
    var p = P[k], t = GT.pieces[k];
    var dw = p.bbox.w - t.w, dh = p.bbox.h - t.h;
    ok('크기 ' + k, Math.abs(dw) <= 1.2 && Math.abs(dh) <= 1.2,
       f(p.bbox.w, 6) + '×' + f(p.bbox.h, 6) + '  도면 ' + f(t.w, 6) + '×' + f(t.h, 6) +
       ' · 차 ' + f(dw, 5) + ' / ' + f(dh, 5));
  });
  var LM = GT.landmark;
  ok('뒤 허리폭', Math.abs(M.backWaistW - LM['뒷판']['허리폭']) <= 0.05,
     f(M.backWaistW, 6) + '  도면 ' + f(LM['뒷판']['허리폭'], 6));
  ok('앞 허리폭', Math.abs(M.frontWaistW - LM['앞판']['허리폭']) <= 0.05,
     f(M.frontWaistW, 6) + '  도면 ' + f(LM['앞판']['허리폭'], 6));
  ok('뒷목너비', Math.abs(g.bNeckW - LM['뒷판']['뒷목너비']) <= 0.05,
     f(g.bNeckW, 6) + '  도면 ' + f(LM['뒷판']['뒷목너비'], 6));
  ok('어깨점 x', Math.abs(g.bSP[0] - LM['뒷판']['어깨점'][0]) <= 0.05,
     f(g.bSP[0], 6) + '  도면 ' + f(LM['뒷판']['어깨점'][0], 6) + ' (= 어깨너비/2)');
  ok('겨드랑 높이', Math.abs((g.bTotal - g.bU[1]) - (LM['뒷판']['겨드랑'][1])) <= 0.15,
     f(g.bTotal - g.bU[1], 6) + '  도면 ' + f(LM['뒷판']['겨드랑'][1], 6) + ' (허리에서)');
  /* ★ 주름 — 이 옷의 핵심. 개수가 도면과 같아야 한다 */
  ok('뒷치마 주름 개수', M.backPleats === GT.pleat.back.n,
     M.backPleats + '개 · 폭 ' + f(M.backSkirtW, 6) + '  도면 ' + GT.pleat.back.n + '개 · ' + f(GT.pleat.back.skirtW, 6));
  ok('앞치마 주름 개수', M.frontPleats === GT.pleat.front.n,
     M.frontPleats + '개 · 폭 ' + f(M.frontSkirtW, 6) + '  도면 ' + GT.pleat.front.n + '개 · ' + f(GT.pleat.front.skirtW, 6));
  ok('주름분 · 간격', Math.abs(K.pleatDepth - GT.pleat.depth) < 1e-9 &&
     Math.abs(K.pleatStep - GT.pleat.step) < 1e-9,
     f(K.pleatDepth, 5) + ' / ' + f(K.pleatStep, 5) + '  도면 ' + GT.pleat.depth + ' / ' + GT.pleat.step);
  ok('소매 진동 · 수구', Math.abs(g.sleeveAH - GT.landmark['긴소매']['진동']) <= 0.05 &&
     Math.abs(g.cuffW - GT.landmark['긴소매']['수구']) <= 0.05,
     f(g.sleeveAH, 6) + ' / ' + f(g.cuffW, 5) + '  도면 ' + GT.landmark['긴소매']['진동'] + ' / ' + GT.landmark['긴소매']['수구']);
  ok('조각 구성', d.pieces.length === 6,
     '6장 — ' + d.pieces.map(function (p) { return p.name; }).join(' · '));
})();

/* ══ 2. 전 호수 — 옷으로 성립하는가 ════════════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 전 호수 — 옷으로 성립하는가');
console.log('════════════════════════════════════════════════════════════');
console.log('   ★ 철릭의 핵심 제약: **주름을 접으면 치마 허리 = 몸판 허리**');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz);
  var g = E.geom(m), d = E.draftCheollik(m, { seam: E.SEAM_DEFAULT }), M = d.measures, bad = [];
  function chk(c, msg) { if (!c) bad.push(msg); }
  /* 주름을 접은 뒤 치마 허리폭 = 몸판 허리폭 */
  var bFold = M.backSkirtW - M.backPleats * M.pleatDepth;
  var fFold = M.frontSkirtW - M.frontPleats * M.pleatDepth;
  chk(Math.abs(bFold - M.backWaistW) < 0.05, '뒷치마 접은 뒤 ' + bFold.toFixed(2) + ' ≠ 허리 ' + M.backWaistW);
  chk(Math.abs(fFold - M.frontWaistW) < 0.05, '앞치마 접은 뒤 ' + fFold.toFixed(2) + ' ≠ 허리 ' + M.frontWaistW);
  /* 어깨는 앞뒤가 같아야 꿰맨다 */
  chk(Math.abs(M.shoulderBack - M.shoulderFront) < 0.15,
      '어깨 짝 ' + M.shoulderBack + ' ↔ ' + M.shoulderFront);
  /* 식이 지켜지는가 — 좌표가 아니라 식을 검사한다 */
  chk(Math.abs(g.bWaist[0] - (m.B / 4 + K.bWaistAdd)) < 1e-6, '뒤 허리폭 식이 안 맞는다');
  chk(Math.abs(g.fWaist[0] - (m.B / 4 + K.frontWrap)) < 1e-6, '앞 허리폭 식이 안 맞는다');
  chk(Math.abs(g.bNeckW - (m.B / 12 + K.backNeckAdd)) < 1e-6, '뒷목너비 식이 안 맞는다');
  chk(Math.abs(g.bSP[0] - (m.shoulderW / 2 - K.shoulderSub)) < 1e-6, '어깨점 식이 안 맞는다');
  /* 소매가 진동에 붙을 수 있는가 (한복은 아래를 겨드랑으로 처리하므로 0.55~1.05) */
  var rat = g.sleeveAH / Math.max(M.armholeTotal, 0.1);
  chk(rat > 0.55 && rat < 1.05, '소매 진동/몸판 진동 ' + rat.toFixed(2));
  /* V 네크라인이 어깨선 위로 올라가면 안 된다 */
  chk(g.vBot[1] > g.fSNP[1] + 2.0, 'V 바닥이 목옆점에 너무 가깝다');
  if (d.warnings.length) bad.push('엔진 경고 ' + d.warnings.join(' · '));
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 6) +
    '허리 뒤/앞 ' + f(M.backWaistW, 6) + '/' + f(M.frontWaistW, 6) +
    ' · 치마 ' + f(M.backSkirtW, 6) + '(' + M.backPleats + ')/' + f(M.frontSkirtW, 6) + '(' + M.frontPleats + ')' +
    ' · 총장 ' + f(M.coatLen, 6) +
    (bad.length ? '\n      → ' + bad.join('\n      → ') : ''));
});

/* ══ 3. 조각 형태 — 자기교차 · 곡선 늘어짐 ═══════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 조각 형태 — 자기교차 · 곡선 늘어짐');
console.log('════════════════════════════════════════════════════════════');
var RATIO = {};
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz);
  var g = E.geom(m), d = E.draftCheollik(m, { seam: E.SEAM_DEFAULT }), bad = [];
  /* 진동은 한 방향으로만 휜다. **한복 진동은 깊게 판다** — 도면 자체가 호/현 1.14 다.
     1.30 을 넘으면 곡선이 늘어진 것이고, 호수마다 값이 달라져도(비율이 아니라
     절대값을 박으면 그렇게 된다) 잘못이다 — 아래 전 호수 편차로 함께 본다. */
  [['뒤 진동', g.bArm], ['앞 진동', g.fArm]].forEach(function (w) {
    var p = U.sampleSegs(w[1], 0.05), arc = U.polyLen(p), ch = V.dist(p[0], p[p.length - 1]);
    if (ch > 1 && arc / ch > 1.30) bad.push(w[0] + ' 호/현 ' + (arc / ch).toFixed(3));
    RATIO[w[0]] = (RATIO[w[0]] || []).concat([arc / ch]);
  });
  d.pieces.forEach(function (pc) {
    var o = pc.outline;
    for (var i = 0; i < o.length - 3; i += 3)
      for (var j = i + 6; j < o.length - 1; j += 3) {
        var a = o[i], b = o[i + 1], c = o[j], e = o[j + 1];
        var dn = (b[0] - a[0]) * (e[1] - c[1]) - (b[1] - a[1]) * (e[0] - c[0]);
        if (Math.abs(dn) < 1e-9) continue;
        var t2 = ((c[0] - a[0]) * (e[1] - c[1]) - (c[1] - a[1]) * (e[0] - c[0])) / dn;
        var u2 = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / dn;
        if (t2 > 0.001 && t2 < 0.999 && u2 > 0.001 && u2 < 0.999) { bad.push(pc.name + ' 자기교차'); return; }
      }
  });
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 6) + '자기교차 없음 · 진동 곡선 정상' +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* 진동 곡률이 **호수마다 같은가** — 절대값을 박으면 작은 호수가 더 깊어진다 */
Object.keys(RATIO).forEach(function (k) {
  var a = RATIO[k], mn = Math.min.apply(null, a), mx = Math.max.apply(null, a);
  ok(k + ' 곡률 일정', mx - mn <= 0.02,
     '호/현 ' + f(mn, 5, 3) + ' ~ ' + f(mx, 5, 3) + ' (전 호수 편차 ' + f(mx - mn, 5, 3) + ')');
});

console.log('\n════════════════════════════════════════════════════════════');
console.log(fails ? ' 실패 ' + fails + '건' + (warns ? ' · 참고 ' + warns + '건' : '')
                  : ' 전체 통과' + (warns ? ' · 참고 ' + warns + '건' : ''));
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
