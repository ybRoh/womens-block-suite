/* ============================================================================
 * engine-verify.js — 바 재킷(더블) 검산
 *
 *   ⚠ 다른 모듈과 달리 **DXF 정답지가 없다.** 원본은 sisterMAG 56 의 PDF 이고
 *   **Größe 36 한 호수뿐**이라, 좌표를 그대로 대조하면 그 호수만 맞는 엔진이 된다.
 *   그래서 여기서는 두 가지만 본다:
 *     ① 봉제로 성립하는가 — 맞물리는 변 짝 · 조각 구성 (전 호수)
 *     ② 36호 **주요 치수**가 도면과 맞는가 (좌표가 아니라 치수)
 *   조각 품질(폐곡선·너치·시접·제도선)은 루트의 `suite-verify.js` 가 전 모듈에 건다.
 *
 *   실행: node engine-verify.js     (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'barjacke-36-groundtruth.json'), 'utf8'));

var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 2 : d); while (s.length < w) s = ' ' + s; return s; }
function ok(name, pass, detail, soft) {
  if (!pass) { if (soft) warns++; else fails++; }
  console.log('  ' + (pass ? '✓ ' : soft ? '⚠ ' : '✗ ') + pad(name, 26) + detail);
}
/** 조각의 변 하나를 outline 에서 **실측**한다 (제도식 값을 믿지 않는다) */
function edgeLen(d, id, name) {
  var p = d.pieces.filter(function (x) { return x.id === id; })[0];
  if (!p) return null;
  var e = (p.edges || []).filter(function (x) { return x.name === name; })[0];
  if (!e) return null;
  var t = 0;
  for (var i = e.start + 1; i <= e.end; i++) t += V.dist(p.outline[i - 1], p.outline[i]);
  return t;
}

/* ══ 1. 봉제 짝 — 전 호수 ═════════════════════════════════════════════ */
console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 봉제 짝 — 맞물리는 변이 같은 길이인가 (전 호수)');
console.log('════════════════════════════════════════════════════════════');
console.log('   짝이 안 맞으면 옷이 안 된다. 정답지가 없어도 이건 검사할 수 있다.');
var PAIRS = [
  ['앞 절개선', 'front', '절개선', 'frontSide', '절개선'],
  ['옆 앞선',  'frontSide', '옆 앞선', 'side', '옆 앞선'],
  ['뒤 절개선', 'back', '절개선', 'side', '절개선']
];
E.SIZES.forEach(function (sz) {
  var d = E.draftJacket(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), bad = [], row = [];
  PAIRS.forEach(function (w) {
    var a = edgeLen(d, w[1], w[2]), b = edgeLen(d, w[3], w[4]);
    if (a === null || b === null) { bad.push(w[0] + ' 변 없음'); return; }
    row.push(w[0] + ' ' + f(a, 6) + '/' + f(b, 6));
    if (Math.abs(a - b) > 0.30) bad.push(w[0] + ' 차 ' + (a - b).toFixed(3));
  });
  if (d.pieces.length !== 7) bad.push('조각 ' + d.pieces.length + '장 (7 이라야 한다)');
  if (d.warnings.length) bad.push('엔진 경고 ' + d.warnings.join(' · '));
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) + row.join(' · ') +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* ══ 2. 36호 주요 치수 — 도면 대조 ════════════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 36호 주요 치수 — 원본 도면(sisterMAG 56) 대조');
console.log('════════════════════════════════════════════════════════════');
console.log('   ⚠ **좌표가 아니라 치수**를 본다. 한 호수뿐인 정답지에 좌표를 맞추면');
console.log('     그 호수만 맞는 엔진이 된다 (다른 모듈에서 여러 번 겪었다).');
(function () {
  var m = E.measuresForSize('55호');           // DE 36 ≈ 한국 55호
  var g = E.geom(m), d = E.draftJacket(m, { seam: E.SEAM_DEFAULT });
  var P = {}; d.pieces.forEach(function (p) { P[p.id] = p; });
  var G = GT.pieces;
  /* 옷길이 — 도면 뒤판 높이 */
  ok('옷길이(뒤)', Math.abs(g.hemY - G.back.h) <= 1.5,
     f(g.hemY, 6) + '  도면 ' + f(G.back.h, 6) + ' · 차 ' + f(g.hemY - G.back.h, 6));
  /* 앞판 높이 — 라펠 끝까지 */
  ok('앞판 높이', Math.abs(P.front.bbox.h - G.front.h) <= 2.0,
     f(P.front.bbox.h, 6) + '  도면 ' + f(G.front.h, 6) + ' · 차 ' + f(P.front.bbox.h - G.front.h, 6));
  /* 완성 가슴둘레 — 재킷은 B + 10~14 가 정상 */
  var chest = 2 * (g.Uf[0] + g.Ub[0]), ease = chest - m.B;
  ok('완성 가슴 여유', ease >= 10 && ease <= 14,
     f(chest, 6) + ' (B ' + f(m.B, 5) + ' + ' + f(ease, 5) + ')');
  /* 여밈 겹침 · 단추 */
  ok('여밈 겹침', Math.abs(E.K.overlap - 7.89) <= 0.2,
     f(E.K.overlap, 6) + '  도면 7.89');
  ok('단추 세로 간격', Math.abs(E.K.btnGapY - 9.80) <= 0.2,
     f(E.K.btnGapY, 6) + '  도면 9.80');
  /* 앞 절개선 짝 — 도면 앞판 ≈65.0 ↔ 앞옆판 64.97 */
  var pr = edgeLen(d, 'front', '절개선');
  ok('앞 절개선 길이', Math.abs(pr - 65.0) <= 6.0,
     f(pr, 6) + '  도면 ≈65.0 (호수·여유가 다르면 벌어진다)', true);
  /* 조각 구성 */
  var names = d.pieces.map(function (p) { return p.name; }).join(' · ');
  ok('조각 구성', d.pieces.length === 7, '7장 — ' + names);
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(fails ? ' 실패 ' + fails + '건' + (warns ? ' · 참고 ' + warns + '건' : '')
                  : ' 전체 통과' + (warns ? ' · 참고 ' + warns + '건' : ''));
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
