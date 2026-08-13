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
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '완성 가슴 ' + f(M.chestFinish, 6) + ' 허리 ' + f(M.waistFinish, 6) + ' 엉덩이 ' + f(M.hipFinish, 6) +
    ' · 밑단 벌어짐 뒤 ' + f(M.hemFlareBack, 5) + ' 앞 ' + f(M.hemFlareFront, 5) +
    ' · 다트 ' + f(M.backDart, 4) + '/' + f(M.frontDart, 4) +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* ══ 3. 프린세스 절개 4조각 ══════════════════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 프린세스 절개 4조각 — 절개선 두 변이 꿰매지는가');
console.log('════════════════════════════════════════════════════════════');
console.log('   ※ 안쪽 변이 조금 긴 것은 오차가 아니라 **이세**다. 뒤는 견갑골,');
console.log('     앞은 가슴 곡선에서 생기고, 29·70번 위쪽 구간에만 몰려 있다.');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), bad = [];
  var d4 = E.draftDress(m, { seam: E.SEAM_DEFAULT, splitPanels: 1 });
  var d2 = E.draftDress(m, { seam: E.SEAM_DEFAULT, splitPanels: 0 });

  /* 조각이 실제로 갈라졌는가 — 옵션이 아무것도 안 하면 그건 거짓말이다 */
  if (d4.pieces.length !== d2.pieces.length + 2) bad.push('4조각인데 조각 수 ' + d4.pieces.length);
  if (d4.warnings.length) bad.push('경고 ' + d4.warnings.join(' · '));

  /* 절개선 두 변 — 총 차이는 이세 허용치 안, 그리고 그 차이가 **위 구간에서만** 나야 한다 */
  var dB = g.prinLenB[0] - g.prinLenB[1], dF = g.prinLenF[0] - g.prinLenF[1];
  if (Math.abs(dB) > 0.6) bad.push('뒤 절개선 차 ' + dB.toFixed(3) + ' — 이세로 보기엔 크다');
  if (Math.abs(dF) > 0.6) bad.push('앞 절개선 차 ' + dF.toFixed(3) + ' — 이세로 보기엔 크다');
  /* 허리 아래(다트 다리)는 35번 대칭이라 저절로 같아야 한다 */
  var lowB = Math.abs(V.dist(g.p36, g.p38) - V.dist(g.p36, g.p39));
  if (lowB > 0.02) bad.push('허리 아래 다트 다리 차 ' + lowB.toFixed(3) + ' — 대칭이 깨졌다');

  /* ★ 가장 센 검사 — **절개해도 옷이 달라지면 안 된다.**
     통짜 밑단에서 다트로 접히는 만큼(38h~39h · 73h~74h)을 뺀 값이
     4조각 밑단의 합과 같아야 한다. 여기가 어긋나면 절개가 치수를 먹은 것이다.
     (0.05 는 다트 자리를 현(弦)으로 재는 데서 오는 차이다 — 밑단은 곡선이다) */
  [['뒤', 'back', ['backCtr', 'backSide'], V.dist(g.p38h, g.p39h)],
   ['앞', 'front', ['frontCtr', 'frontSide'], V.dist(g.f73h, g.f74h)]].forEach(function (r) {
    var whole = edgeLen(d2, r[1], '밑단');
    var split = r[2].reduce(function (a, id) { return a + edgeLen(d4, id, '밑단'); }, 0);
    if (Math.abs(whole - r[3] - split) > 0.05)
      bad.push(r[0] + ' 밑단 ' + whole.toFixed(2) + ' − 다트 ' + r[3].toFixed(2) +
               ' ≠ 4조각 합 ' + split.toFixed(2) + ' (차 ' + (whole - r[3] - split).toFixed(3) + ')');
  });

  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '뒤 절개선 ' + f(g.prinLenB[0], 7) + '/' + f(g.prinLenB[1], 7) + ' 이세 ' + f(dB, 6, 3) +
    ' · 앞 ' + f(g.prinLenF[0], 7) + '/' + f(g.prinLenF[1], 7) + ' 이세 ' + f(dF, 6, 3) +
    ' · 조각 ' + d4.pieces.length +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* ══ 4. 도면 대조 (soft) — 원문 55 Size 그림에서 읽은 값 ═══════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 도면 대조 (soft) — 원문 55 Size · 정답지가 없어 참고만 한다');
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
