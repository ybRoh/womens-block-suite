/* ============================================================================
 * 바 재킷 (더블) — 제도 엔진
 *
 *   제도법: **백영례 「테일러 자켓 패턴」 번호점 제도법** (번호점 1~87 · 46단계)
 *           docs/테일러드재킷-제도법-백영례.md 가 이 엔진의 기준 문서다.
 *   조각 7장 — 앞판 · 앞옆판 · 뒤옆판 · 뒤판 · 카라 · 주머니 플랩 · 주머니감
 *              (앞뒤 각 2장 = 4패널 · **옆선이 그대로 있다**)
 *   참고자료: barjacke-36-groundtruth.json (sisterMAG 56 Barjacke DE36 도면 실측)
 *            — 좌표를 맞추는 대상이 **아니라** 치수 참고용이다.
 *
 * 좌표계: cm. 뒤 = 뒤중심선 × 상단 기준선(2번).
 *             앞 = 앞중심선 × **앞 상단선(44번 · 뒤보다 유차만큼 위)**.
 *         x 옆으로 + · y 아래 +.
 *
 * 노출: window.BarJacketEngine / module.exports
 * ==========================================================================*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.BarJacketEngine = api; }
  else if (root) root.BarJacketEngine = api;
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
  /** 원점→D 대각선에 점 P 에서 내린 수선. 교재의 `⌐` 직각 기호가 이것이다.
   *  (숙녀복기본원형1 · 기본원형과 같은 방식 — 반소매/긴소매 DXF 로 검증된 제도법) */
  function footOn(D, P) {
    var L = Math.hypot(D[0], D[1]), u = [D[0] / L, D[1] / L];
    var t = (P[0] * u[0] + P[1] * u[1]);
    var F = [u[0] * t, u[1] * t];
    return { foot: F, t: t / L, dist: V.dist(P, F), u: u, len: L };
  }
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
   * 1. 치수와 그레이딩
   *
   *   ★ 제도는 **백영례 「테일러 자켓 패턴」 번호점 제도법**을 따른다
   *     (docs/테일러드재킷-제도법-백영례.md · 번호점 1~87 · 46단계).
   *     교재는 55 Size 로 설명하지만 **숫자가 아니라 계산식**을 가져온다 —
   *     치수 프리셋은 이 Suite 의 호수표(44~88호)를 그대로 쓴다.
   *
   *   ⚠ 예전 엔진은 sisterMAG Barjacke **36호 도면 좌표 한 벌**에 곡선을 맞췄다.
   *     그래서 절개선 곡률 부호를 앵커로 못 잡고, 옆판 폭이 6.8 어긋난 채 남았다.
   *     식으로 세우면 골격점이 정해지므로 앵커가 필요 없고 전 호수가 따라온다.
   * ════════════════════════════════════════════════════════════════ */
  /* 유B(젖가슴둘레) = B + 2 · 유장(옆목점 → BP)은 55"25 · 66"25.5 · 77"26 (교재 표) */
  var BASE  = { B: 87.6, bustB: 89.6, W: 73.6, H: 97.04, backLen: 37.5, coatLen: 58.5,
                shoulderW: 38.0, backW: 36.8, frontW: 34.3,
                bpSpan: 19.0, bpLen: 25.5, hipLen: 19.0 };
  var GRADE = { B: 6.0,  bustB: 6.0,  W: 6.0,  H: 6.0,  backLen: 0.5,  coatLen: 0.8,
                shoulderW: 0.8, backW: 1.2, frontW: 1.2,
                bpSpan: 0.5, bpLen: 0.5, hipLen: 0.3 };
  var SIZE_STEP = { '44호': -2, '55호': -1, '66호': 0, '77호': 1, '88호': 2 };
  var MEAS_KEYS = ['B', 'bustB', 'W', 'H', 'backLen', 'coatLen', 'shoulderW',
                   'backW', 'frontW', 'bpSpan', 'bpLen', 'hipLen'];
  var MEAS_LABEL = { B: '가슴둘레(상동)', bustB: '젖가슴둘레(유B)', W: '허리둘레', H: '엉덩이둘레',
                     backLen: '등길이', coatLen: '옷길이', shoulderW: '어깨너비',
                     backW: '등품', frontW: '앞품', bpSpan: '유폭', bpLen: '유장',
                     hipLen: '엉덩이길이' };

  function measuresForSize(sizeName) {
    var step = SIZE_STEP[sizeName];
    if (step === undefined) throw new Error('알 수 없는 호수: ' + sizeName);
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
   * 2. 제도 상수 — [ ] 안이 교재의 번호점·단계
   *
   *   ⚠ 실측 좌표를 골격에 박지 않는다. 전부 **치수에서 나오는 값**이거나,
   *     교재가 「자연스럽게 · 원하는 곳」이라고 적은 **스타일 값**이다.
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;
  var K = {
    /* ── Ⅰ. 기본선 [1]~[5] ─────────────────────────────────────────── */
    armDepthAdd  : 1.5,    // 진동깊이 = B/4 + 1.5              [2] 4번
    cbIn         : 1.5,    // 뒤중심 들임                        [5] 7·8·9번
    jacketLenAdd : 6.0,    // 재킷 길이 — 옷길이에 더한다 (스타일)
    /* ── Ⅱ. 뒤판 [6]~[19] ─────────────────────────────────────────── */
    underarmAdd  : 1.75,   // 겨드랑 = 유B/4 + 1.5~2            [7] 13번
    hipEase      : 1.5,    // 밑단(H) = H/4 + 여유 1.5          [8] 16번
    waistEase    : 1.75,   // 허리 = W/4 + 여유 1.5~2           [9] 18번
    /* ★ 교재는 옆선을 「자연스럽게」 그리고 **남는 양을 다트분으로** 삼는다.
       「자연스럽게」가 곧 스타일이므로, 겨드랑~밑단 자연 곡선에서 허리를 얼마나
       더 들일지를 값으로 뺀다. 0 이면 교재 그대로(옆선 들임 없음)다. */
    sideWaistIn  : 1.5,    // 옆선 허리 들임 (19번을 안으로)     [9] 19번
    shSlope      : 1.4,    // 어깨기울기 = 품선 위끝에서 1.3~1.5 [10] 22번
    backShDart   : 1.5,    // 뒤 어깨 다트분                     [10] 21번
    backShEase   : 0.75,   // 다트 대신 이세로 할 때 0.7~0.8    [12]
    backShDartLen: 7.0,    // 어깨 다트 길이                     [19] 40번
    armInset     : 0.5,    // 암홀이 품선에서 떨어지는 양 0.5~1  [13] 26번 · [25] 49번
    bDartCenterIn: 2.5,    // 뒤 절개 중심 = 등품점에서 2~3 안쪽 [14] 27번
    hemCrossUp   : 5.0,    // 밑단 교차점 = 밑단에서 5 위        [14] 29번
    hemSplayMin  : 0.6,    // 밑단 벌림 하한 — 14~16 이 0 이면 이 값 [15] 30·31번
    neckOut      : 1.5,    // 옆목 파기 (앞뒤 공통)              [18] 38번 · [23] 53번
    bnpDrop      : 0.5,    // 뒤중심 목 파기 (목이 굵으면 0.7~1) [18] 37번
    backNeckDivB : 12,     // 뒤목치수 = B/12                    [11] 23번
    /* ── 유차 — 앞이 뒤보다 긴 양. B 90 이상이면 2.8 (교재 표) ───────── */
    bustDiff     : 2.5,
    bustDiffBig  : 2.8,
    /* ── Ⅲ. 앞판 [20]~[38] ────────────────────────────────────────── */
    frontShGuide : 4.5,    // 어깨기울기 안내 = 47번 아래로 4.5  [21] 48번
    frontNeckDrop: 1.0,    // 앞 목옆점 = 50번에서 1 내려        [22] 51번
    bpOutToDart  : 1.75,   // 앞 다트 중심 = BP 에서 1.5~2 옆    [26] 58번
    /* ★ 가슴다트 — 앞 옆선이 뒤보다 **정확히 유차만큼** 길다. 그 길이를 옆선에서
       덜어내는 것이 가슴다트다 (꼭짓점 BP). 다트분을 따로 정하지 않는 이유다.  */
    bustDartAt   : 5.0,    // 겨드랑에서 5 내려간 자리           [27b] 65번
    frontDrop    : 2.5,    // 앞처짐 — 앞중심 밑단을 내린다      [38] 70번
    /* ── Ⅳ. 여밈 · 라펠 · 카라 [39]~[46] ───────────────────────────
       여밈분은 얇은 원단 2 · 두꺼운 원단 2.5 인데 **더블은 훨씬 크다**.
       Barjacke 도면 실측(겹침 7.89 · 단추 간격 9.80)을 더블 기본값으로 둔다. */
    overlap      : 7.89,   // 앞중심 → 여밈 끝                   [38] 71번
    btnOut       : 3.71,   // 앞중심 → 단추열 (좌우 대칭)
    btnGapY      : 9.80,   // 단추 세로 간격
    btnTopFromBL : 5.30,   // 맨 위 단추 — 가슴선에서 아래로
    btnRows      : 3,      // 단추 줄 수
    bhLen        : 2.09,   // 단춧구멍 길이
    rollIn       : 2.5,    // 꺾임선이 어깨선을 지나는 자리       [41] 76번
    gorgeDrop    : 2.5,    // 고지선 시작 = 목옆점에서 2.5 내려   [43] 82번
    gorgeLen     : 8.0,    // 고지선 길이 (= 라펠 폭을 정한다)    [43] 83번
    collarOut    : 0.5,    // 테일러 카라 — 옆목점에서 0.5 나가서 [42] 78번
    collarW      : 7.5,    // 카라 넓이 (79~80)                  [42] 80번
    collarStand  : 3.0,    // 스탠드 높이 — 넓이보다 작아야 눕는다
    /* ★ 카라가 눕는 정도 — 목붙임선을 앞으로 갈수록 `(넓이 − 스탠드) × 이 값`만큼
       올려 굽힌다. 굽은 목붙임선을 바깥으로 넓이만큼 밀면 바깥선이 저절로 길어진다
       (slash & spread 를 안 해도 같은 결과다). 0 이면 목붙임선이 직선 = 선 카라. */
    collarCurl   : 0.55,
    notchLen     : 4.0,    // 카라 끝 — 86번에서 직각 3.5~4      [44] 87번
    notchAngle   : 38.0,   // 노치(V홈) 벌림 각                  [45]
    /* ── 주머니 (교재 밖 · Barjacke 도면 실측) ───────────────────── */
    pocketFromWL : 6.20,   // 주머니 입구 — 허리선에서 아래로
    pocketW      : 14.30,  // 입구 너비
    pocketTilt   : 6.0,    // 앞이 올라가는 기울기(도)
    flapH        : 6.30    // 플랩 높이
  };
  var CAL = {
    backNeck : { a0: 10, k0: 1.60, k1: 0.60 },
    /* 암홀 — 어깨점 → **품선 접점**(수직 접선) → 오목점 → 겨드랑(수평 도착).
       통과점은 자기 구간 안의 **비율**이다 (절대 좌표를 박으면 44호가 겨드랑선
       아래로 파고든다 — 2026-08-12 QA 에서 실제로 그랬다). */
    backArm  : { k0: 1.50, kA: 1.10, kB: 1.50, k1: 2.00, upFx: 0.45, upT: 0.38 },
    frontArm : { k0: 1.20, kA: 1.30, kB: 1.40, k1: 1.60, upFx: 0.45, upT: 0.40 },
    side     : { k0: 0.60, k1: 1.20 },
    princess : { k0: 0.30, kM: 1.00, k1: 0.60 }
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도 — 좌표계는 앞뒤 따로
   *
   *   뒤 = 뒤중심선 × 상단 기준선(2번).  앞 = 앞중심선 × **앞 상단선(44번)**.
   *   x 옆으로 + · y 아래 +.
   *
   *   ★ 앞 상단선은 뒤보다 **유차만큼 위**에 있다 [20]. 두 프레임을 따로 두면
   *     앞의 가로선들이 자기 원점에서 (뒤 높이 + 유차) 로 내려온다 —
   *     그래서 앞 옆선이 뒤보다 정확히 유차만큼 길고, 그 길이를 가슴다트가 먹는다.
   * ════════════════════════════════════════════════════════════════ */
  function rotAbout(p, c, a) {
    var s = Math.sin(a), co = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1];
    return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co];
  }
  function num(v, d) { return (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v; }
  /** 두 점을 잇는 **자연 곡선**(양끝 수직 접선)이 높이 y 에서 갖는 x.
   *  교재의 「자연스레 이어지는 지점」(19번·56번)을 식으로 만든 것이다. */
  function naturalX(a, b, y) {
    var q = ptOnSegsAtY(splineSegs([a, b], endTan([0, 1], 1), endTan([0, 1], 1)), y);
    if (q) return q[0];
    var t = (b[1] - a[1]) ? (y - a[1]) / (b[1] - a[1]) : 0;
    return a[0] + (b[0] - a[0]) * t;
  }
  /** 곡선을 **높이 y** 자리에서 둘로 자른다 (cutSegsAtT 를 호 비율로 환산해 재사용).
   *  @returns {head 겨드랑쪽, tail 어깨쪽, p 자른 점} */
  function cutSegsAtY(segs, y, fromUnderarm) {
    var work = fromUnderarm ? segs : revSegs(segs);
    var pts = sampleSegs(work, 0.02), tot = polyLen(pts), acc = 0, want = 0, bd = Infinity;
    for (var i = 1; i < pts.length; i++) {
      acc += V.dist(pts[i - 1], pts[i]);
      var e = Math.abs(pts[i][1] - y);
      if (e < bd) { bd = e; want = acc; }
    }
    return cutSegsAtT(segs, tot > 1e-9 ? want / tot : 0.3, fromUnderarm);
  }

  function geom(m, opt) {
    opt = opt || {};
    var B = num(opt.B, m.B), W = num(opt.W, m.W), H = num(opt.H, m.H);
    var bustB    = num(opt.bustB, m.bustB !== undefined ? m.bustB : m.B + 2);
    var shoulderW= num(opt.shoulderW, m.shoulderW);
    var backW    = num(opt.backW, m.backW), frontW = num(opt.frontW, m.frontW);
    var bpSpan   = num(opt.bpSpan, m.bpSpan);
    var bpLen    = num(opt.bpLen, m.bpLen !== undefined ? m.bpLen : 25.5);
    var hipLen   = num(opt.hipLen, m.hipLen);
    /* 유차 — 교재 표: 55·66 = 2.5 · 77·88(B 90 이상) = 2.8 */
    var dif      = num(opt.bustDiff, B >= 90 ? K.bustDiffBig : K.bustDiff);
    var cbIn     = num(opt.cbIn, K.cbIn);
    var uAdd     = num(opt.underarmAdd, K.underarmAdd);
    var hipEase  = num(opt.hipEase, K.hipEase);
    var wEase    = num(opt.waistEase, K.waistEase);
    var sideIn   = num(opt.sideWaistIn, K.sideWaistIn);
    var armInset = num(opt.armInset, K.armInset);
    var neckOut  = num(opt.neckOut, K.neckOut);

    /* ───────── Ⅰ. 기본선 [1]~[5] ───────── */
    var BL   = B / 4 + num(opt.armDepthAdd, K.armDepthAdd);   // [2] 4번 진동선
    var WLb  = num(opt.backLen, m.backLen);                   // [3] 5번 W선
    var hipY = WLb + hipLen;                                  // [4] 3번 H선
    var hemY = Math.max(hipY + 1.0,
                 num(opt.coatLen, m.coatLen) + num(opt.jacketLenAdd, K.jacketLenAdd));

    /* ───────── Ⅱ. 뒤판 [6]~[19] ───────── */
    /* [6] 등솔선 — 2번에서 6번(2~4 3등분 위쪽)까지 직선, 6-8 곡선, 8-9 직선 */
    var BNP = [0, num(opt.bnpDrop, K.bnpDrop)];               // [18] 37번 뒤중심 목점
    /* ⚠ 뒤중심선은 **37번(뒷목점)** 에서 시작한다. 2번[0,0] 에서 시작하면 뒷목선
       끝과 0.5 벌어져 폐곡선에 구멍이 난다 (점 간격 검사가 0.46 으로 잡았다). */
    var bCenter = splineSegs([BNP, [0, BL / 3], [cbIn, WLb]],
                    endTan([0, 1], 1.0), endTan([0, 1], 1.0))
                  .concat(lineSegs([cbIn, WLb], [cbIn, hemY]));
    var p10 = [cbIn / 2, BL];                                  // [7] 4~7 2등분
    var bPitchX = p10[0] + backW / 2;                          // [7] 11번 등품점
    var Ub = [p10[0] + bustB / 4 + uAdd, BL];                  // [7] 13번 겨드랑
    var bHemSide = [cbIn + H / 4 + hipEase, hemY];             // [8] 16번
    var bWaistReq = cbIn + W / 4 + wEase;                      // [9] 18번
    /* [9] 13번에서 밑단으로 자연스레 잇고, 그 곡선이 W 선을 지나는 자리가 19번.
           18~19 가 **W 다트분**이다 — 다트를 정해 놓고 옆선을 그리지 않는다. */
    var bWaistSide = [naturalX(Ub, bHemSide, WLb) - sideIn, WLb];
    var bDart = Math.max(0.5, bWaistSide[0] - bWaistReq);
    var backSide = splineSegs([Ub, bWaistSide, bHemSide],
                     endTan([0, 1], CAL.side.k0), endTan([0, 1], CAL.side.k1));
    /* [10]~[12] 어깨 — 24번(목옆) 에서 22번(품선 위끝에서 어깨기울기) 방향으로 긋고,
           x = 어깨너비/2 + 다트분(21번) 이 되는 자리가 어깨점이다.
       ★ 다트 대신 이세로 할 수도 있다 [12] — 둘 중 하나만 쓴다. */
    var shDart = num(opt.backShDart, K.backShDart);
    var shEase = shDart > 0.01 ? 0 : num(opt.backShEase, K.backShEase);
    var shExtra = shDart > 0.01 ? shDart : shEase;
    var SNPb0 = [B / K.backNeckDivB, -dif];                    // [11] 24번
    var SNPb  = [SNPb0[0] + neckOut, -dif];                    // [18] 38번 옆목 파기
    var p22 = [bPitchX, num(opt.shSlope, K.shSlope)];          // [10] 22번
    var dirB = V.norm(V.sub(p22, SNPb0));
    var bSpX = shoulderW / 2 + shExtra;                        // [10] 21번
    var SPb = [bSpX, SNPb0[1] + (bSpX - SNPb0[0]) * dirB[1] / (dirB[0] || 1e-9)];
    var shLenBack = V.dist(SNPb, SPb);
    /* [18] 뒷목선 — 38번에서 2~23 3등분점을 지나 37번(뒤중심)으로 */
    var backNeck = curveBackNeck(BNP, SNPb, [SNPb0[0] * 2 / 3, 0], SPb);
    /* [13] 26번 = 22~11 2등분 = 암홀 접점 높이. 암홀은 등품에서 armInset 떨어진다 */
    var bArmTan = [bPitchX + armInset, (p22[1] + BL) / 2];
    var backArm = armCurve2(SPb, bArmTan, Ub, CAL.backArm);
    /* [14]~[16] 뒤 절개선 — 암홀에서 27번(다트 중심)을 향해. 26번 위로 가면 안 된다 */
    var bCx  = bPitchX - num(opt.bDartCenterIn, K.bDartCenterIn);   // 27번
    var bCut = cutSegsAtY(backArm, bArmTan[1] + Math.max(0, num(opt.bCutDrop, 0)), false);
    var bSplit = Math.max(K.hemSplayMin, Math.abs(bHemSide[0] - Ub[0]) / 2);  // [15] 14~16 2등분
    var bCross = [bCx, hemY - num(opt.hemCrossUp, K.hemCrossUp)];            // [14] 29번
    var bPwA = [bCx + bDart / 2, WLb], bPwB = [bCx - bDart / 2, WLb];        // [16] 32·33번
    var bPhA = [bCx - bSplit, hemY],  bPhB = [bCx + bSplit, hemY];           // [15] 30·31번
    /* 32-31 · 33-30 으로 **엇갈려** 잇는다 — 29번에서 교차하며 밑단이 벌어진다 */
    var bPrinOut = cutLine(bCut.p, [bCx, BL], bPwA, bCross, bPhA);
    var bPrinIn  = cutLine(bCut.p, [bCx, BL], bPwB, bCross, bPhB);
    /* [19] 어깨 다트 — 어깨선 2등분에서 다트분, 길이 7 */
    var shU = V.norm(V.sub(SPb, SNPb));
    var shMid = V.add(SNPb, V.mul(shU, shLenBack / 2));
    var shLegIn  = V.add(shMid, V.mul(shU, -shDart / 2));
    var shLegOut = V.add(shMid, V.mul(shU,  shDart / 2));
    var shDown = [-shU[1], shU[0]];                       // 어깨선에 직각 · 몸 안쪽(아래)
    if (shDown[1] < 0) shDown = [-shDown[0], -shDown[1]];
    var shApex = V.add(shMid, V.mul(shDown, num(opt.backShDartLen, K.backShDartLen)));

    /* ───────── Ⅲ. 앞판 [20]~[38] ─────────
       앞 프레임의 가로선은 자기 원점에서 (뒤 높이 + 유차) 다 [20]. */
    var WLf = WLb + dif, hipYf = hipY + dif, hemYf = hemY + dif;
    var SNPf0 = [B / K.backNeckDivB, num(opt.frontNeckDrop, K.frontNeckDrop)];  // [22] 51번
    var SNPf  = [SNPf0[0] + neckOut, SNPf0[1]];                                 // [23] 53번
    var fPitchX = frontW / 2;                                                   // [21] 46번
    var p48 = [fPitchX, num(opt.frontShGuide, K.frontShGuide)];                 // [21] 48번
    var fArmTan = [fPitchX + armInset, BL * 2 / 3];                             // [21] 49번
    var p69 = [fPitchX, (BL + p48[1]) / 2];                                     // [28] 69번 (절개 상한)
    var Uf  = [Ub[0], BL];                                                      // [20] 41번 — 옆선을 뒤와 공유
    var fHemSide = [H / 4 + hipEase, hemYf];        // 앞은 **기본선에서** H 치수가 나간다
    var fWaistReq = W / 4 + wEase;                                              // [24] 55번
    var fWaistSide = [naturalX(Uf, fHemSide, WLf) - sideIn, WLf];               // [24] 56번
    var fDart = Math.max(0.5, fWaistSide[0] - fWaistReq);
    /* [23] 앞 어깨 — 안내선 51-48 방향 · 길이는 **뒤 어깨에서 다트분(이세분)을 뺀 값**.
           교재가 「잘라 둔 뒤판을 대고 확인하라」고 한 그 제약 그대로다. */
    var shDirF = V.norm(V.sub(p48, SNPf0));
    var shLenFront = shLenBack - shExtra;
    var SPf = V.add(SNPf, V.mul(shDirF, shLenFront));
    var frontArm = armCurve2(SPf, fArmTan, Uf, CAL.frontArm);
    /* [26] BP = 옆목점(51번)에서 유장 · 앞중심에서 유폭/2 */
    var bpX = bpSpan / 2;
    var BP = [bpX, SNPf0[1] + Math.sqrt(Math.max(bpLen * bpLen -
                    (bpX - SNPf0[0]) * (bpX - SNPf0[0]), 1))];
    var fCx = BP[0] + num(opt.bpOutToDart, K.bpOutToDart);                      // [26] 58번
    /* 앞처짐 [38] — 앞중심 밑단을 2.5 내리고 옆선까지 곧게 잇는다 */
    var frontDrop = num(opt.frontDrop, K.frontDrop);
    function fHemAt(x) { return hemYf + frontDrop * (1 - x / (fHemSide[0] || 1)); }
    var fSplit = Math.max(K.hemSplayMin, Math.abs(fHemSide[0] - Uf[0]) / 2);    // [27] 60·61번
    var fCross = [fCx, fHemAt(fCx) - num(opt.hemCrossUp, K.hemCrossUp)];
    var fPwA = [fCx + fDart / 2, WLf], fPwB = [fCx - fDart / 2, WLf];           // [27] 63·64번
    var fPhA = [fCx - fSplit, fHemAt(fCx - fSplit)];
    var fPhB = [fCx + fSplit, fHemAt(fCx + fSplit)];
    /* [28] 앞 절개선 — 암홀에서 58번을 향해. 69번 위로 올라가면 안 된다.
       ★ BP 를 그대로 지나게 하면 두 다리가 58번 기준으로 비대칭이라 **짝 길이가
         0.4 어긋난다.** 교재대로 58번(다트 중심)을 지나게 해야 좌우가 같아진다. */
    var fCutY = Math.max(p69[1], fArmTan[1] + Math.max(0, num(opt.fCutDrop, 0)));
    var fCut = cutSegsAtY(frontArm, fCutY, false);
    var fPrinOut = cutLine(fCut.p, [fCx, BP[1]], fPwA, fCross, fPhA);
    var fPrinIn  = cutLine(fCut.p, [fCx, BP[1]], fPwB, fCross, fPhB);
    /* [27b] 가슴다트 — 앞 옆선이 뒤보다 **유차만큼** 길다. 겨드랑에서 5 내려간
       자리에서 그 길이를 덜어낸다 (꼭짓점 BP). 접으면 앞뒤 옆선이 같아진다. */
    var fSideFull = splineSegs([Uf, fWaistSide, [fHemSide[0], fHemAt(fHemSide[0])]],
                      endTan([0, 1], CAL.side.k0), endTan([0, 1], CAL.side.k1));
    /* ★ 다트 꼭짓점은 BP 가 아니라 **58번(다트 중심)** 이다.
       ① 실무에서도 다트 끝은 BP 에서 1.5~2 물러난 자리에 둔다 (끝이 뾰족해진다).
       ② BP 를 축으로 돌리면 절개선이 지나는 58번이 함께 돌아, 다트 위(안 도는)
          구간과 **0.16 어긋나 폐곡선이 끊긴다.** 58번을 축으로 하면 그 점이 고정된다. */
    var dartTip = [fCx, BP[1]];
    var wedge = wedgeOn(fSideFull, dartTip, num(opt.bustDartAt, K.bustDartAt), dif);
    var dartClose = Math.atan2(wedge.pTop[1] - dartTip[1], wedge.pTop[0] - dartTip[0]) -
                    Math.atan2(wedge.pBot[1] - dartTip[1], wedge.pBot[0] - dartTip[0]);

    /* ───────── Ⅳ. 여밈 · 꺾임선 [38]~[41] ───────── */
    var ov = num(opt.overlap, K.overlap);
    var btnTopY = BL + num(opt.btnTopFromBL, K.btnTopFromBL);
    var breakPt = [-ov, btnTopY];                                    // [40] 75번 (꺾임 시작)
    var rollOn  = V.add(SNPf, V.mul(V.norm(V.sub(SPf, SNPf)),
                    num(opt.rollIn, K.rollIn)));                     // [41] 76번
    var rollDir = V.norm(V.sub(rollOn, breakPt));                    // 꺾임선 방향(위쪽)
    var rollOut = [rollDir[1], -rollDir[0]];                         // 몸 바깥쪽 법선
    if (rollOut[0] > 0) rollOut = [-rollOut[0], -rollOut[1]];
    var gorge0 = [SNPf[0], SNPf[1] + num(opt.gorgeDrop, K.gorgeDrop)];         // [43] 82번
    var lapelPt = V.add(gorge0, V.mul(rollOut, num(opt.gorgeLen, K.gorgeLen))); // [43] 83번
    /* 라펠 폭 = 꺾임선에서 83번까지의 수직거리 — 「접어서 확인」의 수치판 */
    var lapelW = Math.abs((lapelPt[0] - breakPt[0]) * rollDir[1] -
                          (lapelPt[1] - breakPt[1]) * rollDir[0]);

    return {
      m: m, opt: { B: B, W: W, H: H }, B: B, W: W, H: H,
      bustB: bustB, bustDiff: dif, cbIn: cbIn,
      BL: BL, WLb: WLb, WLf: WLf, hipY: hipY, hipYf: hipYf,
      hemY: hemY, hemYf: hemYf, fHemAt: fHemAt,
      bDart: bDart, fDart: fDart, bSplit: bSplit, fSplit: fSplit,
      /* 뒤 */
      BNP: BNP, SNPb0: SNPb0, SNPb: SNPb, SPb: SPb, p22: p22,
      bPitchX: bPitchX, bArmTan: bArmTan, Ub: Ub,
      bWaistSide: bWaistSide, bHemSide: bHemSide, bWaistReq: bWaistReq,
      bCenter: bCenter, backNeck: backNeck, backArm: backArm, backSide: backSide,
      bCx: bCx, bCross: bCross, bPwA: bPwA, bPwB: bPwB, bPhA: bPhA, bPhB: bPhB,
      bPrinOut: bPrinOut, bPrinIn: bPrinIn,
      bArmLow: bCut.head, bArmUp: bCut.tail, bCutP: bCut.p,
      shLenBack: shLenBack, shDart: shDart, shEase: shEase, shExtra: shExtra,
      shLegIn: shLegIn, shLegOut: shLegOut, shApex: shApex,
      /* 앞 */
      SNPf0: SNPf0, SNPf: SNPf, SPf: SPf, fPitchX: fPitchX, fArmTan: fArmTan,
      p48: p48, p69: p69, Uf: Uf, BP: BP, fCx: fCx,
      fWaistSide: fWaistSide, fHemSide: fHemSide, fWaistReq: fWaistReq,
      frontArm: frontArm, fSideFull: fSideFull,
      fCross: fCross, fPwA: fPwA, fPwB: fPwB, fPhA: fPhA, fPhB: fPhB,
      fPrinOut: fPrinOut, fPrinIn: fPrinIn,
      fArmLow: fCut.head, fArmUp: fCut.tail, fCutP: fCut.p, dartTip: dartTip,
      shLenFront: shLenFront,
      fSideTop: wedge.top, fSideBot: wedge.bot,
      wedgeTop: wedge.pTop, wedgeBot: wedge.pBot, wedgeAmt: wedge.amt,
      fHemSideCut: wedge.hem, dartClose: dartClose,
      /* 여밈 · 라펠 */
      overlap: ov, btnTopY: btnTopY, breakPt: breakPt, rollOn: rollOn,
      rollDir: rollDir, rollOut: rollOut, gorge0: gorge0, lapelPt: lapelPt, lapelW: lapelW
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 4. 곡선
   * ════════════════════════════════════════════════════════════════ */
  /** 뒷목선 [18] — 38번(옆목) → 2~23 3등분점 → 37번(뒤중심). 뒤중심에 직각으로 닿는다 */
  function curveBackNeck(BNP, SNP, pass, SP) {
    var C = CAL.backNeck, sd = V.norm(V.sub(SP, SNP));
    return splineSegs([SNP, pass, BNP],
      endTan(rotv([-sd[1], sd[0]], C.a0), C.k0), endTan([-1, 0], C.k1));
  }
  /** 암홀 — 어깨점 → **접점 T**(수직 접선) → 오목점 → 겨드랑(수평 도착).
   *  T 는 뒤 26번 / 앞 49번 높이에서 품선 바깥 armInset 자리다 [13][25].
   *  오목점은 품선×BL 모서리에서 [T → 겨드랑] 현에 내린 **수선의 중점**. */
  function armCurve2(SP, T, U, C) {
    var Cn = [T[0], U[1]];
    var d  = V.norm(V.sub(U, T));
    var F  = V.add(T, V.mul(d, (Cn[0] - T[0]) * d[0] + (Cn[1] - T[1]) * d[1]));
    var Hp = _lerp(Cn, F, 0.5);
    var up = [SP, [T[0] + (SP[0] - T[0]) * C.upFx, SP[1] + (T[1] - SP[1]) * C.upT], T];
    var lo = [T, Hp, U];
    return splineSegs(up, endTan(V.norm(V.sub(up[1], SP)), C.k0), endTan([0, 1], C.kA))
      .concat(splineSegs(lo, endTan([0, 1], C.kB), endTan([1, 0], C.k1)));
  }
  /** 절개선 — 암홀 시작 → 다트 중심(가슴선/BP 높이) → 허리 다리 → 29번 교차 → 밑단.
   *  두 다리가 **다트 중심선 기준 좌우 대칭**이라 짝 길이가 저절로 같아진다. */
  function cutLine(start, mid, waist, cross, hem) {
    /* ★ 위 구간과 아래 구간을 **따로** 풀고 다트 중심(mid)에서 접선을 수직으로 고정한다.
       5점을 한 번에 C2 스플라인으로 풀면 아래 다리가 위 구간 모양까지 바꿔서,
       좌우 대칭으로 놓았는데도 **짝 길이가 0.37 어긋났다.** 접선을 고정하면
       위 구간은 두 다리가 완전히 같고, 아래 두 다리는 중심선 기준 정확한 거울상이 된다. */
    var C = CAL.princess;
    return splineSegs([start, mid], endTan(V.norm(V.sub(mid, start)), C.k0), endTan([0, 1], C.kM))
      .concat(splineSegs([mid, waist, cross, hem],
        endTan([0, 1], C.kM), endTan(V.sub(hem, cross), C.k1)));
  }
  /** c 를 축으로 **c 보다 아래(y 큰) 구간만** a(rad) 돌린다. 가슴다트를 닫는 데 쓴다. */
  function rotSegsBelow(segs, c, a) {
    if (!a) return segs;
    return segs.map(function (g) {
      var below = g.p0[1] >= c[1] - 1e-4 && g.p1[1] >= c[1] - 1e-4;
      if (!below) return g;
      return { p0: rotAbout(g.p0, c, a), c1: rotAbout(g.c1, c, a),
               c2: rotAbout(g.c2, c, a), p1: rotAbout(g.p1, c, a) };
    });
  }
  /** 가슴다트 [27b] — 옆선에서 `at` 내려간 자리부터 `amt` 만큼을 **덜어낸다**.
   *  덜어낸 길이가 곧 유차이므로, 접으면 앞 옆선 = 뒤 옆선이 된다. */
  function wedgeOn(sideSegs, BP, at, amt) {
    var pts = sampleSegs(sideSegs, 0.02), acc = 0, i = 1;
    for (; i < pts.length; i++) { acc += V.dist(pts[i - 1], pts[i]); if (acc >= at) break; }
    if (i >= pts.length) i = pts.length - 1;
    var pTop = pts[i], j = i;
    for (; j < pts.length; j++) { acc += V.dist(pts[j - 1], pts[j]); if (acc >= at + amt) break; }
    if (j >= pts.length) j = pts.length - 1;
    var lower = pts.slice(j);
    return { top: lineSegs.apply(null, pts.slice(0, i + 1)), bot: lineSegs.apply(null, lower),
             pTop: pTop, pBot: lower[0], hem: lower[lower.length - 1],
             amt: V.dist(pTop, lower[0]) };
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
      /* ★ **너무 촘촘한 점은 버린다.** sampleSegs 는 베지어 조각마다 최소 2점을 내므로,
         점열을 이어 붙여 만든 변(poly·lineSegs 연쇄)은 조각 하나가 FLATTEN 보다 짧아도
         2점이 찍혀 간격이 0.005 까지 내려간다 — 뒷판 허리선 9cm 에 1806점이 박혔다
         (2026-08-12 QA). 치수는 안 변하지만 DXF·인쇄 파일이 헛되이 커진다.
         변의 **첫 점과 끝 점은 반드시 남긴다** (모서리·시접 경계라서). */
      var keep = [], MIN = FLATTEN * 0.375;              // 0.015
      for (var si = 0; si < sp.length; si++) {
        if (si === 0 || si === sp.length - 1 ||
            V.dist(sp[si], keep[keep.length - 1]) >= MIN) keep.push(sp[si]);
      }
      if (keep.length > 2 && V.dist(keep[keep.length - 1], keep[keep.length - 2]) < MIN * 0.5)
        keep.splice(keep.length - 2, 1);                 // 끝점 직전이 너무 붙으면 하나 뺀다
      sp = keep;
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
  /* ★ `princess`(프린세스 절개선)를 반드시 넣는다 — 없으면 `normSeam` 이 모르는 role 로
     보고 **시접 0** 을 준다(골선과 같아진다). 절개선 4곳이 전부 시접 없이 나갔다
     (2026-08-12). 옆선과 같은 1.5 를 준다 — 곡선이라 시접이 크면 뒤집을 때 겹친다. */
  /* ★ `center`(뒤중심) 는 **골선이 아니라 봉제선**이다. 뒤중심선이 허리에서 1.24
     들어왔다 다시 나가는 **굽은 선**이라(0 → 0.533@BL → 1.244@허리 → 0.999@밑단)
     접을 수가 없다 — 좌우 두 장을 꿰매는 자리다. role 을 fold 로 두면 시접이 0 으로
     나가 재단해도 못 꿰맨다 (2026-08-12 사용자 지적).
     앞중심은 x=0 수직 직선이라 그대로 fold 다. */
  var SEAM_DEFAULT = { neck: 1.0, shoulder: 1.0, armhole: 1.0, side: 1.5, princess: 1.5,
                       center: 1.5, hem: 3.0, sleeveHem: 2.5, dart: 1.5, fold: 0 };
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

    /* ② 변별 오프셋 (변 내부는 시접이 같으므로 이등분선 마이터)
     *  LIMIT = 마이터 한계(시접의 몇 배까지 뾰족하게 둘 것인가).
     *  ⚠ 3 으로 두었더니 **절개 시작점처럼 진짜 뾰족한 모서리(내각 34.7°, 이론 마이터 3.36)가
     *    잘려 나갔다.** 패턴에서 저런 꼭짓점은 접어서 맞추는 자리라 온전해야 한다.
     *  8 이면 내각 14° 까지 온전히 살고, 그보다 더 붙은 각(사실상 첨점)만 bevel 로 잘린다. */
    var LIMIT = 8;
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

      if (Math.abs(sA - sB) < 1e-12) {                    // ── 등폭 → 이등분선 마이터
        if (sA === 0) { corners.push({ pts: [cp(P)], own: [cornOwner] }); continue; }
        var mm = V.add(nPrev, nNext), ml = Math.hypot(mm[0], mm[1]);
        if (ml < 1e-9) { corners.push({ pts: [[P[0] + nNext[0] * sA, P[1] + nNext[1] * sA]], own: [cornOwner] }); continue; }
        var mu = [mm[0] / ml, mm[1] / ml];
        var kk = sA / Math.max(mu[0] * nNext[0] + mu[1] * nNext[1], 1 / LIMIT);
        corners.push({ pts: [[P[0] + mu[0] * kk, P[1] + mu[1] * kk]], own: [cornOwner] });
        continue;
      }
      // ── 이폭 → 두 오프셋선의 교점
      var A = [P[0] + nPrev[0] * sA, P[1] + nPrev[1] * sA];
      var Bp = [P[0] + nNext[0] * sB, P[1] + nNext[1] * sB];
      var X = lineX(A, segDir[(cornerIdx - 1 + n) % n], Bp, segDir[cornerIdx]);
      /* 이폭 모서리는 한계를 3배로 죈다 — 소매산처럼 끝 접선이 밑선과 거의 나란한
       *  이폭 모서리(1.0↔1.5)는 교점이 시접의 8배 아래까지 내려가 얇은 가시가 된다
       *  (숙녀복기본원형2 소매 실측 2.6cm). 등폭 모서리의 첨점 보존(LIMIT 8)은 그대로 둔다. */
      var lim = Math.max(sA, sB) * 3;
      if (X && V.dist(X, P) <= lim) corners.push({ pts: [X], own: [cornOwner] });
      else corners.push({ pts: [A, Bp], own: [k, cornOwner] });     // bevel
    }
    // 조립: outline 인덱스 0 이 변0 의 첫 모서리(= 마지막 변과의 접점)가 되도록
    var seamPts = [], owner = [];
    for (k = 0; k < E_; k++) {
      var cprev = corners[(k - 1 + E_) % E_];
      for (var c = 0; c < cprev.pts.length; c++) { seamPts.push(cprev.pts[c]); owner.push(cprev.own[c]); }
      var offK = offEdge[k];
      for (var q = 1; q < offK.length - 1; q++) { seamPts.push(offK[q]); owner.push(k); }
    }

    /* ④-0 골선 클램프 — SPEC §11-2: 시접 0 인 골선은 **좌표를 유지한 채** 시접 폭만큼
       연장돼야 한다. V 네크라인처럼 목선이 골선과 예각으로 만나면 목선 오프셋이
       골선을 최대 시접 폭만큼 넘어간다 — 넘은 점을 골선 위로 되투영한다.
       골선이 없거나 넘은 점이 없으면 완전한 no-op (기존 조각 결과 불변). */
    var foldR = loop.ranges.filter(function (r) { return r.role === 'fold'; });
    if (foldR.length) {
      var cx = 0, cy = 0;
      for (i = 0; i < pts.length; i++) { cx += pts[i][0]; cy += pts[i][1]; }
      cx /= pts.length; cy /= pts.length;
      foldR.forEach(function (r) {
        var a2 = pts[r.start], b2 = pts[r.end];
        if (V.dist(a2, b2) < 1e-6) return;
        var t2 = V.norm(V.sub(b2, a2)), nf = [t2[1], -t2[0]];
        if (nf[0] * (cx - a2[0]) + nf[1] * (cy - a2[1]) > 0) nf = [-nf[0], -nf[1]];
        for (var z = 0; z < seamPts.length; z++) {
          var dv = (seamPts[z][0] - a2[0]) * nf[0] + (seamPts[z][1] - a2[1]) * nf[1];
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
  /** 3차 베지어를 t 에서 둘로 나눈다 (de Casteljau) */
  function bezSplit(g, t) {
    var a = _lerp(g.p0, g.c1, t), b = _lerp(g.c1, g.c2, t), c = _lerp(g.c2, g.p1, t);
    var d = _lerp(a, b, t), e = _lerp(b, c, t), m = _lerp(d, e, t);
    return [{ p0: g.p0, c1: a, c2: d, p1: m }, { p0: m, c1: e, c2: c, p1: g.p1 }];
  }
  /** ★ 곡선을 **겨드랑 끝에서 잰 호 비율** 자리에서 둘로 자른다.
   *  암홀라인은 절개선이 암홀 위에서 갈라지므로 암홀을 두 조각으로 나눠야 한다.
   *  절대 좌표로 자르면 66호만 맞는다 — 비율이라야 전 호수가 따라온다.
   *  @returns {head, tail, p} head = 겨드랑 쪽, tail = 어깨 쪽, p = 자른 점 */
  function cutSegsAtT(segs, frac, fromUnderarm) {
    var work = fromUnderarm ? segs : revSegs(segs);        // 항상 겨드랑이 앞
    var lens = work.map(function (g) { return bezLen(g.p0, g.c1, g.c2, g.p1); });
    var tot = lens.reduce(function (a, b) { return a + b; }, 0), want = tot * frac;
    var acc = 0, i = 0;
    for (; i < work.length - 1; i++) {
      if (acc + lens[i] >= want) break;
      acc += lens[i];
    }
    var t = lens[i] > 1e-9 ? (want - acc) / lens[i] : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var pair = bezSplit(work[i], t);
    var head = work.slice(0, i).concat([pair[0]]);
    var tail = [pair[1]].concat(work.slice(i + 1));
    return fromUnderarm ? { head: head, tail: tail, p: pair[0].p1 }
                        : { head: head, tail: tail, p: pair[0].p1 };
  }
  /** ★ 뒤 조각을 **옆선에서 앞 조각에 붙이는** 강체 변환.
   *  재킷의 옆판은 옆선을 가로질러 한 장이라, 앞·뒤가 각자 원점을 쓰는 이 엔진에서는
   *  그대로 만들 수 없다. 종이로 하는 응용 제도와 같이 **뒷옆면을 옆선에서 앞옆면에
   *  붙인 뒤** 새 절개선을 긋는다. 옆선 짝이 0.02 밖에 차이가 안 나 이음매가 정확하다.
   *  앞뒤는 몸의 반대편이므로 **x 를 뒤집고** 겨드랑·밑단 두 점으로 회전·평행이동을 정한다. */
  function backToFrontTf(Ub, bHemSide, Uf, fHemSide) {
    /* ★ 회전을 넣지 마라. 앞·뒤는 **같은 상단 기준선**에서 제도하므로 y 는 그대로 두고
       x 만 옆선(겨드랑)에서 접어 붙이면 된다.
       처음엔 겨드랑·밑단 두 점으로 회전각까지 맞췄는데, 앞뒤 밑단 높이가 1.46 다르고
       폭도 달라 **각도가 생겨 뒤판이 통째로 기울었다** — 옆판이 도면 12.5×47.1 인데
       20.1×56.4 로 부풀고 뒤판에 없는 V 가 생겼다 (2026-08-12 사용자 지적).
         x' = 겨드랑(앞) + (겨드랑(뒤) − x)   ← 옆선에서 반전, 뒤로 갈수록 바깥
         y' = y                                ← 높이는 그대로 */
    return function (p) { return [Uf[0] + (Ub[0] - p[0]), p[1]]; };
  }
  /** 세그먼트 전체에 점 변환 적용 (제어점까지) */
  function mapSegs(segs, f) {
    return segs.map(function (g) {
      return { p0: f(g.p0), c1: f(g.c1), c2: f(g.c2), p1: f(g.p1) };
    });
  }
  /** 두 점을 잇는 **현에서 t 자리에 off 만큼 수직으로 띄운 통과점**.
   *  절개선 곡률을 도면에 맞추는 데 쓴다 — 곡률을 「현에서 벗어난 양」으로 재고
   *  같은 방식으로 앵커를 놓으면 재적합이 한 번에 끝난다.
   *  off > 0 은 위→아래 진행 방향의 **오른쪽**. */
  function chordBulge(a, b, t, off) {
    var ux = b[0] - a[0], uy = b[1] - a[1], L = Math.hypot(ux, uy) || 1;
    ux /= L; uy /= L;
    return [a[0] + ux * L * t - uy * off, a[1] + uy * L * t + ux * off];
  }
  /** 곡선 위에서 y 가 주어진 자리 (해부학적 높이로 너치를 찍는 데 쓴다) */
  function ptOnSegsAtY(segs, targetY) {
    var p = sampleSegs(segs, 0.02), best = null, bd = Infinity;
    for (var i = 0; i < p.length; i++) {
      var d = Math.abs(p[i][1] - targetY);
      if (d < bd) { bd = d; best = p[i]; }
    }
    return bd <= 0.25 ? [best[0], best[1]] : null;
  }
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
  /** 너치 표시선 길이 (SPEC §8.1 — 안쪽 0.5cm). 방향 판정도 이 길이로 한다. */
  var NOTCH_TICK = 0.5;
  /** 점이 폐다각형 안에 있는가 — ray casting. 오목한 조각(암홀)에서도 정확하다. */
  function ptInPoly(pt, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
          pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
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
  /** 맞물리는 두 변에 **해부학적 높이**(가슴선·BP·허리·엉덩이선)로 짝 너치를 찍는다.
   *  ★ 왜 비율(호길이)이 아니라 높이인가 — 비율 너치와 실제 기준점(허리·BP) 너치를
   *  섞으면 **한 구간에 이세가 몰렸다 다음 구간에서 되돌아온다.** 88호 뒤 절개선에서
   *  허리 앞 1.6cm 구간에 0.32 를 밀어넣고 바로 다음 구간에서 0.32 를 빼야 했다
   *  (2026-08-12). 높이로 맞추면 이세가 **어깨~가슴선 한 구간에만** 모이고
   *  (뒤 88호 0.339 / 21cm = 1.6%) 나머지 구간은 0.12 이하로 떨어진다.
   *  @param levels [[라벨, y], …] 위에서 아래 순
   *  @param post   점을 찍은 뒤 옮길 일이 있으면(앞옆면 다트 회전) 주는 변환
   *  @returns {a:[], b:[]} */
  function levelNotches(segsA, insideA, segsB, insideB, levels, postA, postB) {
    var pa = sampleSegs(segsA, 0.02), pb = sampleSegs(segsB, 0.02), a = [], b = [];
    function at(p, y) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < p.length; i++) { var e = Math.abs(p[i][1] - y); if (e < bd) { bd = e; bi = i; } }
      var j = Math.max(1, Math.min(p.length - 1, bi));
      return { p: cp(p[bi]), tan: V.norm(V.sub(p[j], p[j - 1])) };
    }
    levels.forEach(function (lv) {
      var ha = at(pa, lv[1]), hb = at(pb, lv[1]);
      var qa = postA ? postA(ha.p) : ha.p, qb = postB ? postB(hb.p) : hb.p;
      a.push({ p: cp(qa), angle: _inward(ha.tan, qa, insideA), label: lv[0] });
      b.push({ p: cp(qb), angle: _inward(hb.tan, qb, insideB), label: lv[0] });
    });
    return { a: a, b: b };
  }
  /** 맞물리는 두 변에 **같은 자리** 너치를 찍는다 — 프린세스 4조각의 핵심이다.
   *  변마다 길이가 조금 다르므로(이세) **짧은 쪽 길이**를 기준으로 비율을 잡아
   *  양쪽 같은 비율 자리에 찍는다. 그래야 봉제할 때 어긋나지 않는다.
   *  @param fracs 시작(=어깨/겨드랑)에서 잰 비율들
   *  @returns {a:[], b:[]} 각 변의 너치 목록 */
  function pairNotches(segsA, segsB, fracs, insideA, insideB, tag, refPt) {
    var LA = polyLen(sampleSegs(segsA, 0.02)), LB = polyLen(sampleSegs(segsB, 0.02));
    var Lmin = Math.min(LA, LB), a = [], b = [];
    /* ★ 두 변의 **진행 방향이 반대일 수 있다** — 조각마다 고리를 도는 방향이 달라
       한쪽이 revSegs 로 들어온다. 그대로 같은 비율을 재면 한쪽은 어깨에서, 다른 쪽은
       밑단에서 재게 되어 **최대 38cm 어긋난다** (2026-08-11 실제로 그랬다).
       `refPt`(짝의 공통 기준점, 보통 어깨 절개점)에 가까운 끝에서부터 재도록 맞춘다. */
    function fromRef(segs) {
      if (!refPt) return false;
      var p = sampleSegs(segs, 0.05);
      return V.dist(p[0], refPt) > V.dist(p[p.length - 1], refPt);   // true = 끝에서부터
    }
    var revA = fromRef(segsA), revB = fromRef(segsB);
    fracs.forEach(function (f, i) {
      var nm = tag + ' ' + (i + 1);
      var ha = _ptAtLen(segsA, Lmin * f, revA), hb = _ptAtLen(segsB, Lmin * f, revB);
      a.push({ p: cp(ha.p), angle: _inward(ha.tan, ha.p, insideA), label: nm });
      b.push({ p: cp(hb.p), angle: _inward(hb.tan, hb.p, insideB), label: nm });
    });
    return { a: a, b: b, ease: r4(LB - LA) };
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

  /* ══════════════════════════════════════════════════════════════════
   * 6. 조각 — **앞뒤 각 2장 = 4패널** + 카라 + 주머니
   *
   *      앞패널1(앞중심·라펠) | 앞패널2(암홀·BP)  ‖  뒤패널2(암홀) | 뒤패널1(뒤중심)
   *                                        ↑ 옆선
   *
   *   ★ 이 제도법은 **옆선이 그대로 있다.** 예전 Barjacke 판처럼 옆판이 겨드랑을
   *     품고 옆선을 흡수하는 구성이 아니다 — 옆선을 가로질러 조각을 붙이는
   *     `backToFrontTf` 가 필요 없어졌다 (그게 제일 애먹던 부분이었다).
   *   ★ 절개선은 앞뒤 **모두 암홀에서** 출발한다 [16][28] — 어깨 프린세스가 아니다.
   * ════════════════════════════════════════════════════════════════ */
  function draftJacket(m, opt) {
    opt = opt || {};
    var seam = normSeam(opt.seam);
    var g = geom(m, opt);
    var pieces = [], warnings = [];

    function mk(id, name, edges, grain, notches, internal, cutCount) {
      var loop = edgesToLoop(edges), sm = buildSeamline(loop, seam);
      /* 너치 보정 — ① 재단선 위로 스냅 ② 틱이 조각 **안쪽**을 향하게.
         판정은 그리는 것과 같은 방식(point-in-polygon)이라야 한다. 무게중심으로
         재면 암홀처럼 오목한 변에서 통과하는데 실제 틱은 밖으로 나간다. */
      (notches || []).forEach(function (n) {
        var o = loop.pts, best = null, bd = Infinity;
        for (var i = 1; i < o.length; i++) {
          var a2 = o[i - 1], b2 = o[i], dx = b2[0] - a2[0], dy = b2[1] - a2[1], L2 = dx * dx + dy * dy;
          var t = L2 ? ((n.p[0] - a2[0]) * dx + (n.p[1] - a2[1]) * dy) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var q2 = [a2[0] + t * dx, a2[1] + t * dy], e2 = V.dist(n.p, q2);
          if (e2 < bd) { bd = e2; best = q2; }
        }
        if (bd <= 3.0) n.p = best;
        function ok(deg) {
          var r = deg * Math.PI / 180;
          return ptInPoly([n.p[0] + Math.cos(r) * NOTCH_TICK, n.p[1] + Math.sin(r) * NOTCH_TICK], o);
        }
        if (ok(n.angle)) return;
        for (var sd = 5; sd <= 180; sd += 5) {
          if (ok(n.angle + sd)) { n.angle = ((n.angle + sd) % 360 + 360) % 360; return; }
          if (ok(n.angle - sd)) { n.angle = ((n.angle - sd) % 360 + 360) % 360; return; }
        }
      });
      return { id: id, name: name, cutCount: cutCount || 2, kind: 'bodice', grainline: grain,
        outline: loop.pts, seamline: sm.seamline, foldEdges: sm.foldEdges,
        seamEdges: sm.seamEdges, seamFoldEdges: sm.seamFoldEdges, seamByRole: sm.seamByRole,
        edges: withSeam(loop.ranges, sm.edgeSeam), internal: internal || [],
        notches: notches || [], bbox: bboxOf(loop.pts) };
    }

    var dc = g.dartClose;
    var TIP = g.dartTip;                                        // 가슴다트 꼭짓점 = 58번
    var fPrinOutC = rotSegsBelow(g.fPrinOut, TIP, dc);          // 앞패널2 절개선 (다트 닫은 뒤)
    var wedgeBotC = rotAbout(g.wedgeBot, TIP, dc);
    var fSideBotC = rotSegsBelow(g.fSideBot, TIP, dc);
    var fHemSideC = rotAbout(g.fHemSideCut, TIP, dc);
    var fPhAC     = rotAbout(g.fPhA, TIP, dc);

    /* ── 맞춤 너치 ────────────────────────────────────────────────────
     *  절개선 두 짝과 옆선이 맞물려야 옷이 된다. 절개선 짝은 **해부학적 높이**로
     *  찍는다 — 비율 너치와 기준점 너치를 섞으면 한 구간에 이세가 몰린다. */
    function rotIfBelow(p) { return p[1] >= TIP[1] - 1e-4 ? rotAbout(p, TIP, dc) : cp(p); }
    var nBack  = levelNotches(g.bPrinIn, [0, g.WLb], g.bPrinOut, [g.Ub[0], g.WLb],
                   [['가슴선', g.BL], ['허리', g.WLb], ['엉덩이', g.hipY]]);
    var nFront = levelNotches(g.fPrinIn, [0, g.WLf], g.fPrinOut, [g.Uf[0], g.WLf],
                   [['가슴선', g.BL], ['BP', g.BP[1]], ['허리', g.WLf], ['엉덩이', g.hipYf]],
                   null, rotIfBelow);
    var nSide  = pairNotches(g.backSide, g.fSideTop.concat(fSideBotC), [0.45, 0.78],
                   [0, g.WLb], [0, g.WLf], '옆선', g.Ub);
    /* 암홀 3등분 너치를 자기 도막(=자기 조각)으로 보낸다 */
    function armSplitNotches(armFull, low, up, U, inside, tag) {
      var all = armNotches(armFull, U, inside, tag);
      function near(q, segs) {
        var pts = sampleSegs(segs, 0.05), b = Infinity;
        for (var i = 0; i < pts.length; i++) { var e = V.dist(q, pts[i]); if (e < b) b = e; }
        return b;
      }
      var lo = [], hi = [];
      all.forEach(function (n) { (near(n.p, low) <= near(n.p, up) ? lo : hi).push(n); });
      return { low: lo, up: hi };
    }
    var nArmB = armSplitNotches(g.backArm,  g.bArmLow, g.bArmUp, g.Ub, [g.bCx, g.BL + 6], '뒤 암홀');
    var nArmF = armSplitNotches(g.frontArm, g.fArmLow, g.fArmUp, g.Uf, [g.fCx, g.BL + 6], '앞 암홀');

    /* ══ ① 앞패널1 — 앞중심 여밈 · 라펠 · 어깨 · 앞 암홀 위쪽 ═══════════
       ★ 테일러드 앞판에는 **앞목둘레 곡선이 없다** — 고지선이 그 자리다 [43].
         앞중심도 골선이 아니다. 여밈이 앞중심을 overlap 만큼 넘어간다(더블).   */
    var edgeX = -g.overlap;
    var hemEdgeF = [edgeX, g.fHemAt(edgeX)];
    pieces.push(mk('front', '앞판', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPf, g.SPf) },
      { name: '앞 암홀',  role: 'armhole',  segs: revSegs(g.fArmUp) },
      { name: '절개선',   role: 'princess', segs: g.fPrinIn },
      { name: '밑단',     role: 'hem',      segs: lineSegs(g.fPhB, hemEdgeF) },
      { name: '여밈선',   role: 'center',   segs: lineSegs(hemEdgeF, g.breakPt) },
      { name: '라펠선',   role: 'center',   segs: lineSegs(g.breakPt, g.lapelPt) },
      { name: '고지선',   role: 'neck',     segs: lineSegs(g.lapelPt, g.gorge0) },
      { name: '목선',     role: 'neck',     segs: lineSegs(g.gorge0, g.SNPf) }
    ], [[edgeX * 0.4, g.BL + 2.0], [edgeX * 0.4, g.hemYf - 4.0]],
      [{ p: cp(g.SNPf), angle: 0,   label: '목옆점' },
       { p: cp(g.gorge0), angle: 0, label: '고지 시작' },
       { p: cp(g.breakPt), angle: 0, label: '꺾임점' },
       { p: cp(g.fCutP), angle: 180, label: '절개 시작' }].concat(nFront.a),
      [L('cf',   'dashed', [[0, g.SNPf[1]], [0, g.fHemAt(0)]], '앞중심'),
       L('roll', 'dashed', [cp(g.breakPt), cp(g.rollOn)], '꺾임선'),
       L('blF',  'dashed', [[edgeX + 1, g.BL], [g.fCx, g.BL]], '가슴선'),
       L('wlF',  'dashed', [[edgeX + 1, g.WLf], [g.fCx, g.WLf]], '허리선')]
        .concat((function () {
          var o2 = [], bo = num(opt.btnOut, K.btnOut), gap = num(opt.btnGapY, K.btnGapY),
              bl = num(opt.bhLen, K.bhLen), rows = Math.max(1, Math.round(num(opt.btnRows, K.btnRows)));
          for (var i = 0; i < rows; i++) {
            var y = g.btnTopY + gap * i;
            o2.push(L('btn' + i, 'point', [[bo, y]], '단추'));       // 반대쪽 단추열
            o2.push(L('bh' + i, 'line', [[-bo, y], [-bo - bl, y]], '단춧구멍'));
          }
          return o2;
        })()), 1));

    /* ══ ② 앞패널2 — 앞 암홀 아래쪽 · 옆선 · 가슴다트 ══════════════════ */
    pieces.push(mk('frontSide', '앞옆판', [
      { name: '앞 암홀',    role: 'armhole',  segs: revSegs(g.fArmLow) },
      { name: '옆선 (위)',  role: 'side',     segs: g.fSideTop },
      /* 다트를 접으면 두 다리가 포개진다. 다리 길이가 꼭짓점에서 조금 달라
         남는 만큼을 짧게 이어 준다 — 접었을 때 맞는 연장이다.
         ★ 이 도막은 옆선이 **아니므로** 이름을 따로 준다. 옆선에 넣으면 앞뒤
           옆선 짝을 잴 때 다트 입 길이까지 같이 재어 1.4 어긋난 것처럼 보인다. */
      { name: '가슴다트',   role: 'side',     segs: lineSegs(g.wedgeTop, wedgeBotC) },
      { name: '옆선 (아래)', role: 'side',    segs: fSideBotC },
      { name: '밑단',       role: 'hem',      segs: lineSegs(fHemSideC, fPhAC) },
      { name: '절개선',     role: 'princess', segs: revSegs(fPrinOutC) }
    ], [[g.fCx + 3.0, g.BL + 2.0], [g.fCx + 3.0, g.hemYf - 4.0]],
      [{ p: cp(g.Uf), angle: 180, label: '겨드랑' },
       { p: cp(g.wedgeTop), angle: 180, label: '가슴다트' },
       { p: cp(wedgeBotC), angle: 180, label: '가슴다트' }]
        .concat(nArmF.low).concat(nFront.b).concat(nSide.b),
      [L('bustDart', 'dashed', [cp(g.wedgeTop), cp(TIP)], '가슴다트 접음선'),
       L('bustTip',  'point',  [cp(g.BP)], 'BP')]
        .concat((function () {
          var pw = num(opt.pocketW, K.pocketW), py = g.WLf + num(opt.pocketFromWL, K.pocketFromWL);
          var cx = (g.fPwA[0] + g.fWaistSide[0]) / 2;
          var tl = num(opt.pocketTilt, K.pocketTilt) * Math.PI / 180;
          return [L('pocket', 'line', [[cx - pw / 2, py + Math.sin(tl) * pw / 2],
                                       [cx + pw / 2, py - Math.sin(tl) * pw / 2]], '주머니 입구')];
        })())));

    /* ══ ③ 뒤패널2 — 뒤 암홀 아래쪽 · 옆선 ══════════════════════════ */
    pieces.push(mk('backSide', '뒤옆판', [
      { name: '뒤 암홀',  role: 'armhole',  segs: revSegs(g.bArmLow) },
      { name: '옆선',     role: 'side',     segs: g.backSide },
      { name: '밑단',     role: 'hem',      segs: lineSegs(g.bHemSide, g.bPhA) },
      { name: '절개선',   role: 'princess', segs: revSegs(g.bPrinOut) }
    ], [[g.bCx + 3.0, g.BL + 2.0], [g.bCx + 3.0, g.hemY - 4.0]],
      [{ p: cp(g.Ub), angle: 180, label: '겨드랑' }]
        .concat(nArmB.low).concat(nBack.b).concat(nSide.a),
      [L('blBS', 'dashed', [[g.bCx + 0.5, g.BL], [g.Ub[0], g.BL]], '가슴선'),
       L('wlBS', 'dashed', [[g.bCx + 0.5, g.WLb], [g.bWaistSide[0], g.WLb]], '허리선'),
       L('hipBS', 'dashed', [[g.bCx + 0.5, g.hipY], [g.bHemSide[0] - 0.5, g.hipY]], '엉덩이선')]));

    /* ══ ④ 뒤패널1 — 뒤중심 · 어깨(다트) · 뒤 암홀 위쪽 ═══════════════ */
    var shoulderEdges = (g.shDart > 0.01)
      ? [{ name: '어깨선 (밖)', role: 'shoulder', segs: lineSegs(g.SPb, g.shLegOut) },
         { name: '어깨 다트',   role: 'dart',     segs: lineSegs(g.shLegOut, g.shApex, g.shLegIn) },
         { name: '어깨선 (안)', role: 'shoulder', segs: lineSegs(g.shLegIn, g.SNPb) }]
      : [{ name: '어깨선',      role: 'shoulder', segs: lineSegs(g.SPb, g.SNPb) }];
    pieces.push(mk('back', '뒤판', [
      { name: '뒷목둘레', role: 'neck',     segs: g.backNeck },
      { name: '뒤중심',   role: 'center',   segs: g.bCenter },
      { name: '밑단',     role: 'hem',      segs: lineSegs([g.cbIn, g.hemY], g.bPhB) },
      { name: '절개선',   role: 'princess', segs: revSegs(g.bPrinIn) },
      { name: '뒤 암홀',  role: 'armhole',  segs: g.bArmUp }
    ].concat(shoulderEdges),
      [[1.6, 4.0], [1.6, g.hemY - 4.0]],
      [{ p: cp(g.SNPb), angle: 0, label: '목옆점' },
       { p: cp(g.bCutP), angle: 180, label: '절개 시작' }]
        .concat(nArmB.up).concat(nBack.a),
      [L('blB',  'dashed', [[0.5, g.BL], [g.bCx - 0.5, g.BL]], '가슴선'),
       L('wlB',  'dashed', [[g.cbIn + 0.3, g.WLb], [g.bCx - 0.5, g.WLb]], '허리선'),
       L('hipB', 'dashed', [[g.cbIn + 0.3, g.hipY], [g.bCx - 0.5, g.hipY]], '엉덩이선')]
        .concat(g.shDart > 0.01
          ? [L('shDart', 'dashed', [cp(g.shLegOut), cp(g.shApex), cp(g.shLegIn)], '어깨 다트')]
          : [])));

    /* ══ ⑤ 카라 [42]~[46] ═══════════════════════════════════════════
       ★ 테일러 카라는 **옆목점에서 0.5 나가서** 뒷목선을 그린다 [42] 78번.
         78~79 = 뒷목치수 · 79~80 = 카라넓이. 위카라(80번)가 꺾임선(77번) 안으로
         들어가면 안 된다 — 들어가면 카라가 목에서 뜬다.
       조각으로 뽑을 때는 목붙임선(= 뒷목 + 옆목~고지 + 고지선)을 그대로 두고
       바깥선만 slash & spread 로 벌린다. 「접어서 확인」은 검산기가 대신한다. */
    var collarNeckLen = sLen(g.backNeck) + V.dist(g.SNPf, g.gorge0) + V.dist(g.gorge0, g.lapelPt);
    (function () {
      var Hc = num(opt.collarW, K.collarW);
      var st = Math.min(Hc - 1.0, num(opt.collarStand, K.collarStand));
      var Lc = collarNeckLen;
      var curl = (Hc - st) * num(opt.collarCurl, K.collarCurl);
      /* 목붙임선 — 뒤중심에서 수평으로 나가 앞으로 갈수록 curl 만큼 올라간다.
         x 를 반복 보정해 **실제 호길이가 목둘레(Lc)** 가 되게 한다. */
      function neckAt(sx) {
        return splineSegs([[0, Hc], [sx * 0.55, Hc - curl * 0.30], [sx, Hc - curl]],
          endTan([1, 0], 1.0), endTan([1, -curl * 2.2 / Math.max(sx, 1)], 1.0));
      }
      var sx = Lc;
      for (var it = 0; it < 14; it++) { var ln = sLen(neckAt(sx)); if (ln > 1e-6) sx *= Lc / ln; }
      var np = sampleSegs(neckAt(sx), 0.05);
      /** 목붙임선을 **바깥(위) 법선**으로 dd 만큼 민다. 굽은 선을 밀면 길어진다. */
      function push(pts, dd) {
        return pts.map(function (q, i) {
          var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          var t = V.norm(V.sub(b, a));
          return [q[0] + t[1] * dd, q[1] - t[0] * dd];
        });
      }
      var outer = push(np, Hc), stand = push(np, st);
      /* 뒷목 끝 — 어깨선에 맞추는 자리. 목붙임선을 뒷목치수만큼 잰 곳 */
      var bnLen = sLen(g.backNeck), acc = 0, shPt = np[np.length - 1];
      for (var i = 1; i < np.length; i++) {
        acc += V.dist(np[i - 1], np[i]);
        if (acc >= bnLen) { shPt = np[i]; break; }
      }
      pieces.push(mk('collar', '카라', [
        { name: '뒤중심',    role: 'fold', segs: lineSegs(np[0], outer[0]) },
        { name: '카라 윗선', role: 'neck', segs: lineSegs.apply(null, outer) },
        { name: '카라 끝',   role: 'neck', segs: lineSegs(outer[outer.length - 1], np[np.length - 1]) },
        { name: '목붙임선',  role: 'neck', segs: lineSegs.apply(null, np.slice().reverse()) }
      ], [[Lc * 0.10, Hc * 0.15], [Lc * 0.10, Hc * 0.9]],
        [{ p: cp(np[0]), angle: 270, label: '뒤중심' },
         { p: cp(shPt), angle: 270, label: '뒷목 끝(어깨)' }],
        [L('stand', 'dashed', stand.filter(function (q, i) { return i % 8 === 0 || i === stand.length - 1; }),
           '스탠드 꺾임선')], 1));
    })();

    /* ══ ⑥ 주머니 플랩 · 주머니감 ═════════════════════════════════════ */
    (function () {
      var w = num(opt.pocketW, K.pocketW), h = num(opt.flapH, K.flapH);
      pieces.push(mk('flap', '주머니 플랩', [
        { name: '윗선',      role: 'princess', segs: lineSegs([0, 0], [w, 0]) },
        { name: '옆선',      role: 'side',     segs: lineSegs([w, 0], [w, h]) },
        { name: '아랫선',    role: 'hem',      segs: lineSegs([w, h], [0, h]) },
        { name: '옆선 (앞)', role: 'side',     segs: lineSegs([0, h], [0, 0]) }
      ], [[w * 0.5, h * 0.2], [w * 0.5, h * 0.8]],
        [{ p: [w / 2, 0], angle: 90, label: '중심' }],
        [L('fold', 'dashed', [[0, h * 0.5], [w, h * 0.5]], '접음선')]));
      var pw = w + 1.4, ph = 15.8;
      pieces.push(mk('pocketBag', '주머니감', [
        { name: '입구',      role: 'princess', segs: lineSegs([0, 0], [pw, 0]) },
        { name: '옆선',      role: 'side',     segs: lineSegs([pw, 0], [pw, ph]) },
        { name: '아랫선',    role: 'hem',      segs: lineSegs([pw, ph], [0, ph]) },
        { name: '옆선 (앞)', role: 'side',     segs: lineSegs([0, ph], [0, 0]) }
      ], [[pw * 0.5, ph * 0.2], [pw * 0.5, ph * 0.8]],
        [{ p: [pw / 2, 0], angle: 90, label: '중심' }],
        [L('mid', 'dashed', [[0, ph * 0.5], [pw, ph * 0.5]], '접음선')]));
    })();

    /* ───────── 계측 · **교재가 시키는 확인 절차** ─────────
       원문의 「확인하라」는 곧 검사다 — [12] 어깨 · [23] 앞뒤 어깨 짝 ·
       [24] 앞뒤 옆라인 · [40] 라펠 높이 · [42] 위카라. 전부 여기서 잰다. */
    function SL(s) { return sLen(s); }
    var sideBack = SL(g.backSide), sideFront = SL(g.fSideTop) + SL(g.fSideBot);
    var chest = 2 * (g.Uf[0] + g.Ub[0]);
    var waistFin = 2 * ((g.bWaistSide[0] - g.cbIn - g.bDart) + (g.fWaistSide[0] - g.fDart));
    var hipFin = 2 * ((g.bHemSide[0] - g.cbIn) + g.fHemSide[0]);
    [['뒤 절개선', SL(g.bPrinIn), SL(g.bPrinOut), 0.3],
     ['앞 절개선', SL(g.fPrinIn), SL(g.fPrinOut), 0.3],
     ['옆선 [24]', sideBack, sideFront, 0.4],
     ['어깨 [23]', g.shLenBack - g.shExtra, g.shLenFront, 0.15]
    ].forEach(function (w) {
      if (Math.abs(w[1] - w[2]) > w[3])
        warnings.push(w[0] + ' 짝 ' + r4(w[1]) + ' ↔ ' + r4(w[2]) + ' (차 ' + r4(w[1] - w[2]) + ')');
    });
    /* [23] 52번 확인 — 앞 어깨점이 어깨너비/2 자리에 오는가 */
    if (Math.abs(g.SPf[0] - num(opt.shoulderW, m.shoulderW) / 2) > 1.5)
      warnings.push('앞 어깨점 x ' + r4(g.SPf[0]) + ' — 어깨너비/2 ' +
                    r4(num(opt.shoulderW, m.shoulderW) / 2) + ' 와 어긋난다 [23] 52번');
    /* [16] 뒤 절개는 26번 위로 · [28] 앞 절개는 69번 위로 올라가면 안 된다 */
    if (g.bCutP[1] < g.bArmTan[1] - 0.05)
      warnings.push('뒤 절개 시작이 26번보다 위다 [16]');
    if (g.fCutP[1] < g.p69[1] - 0.05)
      warnings.push('앞 절개 시작이 69번보다 위다 [28]');
    /* [40] 75번은 W 선 위로 2.5 이상 — 그보다 낮으면 배꼽이 보인다 */
    if (g.WLf - g.btnTopY < 2.5)
      warnings.push('꺾임 시작(75번)이 허리에서 ' + r4(g.WLf - g.btnTopY) + ' 위 — 2.5 이상이라야 한다 [40]');
    /* [42] 위카라가 꺾임선 안으로 들어가면 안 된다 = 카라넓이 > 스탠드 */
    if (num(opt.collarW, K.collarW) - num(opt.collarStand, K.collarStand) < 1.0)
      warnings.push('카라넓이 − 스탠드 가 1.0 미만 — 위카라가 꺾임선 안으로 들어간다 [42]');

    return {
      pieces: pieces, warnings: warnings, notes: [],
      measures: {
        bust: r4(g.B), hip: r4(g.H), BL: r4(g.BL),
        backLen: r4(g.WLb), coatLen: r4(g.hemY), hipLine: r4(g.hipY),
        bustDiff: r4(g.bustDiff),
        chestFinish: r4(chest), chestEase: r4(chest - g.B),
        waistFinish: r4(waistFin), waistEase: r4(waistFin - g.W),
        hipFinish: r4(hipFin), hipEase: r4(hipFin - g.H),
        shoulderBack: r4(g.shLenBack), shoulderFront: r4(g.shLenFront),
        shoulderBackSewn: r4(g.shLenBack - g.shDart),
        shoulderFrontSewn: r4(g.shLenFront),
        /* 어깨 이세분 — 다트로 처리하면 0, 이세로 처리하면 0.7~0.8 [12] */
        shoulderEase: r4(g.shEase),
        backShDart: r4(g.shDart),
        neckBack: r4(sLen(g.backNeck)),
        /* 테일러드 앞판에는 앞목둘레 곡선이 없다 — 목선 + 고지선 + 라펠선이 그 자리다.
           고지선만 재면 스타일 상수라 호수가 커져도 안 변한다. */
        neckFront: r4(V.dist(g.SNPf, g.gorge0) + V.dist(g.gorge0, g.lapelPt) +
                      V.dist(g.lapelPt, g.breakPt)),
        neckTotal: r4(collarNeckLen),
        armholeBack: r4(sLen(g.backArm)), armholeFront: r4(sLen(g.frontArm)),
        armholeTotal: r4(sLen(g.backArm) + sLen(g.frontArm)),
        sideBack: r4(sideBack), sideFront: r4(sideFront),
        bustDart: r4(g.wedgeAmt),
        backWaistDart: r4(g.bDart), frontWaistDart: r4(g.fDart),
        princessBackIn: r4(sLen(g.bPrinIn)), princessBackOut: r4(sLen(g.bPrinOut)),
        princessFrontIn: r4(sLen(g.fPrinIn)), princessFrontOut: r4(sLen(g.fPrinOut)),
        lapelW: r4(g.lapelW), collarW: r4(num(opt.collarW, K.collarW)),
        pieceCount: pieces.length
      },
      meta: {
        title: '바 재킷 (더블)',
        source: '백영례 「테일러 자켓 패턴」 번호점 제도법 (docs/테일러드재킷-제도법-백영례.md)',
        sizeName: sizeNameOf(m), m: m, geom: g, warnings: warnings, notes: [],
        formulaNotes: formulaNotes(m, g), seam: seam
      }
    };
  }

  function formulaNotes(m, g) {
    return [
      FN('BL',    '진동깊이',  'B/4 + ' + f1(K.armDepthAdd) + '  [2] 4번', g.BL, 'back',
                  [g.bPitchX * 0.4, g.BL]),
      FN('WL',    '허리선',    '등길이  [3] 5번', g.WLb, 'back', [g.bPitchX * 0.4, g.WLb]),
      FN('hip',   '엉덩이선',  '허리 + 엉덩이길이  [4] 3번', g.hipY, 'back', [g.bPitchX * 0.4, g.hipY]),
      FN('cbIn',  '뒤중심 들임', f1(K.cbIn) + '  [5] 7·8·9번', g.cbIn, 'back', [g.cbIn + 0.6, g.WLb - 3.0]),
      FN('bPitch', '등품점',   '4~7 2등분 + 등품/2  [7] 11번', g.bPitchX, 'back',
                  [g.bPitchX - 4.0, g.BL - 1.0]),
      FN('bUnder', '겨드랑',   '4~7 2등분 + 유B/4 + ' + f1(K.underarmAdd) + '  [7] 13번',
                  g.Ub[0], 'backSide', [g.Ub[0] - 4.0, g.BL + 1.2]),
      FN('bHem',  '밑단 폭',   '뒤중심 들임 + H/4 + ' + f1(K.hipEase) + '  [8] 16번',
                  g.bHemSide[0], 'backSide', [g.bHemSide[0] - 5.0, g.hemY - 1.2]),
      FN('bDart', '뒤 다트분', '18~19 = 옆선 허리 − (W/4 + ' + f1(K.waistEase) + ')  [9]',
                  g.bDart, 'back', [g.bCx - 2.0, g.WLb - 1.2]),
      FN('bSh',   '뒤 어깨',   '24-22 기울기 · x = 어깨/2 + ' + f1(K.backShDart) + '  [10][12] 21번',
                  g.shLenBack, 'back', [(g.SNPb[0] + g.SPb[0]) / 2, (g.SNPb[1] + g.SPb[1]) / 2 - 0.8]),
      FN('bNeck', '뒷목',      'B/12 · 유차 올림 ' + f1(g.bustDiff) + ' · 옆목 파기 ' + f1(K.neckOut) +
                  '  [11][18]', g.SNPb[0], 'back', [g.SNPb[0] * 0.5, -1.0]),
      FN('bPrin', '뒤 절개',   '암홀(26번)에서 27번(등품점 − ' + f1(K.bDartCenterIn) + ') 향해  [14][16]',
                  g.bCx, 'back', [g.bCx - 3.0, g.BL + 4.0]),
      FN('fTop',  '앞 상단선', '뒤보다 유차 ' + f1(g.bustDiff) + ' 위 → 앞길이 = 등길이 + 유차  [20]',
                  g.WLf, 'front', [g.fPitchX * 0.35, 1.2]),
      FN('fSh',   '앞 어깨',   '51-48 기울기 · 길이 = 뒤 어깨 − 다트분  [22][23]',
                  g.shLenFront, 'front', [(g.SNPf[0] + g.SPf[0]) / 2, (g.SNPf[1] + g.SPf[1]) / 2 - 0.8]),
      FN('bp',    'BP',       '유폭/2 · 옆목점에서 유장  [26] 57번', m.bpLen, 'frontSide',
                  [g.BP[0] + 0.6, g.BP[1] - 0.8]),
      FN('fDart', '앞 다트분', '옆선 허리 − (W/4 + ' + f1(K.waistEase) + ') · 중심 = BP + ' +
                  f1(K.bpOutToDart) + '  [26][27]', g.fDart, 'frontSide', [g.fCx + 0.6, g.WLf - 1.2]),
      FN('wedge', '가슴다트',  '겨드랑에서 ' + f1(K.bustDartAt) + ' 아래 · **유차만큼** 덜어낸다 (꼭짓점 BP)  [27b]',
                  g.wedgeAmt, 'frontSide', [g.wedgeTop[0] - 4.6, (g.wedgeTop[1] + g.wedgeBot[1]) / 2]),
      FN('lapel', '라펠',      '꺾임 = 75(맨 윗단추) → 76(어깨선 안 ' + f1(K.rollIn) + ') · 고지선 ' +
                  f1(K.gorgeLen) + '  [40]~[43]', g.lapelW, 'front',
                  [g.lapelPt[0] - 1.0, g.lapelPt[1] + 3.0]),
      FN('collar', '카라',     '옆목점에서 ' + f1(K.collarOut) + ' 나가서 · 뒷목치수 + 카라넓이 ' +
                  f1(K.collarW) + '  [42]', K.collarW, 'collar', [1.0, K.collarW * 0.5])
    ];
  }
  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }

  return {
    measuresForSize: measuresForSize,
    draftJacket: draftJacket, draft: draftJacket, geom: geom,
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
