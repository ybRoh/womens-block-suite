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
var AC = require('../tools/answer-check.js');

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
  /* ★ 앞 소매산이 앞 암홀을 덮는가 — 짧으면 소매를 못 단다 (사용자 지적 2026-08-14)
     「5,18,17,9 로 이어지는 곡선이 많이 휘는 것이 암홀 길이를 맞추는 이유 아닐까」
     장력을 눈대중으로 두었을 때 44~66호에서 앞 곡선이 앞AH 보다 **짧았다**(−0.17~−0.04). */
  var sl = d.sleeve, capFLen = U.polyLen(U.sampleSegs(sl.capF, 0.02));
  row.push('앞소매산−앞AH ' + f(capFLen - g.ahFront, 5));
  if (capFLen < g.ahFront + 0.05)
    bad.push('앞 소매산 ' + capFLen.toFixed(2) + ' < 앞AH ' + g.ahFront.toFixed(2) +
             ' — 곡선이 덜 휘어 앞이 모자란다 (소매를 못 단다)');
  /* 이세가 2.0 을 넘는 것은 **AH 가 3.5 작은 것의 증상** — 정점이 9번이라
     9→7 직선이 이미 뒤AH 보다 길어 뒤 이세가 1.5 이상 깔린다. 위 1.0~2.6 검사로 남긴다. */

  /* 소매 [11] 부리선 길이가 소매부리와 같은가 — 24번을 「밖으로」 잡으면 어긋난다 */
  row.push('부리 ' + f(M.cuffWidth, 5));
  /* 원문은 55 Size 값 24 만 준다 — 호수는 0.5 씩 등급한다.
     55호에서 정확히 24 인지, 그리고 호수 따라 커지는지를 본다. */
  var wantCuff = K.cuffW + K.cuffGrade * ((m.B - 84) / 4);
  if (Math.abs(M.cuffWidth - wantCuff) > 0.15)
    bad.push('소맷부리 ' + M.cuffWidth.toFixed(2) + ' ≠ ' + wantCuff.toFixed(2));

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

/* ══ 3-B. 원문 준수 — 「어느 점을 지나라」를 곡선에서 실제로 잰다 ═════════
 *
 *  ★ 사용자 지적 (2026-08-14): 「이미지로 준 제도법을 준수했나? QA팀은 이 제도법대로
 *    그렸는지 검증했나?」 — **안 했다.** §1 은 원문에서 **숫자 8개**만 봤다.
 *    「16번에 곡자를 대고 15번과 연결」, 「41번이 맞닿을 정도로」, 「29번을 향하여」처럼
 *    **곡선이 어느 점을 지나는가**는 하나도 재지 않았다. 여기서 전부 잰다.
 *
 *  통과 기준은 원문이 준 말 그대로다:
 *    · 「지나간다 · 연결한다」 → 0.15 이내
 *    · 「맞닿을 정도로 · 붙게」 → 0.25 이내
 *    · 수치가 붙은 것(0.3~0.5 · 1)  → 그 범위
 * ══════════════════════════════════════════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3-B. 원문 준수 — 번호점 좌표 45개 + 곡선이 지나야 할 점');
console.log('════════════════════════════════════════════════════════════');
function nearest(segs, P) {
  var q = U.sampleSegs(segs, 0.02), b = 1e9;
  q.forEach(function (x) { b = Math.min(b, V.dist(x, P)); });
  return b;
}
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m);
  var s = E.draftDress(m, { seam: E.SEAM_DEFAULT }).sleeve, bad = [], soft = [];
  /* [단계, 곡선, 지나야 할 점, 허용, 설명] */
  [['[26]', g.bNeck, g.p41, 0.25, '뒷목선이 41번에 맞닿는다'],
   ['[21]', g.bPrinIn, g.p29, 0.25, '뒤 절개선이 29번을 지난다'],
   ['[23]', g.bPrinOut, g.p29, 0.25, '30-29-33 이 29번을 지난다'],
   ['[24]', g.bPrinOut, g.p36, 0.15, '다트가 36번(다트 끝)을 지난다'],
   ['[41]', g.fPrinOut, g.f70, 0.25, '앞 절개선이 70번을 지난다'],
   /* [28] 은 43번(기준선 11~40 의 3등분점)이 **곡선 위 점인지 기준선 위 표시인지**
      도면 해상도로 확정이 안 됐다. 확실한 것만 잰다 — 밑단이 현에서 실제로 휘는가.
      아래 hemBow 검사가 그것이고, 43 통과 여부는 [미확정] 으로 남긴다. */
   ['소매[7]', s.capF, s.p18, 0.05, '앞 소매산이 18번을 지난다'],
   ['소매[7]', s.capF, s.p17, 0.05, '앞 소매산이 17번을 지난다'],
   ['소매[8]', s.capB, s.p21, 0.05, '뒤 소매산이 21번을 지난다'],
   ['소매[5]', s.capF, s.p9, 0.02, '앞 소매산이 정점 9번에서 끝난다'],
   ['소매[5]', s.capB, s.p6, 0.02, '뒤 소매산이 6번에서 시작한다']
  ].forEach(function (r) {
    var d = nearest(r[1], r[2]);
    if (d > r[3]) (r[3] >= 0.5 ? soft : bad).push(r[0] + ' ' + r[4] + ' — 실제 ' + d.toFixed(2));
  });
  /* ★ 번호점 좌표 전수 대조 (2026-08-14 · 도면 docs/img/원피스-뒤판·앞판-도면.png)
     사용자 지적 「앞판 뒷판 도면도 다시 대조해서 검증해줘」 로 한 번에 훑었다.
     뒤판 19개 · 앞판 12개 전부 식과 일치했고, 아래 두 건이 새로 잡혔다:
       · [40] 앞 절개선이 71번에서 **0.3 밖으로** 부풀어야 하는데 0.385 **안으로** 처져 있었다
       · [43] 77번(54 직각선 ∩ 앞품선)은 도면으로 위치 확정이 안 돼 [미확정] 로 둔다 */
  /* ⚠ 기대값에 K 를 쓰면 **자기만족 검사**가 된다 — K 를 고치면 기대값도 따라간다.
     실제로 K.frontPrinOut 을 0.3 → 0 으로 되돌렸는데도 45/45 가 그대로 떴다
     (2026-08-14). 원문이 **하나로 못 박은 값은 리터럴**로 쓰고, 「2~2.5」처럼 폭을
     준 것만 K 를 쓰되 그 K 가 범위 안인지 따로 본다. */
  var B = m.B, 유B = m['유B'], W = m.W, H = m.H, cb = g.cbIn, 유차 = g['유차'];
  [['waistEase', K.waistEase, 1.5, 1.5], ['hipEase', K.hipEase, 1.0, 1.0],
   ['backDart', K.backDart, 2.0, 2.5], ['princessOut', K.princessOut, 2.0, 2.5],
   ['dartFromCB', K.dartFromCB, 8.0, 9.0], ['dartTipUp', K.dartTipUp, 5.0, 5.0],
   ['bpOut', K.bpOut, 1.5, 2.0], ['neckDrop1', K.neckDrop1, 1.0, 1.0],
   ['frontShDrop', K.frontShDrop, 4.8, 4.8], ['neckDeepAdd', K.neckDeepAdd, 0.5, 0.5],
   ['frontDrop', K.frontDrop, 2.0, 2.0], ['frontPrinOut', K.frontPrinOut, 0.3, 0.3],
   ['armFromBW', K.armFromBW, 1.0, 1.0], ['frontArmGap', K.frontArmGap, 0.3, 0.5],
   ['cbIn', g.cbIn, 1.5, 1.5], ['shDrop', K.shDrop, 2.0, 2.0], ['shDart', K.shDart, 1.5, 1.5],
   ['sleeveEase', K.sleeveEase, 0.5, 0.5], ['capFrontOut', K.capFrontOut, 4.5, 4.5],
   ['capBackIn', K.capBackIn, 4.0, 4.0], ['capFrontIn', K.capFrontIn, 4.5, 5.0],
   ['capBackOut', K.capBackOut, 4.5, 5.0], ['cuffW(55호)', K.cuffW, 24, 24], ['cuffGrade', K.cuffGrade, 0.4, 0.7]
  ].forEach(function (r) {
    if (!(r[1] >= r[2] - 1e-9 && r[1] <= r[3] + 1e-9))
      bad.push('K.' + r[0] + ' = ' + r[1] + ' — 원문은 ' +
               (r[2] === r[3] ? String(r[2]) : r[2] + '~' + r[3]));
  });
  [['11', g.p11, [cb, g.LEN]], ['10', g.p10, [cb, g.HL]], ['9', g.p9, [cb, g.WL]],
   ['12', g.p12, [유B / 4 + 1.5, g.BL]], ['19', g.p19, [B / 12, 0]], ['20', g.p20, [B / 12, -유차]],
   ['21', g.p21, [m.shoulderW / 2, 0]],
   ['15', g.p15, [cb + W / 4 + 1.5 + K.backDart, g.WL]],
   ['17', g.p17, [cb + H / 4 + 1.0, g.HL]], ['18', g.p18, [cb + H / 4 + 1.0, g.LEN]],
   ['26', g.p26, [g.p25[0] + m.backW / 2, g.BL]],
   ['28', g.p28, [(g.p25[0] + g.p26[0]) / 2, g.BL]], ['29', g.p29, [g.p28[0] + K.princessOut, g.BL]],
   ['32', g.p32, [cb + K.dartFromCB, g.WL]], ['33', g.p33, [g.p32[0] + K.backDart, g.WL]],
   ['36', g.p36, [(g.p32[0] + g.p33[0]) / 2, g.HL - 5]],
   ['f12', g.f12, [유B / 4 + 1.5, g.BL]], ['f51', g.f51, [m.frontW / 2, g.BL]],
   ['f53', g.f53, [B / 12, 0]], ['f54', g.f54, [B / 12, 1.0]],
   ["f56", g.f56, [m.shoulderW / 2, 4.8]],
   ['f59(BP)', g.f59, [m.bustW / 2, m.bustLen]], ['f60', g.f60, [m.bustW / 2 + K.bpOut, m.bustLen]],
   /* [42] 앞목 깊이는 **55번에서** 재고, [31] 로 55 = (0, 54의 높이) 다 */
   ['f75', g.f75, [0, 1.0 + B / 12 + 0.5]], ['f64', g.f64, [0, g.LEN + 2.0]],
   ['f15', g.f15, [W / 4 + 1.5 + K.frontDart, g.WL]]
  ].forEach(function (r) {
    if (V.dist(r[1], r[2]) > 0.02)
      bad.push(r[0] + '번 ' + r[1].map(function (v) { return v.toFixed(2); }).join(',') +
               ' ≠ 식 ' + r[2].map(function (v) { return v.toFixed(2); }).join(','));
  });
  /* [40] 앞 절개선 — 71번에서 0.3 밖으로 (안으로 처지면 부호가 뒤집힌다) */
  (function () {
    var A = g.f58, Bp = g.f70, d = V.sub(Bp, A), L = Math.hypot(d[0], d[1]);
    var y71 = A[1] + (Bp[1] - A[1]) / 3;
    [['앞 절개선(밖)', g.fPrinOut], ['앞 절개선(안)', g.fPrinIn]].forEach(function (r) {
      var q = U.sampleSegs(r[1], 0.01), b = null;
      q.forEach(function (x) { if (!b || Math.abs(x[1] - y71) < Math.abs(b[1] - y71)) b = x; });
      var dev = ((b[0] - A[0]) * d[1] - (b[1] - A[1]) * d[0]) / L;
      if (Math.abs(dev - 0.3) > 0.06)
        bad.push('[40] ' + r[0] + ' 71번 편차 ' + dev.toFixed(3) + ' (원문 +0.3 밖으로)');
    });
  })();
  /* ★ 소매산 **편차 프로파일** — 도면에서 확실히 읽히는 것은 「부호」다.
       정점은 **9번**이다(원문 [5] 소매중심선). 6번은 소매폭을 정하는 점일 뿐이다.
       앞·뒤 모두 **진동 쪽이 오목 · 정점 쪽이 볼록**인 S 자다.
       ⚠ 부호는 앞뒤가 반대로 나온다 — 편차식의 방향벡터(A→B)가 x 방향이 서로 반대라
         같은 「오목」이 앞은 −, 뒤는 + 로 찍힌다. 부호 상수(마지막 열)가 그것이다.
     크기(최대 부풀림)는 도면 해상도로 확정이 안 된다 — 부호와 교차 위치만 잠근다. */
  [['앞 소매산', s.capF, s.p5, s.p9, s.p17, +1],
   ['뒤 소매산', s.capB, s.p7, s.p6, s.p21, -1]].forEach(function (r) {
    var A = r[2], Bp = r[3], d = V.sub(Bp, A), L = Math.hypot(d[0], d[1]);
    function devAt(t) {
      var y = A[1] + (Bp[1] - A[1]) * t, q = U.sampleSegs(r[1], 0.02), b = null;
      q.forEach(function (x) { if (!b || Math.abs(x[1] - y) < Math.abs(b[1] - y)) b = x; });
      return ((b[0] - A[0]) * d[1] - (b[1] - A[1]) * d[0]) / L;
    }
    if (devAt(0.2) * r[5] <= 0.15) bad.push(r[0] + ' 진동 쪽 부호가 다르다 (' + devAt(0.2).toFixed(2) + ')');
    if (devAt(0.8) * r[5] >= -0.15) bad.push(r[0] + ' 정점 쪽 부호가 다르다 (' + devAt(0.8).toFixed(2) + ')');
    /* ⚠ 「0 교차가 통과점 자리」는 검사하지 않는다 — 정점이 9번이 되면서 통과점
       17·21 이 현(5→9 · 7→9) 위에 있지 않게 됐다. 21 은 7→**6** 대각선 위의 점이다.
       통과 여부는 위 nearest 표에서 0.000 으로 따로 확인한다. */
  });
  /* ★ 소매산 골격의 앞뒤 비대칭 — 골격 도면(docs/img/원피스-소매-골격.png) 실측이 기준.
       · 대각선은 **앞 5→9 · 뒤 7→6** 이다. 6 과 9 는 우측선 위의 다른 점이고
         (도면에서 41px = 소매통의 0.041), 뒤 대각선은 9 가 아니라 6 으로 간다.
       · 예전엔 뒤를 9 로 재서 뒤 각이 2° 작게 나왔고, 그 값에 맞춰 문턱을 8° 로
         잡았다. 앞AH 를 바로잡자 66·77·88호가 걸렸는데, 도면을 재 보니
         틀린 건 소매가 아니라 이 검사였다.
       도면 실측(px): 소매산높이 458 · 뒤(7→6) 522 · 앞(5→9) 430 · 6→9 41
                      소매통 993  →  앞 46.8° 뒤 41.3° 차 **5.53°**            */
  (function () {
    var 통 = Math.abs(s.p5[0] - s.p7[0]);
    var hf = Math.abs(s.p9[0] - s.p5[0]), hb = Math.abs(s.p7[0] - s.p6[0]);
    var af = Math.atan(s.h / hf) * 180 / Math.PI, ab = Math.atan(s.h / hb) * 180 / Math.PI;
    var d = af - ab;
    if (d < 4.5 || d > 7.0)
      bad.push('소매산 앞뒤 기울기 차 ' + d.toFixed(1) + '° — 도면은 5.5° (허용 4.5~7.0). 앞 ' +
               af.toFixed(1) + '° 뒤 ' + ab.toFixed(1) + '°');
    [['뒤 반너비(7→6)', hb / 통, 0.5257], ['앞 반너비(5→9)', hf / 통, 0.4330],
     ['6→9 시프트', Math.abs(s.p9[0] - s.p6[0]) / 통, 0.0413]].forEach(function (r) {
      if (Math.abs(r[1] - r[2]) > 0.02)
        bad.push('소매산 ' + r[0] + '/소매통 = ' + r[1].toFixed(4) + ' ≠ 도면 ' + r[2]);
    });
  })();

  /* ★ 「소매산 정점」 너치는 **9번** 위에 있어야 한다 — 마루가 9 로 시프트했으므로.
     6 에 남아 있으면 재단할 때 몸판 어깨점과 맞추는 자리가 1.5 어긋난다.
     (실제로 정점을 9 로 옮기면서 이 너치만 6 에 남아 있었다 · 2026-08-14) */
  (function () {
    var p = E.draftDress(m, { seam: E.SEAM_DEFAULT }).pieces
             .filter(function (x) { return x.id === 'sleeve'; })[0];
    if (!p) return;
    var n = (p.notches || []).filter(function (x) { return /정점/.test(x.label); })[0];
    if (!n) { bad.push('소매산 정점 너치가 없다'); return; }
    if (V.dist(n.p, s.p9) > 0.05)
      bad.push('소매산 정점 너치가 ' + n.p.map(function (v) { return v.toFixed(2); }).join(',') +
               ' — 9번 ' + s.p9.map(function (v) { return v.toFixed(2); }).join(',') + ' 위라야 한다');
  })();

  /* ★ 정수리 — 9~6 의 평평한 구간이 있고 양쪽 곡선이 거기에 매끄럽게 붙는가.
     한 점에 모으면 앞이 급경사(42°)라 정점에서 급히 꺾인다(반지름 1.8cm). */
  (function () {
    var top = U.polyLen(U.sampleSegs(s.capTop, 0.02));
    if (Math.abs(top - K.sleeveCtrIn) > 0.02)
      bad.push('소매산 정수리 길이 ' + top.toFixed(2) + ' ≠ 9~6 (' + K.sleeveCtrIn + ')');
    if (Math.abs(s.p9[1]) > 1e-6 || Math.abs(s.p6[1]) > 1e-6)
      bad.push('정수리가 수평이 아니다');
    var f = U.sampleSegs(s.capF, 0.02), b2 = U.sampleSegs(s.capB, 0.02);
    [['앞', V.sub(f[f.length - 1], f[f.length - 6])], ['뒤', V.sub(b2[5], b2[0])]].forEach(function (r) {
      var a = Math.abs(Math.atan2(r[1][1], r[1][0]) * 180 / Math.PI);
      if (Math.abs(180 - a) > 6)
        bad.push('소매산 ' + r[0] + ' 이 정수리에 ' + (180 - a).toFixed(1) + '° 로 붙는다 (6° 이내)');
    });
  })();

  /* 소맷부리는 호수 따라 커져야 한다 (등급이 없으면 44호와 88호가 같은 부리다) */
  if (sz !== E.SIZES[0]) {
    var prevCuff = E.draftDress(E.measuresForSize(E.SIZES[E.SIZES.indexOf(sz) - 1]),
                                { seam: E.SEAM_DEFAULT }).sleeve.cuffW;
    if (!(s.cuffW > prevCuff + 0.2))
      bad.push('소맷부리가 호수 따라 안 큰다 (' + prevCuff.toFixed(2) + ' → ' + s.cuffW.toFixed(2) + ')');
  }

  /* ★★ NaN·누락 가드 — **이번 세션에서 세 번 밟은 함정.**
     `num(opt.x, K.x)` 를 쓰면서 K 에 값을 안 넣으면 undefined → NaN 이 조용히 번진다.
     NaN 은 모든 부등호를 통과하므로 길이·거리 검사가 전부 「통과」로 찍힌다
     (hemBow · capEaseFront 가 그랬다). 여기서 먼저 막는다. */
  ['cbIn','waistEase','hipEase','backDart','princessOut','dartFromCB','dartTipUp',
   'shDrop','shDart','armFromBW','frontShDrop','neckDrop1','neckDeepAdd','bpOut',
   'frontWEase','frontDrop','frontArmGap','frontPrinOut','neckAnchor','neckEndMix',
   'hemPerpK','hemBow','capDiv','capAdd','capFrontOut','capFrontIn','capBackIn','capBackOut',
   'capEaseFront','sleeveCtrIn','elbowAdd','cuffW','cuffGrade','cuffDrop','cuffPerpK',
   'mpBelowEL','ctrTwist','sleeveEase','sleeveSeamBow','twoSideOff','twoSplitAt',
   'twoSplitGap','twoSeamBulge','twoSeamMix','splitPanels'].forEach(function (k) {
    if (!isFinite(K[k])) bad.push('K.' + k + ' 가 없다/숫자가 아니다 (' + K[k] + ') — NaN 이 번진다');
  });
  E.draftDress(m, { seam: E.SEAM_DEFAULT }).pieces.forEach(function (pc) {
    for (var i = 0; i < pc.outline.length; i++)
      if (!isFinite(pc.outline[i][0]) || !isFinite(pc.outline[i][1])) {
        bad.push(pc.name + ' 외곽선에 NaN 좌표'); break;
      }
  });

  /* ★ 소매 좌표 규약 — **앞 +x · 뒤 −x** (스위트 공통).
     도면을 90° 반시계로 돌리면 뒤가 왼쪽·앞이 오른쪽이다. 반대로 두면 조각이
     도면과 거울상으로 나온다 (2026-08-14 사용자 지적으로 발견 — 길이·거리 검사는
     **거울에 불변**이라 89항목 중 어느 것도 못 잡았다). */
  if (!(s.p5[0] > 0 && s.p7[0] < 0))
    bad.push('소매 앞뒤가 뒤집혔다 — 5번(앞) x=' + s.p5[0].toFixed(2) + ' 7번(뒤) x=' + s.p7[0].toFixed(2) +
             ' (앞이 +x 라야 한다)');
  if (!(s.p3[0] > 0 && s.p8[0] < 0)) bad.push('소매 부리 앞뒤가 뒤집혔다');

  /* ★ [19] 34번은 32~33 의 2등분 — 다트 다리는 중심에서 각각 다트분/2 */
  if (Math.abs((g.p34[0] - g.p32[0]) - (g.p33[0] - g.p34[0])) > 0.01)
    bad.push('[19] 34번이 32~33 의 2등분이 아니다');
  if (Math.abs((g.p33[0] - g.p32[0]) - K.backDart) > 0.01)
    bad.push('[19] 32~33 ≠ 다트분');
  /* 소매산 하향폭 — 원문 「소매통이 좁으면 소매산을 0.5~1 내린다」.
     이 제도법은 필요치수(소매통 33~34)와 [2](소매산 = AH/3)가 같이 성립하지 않아
     55호에서 1.49 를 내려야 한다. 원문이 준 폭(0.5~1)을 넘으므로 **경고로 띄운다**. */
  var drop = g.AH / 3 - s.h;
  if (drop > 1.05 || drop < -1.05)
    soft.push('소매산 하향 ' + drop.toFixed(2) + ' — 원문은 0.5~1 (필요치수 소매통 ' +
              m.sleeveW + ' 과 [2] AH/3 = ' + (g.AH / 3).toFixed(2) + ' 가 같이 성립하지 않는다)');

  /* ★ 소맷부리 [10][11][15] — 도면의 ★★ 표시와 26번 통과
       사용자 지적 「소매 밑단도 처리 안되었는데?」(2026-08-14) 로 잡혔다.
       부리선이 26번을 안 지나 **완전한 직선**이었다(양 끝·중간 모두 y = 56.50). */
  (function () {
    var q = U.sampleSegs(s.cuff, 0.02), near26 = 1e9, ys = [];
    q.forEach(function (x) { near26 = Math.min(near26, V.dist(x, s.p26)); ys.push(x[1]); });
    /* [15] 26번(10번에서 안쪽 1.25)을 지나는가 */
    if (near26 > 0.05) bad.push('소매[15] 부리선이 26번을 안 지난다 (' + near26.toFixed(2) + ')');
    /* 직선이면 안 된다 — 23·24 가 내려가고 가운데가 26 을 지나 곡선이 된다 */
    var rise = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    if (rise < 0.2) bad.push('소매 부리선이 직선이다 (높이차 ' + rise.toFixed(2) + ')');
    /* [11] ★★ : 3~24 = 23~8 */
    if (Math.abs(Math.abs(s.p24[0] - s.p3[0]) - Math.abs(s.p8[0] - s.p23[0])) > 0.02)
      bad.push('소매[11] ★★ 3~24 ≠ 23~8');
    /* [10][11] : 3~22 = 24~23 = 소매부리 */
    if (Math.abs(Math.abs(s.p22[0] - s.p3[0]) - s.cuffW) > 0.02)
      bad.push('소매[10] 3~22 ≠ 소매부리');
    if (Math.abs(Math.abs(s.p23[0] - s.p24[0]) - s.cuffW) > 0.02)
      bad.push('소매[11] 24~23 ≠ 소매부리 — 24 를 「밖으로」 읽으면 여기가 깨진다');
    /* 부리 호길이가 소매부리에서 크게 벗어나면 안 된다 (26 통과로 +0.04 정도) */
    if (Math.abs(U.polyLen(q) - s.cuffW) > 0.15)
      bad.push('소매 부리선 호길이 ' + U.polyLen(q).toFixed(2) + ' ≠ 소매부리 ' + s.cuffW);
    /* [14] MP 분량선 25 = EL 에서 1 아래 · 14 = EL ∩ 앞 밑변 */
    if (Math.abs(s.p25[1] - (s.elY + 1)) > 0.02) bad.push('소매[14] 25번이 EL+1 이 아니다');
    if (Math.abs(s.p14[1] - s.elY) > 0.02) bad.push('소매[14] 14번이 EL 위가 아니다');
  })();

  /* ★ 어깨를 꿰맸을 때 앞뒤 목선이 **한 줄기로 이어지는가**
     (앞 목선↔어깨선 각) + (뒤 목선↔어깨선 각) = 180° 라야 안 꺾인다. */
  (function () {
    function arrive(sg, at) {
      var q = U.sampleSegs(sg, 0.02);
      if (V.dist(q[0], at) < V.dist(q[q.length - 1], at)) q = q.slice().reverse();
      return V.norm(V.sub(q[q.length - 1], q[q.length - 4]));
    }
    function ang(a, b) {
      return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
    }
    var fT = arrive(g.fNeck, g.f54), bT = arrive(g.bNeck, g.p20);
    var sum = ang([-fT[0], -fT[1]], V.norm(V.sub(g.f57, g.f54))) +
              ang([-bT[0], -bT[1]], V.norm(V.sub(g.p23, g.p20)));
    if (Math.abs(180 - sum) > 3)
      bad.push('어깨에서 앞뒤 목선이 ' + Math.abs(180 - sum).toFixed(1) + '° 꺾인다 (3° 이내)');
  })();

  /* ★ 앞목선의 앞중심 쪽 평평 구간 — **도면 기준으로 다시 잡았다**.
       예전 문턱은 「≥45%」였다. 그건 목이 얕던 시절(75 를 기준선에서 7.5 로 잡던 때)
       「사선처럼 보인다」는 지적에서 나온 값이고, 도면을 재 보니 도면은 **28.8%** 다.
       도면 곡선을 54·75 끝점으로 엔진 크기에 맞춘 뒤 같은 자(0.5cm 띠 · ÷목너비)로 쟀다.
       ⚠ 한쪽만 막던 검사를 **양쪽 띠**로 바꾼다 — 너무 평평해도 도면과 멀어진다
         (nA 0.76 이면 48% 로, 곡선 최대편차가 0.176 → 0.5 대로 벌어졌다).
       ※ 이 스칼라는 0.5cm 띠를 넘는 자리 하나로 정해져 칼날 같다. **진짜 검사는
         §3-C 의 fNeck 곡선 대조**(허용 0.25)이고 여기는 값싼 보조 검사다. */
  (function () {
    var q = U.sampleSegs(g.fNeck, 0.02), flat = 0;
    q.forEach(function (x) { if (Math.abs(x[1] - g.f75[1]) <= 0.5) flat = Math.max(flat, x[0]); });
    var ratio = flat / g.f53[0];
    if (ratio < 0.25 || ratio > 0.40)
      bad.push('앞목선 평평 구간 ' + (ratio * 100).toFixed(0) + '% — 도면은 28.8% (25~40%)');
  })();

  /* ★ 앞목선은 54 쪽이 **직선으로 나간다** — 원문 [42] 의 76 보조선 구간.
     앞판 도면 실측: 54 에서 3.2cm 넘게 편차 0.04(화소 잡음) 인 완전한 직선이다.
     자를 두 개 쓴다:
       · 도면과 **견줄 때**는 도면의 잡음 바닥(0.10cm)에 맞춘다 — 그보다 촘촘히 재면
         도면 쪽만 17% 로 무너진다(화소 지그재그를 곡률로 읽는다). 0.10 에서 도면 48%.
       · **회귀를 잡을 때**는 0.02cm 로 재야 「진짜 직선인가」가 갈린다 —
         직선을 끄면 13%, 켜면 39% 로 뚜렷하다 (0.10 으로 재면 39% vs 43% 라 못 잡는다).
     예전엔 54 에서 곧바로 곡률이 붙어 직선이 16% 밖에 없었다(사용자 지적 2026-08-14).
     ⚠ 이 검사는 「평평 구간 ≥45%」와 **같이** 걸어야 뜻이 있다 — 둘 중 하나만 보면
       한쪽을 늘리다 다른 쪽을 죽인다(직선을 넣자 평평이 57%→44% 로 무너졌었다). */
  (function () {
    var p = U.sampleSegs(g.fNeck, 0.02).slice().reverse();   // 54 → 75
    var s = [0], i;
    for (i = 1; i < p.length; i++) s.push(s[i - 1] + V.dist(p[i], p[i - 1]));
    var T = s[s.length - 1], i1 = 0;
    while (s[i1] < 0.05 * T) i1++;
    var d = V.norm(V.sub(p[i1], p[0])), n = [-d[1], d[0]], hit = 1;
    for (i = 2; i < p.length; i++) {
      if (Math.abs((p[i][0] - p[0][0]) * n[0] + (p[i][1] - p[0][1]) * n[1]) > 0.02) { hit = s[i] / T; break; }
    }
    if (hit < 0.30)
      bad.push('앞목선 직선 구간 ' + (hit * 100).toFixed(0) + '% (자 0.02) — 직선을 끄면 13% 다 (30% 이상)');
    /* 직선이 끝나는 자리에서 꺾이면 안 된다 — 접선이 이어져야 한다 */
    var j = 0; while (j < p.length - 4 && s[j] < hit * T) j++;
    if (j > 3 && j < p.length - 4) {
      var a = V.norm(V.sub(p[j], p[j - 3])), b = V.norm(V.sub(p[j + 3], p[j]));
      var kink = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
      if (kink > 6)
        bad.push('앞목선 직선이 끝나는 곳에서 ' + kink.toFixed(1) + '° 꺾인다 (6° 이내)');
    }
  })();

  /* [41] 74 = 66 + (73~66) — 밑단 다트 다리가 66번 기준 대칭 */
  if (Math.abs(Math.abs(g.f73[0] - g.f66[0]) - Math.abs(g.f74[0] - g.f66[0])) > 0.02)
    bad.push('[41] 73~66 ≠ 66~74');

  /* 좌표로 정해진 점 — 원문 식 그대로인지 */
  var chk = [
    ['소매[5]', s.p9[0], 1.5, 0.01, '9번 = 6번에서 1.5 앞 (앞 = +x)'],
    ['소매[15]', s.p26[0] - s.p10[0], 1.25, 0.01, '26번 = 10번에서 1.25 안쪽'],
    ['소매[6]', s.elY, (s.h + s.len) / 2 - 2.25, 0.01, 'EL = 12번에서 2.25 위'],
    ['[20]', g.p36[1], g.HL - 5, 0.01, '36번 = H선에서 5 위'],
    ['[42]', g.f75[1], 1.0 + m.B / 12 + 0.5, 0.01, '앞목 깊이 = **55번**(=54 높이) 에서 B/12 + 0.5'],
    ['[31]', g.f53[0], m.B / 12, 0.01, '앞목 너비 = B/12']
  ];
  chk.forEach(function (r) {
    if (Math.abs(r[1] - r[2]) > r[3])
      bad.push(r[0] + ' ' + r[4] + ' — ' + (+r[1]).toFixed(2) + ' ≠ ' + (+r[2]).toFixed(2));
  });
  /* [28] 「44번에 곡자를 대고 밑단」 — 밑단이 현(11~40)에서 실제로 휘어야 한다.
     통과점을 현 위에 두면 31cm 구간에서 0.17 밖에 안 휘어 직선처럼 보인다(사용자 지적). */
  [['뒤', g.bHem, g.p11, g.p40], ['앞', g.fHem, g.f64, g.f65]].forEach(function (r) {
    var q = U.sampleSegs(r[1], 0.02), d = V.sub(r[3], r[2]), L = Math.hypot(d[0], d[1]), mx = 0;
    q.forEach(function (x) {
      mx = Math.max(mx, Math.abs((x[0] - r[2][0]) * d[1] - (x[1] - r[2][1]) * d[0]) / L);
    });
    if (mx < 0.4 || mx > 1.4) bad.push('[28] ' + r[0] + ' 밑단 휨 ' + mx.toFixed(2) + ' (0.4~1.4 라야 곡선이다)');
  });
  /* 소매 [15] ■ — **너치 위치** 규칙이다 (도면 「앞쪽 ■ +0.5(이세분)」).
     솔기 길이 조건이 아니다: [10][11] 로 22·23·24 를 잡으면 앞뒤 가로 span 이 둘 다
     Lrest/2 라 두 솔기가 수학적으로 같아진다. 그 사실도 함께 검사한다. */
  if (Math.abs((s.markAtF - s.markAtB) - 0.5) > 0.01)
    bad.push('소매[15] ■ 앞이 뒤보다 0.5 나가야 한다 — 실제 ' +
             (s.markAtF - s.markAtB).toFixed(3));
  if (Math.abs(s.seamLenB - s.seamLenF) > 0.02)
    bad.push('소매 앞뒤 솔기가 다르다 ' + s.seamLenF.toFixed(3) + '↔' + s.seamLenB.toFixed(3) +
             ' — [10][11] 작도상 같아야 한다');
  if (bad.length) fails++; else if (soft.length) warns++;
  console.log('  ' + (bad.length ? '✗ ' : soft.length ? '⚠ ' : '✓ ') + pad(sz, 5) +
    '원문 점 통과 ' + (91 - bad.length - soft.length) + '/91' +
    (bad.length ? '\n      ✗ ' + bad.join('\n      ✗ ') : '') +
    (soft.length ? '\n      ⚠ ' + soft.join('\n      ⚠ ') : ''));
});

/* ══ 3-C. 정답지 대조 — 도면에서 찍은 좌표와 직접 비교 ═══════════════════
 *  `tools/도면-좌표찍기.html` 로 docs/answer/원피스-{뒤판,앞판,소매}.json 을 만들면
 *  여기가 자동으로 켜진다. 정답지가 없으면 조용히 건너뛴다.
 *  ★ 좌표 대조는 **거울·회전·모양을 한 번에** 잡는다 — 길이 검사가 못 잡는 것들이다.
 * ══════════════════════════════════════════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3-C. 정답지 대조 (docs/answer/*.json · 도면에서 찍은 좌표)');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var m = E.measuresForSize('55호'), g = E.geom(m);
  var s = E.draftDress(m, { seam: E.SEAM_DEFAULT }).sleeve, any = false;
  [['원피스-뒤판',
    { 2: g.p2, 9: g.p9, 10: g.p10, 11: g.p11, 12: g.p12, 15: g.p15, 17: g.p17, 18: g.p18,
      19: g.p19, 20: g.p20, 21: g.p21, 22: g.p22, 23: g.p23, 26: g.p26, 28: g.p28, 29: g.p29,
      32: g.p32, 33: g.p33, 34: g.p34, 35: g.p35, 36: g.p36, 38: g.p38, 39: g.p39, 40: g.p40, 42: g.p42 },
    /* 2026-08-15 정답지를 도면에서 확충했다 (1 → 6곡선) — 절개선·등솔선까지 대조한다.
       스킬 pattern-drawing-diff · tools/원피스-정답지-생성.js */
    { bArm: g.bArm, bNeck: g.bNeck, bSide: g.bSide, bHem: g.bHem,
      cbSegs: g.cbSegs, bPrinIn: g.bPrinIn, bPrinOut: g.bPrinOut }],
   ['원피스-앞판',
    { 12: g.f12, 15: g.f15, 51: g.f51, 53: g.f53, 54: g.f54, 56: g.f56, 57: g.f57, 58: g.f58,
      59: g.f59, 60: g.f60, 64: g.f64, 67: g.f67, 68: g.f68, 69: g.f69, 70: g.f70,
      73: g.f73, 74: g.f74, 75: g.f75, 78: g.f78 },
    { fArm: g.fArm, fNeck: g.fNeck, fSide: g.fSide, fHem: g.fHem,
      fPrinIn: g.fPrinIn, fPrinOut: g.fPrinOut }],
   ['원피스-소매',
    { 3: s.p3, 5: s.p5, 6: s.p6, 7: s.p7, 8: s.p8, 9: s.p9, 10: s.p10, 15: s.p15, 16: s.p16,
      17: s.p17, 18: s.p18, 19: s.p19, 20: s.p20, 21: s.p21, 22: s.p22, 23: s.p23, 24: s.p24, 26: s.p26 },
    { capF: s.capF, capB: s.capB, seamF: s.seamF, seamB: s.seamB, cuff: s.cuff }]
  ].forEach(function (r) {
    var bad = [], out = AC.run(r[0], r[1], r[2], U, bad);
    if (out.skipped) { console.log('  · ' + pad(r[0], 12) + '정답지 없음 — 건너뜀'); return; }
    any = true;
    if (bad.length) fails++;
    console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(r[0], 12) +
      '번호점 ' + out.n + '개 최대 차 ' + f(out.worst, 5) + (out.worstK ? ' (' + out.worstK + '번)' : '') +
      ' · 곡선 ' + out.cn + '개 최대 ' + f(out.cworst, 5) +
      (out.mirrored ? ' · 도면은 거울' : '') +
      (bad.length ? '\n      → ' + bad.slice(0, 6).join('\n      → ') +
        (bad.length > 6 ? '\n      → … 외 ' + (bad.length - 6) + '건' : '') : ''));
  });
  if (!any) {
    console.log('');
    console.log('  ※ 정답지를 만들면 이 절이 켜진다 — 좌표 대조는 **거울·회전·모양**을');
    console.log('    한 번에 잡는다. 길이 검사(§1~3)로는 못 잡는 것들이다.');
    console.log('      tools/도면-좌표찍기.html 을 열고 docs/img/ 의 도면에서');
    console.log('      보정점 3개(삼각형!) + 번호점을 찍어 docs/answer/ 에 저장.');
  }
})();

/* ══ 4. 곡선 모양 검사 — 길이가 아니라 **생김새**를 잰다 ═══════════════
 *
 *  ★ 이 검사가 없어서 두 번 놓쳤다 (2026-08-14 사용자 지적):
 *    · 소매산 — 이세 1.83 · 소매통 33.5 로 **길이는 다 맞는데** 정수리가 평평하고
 *      뒤쪽에 각이 졌다. 원문 점을 그대로 스플라인에 꿴 탓이다.
 *    · 앞목   — 끝접선을 (0,1) 로 줘서 목옆점 앞에서 **되돌아 나갔다**.
 *      총회전 201°(정상 ~95°) · 최대곡률 3.19(반지름 0.31cm) 였는데 길이 검사는 통과.
 *
 *  재는 것 셋:
 *    ① 최대곡률  — 스파이크가 곧 「각」이다. 반지름 1cm 보다 급하면 사람 몸에 없는 선이다
 *    ② 변곡 횟수 — 곡률 부호가 몇 번 바뀌나. 물결치면 늘어난다
 *    ③ 끝접선    — 도면의 직각 표시(어깨 끝·목옆점)와 수평 도착(겨드랑·소매산)을 확인
 * ══════════════════════════════════════════════════════════════════ */
function shapeOf(segs) {
  var p = U.sampleSegs(segs, 0.05), ang = [], ds = [], i;
  for (i = 1; i < p.length; i++) {
    var d = V.sub(p[i], p[i - 1]);
    ang.push(Math.atan2(d[1], d[0])); ds.push(Math.hypot(d[0], d[1]));
  }
  var k = [], turn = 0;
  for (i = 1; i < ang.length; i++) {
    var da = ang[i] - ang[i - 1];
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    k.push(da / (((ds[i] + ds[i - 1]) / 2) || 1e-9)); turn += Math.abs(da);
  }
  /* 표본 잡음을 없애려고 창 6 으로 민다 — 안 밀면 끝점마다 가짜 변곡이 잡힌다 */
  var sm = [], W = 6, mx = 0;
  for (i = 0; i < k.length; i++) {
    var a = 0, c = 0;
    for (var j = Math.max(0, i - W); j < Math.min(k.length, i + W + 1); j++) { a += k[j]; c++; }
    sm.push(a / c); mx = Math.max(mx, Math.abs(a / c));
  }
  /* 변곡은 **의미 있는 곡률**에서만 센다 — 반지름 12cm 보다 평평하면 직선으로 본다 */
  var lim = Math.max(0.08, mx * 0.10), infl = 0, prev = 0;
  sm.forEach(function (v) {
    var sg = v > lim ? 1 : (v < -lim ? -1 : 0);
    if (sg && prev && sg !== prev) infl++;
    if (sg) prev = sg;
  });
  var deg = function (r) { return r * 180 / Math.PI; };
  return { maxK: mx, infl: infl, turn: deg(turn), t0: deg(ang[0]), t1: deg(ang[ang.length - 1]) };
}
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 곡선 모양 — 최대곡률 · 변곡 · 끝접선 (길이로는 안 잡히는 것)');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), s = E.draftDress(m, { seam: E.SEAM_DEFAULT }).sleeve, bad = [];
  /* [곡선, 이름, 최대곡률 상한, 변곡 상한, 시작접선 기대·허용, 끝접선 기대·허용] */
  var shoulderB = Math.atan2(g.p23[1] - g.p20[1], g.p23[0] - g.p20[0]) * 180 / Math.PI;
  var shoulderF = Math.atan2(g.f57[1] - g.f54[1], g.f57[0] - g.f54[0]) * 180 / Math.PI;
  [[g.bArm,  '뒤 암홀',   0.45, 1, shoulderB + 90, 12, 0, 6],
   [g.fArm,  '앞 암홀',   0.45, 1, shoulderF + 90, 12, 0, 6],
   /* 앞 = +x 규약이라 소매산은 −x 로 진행 → 끝접선 기대값 180° (여전히 수평) */
   /* 소매산 상한은 0.70 — 최대곡률이 **끝점**에 있다: 앞은 겨드랑 훅(반지름 1.5cm,
      앞 소매산이 원래 그렇다), 뒤는 평평한 정수리에서 곡선으로 넘어가는 자리.
      가운데가 튀면 여전히 잡힌다. */
   [s.capF,  '앞 소매산', 0.70, 1, 180, 6, 180, 6],
   [s.capB,  '뒤 소매산', 0.70, 1, 180, 6, 180, 6],
   [g.bNeck, '뒷목',      0.70, 1, null, 0, shoulderB - 90, 15],
   [g.fNeck, '앞목',      0.70, 2, null, 0, shoulderF - 90, 8]
  ].forEach(function (r) {
    var x = shapeOf(r[0]), nm = r[1];
    if (x.maxK > r[2]) bad.push(nm + ' 최대곡률 ' + x.maxK.toFixed(2) + ' > ' + r[2] +
                                ' (반지름 ' + (1 / x.maxK).toFixed(1) + 'cm — 각이 졌다)');
    if (x.infl > r[3]) bad.push(nm + ' 변곡 ' + x.infl + ' > ' + r[3] + ' (물결친다)');
    function angChk(got, want, tol, label) {
      if (want === null) return;
      var d = ((got - want + 540) % 360) - 180;
      if (Math.abs(d) > tol) bad.push(nm + ' ' + label + ' ' + got.toFixed(1) + '° (기대 ' +
                                      want.toFixed(1) + '° ± ' + tol + ')');
    }
    angChk(x.t0, r[4], r[5], '시작접선');
    angChk(x.t1, r[6], r[7], '끝접선');
  });
  if (bad.length) fails++;
  var sh = shapeOf(g.bArm), sf = shapeOf(g.fArm), sc = shapeOf(s.capF);
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '뒤암홀 곡률 ' + f(sh.maxK, 5) + ' 변곡 ' + sh.infl +
    ' · 앞암홀 ' + f(sf.maxK, 5) + '/' + sf.infl +
    ' · 앞소매산 ' + f(sc.maxK, 5) + '/' + sc.infl + ' 끝접선 ' + f(sc.t1, 5) + '°' +
    (bad.length ? '\n      → ' + bad.join('\n      → ') : ''));
});

/* ══ 5. 두 장 소매 — 자르기 전과 같은 소매인가 ═════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 5. 두 장 소매 — 짝 길이는 작도로 보장된다 (대칭 · 평행이동)');
console.log('════════════════════════════════════════════════════════════');
console.log('   ※ 원문에는 한 장 소매 도면뿐이다. 두 장은 이 스위트의 정답지 모듈');
console.log('     (숙녀복기본원형1·2)에서 검증된 작도를 따른다.');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), bad = [];
  var d1 = E.draftDress(m, { seam: E.SEAM_DEFAULT, sleeveType: 'one' });
  var d2 = E.draftDress(m, { seam: E.SEAM_DEFAULT, sleeveType: 'two' });
  var x = d2.two, one = d1.sleeve;

  if (!x) { bad.push('두 장 소매가 안 나왔다'); }
  else {
    /* 짝 — 작도로 보장되므로 0.02 로 조인다. 벌어지면 작도가 무너진 것이다 */
    if (Math.abs(x.seamLenBig - x.seamLenUnd) > 0.02)
      bad.push('절개선 짝 ' + x.seamLenBig.toFixed(3) + '↔' + x.seamLenUnd.toFixed(3));
    if (Math.abs(x.frontLenBig - x.frontLenUnd) > 0.02)
      bad.push('앞 솔기 짝 ' + x.frontLenBig.toFixed(3) + '↔' + x.frontLenUnd.toFixed(3));
    /* ★ 자른다고 소매가 달라지면 안 된다 */
    if (Math.abs((x.cuffBig + x.cuffUnd) - one.cuffW) > 0.02)
      bad.push('부리 합 ' + (x.cuffBig + x.cuffUnd).toFixed(3) + ' ≠ 소매부리 ' + one.cuffW);
    var capTot = x.capLenBig + x.capLenUnd, easeTot = capTot - g.AH;
    if (Math.abs(capTot - one.capLen) > 0.05)
      bad.push('소매산 합 ' + capTot.toFixed(3) + ' ≠ 한 장 ' + one.capLen.toFixed(3));
    if (easeTot < 1.0 || easeTot > 2.6) bad.push('두 장 이세 ' + easeTot.toFixed(2) + ' (원문 1.5~2)');
    /* 작은소매가 큰소매보다 좁아야 한다 — 뒤집히면 절개점이 잘못 잡힌 것이다 */
    if (x.cuffUnd >= x.cuffBig) bad.push('작은소매 부리 ' + x.cuffUnd.toFixed(2) + ' ≥ 큰소매 ' + x.cuffBig.toFixed(2));
    /* 조각 수 — 소매 1장이 2장으로 */
    if (d2.pieces.length !== d1.pieces.length + 1) bad.push('조각 수 ' + d2.pieces.length);
    if (d2.warnings.length) bad.push('경고 ' + d2.warnings.join(' · '));
    /* 모양도 본다 — 절개선이 각지거나 물결치면 안 된다 (§4 와 같은 잣대) */
    [[x.bigSeam, '큰소매 절개선'], [x.undSeam, '작은소매 절개선'],
     [x.bigFront, '큰소매 앞 밑선']].forEach(function (r) {
      var q = shapeOf(r[0]);
      if (q.maxK > 0.35) bad.push(r[1] + ' 최대곡률 ' + q.maxK.toFixed(2) + ' (각이 졌다)');
      if (q.infl > 1) bad.push(r[1] + ' 변곡 ' + q.infl + ' (물결친다)');
    });
  }
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    (x ? ('절개선 ' + f(x.seamLenBig, 7) + '↔' + f(x.seamLenUnd, 7) +
          ' · 앞솔기 ' + f(x.frontLenBig, 7) + '↔' + f(x.frontLenUnd, 7) +
          ' · 부리 ' + f(x.cuffBig, 6) + '+' + f(x.cuffUnd, 5) + '=' + f(x.cuffBig + x.cuffUnd, 6) +
          ' · 이세 ' + f(x.capLenBig + x.capLenUnd - g.AH, 5)) : '') +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* ══ 6. 도면 대조 (soft) — 원문 55 Size 그림에서 읽은 값 ═══════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 6. 도면 대조 (soft) — 원문 55 Size · 정답지가 없어 참고만 한다');
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
  /* 앞목 깊이 — 도면 실측 9.60. 원문 [31]+[42] 를 이으면 8.50 이라 1.10 차인데,
     같은 도면에서 목너비가 +0.84 · 앞품이 +0.48 헐거우니 그 범위다.
     예전엔 기준선에서 재서 7.50 이었고 도면과 2.10 어긋났다. */
  chk('앞목 깊이',        g.f75[1], 8.5, 0.01);    // 55(=54 높이) + B/12 + 0.5
  chk('BP (유폭/2, 유장)', g.f59[0], 8.0, 0.01);
  /* 앞 어깨 — 앞판 도면(docs/img/원피스-앞판-도면.png) 실측.
     기준: 앞목기준선 px 1892 · 앞중심 py 799 · 22.70 px/cm.
     어깨선을 245점으로 직선피팅(RMS 0.51px)해서 얻은 값이다.
     이 세 줄이 「56 을 앞품/2 에서 재던」 결함을 잡는다. */
  chk('앞 어깨 기울기',    (g.f56[1] - g.f54[1]) / (g.f56[0] - g.f54[0]), 0.3157, 0.02);
  /* 앞목선이 54 에서 나가는 각 — 도면 곡선의 실제 접선 108.43°.
     어깨 직각만 쓰면 107.57° 라 0.86° 안쪽으로 모자란다. 작아 보여도 이 각이
     54→76 보조선의 방향이고, 곡선이 그 직선을 얼마나 타는지를 정한다.
     (사용자 지적 2026-08-14 — 「안쪽으로 직선 출발 각을 조금 줄이면」) */
  (function () {
    var q = U.sampleSegs(g.fNeck, 0.02);
    if (V.dist(q[0], g.f54) > V.dist(q[q.length - 1], g.f54)) q = q.slice().reverse();
    chk('앞목선 54 출발각', Math.atan2(q[5][1] - q[0][1], q[5][0] - q[0][0]) * 180 / Math.PI, 108.43, 0.6);
  })();
  chk('앞 어깨끝 57번 x',  g.f57[0], 18.99, 0.25);
  chk('앞 어깨끝 57번 y',  g.f57[1], 4.85, 0.25);
  /* 앞AH — 도면의 암홀 곡선을 파랑 화소 위 최단경로로 재면 57→옆선까지 22.13 인데
     끝이 옆선으로 약 1 넘어가므로 실질 21.1~22.1. 아직 이만큼 짧다(뒤도 1.0 짧다).
     소매산 높이 h/소매통 이 도면 0.4612 · 55호 0.4004 인 것과 같은 원인이다. */
  /* 뒤 어깨 — 뒤판 도면(빨강 선) 실측. 기준 px 1863 / py 803 / 23.09 px/cm,
     251점 직선피팅 RMS 0.43px. 뒤는 골격이 맞다 — 여기는 회귀 방지용이다. */
  chk('뒤 어깨 기울기',   (g.p22[1] - g.p20[1]) / (g.p22[0] - g.p20[0]), 0.3869, 0.03);
  chk('뒤 목옆 20번 y',   g.p20[1], -2.75, 0.35);
  chk('뒤 어깨끝 22번 y', g.p22[1], 1.85, 0.25);
  /* 암홀 둘레 — 도면 곡선을 화소 최단경로로 재고 0.12cm 로 솎은 값이 기준이다.
     ⚠ 원시 경로를 그대로 재면 계단 때문에 7% 부푼다(길이를 아는 직선으로 확인:
       원시 12.693 · 솎기 11.830 · 실제 11.773). 예전에 「앞 21.1~22.1 · 뒤 23.5」로
       적어 둔 것은 그 부푼 값이었고, 그래서 「AH 가 모자라다」는 결론이 부호까지
       틀렸다. 실제로는 **엔진이 도면보다 길다**.
     허용 폭 ±1.5 는 이세 예산 정도의 크기다. 모양 자체는 §3-C 정답지가 맡는다. */
  ok('앞 암홀', Math.abs(g.ahFront - 20.06) <= 1.5,
     f(g.ahFront, 7) + '  도면 20.06 · 차 ' + f(g.ahFront - 20.06, 6), true);
  ok('뒤 암홀', Math.abs(g.ahBack - 21.07) <= 1.5,
     f(g.ahBack, 7) + '  도면 21.07 · 차 ' + f(g.ahBack - 21.07, 6), true);
  ok('소매통', Math.abs(M.sleeveW - 33.5) <= 0.5, f(M.sleeveW, 7) + '  원문 33~34', true);
  ok('소매 이세', M.capEase >= 1.2 && M.capEase <= 2.2, f(M.capEase, 7) + '  원문 1.5~2', true);
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(fails ? ' 실패 ' + fails + '건' + (warns ? ' · 참고 ' + warns + '건' : '')
                  : ' 전체 통과' + (warns ? ' · 참고 ' + warns + '건' : ''));
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
