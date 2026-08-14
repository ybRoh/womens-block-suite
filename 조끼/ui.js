/* ═══════════════════════════════════════════════════════════════════════
   토르소 원형 프린세스라인 — 화면 상호작용
   window.NoDartUI 로 노출.

   의존 (ui.js 보다 먼저 로드):
     window.VestEngine.measuresForSize(size)  → 표준 치수 ★ 유일한 치수 출처
     window.VestEngine.draftVest(m, opt)    → Draft (SPEC §8)
     window.NoDartPrint.buildPrintLayout / applyPageCss / renderTo

   ※ 이 파일에는 SPEC §2 치수표 사본이 없습니다. 표준값은 항상 엔진에서 읽습니다.
     엔진이 없으면 그리지 않고 "엔진 없음" 안내를 띄웁니다(목업 제도 없음).

   외부 라이브러리·CDN 없음. ES module 아님(즉시실행 함수).
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* measurements 가 아니라 opt 로 넘기는 치수 키. 조끼는 없다(소매가 없으므로). */
  var OPT_MEASURE_KEYS = [];

  /* 라벨은 숫자가 아니라 표기이므로 사본이어도 어긋날 위험이 없습니다.
     엔진이 MEAS_LABEL 을 주면 그쪽이 우선입니다. */
  var LABEL_FALLBACK = {
    B: '가슴둘레 B', backLen: '등길이', shoulderW: '어깨너비', backW: '등품',
    frontW: '앞품', bpLen: '유장', bpSpan: '유폭'
  };
  var FIELD_NOTE = { frontLen: '앞길이 − 등길이 = 앞 등길이 차이치수', bpLen: '앞목 옆점에서 잰다' };
  /* ★ 2026-08-14 — 소매 관련 상태·입력란을 전부 걷어냈다. **조끼에는 소매가 없다.**
     엔진에서도 sleeveGeom/SLEEVE_TYPE 을 지웠으므로 UI 에 남기면 무동작 상자가 된다.
     (engine-verify.js §6 이 sleeveType 이 되살아나는지 감시한다) */
  /* 스타일 값 — 교재가 범위로 준 것을 사용자가 고를 수 있게 UI 로 뺐다.
     ★ **엔진이 실제로 읽는 opt 키만** 넣는다 (engine.js 의 `num(opt.xxx, K.xxx)` 자리).
       원형2 에서 복붙한 ease/shoulderEase/dartAmount/dartRise 가 올라가 있었는데
       토르소 엔진은 그 키를 하나도 안 읽어 **입력란 4개가 전부 무동작**이었다
       (값을 바꿔도 outline 해시가 안 변한다 — 2026-08-12 QA). 화면에 있는 입력란이
       아무것도 안 하면 그건 거짓말이다. 키를 늘리려면 엔진에 `num(opt.…)` 을 먼저 넣어라. */
  /* ★ 2026-08-14 — 목록을 **조끼 엔진의 K 로 다시 썼다.**
     예전 목록 17개 중 **7개(dartFromCB · dartTipUp · underarmAdd · shDrop ·
     princessOut · neckDeepAdd · cuffW · capAdd · ctrTwist)가 원피스/소매의
     K_OLD 키**였다. 조끼 엔진은 그 키를 하나도 안 읽으므로 슬라이더를 움직여도
     도면이 안 변했다 — 화면에 있는 입력란이 아무것도 안 하면 그건 거짓말이다.
     engine-verify.js §6 이 이 목록을 엔진 소스의 `num(opt.…)` 와 대조한다.
     키를 늘리려면 **엔진에 num(opt.…) 을 먼저 넣어라.**
     단계 번호는 조끼 원문(docs/조끼-제도법-백영례.md)의 것이다. */
  var STYLE_KEYS = [
    { k: 'armDepthAdd', label: '진동 깊이 가감', min: 0,  max: 4,   step: 0.1,  hint: '진동선 = B/4 + 이 값 · 원문 1.5  [2]' },
    { k: 'cbIn',        label: '뒤중심 들임',   min: 0,   max: 3,   step: 0.1,  hint: '4·5·3 에서 나가는 양 · 원문 1.5  [5]' },
    { k: 'chestEase',   label: '겨드랑 여유',   min: 0,   max: 4,   step: 0.05, hint: '13 = 유B/4 + 이 값 · 원문 1.5~2  [7]' },
    { k: 'waistEase',   label: '허리 여유',     min: 0,   max: 5,   step: 0.05, hint: '18 = 17 + 이 값 · 원문 1.5~2  [9]' },
    /* 뒤판 여유(hipEaseB)를 노출한다 — 16번·절개선 밑단 벌어짐이 눈에 보이게 움직인다.
       앞판 hipEase(1.5)는 표준 체형에서 옮김이 0 이라 슬라이더로 두면 무동작이 된다
       (suite-verify UI 계약 · 2026-08-14). */
    { k: 'hipEaseB',    label: '엉덩이 여유(뒤)', min: 0,  max: 5,  step: 0.1,  hint: '16 = 15 + 이 값 · 도면 실측 2.4 (원문 텍스트 1.5)  [8]' },
    { k: 'backDart',    label: '뒤 허리 다트분', min: 1.0, max: 4.0, step: 0.05, hint: '19 = 18 + 이 값 · 원문 2~2.5  [9]' },
    { k: 'shDart',      label: '뒤 어깨 다트분', min: 0,  max: 3,   step: 0.1,  hint: '21 = 20 + 이 값 · 원문 1.5  [10]' },
    { k: 'shDartLen',   label: '뒤 어깨 다트길이', min: 4, max: 16, step: 0.5,  hint: '40 = 다트길이 · 원문 7 · 기본 12(BP 쪽까지)  [19]' },
    { k: 'shSlope',     label: '어깨 기울기',   min: 1.0, max: 2.5, step: 0.05, hint: '22 = 12 에서 내려온 양 · 원문 1.3~1.5  [10]' },
    { k: 'shScoop',     label: '어깨 파기',     min: 0,   max: 3,   step: 0.1,  hint: '26 = 21 에서 · 52 = 20 에서 · 원문 1.5  [12][23]' },
    { k: 'armFromBW',   label: '암홀↔등품선',   min: 0.3, max: 1.5, step: 0.05, hint: '암홀이 27 에서 떨어지는 양 · 원문 0.5~1  [13]' },
    { k: 'frontArmGap', label: '앞암홀↔앞품선', min: 0.2, max: 1.2, step: 0.05, hint: '앞암홀이 49 에서 떨어지는 양 · 원문 0.5  [25]' },
    { k: 'splitIn',     label: '절개선 위치',   min: 1.5, max: 4,   step: 0.1,  hint: '28 = 11 에서 안쪽 · 원문 2~3  [14]' },
    { k: 'splitStartAng', label: '절개선 시작각', min: 20, max: 45, step: 0.5, hint: '27a 에서 나가는 각(°) · 도면 27~34.7 · 27 밑이면 모서리 시접이 무너진다  [16]' },
    { k: 'hemUp',       label: '다트 끝 높이',  min: 2,   max: 12,  step: 0.5,  hint: '30·62 = 밑단에서 위로 · 원문 5  [14][27]' },
    { k: 'neckOut',     label: '옆목 파기',     min: 0,   max: 3,   step: 0.1,  hint: '38 = 24 에서 나간 양 · 원문 1.5  [18]' },
    { k: 'frontShDrop', label: '앞 어깨기울기 안내', min: 2, max: 8, step: 0.1, hint: '48 = 47 아래로 · 원문 4.5  [21]' },
    { k: 'fNeckDrop',   label: '앞목 내림',     min: 0,   max: 3,   step: 0.1,  hint: '51 = 50 에서 내려온 양 · 원문 1  [22]' },
    { k: 'fNeckOut',    label: '앞 옆목 파기',  min: 0,   max: 3,   step: 0.1,  hint: '53 = 51 에서 나간 양 · 원문 1.5  [23]' },
    { k: 'bpOut',       label: 'BP 절개 중심',  min: 0.5, max: 4,   step: 0.05, hint: '58 = BP 에서 나간 양 · 원문 1.5~2  [26]' },
    { k: 'frontDrop',   label: '앞처짐',        min: 0,   max: 5,   step: 0.1,  hint: '70 = 3 에서 아래로 · 원문 2.5  [38]' },
    { k: 'frontWrap',   label: '앞여밈분',      min: 1,   max: 4,   step: 0.1,  hint: '얇은 원단 2 · 두꺼운 원단 2.5  [38]' },
    /* MP(형지접어줄임) — 엔진에는 있는데 화면에 없던 손잡이 (2026-08-14 최종대조) */
    { k: 'mpAt',        label: 'MP 자리',       min: 0.2, max: 0.9, step: 0.05, hint: '35 = 암홀 위 비율 · 앞은 53~68 위 · 원문 「적당한 곳」  [17][39]' },
    { k: 'mpBack',      label: '뒤 MP',         min: 0.3, max: 1.2, step: 0.05, hint: '35→36 접어 줄이는 양 · 원문 0.5~0.8  [17]' },
    { k: 'mpFront',     label: '앞 MP',         min: 0.3, max: 1.5, step: 0.05, hint: '앞이 뜨는 것을 막는 양 · 원문 0.5~1  [39]' },
    /* 안단선 — 정답지 15_앞뒤판완성이미지 의 보라선 (본문에는 없다) */
    { k: 'facingSh',    label: '안단 어깨',     min: 2,   max: 8,   step: 0.1,  hint: '어깨선 위 · 옆목점에서 · 도면 4~5  [15]' },
    { k: 'facingCf',    label: '안단 앞단',     min: 4,   max: 10,  step: 0.1,  hint: '앞단(여밈선)에서 안으로 · 도면 6~7  [15]' },
    { k: 'facingBk',    label: '안단 뒤중심',   min: 3,   max: 10,  step: 0.1,  hint: '2번에서 아래로 (뒷목 안단) · 도면 6~7  [15]' },
    { k: 'facingHemS',  label: '밑단안단 옆',   min: 3,   max: 14,  step: 0.5,  hint: '옆선에서 위로 · 앞뒤 공통 · 도면 9  [15]' },
    /* 앞자락을 사선으로 자르면서(사용자 결정 2026-08-14) 밑단안단의 앞중심 다리는
       사라졌다 — 그 자리를 정하는 것은 이제 **사선이 올라가는 양**이다.
       (facingHemCf 는 죽은 상수라 슬라이더에서 뺐다 · engine-verify §10) */
    { k: 'frontPointRise', label: '앞자락 사선', min: 4, max: 18,  step: 0.5,  hint: '앞단 아래를 자르는 사선이 여밈선에서 올라가는 양 · 도면 12  [40]' },
    { k: 'facingHemCb', label: '밑단안단 뒤중심', min: 3, max: 14,  step: 0.5,  hint: '뒤중심에서 위로 · 도면 8  [15]' },
    { k: 'facingHemF',  label: '밑단안단 꼭짓점', min: 2, max: 10,  step: 0.5,  hint: '안단선과 만나는 자리의 높이 · 도면 4.5  [15]' }
  ];
  /** 기본값은 **엔진 K 에서 읽는다** — UI 에 숫자를 또 적으면 엔진과 어긋난다 */
  function styleDefaults() {
    var K = (ENG() && ENG().K) || {}, out = {};
    STYLE_KEYS.forEach(function (s) { if (isFinite(K[s.k])) out[s.k] = K[s.k]; });
    return out;
  }
  /** state.style 을 opt 에 얹는다 (없는 값은 엔진 기본값이 쓰인다) */
  function styleOpt(opt) { return styleOpt_(opt || {}); }
  function styleOpt_(opt) {
    opt = opt || {};
    var st = state.style || {};
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var k = STYLE_KEYS[i].k;
      if (st[k] !== null && st[k] !== undefined && isFinite(st[k])) opt[k] = +st[k];
    }
    return opt;
  }
  /* SHOULDER_EASE 는 원형2(소매 있는 원형)의 값이었다 — 토르소 엔진은 shoulderEase 를
     읽지 않으므로 넘기지 않는다. 뒤 어깨 다트분은 위 STYLE_KEYS 의 backDartSh 다. */

  /* ── 호수 (SPEC §11-3) ──
     탭 목록은 엔진에서 읽습니다. 엔진이 SIZES 를 좁게 내보내도 44/88호가 실제로
     동작하면 탭에 넣기 위해, 이름만 후보로 두고 measuresForSize() 로 타진합니다.
     ★ 이름은 식별자일 뿐이고 치수 숫자는 전부 엔진에서 옵니다. */
  var CANDIDATE_SIZES = ['44호', '55호', '66호', '77호', '88호'];

  /* ── 부위별 시접 (SPEC §11-1) ──
     role 목록과 기본 수치는 엔진(VestEngine.SEAM_ROLES / SEAM_DEFAULT)에서 읽습니다.
     UI 는 표시 순서와 한국어 라벨만 갖습니다(숫자 아님).
     ★ SEAM_FALLBACK 은 엔진이 부위별 시접을 아직 노출하지 않을 때만 쓰는 임시값. */
  var FOLD_ROLE = 'fold';                       // 항상 0 고정, 입력란 없음
  var SEAM_ROLE_LABEL = {
    neck: '목둘레', shoulder: '어깨선', armhole: '암홀',
    side: '옆선', princess: '절개선', center: '뒤중심', hem: '밑단', dart: '다트', fold: '골선'
  };
  /* ★ 엔진에 있는 role 을 **여기에도 넣어야** 입력란이 생긴다. 빠지면 UI 가 자기 목록만
     넘겨 그 부위 시접이 **0 으로 나간다** — 프린세스 절개선 4곳이 그렇게 시접 없이
     나갔다 (2026-08-12). 아래 renderSeam 이 엔진 SEAM_ROLES 와 대조해 경고한다. */
  var SEAM_ROLE_ORDER = ['neck', 'shoulder', 'armhole', 'side', 'princess', 'center', 'hem', 'dart'];
  var SEAM_FALLBACK = { neck: 1.0, shoulder: 1.0, armhole: 1.0, side: 1.5, princess: 1.5,
                        center: 1.5, hem: 3.0, dart: 1.5, fold: 0 };
  var SEAM_PRESETS = {
    none: function () { return zeroSeam(); },
    standard: function () { return standardSeam(); },
    uniform: function () { return uniformSeam(1.0); }
  };
  var SEAM_PRESET_LABEL = { none: '시접 없음', standard: '표준', uniform: '균일 1.0', custom: '사용자 지정' };

  /** 현재 draft 의 조각들이 실제로 쓰는 role 집합. 판단 불가면 null(=필터 안 함). */
  function usedSeamRoles() {
    var E = ENG();
    if (!E || typeof E.draftVest !== 'function' || !state.m) return null;
    var d;
    try {
      var sp = splitMeasures();
      d = E.draftVest(sp.m, styleOpt({ seam: {} }));
    } catch (e) { return null; }
    if (!d || !d.pieces) return null;
    var out = null;
    d.pieces.forEach(function (p) {
      (p.edges || []).forEach(function (e) {
        if (e && e.role) { out = out || {}; out[e.role] = 1; }
      });
    });
    return out;
  }

  /** 입력란을 만들 role 목록 (fold 제외) — 엔진 목록 우선, UI 선호 순서로 정렬 */
  function seamRoleDefs() {
    var E = ENG();
    var keys = (E && E.SEAM_ROLES && E.SEAM_ROLES.length)
      ? E.SEAM_ROLES.slice()
      : Object.keys(SEAM_FALLBACK);
    keys = keys.filter(function (k) { return k !== FOLD_ROLE; });
    /* 현재 도면에 실제로 존재하는 변만 남깁니다 — 소매를 뺀 상태에서 '소매 밑단'
       입력란이 남아 있으면 값을 바꿔도 붙을 변이 없습니다.
       조각 구성이 바뀌면(소매 복원 등) 자동으로 따라옵니다. */
    var used = usedSeamRoles();
    if (used) keys = keys.filter(function (k) { return used[k]; });
    keys.sort(function (a, b) {
      var ia = SEAM_ROLE_ORDER.indexOf(a), ib = SEAM_ROLE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return keys.map(function (k) { return { key: k, label: SEAM_ROLE_LABEL[k] || k }; });
  }
  function seamRoleKeys() {
    var out = seamRoleDefs().map(function (r) { return r.key; });
    out.push(FOLD_ROLE);
    return out;
  }
  function zeroSeam() {
    var o = {}; seamRoleKeys().forEach(function (k) { o[k] = 0; }); return o;
  }
  function uniformSeam(v) {
    var o = {}; seamRoleKeys().forEach(function (k) { o[k] = v; }); o[FOLD_ROLE] = 0; return o;
  }
  /** 표준 프리셋 — 엔진 SEAM_DEFAULT 가 1순위, 그다음 seam:{} 제도 결과, 마지막이 SEAM_FALLBACK */
  var _stdSeamCache = null;
  function standardSeam() {
    if (_stdSeamCache) return copyObj(_stdSeamCache);
    var E = ENG(), src = null;
    if (E && E.SEAM_DEFAULT && typeof E.SEAM_DEFAULT === 'object') src = copyObj(E.SEAM_DEFAULT);
    if (!src) src = probeSeamByRole();
    _stdSeamCache = src || copyObj(SEAM_FALLBACK);
    _stdSeamCache[FOLD_ROLE] = 0;
    return copyObj(_stdSeamCache);
  }
  /** seam:{} (빈 객체)로 한 번 제도해 엔진이 채우는 role 별 기본값을 읽습니다.
      SPEC §11-1: "객체에서 누락된 role 은 표의 기본값을 씁니다" */
  function probeSeamByRole() {
    var E = ENG();
    if (!E || typeof E.draftVest !== 'function' || !state.m) return null;
    try {
      var sp = splitMeasures();
      var d = E.draftVest(sp.m, styleOpt({ seam: {} }));
      var merged = collectSeamByRole(d);
      return (merged && Object.keys(merged).length) ? merged : null;
    } catch (e) { return null; }
  }
  /** draft 의 모든 조각에서 seamByRole 을 모읍니다 (엔진이 실제로 적용한 값). */
  function collectSeamByRole(d) {
    if (!d || !d.pieces) return null;
    var out = null;
    d.pieces.forEach(function (p) {
      var sbr = p.seamByRole;
      if (!sbr && Array.isArray(p.edges)) {
        sbr = {};
        p.edges.forEach(function (e) { if (e && e.role && num(e.seam) !== null) sbr[e.role] = e.seam; });
        if (!Object.keys(sbr).length) sbr = null;
      }
      if (!sbr) return;
      out = out || {};
      for (var k in sbr) if (sbr.hasOwnProperty(k) && num(sbr[k]) !== null) out[k] = sbr[k];
    });
    return out;
  }
  function copyObj(o) { var r = {}, k; for (k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }
  function sameSeam(a, b) {
    var keys = seamRoleKeys();
    for (var i = 0; i < keys.length; i++) {
      if (Math.abs((a[keys[i]] || 0) - (b[keys[i]] || 0)) > 1e-6) return false;
    }
    return true;
  }
  function maxSeam(o) {
    var m = 0; seamRoleKeys().forEach(function (k) { if ((o[k] || 0) > m) m = o[k]; }); return m;
  }
  var SIDE_WARN_CM = 14.0;                     // SPEC §9-5 (2026-08-07 개정: 14.5→14.0.
                                               // 표준 77호가 정확히 14.000 이라 14.5 면 표준 치수에 경고가 떠 무의미해짐)

  /* SPEC §3.4 소매산 이세분 판정 */
  function easeGrade(v) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    if (v < 0.5 || v > 2.5) return 'fail';
    if (v < 1.0) return 'warn';
    return 'pass';
  }

  /* ─────────────────────────── 소형 유틸 ─────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function f2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  var V = {
    dist: function (a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  };
  function bboxOfPts(pts, box) {
    box = box || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p || typeof p[0] !== 'number') continue;
      if (p[0] < box.x0) box.x0 = p[0];
      if (p[0] > box.x1) box.x1 = p[0];
      if (p[1] < box.y0) box.y0 = p[1];
      if (p[1] > box.y1) box.y1 = p[1];
    }
    return box;
  }
  function d3(p) { return p[0].toFixed(3) + ',' + p[1].toFixed(3); }
  function pathOf(pts, close) {
    if (!pts || !pts.length) return '';
    return 'M ' + pts.map(d3).join(' L ') + (close ? ' Z' : '');
  }
  /** 엔진이 아직 키 이름을 확정하지 않은 값들을 여러 후보로 찾아 읽습니다. */
  function pick(obj, names) {
    if (!obj) return null;
    for (var i = 0; i < names.length; i++) {
      var v = num(obj[names[i]]);
      if (v !== null) return v;
    }
    return null;
  }

  function ENG() { return global.VestEngine; }
  function PRN() { return global.NoDartPrint; }

  /* ═══════════════════════════════════════════════════════════════════
     표준 치수 — 엔진이 유일한 출처. 이 파일에 SPEC §2 표 사본은 없습니다.
     소매길이는 measuresForSize 에 없으므로, sleeveLen 을 생략한 채 한 번 제도해
     엔진이 스스로 만든 기본값(measures.sleeveLen)을 읽어옵니다. 숫자 사본 없음.
     ═══════════════════════════════════════════════════════════════════ */
  function stdMeasures(size) {
    var E = ENG();
    if (!E || typeof E.measuresForSize !== 'function') return null;
    var m;
    try { m = E.measuresForSize(size); } catch (e) { return null; }
    if (!m || typeof m.B !== 'number') return null;
    var o = {}, k;
    for (k in m) if (m.hasOwnProperty(k)) o[k] = m[k];

    for (var i = 0; i < OPT_MEASURE_KEYS.length; i++) {
      var key = OPT_MEASURE_KEYS[i];
      if (o[key] !== undefined) continue;
      var probed = probeEngineDefault(o, key);
      if (probed !== null) o[key] = probed;
    }
    return o;
  }

  /** sleeveLen 등 opt 기본값을 엔진에서 역으로 읽습니다 (measures 에 되돌려주는 값 사용). */
  var _probeCache = {};
  function probeEngineDefault(m, key) {
    var E = ENG();
    if (!E || typeof E.draftVest !== 'function') return null;
    var ck = key + '@' + m.B;
    if (_probeCache[ck] !== undefined) return _probeCache[ck];
    var v = null;
    try {
      var d = E.draftVest(m, styleOpt({ seam: 0 }));
      v = (d && d.measures) ? num(d.measures[key]) : null;
    } catch (e) { v = null; }
    _probeCache[ck] = v;
    return v;
  }

  /** state.m 을 엔진 measurements 와 opt 로 분리합니다. */
  function splitMeasures() {
    var E = ENG();
    var engKeys = (E && E.MEAS_KEYS) ? E.MEAS_KEYS : null;
    var mm = {}, extra = {}, k;
    for (k in state.m) {
      if (!state.m.hasOwnProperty(k) || k.charAt(0) === '_') continue;
      var isEngine = engKeys ? (engKeys.indexOf(k) >= 0) : (OPT_MEASURE_KEYS.indexOf(k) < 0);
      if (isEngine) mm[k] = state.m[k]; else extra[k] = state.m[k];
    }
    return { m: mm, opt: extra };
  }
  /** 호수 목록 — 엔진의 SIZES 와, measuresForSize() 가 실제로 받아주는 후보 이름의 합집합.
      가슴둘레 오름차순 정렬. 숫자는 전부 엔진에서 옵니다 (SPEC §11-3). */
  var _sizesCache = null;
  function sizesList() {
    if (_sizesCache) return _sizesCache.slice();
    var E = ENG();
    if (!E || typeof E.measuresForSize !== 'function') return ['55호', '66호', '77호'];
    var names = {}, i;
    if (E.SIZES && E.SIZES.length) E.SIZES.forEach(function (s) { names[s] = 1; });
    for (i = 0; i < CANDIDATE_SIZES.length; i++) names[CANDIDATE_SIZES[i]] = 1;
    var ok = [];
    for (var n in names) {
      if (!names.hasOwnProperty(n)) continue;
      try {
        var m = E.measuresForSize(n);
        if (m && typeof m.B === 'number' && isFinite(m.B)) ok.push({ name: n, B: m.B });
      } catch (e) { /* 엔진이 모르는 호수 — 탭에 넣지 않음 */ }
    }
    if (!ok.length) return ['66호'];
    ok.sort(function (a, b) { return a.B - b.B; });
    _sizesCache = ok.map(function (r) { return r.name; });
    return _sizesCache.slice();
  }
  function labelOf(key) {
    var E = ENG();
    if (E && E.MEAS_LABEL && E.MEAS_LABEL[key]) return E.MEAS_LABEL[key];
    return LABEL_FALLBACK[key] || key;
  }
  function measureKeys(m) {
    var out = [], k;
    for (k in m) if (m.hasOwnProperty(k) && k.charAt(0) !== '_') out.push(k);
    return out;
  }
  function cloneM(m) {
    var o = {}, k;
    for (k in m) if (m.hasOwnProperty(k) && k.charAt(0) !== '_') o[k] = m[k];
    return o;
  }

  /* ═══════════════════════════════════════════════════════════════════
     스타일 입력
     ═══════════════════════════════════════════════════════════════════ */
  /** 조각 구성 select 에 현재 값을 반영합니다 (2조각 / 4조각) */
  function syncSplit() {
    if (els && els.split) els.split.value = String(state.split || 0);
  }

  function buildStyleFields() {
    syncSplit();
    if (!els.styleBox) return;
    els.styleBox.innerHTML = STYLE_KEYS.map(function (f) {
      var v = state.style[f.k];
      return '<label class="field"><span class="field-l">' + esc(f.label) + '</span>' +
        '<span class="numwrap"><input type="number" data-style="' + esc(f.k) + '"' +
        ' step="' + f.step + '" min="' + f.min + '" max="' + f.max + '"' +
        ' value="' + (v === undefined ? '' : (Math.round(v * 100) / 100)) + '"' +
        ' title="' + esc(f.hint) + '"><span class="unit">cm</span></span></label>';
    }).join('');
    Array.prototype.forEach.call(els.styleBox.querySelectorAll('input[data-style]'), function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.dataset.style, v = parseFloat(inp.value);
        var def = STYLE_KEYS.filter(function (f) { return f.k === k; })[0];
        if (!isFinite(v)) v = styleDefaults()[k];
        v = Math.min(def.max, Math.max(def.min, v));
        inp.value = Math.round(v * 100) / 100;
        state.style[k] = v;
        recompute(false);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     상태
     ═══════════════════════════════════════════════════════════════════ */
  /* ══ 앱 버전 · 빌드 시각 (SPEC §17-2) ═══════════════════════════════
     ND_BUILD 는 build.py 가 빌드할 때 심는 문자열입니다. 소스를 고쳐 다시 빌드했는데
     화면 배지의 시각이 그대로면 브라우저가 옛 HTML 을 들고 있는 것입니다(강제 새로고침).
     print.js 의 VERSION 은 출력 엔진 버전이라 이것과 별개입니다. */
  var APP_VERSION = '0.1.0';
  function buildStamp() {
    var b = (typeof window !== 'undefined' && window.ND_BUILD) ? String(window.ND_BUILD) : '';
    return 'v' + APP_VERSION + ' · ' + (b || '개발판');
  }

  /* ══ 브라우저 저장 (SPEC §17-3) ══════════════════════════════════════
     ⚠ 키를 반드시 모듈별로 가른다. 포터블은 앱 5개가 iframe srcdoc 이라
       부모 file:// origin 과 localStorage 를 **공유**한다. 게다가 기본원형과
       언더암다트는 DOM id 접두사(nd)까지 같아서 공용 키를 쓰면 서로 덮어쓴다.
     ND_APP 은 build.py 가 폴더명으로 심는다. 없으면 저장하지 않는다(오염 방지).
     file:// 이나 시크릿 창에서 localStorage 가 막히면 조용히 넘어간다 — 저장은
     편의 기능이라 여기서 앱이 멈추면 안 된다. */
  function storeKey(name) {
    var app = (typeof window !== 'undefined' && window.ND_APP) ? String(window.ND_APP) : '';
    return app ? ('여성복원형Suite:' + app + ':' + name) : '';
  }
  function storeGet(name) {
    var k = storeKey(name);
    if (!k) return null;
    try {
      var raw = window.localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function storeSet(name, val) {
    var k = storeKey(name);
    if (!k) return false;
    try {
      if (val === null || val === undefined) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, JSON.stringify(val));
      return true;
    } catch (e) { return false; }   // 용량 초과·차단 — 저장만 못 할 뿐 앱은 그대로 돈다
  }

  var state = {
    size: '55호',
    split: 1,              /* 1 = 암홀라인 절개 4조각(기본) · 0 = 몸판 통짜 2조각.
                              사용자 지정 2026-08-14 「절개선이 그려진 형태면 앞판·앞옆판·
                              뒤판·뒤옆판 4조각이어야 한다」 — 원문도 「이 조끼는 암홀라인」. */
    custom: false,
    m: null,
    printExclude: {},      // 인쇄에서 뺀 조각 id (SPEC §17-1). 비어 있으면 전부 인쇄

    seam: null,            // SPEC §11-1 부위별 시접 객체 {neck,shoulder,armhole,side,hem,sleeveHem,fold}
    seamPreset: 'standard',
    style: {},             // 스타일 값 (STYLE_KEYS) — 비어 있으면 엔진 기본값
    printMode: 'a4',
    rollWidthMm: 594,
    rollMaxHmm: 0,         // 롤지 한 장 최대 길이 — 0 = 연속 롤(기본). 컷시트 플로터면 841/1189
    overlapMm: 10,
    gapMm: 6,              // 네스팅 조각 간격 — 크면 종이가 낭비된다
    calibMm: 50,
    show: { dim: true, formula: true, seam: true, notch: true, inner: true, grid: true },
    view: { s: 8, tx: 60, ty: 40 },
    autoFit: true,
    draft: null,
    engineOk: false,
    lastError: '',
    layout: null
  };
  var engineWarn = '';
  var PX_PER_CM = 96 / 2.54;
  var els = {};
  var inited = false;

  /* ═══════════════════════════════════════════════════════════════════
     제도 호출
     ═══════════════════════════════════════════════════════════════════ */
  function computeDraft() {
    var E = ENG();
    state.lastError = '';
    if (!E || typeof E.draftVest !== 'function') {
      state.engineOk = false;
      state.draft = null;
      state.lastError = 'engine.js (window.VestEngine.draftVest) 를 찾을 수 없습니다.';
      return null;
    }
    var sp = splitMeasures();
    var seamOpt = copyObj(state.seam || standardSeam());
    seamOpt[FOLD_ROLE] = 0;                       // SPEC §11-1: 골선은 항상 0 강제
    var opt = {
      seam: seamOpt,
      size: state.size
    };
    styleOpt(opt);
    for (var ok in sp.opt) if (sp.opt.hasOwnProperty(ok)) opt[ok] = sp.opt[ok];
    opt.splitPanels = state.split;      // 조각 구성(2/4)은 스타일과 함께 넘긴다
    try {
      var d = E.draftVest(sp.m, opt);
      if (!d || !d.pieces || !d.pieces.length) throw new Error('draftVest 가 pieces 를 반환하지 않았습니다.');
      /* 설정끼리 모순이면 엔진이 알려 준다 (안단이 들어갈 자리보다 넓은 경우 등) */
      if (d.warnings && d.warnings.length) toast(d.warnings[0]);
      state.engineOk = true;
      state.draft = d;
      return d;
    } catch (e) {
      console.error('[NoDartUI] 제도 실패:', e);
      state.engineOk = false;
      state.draft = null;
      state.lastError = (e && e.message) || String(e);
      return null;
    }
  }

  /** 조각을 화면에서 가로로 나란히 배치 (엔진 좌표는 그대로, offset 만 계산)
      draw bbox = outline ∪ seamline. 밑단 시접 3.0 처럼 시접이 큰 부위가 있으면
      piece.bbox(=outline 기준)만 믿으면 시접선이 잘리므로 반드시 합집합을 씁니다. */
  function layoutPieces(draft) {
    var GAP = 8, cursorX = 0, out = [], all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    ((draft && draft.pieces) || []).forEach(function (p) {
      var ob = (p.bbox && typeof p.bbox.w === 'number' && p.bbox.w > 0)
        ? { x0: p.bbox.x, y0: p.bbox.y, x1: p.bbox.x + p.bbox.w, y1: p.bbox.y + p.bbox.h }
        : bboxOfPts(p.outline || []);
      var db = { x0: ob.x0, y0: ob.y0, x1: ob.x1, y1: ob.y1 };
      if (p.seamline && p.seamline.length) db = bboxOfPts(p.seamline, db);
      var bb = { x: ob.x0, y: ob.y0, w: ob.x1 - ob.x0, h: ob.y1 - ob.y0 };            // 완성선 기준 (라벨·치수선용)
      var draw = { x: db.x0, y: db.y0, w: db.x1 - db.x0, h: db.y1 - db.y0 };          // 시접 포함 (배치·맞춤용)
      var off = [cursorX - draw.x, -draw.y];
      out.push({ piece: p, off: off, bbox: bb, draw: draw });
      all.x0 = Math.min(all.x0, cursorX);
      all.x1 = Math.max(all.x1, cursorX + draw.w);
      all.y0 = Math.min(all.y0, 0);
      all.y1 = Math.max(all.y1, draw.h);
      cursorX += draw.w + GAP;
    });
    if (!out.length) all = { x0: 0, y0: 0, x1: 10, y1: 10 };
    return { items: out, bbox: { x: all.x0, y: all.y0, w: all.x1 - all.x0, h: all.y1 - all.y0 } };
  }

  /* ═══════════════════════════════════════════════════════════════════
     SVG 렌더
     ═══════════════════════════════════════════════════════════════════ */
  function renderSvg() {
    var svg = els.svg;
    if (!svg) return;
    var empty = !state.draft;
    els.canvasEmpty.hidden = !empty;
    els.canvasHint.hidden = empty;
    if (empty) {
      svg.innerHTML = '';
      els.canvasEmpty.querySelector('span').textContent =
        state.lastError || 'engine.js (window.VestEngine.draftVest) 를 ui.js 보다 먼저 로드하세요.';
      return;
    }

    var L = state.layout;
    var w = els.wrap.clientWidth || 800, h = els.wrap.clientHeight || 500;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    var defs = '<defs>' +
      '<marker id="ndArrowE" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#2f7d5b"/></marker>' +
      '<marker id="ndArrowS" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M9,1 L0,5 L9,9 z" fill="#2f7d5b"/></marker>' +
      '</defs>';

    /* 라벨은 조각 마크업에서 바로 찍지 않고 수집해 두었다가,
       전부 모인 뒤 충돌 회피를 거쳐 world 절대좌표로 한 번에 그립니다 (SPEC §11-2). */
    var labels = [];      // 배치 대상
    var fixed = [];       // 고정 장애물 (조각 라벨·치수선 글자 등)

    var body = '';
    if (state.show.grid) body += gridMarkup(L.bbox);
    (L.items || []).forEach(function (it, idx) {
      body += '<g transform="translate(' + it.off[0].toFixed(3) + ',' + it.off[1].toFixed(3) + ')">' +
        pieceMarkup(it.piece, it.bbox, it.off, idx, labels, fixed) + '</g>';
    });
    body += placeLabels(labels, fixed, L);

    svg.innerHTML = defs + '<g id="ndWorld" font-size="' + (12 / state.view.s).toFixed(4) + '">' + body + '</g>';
    applyTransform();
  }

  /* ═══════════════════════════════════════════════════════════════════
     라벨 충돌 회피 (SPEC §11-2)
     · 화면 px 공간에서 사각형 겹침을 검사하고 수직으로 밀어냅니다(위/아래 번갈아, 3라운드).
     · 밀려난 라벨은 지시선으로 앵커와 연결.
     · 3라운드로도 안 되면 숨기고 호버 시에만 표시.
     · 인접 조각 bbox 는 약한 벌점(피할 수 있으면 피하되, 그 때문에 숨기지는 않음).
     · 글자 크기가 12/scale 로 고정이라 배율이 바뀌면 다시 배치해야 합니다
       (renderSvg 가 통째로 다시 도므로 자동. 확대/축소 중에는 아래 zoomAt 이 디바운스).
     ═══════════════════════════════════════════════════════════════════ */
  var _labelStats = { total: 0, placed: 0, displaced: 0, hidden: 0, overlaps: 0 };
  var COLLIDE_OFF = false;   // NoDartUI.setCollisionAvoidance(false) — 회피 전/후 비교용

  var _measCtx = null, _measCache = {};
  function textWidthPx(txt, fontPx, bold) {
    var key = fontPx + '|' + (bold ? 'b' : '') + '|' + txt;
    if (_measCache[key] != null) return _measCache[key];
    var w;
    if (!_measCtx && typeof document.createElement === 'function') {
      try { _measCtx = document.createElement('canvas').getContext('2d'); } catch (e) { _measCtx = null; }
    }
    if (_measCtx) {
      _measCtx.font = (bold ? '600 ' : '') + fontPx + 'px -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif';
      w = _measCtx.measureText(txt).width;
    } else {
      /* canvas 가 없는 환경(jsdom 등) — 한글 1.0em, 그 외 0.55em 로 근사 */
      w = 0;
      for (var i = 0; i < txt.length; i++) w += (txt.charCodeAt(i) > 0x2000 ? 1.0 : 0.55) * fontPx;
    }
    _measCache[key] = w;
    return w;
  }
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  function overlapArea(a, b) {
    var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox > 0 && oy > 0) ? ox * oy : 0;
  }

  /** 라벨 후보 등록 — world 절대좌표(조각 offset 적용 후) */
  function pushLabel(bag, off, rec) {
    bag.push({
      ax: rec.at[0] + off[0], ay: rec.at[1] + off[1],
      text: rec.text, full: rec.full || rec.text,
      cls: rec.cls || 't-inner', em: rec.em || 0.8,
      anchorEnd: !!rec.anchorEnd, piece: rec.piece
    });
  }
  /** 고정 장애물 등록 (밀지 않고 자리만 차지) */
  function pushFixed(bag, off, at, text, em, anchorEnd, bold) {
    bag.push({ ax: at[0] + off[0], ay: at[1] + off[1], text: text, em: em || 0.8, anchorEnd: !!anchorEnd, bold: !!bold });
  }

  function placeLabels(labels, fixed, L) {
    var v = state.view, s = v.s;
    var BASE_PX = 12;
    _labelStats = { total: labels.length, placed: 0, displaced: 0, hidden: 0, overlaps: 0 };
    if (!labels.length) return '';

    /* 실제 렌더 글리프 상자보다 살짝 크게 잡아야 1px 스침이 안 남습니다
       (브라우저 text bbox 는 폰트 ascent/descent 때문에 font-size 보다 큽니다). */
    function boxOf(rec, dyPx) {
      var fpx = BASE_PX * rec.em;
      var w = textWidthPx(rec.text, fpx) + 3;
      var h = fpx * 1.5;
      var sx = v.tx + s * rec.ax, sy = v.ty + s * rec.ay + (dyPx || 0);
      return { x: rec.anchorEnd ? sx - w : sx, y: sy - fpx * 1.02, w: w, h: h, fpx: fpx };
    }

    /* 고정 장애물 사각형 */
    var occupied = [];
    fixed.forEach(function (f) {
      var fpx = BASE_PX * f.em, w = textWidthPx(f.text, fpx, f.bold) + 2;
      var sx = v.tx + s * f.ax, sy = v.ty + s * f.ay;
      occupied.push({ x: f.anchorEnd ? sx - w : sx, y: sy - fpx * 0.86, w: w, h: fpx * 1.22 });
    });

    /* 인접 조각 영역 (약한 벌점용) */
    var pieceRects = (L.items || []).map(function (it) {
      return {
        x: v.tx + s * (it.draw.x + it.off[0]), y: v.ty + s * (it.draw.y + it.off[1]),
        w: s * it.draw.w, h: s * it.draw.h
      };
    });

    /* 위에서 아래로, 왼쪽에서 오른쪽으로 배치하면 밀어내기가 안정적입니다 */
    var order = labels.map(function (r, i) { return i; });
    order.sort(function (a, b) {
      return (labels[a].ay - labels[b].ay) || (labels[a].ax - labels[b].ax);
    });

    var out = [], placedBoxes = [];
    order.forEach(function (idx) {
      var rec = labels[idx];
      var base = boxOf(rec, 0);
      var step = base.h + 1;
      /* 0 → ±1 → ±2 → ±3 (3라운드).  _noCollide 는 회피 전/후 비교용 디버그 스위치 */
      var cands = COLLIDE_OFF ? [0] : [0, -step, step, -2 * step, 2 * step, -3 * step, 3 * step];
      var best = null;
      for (var ci = 0; ci < cands.length; ci++) {
        var dy = cands[ci], bx = boxOf(rec, dy), cost = 0, j;
        for (j = 0; j < placedBoxes.length; j++) cost += overlapArea(bx, placedBoxes[j]) * 10;
        for (j = 0; j < occupied.length; j++) cost += overlapArea(bx, occupied[j]) * 6;
        for (j = 0; j < pieceRects.length; j++) {
          if (j === rec.piece) continue;
          cost += overlapArea(bx, pieceRects[j]) * 0.02;   // 인접 조각은 약한 벌점
        }
        cost += Math.abs(dy) * 0.6;
        if (best === null || cost < best.cost) best = { cost: cost, dy: dy, box: bx };
        if (cost === 0) break;
      }

      /* 라벨끼리 실제로 겹치는 양만 따로 계산 — 이게 남으면 숨김 */
      var hardOverlap = 0;
      for (var k = 0; k < placedBoxes.length; k++) hardOverlap += overlapArea(best.box, placedBoxes[k]);

      var worldDy = best.dy / s;
      var lx = rec.ax, ly = rec.ay + worldDy;

      if (!COLLIDE_OFF && hardOverlap > base.h * 1.2) {
        /* 3라운드로도 자리가 없음 → 숨기고 호버 시에만 (앵커에 작은 점) */
        _labelStats.hidden++;
        var hw = best.box.w / s, hh = best.box.h / s;
        var hx = rec.anchorEnd ? rec.ax - hw : rec.ax;
        out.push('<g class="lblhide">' +
          '<title>' + esc(rec.full) + '</title>' +
          '<circle class="lbl-dot" cx="' + rec.ax.toFixed(3) + '" cy="' + rec.ay.toFixed(3) + '" r="' + (2.5 / s).toFixed(4) + '"/>' +
          '<circle class="lbl-hit" cx="' + rec.ax.toFixed(3) + '" cy="' + rec.ay.toFixed(3) + '" r="' + (7 / s).toFixed(4) + '"/>' +
          '<rect class="lblhide-bg" x="' + hx.toFixed(3) + '" y="' + (ly - hh * 0.86).toFixed(3) + '" width="' + hw.toFixed(3) + '" height="' + hh.toFixed(3) + '" rx="' + (2 / s).toFixed(4) + '"/>' +
          '<text class="' + rec.cls + ' lblhide-txt"' + (rec.anchorEnd ? ' text-anchor="end"' : '') +
          ' x="' + rec.ax.toFixed(3) + '" y="' + ly.toFixed(3) + '">' + esc(rec.text) + '</text>' +
          '</g>');
        return;
      }

      placedBoxes.push(best.box);
      _labelStats.placed++;
      if (best.dy !== 0) {
        _labelStats.displaced++;
        /* 지시선 — 앵커점 → 라벨 기준점 (수직) */
        out.push('<path class="leader" d="M' + rec.ax.toFixed(3) + ',' + rec.ay.toFixed(3) +
          'L' + rec.ax.toFixed(3) + ',' + (ly - (best.dy > 0 ? base.h / s * 0.8 : -base.h / s * 0.2)).toFixed(3) + '"/>' +
          '<circle class="lbl-dot" cx="' + rec.ax.toFixed(3) + '" cy="' + rec.ay.toFixed(3) + '" r="' + (1.6 / s).toFixed(4) + '"/>');
      }
      out.push('<text class="' + rec.cls + '"' + (rec.anchorEnd ? ' text-anchor="end"' : '') +
        ' x="' + rec.ax.toFixed(3) + '" y="' + ly.toFixed(3) + '">' +
        (rec.text === rec.full ? '' : '<title>' + esc(rec.full) + '</title>') + esc(rec.text) + '</text>');
    });

    /* 최종 겹침 개수(쌍) — 보고·회귀 검사용 */
    for (var a = 0; a < placedBoxes.length; a++) {
      for (var b = a + 1; b < placedBoxes.length; b++) {
        if (rectsOverlap(placedBoxes[a], placedBoxes[b])) _labelStats.overlaps++;
      }
    }
    return '<g class="labels">' + out.join('') + '</g>';
  }

  function gridMarkup(bb) {
    var pad = 6;
    var x0 = Math.floor(bb.x - pad), x1 = Math.ceil(bb.x + bb.w + pad);
    var y0 = Math.floor(bb.y - pad), y1 = Math.ceil(bb.y + bb.h + pad);
    var minorOn = state.view.s >= 4.2;
    var mn = [], mj = [], x, y;
    for (x = x0; x <= x1; x++) {
      var seg = 'M' + x + ',' + y0 + 'V' + y1;
      if (((x % 5) + 5) % 5 === 0) mj.push(seg); else if (minorOn) mn.push(seg);
    }
    for (y = y0; y <= y1; y++) {
      var seg2 = 'M' + x0 + ',' + y + 'H' + x1;
      if (((y % 5) + 5) % 5 === 0) mj.push(seg2); else if (minorOn) mn.push(seg2);
    }
    return (mn.length ? '<path class="gridmn" d="' + mn.join(' ') + '"/>' : '') +
      '<path class="gridmj" d="' + mj.join(' ') + '"/>';
  }

  /* 엔진이 internal[].label 에 긴 문구를 넣는 경우 도면에서는 줄여 찍습니다.
     (SPEC §8.1 은 짧은 이름을 요구하지만 방어) */
  var LABEL_MAX = 13;
  function shortLabel(s) {
    s = String(s);
    if (s.length <= LABEL_MAX) return s;
    var cut = s.slice(0, LABEL_MAX), sp = cut.lastIndexOf(' ');
    if (sp >= 5) cut = cut.slice(0, sp);
    return cut + '…';
  }
  function innerLabelRec(label, at, pieceIdx) {
    var full = String(label);
    return { at: at, text: state.show.formula ? full : shortLabel(full), full: full, cls: 't-inner', em: 0.8, piece: pieceIdx };
  }
  function labelAnchor(pts) {
    var a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) return a[0] > b[0] ? a : b;
    return a[1] < b[1] ? a : b;
  }

  /** 골선(CB·CF) — piece.foldEdges 가 있을 때만 그립니다.
      소매는 SPEC §3.4 에 따라 foldEdges: [] 이므로 아무것도 그리지 않습니다. */
  function foldMarkup(p, off, fixed) {
    var fe = p.foldEdges;
    if (!Array.isArray(fe) || !fe.length) return '';
    var o = p.outline || [];
    if (o.length < 2) return '';
    var s = '', drew = false, mid = null;
    for (var i = 0; i < fe.length; i++) {
      var r = fe[i];
      if (!Array.isArray(r) || r.length < 2) continue;
      var a = r[0] | 0, b = r[1] | 0;
      if (a < 0 || b < 0 || a >= o.length || b >= o.length) continue;
      var seg = [];
      if (a <= b) { for (var j = a; j <= b; j++) seg.push(o[j]); }
      else { for (var j2 = a; j2 < o.length; j2++) seg.push(o[j2]); for (var j3 = 0; j3 <= b; j3++) seg.push(o[j3]); }
      if (seg.length < 2) continue;
      s += '<path class="fold" d="' + pathOf(seg, false) + '"/>';
      drew = true;
      if (!mid) mid = seg[Math.floor(seg.length / 2)];
    }
    if (drew && mid) {
      s += '<text class="t-fold" x="' + (mid[0] - 0.4).toFixed(2) + '" y="' + mid[1].toFixed(2) +
        '" text-anchor="end">골선</text>';
      if (fixed && off) pushFixed(fixed, off, [mid[0] - 0.4, mid[1]], '골선', 0.8, true, true);
    }
    return s;
  }

  function pieceMarkup(p, bb, off, pieceIdx, labels, fixed) {
    var s = '', i;
    var outline = p.outline || [];

    if (state.show.inner && p.internal) {
      for (i = 0; i < p.internal.length; i++) {
        var it = p.internal[i], pts = it.pts || [];
        if (!pts.length) continue;
        if (it.type === 'point') {
          s += '<circle class="pt" cx="' + pts[0][0].toFixed(3) + '" cy="' + pts[0][1].toFixed(3) + '" r="0.16"/>';
          if (it.label) pushLabel(labels, off, innerLabelRec(it.label, [pts[0][0] + 0.35, pts[0][1] - 0.3], pieceIdx));
        } else {
          /* 'edge' = 외곽선과 같은 굵기 — 다트 다리처럼 실제로 접어 꿰매는 선 */
          s += '<path class="' + (it.type === 'dashed' ? 'inner-d' : it.type === 'edge' ? 'fin' : 'inner') +
               '" d="' + pathOf(pts, false) + '"/>';
          if (it.label && state.show.dim) {
            var e = labelAnchor(pts);
            pushLabel(labels, off, innerLabelRec(it.label, [e[0] + 0.3, e[1] - 0.28], pieceIdx));
          }
        }
      }
    }

    if (state.show.seam && maxSeam(state.seam || {}) > 0 && p.seamline && p.seamline.length) {
      s += '<path class="sa" d="' + pathOf(p.seamline, true) + '"/>';
    }

    s += '<path class="fin" d="' + pathOf(outline, true) + '"/>';
    s += foldMarkup(p, off, fixed);

    if (p.grainline && p.grainline.length === 2) s += '<path class="grain" d="' + pathOf(p.grainline, false) + '"/>';

    if (state.show.notch && p.notches) {
      for (i = 0; i < p.notches.length; i++) {
        var nt = p.notches[i];
        if (!nt || !nt.p) continue;
        /* SPEC §8.1: angle 은 도(degree), 0° = +x, 시계방향 +, 조각 안쪽 방향, 표시선 0.5cm */
        var a = (typeof nt.angle === 'number' && isFinite(nt.angle)) ? nt.angle : null;
        if (a === null) {
          s += '<path class="notch" d="M' + (nt.p[0] - 0.3).toFixed(3) + ',' + (nt.p[1] - 0.3).toFixed(3) +
            'L' + (nt.p[0] + 0.3).toFixed(3) + ',' + (nt.p[1] + 0.3).toFixed(3) +
            'M' + (nt.p[0] - 0.3).toFixed(3) + ',' + (nt.p[1] + 0.3).toFixed(3) +
            'L' + (nt.p[0] + 0.3).toFixed(3) + ',' + (nt.p[1] - 0.3).toFixed(3) + '"/>';
        } else {
          var rad = a * Math.PI / 180;
          s += '<path class="notch" d="M' + nt.p[0].toFixed(3) + ',' + nt.p[1].toFixed(3) +
            'L' + (nt.p[0] + Math.cos(rad) * 0.5).toFixed(3) + ',' + (nt.p[1] + Math.sin(rad) * 0.5).toFixed(3) + '"/>';
        }
      }
    }

    s += '<text class="t-name" x="' + (bb.x + bb.w * 0.5).toFixed(2) + '" y="' + (bb.y + bb.h * 0.62).toFixed(2) + '">' +
      esc(p.name || p.id || '') + '</text>';

    /* 조각 배지·치수 글자는 밀지 않는 고정 요소 — 자리만 장애물로 등록 */
    var badge = (p.name || p.id) + ' · ' + (p.cutCount || 2) + '매 · ' + f1(bb.w) + '×' + f1(bb.h) + 'cm';
    s += '<text class="t-badge" x="' + bb.x.toFixed(2) + '" y="' + (bb.y - 1.2).toFixed(2) + '">' + esc(badge) + '</text>';
    pushFixed(fixed, off, [bb.x, bb.y - 1.2], badge, 0.95, false, true);

    if (state.show.dim) s += dimMarkup(bb, off, fixed);
    if (state.show.formula) s += formulaMarkup(p, off, pieceIdx, labels);
    return s;
  }

  function dimMarkup(bb, off, fixed) {
    var o = 1.6, t = 0.32, s = '';
    var yB = bb.y + bb.h + o, xR = bb.x + bb.w + o;
    s += '<path class="dim" d="M' + bb.x + ',' + yB.toFixed(2) + 'H' + (bb.x + bb.w).toFixed(2) + '"/>';
    s += '<path class="dimtick" d="M' + bb.x + ',' + (yB - t).toFixed(2) + 'v' + (t * 2).toFixed(2) +
      'M' + (bb.x + bb.w).toFixed(2) + ',' + (yB - t).toFixed(2) + 'v' + (t * 2).toFixed(2) + '"/>';
    s += '<text class="t-dim" text-anchor="middle" x="' + (bb.x + bb.w / 2).toFixed(2) + '" y="' + (yB - 0.35).toFixed(2) + '">' + f1(bb.w) + '</text>';
    s += '<path class="dim" d="M' + xR.toFixed(2) + ',' + bb.y.toFixed(2) + 'V' + (bb.y + bb.h).toFixed(2) + '"/>';
    s += '<path class="dimtick" d="M' + (xR - t).toFixed(2) + ',' + bb.y.toFixed(2) + 'h' + (t * 2).toFixed(2) +
      'M' + (xR - t).toFixed(2) + ',' + (bb.y + bb.h).toFixed(2) + 'h' + (t * 2).toFixed(2) + '"/>';
    s += '<text class="t-dim" x="' + (xR + 0.3).toFixed(2) + '" y="' + (bb.y + bb.h / 2).toFixed(2) + '">' + f1(bb.h) + '</text>';
    if (fixed) pushFixed(fixed, off, [xR + 0.3, bb.y + bb.h / 2], f1(bb.h), 0.85, false, false);
    return s;
  }

  /* SPEC §8.1 확정 구조: {id, label, formula, value, piece, anchor:[x,y]}
     (구버전 {p, text} · 문자열도 계속 받습니다) */
  function noteText(n) {
    if (typeof n === 'string') return n;
    if (!n || typeof n !== 'object') return '';
    if (n.formula !== undefined || n.value !== undefined) {
      return (n.label ? n.label + ' = ' : '') + (n.formula || '') +
        (n.value !== undefined && n.value !== null ? ' = ' + f2(n.value) : '');
    }
    return n.text || '';
  }
  function noteAnchor(n) {
    if (!n || typeof n !== 'object') return null;
    if (Array.isArray(n.anchor) && n.anchor.length === 2) return n.anchor;
    if (Array.isArray(n.p) && n.p.length === 2) return n.p;
    return null;
  }
  function formulaMarkup(p, off, pieceIdx, labels) {
    var notes = (state.draft.meta && state.draft.meta.formulaNotes) || [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i], at = noteAnchor(n);
      if (!at) continue;
      if (n.piece && n.piece !== 'both' && n.piece !== p.id) continue;
      var t = noteText(n);
      if (!t) continue;
      pushLabel(labels, off, {
        at: [+at[0], +at[1]], text: t, full: t, cls: 't-formula', em: 0.8,
        anchorEnd: !!(n.anchorEnd || n.textAnchor === 'end'), piece: pieceIdx
      });
    }
    return '';
  }

  function applyTransform() {
    var g = els.svg && els.svg.querySelector('#ndWorld');
    if (!g) return;
    var v = state.view;
    g.setAttribute('transform', 'translate(' + v.tx.toFixed(2) + ',' + v.ty.toFixed(2) + ') scale(' + v.s.toFixed(5) + ')');
    g.setAttribute('font-size', (12 / v.s).toFixed(4));
    if (els.zoomVal) els.zoomVal.textContent = Math.round(v.s / PX_PER_CM * 100) + '%';
  }

  function fitView() {
    var raw = state.layout ? state.layout.bbox : { x: 0, y: 0, w: 60, h: 45 };
    var MG = 3;
    var bb = { x: raw.x - MG, y: raw.y - MG, w: raw.w + MG * 2, h: raw.h + MG * 2 };
    var w = els.wrap.clientWidth || 800, h = els.wrap.clientHeight || 500, pad = 16;
    var s = Math.min((w - pad * 2) / Math.max(bb.w, 1), (h - pad * 2) / Math.max(bb.h, 1));
    if (!isFinite(s) || s <= 0) s = 8;
    state.view.s = s;
    state.view.tx = (w - bb.w * s) / 2 - bb.x * s;
    state.view.ty = (h - bb.h * s) / 2 - bb.y * s;
    state.autoFit = true;
    renderSvg();
  }

  /* 확대/축소 — 즉시 반응은 transform 만 갱신(싸다), 라벨 재배치·모눈 밀도는 디바운스.
     라벨 글자 크기가 12/scale 로 고정이라 배율이 바뀌면 반드시 다시 배치해야 합니다(SPEC §11-2). */
  var _zoomT = 0;
  function zoomAt(factor, cx, cy) {
    var v = state.view;
    var ns = Math.max(0.4, Math.min(220, v.s * factor));
    if (ns === v.s) return;
    v.tx = cx - (cx - v.tx) * (ns / v.s);
    v.ty = cy - (cy - v.ty) * (ns / v.s);
    v.s = ns;
    state.autoFit = false;
    applyTransform();                    // 즉시 반영
    clearTimeout(_zoomT);
    _zoomT = setTimeout(function () { renderSvg(); }, 90);   // 라벨 재배치
  }

  /* ═══════════════════════════════════════════════════════════════════
     좌측 패널
     ═══════════════════════════════════════════════════════════════════ */
  function buildFields() {
    var keys = state.m ? measureKeys(state.m) : [];
    var html = '';
    keys.forEach(function (k) {
      html += '<div class="field" data-key="' + k + '">' +
        '<label for="nd_' + k + '">' + esc(labelOf(k)) +
        (FIELD_NOTE[k] ? '<span class="sublab">' + esc(FIELD_NOTE[k]) + '</span>' : '') + '</label>' +
        '<span class="delta" data-delta="' + k + '"></span>' +
        '<input type="number" id="nd_' + k + '" step="0.1" inputmode="decimal">' +
        '</div>';
    });
    els.fields.innerHTML = html;
    keys.forEach(function (k) {
      var inp = $('nd_' + k);
      inp.addEventListener('input', function () {
        var v = parseFloat(inp.value);
        if (!isFinite(v)) return;
        state.m[k] = v;
        refreshCustomFlag();
        recompute(false);
      });
      inp.addEventListener('blur', function () {
        var v = parseFloat(inp.value);
        inp.value = f1(isFinite(v) ? v : state.m[k]);
      });
    });
  }

  /* ── 부위별 시접 입력 (SPEC §11-1) ── */
  function buildSeamRoles() {
    els.seamRoles.innerHTML = seamRoleDefs().map(function (r) {
      return '<div class="role" data-role="' + r.key + '">' +
        '<label for="ndSeam_' + r.key + '">' + esc(r.label) + '</label>' +
        '<input type="number" id="ndSeam_' + r.key + '" min="0" max="10" step="0.1" inputmode="decimal">' +
        '</div>';
    }).join('');
    seamRoleDefs().forEach(function (r) {
      var inp = $('ndSeam_' + r.key);
      inp.addEventListener('input', function () {
        var v = parseFloat(inp.value);
        if (!isFinite(v) || v < 0) return;
        state.seam[r.key] = v;
        state.seam[FOLD_ROLE] = 0;
        state.seamPreset = detectPreset(state.seam);
        syncSeamUI();
        recompute(false);
      });
      inp.addEventListener('blur', function () {
        var v = parseFloat(inp.value);
        inp.value = f1(isFinite(v) && v >= 0 ? v : state.seam[r.key]);
      });
    });
  }
  function detectPreset(sm) {
    var k;
    for (k in SEAM_PRESETS) {
      if (SEAM_PRESETS.hasOwnProperty(k) && sameSeam(sm, SEAM_PRESETS[k]())) return k;
    }
    return 'custom';
  }
  function syncSeamUI() {
    var std = standardSeam();
    seamRoleDefs().forEach(function (r) {
      var inp = $('ndSeam_' + r.key);
      if (!inp) return;
      if (document.activeElement !== inp) inp.value = f1(state.seam[r.key] || 0);
      var row = els.seamRoles.querySelector('.role[data-role="' + r.key + '"]');
      if (row) row.classList.toggle('is-diff', Math.abs((state.seam[r.key] || 0) - (std[r.key] || 0)) > 1e-6);
    });
    Array.prototype.forEach.call(els.seamPreset.querySelectorAll('.seg-btn'), function (b) {
      b.classList.toggle('is-on', b.dataset.preset === state.seamPreset);
    });
  }
  /** 엔진이 실제로 적용한 부위별 시접을 표시 (입력값을 그대로 믿지 않음 — SPEC §11-1) */
  function renderSeamApplied() {
    var applied = collectSeamByRole(state.draft);
    if (!applied) {
      els.seamApplied.hidden = false;
      els.seamAppliedSrc.textContent = '';
      els.seamAppliedBody.innerHTML =
        '<span class="mis">엔진이 seamByRole / edges[].seam 을 돌려주지 않습니다.</span><br>' +
        '아래 입력값은 요청값이며 실제 적용 여부는 확인되지 않았습니다. (engine.js §11-1 대기)';
      return;
    }
    els.seamApplied.hidden = false;
    els.seamAppliedSrc.textContent = '(piece.seamByRole)';
    var rows = [];
    seamRoleDefs().concat([{ key: FOLD_ROLE, label: SEAM_ROLE_LABEL[FOLD_ROLE] }]).forEach(function (r) {
      var a = num(applied[r.key]);
      if (a === null) return;
      var want = (r.key === FOLD_ROLE) ? 0 : (state.seam[r.key] || 0);
      var mismatch = Math.abs(a - want) > 1e-6;
      rows.push(esc(r.label) + ' <b>' + f1(a) + '</b>' +
        (mismatch ? ' <span class="mis">(요청 ' + f1(want) + ')</span>' : ''));
    });
    els.seamAppliedBody.innerHTML = rows.join(' · ') || '—';
  }

  function syncFields() {
    if (!state.m) return;
    var std = stdMeasures(state.size) || {};
    measureKeys(state.m).forEach(function (k) {
      var inp = $('nd_' + k);
      if (!inp) return;
      if (document.activeElement !== inp) inp.value = f1(state.m[k]);
      var row = els.fields.querySelector('.field[data-key="' + k + '"]');
      var dl = els.fields.querySelector('[data-delta="' + k + '"]');
      var diff = Math.round((state.m[k] - std[k]) * 100) / 100;
      if (row && dl) {
        if (Math.abs(diff) > 0.001) { row.classList.add('is-custom'); dl.textContent = (diff > 0 ? '+' : '') + f1(diff); }
        else { row.classList.remove('is-custom'); dl.textContent = ''; }
      }
    });
  }

  function refreshCustomFlag() {
    var std = stdMeasures(state.size), custom = false;
    if (std && state.m) {
      measureKeys(state.m).forEach(function (k) {
        if (Math.abs(state.m[k] - std[k]) > 0.001) custom = true;
      });
    }
    state.custom = custom;
    els.stateBadge.textContent = custom ? '사용자 지정' : '표준 치수';
    els.stateBadge.setAttribute('data-state', custom ? 'custom' : 'std');
  }

  /* ═══════════════════════════════════════════════════════════════════
     우측 요약
     ═══════════════════════════════════════════════════════════════════ */
  function put(id, v, cls) {
    var e = $(id);
    if (!e) return;
    e.textContent = (typeof v === 'number' && isFinite(v)) ? f2(v) : (typeof v === 'string' ? v : '—');
    e.className = 'v' + (cls ? ' v-' + cls : '');
  }
  function mark(id, kind, txt) {
    var e = $(id);
    if (!e) return;
    if (!kind) { e.textContent = ''; e.className = 'n'; return; }
    e.textContent = txt || (kind === 'pass' ? '✓' : kind === 'warn' ? '!' : '!');
    e.className = 'n n-' + kind;
  }

  function renderSummary() {
    var d = state.draft;
    var M = (d && d.measures) || {};
    var checks = [];

    put('sumShB', num(M.shoulderBack)); put('sumShF', num(M.shoulderFront)); put('sumShE', num(M.shoulderEase));
    put('sumAhB', num(M.armholeBack)); put('sumAhF', num(M.armholeFront)); put('sumAhT', num(M.armholeTotal));
    put('sumNkB', num(M.neckBack)); put('sumNkF', num(M.neckFront)); put('sumNkT', num(M.neckTotal));
    put('sumSdB', num(M.sideBack)); put('sumSdF', num(M.sideFront));

    /* 어깨 이세분 — ★ 이 원형은 이세로 먹이지 않고 **어깨 다트(뒤 1.3)·벌림(앞 0.6)**
       으로 처리한다. 접으면 앞뒤 어깨가 같아지므로 이세분은 0 이 정상이다.
       원형2 의 「0.3~0.6」 검사를 복붙해 둔 탓에 항상 거짓 경보였다 (2026-08-12 QA). */
    var ease = num(M.shoulderEase);
    if (ease !== null) {
      var ok = Math.abs(ease) <= 0.05;
      mark('sumShEok', ok ? 'pass' : 'fail');
      checks.push({ k: ok ? 'ok' : 'bad',
        t: ok ? '어깨 이세분 0 — 어깨 다트·벌림으로 처리한다'
              : '어깨 이세분 ' + f2(ease) + ' cm — 이 원형은 0 이어야 한다' });
    } else mark('sumShEok', null);

    /* 어깨 솔기 — 다트를 접은 뒤 앞뒤가 같아야 한다 (|뒤 − 앞| = 이세분 = 0). */
    /* 엔진이 내보내는 키 이름을 쓴다 — 옛 이름(shoulderBackSeam)을 읽어 항상 null 이라
       **검사가 조용히 건너뛰어졌다** (2026-08-12 QA). 없는 키를 읽으면 통과도 실패도 안 한다. */
    var sbs = num(M.shoulderBackSeam !== undefined ? M.shoulderBackSeam : M.shoulderBackSewn),
        sfs = num(M.shoulderFrontSeam !== undefined ? M.shoulderFrontSeam : M.shoulderFrontSewn);
    if (sbs !== null && sfs !== null) {
      var dd = Math.abs(sbs - sfs);
      var okS = (ease === null) ? dd <= 0.10 : Math.abs(dd - ease) <= 0.05;
      put('sumShSeam', f2(sbs) + ' / ' + f2(sfs));
      mark('sumShSeamok', okS ? 'pass' : 'fail');
      checks.push({ k: okS ? 'ok' : 'bad',
        t: '어깨 솔기 차 ' + f2(dd) + ' cm = 이세분 ' + (ease === null ? '—' : f2(ease)) +
           (okS ? ' (뒤를 이세로 먹인다)' : ' — 어긋남') });
    } else { put('sumShSeam', '—'); mark('sumShSeamok', null); }

    /* 옆선 — SPEC §5-2 일치 + §9-5 진동깊이 경고 */
    var sb = num(M.sideBack), sf = num(M.sideFront);
    var sideWarnOn = false, minSide = null;
    if (sb !== null && sf !== null) {
      /* 앞 옆선은 **다트분만큼 길게 재단**하고 접으면 뒤와 같아진다 (앞 등길이 차이치수 = 다트분) */
      var sfSewn = num(M.sideFrontSewn !== undefined ? M.sideFrontSewn : M.sideFront);
      var diff = Math.abs(sb - (sfSewn === null ? sf : sfSewn)), okSide = diff <= 0.05;
      checks.push({ k: okSide ? 'ok' : 'bad',
        t: okSide ? ('앞뒤 옆선 일치 — 앞 재단 ' + f2(sf) + ' 에서 다트분을 접으면 ' + f2(sfSewn) + ' = 뒤 ' + f2(sb))
                  : ('다트를 접은 뒤 앞뒤 옆선 차이 ' + f2(diff) + ' cm') });
      minSide = Math.min(sb, sfSewn === null ? sf : sfSewn);
      sideWarnOn = minSide < SIDE_WARN_CM;
      mark('sumSdBok', sb < SIDE_WARN_CM ? 'fail' : (okSide ? 'pass' : 'fail'));
      mark('sumSdFok', okSide ? 'pass' : 'fail');
      put('sumSdB', sb, sb < SIDE_WARN_CM ? 'fail' : null);
      put('sumSdF', sf);
    } else { mark('sumSdBok', null); mark('sumSdFok', null); }

    els.sideWarn.hidden = !sideWarnOn;
    if (sideWarnOn) {
      els.sideWarnDetail.textContent =
        '옆선 ' + f2(minSide) + ' cm (기준 ' + f1(SIDE_WARN_CM) + ' cm 미만). ' +
        '가슴선 B/4 는 호수당 +1.5 로 커지는데 등길이는 +0.5 라서 큰 호수일수록 옆선이 짧아집니다. ' +
        '등길이를 늘리면 옆선이 회복됩니다.';
      checks.push({ k: 'bad', t: '진동이 깊습니다 — 옆선 ' + f2(minSide) + ' cm < ' + f1(SIDE_WARN_CM) });
    }

    /* ── 소매는 이 앱에서 제외되었습니다 (2026-08-07 사용자 결정) ──
       제공된 반소매 도면이 '숙녀복기본원형1 반소매 47P' 로 이 몸판(무다트 원형)과
       다른 원형의 소매이고(AH 42.82 vs 47.19), 긴소매는 제도법 자체가 다릅니다.
       엔진에 코드는 남아 있으며 opt.includeSleeve = true 로 되살릴 수 있습니다.
       그때 이 블록과 ui.html 의 소매 요약 행·이세분 경고를 함께 복원하세요. */

    /* 조각 외곽선 유효성 (폐곡선 판정은 QA팀 몫) */
    ((d && d.pieces) || []).forEach(function (p) {
      var o = p.outline || [], bad = o.length < 3;
      for (var i = 0; !bad && i < o.length; i++) if (!isFinite(o[i][0]) || !isFinite(o[i][1])) bad = true;
      checks.push({ k: bad ? 'bad' : 'ok', t: (p.name || p.id) + ' 외곽선 ' + (bad ? '이상 (점 부족/NaN)' : o.length + '점') });
    });

    if (!d) checks = [{ k: 'bad', t: state.lastError || '제도 결과 없음' }];

    els.checks.innerHTML = checks.map(function (c) {
      return '<li class="ck ' + (c.k === 'ok' ? 'ck-ok' : 'ck-bad') + '">' + esc(c.t) + '</li>';
    }).join('');

    renderPickList(d);          // 인쇄할 조각 체크박스 (SPEC §17-1)

    els.pieces.innerHTML = ((d && d.pieces) || []).map(function (p) {
      var bb = p.bbox || { w: 0, h: 0 };
      var fold = Array.isArray(p.foldEdges) ? (p.foldEdges.length ? '골선 ' + p.foldEdges.length : '골선 없음') : '골선 정보 없음';
      return '<div class="piece"><b>' + esc(p.name || p.id) + '</b> · ' + (p.cutCount || 2) + '매' +
        '<br><span class="pm">' + f1(bb.w) + ' × ' + f1(bb.h) + ' cm · 외곽 ' + (p.outline || []).length + '점 · ' + fold + '</span></div>';
    }).join('') || '<div class="piece">조각 없음</div>';

    var notes = (d && d.meta && d.meta.formulaNotes) || [];
    els.notesBlock.hidden = !notes.length;
    if (notes.length) {
      els.notes.innerHTML = notes.map(function (n) { return '<li>' + esc(noteText(n)) + '</li>'; }).join('');
    }

    renderSeamApplied();
  }

  function renderFoot() {
    els.footSize.textContent = state.size + (state.custom ? ' (사용자 지정)' : '');
    els.footMeas.textContent = state.m
      ? ('B ' + f1(state.m.B) + ' · 등길이 ' + f1(state.m.backLen) +
        (state.m.sleeveLen !== undefined ? ' · 소매 ' + f1(state.m.sleeveLen) : ''))
      : '—';
    els.footSeam.textContent = '시접 ' + (SEAM_PRESET_LABEL[state.seamPreset] || state.seamPreset) +
      ' (' + seamRoleDefs().map(function (r) { return f1(state.seam[r.key] || 0); }).join('/') + ', 골선 0)' +
      '';
    var bb = (state.draft && state.layout) ? state.layout.bbox : null;
    els.footBox.textContent = bb ? ('전체 ' + f1(bb.w) + ' × ' + f1(bb.h) + ' cm') : '—';

    els.engineBadge.textContent = state.engineOk ? '엔진 연결됨' : '엔진 없음';
    els.engineBadge.setAttribute('data-state', state.engineOk ? 'real' : 'mock');
    els.engineBadge.title = state.engineOk
      ? 'window.VestEngine.draftVest() 결과를 그리는 중입니다.'
      : (state.lastError || 'engine.js 가 로드되지 않았습니다.');
    els.resetSize.textContent = state.size;
    els.printBtn.disabled = !state.draft;
    if (els.pdfBtn) {
      var pdfOk = !!(state.draft && PDFM() && typeof PDFM().savePdf === 'function');
      els.pdfBtn.disabled = !pdfOk;
      els.pdfBtn.title = pdfOk ? '' : 'pdf.js 가 연결되지 않았습니다.';
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     재계산
     ═══════════════════════════════════════════════════════════════════ */
  var _raf = 0;
  function recompute(refit) {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = requestAnimationFrame(function () {
      _raf = 0;
      var d = computeDraft();
      state.layout = layoutPieces(d);
      if (refit || state.autoFit) fitView(); else renderSvg();
      syncFields();
      renderSummary();
      renderFoot();
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     인쇄 — print.js 의 applyPageCss / renderTo 를 반드시 거칩니다.
       applyPageCss 를 빼먹으면 롤지(594×가변)가 @page 210×297 로 잘립니다.
     ═══════════════════════════════════════════════════════════════════ */
  /** 인쇄·PDF 가 공유하는 레이아웃 생성. 실패하면 null 을 돌려주고 toast 로 알립니다. */
  /* ══ 조각별 인쇄 선택 (SPEC §17-1) ═════════════════════════════════
     담아 두는 것은 **뺀 조각**입니다. 넣은 조각을 담으면, 소매 종류를 바꾸는 식으로
     조각 id 가 통째로 갈리는 순간 새 조각이 조용히 인쇄에서 빠집니다. */
  function pieceKey(p, i) { return String((p && (p.id || p.name)) || ('조각' + (i + 1))); }

  /** 인쇄할 조각 id 배열. 전부 뺐으면 빈 배열 → makeLayout 이 막습니다. */
  function pickedIds(d) {
    var src = (d && d.pieces) || [], out = [], i;
    for (i = 0; i < src.length; i++) {
      var k = pieceKey(src[i], i);
      if (!state.printExclude[k]) out.push(k);
    }
    return out;
  }

  /** 뺀 조각 목록을 브라우저에 저장 — 다음에 열어도 그대로입니다 (SPEC §17-3) */
  function savePick() {
    var ex = [], k;
    for (k in state.printExclude) if (state.printExclude[k]) ex.push(k);
    storeSet('printExclude', ex);
    if (els && els.pickSaved) {
      els.pickSaved.textContent = ex.length ? '이 브라우저에 저장됨' : '';
    }
  }

  /** 저장해 둔 선택 복원. 지금 없는 조각 id 가 섞여 있어도 그냥 둔다 —
      소매 종류를 다시 바꾸면 그 선택이 되살아나는 편이 자연스럽다. */
  function loadPick() {
    var sp = storeGet('split');
    if (sp === 0 || sp === 1) state.split = sp;
    var ex = storeGet('printExclude');
    if (!ex || typeof ex.length !== 'number') return;
    state.printExclude = {};
    for (var i = 0; i < ex.length; i++) state.printExclude[String(ex[i])] = true;
  }

  /** 조각 목록 다시 그리기 — 체크 상태는 DOM 이 아니라 state 에 있습니다. */
  function renderPickList(d) {
    if (!els || !els.pickList) return;
    var src = (d && d.pieces) || [];
    els.pickList.innerHTML = src.map(function (p, i) {
      var k = pieceKey(p, i);
      return '<label class="chip"><input type="checkbox" data-piece="' + esc(k) + '"' +
        (state.printExclude[k] ? '' : ' checked') + '><span>' + esc(p.name || k) + '</span></label>';
    }).join('') || '<span class="hint">조각 없음</span>';
    var on = pickedIds(d).length;
    if (els.pickCount) {
      els.pickCount.textContent = src.length ? (on + ' / ' + src.length) : '—';
      els.pickCount.className = 'picknum' + (src.length && on !== src.length ? ' is-part' : '');
    }
  }

  function makeLayout(what) {
    var P = PRN();
    if (!P || typeof P.buildPrintLayout !== 'function') {
      toast('출력 모듈(print.js)이 아직 연결되지 않았습니다. 통합 후 ' + what + '이 활성화됩니다.');
      return null;
    }
    if (!state.draft) { toast('제도 결과가 없어 ' + what + '할 수 없습니다.'); return null; }

    /* 조각별 인쇄 선택 — 전부 빼면 print.js 가 '유효한 조각이 없습니다' 로 던지므로 여기서 막습니다 */
    var want = pickedIds(state.draft);
    if (!want.length) {
      toast('인쇄할 조각이 하나도 없습니다. 「인쇄할 조각」에서 최소 1개를 체크하세요.');
      return null;
    }

    var opt = {
      mode: state.printMode,
      rollWidthMm: state.rollWidthMm,
      rollMaxHmm: state.rollMaxHmm,
      overlapMm: state.overlapMm,
      gapMm: state.gapMm,
      /* print.js 가 부위별 객체를 이해하면(normalizeSeamOpt/SEAM_DEFAULTS 노출) 그대로 넘기고,
         숫자만 받는 구버전이면 가장 큰 부위값을 넘겨 시접이 모자라게 잘리지 않도록 합니다. */
      seam: (P.normalizeSeamOpt || P.SEAM_DEFAULTS) ? copyObj(state.seam) : maxSeam(state.seam),
      seamByRole: copyObj(state.seam),
      calibMm: state.calibMm,
      pieces: want,             // 조각별 인쇄 선택 (SPEC §17-1)
      stamp: buildStamp(),      // 종이에 앱 버전·빌드시각을 남깁니다 (SPEC §17-2)
      title: state.size + (state.custom ? ' (사용자 지정)' : '') +
        ' · B ' + f1(state.m.B) + ' · 등길이 ' + f1(state.m.backLen) +
        ' · 시접 ' + (SEAM_PRESET_LABEL[state.seamPreset] || state.seamPreset)
    };

    var layout;
    try {
      layout = P.buildPrintLayout(state.draft, opt);
    } catch (e) {
      console.error('[NoDartUI] buildPrintLayout 실패:', e);
      toast('인쇄 레이아웃 생성 실패: ' + (e && e.message));
      return null;
    }
    if (!layout || !layout.pagesSvg || !layout.pagesSvg.length) {
      toast('출력할 페이지가 생성되지 않았습니다.');
      return null;
    }
    return layout;
  }

  function doPrint() {
    var P = PRN();
    var layout = makeLayout('인쇄');
    if (!layout) return null;

    /* ★ 1. @page 크기 주입 — 롤지는 이게 없으면 A4 로 잘립니다 */
    if (typeof P.applyPageCss === 'function') P.applyPageCss(layout);
    else console.warn('[NoDartUI] NoDartPrint.applyPageCss 없음 — 롤지 용지크기가 적용되지 않습니다.');

    /* ★ 2. body 직속 #ndp-print-area 에 삽입 (print.css 규약) */
    var area = els.printArea || document.getElementById('ndp-print-area');
    if (typeof P.renderTo === 'function') {
      P.renderTo(layout, area);
    } else {
      var w = layout.info.pageWidthMm, h = layout.info.pageHeightMm;
      area.innerHTML = layout.pagesSvg.map(function (svg) {
        return '<div class="ndp-page" style="width:' + w + 'mm;height:' + (h - 0.1) + 'mm">' + svg + '</div>';
      }).join('');
    }

    var warns = (layout.info && layout.info.warnings) || [];
    toast('전체 ' + layout.pageCount + '장 · ' +
      (layout.info.pageWidthMm).toFixed(0) + '×' + (layout.info.pageHeightMm).toFixed(0) + 'mm — 인쇄 배율 100%(실제 크기)' +
      (warns.length ? ' / 경고 ' + warns.length + '건: ' + warns[0] : ''));
    if (warns.length) console.warn('[NoDartUI] print 경고:', warns);

    if (global.requestAnimationFrame) global.requestAnimationFrame(function () { global.print(); });
    else global.print();
    return layout;
  }

  /* ═══════════════════════════════════════════════════════════════════
     PDF 저장 (pdf.js) — 배율이 절대 틀리지 않는 1:1 출력.
     print.js 가 만든 페이지 SVG 를 그대로 벡터 PDF 로 옮기므로 인쇄본과 같습니다.
     ═══════════════════════════════════════════════════════════════════ */
  function PDFM() { return global.NoDartPDF; }

  function pdfFileName() {
    return '토르소원형프린세스라인_' + state.size +
      '_' + (state.printMode === 'roll' ? '롤지' + state.rollWidthMm + 'mm' : 'A4분할') +
      '_시접' + (SEAM_PRESET_LABEL[state.seamPreset] || state.seamPreset).replace(/\s+/g, '') +
      '_1대1.pdf';
  }

  function doSavePdf() {
    var M = PDFM();
    if (!M || typeof M.savePdf !== 'function') {
      toast('PDF 모듈(pdf.js)이 연결되지 않았습니다.');
      return null;
    }
    var layout = makeLayout('PDF 저장');
    if (!layout) return null;
    if (els.pdfBtn) { els.pdfBtn.disabled = true; els.pdfBtn.textContent = 'PDF 만드는 중…'; }
    var done = function () {
      if (els.pdfBtn) { els.pdfBtn.disabled = false; els.pdfBtn.textContent = 'PDF 저장 · 배율 고정 1:1'; }
    };
    try {
      M.savePdf(layout.pagesSvg, {
        widthMm: layout.info.pageWidthMm,
        heightMm: layout.info.pageHeightMm,
        title: '토르소 원형 프린세스라인 ' + state.size,
        fileName: pdfFileName()
      }).then(function (blob) {
        done();
        toast('PDF ' + layout.pageCount + '장 (' + (blob.size / 1048576).toFixed(1) + 'MB) 저장 — ' +
              '뷰어에서 "실제 크기 / 100%" 로 인쇄하세요 (배율 고정 1:1)');
      }, function (e) {
        done();
        console.error('[NoDartUI] PDF 생성 실패:', e);
        toast('PDF 생성 실패: ' + (e && e.message));
      });
    } catch (e) {
      done();
      console.error('[NoDartUI] PDF 생성 실패:', e);
      toast('PDF 생성 실패: ' + (e && e.message));
      return null;
    }
    return layout;
  }

  /* ═══════════════════════════════════════════════════════════════════
     DXF 내보내기 — dxf.js (SPEC §13). 현재 화면의 draft 를 그대로 넘깁니다.
     ═══════════════════════════════════════════════════════════════════ */
  function DXF() { return global.NoDartDXF; }

  function syncDxfAvail() {
    var btn = $('ndDxfBtn'), blk = $('ndDxfBlock');
    if (!btn || !blk) return;
    var ok = !!(DXF() && typeof DXF().download === 'function');
    btn.disabled = !ok;
    btn.textContent = ok ? 'DXF 내보내기' : 'DXF 모듈 없음';
    btn.title = ok ? '' : 'dxf.js 가 연결되지 않았습니다. 통합 후 활성화됩니다.';
  }

  function dxfFileName() {
    return '토르소원형프린세스라인_' + state.size +
      '_시접' + (SEAM_PRESET_LABEL[state.seamPreset] || state.seamPreset).replace(/\s+/g, '') +
      '_' + ($('ndDxfUnit') ? $('ndDxfUnit').value : 'cm') + '.dxf';
  }

  function doExportDXF() {
    var D = DXF();
    if (!D || typeof D.download !== 'function') { toast('DXF 모듈(dxf.js)이 연결되지 않았습니다.'); return null; }
    if (!state.draft) { toast('제도 결과가 없어 내보낼 수 없습니다.'); return null; }

    var opt = {
      unit: $('ndDxfUnit') ? $('ndDxfUnit').value : 'cm',
      layout: $('ndDxfLayout') ? $('ndDxfLayout').value : 'row',
      includeSeam: $('ndDxfSeam') ? $('ndDxfSeam').checked : true,
      includeInternal: $('ndDxfInternal') ? $('ndDxfInternal').checked : true,
      includeText: $('ndDxfText') ? $('ndDxfText').checked : true,
      filename: dxfFileName()
    };

    var r;
    try { r = D.download(state.draft, opt); }
    catch (e) {
      console.error('[NoDartUI] DXF 내보내기 실패:', e);
      toast('DXF 내보내기 실패: ' + (e && e.message));
      return null;
    }

    var info = r && r.info;
    var box = $('ndDxfResult'), body = $('ndDxfResultBody');
    if (info && box && body) {
      var pcs = (info.pieces || []).map(function (p) {
        return esc(p.name || p.id) +
          (p.outlinePts != null ? ' ' + p.outlinePts + '→' + p.outlineSimplified + '점' : '');
      }).join(' · ');
      /* info.entities 는 {LWPOLYLINE:n, LINE:n, ...} 형태이므로 합계를 냅니다 */
      var entN = 0, ek;
      if (info.entities && typeof info.entities === 'object') {
        for (ek in info.entities) if (info.entities.hasOwnProperty(ek)) entN += (+info.entities[ek] || 0);
      } else entN = +info.entities || 0;
      var dev = num(info.simplifyDevCm);
      var warn = (info.warnings || []).length;
      body.innerHTML =
        '<div>' + esc(opt.filename) + '</div>' +
        '<div>' + esc(info.acadver || '') + ' · ' + esc(info.unit) + ' · 레이어 ' +
          ((info.layersUsed || info.layers || []).length) + '개 · 엔티티 ' + entN + '개</div>' +
        (pcs ? '<div>' + pcs + '</div>' : '') +
        '<div>단순화 최대 편차 <b class="' + (dev !== null && dev <= 0.05 ? 'dxf-ok' : 'dxf-warn') + '">' +
          (dev !== null ? dev.toFixed(4) + ' cm' : '?') + '</b>' +
        (warn ? ' · <span class="dxf-warn">경고 ' + warn + '건</span>' : '') + '</div>';
      box.hidden = false;
    }
    toast('DXF 저장: ' + opt.filename);
    return r;
  }

  var _toastT = 0;
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('is-on');
    clearTimeout(_toastT);
    _toastT = setTimeout(function () { els.toast.classList.remove('is-on'); }, 5200);
  }

  /* ═══════════════════════════════════════════════════════════════════
     이벤트
     ═══════════════════════════════════════════════════════════════════ */
  function bind() {
    if (els.split) els.split.addEventListener('change', function () {
      state.split = +els.split.value ? 1 : 0;
      storeSet('split', state.split);
      /* 조각 구성이 통째로 바뀐다 (2조각 ↔ 4조각) — 인쇄 선택도 다시 맞춘다 */
      recompute(true);
    });
    if (els.styleReset) els.styleReset.addEventListener('click', function () {
      state.styleTouched_dartRise = false;
      state.style = styleDefaults();
      buildStyleFields();
      recompute(true);
      toast('스타일을 기본값으로 되돌렸습니다.');
    });
    els.sizeTabs.addEventListener('click', function (e) {
      var b = e.target.closest('.sizetab');
      if (b) setSize(b.dataset.size);
    });

    els.resetBtn.addEventListener('click', function () {
      var std = stdMeasures(state.size);
      if (!std) { toast('엔진이 없어 표준값을 읽을 수 없습니다.'); return; }
      state.m = std;
      refreshCustomFlag();
      recompute(false);
      toast(state.size + ' 표준 치수로 되돌렸습니다.');
    });

    els.seamPreset.addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn');
      if (!b || !SEAM_PRESETS[b.dataset.preset]) return;
      state.seamPreset = b.dataset.preset;
      state.seam = SEAM_PRESETS[state.seamPreset]();
      state.seam[FOLD_ROLE] = 0;
      syncSeamUI();
      recompute(false);
    });


    els.printMode.addEventListener('change', function () {
      state.printMode = els.printMode.value;
      els.rollRow.hidden = state.printMode !== 'roll';
    if (els.rollMaxRow) els.rollMaxRow.hidden = state.printMode !== 'roll';
      var rh = $('ndRollHint'); if (rh) rh.hidden = state.printMode !== 'roll';
      els.overlapRow.hidden = state.printMode !== 'a4';
    });
    els.rollWidth.addEventListener('change', function () { state.rollWidthMm = parseInt(els.rollWidth.value, 10); });
    if (els.rollMax) els.rollMax.addEventListener('change', function () {
      state.rollMaxHmm = parseInt(els.rollMax.value, 10) || 0; recompute(false);
    });
    els.overlap.addEventListener('change', function () {
      var v = parseFloat(els.overlap.value);
      state.overlapMm = isFinite(v) ? v : 10;
    })
    if (els.gap) els.gap.addEventListener('change', function () {
      var g = parseFloat(els.gap.value);
      if (!isFinite(g) || g < 0) g = 6;
      state.gapMm = Math.min(30, Math.max(0, g));
      els.gap.value = state.gapMm;
      recompute(false);
    });;
    els.calib.addEventListener('change', function () {
      var v = parseFloat(els.calib.value);
      state.calibMm = (isFinite(v) && v >= 30 && v <= 70) ? v : 50;
      els.calib.value = state.calibMm;
    });
    /* ── 조각별 인쇄 선택 (SPEC §17-1) ── */
    if (els.pickList) els.pickList.addEventListener('change', function (e) {
      var el = e.target;
      if (!el || !el.getAttribute || !el.getAttribute('data-piece')) return;
      var k = el.getAttribute('data-piece');
      if (el.checked) delete state.printExclude[k]; else state.printExclude[k] = true;
      savePick();
      renderPickList(state.draft);
    });
    if (els.pickAll) els.pickAll.addEventListener('click', function () {
      state.printExclude = {}; savePick(); renderPickList(state.draft);
    });
    if (els.pickNone) els.pickNone.addEventListener('click', function () {
      var src = (state.draft && state.draft.pieces) || [], i;
      state.printExclude = {};
      for (i = 0; i < src.length; i++) state.printExclude[pieceKey(src[i], i)] = true;
      savePick();
      renderPickList(state.draft);
      toast('조각을 전부 뺐습니다 — 인쇄하려면 최소 1개는 체크하세요.');
    });

    els.printBtn.addEventListener('click', function () { doPrint(); });
    if (els.pdfBtn) els.pdfBtn.addEventListener('click', function () { doSavePdf(); });

    /* DXF 내보내기 (SPEC §13) */
    var dxfBtn = $('ndDxfBtn');
    if (dxfBtn) dxfBtn.addEventListener('click', function () { doExportDXF(); });
    ['ndDxfUnit', 'ndDxfLayout'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', function () { var b = $('ndDxfResult'); if (b) b.hidden = true; });
    });

    var tmap = { ndTglDim: 'dim', ndTglFormula: 'formula', ndTglSeam: 'seam', ndTglNotch: 'notch', ndTglInner: 'inner', ndTglGrid: 'grid' };
    Object.keys(tmap).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.checked = !!state.show[tmap[id]];
      el.addEventListener('change', function () { state.show[tmap[id]] = el.checked; renderSvg(); });
    });

    els.zoomIn.addEventListener('click', function () { zoomAt(1.25, els.wrap.clientWidth / 2, els.wrap.clientHeight / 2); });
    els.zoomOut.addEventListener('click', function () { zoomAt(1 / 1.25, els.wrap.clientWidth / 2, els.wrap.clientHeight / 2); });
    els.zoomVal.addEventListener('click', fitView);
    els.fitBtn.addEventListener('click', fitView);
    els.actualBtn.addEventListener('click', function () {
      zoomAt(PX_PER_CM / state.view.s, els.wrap.clientWidth / 2, els.wrap.clientHeight / 2);
      toast('화면 1:1 은 모니터 해상도에 따라 오차가 있습니다. 실물 1:1은 인쇄로 확인하세요.');
    });

    els.wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = els.wrap.getBoundingClientRect();
      zoomAt(Math.pow(0.9988, e.deltaY * (e.deltaMode === 1 ? 16 : 1)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    var drag = null;
    els.svg.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 && e.button !== 1) return;
      drag = { x: e.clientX, y: e.clientY, tx: state.view.tx, ty: state.view.ty };
      state.autoFit = false;
      els.svg.classList.add('is-panning');
      els.svg.setPointerCapture(e.pointerId);
    });
    els.svg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      state.view.tx = drag.tx + (e.clientX - drag.x);
      state.view.ty = drag.ty + (e.clientY - drag.y);
      applyTransform();
    });
    function endDrag(e) {
      if (!drag) return;
      drag = null;
      els.svg.classList.remove('is-panning');
      try { els.svg.releasePointerCapture(e.pointerId); } catch (x) { }
    }
    els.svg.addEventListener('pointerup', endDrag);
    els.svg.addEventListener('pointercancel', endDrag);
    els.svg.addEventListener('dblclick', fitView);

    document.addEventListener('keydown', function (e) {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '')) return;
      var sz = sizesList();
      if (e.key === 'f' || e.key === 'F') fitView();
      else if (e.key === '+' || e.key === '=') zoomAt(1.25, els.wrap.clientWidth / 2, els.wrap.clientHeight / 2);
      else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.25, els.wrap.clientWidth / 2, els.wrap.clientHeight / 2);
      else if (e.key >= '1' && e.key <= '9' && sz[+e.key - 1]) setSize(sz[+e.key - 1]);
    });

    var rt = 0;
    function onResize() {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (!els.wrap.clientWidth || !els.wrap.clientHeight) return;
        if (state.autoFit) fitView(); else renderSvg();
      }, 100);
    }
    global.addEventListener('resize', onResize);
    if (global.ResizeObserver) { try { new global.ResizeObserver(onResize).observe(els.wrap); } catch (x) { } }
  }

  function setSize(size) {
    if (sizesList().indexOf(size) < 0) return;
    var std = stdMeasures(size);
    state.size = size;
    if (std) state.m = std;
    Array.prototype.forEach.call(els.sizeTabs.querySelectorAll('.sizetab'), function (b) {
      var on = b.dataset.size === size;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    refreshCustomFlag();
    recompute(false);
  }

  /* ═══════════════════════════════════════════════════════════════════
     초기화
     ═══════════════════════════════════════════════════════════════════ */
  function init() {
    if (inited) return;
    var need = ['ndSizeTabs', 'ndFields', 'ndSvg', 'ndCanvasWrap'];
    for (var i = 0; i < need.length; i++) {
      if (!$(need[i])) { console.warn('[NoDartUI] 마크업(' + need[i] + ')을 찾지 못해 초기화를 건너뜁니다.'); return; }
    }
    inited = true;

    els = {
      sizeTabs: $('ndSizeTabs'), stateBadge: $('ndStateBadge'), engineBadge: $('ndEngineBadge'),
      fields: $('ndFields'), resetBtn: $('ndResetBtn'), resetSize: $('ndResetSize'),
      seamPreset: $('ndSeamPreset'), seamRoles: $('ndSeamRoles'),
      seamApplied: $('ndSeamApplied'), seamAppliedSrc: $('ndSeamAppliedSrc'), seamAppliedBody: $('ndSeamAppliedBody'),
      styleBox: $('ndStyle'), styleReset: $('ndStyleReset'), split: $('ndSplit'),
      printMode: $('ndPrintMode'), rollRow: $('ndRollRow'), rollMaxRow: $('ndRollMaxRow'), rollMax: $('ndRollMax'), rollWidth: $('ndRollWidth'),
      overlapRow: $('ndOverlapRow'), overlap: $('ndOverlap'), calib: $('ndCalib'), printBtn: $('ndPrintBtn'),
      pdfBtn: $('ndPdfBtn'),
      svg: $('ndSvg'), wrap: $('ndCanvasWrap'), canvasEmpty: $('ndCanvasEmpty'), canvasHint: $('ndCanvasHint'),
      zoomIn: $('ndZoomIn'), zoomOut: $('ndZoomOut'), zoomVal: $('ndZoomVal'),
      fitBtn: $('ndFitBtn'), actualBtn: $('ndActualBtn'),
      checks: $('ndChecks'), pieces: $('ndPieces'), notes: $('ndNotes'), notesBlock: $('ndNotesBlock'),
      sideWarn: $('ndSideWarn'), sideWarnDetail: $('ndSideWarnDetail'),
      footSize: $('ndFootSize'), footMeas: $('ndFootMeas'), footSeam: $('ndFootSeam'), footBox: $('ndFootBox'),
      pickBox: $('ndPickBox'), pickList: $('ndPickList'), pickCount: $('ndPickCount'),
      pickAll: $('ndPickAll'), pickNone: $('ndPickNone'), pickSaved: $('ndPickSaved'),
      verBadge: $('ndVerBadge'),
      printArea: $('ndp-print-area'), toast: $('ndToast')
    };

    /* 버전·빌드시각 배지 (SPEC §17-2) — 재빌드 후 새로고침이 먹혔는지 눈으로 확인 */
    if (els.verBadge) els.verBadge.textContent = buildStamp();

    /* 저장해 둔 조각 선택 복원 (SPEC §17-3) — 첫 renderPickList 보다 먼저 */
    loadPick();
    savePick();

    /* 인쇄 컨테이너가 body 직속인지 확인 — print.css 규약 (SPEC §8.1) */
    if (els.printArea && els.printArea.parentNode !== document.body) {
      console.warn('[NoDartUI] #ndp-print-area 가 body 직속이 아닙니다. print.css 규칙에 걸려 인쇄가 빈 종이로 나옵니다. body 직속으로 옮깁니다.');
      document.body.appendChild(els.printArea);
    }

    /* 호수 탭 — 엔진이 실제로 받아주는 호수만 (SPEC §11-3: 44호 포함) */
    var sz = sizesList();
    els.sizeTabs.innerHTML = sz.map(function (s) {
      return '<button type="button" class="sizetab" role="tab" data-size="' + esc(s) + '" aria-selected="false">' + esc(s) + '</button>';
    }).join('');
    if (sz.indexOf(state.size) < 0) state.size = sz[Math.min(1, sz.length - 1)];

    state.m = stdMeasures(state.size);
    /* 시접 — 표준 프리셋(엔진 seamByRole 우선) */
    state.seam = standardSeam();
    state.seam[FOLD_ROLE] = 0;
    state.seamPreset = detectPreset(state.seam);
    state.style = styleDefaults();

    if (els.gap) els.gap.value = state.gapMm;
    if (els.rollMax) els.rollMax.value = String(state.rollMaxHmm);

    buildFields();
    buildStyleFields();
    buildSeamRoles();
    syncSeamUI();
    bind();
    syncDxfAvail();
    els.rollRow.hidden = true;
    var _rh0 = $('ndRollHint'); if (_rh0) _rh0.hidden = true;
    Array.prototype.forEach.call(els.sizeTabs.querySelectorAll('.sizetab'), function (b) {
      var on = b.dataset.size === state.size;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    refreshCustomFlag();

    var d = computeDraft();
    state.layout = layoutPieces(d);
    syncFields();
    renderSummary();
    renderFoot();
    fitView();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ─────────────────────────── 공개 API ─────────────────────────── */
  global.NoDartUI = {
    init: init,
    /** 엔진을 나중에 로드했을 때 등, 강제 재제도 */
    refresh: function (refit) {
      if (!state.m) { state.m = stdMeasures(state.size); if (state.m) buildFields(); }
      recompute(refit !== false);
    },
    setSize: setSize,
    /** 숫자면 균일, 객체면 부위별, 프리셋 이름('none'|'standard'|'uniform')도 받습니다 */
    setSeam: function (v) {
      if (typeof v === 'string' && SEAM_PRESETS[v]) { state.seam = SEAM_PRESETS[v](); }
      else if (typeof v === 'number') { state.seam = uniformSeam(v); }
      else if (v && typeof v === 'object') {
        var base = copyObj(state.seam || standardSeam()), k;
        for (k in v) if (v.hasOwnProperty(k) && num(v[k]) !== null) base[k] = v[k];
        state.seam = base;
      } else return;
      state.seam[FOLD_ROLE] = 0;
      state.seamPreset = detectPreset(state.seam);
      syncSeamUI();
      recompute(false);
    },
    /** 라벨 충돌 회피 결과 (SPEC §11-2 검증용)
        {total, placed, displaced, hidden, overlaps} — overlaps 가 보이는 라벨끼리의 겹침 쌍 수 */
    labelStats: function () { return copyObj(_labelStats); },
    /** 회피 전/후 비교용 스위치 */
    setCollisionAvoidance: function (on) { COLLIDE_OFF = !on; renderSvg(); return copyObj(_labelStats); },
    setCapReduce: function (v) {
      var n = Math.max(0, Math.min(1, +v || 0));
      recompute(false);
    },
    setMeasure: function (key, v) {
      if (!state.m || !(key in state.m)) return;
      state.m[key] = +v;
      refreshCustomFlag();
      recompute(false);
    },
    fit: fitView,
    print: doPrint,
    toast: toast,
    getState: function () {
      return {
        size: state.size, custom: state.custom, measures: state.m ? cloneM(state.m) : null,
        seam: copyObj(state.seam || {}), seamPreset: state.seamPreset, style: copyObj(state.style || {}),
        printMode: state.printMode, rollWidthMm: state.rollWidthMm, overlapMm: state.overlapMm,
        gapMm: state.gapMm,
        calibMm: state.calibMm, engineOk: state.engineOk, lastError: state.lastError,
        appVersion: APP_VERSION, build: (typeof window !== 'undefined' && window.ND_BUILD) || '',
        printExclude: copyObj(state.printExclude || {}),
        zoom: state.view.s / PX_PER_CM
      };
    },
    getDraft: function () { return state.draft; },
    easeGrade: easeGrade,
    SIDE_WARN_CM: SIDE_WARN_CM
  };
})(window);
