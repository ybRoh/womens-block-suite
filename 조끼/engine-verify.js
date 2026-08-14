/* ============================================================================
 * engine-verify.js — 조끼 검산
 *
 *   제도법: 백영례 조끼 번호점 제도법 (docs/조끼-제도법-백영례.md)
 *
 *   ★ 이 모듈에는 **DXF/PDF 정답지가 없다.** 원문 텍스트와 도면 이미지만 있다.
 *     그래서 검사는 세 가지다:
 *       ① 원문이 「재서 확인하라」고 한 자리          (§1)
 *       ② 번호점이 원문 **식** 그대로인가            (§2)
 *       ③ 조각이 실제로 꿰매지는가 — 닫힘·짝·연속성  (§3~§5)
 *
 *   ⚠ 2026-08-14 이전의 이 파일은 **원피스 검산기가 그대로 복제**돼 있었다.
 *     g.p42 · g.f78 · g.bPrinIn · d.sleeve 처럼 조끼 엔진에 없는 이름을 읽어
 *     **첫 줄에서 TypeError 로 죽었다** — 즉 조끼는 한 번도 검산된 적이 없다.
 *     (알려진 결함 유형 ① 「검사가 없어서 통과」의 교과서적인 사례다.)
 *
 *   ★ 기대값에 K 를 쓰면 자기만족 검사가 된다. 원문이 하나로 못 박은 값은
 *     **리터럴**로 쓰고, 「2~2.5」처럼 폭이 있는 것만 K 를 참조한다.
 *
 *   실행: node engine-verify.js     (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var E = require('./engine.js'), U = E.util, V = U.V, K = E.K;

var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 2 : d); while (s.length < w) s = ' ' + s; return s; }
function head(t) {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(' ' + t);
  console.log('════════════════════════════════════════════════════════════');
}
function row(sz, bad, soft, text) {
  if (bad.length) fails++;
  if (soft.length) warns++;
  console.log('  ' + (bad.length ? '✗ ' : soft.length ? '⚠ ' : '✓ ') + pad(sz, 5) + text +
    (bad.length ? '\n      ✗ ' + bad.join('\n      ✗ ') : '') +
    (soft.length ? '\n      ⚠ ' + soft.join('\n      ⚠ ') : ''));
}
function LEN(segs) { return U.polyLen(U.sampleSegs(segs, 0.02)); }
/** 곡선 위에서 점 P 까지의 최단거리 — 「이 점을 지나야 한다」를 재는 자 */
function nearest(segs, P) {
  var q = U.sampleSegs(segs, 0.02), b = Infinity;
  for (var i = 0; i < q.length; i++) { var d = V.dist(q[i], P); if (d < b) b = d; }
  return b;
}
/** NaN 은 모든 부등식을 통과한다 — 값을 쓰기 전에 반드시 여기를 지난다 */
function finiteOr(bad, label, v) {
  if (!isFinite(v)) { bad.push(label + ' = ' + v + ' (NaN/Infinity — 부등식 검사를 그냥 통과한다)'); return false; }
  return true;
}

var SIZES = E.SIZES;

/* ══════════════════════════════════════════════════════════════════════
 * §1. 원문이 「재서 확인하라」고 한 자리
 * ════════════════════════════════════════════════════════════════════ */
head('1. 원문 확인 절차 — 「재서 확인하라」가 곧 검사다 (전 호수)');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), d = E.draftVest(m, { seam: E.SEAM_DEFAULT });
  var M = d.measures, bad = [], soft = [];

  /* [12] 「2번과 21번까지의 치수를 재서 2분의어깨치수와 다트분 1.5cm 를 확인」 */
  var d221 = V.dist(g.p2, g.p21);
  if (finiteOr(bad, '[12] 2~21', d221) && Math.abs(d221 - (m.shoulderW / 2 + g.shDart)) > 0.02)
    bad.push('[12] 2~21 ' + d221.toFixed(3) + ' ≠ 어깨/2 + 다트 ' + (m.shoulderW / 2 + g.shDart).toFixed(2));

  /* [20] 「빨간 별표시한 유차 부분들은 치수가 같아야 합니다」
     ★ 별표 셋 = 13→41 · 2→44 · (진동선의) 43 자리. 전부 유차여야 한다. */
  var starA = g.p13[1] - g.f41[1], starB = g.p2[1] - g.f44[1], starC = g.p23[1] - g.p24[1];
  [['13→41', starA], ['2→44', starB], ['23→24', starC]].forEach(function (r) {
    if (finiteOr(bad, '[20] ' + r[0], r[1]) && Math.abs(r[1] - g['유차']) > 0.001)
      bad.push('[20] 유차 별표 ' + r[0] + ' = ' + r[1].toFixed(3) + ' ≠ 유차 ' + g['유차']);
  });

  /* [23] 「뒤다트분이나 이세분을 뺀 어깨 길이가 같은지 확인」 — 봉제 짝
     0.05 는 못 맞춘다(작도가 다르다). 이세로 먹을 수 있는 0.3 을 상한으로 둔다. */
  if (finiteOr(bad, '[23] 어깨 짝', M.shoulderGap)) {
    if (Math.abs(M.shoulderGap) > 0.30)
      bad.push('[23] 어깨 짝 ' + M.shoulderBackSewn.toFixed(3) + ' vs ' + M.shoulderFront.toFixed(3) +
               ' — 차 ' + M.shoulderGap.toFixed(3) + ' (이세로 먹기엔 크다)');
    else if (Math.abs(M.shoulderGap) > 0.05)
      soft.push('[23] 어깨 짝 차 ' + M.shoulderGap.toFixed(3) + ' — 뒤가 길다(이세로 넣는다)');
  }

  /* [13] 「27번점에서 0.5~1 정도 떨어지게」 — 뒤 암홀 */
  var d27 = nearest(g.bArm, g.p27);
  if (finiteOr(bad, '[13] 암홀↔27', d27) && (d27 < 0.5 - 0.02 || d27 > 1.0 + 0.02))
    bad.push('[13] 뒤 암홀↔27 ' + d27.toFixed(3) + ' (원문 0.5~1)');

  /* [25] 「49번 앞품에서 0.5cm 정도 떨어지게」 — 앞 암홀 */
  var d49 = nearest(g.fArm, g.f49);
  if (finiteOr(bad, '[25] 암홀↔49', d49) && Math.abs(d49 - 0.5) > 0.15)
    bad.push('[25] 앞 암홀↔49 ' + d49.toFixed(3) + ' (원문 0.5)');

  /* [28] 「69번점 위로 올라가면 안 된다」 — 앞 절개선 시작 */
  if (finiteOr(bad, '[28] 67', g.f67[1]) && g.f67[1] < g.f69[1] - 1e-6)
    bad.push('[28] 앞 절개선 시작 67 y=' + g.f67[1].toFixed(2) + ' 이 69 y=' + g.f69[1].toFixed(2) + ' 위로 올라갔다');

  /* [16] 「27번점 위로 올라가서 그리면 안 된다」 — 뒤 절개선 시작 */
  if (finiteOr(bad, '[16] 절개시작', g.p27a[1]) && g.p27a[1] < g.p27[1] - 1e-6)
    bad.push('[16] 뒤 절개선 시작이 27 위로 올라갔다');

  /* 뒤 ≥ 앞 — 원문 0. 「뒤품이 앞품보다 1.5 정도 많은 것이 정상」의 귀결 */
  if (finiteOr(bad, 'AH', M.ahBack) && M.ahBack < M.ahFront)
    bad.push('뒤 AH ' + M.ahBack.toFixed(2) + ' < 앞 AH ' + M.ahFront.toFixed(2) + ' — 뒤가 커야 한다');

  row(sz, bad, soft,
    '2~21 ' + f(d221, 6) + ' · 어깨 뒤(다트뺀) ' + f(M.shoulderBackSewn, 6) + ' 앞 ' + f(M.shoulderFront, 6) +
    ' 차 ' + f(M.shoulderGap, 6, 3) + ' · AH 뒤 ' + f(M.ahBack, 6) + ' 앞 ' + f(M.ahFront, 6) +
    ' · 암홀↔27 ' + f(d27, 5) + ' ↔49 ' + f(d49, 5));
});

/* ══════════════════════════════════════════════════════════════════════
 * §2. 번호점 좌표 — 원문 **식** 그대로인가 (전 호수 · 리터럴 기대값)
 * ════════════════════════════════════════════════════════════════════ */
head('2. 번호점 좌표 — 원문 식 그대로인가 (뒤 22점 · 앞 14점)');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m), bad = [], soft = [];
  var B = m.B, uB = m['유B'], W = m.W, H = m.H, cb = g.cbIn, BL = g.BL, WL = g.WL, HL = g.HL;
  var yc = g['유차'], sh = m.shoulderW, bw = m.backW, fw = m.frontW;
  /* [번호, 실제, 기대, 원문] — 기대값은 **식을 다시 쓴 것**이지 K 사본이 아니다 */
  var T = [
    ['[2] 4',   g.p4,  [0, B / 4 + K.armDepthAdd],       '2에서 B/4+1.5'],
    ['[3] 5',   g.p5,  [0, m.backLen],                   '2에서 등길이'],
    ['[4] 3',   g.p3,  [0, m.backLen + m.hipLen],        '5에서 엉덩이길이'],
    ['[5] 6',   g.p6,  [0, BL / 3],                      '2~4 의 3등분'],
    ['[5] 7',   g.p7,  [cb, BL],                         '4에서 1.5'],
    ['[5] 8',   g.p8,  [cb, WL],                         '5에서 1.5'],
    ['[5] 9',   g.p9,  [cb, HL],                         '3에서 1.5'],
    ['[7] 10',  g.p10, [cb / 2, BL],                     '4~7 의 2등분'],
    ['[7] 11',  g.p11, [cb / 2 + bw / 2, BL],            '10에서 등품/2'],
    ['[7] 12',  g.p12, [cb / 2 + bw / 2, 0],             '11에서 직선으로 올려'],
    ['[7] 13',  g.p13, [cb / 2 + uB / 4 + K.chestEase, BL], '10에서 유B/4+1.5~2'],
    ['[7] 14',  g.p14, [cb / 2 + uB / 4 + K.chestEase, HL], '13에서 직선으로 내려'],
    ['[8] 15',  g.p15, [cb + H / 4, HL],                 '9에서 H/4'],
    ['[8] 16',  g.p16, [cb + H / 4 + K.hipEase, HL],     '15에서 여유 1.5'],
    ['[9] 17',  g.p17, [cb + W / 4, WL],                 '8에서 W/4'],
    ['[9] 18',  g.p18, [cb + W / 4 + K.waistEase, WL],   '17에서 여유 1.5~2'],
    ['[9] 19',  g.p19, [cb + W / 4 + K.waistEase + K.backDart, WL], '18에서 다트분 2~2.5'],
    ['[10] 20', g.p20, [sh / 2, 0],                      '2에서 어깨/2'],
    ['[10] 21', g.p21, [sh / 2 + K.shDart, 0],           '20에서 다트 1.5'],
    ['[10] 22', g.p22, [cb / 2 + bw / 2, K.shSlope],     '12에서 어깨기울기 1.3~1.5'],
    ['[11] 23', g.p23, [B / 12, 0],                      '2에서 B/12'],
    ['[11] 24', g.p24, [B / 12, -yc],                    '23에서 유차 올라간 곳'],
    ['[12] 26', g.p26, [sh / 2 + K.shDart, K.shScoop],   '21에서 1.5 (어깨를 판다)'],
    ['[13] 27', g.p27, [cb / 2 + bw / 2, (K.shSlope + BL) / 2], '22~11 의 2등분'],
    ['[14] 28', g.p28, [cb / 2 + bw / 2 - K.splitIn, BL], '11에서 2~3 안쪽'],
    ['[14] 29', g.p29, [cb / 2 + bw / 2 - K.splitIn, HL], '28에서 직선으로 내려'],
    ['[14] 30', g.p30, [cb / 2 + bw / 2 - K.splitIn, HL - K.hemUp], '29에서 5'],
    ['[18] 37', g.p37, [B / 12 / 3, 0],                  '2~23 의 3등분'],
    ['[18] 38', g.p38, [B / 12 + K.neckOut, -yc],        '24에서 1.5 나간 곳'],
    /* ── 앞판 ── */
    ['[20] 41', g.f41, [g.p13[0], BL - yc],              '13에서 유차 올라간 곳'],
    ['[20] 42', g.f42, [g.p13[0], HL],                   '41에서 직각으로 내린 곳'],
    ['[20] 43', g.f43, [0, BL - yc],                     '41 높이의 앞중심'],
    ['[20] 44', g.f44, [0, -yc],                         '2에서 유차 올라간 곳'],
    ['[21] 46', g.f46, [fw / 2, BL - yc],                '43에서 앞품/2'],
    ['[21] 47', g.f47, [fw / 2, -yc],                    '46에서 직선으로 올린 곳(45선)'],
    ['[21] 48', g.f48, [fw / 2, -yc + K.frontShDrop],    '47 아래로 4.5'],
    ['[21] 49', g.f49, [fw / 2, (BL - yc) - (BL - yc - (-yc)) / 3], '46~47 의 3등분'],
    ['[22] 50', g.f50, [B / 12, -yc],                    '23에서 직선으로 올린 곳'],
    ['[22] 51', g.f51, [B / 12, -yc + K.fNeckDrop],      '50에서 1 내려온 곳'],
    ['[23] 52', g.f52, [sh / 2, K.fShScoop],             '20에서 1.5 내려온 곳'],
    ['[23] 53', g.f53, [B / 12 + K.fNeckOut, -yc + K.fNeckDrop], '51에서 1.5 나간 곳'],
    ['[24] 54', g.f54, [W / 4, WL],                      '5에서 W/4'],
    ['[24] 55', g.f55, [W / 4 + K.waistEase, WL],        '54에서 여유 1.5~2'],
    ['[26] 57', g.f57, [m.bustW / 2, m.bustLen],         'BP = (유폭/2, 유장)'],
    ['[26] 58', g.f58, [m.bustW / 2 + K.bpOut, m.bustLen], '57에서 1.5~2'],
    ['[38] 70', g.f70, [0, HL + K.frontDrop],            '3에서 앞처짐 2.5'],
    ['[38] 71', g.f71, [-K.frontWrap, HL + K.frontDrop], '70에서 앞여밈분'],
    ['[38] 72', g.f72, [-K.frontWrap, BL - yc],          '71에서 위로 (앞목선과 만난다)']
  ];
  var worst = 0, worstName = '';
  T.forEach(function (r) {
    if (!r[1] || !isFinite(r[1][0]) || !isFinite(r[1][1])) { bad.push(r[0] + ' 가 없다/NaN'); return; }
    var e = Math.max(Math.abs(r[1][0] - r[2][0]), Math.abs(r[1][1] - r[2][1]));
    if (e > worst) { worst = e; worstName = r[0]; }
    if (e > 0.001) bad.push(r[0] + ' (' + r[1][0].toFixed(3) + ',' + r[1][1].toFixed(3) + ') ≠ ' +
      '(' + r[2][0].toFixed(3) + ',' + r[2][1].toFixed(3) + ')  ← ' + r[3]);
  });
  row(sz, bad, soft, '번호점 ' + T.length + '개 · 최대 오차 ' + f(worst, 7, 4) + (worstName ? ' (' + worstName + ')' : ''));
});

/* ══════════════════════════════════════════════════════════════════════
 * §3. 곡선이 끝점에서 실제로 만나는가 — 조각이 닫히는가
 *     ★ 여기가 2026-08-14 QA 에서 가장 크게 터진 자리다. 원피스에서 복제한
 *       검산기는 이걸 아예 안 봤고, 뒤판은 암홀 끝(11)과 옆선 시작(13)이
 *       6.25cm, 앞판은 앞목과 앞중심이 15.63cm 벌어진 채로 통과했다.
 * ════════════════════════════════════════════════════════════════════ */
head('3. 조각 닫힘 — 변과 변이 실제로 만나는가 (통짜 2조각 · 절개 4조각)');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), bad = [], soft = [], worst = 0;
  [0, 1].forEach(function (sp) {
    var d = E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: sp });
    d.pieces.forEach(function (p) {
      var n = p.edges.length;
      for (var i = 0; i < n; i++) {
        var a = p.outline[p.edges[i].end], b = p.outline[p.edges[(i + 1) % n].start];
        var gp = V.dist(a, b);
        if (gp > worst) worst = gp;
        /* FLATTEN(0.04) 의 2배까지는 샘플 간격이다. 그 이상은 진짜 구멍이다. */
        if (gp > E.FLATTEN * 2)
          bad.push('sp' + sp + ' ' + p.id + ' 「' + p.edges[i].name + '」→「' +
                   p.edges[(i + 1) % n].name + '」 ' + gp.toFixed(3) + 'cm 벌어짐');
        /* 길이 0 인 변 = 거짓말하는 변 (예전 절개 조각의 어깨선이 그랬다) */
        if (p.edges[i].end <= p.edges[i].start)
          bad.push('sp' + sp + ' ' + p.id + ' 「' + p.edges[i].name + '」 가 길이 0 이다');
      }
      /* 골선이 없으면 **좌우 두 장**을 재단해야 한다.
         조끼 뒤중심은 6~8 이 굽은 등솔선이라 접을 수 없다(골선 아님) — 그런데
         예전에는 cutCount 1 로 나가 재단하면 뒤판 반쪽만 생겼다 (2026-08-14 QA). */
      if (p.foldEdges.length === 0 && p.cutCount < 2)
        bad.push('sp' + sp + ' ' + p.id + ' 골선이 없는데 재단 ' + p.cutCount + '장 — 좌우 2장이라야 한다');
      p.outline.forEach(function (q) {
        if (!isFinite(q[0]) || !isFinite(q[1])) bad.push('sp' + sp + ' ' + p.id + ' outline 에 NaN');
      });
      p.seamline.forEach(function (q) {
        if (!isFinite(q[0]) || !isFinite(q[1])) bad.push('sp' + sp + ' ' + p.id + ' seamline 에 NaN');
      });
    });
  });
  row(sz, bad, soft, '최대 틈 ' + f(worst, 7, 4) + 'cm');
});

/* ══════════════════════════════════════════════════════════════════════
 * §4. 봉제 짝 — 맞물리는 변의 길이가 같은가
 * ════════════════════════════════════════════════════════════════════ */
head('4. 봉제 짝 — 맞물리는 변의 길이 (옆선 · 절개선 · 어깨)');
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), d = E.draftVest(m, { seam: E.SEAM_DEFAULT }), M = d.measures;
  var bad = [], soft = [];

  /* 절개선 두 변 — 이세로 볼 수 있는 범위 */
  [['뒤', M.splitBackIn, M.splitBackOut], ['앞', M.splitFrontIn, M.splitFrontOut]].forEach(function (r) {
    var dd = r[1] - r[2];
    if (!finiteOr(bad, r[0] + ' 절개선', dd)) return;
    if (Math.abs(dd) > 0.6) bad.push(r[0] + ' 절개선 두 변 차 ' + dd.toFixed(3) + ' — 이세로 보기엔 크다');
  });

  /* 옆선 — **아직 못 고친 자리.** 유차만큼 어긋나는 것은 원문 구조 그대로이고,
     그 이상 어긋나면 작도가 깨진 것이다. 유차 ±0.1 밖으로 나가면 실패. */
  if (finiteOr(bad, '옆선 차', M.sideGap)) {
    if (Math.abs(M.sideGap - M['유차']) > 0.1)
      bad.push('옆선 차 ' + M.sideGap.toFixed(3) + ' 가 유차 ' + M['유차'] +
               ' 와 다르다 — 유차 말고 다른 이유로 어긋났다는 뜻이다');
    else
      soft.push('옆선 차 ' + M.sideGap.toFixed(3) + ' = 유차 ' + M['유차'] +
                ' — 원문 [27] 이 열어 둔 앞 다트를 아직 안 넣었다 (이어서-할-일.md)');
  }

  /* 엔진이 스스로 낸 경고는 반드시 화면에 나와야 한다 */
  d.warnings.forEach(function (w) { if (soft.indexOf(w) < 0) soft.push('엔진 경고: ' + w); });

  row(sz, bad, soft,
    '옆선 뒤 ' + f(M.sideBack, 6) + ' 앞 ' + f(M.sideFront, 6) + ' 차 ' + f(M.sideGap, 6, 3) +
    ' · 절개선 뒤 ' + f(M.splitBackIn, 6) + '/' + f(M.splitBackOut, 6) +
    ' 앞 ' + f(M.splitFrontIn, 6) + '/' + f(M.splitFrontOut, 6));
});

/* ══════════════════════════════════════════════════════════════════════
 * §5. 완성 치수 · 그레이딩 — 전 호수 단조 증가
 * ════════════════════════════════════════════════════════════════════ */
head('5. 완성 치수와 그레이딩 (실측 상수가 섞이면 여기서 무너진다)');
var prev = null;
SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), d = E.draftVest(m, { seam: E.SEAM_DEFAULT }), M = d.measures;
  var bad = [], soft = [];
  [['가슴', M.chestFinish, m['유B']], ['허리', M.waistFinish, m.W], ['엉덩이', M.hipFinish, m.H]].forEach(function (r) {
    if (!finiteOr(bad, '완성 ' + r[0], r[1])) return;
    if (r[1] <= r[2]) bad.push('완성 ' + r[0] + ' ' + r[1] + ' ≤ 치수 ' + r[2] + ' (여유가 없다)');
    if (r[1] > r[2] + 12) bad.push('완성 ' + r[0] + ' ' + r[1] + ' 이 치수 ' + r[2] + ' 보다 12 이상 크다');
  });
  /* 허리 여유는 앞뒤가 같은 식이라야 한다 — 앞 다트를 남는 양으로 잡았는지의 검사 */
  var wantW = m.W + 4 * K.waistEase;
  if (finiteOr(bad, '완성 허리', M.waistFinish) && Math.abs(M.waistFinish - wantW) > 0.02)
    bad.push('완성 허리 ' + M.waistFinish + ' ≠ W + 여유×4 = ' + wantW.toFixed(2) +
             ' — 앞 다트를 「남는 양」으로 안 잡았다는 뜻이다');
  if (prev) {
    ['ahBack', 'ahFront', 'shoulderBack', 'shoulderFront', 'chestFinish', 'waistFinish', 'hipFinish'].forEach(function (k) {
      if (M[k] <= prev.M[k])
        bad.push('그레이딩: ' + k + ' 가 ' + prev.sz + ' ' + prev.M[k] + ' → ' + sz + ' ' + M[k] + ' 로 안 커진다');
    });
  }
  prev = { sz: sz, M: M };
  row(sz, bad, soft, '가슴 ' + f(M.chestFinish, 6) + ' 허리 ' + f(M.waistFinish, 6) +
    ' 엉덩이 ' + f(M.hipFinish, 6) + ' · 다트 뒤 ' + f(M.backDart, 5) + ' 앞 ' + f(M.frontDart, 5));
});

/* ══════════════════════════════════════════════════════════════════════
 * §6. UI 계약 — 화면에 있는 입력란이 실제로 동작하는가
 *     ★ 「UI/엔진 목록 불일치」는 이 프로젝트에서 반복해서 터진 결함이다.
 *       엔진이 안 읽는 opt 키를 UI 가 슬라이더로 내걸면 그건 거짓말이다.
 * ════════════════════════════════════════════════════════════════════ */
head('6. UI 계약 — ui.js 의 STYLE_KEYS 가 엔진이 실제로 읽는 키인가');
(function () {
  var fs = require('fs'), path = require('path');
  var uiSrc, engSrc, bad = [], soft = [];
  try {
    uiSrc = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
    engSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  } catch (e) { console.log('  ⚠ ui.js/engine.js 를 못 읽었다 — 건너뛴다'); warns++; return; }

  var block = uiSrc.match(/var STYLE_KEYS\s*=\s*\[([\s\S]*?)\n\s*\];/);
  if (!block) { console.log('  ⚠ ui.js 에서 STYLE_KEYS 를 못 찾았다'); warns++; return; }
  var keys = [], mm, re = /\{\s*k:\s*'([^']+)'/g;
  while ((mm = re.exec(block[1]))) keys.push(mm[1]);

  /* 엔진이 실제로 읽는 opt 키 = `num(opt.xxx, …)` 또는 `opt.xxx` */
  var readable = {}, re2 = /num\(opt\.([A-Za-z0-9_]+)/g;
  while ((mm = re2.exec(engSrc))) readable[mm[1]] = 1;
  ['splitPanels', 'seam', 'bustDiff'].forEach(function (k) { readable[k] = 1; });
  E.MEAS_KEYS.forEach(function (k) { readable[k] = 1; });

  keys.forEach(function (k) {
    if (!readable[k]) bad.push('ui.js STYLE_KEYS 의 「' + k + '」 를 엔진이 안 읽는다 (입력란이 무동작)');
  });
  /* 소매가 UI 에 남아 있으면 안 된다 — 조끼에는 소매가 없다.
     주석에 적힌 낱말이 아니라 **실제로 읽고 쓰는 자리**만 본다. */
  if (/(state|els|opt)\.sleeveType|\$\('ndSleeveType'\)/.test(uiSrc))
    bad.push('ui.js 가 sleeveType 을 읽거나 쓴다 — 조끼는 소매가 없다');
  var uiHtml = '';
  try { uiHtml = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8'); } catch (e) { }
  if (/ndSleeveType/.test(uiHtml)) bad.push('ui.html 에 「소매 종류」 선택 상자가 남아 있다');

  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + 'STYLE_KEYS ' + keys.length + '개 · 엔진이 읽는 키 ' +
    Object.keys(readable).length + '개' + (bad.length ? '\n      ✗ ' + bad.join('\n      ✗ ') : ''));
})();

/* ══════════════════════════════════════════════════════════════════════ */
console.log('\n════════════════════════════════════════════════════════════');
console.log(fails ? ' ✗ 실패 ' + fails + '건 · 경고 ' + warns + '건'
                  : ' ✓ 전부 통과 (경고 ' + warns + '건)');
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
