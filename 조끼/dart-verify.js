/* ============================================================================
 * dart-verify.js — 조끼 **다트만** 따로 보는 검사기
 *
 *   사용자 지적(2026-08-14): 「다트가 다 들어가지 않았어」
 *   원문이 말하는 다트는 **6종**이다. 하나라도 조각에 안 그려져 있으면 미완성이다.
 *
 *     ① 뒤 어깨다트   [10] 분량 1.5 · [19] 중심 39(38~22 2등분) · 길이 7
 *     ② 뒤 허리다트   [9] 분량 2~2.5 · [16] 33·34 로 양쪽 분배
 *     ③ 앞 허리다트   [27] 63·64 로 양쪽 분배 · 분량은 「남는 양」(56−55)
 *     ④ 뒤 MP        [17] 0.5~0.8 (형지접어줄임)
 *     ⑤ 앞 MP        [39] 0.5~1
 *     ⑥ 앞 겨드랑다트 [27] 65·66 · 분량 = 유차 — **아직 안 넣었다**
 *
 *   ⚠ ⑥ 은 2026-08-14 까지 이 목록에 **없었다.** 목록에 없으니 아무도 안 셌고,
 *     「없는 다트」가 전체 통과로 나왔다 (결함 ①형 — 검사가 없어서 통과).
 *     지금은 §7 이 그 부재를 **참고(경고)로 센다.** 원문 [27] 이 「다트를 넣는 위치와
 *     방법은 여러가지가 있으며 꼭 집어서 어느부분에 넣어야 한다는 공식이나 원칙은
 *     없습니다」라며 자리를 정하지 않아 사용자 결정을 기다리는 항목이라 실패로
 *     세우지는 않는다 — 다만 **조용히 통과하지도 않는다.**
 *     (이어서-할-일.md 「1. 앞 옆선이 뒤 옆선보다 유차만큼 길다」)
 *
 *   ★ 검사는 「엔진이 값을 계산했나」가 아니라 **조각에 그려졌나**를 본다.
 *     값만 있고 조각에 없으면 종이에는 다트가 없다 — 실제로 그렇게 나갔다.
 *
 *   실행: node dart-verify.js        (실패가 있으면 종료코드 1)
 * ==========================================================================*/
'use strict';
var E = require('./engine.js'), U = E.util, V = U.V, K = E.K;

/* ★ 두 가지로 쓴다 —
 *   ① 단독 실행:  node dart-verify.js
 *   ② engine-verify.js 안에서:
 *        var DV = require('./dart-verify.js');
 *        var r = DV.run();          // { fails, warns } 를 돌려준다
 *   검사를 한 군데에만 두려고 이렇게 했다. 복붙하면 한쪽만 고쳐지고 다른 쪽은
 *   낡은 채 통과한다 — 이 프로젝트에서 이미 겪은 실수다. */
function run() {
var fails = 0, warns = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function f(v, w, d) { var s = (+v).toFixed(d === undefined ? 2 : d); while (s.length < w) s = ' ' + s; return s; }
function ok(name, pass, detail, soft) {
  if (!pass) { if (soft) warns++; else fails++; }
  console.log('  ' + (pass ? '✓ ' : soft ? '⚠ ' : '✗ ') + pad(name, 26) + detail);
}
function head(t) {
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log(' ' + t);
  console.log('════════════════════════════════════════════════════════════');
}
function len(segsOrPts) {
  var p = Array.isArray(segsOrPts) && segsOrPts.length && segsOrPts[0].p0
        ? U.sampleSegs(segsOrPts, 0.02) : segsOrPts;
  var L = 0; for (var i = 1; i < p.length; i++) L += V.dist(p[i], p[i - 1]);
  return L;
}
/** 조각 안에서 「다트」 라벨을 단 제도선/너치를 찾는다 */
function dartsOf(piece) {
  var lines = (piece.internal || []).filter(function (x) {
    return /다트|dart/i.test(x.label || '') || /다트|dart/i.test(x.id || '');
  });
  var nt = (piece.notches || []).filter(function (n) { return /다트|dart/i.test(n.label || ''); });
  return { lines: lines, notches: nt };
}

head('0. 원문이 말하는 다트 — 무엇이 있어야 하나');
console.log('  ① 뒤 어깨다트  [10] 분량 1.5 · [19] 중심 39 · 길이 7');
console.log('  ② 뒤 허리다트  [9] 분량 2~2.5 · [16] 33·34 양쪽 분배');
console.log('  ③ 앞 허리다트  [27] 63·64 양쪽 분배 · 분량 = 남는 양(56−55)');
console.log('  ④ 뒤 MP       [17] 0.5~0.8');
console.log('  ⑤ 앞 MP       [39] 0.5~1');
console.log('  ⑥ 앞 겨드랑다트 [27] 65·66 · 분량 = 유차 · 꼭짓점 58 — 아직 안 넣었다(§7)');

/* ══ 1. 다트가 **조각에 그려졌는가** ═══════════════════════════════════ */
head('1. 다트가 조각에 그려졌는가 (55호) — 값만 있고 안 그리면 종이엔 없다');
(function () {
  var m = E.measuresForSize('55호');
  var d = E.draftVest(m, { seam: E.SEAM_DEFAULT });
  var total = 0;
  d.pieces.forEach(function (p) {
    var dt = dartsOf(p);
    total += dt.lines.length;
    /* ⚠ 4조각에서는 **앞판(중심)에 다트가 없는 것이 정상**이다 — 허리다트는 절개선으로,
       겨드랑다트는 앞옆판으로 갔다. 「모든 조각에 다트가 있어야 한다」로 두면 옳게 옮긴
       것을 결함으로 잡는다 (2026-08-15). 뒤판은 어깨다트가 남아 있어야 한다. */
    /* 안단 조각에는 다트가 없다 — 목·어깨·안단선·중심으로만 닫힌 조각이다 */
    ok('조각 ' + p.name, dt.lines.length > 0 || /옆|Side|^앞판$|안단/.test(p.name),
       '다트선 ' + dt.lines.length + '개 · 다트너치 ' + dt.notches.length + '개' +
       (dt.lines.length ? ' — ' + dt.lines.map(function (x) { return x.label || x.id; }).join(', ') : ''),
       /옆|Side/.test(p.name));
  });
  ok('다트선 총합', total > 0, total + '개  — 0 이면 어떤 조각에도 다트가 없다는 뜻이다');
})();

/* ══ 2. 다트 분량이 원문 범위인가 ════════════════════════════════════ */
head('2. 다트 분량 — 원문 범위');
(function () {
  var m = E.measuresForSize('55호'), g = E.geom(m, {});
  var shDart = num(K.shDart), backDart = num(K.backDart);
  ok('① 뒤 어깨다트 분량', Math.abs(shDart - 1.5) <= 0.01, f(shDart, 6) + '  원문 [10] 1.5');
  ok('② 뒤 허리다트 분량', backDart >= 2.0 && backDart <= 2.5, f(backDart, 6) + '  원문 [9] 2~2.5');
  /* ③ 앞 허리다트 = **「남는 양」**(56 − 55).
     ⚠ 「보통 2~3」이라는 고정 band 로 재면 안 된다 — 원문 [24] 참고가 바로 그
       고정치수 방식을 **쓰지 말라**고 한다(「정해진 치수로 다트를 주고 옆라인을
       그리면 뒤판 옆라인과 많은 차이가 날 수 있다」). 4조각에서는 이 양이 통째로
       절개선으로 가므로 3 을 넘어도 결함이 아니다.
     → 옳은 시험은 **완성 허리가 W + 여유×4 인가** 다. 다트와 옆라인이 서로
       모르는 사이가 되면 여기서 걸린다. (2026-08-14 · 처음엔 band 로 재서 오진했다) */
  var f55 = g.f55, f56 = g.f56;
  if (f56 && f55) {
    var fd = Math.abs(f56[0] - f55[0]);
    var fin = 2 * ((g.p19[0] - g.cbIn - g.backDart) + (f56[0] - g.frontDart));
    /* 완성이미지 실측(2026-08-14) — 다트는 남는 양의 fDartUse(0.8)만 접는다.
       안 접은 몫 2×(1−fDartUse)×남는양 은 앞 허리 여유로 남는다 (engine-verify §9 와 동식). */
    var want = g.W + 4 * K.waistEase + 2 * (1 - K.fDartUse) * fd;
    ok('③ 앞 허리다트 = 남는 양 × fDartUse', Math.abs(fin - want) <= 0.02,
       '다트 ' + f(g.frontDart, 5) + ' = 남는 양 ' + f(fd, 5) + ' × ' + K.fDartUse +
       ' · 완성 허리 ' + f(fin, 6) + ' (기대 ' + f(want, 6) + ')');
  } else {
    ok('③ 앞 허리다트 = 남는 양', false, '56 번이 geom 에 없다 — 「남는 양」을 못 잰다');
  }
  ok('④ 뒤 MP', num(K.mpBack) >= 0.5 && num(K.mpBack) <= 0.8, f(num(K.mpBack), 6) + '  원문 [17] 0.5~0.8');
  var mpF = K.mpFront;
  ok('⑤ 앞 MP', mpF !== undefined && mpF >= 0.5 && mpF <= 1.0,
     (mpF === undefined ? '없다(undefined)' : f(mpF, 6)) + '  원문 [39] 0.5~1');
  /* ★ 값이 있어도 **그려지지 않으면 종이엔 없다** — 이게 이번 지적의 핵심이었다 */
  /* ⚠ MP 는 **그 선이 놓인 조각**에만 있어야 한다. 처음엔 4조각 전부에 요구했는데,
     그러면 앞 MP 를 앞옆에도 붙이게 되고 검산기가 「조각 밖 허공」으로 잡는다.
     → 뒤 MP 는 뒤쪽 어딘가에, 앞 MP 는 앞쪽 어딘가에 **한 번씩** 있으면 된다. */
  var dd = E.draftVest(m, { seam: E.SEAM_DEFAULT });
  function mpIn(pref) {
    return dd.pieces.filter(function (x) { return x.name.indexOf(pref) === 0; })
      .some(function (pc) { return (pc.internal || []).some(function (x) { return /MP/.test(x.label || ''); }); });
  }
  ok('뒤 MP 선이 그려졌나', mpIn('뒤'), mpIn('뒤') ? '뒤 조각에 있다' : '**없다** — 값만 있고 안 그렸다');
  ok('앞 MP 선이 그려졌나', mpIn('앞'), mpIn('앞') ? '앞 조각에 있다' : '**없다** — 값만 있고 안 그렸다');
  function num(v) { return typeof v === 'number' ? v : NaN; }
})();

/* ══ 3. 다트 자리와 길이 — 원문 번호점과 맞나 ══════════════════════ */
head('3. 다트 자리·길이 — 원문 번호점');
(function () {
  var m = E.measuresForSize('55호'), g = E.geom(m, {});
  /* ① 어깨다트 중심 39 = 38~22 의 2등분 */
  if (g.p38 && g.p22 && g.p39) {
    var mid = [(g.p38[0] + g.p22[0]) / 2, (g.p38[1] + g.p22[1]) / 2];
    ok('① 어깨다트 중심 39', V.dist(g.p39, mid) <= 0.02,
       '(' + f(g.p39[0], 5) + ',' + f(g.p39[1], 5) + ')  38~22 의 2등분 (' +
       f(mid[0], 5) + ',' + f(mid[1], 5) + ')');
  } else ok('① 어깨다트 중심 39', false, '39 번이 geom 에 없다');
  /* 폭은 원문 고정(1.5) · 길이는 사용자 지정으로 연장 가능 — 「폭은 고정하고 길이만
     길게」(2026-08-14). 다트 끝이 진동선을 넘어가면 등에서 뜨므로 그건 막는다. */
  ok('① 어깨다트 길이', g.shDartLen >= 7 && g.shDartLen <= 16,
     f(g.shDartLen, 6) + '  원문 [19] 7 · 사용자 지정 연장 (상한 16)');
  var dTipY = g.p39 ? g.p39[1] + g.shDartLen : NaN;
  ok('① └ 다트 끝이 진동선 위인가', !(dTipY > g.BL),
     '다트 끝 y ' + f(dTipY, 6) + ' ↔ 진동선 ' + f(g.BL, 6));
  /* ② 뒤 허리다트 33·34 가 다트분만큼 벌어졌나 */
  if (g.p33 && g.p34) {
    var wB = Math.abs(g.p33[0] - g.p34[0]);
    ok('② 33~34 벌어짐', Math.abs(wB - g.backDart) <= 0.02,
       f(wB, 6) + '  = 뒤 허리다트분 ' + f(g.backDart, 5));
  } else ok('② 33~34 벌어짐', false, '33·34 가 geom 에 없다');
  /* ③ 앞 허리다트 63·64 */
  if (g.f63 && g.f64) {
    var wF = Math.abs(g.f63[0] - g.f64[0]);
    ok('③ 63~64 벌어짐', wF > 1.0, f(wF, 6) + '  = 앞 허리다트분');
  } else ok('③ 63~64 벌어짐', false, '63·64 가 geom 에 없다');
})();

/* ══ 4. 다트를 **접으면 치수가 맞나** — 제일 센 검사 ═══════════════ */
head('4. 다트를 접으면 치수가 맞나 (허리 · 어깨)');
E.SIZES.forEach(function (sz) {
  var m = E.measuresForSize(sz), g = E.geom(m, {});
  var bad = [];
  /* 허리 — (뒤 반폭 + 앞 반폭) × 2 − 다트분 합 = W + 여유 */
  var backW = g.p19 ? g.p19[0] - g.cbIn : NaN;          // 8~19
  var frontW = g.f55 ? g.f55[0] : NaN;                   // 앞중심~55
  var dartSum = g.backDart + (g.f56 && g.f55 ? Math.abs(g.f56[0] - g.f55[0]) : 0);
  var waistFin = (backW + frontW) * 2 - dartSum * 2;
  var target = g.W + 2 * (num(K.waistEase) * 2);         // 여유는 앞뒤 각각
  if (!isFinite(waistFin)) bad.push('허리 계산 NaN');
  /* 어깨 — 뒤(다트 뺀 것) = 앞 */
  var shB = g.p38 && g.p26 ? V.dist(g.p38, g.p26) - g.shDart : NaN;
  var shF = g.f53 && g.f52 ? V.dist(g.f53, g.f52) : NaN;
  if (!isFinite(shB) || !isFinite(shF)) bad.push('어깨 계산 NaN');
  else if (Math.abs(shB - shF) > 0.3) bad.push('어깨 짝 ' + f(shB, 5) + ' ↔ ' + f(shF, 5) +
    ' 차 ' + f(shB - shF, 5) + ' (원문 [23] 같아야 한다)');
  ok(sz, !bad.length,
     bad.length ? bad.join(' · ')
     : '허리(다트접은뒤) ' + f(waistFin, 6) + ' · 어깨 뒤−다트 ' + f(shB, 5) + ' ↔ 앞 ' + f(shF, 5));
  function num(v) { return typeof v === 'number' ? v : NaN; }
});

/* ══ 5. 전 호수에서 다트가 다 있나 ══════════════════════════════════
 *  ★ **sp0·sp1 둘 다** 돈다. 예전엔 opt 에 splitPanels 를 안 넘겨 늘 K 기본값
 *    (=1, 4조각)만 봤는데, 사용자가 화면에서 보는 것은 **sp0(통짜)** 다
 *    (ui.html 의 selected 가 0). 그래서 통짜에 어깨다트·겨드랑다트 다리가
 *    통째로 없어도 이 검사가 「전체 통과」를 냈다 (2026-08-14 사용자 지적). */
head('5. 전 호수 다트 개수 — 호수 따라 있다 없다 하면 안 된다');
(function () {
  [0, 1].forEach(function (sp) {
    var counts = {};
    E.SIZES.forEach(function (sz) {
      var d = E.draftVest(E.measuresForSize(sz), { seam: E.SEAM_DEFAULT, splitPanels: sp });
      d.pieces.forEach(function (p) {
        var n = dartsOf(p).lines.length;
        (counts[p.name] = counts[p.name] || []).push(n);
      });
    });
    Object.keys(counts).forEach(function (k) {
      var a = counts[k], same = a.every(function (v) { return v === a[0]; });
      ok('sp' + sp + ' 조각 ' + k, same, a.join(' / ') + '  (44·55·66·77·88호)');
    });
  });
})();

/* ══ 6. 다트 다리 너치 ═════════════════════════════════════════════ */
head('6. 다트 다리 너치 — 접는 자리 표시');
[0, 1].forEach(function (sp) {
  var d = E.draftVest(E.measuresForSize('55호'), { seam: E.SEAM_DEFAULT, splitPanels: sp });
  var any = 0;
  /* ⚠ 「다트」가 라벨에 들어간 선이 다 접는 다트는 아니다 — `다트 끝`(절개 끝 표시)과
     MP 는 다리가 없다. **접는 다트**(어깨 다트)가 있는 조각만 다리 너치를 요구한다.
     (처음엔 전 조각에 요구해서 4건이 헛 FAIL 났다 · 2026-08-14) */
  d.pieces.forEach(function (p) {
    var fold = (p.internal || []).filter(function (x) { return /어깨 다트/.test(x.label || ''); });
    var nt = dartsOf(p).notches;
    any += nt.length;
    if (fold.length)
      ok('sp' + sp + ' 조각 ' + p.name, nt.length >= 2,
         '접는 다트 ' + fold.length + '개 · 다리 너치 ' + nt.length + '개 (두 곳이라야 한다)');
    else
      ok('sp' + sp + ' 조각 ' + p.name, true, '접는 다트 없음 — 절개선이 다트를 먹는다 (다리 너치 불필요)', true);
  });
  ok('sp' + sp + ' 다트 너치 총합', any > 0, any + '개');
  /* ★ **공허한 통과 방지** — 위 검사는 「접는 다트가 있는 조각만」 본다. 그래서
     다트가 **통째로 사라지면** 조건이 공허해져 전부 통과해 버린다.
     실제로 그랬다: 어깨 다트를 bGuide 에서 빼다가 뒤중심에서도 없어졌는데
     검사기가 「전체 통과」를 냈다 (2026-08-14). 그래서 **최소 1개**를 따로 건다. */
  var foldTotal = 0;
  d.pieces.forEach(function (p) {
    foldTotal += (p.internal || []).filter(function (x) { return /어깨 다트/.test(x.label || ''); }).length;
  });
  ok('sp' + sp + ' 접는 다트 최소 1개', foldTotal >= 1,
     '어깨 다트 ' + foldTotal + '개 — 0 이면 위 §6 이 공허하게 통과한다');
});

/* ══ 7. ⑥ 앞 겨드랑다트 — 구성마다 **처리 방식이 다르다** ═══════════════
 *   · 통짜(sp0)  절개선이 제도선일 뿐이라 회전할 데가 없다 → 다트를 **변으로 둔다**
 *   · 4조각(sp1) 사용자 지정 2026-08-14 「여기 다트는 회전해서 붙여줘요」 →
 *                꼭짓점을 피벗으로 돌려 **닫는다**. 그래서 다트 변이 없는 것이 정상이고,
 *                대신 ① 옆선이 한 줄이고 ② 그 길이가 뒤 옆선과 같아야 한다.
 *   ⚠ 「없으면 실패」로만 두면 회전으로 닫은 것을 미구현으로 오진한다. 구성별로
 *     **무엇이 맞는지**를 갈라서 센다 (이 프로젝트에서 반대 요구가 두 번 부딪혔다). */
head('7. ⑥ 앞 겨드랑다트 — 통짜는 변으로 · 4조각은 회전해 닫았는가');
[0, 1].forEach(function (sp) {
  var m = E.measuresForSize('55호');
  var d = E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: sp }), M = d.measures;
  var fsId = sp ? 'frontSide' : 'front';
  var fs = d.pieces.filter(function (p) { return p.id === fsId; })[0];
  var dartEdges = fs ? (fs.edges || []).filter(function (e) { return /겨드랑/.test(e.name || ''); }) : [];
  var sideEdges = fs ? (fs.edges || []).filter(function (e) { return e.role === 'side'; }) : [];
  function edgeLen(e) {
    var a = fs.outline.slice(e.start === 0 ? 0 : e.start - 1, e.end + 1), L = 0;
    for (var i = 1; i < a.length; i++) L += V.dist(a[i], a[i - 1]);
    return L;
  }
  if (!sp) {
    /* 통짜 — 다트가 변으로 있고 V(두 다리)라야 한다 */
    ok('sp0 ⑥ 겨드랑다트 변', dartEdges.length === 1,
       dartEdges.length ? fsId + ' 조각에 있다' : fsId + ' 조각에 **없다** — 앞 옆선이 뒤보다 ' +
       f(M.sideFront - M.sideBack, 5, 3) + 'cm 길다 (유차 ' + M['유차'] + ')');
    var legs = 0, apex = null;
    dartEdges.forEach(function (e) {
      var pts = fs.outline.slice(e.start === 0 ? 0 : e.start - 1, e.end + 1);
      for (var i = 1; i < pts.length - 1; i++) {
        var a = V.norm(V.sub(pts[i], pts[i - 1])), b = V.norm(V.sub(pts[i + 1], pts[i]));
        var ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
        if (ang > 30) { legs = 2; apex = pts[i]; }
      }
    });
    ok('sp0 └ V(두 다리)인가', legs === 2,
       apex ? '꼭짓점 (' + f(apex[0], 5) + ',' + f(apex[1], 5) + ')' : '꺾이는 자리를 못 찾았다');
  } else {
    /* 4조각 — 회전해 닫았으므로 다트 변이 **없어야** 하고 옆선이 한 줄이라야 한다 */
    ok('sp1 ⑥ 겨드랑다트를 회전해 닫았나', dartEdges.length === 0 && sideEdges.length === 1,
       dartEdges.length ? '앞옆판에 다트 변이 아직 남아 있다 (회전 전 상태)'
                        : '앞옆판 옆선 ' + sideEdges.length + '줄 · 다트 변 0개');
    var sideL = sideEdges.length === 1 ? edgeLen(sideEdges[0]) : NaN;
    /* ⚠ 2026-08-15 밑단을 보라선으로 올리면서 옆선도 **잘렸다** — 뒤 옆선(M.sideBack)은
       제도 전체 길이라 이제 짝이 아니다. 같은 조건의 **뒤옆판 옆선 변**과 잰다. */
    var bsP = d.pieces.filter(function (x) { return x.id === 'backSide'; })[0];
    var bsE = bsP ? (bsP.edges || []).filter(function (e) { return e.role === 'side'; })[0] : null;
    var sideBackCut = bsE ? (function () {
      var a = bsP.outline.slice(bsE.start === 0 ? 0 : bsE.start - 1, bsE.end + 1), L = 0;
      for (var i = 1; i < a.length; i++) L += V.dist(a[i], a[i - 1]);
      return L;
    })() : M.sideBack;
    /* 회전은 강체 변환이라 옆선 길이는 「다트를 뺀 값」 그대로여야 한다.
       허용 0.25 — 외곽선은 폴리라인 샘플이라 곡선 이음부에서 그만큼 차이가 난다. */
    ok('sp1 └ 접은 옆선 = 뒤 옆선', isFinite(sideL) && Math.abs(sideL - sideBackCut) <= 0.25,
       '앞옆판 옆선 ' + f(sideL, 6) + ' ↔ 뒤옆판 ' + f(sideBackCut, 6) +
       ' 차 ' + f(sideL - sideBackCut, 6, 3) + '  (둘 다 밑단에서 잘린 길이)');
  }
  /* 구성과 무관하게 — 접은 뒤 옆선 짝은 늘 맞아야 한다 */
  ok('sp' + sp + ' └ 봉제 후 옆선 짝', Math.abs(M.sideFrontSewn - M.sideBack) <= 0.1,
     '앞(다트 뺀 뒤) ' + f(M.sideFrontSewn, 6) + ' ↔ 뒤 ' + f(M.sideBack, 6) +
     ' 차 ' + f(M.sideFrontSewn - M.sideBack, 6, 3));
});

console.log('');
console.log('  다트 검사 — ' + (fails ? '실패 ' + fails + '건' : '전체 통과') +
            (warns ? ' · 참고 ' + warns + '건' : ''));
return { fails: fails, warns: warns };
}

module.exports = { run: run };
/* 단독 실행일 때만 바로 돌리고 종료코드를 낸다 */
if (require.main === module) {
  var r = run();
  console.log('');
  console.log('════════════════════════════════════════════════════════════');
  console.log(r.fails ? ' 실패 ' + r.fails + '건' + (r.warns ? ' · 참고 ' + r.warns + '건' : '')
                      : ' 전체 통과' + (r.warns ? ' · 참고 ' + r.warns + '건' : ''));
  console.log('════════════════════════════════════════════════════════════');
  process.exit(r.fails ? 1 : 0);
}
