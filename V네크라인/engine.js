/* ============================================================================
 * V 네크라인 (민소매 · 자락 앞면) — 제도 엔진
 *   · 교재 p.103 「V 네크라인 6개 패턴」
 *   · 몸판은 "기본무다트원형 치수대로" · 뒷면은 "어깨다트없는원형 뒷면 34P"
 *   · 조각 6개 — 앞면 · 뒷면 · 앞면 목둘레안단 · 앞면 암홀안단 · 뒷면 목둘레안단 · 뒷면 암홀안단
 *
 * 좌표계: cm. y = 상단 기준선에서 아래 +
 *         뒤판 x = CB 에서 옆선 방향 +
 *         앞판 x = CF 에서 옆선 방향 + / 앞중심을 넘어가는 자락은 −
 *         앞뒤가 같은 상단 기준선·같은 허리선을 쓴다 (원본 DXF 배치 그대로)
 *
 * 노출: window.VNeckEngine / module.exports  (ES module import 금지, 외부 lib 없음)
 * 곡선: 기본원형 엔진과 같은 C2 스플라인. 핸들·끝접선은 66호 원본 DXF
 *       (dxf-66-groundtruth.json) 에 맞춰 캘리브레이션했고 전부 무차원 비율이라
 *       호수가 바뀌어도 자기유사하게 스케일된다.
 * ==========================================================================*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.VNeckEngine = api;
  else if (root) root.VNeckEngine = api;
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
   * 1. 치수와 그레이딩 (SPEC §2 — 확정값. 임의 변경 금지)
   * ════════════════════════════════════════════════════════════════ */
  var BASE  = { B: 87.6, backLen: 37.5, shoulderW: 39.5, backW: 36.8, frontW: 34.3, bpLen: 24.8, bpSpan: 19.0 };
  var GRADE = { B: 6.0,  backLen: 0.5,  shoulderW: 0.8,  backW: 1.2,  frontW: 1.2,  bpLen: 0.5,  bpSpan: 0.5 };
  var SIZE_STEP = { '44호': -2, '55호': -1, '66호': 0, '77호': 1, '88호': 2 };   // SPEC §11-3 · §14
  var MEAS_KEYS = ['B', 'backLen', 'shoulderW', 'backW', 'frontW', 'bpLen', 'bpSpan'];
  var MEAS_LABEL = { B: '가슴둘레', backLen: '등길이', shoulderW: '어깨너비', backW: '등품', frontW: '앞품', bpLen: '유장', bpSpan: '유폭' };

  /** @returns {Measurements} 호수별 표준 치수 (SPEC §8) */
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
   * 2. 제도 상수 (SPEC §V-3 + 66호 V네크라인 DXF 실측 캘리브레이션)
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;          // outline/seamline 폴리라인 간격 (cm)
  var K = {
    /* ── 공통 ── */
    fixedX       : 23.5,       // 고정치수선 (전 호수 고정)
    facing       : 4.0,        // 안단너비 — 목둘레·암홀 공통 (도면 `4(1⅝)`)
    armRise      : 3.0,        // 진동 올림 — 가슴선(B/4)에서 위로. 도면 `1.9~3.1`
    armRiseMin   : 1.9,
    armRiseMax   : 3.1,

    /* ── 뒤판 (기본무다트원형 34P 그대로) ── */
    backSideEase : 1.9,        // 옆선 x = B/4 + 1.9
    backNeckRise : 0.3,        // 뒷목 중심점 y = −0.3
    backNeckLift : 3.5,        // 뒷목 옆점 올림 (목너비 사각 모서리)
    backShDrop   : 3.1,        // 뒤 어깨선이 고정치수선과 만나는 y
    backNeckExt  : 1.0,        // 목옆점 = 사각 모서리에서 어깨선 바깥 1.0
    shTipExt     : 0.6,        // 어깨점 세로 안내선 x = 어깨너비/2 + 0.6
    shEase       : 0.95,       // 뒤 어깨 이세분 (앞 어깨 = 뒤 어깨 − 이세)

    /* ── 앞판 ── */
    frontSideEase: 1.6,        // 옆선 x = B/4 + 1.6  (66호 23.5 — 원본 DXF 실측)
    frontNeckLift: 0.6,        // 앞목 옆점 y = −0.6 (도면 `0.6(¼)`)
    frontNeckDeep: 0.3,        // 앞목 깊이 = B/12 + 0.3 (도면 `B/12+0.3(⅛)` = 66호 7.6)
    frontShDrop  : 5.4,        // 앞 어깨선이 고정치수선과 만나는 y
    neckDiagRatio: 2 / 3,      // 기본 원형 앞목 곡선이 지나는 목 사각 대각선 비율
    vNeckMark    : 1.0,        // V선 통과점 = 대각선 2/3 점에서 모서리 쪽 1.0 (도면 `1(⅜)`)
    vDepthAdd    : 7.0,        // V 깊이 = 앞목깊이 + 7.0 (상단 기준선에서 아래) — 66호 14.6
    wrapUp       : 9.3,        // 자락 끝(반대 옆선) = 허리선에서 위로 9.3 — 66호 상단에서 28.2
    dartAmount   : 1.5,        // 가슴다트 분량 (도면 `1.5(⅝) 다트`)
    /* 다트 아래 다리 = 허리선에서 위로 **옆선 길이 × dartRiseRatio**.
     *  66호에서는 B/8 (10.95) 과 같은 값이고, 다른 호수만 달라진다.
     *    ratio = (87.6/8) / (37.5 − (87.6/4 − 3)) = 10.95 / 18.6
     *  왜 B/8 을 그대로 안 쓰나 — 이 원형은 겨드랑이 B/4 를 따라 호수당 1.5 내려가는데
     *  등길이는 0.5 밖에 안 늘어 **옆선이 호수당 1.0 짧아진다**(44호 20.6 → 88호 16.6).
     *  거기에 B/8 은 호수당 0.75 올라가서 둘이 1.75 씩 가까워지고, 88호에서는
     *  겨드랑~다트가 2.65 까지 붙어 암홀 안단(4)도 못 들어간다.
     *  옆선에 대한 비율로 잡으면 어느 호수에서나 같은 자리에 온다. */
    dartRiseRatio: 10.95 / 18.6,
    dartTipBack  : 0,          // 다트 끝을 BP 앞에서 멈춤 (교재 권장 1.3~1.9 · 기본 0 = BP)
    dartTipMin   : 1.3,
    dartTipMax   : 1.9,
    sideTrue     : true        // 앞 옆선을 다트분만큼 늘려 봉제 후 뒤와 맞춘다 (교재 도면엔 없음)
  };

  /* ── 곡선 캘리브레이션 ─────────────────────────────────────────────
   *  66호 원본 DXF(dxf-66-groundtruth.json) 대비 최대편차를 최소화하도록 적합.
   *  전부 무차원 비율/접선크기라 다른 호수에서도 같은 모양이 유지된다.
   *  재적합: node calibrate.js                                        */
  var CAL = {
    backNeck : { mx: 0.950000, my: 0.618739, k0: 0.251673, k1: 1.130455 },   // 편차 0.035
    backArm  : { pdx: 0.082995, pky: 0.280421, hdx: 0.850000, hdy: 0.188000,
                 k0: 1.467000, k1: 1.345000 },                               // 편차 0.071
    frontArm : { pdx: 0.020000, pky: 0.480000, hdx: 0.855000, hdy: 0.106000,
                 k0: 1.418963, k1: 1.513412 },                               // 편차 0.032
    /* V 네크라인은 DXF 도 세 조각으로 끊겨 있다(곡률 불연속). 같은 구조로 잇는다.
       up  = 어깨 목옆점 → 대각선 통과점 → 앞중심 V 점
       low = 앞중심 V 점 → 중간 앵커 → 반대 옆선 (접선은 up 끝과 이어 G1) */
    vNeckUp  : { k0: 0.600000, k1: 0.500000, endAng: 48.0000, startAng: -11.0 },  // 편차 0.053
    vNeckLow : { k0: 0.995100, k1: 0.660800, slope: 0.167200,
                 mt: 0.430200, moff: 0.090000 },                                 // 편차 0.068
    /* 밑단 — 언더암다트 원형의 uaHem 과 같은 값. 두 도막으로 그리면 앞이 평평하고
       뒤가 뚝 떨어지는 S 가 나서, 옆선 끝 → 앞중심을 한 줄로 완만하게 긋는다. */
    hem      : { k0: 1.00, k1: 1.00 }
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도
   * ════════════════════════════════════════════════════════════════ */
  function rotAbout(p, c, a) {
    var s = Math.sin(a), q = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * q - y * s, c[1] + x * s + y * q];
  }
  function num(v, d) { return (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v; }

  /** 제도점 + 곡선만 계산 (폴리라인 flatten 없음). draftVNeck 과 검증기가 공유. */
  function geom(m, opt) {
    opt = opt || {};
    MEAS_KEYS.forEach(function (k) {
      if (typeof m[k] !== 'number' || !isFinite(m[k])) throw new Error('치수 누락/오류: ' + k);
    });
    var B = m.B, nw = B / 12, WL = m.backLen;
    var shEase   = num(opt.shoulderEase, K.shEase);
    var facing   = num(opt.facing,       K.facing);
    var armRise  = num(opt.armRise,      K.armRise);
    var dartAmt  = num(opt.dartAmount,   K.dartAmount);
    var dartRise = num(opt.dartRise, (WL - (B / 4 - armRise)) * K.dartRiseRatio);
    var vDepth   = num(opt.vDepth,       nw + K.frontNeckDeep + K.vDepthAdd);
    var wrapUp   = num(opt.wrapUp,       K.wrapUp);
    var dartTipBack = num(opt.dartTipBack, K.dartTipBack);
    var sideTrue = (opt.sideTrue === undefined || opt.sideTrue === null) ? K.sideTrue : !!opt.sideTrue;

    var BL   = B / 4;               // 가슴선 — 앞뒤 공통 (상단 기준선에서 아래)
    var armY = BL - armRise;        // 겨드랑 높이 (민소매라 가슴선보다 올린다)

    /* ───────── 뒤판 ───────── */
    var bSideX = B / 4 + K.backSideEase;
    var bPitchX = m.backW / 2;
    var bSpX = m.shoulderW / 2 + K.shTipExt;
    var BNP = [0, -K.backNeckRise];
    var bNeckCorner = [nw, -K.backNeckLift];
    var bShDir = V.norm(V.sub([K.fixedX, K.backShDrop], bNeckCorner));
    var SNPb = V.add(bNeckCorner, V.mul(bShDir, K.backNeckExt));
    var SPb = [bSpX, bNeckCorner[1] + (bShDir[1] / bShDir[0]) * (bSpX - bNeckCorner[0])];
    var Ub = [bSideX, armY];
    var bWaist = [bSideX, WL];
    var shLenBack = V.dist(bNeckCorner, SPb);
    var shLenBackSeam = V.dist(SNPb, SPb);

    /* ───────── 앞판 ───────── */
    var fSideX = B / 4 + K.frontSideEase;
    var fPitchX = m.frontW / 2;
    var SNPf = [nw, -K.frontNeckLift];
    var FNP = [0, nw + K.frontNeckDeep];                 // 기본 원형 앞목 (참고 제도선)
    var fShDir = V.norm(V.sub([K.fixedX, K.frontShDrop], SNPf));
    var shLenFront = shLenBack - shEase;
    var SPf = V.add(SNPf, V.mul(fShDir, shLenFront));
    var shLenFrontSeam = V.dist(SNPf, SPf);
    var Uf = [fSideX, armY];
    var BP = [m.bpSpan / 2, SNPf[1] + m.bpLen];

    /* 가슴다트 — 아래 다리를 옆선에 두고 BP 를 중심으로 다트분만큼 돌려 위 다리를 만든다 */
    var hasDart = dartAmt > 1e-6;
    var dartLo = [fSideX, WL - dartRise];
    var dartLeg = V.dist(BP, dartLo);
    var dartAng = hasDart ? 2 * Math.asin(Math.min(0.999, dartAmt / 2 / dartLeg)) : 0;
    var dartHi = hasDart ? rotAbout(dartLo, BP, -dartAng) : cp(dartLo);
    var dartTip = (dartTipBack > 0)
      ? V.add(BP, V.mul(V.norm(V.sub(dartLo, BP)), dartTipBack)) : cp(BP);

    /* ── 옆선 트루잉 ────────────────────────────────────────────────
     *  가슴다트를 접으면 앞 옆선이 다트분만큼 짧아져 뒤(18.6)와 안 맞는다.
     *  다트 아래쪽 옆선을 그만큼 늘리고 밑단을 다시 그린다.
     *  늘림량은 "다트분" 이 아니라 **접은 뒤 뒤 옆선과 같아지는 값** 으로 잡는다
     *  (다트 위 다리가 옆선보다 조금 바깥으로 나가 있어 다트분과 미세하게 다르다).
     *  교재 도면 그대로 보려면 opt.sideTrue = false. */
    var sideBackLen = WL - armY;                       // 뒤 옆선 (겨드랑 → 허리)
    var sideUpper = V.dist(Uf, dartHi);                // 앞 옆선 위쪽 (겨드랑 → 다트 위 다리)
    var hemDrop = 0;
    if (sideTrue && hasDart)
      hemDrop = Math.max(0, (dartLo[1] + (sideBackLen - sideUpper)) - WL);
    var fWaist = [fSideX, WL + hemDrop];

    /* V 네크라인 — 목옆점 → 대각선 통과점 → 앞중심 V 점 → 반대 옆선(자락 끝) */
    var diagCorner = [nw, FNP[1]];
    var diag2 = [nw * K.neckDiagRatio, FNP[1] * K.neckDiagRatio];
    var vMark = V.add(diag2, V.mul(V.norm(V.sub(diagCorner, diag2)), K.vNeckMark));
    var Vcf  = [0, vDepth];
    var Vend = [-fSideX, WL - wrapUp];
    var wrapWaist = [-fSideX, WL];

    /* ───────── 곡선 ───────── */
    var backNeck = curveBackNeck(BNP, SNPb, bShDir);
    var backArm  = curveArmhole(Ub, SPb, bShDir, bPitchX, armY, true);
    var frontArm = curveArmhole(Uf, SPf, fShDir, fPitchX, armY, false);
    var vc       = curveVNeck(SNPf, vMark, Vcf, Vend, fShDir);   // 목옆점 → 자락 끝
    var vNeck    = vc.all;
    var frontHem = curveFrontHem(fWaist, [0, WL], V.norm(V.sub(fWaist, dartLo)));

    return {
      m: m, opt: { shEase: shEase, facing: facing, armRise: armRise, dartAmount: dartAmt,
                   dartRise: dartRise, vDepth: vDepth, wrapUp: wrapUp, dartTipBack: dartTipBack },
      nw: nw, WL: WL, BL: BL, armY: armY, shEase: shEase, facing: facing,
      bSideX: bSideX, bPitchX: bPitchX, bSpX: bSpX, bShDir: bShDir, bNeckCorner: bNeckCorner,
      BNP: BNP, SNPb: SNPb, SPb: SPb, Ub: Ub, bWaist: bWaist,
      shLenBack: shLenBack, shLenBackSeam: shLenBackSeam,
      shLenFront: shLenFront, shLenFrontSeam: shLenFrontSeam,
      fSideX: fSideX, fPitchX: fPitchX, fShDir: fShDir,
      SNPf: SNPf, FNP: FNP, SPf: SPf, Uf: Uf, fWaist: fWaist, BP: BP,
      dartLo: dartLo, dartHi: dartHi, dartTip: dartTip, dartLeg: dartLeg, dartAng: dartAng,
      sideTrue: sideTrue, hasDart: hasDart, hemDrop: hemDrop,
      sideBackLen: sideBackLen, sideUpper: sideUpper,
      frontHem: frontHem,
      vMark: vMark, Vcf: Vcf, Vend: Vend, wrapWaist: wrapWaist,
      backNeck: backNeck, backArm: backArm, frontArm: frontArm,
      vNeck: vNeck, vNeckUp: vc.up, vNeckLow: vc.low   // 위 = 앞중심까지 (자락 없는 앞판이 쓴다)
    };
  }

  /* ── 안단(안감) 조각 ────────────────────────────────────────────────
   *  가장자리 곡선을 조각 안쪽으로 안단너비만큼 평행 이동한 뒤,
   *  양 끝을 이웃 변(어깨선·중심선·옆선)에 맞춰 자른다. */
  function offsetOpen(segs, dist, inside) {
    var p = sampleSegs(segs, FLATTEN), n = p.length, i, nrm = [];
    for (i = 0; i < n; i++) {
      var a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
      var t = V.norm(V.sub(b, a));
      nrm.push([t[1], -t[0]]);                     // 곡선 전체에서 한쪽으로 통일
    }
    var k = n >> 1, sgn =
      (nrm[k][0] * (inside[0] - p[k][0]) + nrm[k][1] * (inside[1] - p[k][1]) < 0) ? -1 : 1;
    var out = [];
    for (i = 0; i < n; i++) out.push(V.add(p[i], V.mul(nrm[i], dist * sgn)));
    return trimOpenLoops(out);
  }
  /** 열린 폴리라인의 자기교차(오프셋 첨점) 제거 — removeSelfLoops 는 폐곡선용이라 못 쓴다 */
  function trimOpenLoops(pts) {
    for (var guard = 0; guard < 40; guard++) {
      var n = pts.length, hit = null, i, j;
      for (i = 0; i < n - 1 && !hit; i++) {
        for (j = i + 2; j < n - 1; j++) {
          var X = segX(pts[i], pts[i + 1], pts[j], pts[j + 1]);
          if (X) { hit = { i: i, j: j, X: X }; break; }
        }
      }
      if (!hit) break;
      pts = pts.slice(0, hit.i + 1).concat([hit.X], pts.slice(hit.j + 1));
    }
    return pts;
  }
  /** 열린 폴리라인의 끝을 직선(A,dir)에 맞춰 자르거나 늘린다. end: 0 = 시작, 1 = 끝 */
  function trimEnd(pts, A, dir, end, far) {
    var q = end ? pts.slice().reverse() : pts.slice(), i, hit = null, acc = 0;
    for (i = 0; i < q.length - 1; i++) {
      var d = V.sub(q[i + 1], q[i]);
      var r = lineX(A, dir, q[i], d);
      if (!r) continue;
      var u = V.sub(r, q[i]);
      var t = (Math.abs(d[0]) > Math.abs(d[1])) ? u[0] / d[0] : u[1] / d[1];
      if (t >= -0.0001 && t <= 1.0001) { hit = { i: i, p: r }; break; }
      acc += V.dist(q[i], q[i + 1]);
      /* 끝 근방에서만 찾는다 — 멀리까지 보면 무한 직선이 곡선을 다시 만나 엉뚱한 데서 잘린다 */
      if (acc > 6) break;
    }
    if (hit) q = [hit.p].concat(q.slice(hit.i + 1));
    else {
      /* 못 만나면 접선으로 늘려 만난다. 다만 기준선이 거의 나란하면 교점이 수십 cm
         밖으로 날아가 조각이 폭주한다 — 안단 너비의 3배를 넘으면 늘리지 않는다. */
      var d0 = V.sub(q[1], q[0]), r2 = lineX(A, dir, q[0], d0);
      if (r2 && V.dist(r2, q[0]) <= 12) q = [r2].concat(q);
    }
    /* ★ 기준은 무한 직선이 아니라 **변**이다 — 변의 끝을 넘어가면 조각 밖으로 나간다.
       (자락 끝이 짧을 때 안단이 밑단 아래로 삐져나오던 것) */
    if (far) {
      var u = V.norm(dir);
      var tf = (far[0] - A[0]) * u[0] + (far[1] - A[1]) * u[1];
      var th = (q[0][0] - A[0]) * u[0] + (q[0][1] - A[1]) * u[1];
      if ((tf >= 0 && th > tf) || (tf < 0 && th < tf)) q[0] = cp(far);
    }
    return end ? q.reverse() : q;
  }
  /** 점 간격이 FLATTEN 을 넘는 곳을 채운다 (자르거나 늘린 끝에서 생긴다) */
  function densify(pts) {
    var out = [pts[0]], i, j, n;
    for (i = 1; i < pts.length; i++) {
      n = Math.ceil(V.dist(pts[i - 1], pts[i]) / FLATTEN);
      for (j = 1; j < n; j++)
        out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * j / n,
                  pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * j / n]);
      out.push(pts[i]);
    }
    return out;
  }
  /** 두 점 사이를 FLATTEN 간격으로 채운 직선 (끝점 제외) */
  function fill(a, b) {
    var n = Math.max(1, Math.ceil(V.dist(a, b) / FLATTEN)), out = [], i;
    for (i = 1; i < n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    return out;
  }
  /** 끝을 경계 변들에 **차례로** 대고 자른다.
   *  자락 끝이 짧으면 밑단이 먼저 막는 식으로 두 변이 연달아 막을 수 있다.
   *  자르기는 짧아지는 방향으로만 작용하므로 순서대로 적용하면 둘 다 반영된다. */
  function trimBest(pts, end, which) {
    var cands = end.also ? [end].concat(end.also) : [end], r = pts;
    for (var i = 0; i < cands.length; i++) r = trimEnd(r, cands[i].p, cands[i].d, which, cands[i].q);
    return r;
  }
  /** 안단 조각 하나 — edge(가장자리 곡선) + 양 끝 경계선 */
  function facingPiece(id, name, edgeSegs, inside, fac, endA, endB, seam, cut, notches, edgeRole) {
    var edge = sampleSegs(edgeSegs, FLATTEN);
    var inner = offsetOpen(edgeSegs, fac, inside);
    /* 끝은 여러 변에 걸릴 수 있다 (자락 끝이 짧으면 밑단이 먼저 막는다).
       후보마다 잘라 보고 **가장 짧게 잘리는** 것을 쓴다 = 조각 밖으로 안 나간다. */
    inner = trimBest(inner, endA, 0);
    inner = densify(trimBest(inner, endB, 1));
    var rev = inner.slice().reverse();
    var capB = fill(edge[edge.length - 1], rev[0]);         // 끝 B (edge 끝 → 안단 끝)
    var capA = fill(rev[rev.length - 1], edge[0]);          // 끝 A (안단 시작 → edge 시작)
    var loopPts = edge.concat(capB, rev, capA);
    var i0 = edge.length, i1 = i0 + capB.length, i2 = i1 + rev.length;
    /* 변마다 **붙을 몸판 변과 같은 role** 을 준다. 하드코딩하면 표준 시접에서
       안단 끝이 몸판보다 0.5 좁아지거나, 골선(시접 0)에 시접이 붙어 중심을 넘어간다. */
    var ranges = [
      { name: '가장자리', role: edgeRole || 'neck',    start: 0,  end: i0 - 1 },
      { name: endB.name || '끝 B', role: endB.role || 'shoulder', start: i0, end: i1 - 1 },
      { name: '안단 안쪽', role: 'facing',             start: i1, end: i2 - 1 },
      { name: endA.name || '끝 A', role: endA.role || 'shoulder', start: i2, end: loopPts.length - 1 }
    ];
    var loop = { pts: loopPts, ranges: ranges };
    var sm = buildSeamline(loop, seam);
    return {
      id: id, name: name, cutCount: cut || 2, kind: 'facing',
      outline: loopPts, seamline: sm.seamline, foldEdges: sm.foldEdges,
      seamEdges: sm.seamEdges, seamFoldEdges: sm.seamFoldEdges, seamByRole: sm.seamByRole,
      edges: withSeam(ranges, sm.edgeSeam),
      grainline: grainOf(loopPts), internal: [], notches: (notches || []).map(function (n) {
        return { p: cp(n.p), angle: n.angle, label: n.label };
      }), bbox: bboxOf(loopPts)
    };
  }
  /** 곡선 위 비율 자리에 너치. 안단과 몸판이 **같은 로컬 좌표**를 쓰므로
   *  한 번 계산해 양쪽 조각에 그대로 붙이면 재단 후 정확히 만난다. */
  function curveNotches(segs, marks, inside, tag) {
    var L = polyLen(sampleSegs(segs, 0.02)), out = [];
    marks.forEach(function (mk) {
      var h = _ptAtLen(segs, L * mk.t, false);
      out.push({ p: cp(h.p), angle: _inward(h.tan, h.p, inside), label: tag + ' ' + mk.name });
    });
    return out;
  }
  /** 폴리라인을 n 점 정도로 솎는다 (기준선 표시용) */
  function thin(pts, n) {
    if (pts.length <= n) return pts.map(cp);
    var out = [], step = (pts.length - 1) / (n - 1), i;
    for (i = 0; i < n; i++) out.push(cp(pts[Math.round(i * step)]));
    return out;
  }
  function grainOf(pts) {
    var b = bboxOf(pts), x = b.x + b.w * 0.5;
    return [[x, b.y + b.h * 0.25], [x, b.y + b.h * 0.75]];
  }

  /** 앞 옆선 변 — 다트분이 0 이면 다트 변을 만들지 않고 한 줄로 잇는다.
   *  0 이면 dartHi = dartLo 라 폭 0 인 14 cm 슬릿이 생기고 시접선이 자기교차한다. */
  function sideEdges(g) {
    if (!g.hasDart) return [{ name: '옆선', role: 'side', segs: lineSegs(g.Uf, g.fWaist) }];
    return [
      { name: '옆선 위',   role: 'side', segs: lineSegs(g.Uf, g.dartHi) },
      { name: '다트',      role: 'dart', segs: lineSegs(g.dartHi, g.dartTip, g.dartLo) },
      { name: '옆선 아래', role: 'side', segs: lineSegs(g.dartLo, g.fWaist) }
    ];
  }

  function draftVNeck(m, opt) {
    opt = opt || {};
    var seam = (opt.seam === undefined) ? 0 : opt.seam;
    var g = geom(m, opt);
    var WL = g.WL, fac = g.facing;

    /* ───────── 안단과 몸판이 공유하는 너치 ─────────
     *  같은 좌표를 양쪽 조각에 그대로 넣는다. 안단을 몸판에 얹어 꿰맬 때 이 자리를 맞춘다. */
    var insideB = [g.bPitchX * 0.5, g.BL], insideF = [g.fPitchX * 0.5, g.BL];
    var nBackNeck = curveNotches(g.backNeck, [{ t: 0.5, name: '1/2' }], insideB, '뒷목둘레');
    var nBackArm  = armNotches(g.backArm,  g.Ub, [g.bPitchX / 2, g.armY], '뒤암홀');
    var nFrontArm = armNotches(g.frontArm, g.Uf, [g.fPitchX / 2, g.armY], '앞암홀');
    var nVUp  = curveNotches(g.vNeckUp, [{ t: 0.5, name: '1/2' }],
                             [g.fSideX * 0.4, g.BL], 'V목둘레(위)');
    var nVLow = curveNotches(g.vNeckLow, [{ t: 1 / 3, name: '1/3' }, { t: 2 / 3, name: '2/3' }],
                             [g.fSideX * 0.2, g.WL - 4], 'V목둘레(아래)');
    var nVcf = { p: cp(g.Vcf), angle: 0, label: '앞중심 V' };      // 자락 앞판·안단 공통 맞춤점

    /* ───────── 뒷판 ───────── */
    var backEdges = [
      { name: '뒷목둘레', role: 'neck',     segs: g.backNeck },
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPb, g.SPb) },
      { name: '뒤암홀',   role: 'armhole',  segs: revSegs(g.backArm) },
      { name: '옆선',     role: 'side',     segs: lineSegs(g.Ub, g.bWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.bWaist, [0, WL]) },
      { name: '뒤중심',   role: 'fold',     segs: lineSegs([0, WL], g.BNP) }
    ];
    /* ───────── 앞판 (자락이 앞중심을 넘어 반대 옆선까지 간다) ───────── */
    var frontEdges = [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPf, g.SPf) },
      { name: '앞암홀',   role: 'armhole',  segs: revSegs(g.frontArm) },
    ].concat(sideEdges(g), [
      { name: '밑단',     role: 'hem',      segs: g.frontHem.concat(lineSegs([0, WL], g.wrapWaist)) },
      { name: '자락 끝',  role: 'side',     segs: lineSegs(g.wrapWaist, g.Vend) },
      { name: 'V 네크라인', role: 'neck',   segs: revSegs(g.vNeck) }      // 자락 끝 → 목옆점
    ]);

    var backLoop = edgesToLoop(backEdges), frontLoop = edgesToLoop(frontEdges);
    var backSeam = buildSeamline(backLoop, seam), frontSeam = buildSeamline(frontLoop, seam);

    var backPiece = {
      id: 'back', name: '뒷면', cutCount: 2, kind: 'body',
      grainline: [[1.5, 2.0], [1.5, WL - 2.0]],
      outline: backLoop.pts, seamline: backSeam.seamline, foldEdges: backSeam.foldEdges,
      seamEdges: backSeam.seamEdges, seamFoldEdges: backSeam.seamFoldEdges,
      seamByRole: backSeam.seamByRole, edges: withSeam(backLoop.ranges, backSeam.edgeSeam),
      internal: backInternal(g), notches: [
        { p: cp(g.SPb),  angle: angDeg(perpToward(g.bShDir, g.SPb, g.Ub)),   label: '어깨점' },
        { p: cp(g.SNPb), angle: angDeg(perpToward(g.bShDir, g.SNPb, g.BNP)), label: '목옆점' },
        { p: cp(g.Ub),   angle: 180,                                          label: '겨드랑' }
      ].concat(nBackArm, nBackNeck),
      bbox: bboxOf(backLoop.pts)
    };
    var frontPiece = {
      id: 'front', name: '앞면', cutCount: 2, kind: 'body',
      grainline: [[g.fSideX * 0.45, g.BL], [g.fSideX * 0.45, WL - 2.0]],
      outline: frontLoop.pts, seamline: frontSeam.seamline, foldEdges: frontSeam.foldEdges,
      seamEdges: frontSeam.seamEdges, seamFoldEdges: frontSeam.seamFoldEdges,
      seamByRole: frontSeam.seamByRole, edges: withSeam(frontLoop.ranges, frontSeam.edgeSeam),
      internal: frontInternal(g, true), notches: [
        { p: cp(g.SPf),  angle: angDeg(perpToward(g.fShDir, g.SPf, g.Uf)),   label: '어깨점' },
        { p: cp(g.SNPf), angle: angDeg(perpToward(g.fShDir, g.SNPf, g.Vcf)), label: '목옆점' },
        { p: cp(g.Uf),   angle: 180,                                          label: '겨드랑' },
        nVcf,
        { p: [0, g.WL],  angle: -90,                                          label: '앞중심 CF' },
      ].concat(g.hasDart ? [{ p: cp(g.dartHi), angle: 180, label: '다트 위' },
                            { p: cp(g.dartLo), angle: 180, label: '다트 아래' }] : [],
               nFrontArm, nVUp, nVLow),
      bbox: bboxOf(frontLoop.pts)
    };

    /* ───────── 안단 4조각 ───────── */
    var shB = { p: g.SNPb, d: V.sub(g.SPb, g.SNPb), q: cp(g.SPb), role: 'shoulder', name: '어깨선' };
    var shF = { p: g.SNPf, d: V.sub(g.SPf, g.SNPf), q: cp(g.SPf), role: 'shoulder', name: '어깨선' };
    var cb  = { p: [0, 0], d: [0, 1], q: [0, WL], role: 'fold', name: '뒤중심' };   // 골선 — 시접 0
    /** 옆선 절단선 — 다트분이 크고 다트가 높으면 겨드랑↔다트 위 다리가 거의 수평이 되어
     *  이 방향으로 자르면 안단이 수십 cm 로 폭주한다. 그럴 땐 수직 옆선으로 되돌린다. */
    function sideCut(from, to, name) {
      var d = V.sub(to, from);
      if (V.dist(from, to) < 1e-6 || Math.abs(d[1]) < Math.abs(d[0])) d = [0, 1];
      return { p: from, d: d, q: cp(to), role: 'side', name: name };
    }
    var sideB = sideCut(g.Ub, g.bWaist, '옆선');               // 뒤 옆선
    var sideF = sideCut(g.Uf, g.dartHi, '옆선');               // 앞 옆선 (겨드랑~다트)
    var wrapE = { p: g.Vend, d: V.sub(g.wrapWaist, g.Vend), q: cp(g.wrapWaist), role: 'side', name: '자락 끝' };

    var backNeckFacing = facingPiece('backNeckFacing', '뒷면 목둘레 안단',
      g.backNeck, [g.bPitchX * 0.5, g.BL], fac, cb, shB, seam, 2, nBackNeck, 'neck');
    var backArmFacing = facingPiece('backArmFacing', '뒷면 암홀 안단',
      g.backArm, [g.bPitchX * 0.4, g.BL], fac, sideB, shB, seam, 2, nBackArm, 'armhole');
    var frontArmFacing = facingPiece('frontArmFacing', '앞면 암홀 안단',
      g.frontArm, [g.fPitchX * 0.4, g.BL], fac, sideF, shF, seam, 2, nFrontArm, 'armhole');
    var frontNeckFacing = facingPiece('frontNeckFacing', '앞면 목둘레 안단',
      g.vNeck, [g.fSideX * 0.6, WL - 3], fac, shF,
      { p: wrapE.p, d: wrapE.d, q: wrapE.q, role: wrapE.role, name: wrapE.name,
        also: [{ p: g.wrapWaist, d: [1, 0], q: [0, WL], role: 'hem', name: '밑단' }] }, seam, 2,
      [nVcf].concat(nVUp, nVLow), 'neck');
    var cf = { p: [0, 0], d: [0, 1], q: [0, WL], role: 'fold', name: '앞중심' };    // 골선 — 시접 0
    var plainNeckFacing = facingPiece('frontPlainNeckFacing', '앞면(자락없음) 목둘레 안단',
      g.vNeckUp, [g.fSideX * 0.5, g.BL], fac, shF, cf, seam, 1, nVUp, 'neck');

    /* ── 자락 없는 앞면 ──────────────────────────────────────────────
     *  자락 앞판은 한쪽만 늘어나 있어 그것만으로는 좌우 대칭 앞판을 만들 수 없다.
     *  앞중심에서 끊은 반쪽을 따로 낸다 — 앞중심을 골선으로 놓고 1장 재단하면
     *  좌우 대칭 V 네크라인이 되고, 자락 스타일에서는 밑에 받치는 앞판이 된다. */
    var plainEdges = [
      { name: '어깨선',    role: 'shoulder', segs: lineSegs(g.SNPf, g.SPf) },
      { name: '앞암홀',    role: 'armhole',  segs: revSegs(g.frontArm) },
    ].concat(sideEdges(g), [
      { name: '밑단',      role: 'hem',      segs: g.frontHem },
      { name: '앞중심',    role: 'fold',     segs: lineSegs([0, WL], g.Vcf) },   // 골선 (시접 0)
      { name: 'V 네크라인', role: 'neck',    segs: revSegs(g.vNeckUp) }          // 앞중심 → 목옆점
    ]);
    var plainLoop = edgesToLoop(plainEdges), plainSeam = buildSeamline(plainLoop, seam);
    var frontPlain = {
      id: 'frontPlain', name: '앞면 (자락 없음)', cutCount: 1, kind: 'body',
      grainline: [[g.fSideX * 0.4, g.BL], [g.fSideX * 0.4, WL - 2.0]],
      outline: plainLoop.pts, seamline: plainSeam.seamline, foldEdges: plainSeam.foldEdges,
      seamEdges: plainSeam.seamEdges, seamFoldEdges: plainSeam.seamFoldEdges,
      seamByRole: plainSeam.seamByRole, edges: withSeam(plainLoop.ranges, plainSeam.edgeSeam),
      internal: frontInternal(g, false).filter(function (x) { return x.id !== 'wrapLine'; }),
      notches: [
        { p: cp(g.SPf),  angle: angDeg(perpToward(g.fShDir, g.SPf, g.Uf)),   label: '어깨점' },
        { p: cp(g.SNPf), angle: angDeg(perpToward(g.fShDir, g.SNPf, g.Vcf)), label: '목옆점' },
        { p: cp(g.Uf),   angle: 180,                                          label: '겨드랑' },
      ].concat(g.hasDart ? [{ p: cp(g.dartHi), angle: 180, label: '다트 위' },
                            { p: cp(g.dartLo), angle: 180, label: '다트 아래' }] : [],
               nFrontArm, nVUp),
      bbox: bboxOf(plainLoop.pts)
    };

    /* 몸판에도 안단선을 그려 넣는다 (교재 도면의 `안단선`) */
    function facingLineOf(p) {
      var e = p.edges.filter(function (x) { return x.role === 'facing'; })[0];
      return e ? thin(p.outline.slice(e.start, e.end + 1), 60) : [];
    }
    backPiece.internal = backPiece.internal.concat([
      L('facingNeck', 'dashed', facingLineOf(backNeckFacing), '목둘레 안단선'),
      L('facingArm',  'dashed', facingLineOf(backArmFacing),  '암홀 안단선')
    ]);
    frontPiece.internal = frontPiece.internal.concat([
      L('facingNeck', 'dashed', facingLineOf(frontNeckFacing), 'V 목둘레 안단선'),
      L('facingArm',  'dashed', facingLineOf(frontArmFacing),  '암홀 안단선')
    ]);

    frontPlain.internal = frontPlain.internal.concat([
      L('facingNeck', 'dashed', facingLineOf(plainNeckFacing), 'V 목둘레 안단선'),
      L('facingArm',  'dashed', facingLineOf(frontArmFacing),  '암홀 안단선')
    ]);

    var pieces = [frontPiece, frontPlain, backPiece,
                  frontNeckFacing, plainNeckFacing, frontArmFacing, backNeckFacing, backArmFacing];

    var AHb = sLen(g.backArm), AHf = sLen(g.frontArm);
    var NKb = sLen(g.backNeck), NKf = sLen(g.vNeck);
    var sideBack = V.dist(g.Ub, g.bWaist);
    var sideFrontCut = g.sideUpper + g.opt.dartAmount + V.dist(g.dartLo, g.fWaist);
    var sideFrontSewn = g.sideUpper + V.dist(g.dartLo, g.fWaist);

    /* 설정끼리 모순이면 도형을 억지로 맞추지 말고 알린다 */
    var warnings = [], notes = [];
    if (g.opt.wrapUp < fac - 1e-9)
      warnings.push('자락 끝 ' + r4(g.opt.wrapUp) + ' 이 안단너비 ' + r4(fac) +
        ' 보다 짧습니다 — 앞 목둘레 안단이 밑단을 넘어갑니다. 자락 끝을 안단너비 이상으로 두세요.');
    if (fac > g.sideUpper)
      notes.push('겨드랑~다트 옆선이 ' + r4(g.sideUpper) + ' 로 안단너비 ' + r4(fac) +
        ' 보다 짧습니다 — 앞 암홀 안단은 다트 자리에서 끝납니다 (조각은 정상).');
    /* 안단이 붙을 몸판보다 커졌다면 그 자리에 들어갈 수 없는 너비다 */
    pieces.forEach(function (p) {
      if (p.kind !== 'facing') return;
      var host = (p.id.indexOf('back') === 0 ? backPiece : frontPiece).bbox;
      if (p.bbox.w > host.w + 0.01 || p.bbox.h > host.h + 0.01)
        warnings.push(p.name + ' 이 몸판보다 커졌습니다 (' + r4(p.bbox.w) + '×' + r4(p.bbox.h) +
          ' > ' + r4(host.w) + '×' + r4(host.h) + ') — 안단너비 ' + r4(fac) + ' 를 줄이세요.');
    });

    return {
      pieces: pieces,
      warnings: warnings, notes: notes,
      measures: {
        shoulderBack: r4(g.shLenBack), shoulderFront: r4(g.shLenFront), shoulderEase: r4(g.shEase),
        shoulderBackSeam: r4(g.shLenBackSeam), shoulderFrontSeam: r4(g.shLenFrontSeam),
        armholeBack: r4(AHb), armholeFront: r4(AHf), armholeTotal: r4(AHb + AHf),
        neckBack: r4(NKb), neckFront: r4(NKf), neckTotal: r4(NKb + NKf),
        sideBack: r4(sideBack), sideFront: r4(sideFrontCut), sideFrontSewn: r4(sideFrontSewn),
        armRise: r4(g.opt.armRise), facing: r4(fac),
        sideTrue: g.sideTrue, hemDrop: r4(g.hemDrop),
        vDepth: r4(g.opt.vDepth), wrapWidth: r4(g.fSideX * 2),
        dartAmount: r4(g.opt.dartAmount), dartLeg: r4(g.dartLeg),
        dartAngleDeg: r4(g.dartAng * 180 / Math.PI),
        facingNeckFront: r4(polyLen(frontNeckFacing.outline) ),
        BL: r4(g.BL), armY: r4(g.armY), WL: r4(WL)
      },
      meta: {
        title: 'V 네크라인 (민소매 · 자락 앞면)',
        source: '교재 p.103 「V 네크라인 6개 패턴」 · 몸판은 기본무다트원형 치수대로 / 뒷면 34P',
        sizeName: sizeNameOf(m), m: m, geom: g, warnings: warnings, notes: notes,
        formulaNotes: formulaNotes(m, g, AHb, AHf, NKb, NKf, seam)
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 4. 곡선 생성
   * ════════════════════════════════════════════════════════════════ */
  /** 뒷목둘레 : CB(수평 출발) → 중간점 → 목옆점(어깨선 수직 도착) */
  function curveBackNeck(BNP, SNP, shDir) {
    var C = CAL.backNeck;
    var Mp = [BNP[0] + (SNP[0] - BNP[0]) * C.mx, BNP[1] + (SNP[1] - BNP[1]) * C.my];
    var pin = perpToward(shDir, SNP, BNP);
    return splineSegs([BNP, Mp, SNP], endTan([1, 0], C.k0), endTan(V.mul(pin, -1), C.k1));
  }

  /** 암홀 : 겨드랑(수평 출발) → 오목점 → 품점 → 어깨점(어깨선 수직 도착)
   *  민소매라 겨드랑을 가슴선에서 armRise 만큼 올린 자리에서 시작한다. */
  function curveArmhole(U, SP, shDir, pitchXm, armY, back) {
    var C = back ? CAL.backArm : CAL.frontArm;
    var dy = armY - SP[1], dx = U[0] - pitchXm;
    var P = [pitchXm + C.pdx * dx, SP[1] + C.pky * dy];
    var H = [U[0] - C.hdx * dx, armY - C.hdy * dy];
    var pin = perpToward(shDir, SP, U);
    return splineSegs([U, H, P, SP], endTan([-1, 0], C.k0), endTan(V.mul(pin, -1), C.k1));
  }

  /** 앞 밑단 : 옆선(내려간 자리) → 앞중심 — **한 줄 스플라인** (언더암다트 원형과 같은 방식)
   *  · 옆선 끝: 옆선에 **직각**으로 출발 (앞뒤를 붙였을 때 옆선이 꺾이지 않는다)
   *  · 앞중심: **수평** 도착 (자락 없는 앞판은 골선이라 접었을 때 매끄러워야 한다)
   *  트루잉을 끄면 두 끝 y 가 같아 그냥 수평선이 된다. */
  function curveFrontHem(side, cf, sideDir) {
    var st = [sideDir[1], -sideDir[0]];                       // 옆선에 수직
    if (st[0] > 0) st = [-st[0], -st[1]];                     // 앞중심 쪽으로
    return splineSegs([side, cf], endTan(st, CAL.hem.k0), endTan([-1, 0], CAL.hem.k1));
  }

  /** V 네크라인 : 목옆점 → 대각선 통과점 → 앞중심 V 점 → 반대 옆선(자락 끝)
   *  원본 DXF 도 앞중심에서 곡률이 끊긴다. 위/아래를 따로 그리고 접선만 이어(G1) 맞춘다. */
  function curveVNeck(SNP, mark, Vcf, Vend, shDir) {
    var Cu = CAL.vNeckUp, Cl = CAL.vNeckLow;
    /* 목옆점 출발 접선 — 어깨선 수직에서 startAng 만큼 돌린 방향.
       ★ 방향은 반드시 곡선이 가는 쪽(앞중심 쪽)이어야 한다. 반대로 두면 목옆점에서
         곡선이 0.02 cm 되짚었다가 돌아 나와, 시접을 붙이면 그 자리가 뾰족하게 튄다. */
    var pin = perpToward(shDir, SNP, Vcf);
    var s0 = Cu.startAng * Math.PI / 180, c0 = Math.cos(s0), n0 = Math.sin(s0);
    var d0 = [pin[0] * c0 - pin[1] * n0, pin[0] * n0 + pin[1] * c0];
    var a = Cu.endAng * Math.PI / 180;
    var up = splineSegs([SNP, mark, Vcf],
      endTan(d0, Cu.k0),
      endTan([-Math.cos(a), Math.sin(a)], Cu.k1));
    var last = up[up.length - 1];
    var tA = V.norm(V.sub(last.p1, last.c2));                  // 앞중심 도착 접선 → 그대로 이어간다
    var ch = V.sub(Vend, Vcf), L = V.dist(Vcf, Vend), u = V.norm(ch);
    var M = [Vcf[0] + u[0] * L * Cl.mt + u[1] * L * Cl.moff,
             Vcf[1] + u[1] * L * Cl.mt - u[0] * L * Cl.moff];
    var low = splineSegs([Vcf, M, Vend], endTan(tA, Cl.k0), endTan([-1, Cl.slope], Cl.k1));
    return { all: up.concat(low), up: up, low: low };
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
        /* ★ 변 안쪽의 급격한 **볼록** 꺾임(턴 > ~91°)은 곡선 샘플링에서 안 나온다 —
           조립 잔재(예: 골선 캡 끝의 0.04 세그먼트)다. 마이터를 뻗치면 시접의
           최대 3배 가시가 생기므로 bevel 두 점으로 자른다.
           오목(다트 꼭짓점 등)은 기존대로 마이터+자기교차 제거에 맡긴다. */
        if (cosHalf < 0.7) {
          var dp_ = segDir[(gi - 1 + n) % n], dn_ = segDir[gi];
          var cr_ = dp_[0] * dn_[1] - dp_[1] * dn_[0];
          if (ccw ? cr_ > 0 : cr_ < 0) {
            out.push([P[0] + nPrev[0] * s, P[1] + nPrev[1] * s]);
            out.push([P[0] + nNext[0] * s, P[1] + nNext[1] * s]);
            continue;
          }
        }
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
      /* ★ 모서리 소유 변: 골선(시접 0) 연장 캡은 **시접 있는 이웃 변** 소유 —
         골선 변의 시접선은 "골선에서 거리 0" 이어야 하고(SPEC §11-2),
         캡 점은 이웃 변 시접의 끝이지 골선의 이탈이 아니다. 그 외엔 끝나는 변. */
      var cornOwner = (sA === 0) ? kNext : k;
      var nPrev = segNrm[(cornerIdx - 1 + n) % n], nNext = segNrm[cornerIdx];

      /* 양쪽 변의 오프셋 직선 — 조립 때 "모서리 뒤로 되돌아간 점" 을 걸러내는 데 쓴다.
         ★ 시접 0(골선) 변의 "오프셋선"은 골선 자신이라 이웃 변 오프셋 점 전부가
         안쪽으로 찍혀 behind 컷이 모서리 근방 2cm 를 후벼 판다 — 골선 쪽은 null 로
         꺼서 되짚음 제거는 ①번 내적 조건 + ④-0 골선 클램프에 맡긴다. */
      var LA = sA > 0 ? { p: [P[0] + nPrev[0] * sA, P[1] + nPrev[1] * sA], n: nPrev } : null;
      var LB = sB > 0 ? { p: [P[0] + nNext[0] * sB, P[1] + nNext[1] * sB], n: nNext } : null;
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
      // ── 이폭 → 두 오프셋선의 교점 (시접 0 쪽 오프셋선은 그 변 자신 = P 통과)
      var A = LA ? LA.p : [P[0] + nPrev[0] * sA, P[1] + nPrev[1] * sA];
      var Bp = LB ? LB.p : [P[0] + nNext[0] * sB, P[1] + nNext[1] * sB];
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
      /* 짧은 변은 양쪽 모서리 정리로 통째로 사라질 수 있다 — 각 끝에서 최대 40% 만 자른다.
         (안단 캡처럼 4cm 짜리 변이 점 1개로 줄면 시접선이 그 자리를 건너뛰어
          모서리끼리 직선으로 이어져 '시접 간격이 들쭉날쭉'해 보인다) */
      var lim = Math.max(0, Math.floor((offK.length - 2) * 0.4));
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
        while (q0 <= 1 + lim && q0 <= q1
               && ((offK[q0][0] - Xs[0]) * d0[0] + (offK[q0][1] - Xs[1]) * d0[1] < 0
                   || behind(offK[q0], La, Ca))) q0++;
        while (q1 >= offK.length - 2 - lim && q1 >= q0
               && ((offK[q1][0] - Xe[0]) * d1[0] + (offK[q1][1] - Xe[1]) * d1[1] > 0
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
      L('topLine', 'line',   [[0, 0], [K.fixedX, 0]], '상단 기준선'),
      L('BL',      'line',   [[0, g.BL], [g.bSideX, g.BL]], 'BL (B/4)'),
      L('armLine', 'dashed', [[0, g.armY], [g.bSideX, g.armY]], '겨드랑선'),
      L('backW',   'dashed', [[g.bPitchX, 0], [g.bPitchX, g.BL]], '등품선'),
      L('fixedX',  'dashed', [[K.fixedX, 0], [K.fixedX, K.backShDrop]], '고정치수선'),
      L('shGuide', 'dashed', [[g.bSpX, -1.2], [g.bSpX, g.SPb[1] + 0.6]], '어깨 안내선'),
      L('neckW',   'dashed', [[g.nw, 0], [g.nw, -K.backNeckLift]], '뒷목너비'),
      L('neckRise','dashed', [[0, -K.backNeckLift], [g.nw, -K.backNeckLift]], '뒷목 올림'),
      L('neckExt', 'dashed', [g.bNeckCorner, g.SNPb], '목옆점 연장'),
      L('SP',      'point',  [g.SPb], 'SP'),
      L('SNP',     'point',  [g.SNPb], 'SNP')
    ];
  }
  /** @param wrap true = 자락 앞판(앞중심 좌우로 뻗음) · false = 자락 없는 앞판(0~옆선만) */
  function frontInternal(g, wrap) {
    var dep = g.FNP[1], xL = wrap ? -g.fSideX : 0;
    return [
      L('topLine',  'line',   [[0, 0], [K.fixedX, 0]], '상단 기준선'),
      L('cfRise',   'dashed', [[0, -K.frontNeckLift], [g.nw, -K.frontNeckLift]], 'CF 올림'),
      L('BL',       'line',   [[xL, g.BL], [g.fSideX, g.BL]], 'BL (B/4)'),
      L('armLine',  'dashed', [[0, g.armY], [g.fSideX, g.armY]], '겨드랑선'),
      L('frontW',   'dashed', [[g.fPitchX, -K.frontNeckLift], [g.fPitchX, g.BL]], '앞품선'),
      /* 앞면은 자락이라 앞중심이 조각 한가운데를 지난다 — 재단·시착 기준이므로 실선으로 긋는다 */
      L('cf',       'line',   [[0, g.Vcf[1]], [0, g.WL]], '앞중심 CF'),
      L('cfUp',     'dashed', [[0, -K.frontNeckLift], [0, g.Vcf[1]]], 'CF 안내선'),
      L('neckW',    'dashed', [[g.nw, -K.frontNeckLift], [g.nw, dep]], '앞목너비'),
      L('neckD',    'dashed', [[0, dep], [g.nw, dep]], '앞목깊이'),
      L('neckDiag', 'dashed', [[0, 0], [g.nw, dep]], '목 사각 대각선'),
      L('vMark',    'point',  [g.vMark], 'V 통과점 (대각선 2/3 + 1)'),
      L('vLine',    'dashed', [g.SNPf, g.Vcf], 'V 직선'),
      L('wrapLine', 'dashed', [[g.fSideX, g.Vend[1]], [xL, g.Vend[1]]], '자락 끝 수평선'),
      L('shExt',    'dashed', [g.SPf, [K.fixedX, K.frontShDrop]], '어깨선 연장'),
      L('bpLen',    'dashed', [g.SNPf, g.BP], '유장'),
      L('bpSpan',   'dashed', [[g.BP[0], 0], [g.BP[0], g.BP[1]]], '유폭'),
      L('hemLevel', 'dashed', [[xL, g.WL], [g.fSideX, g.WL]], '허리선 (다트 접은 뒤 밑단)'),
      L('dartMid',  'dashed', [g.BP, [(g.dartHi[0] + g.dartLo[0]) / 2, (g.dartHi[1] + g.dartLo[1]) / 2]], '다트 중심'),
      L('BP',       'point',  [g.BP], 'BP'),
      L('SP',       'point',  [g.SPf], 'SP'),
      L('SNP',      'point',  [g.SNPf], 'SNP'),
      L('FNP',      'point',  [g.FNP], 'FNP (기본 원형)')
    ];
  }

  /** meta.formulaNotes — { id, label, formula, value, piece, anchor } */
  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }
  function formulaNotes(m, g, AHb, AHf, NKb, NKf, seam) {
    var nw = g.nw;
    return [
      /* ── 뒷면 ── */
      FN('BL',       'BL',        'B/4',                     g.BL,      'back',  [g.bSideX * 0.5, g.BL]),
      FN('armLine',  '겨드랑선',   'B/4 − 진동올림 ' + f1(g.opt.armRise) + ' (1.9~3.1)', g.armY, 'back', [g.bSideX * 0.72, g.armY]),
      FN('WL',       '허리선',     '등길이',                   g.WL,      'back',  [g.bSideX * 0.5, g.WL]),
      FN('side',     '옆선',       'B/4 + 1.9',               g.bSideX,  'back',  [g.bSideX, (g.armY + g.WL) / 2]),
      FN('backW',    '등품선',     '등품/2',                   g.bPitchX, 'back',  [g.bPitchX, g.BL * 0.62]),
      FN('shGuide',  '어깨 안내선', '어깨너비/2 + 0.6',          g.bSpX,    'back',  [g.bSpX, 0.9]),
      FN('neckW',    '뒷목너비',   'B/12',                     nw,        'back',  [nw * 0.5, -K.backNeckLift]),
      FN('neckExt',  '목옆점 연장', '어깨선 바깥 1.0',           K.backNeckExt, 'back', cp(g.SNPb)),
      FN('shBack',   '뒤 어깨선',  '(B/12,−3.5) → (23.5, 3.1)', g.shLenBack, 'back', [(g.SNPb[0] + g.SPb[0]) / 2, (g.SNPb[1] + g.SPb[1]) / 2]),
      FN('armBack',  '뒤 암홀',    '곡선길이',                  AHb,       'back',  [g.bPitchX + 1.0, g.BL * 0.5]),
      FN('neckBack', '뒷목둘레',   '곡선길이',                  NKb,       'back',  [nw * 0.5, -0.9]),
      /* ── 앞면 ── */
      FN('BL',       'BL',        'B/4',                     g.BL,      'front', [g.fSideX * 0.5, g.BL]),
      FN('WL',       '허리선',     '등길이',                   g.WL,      'front', [g.fSideX * 0.5, g.WL]),
      FN('side',     '옆선',       'B/4 + 1.6',               g.fSideX,  'front', [g.fSideX, (g.armY + g.WL) / 2]),
      FN('frontW',   '앞품선',     '앞품/2',                   g.fPitchX, 'front', [g.fPitchX, g.BL * 0.6]),
      FN('neckW',    '앞목너비',   'B/12',                     nw,        'front', [nw * 0.5, -K.frontNeckLift]),
      FN('neckD',    '앞목깊이',   'B/12 + 0.3',              g.FNP[1],  'front', [0.6, g.FNP[1] * 0.5]),
      FN('vMark',    'V 통과점',   '목 사각 대각선 2/3 점에서 모서리 쪽 1.0', K.vNeckMark, 'front', cp(g.vMark)),
      FN('vDepth',   'V 깊이',     '앞목깊이 + ' + f1(K.vDepthAdd) + ' (앞중심)', g.opt.vDepth, 'front', [0.8, g.opt.vDepth]),
      FN('wrapEnd',  '자락 끝',    '허리선에서 위로 ' + f1(g.opt.wrapUp), g.Vend[1], 'front', cp(g.Vend)),
      FN('bpLen',    '유장',       '앞목옆점에서 수직 유장',      m.bpLen,   'front', [(g.SNPf[0] + g.BP[0]) / 2, (g.SNPf[1] + g.BP[1]) / 2]),
      FN('bpSpan',   '유폭',       '유폭/2',                   g.BP[0],   'front', [g.BP[0] * 0.5, g.BP[1] - 1.2]),
      FN('hemDrop',  '옆선 늘림',  (g.sideTrue ? '다트를 접어도 뒤 옆선과 맞도록 밑단을 내림' : '트루잉 끔 — 교재 도면 그대로'),
                                                              g.hemDrop, 'front', [g.fSideX * 0.8, g.WL + g.hemDrop * 0.5]),
      FN('dart',     '가슴다트',   '다트분 ' + f1(g.opt.dartAmount) + ' · 아래 다리 = 허리선 위 B/8 = ' + f1(g.opt.dartRise),
                                                              g.opt.dartAmount, 'front', [(g.BP[0] + g.fSideX) / 2, (g.dartHi[1] + g.dartLo[1]) / 2]),
      FN('shFront',  '앞 어깨선',  '뒤 어깨선 − 이세 ' + f1(g.shEase), g.shLenFront, 'front', [(g.SNPf[0] + g.SPf[0]) / 2, (g.SNPf[1] + g.SPf[1]) / 2]),
      FN('armFront', '앞 암홀',    '곡선길이',                  AHf,       'front', [g.fPitchX + 1.0, g.BL * 0.5]),
      FN('neckFront','V 네크라인', '곡선길이',                  NKf,       'front', [-g.fSideX * 0.5, (g.Vcf[1] + g.Vend[1]) / 2]),
      FN('facing',   '안단너비',   '목둘레·암홀 공통',           g.facing,  'both',  [0, 0]),
      FN('seam',     '시접',       '변별 기본값',                (typeof seam === 'number' ? seam : 0), 'both', [0, 0])
    ];
  }

  /* ══════════════════════════════════════════════════════════════════
   * 6. 노출
   * ════════════════════════════════════════════════════════════════ */
  return {
    measuresForSize: measuresForSize,
    draftVNeck: draftVNeck,
    draft: draftVNeck,                // 공통 이름
    geom: geom,
    MEAS_KEYS: MEAS_KEYS, MEAS_LABEL: MEAS_LABEL, SIZES: Object.keys(SIZE_STEP),
    BASE: BASE, GRADE: GRADE, K: K, CAL: CAL, FLATTEN: FLATTEN,
    SEAM_DEFAULT: SEAM_DEFAULT, SEAM_ROLES: SEAM_ROLES,
    util: { V: V, bez: bez, bezLen: bezLen, sLen: sLen, through: through, splineSegs: splineSegs,
            endTan: endTan, sPath: sPath, LN: LN,
            sampleSegs: sampleSegs, polyLen: polyLen, offsetLoop: offsetLoop, offsetLoopSeg: offsetLoopSeg,
            normSeam: normSeam, lineSegs: lineSegs, offsetOpen: offsetOpen,
            rotv: rotv, rotAbout: rotAbout, perpToward: perpToward, revSegs: revSegs }
  };
});
