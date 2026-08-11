/* ============================================================================
 * suite-verify.js — 원형 7종 **공통** 검산
 *
 *   각 모듈의 engine-verify.js 는 그 모듈의 DXF 정답지를 대조한다 (모듈마다 다르다).
 *   이 파일은 **정답지가 없어도 반드시 참이어야 하는 것**만 전 모듈·전 호수에 건다.
 *
 *   왜 따로 두나 — 모듈마다 검사가 제각각이라 **새 모듈일수록 성글었다.**
 *   2026-08-12 QA 에서 일부러 망가뜨려도 통과한 것들:
 *     · 너치를 전부 지워도 통과 (기본원형·원형2·원형3)
 *     · 너치 각을 +180° 뒤집어도 통과 (5개 모듈)
 *     · SEAM_DEFAULT.side 를 0 으로 해도 통과 (3개 모듈)
 *     · outline 을 60점 잘라 폐곡선을 깨도 통과 (원형3)
 *   검사를 모듈마다 베껴 넣으면 또 빠진다. **한 군데 넣고 전부 돌린다.**
 *
 *   실행: node suite-verify.js            (전 모듈)
 *         node suite-verify.js 토르소      (이름에 그 글자가 든 모듈만)
 *   실패가 있으면 종료코드 1.
 * ==========================================================================*/
'use strict';
var fs = require('fs'), path = require('path');

var MODULES = [
  { dir: '기본원형',              draft: 'draftNoDart' },
  { dir: '숙녀복기본원형1',        draft: 'draftLady1' },
  { dir: '언더암다트',            draft: 'draftLady1' },
  { dir: 'V네크라인',             draft: 'draftVNeck' },
  { dir: '숙녀복기본원형2',        draft: 'draftBodice2',
    opt: { sleeveType: 'two' },
    pairs: [['2장소매 절개선', '큰소매', '뒤 절개선', '작은소매', '절개선', 0.15]] },
  { dir: '숙녀복기본원형3',        draft: 'draftBodice3' },
  { dir: '토르소원형프린세스라인',   draft: 'draftTorso' }
];

/* 시접 0 이 **의도된** 자리 — 그 외에 0 이 나오면 재단해도 못 꿰맨다.
   fold(골선)는 항상 0 이고, dart 다리는 허리 시접이 덮으므로 0 으로 둔다. */
var SEAM_ZERO_OK = ['fold', 'dart'];
/* 짝이 없어도 되는 너치 — 다트 다리는 접으면 서로 포개진다 */
var NOTCH_SOLO = ['가슴다트', '다트 위', '다트 아래', '다트'];

var NOTCH_TICK = 0.5;      // SPEC §8.1
var GAP_MAX = 0.06;        // 외곽선 점 간격 상한
var GAP_MIN = 0.015;       // 하한 — 이보다 촘촘하면 폴리라인이 과밀하다

var fails = 0, warns = 0, checked = 0;
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function ptInPoly(pt, poly) {
  var c = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
        pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function finite(p) { return p && isFinite(p[0]) && isFinite(p[1]); }
/** 조각의 변 하나를 outline 에서 **실측**한다 — 제도식/measures 값을 믿으면 안 된다.
    원형2 옆선 검사가 measures 를 읽어 늘 0 으로 보였다 (실제 도면은 0.33~0.45 차). */
function edgeLen(d, pieceName, edgeName) {
  var p = (d.pieces || []).filter(function (x) { return x.name === pieceName || x.id === pieceName; })[0];
  if (!p) return null;
  var names = Array.isArray(edgeName) ? edgeName : [edgeName], tot = 0, hit = 0;
  names.forEach(function (en) {
    var e = (p.edges || []).filter(function (x) { return x.name === en; })[0];
    if (!e) return;
    hit++;
    for (var i = e.start + 1; i <= e.end; i++) tot += dist(p.outline[i - 1], p.outline[i]);
  });
  return hit === names.length ? tot : null;
}

/* ── 조각 하나에 거는 검사 ───────────────────────────────────────────── */
function checkPiece(p, bad) {
  var nm = p.name || p.id || '?';
  var o = p.outline || [];
  if (o.length < 8) { bad.push(nm + ' outline 이 ' + o.length + '점'); return; }

  /* ① 좌표가 전부 유한한가 — NaN 이 하나만 있어도 재단 파일이 깨진다 */
  for (var i = 0; i < o.length; i++)
    if (!finite(o[i])) { bad.push(nm + ' outline[' + i + '] 이 NaN/무한'); return; }

  /* ② 폐곡선 — 시작과 끝이 만나야 한다. 원형3 은 이 검사가 없어 60점을 잘라도 통과했다 */
  var close = dist(o[0], o[o.length - 1]);
  if (close > 0.10) bad.push(nm + ' 폐곡선 안 닫힘 ' + close.toFixed(3));

  /* ③ 점 간격 — 벌어지면 재단선이 각지고, 과밀하면 파일만 커진다 */
  var gmax = 0, gmin = Infinity, dense = 0;
  for (i = 1; i < o.length; i++) {
    var g = dist(o[i - 1], o[i]);
    if (g > gmax) gmax = g;
    if (g > 1e-9 && g < gmin) gmin = g;
    if (g > 1e-9 && g < GAP_MIN) dense++;
  }
  if (gmax > GAP_MAX) bad.push(nm + ' 점 간격 ' + gmax.toFixed(3) + ' (상한 ' + GAP_MAX + ')');
  if (dense > o.length * 0.5)
    warns += 0, bad.push('~' + nm + ' 폴리라인 과밀 — ' + dense + '/' + o.length + ' 점이 간격 ' + GAP_MIN + ' 미만');

  /* ④ 봉제선에 시접이 0 이면 못 꿰맨다 */
  (p.edges || []).forEach(function (e) {
    if (SEAM_ZERO_OK.indexOf(e.role) < 0 && !(e.seam > 0))
      bad.push(nm + ' 「' + e.name + '」(' + e.role + ') 시접 0');
  });

  /* ⑤ 너치 — 없으면 봉제할 때 맞출 데가 없다. 빈 배열은 「검사할 게 없다」가 아니다. */
  var nts = p.notches || [];
  if (!nts.length) { bad.push(nm + ' 너치 0개'); return; }
  nts.forEach(function (n) {
    var lb = n.label || '(무명)';
    if (!n.p || !finite(n.p)) { bad.push(nm + ' 「' + lb + '」 너치 좌표가 NaN'); return; }
    /* 너치는 외곽선 위에 있어야 한다 */
    var b = Infinity;
    for (var k = 0; k < o.length; k++) { var e = dist(n.p, o[k]); if (e < b) b = e; }
    if (b > GAP_MAX) bad.push(nm + ' 「' + lb + '」 너치가 외곽선 밖 ' + b.toFixed(3));
    /* 틱이 조각 **안쪽**을 향해야 한다 — 바깥이면 재단할 때 반대로 판다.
       ⚠ 무게중심으로 재면 오목한 변(암홀)에서 샌다. 그리는 것과 같은 방식으로 판정한다. */
    if (typeof n.angle === 'number' && isFinite(n.angle)) {
      var a = n.angle * Math.PI / 180;
      if (!ptInPoly([n.p[0] + Math.cos(a) * NOTCH_TICK, n.p[1] + Math.sin(a) * NOTCH_TICK], o))
        bad.push(nm + ' 「' + lb + '」 너치 틱이 조각 밖으로 나간다');
    }
  });
}

/* ── UI ↔ 엔진 계약 ─────────────────────────────────────────────────
   화면에 있는 입력란이 아무 일도 안 하면 그건 거짓말이다. 토르소·원형3 의
   스타일 입력 7개가 그랬다 (원형2 ui.js 복붙 — 엔진이 그 키를 안 읽는다). */
function checkUiContract(dir, E, draftFn, bad) {
  var f = path.join(__dirname, dir, 'ui.js');
  if (!fs.existsSync(f)) return null;
  var src = fs.readFileSync(f, 'utf8');
  var blk = src.match(/var STYLE_KEYS\s*=\s*\[([\s\S]*?)\n\s*\];/);
  var keys = blk ? (blk[1].match(/\bk:\s*'(\w+)'/g) || []).map(function (x) { return x.match(/'(\w+)'/)[1]; }) : [];
  var m = E.measuresForSize(E.SIZES[Math.floor(E.SIZES.length / 2)]);
  /* 외곽선만 보면 안 된다 — 목다트(MP)처럼 **제도선만 바꾸는** 입력이 있다.
     「이 입력이 무엇이든 바꾸는가」를 물어야 하므로 outline·internal·measures 를 다 본다. */
  function sig(opt) {
    var d = draftFn(m, opt);
    return JSON.stringify(d.pieces.map(function (p) { return [p.outline, p.internal || [], p.notches || []]; })) +
           JSON.stringify(d.measures || {});
  }
  var base = sig({}), dead = [];
  keys.forEach(function (k) {
    var K = (E.K || {}), seed = isFinite(K[k]) ? K[k] * 0.5 + 0.37 : 3.14;
    var o = {}; o[k] = seed;
    var same;
    try { same = sig(o) === base; } catch (err) { same = false; }
    if (same) dead.push(k);
  });
  if (dead.length) bad.push('UI 스타일 입력이 무동작: ' + dead.join(', ') + ' (엔진이 이 opt 키를 안 읽는다)');

  /* ui.js 가 읽는 measures 키가 실제로 있는가 — 없으면 그 검사가 조용히 스킵된다.
     `M.x !== undefined ? M.x : M.y` 처럼 폴백을 둔 자리는 통과로 본다. */
  var meas = draftFn(m, {}).measures || {};
  var missing = [];
  (src.match(/M\.(\w+)/g) || []).forEach(function (x) {
    var k = x.slice(2);
    if (k === 'savePdf' || meas[k] !== undefined || missing.indexOf(k) >= 0) return;
    if (src.indexOf('M.' + k + ' !== undefined') >= 0) return;    // 폴백 있음
    missing.push(k);
  });
  if (missing.length) bad.push('ui.js 가 없는 measures 키를 읽는다: ' + missing.join(', '));
  return { styleKeys: keys.length, dead: dead.length };
}

/* ── 모듈 하나 ──────────────────────────────────────────────────────── */
function runModule(mod) {
  var E;
  try { E = require(path.join(__dirname, mod.dir, 'engine.js')); }
  catch (e) { console.log('  ✗ ' + mod.dir + ' — engine.js 를 못 읽는다: ' + e.message); fails++; return; }
  var draftFn = E[mod.draft];
  if (typeof draftFn !== 'function') {
    console.log('  ✗ ' + mod.dir + ' — ' + mod.draft + ' 가 없다'); fails++; return;
  }
  console.log('\n── ' + mod.dir);
  var prev = null, modBad = [], prevSig = null, prevSize = null;

  E.SIZES.forEach(function (sz) {
    var bad = [], d;
    var o = { seam: E.SEAM_DEFAULT };
    for (var ok2 in (mod.opt || {})) o[ok2] = mod.opt[ok2];
    try { d = draftFn(E.measuresForSize(sz), o); }
    catch (e) { console.log('   ✗ ' + pad(sz, 5) + '제도 실패: ' + e.message); fails++; return; }
    (d.pieces || []).forEach(function (p) { checkPiece(p, bad); checked++; });

    /* 호수가 커지면 주요 치수는 **반드시** 커진다 — 66호 실측 상수를 골격에 박으면
       여기서 뒤집힌다 (토르소 뒤 암홀이 44호에서 66호보다 길었다). */
    var M = d.measures || {}, cur = {};
    /* ⚠ 옆선(sideBack)은 넣으면 안 된다 — 호수가 커지면 진동이 깊어져 겨드랑이
       내려가므로 **짧아지는 것이 정상**이다. 단조 증가가 참인 것만 넣는다. */
    ['armholeTotal', 'neckBack', 'neckFront'].forEach(function (k) {
      if (isFinite(M[k])) cur[k] = M[k];
    });
    if (prev) Object.keys(cur).forEach(function (k) {
      if (prev[k] !== undefined && cur[k] <= prev[k])
        bad.push(k + ' 단조성 위반 ' + prev[k].toFixed(3) + ' → ' + cur[k].toFixed(3));
    });
    prev = cur;

    /* 조각별 **너치 개수가 호수마다 같아야** 한다 — 호수 따라 있다 없다 하면
       그 호수에는 맞출 자리가 없는 것이다. 원형2 「뒤 1/3」이 66·77호에만 있었다
       (44·55·88호에는 아예 없었다 — 2026-08-12 QA). 「어느 곡선 위인가」로 너치를
       조각에 나누다 보니 경계에 놓인 것이 어느 쪽에도 안 잡혀 사라졌다. */
    var sig = (d.pieces || []).map(function (p) {
      return (p.name || p.id) + ':' + (p.notches || []).length;
    }).join(' · ');
    if (prevSig !== null && sig !== prevSig)
      bad.push('조각별 너치 개수가 호수마다 다르다\n           ' + prevSize + '  ' + prevSig + '\n           ' + sz + '  ' + sig);
    prevSig = sig; prevSize = sz;

    /* 맞물리는 변 짝 — **모듈이 선언한 것만** 전 호수로 잰다. 66호 전용 검사 안에
       숨어 있으면 44/88호가 깨져도 통과한다 (원형2 2장소매가 44호 1.16 · 88호 1.53
       어긋난 채 나갔다 — 2026-08-12 QA). */
    (mod.pairs || []).forEach(function (w) {
      var A = edgeLen(d, w[1], w[2]), B = edgeLen(d, w[3], w[4]);
      if (A === null || B === null) { bad.push(w[0] + ' 변을 못 찾음'); return; }
      if (Math.abs(A - B) > (w[5] || 0.3))
        bad.push(w[0] + ' 짝 ' + A.toFixed(3) + '↔' + B.toFixed(3) + ' 차 ' + (A - B).toFixed(3));
    });

    var hard = bad.filter(function (x) { return x[0] !== '~'; });
    var soft = bad.filter(function (x) { return x[0] === '~'; });
    if (hard.length) fails++; else if (soft.length) warns++;
    console.log('   ' + (hard.length ? '✗ ' : soft.length ? '⚠ ' : '✓ ') + pad(sz, 5) +
      '조각 ' + (d.pieces || []).length + '장 · 너치 ' +
      (d.pieces || []).reduce(function (a, p) { return a + (p.notches || []).length; }, 0) + '개' +
      (hard.length ? '\n        → ' + hard.join('\n        → ') : '') +
      (soft.length ? '\n        ⚠ ' + soft.map(function (x) { return x.slice(1); }).join('\n        ⚠ ') : ''));
  });

  var ui = checkUiContract(mod.dir, E, draftFn, modBad);
  if (modBad.length) { fails++; console.log('   ✗ UI 계약\n        → ' + modBad.join('\n        → ')); }
  else if (ui) console.log('   ✓ UI 계약  스타일 입력 ' + ui.styleKeys + '개 전부 동작 · measures 키 대응');
}

/* ── 실행 ───────────────────────────────────────────────────────────── */
var filter = process.argv[2];
var list = filter ? MODULES.filter(function (m) { return m.dir.indexOf(filter) >= 0; }) : MODULES;
console.log('════════════════════════════════════════════════════════════');
console.log(' 원형 7종 공통 검산 — 정답지 없이도 반드시 참이어야 하는 것');
console.log('════════════════════════════════════════════════════════════');
console.log(' 폐곡선 · 점 간격 · 봉제선 시접 0 · 너치(존재·외곽선 위·틱 방향)');
console.log(' · 전 호수 단조성 · UI↔엔진 계약');
if (!list.length) { console.log('\n  「' + filter + '」 에 맞는 모듈이 없다'); process.exit(1); }
list.forEach(runModule);
console.log('\n════════════════════════════════════════════════════════════');
console.log(' 조각 ' + checked + '개 검사 · 실패 ' + fails + '건' + (warns ? ' · 참고 ' + warns + '건' : ''));
console.log('════════════════════════════════════════════════════════════');
process.exit(fails ? 1 : 0);
