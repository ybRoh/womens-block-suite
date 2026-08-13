/* ============================================================================
 * engine-verify.js — 바 재킷(더블) 검산
 *
 *   제도법: 백영례 「테일러 자켓 패턴」 번호점 제도법
 *           (docs/테일러드재킷-제도법-백영례.md)
 *
 *   ★ 이 모듈에는 **DXF 정답지가 없다.** 참고자료인 sisterMAG Barjacke 도면은
 *     Größe 36 **한 호수뿐**이라, 좌표를 대조하면 그 호수만 맞는 엔진이 된다.
 *     실제로 예전 판이 그 함정에 빠져 절개선 곡률 부호를 끝내 못 잡았다.
 *
 *   그래서 여기서 보는 것은 **제도법 자신이 시키는 확인 절차**다.
 *   교재는 「잘라 둔 뒤판을 대고 확인하라」([23]) 처럼 곳곳에서 확인을 시킨다 —
 *   그 확인이 곧 검사다. 도면은 §4 에서 **참고(soft)** 로만 본다.
 *
 *   조각 품질(폐곡선·점 간격·너치·시접·제도선·전 호수 단조성)은 루트의
 *   `suite-verify.js` 가 전 모듈에 건다. 여기서 겹쳐 검사하지 않는다.
 *
 *   실행: node engine-verify.js     (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');
var E = require('./engine.js'), U = E.util, V = U.V, K = E.K;
var GT = JSON.parse(fs.readFileSync(path.join(__dirname, 'barjacke-36-groundtruth.json'), 'utf8'));

var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 2 : d); while (s.length < w) s = ' ' + s; return s; }
function ok(name, pass, detail, soft) {
  if (!pass) { if (soft) warns++; else fails++; }
  console.log('  ' + (pass ? '✓ ' : soft ? '⚠ ' : '✗ ') + pad(name, 24) + detail);
}
/** 조각의 변 하나를 outline 에서 **실측**한다 (제도식 값을 믿지 않는다) */
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

/* ══ 1. 봉제 짝 — 전 호수 ═════════════════════════════════════════════ */
console.log('════════════════════════════════════════════════════════════');
console.log(' 1. 봉제 짝 — 맞물리는 변이 같은 길이인가 (전 호수)');
console.log('════════════════════════════════════════════════════════════');
console.log('   짝이 안 맞으면 옷이 안 된다. 정답지가 없어도 이건 검사할 수 있다.');
console.log('   앞 옆선은 가슴다트 입(별도 변)을 빼고 위·아래 도막만 잰다.');
var PAIRS = [
  ['앞 절개선', 'front', '절개선', 'frontSide', '절개선', 0.30],
  ['뒤 절개선', 'back',  '절개선', 'backSide',  '절개선', 0.30],
  ['옆선',     'frontSide', ['옆선 (위)', '옆선 (아래)'], 'backSide', '옆선', 0.40],
  /* 2장소매 두 절개선은 서로 꿰매는 짝이다. 원형2 에서 몫을 이분법으로 풀어
     전 호수 0.000 으로 맞춘 판을 가져왔으므로 허용을 좁게 건다. */
  ['소매 절개선', 'sleeveBig', '뒤 절개선', 'sleeveUnder', '절개선', 0.15],
  /* 안단은 몸판에서 떠낸 조각이다 — 바깥 변이 몸판과 **같은 선**이라야 겹친다.
     ⚠ 허용 0.06 은 폴리라인 눈금(FLATTEN 0.04) 때문이다 — 변 구간이 공유 모서리
       점을 앞 변에 넘기므로 실측이 한 칸만큼 짧게 나올 수 있다. */
  ['안단 고지선',  'front', '고지선', 'frontFacing', '고지선', 0.06],
  ['안단 라펠선',  'front', '라펠선', 'frontFacing', '라펠선', 0.06],
  ['안단 라펠 윗변', 'front', '라펠 윗변', 'frontFacing', '라펠 윗변', 0.06],
  ['뒤 안단 뒷목', 'back',  '뒷목둘레', 'backFacing', '뒷목둘레', 0.06],
  /* 안감도 서로 꿰맨다 — 겉감과 같은 짝이 안감에도 있어야 한다 */
  ['안감 앞 절개선', 'frontLining', '절개선', 'frontSideLining', '절개선', 0.30],
  ['안감 뒤 절개선', 'backLining', '절개선', 'backSideLining', '절개선', 0.30],
  ['안감 옆선', 'frontSideLining', ['옆선 (위)', '옆선 (아래)'], 'backSideLining', '옆선', 0.40],
  ['안감 소매 절개선', 'sleeveBigLining', '뒤 절개선', 'sleeveUnderLining', '절개선', 0.15]
];
E.SIZES.forEach(function (sz) {
  var d = E.draftJacket(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT }), bad = [], row = [];
  PAIRS.forEach(function (w) {
    var a = edgeLen(d, w[1], w[2]), b = edgeLen(d, w[3], w[4]);
    if (a === null || b === null) { bad.push(w[0] + ' 변 없음'); return; }
    row.push(w[0] + ' ' + f(a, 6) + '/' + f(b, 6));
    if (Math.abs(a - b) > w[5]) bad.push(w[0] + ' 차 ' + (a - b).toFixed(3));
  });
  /* ★ 카라 목붙임선 ↔ 몸판 목둘레(뒤판 뒷목둘레 + 앞판 고지선).
     짝이 **두 조각에 걸쳐** 있어 위 PAIRS 표로는 못 잰다 — 그래서 예전 판은
     이 짝을 아예 안 보고 있었고, 카라 바깥선이 목붙임선보다 2.1 **짧은** 채로
     통과했다(= 목을 조이는 선 카라). 길이와 「눕는가」를 같이 본다. */
  var cN = edgeLen(d, 'collar', '목붙임선'), cO = edgeLen(d, 'collar', '카라 윗선');
  var bodyN = edgeLen(d, 'back', '뒷목둘레') + edgeLen(d, 'front', '고지선');
  row.push('카라 목붙임 ' + f(cN, 6) + '/' + f(bodyN, 6) + ' 바깥 ' + f(cO, 6));
  if (Math.abs(cN - bodyN) > 0.10) bad.push('카라 목붙임선 차 ' + (cN - bodyN).toFixed(3));
  /* 꺾여 내려온 폭은 목보다 굵은 자리에 가 닿는다 — 바깥선이 더 길어야 눕는다.
     너무 길면(1.35 배 넘게) 피터팬처럼 퍼져 재킷 카라가 안 된다. */
  if (cO <= cN + 0.5)
    bad.push('카라 바깥선 ' + cO.toFixed(2) + ' 이 목붙임선 ' + cN.toFixed(2) + ' 보다 안 길다 — 안 눕는다');
  else if (cO / cN > 1.35)
    bad.push('카라 바깥선/목붙임선 ' + (cO / cN).toFixed(3) + ' — 너무 퍼졌다 (1.35 이하)');
  if (d.pieces.length !== 17) bad.push('조각 ' + d.pieces.length + '장 (17 이라야 한다)');
  if (d.warnings.length) bad.push('엔진 경고 ' + d.warnings.join(' · '));
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) + row.join(' · ') +
    (bad.length ? '\n      → ' + bad.join(' · ') : ''));
});

/* ══ 2. 제도법이 시키는 확인 — 전 호수 ═══════════════════════════════
   교재의 「확인하라」를 그대로 옮긴 것이다. 번호는 원문 단계.               */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 2. 제도법 확인 절차 — 교재가 시키는 확인을 그대로 (전 호수)');
console.log('════════════════════════════════════════════════════════════');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz);
  var g = E.geom(m), d = E.draftJacket(m, { seam: E.SEAM_DEFAULT }), M = d.measures, bad = [];
  function chk(cond, msg) { if (!cond) bad.push(msg); }
  var dif = g.bustDiff;
  /* [2] 진동깊이 = B/4 + 1.5 */
  chk(Math.abs(g.BL - (m.B / 4 + K.armDepthAdd)) < 1e-6, '[2] 진동깊이 ≠ B/4 + 1.5');
  /* [7] 등품점 = 4~7 2등분 + 등품/2 · 겨드랑 = + 유B/4 + 1.5~2 */
  chk(Math.abs(g.bPitchX - (K.cbIn / 2 + m.backW / 2)) < 1e-6, '[7] 11번(등품점) 식이 안 맞는다');
  chk(Math.abs(g.Ub[0] - (K.cbIn / 2 + m.bustB / 4 + K.underarmAdd)) < 1e-6, '[7] 13번(겨드랑) 식이 안 맞는다');
  /* [9] 18~19 = W 다트분 — 남는 양이 다트다. 0 이거나 6 을 넘으면 배분이 깨진 것 */
  chk(g.bDart > 0.8 && g.bDart < 6.0, '[9] 뒤 다트분 ' + g.bDart.toFixed(2) + ' 이 범위 밖');
  chk(g.fDart > 0.8 && g.fDart < 6.0, '[27] 앞 다트분 ' + g.fDart.toFixed(2) + ' 이 범위 밖');
  /* [11] 뒤 목너비 = B/12 · 목옆점은 유차만큼 올라간다 · [18] 옆목 1.5 파기 */
  chk(Math.abs(g.SNPb[0] - (m.B / 12 + K.neckOut)) < 1e-6, '[11][18] 뒤 목옆점 x 식이 안 맞는다');
  chk(Math.abs(g.SNPb[1] + dif) < 1e-6, '[11] 뒤 목옆점이 유차만큼 안 올라갔다');
  /* [23] 앞 목너비 = B/12 + 앞 옆목 파기 (도면 7.15 = 6.8 + 0.35) */
  chk(Math.abs(g.SNPf[0] - (m.B / 12 + K.frontNeckOut)) < 1e-6, '[23] 앞 목옆점 x 식이 안 맞는다');
  /* [12] 2~21 = 어깨/2 + 다트분 · + **어깨 늘림(패드분)** — 재킷 어깨는 몸보다 넓다(도면) */
  chk(Math.abs(g.SPb[0] - (m.shoulderW / 2 + K.shoulderAdd + g.shExtra)) < 1e-6,
      '[12] 21번(어깨점 x) 식이 안 맞는다');
  /* [23] 잘라 둔 뒤판을 대고 — 다트분을 뺀 어깨 길이가 앞뒤 같아야 한다 */
  chk(Math.abs((g.shLenBack - g.shExtra) - g.shLenFront) < 0.02,
      '[23] 어깨 짝 ' + (g.shLenBack - g.shExtra).toFixed(3) + ' ↔ ' + g.shLenFront.toFixed(3));
  /* [23] 52번 — 앞 어깨점이 어깨너비/2 자리 부근. 재킷은 **패드분만큼 밖**이 정상이다 */
  chk(Math.abs(g.SPf[0] - (m.shoulderW / 2 + K.shoulderAdd)) <= 1.5,
      '[23] 52번 앞 어깨점 x ' + g.SPf[0].toFixed(2) + ' vs 어깨/2 + 패드분 ' +
      (m.shoulderW / 2 + K.shoulderAdd).toFixed(2));
  /* [20] 유차 — 앞 옆선이 뒤보다 정확히 유차만큼 길게 제도된다 (다트 닫기 전) */
  var rawFront = U.sLen(g.fSideFull), rawBack = U.sLen(g.backSide);
  chk(Math.abs((rawFront - rawBack) - dif) < 0.35,
      '[20] 앞 옆선 − 뒤 옆선 = ' + (rawFront - rawBack).toFixed(2) + ' (유차 ' + dif + ' 라야 한다)');
  /* [27b] 가슴다트분 = 유차 — 접으면 앞뒤 옆선이 같아진다 */
  chk(Math.abs(M.bustDart - dif) < 0.25,
      '[27b] 가슴다트 ' + M.bustDart.toFixed(2) + ' ≠ 유차 ' + dif);
  /* [26] BP — 앞중심에서 유폭/2 · 옆목점(51번)에서 유장 */
  chk(Math.abs(g.BP[0] - m.bpSpan / 2) < 1e-6, '[26] BP x ≠ 유폭/2');
  chk(Math.abs(V.dist(g.SNPf0, g.BP) - m.bpLen) < 0.02, '[26] 옆목점 → BP 가 유장이 아니다');
  /* [16] 뒤 절개는 26번 위로 · [28] 앞 절개는 69번 위로 올라가면 안 된다 */
  chk(g.bCutP[1] >= g.bArmTan[1] - 0.05, '[16] 뒤 절개 시작이 26번보다 위');
  /* [28] 은 **암홀 출발**일 때의 규칙이다. 도면 구성(어깨 출발)에서는 해당 없고,
     대신 절개 시작점이 어깨선 위에 제대로 얹혀 있는지를 본다. */
  if (!g.fCutShoulder) {
    chk(g.fCutP[1] >= g.p69[1] - 0.05, '[28] 앞 절개 시작이 69번보다 위');
  } else {
    var shL = V.dist(g.SNPf, g.SPf), cutL = V.dist(g.SNPf, g.fCutP);
    chk(cutL > shL * 0.25 && cutL < shL * 0.9,
        '앞 절개 시작이 어깨선 위 ' + cutL.toFixed(2) + ' / 어깨 ' + shL.toFixed(2));
    /* 절개점이 어깨선 **위**에 있어야 한다 (두 조각의 어깨가 이어진다) */
    var d0 = V.dist(g.SNPf, g.fCutP) + V.dist(g.fCutP, g.SPf);
    chk(Math.abs(d0 - shL) < 0.01, '앞 절개 시작이 어깨선에서 벗어났다');
  }
  /* [40] 꺾임 시작(75번)은 W 선 위로 2.5 이상 */
  chk(g.WLf - g.btnTopY >= 2.5, '[40] 꺾임 시작이 허리에서 ' + (g.WLf - g.btnTopY).toFixed(2) + ' 위');
  /* [42] 위카라(80번)가 꺾임선 안으로 들어가면 안 된다 = 카라넓이 > 스탠드 */
  chk(K.collarW - K.collarStand >= 1.0, '[42] 카라넓이 − 스탠드 < 1.0');
  /* 소매 — 소매산 이세를 **앞뒤 각각** 본다. 총합만 보면 배분이 틀려도 안 드러난다 */
  chk(M.capEaseFront >= 0.2 && M.capEaseFront <= 3.5, '앞 소매산 이세 ' + M.capEaseFront);
  chk(M.capEaseBack  >= 0.2 && M.capEaseBack  <= 4.0, '뒤 소매산 이세 ' + M.capEaseBack);
  chk(M.sleeveLen > 40 && M.sleeveLen < 80, '소매길이 ' + M.sleeveLen);
  /* 밑단 트임 — **직선 구간(허리 아래)** 에 있어야 접힌다. 굽은 자리면 못 접는다 */
  (function () {
    var bp = d.pieces.filter(function (x) { return x.id === 'back'; })[0];
    var ve = (bp.edges || []).filter(function (e) { return e.name === '트임'; })[0];
    if (K.bodyVentLen > 0.05) {
      chk(!!ve, '뒤판에 트임 변이 없다');
      chk(g.hemY - K.bodyVentLen > g.WLb, '트임 끝이 허리선 위 — 굽은 구간이라 접히지 않는다');
      if (ve) {
        var vl = 0;
        for (var i = ve.start + 1; i <= ve.end; i++) vl += V.dist(bp.outline[i - 1], bp.outline[i]);
        chk(Math.abs(vl - K.bodyVentLen) < 0.6, '트임 길이 ' + vl.toFixed(2) + ' ≠ ' + K.bodyVentLen);
      }
    }
  })();
  /* 완성 치수 — 테일러드 재킷의 적정 여유 */
  chk(M.chestEase >= 10 && M.chestEase <= 14, '완성 가슴 여유 ' + M.chestEase + ' (10~14)');
  chk(M.waistEase >= 4 && M.waistEase <= 11, '완성 허리 여유 ' + M.waistEase + ' (4~11)');
  chk(M.hipEase >= 3 && M.hipEase <= 11, '완성 엉덩이 여유 ' + M.hipEase + ' (3~11)');
  if (bad.length) fails++;
  console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
    '유차 ' + f(dif, 4) + ' · 다트 뒤/앞 ' + f(g.bDart, 5) + '/' + f(g.fDart, 5) +
    ' · 어깨 ' + f(g.shLenBack - g.shExtra, 6) + ' · 여유 가슴 ' + f(M.chestEase, 5) +
    ' 허리 ' + f(M.waistEase, 5) + ' 엉덩이 ' + f(M.hipEase, 5) +
    (bad.length ? '\n      → ' + bad.join('\n      → ') : ''));
});

/* ══ 3. 조각 형태 — 절개선이 반대로 휘지 않았나 · 자기교차 ══════════════
   ⚠ 예전에는 QA 를 코드만 돌려 놓고 도면과 출력물을 안 맞춰 봐서 형태 오류를
   매번 사람이 눈으로 잡았다. 눈으로 보던 것을 수치로 만든다.               */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 3. 조각 형태 — 절개선 곡률 부호 · 자기교차 (사람 눈 대신 수치로)');
console.log('════════════════════════════════════════════════════════════');
(function () {
  /** 현에서 벗어난 양의 프로파일 (위 → 아래 방향, 8구간) */
  function prof(segs) {
    var p = U.sampleSegs(segs, 0.05);
    if (p[0][1] > p[p.length - 1][1]) p = p.slice().reverse();
    var a = p[0], b = p[p.length - 1], ux = b[0] - a[0], uy = b[1] - a[1];
    var ch = Math.hypot(ux, uy) || 1; ux /= ch; uy /= ch;
    var tot = U.polyLen(p), acc = 0, k = 0, res = [];
    for (var i = 1; i < p.length; i++) {
      acc += V.dist(p[i - 1], p[i]);
      while (k < 9 && acc / tot >= k / 8) {
        var q = p[i]; res.push(-(q[0] - a[0]) * uy + (q[1] - a[1]) * ux); k++;
      }
    }
    while (res.length < 9) res.push(0);
    return res;
  }
  E.SIZES.forEach(function (sz) {
    var m = E.measuresForSize(sz);
    var d = E.draftJacket(m, { seam: E.SEAM_DEFAULT }), g = E.geom(m), bad = [];
    /* ① 곡률 **뒤집힘 횟수**. 한 번은 정상이다 — 절개선은 가슴선에서 안으로
         들어갔다가 허리에서 다트분만큼 벌어지고, 밑단에서 다시 교차한다(29번).
         옆선도 허리에서 잘록했다 밑단에서 나간다. **두 번 이상** 뒤집히면
         스플라인이 뱀처럼 휜 것이다 (6차에서 앵커를 늘리다 65 → 79cm 가 됐다). */
    [['앞 절개선', g.fPrinOut], ['뒤 절개선', g.bPrinOut],
     ['앞 옆선', g.fSideFull], ['뒤 옆선', g.backSide]].forEach(function (w) {
      var p = prof(w[1]), sign = 0, flips = 0;
      for (var i = 1; i < 8; i++) {
        var sg = p[i] > 0.25 ? 1 : p[i] < -0.25 ? -1 : 0;
        if (sg && sign && sg !== sign) flips++;
        if (sg) sign = sg;
      }
      if (flips >= 2) bad.push(w[0] + ' 곡률이 ' + flips + '번 뒤집힌다 [' +
        p.map(function (v) { return v.toFixed(1); }).join(',') + ']');
    });
    /* ② 호/현 비 — 곡선이 늘어졌는지는 이것이 제일 정직하다. 잘 그은 절개선은 1.05 이하 */
    [['앞 절개선', g.fPrinOut], ['뒤 절개선', g.bPrinOut],
     ['앞 옆선', g.fSideFull], ['뒤 옆선', g.backSide]].forEach(function (w) {
      var pp = U.sampleSegs(w[1], 0.05);
      var arc = U.polyLen(pp), ch = V.dist(pp[0], pp[pp.length - 1]);
      if (ch > 1 && arc / ch > 1.10)
        bad.push(w[0] + ' 호/현 ' + (arc / ch).toFixed(3) + ' — 곡선이 늘어졌다 (' +
                 arc.toFixed(1) + ' / ' + ch.toFixed(1) + ')');
    });
    /* ③ 자기교차 — 재단선이 꼬이면 아예 못 쓴다 */
    d.pieces.forEach(function (pc) {
      var o = pc.outline;
      for (var i = 0; i < o.length - 3; i += 3)
        for (var j = i + 6; j < o.length - 1; j += 3) {
          var a = o[i], b = o[i + 1], c = o[j], e = o[j + 1];
          var dn = (b[0] - a[0]) * (e[1] - c[1]) - (b[1] - a[1]) * (e[0] - c[0]);
          if (Math.abs(dn) < 1e-9) continue;
          var t2 = ((c[0] - a[0]) * (e[1] - c[1]) - (c[1] - a[1]) * (e[0] - c[0])) / dn;
          var u2 = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / dn;
          if (t2 > 0.001 && t2 < 0.999 && u2 > 0.001 && u2 < 0.999) {
            bad.push(pc.name + ' 이 자기교차한다'); return;
          }
        }
    });
    if (bad.length) fails++;
    console.log('  ' + (bad.length ? '✗ ' : '✓ ') + pad(sz, 5) +
      '절개 뒤 ' + f(U.sLen(g.bPrinIn), 6) + ' · 앞 ' + f(U.sLen(g.fPrinIn), 6) +
      ' · 자기교차 없음' + (bad.length ? '\n      → ' + bad.join('\n      → ') : ''));
  });
})();

/* ══ 4. 도면 참고 — sisterMAG Barjacke DE36 ═══════════════════════════
   ⚠ **맞춰야 할 정답지가 아니다.** 이 재킷은 백영례 제도법으로 다시 그린 것이라
   조각 분할부터 다르다(도면은 옆판이 겨드랑을 품는 구성). 크기 감각만 본다.  */
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 4. 도면 참고 (soft) — Barjacke DE36 ↔ 55호. 맞출 대상이 아니다');
console.log('════════════════════════════════════════════════════════════');
(function () {
  var m = E.measuresForSize('55호');
  var g = E.geom(m), d = E.draftJacket(m, { seam: E.SEAM_DEFAULT });
  var P = {}; d.pieces.forEach(function (p) { P[p.id] = p; });
  var G = GT.pieces;
  ok('옷길이(뒤)', Math.abs(g.hemY - G.back.h) <= 4.0,
     f(g.hemY, 6) + '  도면 ' + f(G.back.h, 6) + ' · 차 ' + f(g.hemY - G.back.h, 6), true);
  [['front', '앞판'], ['frontSide', '앞옆판'], ['back', '뒤판']].forEach(function (w) {
    var e = P[w[0]].bbox, t = G[w[0]];
    ok('크기 ' + w[1], Math.abs(e.w - t.w) <= 5.0 && Math.abs(e.h - t.h) <= 5.0,
       f(e.w, 6) + '×' + f(e.h, 6) + '  도면 ' + f(t.w, 6) + '×' + f(t.h, 6) +
       ' · 차 ' + f(e.w - t.w, 6) + ' / ' + f(e.h - t.h, 6), true);
  });
  ok('여밈 겹침', Math.abs(K.overlap - 7.89) <= 0.2, f(K.overlap, 6) + '  도면 7.89', true);
  ok('단추 세로 간격', Math.abs(K.btnGapY - 9.80) <= 0.2, f(K.btnGapY, 6) + '  도면 9.80', true);
  var names = d.pieces.map(function (p) { return p.name; }).join(' · ');
  ok('조각 구성', d.pieces.length === 17, '17장 — ' + names);
})();

console.log('\n════════════════════════════════════════════════════════════');
console.log(fails ? ' 실패 ' + fails + '건' + (warns ? ' · 참고 ' + warns + '건' : '')
                  : ' 전체 통과' + (warns ? ' · 참고 ' + warns + '건' : ''));
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
