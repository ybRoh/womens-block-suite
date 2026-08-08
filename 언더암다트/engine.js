/* ============================================================================
 * 언더암 다트 원형 — 제도 엔진
 *   · **제도 1** = 숙녀복 기본원형 앞판 다트 제도법 (허리다트 BP 아래 수직 ·
 *     가슴다트는 암홀 끝점에서 5 아래) 그대로.
 *   · **제도 2** = 그 상태에서 **허리다트를 BP 중심으로 접어** 그 분량을
 *     가슴다트로 회전시킨 것 → 언더암 다트 하나.
 *   · 다트는 **BP 까지 박지 않고 1.3~1.9 남기고** 끝낸다 (교재 `1.3(하)~1.9(상)`).
 *   · 교재 도면은 앞판만 그린다. 뒷판은 기준 원형 그대로 함께 낸다.
 *   · 정답지: 숙녀복기본원형1.dxf (몸판 66호) · 반소매원형 (1).dxf (소매 47P)
 *   · SPEC.md §1 좌표계 · §12 Draft 구조 · §19 계산식 준수
 *
 * 좌표계: cm. x = 중심선(CB/CF)에서 옆선 방향 +, y = 상단 기준선에서 아래 +
 *         조각마다 자기 로컬 원점(뒤판 = CB×상단선, 앞판 = CF×상단선)
 *
 * 기본원형(무다트)과 다른 점 — 이 원형은 **다트가 있는 몸판**입니다.
 *   · 앞판: 옆선 가슴다트(앞길이−등길이) + 허리다트(1.0/1.5)
 *   · 뒤판: 허리다트(2.0)
 *   · 폭이 `B/4 + 여유분/2` 라 여유분이 사용자 입력입니다 (도면은 여유분 0)
 *   · 뒤 허리선 = 등길이, 앞 중심 밑단 = 앞길이 (§19-2 참조)
 *
 * 노출: window.UnderarmEngine (+ 호환 별칭 window.Lady1Engine / window.NoDartEngine)
 * 곡선: 기본원형 엔진과 같은 Freesewing(Brian block) 계열 3차 베지어.
 *       핸들 길이·끝접선 각도는 66호 원본 DXF 에 맞춰 캘리브레이션했고,
 *       전부 무차원 비율이라 호수가 바뀌어도 자기유사하게 스케일된다.
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.UnderarmEngine = api; window.Lady1Engine = api; window.NoDartEngine = api; }
  else if (root) { root.UnderarmEngine = api; root.Lady1Engine = api; root.NoDartEngine = api; }
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
  var BASE  = { B: 84.0, backLen: 37.5, frontLen: 40.0, shoulderW: 37.0,
                backW: 34.4, frontW: 32.0, bpLen: 24.0, bpSpan: 18.0 };
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
   * 2. 제도 상수 (SPEC §19-3 + 66호 DXF 실측)
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;          // outline/seamline 폴리라인 간격 (cm) — 요구 0.05 이하
  var EASE_DEFAULT = 0;        // 여유분 기본값. 도면(66호)이 여유분 0 으로 그려져 있다
  var K = {
    /* ── 공통 ── */
    armDepthEase : 0.6,        // 가슴선 BL = B/4 + 0.6
    waistIn      : 1.2,        // 허리 옆선 들임 (앞뒤 공통)

    /* ── 뒤판 ── */
    backNeckAdd  : 1.0,        // 뒷목너비 = B/12 + 1
    backNeckRise : 2.5,        // 뒷목 올림 (목옆점이 상단 기준선 위로)
    backShDrop   : 0.6,        // 뒤 어깨선이 등품선과 만나는 y  (도면 `0.6↓`)
    backShEase   : 0.5,        // 뒤 어깨점 x = 어깨너비/2 + 이세분 (도면 `+0.3~0.6`)
    bDartShoulder: 4.5,        // 뒤 다트 중심선 시작 = 어깨선 위 목옆점에서 4.5 (도면 `4.5`)
    bDartBLOff   : 1.2,        // 뒤 다트 중심 x = 등품/4 + 1.2  (도면 `중심 ← 1.2`)
    bDartTipUp   : 5.0,        // 뒤 다트끝 = 중심선 위 BL 에서 5.0 (도면 `5`)
    bDartW       : 2.0,        // 뒤 허리다트 폭

    /* ── 앞판 ── */
    frontShDrop  : 3.4,        // 앞 어깨선이 앞품선과 만나는 y  (도면 `3.4↓`)
    neckDiagRatio: 2 / 3,      // 앞목 곡선은 목 구성 사각 대각선의 2/3 점을 지난다
                               //   (66호 DXF 에 반지름 0.104 표시원이 정확히 그 점에 있다)
    sideDartDrop : 5.0,        // 옆선 가슴다트 위 다리 발점 = 옆선 위 BL 에서 5.0 (도면 `5`)
    sideDartTrue : 0.3,        // 다트 트루잉 — 위 다리 −0.3 · 아래 다리 +0.3 (도면 `0.3 이세분 커트`)
                               //   두 다리 끝 사이 벌어짐 = 앞길이 − 등길이.
                               //   66호 DXF 실측 2.5003 (= 40 − 37.5) 로 정확히 일치한다.
    /* ★ 이 원형은 허리다트를 **BP 중심으로 접어** 언더암으로 보낸다.
       그러려면 허리다트끝이 BP 에 있어야 회전이 정확히 닫힌다 (기준 원형은 2.5 아래). */
    fDartTipDown : 0.0,        // 앞 허리다트끝 = BP (회전 중심)
    /* 다트를 BP 까지 박지 않고 남기는 거리 — 교재 `1.3(하) ~ 1.9(상)`.
       66호 1.6 · 호수당 ±0.15 → 44호 1.3 / 88호 1.9 */
    dartTipGap     : 1.6,
    dartTipGapGrade: 0.15,
    fDartIn      : 1.0,        // 앞 허리다트 CF 쪽 다리  (도면 `←1`)
    /* ★ 이 원형은 기준 원형과 다트 크기가 다르다 —
       허리다트 1 + 1.5 → **1 + 1** · 옆선 가슴다트 2.5 → **1.5** */
    fDartOut     : 1.0,        // 앞 허리다트 옆선 쪽 다리 (기준 원형 1.5)
    bustDartAmt  : 1.5,        // 옆선 가슴다트 벌어짐 고정값 (기준 원형은 앞길이 − 등길이 = 2.5)

    /* ── 반소매 (SPEC §17-2 · 반소매원형 (1).dxf 실측) ── */
    armNotchDiv    : 3,        // 암홀·소매산 너치 등분 수 (3등분 = 1/3 · 2/3 두 곳)
    capReduce      : 0,        // 대각선 감소량. 도면 교차검증 결과 0 (대각선 = 암홀 길이)
    sleeveHemInset : 1.5,      // 밑단 들임 (좌우 각)
    sleeveHemDrop  : 0.5,      // 밑단 2등분점 → 끝 하강량
    capBulge       : 0.5,      // 곡선 통과점 = 대각선 발점 ↔ 마크 사이의 비율 (도면 실측 0.500~0.512)
    capTension     : 0.42,     // 소매산 통과점 베지어 장력
    hemC1: 0.25, hemC2x: 0.18, hemC2y: 0.025,  // 밑단 하강 곡선 핸들

    /* ── 타이트 긴소매 (교재 48P · 언더암다트_타니트긴소매.dxf 실측) ── */
    tightApexShift   : 0.6,    // 소매산 정점을 앞으로 이동 (도면 `앞으로이동 0.6`)
    tightBackHemDrop : 0.3,    // 소맷부리 뒤쪽 끝 내림 (도면 `0.3↓`)
    tightElbowAdd    : 2.5,    // 팔꿈치선 = 소매길이/2 + 2.5 (도면 실측 32.314)
    tightUnderTension: 0.42,   // 앞 밑선 통과점 베지어 장력 (재적합 대상)

    /* ── 2장소매 (교재 48P · 숙녀복기본원형 2장소매.dxf 실측) ── */
    twoSideOff       : 3.0,    // 작은소매 뒤 +3 · 큰소매 앞 −3 (도면 `3`)
    twoHemDrop       : 1.3,    // 밑단이 소매길이보다 내려가는 양 (도면 `1.3↓`)
    twoFrontHemIn    : 1.7,    // 큰소매 앞 밑단 들임
    twoFrontElbowIn  : 0.30,   // 큰소매 앞 경계의 팔꿈치 들임
    twoBackElbowOut  : 0.55,   // 작은소매 바깥 뒤 경계의 팔꿈치 내밈
    /* 소맷부리 트임 — 도면 마크 `2.2` `9` `2`.
       절개선 아래 9 를 바깥으로 2.2 내밀어 덧단을 만든다. 두 조각의 덧단이 서로
       겹쳐 트임이 닫힌다. 미터 접음선은 트임 위 모서리 → 절개선 위 2 지점. */
    ventW            : 2.2,    // 트임 너비 (도면 실측 2.2007 / 2.2016)
    ventLen          : 9.0,    // 트임 길이 (도면 트임선 8.9485 · 절개선 현 8.998)
    ventMitre        : 2.0     // 미터 접음선이 절개선 위로 올라가는 거리 (도면 실측 2.0006)
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도
   * ════════════════════════════════════════════════════════════════ */

  /** 광선 O + t·u 위에서 기준점 R 로부터 거리가 d 인 점 (t > 0 중 tHint 에 가까운 쪽) */
  function pointOnRayAtDist(O, u, R, d, tHint) {
    var w = V.sub(O, R);
    var b = 2 * (w[0] * u[0] + w[1] * u[1]);
    var c = w[0] * w[0] + w[1] * w[1] - d * d;
    var disc = b * b - 4 * c;
    if (disc < 0) return V.add(O, V.mul(u, tHint));                 // 닿지 않으면 힌트 그대로
    var s = Math.sqrt(disc), t1 = (-b + s) / 2, t2 = (-b - s) / 2;
    var t = (Math.abs(t1 - tHint) <= Math.abs(t2 - tHint)) ? t1 : t2;
    return V.add(O, V.mul(u, t));
  }

  /** 제도점 + 곡선만 계산 (폴리라인 flatten 없음). draftLady1 과 engine-verify 가 공유. */
  function geom(m, opt) {
    opt = opt || {};
    var ease = (opt.ease === undefined) ? EASE_DEFAULT : +opt.ease;          // 여유분
    var shEase = (opt.shoulderEase === undefined) ? K.backShEase : +opt.shoulderEase;
    MEAS_KEYS.forEach(function (k) {
      if (typeof m[k] !== 'number' || !isFinite(m[k])) throw new Error('치수 누락/오류: ' + k);
    });

    var B = m.B;
    var nwF = B / 12;                       // 앞목너비 = 앞목깊이 = B/12
    var nwB = B / 12 + K.backNeckAdd;       // 뒷목너비 = B/12 + 1
    var BL = B / 4 + K.armDepthEase;        // 가슴선 (앞뒤 공통, 상단 기준선에서)
    var halfW = B / 4 + ease / 2;           // 옆선 x  = B/4 + 여유분/2
    var WLb = m.backLen;                    // 뒤 허리선 = 등길이
    var WLf = m.frontLen;                   // 앞 중심 밑단 = 앞길이
    /* 가슴다트 벌어짐 — 기준 원형은 `앞길이 − 등길이`(2.5) 지만 이 원형은 **1.5 고정**.
       나머지 분량은 허리다트를 접어 언더암으로 보내면서 흡수된다. */
    var dartAmt = (opt.bustDartAmt !== undefined) ? +opt.bustDartAmt
                : (K.bustDartAmt || (m.frontLen - m.backLen));

    /* ───────── 뒤판 ───────── */
    var bPitchX = m.backW / 2;
    var BNP = [0, 0];                                             // 목뒤점 (상단 기준선 위)
    var SNPb = [nwB, -K.backNeckRise];                            // 목옆점 (올림 2.5)
    var bShDir = V.norm(V.sub([bPitchX, K.backShDrop], SNPb));    // 어깨 기울기: 등품선에서 0.6
    var bSpX = m.shoulderW / 2 + shEase;
    var SPb = [bSpX, SNPb[1] + (bShDir[1] / bShDir[0]) * (bSpX - SNPb[0])];
    var Ub = [halfW, BL];                                         // 겨드랑 (옆선 × BL)
    var bWaist = [halfW - K.waistIn, WLb];
    var shLenBack = V.dist(SNPb, SPb);

    // 뒤 허리다트 — 중심선 = 어깨선 위 4.5 지점 ↔ BL 위 (등품/4 + 1.2)
    var bDartX = m.backW / 4 + K.bDartBLOff;
    var bDartBL = [bDartX, BL];
    var bDartTop = V.add(SNPb, V.mul(bShDir, K.bDartShoulder));
    var bDartTip = V.add(bDartBL, V.mul(V.norm(V.sub(bDartTop, bDartBL)), K.bDartTipUp));
    var bDartL = [bDartX - K.bDartW / 2, WLb];
    var bDartR = [bDartX + K.bDartW / 2, WLb];

    /* ───────── 앞판 ───────── */
    var fPitchX = m.frontW / 2;
    var SNPf = [nwF, 0];
    var FNP = [0, nwF];                                           // 앞목 중심 (깊이 B/12)
    var fShDir = V.norm(V.sub([fPitchX, K.frontShDrop], SNPf));   // 어깨 기울기: 앞품선에서 3.4
    var SPf = V.add(SNPf, V.mul(fShDir, shLenBack));              // 앞 어깨선 길이 = 뒤 어깨선 길이
    var Uf = [halfW, BL];
    // BP — x = 유폭/2, 목옆점에서 잰 거리 = 유장
    var bpx = m.bpSpan / 2;
    var bpDx = bpx - SNPf[0];
    var BP = [bpx, SNPf[1] + Math.sqrt(Math.max(m.bpLen * m.bpLen - bpDx * bpDx, 0.01))];

    /* 옆선 가슴다트 — 두 다리 모두 **다트 기준점까지의 길이 rA**, 벌어짐 = 앞길이 − 등길이.
     *
     * ★ 다트는 접어서 꿰매므로 **두 다리 길이가 같아야** 한다. 다르면 접었을 때
     *   끝점이 안 맞아 옆선에 턱이 지고, 그만큼 잘라내야 한다.
     *
     * 도면(숙녀복기본원형1.dxf 실측) —
     *   · BP →(21.000, 26.600) 12.2964 는 **다트 기준선(작도선)** 이지 다리가 아니다.
     *   · 위 다리 = 옆선(위)이 끝나는 곳 (20.678, 26.528) → **11.9662** (= rA − 0.33)
     *   · 아래 다리 BP →(20.516, 29.023) → **12.5972** (= rA + 0.30)
     *   · 두 끝 사이 벌어짐 |위−아래| = 2.5003 = 앞길이 − 등길이 ✔
     * 즉 도면은 두 다리가 **0.63 차이**난다. 그 차이는 접어서 잘라내는 트루잉분이므로
     * 완성 패턴은 **둘 다 위 다리 길이(rA − 0.3)** 로 맞춘다.
     *
     * ⚠ 한때 BP→(21,26.6) 을 위 다리로 착각해 rA 로 늘렸다가 도면에서 0.33 밀렸다.
     *   도면에서 **작도선과 완성선을 구분**할 것 — 여기선 옆선이 끝나는 점이 다리 끝이다. */
    var dFoot = [halfW, BL + K.sideDartDrop];
    var uUp = V.norm(V.sub(dFoot, BP));
    var rA = V.dist(BP, dFoot);
    var rU = Math.max(0.5, rA - K.sideDartTrue), rL = rU;   // ★ 두 다리 같은 길이
    var aU = Math.atan2(uUp[1], uUp[0]);
    var dUp = [BP[0] + rU * Math.cos(aU), BP[1] + rU * Math.sin(aU)];
    var loAt = function (th) { return [BP[0] + rL * Math.cos(aU + th), BP[1] + rL * Math.sin(aU + th)]; };

    /* 다트 벌어짐 — 교재 규칙은 `앞길이 − 등길이`. 그 규칙의 **목적**이
       "다트를 접으면 앞 옆선이 뒤 옆선과 같아진다" 이므로, 각을 거기서 조금 열어
       **앞 옆선 = 뒤 옆선** 을 정확히 맞춘다 (66호 2.500 → 2.59, 0.09 차).
       다리 길이는 둘 다 rA 로 고정이라 이 조정은 다리 길이를 건드리지 않는다.
       opt.trueSide === false 를 주면 규칙값(앞길이 − 등길이) 그대로 쓴다. */
    var sideBack = V.dist(Ub, bWaist);
    var fWaist = [halfW - K.waistIn, WLf];
    var th0 = 2 * Math.asin(Math.max(-1, Math.min(1, dartAmt / (2 * rU))));
    var sideUpLen = V.dist(Uf, dUp);
    var frontAt = function (th) { return sideUpLen + V.dist(loAt(th), fWaist); };
    var dTheta = th0;
    if (opt.trueSide === true) {          // 벌어짐이 고정값이라 기본은 규칙대로 둔다
      var lo = Math.max(1e-4, th0 - 0.30), hi = th0 + 0.30;
      if ((frontAt(lo) - sideBack) * (frontAt(hi) - sideBack) < 0) {
        for (var it = 0; it < 60; it++) {            // 각을 키우면 앞 옆선이 짧아진다
          var mt = (lo + hi) / 2;
          if (frontAt(mt) > sideBack) lo = mt; else hi = mt;
        }
        dTheta = (lo + hi) / 2;
      }
    }
    var dLo = loAt(dTheta);
    var sideLow = V.dist(dLo, fWaist);
    var dUpTrue = dUp;

    // 앞 허리다트 — 중심 = BP 아래 수직, 끝은 BP 에서 2.5 아래
    /* ── 제도 2 : 허리다트를 BP 중심으로 접는다 ─────────────────────────
     *  옆선 쪽 조각(가슴다트 아래다리 → 옆선(아래) → 밑단(옆) → 허리다트 옆다리)을
     *  BP 둘레로 돌려 **허리다트 옆다리를 중심다리에 포갠다.** 그만큼 가슴다트가
     *  벌어져 **언더암 다트** 하나가 된다. 66호 회전 8.886° · 벌어짐 2.603 → 4.443.
     *  회전은 강체라 조각의 다른 치수는 하나도 변하지 않는다.               */
    var fDartTip = [BP[0], BP[1] + K.fDartTipDown];
    var fDartL = [BP[0] - K.fDartIn, WLf];
    var fDartR = [BP[0] + K.fDartOut, WLf];

    /* 회전각 = BP 에서 본 두 허리다트 다리 사이 각. 옆다리를 중심다리로 보낸다. */
    var angOf = function (q) { return Math.atan2(q[1] - BP[1], q[0] - BP[0]); };
    var uaRot = angOf(fDartL) - angOf(fDartR);
    var rotP = function (q) {
      var c = Math.cos(uaRot), si = Math.sin(uaRot);
      var dx = q[0] - BP[0], dy = q[1] - BP[1];
      return [BP[0] + dx * c - dy * si, BP[1] + dx * si + dy * c];
    };
    var uaDLo = rotP(dLo), uaWaist = rotP(fWaist);
    /* 다트끝은 BP 까지 안 간다 — 두 다리의 이등분선 위로 dartGap 만큼 옆선 쪽에 둔다 */
    var dartGap = (opt.dartTipGap === undefined)
      ? K.dartTipGap + K.dartTipGapGrade * ((m.B - BASE.B) / GRADE.B) : +opt.dartTipGap;
    var bis = V.norm(V.add(V.norm(V.sub(dUpTrue, BP)), V.norm(V.sub(uaDLo, BP))));
    var uaDartTip = [BP[0] + bis[0] * dartGap, BP[1] + bis[1] * dartGap];
    /* ★ 완성선 밑단 — **옆선 끝에서 앞중심까지 한 줄 스플라인**.
       다트가 닫힌 자리에서 한 번 꺾어 두 도막으로 그렸더니 그 앞이 평평하고
       그 뒤가 뚝 떨어지는 S 가 났다. 완만한 한 줄이라야 한다.
       · 옆선 끝: 옆선에 **직각**으로 출발 (앞뒤를 붙였을 때 옆선이 안 꺾인다)
       · 앞중심: **수평** 도착 (골선이라 접었을 때 매끄러워야 한다)
       다트 닫힌 자리(fDartL)는 지나가지 않고 그 아래로 완만히 흐른다 — 트루잉이다. */
    var uaSideDir = V.norm(V.sub(uaWaist, uaDLo));
    var uaHemStart = [uaSideDir[1], -uaSideDir[0]];                 // 옆선 수직
    if (uaHemStart[0] > 0) uaHemStart = [-uaHemStart[0], -uaHemStart[1]];   // 앞중심 쪽으로
    var uaHem = splineSegs([uaWaist, [0, WLf]],
      endTan(uaHemStart, CAL.uaHem.k0), endTan([-1, 0], CAL.uaHem.k1));

    /* ───────── 곡선 ───────── */
    /* 품선 2등분점 — 뒤 등품선은 상단 기준선(0)~BL, 앞 앞품선은 어깨 기울기점(3.4)~BL */
    var bPitchY = BL / 2;
    var fPitchY = (K.frontShDrop + BL) / 2;
    var backNeck = curveBackNeck(BNP, SNPb, bShDir);
    var backArm = curveArmhole(Ub, SPb, bShDir, bPitchX, bPitchY, BL, true);
    var frontNeck = curveFrontNeck(FNP, SNPf, fShDir, nwF);
    var frontArm = curveArmhole(Uf, SPf, fShDir, fPitchX, fPitchY, BL, false);

    return {
      m: m, ease: ease, shEase: shEase, nwF: nwF, nwB: nwB, BL: BL, halfW: halfW,
      WLb: WLb, WLf: WLf, dartAmt: dartAmt,
      bPitchX: bPitchX, bSpX: bSpX, bShDir: bShDir, BNP: BNP, SNPb: SNPb, SPb: SPb,
      Ub: Ub, bWaist: bWaist, shLenBack: shLenBack,
      bDartX: bDartX, bDartBL: bDartBL, bDartTop: bDartTop, bDartTip: bDartTip,
      bDartL: bDartL, bDartR: bDartR,
      fPitchX: fPitchX, fShDir: fShDir, SNPf: SNPf, FNP: FNP, SPf: SPf, Uf: Uf,
      fWaist: fWaist, BP: BP, dFoot: dFoot, dUp: dUp, dUpTrue: dUpTrue, dLo: dLo,
      rU: rU, rL: rL, dartOpen: V.dist(dUp, dLo),
      fDartTip: fDartTip, fDartL: fDartL, fDartR: fDartR,
      /* ── 언더암 다트 (제도 2) ── */
      uaRot: uaRot, uaDLo: uaDLo, uaWaist: uaWaist, uaDartTip: uaDartTip,
      uaOpen: V.dist(dUpTrue, uaDLo), uaGap: dartGap, uaHem: uaHem,
      uaHemLen: polyLen(sampleSegs(uaHem, 0.02)), uaDrop: uaWaist[1] - WLf,
      dartOpenStage1: V.dist(dUpTrue, dLo),
      shLenFront: V.dist(SNPf, SPf), sideBack: sideBack,
      sideUp: V.dist(Uf, dUpTrue), sideLow: sideLow,
      backNeck: backNeck, backArm: backArm, frontNeck: frontNeck, frontArm: frontArm
    };
  }

  function draftLady1(m, opt) {
    opt = opt || {};
    var seam = (opt.seam === undefined) ? 0 : opt.seam;
    var g = geom(m, opt);

    /* ───────── 조각 조립 ─────────
       다트는 outline 에 V 홈으로 들어간다 (도면의 허리선이 다트에서 끊겨 있다).
       다트 변의 role 은 'dart' = 시접 0 — 골선과 같은 처리라, 허리 시접이
       다트 다리를 따라 그대로 연장된다 (봉제 시 시접이 다트를 통과하는 모양). */
    var backEdges = [
      { name: '뒷목둘레',   role: 'neck',     segs: g.backNeck },
      { name: '어깨선',     role: 'shoulder', segs: lineSegs(g.SNPb, g.SPb) },
      { name: '뒤암홀',     role: 'armhole',  segs: revSegs(g.backArm) },
      { name: '옆선',       role: 'side',     segs: bowSegs(g.Ub, g.bWaist, CAL.backSideSeam) },
      { name: '허리선(옆)', role: 'hem',      segs: lineSegs(g.bWaist, g.bDartR) },
      /* 다리는 도면대로 **곡선** — 둘 다 뒤중심 쪽으로 휜다 (직선이면 0.44 벌어진다) */
      { name: '다트 옆다리', role: 'dart',    segs: revSegs(bowSegs(g.bDartTip, g.bDartR, CAL.dartBackSide)) },
      { name: '다트 중심다리', role: 'dart',  segs: bowSegs(g.bDartTip, g.bDartL, CAL.dartBackCtr) },
      { name: '허리선(중심)', role: 'hem',    segs: lineSegs(g.bDartL, [0, g.WLb]) },
      { name: '뒤중심',     role: 'fold',     segs: lineSegs([0, g.WLb], g.BNP) }
    ];
    /* 제도 1 = 기준 원형 그대로(가슴다트 + 허리다트).
       제도 2 = 허리다트를 BP 중심으로 접어 언더암 다트 하나로 만든 것. 기본은 제도 2. */
    var stage = (+opt.stage === 1) ? 1 : 2;
    var frontHead = [
      { name: '앞목둘레',   role: 'neck',     segs: g.frontNeck },
      { name: '어깨선',     role: 'shoulder', segs: lineSegs(g.SNPf, g.SPf) },
      { name: '앞암홀',     role: 'armhole',  segs: revSegs(g.frontArm) },
      { name: '옆선(위)',   role: 'side',     segs: lineSegs(g.Uf, g.dUpTrue) }
    ];
    var frontEdges = (stage === 1) ? frontHead.concat([
      { name: '가슴다트 위다리', role: 'dart', segs: lineSegs(g.dUpTrue, g.BP) },
      { name: '가슴다트 아래다리', role: 'dart', segs: lineSegs(g.BP, g.dLo) },
      { name: '옆선(아래)', role: 'side',     segs: lineSegs(g.dLo, g.fWaist) },
      { name: '밑단(옆)',   role: 'hem',      segs: lineSegs(g.fWaist, g.fDartR) },
      { name: '허리다트 옆다리', role: 'dart', segs: revSegs(bowSegs(g.fDartTip, g.fDartR, CAL.dartFrontSide)) },
      { name: '허리다트 중심다리', role: 'dart', segs: bowSegs(g.fDartTip, g.fDartL, CAL.dartFrontCtr) },
      { name: '밑단(중심)', role: 'hem',      segs: lineSegs(g.fDartL, [0, g.WLf]) },
      { name: '앞중심',     role: 'fold',     segs: lineSegs([0, g.WLf], g.FNP) }
    ]) : frontHead.concat([
      /* ★ 언더암 다트 — BP 까지 박지 않고 uaGap(1.3~1.9) 남기고 끝낸다 */
      { name: '언더암다트 위다리', role: 'dart', segs: lineSegs(g.dUpTrue, g.uaDartTip) },
      { name: '언더암다트 아래다리', role: 'dart', segs: lineSegs(g.uaDartTip, g.uaDLo) },
      { name: '옆선(아래)', role: 'side',     segs: lineSegs(g.uaDLo, g.uaWaist) },
      /* ★ 완성선 — 허리다트를 접으면 옆선 쪽 밑단이 1.5 남짓 돌아간다. 옆선은 그대로 두고
         **밑단만 매끄럽게 이어 그린다.** 옆선에는 직각으로 출발해 다트가 닫힌 자리
         (허리다트 중심다리 끝) 에 **수평으로 도착**하므로 앞중심 쪽 허리선과 안 꺾인다. */
      { name: '밑단',       role: 'hem',      segs: g.uaHem },
      { name: '앞중심',     role: 'fold',     segs: lineSegs([0, g.WLf], g.FNP) }
    ]);

    var backLoop = edgesToLoop(backEdges), frontLoop = edgesToLoop(frontEdges);
    var backSeam = buildSeamline(backLoop, seam), frontSeam = buildSeamline(frontLoop, seam);

    var backPiece = {
      id: 'back', name: '뒷판', cutCount: 2,
      grainline: [[1.5, 2.0], [1.5, g.WLb - 2.0]],
      outline: backLoop.pts,
      seamline: backSeam.seamline,
      foldEdges: backSeam.foldEdges,
      seamEdges: backSeam.seamEdges,
      seamFoldEdges: backSeam.seamFoldEdges,
      seamByRole: backSeam.seamByRole,
      edges: withSeam(backLoop.ranges, backSeam.edgeSeam),
      internal: backInternal(m, g).concat(backEdgeInternals(g)),
      notches: [
        { p: cp(g.SPb),  angle: angDeg(perpToward(g.bShDir, g.SPb, g.Ub)),   label: '어깨점' },
        { p: cp(g.SNPb), angle: angDeg(perpToward(g.bShDir, g.SNPb, g.BNP)), label: '목옆점' },
        { p: cp(g.Ub),   angle: 180,                                          label: '옆선 BL' }
      ].concat(armNotches(g.backArm, g.Ub, [g.bDartX, g.BL], '뒤암홀')).concat([
        /* ↑ 암홀 3등분 너치 — 소매산의 같은 비율 지점과 짝이 된다 */
        { p: cp(g.bDartL), angle: -90,                                        label: '다트' },
        { p: cp(g.bDartR), angle: -90,                                        label: '다트' }
      ]),
      bbox: bboxOf(backLoop.pts)
    };
    var frontPiece = {
      id: 'front', name: '앞판', cutCount: 2,
      grainline: [[1.5, 4.0], [1.5, g.WLf - 2.0]],
      outline: frontLoop.pts,
      seamline: frontSeam.seamline,
      foldEdges: frontSeam.foldEdges,
      seamEdges: frontSeam.seamEdges,
      seamFoldEdges: frontSeam.seamFoldEdges,
      seamByRole: frontSeam.seamByRole,
      edges: withSeam(frontLoop.ranges, frontSeam.edgeSeam),
      internal: frontInternal(m, g).concat(frontEdgeInternals(g)),
      notches: [
        { p: cp(g.SPf),  angle: angDeg(perpToward(g.fShDir, g.SPf, g.Uf)),   label: '어깨점' },
        { p: cp(g.SNPf), angle: angDeg(perpToward(g.fShDir, g.SNPf, g.FNP)), label: '목옆점' },
        { p: cp(g.Uf),   angle: 180,                                          label: '옆선 BL' }
      ].concat(armNotches(g.frontArm, g.Uf, [g.BP[0], g.BL], '앞암홀')).concat([
        { p: cp(g.dUpTrue), angle: 180,                                       label: '가슴다트' },
        { p: cp(g.dLo),  angle: 180,                                          label: '가슴다트' },
        { p: cp(g.fDartL), angle: -90,                                        label: '허리다트' },
        { p: cp(g.fDartR), angle: -90,                                        label: '허리다트' }
      ]),
      bbox: bboxOf(frontLoop.pts)
    };

    var AHb = sLen(g.backArm), AHf = sLen(g.frontArm);
    var NKb = sLen(g.backNeck), NKf = sLen(g.frontNeck);
    var sideFront = g.sideUp + g.sideLow;

    /* ───────── 반소매 (SPEC §17-2) ───────── */
    var slv = (opt.includeSleeve === false) ? null : sleeveGeom(m, opt, AHb, AHf);
    var pieces = [backPiece, frontPiece];
    if (slv) {
      if (slv.twoPiece) twoSleevePieces(slv, seam).forEach(function (p) { pieces.push(p); });
      else pieces.push(sleevePiece(slv, seam));
    }

    return {
      pieces: pieces,
      measures: {
        shoulderBack: r4(g.shLenBack),
        shoulderFront: r4(g.shLenFront),
        shoulderEase: r4(g.shEase),
        shoulderBackSeam: r4(g.shLenBack),
        shoulderFrontSeam: r4(g.shLenFront),
        armholeBack: r4(AHb), armholeFront: r4(AHf), armholeTotal: r4(AHb + AHf),
        neckBack: r4(NKb), neckFront: r4(NKf), neckTotal: r4(NKb + NKf),
        sideBack: r4(g.sideBack), sideFront: r4(sideFront),
        /* ── 다트 (이 원형 고유) ── */
        bustDartOpen: r4(g.dartOpen),          // 옆선 가슴다트 벌어짐 = 앞길이 − 등길이
        bustDartLegUp: r4(V.dist(g.BP, g.dUpTrue)),
        bustDartLegLow: r4(g.rL),
        waistDartBack: r4(K.bDartW),
        waistDartFront: r4(K.fDartIn + K.fDartOut),
        waistBack: r4(g.bWaist[0] - K.bDartW),   // 뒤 허리 완성 반폭 (다트 뺀 값)
        waistFront: r4(g.fWaist[0] - (K.fDartIn + K.fDartOut)),
        ease: r4(g.ease),
        /* ── 반소매 ── */
        sleeveCapEase:  slv ? r4(slv.capLenTotal - (AHb + AHf)) : null,
        sleeveWidth:    slv ? r4(slv.halfB + slv.halfF) : null,
        capHeight:      slv ? r4(slv.capH) : null,
        sleeveHemWidth: slv ? r4(slv.hemHalfB + slv.hemHalfF) : null,
        sleeveLen:        slv ? r4(slv.sleeveLen) : null,
        sleeveType:       slv ? slv.sleeveType : null,
        sleeveTypeName:   slv ? slv.typeName : null,
        sleeveUnderLenBack:  slv ? r4(slv.underLenB) : null,
        sleeveUnderLenFront: slv ? r4(slv.underLenF) : null,
        sleeveCapLenBack: slv ? r4(slv.capLenBack) : null,
        sleeveCapLenFront: slv ? r4(slv.capLenFront) : null,
        sleeveCapLenTotal: slv ? r4(slv.capLenTotal) : null,
        capReduce:        slv ? r4(slv.capReduce) : null
      },
      size: sizeNameOf(m),
      points: {
        back:  { BNP: cp(g.BNP), SNP: cp(g.SNPb), SP: cp(g.SPb), U: cp(g.Ub), waist: cp(g.bWaist),
                 dartTip: cp(g.bDartTip), dartL: cp(g.bDartL), dartR: cp(g.bDartR),
                 BL: g.BL, WL: g.WLb, sideX: g.halfW, pitchX: g.bPitchX, spGuideX: g.bSpX },
        front: { FNP: cp(g.FNP), SNP: cp(g.SNPf), SP: cp(g.SPf), U: cp(g.Uf), BP: cp(g.BP),
                 dartUp: cp(g.dUpTrue), dartLow: cp(g.dLo), dartFoot: cp(g.dFoot),
                 waistDartTip: cp(g.fDartTip), waistDartL: cp(g.fDartL), waistDartR: cp(g.fDartR),
                 waist: cp(g.fWaist), BL: g.BL, WL: g.WLf, sideX: g.halfW, pitchX: g.fPitchX }
      },
      curves: {
        backNeck: g.backNeck, backArm: g.backArm, frontNeck: g.frontNeck, frontArm: g.frontArm,
        sleeveCapBack: slv ? slv.capBack : null, sleeveCapFront: slv ? slv.capFront : null,
        sleeveHemBack: slv ? slv.hemBack : null, sleeveHemFront: slv ? slv.hemFront : null
      },
      sleeve: slv,
      geom: g,
      meta: {
        sleeveType: slv ? slv.sleeveType : null,
        sleeveTypes: SLEEVE_TYPES.map(function (k) {
          return { key: k, name: SLEEVE_TYPE[k].name, len66: SLEEVE_TYPE[k].len, grade: SLEEVE_TYPE[k].lenGrade };
        }),
        formulaNotes: formulaNotes(m, g, seam, AHb, AHf, NKb, NKf).concat(slv ? sleeveNotes(slv) : [])
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 3-S. 반소매 (소매 원형) — SPEC §3.4
   *   로컬 원점 = 소매산 정점. x 오른쪽 +(앞) / 왼쪽 −(뒤), y 아래 +.
   *   AH·뒤AH·앞AH 는 몸판 draft 에서 자동 산출 (사용자 입력 아님).
   * ════════════════════════════════════════════════════════════════ */

  /* ── 소매 종류 (SPEC §17-2) ────────────────────────────────────────
   *  이 원형에는 **반소매 한 종류만** 있습니다. 제공된 도면이 `반소매원형 (1).dxf`
   *  ("숙녀복기본원형1 반소매 47P") 한 벌뿐이고, 소매길이만 바꿔서 다른 소매를
   *  만들 수는 없기 때문입니다 (긴소매는 팔꿈치 처리·소매산 높이가 모두 다른 별도 제도법).
   *  66호 소매길이 23.0 은 그 도면의 정점→밑단중앙 실측값입니다.               */
  var SLEEVE_TYPE = {
    short: { name: '반소매',        len: 23.0, lenGrade: 0.5 },
    tight: { name: '타이트 긴소매',  len: 59.7, lenGrade: 1.0, cuff: 23.0, cuffGrade: 0.5 },
    /* 2장소매 — 큰소매·작은소매 **2조각**. 소맷부리는 도면 표기 (23~25)+(4~5) 처럼
       큰소매 몫과 작은소매 몫으로 나뉜다 (66호 22.15 + 7.01 = 29.16). */
    two:   { name: '2장소매', len: 59.7, lenGrade: 1.0,
             /* ★ 소맷부리는 **총둘레 하나**만 입력한다 — 큰/작은 몫은 절개점 대칭이 정한다.
                봉제되는 모서리까지 재는 값이고 트임 덧단(2.2)은 포함하지 않는다
                (두 조각의 덧단이 서로 겹쳐 닫히므로). 66호 = 큰 19.90 + 작은 6.87. */
             cuff: 26.765, cuffGrade: 0.65, twoPiece: true }
  };
  var SLEEVE_TYPES = Object.keys(SLEEVE_TYPE);

  /** 점 P 에서 원점→D 대각선에 내린 수선의 발과 수선 길이 */
  function footOn(D, P) {
    var L = Math.hypot(D[0], D[1]), u = [D[0] / L, D[1] / L];
    var t = (P[0] * u[0] + P[1] * u[1]);
    var F = [u[0] * t, u[1] * t];
    return { foot: F, t: t / L, dist: V.dist(P, F), u: u, len: L };
  }

  /** 소매 제도 — 제도점 + 베지어 (조각 조립 전) */
  /** 소매산 — 반소매·긴소매가 **똑같이** 쓰는 부분.
   *  apexShift 만큼 정점을 앞으로 옮긴다 (긴소매 도면 `앞으로이동 0.6`).
   *  대각선·마크는 **중심선 상단점(0,0) 기준**이고 정점만 옮겨진다는 점이 중요하다
   *  (긴소매 DXF 에서 앞 대각선 (−0.6,0)→앞소매통 = 앞AH 20.444 로 확인). */
  function capGeom(AH, AHb, AHf, capReduce, apexShift) {
    var capH = AH / 4 + 2;                                   // 소매산 높이 = AH/4 + 2
    var diagB = AHb - capReduce, diagF = AHf - capReduce;    // 대각선 = 각 암홀 길이
    var halfB = Math.sqrt(Math.max(diagB * diagB - capH * capH, 0.01));
    var halfF = Math.sqrt(Math.max(diagF * diagF - capH * capH, 0.01));
    var apex = [apexShift, 0], bicepB = [-halfB, capH], bicepF = [halfF, capH];

    // 마크 — 상단은 중심선 상단점에서 수평 AH/8, 하단은 소매폭 끝에서 안쪽으로
    var markTopB = [-AH / 8, 0], markTopF = [AH / 8, 0];
    var markBotB = [-halfB + (AH / 12 + 0.6), capH];
    var markBotF = [halfF - AH / 8, capH];

    // 각 마크에서 대각선에 수선 → 발점. 곡선은 발점↔마크 사이 capBulge 비율 지점을 지난다
    var fTB = footOn(bicepB, markTopB), fBB = footOn(bicepB, markBotB);
    var fTF = footOn(bicepF, markTopF), fBF = footOn(bicepF, markBotF);
    var mixP = function (f, mk) { return _lerp(f.foot, mk, K.capBulge); };
    var pTB = mixP(fTB, markTopB), pBB = mixP(fBB, markBotB);
    var pTF = mixP(fTF, markTopF), pBF = mixP(fBF, markBotF);

    // 소매산 곡선 — 정점에서 수평 출발, 상단 볼록점 → 하단 오목점 → 소매폭 끝
    /* 양 끝 접선은 **둘 다 수평** — 정점에서 수평으로 출발해 소매통 끝에도 수평으로
       닿는다 (긴소매 DXF 실측: 소매통 도착 접선 뒤 −1.55° / 앞 1.82°).
       끝접선을 자유롭게 두면 소매통 근처에서 도면과 0.15 cm 어긋난다. */
    /* 정점 → 상단 통과점 → 하단 통과점 → 소매통 끝을 **C2 스플라인**으로 잇는다.
       양 끝 접선은 둘 다 수평 (DXF 실측 도착 접선 뒤 −1.55° / 앞 1.82°).
       구간별 장력을 따로 적합하던 이전 방식은 통과점 사이가 직선처럼 펴져 보였다. */
    var cb = CAL.capBack, cf = CAL.capFront;
    /* 상단 통과점 ↔ 하단 통과점 사이는 S 자이고 도면에서 그 두 점을 잇는 **현의 중점**에서
       방향이 바뀐다 (t=0.500 에서 오프셋 −0.0002). 그 교차점도 앵커로 넣는다.
       C2 스플라인이라 앵커를 늘려도 곡률은 계속 이어진다. */
    var midB = _lerp(pTB, pBB, 0.5), midF = _lerp(pTF, pBF, 0.5);
    var capBack = splineSegs([apex, pTB, midB, pBB, bicepB],
      endTan([-1, 0], cb.k0), endTan([-1, 0], cb.k1));
    var capFront = splineSegs([apex, pTF, midF, pBF, bicepF],
      endTan([1, 0], cf.k0), endTan([1, 0], cf.k1));
    var capLenBack = sLen(capBack), capLenFront = sLen(capFront);
    return {
      capH: capH, diagB: diagB, diagF: diagF, halfB: halfB, halfF: halfF,
      apexShift: apexShift, apex: apex, bicepB: bicepB, bicepF: bicepF,
      markTopB: markTopB, markTopF: markTopF, markBotB: markBotB, markBotF: markBotF,
      footTopB: fTB, footBotB: fBB, footTopF: fTF, footBotF: fBF,
      pTB: pTB, pBB: pBB, pTF: pTF, pBF: pBF,
      capBack: capBack, capFront: capFront,
      capLenBack: capLenBack, capLenFront: capLenFront,
      capLenTotal: capLenBack + capLenFront, capEase: capLenBack + capLenFront - AH
    };
  }

  /** 소매 종류에 따라 갈라진다 — 'short' 반소매 / 'tight' 타이트 긴소매 */
  function sleeveGeom(m, opt, AHb, AHf) {
    var stKey0 = SLEEVE_TYPE[opt.sleeveType] ? opt.sleeveType : 'short';
    if (stKey0 === 'two') return twoSleeveGeom(m, opt, AHb, AHf);
    if (stKey0 === 'tight') return tightSleeveGeom(m, opt, AHb, AHf);
    return shortSleeveGeom(m, opt, AHb, AHf);
  }

  function shortSleeveGeom(m, opt, AHb, AHf) {
    var AH = AHb + AHf;
    var capReduce = (opt.capReduce === undefined) ? K.capReduce : +opt.capReduce;
    capReduce = Math.max(0, Math.min(1, capReduce));
    /* 소매 종류 — 기본 'short'(반소매). 알 수 없는 값이 오면 조용히 기본값으로.
       소매길이 = 종류 기준값 + 호수당 grade.  opt.sleeveLen 을 주면 그것으로 덮어쓴다.
       ※ short 의 25.0 + 0.5·step 은 기존 식 25.0 + (B−87.6)/12 와 항등 → 하위호환. */
    var stKey = 'short';
    var ST = SLEEVE_TYPE[stKey];
    var step = (m.B - BASE.B) / GRADE.B;                     // 호수 스텝 (66호 = 0)
    var sleeveLen = (opt.sleeveLen === undefined) ? ST.len + ST.lenGrade * step : +opt.sleeveLen;

    var cg = capGeom(AH, AHb, AHf, capReduce, 0);            // 반소매는 정점을 옮기지 않는다
    var capH = cg.capH, diagB = cg.diagB, diagF = cg.diagF;
    var halfB = cg.halfB, halfF = cg.halfF;
    var apex = cg.apex, bicepB = cg.bicepB, bicepF = cg.bicepF;

    var hemHalfB = halfB - K.sleeveHemInset, hemHalfF = halfF - K.sleeveHemInset;
    var hemEndB = [-hemHalfB, sleeveLen + K.sleeveHemDrop];
    var hemEndF = [hemHalfF, sleeveLen + K.sleeveHemDrop];
    var hemMidB = [-hemHalfB / 2, sleeveLen];                // 2등분점 (중심선 ↔ 밑단 끝)
    var hemMidF = [hemHalfF / 2, sleeveLen];

    // 밑단 — 중앙은 수평, 2등분점부터 끝까지 0.5 하강 (2등분점에서 수평 접선)
    var hemBack  = hemCurve(hemMidB, hemEndB);
    var hemFront = hemCurve(hemMidF, hemEndF);

    var out = {
      AH: AH, AHb: AHb, AHf: AHf, capReduce: capReduce, sleeveLen: sleeveLen,
      sleeveType: stKey, typeName: ST.name,
      underLenB: V.dist(bicepB, hemEndB), underLenF: V.dist(bicepF, hemEndF),   // 밑선(직선) 길이
      hemHalfB: hemHalfB, hemHalfF: hemHalfF,
      hemEndB: hemEndB, hemEndF: hemEndF, hemMidB: hemMidB, hemMidF: hemMidF,
      hemBack: hemBack, hemFront: hemFront
    };
    for (var k in cg) if (cg.hasOwnProperty(k)) out[k] = cg[k];
    return out;
  }

  /* ── 타이트 긴소매 (교재 48P) ───────────────────────────────────────
   *  반소매와 소매산은 **완전히 같고**, 아래가 다르다:
   *   · 정점을 앞으로 0.6 이동 (도면 `앞으로이동 0.6`)
   *   · 뒤 밑선은 **직선**(이세처리), 앞 밑선은 **곡선** — 반소매 밑단 들임 지점
   *     (앞반폭 − 1.5, y = 반소매길이) 을 지나 소맷부리까지 완만히 들어온다
   *   · 밑단(소맷부리)은 뒤쪽 끝이 0.3 내려간다 (도면 `0.3↓`)
   *  좌표 원점은 **중심선 상단**(정점이 아니다) — 정점은 (+0.6, 0).            */
  function tightSleeveGeom(m, opt, AHb, AHf) {
    var AH = AHb + AHf;
    var capReduce = (opt.capReduce === undefined) ? K.capReduce : +opt.capReduce;
    capReduce = Math.max(0, Math.min(1, capReduce));
    var ST = SLEEVE_TYPE.tight, SS = SLEEVE_TYPE.short;
    var step = (m.B - BASE.B) / GRADE.B;
    var sleeveLen = (opt.sleeveLen === undefined) ? ST.len + ST.lenGrade * step : +opt.sleeveLen;
    var cuffW = (opt.cuffW === undefined) ? ST.cuff + ST.cuffGrade * step : +opt.cuffW;

    var cg = capGeom(AH, AHb, AHf, capReduce, K.tightApexShift);
    var halfB = cg.halfB, halfF = cg.halfF, capH = cg.capH;
    var bicepB = cg.bicepB, bicepF = cg.bicepF;

    var elbowY = sleeveLen / 2 + K.tightElbowAdd;             // 팔꿈치선 (도면 실측 32.314)
    var hemF = [cuffW / 2, sleeveLen];
    var hemB = [-cuffW / 2, sleeveLen + K.tightBackHemDrop];  // 뒤 끝 0.3 내림
    var hemFlat = [-cuffW / 4, sleeveLen];                    // 여기까지 수평, 여기서부터 뒤로 하강

    /* 앞 밑선이 반드시 지나는 점 — 반소매 밑단 들임 지점 */
    var insetY = SS.len + SS.lenGrade * step;
    var underMid = [halfF - K.sleeveHemInset, insetY];
    /* 뒤 밑선(직선) 위의 같은 높이 점 — 너치 짝을 맞추기 위한 것.
       도면에서 이 점이 뒤 소매통 + 1.5 (= 반소매 밑단 들임) 와 0.02 로 일치한다. */
    var tB = (insetY - capH) / (sleeveLen + K.tightBackHemDrop - capH);
    var underBackMid = [-halfB + (-cuffW / 2 + halfB) * tB, insetY];

    /* 앞 밑선 — 소매통 끝에서 세로에 가깝게 출발해 들임점을 지나 소맷부리로.
       자연단 스플라인이라 곡률이 끝에서 0 으로 풀려 밑단과 매끄럽게 만난다. */
    var cu = CAL.tightUnder;
    /* 팔꿈치선 위의 점도 앵커로 — 도면의 앞 밑선은 소매통~들임점 구간과
       들임점~소맷부리 구간의 곡률이 확연히 달라 세 점만으로는 모자란다. */
    var tE = (elbowY - underMid[1]) / (sleeveLen - underMid[1]);
    var underElbow = [underMid[0] + (cuffW / 2 - underMid[0]) * tE + cu.eOff, elbowY];
    var underFront = splineSegs([bicepF, underMid, underElbow, hemF],
      endTan([0, 1], cu.k0),
      endTan(V.sub(hemF, underElbow), cu.k1));
    var underBack = lineSegs(bicepB, hemB);                   // 뒤는 직선 (이세처리)
    var hemBack = hemCurve(hemFlat, hemB);                    // 수평 구간 끝 → 뒤 끝 (0.3 하강)

    var out = {
      AH: AH, AHb: AHb, AHf: AHf, capReduce: capReduce, sleeveLen: sleeveLen,
      sleeveType: 'tight', typeName: ST.name, cuffW: cuffW,
      elbowY: elbowY, insetY: insetY, underMid: underMid, underBackMid: underBackMid,
      hemF: hemF, hemB: hemB, hemFlat: hemFlat,
      underFront: underFront, underBack: underBack, hemBack: hemBack,
      underLenB: V.dist(bicepB, hemB), underLenF: sLen(underFront),
      /* 반소매와 키 이름을 맞춰 두면 조각·주석·UI 가 그대로 돌아간다 */
      hemHalfB: cuffW / 2, hemHalfF: cuffW / 2,
      hemEndB: hemB, hemEndF: hemF, hemMidB: hemFlat, hemMidF: [cuffW / 4, sleeveLen],
      hemFront: null
    };
    for (var k in cg) if (cg.hasOwnProperty(k)) out[k] = cg[k];
    return out;
  }

  /** 밑단 2등분점 → 끝점, 2등분점에서 수평 접선인 완만한 하강 곡선 (단일 큐빅) */
  function hemCurve(mid, end) {
    var W = end[0] - mid[0], D = end[1] - mid[1];
    return [{ p0: mid, c1: [mid[0] + W * K.hemC1, mid[1]],
              c2: [end[0] - W * K.hemC2x, end[1] - D * K.hemC2y], p1: end }];
  }

  /** 곡선을 n 등분한 안쪽 지점들 — **겨드랑(끝점) 쪽에서부터** 잰다.
   *  암홀 3등분 너치처럼 "곡선 길이의 몇 분의 몇" 으로 잡는 자리에 쓴다.
   *  몸판 암홀과 소매산은 길이가 다르므로(이세분) 같은 **비율** 로 잡아야 짝이 맞는다. */
  function divPts(segs, nDiv, fromEnd) {
    var p = sampleSegs(segs, 0.02);
    if (fromEnd) p = p.slice().reverse();          // 겨드랑이 배열 앞으로 오게
    var L = polyLen(p), out = [];
    for (var q = 1; q < nDiv; q++) {
      var want = L * q / nDiv, acc = 0, pt = p[p.length - 1], tan = [1, 0];
      for (var i = 1; i < p.length; i++) {
        var seg = V.dist(p[i - 1], p[i]);
        if (acc + seg >= want) {
          var t = seg > 1e-9 ? (want - acc) / seg : 0;
          pt = _lerp(p[i - 1], p[i], t);
          tan = V.norm(V.sub(p[i], p[i - 1]));
          break;
        }
        acc += seg;
      }
      out.push({ p: pt, tan: tan, frac: q / nDiv });
    }
    return out;
  }
  /** 암홀 3등분 너치 — 겨드랑에서 1/3 · 2/3 지점. 소매산의 같은 비율 지점과 짝이 된다.
   *  (몸판 암홀과 소매산은 이세분만큼 길이가 다르므로 **비율**로 잡아야 짝이 맞는다) */
  function armNotches(armSegs, underarm, inside, tag) {
    var p0 = sampleSegs(armSegs, 0.05)[0];
    var fromEnd = V.dist(p0, underarm) > 1e-6;          // 겨드랑이 곡선의 끝쪽인가
    return divPts(armSegs, K.armNotchDiv, fromEnd).map(function (w) {
      return { p: cp(w.p), angle: inwardAngle(w.tan, w.p, inside),
               label: tag + ' ' + Math.round(w.frac * K.armNotchDiv) + '/' + K.armNotchDiv };
    });
  }

  /** 소매산 3등분 너치 — 몸판 암홀 너치와 **같은 비율** 지점이라 짝이 맞는다.
   *  이세분은 구간마다 비례해서 들어간다. */
  function capNotches(s) {
    var mid = [s.apexShift, s.sleeveLen * 0.4];
    return divPts(s.capBack, K.armNotchDiv, true).map(function (w) {
      return { p: cp(w.p), angle: inwardAngle(w.tan, w.p, mid),
               label: '뒤 ' + Math.round(w.frac * K.armNotchDiv) + '/' + K.armNotchDiv };
    }).concat(divPts(s.capFront, K.armNotchDiv, true).map(function (w) {
      return { p: cp(w.p), angle: inwardAngle(w.tan, w.p, mid),
               label: '앞 ' + Math.round(w.frac * K.armNotchDiv) + '/' + K.armNotchDiv };
    }));
  }

  /** 곡선 위 점에서 **조각 안쪽**을 향하는 너치 각도 */
  function inwardAngle(tan, at, inside) {
    var nr = [tan[1], -tan[0]];
    if (nr[0] * (inside[0] - at[0]) + nr[1] * (inside[1] - at[1]) < 0) nr = [-nr[0], -nr[1]];
    return angDeg(nr);
  }

  /** 다트 다리 · 뒤 옆선처럼 **살짝 휜 직선** — 끝점 둘 + 현 위에 띄운 앵커 하나.
   *  C 는 {tm, k}: tm 은 현 위의 위치(비율), k 는 **현길이 대비** 수직 오프셋.
   *  수직 방향은 (끝 − 시작) 을 시계방향 90° 돌린 쪽 = [v.y, −v.x].
   *  무차원이라 44~88호에서 같은 모양이 유지된다.                                */
  function bowSegs(A, B, C) {
    var v = V.sub(B, A), L = Math.hypot(v[0], v[1]);
    if (!(L > 1e-9) || !C) return lineSegs(A, B);
    var n = [v[1] / L, -v[0] / L], off = C.k * L;
    var M = [A[0] + v[0] * C.tm + n[0] * off, A[1] + v[1] * C.tm + n[1] * off];
    return splineSegs([A, M, B], null, null);
  }

  /** 베지어 구간열에서 x = 목표 인 점 — 소매산에서 절개 시작점을 찾는 데 쓴다 */
  function ptOnSegsAtX(segs, targetX) {
    var p = sampleSegs(segs, 0.01);
    for (var i = 1; i < p.length; i++) {
      var a = p[i - 1], b = p[i];
      if ((a[0] - targetX) * (b[0] - targetX) <= 0 && Math.abs(b[0] - a[0]) > 1e-9) {
        var t = (targetX - a[0]) / (b[0] - a[0]);
        return [targetX, a[1] + (b[1] - a[1]) * t];
      }
    }
    return cp(p[p.length - 1]);
  }
  /** 소매산을 x 기준으로 갈라 두 조각이 나눠 갖게 한다 */
  function splitSegsAtX(segs, targetX) {
    var p = sampleSegs(segs, 0.01), cut = -1;
    for (var i = 1; i < p.length; i++) {
      if ((p[i - 1][0] - targetX) * (p[i][0] - targetX) <= 0) { cut = i; break; }
    }
    if (cut < 1) cut = Math.max(1, Math.floor(p.length / 2));
    return { head: p.slice(0, cut + 1).map(cp), tail: p.slice(cut - 1).map(cp) };
  }
  function revPts(a) { return a.slice().reverse(); }

  /** 큐빅 하나를 매개변수 t 에서 둘로 (드 카스텔조) */
  function bezSplit(g, t) {
    var a = _lerp(g.p0, g.c1, t), b = _lerp(g.c1, g.c2, t), c = _lerp(g.c2, g.p1, t);
    var d = _lerp(a, b, t), e = _lerp(b, c, t), m = _lerp(d, e, t);
    return [{ p0: g.p0, c1: a, c2: d, p1: m }, { p0: m, c1: e, c2: c, p1: g.p1 }];
  }
  /** 베지어 구간열을 **끝에서 호길이 L** 인 지점에서 자른다 (트임 시작점 찾기).
   *  샘플로 잘라 폴리라인으로 바꾸면 곡선이 죽으므로 곡선인 채로 나눈다. */
  function splitSegsAtLenFromEnd(segs, L) {
    var target = sLen(segs) - L;
    if (target <= 0) return { head: [], tail: segs.slice() };
    var acc = 0;
    for (var i = 0; i < segs.length; i++) {
      var li = sLen([segs[i]]);
      if (acc + li >= target) {
        var lo = 0, hi = 1;
        for (var it = 0; it < 32; it++) {
          var mt = (lo + hi) / 2;
          if (acc + sLen([bezSplit(segs[i], mt)[0]]) < target) lo = mt; else hi = mt;
        }
        var sp = bezSplit(segs[i], (lo + hi) / 2);
        return { head: segs.slice(0, i).concat([sp[0]]), tail: [sp[1]].concat(segs.slice(i + 1)) };
      }
      acc += li;
    }
    return { head: segs.slice(), tail: [] };
  }

  /* ── 소맷부리 트임 (도면 2.2 · 9 · 2) ──────────────────────────────
   *  절개선의 **아래 9 cm 구간을 바깥으로 2.2 내밀어** 덧단을 만든다.
   *  · 내미는 방향 = 그 9 cm 구간의 **현에 수직**, 조각 안쪽의 반대편
   *    (도면 실측 큰소매 Δ(−2.188, +0.242) / 작은소매 Δ(+2.190, +0.226) — 둘 다 현 수직)
   *  · ★ 덧단 **위는 직각 계단이 아니라 미터로 잘려 뾰족해진다.**
   *    트임 바깥 위 모서리 → 절개선 위 **2.0** 지점을 잇는 사선이 **재단선**이고
   *    (도면 실측 2.9742), 2.2 가로선과 절개선 아래 9 는 **접음선**이다.
   *    직각으로 두면 접었을 때 그 삼각형만큼 부피가 겹쳐 소맷부리가 두꺼워진다.
   *  외곽선: 절개선(미터 위) → 미터 사선 → 트임 9 → 2.2 → 밑단.                  */
  function ventOf(seamSegs, insideRef) {
    var sp = splitSegsAtLenFromEnd(seamSegs, K.ventLen);
    var top = sp.head.length ? sp.head[sp.head.length - 1].p1 : seamSegs[0].p0;
    var fold = sp.tail;                                  // 트임 접음선 = 절개선 아래 9
    var hem = seamSegs[seamSegs.length - 1].p1;
    var ch = V.norm(V.sub(hem, top)), nr = [ch[1], -ch[0]];
    if (nr[0] * (hem[0] - insideRef[0]) + nr[1] * (hem[1] - insideRef[1]) < 0) nr = [-nr[0], -nr[1]];
    var vv = [nr[0] * K.ventW, nr[1] * K.ventW];
    /* 절개선은 **미터 기준점(트임 위 2.0)** 에서 끝난다 — 그 아래는 미터 사선이 대신한다 */
    var mp = splitSegsAtLenFromEnd(seamSegs, K.ventLen + K.ventMitre);
    return {
      seamHead: mp.head, fold: fold, top: top, hem: hem,
      mitreOn: mp.head.length ? mp.head[mp.head.length - 1].p1 : top,
      topOut: [top[0] + vv[0], top[1] + vv[1]],
      hemOut: [hem[0] + vv[0], hem[1] + vv[1]],
      vec: vv, len: polyLen(sampleSegs(fold, 0.02))
    };
  }

  /* ── 2장소매 (교재 48P) — 큰소매 + 작은소매 ────────────────────────
   *  소매산·소매길이·팔꿈치선은 **타이트 긴소매와 같다.** 다른 점은 뒤쪽에서 갈라
   *  두 장으로 만드는 것 —
   *   · 절개 시작점 = 뒤 소매산 위에서 **x = −AH/4** 인 점 (66호 −10.711, 7.519)
   *   · 두 조각의 절개변은 그 점에서 갈라져 밑단에서 벌어진다.
   *     **두 변의 길이가 같아야** 봉제된다 (도면 실측 53.7565 = 53.7565)
   *   · 작은소매 바깥 뒤 = 소매통 뒤 + 3.0, 큰소매 앞 = 소매통 앞 − 3.0 (도면 `3`)
   *   · 밑단은 소매길이보다 1.3 내려간다 (도면 `1.3↓`)                        */
  function twoSleeveGeom(m, opt, AHb, AHf) {
    var AH = AHb + AHf;
    var capReduce = (opt.capReduce === undefined) ? K.capReduce : +opt.capReduce;
    capReduce = Math.max(0, Math.min(1, capReduce));
    var ST = SLEEVE_TYPE.two, SS = SLEEVE_TYPE.short;
    var step = (m.B - BASE.B) / GRADE.B;
    var sleeveLen = (opt.sleeveLen === undefined) ? ST.len + ST.lenGrade * step : +opt.sleeveLen;
    var cuffW = (opt.cuffW === undefined) ? ST.cuff + ST.cuffGrade * step : +opt.cuffW;

    var cg = capGeom(AH, AHb, AHf, capReduce, K.tightApexShift);
    var halfB = cg.halfB, halfF = cg.halfF;
    var elbowY = sleeveLen / 2 + K.tightElbowAdd;
    var insetY = SS.len + SS.lenGrade * step;

    var splitX = -AH / 4;                                   // 절개 시작 x
    var splitP = ptOnSegsAtX(cg.capBack, splitX);
    /* 소매산(정점 → 뒤 소매통)을 절개점에서 자른다.
       head = 정점~절개점 → **큰소매** 몫, tail = 절개점~뒤 소매통 → **작은소매** 몫 */
    var capSplit = splitSegsAtX(cg.capBack, splitX);

    var backOutX = -(halfB + K.twoSideOff);
    var frontInX = halfF - K.twoSideOff;
    /* ★ 큰소매 앞 소매산은 **소매통 끝이 아니라 frontInX 에서 끝난다** (도면 capFront
       (0.6,0)→(13.017,12.138), 호 18.163). 여기서 자르지 않고 소매통까지 그리면
       앞 밑선 시작점과 3 cm 어긋나 외곽선에 계단이 생긴다. 앞에서 덜어낸 몫은
       작은소매가 뒤쪽 undCapOut(3.07)으로 받는다. */
    var capBigFront = splitSegsAtX(cg.capFront, frontInX).head;
    var topY = capBigFront[capBigFront.length - 1][1];
    var hemY = sleeveLen, hemLowY = sleeveLen + K.twoHemDrop;

    var bigHemF = [halfF - K.twoFrontHemIn, hemY];
    var undHemB = [backOutX - K.twoHemDrop, hemY];
    /* ★ 작은소매 절개선은 큰소매 절개선을 **절개점 수직선에 대칭**시킨 것이다.
       도면이 그렇다 — 큰 −5.586 / 작은 −15.836 은 절개점 −10.711 에 대해 정확히 대칭.
       대칭이면 두 절개변 길이가 저절로 같아진다(도면 53.7565 = 53.7565).
       그래서 **입력은 소맷부리 총둘레 하나뿐**이고, 큰/작은 몫은 대칭이 정한다.
         총둘레 C = (앞 − 큰끝) + (2·절개x − 큰끝 − 작은바깥)
         ⇒ 큰끝 = (앞 − 작은바깥 + 2·절개x − C) / 2
       ⚠ 큰소매 몫만 따로 등급을 주면 대칭 때문에 작은소매 몫이 호수마다 널뛴다
         (66호 6.9 → 88호 3.4 로 줄었다). 총둘레를 등급하고 몫은 계산해야 한다. */
    var bigHemB = [(bigHemF[0] - undHemB[0] + 2 * splitX - cuffW) / 2, hemLowY];
    var undHemF = [2 * splitX - bigHemB[0], hemLowY];
    var cuffBig = bigHemF[0] - bigHemB[0], cuffUnder = undHemF[0] - undHemB[0];

    /* 절개선 — 절개점 → 팔꿈치선 위의 중간 앵커 → 밑단.
       앵커 위치(mr·my)와 양 끝 접선(k0·k1)은 도면 bigBack 41점에 적합했다. */
    var mkSeam = function (endPt) {
      var cs = CAL.twoSeam;
      var mid = [splitX + (endPt[0] - splitX) * cs.mr, elbowY + cs.my];
      return splineSegs([splitP, mid, endPt],
        endTan(V.sub(mid, splitP), cs.k0), endTan(V.sub(endPt, mid), cs.k1));
    };
    var bigBack = mkSeam(bigHemB);
    var undBack = mkSeam(undHemF);      // 대칭점이라 길이는 자동으로 같다
    /* 트임 — 두 조각 모두 절개선 아래 9 를 바깥으로 2.2 내민다 */
    var ventBig = ventOf(bigBack, [halfF, elbowY]);      // 조각 안쪽 = 앞쪽 → 덧단은 뒤로
    var ventUnd = ventOf(undBack, [backOutX, elbowY]);   // 조각 안쪽 = 뒤쪽 → 덧단은 앞으로

    var bigFront = splineSegs([[frontInX, topY], [frontInX - K.twoFrontElbowIn, elbowY], bigHemF],
      endTan([0, 1], CAL.twoFront.k0), null);
    var undOuter = splineSegs([[backOutX, topY], [backOutX - K.twoBackElbowOut, elbowY], undHemB],
      endTan([0, 1], CAL.twoFront.k0), null);
    /* 소매통 연결 — 뒤로 3 cm 내민 지점에서 소매통 끝까지. 출발은 **아래로** 기울고
       (도면 12.138 → 12.705 로 내려간다) 도착은 **수평** — 뒤 소매산이 소매통에
       수평으로 닿으므로 여기서도 수평이라야 꺾이지 않는다. */
    var co = CAL.twoCapOut;
    var undCapOut = splineSegs([[backOutX, topY], cg.bicepB],
      endTan([1, co.slope], co.k0), endTan([1, 0], co.k1));

    var out = {
      AH: AH, AHb: AHb, AHf: AHf, capReduce: capReduce, sleeveLen: sleeveLen,
      sleeveType: 'two', typeName: ST.name, twoPiece: true,
      cuffBig: cuffBig, cuffUnder: cuffUnder, cuffW: cuffBig + cuffUnder,
      elbowY: elbowY, insetY: insetY, splitX: splitX, splitP: splitP,
      backOutX: backOutX, frontInX: frontInX, topY: topY,
      capBigFront: capBigFront,               // 정점 → 앞 절단점 (소매통까지 안 간다)
      capBigBack: revPts(capSplit.head),      // 절개점 → 정점
      capUnderBack: revPts(capSplit.tail),    // 뒤 소매통 → 절개점
      bigHemF: bigHemF, bigHemB: bigHemB, undHemB: undHemB, undHemF: undHemF,
      bigBack: bigBack, undBack: undBack, bigFront: bigFront,
      ventBig: ventBig, ventUnd: ventUnd, ventW: K.ventW, ventLen: K.ventLen,
      undOuter: undOuter, undCapOut: undCapOut,
      seamLenBig: polyLen(sampleSegs(bigBack, 0.02)),
      seamLenUnder: polyLen(sampleSegs(undBack, 0.02)),
      underLenB: polyLen(sampleSegs(undOuter, 0.02)),
      underLenF: polyLen(sampleSegs(bigFront, 0.02)),
      hemEndB: bigHemB, hemEndF: bigHemF, hemMidB: bigHemB, hemMidF: bigHemF,
      hemHalfB: cuffBig / 2, hemHalfF: cuffBig / 2, hemBack: null, hemFront: null
    };
    for (var k in cg) if (cg.hasOwnProperty(k)) out[k] = cg[k];
    return out;
  }

  /** 점이 이 점열 위에 있는가 (2장소매에서 너치를 어느 조각에 붙일지 고를 때) */
  function onPts(q, pts) {
    if (!pts || !pts.length) return false;
    for (var i = 0; i < pts.length; i++) if (V.dist(q, pts[i]) < 0.06) return true;
    return false;
  }

  /** 2장소매 조각 2개 */
  function twoSleevePieces(s, seam) {
    function mk(id, name, edges, grain, notches) {
      var loop = edgesToLoop(edges), sm = buildSeamline(loop, seam);
      return {
        id: id, name: name, cutCount: 2, grainline: grain,
        outline: loop.pts, seamline: sm.seamline,
        foldEdges: [], seamEdges: sm.seamEdges, seamFoldEdges: [],
        seamByRole: sm.seamByRole, edges: withSeam(loop.ranges, sm.edgeSeam),
        internal: twoInternal(s, id), notches: notches || [], bbox: bboxOf(loop.pts)
      };
    }
    var poly = function (pts) { return lineSegs.apply(null, pts); };
    var vB = s.ventBig, vU = s.ventUnd;
    var big = mk('sleeveBig', '큰소매', [
      { name: '앞 소매산', role: 'armhole',   segs: poly(s.capBigFront) },
      { name: '앞 밑선',   role: 'side',      segs: s.bigFront },
      { name: '밑단',      role: 'sleeveHem', segs: lineSegs(s.bigHemF, s.bigHemB) },
      /* 트임 덧단 — 밑단에서 2.2 나갔다가 9 올라가고, 위는 미터로 잘려 뾰족해진다 */
      { name: '트임 밑단', role: 'sleeveHem', segs: lineSegs(s.bigHemB, vB.hemOut) },
      { name: '트임',      role: 'side',      segs: lineSegs(vB.hemOut, vB.topOut) },
      { name: '트임 미터', role: 'side',      segs: lineSegs(vB.topOut, vB.mitreOn) },
      { name: '뒤 절개선', role: 'side',      segs: revSegs(vB.seamHead) },
      { name: '뒤 소매산', role: 'armhole',   segs: poly(s.capBigBack) }
    ], [[s.apexShift, 1.0], [s.apexShift, s.sleeveLen - 1.0]],
       [{ p: cp(s.splitP), angle: 0, label: '절개 시작' },
        { p: cp(s.apex), angle: 90, label: '소매산 정점' },
        /* 앞 합인 — 도면 마크 (11.6975, 11.4023) */
        { p: cp(s.pBF), angle: angDeg(V.norm(V.sub([0, s.sleeveLen * 0.5], s.pBF))), label: '앞 합인' },
        { p: cp(vB.top), angle: 0, label: '트임 끝 (9)' }]
       .concat(capNotches(s).filter(function (nt) { return onPts(nt.p, s.capBigFront) || onPts(nt.p, s.capBigBack); })));
    var und = mk('sleeveUnder', '작은소매', [
      { name: '뒤 소매산',  role: 'armhole',   segs: poly(s.capUnderBack) },
      { name: '절개선',     role: 'side',      segs: vU.seamHead },
      { name: '트임 미터',  role: 'side',      segs: lineSegs(vU.mitreOn, vU.topOut) },
      { name: '트임',       role: 'side',      segs: lineSegs(vU.topOut, vU.hemOut) },
      { name: '트임 밑단',  role: 'sleeveHem', segs: lineSegs(vU.hemOut, s.undHemF) },
      { name: '밑단',       role: 'sleeveHem', segs: lineSegs(s.undHemF, s.undHemB) },
      { name: '바깥 뒤선',  role: 'side',      segs: revSegs(s.undOuter) },
      { name: '소매통 연결', role: 'armhole',  segs: s.undCapOut }
    ], [[s.backOutX + 2, 15], [s.backOutX + 2, s.sleeveLen - 1.0]],
       [{ p: cp(s.splitP), angle: 180, label: '절개 시작' },
        /* 뒤 합인 — 도면 마크 (−14.9255, 11.7312). 절개점과 소매통 사이라 작은소매 몫 */
        { p: cp(s.pBB), angle: angDeg(V.norm(V.sub([0, s.sleeveLen * 0.5], s.pBB))), label: '뒤 합인' },
        { p: cp(vU.top), angle: 180, label: '트임 끝 (9)' }]
       .concat(capNotches(s).filter(function (nt) { return onPts(nt.p, s.capUnderBack); })));
    return [big, und];
  }

  /** 2장소매 조각의 제도선 — 조각마다 자기가 쓰는 기준선만 그린다.
   *  (한장소매의 sleeveInternal 은 좌우가 한 장에 다 있는 전제라 그대로 못 쓴다) */
  function twoInternal(s, id) {
    var big = (id === 'sleeveBig'), v = big ? s.ventBig : s.ventUnd;
    var x0 = big ? s.bigHemB[0] : s.undHemB[0], x1 = big ? s.bigHemF[0] : s.undHemF[0];
    var common = [
      L('elbow',     'dashed', [[Math.min(x0, x1) - 0.5, s.elbowY], [Math.max(x0, x1) + 0.5, s.elbowY]], '팔꿈치선'),
      /* 접음선 둘 — 절개선 아래 9 와 트임 위 가로선 2.2. 미터 사선은 **재단선**이라
         내부선이 아니다 (외곽선 '트임 미터' 변). */
      L('ventFold',  'dashed', subsamp(v.fold), '트임 접음선 (9)'),
      L('ventTop',   'dashed', [cp(v.top), cp(v.topOut)], '트임 위 접음선 (2.2)'),
      L('splitPt',   'point',  [cp(s.splitP)], '절개 시작 −AH/4')
    ];
    return big ? common.concat([
      L('bicep',    'line',   [cp(s.splitP), [s.frontInX, s.topY]], '절개점 ↔ 앞 경계'),
      L('center',   'dashed', [[s.apexShift, 0], [s.apexShift, s.sleeveLen]], '정점 수직선'),
      L('capH',     'dashed', [[s.apexShift, 0], [s.apexShift, s.capH]], '소매산 높이'),
      L('apexPt',   'point',  [cp(s.apex)], '정점'),
      L('frontIn',  'point',  [[s.frontInX, s.topY]], '앞 경계 (소매통 −3)')
    ]) : common.concat([
      L('bicep',    'line',   [[s.backOutX, s.topY], cp(s.bicepB)], '바깥 경계 ↔ 소매통'),
      L('backOut',  'point',  [[s.backOutX, s.topY]], '뒤 경계 (소매통 +3)')
    ]);
  }

  function sleevePiece(s, seam) {
    /* 변 순서는 앞 소매산 → 앞 밑선 → 밑단 → 뒤 밑선 → 뒤 소매산 (시계 반대) */
    var edges = (s.sleeveType === 'tight') ? [
      { name: '앞 소매산',   role: 'armhole',   segs: s.capFront },
      { name: '앞 밑선',     role: 'side',      segs: s.underFront },      // 곡선
      /* ★ 밑단은 **한 줄 C2 스플라인** — 직선 + 곡선으로 이어 붙이면 2등분점에서
         곡률이 튀어 눈에 꺾여 보인다 (실제로 지적받았다). */
      { name: '밑단',        role: 'sleeveHem', segs: splineSegs([s.hemF, s.hemFlat, s.hemB], null, null) },
      { name: '뒤 밑선',     role: 'side',      segs: lineSegs(s.hemB, s.bicepB) },  // 직선
      { name: '뒤 소매산',   role: 'armhole',   segs: revSegs(s.capBack) }
    ] : [
      { name: '앞 소매산',   role: 'armhole',   segs: s.capFront },
      { name: '앞 밑선',     role: 'side',      segs: lineSegs(s.bicepF, s.hemEndF) },
      /* ★ 밑단은 **한 줄 C2 스플라인** (2등분점 두 개를 앵커로) — 곡선·직선·곡선으로
         이어 붙이면 2등분점에서 곡률이 튀어 꺾여 보인다. */
      { name: '밑단',        role: 'sleeveHem',
        segs: splineSegs([s.hemEndF, s.hemMidF, s.hemMidB, s.hemEndB], null, null) },
      { name: '뒤 밑선',     role: 'side',      segs: lineSegs(s.hemEndB, s.bicepB) },
      { name: '뒤 소매산',   role: 'armhole',   segs: revSegs(s.capBack) }
    ];
    var loop = edgesToLoop(edges);
    var sm = buildSeamline(loop, seam);      // 골선 없음 → 전 둘레 균일 시접
    var inward = function (p) { return angDeg(V.norm(V.sub([0, s.sleeveLen * 0.5], p))); };
    return {
      id: 'sleeve', name: '소매', cutCount: 2,
      grainline: [[0, 0.6], [0, s.sleeveLen - 0.6]],
      outline: loop.pts,
      seamline: sm.seamline,
      foldEdges: [],                          // 한 장 소매 · 좌우 비대칭 → 골선 없음
      seamEdges: sm.seamEdges,
      seamFoldEdges: [],
      seamByRole: sm.seamByRole,
      edges: withSeam(loop.ranges, sm.edgeSeam),
      internal: sleeveInternal(s),
      notches: capNotches(s).concat((s.sleeveType === 'tight') ? [
        { p: cp(s.apex), angle: 90,            label: '소매산 정점' },
        { p: cp(s.pBB),  angle: inward(s.pBB), label: '뒤 합인' },
        { p: cp(s.pBF),  angle: inward(s.pBF), label: '앞 합인' },
        { p: cp(s.underMid),     angle: 180,   label: '앞 밑선 들임' },
        { p: cp(s.underBackMid), angle: 0,     label: '뒤 밑선 (짝점)' },
        { p: cp(s.hemFlat),      angle: -90,   label: '밑단 수평 끝' }
      ] : [
        { p: cp(s.apex), angle: 90,           label: '소매산 정점' },
        { p: cp(s.pBB),  angle: inward(s.pBB), label: '뒤 합인' },
        { p: cp(s.pBF),  angle: inward(s.pBF), label: '앞 합인' },
        { p: cp(s.hemMidB), angle: -90,        label: '뒤 밑단 2등분' },
        { p: cp(s.hemMidF), angle: -90,        label: '앞 밑단 2등분' }
      ]),
      bbox: bboxOf(loop.pts)
    };
  }

  function sleeveInternal(s) {
    /* 대각선은 **중심선 상단점**에서 그린다 — 긴소매는 정점이 앞으로 0.6 옮겨져 있어
       정점에서 그으면 대각선 길이가 암홀과 어긋난다 (도면 확인 완료). */
    var top = [0, 0];
    var extra = (s.sleeveType !== 'tight') ? [] : [
      L('elbow',    'dashed', [[-s.halfB, s.elbowY], [s.halfF, s.elbowY]], '팔꿈치선'),
      L('insetLine','dashed', [[-s.halfB, s.insetY], [s.halfF, s.insetY]], '반소매 기준선'),
      L('underMid', 'point',  [s.underMid], '앞 밑선 들임 1.5'),
      L('underFront','line',  subsamp(s.underFront), '앞 밑선')
    ];
    return [
      L('bicep',    'line',   [s.bicepB, s.bicepF], '소매통선'),
      L('center',   'dashed', [[0, 0], [0, s.sleeveLen]], '중심선'),
      L('diagBack', 'dashed', [top, s.bicepB], '뒤 대각선'),
      L('diagFront','dashed', [top, s.bicepF], '앞 대각선'),
      L('markTop',  'dashed', [s.markTopB, s.markTopF], '상단 마크'),
      L('perpTB',   'dashed', [s.markTopB, s.footTopB.foot], '뒤 상단 수선'),
      L('perpBB',   'dashed', [s.markBotB, s.footBotB.foot], '뒤 하단 수선'),
      L('perpTF',   'dashed', [s.markTopF, s.footTopF.foot], '앞 상단 수선'),
      L('perpBF',   'dashed', [s.markBotF, s.footBotF.foot], '앞 하단 수선'),
      L('hemLine',  'dashed', [[-s.hemHalfB, s.sleeveLen], [s.hemHalfF, s.sleeveLen]], '밑단 기준선'),
      L('capH',     'dashed', [[0, 0], [0, s.capH]], '소매산 높이'),
      L('capBack',  'line',   subsamp(s.capBack), '뒤 소매산'),
      L('capFront', 'line',   subsamp(s.capFront), '앞 소매산'),
      L('apexPt',   'point',  [s.apex], '정점')
    ].concat(extra);
  }

  function sleeveNotes(s) {
    var mid = s.sleeveLen * 0.55;
    /* ★ 2장소매는 조각 id 가 sleeveBig / sleeveUnder 라 piece:'sleeve' 로 달면
       **주석이 하나도 안 붙는다** (실제로 그렇게 비어 있었다). 조각별로 나눠 단다. */
    if (s.twoPiece) return twoNotes(s);
    return [
      FN('capH',     '소매산 높이', 'AH/4 + 2',                       s.capH,   'sleeve', [0.6, s.capH * 0.5]),
      FN('bicep',    '소매통',     '뒤반 + 앞반',                      s.halfB + s.halfF, 'sleeve', [0, s.capH]),
      FN('diagBack', '뒤 대각선',  '뒤AH − capReduce ' + f1(s.capReduce), s.diagB, 'sleeve', [-s.halfB * 0.5, s.capH * 0.5]),
      FN('diagFront','앞 대각선',  '앞AH − capReduce ' + f1(s.capReduce), s.diagF, 'sleeve', [s.halfF * 0.5, s.capH * 0.5]),
      FN('markTop',  '상단 마크',  'AH/8',                            s.AH / 8, 'sleeve', [0, -0.4]),
      FN('perpBB',   '뒤 하단 마크', 'AH/12 + 0.6',                    s.AH / 12 + 0.6, 'sleeve', cp(s.markBotB)),
      FN('perpBF',   '앞 하단 마크', 'AH/8',                           s.AH / 8, 'sleeve', cp(s.markBotF)),
      FN('center',   '소매길이',   s.typeName + ' — 66호 ' + f1(SLEEVE_TYPE[s.sleeveType].len) +
                                   ' · 호수당 +' + f1(SLEEVE_TYPE[s.sleeveType].lenGrade), s.sleeveLen, 'sleeve', [0, mid]),
      FN('hemLine',  (s.sleeveType === 'tight') ? '소맷부리' : '밑단폭',
                     (s.sleeveType === 'tight') ? '중심에서 좌우 반씩' : '소매통 − 들임 1.5×2 (교재 규정)',
                     s.hemHalfB + s.hemHalfF, 'sleeve', [0, s.sleeveLen]),
      FN('capBack',  '뒤 소매산',  '곡선길이 (≥ 뒤AH ' + f1(s.AHb) + ')', s.capLenBack,  'sleeve', [-s.halfB * 0.55, s.capH * 0.35]),
      FN('capFront', '앞 소매산',  '곡선길이 (≥ 앞AH ' + f1(s.AHf) + ')', s.capLenFront, 'sleeve', [s.halfF * 0.55, s.capH * 0.35]),
      FN('apexPt',   '이세분',     '소매산 곡선길이 − AH',              s.capEase, 'sleeve', [0, 1.2])
    ].concat((s.sleeveType !== 'tight') ? [] : [
      FN('apexPt',    '정점 이동',   '앞으로 ' + f1(K.tightApexShift),      s.apexShift, 'sleeve', [s.apexShift, -0.9]),
      FN('elbow',     '팔꿈치선',    '소매길이/2 + ' + f1(K.tightElbowAdd), s.elbowY,    'sleeve', [0, s.elbowY]),
      FN('insetLine', '반소매 기준선', '반소매 길이 — 앞 밑선이 여기서 1.5 들어온다', s.insetY, 'sleeve', [0, s.insetY]),
      FN('underMid',  '앞 밑선 들임', '앞반폭 − 1.5',                      K.sleeveHemInset, 'sleeve', cp(s.underMid)),
      FN('underFront','앞 밑선',     '곡선길이 (뒤 밑선 ' + f1(s.underLenB) + ' 를 이세처리)', s.underLenF, 'sleeve', [s.halfF * 0.7, s.elbowY])
    ]);
  }

  /** 2장소매 계산식·치수 — 조각(sleeveBig / sleeveUnder)별로 나눠 단다 */
  function twoNotes(s) {
    var B = 'sleeveBig', U = 'sleeveUnder', mid = s.sleeveLen * 0.55;
    var vB = s.ventBig, vU = s.ventUnd;
    return [
      /* ── 공통 골격 (큰소매에 표기) ── */
      FN('capH',     '소매산 높이', 'AH/4 + 2',                         s.capH, B, [s.apexShift + 0.4, s.capH * 0.5]),
      FN('apexPt',   '정점 이동',   '앞으로 ' + f1(K.tightApexShift),    s.apexShift, B, [s.apexShift, -0.9]),
      FN('center',   '소매길이',    '2장소매 — 66호 ' + f1(SLEEVE_TYPE.two.len) +
                                    ' · 호수당 +' + f1(SLEEVE_TYPE.two.lenGrade), s.sleeveLen, B, [s.apexShift, mid]),
      FN('elbow',    '팔꿈치선',    '소매길이/2 + ' + f1(K.tightElbowAdd), s.elbowY, B, [s.frontInX * 0.4, s.elbowY]),
      FN('splitPt',  '절개 시작점', '뒤 소매산 위 x = −AH/4',            -s.AH / 4, B, cp(s.splitP)),
      FN('frontIn',  '앞 경계',     '앞 소매통 − ' + f1(K.twoSideOff),   s.frontInX, B, [s.frontInX, s.topY - 0.8]),
      FN('capBigFront', '큰소매 앞 소매산', '정점 → 앞 경계 (소매통까지 가지 않는다)',
                     polyLen(s.capBigFront), B, [s.frontInX * 0.55, s.capH * 0.45]),
      FN('capBigBack',  '큰소매 뒤 소매산', '정점 → 절개점',
                     polyLen(s.capBigBack), B, [s.splitP[0] * 0.5, s.capH * 0.30]),
      FN('bigBack',  '뒤 절개선',   '작은소매 절개선과 **길이가 같아야** 봉제된다',
                     s.seamLenBig, B, [(s.splitP[0] + s.bigHemB[0]) / 2 - 1.2, s.elbowY + 6]),
      FN('bigFront', '앞 밑선',     '앞 경계 → 밑단 (작은소매 바깥 뒤선 ' + f1(s.underLenB) + ' 와 맞물린다)',
                     s.underLenF, B, [s.frontInX - 1.0, s.elbowY + 8]),
      FN('bigHem',   '큰소매 밑단', '봉제 모서리까지 (트임 덧단 ' + f1(K.ventW) + ' 는 별도)',
                     V.dist(s.bigHemF, s.bigHemB), B, [(s.bigHemF[0] + s.bigHemB[0]) / 2, s.sleeveLen + 1.6]),
      FN('ventFold', '트임',        '절개선 아래 ' + f1(K.ventLen) + ' 를 바깥으로 ' + f1(K.ventW),
                     vB.len, B, [vB.topOut[0] - 0.6, (vB.topOut[1] + vB.hemOut[1]) / 2]),
      FN('ventMitre','트임 미터',   '재단선 — 트임 바깥 위 모서리 → 절개선 위 ' + f1(K.ventMitre) +
                                    ' (직각으로 두면 접을 때 부피가 겹친다)',
                     V.dist(vB.topOut, vB.mitreOn), B, cp(vB.mitreOn)),
      FN('ventTop',  '트임 위 접음선', '트임 너비 ' + f1(K.ventW),
                     V.dist(vB.top, vB.topOut), B, cp(vB.top)),
      FN('hemDrop',  '밑단 하강',   '소매길이보다 ' + f1(K.twoHemDrop) + ' 내려간다',
                     K.twoHemDrop, B, [s.bigHemB[0] + 1.5, s.sleeveLen + 0.7]),

      /* ── 작은소매 ── */
      FN('backOut',  '뒤 경계',     '뒤 소매통 + ' + f1(K.twoSideOff),   s.backOutX, U, [s.backOutX, s.topY - 0.8]),
      FN('bicep',    '소매통 연결', '뒤 경계 → 소매통 끝 (소매산에 수평으로 닿는다)',
                     polyLen(sampleSegs(s.undCapOut, 0.02)), U, [(s.backOutX + s.bicepB[0]) / 2, s.topY - 0.6]),
      FN('capUnderBack', '작은소매 소매산', '소매통 → 절개점',
                     polyLen(s.capUnderBack), U, [(s.bicepB[0] + s.splitP[0]) / 2, s.capH * 0.55]),
      FN('splitPt',  '절개 시작점', '뒤 소매산 위 x = −AH/4',            -s.AH / 4, U, cp(s.splitP)),
      FN('elbow',    '팔꿈치선',    '소매길이/2 + ' + f1(K.tightElbowAdd), s.elbowY, U, [s.backOutX + 2.5, s.elbowY]),
      FN('undBack',  '절개선',      '큰소매 뒤 절개선 ' + f1(s.seamLenBig) + ' 과 같은 길이',
                     s.seamLenUnder, U, [(s.splitP[0] + s.undHemF[0]) / 2 + 1.2, s.elbowY + 6]),
      FN('undOuter', '바깥 뒤선',   '뒤 경계 → 밑단 (큰소매 앞 밑선과 맞물린다)',
                     s.underLenB, U, [s.backOutX - 1.0, s.elbowY + 8]),
      FN('undHem',   '작은소매 밑단', '봉제 모서리까지 (트임 덧단 ' + f1(K.ventW) + ' 는 별도)',
                     V.dist(s.undHemF, s.undHemB), U, [(s.undHemF[0] + s.undHemB[0]) / 2, s.sleeveLen + 1.6]),
      FN('ventFold', '트임',        '절개선 아래 ' + f1(K.ventLen) + ' 를 바깥으로 ' + f1(K.ventW),
                     vU.len, U, [vU.topOut[0] + 0.6, (vU.topOut[1] + vU.hemOut[1]) / 2]),
      FN('ventMitre','트임 미터',   '재단선 — 트임 바깥 위 모서리 → 절개선 위 ' + f1(K.ventMitre),
                     V.dist(vU.topOut, vU.mitreOn), U, cp(vU.mitreOn)),
      FN('ventTop',  '트임 위 접음선', '트임 너비 ' + f1(K.ventW),
                     V.dist(vU.top, vU.topOut), U, cp(vU.top)),

      /* ── 소맷부리 합계 (큰소매에 한 번) ── */
      FN('cuff',     '완성 소맷부리', '큰 ' + f1(V.dist(s.bigHemF, s.bigHemB)) +
                     ' + 작은 ' + f1(V.dist(s.undHemF, s.undHemB)) + ' (트임 덧단은 서로 겹친다)',
                     V.dist(s.bigHemF, s.bigHemB) + V.dist(s.undHemF, s.undHemB), B,
                     [(s.bigHemF[0] + s.bigHemB[0]) / 2, s.sleeveLen + 3.0]),
      FN('capAll',   '소매산 총합',  '큰 + 작은 = 암홀 ' + f1(s.AH) + ' + 이세분',
                     polyLen(s.capBigFront) + polyLen(s.capBigBack) + polyLen(s.capUnderBack) +
                     polyLen(sampleSegs(s.undCapOut, 0.02)), B, [s.apexShift, 1.4])
    ];
  }

  /* ══════════════════════════════════════════════════════════════════
   * 4. 곡선 생성 (Freesewing Brian block 계열 3차 베지어)
   * ════════════════════════════════════════════════════════════════ */

  /** 뒤 목선 : CB(수평 출발) → 중간점 M → 목옆점(어깨선에 수직 도착) — 2 큐빅
   *  Freesewing fsNeck 구조(중심 수평 · SNP 어깨수직)에 중간 앵커를 하나 더 둔 형태.
   *  M 은 뒷목 사각(B/12 × 3.5) 안의 비율점이라 호수가 바뀌어도 자기유사하게 움직인다. */
  function curveBackNeck(BNP, SNP, shDir) {
    var C = CAL.backNeck;
    var W = SNP[0] - BNP[0], Hy = SNP[1] - BNP[1];
    var Mp = [BNP[0] + W * C.mx, BNP[1] + Hy * C.my];
    /* 끝접선 — 이 원형의 뒷목은 어깨선에 **수직으로 도착하지 않는다**
       (66호 DXF 실측 −58.05°, 어깨 수직이면 −71.38°). 어깨 수직에서 et 도 돌려 맞춘다. */
    /* 목옆점에는 **어깨선에 수직으로** 도착한다 (SPEC §5-7 · §23).
       앞뒤 목선이 어깨솔기에서 같은 각으로 만나야 봉제 후 목선이 매끄럽다.
       ※ 원본 DXF 는 이 각이 벗어나 있지만(손으로 그은 스플라인) 규칙을 따른다. */
    var pin = perpToward(shDir, SNP, BNP);
    return splineSegs([BNP, Mp, SNP],
      endTan([1, 0], C.k0),        // CB 에서 수평 출발
      endTan(V.mul(pin, -1), C.k1));
  }

  /** 앞 목선 : CF(수평 출발) → 목 구성 사각 대각선 2/3 점 → 목옆점 — C2 스플라인
   *  대각선 2/3 점은 66호 DXF 의 표시원과 정확히 일치한다. */
  function curveFrontNeck(FNP, SNP, shDir, nw) {
    var C = CAL.frontNeck;
    var dep = FNP[1];                                            // 앞목깊이 = B/12
    var Mp = [nw * K.neckDiagRatio, dep * K.neckDiagRatio];      // 목 사각 대각선 2/3 점
    var pin = perpToward(shDir, SNP, FNP);      // 어깨선에 수직 도착 (§5-7)
    return splineSegs([FNP, Mp, SNP],
      endTan([1, 0], C.k0),
      endTan(V.mul(pin, -1), C.k1));
  }

  /** 암홀 : 겨드랑(수평 출발) → 오목점 hollow → 품점(품선 2등분점) → 접점 T → 어깨점
   *
   *  66호 DXF 로 확인한 이 원형의 암홀 구조 —
   *   ① 어깨점에서 어깨선에 **수직으로 내린 직선**이 품선과 만나는 점까지가 안내선이고,
   *      암홀 윗부분은 그 직선 위를 그대로 지난다 (DXF 편차 0.0003 cm).
   *   ② 암홀은 품선의 2등분점에서 품선에 **접한다** (뒤 (17.2,10.8) 편차 0.0003 cm).
   *
   *  네 점을 **C2 스플라인**으로 잇고 마지막 T~SP 만 직선이다.
   *  예전처럼 구간마다 장력을 따로 적합하면 접선은 이어져도 곡률이 튀어
   *  품점 부근에서 눈에 보이게 꺾인다 (실제로 곡률이 −10 ↔ +11 로 뒤집혔다).
   *  앵커 위치는 dx(품선→옆선)·dy(어깨점→BL) 대비 비율이라 호수에 따라 스케일된다. */
  function curveArmhole(U, SP, shDir, pitchXm, pitchY, BL, back) {
    var C = back ? CAL.backArm : CAL.frontArm;
    var dy = BL - SP[1];                                       // 어깨점 → BL 세로 스팬
    var dx = U[0] - pitchXm;                                   // 품선 → 옆선 가로 스팬
    var P = [pitchXm + C.pdx * dx, pitchY + C.pdy * dy];       // 품점 (품선 2등분점 + 미세보정)
    var H = [U[0] - C.hdx * dx, BL - C.hdy * dy];              // 오목점 hollow
    var pin = perpToward(shDir, SP, U);                        // 어깨선 수직, 조각 안쪽
    /* 어깨점에서 어깨선에 수직으로 내린 직선이 품선과 만날 때까지의 거리 */
    var sQ = Math.abs(pin[0]) > 1e-6 ? (pitchXm - SP[0]) / pin[0] : dy;
    if (!isFinite(sQ) || sQ <= 0.2) sQ = dy;
    var T = V.add(SP, V.mul(pin, sQ * C.tR));                  // 곡선이 그 직선에 접하는 점
    /* 끝은 직선 T→SP 에 접해야 하므로 T 에서의 접선을 그 직선 방향(−pin)으로 고정한다 */
    var curve = splineSegs([U, H, P, T],
      endTan([-1, 0], C.k0),
      endTan(V.mul(pin, -1), C.k1));
    return curve.concat(lineSegs(T, SP));
  }

  /* ── 곡선 캘리브레이션 상수 ──────────────────────────────────────────
   *  66호 원본 DXF(dxf-66-groundtruth.json) 폴리라인에 대한 최대편차를
   *  최소화하도록 적합한 값. 모두 무차원 비율/각도(도)이므로 44~88호에서도
   *  같은 모양이 유지된다.  재적합: node engine-verify.js --calibrate         */
  var CAL = {
    backNeck : { mx: 0.533270, my: 0.066068, k0: 0.586070, k1: 1.029722 },
    frontNeck: { k0: 0.961130, k1: 0.727263 },
    backArm  : { pdx: 0.004119, pdy: -0.052741, hdx: 0.531282, hdy: 0.044945, tR: 0.224301, k0: 1.633277, k1: 1.638341 },
    frontArm : { pdx: 0.018507, pdy: 0.084168, hdx: 0.885293, hdy: 0.198793, tR: 0.091475, k0: 1.470229, k1: 1.536268 },
    capBack  : { k0: 1.1487, k1: 1.8359 },
    capFront : { k0: 0.9437, k1: 0.9742 },
    tightUnder: { eOff: -0.2000, k0: 0.2776, k1: 2.0108 },
    /* 2장소매 — 절개변·앞경계의 끝 접선 크기 */
    /* 절개선 — 도면 bigBack 41점에 적합(편차 0.106). 도면의 절개선은 거의 직선이라
       (호 53.7565 / 현 53.726) 중간 앵커는 팔꿈치선보다 6.8 위로 올라간다. */
    /* 언더암 다트 완성선 밑단 — 옆선 직각 출발 · 다트 닫힌 자리 수평 도착 */
    uaHem    : { k0: 1.00, k1: 1.00 },
    twoSeam  : { mr: 0.172537, my: -6.831831, k0: 0.847411, k1: 0.150000 },
    /* ★ 허리다트 다리와 뒤 옆선은 **직선이 아니라 곡선**이다 (도면 폴리라인 실측).
       tm = 중간 앵커의 현 위치(비율), k = 현길이 대비 수직 오프셋 — 둘 다 무차원이라
       전 호수에 그대로 쓴다. 직선으로 두면 뒤 다트가 도면에서 0.44 벌어진다. */
    dartBackSide : { tm: 0.0992, k: -0.00850 },   // 뒤 다트 옆다리   (편차 0.076)
    dartBackCtr  : { tm: 0.1801, k: -0.01350 },   // 뒤 다트 중심다리 (편차 0.029)
    dartFrontSide: { tm: 0.1377, k: -0.00350 },   // 앞 다트 옆다리   (편차 0.014)
    dartFrontCtr : { tm: 0.8772, k:  0.00250 },   // 앞 다트 중심다리 (편차 0.006)
    backSideSeam : { tm: 0.1381, k: -0.00250 },   // 뒤 옆선          (편차 0.031)
    twoFront : { k0: 1.00 },
    /* 작은소매 소매통 연결(3 cm) — 도면 capBackOut 7점에 적합.
       도착 접선은 **수평 고정**이라야 뒤 소매산과 매끄럽게 이어진다. */
    twoCapOut: { slope: 0.6111, k0: 0.6078, k1: 0.2402 }
  };

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
  var SEAM_DEFAULT = { neck: 1.0, shoulder: 1.0, armhole: 1.0, side: 1.5, hem: 3.0,
                       sleeveHem: 2.5, fold: 0, dart: 0 };
  /* dart — 다트 다리에는 시접을 따로 주지 않는다(항상 0). 허리 시접이 다트 다리를
     따라 그대로 연장되는 모양이 되어, 봉제 시 시접이 다트를 통과한다. */
  var SEAM_ROLES = Object.keys(SEAM_DEFAULT);

  /** opt.seam 정규화 — 숫자면 전 부위 균일, 객체면 role 별. fold 는 항상 0 강제. */
  function normSeam(seam) {
    var out = {}, warn = null, i;
    if (seam === undefined || seam === null) seam = 0;
    if (typeof seam === 'number') {
      if (!(seam > 0)) { for (i = 0; i < SEAM_ROLES.length; i++) out[SEAM_ROLES[i]] = 0; return { map: out, uniform: 0, warn: null }; }
      for (i = 0; i < SEAM_ROLES.length; i++) out[SEAM_ROLES[i]] = seam;
      out.fold = 0; out.dart = 0;
      return { map: out, uniform: seam, warn: null };
    }
    for (i = 0; i < SEAM_ROLES.length; i++) {
      var k = SEAM_ROLES[i];
      var v = (typeof seam[k] === 'number' && isFinite(seam[k]) && seam[k] >= 0) ? seam[k] : SEAM_DEFAULT[k];
      out[k] = v;
    }
    if (typeof seam.fold === 'number' && seam.fold !== 0) warn = '골선(fold) 시접은 항상 0 입니다 — 입력값 ' + seam.fold + ' 무시';
    if (typeof seam.dart === 'number' && seam.dart !== 0) warn = (warn ? warn + ' / ' : '') + '다트(dart) 시접은 항상 0 입니다 — 입력값 ' + seam.dart + ' 무시';
    out.fold = 0; out.dart = 0;
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
      var lim = Math.max(sA, sB) * LIMIT;
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

  /** 외곽선 변을 가리키는 internal 항목 — formulaNotes.id 가 전부 대응되도록.
   *  좌표는 외곽선과 완전히 겹치므로 도면이 달라지지 않고, UI 는 id 로 주석을 붙일 수 있다. */
  function subsamp(segs, n) {
    var p = sampleSegs(segs, 0.4), out = [], step = Math.max(1, Math.floor(p.length / (n || 40)));
    for (var i = 0; i < p.length; i += step) out.push(p[i]);
    if (out[out.length - 1] !== p[p.length - 1]) out.push(p[p.length - 1]);
    return out;
  }

  function backInternal(m, g) {
    var half = g.bPitchX / 2;
    return [
      L('topLine',  'line',   [[0, 0], [g.halfW, 0]], '상단 기준선'),
      L('BL',       'line',   [[0, g.BL], [g.halfW, g.BL]], 'BL'),
      L('backW',    'dashed', [[g.bPitchX, 0], [g.bPitchX, g.BL]], '등품선'),
      L('backW2',   'dashed', [[half, g.BL - 1.4], [half, g.BL]], '등품 2등분'),
      L('shGuide',  'dashed', [[g.bSpX, -1.2], [g.bSpX, g.SPb[1] + 0.6]], '어깨 안내선'),
      L('neckW',    'dashed', [[g.nwB, 0], [g.nwB, -K.backNeckRise]], '뒷목너비'),
      L('neckRise', 'dashed', [[0, -K.backNeckRise], [g.nwB, -K.backNeckRise]], '뒷목 올림'),
      L('shDrop',   'dashed', [[g.bPitchX - 2.0, K.backShDrop], [g.bPitchX + 1.0, K.backShDrop]], '어깨 기울기점'),
      L('dartLine', 'dashed', [g.bDartTop, [g.bDartX, g.WLb]], '다트 중심선'),
      L('SP',       'point',  [g.SPb], 'SP'),
      L('SNP',      'point',  [g.SNPb], 'SNP'),
      L('dartTip',  'point',  [g.bDartTip], '다트끝')
    ];
  }
  function frontInternal(m, g) {
    var half = K.frontShDrop + (g.BL - K.frontShDrop) / 2;      // 앞품선 2등분점 y
    return [
      L('topLine',  'line',   [[0, 0], [g.halfW, 0]], '상단 기준선'),
      L('BL',       'line',   [[0, g.BL], [g.halfW, g.BL]], 'BL'),
      L('frontW',   'dashed', [[g.fPitchX, K.frontShDrop], [g.fPitchX, g.BL]], '앞품선'),
      L('frontW2',  'dashed', [[g.fPitchX - 1.0, half], [g.fPitchX, half]], '앞품 2등분'),
      L('neckW',    'dashed', [[g.nwF, 0], [g.nwF, g.FNP[1]]], '앞목너비'),
      L('neckD',    'dashed', [[0, g.FNP[1]], [g.nwF, g.FNP[1]]], '앞목깊이'),
      L('neckDiag', 'dashed', [[0, 0], [g.nwF, g.FNP[1]]], '목 사각 대각선'),
      L('shDrop',   'dashed', [[g.fPitchX - 2.0, K.frontShDrop], [g.fPitchX + 1.0, K.frontShDrop]], '어깨 기울기점'),
      L('bpLen',    'dashed', [g.SNPf, g.BP], '유장'),
      L('bpSpan',   'dashed', [[g.BP[0], 0], [g.BP[0], g.BP[1]]], '유폭'),
      L('sideDart', 'dashed', [g.BP, g.dFoot], '가슴다트 기준'),
      L('waistDart','dashed', [g.BP, [g.BP[0], g.WLf]], '허리다트 중심'),
      L('BP',       'point',  [g.BP], 'BP'),
      L('SP',       'point',  [g.SPf], 'SP'),
      L('SNP',      'point',  [g.SNPf], 'SNP'),
      L('fDartTip', 'point',  [g.fDartTip], '허리다트끝')
    ];
  }

  /** 외곽선 변을 가리키는 internal 항목 — formulaNotes.id 가 전부 대응되도록. */
  function backEdgeInternals(g) {
    return [
      L('side',     'line', [g.Ub, g.bWaist], '옆선'),
      L('WL',       'line', [[0, g.WLb], [g.bWaist[0], g.WLb]], '허리선'),
      L('shBack',   'line', [g.SNPb, g.SPb], '어깨선'),
      L('armBack',  'line', subsamp(g.backArm), '뒤 암홀'),
      L('neckBack', 'line', subsamp(g.backNeck), '뒷목둘레'),
      L('bDart',    'line', [g.bDartR, g.bDartTip, g.bDartL], '뒤 허리다트')
    ];
  }
  function frontEdgeInternals(g) {
    return [
      L('side',      'line',  [g.Uf, g.dUpTrue], '옆선(위)'),
      L('sideLow',   'line',  [g.dLo, g.fWaist], '옆선(아래)'),
      L('shFront',   'line',  [g.SNPf, g.SPf], '어깨선'),
      L('armFront',  'line',  subsamp(g.frontArm), '앞 암홀'),
      L('neckFront', 'line',  subsamp(g.frontNeck), '앞목둘레'),
      L('bustDart',  'line',  [g.dUpTrue, g.BP, g.dLo], '가슴다트'),
      L('fDart',     'line',  [g.fDartR, g.fDartTip, g.fDartL], '앞 허리다트'),
      L('hemCF',     'point', [[0, g.WLf]], 'CF 밑단')
    ];
  }

  /** meta.formulaNotes — SPEC §8.1 확정 구조 { id, label, formula, value, piece, anchor } */
  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }
  function formulaNotes(m, g, seam, AHb, AHf, NKb, NKf) {
    var easeTxt = g.ease ? ' (여유분 ' + f1(g.ease) + ')' : ' (여유분 0)';
    return [
      /* ── 뒤판 ── */
      FN('BL',       'BL',          'B/4 + 0.6',              g.BL,       'back',  [g.halfW * 0.5, g.BL]),
      FN('WL',       '허리선',       '등길이',                   g.WLb,      'back',  [g.halfW * 0.5, g.WLb]),
      FN('side',     '옆선',         'B/4 + 여유분/2' + easeTxt, g.halfW,    'back',  [g.halfW, (g.BL + g.WLb) / 2]),
      FN('backW',    '등품선',       '등품/2',                  g.bPitchX,  'back',  [g.bPitchX, g.BL * 0.62]),
      FN('shGuide',  '어깨 안내선',   '어깨너비/2 + 이세 ' + f1(g.shEase), g.bSpX, 'back', [g.bSpX, 0.9]),
      FN('neckW',    '뒷목너비',      'B/12 + 1',               g.nwB,      'back',  [g.nwB * 0.5, -K.backNeckRise]),
      FN('neckRise', '뒷목 올림',     '고정 2.5',                K.backNeckRise, 'back', [g.nwB, -K.backNeckRise * 0.5]),
      FN('shDrop',   '어깨 기울기점',  '등품선에서 0.6 내림',        K.backShDrop, 'back', [g.bPitchX, K.backShDrop]),
      FN('shBack',   '뒤 어깨선',     '목옆점 → 어깨너비/2 + 이세',  g.shLenBack, 'back', [(g.SNPb[0] + g.SPb[0]) / 2, (g.SNPb[1] + g.SPb[1]) / 2]),
      FN('armBack',  '뒤 암홀',      '곡선길이',                 AHb,        'back',  [g.bPitchX + 1.0, g.BL * 0.55]),
      FN('neckBack', '뒷목둘레',      '곡선길이',                 NKb,        'back',  [g.nwB * 0.5, -0.9]),
      FN('dartLine', '다트 중심선',   '어깨선 4.5 지점 ↔ 등품/4 + 1.2', g.bDartX, 'back', [g.bDartX, g.BL * 0.8]),
      FN('dartTip',  '뒤 다트끝',     'BL 에서 5.0 위',           K.bDartTipUp, 'back', cp(g.bDartTip)),
      FN('bDart',    '뒤 허리다트',   '다트 폭 2.0',              K.bDartW,   'back',  [g.bDartX, g.WLb]),
      /* ── 앞판 ── */
      FN('BL',       'BL',          'B/4 + 0.6',              g.BL,       'front', [g.halfW * 0.5, g.BL]),
      FN('WL',       'CF 밑단',      '앞길이',                   g.WLf,      'front', [g.halfW * 0.25, g.WLf]),
      FN('side',     '옆선',         'B/4 + 여유분/2' + easeTxt, g.halfW,    'front', [g.halfW, (g.BL + g.WLf) / 2]),
      FN('frontW',   '앞품선',       '앞품/2',                  g.fPitchX,  'front', [g.fPitchX, g.BL * 0.6]),
      FN('neckW',    '앞목너비',      'B/12',                   g.nwF,      'front', [g.nwF * 0.5, -0.5]),
      FN('neckD',    '앞목깊이',      'B/12',                   g.nwF,      'front', [0.6, g.nwF * 0.5]),
      FN('shDrop',   '어깨 기울기점',  '앞품선에서 3.4 내림',        K.frontShDrop, 'front', [g.fPitchX, K.frontShDrop]),
      FN('shFront',  '앞 어깨선',     '뒤 어깨선과 같은 길이',        g.shLenFront, 'front', [(g.SNPf[0] + g.SPf[0]) / 2, (g.SNPf[1] + g.SPf[1]) / 2]),
      FN('bpLen',    '유장',         '목옆점에서 잰 거리',          m.bpLen,    'front', [(g.SNPf[0] + g.BP[0]) / 2, (g.SNPf[1] + g.BP[1]) / 2]),
      FN('bpSpan',   '유폭',         '유폭/2',                  g.BP[0],    'front', [g.BP[0] * 0.5, g.BP[1] - 1.2]),
      FN('BP',       'BP',          '(유폭/2, 유장)',            g.BP[1],    'front', cp(g.BP)),
      FN('armFront', '앞 암홀',      '곡선길이',                 AHf,        'front', [g.fPitchX + 1.0, g.BL * 0.55]),
      FN('neckFront','앞목둘레',      '곡선길이',                 NKf,        'front', [g.nwF * 0.45, g.nwF * 0.55]),
      FN('sideDart', '가슴다트',      '앞길이 − 등길이',            g.dartAmt,  'front', [g.halfW - 1.5, g.BL + K.sideDartDrop]),
      FN('bustDart', '다트 다리',     '위 = 아래 (접어 꿰매므로 같아야 한다) · BP→기준점 − 0.3', g.rL, 'front', cp(g.dLo)),
      FN('fDartTip', '허리다트끝',    'BP 아래 2.5',              K.fDartTipDown, 'front', cp(g.fDartTip)),
      FN('fDart',    '앞 허리다트',   'CF쪽 1.0 · 옆선쪽 1.5',      K.fDartIn + K.fDartOut, 'front', [g.BP[0], g.WLf]),
      FN('seam',     '시접',         (typeof seam === 'number' ? '전 둘레 균일' : '부위별'), (typeof seam === 'number' ? seam : 0), 'both', [0, 0])
    ];
  }

  /* ══════════════════════════════════════════════════════════════════
   * 6. 노출
   * ════════════════════════════════════════════════════════════════ */
  return {
    measuresForSize: measuresForSize,
    draftLady1: draftLady1,
    draftNoDart: draftLady1,          // 재사용 모듈(ui.js·print.js) 호환용 별칭
    geom: geom,
    MEAS_KEYS: MEAS_KEYS, MEAS_LABEL: MEAS_LABEL, SIZES: Object.keys(SIZE_STEP),
    BASE: BASE, GRADE: GRADE, K: K, CAL: CAL, FLATTEN: FLATTEN, EASE_DEFAULT: EASE_DEFAULT,
    SEAM_DEFAULT: SEAM_DEFAULT, SEAM_ROLES: SEAM_ROLES,
    SLEEVE_TYPE: SLEEVE_TYPE, SLEEVE_TYPES: SLEEVE_TYPES,
    util: { V: V, bez: bez, bezLen: bezLen, sLen: sLen, through: through, sPath: sPath, LN: LN,
            sampleSegs: sampleSegs, polyLen: polyLen, offsetLoop: offsetLoop, offsetLoopSeg: offsetLoopSeg,
            normSeam: normSeam, lineSegs: lineSegs,
            rotv: rotv, perpToward: perpToward, revSegs: revSegs, pointOnRayAtDist: pointOnRayAtDist,
            /* 곡선 상수 재적합 스크립트가 조각 하나만 빠르게 다시 그릴 수 있도록 노출한다 */
            splineSegs: splineSegs, endTan: endTan }
  };
});
