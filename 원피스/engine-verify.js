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
   ['소매[5]', s.capB, s.p9, 0.02, '뒤 소매산이 정점 9번에서 시작한다']
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
   ['capBackOut', K.capBackOut, 4.5, 5.0], ['cuffW', K.cuffW, 24, 24]
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
   ['f56', g.f56, [m.frontW / 2, 4.8]],
   ['f59(BP)', g.f59, [m.bustW / 2, m.bustLen]], ['f60', g.f60, [m.bustW / 2 + K.bpOut, m.bustLen]],
   ['f75', g.f75, [0, B / 12 + 0.5]], ['f64', g.f64, [0, g.LEN + 2.0]],
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
  [['앞 소매산', s.capF, s.p5, s.p9, s.p17, -1],
   ['뒤 소매산', s.capB, s.p7, s.p9, s.p21, +1]].forEach(function (r) {
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
  /* ★ 앞이 급경사 · 뒤가 완만 — 정점이 9번이라야 이렇게 된다 (사용자 지적 2026-08-14).
     정점을 6번에 두면 앞 39.4° / 뒤 34.1° 로 차이가 5° 밖에 안 나고 도면과 다르다.
     9번이면 앞 42.3° / 뒤 32.1° — 10° 이상 벌어진다. */
  (function () {
    var hf = Math.abs(s.p9[0] - s.p5[0]), hb = Math.abs(s.p7[0] - s.p9[0]);
    var af = Math.atan(s.h / hf) * 180 / Math.PI, ab = Math.atan(s.h / hb) * 180 / Math.PI;
    if (af - ab < 8)
      bad.push('소매산 앞뒤 기울기 차 ' + (af - ab).toFixed(1) + '° — 앞이 급경사·뒤가 완만해야 한다 (앞 ' +
               af.toFixed(1) + '° 뒤 ' + ab.toFixed(1) + '°)');
  })();

  /* 정점에서 앞뒤가 매끄럽게 이어지는가 (뾰족하면 안 된다) */
  (function () {
    var f = U.sampleSegs(s.capF, 0.02), b2 = U.sampleSegs(s.capB, 0.02);
    var t1 = V.sub(f[f.length - 1], f[f.length - 6]), t2 = V.sub(b2[5], b2[0]);
    var n1 = Math.hypot(t1[0], t1[1]), n2 = Math.hypot(t2[0], t2[1]);
    var a = Math.acos(Math.max(-1, Math.min(1, (t1[0] * t2[0] + t1[1] * t2[1]) / (n1 * n2)))) * 180 / Math.PI;
    if (a > 6) bad.push('소매산 정점 꺾임 ' + a.toFixed(1) + '° (6° 이내라야 한다)');
  })();

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

  /* [41] 74 = 66 + (73~66) — 밑단 다트 다리가 66번 기준 대칭 */
  if (Math.abs(Math.abs(g.f73[0] - g.f66[0]) - Math.abs(g.f74[0] - g.f66[0])) > 0.02)
    bad.push('[41] 73~66 ≠ 66~74');

  /* 좌표로 정해진 점 — 원문 식 그대로인지 */
  var chk = [
    ['소매[5]', s.p9[0], -1.5, 0.01, '9번 = 6번에서 1.5 앞'],
    ['소매[15]', s.p26[0] - s.p10[0], -1.25, 0.01, '26번 = 10번에서 1.25 안쪽'],
    ['소매[6]', s.elY, (s.h + s.len) / 2 - 2.25, 0.01, 'EL = 12번에서 2.25 위'],
    ['[20]', g.p36[1], g.HL - 5, 0.01, '36번 = H선에서 5 위'],
    ['[42]', g.f75[1], m.B / 12 + 0.5, 0.01, '앞목 깊이 = B/12 + 0.5'],
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
    '원문 점 통과 ' + (86 - bad.length - soft.length) + '/86' +
    (bad.length ? '\n      ✗ ' + bad.join('\n      ✗ ') : '') +
    (soft.length ? '\n      ⚠ ' + soft.join('\n      ⚠ ') : ''));
});

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
   [s.capF,  '앞 소매산', 0.60, 1, 0, 6, 0, 6],     // 양 끝 수평 — 정답지 작도
   [s.capB,  '뒤 소매산', 0.60, 1, 0, 6, 0, 6],
   [g.bNeck, '뒷목',      0.70, 1, null, 0, shoulderB - 90, 15],
   [g.fNeck, '앞목',      0.70, 2, null, 0, shoulderF - 90, 15]
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
