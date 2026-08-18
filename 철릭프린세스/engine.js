/* ============================================================================
 * 철릭 프린세스 — 제도 엔진
 *
 * ★★ 이 엔진은 **PDF/DXF 도면을 읽어 「공식화」하는 엔진**이다 ★★
 *     · 대상 도면 : `철릭프린세스.dxf` · **66호반(66.5호) 한 벌**
 *     · 우선순위 : **도면 치수가 먼저.** 도면에 없는 것만 한복 제도 관례를 벤치마킹.
 *     · 하는 일  : 한 호수뿐인 도면을 **전 호수가 따라오는 식**으로 바꾼다.
 *   ⚠ 좌표를 박지 마라 — `B/4 + 상수` · `어깨너비/2` · `B/12` 처럼 **치수에서 나오는 식**으로.
 *   ⚠ 이 방침과 도면 상수는 **이 엔진에만** 쓴다 (다른 모듈은 교재 공식이 기준).
 *
 *   조각 6장 — 뒷판 · 앞판 · 긴소매 · 깃 · 뒷치마판 · 앞치마판
 *   ★ 철릭은 **상의(저고리) + 주름 잡은 치마**를 허리에서 잇는 옷이다.
 *     치마폭을 임의로 정하지 않는다 — 몸판 허리폭에서 **주름 개수**가 나오고
 *     치마폭이 따라 나온다.
 *   ★ 앞판은 **V 네크라인 변형** — 앞목 곡선이 없고 섶선이 목옆점까지 직선이다.
 *
 * 좌표계: cm. 조각마다 자기 원점. x 오른쪽 + · y 아래 +.
 *         몸판은 **목옆점 높이 y=0 · 허리 y=조각 높이**.
 *
 * 노출: window.CheollikEngine / module.exports
 * ==========================================================================*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.CheollikEngine = api; }
  else if (root) root.CheollikEngine = api;
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
    /* ★ 등분 수를 **길이에 맞춘다.** 예전에는 늘 240 등분이었다 — 점열로 만든 변
       (poly·lineSegs 연쇄)은 도막 하나가 0.02cm 인데도 240 번을 돌아, 조각 하나에
       수십만 번이 나갔다. 제어 다각형 길이로 잡으면 긴 곡선은 그대로 240 이라
       **정밀도는 변하지 않고** 짧은 도막만 빨라진다. */
    if (n === undefined || n === null) {
      var cl = V.dist(p0, c1) + V.dist(c1, c2) + V.dist(c2, p1);
      n = Math.max(8, Math.min(240, Math.ceil(cl / 0.02)));
    }
    var L = 0, q = p0;
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
  /* ★ 같은 곡선을 **몇 번이고 다시 샘플링**한다 — 변을 만들 때 한 번, 너치마다 한 번,
     길이 잴 때 또 한 번. 프로파일에서 이 함수가 전체의 58% 였다.
     세그먼트 배열을 키로 캐시한다 (WeakMap 이라 제도 한 판이 끝나면 저절로 버려진다).
     ⚠ 돌려주는 배열을 **고쳐 쓰면 안 된다** — 부르는 쪽이 전부 slice/map 으로 복사해
       쓰고 있어 지금은 안전하다. 새로 쓸 때도 그 규칙을 지킬 것. */
  var _sampleCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function sampleSegs(segs, step) {
    step = step || FLATTEN;
    if (_sampleCache && segs && typeof segs === 'object') {
      var slot = _sampleCache.get(segs);
      if (!slot) { slot = {}; _sampleCache.set(segs, slot); }
      var key = '' + step;
      if (slot[key]) return slot[key];
      var made = sampleSegsRaw(segs, step);
      slot[key] = made;
      return made;
    }
    return sampleSegsRaw(segs, step);
  }
  function sampleSegsRaw(segs, step) {
    var pts = [];
    segs.forEach(function (g, gi) {
      var L = bezLen(g.p0, g.c1, g.c2, g.p1), n = Math.max(2, Math.ceil(L / step));
      /* ★ 호길이 표의 촘촘함도 **도막 길이에 맞춘다.** 최소 64 를 박아 두면 0.02cm
         도막에도 64 점을 만든다 — 점열로 만든 변에서 그게 곧 병목이었다.
         0.5cm 이상 도막에서는 예전과 값이 같다 (64 가 그대로 나온다). */
      var fine = Math.max(4, Math.min(64, Math.ceil(L / 0.005)));
      if (n * 4 > fine) fine = n * 4;
      var fx = [g.p0], acc = [0], prev = g.p0, i;
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
   *   원본 도면(`철릭프린세스.dxf`)은 **66호반(66.5호) 한 벌**이다.
   *   호수표는 이 Suite 의 것을 쓰고, 66.5호 = 66호 + **0.5단계**로 놓아
   *   도면 실측이 그 자리에서 재현되게 상수를 잡았다.
   * ════════════════════════════════════════════════════════════════ */
  var BASE  = { B: 87.6, W: 73.6, backLen: 37.5, skirtLen: 74.5,
                shoulderW: 38.0, sleeveLen: 46.0, collarLen: 44.8 };
  var GRADE = { B: 6.0,  W: 6.0,  backLen: 0.5,  skirtLen: 1.0,
                shoulderW: 0.8,  sleeveLen: 1.0, collarLen: 0.5 };
  var SIZE_STEP = { '44호': -2, '55호': -1, '66호': 0, '66호반': 0.5, '77호': 1, '88호': 2 };
  var MEAS_KEYS = ['B', 'W', 'backLen', 'skirtLen', 'shoulderW', 'sleeveLen', 'collarLen'];
  var MEAS_LABEL = { B: '가슴둘레', W: '허리둘레', backLen: '등길이(저고리)',
                     skirtLen: '치마길이', shoulderW: '어깨너비',
                     sleeveLen: '소매길이', collarLen: '깃 길이' };

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
   * 2. 제도 상수 — [ ] 안이 **66.5호 도면 실측**
   *
   *   ★ 이 엔진도 **PDF 도면을 읽어 「공식화」하는 엔진**이다 (바재킷더블과 같은 방침).
   *     도면 치수가 먼저이고, 도면에 없는 것만 한복 제도 관례를 벤치마킹한다.
   *   ⚠ 좌표를 그대로 박지 않는다 — `B/4 + 상수` · `어깨너비/2` · `B/12` 처럼
   *     **치수에서 나오는 식**으로 옮겨 전 호수가 따라오게 한다.
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;
  var K = {
    /* ── 몸판 폭 — 전부 B/4 기준 ─────────────────────────────────── */
    bWaistAdd    : -0.26,  // 뒤 허리폭  = B/4 + 이 값   [22.39]
    bChestAdd    :  0.99,  // 뒤 겨드랑폭 = B/4 + 이 값  [23.64]
    frontWrap    : 13.73,  // 앞 허리폭  = B/4 + 이 값 (여밈분)  [36.38]
    fChestAdd    : 15.26,  // 앞 겨드랑폭 = B/4 + 이 값  [37.91]
    /* ── 몸판 높이 ────────────────────────────────────────────────── */
    cbSub        :  0.36,  // 뒤중심 길이 = 등길이 − 이 값 (허리~뒷목점)  [37.39]
    snpRise      :  2.79,  // 목옆점 — 뒷목선에서 올림   [40.18 − 37.39]
    backNeckAdd  :  0.15,  // 뒷목너비 = B/12 + 이 값    [7.70]
    /* ★ 뒷목둘레는 **곡선**이다 — 직선 + 모서리가 아니다 (2026-08-13 사용자 지적).
       처음에 DXF SPLINE 의 **제어점**을 그대로 읽어 (0,2.79)–(7.70,2.79)–(8.39,0)
       꺾인 선으로 그렸다. 제어 다각형은 늘 실제 곡선보다 각져 보인다.
       de Boor 로 평가한 실제 곡선을 재니 매끄러운 곡선이고, 현에서 **0.122 비율**
       (1.08cm) 안으로 들어간다. 한복 저고리 뒷목선이 원래 그렇게 굽는다. */
    bnpAdd       :  0.20,  // 뒤중심 목점 = 뒷목선 + 이 값  [2.99 − 2.79]
    backNeckB : [[0.114,-0.0753],[0.257,-0.1081],[0.377,-0.1127],[0.474,-0.1063],
                 [0.646,-0.0786],[0.779,-0.0459],[0.852,-0.0247]],
    /* ── 프린세스 절개선 (이 모듈 전용) ─────────────────────────────
       철릭 도면에는 절개선이 없다. 토르소원형프린세스라인을 벤치마킹한 값이다.
       ⚠ 허리 위치는 「폭의 비율」이라 호수가 바뀌어도 같은 자리에 온다. */
    princessAt   :  0.52,  // 어깨선에서 출발하는 자리 (0.5 = 2등분 · 토르소 도면 ✳)
    /* ★ 앞 절개선은 **BP 를 지난다** (사용자 지적 2026-08-14 — 「앞판은 BP점을
       지나야 이쁘지」). 철릭 치수에는 유장·유폭이 없어 B·등길이에서 세운다.
       기준은 숙녀복 원형(B 84 에서 유폭 16 · 유장 25 · 등길이 38):
         유폭/2 = B × 0.0952   (84 × 0.0952 = 8.00)
         유장   = 등길이 × 0.658 (38 × 0.658 = 25.0)
       ⚠ 앞판 좌표는 x=0 이 **여밈 끝**이고 **몸 중심은 x = 여밈분** 이다
         (옆선 36.38 = 여밈 13.73 + B/4 22.65 로 맞아떨어진다). */
    bustHalfAt   :  0.0952, // 유폭/2 = B × 이 값
    bustLenAt    :  0.658,  // 유장 = 등길이 × 이 값 (목옆점에서)
    fPrinWaistOff: -0.60,   // 허리에서 BP 보다 앞중심 쪽으로 더 들어가는 양
    bPrinWaistAt :  0.40,   // 뒤 절개선이 허리를 만나는 곳 — 뒤 허리폭의 비율
    bPrinBow     : -1.00,   // 뒤 — 진동선 높이에서 **뒤중심 쪽으로** 휘는 양(견갑골)
    shSlope      :  3.57,  // 어깨 기울기 — 목옆점에서 어깨점까지 내림  [3.57]
    shoulderSub  :  0.07,  // 어깨점 x = 어깨너비/2 − 이 값  [19.13]
    armDepthSub  :  1.71,  // 진동깊이 = B/4 − 이 값 (뒷목선에서 겨드랑까지)  [20.94]
    /* ── 앞판 · V 네크라인 ────────────────────────────────────────── */
    fSnpDrop     :  1.12,  // 앞 목옆점은 뒤보다 이만큼 낮다  [40.18 − 39.06]
    fSnpIn       : 13.90,  // 앞 목옆점 — **옆선에서** 안으로  [36.38 − 22.48]
    vNeckDrop    : 11.87,  // V 바닥 — 앞중심에서 위로 (허리 기준)  [11.87]
    vNeckIn      :  4.62,  // V 바닥 — 앞중심에서 안으로  [4.62]
    /* ★ 진동 곡선이 **현에서 안으로 들어가는 양** — 앵커 7점을 **실제 곡선에서** 뽑았다.
       ① 들어가는 양은 **현 길이의 비율**이다. 절대값으로 박으면 호수가 작아질수록
          현이 짧아져 진동이 상대적으로 더 깊어진다 (44호 호/현 1.21 ↔ 88호 1.11).
       ② ⚠ **제어점에서 재면 안 된다.** DXF SPLINE 의 코드 10 은 제어점이고,
          제어 다각형은 오목한 구간에서 늘 실제 곡선 **바깥**에 있다 —
          t 0.4 에서 제어점은 0.2565 인데 실제 곡선은 **0.1852** 다.
          그 값으로 그렸더니 진동이 도면보다 깊고 각졌다
          (2026-08-13 사용자 지적: 「도면 암홀은 부드러운데 조각은 둥글지 않다」).
       ③ 앵커가 3점이면 t 0.5~0.75 의 완만한 구간을 못 따라간다 → **7점**.
       de Boor 로 평가한 정답지 곡선에서 t 0.12~0.88 을 고르게 뽑은 값이다. */
    /* 겨드랑 쪽 t 0.85~0.97 을 더 넣었다 — 없으면 진동이 겨드랑에서 **각지게 꺾인다**
       (도면은 둥글게 이어진다). */
    bArmB : [[0.130,0.0746],[0.260,0.1370],[0.381,0.1852],[0.510,0.2235],
             [0.608,0.2411],[0.749,0.2412],[0.851,0.2075],[0.919,0.1550],[0.962,0.0982]],
    /* ⚠ 앞 앵커는 **앞판 프레임(목옆점 y=0)** 에서 뽑아야 한다. 뒤 프레임 좌표로
       뽑았더니 끝점이 1.1 어긋난 자리에서 재어 겨드랑 부근이 그만큼 벌어졌다. */
    fArmB : [[0.123,0.0796],[0.259,0.1554],[0.382,0.2153],[0.506,0.2635],
             [0.621,0.2899],[0.752,0.2806],[0.851,0.2307],[0.919,0.1603],[0.965,0.0838]],
    /* ── 치마 · 주름 ───────────────────────────────────────────────
       ★ 주름이 이 옷의 핵심이다. 도면에서 규칙을 읽었다:
         · 주름 하나가 **접히는 양** 3.85 · 치마에서 차지하는 폭 5.83
         · 그래서 허리에서 **보이는 폭**은 5.83 − 3.85 = 1.98 씩
         · 주름 개수 n = round((허리폭 − 양끝 여백) / 1.98)
         · 치마폭 = 허리폭 + n × 3.85
       도면 검산 — 뒤: n 10 · 22.39 + 10×3.85 = 60.9 [60.81]
                   앞: n 17 · 36.38 + 17×3.85 = 101.8 [102.69] */
    /* ★ 주름분은 **앞뒤가 다르다.** 주름 표시 폭(3.85) 하나로 두었더니 뒷치마는
       +0.08 로 맞는데 앞치마가 −0.86 어긋났다. 도면에서 역산하면
         뒤 (60.815 − 22.39)/10 = **3.8425**   앞 (102.694 − 36.38)/17 = **3.9008**
       치마폭 = 허리폭 + 개수 × 주름분 이므로 앞뒤를 따로 두어야 둘 다 맞는다. */
    pleatDepthB  :  3.8425, // 뒤 주름분 (접히는 양)
    pleatDepthF  :  3.9008, // 앞 주름분
    pleatStep    :  5.83,  // 주름 간격 (치마에서 차지하는 폭) — 앞뒤 같다 [58.3mm]
    /* 여백 3.0 이면 앞뒤 모두 도면과 같은 개수가 나온다 (뒤 10 · 앞 17) */
    pleatEdge    :  3.00,  // 양끝 여백 — 주름을 두지 않는 폭
    pleatMarkH   :  5.00,  // 주름 표시 높이 (제도선)
    /* ── 소매 — **소매산이 위 · 수구가 아래** ───────────────────────
       ⚠ 2026-08-17 이전에는 변 이름이 통째로 뒤바뀌어 있었다 — 굽은 끝을
         「배래 + 수구」로, 곧은 끝을 「진동」으로 읽었다. 실측이 그걸 부순다:
         굽은 끝 49.53 만이 몸판 진동 47.89 와 맞고(이세 3.4%), 곧은 끝 30.14 는
         **17.75 나 모자랐다**. 두 밑선은 31.95 ↔ 31.91 로 짝이고, 소매산 높이는
         14.74 다. 근거 전문은 docs/철릭-소매-판정.md.
       ★ 소매폭은 상수가 아니라 **몸판 진동에서 풀어 나온다** (geom 참고).
         30.22 를 상수로 박아 두었더니 44호 이세 +9.96(26%) · 88호 **−3.45**
         (모자라서 붙지도 않는다) 였다 — memory `pattern-engine-techniques` ①. */
    capEase      :  0.03501,// 소매산 이세 = 몸판 진동의 이 비율 — 66호반에서 도면 폭 37.112 / 수구 30.22 가 그대로 나오는 값이다 [1.68/47.89]
    capHAt       :  0.317, // 소매산 높이 = 소매길이의 이 비율   [도면 14.75/46.48]
    cuffRatio    :  0.8144,// 수구 폭 = 소매폭의 이 비율         [도면 30.22/37.11]
    /* ★ 소매산 꼭짓점은 **평평한 변이 아니라 둥근 점**이다. 제어점에 x=0 이 둘
       있어 3.81 짜리 직선으로 오독했는데, 실제 곡선은 x=0 을 **한 번 스치고**
       돌아 나간다 (2026-08-13 도면 대조). */
    capTipW      :  0.60,  // 소매산 꼭짓점 — 곧은 구간 (사실상 점)
    capTipAt     :  0.5047,// 꼭짓점 자리 — 소매폭의 이 비율     [도면 18.73/37.11]
    /* 소매산 두 도막 — 도면 점열에서 잰 **현 대비 비율** 앵커.
       ⚠ 2점 스플라인에 장력만 주면 4.6cm 나 부푼다 (도면 대조에서 잡혔다).
       뒤가 앞보다 길다 (25.02 ↔ 23.95) — 이세도 뒤가 크다(0.87 > 0.21). */
    capBack  : [[0.076,-0.0396],[0.192,-0.0663],[0.315,-0.0615],[0.435,-0.0264],
               [0.559,0.0346],[0.682,0.0770],[0.791,0.0860],[0.880,0.0673],
               [0.941,0.0392],[0.976,0.0175]],                  // 가장 넓은 자리 → 꼭짓점 (뒤)
    capFront : [[0.085,0.0360],[0.188,0.0486],[0.327,0.0404],[0.432,0.0234],
               [0.553,-0.0038],[0.684,-0.0357],[0.792,-0.0489],[0.884,-0.0458],
               [0.947,-0.0304],[0.966,-0.0220]],                // 꼭짓점 → 가장 넓은 자리 (앞)
    /* 소매 끝의 곧은 구간 — 사실상 점이라 곡률은 거의 없다 */
    capTipB : [[0.35, -0.004], [0.70, -0.010]],
    /* V 네크라인은 **곧은 직선이 아니라 살짝 굽는다** (현에서 0.02 비율 안쪽) */
    /* ★ 앞 목선은 **목옆점에서 앞중심까지 한 줄기 곡선**이다 — 도면이 그렇다.
       V 바닥에서 꺾어 「섶선」을 따로 그으면 도면에 없는 계단이 생긴다
       (2026-08-13 사용자 지적). V 바닥은 그 곡선 위의 **표시점**일 뿐이다. */
    vNeckB : [[0.095,-0.0294],[0.216,-0.0453],[0.338,-0.0579],[0.461,-0.0706],
              [0.579,-0.0828],[0.697,-0.0950],[0.805,-0.0920],[0.886,-0.0736],
              [0.939,-0.0501],[0.974,-0.0249]],
    /* ── 깃 ───────────────────────────────────────────────────────── */
    collarW      :  4.50,  // 깃 너비  [1.15~5.65]
    collarRound  : 10.37,  // 깃 끝 둥글리기 시작 — 끝에서 이 거리  [10.37]
    /* ★ 깃 아랫변(목붙임선)은 **둥글리기 전까지 곧은 직선**이다.
       스플라인 하나로 그렸더니 가운데가 0.48 처졌다 (도면은 y 4.50~4.53 로 곧다).
       둥근 끝만 도면 앵커로 그린다. */
    collarTipB : [[0.116,-0.0450],[0.277,-0.0847],[0.437,-0.1099],[0.599,-0.1186],
                  [0.742,-0.1071],[0.861,-0.0775],[0.942,-0.0401]],
    collarStraight: 9.75,  // 깃 직선부(동정 자리) — 반대 끝에서  [35.31~45.06]
    /* ── 고름 · 동정 — **도면에 없다.** 한복 관례를 벤치마킹한다 ────────
       이 엔진은 도면 치수가 먼저지만, 도면에 없는 것은 관례를 쓴다는 방침이다.
       고름은 **폭을 두 배로 재단해 길이 방향으로 반 접는다** — 그래서 조각의
       폭은 완성폭 × 2 이고 긴 변 하나가 골선이다. 끝은 사선으로 자른다. */
    gorumLongF   : 0.95,   // 긴고름 길이 = 총장(저고리+치마) × 이 비율
    gorumShortSub: 14.0,   // 짧은고름 = 긴고름 − 이 값
    gorumW       :  6.0,   // 고름 완성 폭 (재단은 ×2)
    gorumCut     :  6.0,   // 고름 끝 사선
    dongjeongF   : 0.62,   // 동정 길이 = 깃 길이 × 이 비율
    dongjeongW   :  1.8    // 동정 완성 폭 (재단은 ×2)
  };
  var CAL = {
    /* 프린세스 절개선 끝접선 장력 — 위아래 모두 세로. 토르소와 같은 값 */
    princess : { k0: 0.20, k1: 0.20 },
    arm    : { k0: 1.10, k1: 1.20 },   // 진동 곡선 끝 접선
    collar : { k0: 1.00, k1: 1.00 },
    sleeve : { k0: 1.20, k1: 1.20 }
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도 — 조각마다 자기 좌표계 (x 오른쪽 + · y 아래 +)
   *
   *   몸판: 원점 = **허리선 × 뒤중심(앞중심)**. y 는 위로 갈수록 **음수**가 아니라,
   *         suite 관례대로 **y 아래 +** 이므로 허리를 y=0 으로 두고 위를 음수로 두지 않고
   *         **목옆점을 y=0, 허리를 y=길이** 로 뒤집어 쓴다 (다른 모듈과 같은 방향).
   * ════════════════════════════════════════════════════════════════ */
  function num(v, d) { return (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v; }
  function rotAbout(p, c, a) {
    var s = Math.sin(a), co = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1];
    return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co];
  }
  /** 너치 보정 — ① 재단선 위로 스냅 ② 틱이 조각 **안쪽**을 향하게.
   *  판정은 그리는 것과 같은 방식(point-in-polygon)이라야 한다. */
  function fixNotches(notches, o) {
    (notches || []).forEach(function (n) {
      var best = null, bd = Infinity, bt = null;
      for (var i = 1; i < o.length; i++) {
        var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        var t = L2 ? ((n.p[0] - a[0]) * dx + (n.p[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var q = [a[0] + t * dx, a[1] + t * dy], e = V.dist(n.p, q);
        if (e < bd) { bd = e; best = q; bt = L2 ? [dx, dy] : null; }
      }
      if (bd <= 3.0) n.p = best;
      /* ★ 너치는 **재단선에 직각**으로 세운다 (2026-08-15 · 조끼→원피스에서 이식).
         방향만 안쪽으로 맞추면 선과 나란히 누워 재단선에 묻힌다.
         조각 **꼭짓점**은 한쪽 변의 법선이 다른 변에 눕는다 → 두 변의 이등분선.
         ⚠ 양쪽 다 조각 밖인 퇴화 자리는 아래 기존 탐색으로 내려간다. */
      if (bt) {
        var Ln = Math.hypot(bt[0], bt[1]);
        var nx = -bt[1] / Ln, ny = bt[0] / Ln, near = [];
        for (var k2 = 1; k2 < o.length; k2++) {
          var a2 = o[k2 - 1], b2 = o[k2], dx2 = b2[0] - a2[0], dy2 = b2[1] - a2[1];
          var L22 = dx2 * dx2 + dy2 * dy2;
          var t2 = L22 ? ((n.p[0] - a2[0]) * dx2 + (n.p[1] - a2[1]) * dy2) / L22 : 0;
          t2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
          if (L22 && V.dist(n.p, [a2[0] + t2 * dx2, a2[1] + t2 * dy2]) <= 0.02)
            near.push([dx2 / Math.sqrt(L22), dy2 / Math.sqrt(L22)]);
        }
        if (near.length >= 2) {
          var f2 = near[0], l2 = near[near.length - 1];
          var bx = f2[0] - l2[0], by = f2[1] - l2[1], bl = Math.hypot(bx, by);
          if (bl > 1e-6) { nx = bx / bl; ny = by / bl; }
        }
        if (!ptInPoly([n.p[0] + nx * NOTCH_TICK, n.p[1] + ny * NOTCH_TICK], o)) { nx = -nx; ny = -ny; }
        if (ptInPoly([n.p[0] + nx * NOTCH_TICK, n.p[1] + ny * NOTCH_TICK], o)) {
          n.angle = Math.atan2(ny, nx) * 180 / Math.PI;
          return;
        }
      }
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
    return notches;
  }

  /** 주름 배분 — 허리폭에서 개수를 정하고 치마폭을 되돌려 준다 */
  function pleatPlan(waistW, opt, depth) {
    var dep = depth, step = num(opt.pleatStep, K.pleatStep);
    var edge = num(opt.pleatEdge, K.pleatEdge);
    var show = Math.max(0.3, step - dep);                 // 허리에서 보이는 폭
    var n = Math.max(1, Math.round((waistW - edge) / show));
    return { n: n, depth: dep, step: step, show: show, edge: edge,
             skirtW: waistW + n * dep };
  }

  function geom(m, opt) {
    opt = opt || {};
    var B = num(opt.B, m.B), W = num(opt.W, m.W);
    var backLen  = num(opt.backLen, m.backLen);
    var skirtLen = num(opt.skirtLen, m.skirtLen);
    var shoulderW= num(opt.shoulderW, m.shoulderW);
    var sleeveLen= num(opt.sleeveLen, m.sleeveLen);
    var collarLen= num(opt.collarLen, m.collarLen);
    var q = B / 4;

    /* ───────── 뒷판 (원점 = 뒤중심 × 목옆점 높이, y 아래 +) ───────── */
    var snpRise = num(opt.snpRise, K.snpRise);
    var cbLen   = backLen - K.cbSub;                       // 허리~뒷목점
    var bTotal  = cbLen + snpRise;                         // 목옆점~허리 (조각 높이)
    var bNeckW  = B / 12 + num(opt.backNeckAdd, K.backNeckAdd);
    var bSNP    = [bNeckW + 0.69, 0];                      // 목옆점
    var bBNP    = [0, snpRise + num(opt.bnpAdd, K.bnpAdd)];  // 뒤중심 목점
    /* 뒷목둘레 — 목옆점 → 뒤중심 목점. **곡선**이다 (도면 실측 앵커) */
    var bNeckCv = armCurve(bSNP, bBNP, K.backNeckB);
    var bSP     = [shoulderW / 2 - K.shoulderSub, num(opt.shSlope, K.shSlope)];
    var armDepth= q - num(opt.armDepthSub, K.armDepthSub); // 뒷목선~겨드랑
    var bUY     = snpRise + armDepth;                      // 겨드랑 y
    var bU      = [q + K.bChestAdd, bUY];                  // 겨드랑
    var bWaist  = [q + K.bWaistAdd, bTotal];               // 허리 옆
    var bHem    = [0, bTotal];                             // 허리 뒤중심

    /* ───────── 앞판 (원점 = 앞중심 × 뒤 목옆점 높이) ───────── */
    var fWaistW = q + num(opt.frontWrap, K.frontWrap);
    var fChestW = q + K.fChestAdd;
    var fSNP    = [fWaistW - K.fSnpIn, K.fSnpDrop];
    var fSP     = [fSNP[0] + (bSP[0] - bSNP[0]), fSNP[1] + num(opt.shSlope, K.shSlope)];
    var fU      = [fChestW, bUY];
    var fWaist  = [fWaistW, bTotal];
    var fCf     = [0, bTotal];                             // 앞중심 × 허리
    /* 앞중심 위끝 — 목선이 앞중심을 만나는 자리. V 바닥은 그 곡선 위의 표시점이다. */
    var fCfTop  = [0, bTotal - num(opt.vNeckDrop, K.vNeckDrop)];
    var vBot    = [num(opt.vNeckIn, K.vNeckIn), fCfTop[1] + 0.35];

    /* V 네크라인 — 목옆점 → **앞중심**까지 한 줄기 곡선 (도면 앵커 10점) */
    var vNeck = armCurve(fSNP, fCfTop, K.vNeckB);
    /* 진동 곡선 — 현에서 안으로 들어간다 (도면 실측 자리) */
    var bArm = armCurve(bSP, bU, K.bArmB);
    var fArm = armCurve(fSP, fU, K.fArmB);

    /* ═══ 프린세스 절개선 — 이 모듈이 기본형과 다른 유일한 곳 ═══════════
       철릭은 **다트가 없다**. 그래서 이 절개선은 다트를 옮겨 담은 서양 프린세스와
       달리 **순수한 분할선**이다 — 두 조각을 도로 붙이면 기본형 몸판 그대로다.
       (검산기가 「자르기 전과 같은 옷인가」로 그것을 확인한다.)

       작도는 토르소원형프린세스라인을 벤치마킹했다:
         · 출발 = **어깨선을 2등분**한 자리 (그쪽 도면의 ✳ 표시 · princessAt 0.5)
         · 진동선 높이를 지나 허리까지 한 줄기 C2 스플라인
         · 끝접선은 위아래 모두 **세로** — 허리에서 꺾이지 않게
       다만 철릭 몸판은 겨드랑~허리가 거의 수직이라(뒤 23.64 → 22.39) 절개선도
       거의 수직이다. 서양 원형처럼 허리를 조이는 선이 아니다. */
    var pAt = num(opt.princessAt, K.princessAt);
    function shTop(SNP, SP) {
      return V.add(SNP, V.mul(V.norm(V.sub(SP, SNP)), V.dist(SNP, SP) * pAt));
    }
    function prin(top, mid, wp) {
      return { top: top, mid: mid, waist: wp,
               segs: splineSegs([top, mid, wp], endTan([0, 1], CAL.princess.k0),
                                                endTan([0, 1], CAL.princess.k1)) };
    }
    /* 뒤 — 견갑골 자리를 지난다. 진동선 높이에서 **뒤중심 쪽으로** 휜다. */
    var bTop  = shTop(bSNP, bSP);
    var bWp   = [bWaist[0] * num(opt.bPrinWaistAt, K.bPrinWaistAt), bTotal];
    var bT    = (bUY - bTop[1]) / (bWp[1] - bTop[1]);
    var bPrin = prin(bTop, [bTop[0] + (bWp[0] - bTop[0]) * bT + num(opt.bPrinBow, K.bPrinBow), bUY], bWp);
    /* 앞 — **BP 를 지난다**. 몸 중심 = 여밈분 자리이므로 거기서 유폭/2 만큼 나간다. */
    var bodyCf  = fWaistW - q;                                   // = 여밈분
    var BP      = [bodyCf + B * num(opt.bustHalfAt, K.bustHalfAt),
                   fSNP[1] + backLen * num(opt.bustLenAt, K.bustLenAt)];
    var fTop    = shTop(fSNP, fSP);
    var fPrin   = prin(fTop, BP, [BP[0] + num(opt.fPrinWaistOff, K.fPrinWaistOff), bTotal]);

    /* ───────── 치마 ───────── */
    var bPl = pleatPlan(bWaist[0], opt, num(opt.pleatDepthB, K.pleatDepthB));  // 뒷치마
    var fPl = pleatPlan(fWaist[0], opt, num(opt.pleatDepthF, K.pleatDepthF));  // 앞치마

    /* ───────── 소매 — 소매산이 **몸판 진동에서 따라 나온다** ─────────
       소매폭을 미지수로 두고 「소매산 호길이 = 몸판 진동 × (1 + 이세)」가 되는
       값을 이분법으로 찾는다. 소매산 높이·수구 비율·곡선 앵커는 도면 그대로라
       **66호반에서는 도면값(폭 37.11 · 수구 30.22)이 그대로 나온다.**
       ⚠ 폭을 상수로 박으면 도면 호수에서만 맞는다 (2026-08-17 판정). */
    var ahAll  = sLen(bArm) + sLen(fArm);
    var capH   = sleeveLen * num(opt.capHAt, K.capHAt);      // 소매산 높이
    var tipW   = num(opt.capTipW, K.capTipW);
    var tipAt  = num(opt.capTipAt, K.capTipAt);
    var capTgt = ahAll * (1 + num(opt.capEase, K.capEase));  // 목표 소매산 호길이
    function capSegsOf(w) {
      var cy = w * tipAt, Tw = [capH, 0], Bw = [capH, w];
      var Cu = [0, cy - tipW / 2], Cl = [0, cy + tipW / 2];
      return [armCurve(Tw, Cu, K.capBack), armCurve(Cu, Cl, K.capTipB),
              armCurve(Cl, Bw, K.capFront)];
    }
    function capLenOf(w) {
      var segs = capSegsOf(w), t = 0;
      for (var ci = 0; ci < segs.length; ci++) t += sLen(segs[ci]);
      return t;
    }
    /* 호길이는 폭에 대해 단조증가라 이분법 40 회면 1e-10 아래로 좁혀진다 */
    var wLo = 5, wHi = 200;
    for (var wI = 0; wI < 40; wI++) {
      var wMid = (wLo + wHi) / 2;
      if (capLenOf(wMid) < capTgt) wLo = wMid; else wHi = wMid;
    }
    var wide = (wLo + wHi) / 2;
    var cuff = wide * num(opt.cuffRatio, K.cuffRatio);

    return {
      m: m, B: B, W: W, q: q, backLen: backLen, skirtLen: skirtLen,
      shoulderW: shoulderW, sleeveLen: sleeveLen, collarLen: collarLen,
      cbLen: cbLen, bTotal: bTotal, armDepth: armDepth, snpRise: snpRise,
      bNeckW: bNeckW, bSNP: bSNP, bBNP: bBNP, bSP: bSP, bNeckCv: bNeckCv,
      bU: bU, bWaist: bWaist, bHem: bHem, bArm: bArm,
      fWaistW: fWaistW, fChestW: fChestW, fSNP: fSNP, fSP: fSP, fU: fU,
      fWaist: fWaist, fCf: fCf, vBot: vBot, fCfTop: fCfTop, fArm: fArm, vNeck: vNeck,
      bPrin: bPrin, fPrin: fPrin, BP: BP, bodyCf: bodyCf,
      bPleat: bPl, fPleat: fPl, coatLen: bTotal + skirtLen,
      sleeveWideY: wide, cuffW: cuff, capH: capH, capTipW: tipW,
      capTipAt: tipAt, armholeAll: ahAll, capLen: capLenOf(wide),
      shLenBack: V.dist(bSNP, bSP), shLenFront: V.dist(fSNP, fSP)
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 4. 곡선
   * ════════════════════════════════════════════════════════════════ */
  /** 진동 — 어깨점에서 겨드랑까지. 현에서 **안으로** 들어간다 (한 방향으로만 휜다).
   *  ★ 앵커 **두 개**를 지난다 — 도면이 t 0.4~0.7 구간에서 평평하기 때문이다.
   *  들어가는 양은 **현 길이의 비율**이라 전 호수가 같은 모양이 된다. */
  function armCurve(SP, U, anchors) {
    var L = V.dist(SP, U);
    var pts = [SP].concat(anchors.map(function (a) { return chordBulge(SP, U, a[0], L * a[1]); })).concat([U]);
    return splineSegs(pts, endTan(V.sub(pts[1], SP), CAL.arm.k0),
                           endTan(V.sub(U, pts[pts.length - 2]), CAL.arm.k1));
  }
  /* chordBulge 는 §5 에 있다 (조각 부속과 함께 이식) */

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
      /* ★ 0.375 → 0.75. 점열로 만든 변은 0.02 간격으로 찍히는데 하한이 0.015 라
         그대로 다 남아 외곽선이 4,000점을 넘었다. 상한이 0.06 이므로 0.03 이면
         재단선 정밀도에 아무 영향이 없고 점수는 절반이 된다. */
      var keep = [], MIN = FLATTEN * 0.75, MAXG = FLATTEN * 1.3;   // 0.03 / 0.052
      for (var si = 0; si < sp.length; si++) {
        if (si === 0 || si === sp.length - 1) { keep.push(sp[si]); continue; }
        if (V.dist(sp[si], keep[keep.length - 1]) >= MIN) { keep.push(sp[si]); continue; }
        /* ★ 하한만 보면 **상한을 넘길 수 있다.** 원본 점 간격이 0.033 인 자리에서
           한 점을 버리면 0.03 + 0.033 = 0.063 이 되어 SPEC 상한 0.06 을 넘는다
           (66호 큰소매에서 실제로 걸렸다). 다음 점까지 건너뛰면 상한을 넘는 자리는
           지금 점을 남긴다. */
        if (V.dist(sp[si + 1], keep[keep.length - 1]) > MAXG) keep.push(sp[si]);
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
      /* ★ 예전에는 모든 점 쌍을 봤다 — 외곽선이 4,000점이면 800만 번이고,
         프로파일에서 이 함수가 전체의 36% 였다. **64점 블록 bbox** 로 먼저 걸러
         겹치지 않는 블록은 통째로 건너뛴다. 판정은 그대로라 결과가 같다. */
      var BS = 64, nb = Math.ceil(n / BS), blk = [], b, q;
      for (b = 0; b < nb; b++) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        var lo = b * BS, hi = Math.min(n, (b + 1) * BS + 1);
        for (q = lo; q < hi; q++) {
          var pq = pts[q % n];
          if (pq[0] < x0) x0 = pq[0]; if (pq[0] > x1) x1 = pq[0];
          if (pq[1] < y0) y0 = pq[1]; if (pq[1] > y1) y1 = pq[1];
        }
        blk.push([x0, y0, x1, y1]);
      }
      for (i = 0; i < n && !hit; i++) {
        var a1 = pts[i], a2 = pts[(i + 1) % n];
        var ax0 = Math.min(a1[0], a2[0]), ax1 = Math.max(a1[0], a2[0]);
        var ay0 = Math.min(a1[1], a2[1]), ay1 = Math.max(a1[1], a2[1]);
        for (b = Math.floor((i + 2) / BS); b < nb && !hit; b++) {
          var B = blk[b];
          if (B[0] > ax1 || B[2] < ax0 || B[1] > ay1 || B[3] < ay0) continue;
          var jLo = Math.max(i + 2, b * BS), jHi = Math.min(n - 1, (b + 1) * BS - 1);
          for (j = jLo; j <= jHi; j++) {
            if (i === 0 && j === n - 1) continue;
            var b1 = pts[j], b2 = pts[(j + 1) % n];
            if (Math.min(b1[0], b2[0]) > ax1 || Math.max(b1[0], b2[0]) < ax0) continue;
            if (Math.min(b1[1], b2[1]) > ay1 || Math.max(b1[1], b2[1]) < ay0) continue;
            var X = segX(a1, a2, b1, b2);
            if (X) { hit = { i: i, j: j, X: X }; break; }
          }
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
   * 6. 조각 — 뒷판 · 앞판 · 긴소매 · 깃 · 앞치마판 · 뒷치마판
   *
   *   ★ 상의(저고리)와 **주름 잡은 치마**를 허리에서 잇는 것이 철릭이다.
   *     치마폭은 임의로 정하지 않는다 — **허리폭에서 주름 개수를 정하고
   *     치마폭이 따라 나온다** (`pleatPlan`).
   *   ★ 앞판은 **V 네크라인 변형** — 앞중심에서 올라온 섶선이 목옆점까지
   *     한 직선으로 간다. 서양 원형의 앞목 곡선이 없다.
   * ════════════════════════════════════════════════════════════════ */
  function draftCheollik(m, opt) {
    opt = opt || {};
    var seam = normSeam(opt.seam);
    var g = geom(m, opt);
    var pieces = [], warnings = [];

    function mk(id, name, edges, grain, notches, internal, cutCount) {
      var loop = edgesToLoop(edges), sm = buildSeamline(loop, seam);
      fixNotches(notches, loop.pts);
      return { id: id, name: name, cutCount: cutCount || 2, kind: 'bodice', grainline: grain,
        outline: loop.pts, seamline: sm.seamline, foldEdges: sm.foldEdges,
        seamEdges: sm.seamEdges, seamFoldEdges: sm.seamFoldEdges, seamByRole: sm.seamByRole,
        edges: withSeam(loop.ranges, sm.edgeSeam), internal: internal || [],
        notches: notches || [], bbox: bboxOf(loop.pts) };
    }
    /** 주름 표시 — 치마 허리선에 접는 자리를 그린다 (제도선).
     *  ⚠ 표시가 아니라 **접는 양**이 중요하다. 표시 폭 = 주름분 그대로다. */
    function pleatMarks(pl, y, id) {
      var out = [], h = K.pleatMarkH;
      for (var i = 0; i < pl.n; i++) {
        var x0 = pl.edge + i * pl.step;
        out.push(L(id + i, 'edge', [[x0, y], [x0, y + h], [x0 + pl.depth, y + h],
                                    [x0 + pl.depth, y], [x0, y]], '주름'));
        out.push(L(id + 'd' + i, 'dashed', [[x0, y + h], [x0 + pl.depth, y]], '접는 방향'));
      }
      return out;
    }

    /* ══ ①② 프린세스 몸판 **4장** — 뒷면 · 뒷옆면 · 앞옆면 · 앞면 ══════
       기본형의 뒷판/앞판을 절개선으로 가른 것이다. 절개선은 두 조각이 **같은
       곡선**을 공유하므로(다트 회전이 없다) 짝 길이는 작도로 보장된다.
       너치는 진동선·중간 높이에 짝으로 찍는다 — 봉제할 때 맞출 자리다. */
    var nB = levelNotches(g.bPrin.segs, [0, g.bTotal], g.bPrin.segs, [g.bWaist[0], g.bTotal],
               [['진동선', g.bU[1]], ['중간', (g.bU[1] + g.bTotal) / 2]]);
    /* 앞 너치는 **BP** 에 찍는다 — 절개선이 BP 를 지나므로 봉제할 때 맞출 자리다 */
    var nF = levelNotches(g.fPrin.segs, [0, g.bTotal], g.fPrin.segs, [g.fWaistW, g.bTotal],
               [['진동선', g.fU[1]], ['BP', g.BP[1]]]);

    /* ① 뒷면 — 뒤중심이 **골선** (1매) */
    pieces.push(mk('back', '뒷면', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.bSNP, g.bPrin.top) },
      { name: '절개선',   role: 'princess', segs: g.bPrin.segs },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.bPrin.waist, g.bHem) },
      { name: '뒤중심',   role: 'fold',     segs: lineSegs(g.bHem, g.bBNP) },
      { name: '뒷목',     role: 'neck',     segs: revSegs(g.bNeckCv) }
    ], [[1.5, g.snpRise + 2.0], [1.5, g.bTotal - 2.0]],
      [{ p: cp(g.bSNP), angle: 90, label: '목옆점' }].concat(nB.a),
      [L('nkB', 'dashed', [[0, g.snpRise], [g.bNeckW, g.snpRise]], '뒷목선(기준)')], 1));

    /* ② 뒷옆면 — 진동이 붙는 쪽 (2매) */
    pieces.push(mk('backSide', '뒷옆면', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.bPrin.top, g.bSP) },
      { name: '진동',     role: 'armhole',  segs: g.bArm },
      { name: '옆선',     role: 'side',     segs: lineSegs(g.bU, g.bWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.bWaist, g.bPrin.waist) },
      { name: '절개선',   role: 'princess', segs: revSegs(g.bPrin.segs) }
    ], [[g.bPrin.mid[0] + 1.5, g.bU[1] - 4.0], [g.bPrin.mid[0] + 1.5, g.bTotal - 2.0]],
      [{ p: cp(g.bU), angle: 180, label: '겨드랑' }].concat(nB.b),
      [L('blB', 'dashed', [[g.bPrin.mid[0] + 0.3, g.bU[1]], [g.bU[0] - 0.5, g.bU[1]]], '진동선')]));

    /* ③ 앞옆면 — 진동이 붙는 쪽 (2매) */
    pieces.push(mk('frontSide', '앞옆면', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.fPrin.top, g.fSP) },
      { name: '진동',     role: 'armhole',  segs: g.fArm },
      { name: '옆선',     role: 'side',     segs: lineSegs(g.fU, g.fWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.fWaist, g.fPrin.waist) },
      { name: '절개선',   role: 'princess', segs: revSegs(g.fPrin.segs) }
    ], [[g.fPrin.mid[0] + 1.5, g.fU[1] - 4.0], [g.fPrin.mid[0] + 1.5, g.bTotal - 2.0]],
      [{ p: cp(g.fU), angle: 180, label: '겨드랑' }].concat(nF.b),
      [L('blF', 'dashed', [[g.fPrin.mid[0] + 0.3, g.fU[1]], [g.fU[0] - 0.5, g.fU[1]]], '진동선')]));

    /* ④ 앞면 — 앞중심 · V 목선 · 여밈이 붙는 쪽 (2매) */
    pieces.push(mk('front', '앞면', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.fSNP, g.fPrin.top) },
      { name: '절개선',   role: 'princess', segs: g.fPrin.segs },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.fPrin.waist, g.fCf) },
      { name: '앞중심',   role: 'center',   segs: lineSegs(g.fCf, g.fCfTop) },
      { name: 'V 목선',   role: 'neck',     segs: revSegs(g.vNeck) }
    ], [[g.fPrin.waist[0] - 3.0, g.fSP[1] + 2.0], [g.fPrin.waist[0] - 3.0, g.bTotal - 2.0]],
      [{ p: cp(g.fSNP), angle: 90, label: '목옆점' },
       { p: cp(g.vBot), angle: 0, label: 'V 바닥' }].concat(nF.a),
      [L('cfF', 'dashed', [[0, g.bTotal - 2.0], [0, g.vBot[1]]], '앞중심'),
       L('bodyF', 'dashed', [[g.bodyCf, g.fU[1]], [g.bodyCf, g.bTotal]], '몸 중심(여밈 끝에서 여밈분)'),
       L('bpF', 'edge', [[g.BP[0] - 0.6, g.BP[1]], [g.BP[0] + 0.6, g.BP[1]]], 'BP'),
       L('bpF2', 'edge', [[g.BP[0], g.BP[1] - 0.6], [g.BP[0], g.BP[1] + 0.6]], 'BP')]));

    /* ══ ③ 긴소매 — **소매산이 위 · 수구가 아래** ═══════════════════
       제도는 교재대로 **눕혀서** 한다 — 소매산 꼭짓점이 왼쪽(x=0) · 수구가
       오른쪽(x=SL) · 소매산 높이만큼 들어온 자리(x=capH)가 가장 넓다(비셉).

       ★ 조각으로 낼 때 **+90° 강체 회전**해 세운다: (x,y) → (폭−y, x).
         det = +1 이라 **거울이 아니다** — 거울로 뒤집으면 소매 앞뒤가 바뀐다.
         회전 뒤 **앞이 왼쪽 · 뒤가 오른쪽**이다 (아래 변 이름과 맞춰 볼 것).
       ⚠ 2026-08-17 이전에는 −90° 로 돌려 **거꾸로** 서 있었고, 변 이름까지
         뒤바뀌어 있었다(굽은 끝=배래+수구 · 곧은 끝=진동). 그래서
         「소매 밑단 시접이 3.0 이 아니다」가 나왔다 — 사용자가 화면 보고 잡았다.
         판정 근거는 docs/철릭-소매-판정.md.
       ⚠ 너치 각은 fixNotches 가 재단선 법선에서 다시 잡는다 — **점만** 옮기면 된다.
       ⚠ 정답지(GT)는 **눕힌** 도면 좌표다 — engine-verify 가 되돌려 대조한다. */
    (function () {
      var SL = g.sleeveLen, wide = g.sleeveWideY, cuff = g.cuffW, capH = g.capH;
      var cy   = wide * g.capTipAt;                  // 소매산 꼭짓점 자리
      var top0 = (wide - cuff) / 2;                  // 수구 위끝 y
      var A = [SL, top0], Bp = [SL, top0 + cuff];    // 수구 (오른쪽 변)
      var Tw = [capH, 0], Bw = [capH, wide];         // 가장 넓은 자리 (비셉)
      var Cu = [0, cy - g.capTipW / 2], Cl = [0, cy + g.capTipW / 2];   // 소매산 꼭짓점
      function up(p) { return [wide - p[1], p[0]]; } // 눕힌 제도 → 세운 조각 (+90°)
      function upS(segs) { return mapSegs(segs, up); }
      var mid0 = [0, cy], mid1 = [SL, top0 + cuff / 2];   // 소매 중심선 (소매산 ↔ 수구)
      function onMid(t) { return [mid1[0] + (mid0[0] - mid1[0]) * t,
                                  mid1[1] + (mid0[1] - mid1[1]) * t]; }
      pieces.push(mk('sleeve', '긴소매', [
        { name: '뒤 밑선',     role: 'side',      segs: upS(lineSegs(A, Tw)) },
        { name: '소매산 (뒤)', role: 'armhole',   segs: upS(armCurve(Tw, Cu, K.capBack)) },
        { name: '소매산 꼭지', role: 'armhole',   segs: upS(armCurve(Cu, Cl, K.capTipB)) },
        { name: '소매산 (앞)', role: 'armhole',   segs: upS(armCurve(Cl, Bw, K.capFront)) },
        { name: '앞 밑선',     role: 'side',      segs: upS(lineSegs(Bw, Bp)) },
        { name: '수구',        role: 'sleeveHem', segs: upS(lineSegs(Bp, A)) }
      /* 식서는 **소매길이 방향** — 소매 중심선 위에 얹는다 (숙녀복기본원형1 소매와
         같은 규약). 눕힌 좌표에서 몸판처럼 「세로선」을 그으면 소매를 가로지른다. */
      ], [up(onMid(0.06)), up(onMid(0.94))],
        [{ p: up(mid1), angle: 180, label: '수구 중심' },
         { p: up(Tw), angle: 270, label: '소매 넓은 자리' },
         { p: up(mid0), angle: 0, label: '소매산 중심' }],
        [L('mid', 'dashed', [up(mid0), up(mid1)], '소매 중심선'),
         L('wideL', 'dashed', [up(Tw), up(Bw)], '가장 넓은 자리 (비셉)')]));
    })();

    /* ══ ④ 깃 — 한쪽 끝은 둥글고, 반대쪽은 동정 자리 직선 ════════════════ */
    (function () {
      var CL = g.collarLen, CW = num(opt.collarW, K.collarW);
      var r = K.collarRound;
      var top = [[0, 0], [CL, 0]];
      pieces.push(mk('collar', '깃', [
        { name: '깃 윗선',  role: 'neck', segs: lineSegs(top[0], top[1]) },
        { name: '깃 끝',    role: 'neck', segs: lineSegs([CL, 0], [CL, CW]) },
        /* 목붙임선 — 둥글리기 전까지 **직선**, 그 다음이 둥근 깃 끝 */
        { name: '목붙임선', role: 'neck', segs: lineSegs([CL, CW], [r, CW]) },
        { name: '깃 둥근끝', role: 'neck', segs: armCurve([r, CW], [0, 0.02], K.collarTipB) }
      ], [[CL * 0.5, CW * 0.25], [CL * 0.5, CW * 0.8]],
        [{ p: [CL - K.collarStraight, 0], angle: 90, label: '동정 끝' },
         { p: [r, CW], angle: 270, label: '둥글리기 시작' }],
        [L('dj', 'dashed', [[CL - K.collarStraight, 0], [CL - K.collarStraight, CW]], '동정 자리'),
         L('half', 'dashed', [[0, CW * 0.5], [CL, CW * 0.5]], '깃 중심')], 1));
    })();

    /* ══ ⑤⑥ 치마 — 허리에 **주름**을 잡아 몸판 허리폭에 맞춘다 ════════════ */
    function skirt(id, name, pl, cut) {
      var Wd = pl.skirtW, Ht = g.skirtLen;
      pieces.push(mk(id, name, [
        { name: '허리선', role: 'hem',  segs: lineSegs([0, 0], [Wd, 0]) },
        { name: '옆선',   role: 'side', segs: lineSegs([Wd, 0], [Wd, Ht]) },
        { name: '밑단',   role: 'hem',  segs: lineSegs([Wd, Ht], [0, Ht]) },
        { name: '앞중심', role: 'side', segs: lineSegs([0, Ht], [0, 0]) }
      ], [[Wd * 0.5, Ht * 0.15], [Wd * 0.5, Ht * 0.85]],
        [{ p: [pl.edge, 0], angle: 90, label: '주름 시작' },
         { p: [pl.edge + (pl.n - 1) * pl.step + pl.depth, 0], angle: 90, label: '주름 끝' },
         { p: [Wd * 0.5, Ht], angle: 270, label: '밑단 중심' }],
        pleatMarks(pl, 0, id + 'p').concat([
          L(id + 'wl', 'dashed', [[0, K.pleatMarkH], [Wd, K.pleatMarkH]], '주름 끝선')]), cut));
    }
    skirt('backSkirt', '뒷치마판', g.bPleat, 1);
    skirt('frontSkirt', '앞치마판', g.fPleat, 2);

    /* ══ ⑦ 고름 · 동정 — 도면에 없다. 한복 관례값 ═══════════════════════
       ★ 고름은 **폭을 두 배로 재단해 반 접는다** — 긴 변 하나가 골선이고,
         끝은 사선으로 자른다. 긴고름·짧은고름 한 쌍.
       ★ 동정은 깃 위에 덧대는 흰 띠다. 깃보다 짧고, 역시 반 접는다. */
    function strip(id, name, len, wFin, cut, label) {
      var W2 = wFin * 2;
      var edges = [
        { name: '골선',   role: 'fold', segs: lineSegs([0, 0], [len, 0]) },
        { name: '끝 사선', role: 'side', segs: lineSegs([len, 0], [len - cut, W2]) },
        { name: '아랫변', role: 'side', segs: lineSegs([len - cut, W2], [0, W2]) },
        { name: '다는 자리', role: 'side', segs: lineSegs([0, W2], [0, 0]) }
      ];
      if (cut <= 0.01) {                                   // 동정 — 사선이 없다
        edges = [
          { name: '골선',   role: 'fold', segs: lineSegs([0, 0], [len, 0]) },
          { name: '끝',     role: 'side', segs: lineSegs([len, 0], [len, W2]) },
          { name: '아랫변', role: 'side', segs: lineSegs([len, W2], [0, W2]) },
          { name: '다는 자리', role: 'side', segs: lineSegs([0, W2], [0, 0]) }
        ];
      }
      pieces.push(mk(id, name, edges,
        [[len * 0.5, W2 * 0.25], [len * 0.5, W2 * 0.8]],
        [{ p: [0, wFin], angle: 0, label: '다는 자리' },
         { p: [len * 0.5, W2], angle: 90, label: '중간' }],
        [L(id + 'f', 'dashed', [[0, wFin], [len, wFin]], '접었을 때 완성 폭 ' + f1(wFin)),
         L(id + 'e', 'point', [[0, wFin]], label)], 1));
    }
    var gLong = g.coatLen * num(opt.gorumLongF, K.gorumLongF);
    var gW = num(opt.gorumW, K.gorumW), gCut = num(opt.gorumCut, K.gorumCut);
    strip('gorumLong', '긴고름', gLong, gW, gCut, '앞판 깃 아래');
    strip('gorumShort', '짧은고름', Math.max(gLong - num(opt.gorumShortSub, K.gorumShortSub), gLong * 0.5),
          gW, gCut, '반대쪽 앞판');
    strip('dongjeong', '동정', g.collarLen * num(opt.dongjeongF, K.dongjeongF),
          num(opt.dongjeongW, K.dongjeongW), 0, '깃 위에 덧댄다');

    /* ───────── 계측 · 확인 ───────── */
    function SL2(s) { return sLen(s); }
    var bWaistW = g.bWaist[0], fWaistW = g.fWaist[0];
    /* 주름을 접으면 치마 허리가 몸판 허리와 같아져야 한다 — 이 옷의 핵심 제약 */
    [['뒷치마 주름', g.bPleat.skirtW - g.bPleat.n * g.bPleat.depth, bWaistW],
     ['앞치마 주름', g.fPleat.skirtW - g.fPleat.n * g.fPleat.depth, fWaistW]
    ].forEach(function (w) {
      if (Math.abs(w[1] - w[2]) > 0.05)
        warnings.push(w[0] + ' 접은 뒤 ' + r4(w[1]) + ' ≠ 몸판 허리 ' + r4(w[2]));
    });
    /* 소매 진동 ↔ 몸판 진동 — **같지 않은 것이 정상이다.** 도면에서도 소매 진동 30.22 에
       몸판 진동 합은 42 다. 한복은 소매를 진동 위쪽에만 붙이고 아래는 겨드랑(무)으로
       처리하기 때문이다. 소매가 진동보다 크거나(못 붙는다) 절반 아래면(너무 짧다) 잡는다. */
    /* 소매산이 몸판 진동에 붙는가 — **이세**로 본다 (0 미만이면 모자라서 못 붙는다).
       예전엔 「곧은 끝 / 몸판 진동」 비를 0.55~1.05 로 봤는데, 그 곧은 끝은
       진동이 아니라 수구였다 (2026-08-17 판정). */
    var ahAll = SL2(g.bArm) + SL2(g.fArm), capEase = g.capLen - ahAll;
    if (capEase < 0 || capEase > ahAll * 0.10)
      warnings.push('소매산 ' + r4(g.capLen) + ' / 몸판 진동 ' + r4(ahAll) +
                    ' — 이세 ' + r4(capEase) + ' (0 ~ 진동의 10% 여야 한다)');
    if (Math.abs(g.shLenBack - g.shLenFront) > 0.15)
      warnings.push('어깨 짝 ' + r4(g.shLenBack) + ' ↔ ' + r4(g.shLenFront));

    /* ★ 제도선은 **조각 안에 들어오는 구간만** 남긴다 (2026-08-15 · 조끼→원피스에서 이식).
       조각 밖 허공에 뜬 기준선은 화면에서 바로 눈에 띈다.
       ⚠ 자르는 것은 **기준선 계열(dashed·line·thin)** 뿐이다 — edge(다트·주름)와
         point(BP 표시)를 자르면 뜻이 깨진다(조끼에서 폭 1.5 다트가 0.199 로 잘렸다).
       ⚠ 선을 잘게 나눠 판정한다 — 점 2개짜리 기준선은 통째로 사라진다.
       ⚠ 경계 위의 점(어깨선 위 다트 다리 등)은 안쪽으로 친다. */
    pieces.forEach(function (pc) {
      var kept = [];
      (pc.internal || []).forEach(function (it) {
        /* ★ point(표시점 · BP·FNP·마크)는 선이 아니라 점이라 자를 수 없다 —
           **조각 밖에 있으면 그 조각의 것이 아니므로 버린다** (2026-08-15).
           BP 를 앞옆판에도 붙여 1.75cm 허공에 뜬 것 같은 자리다(조끼에서 겪은 유형).
           경계 0.05 안쪽이면 남긴다. */
        if (it.type === 'point') {
          var okPt = (it.pts || []).some(function (q) {
            if (ptInPoly(q, pc.outline)) return true;
            for (var i = 1; i < pc.outline.length; i++) {
              var a = pc.outline[i - 1], b = pc.outline[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
              var t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              if (Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)) <= 0.05) return true;
            }
            return false;
          });
          if (okPt) kept.push(it);
          return;
        }
        var CLIPT = { dashed: 1, line: 1, thin: 1 };
        if (!CLIPT[it.type] || !it.pts || it.pts.length < 2) { kept.push(it); return; }
        var dense = [], q0, a0, b0, L0, n0, t0;
        for (q0 = 1; q0 < it.pts.length; q0++) {
          a0 = it.pts[q0 - 1]; b0 = it.pts[q0]; L0 = V.dist(a0, b0);
          n0 = Math.max(1, Math.ceil(L0 / 0.1));
          for (t0 = 0; t0 < n0; t0++)
            dense.push([a0[0] + (b0[0] - a0[0]) * t0 / n0, a0[1] + (b0[1] - a0[1]) * t0 / n0]);
        }
        dense.push([it.pts[it.pts.length - 1][0], it.pts[it.pts.length - 1][1]]);
        function inside(q) {
          if (ptInPoly(q, pc.outline)) return true;
          for (var i = 1; i < pc.outline.length; i++) {
            var a = pc.outline[i - 1], b = pc.outline[i];
            var dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
            var t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            if (V.dist(q, [a[0] + t * dx, a[1] + t * dy]) <= 0.05) return true;
          }
          return false;
        }
        var run = null, runs = [];
        dense.forEach(function (q) {
          if (inside(q)) { if (!run) { run = []; runs.push(run); } run.push([q[0], q[1]]); }
          else run = null;
        });
        runs.forEach(function (r, i) {
          if (r.length < 2 || polyLen(r) < 0.2) return;
          kept.push({ id: it.id + (i ? '_' + (i + 1) : ''), type: it.type, pts: r, label: it.label });
        });
      });
      pc.internal = kept;
    });

    /* ★ 암홀 ↔ 소매산 **맞춤 너치** — 앞 1개 · 뒤 2개 (사용자 기준 2026-08-15
       「앞판 암홀에는 1개, 뒤판 암홀에는 2개를 넣고 소매산의 중심과 앞뒤를 맞춰
       소매를 연결합니다」). 개수가 곧 앞뒤 구분이다.
       ★ 자리는 **겨드랑에서 잰 호길이**다 — 소매산은 이세 때문에 몸판 암홀보다 길지만
         그 이세는 정수리 쪽에 배분되므로, 겨드랑 기준으로 같은 거리를 잡아야 짝이 맞는다.
         (비율로 잡으면 이세만큼 어긋난다.)
       ⚠ 소매가 없는 구성(민소매·조끼)에서는 몸판에만 남는다 — 그래도 안단·바이어스를
         맞추는 자리로 쓰인다. */
    (function () {
      function edgeInfo(pc, e) {
        var pts = pc.outline.slice(e.start === 0 ? 0 : e.start - 1, e.end + 1);
        if (pts.length < 3) return null;
        var acc = [0], i;
        for (i = 1; i < pts.length; i++) acc.push(acc[i - 1] + V.dist(pts[i], pts[i - 1]));
        return { pts: pts, acc: acc, L: acc[acc.length - 1] };
      }
      function atArc(inf, fromEnd, d) {          // 끝(fromEnd)에서 d 만큼 들어온 점
        var t = fromEnd ? inf.L - d : d, i;
        if (t <= 0 || t >= inf.L) return null;
        for (i = 1; i < inf.acc.length; i++) if (inf.acc[i] >= t) {
          var f = (t - inf.acc[i - 1]) / ((inf.acc[i] - inf.acc[i - 1]) || 1e-9);
          return [inf.pts[i - 1][0] + (inf.pts[i][0] - inf.pts[i - 1][0]) * f,
                  inf.pts[i - 1][1] + (inf.pts[i][1] - inf.pts[i - 1][1]) * f];
        }
        return null;
      }
      function put(pc, inf, fromEnd, d, label) {
        var __before = pc.notches.length;
        var q = atArc(inf, fromEnd, d); if (!q) return false;
        /* ⚠ 중복 방지는 **0.4cm** — 1.0 으로 두면 기존 너치(겨드랑·절개 시작) 곁이라는
           이유로 규칙 너치가 통째로 생략돼 「앞 0개·뒤 1개」가 됐다 (2026-08-15). */
        for (var k = 0; k < pc.notches.length; k++)
          if (V.dist(pc.notches[k].p, q) < 0.4) return true;
        var i, near = 0, tx = 0, ty = 0;
        for (i = 1; i < inf.pts.length; i++)
          if (V.dist(inf.pts[i], q) < V.dist(inf.pts[near], q)) near = i;
        var a = inf.pts[Math.max(0, near - 1)], b = inf.pts[Math.min(inf.pts.length - 1, near + 1)];
        tx = b[0] - a[0]; ty = b[1] - a[1];
        var tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
        function inP(px, py) {
          var c = false, o = pc.outline;
          for (var s2 = 0, t2 = o.length - 1; s2 < o.length; t2 = s2++) {
            var u = o[s2], v = o[t2];
            if ((u[1] > py) !== (v[1] > py) && px < (v[0] - u[0]) * (py - u[1]) / (v[1] - u[1]) + u[0]) c = !c;
          }
          return c;
        }
        if (!inP(q[0] + nx * 0.5, q[1] + ny * 0.5)) { nx = -nx; ny = -ny; }
        /* 양쪽 다 조각 밖이면 **넣지 않는다** — 틱이 허공에 뜨느니 없는 편이 낫다 */
        if (!inP(q[0] + nx * 0.5, q[1] + ny * 0.5)) return false;
        pc.notches.push({ p: q, angle: Math.atan2(ny, nx) * 180 / Math.PI, label: label });
        return pc.notches.length > __before;
      }
      /* 몸판 앞/뒤 암홀 · 소매산을 찾는다 (조각·변 이름은 모듈마다 다르다) */
      var armF = null, armB = null, capF = [], capB = [], armBAll = [];
      pieces.forEach(function (pc) {
        /* ⚠ **안단·안감은 제외** — 소매를 거기 달지 않는다. V네크라인 암홀 안단에
           소매맞춤이 들어가 몸판과 좌표가 어긋난다고 잡혔다 (2026-08-15). */
        if (/안단|안감|facing|lining/i.test(pc.name || '') || /Facing|Lining/.test(pc.id || '')) return;
        var isSleeve = /소매/.test(pc.name || '');
        (pc.edges || []).forEach(function (e) {
          var nm = (e.name || ''), isArm = e.role === 'armhole' || /암홀|진동|소매산/.test(nm);
          if (!isArm) return;
          var inf = edgeInfo(pc, e); if (!inf || inf.L < 6) return;
          var isBack = /뒤|뒷|back/i.test(nm) || /뒤|뒷|back/i.test(pc.name || '');
          if (isSleeve) { (isBack ? capB : capF).push({ pc: pc, inf: inf }); }
          else if (isBack) { var cand = { pc: pc, inf: inf }; armBAll.push(cand);
                             if (!armB || inf.L > armB.inf.L) armB = cand; }
          else { if (!armF || inf.L > armF.inf.L) armF = { pc: pc, inf: inf }; }
        });
      });
      /* 겨드랑 = 암홀 변의 두 끝 중 **아래쪽**(y 가 큰 쪽) */
      function fromEndOf(inf) { return inf.pts[inf.pts.length - 1][1] > inf.pts[0][1]; }
      var dF = armF ? Math.min(armF.inf.L * 0.40, 10) : 0;
      var dB = armB ? Math.min(armB.inf.L * 0.45, 11) : 0;
      var GAP2 = 1.2;                                   // 뒤 두 번째 너치 간격
      /* 한 자리가 막히면(기존 너치 곁) **조금 옮겨서 다시** 시도한다 — 규칙 개수를
         채우는 것이 우선이다. 0.6cm 씩 최대 6번 민다. */
      function putTry(t, base, label) {
        if (!t) return false;
        for (var k = 0; k < 7; k++) {
          if (put(t.pc, t.inf, fromEndOf(t.inf), base + k * 0.6, label)) return true;
          if (base - k * 0.6 > 1 && put(t.pc, t.inf, fromEndOf(t.inf), base - k * 0.6, label)) return true;
        }
        return false;
      }
      putTry(armF, dF, '소매맞춤');
      putTry(armB, dB, '소매맞춤');
      /* ⚠ 암홀이 **두 조각으로 갈린** 구조(토르소·바재킷)에서는 긴 변에 둘 다 못 들어갈
         수 있다 — 그럴 땐 다른 뒤 암홀 변에도 시도해 규칙 개수(뒤 2개)를 채운다. */
      if (!putTry(armB, dB + GAP2, '소매맞춤'))
        armBAll.forEach(function (t) { if (t !== armB) putTry(t, dB, '소매맞춤'); });
      /* ★ 개수로 앞뒤를 구분해야 한다 — 모듈이 원래 갖고 있던 맞춤 너치까지 세어
         **뒤가 앞보다 많지 않으면** 뒤에 하나 더 넣는다 (사용자 기준의 핵심).
         토르소는 앞뒤 모두 「암홀 1/3·2/3」를 갖고 있어 3:3 이 됐다. */
      function cntArm(t) {
        if (!t) return 0;
        var c = 0;
        (t.pc.notches || []).forEach(function (n) {
          if (!/소매맞춤|앞 맞춤|뒤 맞춤|암홀 \d\/\d/.test(n.label || '')) return;
          var bd = Infinity;
          for (var i = 0; i < t.inf.pts.length; i++) {
            var dd = V.dist(n.p, t.inf.pts[i]); if (dd < bd) bd = dd;
          }
          if (bd <= 0.06) c++;
        });
        return c;
      }
      var nF = cntArm(armF), nB = 0;
      armBAll.forEach(function (t) { nB += cntArm(t); });
      for (var tryK = 0; nB <= nF && tryK < 5; tryK++) {
        if (!putTry(armB, dB + GAP2 + (tryK + 1) * 0.8, '소매맞춤')) break;
        nB = 0; armBAll.forEach(function (t) { nB += cntArm(t); });
      }
      capF.forEach(function (c) { if (dF) putTry(c, dF, '소매맞춤'); });
      capB.forEach(function (c) {
        if (!dB) return;
        putTry(c, dB, '소매맞춤');
        putTry(c, dB + GAP2, '소매맞춤');
      });
    })();

    /* ★ 긴 변에는 **맞춤 너치**를 넣는다 (사용자 지정 2026-08-15
       「너치 간격이 30cm 을 넘으면 추가해줘」). 원피스 옆선 80cm 에 너치가 위쪽에만
       둘 있어 아래 63cm 구간을 맨눈으로 맞춰야 했다.
       ★ **균등 분할**이라야 짝이 맞는다 — 앞뒤 옆선은 길이가 같으므로 같은 자리에
         생긴다. 「30cm 마다 하나」식으로 끝에서부터 세면 짝이 어긋난다.
       ⚠ 맞출 짝이 있는 변만 — 옆선·절개선·어깨·진동. 밑단(접는다)·중심(골선/여밈)은
         제외한다. 기존 너치와 2cm 안쪽이면 넣지 않는다(같은 자리에 둘이 되면 헷갈린다). */
    var NOTCH_MAX_GAP = 30;
    pieces.forEach(function (pc) {
      (pc.edges || []).forEach(function (e) {
        /* ★ center 도 대상이다 — 등솔선·앞여밈은 **좌우를 꿰매는 봉제선**이라
           너치가 필요하다 (사용자 지적 2026-08-15 「여기 너치 없잖아」 · 조끼 뒤중심 51cm).
           제외할 것은 **골선**뿐이다 — 접는 선이라 맞출 상대가 없다(시접 0 으로 구분). */
        if (!/^(side|princess|shoulder|armhole|center)$/.test(e.role || '')) return;
        if (e.role === 'center' && !(e.seam > 0)) return;      // 골선은 제외
        var pts = pc.outline.slice(e.start === 0 ? 0 : e.start - 1, e.end + 1);
        if (pts.length < 3) return;
        var acc = [0], i;
        for (i = 1; i < pts.length; i++) acc.push(acc[i - 1] + V.dist(pts[i], pts[i - 1]));
        var L = acc[acc.length - 1];
        if (L <= NOTCH_MAX_GAP) return;
        var have = [];
        (pc.notches || []).forEach(function (n) {
          var bd = Infinity, at = 0;
          for (i = 0; i < pts.length; i++) {
            var dd = V.dist(n.p, pts[i]); if (dd < bd) { bd = dd; at = acc[i]; }
          }
          if (bd <= 0.06) have.push(at);
        });
        var parts = Math.ceil(L / NOTCH_MAX_GAP);      // 구간 수 (균등)
        for (var k = 1; k < parts; k++) {
          var target = L * k / parts, near = false;
          for (i = 0; i < have.length; i++) if (Math.abs(have[i] - target) < 2.0) near = true;
          if (near) continue;
          for (i = 1; i < acc.length; i++) if (acc[i] >= target) {
            var f = (target - acc[i - 1]) / ((acc[i] - acc[i - 1]) || 1e-9);
            /* ★ 각도를 **여기서** 정한다 — angle 0 으로 넣고 뒤처리에 맡기면, 보정이
               없거나 이미 지나간 모듈에서 틱이 조각 밖으로 나간다 (2026-08-15).
               변의 법선 중 **무게중심 쪽**이 조각 안이다. */
            var qx = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
            var qy = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
            var tx = pts[i][0] - pts[i - 1][0], ty = pts[i][1] - pts[i - 1][1];
            var tl = Math.hypot(tx, ty) || 1, nx2 = -ty / tl, ny2 = tx / tl;
            /* ⚠ 무게중심은 **가늘고 굽은 조각**(앞 안단)에서 조각 밖에 있다 —
               실제로 틱이 밖으로 나갔다. 점이 안인지로 직접 판정한다 (2026-08-15). */
            function inP(px2, py2) {
              var c2 = false, o2 = pc.outline;
              for (var a2 = 0, b2 = o2.length - 1; a2 < o2.length; b2 = a2++) {
                var u = o2[a2], v = o2[b2];
                if ((u[1] > py2) !== (v[1] > py2) &&
                    px2 < (v[0] - u[0]) * (py2 - u[1]) / (v[1] - u[1]) + u[0]) c2 = !c2;
              }
              return c2;
            }
            if (!inP(qx + nx2 * 0.5, qy + ny2 * 0.5)) { nx2 = -nx2; ny2 = -ny2; }
            pc.notches.push({ p: [qx, qy], angle: Math.atan2(ny2, nx2) * 180 / Math.PI, label: '맞춤' });
            break;
          }
        }
      });
    });

    return {
      pieces: pieces, warnings: warnings, notes: [],
      measures: {
        bust: r4(g.B), waist: r4(g.W),
        backLen: r4(g.backLen), skirtLen: r4(g.skirtLen), coatLen: r4(g.bTotal + g.skirtLen),
        BL: r4(g.bU[1]),
        backWaistW: r4(bWaistW), frontWaistW: r4(fWaistW),
        backSkirtW: r4(g.bPleat.skirtW), frontSkirtW: r4(g.fPleat.skirtW),
        backPleats: g.bPleat.n, frontPleats: g.fPleat.n,
        pleatDepth: r4(g.bPleat.depth), pleatStep: r4(g.bPleat.step),
        pleatDepthBack: r4(g.bPleat.depth), pleatDepthFront: r4(g.fPleat.depth),
        shoulderBack: r4(g.shLenBack), shoulderFront: r4(g.shLenFront),
        shoulderBackSewn: r4(g.shLenBack), shoulderFrontSewn: r4(g.shLenFront),
        shoulderEase: 0,
        armholeBack: r4(SL2(g.bArm)), armholeFront: r4(SL2(g.fArm)),
        armholeTotal: r4(SL2(g.bArm) + SL2(g.fArm)),
        neckBack: r4(sLen(g.bNeckCv)),
        neckFront: r4(sLen(g.vNeck)),
        neckTotal: r4(sLen(g.bNeckCv) + sLen(g.vNeck)),
        sideBack: r4(V.dist(g.bU, g.bWaist)), sideFront: r4(V.dist(g.fU, g.fWaist)),
        sleeveLen: r4(g.sleeveLen), sleeveWide: r4(g.sleeveWideY), cuffW: r4(g.cuffW),
        sleeveCap: r4(g.capLen), sleeveCapH: r4(g.capH),
        sleeveCapEase: r4(g.capLen - (SL2(g.bArm) + SL2(g.fArm))),
        collarLen: r4(g.collarLen),
        gorumLong: r4(g.coatLen * num(opt.gorumLongF, K.gorumLongF)),
        gorumShort: r4(g.coatLen * num(opt.gorumLongF, K.gorumLongF) - num(opt.gorumShortSub, K.gorumShortSub)),
        gorumW: r4(num(opt.gorumW, K.gorumW)),
        dongjeongLen: r4(g.collarLen * num(opt.dongjeongF, K.dongjeongF)),
        pieceCount: pieces.length
      },
      meta: {
        title: '철릭 프린세스',
        source: '원본 도면 `철릭프린세스.dxf` (66호반) 를 읽어 공식화',
        sizeName: sizeNameOf(m), m: m, geom: g, warnings: warnings, notes: [],
        formulaNotes: formulaNotes(m, g), seam: seam
      }
    };
  }

  function formulaNotes(m, g) {
    return [
      FN('cb',    '뒤중심',   '등길이 − ' + f1(K.cbSub) + ' (허리~뒷목점)', g.cbLen, 'back', [1.2, g.bTotal * 0.5]),
      FN('bneck', '뒷목둘레', 'B/12 + ' + f1(K.backNeckAdd) + ' · **곡선**(현에서 0.122 안쪽)',
                  sLen(g.bNeckCv), 'back', [g.bNeckW * 0.5, g.snpRise + 1.6]),
      FN('bsh',   '어깨선',   '어깨점 x = 어깨너비/2 · 기울기 ' + f1(K.shSlope), g.shLenBack, 'back',
                  [(g.bSNP[0] + g.bSP[0]) / 2, (g.bSNP[1] + g.bSP[1]) / 2 + 1.2]),
      FN('bar',   '진동깊이', 'B/4 − ' + f1(K.armDepthSub) + ' (뒷목선에서)', g.armDepth, 'back',
                  [g.bU[0] - 4.0, g.bU[1] - 2.0]),
      FN('bw',    '뒤 허리폭', 'B/4 + ' + f1(K.bWaistAdd), g.bWaist[0], 'back', [g.bWaist[0] * 0.5, g.bTotal - 1.4]),
      FN('fw',    '앞 허리폭', 'B/4 + **여밈분** ' + f1(K.frontWrap), g.fWaist[0], 'front',
                  [g.fWaist[0] * 0.5, g.bTotal - 1.4]),
      FN('vn',    'V 네크라인', '앞중심 위 ' + f1(K.vNeckDrop) + ' → 목옆점까지 **한 줄기 곡선**',
                  sLen(g.vNeck), 'front', [(g.vBot[0] + g.fSNP[0]) / 2 - 3.0, (g.vBot[1] + g.fSNP[1]) / 2]),
      FN('bpl',   '뒷치마 주름', '주름분 ' + f1(K.pleatDepthB) + ' × ' + g.bPleat.n + '개 · 간격 ' + f1(K.pleatStep),
                  g.bPleat.skirtW, 'backSkirt', [g.bPleat.skirtW * 0.5, 8.0]),
      FN('fpl',   '앞치마 주름', '주름분 ' + f1(K.pleatDepthF) + ' × ' + g.fPleat.n + '개 · 간격 ' + f1(K.pleatStep),
                  g.fPleat.skirtW, 'frontSkirt', [g.fPleat.skirtW * 0.5, 8.0]),
      FN('slv',   '소매',     '소매산 = **몸판 진동 × (1 + 이세 ' + f1(K.capEase) + ')** · ' +
                  '산높이 = 소매길이 × ' + f1(K.capHAt) + ' · 수구 = 소매폭 × ' + f1(K.cuffRatio),
                  /* 소매는 세워서 낸다 — 폭이 x, 길이가 y (위 ③ 참고) */
                  g.sleeveLen, 'sleeve', [g.sleeveWideY * 0.5, g.sleeveLen * 0.5]),
      FN('col',   '깃',       '길이 = 깃 길이 · 너비 ' + f1(K.collarW), g.collarLen, 'collar',
                  [g.collarLen * 0.35, K.collarW * 0.4]),
      FN('gorum', '고름',     '**도면에 없다 · 관례** 길이 = 총장 × ' + f1(K.gorumLongF) +
                  ' · 완성폭 ' + f1(K.gorumW) + ' (재단은 ×2, 반 접는다)',
                  g.coatLen * K.gorumLongF, 'gorumLong', [g.coatLen * K.gorumLongF * 0.3, K.gorumW * 0.6]),
      FN('dj',    '동정',     '**도면에 없다 · 관례** 길이 = 깃 × ' + f1(K.dongjeongF) +
                  ' · 완성폭 ' + f1(K.dongjeongW), g.collarLen * K.dongjeongF, 'dongjeong',
                  [g.collarLen * K.dongjeongF * 0.3, K.dongjeongW * 0.6])
    ];
  }
  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }

  return {
    measuresForSize: measuresForSize,
    draftCheollik: draftCheollik, draft: draftCheollik, geom: geom,
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
