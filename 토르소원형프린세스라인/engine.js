/* ============================================================================
 * 토르소 원형 프린세스라인 — 제도 엔진
 *   · 조각 4장 — 뒷면 · 뒷옆면 · 앞옆면 · 앞면 (프린세스 절개)
 *   · 정답지: dxf-66-groundtruth.json (원본 `토르소원형프린세스라인.dxf` 66호 실측)
 *
 * 좌표계: cm. 뒤 = 뒤중심선 × 상단 기준선 · 앞 = 앞중심선 × 같은 상단선.
 *         x 옆으로 + · y 아래 +. 목옆점은 앞뒤 모두 상단선 **위**에 있다(음수 y).
 *
 * 노출: window.TorsoEngine / module.exports
 * ==========================================================================*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.TorsoEngine = api; }
  else if (root) root.TorsoEngine = api;
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
  /* ══════════════════════════════════════════════════════════════════
   * 1. 치수와 그레이딩 (66호 = 원본 `토르소원형프린세스라인.dxf` 실측)
   * ════════════════════════════════════════════════════════════════ */
  var BASE  = { B: 87.6, W: 73.6, H: 97.04, backLen: 37.5, coatLen: 58.5,
                shoulderW: 38.0, backW: 36.8, frontW: 34.3, bpSpan: 19.0, hipLen: 19.0 };
  var GRADE = { B: 6.0,  W: 6.0,  H: 6.0,  backLen: 0.5,  coatLen: 0.8,
                shoulderW: 0.8, backW: 1.2, frontW: 1.2, bpSpan: 0.5, hipLen: 0.3 };
  var SIZE_STEP = { '44호': -2, '55호': -1, '66호': 0, '77호': 1, '88호': 2 };
  var MEAS_KEYS = ['B', 'W', 'H', 'backLen', 'coatLen', 'shoulderW', 'backW', 'frontW', 'bpSpan', 'hipLen'];
  var MEAS_LABEL = { B: '가슴둘레', W: '허리둘레', H: '엉덩이둘레', backLen: '등길이', coatLen: '옷길이',
                     shoulderW: '어깨너비', backW: '등품', frontW: '앞품',
                     bpSpan: '유폭', hipLen: '엉덩이길이' };

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
   * 2. 제도 상수  ([ ] 안이 66호 정답지 실측값)
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;
  var K = {
    frontEase    : 1.5,     // 앞 가슴선 = B/4 + 여유분 [23.400]
    neckWDivB    : 12,      // 목너비 기준 B/12 [7.3]
    backNeckAdd  : 0.95,    // 뒷목너비 = B/12 + 0.95 [8.2505]
    bnpRise      : 0.30,    // BNP 를 상단선 위로 [0.2995]
    backSnpRise  : 2.49,    // 뒤 목옆점을 상단선 위로 [2.4910]
    frontSnpRise : 1.00,    // 앞 목옆점을 상단선 위로 [1.0]
    frontNeckAdd : 0.30,    // 앞목깊이 = B/12 + 0.3 [7.6]
    frontSpOut   : 1.015,   // 앞 어깨점 x = 앞품/2 + 1.015 [18.165]
                            //   ※ 원형 II(+1.0)·III(+1.25) 와 같은 구조. 도면엔 표기가 없다
    /* 앞 밑단은 뒤보다 **1.463 아래**다 (앞처짐). 도면 회전 전 절개선 밑단 (8.895, 59.963) ·
       옆선 밑단 (24.675, 59.963) 인데 뒤 밑단은 58.5 다. x 는 8.900 으로 이미 맞았고
       세로만 틀려 있었다. */
    frontHemDrop : 1.463,
    frontSpDrop  : 4.00,    // 앞 어깨점 y [4.0005]
    /* ★ 뒤 어깨점은 **식으로 나온다** — 실측 상수가 아니다.
         x = 어깨너비/2 + 다트분  [19.0 + 1.3 = 20.3 · 실측 20.2993]  (도면 「어깨너비/2 + 다트분 1.3」)
         길이 = 앞 어깨선 + (뒤 다트분 − 앞 다트분)  [11.9603 + 0.7 = 12.6603 · 실측 12.6666]
                → 다트를 접으면 앞뒤가 같아진다는 봉제 제약 그 자체다
         y 는 그 길이에서 유도한다.
       ⚠ 예전에는 x·y 를 실측 상수로 박고 폭 배율만 곱해서 **66호에서만 맞았다**
         (봉제 어깨 차 44호 −1.17 · 88호 +1.20). */
    /* 프린세스 — 앞뒤 모두 **어깨선을 정확히 2등분**한 자리에서 출발한다 (도면 ✳ 표시) */
    princessAt   : 0.5,
    frontDartSh  : 0.60,    // 앞 어깨 벌림 [0.600]
    backDartSh   : 1.30,    // 뒤 어깨 다트분 [1.300]
    /* 옆선 — BL·허리·밑단의 x. 허리는 들임 결과값이다 */
    fSideBL      : 23.400,  // = B/4 + 여유분 1.5
    fSideWaist   : 22.100,  // [22.100]
    fSideHem     : 24.675,  // [24.675]
    bSideBL      : 24.989,  // [24.989]  ※ H/4 + 1.9 = 26.16 이 아니라 실측 24.989
    bSideWaist   : 24.041,  // [24.041]
    bSideHem     : 26.264,  // [26.264]
    /* 뒤중심 — 허리에서 1.24 들이고 밑단에서 1.0 */
    bCenterBL    : 0.533,   // [0.533]
    bCenterWaist : 1.244,   // [1.244]
    bCenterHem   : 0.999,   // [0.999]
    /* 앞 옆선 가슴다트 — BL 에서 6.2 내려간 자리에서 1.5 벌린다 (꼭짓점 BP) */
    fBustDartAt  : 6.20,    // [호 6.201]
    fBustDartAmt : 1.50,    // [1.5005]
    /* BP */
    bpDrop       : 26.294,  // BP y [26.2944] — 유폭/2 가 x
    /* 프린세스 허리 위치 */
    fPrinWaistIn : 8.60,    // 앞 절개 허리 앞쪽 다리 x [유추 — BP 기준]
    fPrinWaistOut: 10.60,
    /* ★ 허리 다트는 상수가 아니라 **남는 양**이다 (도면의 `○` `c` 배분 표시).
         뒤 다트분 = (뒤 옆선허리 − 뒤중심허리) − (W/4 + 여유분 1.9)
                   = (24.041 − 1.244) − (18.4 + 1.9) = 22.797 − 20.3 = 2.497  [실측 2.503]
         앞 다트분 = (앞 옆선허리 − 0) − (W/4 + 여유분 1.5)
                   = 22.100 − 19.9 = 2.200
       예전에는 좌우 x 를 실측 상수로 박고 폭 배율만 곱해 호수마다 어긋났다. */
    /* 암홀 — 품선에 **접**한다 (앞 최소 x = 앞품/2 정확히 · 뒤는 등품/2 + 0.04).
       접점에서 끊어 두 조각으로 그리고, 겨드랑 쪽에 오목점 하나를 더 둔다. */
    /* 뒤 품선 위끝 — 앞은 어깨점 y 를 그대로 쓰면 맞는데(길이 차 0.0005) 뒤는 상단선(0)
       으로 하면 2등분점이 10.95 가 되어 실측 10.585 와 0.365 어긋난다. 실측에서 역산한
       −0.73 을 쓴다. 이 값이 무엇에서 나오는지는 [미확정]. */
    fNeckPassX   : 5.13,    // 앞목둘레 통과점 [실측 (5.13, 4.57)]
    fNeckPassY   : 4.57,
    bSideMidX    : 24.10,   // 뒤 옆선 앵커 [실측 (24.10, 29.38)]
    bSideMidY    : 29.38,
    bPrinOutX3   : 12.76,   // 뒤 절개 바깥 앵커 3 [실측 (12.76, 29.99)]
    bPrinOutY3   : 29.99,
    bPrinInX3    : 11.79,   // 뒤 절개 안쪽 앵커 3 [실측 (11.79, 54.50)]
    bPrinInY3    : 54.50,
    bArmTopY     : -0.73,
    bArmTanY     : 10.585,  // 뒤 암홀 접점 y [10.585] — 위 값의 2등분 결과
    bArmTanOut   : 0.040,   // 뒤 접점 x = 등품/2 + 0.04
    bArmLowX     : 20.00,   // 뒤 오목점 x (y=20) [20.00]
    fArmTanY     : 12.717,  // 앞 암홀 접점 y [12.717]
    fArmTanOut   : 0.000,   // 앞 접점 x = 앞품/2 정확히
    fArmLowX     : 19.02,   // 앞 오목점 x (y=20) [19.02]
    armLowY      : 20.0,
    backWaistEase: 1.9,     // 뒤 허리 여유분
    frontWaistEase: 1.5,    // 앞 허리 여유분
    /* 뒤 절개선 두 다리는 **모양이 다르다** — 바깥은 안으로 들어갔다 나오고(호/현 1.0085),
       안쪽은 단조 감소(1.0007). 어깨~허리 사이 두 자리를 앵커로 박는다 (정답지 실측). */
    bPrinOutX1   : 12.384,  // 바깥 다리 y=10  [12.384]
    bPrinOutX2   : 12.452,  // 바깥 다리 y=BL  [12.452]
    bPrinInX1    : 12.335,  // 안쪽 다리 y=10  [12.335]
    bPrinInX2    : 11.344,  // 안쪽 다리 y=BL  [11.344]
    bPrinY1      : 10.0,
    bPrinCx      : 11.9005, // 뒤 절개 허리 중심 x [(13.1493 + 10.6493)/2]
    /* 밑단에서 두 다리가 교차해 좌우로 0.6 씩 벌어진다 */
    hemSplay     : 0.60,    // [앞뒤 공통 0.6]
    /* ★ 밑단 절개는 **다트 중심에서 좌우 같은 값**으로 벌린다 (도면 「0.6 0.6 (¼)(¼)」).
       실측 상수를 넷 박아 뒀는데 앞 바깥만 9.881 로 틀려 있었다 — 그 값은 정답지에서
       **끊긴 곡선의 끝점**(y 56.063)이라 밑단이 아니었다. 뒤는 11.904 ∓ 0.600 으로
       도면과 정확히 맞았다. 하나로 합치면 앞뒤가 같은 규칙이 되고 전 호수가 따라온다.
       (프린세스판에서 물려받은 오독 — 2026-08-12 사용자 지적) */
    hemSplit     : 0.60
  };
  var CAL = {
    backNeck : { mx: 0.70, my: 0.20, a0: 10, k0: 1.60, k1: 0.60 },
    frontNeck: { a0: 0, a1: -4, k0: 1.20, k1: 1.00 },
    /* 뒤 암홀 — 오목점을 「수선의 중점」이 아니라 **도면 실측 자리**로 바꾸니 잡혔다
       (편차 0.475 → 0.058 · 길이 24.781 vs 도면 24.782). 앞은 수선의 중점이 맞는데
       뒤만 다르다 — 왜인지는 [미확정].
       ★ 통과점 두 개는 **자기 구간 안의 비율**이다 (절대 좌표 아님).
       66호 실측 y(4.86 · 20.81)를 그대로 박아 뒀더니 BL = B/4 는 호수당 1.5 움직이는데
       통과점은 안 움직여, **44호 암홀이 겨드랑선 아래로 2.26 파고들어** 갈고리가 됐다
       (55호 0.41 · 암홀 길이도 25.92→24.51→24.74→25.72→27.01 로 역전, 2026-08-12 QA).
       비율로 바꾸면 66호 값은 그대로이면서 전 호수가 따라 움직인다.
         upT  = (4.86 − SP_y) / (A_y − SP_y)      · upFx  = 0.86 / (SP_x − 품선x)
         lowT = (20.81 − A_y) / (BL − A_y)        · lowFx = 2.14 / (겨드랑x − 품선x) */
    backArm  : { k0: 1.50, kA: 1.10, kB: 1.50, k1: 2.00,
                 upFx: 0.452632, upT: 0.377176,
                 lowFx: 0.324784, lowT: 0.903668 },   // 66호 편차 0.058
    frontArm : { k0: 0.30, kA: 1.60, kB: 1.60, k1: 1.60 },
    side     : { k0: 0.60, k1: 1.20 },
    princess : { k0: 0.20, k1: 0.20 }
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도 — 좌표계는 앞뒤 따로 (SPEC §1)
   *    뒤 = 뒤중심선 × 상단 기준선 · 앞 = 앞중심선 × 같은 상단선. x 옆으로 + · y 아래 +
   * ════════════════════════════════════════════════════════════════ */
  function rotAbout(p, c, a) {
    var s = Math.sin(a), co = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1];
    return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co];
  }
  function num(v, d) { return (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v; }
  function gscale(m) { return (num(null, m.B) - BASE.B) / GRADE.B; }

  function geom(m, opt) {
    opt = opt || {};
    var B = num(opt.B, m.B), W = num(opt.W, m.W), H = num(opt.H, m.H);
    var step = (B - BASE.B) / GRADE.B;                    // 실측 상수를 태울 그레이딩 배율
    var s = 1 + step * 0.06;                              // 폭 방향 근사 배율 [유추]
    var BL     = B / 4;                                   // 진동깊이 [21.9]
    var WLb    = num(opt.backLen, m.backLen);             // 허리 [37.5]
    var hemY   = num(opt.coatLen, m.coatLen);             // 밑단 [58.5]
    var hipY   = WLb + num(opt.hipLen, m.hipLen);         // 엉덩이선
    var frontW = num(opt.frontW, m.frontW), backW = num(opt.backW, m.backW);
    var bpSpan = num(opt.bpSpan, m.bpSpan);
    var nw     = B / K.neckWDivB;

    /* ───────── 뒤판 ───────── */
    var BNP  = [0, -K.bnpRise];
    var SNPb = [nw + K.backNeckAdd, -K.backSnpRise];
    var SPb = null;   // 앞 어깨선을 먼저 낸 뒤 아래에서 정한다
    var bPitchX = backW / 2;
    var Ub   = [K.bSideBL * s, BL];
    var bWaistSide = [K.bSideWaist * s, WLb];
    var bHemSide   = [K.bSideHem * s, hemY];
    var shLenBack = 0, shDirB = null;   // 아래 ③ 에서 채운다
    var bMid, half, bPrinA, bPrinB;   // 뒤 어깨점이 정해진 뒤 아래 ④ 에서 채운다
    var bWaistW = K.bSideWaist * s - K.bCenterWaist * s;          // 뒤 허리 총폭
    var bDart = Math.max(0.2, bWaistW - (W / 4 + K.backWaistEase)); // 남는 양이 다트분
    var bCx = K.bPrinCx * s;
    var bPwA = [bCx + bDart / 2, WLb], bPwB = [bCx - bDart / 2, WLb];
    var bHemCx = (bPwA[0] + bPwB[0]) / 2;                 // 뒤 다트 중심 (DXF 11.904)
    var bPhA = [bHemCx - K.hemSplit, hemY], bPhB = [bHemCx + K.hemSplit, hemY];

    /* ───────── 앞판 ───────── */
    var SNPf = [nw, -K.frontSnpRise];
    var FNP  = [0, nw + K.frontNeckAdd];
    var fPitchX = frontW / 2;
    var SPf  = [fPitchX + K.frontSpOut, K.frontSpDrop];
    var Uf   = [K.fSideBL * s, BL];
    var fWaistSide = [K.fSideWaist * s, WLb];
    var fHemY      = hemY + K.frontHemDrop;          // 앞 밑단은 뒤보다 아래
    var fHemSide   = [K.fSideHem * s, fHemY];
    var BP   = [bpSpan / 2, K.bpDrop];
    var shLenFront = V.dist(SNPf, SPf);
    var shDirF     = V.norm(V.sub(SPf, SNPf));
    /* ③ 뒤 어깨점 — 앞 어깨선 길이가 정해진 뒤라야 낼 수 있다 */
    shLenBack = shLenFront + (num(opt.backDartSh, K.backDartSh) - num(opt.frontDartSh, K.frontDartSh));
    var bSpX  = num(opt.shoulderW, m.shoulderW) / 2 + num(opt.backDartSh, K.backDartSh);
    var bSpDx = bSpX - SNPb[0];
    SPb = [bSpX, SNPb[1] + Math.sqrt(Math.max(shLenBack * shLenBack - bSpDx * bSpDx, 0.01))];
    shDirB = V.norm(V.sub(SPb, SNPb));
    /* ④ 뒤 프린세스 시작 — 어깨선 2등분 자리에서 다트분만큼 벌린다 */
    bMid   = V.add(SNPb, V.mul(shDirB, shLenBack * K.princessAt));
    half   = num(opt.backDartSh, K.backDartSh) / 2;
    bPrinA = V.add(bMid, V.mul(shDirB,  half));           // 옆쪽 다리
    bPrinB = V.add(bMid, V.mul(shDirB, -half));           // 중심쪽 다리
    var fMid   = V.add(SNPf, V.mul(shDirF, shLenFront * K.princessAt));
    var halfF  = num(opt.frontDartSh, K.frontDartSh) / 2;
    var fPrinA = V.add(fMid, V.mul(shDirF,  halfF));      // 옆쪽 다리 (앞옆면)
    var fPrinB = V.add(fMid, V.mul(shDirF, -halfF));      // 중심쪽 다리 (앞면)
    var fWaistW = K.fSideWaist * s;                                // 앞 허리 총폭 (앞중심 0 부터)
    var fDart = Math.max(0.2, fWaistW - (W / 4 + K.frontWaistEase));
    var fCx = BP[0];                                               // 앞 다트 중심 = BP 수직
    var fPwA = [fCx + fDart / 2, WLb], fPwB = [fCx - fDart / 2, WLb];
    var fPhA = [fCx - K.hemSplit, fHemY],  fPhB = [fCx + K.hemSplit, fHemY];

    /* ───────── 곡선 ───────── */
    var backNeck  = curveBackNeck(BNP, SNPb, SPb);
    var frontNeck = curveFrontNeck(FNP, SNPf, nw, SPf);
    var backArm   = armCurve(SPb, bPitchX, K.bArmTopY, Ub, BL, CAL.backArm);
    var frontArm  = armCurve(SPf, fPitchX, SPf[1],      Uf, BL, CAL.frontArm);
    /* 옆선 — BL → 허리 → 밑단 (허리에서 들어갔다 밑단에서 다시 나온다) */
    var backSide  = sideCurve(Ub, bWaistSide, bHemSide, [K.bSideMidX * s, K.bSideMidY]);
    /* 앞 옆선은 BL 아래 6.2 에서 가슴다트로 끊긴다 — 위 조각 · 다트 · 아래 조각 */
    var fSideFull = sideCurve(Uf, fWaistSide, fHemSide);
    var wedge = wedgeOn(fSideFull, BP, num(opt.bustDartAt, K.fBustDartAt),
                        num(opt.bustDartAmt, K.fBustDartAmt));
    /* 다트 회전각 = 다트분 / 다트 다리 (BP → 다트 입). 도면 실측 6.402~6.439° */
    var dartAng = num(opt.bustDartAmt, K.fBustDartAmt) / Math.max(V.dist(BP, wedge.pTop), 0.01);

    return {
      m: m, opt: { B: B, W: W, H: H }, B: B, W: W, H: H, scale: s,
      bDart: bDart, fDart: fDart,
      BL: BL, WLb: WLb, hipY: hipY, hemY: hemY,
      BNP: BNP, SNPb: SNPb, SPb: SPb, Ub: Ub, bWaistSide: bWaistSide, bHemSide: bHemSide,
      bPitchX: bPitchX, shLenBack: shLenBack,
      bPrinA: bPrinA, bPrinB: bPrinB, bPwA: bPwA, bPwB: bPwB, bPhA: bPhA, bPhB: bPhB,
      backNeck: backNeck, backArm: backArm, backSide: backSide,
      bCenter: [[0, -K.bnpRise], [K.bCenterBL * s, BL], [K.bCenterWaist * s, WLb], [K.bCenterHem * s, hemY]],
      SNPf: SNPf, FNP: FNP, SPf: SPf, Uf: Uf, fWaistSide: fWaistSide, fHemSide: fHemSide,
      fPitchX: fPitchX, BP: BP, shLenFront: shLenFront, fHemY: fHemY,
      fPrinA: fPrinA, fPrinB: fPrinB, fPwA: fPwA, fPwB: fPwB, fPhA: fPhA, fPhB: fPhB,
      frontNeck: frontNeck, frontArm: frontArm,
      /* ★ 밑단 모서리는 **다트를 돌린 뒤의 옆선 끝**이다. 안 돌린 자리(fHemSide)를 쓰면
         외곽선이 그만큼 벌어진다 — 다트를 접었을 때 맞도록 옆선을 따라 연장하는 제도법.
         (숙녀복 기본원형2 소맷부리를 다트분만큼 연장한 것과 같은 원리) */
      /* ── 가슴다트 회전 ────────────────────────────────────────────────
       *  제도(geom 의 프레임)는 다트가 **열려** 있다 — 옆선 위 6.2 · 간격 1.5 · 옆선 아래.
       *  다트를 접으면 **BP 를 축으로 BP 아래 전체**가 돈다 (옆선 하부 · 밑단 ·
       *  절개선 BP~밑단). DXF 대역 A 의 「다트회전」 도면 두 벌로 확인했다:
       *      회전 전 : 옆선위 끝 (1626.39,1444.99) · 옆선아래 시작 (1626.25,1443.50) 간격 1.497
       *      회전 후 : 둘 다 (1653.53,1444.97) — 이어진다
       *  회전각은 상수가 아니라 **두 다리의 실제 각도차**로 잰다 (아래 dartClose).
       *  계산식 다트분/다리 = 6.414° 와 도면 실측 6.402~6.439° 가 이를 검증한다.  */
      dartAng: dartAng,
      /* 닫는 회전각 — ∠(BP→위 다리) − ∠(BP→아래 다리). 음수(반시계쪽) −6.25° 쯤 */
      dartClose: Math.atan2(wedge.pTop[1] - BP[1], wedge.pTop[0] - BP[0]) -
                 Math.atan2(wedge.pBot[1] - BP[1], wedge.pBot[0] - BP[0]),
      openBelow: function (segs) { return rotSegsBelow(segs, BP, dartAng); },
      closeBelow: function (segs) { return rotSegsBelow(segs, BP, -dartAng); },
      fSideFull: fSideFull, fHemSideCut: wedge.hem,
      fSideTop: wedge.top, fSideBot: wedge.bot, wedgeTop: wedge.pTop, wedgeBot: wedge.pBot,
      wedgeAmt: wedge.amt,
      /* 프린세스 곡선 — 어깨 → (앞은 BP) → 허리 → 밑단 */
      bPrinOut: princess(bPrinA, null, bPwA, bPhA,
                 [[K.bPrinOutX1 * s, K.bPrinY1], [K.bPrinOutX2 * s, BL],
                  [K.bPrinOutX3 * s, K.bPrinOutY3]]),
      bPrinIn : princess(bPrinB, null, bPwB, bPhB,
                 [[K.bPrinInX1 * s, K.bPrinY1], [K.bPrinInX2 * s, BL]]),
                 /* 밑단 쪽(y 54.5)에 앵커를 더해 봤으나 0.312 → 0.415 로 나빠져 뺐다 */
      fPrinOut: princess(fPrinA, BP, fPwA, fPhA),
      fPrinIn : princess(fPrinB, BP, fPwB, fPhB)
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 4. 곡선
   * ════════════════════════════════════════════════════════════════ */
  function curveBackNeck(BNP, SNP, SP) {
    var C = CAL.backNeck, Mp = [SNP[0] * C.mx, SNP[1] * C.my];
    var sd = V.norm(V.sub(SP, SNP));
    return splineSegs([SNP, Mp, BNP],
      endTan(rotv([-sd[1], sd[0]], C.a0), C.k0), endTan([-1, 0], C.k1));
  }
  function curveFrontNeck(FNP, SNP, nw, SP) {
    /* 통과점 — 목사각 대각선 2/3 + 0.3 식으로 하면 y 2.5~6.1 구간이 0.34 바깥으로 나간다.
       도면 실측 자리(5.13, 4.57)를 쓴다 [식 미확정]. */
    var C = CAL.frontNeck;
    var P = [K.fNeckPassX * (nw / 7.3), K.fNeckPassY];
    var sd = V.norm(V.sub(SP, SNP));
    return splineSegs([FNP, P, SNP],
      endTan(rotv([1, 0], C.a0), C.k0), endTan(rotv([sd[1], -sd[0]], C.a1), C.k1));
  }
  /** 암홀 — 어깨점 → **품선 접점**(수직 접선) → 오목점 → 겨드랑(수평 도착).
   *  접점에서 끊어 두 조각으로 그린다 (숙녀복 기본원형 III 과 같은 구성). */
  function armCurve(SP, pitchX, pitchTop, U, BL, C) {
    /* 숙녀복 기본원형 III 과 같은 작도다:
       · 품선 위끝(뒤 = 상단선 0 · 앞 = 어깨점 y) ~ BL 을 **2등분**한 자리에서 품선에 접한다
         [실측 뒤 10.585 (식 10.95) · 앞 12.717 (식 12.95)]
       · 오목점 = 품선×BL 모서리에서 [2등분점 → 겨드랑] 현에 내린 **수선의 중점** */
    var A  = [pitchX, (pitchTop + BL) / 2];
    var d  = V.norm(V.sub(U, A));
    var Cn = [pitchX, BL];
    var F  = V.add(A, V.mul(d, (Cn[0] - A[0]) * d[0] + (Cn[1] - A[1]) * d[1]));
    var H  = _lerp(Cn, F, 0.5);
    /* 위 구간에 통과점이 하나 더 필요하다 — 어깨점 → 접점 사이가 2점 스플라인이면
       장력을 최대로 줘도 도면만큼 안 휜다 (뒤 암홀 길이가 0.31 모자랐다). */
    /* ★ 통과점은 **자기 구간 안의 비율**로 잡는다 — 절대 좌표를 박으면 BL 이 호수 따라
       움직일 때 따라가지 못해 44호 암홀이 겨드랑선 아래로 파고든다 (CAL.backArm 주석). */
    var up = C.upT !== undefined
      ? [SP, [pitchX + (SP[0] - pitchX) * C.upFx, SP[1] + (A[1] - SP[1]) * C.upT], A]
      : [SP, A];
    /* 아래 구간도 앵커가 오목점 하나뿐이면 겨드랑 근처에서 0.47 안으로 들어간다.
       도면 자리를 하나 더 박는다 — 이것도 비율이다. */
    var lo = C.lowT !== undefined
      ? [A, [pitchX + (U[0] - pitchX) * C.lowFx, A[1] + (U[1] - A[1]) * C.lowT], U]
      : [A, H, U];
    return splineSegs(up, endTan(V.norm(V.sub(up[1], SP)), C.k0), endTan([0, 1], C.kA))
      .concat(splineSegs(lo, endTan([0, 1], C.kB), endTan([1, 0], C.k1)));
  }
  /** 옆선 — 겨드랑 → 허리(들임) → 밑단. 허리에서 잘록하고 밑단에서 다시 나간다 */
  function sideCurve(U, waist, hem, mid) {
    var C = CAL.side;
    var pts = mid ? [U, mid, waist, hem] : [U, waist, hem];
    return splineSegs(pts, endTan([0, 1], C.k0), endTan([0, 1], C.k1));
  }
  /** 프린세스 절개선 — 어깨 절개점 → (앞은 BP 통과) → 허리 → 밑단 */
  function princess(shoulder, bp, waist, hem, mids, lows) {
    var C = CAL.princess;
    var pts = bp ? [shoulder, bp, waist, hem]
                 : [shoulder].concat(mids || [], [waist], lows || [], [hem]);
    return splineSegs(pts, endTan(V.norm(V.sub(bp || waist, shoulder)), C.k0),
      endTan([0, 1], C.k1));
  }
  /** c 를 축으로 **c 보다 아래(y 큰) 구간만** a(rad) 돌린다. 다트를 닫는 데 쓴다.
   *  ⚠ 판정은 「두 끝점이 **모두** c 아래(또는 c 위)일 때만 회전」이다.
   *    반대로 「둘 다 위가 아니면 회전」으로 하면 c 를 걸친 세그먼트(어깨→BP)가
   *    통째로 돌아 폐곡선이 2.72 깨졌다 (2026-08-11 되돌린 커밋의 원인).
   *    프린세스 곡선은 BP 가 스플라인 **앵커**라 세그먼트 경계가 정확히 BP 에 있다 —
   *    그래서 걸친 세그먼트를 자를 필요 없이 이 판정으로 충분하다. */
  function rotSegsBelow(segs, c, a) {
    if (!a) return segs;
    return segs.map(function (g) {
      var below = g.p0[1] >= c[1] - 1e-4 && g.p1[1] >= c[1] - 1e-4;
      if (!below) return g;
      return { p0: rotAbout(g.p0, c, a), c1: rotAbout(g.c1, c, a),
               c2: rotAbout(g.c2, c, a), p1: rotAbout(g.p1, c, a) };
    });
  }
  /** 앞 옆선 가슴다트 — 겨드랑에서 `at` 내려간 자리에서 `amt` 만큼 벌린다 (꼭짓점 BP) */
  function wedgeOn(sideSegs, BP, at, amt) {
    var pts = sampleSegs(sideSegs, 0.02), acc = 0, i = 1;
    for (; i < pts.length; i++) { acc += V.dist(pts[i - 1], pts[i]); if (acc >= at) break; }
    if (i >= pts.length) i = pts.length - 1;
    /* ★ 이 다트는 옆선 길이를 **줄이지 않는다** — 아래 조각을 BP 축으로 돌려 벌릴 뿐이다.
       정답지: 앞 옆선 위 6.201 + 아래 30.644 = 36.845 ≈ 뒤 옆선 36.832 (차 0.013).
       길이를 빼는 방식(숙녀복 기본원형 III 의 웨지)으로 하면 앞이 1.4 짧아진다. */
    /* ★ 다트는 옆선에서 `amt` 를 **덜어낸다** — 회전이 아니다.
       도면: 옆선 위 6.201 + 아래 30.644 = 36.845 ≈ 뒤 옆선 36.832.
       전체 옆선 38.31 에서 다트 1.5 를 빼야 뒤와 맞는다 (안 빼면 −1.5045 벌어진다).
       접었을 때 두 변이 만나는 것은 다트 다리 길이가 BP 에서 같기 때문이다. */
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
   * 6. 조각 — 프린세스 **4장** (뒷면 · 뒷옆면 · 앞옆면 · 앞면)
   * ════════════════════════════════════════════════════════════════ */
  function draftTorso(m, opt) {
    opt = opt || {};
    var seam = normSeam(opt.seam);
    var g = geom(m, opt);
    var pieces = [];

    function mk(id, name, edges, grain, notches, internal) {
      var loop = edgesToLoop(edges), sm = buildSeamline(loop, seam);
      /* ★ 너치 각은 **조각이 만들어진 뒤 일괄 보정**한다. 조각마다 `inside` 점을 손으로
         넣으면 틀린다 — 옆면 조각(x 11~26)에 중심선 [0, WL] 을 줘서 8개가 뒤집혔다.
         ⚠ 무게중심으로 보정하던 것을 **틱 끝점이 조각 안에 있는지**로 바꿨다.
         암홀처럼 **오목한** 변에서는 무게중심 방향과 폴리곤 내부가 달라, 무게중심
         기준으로는 통과하는데 실제 틱은 조각 밖으로 나갔다 (암홀 2/3 너치 2개가
         전 호수에서 그랬다 — 2026-08-12 QA). 판정은 그리는 것과 같은 방식이어야 한다. */
      (notches || []).forEach(function (n) {
        var a = n.angle * Math.PI / 180;
        if (!ptInPoly([n.p[0] + Math.cos(a) * NOTCH_TICK, n.p[1] + Math.sin(a) * NOTCH_TICK], loop.pts))
          n.angle = angDeg([-Math.cos(a), -Math.sin(a)]);
      });
      return { id: id, name: name, cutCount: (id === 'front') ? 1 : 2   /* 뒷면도 2매 — 뒤중심이 골선이 아니라 봉제선이다 */,
        kind: 'bodice', grainline: grain,
        outline: loop.pts, seamline: sm.seamline, foldEdges: sm.foldEdges,
        seamEdges: sm.seamEdges, seamFoldEdges: sm.seamFoldEdges, seamByRole: sm.seamByRole,
        edges: withSeam(loop.ranges, sm.edgeSeam), internal: internal || [],
        notches: notches || [], bbox: bboxOf(loop.pts) };
    }
    var hemY = g.hemY, WLb = g.WLb;

    /* ── 맞춤 너치 ────────────────────────────────────────────────────
     *  프린세스 4조각은 **절개선 두 짝**과 **옆선**이 맞물려야 옷이 된다.
     *  변마다 길이가 조금 다르므로 짧은 쪽 기준 비율로 양쪽 같은 자리에 찍는다.
     *  뒤 절개선은 짝 차가 0.16 쯤이라 그 여유가 허리 위쪽에서 이세로 들어간다.       */
    var dc = g.dartClose;
    var fPrinOutC = rotSegsBelow(revSegs(g.fPrinOut), g.BP, dc);   // 앞옆면 절개선 (회전 후)
    /* 절개선 짝은 **높이**로 맞춘다 (위 levelNotches 주석 참고). 앞옆면 절개선은
       BP 아래가 다트 회전을 받으므로 **회전 전 곡선에서 높이를 찾은 뒤 같이 돌린다**
       — 회전 후 곡선에서 y 를 찾으면 해부학적 높이가 아니게 된다. */
    function rotIfBelow(p) { return p[1] >= g.BP[1] - 1e-4 ? rotAbout(p, g.BP, dc) : cp(p); }
    var nBack  = levelNotches(g.bPrinIn, [0, g.WLb], g.bPrinOut, [g.bSideBL, g.WLb],
                   [['가슴선', g.BL], ['허리', g.WLb], ['엉덩이', g.hipY]]);
    var nFront = levelNotches(g.fPrinIn, [0, g.WLf], g.fPrinOut, [g.sideX, g.WLf],
                   [['가슴선', g.BL], ['BP', g.BP[1]], ['허리', g.WLb], ['엉덩이', g.hipY]],
                   null, rotIfBelow);
    var nSide  = pairNotches(g.backSide, g.fSideTop.concat(rotSegsBelow(g.fSideBot, g.BP, dc)),
                   [0.45, 0.75], [0, g.WLb], [0, g.WLf], '옆선', g.Ub);   // 기준 = 겨드랑

    /* ① 뒷면 — 뒤중심 골선 */
    pieces.push(mk('back', '뒷면', [
      { name: '뒷목둘레', role: 'neck',     segs: revSegs(g.backNeck) },
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPb, g.bPrinB) },
      { name: '절개선',   role: 'princess', segs: g.bPrinIn },
      { name: '밑단',     role: 'hem',      segs: lineSegs(g.bPhB, [g.bCenter[3][0], hemY]) },
      { name: '뒤중심',   role: 'center',   segs: revSegs(lineSegs.apply(null, g.bCenter)) }
    ], [[2.0, 4.0], [2.0, hemY - 4.0]],
      /* 허리·가슴선·엉덩이 너치는 nBack 이 절개선 위에 짝으로 찍는다 — 여기서 또
         찍으면 같은 자리에 두 개가 겹친다 */
      [{ p: cp(g.SNPb), angle: 90, label: '목옆점' }].concat(nBack.a)));

    /* ② 뒷옆면 */
    pieces.push(mk('backSide', '뒷옆면', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.bPrinA, g.SPb) },
      { name: '뒤 암홀',  role: 'armhole',  segs: g.backArm },
      { name: '옆선',     role: 'side',     segs: g.backSide },
      { name: '밑단',     role: 'hem',      segs: lineSegs(g.bHemSide, g.bPhA) },
      { name: '절개선',   role: 'princess', segs: revSegs(g.bPrinOut) }
    ], [[g.bPwA[0] + 4.0, g.BL + 2.0], [g.bPwA[0] + 4.0, hemY - 4.0]],
      [{ p: cp(g.Ub), angle: 180, label: '겨드랑' }]
        .concat(armNotches(g.backArm, g.Ub, [g.bPwA[0], g.BL + 6], '뒤 암홀'))
        .concat(nBack.b).concat(nSide.a)));

    /* ③ 앞면 — 앞중심 골선. **앞옆면보다 먼저 낸다** — 뒷면·뒷옆면과 같은 차례라야
       인쇄물에서 맞물리는 변(앞면 절개선 ↔ 앞옆면 절개선)이 이웃해 대조하기 쉽다. */
    pieces.push(mk('front', '앞면', [
      { name: '앞목둘레', role: 'neck',     segs: g.frontNeck },
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPf, g.fPrinB) },
      { name: '절개선',   role: 'princess', segs: g.fPrinIn },
      { name: '밑단',     role: 'hem',      segs: lineSegs(g.fPhB, [0, g.fHemY]) },
      { name: '앞중심',   role: 'fold',     segs: lineSegs([0, g.fHemY], g.FNP) }
    ], [[2.0, g.FNP[1] + 3.0], [2.0, g.fHemY - 4.0]],
      [{ p: cp(g.SNPf), angle: 90, label: '목옆점' }].concat(nFront.a)));

    /* ④ 앞옆면 — 가슴다트를 **BP 축으로 돌려 붙인** 조각 (DXF 「다트회전」 회전 후) */
    var wedgeBotC = rotAbout(g.wedgeBot, g.BP, dc);       // 아래 다리 입을 위 다리 쪽으로
    pieces.push(mk('frontSide', '앞옆면', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.fPrinA, g.SPf) },
      { name: '앞 암홀',  role: 'armhole',  segs: g.frontArm },
      /* ★ 다트를 붙인다 — 아래 다리를 BP 축으로 돌려 위 다리에 포갠다. BP 아래 전체
         (옆선 하부 · 밑단 · 절개선 BP~밑단)가 같이 돈다. 다리 길이가 13.457/13.567 로
         0.11 달라(도면도 0.14 다르다) 위 다리 끝 → 돌린 아래 다리 입을 짧게 이어 준다
         — 접으면 맞는 연장이다 (소맷부리 연장과 같은 처리). */
      { name: '옆선 (위)', role: 'side',    segs: g.fSideTop.concat(lineSegs(g.wedgeTop, wedgeBotC)) },
      { name: '옆선 (아래)', role: 'side',   segs: rotSegsBelow(g.fSideBot, g.BP, dc) },
      { name: '밑단',     role: 'hem',      segs: rotSegsBelow(lineSegs(g.fHemSide, g.fPhA), g.BP, dc) },
      /* 절개선은 BP 아래 구간만 돈다 — BP 가 스플라인 앵커라 rotSegsBelow 판정으로 안전 */
      { name: '절개선',   role: 'princess', segs: fPrinOutC }
    ], [[g.fPwA[0] + 4.0, g.BL + 2.0], [g.fPwA[0] + 4.0, hemY - 4.0]],
      /* ★ BP·허리·가슴선·엉덩이는 nFront 가 **앞면 절개선과 짝으로** 찍는다.
         2026-08-12 까지 앞면에만 있고 앞옆면엔 없었다(앞면 5 ↔ 앞옆면 3) —
         검증기가 라벨 '절개' 로 시작하는 것만 짝지어 봐서 통과시켰다. */
      [{ p: cp(g.Uf), angle: 180, label: '겨드랑' },
       { p: cp(g.wedgeTop), angle: 180, label: '가슴다트' },
       { p: cp(wedgeBotC), angle: 180, label: '가슴다트' }]
        .concat(armNotches(g.frontArm, g.Uf, [g.fPwA[0], g.BL + 6], '앞 암홀'))
        .concat(nFront.b).concat(nSide.b),
      [L('bustDart', 'dashed', [cp(g.wedgeTop), cp(g.BP)], '가슴다트 접음선'),
       L('bustTip',  'point',  [cp(g.BP)], 'BP')]));


    /* ★ 「중심」 안내선 — 다트/절개의 **좌우 대칭축**이다 (도면 「중심」 표기).
       앞 = BP 수직 x 9.500 · 뒤 = 허리다트 중심 x 11.904 (66호 · DXF 실측과 일치).
       조각 4장 중 3장이 internal 0개였다 — 제도선이 없으면 「이 절개가 어디서
       나왔나」를 되짚을 수 없다 (스킬 규약: 조각 하나가 internal 0개면 미완성).
       ⚠ 세로선이 조각 **밖으로 나가면 안 된다** — 허리에서는 두 조각 사이를 지나므로
       조각마다 **안에 있는 구간만** 잘라 넣는다. 판정은 point-in-polygon. */
    (function () {
      function inPoly(pt, poly) {
        var c = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          var a = poly[i], b = poly[j];
          if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
              pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
        }
        return c;
      }
      function clipRuns(x, y0, y1, poly) {
        var runs = [], cur = null, STEP = 0.1;
        for (var y = y0; y <= y1 + 1e-9; y += STEP) {
          if (inPoly([x, y], poly)) { if (!cur) cur = [y, y]; else cur[1] = y; }
          else if (cur) { runs.push(cur); cur = null; }
        }
        if (cur) runs.push(cur);
        return runs.filter(function (r) { return r[1] - r[0] >= 3.0; });   // 3cm 미만은 안 그린다
      }
      var fCxL = g.BP[0], bCxL = (g.bPwA[0] + g.bPwB[0]) / 2;
      pieces.forEach(function (pc) {
        var back = (pc.id === 'back' || pc.id === 'backSide');
        var x = back ? bCxL : fCxL;
        var y0 = back ? g.BL : g.BP[1] - 8.0, y1 = back ? hemY : g.fHemY;
        clipRuns(x, y0, y1, pc.outline).forEach(function (r, k) {
          pc.internal.push(L('center' + (k ? k + 1 : ''), 'dashed',
            [[x, r[0]], [x, r[1]]], '중심'));
        });
      });
    })();

    /* ───────── 계측 · 봉제 짝 검사 ───────── */
    function SL(s) { return sLen(s); }   // 전역 L(내부선) 과 이름이 겹치면 안 된다
    var pairs = [
      ['뒤 절개선', SL(g.bPrinIn), SL(g.bPrinOut)],
      ['앞 절개선', SL(g.fPrinIn), SL(g.fPrinOut)],
      ['옆선',     SL(g.backSide), SL(g.fSideTop) + SL(g.fSideBot)],
      ['어깨 (안)', V.dist(g.SNPb, g.bPrinB), V.dist(g.SNPf, g.fPrinB)],
      ['어깨 (밖)', V.dist(g.bPrinA, g.SPb), V.dist(g.fPrinA, g.SPf)]
    ];
    var warnings = [];
    pairs.forEach(function (w) {
      if (Math.abs(w[1] - w[2]) > 0.35)
        warnings.push(w[0] + ' 짝 ' + r4(w[1]) + ' ↔ ' + r4(w[2]) +
          ' (차 ' + r4(w[1] - w[2]) + ')');
    });

    return {
      pieces: pieces, warnings: warnings, notes: [],
      measures: {
        bust: r4(g.B), hip: r4(g.H), BL: r4(g.BL),
        backLen: r4(g.WLb), coatLen: r4(g.hemY), hipLine: r4(g.hipY),
        shoulderBack: r4(g.shLenBack), shoulderFront: r4(g.shLenFront),
        shoulderBackSewn: r4(g.shLenBack - K.backDartSh),
        shoulderFrontSewn: r4(g.shLenFront - K.frontDartSh),
        neckBack: r4(sLen(g.backNeck)), neckFront: r4(sLen(g.frontNeck)),
        neckTotal: r4(sLen(g.backNeck) + sLen(g.frontNeck)),
        /* 어깨 이세분 = 다트를 접은 뒤 뒤 − 앞. 이 원형은 이세로 먹이지 않고
           **어깨 다트/벌림**으로 처리하므로 0 이 정상이다 (UI 요약이 이 키를 읽는다). */
        shoulderEase: r4((g.shLenBack - K.backDartSh) - (g.shLenFront - K.frontDartSh)),
        armholeBack: r4(sLen(g.backArm)), armholeFront: r4(sLen(g.frontArm)),
        armholeTotal: r4(sLen(g.backArm) + sLen(g.frontArm)),
        sideBack: r4(sLen(g.backSide)), sideFront: r4(sLen(g.fSideTop) + sLen(g.fSideBot)),
        bustDart: r4(g.wedgeAmt),
        princessBackIn: r4(sLen(g.bPrinIn)), princessBackOut: r4(sLen(g.bPrinOut)),
        princessFrontIn: r4(sLen(g.fPrinIn)), princessFrontOut: r4(sLen(g.fPrinOut)),
        pieceCount: pieces.length
      },
      meta: {
        title: '토르소 원형 프린세스라인',
        source: '교재 「토르소 원형 프린세스라인」 + 원본 DXF 실측',
        sizeName: sizeNameOf(m), m: m, geom: g, warnings: warnings, notes: [],
        formulaNotes: formulaNotes(m, g), seam: seam
      }
    };
  }

  function formulaNotes(m, g) {
    return [
      FN('BL',    '진동깊이',   'B/4',                    g.BL,   'back',  [g.bPitchX * 0.5, g.BL]),
      FN('WL',    '허리선',     '등길이',                  g.WLb,  'back',  [g.bPitchX * 0.5, g.WLb]),
      FN('hem',   '밑단',       '옷길이 (△ = 옷길이 − 등길이)', g.hemY, 'back', [g.bPitchX * 0.5, g.hemY]),
      FN('bNeck', '뒷목너비',   'B/12 + ' + f1(K.backNeckAdd), g.SNPb[0], 'back', [g.SNPb[0] * 0.5, -0.6]),
      FN('bSh',   '뒤 어깨선',  '목옆점 → 어깨점',          g.shLenBack, 'back',
                  [(g.SNPb[0] + g.SPb[0]) / 2, (g.SNPb[1] + g.SPb[1]) / 2 - 0.8]),
      FN('bPrin', '뒤 절개',    '어깨선 2등분 · 다트분 ' + f1(K.backDartSh),
                  K.backDartSh, 'back', [g.bPrinB[0] - 1.0, g.bPrinB[1] + 3.0]),
      FN('fNeck', '앞목',       '너비 B/12 · 깊이 B/12 + ' + f1(K.frontNeckAdd),
                  g.FNP[1], 'front', [-1.0, g.FNP[1] * 0.5]),
      FN('fSh',   '앞 어깨선',  'x = 앞품/2 + ' + f1(K.frontSpOut) + ' (원형 II·III 과 같은 구조)',
                  g.shLenFront, 'front', [(g.SNPf[0] + g.SPf[0]) / 2, (g.SNPf[1] + g.SPf[1]) / 2 - 0.8]),
      FN('fPrin', '앞 절개',    '어깨선 2등분 · 벌림 ' + f1(K.frontDartSh) + ' · BP 통과',
                  K.frontDartSh, 'front', [g.fPrinB[0] - 1.0, g.fPrinB[1] + 3.0]),
      FN('bp',    'BP',        '유폭/2',                  m.bpSpan / 2, 'front', [g.BP[0] - 2.4, g.BP[1] - 0.6]),
      FN('wedge', '가슴다트',   '옆선 겨드랑에서 ' + f1(K.fBustDartAt) + ' 아래 · 벌림 ' + f1(K.fBustDartAmt) +
                  ' (꼭짓점 BP · **남는 다트**다)',
                  g.wedgeAmt, 'frontSide', [g.wedgeTop[0] - 3.6, (g.wedgeTop[1] + g.wedgeBot[1]) / 2]),
      FN('fSide', '앞 옆선',   '겨드랑 → 허리 → 밑단',      sLen(g.fSideTop) + sLen(g.fSideBot),
                  'frontSide', [g.fWaistSide[0] + 0.8, (g.BL + g.hemY) / 2]),
      FN('bSide', '뒤 옆선',   '겨드랑 → 허리 → 밑단',      sLen(g.backSide),
                  'backSide', [g.bWaistSide[0] + 0.8, (g.BL + g.hemY) / 2])
    ];
  }
  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }

  return {
    measuresForSize: measuresForSize,
    draftTorso: draftTorso, draft: draftTorso, geom: geom,
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
