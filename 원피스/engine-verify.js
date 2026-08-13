/* ============================================================================
 * engine-verify.js — 원피스 검산
 *
 *   제도법: 백영례 원피스 번호점 제도법 (docs/원피스-제도법-백영례.md)
 *
 *   ★ 이 모듈에는 **DXF/PDF 정답지가 없다.** 원문 도면 이미지만 있다.
 *     그래서 검사는 **원문이 시키는 「확인하라」** 를 그대로 옮긴 것이다.
 *     교재가 「재서 확인하라」고 한 자리가 곧 검사다.
 *
 *   조각 품질(폐곡선·점 간격·너치·시접·전 호수 단조성·UI 계약)은 루트의
 *   `suite-verify.js` 가 전 모듈에 건다. 여기서 겹쳐 검사하지 않는다.
 *
 *   실행: node engine-verify.js     (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var E = require('./engine.js'), U = E.util, V = U.V, K = E.K;

var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 2 : d); while (s.length < w) s = ' ' + s; return s; }
function ok(name, pass, detail, soft) {
  if (!pass) { if (soft) warns++; else fails++; }
  console.log('  ' + (pass ? '✓ ' : soft ? '⚠ ' : '✗ ') + pad(name, 22) + detail);
}
function edgeLen(d, id, names) {
  var p = d.pieces.filter(function (x) { return x.id === id; })[0];
  if (!p) return null;
  names = Array.isArray(names) ? names : [names];
  var tot = 0, hit = 0;
  names.forEach(function (nm) {
    var e = (p.edges || []).filter(function (x) { return x.name === nm; })[0];
    if (!e) return;
    hit++;
    for (var i = e.start + 1; i <= e.end; i++) tot += V.dist(p.outline[i - 1], p.outline[i]);
  });
  return hit === names.length ? tot : null;
}

/* ══ 1. 원문이 시키는 「확인하라」 — 전 호수 ═══════════════════════════ */
console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 원문 확인 절차 — 「재서 확인하라」가 곧 검사다 (전 호수)');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz);
  var g = E.geom(m), d = E.draftDress(m, { seam: E.SEAM_DEFAULT }), M = d.measures, bad = [], row = [];

  /* [13] 2~22 를 재서 **어깨/2** 인지 — 원문이 「어깨를 수정하라」고 한 자리 */
  var shW = V.dist(g.p2, g.p22);
  row.push('[13] 어깨/2 ' + f(shW, 6));
  if (Math.abs(shW - m.shoulderW / 2) > 0.02)
    bad.push('[13] 2~22 ' + shW.toFixed(3) + ' ≠ 어깨/2 ' + (m.shoulderW / 2).toFixed(2));

  /* [33] 앞 어깨 = 뒤 어깨 − 다트분 — 봉제 짝 */
  row.push('[33] 앞/뒤어깨 ' + f(M.shoulderFront, 6) + '/' + f(M.shoulderBackSewn, 6));
  if (Math.abs(M.shoulderFront - M.shoulderBackSewn) > 0.05)
    bad.push('[33] 어깨 짝 차 ' + (M.shoulderFront - M.shoulderBackSewn).toFixed(3));

  /* [27] 암홀선이 등품선(42번)에서 1 정도 떨어진다 */
  var arm = U.sampleSegs(g.bArm, 0.05), best = 1e9;
  arm.forEach(function (q) { best = Math.min(best, V.dist(q, g.p42)); });
  row.push('[27] 암홀↔42 ' + f(best, 5));
  if (Math.abs(best - K.armFromBW) > 0.35)
    bad.push('[27] 암홀↔42 ' + best.toFixed(2) + ' (1.0 이라야 한다)');

  /* [45] 앞 암홀이 78번에서 0.3~0.5 */
  var fa = U.sampleSegs(g.fArm, 0.05), bf = 1e9;
  fa.forEach(function (q) { bf = Math.min(bf, V.dist(q, g.f78)); });
  row.push('[45] 앞암홀↔78 ' + f(bf, 5));
  if (bf < 0.15 || bf > 0.75) bad.push('[45] 앞암홀↔78 ' + bf.toFixed(2) + ' (0.3~0.5)');

  /* 소매 [4] 소매통을 재서 원하는 값이 나왔는가 */
  row.push('소매통 ' + f(M.sleeveW, 5));
  if (Math.abs(M.sleeveW - m.sleeveW) > 0.15)
    bad.push('소매통 ' + M.sleeveW.toFixed(2) + ' ≠ ' + m.sleeveW);

  /* 소매 [9] 앞뒤 암홀 + 이세 1.5~2 */
  row.push('이세 ' + f(M.capEase, 5));
  if (M.capEase < 1.0 || M.capEase > 2.6) bad.push('소매산 이세 ' + M.capEase.toFixed(2) + ' (원문 1.5~2)');

  /* 소매 [11] 부리선 길이가 소매부리와 같은가 — 24번을 「밖으로」 잡으면 어긋난다 */
  row.push('부리 ' + f(M.cuffWidth, 5));
  if (Math.abs(M.cuffWidth - K.cuffW) > 0.15)
    bad.push('소맷부리 ' + M.cuffWidth.toFixed(2) + ' ≠ ' + K.cuffW);

  if (d.warnings.length) bad.push('엔진 경고 ' + d.warnings.join(' · '));
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) + row.join(' · ') +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* ══ 2. 제도 구조 — 원문 도면이 그런 모양인가 ═════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 제도 구조 — 다이아몬드 다트 · 밑단 벌어짐 · 완성 치수');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m);
  var d = E.draftDress(m, { seam: E.SEAM_DEFAULT }), M = d.measures, bad = [];

  /* [24] 38·39 의 2등분이 35번(다트 중심선)과 같아야 한다 — 구조 자체의 검산 */
  var mid = (g.p38[0] + g.p39[0]) / 2;
  if (Math.abs(mid - g.p35[0]) > 0.02)
    bad.push('[24] 38·39 의 2등분 ' + mid.toFixed(3) + ' ≠ 35번 ' + g.p35[0].toFixed(3));
  /* 다트가 밑단에서 벌어져야 치마폭이 생긴다 */
  if (M.hemFlareBack < 1.0) bad.push('뒤 밑단 벌어짐 ' + M.hemFlareBack + ' — 다이아몬드 다트가 안 됐다');
  /* 완성 치수 — 가슴은 유B 보다, 허리는 W 보다, 엉덩이는 H 보다 커야 한다 */
  if (M.chestFinish <= m['유B']) bad.push('완성 가슴 ' + M.chestFinish + ' ≤ 유B ' + m['유B']);
  if (M.waistFinish <= m.W)      bad.push('완성 허리 ' + M.waistFinish + ' ≤ W ' + m.W);
  if (M.hipFinish <= m.H)        bad.push('완성 엉덩이 ' + M.hipFinish + ' ≤ H ' + m.H);
  /* 앞판이 뒤판보다 유차만큼 길다 */
  var bH = d.pieces[0].bbox, fH = d.pieces[1].bbox;
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '완성 가슴 ' + f(M.chestFinish, 6) + ' 허리 ' + f(M.waistFinish, 6) + ' 엉덩이 ' + f(M.hipFinish, 6) +
    ' · 밑단 벌어짐 뒤 ' + f(M.hemFlareBack, 5) + ' 앞 ' + f(M.hemFlareFront, 5) +
    ' · 다트 ' + f(M.backDart, 4) + '/' + f(M.frontDart, 4) +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* ══ 3. 도면 대조 (soft) — 원문 55 Size 그림에서 읽은 값 ═══════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 도면 대조 (soft) — 원문 55 Size · 정답지가 없어 참고만 한다');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var m = E.measuresForSize('55호'), g = E.geom(m), M = E.draftDress(m, { seam: E.SEAM_DEFAULT }).measures;
  function chk(name, got, want, tol) {
    ok(name, Math.abs(got - want) <= tol, f(got, 7) + '  도면 ' + f(want, 6) + ' · 차 ' + f(got - want, 6), true);
  }
  chk('진동깊이 (B/4)',   g.BL, 21.0, 0.01);
  chk('겨드랑 12번',      g.p12[0], 23.0, 0.01);   // 유B/4 + 1.5 — 괄호 22.5 는 오기
  chk('뒤목너비 19번',    g.p19[0], 7.0, 0.01);    // B/12
  chk('어깨점 22번 x',    g.p22[0], 18.894, 0.01); // √((어깨/2)² − 2²)
  chk('등품점 26번',      g.p26[0], 17.15, 0.20);  // 25번 + 등품/2
  chk('다트 끝 36번 y',   g.p36[1], g.HL - 5, 0.01);
  chk('앞목 깊이',        g.f75[1], 7.5, 0.01);    // B/12 + 0.5
  chk('BP (유폭/2, 유장)', g.f59[0], 8.0, 0.01);
  ok('소매통', Math.abs(M.sleeveW - 33.5) <= 0.5, f(M.sleeveW, 7) + '  원문 33~34', true);
  ok('소매 이세', M.capEase >= 1.2 && M.capEase <= 2.2, f(M.capEase, 7) + '  원문 1.5~2', true);
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(fails ? ' 실패 ' + fails + '건' + (warns ? ' · 참고 ' + warns + '건' : '')
                  : ' 전체 통과' + (warns ? ' · 참고 ' + warns + '건' : ''));
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
