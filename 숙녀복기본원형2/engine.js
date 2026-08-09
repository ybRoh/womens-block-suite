/* ============================================================================
 * 숙녀복 기본원형 II — 제도 엔진
 *   · 교재 「숙녀복 기본원형 II」 제도 1(구성) · 제도 2(완성 조각)
 *   · 조각 2개 — 앞면(가슴다트) · 뒷면
 *
 * 좌표계: cm. x = 중심선(CB/CF)에서 옆선 방향 +, y = **각 조각 자기 상단선**에서 아래 +
 *         앞 상단선이 뒤 상단선보다 `앞 등길이 차이치수`(4) 만큼 위에 있어서,
 *         두 조각을 나란히 놓으면 허리선이 같은 높이에 온다.
 *
 * 노출: window.Bodice2Engine / module.exports (ES module import 금지, 외부 lib 없음)
 * ==========================================================================*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.Bodice2Engine = api; window.Bodice2Engine = api; }
  else if (root) root.Bodice2Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  /* ══════════════════════════════════════════════════════════════════
   * 0. 벡터 / 베지어 유틸  (draft-bunka-fs.js 에서 이식 — 새로 만들지 않음)
   * ════════════════════════════════════════════════════════════════ */
  var V = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1]]; },
    mul: function (a, k) { return [a[0] * k, a[1] * k]; },
    dist: function (a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); },
    norm: function (a) { var l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; }
  };
  function bez(p0, c1, c2, p1, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
            a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
  }
  function bezLen(p0, c1, c2, p1, n) {
    n = n || 240; var L = 0, q = p0;
    for (var i = 1; i <= n; i++) { var p = bez(p0, c1, c2, p1, i / n); L += V.dist(q, p); q = p; }
    return L;
  }
  function sLen(s) { return s.reduce(function (a, g) { return a + bezLen(g.p0, g.c1, g.c2, g.p1); }, 0); }
  function _lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function through(pts, t0v, t1v, tension) {
    tension = (tension === undefined) ? 0.42 : tension;
    var segs = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i], p1 = pts[i + 1], d = V.dist(p0, p1), t0, t1;
      if (i === 0) t0 = t0v ? V.norm(t0v) : V.norm(V.sub(p1, p0)); else t0 = V.norm(V.sub(p1, pts[i - 1]));
      if (i === pts.length - 2) t1 = t1v ? V.norm(t1v) : V.norm(V.sub(p1, p0)); else t1 = V.norm(V.sub(pts[i + 2], p0));
      segs.push({ p0: p0, c1: V.add(p0, V.mul(t0, d * tension)), c2: V.sub(p1, V.mul(t1, d * tension)), p1: p1 });
    }
    return segs;
  }
  var F2 = function (p) { return p[0].toFixed(3) + ',' + p[1].toFixed(3); };
  var sPath = function (s) { return 'M ' + F2(s[0].p0) + ' ' + s.map(function (g) { return 'C ' + F2(g.c1) + ' ' + F2(g.c2) + ' ' + F2(g.p1); }).join(' '); };
  var LN = function () { return 'M ' + Array.prototype.slice.call(arguments).map(F2).join(' L '); };
  /** 앵커를 지나는 **C2 연속 3차 스플라인** → 베지어 세그먼트 배열.
   *
   *  왜 필요한가 — 조각마다 장력을 따로 적합하면 접선은 이어져도(G1) **곡률이 튄다**.
   *  실제로 앞 암홀에서 곡률이 −10 ↔ +11 로 뒤집혀 눈에 보이는 꺾임이 생겼고,
   *  소매산은 중간 앵커 구간이 직선처럼 펴졌다.
   *  C2 스플라인은 곡률까지 이어져 사람이 운형자로 그은 곡선처럼 매끄럽다.
   *  (원본 도면의 AutoCAD 스플라인도 같은 계열이라 대조 정확도도 좋아진다.)
   *
   *  @param pts  반드시 지나야 하는 점들 (제도 규칙점)
   *  @param d0   시작 접선 **벡터**. null 이면 자연단(2차 도함수 0)
   *  @param d1   끝 접선 벡터.       null 이면 자연단
   *  끝 접선은 크기가 모양을 좌우하므로 부르는 쪽에서 방향 × (현길이 × 계수) 로 준다. */
  function splineSegs(pts, d0, d1) {
    var n = pts.length - 1, i;
    if (n < 1) return [];
    var h = [];
    for (i = 0; i < n; i++) h.push(Math.max(V.dist(pts[i], pts[i + 1]), 1e-9));

    /* 삼중대각 A·m = R  (m = 앵커별 접선벡터). 좌표별 계수가 같아 벡터로 한 번에 푼다. */
    var A = [], B = [], C2 = [], R = [];
    for (i = 0; i <= n; i++) { A.push(0); B.push(0); C2.push(0); R.push([0, 0]); }
    if (d0) { B[0] = 1; C2[0] = 0; R[0] = [d0[0], d0[1]]; }
    else { B[0] = 2; C2[0] = 1; R[0] = V.mul(V.sub(pts[1], pts[0]), 3 / h[0]); }
    for (i = 1; i < n; i++) {
      A[i] = h[i]; B[i] = 2 * (h[i - 1] + h[i]); C2[i] = h[i - 1];
      R[i] = V.add(V.mul(V.sub(pts[i], pts[i - 1]), 3 * h[i] / h[i - 1]),
                   V.mul(V.sub(pts[i + 1], pts[i]), 3 * h[i - 1] / h[i]));
    }
    if (d1) { A[n] = 0; B[n] = 1; R[n] = [d1[0], d1[1]]; }
    else { A[n] = 1; B[n] = 2; R[n] = V.mul(V.sub(pts[n], pts[n - 1]), 3 / h[n - 1]); }

    for (i = 1; i <= n; i++) {                    // 토마스 알고리즘
      var w = A[i] / B[i - 1];
      B[i] -= w * C2[i - 1];
      R[i] = V.sub(R[i], V.mul(R[i - 1], w));
    }
    var m = [];
    for (i = 0; i <= n; i++) m.push([0, 0]);
    m[n] = V.mul(R[n], 1 / B[n]);
    for (i = n - 1; i >= 0; i--) m[i] = V.mul(V.sub(R[i], V.mul(m[i + 1], C2[i])), 1 / B[i]);

    var segs = [];
    for (i = 0; i < n; i++) {
      segs.push({ p0: pts[i], c1: V.add(pts[i], V.mul(m[i], h[i] / 3)),
                  c2: V.sub(pts[i + 1], V.mul(m[i + 1], h[i] / 3)), p1: pts[i + 1] });
    }
    return segs;
  }
  /** 스플라인 끝 접선 벡터 — 방향 × k.
   *  현길이 매개화라 |접선| ≈ 1 이 "자연스러운" 크기다. 현길이를 곱하면 곡선이 부푼다. */
  function endTan(dir, k) { return V.mul(V.norm(dir), (k === undefined ? 1 : k)); }

  /** through() 의 세그먼트별 장력 변형 (구버전 — 곡률이 튀어 더는 쓰지 않는다) */
  function throughT(pts, t0v, t1v, C) {
    var n = pts.length, tt = (C && C.t) || null, rot = (C && C.r) || null;
    var tan = [], i;
    for (i = 0; i < n; i++) {
      var t;
      if (i === 0) t = t0v ? V.norm(t0v) : V.norm(V.sub(pts[1], pts[0]));
      else if (i === n - 1) t = t1v ? V.norm(t1v) : V.norm(V.sub(pts[n - 1], pts[n - 2]));
      else t = V.norm(V.sub(pts[i + 1], pts[i - 1]));      // Catmull-Rom
      if (rot && rot[i]) t = rotv(t, rot[i]);              // 앵커별 접선 회전(도)
      tan.push(t);
    }
    var segs = [];
    for (i = 0; i < n - 1; i++) {
      var d = V.dist(pts[i], pts[i + 1]);
      var a = (tt && tt[i]) ? tt[i][0] : 0.42, b = (tt && tt[i]) ? tt[i][1] : 0.42;
      segs.push({ p0: pts[i], c1: V.add(pts[i], V.mul(tan[i], d * a)),
                  c2: V.sub(pts[i + 1], V.mul(tan[i + 1], d * b)), p1: pts[i + 1] });
    }
    return segs;
  }
  function lineSegs() {
    var p = Array.prototype.slice.call(arguments), s = [];
    for (var i = 0; i < p.length - 1; i++) s.push({ p0: p[i], c1: _lerp(p[i], p[i + 1], 1 / 3), c2: _lerp(p[i], p[i + 1], 2 / 3), p1: p[i + 1] });
    return s;
  }
  /** 베지어 세그먼트 배열 → 조밀 폴리라인 (점 간격 ≤ step cm). SPEC: 곡선 0.5mm 이하.
   *  t 등간격이 아니라 **호길이 등간격**으로 뽑는다 — 핸들이 짧은 구간에서 t 등간격은
   *  점 간격이 몇 배로 벌어져 0.05cm 요구를 못 지킨다. */
  function sampleSegs(segs, step) {
    step = step || FLATTEN;
    var pts = [];
    segs.forEach(function (g, gi) {
      var L = bezLen(g.p0, g.c1, g.c2, g.p1), n = Math.max(2, Math.ceil(L / step));
      var fine = Math.max(64, n * 4), fx = [g.p0], acc = [0], prev = g.p0, i;
      for (i = 1; i <= fine; i++) {
        var p = bez(g.p0, g.c1, g.c2, g.p1, i / fine);
        acc.push(acc[i - 1] + V.dist(prev, p)); fx.push(p); prev = p;
      }
      var total = acc[fine], j = 0;
      for (var k = (gi ? 1 : 0); k <= n; k++) {
        var target = total * k / n;
        while (j < fine - 1 && acc[j + 1] < target) j++;
        var a = acc[j], b = acc[j + 1], u = (b > a) ? (target - a) / (b - a) : 0;
        pts.push(_lerp(fx[j], fx[j + 1], Math.min(1, Math.max(0, u))));
      }
    });
    return pts;
  }
  function polyLen(pts) { var L = 0; for (var i = 1; i < pts.length; i++) L += V.dist(pts[i - 1], pts[i]); return L; }
  /** 닫힌 루프를 바깥으로 sa 만큼 오프셋 (draft-bunka-fs.js offsetLoop) */
  function offsetLoop(pts, saArr) {
    var area = 0, i;
    for (i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
    var ccw = area > 0, out = [];
    for (i = 0; i < pts.length; i++) {
      var prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
      var tan = V.norm(V.sub(next, prev));
      var nrm = ccw ? [tan[1], -tan[0]] : [-tan[1], tan[0]];
      var sa = (typeof saArr === 'number') ? saArr : saArr[i];
      out.push([pts[i][0] + nrm[0] * sa, pts[i][1] + nrm[1] * sa]);
    }
    return out;
  }

  /** 두 직선 (A0 + t·d0) × (A1 + u·d1) 교점. 평행이면 null */
  function lineX(A0, d0, A1, d1) {
    var den = d0[0] * d1[1] - d0[1] * d1[0];
    if (Math.abs(den) < 1e-12) return null;
    var t = ((A1[0] - A0[0]) * d1[1] - (A1[1] - A0[1]) * d1[0]) / den;
    return [A0[0] + d0[0] * t, A0[1] + d0[1] * t];
  }

  /** 변별 시접이 다른 폐곡선 오프셋 — 인덱스 1:1 유지.
   *  @param pts    완성선 폐곡선
   *  @param saSeg  구간(i → i+1)별 시접. 0 이면 그 구간은 움직이지 않는다(골선)
   *  @param limit  마이터 한계 배수 (넘으면 이등분선 방향으로 클램프 = bevel 근사)
   *  볼록 모서리는 마이터, 시접이 서로 다른 모서리(골선 접점)는 두 오프셋 직선의 교점 →
   *  골선 위로 시접만큼 연장된 정확한 재단 모서리가 나온다.                        */
  function offsetLoopSeg(pts, saSeg, limit) {
    limit = limit || 3;
    var n = pts.length, i, area = 0;
    for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var ccw = area > 0, nrm = [], dir = [];
    for (i = 0; i < n; i++) {
      var t = V.norm(V.sub(pts[(i + 1) % n], pts[i]));
      dir.push(t);
      nrm.push(ccw ? [t[1], -t[0]] : [-t[1], t[0]]);   // 바깥 법선
    }
    var out = [];
    for (i = 0; i < n; i++) {
      var ip = (i - 1 + n) % n, s0 = saSeg[ip], s1 = saSeg[i], P = pts[i];
      if (s0 === 0 && s1 === 0) { out.push([P[0], P[1]]); continue; }   // 골선 내부 → 그대로
      if (s0 === s1) {
        var mm = V.add(nrm[ip], nrm[i]), ml = Math.hypot(mm[0], mm[1]);
        if (ml < 1e-9) { out.push([P[0] + nrm[i][0] * s1, P[1] + nrm[i][1] * s1]); continue; }
        var mu = [mm[0] / ml, mm[1] / ml];
        var cosHalf = mu[0] * nrm[i][0] + mu[1] * nrm[i][1];
        var k = s1 / Math.max(cosHalf, 1 / limit);
        out.push([P[0] + mu[0] * k, P[1] + mu[1] * k]);
      } else {
        var A0 = [P[0] + nrm[ip][0] * s0, P[1] + nrm[ip][1] * s0];
        var A1 = [P[0] + nrm[i][0] * s1, P[1] + nrm[i][1] * s1];
        var x = lineX(A0, dir[ip], A1, dir[i]);
        if (!x || V.dist(x, P) > Math.max(s0, s1) * limit) x = A1;
        out.push(x);
      }
    }
    return out;
  }
  /** 단위벡터 회전 (deg) */
  function rotv(v, deg) {
    var r = deg * Math.PI / 180;
    return [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)];
  }
  /** dir 에 수직이면서 to 쪽을 향하는 단위벡터 */
  function perpToward(dir, from, to) {
    var p = [dir[1], -dir[0]];
    if (p[0] * (to[0] - from[0]) + p[1] * (to[1] - from[1]) < 0) p = [-p[0], -p[1]];
    return p;
  }

  /* ══════════════════════════════════════════════════════════════════
   * 1. 치수와 그레이딩 (SPEC §19-1 — 66호 = 교재 46P 필요치수)
   * ════════════════════════════════════════════════════════════════ */
  var BASE  = { B: 87.6, backLen: 38.0, frontLen: 42.0, shoulderW: 38.0,
                backW: 36.8, frontW: 34.3, bpLen: 24.0, bpSpan: 16.0 };   // 원본 DXF 실측
  var GRADE = { B: 6.0,  backLen: 0.5,  frontLen: 0.5,  shoulderW: 0.8,
                backW: 1.2,  frontW: 1.2,  bpLen: 0.5,  bpSpan: 0.5 };
  var SIZE_STEP = { '44호': -2, '55호': -1, '66호': 0, '77호': 1, '88호': 2 };
  var MEAS_KEYS = ['B', 'backLen', 'frontLen', 'shoulderW', 'backW', 'frontW', 'bpLen', 'bpSpan'];
  var MEAS_LABEL = { B: '가슴둘레', backLen: '등길이', frontLen: '앞길이', shoulderW: '어깨너비',
                     backW: '등품', frontW: '앞품', bpLen: '유장', bpSpan: '유폭' };

  /** @returns {Measurements} 호수별 표준 치수 */
  function measuresForSize(sizeName) {
    var step = SIZE_STEP[sizeName];
    if (step === undefined) throw new Error('알 수 없는 호수: ' + sizeName + ' (' + Object.keys(SIZE_STEP).join('|') + ')');
    var m = {};
    MEAS_KEYS.forEach(function (k) { m[k] = +(BASE[k] + GRADE[k] * step).toFixed(2); });
    return m;
  }
  function sizeNameOf(m) {
    var names = Object.keys(SIZE_STEP);
    for (var i = 0; i < names.length; i++) {
      var s = measuresForSize(names[i]), ok = true;
      MEAS_KEYS.forEach(function (k) { if (Math.abs(s[k] - m[k]) > 1e-6) ok = false; });
      if (ok) return names[i];
    }
    return '사용자 지정';
  }
  /* ══════════════════════════════════════════════════════════════════
   * 2. 제도 상수 (SPEC §II + 원본 DXF 실측 캘리브레이션)
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;
  var K = {
    ease         : 4.0,        // 여유분 — 폭 = B/4 + 여유분/2 (도면 `B/4 + 여유분/2`)
    frontBackDiff: 4.0,        // 앞 등길이 차이치수 — 앞 상단이 뒤 상단보다 위 (도면 `앞 등길이 차이치수 4`)
    shEase       : 0.5,        // 어깨 이세분 0.3~0.6 — 뒤 어깨 안내선 = 어깨너비/2 + 이세분
    shEaseMin    : 0.3,
    shEaseMax    : 0.6,

    /* ── 뒷면 ── */
    backNeckAdd  : 0.5,        // 뒷목너비 = B/12 + 0.5
    backNeckLift : 2.5,        // 뒷목 옆점 올림 (도면 `2.5↑`)
    backShDrop   : 1.0,        // 어깨점 = 어깨 안내선에서 아래로 1.0 (도면 `↓1`)
    backArmMid   : 0.3,        // 뒤 암홀 겨드랑 쪽 조정 (도면 `0.3↑`)

    /* ── 앞면 ── */
    frontNeckAdd : 0.6,        // 앞목깊이 = B/12 + 0.6
    frontShDrop  : 4.5,        // 앞 어깨 안내선 = 상단에서 아래로 4.5 (도면 `4.5↓`)
    neckDiagOut  : 0.3,        // 앞목둘레는 목사각 대각선 2/3 점에서 0.3 더 나간 점을 지난다
    frontArmDown : 0.2,        // 앞 암홀 아래쪽 조정 (도면 `0.2↑`)
    dartAmount   : 4.0,        // 가슴다트 분량 (도면 `4 다트분`)
    dartRise     : 9.9,        // 다트 아래 다리 = 허리선에서 위로 9.9
    sideAboveDart: 6.2,        // 겨드랑 → 다트 위 (세로 기준, 도면 `6.2`)
    dartTrueOut  : 1.14        // 다트 중심선을 다리길이보다 이만큼 더 연장한 곳이 트루잉 점
  };

  /* 곡선 캘리브레이션 — 원본 DXF 에 맞춰 적합. 무차원 비율/접선크기라 호수를 따라 스케일된다.
     재적합: node calibrate.js */
  var CAL = {
    backNeck : { mx: 0.7700, my: 0.6435, k0: 0.5159, k1: 0.2000 },              // 편차 0.160
    frontNeck: { out: 0.3990, k0: 0.6245, k1: 0.2000 },                         // 편차 0.104
    backArm  : { d1: 0.1445, d2: 0.1100, hx: 0.8000, hy: 0.3760,
                 k0: 0.5087, k1: 1.2520 },                                      // 편차 0.128
    frontArm : { d1: -0.0200, d2: 0.2433, hx: 0.8000, hy: 0.3355,
                 k0: 1.2919, k1: 0.5965 }                                       // 편차 0.161
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도
   * ════════════════════════════════════════════════════════════════ */
  function rotAbout(p, c, a) {
    var s = Math.sin(a), q = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * q - y * s, c[1] + x * s + y * q];
  }
  function num(v, d) { return (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v; }

  /** 제도점 + 곡선 (폴리라인 flatten 없음) — draftBodice2 와 검증기가 공유
   *  좌표계: 앞뒤 **각자 자기 상단선**이 y=0. 앞 상단은 뒤 상단보다 frontBackDiff 위라
   *  두 조각을 나란히 놓으면 허리선이 같은 높이에 온다. */
  function geom(m, opt) {
    opt = opt || {};
    MEAS_KEYS.forEach(function (k) {
      if (typeof m[k] !== 'number' || !isFinite(m[k])) throw new Error('치수 누락/오류: ' + k);
    });
    var B = m.B, nw = B / 12;
    var ease    = num(opt.ease,        K.ease);
    var shEase  = num(opt.shoulderEase, K.shEase);
    var dartAmt = num(opt.dartAmount,  K.dartAmount);
    var dartRise= num(opt.dartRise,    K.dartRise);

    var halfW = B / 4 + ease / 2;      // 옆선 x — 앞뒤 공통
    var BL    = B / 4;                 // 가슴선 y — 앞뒤 공통 (각자 상단 기준)
    var WLb   = m.backLen;             // 뒤 허리선
    var WLf   = m.frontLen;            // 앞 허리선
    var diff  = WLf - WLb;             // 앞 등길이 차이치수 (도면 4)

    /* ───────── 뒷면 ───────── */
    var bSideX  = halfW, bPitchX = m.backW / 2;
    var BNP     = [0, 0];
    var bNeckW  = nw + K.backNeckAdd;
    var SNPb    = [bNeckW, -K.backNeckLift];
    var bSpX    = m.shoulderW / 2 + shEase;
    var SPb     = [bSpX, K.backShDrop];
    var Ub      = [bSideX, BL];
    var bWaist  = [bSideX, WLb];
    var shLenBack = V.dist(SNPb, SPb);

    /* ───────── 앞면 ───────── */
    var fSideX  = halfW, fPitchX = m.frontW / 2;
    var SNPf    = [nw, 0];                       // 앞목 옆점 — 상단선 위
    var FNP     = [0, nw + K.frontNeckAdd];      // 앞목 깊이
    /* 앞 어깨 — 목옆점에서 **뒤 어깨선과 같은 길이**로 재어 상단에서 4.5 내려간 자리가 안내선 끝.
       거기서 이세분만큼 되돌린 점이 실제 어깨점이다 (도면 `이세분 커트`). */
    var dy = K.frontShDrop, dx = Math.sqrt(Math.max(0, shLenBack * shLenBack - dy * dy));
    var fShGuide= [SNPf[0] + dx, SNPf[1] + dy];
    var shLenFront = shLenBack - shEase;
    var fShDir  = V.norm(V.sub(fShGuide, SNPf));
    var SPf     = V.add(SNPf, V.mul(fShDir, shLenFront));
    var Uf      = [fSideX, BL];
    var fWaist  = [fSideX, WLf];
    var BP      = [m.bpSpan / 2, SNPf[1] + m.bpLen];

    /* 가슴다트 — 아래 다리를 옆선에 두고 BP 중심으로 다트분만큼 돌려 위 다리를 만든다 */
    var dartLo  = [fSideX, WLf - dartRise];
    var dartLeg = V.dist(BP, dartLo);
    var dartAng = 2 * Math.asin(Math.min(0.999, dartAmt / 2 / dartLeg));
    var dartHi  = rotAbout(dartLo, BP, -dartAng);
    /* 트루잉 점 — 다트를 접었을 때 옆선이 이어지도록 두 다리 끝에서 같은 거리에 둔다 */
    var mid     = [(dartHi[0] + dartLo[0]) / 2, (dartHi[1] + dartLo[1]) / 2];
    var dartT   = V.add(BP, V.mul(V.norm(V.sub(mid, BP)), dartLeg + K.dartTrueOut));

    /* ───────── 곡선 ───────── */
    var backNeck  = curveBackNeck(BNP, SNPb);
    var backArm   = curveBackArm(SPb, [bPitchX, 0], Ub, BL);
    var frontNeck = curveFrontNeck(FNP, SNPf, nw);
    var frontArm  = curveFrontArm(SPf, [fPitchX, 0], Uf, BL);

    return {
      m: m, opt: { ease: ease, shEase: shEase, dartAmount: dartAmt, dartRise: dartRise },
      nw: nw, B: B, BL: BL, halfW: halfW, WLb: WLb, WLf: WLf, diff: diff, shEase: shEase,
      bSideX: bSideX, bPitchX: bPitchX, bNeckW: bNeckW, bSpX: bSpX,
      BNP: BNP, SNPb: SNPb, SPb: SPb, Ub: Ub, bWaist: bWaist, shLenBack: shLenBack,
      fSideX: fSideX, fPitchX: fPitchX, fShGuide: fShGuide, fShDir: fShDir, shLenFront: shLenFront,
      SNPf: SNPf, FNP: FNP, SPf: SPf, Uf: Uf, fWaist: fWaist, BP: BP,
      dartLo: dartLo, dartHi: dartHi, dartT: dartT, dartLeg: dartLeg, dartAng: dartAng,
      backNeck: backNeck, backArm: backArm, frontNeck: frontNeck, frontArm: frontArm
    };
  }

  function draftBodice2(m, opt) {
    opt = opt || {};
    var seam = (opt.seam === undefined) ? 0 : opt.seam;
    var g = geom(m, opt);

    var backEdges = [
      { name: '뒷목둘레', role: 'neck',     segs: revSegs(g.backNeck) },   // 뒤중심 → 목옆점
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPb, g.SPb) },
      { name: '뒤암홀',   role: 'armhole',  segs: g.backArm },
      { name: '옆선',     role: 'side',     segs: lineSegs(g.Ub, g.bWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.bWaist, [0, g.WLb]) },
      { name: '뒤중심',   role: 'fold',     segs: lineSegs([0, g.WLb], g.BNP) }
    ];
    var frontEdges = [
      { name: '앞목둘레', role: 'neck',     segs: g.frontNeck },            // 앞중심 → 목옆점
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPf, g.SPf) },
      { name: '앞암홀',   role: 'armhole',  segs: g.frontArm },
      { name: '옆선 위',  role: 'side',     segs: lineSegs(g.Uf, g.dartHi) },
      { name: '다트',     role: 'dart',     segs: lineSegs(g.dartHi, g.dartT, g.dartLo) },
      { name: '옆선 아래', role: 'side',    segs: lineSegs(g.dartLo, g.fWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.fWaist, [0, g.WLf]) },
      { name: '앞중심',   role: 'fold',     segs: lineSegs([0, g.WLf], g.FNP) }
    ];

    var backLoop = edgesToLoop(backEdges), frontLoop = edgesToLoop(frontEdges);
    var backSeam = buildSeamline(backLoop, seam), frontSeam = buildSeamline(frontLoop, seam);

    var nBackArm  = armNotches(g.backArm,  g.Ub, [g.bPitchX / 2, g.BL], '뒤암홀');
    var nFrontArm = armNotches(g.frontArm, g.Uf, [g.fPitchX / 2, g.BL], '앞암홀');

    var backPiece = {
      id: 'back', name: '뒷면', cutCount: 2, kind: 'body',
      grainline: [[1.5, 2.0], [1.5, g.WLb - 2.0]],
      outline: backLoop.pts, seamline: backSeam.seamline, foldEdges: backSeam.foldEdges,
      seamEdges: backSeam.seamEdges, seamFoldEdges: backSeam.seamFoldEdges,
      seamByRole: backSeam.seamByRole, edges: withSeam(backLoop.ranges, backSeam.edgeSeam),
      internal: backInternal(g),
      notches: [{ p: cp(g.SPb), angle: 180, label: '어깨점' },
                { p: cp(g.SNPb), angle: 90, label: '목옆점' },
                { p: cp(g.Ub), angle: 180, label: '겨드랑' }].concat(nBackArm),
      bbox: bboxOf(backLoop.pts)
    };
    var frontPiece = {
      id: 'front', name: '앞면', cutCount: 2, kind: 'body',
      grainline: [[1.5, 4.0], [1.5, g.WLf - 2.0]],
      outline: frontLoop.pts, seamline: frontSeam.seamline, foldEdges: frontSeam.foldEdges,
      seamEdges: frontSeam.seamEdges, seamFoldEdges: frontSeam.seamFoldEdges,
      seamByRole: frontSeam.seamByRole, edges: withSeam(frontLoop.ranges, frontSeam.edgeSeam),
      internal: frontInternal(g),
      notches: [{ p: cp(g.SPf), angle: 180, label: '어깨점' },
                { p: cp(g.SNPf), angle: 90, label: '목옆점' },
                { p: cp(g.Uf), angle: 180, label: '겨드랑' },
                { p: cp(g.dartHi), angle: 180, label: '다트 위' },
                { p: cp(g.dartLo), angle: 180, label: '다트 아래' }].concat(nFrontArm),
      bbox: bboxOf(frontLoop.pts)
    };

    var AHb = sLen(g.backArm), AHf = sLen(g.frontArm);
    var NKb = sLen(g.backNeck), NKf = sLen(g.frontNeck);
    /* 옆선 — 앞은 다트분만큼 길게 재단하고 접으면 뒤와 같아진다 */
    var sideBack = V.dist(g.Ub, g.bWaist);
    var sideFrontCut = (g.WLf - g.BL);
    var sideFrontSewn = sideFrontCut - g.opt.dartAmount;

    var warnings = [], notes = [];
    if (Math.abs(sideBack - sideFrontSewn) > 0.05)
      warnings.push('다트를 접은 뒤 앞 옆선 ' + r4(sideFrontSewn) + ' 이 뒤 옆선 ' + r4(sideBack) +
        ' 과 ' + r4(Math.abs(sideBack - sideFrontSewn)) + ' 다릅니다.');

    return {
      pieces: [frontPiece, backPiece], warnings: warnings, notes: notes,
      measures: {
        shoulderBack: r4(g.shLenBack), shoulderFront: r4(g.shLenFront), shoulderEase: r4(g.shEase),
        shoulderBackSeam: r4(g.shLenBack), shoulderFrontSeam: r4(g.shLenFront),
        armholeBack: r4(AHb), armholeFront: r4(AHf), armholeTotal: r4(AHb + AHf),
        neckBack: r4(NKb), neckFront: r4(NKf), neckTotal: r4(NKb + NKf),
        sideBack: r4(sideBack), sideFront: r4(sideFrontCut), sideFrontSewn: r4(sideFrontSewn),
        halfWidth: r4(g.halfW), ease: r4(g.opt.ease), BL: r4(g.BL),
        frontBackDiff: r4(g.diff), dartAmount: r4(g.opt.dartAmount),
        dartLeg: r4(g.dartLeg), dartAngleDeg: r4(g.dartAng * 180 / Math.PI),
        bust: r4(g.B), waistBack: r4(g.WLb), waistFront: r4(g.WLf)
      },
      meta: {
        title: '숙녀복 기본원형 II', source: '교재 「숙녀복 기본원형 II」 제도 1·2',
        sizeName: sizeNameOf(m), m: m, geom: g, warnings: warnings, notes: notes,
        formulaNotes: formulaNotes(m, g, AHb, AHf, NKb, NKf, seam)
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 4. 곡선
   * ════════════════════════════════════════════════════════════════ */
  /** 뒷목둘레 : 목옆점 → 뒤중심(수평 도착) */
  function curveBackNeck(BNP, SNP) {
    var C = CAL.backNeck;
    var Mp = [SNP[0] * C.mx, SNP[1] * (1 - C.my)];
    return splineSegs([SNP, Mp, BNP], endTan(V.sub(BNP, SNP), C.k0), endTan([-1, 0], C.k1));
  }
  /** 암홀 — 어깨점 → 품선 1/3 → 품선 2/3 → 오목점 → 겨드랑(수평 도착)
   *  품선을 3등분해 그 자리를 지나는 교재 방식(도면 `3등분`). */
  function curveArm(SP, pitchX, U, BL, topY, C) {
    var y1 = topY + (BL - topY) / 3, y2 = topY + (BL - topY) * 2 / 3;
    var P1 = [pitchX + C.d1, y1], P2 = [pitchX + C.d2, y2];
    var H  = [U[0] - C.hx * (U[0] - pitchX), BL - C.hy * (BL - y2)];
    return splineSegs([SP, P1, P2, H, U], endTan(V.sub(P1, SP), C.k0), endTan([1, 0], C.k1));
  }
  /** 앞목둘레 : 앞중심(수평 출발) → 목사각 대각선 2/3 점 + 0.3 → 목옆점 */
  /** 앞목둘레 : 앞중심(수평 출발) → 목사각 대각선 2/3 점에서 0.3 더 나간 점 → 목옆점 */
  function curveFrontNeck(FNP, SNP, nw) {
    var C = CAL.frontNeck, dep = FNP[1];
    var P0 = [nw * 2 / 3, dep * 2 / 3];
    var Pm = V.add(P0, V.mul(V.norm([nw, dep]), C.out));
    return splineSegs([FNP, Pm, SNP], endTan([1, 0], C.k0), endTan(V.sub(SNP, Pm), C.k1));
  }
  function curveBackArm(SP, pitchTop, U, BL) {
    return curveArm(SP, pitchTop[0], U, BL, 0.671, CAL.backArm);
  }
  function curveFrontArm(SP, pitchTop, U, BL) {
    return curveArm(SP, pitchTop[0], U, BL, SP[1], CAL.frontArm);
  }

  /* ══════════════════════════════════════════════════════════════════
   * 5. 조각 부속 (기준선 · 주석 · 시접 · bbox)
   * ════════════════════════════════════════════════════════════════ */
  function revSegs(segs) {
    return segs.slice().reverse().map(function (g) { return { p0: g.p1, c1: g.c2, c2: g.c1, p1: g.p0 }; });
  }
  /** 변 목록 → 조밀 폴리라인 폐곡선 + 변별 인덱스 구간
   *  구간 start 는 그 변의 '두 번째' 샘플점 (첫 점은 앞 변과 공유하는 모서리라 앞 변이 가짐) */
  function edgesToLoop(edges) {
    var pts = [], ranges = [];
    edges.forEach(function (e, ei) {
      var sp = sampleSegs(e.segs, FLATTEN), start = pts.length;
      sp.forEach(function (p, i) { if (ei > 0 && i === 0) return; pts.push([p[0], p[1]]); });
      ranges.push({ name: e.name, role: e.role || 'side', fold: e.role === 'fold',
                    start: start, end: pts.length - 1 });
    });
    // 마지막 점이 시작점과 같으면 제거 (닫힌 폐곡선: 암묵적으로 닫음)
    if (pts.length > 1 && V.dist(pts[0], pts[pts.length - 1]) < 1e-9) {
      pts.pop(); ranges[ranges.length - 1].end--;
    }
    return { pts: pts, ranges: ranges };
  }
  /** edges[] 에 실제 적용된 시접을 얹어 되돌려 준다 (SPEC §11-1) */
  function withSeam(ranges, edgeSeam) {
    return ranges.map(function (r, k) {
      return { name: r.name, role: r.role, fold: r.fold, seam: edgeSeam ? edgeSeam[k] : 0,
               start: r.start, end: r.end };
    });
  }
  function foldRanges(loop) {
    return loop.ranges.filter(function (r) { return r.fold; })
      .map(function (r) { return [r.start, r.end]; });
  }

  /* ── 위치별 시접 (SPEC §11-1) ─────────────────────────────────────── */
  var SEAM_DEFAULT = { neck: 1.0, shoulder: 1.0, armhole: 1.0, side: 1.5, hem: 3.0, dart: 1.5, facing: 1.0, fold: 0 };
  var SEAM_ROLES = Object.keys(SEAM_DEFAULT);

  /** opt.seam 정규화 — 숫자면 전 부위 균일, 객체면 role 별. fold 는 항상 0 강제. */
  function normSeam(seam) {
    var out = {}, warn = null, i;
    if (seam === undefined || seam === null) seam = 0;
    if (typeof seam === 'number') {
      if (!(seam > 0)) { for (i = 0; i < SEAM_ROLES.length; i++) out[SEAM_ROLES[i]] = 0; return { map: out, uniform: 0, warn: null }; }
      for (i = 0; i < SEAM_ROLES.length; i++) out[SEAM_ROLES[i]] = seam;
      out.fold = 0;
      return { map: out, uniform: seam, warn: null };
    }
    for (i = 0; i < SEAM_ROLES.length; i++) {
      var k = SEAM_ROLES[i];
      var v = (typeof seam[k] === 'number' && isFinite(seam[k]) && seam[k] >= 0) ? seam[k] : SEAM_DEFAULT[k];
      out[k] = v;
    }
    if (typeof seam.fold === 'number' && seam.fold !== 0) warn = '골선(fold) 시접은 항상 0 입니다 — 입력값 ' + seam.fold + ' 무시';
    out.fold = 0;
    return { map: out, uniform: null, warn: warn };
  }

  /** 변별 시접이 다른 폐곡선 오프셋.
   *  ① 변마다 자기 시접으로 오프셋 → ② 모서리에서 두 오프셋선의 교점(마이터)으로 접합,
   *  한계 초과 시 bevel → ③ 자기교차 루프 제거.
   *  seamline 은 outline 과 인덱스 1:1 을 보장하지 않으므로 seamEdges 를 함께 돌려준다.
   *  (시접이 전 부위 동일하고 모서리가 전부 마이터면 결과적으로 1:1 이 유지된다.) */
  function buildSeamline(loop, seamOpt) {
    var pts = loop.pts, ranges = loop.ranges, n = pts.length, i, j;
    var ns = normSeam(seamOpt), smap = ns.map;
    var edgeSeam = ranges.map(function (r) { return smap[r.role] === undefined ? 0 : smap[r.role]; });
    var anySeam = edgeSeam.some(function (v) { return v > 0; });
    if (!anySeam) {
      return { seamline: pts.map(cp), foldEdges: foldRanges(loop),
        seamEdges: ranges.map(function (r, k) {
          return { role: r.role, name: r.name, seam: 0, start: r.start, end: r.end };
        }),
        seamFoldEdges: foldRanges(loop), seamByRole: smap, warn: ns.warn };
    }

    // 바깥 방향 결정
    var area = 0;
    for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var ccw = area > 0;
    var segDir = [], segNrm = [];
    for (i = 0; i < n; i++) {
      var t = V.norm(V.sub(pts[(i + 1) % n], pts[i]));
      segDir.push(t);
      segNrm.push(ccw ? [t[1], -t[0]] : [-t[1], t[0]]);
    }

    // ① 변별 점 인덱스 (양 끝 모서리 포함) — 이웃 변과 끝점을 공유한다
    var idxOf = ranges.map(function (r, k) {
      var lo = (k === 0) ? 0 : r.start - 1, hi = r.end, list = [];
      for (var q = lo; q <= hi; q++) list.push(q);
      if (k === ranges.length - 1) list.push(0);      // 마지막 변은 시작점으로 닫힌다
      return list;
    });

    // ② 변별 오프셋 (변 내부는 시접이 같으므로 이등분선 마이터)
    var LIMIT = 3;
    var offEdge = idxOf.map(function (list, k) {
      var s = edgeSeam[k], out = [];
      for (var q = 0; q < list.length; q++) {
        var gi = list[q], P = pts[gi];
        if (s === 0) { out.push(cp(P)); continue; }
        var nPrev = (q === 0) ? segNrm[gi] : segNrm[(gi - 1 + n) % n];
        var nNext = (q === list.length - 1) ? segNrm[(gi - 1 + n) % n] : segNrm[gi];
        var mm = V.add(nPrev, nNext), ml = Math.hypot(mm[0], mm[1]);
        if (ml < 1e-9) { out.push([P[0] + nNext[0] * s, P[1] + nNext[1] * s]); continue; }
        var mu = [mm[0] / ml, mm[1] / ml];
        var cosHalf = mu[0] * nNext[0] + mu[1] * nNext[1];
        var kk = s / Math.max(cosHalf, 1 / LIMIT);
        out.push([P[0] + mu[0] * kk, P[1] + mu[1] * kk]);
      }
      return out;
    });

    /* ③ 모서리 접합 — 변 k 와 변 k+1 사이
     *    · 두 변의 시접이 같으면 이등분선 마이터 (등폭 균일 오프셋과 완전히 동일 → 하위호환)
     *    · 다르면 두 오프셋선의 교점. 마이터 한계 초과 시 bevel(두 점) */
    var E_ = ranges.length, corners = [];
    for (var k = 0; k < E_; k++) {
      var list = idxOf[k], off = offEdge[k], kNext = (k + 1) % E_;
      var sA = edgeSeam[k], sB = edgeSeam[kNext];
      var cornerIdx = list[list.length - 1];              // 다음 변과 공유하는 outline 인덱스
      var P = pts[cornerIdx];
      // 모서리 소유 변: 한쪽이 골선이면 골선 쪽(골선 위 x=0 연장점이므로), 아니면 끝나는 변
      var cornOwner = (sA === 0) ? k : (sB === 0 ? kNext : k);
      var nPrev = segNrm[(cornerIdx - 1 + n) % n], nNext = segNrm[cornerIdx];

      /* 양쪽 변의 오프셋 직선 — 조립 때 "모서리 뒤로 되돌아간 점" 을 걸러내는 데 쓴다 */
      var LA = { p: [P[0] + nPrev[0] * sA, P[1] + nPrev[1] * sA], n: nPrev };
      var LB = { p: [P[0] + nNext[0] * sB, P[1] + nNext[1] * sB], n: nNext };
      var CR = { p: cp(P), r: Math.max(sA, sB) * 2 + 0.2 };   // 되짚음 판정을 쓸 모서리 반경
      if (Math.abs(sA - sB) < 1e-12) {                    // ── 등폭 → 이등분선 마이터
        if (sA === 0) { corners.push({ pts: [cp(P)], own: [cornOwner], la: LA, lb: LB, cr: CR }); continue; }
        var mm = V.add(nPrev, nNext), ml = Math.hypot(mm[0], mm[1]);
        if (ml < 1e-9) { corners.push({ pts: [[P[0] + nNext[0] * sA, P[1] + nNext[1] * sA]], own: [cornOwner], la: LA, lb: LB, cr: CR }); continue; }
        var mu = [mm[0] / ml, mm[1] / ml];
        var kk = sA / Math.max(mu[0] * nNext[0] + mu[1] * nNext[1], 1 / LIMIT);
        corners.push({ pts: [[P[0] + mu[0] * kk, P[1] + mu[1] * kk]], own: [cornOwner], la: LA, lb: LB, cr: CR });
        continue;
      }
      // ── 이폭 → 두 오프셋선의 교점
      var A = LA.p, Bp = LB.p;
      var X = lineX(A, segDir[(cornerIdx - 1 + n) % n], Bp, segDir[cornerIdx]);
      var lim = Math.max(sA, sB) * LIMIT;
      if (X && V.dist(X, P) <= lim) corners.push({ pts: [X], own: [cornOwner], la: LA, lb: LB, cr: CR });
      else corners.push({ pts: [A, Bp], own: [k, cornOwner], la: LA, lb: LB, cr: CR });     // bevel
    }
    // 조립: outline 인덱스 0 이 변0 의 첫 모서리(= 마지막 변과의 접점)가 되도록
    var seamPts = [], owner = [];
    for (k = 0; k < E_; k++) {
      var cprev = corners[(k - 1 + E_) % E_];
      for (var c = 0; c < cprev.pts.length; c++) { seamPts.push(cprev.pts[c]); owner.push(cprev.own[c]); }
      var offK = offEdge[k];
      /* ★ 모서리 교점 뒤로 되돌아가는 점은 버린다.
         시접이 다른 두 변(특히 시접 0 인 골선 ↔ 시접 있는 목선)이 만나면 교점 X 가
         이 변의 오프셋 점열보다 안쪽에 생긴다. 그대로 이으면 X 까지 갔다가 되짚어
         골선 밖으로 튀어나오는데, 두 선이 거의 공선이라 removeSelfLoops 가 못 잡는다.
         (SPEC §11-2 — 골선은 x 를 유지한 채 시접 폭만큼 연장돼야 한다) */
      var q0 = 1, q1 = offK.length - 2;
      if (offK.length > 3) {
        var Xs = cprev.pts[cprev.pts.length - 1], Xe = corners[k].pts[0];
        var d0 = V.sub(offK[1], offK[0]), d1 = V.sub(offK[offK.length - 1], offK[offK.length - 2]);
        /* 이웃 변의 오프셋 직선 안쪽으로 넘어간 점 — **모서리 근방에서만** 본다.
           멀리까지 적용하면 직각으로 꺾이는 변(옆선↔허리선)에서 변 전체가 지워진다. */
        var La = cprev.la, Lb = corners[k].lb, Ca = cprev.cr, Cb = corners[k].cr;
        var behind = function (pt, L, C) {
          if (!L || !C || V.dist(pt, C.p) > C.r) return false;
          return ((pt[0] - L.p[0]) * L.n[0] + (pt[1] - L.p[1]) * L.n[1]) < -1e-9;
        };
        while (q0 <= q1 && ((offK[q0][0] - Xs[0]) * d0[0] + (offK[q0][1] - Xs[1]) * d0[1] < 0
                            || behind(offK[q0], La, Ca))) q0++;
        while (q1 >= q0 && ((offK[q1][0] - Xe[0]) * d1[0] + (offK[q1][1] - Xe[1]) * d1[1] > 0
                            || behind(offK[q1], Lb, Cb))) q1--;
      }
      for (var q = q0; q <= q1; q++) { seamPts.push(offK[q]); owner.push(k); }
    }

    /* ④-0 골선 클램프 — SPEC §11-2: 시접 0 인 골선은 **좌표를 유지한 채** 시접 폭만큼
       연장돼야 한다. 이웃 변의 오프셋이 골선을 조금이라도 넘으면 재단 시 중심이 잘린다. */
    var foldR = loop.ranges.filter(function (r) { return r.role === 'fold'; });
    if (foldR.length) {
      var cx = 0, cy = 0;
      for (i = 0; i < pts.length; i++) { cx += pts[i][0]; cy += pts[i][1]; }
      cx /= pts.length; cy /= pts.length;
      foldR.forEach(function (r) {
        var a = pts[r.start], b = pts[r.end];
        if (V.dist(a, b) < 1e-6) return;
        var t = V.norm(V.sub(b, a)), nf = [t[1], -t[0]];
        if (nf[0] * (cx - a[0]) + nf[1] * (cy - a[1]) > 0) nf = [-nf[0], -nf[1]];   // 조각 바깥
        for (var z = 0; z < seamPts.length; z++) {
          var dv = (seamPts[z][0] - a[0]) * nf[0] + (seamPts[z][1] - a[1]) * nf[1];
          if (dv > 1e-9) seamPts[z] = [seamPts[z][0] - nf[0] * dv, seamPts[z][1] - nf[1] * dv];
        }
      });
    }

    // ④ 자기교차 루프 제거
    var cleaned = removeSelfLoops(seamPts, owner);

    // ⑤ seamEdges 재구성
    var se = [], cur = null;
    for (i = 0; i < cleaned.owner.length; i++) {
      var o = cleaned.owner[i];
      if (!cur || cur.k !== o) { if (cur) se.push(cur); cur = { k: o, start: i, end: i }; }
      else cur.end = i;
    }
    if (cur) se.push(cur);
    // 같은 변이 앞뒤로 쪼개졌으면(마지막 변이 0번 인덱스로 감김) 그대로 둔다 — print.js 가 구간 목록으로 읽는다
    var seamEdges = se.map(function (r) {
      return { role: ranges[r.k].role, name: ranges[r.k].name, seam: edgeSeam[r.k], start: r.start, end: r.end };
    });
    return {
      seamline: cleaned.pts,
      foldEdges: foldRanges(loop),
      seamEdges: seamEdges,
      seamFoldEdges: seamEdges.filter(function (r) { return r.role === 'fold'; })
        .map(function (r) { return [r.start, r.end]; }),
      seamByRole: smap,
      edgeSeam: edgeSeam,
      warn: ns.warn
    };
  }

  /** 폐곡선의 자기교차 루프 제거 — 교차하는 두 구간 사이의 짧은 쪽을 교점 하나로 대체 */
  function removeSelfLoops(pts, owner) {
    var guard = 0;
    while (guard++ < 60) {
      var n = pts.length, hit = null, i, j;
      for (i = 0; i < n && !hit; i++) {
        var a1 = pts[i], a2 = pts[(i + 1) % n];
        var ax0 = Math.min(a1[0], a2[0]), ax1 = Math.max(a1[0], a2[0]);
        var ay0 = Math.min(a1[1], a2[1]), ay1 = Math.max(a1[1], a2[1]);
        for (j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          var b1 = pts[j], b2 = pts[(j + 1) % n];
          if (Math.min(b1[0], b2[0]) > ax1 || Math.max(b1[0], b2[0]) < ax0) continue;
          if (Math.min(b1[1], b2[1]) > ay1 || Math.max(b1[1], b2[1]) < ay0) continue;
          var X = segX(a1, a2, b1, b2);
          if (X) { hit = { i: i, j: j, X: X }; break; }
        }
      }
      if (!hit) break;
      var inner = hit.j - hit.i;                       // i+1 … j 구간 길이
      var np = [], no = [], q;
      if (inner * 2 <= n) {                            // 안쪽(짧은) 루프 제거
        for (q = 0; q <= hit.i; q++) { np.push(pts[q]); no.push(owner[q]); }
        np.push(hit.X); no.push(owner[hit.i]);
        for (q = hit.j + 1; q < n; q++) { np.push(pts[q]); no.push(owner[q]); }
      } else {                                         // 바깥(짧은) 루프 제거
        for (q = hit.i + 1; q <= hit.j; q++) { np.push(pts[q]); no.push(owner[q]); }
        np.push(hit.X); no.push(owner[hit.j]);
      }
      if (np.length < 8) break;
      pts = np; owner = no;
    }
    return { pts: pts, owner: owner };
  }
  function segX(p1, p2, p3, p4) {
    var d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-12) return null;
    var t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    var u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9)
      return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
    return null;
  }
  /* ── 암홀·소매산 3등분 너치 (숙녀복1 엔진과 같은 규칙) ────────────────
   *  ① 몸판 암홀을 3등분 · 소매산은 **몸판 구간 + 그 구간 몫의 이세** 자리
   *  ② 겨드랑 구간 이세 0 — 거기 이세를 넣으면 주름이 지고 겨드랑이 당긴다
   *  ③ 전체 이세는 뒤 60% / 앞 40% — 어깨 맞춤 너치를 옮겨 맞춘다            */
  var ARM_DIV = 3, EASE_SHARE = [0.0, 0.5, 0.5], EASE_BACK = 0.6;
  function _ptAtLen(segs, dist, fromEnd) {
    var p = sampleSegs(segs, 0.02);
    if (fromEnd) p = p.slice().reverse();
    var acc = 0;
    for (var i = 1; i < p.length; i++) {
      var g2 = V.dist(p[i - 1], p[i]);
      if (acc + g2 >= dist) {
        var t = g2 > 1e-9 ? (dist - acc) / g2 : 0;
        return { p: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t],
                 tan: V.norm(V.sub(p[i], p[i - 1])) };
      }
      acc += g2;
    }
    var n2 = p.length;
    return { p: cp(p[n2 - 1]), tan: V.norm(V.sub(p[n2 - 1], p[n2 - 2])) };
  }
  function _inward(tan, at, inside) {
    var nr = [tan[1], -tan[0]];
    if (nr[0] * (inside[0] - at[0]) + nr[1] * (inside[1] - at[1]) < 0) nr = [-nr[0], -nr[1]];
    return angDeg(nr);
  }
  function armNotches(armSegs, underarm, inside, tag) {
    var p0 = sampleSegs(armSegs, 0.05)[0];
    var fromEnd = V.dist(p0, underarm) > 1e-6;
    var L = polyLen(sampleSegs(armSegs, 0.02)), out = [];
    for (var q = 1; q < ARM_DIV; q++) {
      var h = _ptAtLen(armSegs, L * q / ARM_DIV, fromEnd);
      out.push({ p: cp(h.p), angle: _inward(h.tan, h.p, inside), label: tag + ' ' + q + '/' + ARM_DIV });
    }
    return out;
  }
  function cp(p) { return [p[0], p[1]]; }
  function r4(v) { return Math.round(v * 1e4) / 1e4; }
  function angDeg(v) { return Math.round(Math.atan2(v[1], v[0]) * 180 / Math.PI * 1e3) / 1e3; }
  function bboxOf(pts) {
    var a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    pts.forEach(function (p) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; });
    return { x: r4(a), y: r4(b), w: r4(c - a), h: r4(d - b) };
  }
  /** internal 항목 — SPEC §8.1: label 은 짧은 이름만. 계산식은 meta.formulaNotes 로. */
  function L(id, type, pts, label) { return { id: id, type: type, pts: pts.map(cp), label: label }; }
  function f1(v) { return (Math.round(v * 100) / 100).toString(); }
  /** 곡선을 성긴 점열로 — internal 표시용 */
  function subsamp(segs, n) {
    var p = sampleSegs(segs, 0.4), out = [], step = Math.max(1, Math.floor(p.length / (n || 40)));
    for (var i = 0; i < p.length; i += step) out.push(p[i]);
    if (out[out.length - 1] !== p[p.length - 1]) out.push(p[p.length - 1]);
    return out;
  }
  function backInternal(g) {
    return [
      L('topLine', 'line',   [[0, 0], [g.bSideX, 0]], '상단 기준선'),
      L('BL',      'line',   [[0, g.BL], [g.bSideX, g.BL]], 'BL (B/4)'),
      L('backW',   'dashed', [[g.bPitchX, 0.671], [g.bPitchX, g.BL]], '등품선'),
      L('div3',    'dashed', [[g.bPitchX - 1.6, 0.671 + (g.BL - 0.671) / 3],
                              [g.bPitchX, 0.671 + (g.BL - 0.671) / 3]], '등품선 3등분'),
      L('div3b',   'dashed', [[g.bPitchX - 3.5, 0.671 + (g.BL - 0.671) * 2 / 3],
                              [g.bPitchX, 0.671 + (g.BL - 0.671) * 2 / 3]], '등품선 3등분'),
      L('shGuide', 'dashed', [[g.bSpX, -1.2], [g.bSpX, g.SPb[1]]], '어깨 안내선 (어깨너비/2 + 이세분)'),
      L('neckW',   'dashed', [[g.bNeckW, 0], [g.bNeckW, -2.5]], '뒷목너비'),
      L('SP',      'point',  [g.SPb], 'SP'),
      L('SNP',     'point',  [g.SNPb], 'SNP')
    ];
  }
  function frontInternal(g) {
    var dep = g.FNP[1], nw = g.nw;
    return [
      L('topLine',  'line',   [[0, 0], [g.fSideX, 0]], '상단 기준선'),
      L('BL',       'line',   [[0, g.BL], [g.fSideX, g.BL]], 'BL (B/4)'),
      L('frontW',   'dashed', [[g.fPitchX, g.SPf[1]], [g.fPitchX, g.BL]], '앞품선'),
      L('neckBox',  'dashed', [[0, dep], [nw, dep], [nw, 0]], '앞목 사각'),
      L('neckDiag', 'dashed', [[0, 0], [nw, dep]], '목 사각 대각선'),
      L('shGuide',  'dashed', [g.fShGuide, [g.fShGuide[0], 0]], '어깨 안내선 (4.5↓)'),
      L('shCut',    'dashed', [g.SPf, g.fShGuide], '이세분 커트'),
      L('bpLen',    'dashed', [g.SNPf, g.BP], '유장'),
      L('bpSpan',   'dashed', [[g.BP[0], 0], [g.BP[0], g.BP[1]]], '유폭/2'),
      L('dartMid',  'dashed', [g.BP, g.dartT], '다트 중심'),
      L('sideGuide','dashed', [[g.fSideX, g.BL], [g.fSideX, g.BL + 6.2]], '겨드랑 → 다트 (6.2)'),
      L('BP',       'point',  [g.BP], 'BP'),
      L('SP',       'point',  [g.SPf], 'SP'),
      L('SNP',      'point',  [g.SNPf], 'SNP'),
      L('FNP',      'point',  [g.FNP], 'FNP')
    ];
  }

  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }
  function formulaNotes(m, g, AHb, AHf, NKb, NKf, seam) {
    var nw = g.nw;
    return [
      FN('BL',      'BL',        'B/4',                       g.BL,      'back',  [g.bSideX * 0.5, g.BL]),
      FN('side',    '폭',        'B/4 + 여유분/2',             g.bSideX,  'back',  [g.bSideX, g.BL * 0.6]),
      FN('WL',      '허리선',     '등길이',                     g.WLb,     'back',  [g.bSideX * 0.5, g.WLb]),
      FN('backW',   '등품선',     '등품/2',                     g.bPitchX, 'back',  [g.bPitchX, g.BL * 0.5]),
      FN('neckW',   '뒷목너비',   'B/12 + 0.5',                g.bNeckW,  'back',  [g.bNeckW * 0.5, -2.5]),
      FN('neckLift','뒷목 올림',  '고정 2.5',                   2.5,       'back',  cp(g.SNPb)),
      FN('shGuide', '어깨 안내선', '어깨너비/2 + 이세분',          g.bSpX,    'back',  [g.bSpX, 0.4]),
      FN('shBack',  '뒤 어깨선',  '목옆점 → (어깨너비/2+이세분, 1.0)', g.shLenBack, 'back',
                                  [(g.SNPb[0] + g.SPb[0]) / 2, (g.SNPb[1] + g.SPb[1]) / 2]),
      FN('armBack', '뒤 암홀',    '곡선길이',                    AHb,       'back',  [g.bPitchX + 1.2, g.BL * 0.55]),
      FN('neckBack','뒷목둘레',   '곡선길이',                    NKb,       'back',  [nw * 0.5, -1.0]),
      FN('BL',      'BL',        'B/4',                       g.BL,      'front', [g.fSideX * 0.5, g.BL]),
      FN('WL',      '허리선',     '앞길이',                     g.WLf,     'front', [g.fSideX * 0.5, g.WLf]),
      FN('diff',    '앞 등길이 차이', '앞길이 − 등길이',           g.diff,    'front', [g.fSideX * 0.2, 1.5]),
      FN('frontW',  '앞품선',     '앞품/2',                     g.fPitchX, 'front', [g.fPitchX, g.BL * 0.5]),
      FN('neckW',   '앞목너비',   'B/12',                       nw,        'front', [nw * 0.5, -0.8]),
      FN('neckD',   '앞목깊이',   'B/12 + 0.6',                 g.FNP[1],  'front', [0.6, g.FNP[1] * 0.5]),
      FN('neckDiag','앞목 통과점', '목 사각 대각선 2/3 점에서 0.3 더', 0.3,  'front', [nw * 0.7, g.FNP[1] * 0.7]),
      FN('shGuide', '앞 어깨 안내선', '상단에서 4.5 아래',         4.5,       'front', cp(g.fShGuide)),
      FN('shFront', '앞 어깨선',  '뒤 어깨선 − 이세분 (이세분 커트)', g.shLenFront, 'front',
                                  [(g.SNPf[0] + g.SPf[0]) / 2, (g.SNPf[1] + g.SPf[1]) / 2]),
      FN('bpLen',   '유장',       '앞목 옆점에서',                m.bpLen,   'front', [(g.SNPf[0] + g.BP[0]) / 2, (g.SNPf[1] + g.BP[1]) / 2]),
      FN('bpSpan',  '유폭',       '유폭/2',                     g.BP[0],   'front', [g.BP[0] * 0.5, g.BP[1] - 1.2]),
      FN('dart',    '가슴다트',   '다트분 ' + f1(g.opt.dartAmount) + ' · 아래 다리 = 허리선 위 ' + f1(g.opt.dartRise),
                                  g.opt.dartAmount, 'front', [(g.BP[0] + g.fSideX) / 2, (g.dartHi[1] + g.dartLo[1]) / 2]),
      FN('armFront','앞 암홀',    '곡선길이',                    AHf,       'front', [g.fPitchX + 1.2, g.BL * 0.55]),
      FN('neckFront','앞목둘레',  '곡선길이',                    NKf,       'front', [nw * 0.45, g.FNP[1] * 0.55]),
      FN('seam',    '시접',       '변별 기본값',                 (typeof seam === 'number' ? seam : 0), 'both', [0, 0])
    ];
  }

  /* ══════════════════════════════════════════════════════════════════
   * 6. 노출
   * ════════════════════════════════════════════════════════════════ */
  return {
    measuresForSize: measuresForSize,
    draftBodice2: draftBodice2,
    draft: draftBodice2,
    geom: geom,
    MEAS_KEYS: MEAS_KEYS, MEAS_LABEL: MEAS_LABEL, SIZES: Object.keys(SIZE_STEP),
    BASE: BASE, GRADE: GRADE, K: K, CAL: CAL, FLATTEN: FLATTEN,
    SEAM_DEFAULT: SEAM_DEFAULT, SEAM_ROLES: SEAM_ROLES,
    util: { V: V, bez: bez, bezLen: bezLen, sLen: sLen, through: through, splineSegs: splineSegs,
            endTan: endTan, sPath: sPath, LN: LN,
            sampleSegs: sampleSegs, polyLen: polyLen, offsetLoop: offsetLoop, offsetLoopSeg: offsetLoopSeg,
            normSeam: normSeam, lineSegs: lineSegs,
            rotv: rotv, rotAbout: rotAbout, perpToward: perpToward, revSegs: revSegs }
  };
});
