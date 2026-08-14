/* ============================================================================
 * 조끼 — 제도 엔진 (백영례 번호점 제도법)
 *
 *   제도법 문서: docs/조끼-제도법-백영례.md
 *   ★ 이 모듈에는 **DXF/PDF 정답지가 없다.** 원문 도면 이미지만 있다.
 *     그래서 검산은 ① 원문이 시키는 「확인하라」 8항목 ② 스위트 공통 조각 품질
 *     ③ 도면 이미지와의 **눈 대조**로 한다.
 *
 *   ⚠ 원문 도면은 **90° 눕혀** 그려져 있다 — 「내려온다」가 그림에서는 왼쪽이다.
 *     이 엔진은 스위트 표준 좌표계를 쓴다: x = 폭(중심 0 → 옆선 +) · y = 길이(목 0 → 밑단 +).
 *
 *   ★ 뒤판을 먼저 그리고 **복사해서** 앞판을 그린다 (원문 방식 그대로).
 *     앞판은 뒤판과 번호만 다르고 구조가 1:1 대응이다:
 *       36↔67(다트 끝) · 35↔66(다트 중심 밑단) · 38·39↔73·74 · 40↔65 · 30↔58
 *
 *   ★ **다트는 다이아몬드**다. W선에서 벌어져 36번(H선 위 5)에서 모였다가
 *     밑단까지 **다시 벌어진다** — 이게 치마폭을 만든다. 밑단 옆선(40)은 그
 *     벌어진 만큼 밖으로 나간다.
 *
 *   ⚠ 원문 본문의 오류 4건은 도면을 따랐다 (문서 §「도면을 세우고 나서」 참고):
 *     ① H선 여유 1.5 → **1**  ② 12번 괄호 22.5 → 식대로 **23.0**
 *     ③ [37] 66번 → **67번**  ④ 소매 24번 「밖으로」 → **안쪽**
 *
 *   조각 5장 — 뒤판 · 앞판 · 소매 (+ 다트는 조각 안의 제도선)
 *
 * 노출: window.VestEngine / module.exports
 * ==========================================================================*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.VestEngine = api; }
  else if (root) root.VestEngine = api;
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
  function _lerp2(a, b) { return _lerp(a, b, 0.5); }   // 2등분점 — 원문의 「2등분하여」
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
   * 2. 치수 · 호수 (원문 55 Size 기준 · 호수별 등급)
   * ════════════════════════════════════════════════════════════════ */
  /* 원문 필요치수(55 Size)를 그대로 BASE 로 둔다. 66호가 기준인 다른 모듈과 달리
     이 제도법은 **55 Size 로 설명**하므로 SIZE_STEP 의 0 을 55호에 둔다. */
  var BASE  = { B: 84, 유B: 86, W: 68, H: 90, backLen: 38, shoulderW: 38,
                backW: 34, frontW: 32, bustLen: 25, bustW: 16,
                sleeveLen: 56, hipLen: 19, dressLen: 100, sleeveW: 33.5 };
  var GRADE = { B: 4.0, 유B: 4.0, W: 4.0, H: 4.0, backLen: 1.0, shoulderW: 1.0,
                backW: 1.0, frontW: 1.0, bustLen: 0.5, bustW: 0.5,
                sleeveLen: 1.0, hipLen: 0.0, dressLen: 1.5, sleeveW: 1.0 };
  var SIZE_STEP = { '44호': -1, '55호': 0, '66호': 1, '77호': 2, '88호': 3 };
  var MEAS_KEYS = ['B', '유B', 'W', 'H', 'backLen', 'shoulderW', 'backW', 'frontW',
                   'bustLen', 'bustW', 'sleeveLen', 'hipLen', 'dressLen', 'sleeveW'];
  var MEAS_LABEL = {
    B: '상동(윗가슴둘레)', 유B: '유상동(젖가슴둘레)', W: '중동(허리둘레)', H: '하동(엉덩이둘레)',
    backLen: '등길이', shoulderW: '어깨너비', backW: '등품', frontW: '앞품',
    bustLen: '유장', bustW: '유폭', sleeveLen: '소매길이', hipLen: '엉덩이길이',
    dressLen: '조끼길이', sleeveW: '소매통'
  };
  function measuresForSize(sizeName) {
    var s = SIZE_STEP[sizeName];
    if (s === undefined) s = 0;
    var m = {};
    MEAS_KEYS.forEach(function (k) { m[k] = Math.round((BASE[k] + GRADE[k] * s) * 100) / 100; });
    return m;
  }
  /** 유차 — 원문 [11] 참고: B 90 미만 2.5 · 90 이상 2.8 */
  function bustDiffOf(B) { return B >= 90 ? 2.8 : 2.5; }
  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도 상수 — 전부 원문 단계 번호를 달았다
   *    「식」이 있는 것은 식으로, 「2~2.5」처럼 폭이 있는 것은 중간값을 기본으로.
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;
  var K = {
    /* ── 조끼 기본선 [1]~[5] ─────────────────────────────────── */
    armDepthAdd :  1.5,   // [2] 진동선 = B/4 + 이 값 (22.5)
    cbIn        :  1.5,   // [5] 4·5·3 에서 1.5 나간 곳 = 7·8·9
    /* ── 뒤판 [6]~[19] ───────────────────────────────────────── */
    chestEase   :  1.75,  // [7] 13 = 유B/4 + 1.5~2
    hipEase     :  1.5,   // [8] 16 = 15 + 여유 1.5
    waistEase   :  1.75,  // [9] 18 = 17 + 여유 1.5~2
    backDart    :  2.25,  // [9] 19 = 18 + 다트분 2~2.5
    shDart      :  1.5,   // [10] 21 = 20 + 다트 1.5
    shSlope     :  1.4,   // [10] 22 = 12 에서 어깨기울기 1.3~1.5
    shScoop     :  1.5,   // [12] 26 = 21 에서 안으로 1.5
    armFromBW   :  0.75,  // [13] 암홀이 27 에서 0.5~1 떨어진다
    splitIn     :  2.5,   // [14] 28 = 11 에서 2~3 안쪽
    hemUp       :  5.0,   // [14] 30 = 29 에서 5 · [27] 62 = 59 에서 5
    mpAt        :  0.55,  // [17] 35 = 암홀 위 MP 자리 (26~11 비율)
    mpBack      :  0.65,  // [17] MP 0.5~0.8
    neckOut     :  1.5,   // [18] 38 = 24 에서 1.5
    shDartLen   :  7.0,   // [19] 40 = 다트길이 7
    /* ── 앞판 [20]~[40] ─────────────────────────────────────── */
    frontShDrop :  4.5,   // [21] 48 = 47 에서 4.5 아래
    fNeckDrop   :  1.0,   // [22] 51 = 50 에서 1 내려온 곳
    fShScoop    :  1.5,   // [23] 52 = 20 에서 1.5 내려온 곳
    fNeckOut    :  1.5,   // [23] 53 = 51 에서 1.5 나간 곳
    bpOut       :  1.75,  // [26] 58 = 57(BP) 에서 1.5~2
    frontDart   :  2.5,   // [27] 앞다트분 2~3
    fSplitDrop  :  1.5,   // [28] 67 — 69(46~48 2등분) 위로 올라가면 안 된다
    frontDrop   :  2.5,   // [38] 70 = 3 에서 앞처짐 2.5
    frontWrap   :  2.0,   // [38] 앞여밈분 — 얇은 원단 2 · 두꺼운 2.5
    frontArmGap :  0.5,   // [25] 앞암홀이 49(앞품)에서 0.5 떨어진다
    splitPanels :  1      // 1 = 암홀라인 절개 4조각
  };
  var K_OLD = {
    /* ── 기본선 [1]~[5] ─────────────────────────────────────────── */
    cbIn        : 1.5,    // 뒤중심 들임 — 6·7·3 번에서 1.5 나간 곳 [5]
    /* ── 뒤판 옆선 [7]~[9] ──────────────────────────────────────── */
    underarmAdd : 1.5,    // 겨드랑 = 유B/4 + 이 값 [7]
                          //  ⚠ 원문 괄호는 22.5 지만 식(유B/4+1.5=23.0)이 맞다. 도면 라벨도 식.
    waistEase   : 1.5,    // W 여유 [8]
    hipEase     : 1.0,    // H 여유 — **도면 `↑1`** (본문은 1.5) [9]
    backDart    : 2.25,   // 뒤 W 다트분 (2~2.5) [8]
    /* ── 목·어깨 [11]~[14] ─────────────────────────────────────── */
    shDrop      : 2.0,    // 어깨 기울기 — 어깨/2 자리에서 내려오는 양 [12]
    shDart      : 1.5,    // 어깨 다트분 [14]
    /* ── 등품·암홀 [15][16][27] ────────────────────────────────── */
    princessOut : 2.25,   // 28번에서 나가는 양 (2~2.5) → 29번 [16]
    armFromBW   : 1.0,    // 암홀선이 등품선(42)에서 떨어지는 거리 [27]
    /* ── 뒤 다트 [18]~[20] ─────────────────────────────────────── */
    dartFromCB  : 8.5,    // 9번에서 나가는 양 (8~9) → 32번 [18]
                          //  안으로 들어올수록 타이트 · 밖으로 나갈수록 여유
    dartTipUp   : 5.0,    // 다트 끝 = H선에서 위로 [20]
    /* ── 앞판 [30]~[38] ────────────────────────────────────────── */
    frontShDrop : 4.8,    // 앞 어깨 기울기 — 앞품선에서 아래로 [32]
    neckDrop1   : 1.0,    // 기본목 53 에서 내려오는 양 → 54 [31]
    /* 앞목선 통과점 = (목너비, 목깊이) 대각선의 이 비율 자리.
       원문은 비율을 안 준다([43] 「암홀자로 기본 앞목선」).
       ★ 0.62 였는데 **틀렸다** — 사용자가 도면 위에 그려 준 곡선은 앞중심 쪽에서
         **폭의 60% 가까이 평평하게** 가다가 목옆점에서 확 올라가는 **둥근 목선**이다.
         0.62 는 평평 구간이 24% 뿐이라 사선처럼 보인다. 0.80 이면 57%.
       원문 [42] 의 「75번 → 직선으로 76번 보조선」이 그 가로 보조선이고,
       곡선은 76~54 직선과 함께 **L 자 두 변에 접한다**(도면의 곡자 작도). */
    neckEndMix  : 0.0,    // 앞목선 끝접선 = 어깨선 직각 ↔ 세로 사이 (0 직각 · 1 세로)
    neckAnchor  : 0.70,
    neckStraight: 0.38,   // 앞목선 54 쪽 직선 구간 — 54~75 현의 비율 [42] 76 보조선
    neckStartTilt: 0.8,   // 그 직선의 출발각을 앞중심 쪽으로 눕히는 각(도) — 도면 108.43° vs 어깨직각 107.57°
    neckDeepAdd : 0.5,    // 앞목 깊이 = B/12 + 이 값 [42]
    bpOut       : 1.75,   // BP 에서 나가는 양 (1.5~2) → 60 [34]
    frontWEase  : 1.5,    // 앞 W 여유 [36]
    frontDrop   : 2.0,    // 앞처짐 — 3번에서 아래로 [37]
    frontArmIn  : 0.3,    // 앞 암홀 보조 (0.3) [40]
    frontArmAt  : 0.45,   // 78번 자리 — 56 에서 진동선까지의 비율 [44]
    frontArmPerp: 0.55,   // 앞 암홀 출발 접선 — 1 이면 어깨에 직각(각짐) · 0 이면 통과점 직행
    frontPrinOut: 0.3,    // [40] 58~70 구간이 71번에서 밖으로 부푸는 양
    frontArmGap : 0.4,    // 앞 암홀이 78번에서 떨어지는 양 (0.3~0.5) [45]
    /* ── 소매 ──────────────────────────────────────────────────── */
    capDiv      : 3,      // 소매산 = AH / 이 값 (capFromAH 를 켰을 때만)
    capAdd      : 0,      // 소매산 가감 — 원문 「소매통이 넓으면 0.5~1 올린다」
    capFromAH   : 0,      // 1 이면 소매산 = AH/3 고정 · 0 이면 소매통에서 역산(기본)
    sleeveWBase : 33.5,   // 소매통 목표 — 원문 55~66 = 33~34
    sleeveWBig  : 2.0,    // B 92 이상이면 +2 (원문 77~88 = 35~36)
    sleeveCtrIn : 1.5,    // 정점 6 에서 앞쪽으로 → 소매중심선 9 [5]
    elbowAdd    : 2.25,   // 12번에서 소매산 쪽으로 (2~2.5) → EL [6]
    capFrontOut : 4.5,    // 5번에서 나가는 양 → 15 [7]
    capEaseFront: 0.30,   // 앞 소매산 = 앞AH + 이 값 — **곡선의 휨으로** 만든다
    capFrontIn  : 4.5,   // 9번에서 들어오는 양 (4.5~5) → 16 [7]
    capBackIn   : 4.0,    // 7번에서 들어오는 양 → 19 [8]
                          //  ⚠ opt 로 주면 그 값을 쓰고, 안 주면 이세에서 역산한다
    capBackOut  : 4.5,    // 6번에서 나가는 양 → 20 [8] (도면)
    cuffW       : 24.0,   // 55 Size 기준 [10]
    cuffGrade   : 0.5,    // 호당 증가 — 원문 자켓 표(26·26·27·27·28)에서 읽는다   // 소매부리 [10]  (자켓이면 26)
    sleeveSeamBow: 0.35,  // 솔기가 팔꿈치에서 안쪽으로 부푸는 양 — 도면은 거의 곧다
    cuffDrop    : 0.5,
    cuffPerpK   : 0.45,   // 부리선이 솔기와 직각으로 만나는 정도 (1.0 이면 모서리에 고리)    // 23·24 를 내려 부리를 곡선으로 [15]
    mpBelowEL   : 1.0,    // EL 에서 아래로 → 25 (MP 분량선) [14]
    ctrTwist    : 1.25,   // 10번에서 안쪽으로 (반인치) → 26 · 중심선 틀기 [15]
    sleeveEase  : 0.5,    // 앞 솔기 + 이 값 = 뒤 솔기 (■ 표시) [15]
    /* ── 두 장 소매 (원문에 없다 — 정답지 모듈의 작도를 따른다) ──────── */
    twoSideOff  : 3.0,    // 큰소매 앞에서 떼어 작은소매 뒤에 붙이는 **현 길이**
    twoSplitAt  : 0.5,    // 절개점 높이 = 소매산 × 이 값
    twoSplitGap : 0,      // 큰·작은 절개점 간격 — 0 이면 소매산 총길이가 그대로 보존된다
    twoSeamBulge: 0.02,   // 절개선이 팔꿈치에서 바깥으로 부푸는 양 (소매통 비율)
    twoSeamMix  : 0.65,   // 절개선 출발접선 = 소매산 접선 ↔ 세로 사이 (0 소매산 · 1 세로)
    /* 0 = 통짜 2조각(원문 도면) · 1 = 프린세스 절개 4조각 */
    splitPanels : 0,
    /* 밑단이 옆선과 직각으로 만나는 정도. 1.0 이면 모서리에 고리가 생긴다 */
    hemPerpK    : 0.30,
    /* 밑단 43번을 현에서 직각으로 띄우는 양(현 길이 비율) — 원문 [28] 「44번에 곡자를 대고」.
       0 이면 통과점이 현 위에 있어 31cm 구간에서 0.17 밖에 안 휘어 직선처럼 보인다. */
    hemBow      : 0.022
  };
  var SLEEVE_TYPE = {
    one: { name: '한 장 소매 (원문)' },
    two: { name: '두 장 소매' }
  };
  var SLEEVE_TYPES = ['one', 'two'];

  var CAL = {
    /* 암홀 2도막 — k0 어깨쪽 · kA 접점 위 · kB 접점 아래 · k1 겨드랑쪽 */
    arm     : { k0: 1.20, kA: 1.10, kB: 1.50, k1: 1.80 },   // 뒤
    armF    : { k0: 0.35, kA: 1.60, kB: 1.60, k1: 1.60 },   // 앞 — 토르소프린세스 값
    neck    : { k0: 1.00, k1: 1.00 },
    princess: { k0: 1.05, k1: 1.15 },
    /* 소매산 끝접선 장력 — **이 제도법 전용**이다.
       숙녀복기본원형1 의 DXF 적합값(뒤 1.1487/1.8359 · 앞 0.9437/0.9742)을 그대로
       가져다 썼더니 이세가 2.5~3.8 로 부풀었다. **작도가 다르면 장력도 다르다**
       (여기는 통과점이 17·18·21 로 못 박혀 있고 저기는 마크+수선이다).
       정점을 9번으로 옮긴 뒤 다시 잡았다 — 전 호수 이세 **1.53~1.95**.
       앞 k1(정점 쪽)은 0.75 로 **올려야** 한다: 앞이 급경사가 되면서 정점에서 수평으로
       급히 꺾여 최대곡률이 정점에 0.63(반지름 1.6cm)으로 몰렸다. 0.75 로 풀면 0.55.

       ★ 도면과의 충돌 (사용자 결정 2026-08-14 · 원문 [9] 우선)
         고해상도 도면을 49.2 px/cm 로 보정해 실측하면 그려진 곡선은 대각선에서
         뒤 0.33 · 앞 0.45 밖에 안 휜다 → 그대로면 **이세가 0.15** 다.
         대각선은 정의상 앞AH·뒤AH 이므로(원문 [3][4]) 이것은 같은 도면에 적힌
         [9]「이세 1.5~2」와 정면으로 어긋난다. 도면의 곡선을 **모식도**로 보고
         숫자로 못 박힌 [9] 를 따른다 — 이세가 없으면 소매를 못 단다.
         **도면에서 잠그는 것은 「모양」(부호·교차·정점)이지 「크기」가 아니다.** */
    capBack : { k0: 0.408, k1: 0.653 },
    capFront: { k0: 0.394, k1: 0.600 },
    side    : { k0: 1.00, k1: 1.00 },
    /* 절개선 — k0 는 **작게**. 소매산 접선을 이어받되(각이 안 지게) 세게 주면
       절개점 바로 아래에서 3.5 나 밖으로 튄다(정답지 도면의 부풀림은 0.66). */
    twoSeam : { k0: 0.90, k1: 1.10 }
  };
  /* ══════════════════════════════════════════════════════════════════
   * 4. 제도 — 원문 번호점을 그대로 좌표로
   *    좌표계: x = 폭(중심선 0 → 옆선 +) · y = 길이(목 0 → 밑단 +)
   *    ⚠ 원문 도면은 90° 눕혀 있다 — 「내려온다」=y 증가 · 「나간다」=x 증가
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
      var best = null, bd = Infinity;
      for (var i = 1; i < o.length; i++) {
        var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        var t = L2 ? ((n.p[0] - a[0]) * dx + (n.p[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var q = [a[0] + t * dx, a[1] + t * dy], e = V.dist(n.p, q);
        if (e < bd) { bd = e; best = q; }
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
    return notches;
  }

  /** 암홀 — **품선에 세로로 접하는 2도막 곡선** (토르소프린세스 armCurve 이식).
   *
   *  단순히 「어깨점 → 통과점 → 겨드랑」 3점 스플라인으로 그리면 어깨 끝에서
   *  직선으로 떨어졌다가 급히 꺾인다 — 실제로 그렇게 나와서 각져 보였다.
   *  사람이 운형자로 그으면 **품선에 한 번 접했다가** 오목점을 지나 겨드랑으로 간다.
   *
   *  @param SP    어깨 끝
   *  @param pitchX 품선 x (등품/2 또는 앞품/2)  @param pitchTop 품선 위끝 y
   *  @param U     겨드랑  @param BL 진동선 y  @param gap 품선에서 띄우는 양 [27][45]
   */
  /** 암홀선 — 원문 [27][45] 를 글자 그대로.
   *
   *    [27] 「암홀자를 **23번에 직각**이 되게 놓고 42번을 향하여 암홀선.
   *          등품선 42번과 암홀라인의 거리가 **1 정도 떨어지게**.
   *          12번과 42번을 **자연스럽게 연결**」
   *    [45] 앞도 같다 — 78번에서 0.3~0.5 띄우고 어깨 끝에서 직각.
   *
   *  즉 **한 줄기 곡선**이다. 규칙은 셋뿐:
   *    ① 어깨 끝에서 **어깨선에 직각**으로 출발 (도면의 직각 표시)
   *    ② 품선에서 gap 만큼 떨어진 점(42·78 자리)을 지난다
   *    ③ 겨드랑에서 **옆선에 직각**으로 도착 = 진동선과 나란히
   *
   *  ⚠ 예전에는 두 도막(어깨→접점 · 접점→겨드랑)을 이어 붙이고 접점에서 양쪽 다
   *    접선을 수직 [0,1] 로 묶었다. 그래서 **접점 부근이 곧은 세로 구간**이 되고
   *    양 끝에서 꺾여 「찌그러져」 보였다 (사용자 지적 2026-08-14).
   *    도면의 12→42→23 은 처음부터 끝까지 한 번에 도는 얕은 그릇 모양이다. */
  function armholeC(SP, shDir, pitchX, pitchTop, U, BL, gap, C) {
    var A = [pitchX + gap, (pitchTop + BL) / 2];   // 품선에서 gap 뗀 점 (42·78 자리)
    /* ① 어깨선에 직각 — 두 수선 중 **암홀 안쪽(A)을 향하는** 쪽을 고른다 */
    var n = [-shDir[1], shDir[0]];
    if ((A[0] - SP[0]) * n[0] + (A[1] - SP[1]) * n[1] < 0) n = [-n[0], -n[1]];
    /* ③ 겨드랑 도착 접선 — 옆선이 세로이므로 직각은 가로다 (진동선과 나란히) */
    return splineSegs([SP, A, U], endTan(n, C.k0), endTan([1, 0], C.k1));
  }

  /** 목선이 목옆점에 닿는 접선 — **어깨선에 직각**.
   *  두 수선 중 목선이 오는 쪽(중심점 from)에서 목옆점을 향하는 방향을 고른다. */
  function neckEndTan(NP, SP, from) {
    var d = V.norm(V.sub(SP, NP)), n = [-d[1], d[0]];
    if ((NP[0] - from[0]) * n[0] + (NP[1] - from[1]) * n[1] < 0) n = [-n[0], -n[1]];
    return n;
  }

  /** 밑단 통과점 — 원문 [28] 의 43·44번.
   *  43 = 현의 1/3 자리. 「44번에 곡자를 대고」 = 그 43 을 **현에서 직각으로 띄워**
   *  곡선을 부풀린다. 띄우는 양은 현 길이의 bow 배 (호수가 커지면 같이 자란다).
   *  ⚠ 44 를 두 직각선의 교점으로 실제로 구하려 했더니, 뒤 밑단은 두 직각선이
   *    거의 나란해서 교점이 밑단 위로 떨어지고 세 점이 일직선이 되어 스플라인이
   *    NaN 을 냈다. 교점을 쓰지 말고 **직각 오프셋**으로 둔다. */
  function hemAnchor(A, B, bow) {
    var d = V.sub(B, A), L = Math.hypot(d[0], d[1]);
    if (!(L > 1e-6)) return _lerp(A, B, 1 / 3);
    var n = [-d[1] / L, d[0] / L];
    if (n[1] < 0) n = [-n[0], -n[1]];          // 밑단 쪽(+y)으로 부푼다
    var P = _lerp(A, B, 1 / 3);
    return [P[0] + n[0] * L * bow, P[1] + n[1] * L * bow];
  }

  /** 곡선 위에서 끝점 FROM 으로부터 호길이 L 인 점 */
  function ptAlong(segs, from, L) {
    var q = sampleSegs(segs, 0.02), acc = 0, i;
    if (V.dist(q[0], from) > V.dist(q[q.length - 1], from)) q = q.slice().reverse();
    for (i = 1; i < q.length; i++) {
      var d = V.dist(q[i - 1], q[i]);
      if (acc + d >= L) return _lerp(q[i - 1], q[i], (L - acc) / (d || 1));
      acc += d;
    }
    return q[q.length - 1];
  }

  /** 두 직선(A→B · C→D)의 교점. 나란하면 CD 의 중점을 돌려준다. */
  function lineMeet(A, B, C, D) {
    var r = V.sub(B, A), sv = V.sub(D, C), den = r[0] * sv[1] - r[1] * sv[0];
    if (Math.abs(den) < 1e-9) return _lerp(C, D, 0.5);
    var t = ((C[0] - A[0]) * sv[1] - (C[1] - A[1]) * sv[0]) / den;
    return [A[0] + r[0] * t, A[1] + r[1] * t];
  }

  /** 두 점을 잇는 직선을 y 까지 연장한 x */
  function extendToY(a, b, y) {
    var dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-9) return b[0];
    return a[0] + (b[0] - a[0]) * (y - a[1]) / dy;
  }
  /** 점열에서 y 를 지나는 x (선형 보간) */
  function xAtY(pts, y) {
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      if ((a[1] - y) * (b[1] - y) <= 0 && Math.abs(b[1] - a[1]) > 1e-12)
        return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]);
    }
    return pts[pts.length - 1][0];
  }

  /* ════════════════════════════════════════════════════════════════
   * 조끼 제도 — 백영례 번호점 제도법 (docs/조끼-제도법-백영례.md)
   *   좌표: x = 폭(중심→옆선) · y = 길이(기초선→밑단). 도면은 90° 회전돼 있다.
   *   ⚠ 번호는 **원문 그대로** 쓴다. p23 은 「23번점」이지 배열 인덱스가 아니다.
   * ════════════════════════════════════════════════════════════════ */
  function bustDiffOf(B) { return B < 90 ? 2.5 : 2.8; }

  function geom(m, opt) {
    opt = opt || {};
    var B = num(opt.B, m.B), 유B = num(opt['유B'], m['유B']);
    var W = num(opt.W, m.W), H = num(opt.H, m.H);
    var backLen = num(opt.backLen, m.backLen), hipLen = num(opt.hipLen, m.hipLen);
    var shoulderW = num(opt.shoulderW, m.shoulderW);
    var backW = num(opt.backW, m.backW), frontW = num(opt.frontW, m.frontW);
    var bustLen = num(opt.bustLen, m.bustLen), bustW = num(opt.bustW, m.bustW);
    var 유차 = num(opt.bustDiff, bustDiffOf(B));
    var q = B / 4;

    /* ══ 기본선 [1]~[5] ═══════════════════════════════════════════ */
    var BL = q + num(opt.armDepthAdd, K.armDepthAdd);   // [2] 진동선 = B/4 + 1.5
    var WL = backLen;                                    // [3] 허리선
    var HL = backLen + hipLen;                           // [4] 힙선
    var cbIn = num(opt.cbIn, K.cbIn);                    // [5] 1.5
    var p2 = [0, 0], p4 = [0, BL], p5 = [0, WL], p3 = [0, HL];
    var p6 = [0, BL / 3];                                // [5] 2~4 의 3등분
    var p7 = [cbIn, BL], p8 = [cbIn, WL], p9 = [cbIn, HL];

    /* ══ 뒤판 [6]~[19] ═══════════════════════════════════════════ */
    /* [7] 10 = 4~7 의 2등분 → 11(등품/2) · 13(유B/4 + 1.5~2) */
    var p10 = [cbIn / 2, BL];
    var p11 = [p10[0] + backW / 2, BL];
    var p12 = [p11[0], 0];
    var p13 = [p10[0] + 유B / 4 + num(opt.chestEase, K.chestEase), BL];
    var p14 = [p13[0], HL];
    /* [8] 15 = 9 + H/4 · 16 = +여유 */
    var p15 = [p9[0] + H / 4, HL];
    var p16 = [p15[0] + num(opt.hipEase, K.hipEase), HL];
    /* [9] 17 = 8 + W/4 · 18 = +여유 · 19 = +다트분 */
    var p17 = [p8[0] + W / 4, WL];
    var p18 = [p17[0] + num(opt.waistEase, K.waistEase), WL];
    var backDart = num(opt.backDart, K.backDart);
    var p19 = [p18[0] + backDart, WL];
    /* [10] 20 = 어깨/2 · 21 = +다트 1.5 · 22 = 12 에서 어깨기울기 */
    var p20 = [shoulderW / 2, 0];
    var shDart = num(opt.shDart, K.shDart);
    var p21 = [p20[0] + shDart, 0];
    var p22 = [p12[0], num(opt.shSlope, K.shSlope)];
    /* [11] 23 = B/12 뒤목 · 24 = 유차 올라간 곳(기초선 위) */
    var p23 = [B / 12, 0];
    var p24 = [p23[0], -유차];
    var p25 = [p23[0] + 1.0, -유차];                     // 직각 표시
    /* [12] 26 = 21 에서 안으로 1.5 (어깨를 판다) */
    var p26 = [p21[0], num(opt.shScoop, K.shScoop)];
    /* [13] 27 = 22~11 의 2등분 */
    var p27 = _lerp2(p22, p11);
    /* [14] 28 = 11 에서 2~3 안쪽 · 29 = 직선 아래 · 30 = 29 에서 5 위 */
    var p28 = [p11[0] - num(opt.splitIn, K.splitIn), BL];
    var p29 = [p28[0], HL];
    var p30 = [p29[0], HL - num(opt.hemUp, K.hemUp)];
    /* [15] 31·32 = 29 양쪽으로 (14~16)/2 */
    var halfHem = Math.abs(p16[0] - p14[0]) / 2;
    var p31 = [p29[0] + halfHem, HL], p32 = [p29[0] - halfHem, HL];
    /* [16] 33·34 = W 다트분 양쪽 분배. 절개선 중심이 허리를 지나는 자리 기준 */
    var splitWaistX = p28[0] + (p29[0] - p28[0]) * (WL - BL) / (HL - BL);
    var p33 = [splitWaistX + backDart / 2, WL], p34 = [splitWaistX - backDart / 2, WL];
    /* [17] 35 = 암홀 위 MP 자리 · 36 = MP 만큼 줄인 곳 */
    var p35 = _lerp(p26, p11, num(opt.mpAt, K.mpAt));
    var p36 = [p35[0] - num(opt.mpBack, K.mpBack), p35[1]];
    /* [18] 37 = 2~23 의 3등분 · 38 = 24 에서 1.5 나간 곳 */
    var p37 = [p23[0] / 3, 0];
    var p38 = [p24[0] + num(opt.neckOut, K.neckOut), p24[1]];
    /* [19] 39 = 38~22 의 2등분(어깨다트 중심) · 40 = 다트길이 7 */
    var p39 = _lerp2(p38, p22);
    var shDartLen = num(opt.shDartLen, K.shDartLen);

    /* 뒤 곡선 ─────────────────────────────────────────────────── */
    /* 등솔선 [6] — 6~8 곡선 · 8~9 직선 */
    var bCb = splineSegs([p2, p6, p8], endTan([0, 1], 1.0), endTan(V.sub(p8, p6), 1.0));
    var bCbLow = lineSegs(p8, p9);
    /* 뒤목선 [18] — 38~37 곡선. 어깨선에 직각으로 도착한다 */
    var bShDir = V.norm(V.sub(p26, p38));
    var bNeck = splineSegs([p37, [p37[0] * 0.55 + p38[0] * 0.45, p38[1] * 0.62], p38],
                           endTan([1, 0], 1.0), endTan(neckEndTan(p38, p26, p37), 1.0));
    /* 뒤 암홀 [13] — 26 → 27 을 0.5~1 떨어져 통과 → 11 */
    var bArm = armholeC(p26, bShDir, p11[0], p22[1], p11, BL,
                        num(opt.armFromBW, K.armFromBW), CAL.arm);
    /* 뒤 옆선 — 13 → 19 → 16 */
    var bSide = splineSegs([p13, p19, p16], endTan(V.sub(p19, p13), CAL.side.k0),
                                            endTan(V.sub(p16, p19), CAL.side.k1));
    /* 뒤 절개선 [16] — 27 → 28 → 33/34 → 31/32 (암홀라인) */
    function bSplit(waistX, hemX) {
      return splineSegs([p27, p28, [waistX, WL], [hemX, HL]],
                        endTan(V.sub(p28, p27), CAL.princess.k0), endTan([0, 1], CAL.princess.k1));
    }
    var bSplitOut = bSplit(p33[0], p31[0]);    // 옆선 쪽 조각의 변
    var bSplitIn  = bSplit(p34[0], p32[0]);    // 중심 쪽 조각의 변
    var bHem = lineSegs(p9, p16);

    /* ══ 앞판 [20]~[40] — 뒤판을 복사해 그린다 ═══════════════════ */
    /* [20] 41 = 13 에서 유차 올라간 곳 · 44 = 2 에서 유차 올라간 곳 */
    var f41 = [p13[0], BL - 유차];
    var f42 = [p13[0], HL];
    var f43 = [0, BL - 유차];
    var f44 = [0, -유차];
    var f45 = [p20[0] + 4.0, -유차];
    /* [21] 46 = 43 + 앞품/2 · 47 = 기초선(44) 높이의 앞품선 · 48 = 47 에서 4.5 · 49 = 3등분 */
    var f46 = [f43[0] + frontW / 2, f43[1]];
    var f47 = [f46[0], f44[1]];
    var f48 = [f47[0], f47[1] + num(opt.frontShDrop, K.frontShDrop)];
    var f49 = _lerp(f46, f47, 1 / 3);
    /* [22] 50 = 23 에서 올라간 곳 · 51 = 50 에서 1 내려온 곳 */
    var f50 = [p23[0], f44[1]];
    var f51 = [f50[0], f50[1] + num(opt.fNeckDrop, K.fNeckDrop)];
    /* [23] 52 = 20 에서 1.5 내려온 곳 · 53 = 51 에서 1.5 나간 곳 */
    var f52 = [p20[0], f44[1] + num(opt.fShScoop, K.fShScoop)];
    var f53 = [f51[0] + num(opt.fNeckOut, K.fNeckOut), f51[1]];
    /* [24] 54 = 5 + W/4 · 55 = +여유 */
    var f54 = [W / 4, WL];
    var f55 = [f54[0] + num(opt.waistEase, K.waistEase), WL];
    /* [26] BP 57 = (유폭/2, 유장) · 58 = +1.5~2 · 59 = 직선 아래 */
    var f57 = [bustW / 2, bustLen];
    var f58 = [f57[0] + num(opt.bpOut, K.bpOut), bustLen];
    var f59 = [f58[0], HL];
    /* [27] 60·61 = (42~16)/2 를 59 양쪽 · 62 = 59 에서 5 위 · 63·64 = 앞다트분 */
    var fHalfHem = Math.abs(f42[0] - p16[0]) / 2;
    var f60 = [f59[0] + fHalfHem, HL], f61 = [f59[0] - fHalfHem, HL];
    var f62 = [f59[0], HL - num(opt.hemUp, K.hemUp)];
    var frontDart = num(opt.frontDart, K.frontDart);
    var fSplitWaistX = f58[0] + (f59[0] - f58[0]) * (WL - bustLen) / (HL - bustLen);
    var f63 = [fSplitWaistX + frontDart / 2, WL], f64 = [fSplitWaistX - frontDart / 2, WL];
    var f65 = [f41[0], f41[1] + num(opt.hemUp, K.hemUp)];
    var f66 = [f59[0], bustLen + 유차];
    /* [28] 67·68 = 앞절개선. 69 = 46~48 의 2등분 — 그 위로 올라가면 안 된다 */
    var f69 = _lerp2(f46, f48);
    var f67 = [f46[0], f46[1] + num(opt.fSplitDrop, K.fSplitDrop)];
    var f68 = cp(f58);
    /* [38] 70 = 3 에서 앞처짐 · 71 = 앞여밈분 · 72 */
    var frontDrop = num(opt.frontDrop, K.frontDrop);
    var wrap = num(opt.frontWrap, K.frontWrap);
    var f70 = [0, HL + frontDrop];
    var f71 = [-wrap, HL + frontDrop];
    var f72 = [-wrap, f44[1]];

    /* 앞 곡선 ─────────────────────────────────────────────────── */
    var fShDir = V.norm(V.sub(f52, f53));
    var fNeck = splineSegs([[0, f53[1] + B / 6 + 0.5], [f53[0] * 0.78, (f53[1] + B / 6 + 0.5) * 0.78], f53],
                           endTan([1, 0], 1.0), endTan(neckEndTan(f53, f52, [0, f53[1] + B / 6 + 0.5]), 1.0));
    var fArm = armholeC(f52, fShDir, f46[0], f52[1], f41, f41[1],
                        num(opt.frontArmGap, K.frontArmGap), CAL.armF);
    var fSide = splineSegs([f41, f55, [p16[0], HL]],
                           endTan(V.sub(f55, f41), CAL.side.k0), endTan([0, 1], CAL.side.k1));
    function fSplit(waistX, hemX) {
      return splineSegs([f67, f68, [waistX, WL], [hemX, HL]],
                        endTan(V.sub(f68, f67), CAL.princess.k0), endTan([0, 1], CAL.princess.k1));
    }
    var fSplitOut = fSplit(f63[0], f60[0]);
    var fSplitIn  = fSplit(f64[0], f61[0]);
    var fHem = lineSegs(f71, [p16[0], HL]);

    return {
      m: m, B: B, 유B: 유B, W: W, H: H, q: q, 유차: 유차,
      BL: BL, WL: WL, HL: HL, cbIn: cbIn, backLen: backLen, hipLen: hipLen,
      shoulderW: shoulderW, backW: backW, frontW: frontW, bustLen: bustLen, bustW: bustW,
      backDart: backDart, frontDart: frontDart, shDart: shDart, shDartLen: shDartLen,
      p2: p2, p3: p3, p4: p4, p5: p5, p6: p6, p7: p7, p8: p8, p9: p9, p10: p10,
      p11: p11, p12: p12, p13: p13, p14: p14, p15: p15, p16: p16, p17: p17, p18: p18,
      p19: p19, p20: p20, p21: p21, p22: p22, p23: p23, p24: p24, p25: p25, p26: p26,
      p27: p27, p28: p28, p29: p29, p30: p30, p31: p31, p32: p32, p33: p33, p34: p34,
      p35: p35, p36: p36, p37: p37, p38: p38, p39: p39,
      f41: f41, f42: f42, f43: f43, f44: f44, f45: f45, f46: f46, f47: f47, f48: f48,
      f49: f49, f50: f50, f51: f51, f52: f52, f53: f53, f54: f54, f55: f55,
      f57: f57, f58: f58, f59: f59, f60: f60, f61: f61, f62: f62, f63: f63, f64: f64,
      f65: f65, f66: f66, f67: f67, f68: f68, f69: f69, f70: f70, f71: f71, f72: f72,
      bCb: bCb, bCbLow: bCbLow, bNeck: bNeck, bArm: bArm, bSide: bSide, bHem: bHem,
      bSplitOut: bSplitOut, bSplitIn: bSplitIn,
      fNeck: fNeck, fArm: fArm, fSide: fSide, fHem: fHem,
      fSplitOut: fSplitOut, fSplitIn: fSplitIn,
      ahBack: polyLen(sampleSegs(bArm, 0.02)), ahFront: polyLen(sampleSegs(fArm, 0.02)),
      AH: polyLen(sampleSegs(bArm, 0.02)) + polyLen(sampleSegs(fArm, 0.02))
    };
  }


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
   * 6. 소매 — 「대각선 = 암홀 길이」 (바재킷 capGeom 과 같은 식)
   *    좌표: 정점 6 = (0,0) · 뒤 +x · 앞 −x · y 는 부리 쪽으로 +
   * ════════════════════════════════════════════════════════════════ */
  function sleeveGeom(g, m, opt) {
    var ahF = g.ahFront, ahB = g.ahBack, AH = g.AH;
    /* ★ 소매산 높이 — 원문은 `AH/3` 으로 시작해서 「소매통을 재서 넓으면 0.5~1 올리고
       좁으면 내린다」고 한다. 즉 **소매통이 입력이고 소매산이 조절 손잡이**다.
       그대로 두면 55호에서 소매통이 28.2 로 원문(33~34)보다 5 좁다 —
       AH/3 은 재킷처럼 암홀이 깊은 옷의 값이다.
       그래서 목표 소매통에서 소매산을 **이분법으로 역산**한다. */
    function widthAt(hh) {
      return Math.sqrt(Math.max(ahF * ahF - hh * hh, 0.25)) +
             Math.sqrt(Math.max(ahB * ahB - hh * hh, 0.25));
    }
    var h;
    var target = num(opt.sleeveW, m.sleeveW);
    if (num(opt.capFromAH, K.capFromAH)) {
      h = AH / num(opt.capDiv, K.capDiv) + num(opt.capAdd, K.capAdd);
    } else {
      var lo = 0.5, hi = Math.min(ahF, ahB) - 0.5;
      for (var it = 0; it < 44; it++) {
        var mid = (lo + hi) / 2;
        if (widthAt(mid) > target) lo = mid; else hi = mid;   // h ↑ → 폭 ↓
      }
      h = (lo + hi) / 2 + num(opt.capAdd, K.capAdd);
    }
    var halfF = Math.sqrt(Math.max(ahF * ahF - h * h, 0.25));
    var halfB = Math.sqrt(Math.max(ahB * ahB - h * h, 0.25));
    var len = num(opt.sleeveLen, m.sleeveLen);
    /* ★ 소맷부리도 **호수 등급**을 준다. 원문은 55 Size 값 24 만 주고 자켓 표
       (55~66 = 26 · 77~88 = 27 · 99 = 28)가 대략 호당 0.5 다.
       등급이 없으면 44호와 88호가 같은 부리가 되고, 두 장 소매의 큰/작은 몫이
       호수 따라 널뛴다 — 큰소매 부리가 44호 15.34 → 88호 14.32 로 **줄었다**
       (사용자 지적 2026-08-14 「두 장 소매도 도면과 대조해줘」로 발견). */
    var szStep = (m.B - BASE.B) / GRADE.B;
    var cuffW = num(opt.cuffW, K.cuffW + num(opt.cuffGrade, K.cuffGrade) * szStep);
    var ctrIn = num(opt.sleeveCtrIn, K.sleeveCtrIn);
    /* ★ 좌표 규약 — **앞 +x · 뒤 −x** (스위트 공통 · 숙녀복기본원형1·2 와 같다).
       도면을 90° 반시계로 돌리면 뒤가 왼쪽·앞이 오른쪽이다. 예전에는 반대로 두어
       조각이 도면과 **거울상**으로 나왔다 (사용자 지적 2026-08-14). */
    var p6 = [0, 0], p5 = [halfF, h], p7 = [-halfB, h];
    var p9 = [ctrIn, 0], p10 = [ctrIn, len], p11 = [ctrIn, h];
    /* ── 소매산 곡선 — 원문 작도 그대로 (도면 `docs/img/조끼-소매-골격.png`) ──
       도면을 받고 나서야 작도가 확정됐다 (2026-08-14):

         · 15 = 5번에서 4.5 (진동선 위)      · 19 = 7번에서 4   (진동선 위)
         · 16 = 9번에서 4.5 (정점선 위)      · 20 = 6번에서 4.5 (정점선 위)
         · **17 = 대각선 5→9 와 직선 15→16 의 교점** (= 15~16 의 2등분)
         · **21 = 대각선 7→6 과 직선 19→20 의 교점** (= 19~20 의 2등분)
         · 18 = 15~17 의 2등분
         · 앞 곡선은 5 → 18 → 17 → **9** · 뒤 곡선은 **6** → 21 → 7
         · 정수리는 9~6 (1.5) 짜리 **평평한 구간**이다 — 앞뒤 곡선이 다른 점에서 끝난다

       ⚠ 그 전에는 이 스위트의 다른 모듈 작도(capGeom · 마크 AH/8 + 대각선 수선)를
         가져다 썼다. 모양은 그럴듯했지만 **원문의 17·21번에서 0.74~0.94 벗어났다**
         — 아예 다른 작도였다. 정답지가 있는 모듈의 작도라도 **골격이 같을 때만**
         빌려 쓸 수 있다. 여기서는 원문에 통과점이 명시돼 있으므로 원문이 먼저다. */
    var p15 = [p5[0] - num(opt.capFrontOut, K.capFrontOut), h];
    var p19 = [p7[0] + num(opt.capBackIn, K.capBackIn), h];
    var p16 = [p9[0] + num(opt.capFrontIn, K.capFrontIn), 0];
    var p20 = [p6[0] - num(opt.capBackOut, K.capBackOut), 0];
    /* 17·21 — 원문 [7][8] 글자 그대로 「16-15 의 2등분」·「20-19 의 2등분」 */
    var p17 = _lerp(p15, p16, 0.5);
    var p18 = _lerp(p15, p17, 0.5);
    var p21 = _lerp(p19, p20, 0.5);
    /* ★★ **6번 = 소매중심(작도 원점) · 9번 = 정점(마루)** — 사용자 확인 2026-08-14
         「소매중심은 6번이야」 · 「정점은 6에서 9로 시프트한 것이 맞아」
         「6에서 7까지선이 뒤 암홀이고 5에서 6이 앞 암홀이야」

       6번은 두 대각선(5→6 = 앞AH · 6→7 = 뒤AH)이 만나 **소매폭을 정하는** 점이고,
       곡선이 넘어가는 마루는 소매중심선(9—10) 위, 즉 **9번**이다.
       9 = 6에서 1.5 앞 (원문 [5]).

         정점 6 → 앞 반폭 15.16(39.4°) · 뒤 18.34(34.1°)   차 5°  ← 앞뒤가 뒤집혀 보인다
         정점 9 → 앞 반폭 13.66(**42.3°**) · 뒤 19.84(**32.1°**)  차 10°  ← 도면과 맞는다

       ★ 정수리는 **9~6 (1.5) 짜리 평평한 구간**이다. 두 곡선을 9번 한 점에 모으면
         앞이 급경사라 정점에서 급히 꺾여 최대곡률이 반지름 1.8cm 로 몰린다
         — 「어깨를 그렇게 하면 못 만들어」. 장력을 올려 펴면 이세가 2.5~3.6 으로 폭발한다.
         평평한 1.5 가 답이다. */
    /* ★★ 곡선의 **휨이 곧 암홀 길이**다 (사용자 지적 2026-08-14
         「5,18,17,9 로 이어지는 곡선이 많이 휘는 것이 암홀 길이를 맞추는 이유 아닐까」).

       장력을 눈대중으로 두었더니 **앞 소매산이 앞AH 보다 짧게** 나왔다
       (44호 −0.17 · 55호 −0.10) — 소매를 달 때 앞이 모자라 늘려 붙여야 한다.
       그리고 이세 1.67 중 1.50 이 **정수리**에서 나오고 있었다. 그건 곡선이 만든
       이세가 아니라 작도 부산물이다.

       → 앞 곡선의 장력을 **앞 이세에서 역산**한다:  앞 곡선 = 앞AH + capEaseFront.
         뒤는 기하가 이미 강제한다 — 정점이 9번(6에서 1.5 앞)이라 9→7 직선거리가
         뒤AH 보다 길어서(23.41 > 22.16) 뒤 이세는 최소 1.25 가 깔린다.
         그래서 앞은 작게, 뒤는 크게 — 원문 [9] 「이세 1.5~2」 안에 든다. */
    var capF, capB, capTop = lineSegs(p9, p6);
    (function () {
      var want = ahF + num(opt.capEaseFront, K.capEaseFront);
      function mk(k) { return splineSegs([p5, p18, p17, p9],
        endTan([-1, 0], CAL.capFront.k0 * k), endTan([-1, 0], CAL.capFront.k1 * k)); }
      var lo = 0.2, hi = 6, i, mid;
      for (i = 0; i < 44; i++) { mid = (lo + hi) / 2;
        if (polyLen(sampleSegs(mk(mid), 0.02)) < want) lo = mid; else hi = mid; }
      capF = mk((lo + hi) / 2);
      capB = splineSegs([p6, p21, p7],
                        endTan([-1, 0], CAL.capBack.k0), endTan([-1, 0], CAL.capBack.k1));
    })();
    /* 부리 [10][11] — 24 는 3번에서 **안쪽**. 그래야 부리 길이가 보존된다 */
    var p3 = [halfF, len], p8 = [-halfB, len];
    var p22 = [p3[0] - cuffW, len];
    var Lrest = Math.max(0, p22[0] - p8[0]);
    var p23 = [p22[0] - Lrest / 2, len];
    var p24 = [p3[0] - Lrest / 2, len];
    var drop = num(opt.cuffDrop, K.cuffDrop);
    var c23 = [p23[0], p23[1] + drop], c24 = [p24[0], p24[1] + drop];
    /* EL [6] · MP [14] */
    var p12 = [p9[0], (h + len) / 2];
    var elY = p12[1] - num(opt.elbowAdd, K.elbowAdd);
    var p14 = [halfF, elY];
    var p25 = [-halfB, elY + num(opt.mpBelowEL, K.mpBelowEL)];
    var p26 = [p10[0] + num(opt.ctrTwist, K.ctrTwist), len];
    /* 솔기 [12][13] */
    /* ── 솔기 [12][13] ──────────────────────────────────────────────
       ★ 끝접선을 **세로 [0,±1]** 로 묶고 있었다. 솔기는 소매통에서 부리로 좁아지는
         **기운 선**이라, 양 끝을 세로로 세우면 가운데가 S 로 휘어(휨 0.633) 도면과
         다르게 나온다. 도면의 5→24 · 7→23 은 거의 곧게 가다 부리에서만 돈다.
         → 끝접선을 **현 방향**으로 두고 팔꿈치에서만 안쪽으로 살짝 부풀린다.

       ★ 원문 [15] 의 ■ 표시: **뒤 솔기 = 앞 솔기 + 0.5(이세분)**. 남는 양은 25번 MP 로
         접어 없앤다. 두 솔기가 똑같이 44.38 로 나오고 있었다 — 이세가 0 이었다.
         뒤 솔기의 부풀림을 **이분법으로 풀어** 0.5 를 만든다. */
    function mkSeam(A, B, bowAmt) {
      var d = V.sub(B, A), L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L];
      var n = [-u[1], u[0]];
      if (n[0] * (0 - A[0]) + n[1] * (0 - A[1]) < 0) n = [-n[0], -n[1]];   // 소매 안쪽으로
      var M = _lerp(A, B, 0.5);
      return splineSegs([A, [M[0] + n[0] * bowAmt, M[1] + n[1] * bowAmt], B],
                        endTan(u, 1.0), endTan(u, 1.0));
    }
    var seamBow = num(opt.sleeveSeamBow, K.sleeveSeamBow);
    var seamF = mkSeam(p5, c24, seamBow);
    var seamB = mkSeam(c23, p7, seamBow);
    /* ★ ■ 표시 (원문 [15] · 도면 「앞쪽 ■ +0.5(이세분)」) — **너치 위치** 규칙이다.
       솔기 길이 조건이 아니다: 원문 [10][11] 로 22·23·24 를 잡으면 앞뒤 솔기의
       가로 span 이 **둘 다 Lrest/2** 라 두 길이는 수학적으로 반드시 같아진다
       (Lrest = 소매통 − 소매부리 · 23 = 22+Lrest/2 · 24 = 3+Lrest/2).
       여기에 0.5 차를 억지로 만들려면 뒤 솔기를 **2.9 나 부풀려야** 하는데
       그러면 도면(거의 곧은 선)과 완전히 달라진다.
       도면이 말하는 것은 「앞쪽 ■ 를 0.5 더 나가서 찍는다」 — 봉제 때 그 0.5 만큼
       앞을 홈줄인다. 그래서 **너치**로 낸다. */
    var easeMk = num(opt.sleeveEase, K.sleeveEase);
    var markAtB = polyLen(sampleSegs(seamB, 0.02)) * 0.5;   // 뒤 ■ = 솔기의 2등분
    var markAtF = markAtB + easeMk;                          // 앞 ■ = 뒤보다 0.5 더
    var markPtB = ptAlong(seamB, p7, markAtB);
    var markPtF = ptAlong(seamF, p5, markAtF);

    /* ★ 소맷부리 — 원문 [15] 「10번에서 안쪽으로 반인치(1.25) 들어온 곳 = 26번」.
       **26번은 부리선 위의 점**이다(소매중심선의 아래 끝이기도 하다).
       통과점을 `24~23 의 중점`으로 두고 있었는데 그 중점은 24·23 과 같은 높이라
       부리선이 **완전한 직선**으로 나왔다(양 끝 y 56.50 · 중간 56.50).
       도면은 23·24 가 0.5 내려가고 가운데가 26번(0.5 위)을 지나 **곡선**이다.
       26 을 지나게 해도 호길이는 24.000 → 24.033 으로 거의 안 는다.
       양 끝 접선은 **솔기에 직각** — 부리를 접었을 때 솔기가 꺾이지 않는다. */
    var cuffT24 = perpToward(V.norm(V.sub(c24, p5)), c24, c23);
    var cuffT23 = perpToward(V.norm(V.sub(c23, p7)), c24, c23);
    var cuff = splineSegs([c24, p26, c23],
                          endTan(cuffT24, num(opt.cuffPerpK, K.cuffPerpK)),
                          endTan(cuffT23, num(opt.cuffPerpK, K.cuffPerpK)));
    return { h: h, halfF: halfF, halfB: halfB, len: len, cuffW: cuffW,
             p3: p3, p5: p5, p6: p6, p7: p7, p8: p8, p9: p9, p10: p10, p11: p11,
             p12: p12, p14: p14, p15: p15, p16: p16, p17: p17, p18: p18,
             p19: p19, p20: p20, p21: p21, p22: p22, p23: c23, p24: c24,
             p25: p25, p26: p26, elY: elY,
             markPtF: markPtF, markPtB: markPtB, markAtF: markAtF, markAtB: markAtB,
             capF: capF, capTop: capTop, capB: capB, seamF: seamF, seamB: seamB, cuff: cuff,
             sleeveW: halfF + halfB,
             capLen: polyLen(sampleSegs(capF, 0.02)) + polyLen(sampleSegs(capTop, 0.02)) +
                     polyLen(sampleSegs(capB, 0.02)),
             seamLenF: polyLen(sampleSegs(seamF, 0.02)),
             seamLenB: polyLen(sampleSegs(seamB, 0.02)) };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 6-2. 두 장 소매 — 한 장 소매를 **잘라서** 만든다
   *
   *   원문(백영례 조끼)에는 **한 장 소매 도면만** 있다. 그래서 두 장 소매는
   *   이 스위트에서 정답지 DXF 로 맞춰 둔 작도(숙녀복기본원형1·2)를 따른다.
   *   그 작도의 핵심 한 줄: 「**큰소매 앞쪽에서 3 을 떼어 작은소매 뒤쪽에 붙인다**」
   *   — 소매는 통이므로 앞 솔기와 뒤 솔기가 원래 같은 자리다. 앞에서 떼어낸 조각을
   *   소매통만큼 뒤로 평행이동하면 그대로 작은소매의 뒤가 된다.
   *
   *   ★ 길이 짝은 **작도로 보장**한다 (숫자를 맞추러 다니지 않는다):
   *     · 앞 솔기 — 작은소매 뒤 밑선 = 큰소매 앞 밑선을 **+소매통 평행이동**
   *     · 뒤 솔기 — 작은소매 절개선 = 큰소매 절개선을 **절개점 세로축에 대칭**
   *     · 부리   — 두 몫의 합이 소매부리가 되도록 밑단 모서리 x 를 **식으로 푼다**
   *         큰 = B − F · 작은 = (F + W) − (2A − B) → 2B − 2A + W = 부리
   *         ⇒ B = A + (부리 − 소매통)/2      (A = 절개점 x · W = 소매통)
   *       55호에서 큰:작은 = 15.68 : 8.32 = 0.653 : 0.347 이 나온다 —
   *       정답지 모듈의 2:1(0.668:0.332)과 사실상 같다. 같은 작도라는 뜻이다.
   * ════════════════════════════════════════════════════════════════ */
  function twoSleeveGeom(s, opt) {
    var W = s.sleeveW, gap = num(opt.twoSplitGap, K.twoSplitGap);
    /* ① 절개점 — 소매산 높이의 twoSplitAt 자리에서 뒤 소매산과 만나는 점 */
    var tgt = s.h * num(opt.twoSplitAt, K.twoSplitAt);
    var bp = sampleSegs(s.capB, 0.01), splitP = bp[0];
    bp.forEach(function (q) { if (Math.abs(q[1] - tgt) < Math.abs(splitP[1] - tgt)) splitP = q; });
    var splitU = [splitP[0] - gap, splitP[1]];        // 작은소매 절개점
    var axis = (splitP[0] + splitU[0]) / 2;           // 대칭축
    /* ② 앞에서 현 twoSideOff 만큼 떼는 자리 — x 오프셋이 아니라 **현 길이**다 */
    var fp = sampleSegs(s.capF, 0.01);                // p5 → p6
    var off = num(opt.twoSideOff, K.twoSideOff), cutI = 0;
    for (var i = 0; i < fp.length; i++) { if (V.dist(fp[i], s.p5) <= off) cutI = i; else break; }
    var cutF = fp[cutI];
    /* ③ 소매산을 조각별로 자른다 */
    var capBigF = fp.slice(cutI);                                        // cutF → 정점
    var capBigB = splitSegsAtPt(s.capB, splitP, true);                   // 정점 → 절개점
    var capUndB = splitSegsAtPt(s.capB, splitU, false);                  // 절개점 → p7
    var capUndF = fp.slice(0, cutI + 1).map(function (q) {               // p5 → cutF 를 뒤로 −W
      return [q[0] - W, q[1]];
    });
    var backTop = [cutF[0] - W, cutF[1]];
    /* ④ 밑단 모서리 — 위 식으로 푼다 */
    var bigHemF = s.p24;                                   // 앞 부리 모서리는 한 장과 같다
    var hemY = s.p24[1];
    var bigHemB = [axis - (s.cuffW - W) / 2, hemY];
    var undHemS = [2 * axis - bigHemB[0], hemY];           // 절개선 쪽 (대칭)
    var undHemB = [bigHemF[0] - W, hemY];                  // 뒤 밑선 쪽 (평행이동)
    /* ⑤ 절개선 — 팔꿈치에서 바깥으로 부푸는 C 자. 부푸는 양은 소매통 비율로 둔다
       (고정 cm 를 박으면 호수가 커질 때 안 자란다 — 이 리포에서 여러 번 겪었다) */
    var bulge = W * num(opt.twoSeamBulge, K.twoSeamBulge);
    var elY = s.elY;
    /* ★ 절개선은 소매산의 **접선을 이어받아** 출발한다 — 수직 [0,1] 로 두면
       절개점에서 소매산과 꺾인다(렌더에서 각으로 보였다). 짝 길이는 대칭이
       보장하므로 접선을 자유롭게 골라도 안전하다. */
    var capT = (function () {
      var q = sampleSegs(s.capB, 0.01), bi = 0;
      for (var i = 0; i < q.length; i++) if (V.dist(q[i], splitP) < V.dist(q[bi], splitP)) bi = i;
      var a = q[Math.max(0, bi - 3)], b = q[Math.min(q.length - 1, bi + 3)];
      var d = V.norm(V.sub(b, a));
      if (d[1] < 0) d = [-d[0], -d[1]];          // 부리 쪽(+y)으로 향하게
      /* ★ 소매산 접선과 세로 사이를 **섞는다**. 접선을 그대로 쓰면 절개점 바로 아래에서
         3.5 나 밖으로 튀고(정답지 부풀림 0.66), 세로로 꺾으면 소매산과 각이 진다.
         세기(k0)만 줄이면 이번엔 곡률이 0.83(반지름 1.2cm)으로 튄다 — 방향을 섞어야 한다. */
      var mixv = num(opt.twoSeamMix, K.twoSeamMix);
      return V.norm([d[0] * (1 - mixv), d[1] * (1 - mixv) + mixv]);
    })();
    function mkBigSeam() {
      return splineSegs([splitP, [splitP[0] - bulge, elY], bigHemB],
                        endTan(capT, CAL.twoSeam.k0), endTan(V.sub(bigHemB, [splitP[0] - bulge, elY]), CAL.twoSeam.k1));
    }
    var bigSeam = mkBigSeam();
    var undSeam = mirrorX(bigSeam, axis);                  // ★ 대칭 → 길이가 저절로 같다
    /* ⑥ 앞 밑선 — 한 장 소매의 앞 솔기를 cutF 에서 시작하도록 다시 그린 것 */
    var bigFront = splineSegs([cutF, [(cutF[0] + bigHemF[0]) / 2 + 0.4, (s.h + hemY) / 2], bigHemF],
                              endTan([0, 1], 1.0), endTan([0, 1], 1.0));
    var undOuter = bigFront.map(function (g) {             // ★ 평행이동 → 길이가 저절로 같다
      return { p0: [g.p0[0] - W, g.p0[1]], c1: [g.c1[0] - W, g.c1[1]],
               c2: [g.c2[0] - W, g.c2[1]], p1: [g.p1[0] - W, g.p1[1]] };
    });
    return {
      splitP: splitP, splitU: splitU, axis: axis, cutF: cutF, backTop: backTop,
      capBigF: capBigF, capBigB: capBigB, capUndB: capUndB, capUndF: capUndF,
      bigHemF: bigHemF, bigHemB: bigHemB, undHemS: undHemS, undHemB: undHemB,
      bigSeam: bigSeam, undSeam: undSeam, bigFront: bigFront, undOuter: undOuter,
      cuffBig: V.dist(bigHemF, bigHemB), cuffUnd: V.dist(undHemS, undHemB),
      seamLenBig: polyLen(sampleSegs(bigSeam, 0.02)), seamLenUnd: polyLen(sampleSegs(undSeam, 0.02)),
      frontLenBig: polyLen(sampleSegs(bigFront, 0.02)), frontLenUnd: polyLen(sampleSegs(undOuter, 0.02)),
      capLenBig: polyLen(capBigF) + polyLen(sampleSegs(s.capTop, 0.02)) + polyLen(sampleSegs(capBigB, 0.02)),
      capLenUnd: polyLen(sampleSegs(capUndB, 0.02)) + polyLen(capUndF)
    };
  }
  /** 세로축 x=a 에 대칭 (좌우 뒤집기 — 방향도 뒤집어 이어 붙이기 좋게) */
  function mirrorX(segs, a) {
    var m = function (q) { return [2 * a - q[0], q[1]]; };
    return segs.map(function (g) { return { p0: m(g.p0), c1: m(g.c1), c2: m(g.c2), p1: m(g.p1) }; });
  }
  /** 점열 → 세그먼트 (길이 재기·변으로 쓰기 위해) */
  function poly2segs(pts) { return lineSegs.apply(null, pts); }
  /** 곡선을 점 P 에서 자른다. head=true 면 시작~P, false 면 P~끝 (P 는 곡선 위 점) */
  function splitSegsAtPt(segs, P, head) {
    var pts = sampleSegs(segs, 0.01), bi = 0;
    for (var i = 0; i < pts.length; i++) if (V.dist(pts[i], P) < V.dist(pts[bi], P)) bi = i;
    return poly2segs(head ? pts.slice(0, bi + 1) : pts.slice(bi));
  }

  /* ══════════════════════════════════════════════════════════════════
   * 7. 조각 — 뒤판 · 앞판 · 소매
   * ════════════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════════════
   * 조각 — **암홀라인 절개** 4장 (뒤중심 · 뒤옆 · 앞중심 · 앞옆)
   *   원문 0. 「암홀라인 = 진동선(겨드랑이)쪽에서 절개선이 들어감」
   *   splitPanels 0 이면 통짜 2장(뒤판·앞판)으로 낸다.
   * ════════════════════════════════════════════════════════════════ */
  function draftVest(m, opt) {
    opt = opt || {};
    var g = geom(m, opt), seam = normSeam(opt.seam);
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
    /* 절개선 짝 너치 — **해부학적 높이**로 잡는다 (비율 아님) */
    function levelPair(segsA, insideA, segsB, insideB, levels) {
      var pa = sampleSegs(segsA, 0.02), pb = sampleSegs(segsB, 0.02), a = [], b = [];
      function at(pts, y) {
        var bi = 0, bd = Infinity;
        for (var i = 0; i < pts.length; i++) { var e = Math.abs(pts[i][1] - y); if (e < bd) { bd = e; bi = i; } }
        return cp(pts[bi]);
      }
      levels.forEach(function (lv) {
        var qa = at(pa, lv[1]), qb = at(pb, lv[1]);
        a.push({ p: qa, angle: angDeg(V.norm(V.sub(insideA, qa))), label: lv[0] });
        b.push({ p: qb, angle: angDeg(V.norm(V.sub(insideB, qb))), label: lv[0] });
      });
      return { a: a, b: b };
    }
    var split = num(opt.splitPanels, K.splitPanels);
    var FN = [];   // 계산식 주석
    function fn(id, label, formula, value, piece, anchor) {
      FN.push({ id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) });
    }

    /* ══ 뒤판 ══════════════════════════════════════════════════ */
    var nB = levelPair(g.bSplitIn, g.p8, g.bSplitOut, g.p16,
               [['진동선', g.BL], ['허리', g.WL], ['엉덩이', g.HL]]);
    var bGuide = [
      L('blB', 'dashed', [[0, g.BL], [g.p13[0], g.BL]], '진동선'),
      L('wlB', 'dashed', [[0, g.WL], [g.p19[0], g.WL]], '허리선'),
      L('hlB', 'dashed', [[0, g.HL], [g.p16[0], g.HL]], '엉덩이선'),
      L('bwB', 'dashed', [[g.p11[0], 0], [g.p11[0], g.BL]], '등품선')
    ];
    if (split) {
      pieces.push(mk('back', '뒤중심', [
        { name: '뒷목',   role: 'neck',     segs: g.bNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.p38, g.p26) },
        { name: '절개선', role: 'princess', segs: g.bSplitIn },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.p32, g.p9) },
        { name: '등솔선', role: 'center',   segs: revSegs(g.bCb.concat(g.bCbLow)) }
      ], [[2.0, g.BL], [2.0, g.HL - 3]],
        [{ p: cp(g.p38), angle: 90, label: '목옆점' }].concat(nB.a),
        bGuide.concat([L('cbB', 'dashed', [[0, 0], [0, g.HL]], '뒤중심 기초선')]), 1));
      pieces.push(mk('backSide', '뒤옆', [
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.p26, g.p26) },
        { name: '진동',   role: 'armhole',  segs: g.bArm },
        { name: '옆선',   role: 'side',     segs: g.bSide },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.p16, g.p31) },
        { name: '절개선', role: 'princess', segs: revSegs(g.bSplitOut) }
      ], [[g.p28[0] + 2.0, g.BL], [g.p28[0] + 2.0, g.HL - 3]],
        [{ p: cp(g.p11), angle: 180, label: '겨드랑' }].concat(nB.b), bGuide));
    } else {
      pieces.push(mk('back', '뒤판', [
        { name: '뒷목',   role: 'neck',     segs: g.bNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.p38, g.p26) },
        { name: '진동',   role: 'armhole',  segs: g.bArm },
        { name: '옆선',   role: 'side',     segs: g.bSide },
        { name: '밑단',   role: 'hem',      segs: revSegs(g.bHem) },
        { name: '등솔선', role: 'center',   segs: revSegs(g.bCb.concat(g.bCbLow)) }
      ], [[2.0, g.BL], [2.0, g.HL - 3]],
        [{ p: cp(g.p38), angle: 90, label: '목옆점' }, { p: cp(g.p11), angle: 180, label: '겨드랑' }],
        bGuide, 1));
    }
    fn('blB', '진동깊이', 'B/4 + 1.5', g.BL, 'back', [1.0, g.BL - 1.0]);
    fn('bwB', '등품/2', '등품/2', g.backW / 2, 'back', [g.p11[0] - 3, g.BL / 2]);

    /* ══ 앞판 ══════════════════════════════════════════════════ */
    var nF = levelPair(g.fSplitIn, [0, g.WL], g.fSplitOut, [g.p16[0], g.WL],
               [['BP', g.bustLen], ['허리', g.WL], ['엉덩이', g.HL]]);
    var fGuide = [
      L('blF', 'dashed', [[0, g.f41[1]], [g.f41[0], g.f41[1]]], '진동선'),
      L('wlF', 'dashed', [[0, g.WL], [g.f55[0], g.WL]], '허리선'),
      L('hlF', 'dashed', [[0, g.HL], [g.p16[0], g.HL]], '엉덩이선'),
      L('fwF', 'dashed', [[g.f46[0], g.f44[1]], [g.f46[0], g.f41[1]]], '앞품선'),
      L('bpF', 'edge', [[g.f57[0] - 0.6, g.f57[1]], [g.f57[0] + 0.6, g.f57[1]]], 'BP'),
      L('bpF2', 'edge', [[g.f57[0], g.f57[1] - 0.6], [g.f57[0], g.f57[1] + 0.6]], 'BP')
    ];
    if (split) {
      pieces.push(mk('front', '앞중심', [
        { name: '앞목',   role: 'neck',     segs: g.fNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.f53, g.f52) },
        { name: '절개선', role: 'princess', segs: g.fSplitIn },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.f61, g.f71) },
        { name: '앞중심', role: 'center',   segs: lineSegs(g.f71, g.f72) }
      ], [[-g.f71[0] + 2.0, g.BL], [-g.f71[0] + 2.0, g.HL - 3]],
        [{ p: cp(g.f53), angle: 90, label: '목옆점' }, { p: cp(g.f57), angle: 0, label: 'BP' }].concat(nF.a),
        fGuide.concat([L('cfF', 'dashed', [[0, g.f44[1]], [0, g.HL]], '앞중심 기초선')])));
      pieces.push(mk('frontSide', '앞옆', [
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.f52, g.f52) },
        { name: '진동',   role: 'armhole',  segs: g.fArm },
        { name: '옆선',   role: 'side',     segs: g.fSide },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.p16, g.f60) },
        { name: '절개선', role: 'princess', segs: revSegs(g.fSplitOut) }
      ], [[g.f58[0] + 3.0, g.BL], [g.f58[0] + 3.0, g.HL - 3]],
        [{ p: cp(g.f41), angle: 180, label: '겨드랑' }].concat(nF.b), fGuide));
    } else {
      pieces.push(mk('front', '앞판', [
        { name: '앞목',   role: 'neck',     segs: g.fNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.f53, g.f52) },
        { name: '진동',   role: 'armhole',  segs: g.fArm },
        { name: '옆선',   role: 'side',     segs: g.fSide },
        { name: '밑단',   role: 'hem',      segs: revSegs(g.fHem) },
        { name: '앞중심', role: 'center',   segs: lineSegs(g.f71, g.f72) }
      ], [[-g.f71[0] + 2.0, g.BL], [-g.f71[0] + 2.0, g.HL - 3]],
        [{ p: cp(g.f53), angle: 90, label: '목옆점' }, { p: cp(g.f57), angle: 0, label: 'BP' }],
        fGuide));
    }
    fn('fwF', '앞품/2', '앞품/2', g.frontW / 2, 'front', [g.f46[0] - 3, g.BL / 2]);
    fn('bpF', 'BP', '(유폭/2, 유장)', g.bustLen, 'front', [g.f57[0] + 1, g.f57[1] + 1]);

    /* 너치 각 보정 — **틱 끝점의 point-in-polygon** 으로 정한다 (무게중심은 오목한 변에서 샌다) */
    pieces.forEach(function (pc) {
      (pc.notches || []).forEach(function (n) {
        function ok(deg) { var r = deg * Math.PI / 180;
          return ptInPoly([n.p[0] + Math.cos(r) * 0.5, n.p[1] + Math.sin(r) * 0.5], pc.outline); }
        if (ok(n.angle)) return;
        for (var t = 5; t <= 180; t += 5) {
          if (ok(n.angle + t)) { n.angle += t; return; }
          if (ok(n.angle - t)) { n.angle -= t; return; }
        }
      });
    });
    return {
      pieces: pieces, warnings: warnings, notes: [],
      meta: { formulaNotes: FN },
      measures: {
        B: r4(g.B), 유B: r4(g['유B']), W: r4(g.W), H: r4(g.H),
        BL: r4(g.BL), WL: r4(g.WL), HL: r4(g.HL), 유차: r4(g['유차']),
        ahBack: r4(g.ahBack), ahFront: r4(g.ahFront), AH: r4(g.AH),
        shoulderBack: r4(V.dist(g.p38, g.p26)), shoulderFront: r4(V.dist(g.f53, g.f52))
      }
    };
  }

  return {
    measuresForSize: measuresForSize,
    draftVest: draftVest, draft: draftVest, geom: geom, sleeveGeom: sleeveGeom,
    MEAS_KEYS: MEAS_KEYS, MEAS_LABEL: MEAS_LABEL, SIZES: Object.keys(SIZE_STEP),
    BASE: BASE, GRADE: GRADE, K: K, CAL: CAL, FLATTEN: FLATTEN,
    SEAM_DEFAULT: SEAM_DEFAULT, SEAM_ROLES: SEAM_ROLES,
    SLEEVE_TYPE: SLEEVE_TYPE, SLEEVE_TYPES: SLEEVE_TYPES,
    util: { V: V, bez: bez, bezLen: bezLen, sLen: sLen, through: through, splineSegs: splineSegs,
            endTan: endTan, sPath: sPath, LN: LN,
            sampleSegs: sampleSegs, polyLen: polyLen, offsetLoop: offsetLoop, offsetLoopSeg: offsetLoopSeg,
            normSeam: normSeam, lineSegs: lineSegs,
            rotv: rotv, rotAbout: rotAbout, perpToward: perpToward, revSegs: revSegs }
  };
});
