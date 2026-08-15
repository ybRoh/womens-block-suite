/* ============================================================================
 * 바 재킷 (더블) — 제도 엔진
 *
 * ★★ 이 엔진은 **PDF 도면을 읽어 「공식화」하는 엔진**이다 ★★ (2026-08-12 사용자 정의)
 *
 *     · 대상 도면 : sisterMAG 56 「Barjacke doppelreihig」 · Größe 36
 *     · 우선순위 : **PDF 치수가 먼저.**
 *                 도면에 **없는 치수만** 기본 제도법(백영례)을 벤치마킹한다.
 *     · 하는 일  : 한 호수뿐인 도면 실측을 **전 호수가 따라오는 식**으로 바꾼다.
 *
 *   ⚠ 도면을 옮길 때 **좌표를 박지 마라.** 「앞중심 기준 · 어깨길이의 비율 ·
 *     현에서 벗어난 양」처럼 **규칙**으로 옮긴다 — 좌표를 박으면 그 호수만 맞는
 *     엔진이 된다 (1~7차에 실제로 그렇게 실패했다).
 *   ⚠ **이 방침과 도면 상수는 이 엔진에만 쓴다.** 다른 8개 모듈은 교재 공식이
 *     기준이고 각자의 DXF 정답지가 따로 있다 — 여기 값을 옮겨 가면 안 된다.
 *   · K 의 각 값이 **도면에서 왔는지 교재에서 왔는지**는
 *     docs/테일러드재킷-제도법-백영례.md §Ⅵ 「치수 출처 표」에 정리해 두었다.
 *
 *   ※ 예외 없음 — **목너비도 도면 치수**로 맞췄다 (앞 7.15 · 뒤 6.57 · 2026-08-12).
 *     교재는 앞뒤 모두 B/12 + 1.5 (=8.30) 로 넓게 판다. 도면이 그보다 조이므로
 *     **재킷을 겹쳐 입을 때 목이 끼는지 시착으로 확인할 것.**
 *     교재값으로 돌리려면 UI 「앞/뒤 옆목 파기」에 1.5 를 준다.
 *
 *   제도법: **백영례 「테일러 자켓 패턴」 번호점 제도법** (번호점 1~87 · 46단계)
 *           docs/테일러드재킷-제도법-백영례.md 가 골격의 기준 문서다.
 *   조각 17장 — 몸판 4 · 카라 · 주머니(플랩·주머니감) · 안단 2 · 소매 2 · 안감 6
 *              (앞뒤 각 2장 = 4패널 · **옆선이 그대로 있다**)
 *   정답지: barjacke-36-groundtruth.json (DE36 도면 실측) — 한 호수뿐이므로
 *          **좌표가 아니라 「규칙」을 읽어** 넣는다 (앞중심 기준 · 비율 · 각도).
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
    /* ★ 교재 [12] 는 **다트 1.5 또는 이세 0.7~0.8** 중 하나를 쓰라고 한다.
       Barjacke 도면(참고자료)의 뒤판에는 **어깨 다트가 없다** — 이세로 처리한 것이다.
       그래서 기본을 0(= 이세)으로 둔다. 다트로 하고 싶으면 UI 에서 1.5 를 준다.
       (2026-08-12 사용자 지적 — 도면에 없는 다트가 조각에 생겼다) */
    /* ★ 어깨 늘림(패드분) — **도면값**. 재킷 어깨는 몸 어깨보다 넓다(패드가 들어간다).
       도면 뒤판 폭 20.32 = 어깨점 x 이고, 어깨너비/2(18.60) + 이세(0.75) = 19.35 이라
       **0.97** 이 모자란다. 교재는 이 값을 따로 두지 않는다(어깨/2 + 다트분).
       ⚠ 이 값을 바꾸면 어깨선이 길어져 **앞 절개 어깨 위치(`fCutShF`)도 다시 맞춰야** 한다. */
    shoulderAdd  : 0.97,   // 어깨점 x = 어깨너비/2 + 이 값 + 다트(이세)분
    backShDart   : 0,      // 뒤 어깨 다트분 (0 = 이세로 대신)   [10] 21번
    backShEase   : 0.75,   // 다트 대신 이세로 할 때 0.7~0.8    [12]
    backShDartLen: 7.0,    // 어깨 다트 길이                     [19] 40번
    armInset     : 0.5,    // 암홀이 품선에서 떨어지는 양 0.5~1  [13] 26번 · [25] 49번
    bDartCenterIn: 2.5,    // 뒤 절개 중심 = 등품점에서 2~3 안쪽 [14] 27번
    /* ── 앞 절개선 출발 ────────────────────────────────────────────
       교재 [28] 은 **암홀**에서 출발한다(69번 아래). 참고 도면(Barjacke)은
       **어깨**에서 출발해 앞판이 좁다 — 도면 실측 목옆점에서 6.40 (어깨의 0.58).
       도면 구성을 기본으로 두고, 교재 구성은 `opt.fCutAt = 'armhole'` 로 쓴다. */
    fCutAt       : 'shoulder',
    /* 도면 앞판 어깨 6.40 ÷ 어깨선 13.72 = 0.466.
       ⚠ **어깨선 길이를 바꾸는 값이면 여기도 다시 맞춰야 한다** — 목너비(앞뒤) ·
         어깨 늘림 · 어깨 다트/이세분이 전부 어깨선 길이를 바꾼다.
         이력: 교재 목너비 0.58 → 도면 목너비 0.50 → 어깨 늘림 0.97 넣고 0.465. */
    fCutShF      : 0.465,  // 어깨 출발 자리 — 목옆점에서 어깨길이의 이 비율 (도면 6.40)
    hemCrossUp   : 5.0,    // 밑단 교차점 = 밑단에서 5 위        [14] 29번
    hemSplayMin  : 0.6,    // 밑단 벌림 하한 — 14~16 이 0 이면 이 값 [15] 30·31번
    /* ★ 뒤 옆목 파기 — **도면값**. 도면 뒷목너비가 6.57 이고 B/12 = 6.80 이라
       파기가 **−0.23**(= 오히려 0.23 좁힌다). 교재 [18] 은 1.5 로 넓게 판다.
       이 엔진은 **PDF 치수가 먼저**이므로 도면을 따른다 (2026-08-12 사용자 지시).
       ⚠ 도면은 앞(7.15)보다 뒤가 더 좁다 — 목이 조이는 제도다.
         교재값으로 돌리려면 UI 「뒤 옆목 파기」에 1.5. */
    neckOut      : -0.23,  // **뒤** 옆목 파기 — 뒷목너비 = B/12 + 이 값 (도면 6.57)
    /* ★ 앞 옆목 파기 — **도면값**. 도면 앞 목너비가 7.15 이고 B/12 = 6.80 이라 0.35.
       교재 [23] 은 뒤와 같이 1.5 (=8.30). PDF 우선이므로 도면을 따른다.
       ⚠ 목너비를 좁히면 **어깨선이 길어진다** — 어깨점 x 는 `어깨/2 + 다트분` 으로
         고정이라 목옆점이 안으로 들어온 만큼 어깨가 늘어난다(11.06 → 12.69).
         그래서 아래 `fCutShF`(앞 절개 어깨 위치)도 함께 다시 맞췄다. */
    frontNeckOut : 0.35,   // **앞** 옆목 파기 — 앞 목너비 = B/12 + 이 값 (도면 7.15)
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
    /* 맨 위 단추 — 도면은 조각 맨 위(목옆점)에서 27.24 아래다.
       목옆점이 가슴선에서 (BL − 목옆점y) 위이므로 가슴선 기준으로 옮기면 6.34. */
    btnTopFromBL : 6.34,   // 맨 위 단추 — 가슴선에서 아래로
    btnRows      : 3,      // 단추 줄 수
    bhLen        : 2.09,   // 단춧구멍 길이
    rollIn       : 2.5,    // 꺾임선이 어깨선을 지나는 자리       [41] 76번
    /* ── 노치 라펠 [43]~[46] ────────────────────────────────────────
       ★ 앞판 윗변은 **봉우리 두 개 + V** 다 — 목옆점(53) → 고지선을 타고 내려간
         **V 바닥(83)** → 라펠 윗변을 타고 올라간 **라펠 꼭짓점** → 여밈선.
         V 바닥에서 카라 끝(87)과 만나 노치가 된다 [45].
       ⚠ 예전에는 목옆점에서 수직으로 2.5 내리고 곧장 여밈선으로 갔다 —
         봉우리가 하나뿐이라 도면과 모양이 달랐다 (2026-08-12 사용자 지적).
       고지선은 **카라가 붙는 변**이고, 라펠 윗변은 안단으로 처리하는 변이다. */
    /* ★ 노치 자리는 **앞중심선 기준**이다 — 도면 실측으로 확인했다:
         · V 바닥(고지선 끝)이 **앞중심선 위**(x = 0), 목옆점에서 6.24 아래
         · 라펠 꼭짓점은 앞중심 **바깥 3.71**, 목옆점에서 2.55 아래
       길이·각도로 잡던 것을 이 규칙으로 바꿨다. 각도로 두면 목너비가 호수마다
       달라질 때 V 바닥이 앞중심을 벗어난다 (55호에서 2.86 안쪽에 있었다). */
    notchDrop    : 6.24,   // V 바닥 — 목옆점에서 아래 (x = 앞중심 0)  [43] 83번
    /* 고지선은 도면에서 **굽어 있다** — 현에서 1.2 아래로 부푼다 (실측 1.202).
       직선으로 두면 카라 붙는 자리가 도면보다 위로 들린다. */
    gorgeBulge   : 1.20,
    /* 라펠선이 여밈선과 만나는 자리 = **꺾임 시작**. 도면은 맨 윗단추보다 7.1 위다
       (조각 위에서 20.1 · 맨 윗단추 27.24). 단추 자리에 두면 라펠이 낮아진다. */
    lapelBreakUp : 7.10,
    lapelOut     : 3.71,   // 라펠 꼭짓점 — 앞중심 바깥               [45]
    lapelDrop    : 2.55,   // 라펠 꼭짓점 — 목옆점에서 아래
    collarOut    : 0.5,    // 테일러 카라 — 옆목점에서 0.5 나가서 [42] 78번
    /* 카라 넓이 (79~80) [42] 80번 — **도면 6.8** · 교재는 7.5.
       도면은 폭이 일정하지 않다(끝 6.3 · 가운데 8.3). 균일 폭으로 옮기면 6.8 이
       도면과 가장 가깝다(편차 0.44, 6.35 는 0.47 · 7.5 는 0.54). */
    collarW      : 6.8,
    collarStand  : 3.0,    // 스탠드 높이 — 넓이보다 작아야 눕는다
    /* ★ 카라 스프링 — **몸판 목둘레의 휨을 얼마나 남길지**.
         테일러드 카라는 몸판 위에 꺾임선을 축으로 그린 뒤 떼어낸다 [42]~[46].
         그 결과가 곧 「목둘레 곡선을 스프링만큼만 남기고 편 선」이다.
           0 = 완전히 편 곧은 띠(선 카라 · 바깥선 = 목붙임선)
           1 = 목둘레 그대로 (피터팬처럼 눕는다 · 55호 늘림 9.8)
         바깥선은 목붙임선보다 **짧아선 안 된다** — 짧으면 목을 조인다.

       ★ 값은 **도면에서 뜬다** — 도면 카라는 목붙임선 17.42 · 바깥선 17.66,
         즉 늘림이 **+0.24 뿐**이다. 도면의 식서 화살표가 골선과 약 57° 로 놓여
         있어 **바이어스 재단 언더칼라**다 — 바이어스는 다림질로 바깥선을 늘려
         쓰므로 제도에서 스프링을 조금만 준다. 0.032 가 늘림 0.238 이다.
         (도면 겹침 편차는 0.02~0.06 구간에서 0.429~0.431 로 평평해 도면이
          스프링을 못 가린다 — 그래서 **늘림 실측값**으로 정했다.) */
    collarSpring : 0.032,
    /* ── 2장소매 (숙녀복기본원형2 에서 이식 · [ ] 안이 그 모듈 정답지 실측) ──── */
    /* ★ 소매산 골격 — **도면(Barjacke) 대조로 다시 잡았다**.
       소매통 폭은 `√(암홀² − 수직변²)` 로 나오는데, 이 수직변이 `AH/capHeightDiv` 다.
       패드분은 정점만 올릴 뿐 수직변이 아니라서 **폭에 영향이 없다** —
       예전에 `capPad` 를 낮춰 폭을 넓히려던 시도가 안 먹힌 이유가 이것이다.
       원형2 이식판은 AH/3 이었고, 그러면 소매통이 도면보다 4.6 좁다(31.4 ↔ 36.0). */
    capHeightDiv   : 3.45,     // 수직변 = AH/3.45 — 소매통 폭을 도면 쪽으로 넓힌 값
    /* 패드분 — 정점만 올린다(폭에는 영향 없음). 조각 넓이를 도면에 맞추는 과정에서
       1.3 → 1.9 로 올렸다. 소매산 이세도 3.26 → 4.01 로 재킷다워진다 [원형2 1.0000]. */
    capPad         : 1.9,
    capApexShift   : 0.6,      // 정점을 앞으로 이동 (도면 `앞으로 이동 0.6`)
    capBulge       : 0.5,      // 곡선 통과점 = 대각선 발점 ↔ 마크 사이 비율 [0.500~0.512]
    capTopDiv      : 8,        // 소매산 상단 마크 = 중심에서 AH/이 값
    capReduce      : 0,        // 소매산 대각선에서 뺄 양 (0 = 암홀 길이 그대로)
    twoMarkBotB    : 4.5,      // 뒤 하단 마크 — 고정 4.5 (AH/12+0.6 아님)
    armNotchDiv    : 3,
    capEaseShare   : [0.0, 0.5, 0.5],   // 겨드랑 구간 이세 0 — 넣으면 주름이 진다
    capEaseBack    : 0.6,      // 전체 이세의 뒤 몫
    elbowAdd       : 2.5,      // 팔꿈치선 = 소매길이/2 + 2.5
    twoSplitGap    : 0.8,      // 큰·작은 절개점 간격 [0.8000]
    /* 절개점 높이 = 소매산 × 이 값. 원형2 정답지는 정확히 절반(0.5)인데,
       **도면은 큰소매가 뒤 소매산을 더 많이 가져간다** (14.72 ↔ 절반이면 12.4). */
    twoSplitAt     : 0.55,
    /* 절개 위치 — 큰소매 앞 −이 값 · 작은소매 뒤 +이 값 (소매통 총폭은 안 변하고
       큰↔작은 몫만 옮긴다). 원형2 는 3.0 이었는데, **도면의 작은소매가 훨씬 넓다**.
       도면 작은소매 폭 13.3~13.6 ↔ 3.0 이면 10.3 · 5.5 면 13.4 로 맞는다.
       ★ 두 조각의 **넓이**까지 보면 5.5 는 큰소매가 36 넘치고 작은소매가 42
         모자랐다(합은 맞았다 — 몫이 틀린 것이다). 55호 6.5 면 둘 다 4 안이다.
       ★ 값은 **halfF 에 대한 비율**이다 (55호 halfF 16.50 × 0.394 = 6.50). */
    twoSideOffAt   : 0.394,
    twoHemDrop     : 2.69,     // 밑단 뒤쪽이 내려간 양 — **도면** 59.92 − 57.23 [원형2 1.4920]
    twoHemUp       : 0.300,    // 밑단선 — 패드점+소매길이 에서 올림 [식 미상]
    twoCuffBigShare: 2 / 3,    // 소맷부리 큰소매 몫 — **이분법이 실패할 때만 쓰는 대비값**
    /* 몫 울타리 — 도면 몫 0.561 (큰 14.24 / 작은 11.16) 을 가운데 두고 잡았다 */
    twoCuffShareBand: [0.50, 0.65],
    twoSeamBulge   : 0.661, twoSeamBulge2 : 0.404, twoSeamBulge3 : -0.878,
    twoSeamBulgeU  : 1.139, twoSeamBulgeU2: 0.882, twoSeamBulgeU3: -0.398,
    twoSeamT1      : 0.234715, twoSeamT2   : 0.484585, twoSeamT3   : 0.798122,
    twoUndOutIn1   : 1.965, twoUndOutY1   : 36.199,
    twoUndOutIn2   : 1.809, twoUndOutY2   : 45.291,
    twoUndHemIn    : 1.175,    // 작은소매 부리 뒤 모서리 — 뒤 경계에서 **안쪽**
    twoUndHemRise  : 0.300,
    /* 큰소매 부리 앞 모서리 = halfF − 이 값. halfF 는 소매산을 낮추면 커지므로
       이 값을 그대로 두면 밑단까지 같이 벌어져 소매가 안 좁아진다 —
       도면 밑단 몫(큰 14.24 / 작 11.16)에 맞춘 **비율**이다 [원형2 는 halfF − 6.25]. */
    twoFrontHemAt  : 0.465, twoFrontElbowIn: 1.44,
    twoInsetY      : 20.8,
    /* ★ 소매 트임 — **도면 실측**. 도면은 트임 덧단을 조각 **밖에 따로** 그려 두었다
       (큰소매 10.37 × 3.03~3.12 · 작은소매 10.52 × 5.33~5.41).
       원형2 이식판은 9.0 × 2.0/2.174 라 덧단이 좁고 짧았다.
       작은소매 덧단이 큰소매보다 넓은 건 큰소매가 그 위를 덮기 때문이다. */
    ventW          : 5.37, ventWBig : 3.08, ventLen : 10.45, ventMitre : 2.0,
    sleeveLenAdd   : 0,        // 소매길이 가감 (기본 = 호수별 57.23 + 1.0/호수 · 도면값)
    cuffAdd        : 0,        // 소맷부리 둘레 가감
    /* ── 밑단 트임 (벤트) — 교재 밖 · 테일러드 재킷 관례 ─────────────
       뒤중심 트임 하나. 좌우 두 장이 같은 패턴이고, 꿰맬 때 한쪽이 위로 겹친다.
       ★ 트임은 **직선 구간**에 있어야 접힌다 — 뒤중심은 허리 아래가 직선이라
         트임 끝이 허리보다 위로 올라가면 경고를 낸다. */
    /* ★ 기본은 **트임 없음(0)** 이다 — 참고 도면(Barjacke DE36)의 뒤판에는
       뒤중심 덧단이 없다. 뒤판 폭이 도면 20.32 인데 트임을 넣으면 22.25 가 되고,
       화면 대조에서 덧단이 도면 바깥으로 튀어나온다 (2026-08-12 사용자 지적).
       트임이 필요하면 UI 「밑단 트임 길이」에 20 쯤 준다. */
    bodyVentLen  : 0,      // 뒤중심 트임 — 밑단에서 위로 (0 = 트임 없음)
    bodyVentW    : 4.0,    // 덧단 너비
    bodyVentMitre: 2.0,    // 트임 위 미터 사선 — 직각으로 두면 접을 때 부피가 겹친다
    /* ── 안감 (교재 밖 · 테일러드 재킷 관례) ────────────────────────
       ★ 안감 밑단은 겉감보다 **솔기를 따라** `liningHemUp` 만큼 짧다.
         가로선 하나로 자르면 안 된다 — 앞옆판은 가슴다트를 닫느라 11° 돌아 있어
         밑단이 기울어져 있기 때문이다. 변마다 **끝에서 호길이로** 줄인다.
       ★ 뒤 안감 중심에는 **주름분**(킥 플리츠)을 둔다. 없으면 팔을 앞으로 모을 때
         안감이 겉감을 당긴다. */
    liningHemUp  : 2.0,    // 안감 밑단 — 겉감보다 솔기를 따라 짧게
    liningPleat  : 1.5,    // 뒤중심 주름분
    /* ── 안단 (원문 「안단선」 절) ─────────────────────────────────
       앞판 안단 : 어깨쪽 4~5 · 밑단쪽 6~7 · 안단선은 **앞 절개선 위쪽을 지나
       어깨로 올라간다**. 뒤판 안단도 같은 방식. */
    facingSh     : 4.5,    // 앞 안단 — 목옆점에서 어깨선을 따라 (4~5)
    facingHem    : 6.5,    // 앞 안단 — 밑단에서 여밈 끝으로부터 (6~7)
    facingRoll   : 2.5,    // 가슴선 높이에서 **꺾임선 안쪽**으로 — 라펠을 덮어야 한다
    facingBack   : 5.0,    // 뒤 안단 폭 — 뒷목선에서 안쪽으로
    /* ── 주머니 (교재 밖 · Barjacke 도면 실측) ─────────────────────
       ⚠ **위치는 도면에 없다.** 몸판 4장 어디에도 주머니 표시가 없다
         (앞판 = 단추 자리 6개 · 앞옆판 = 가슴다트와 허리선 · 옆판·뒤판 = 너치와 트임선).
         그래서 `pocketFromWL`·`pocketTilt` 는 도면 근거가 없는 **관례값**이다.
       ★ 조각 크기는 도면에 있다 — 플랩·주머니감을 실측해 맞췄다.
         플랩은 다는변 15.71 · 수직 깊이 5.25~5.69 · 넓이 88.69,
         주머니감은 입구 15.84 · 넓이 190.88 (둘 다 모서리가 둥글다).
         엔진 조각은 직사각형이라 **넓이가 같아지도록** 폭·깊이를 잡았다. */
    pocketFromWL : 6.20,   // 주머니 입구 — 허리선에서 아래로  [관례 · 도면에 없음]
    pocketW      : 15.70,  // 입구 너비 = 플랩 다는변           [도면 15.71]
    pocketTilt   : 6.0,    // 앞이 올라가는 기울기(도)          [관례 · 도면에 없음]
    flapH        : 5.70,   // 플랩 깊이                        [도면 5.25~5.69]
    /* 귀 둥글리기 — 도면 원 맞춤 실측. 플랩은 두 귀 반지름이 다르다. */
    flapRoundF   : 1.99,   // 플랩 앞 귀                        [도면 1.99]
    flapRoundB   : 0.73,   // 플랩 뒤 귀                        [도면 0.73]
    pocketBagAdd : 0.15,   // 주머니감 폭 = 입구 + 이 값        [도면 15.84 − 15.71]
    pocketBagH   : 12.36,  // 주머니감 깊이                     [도면 넓이 190.88 기준]
    pocketBagRound: 3.40   // 주머니감 바닥 귀                  [도면 3.49 / 3.27]
  };
  var CAL = {
    backNeck : { a0: 10, k0: 1.60, k1: 0.60 },
    /* 암홀 — 어깨점 → **품선 접점**(수직 접선) → 오목점 → 겨드랑(수평 도착).
       통과점은 자기 구간 안의 **비율**이다 (절대 좌표를 박으면 44호가 겨드랑선
       아래로 파고든다 — 2026-08-12 QA 에서 실제로 그랬다). */
    backArm  : { k0: 1.50, kA: 1.10, kB: 1.50, k1: 2.00, upFx: 0.45, upT: 0.38 },
    frontArm : { k0: 1.20, kA: 1.30, kB: 1.40, k1: 1.60, upFx: 0.45, upT: 0.40 },
    side     : { k0: 0.60, k1: 1.20 },
    princess : { k0: 0.30, kM: 1.00, k1: 0.60 },
    /* ── 2장소매 (원형2 이식) ── */
    sleeveCap: { k0: 1.1487, k1: 1.8359 },
    capBack  : { k0: 1.10, k1: 1.50 },
    capFront : { k0: 1.40, k1: 1.60 },
    twoSeam  : { k0: 0.10, k1: 0.10 },     // 완만한 C자 — 절개점 수직 출발, 앵커 두 점 → 밑단
    twoFront : { k0: 1.00 },
    twoUndOuter: { k0: 0.10, k1: 1.60 },
    twoUnderCap: { k0: 1.00 }
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
    var bSpX = shoulderW / 2 + num(opt.shoulderAdd, K.shoulderAdd) + shExtra;   // [10] 21번 + 패드분
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
    var SNPf  = [SNPf0[0] + num(opt.frontNeckOut, K.frontNeckOut), SNPf0[1]];   // [23] 53번
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
    var fCutAt = (opt.fCutAt === undefined) ? K.fCutAt : opt.fCutAt;
    var fCutShoulder = (fCutAt !== 'armhole');
    var fCutP, fArmLow, fArmUp;
    if (fCutShoulder) {
      /* 도면 구성 — 어깨선 위 `fCutShF` 자리에서 출발한다. 앞판에는 **암홀이 없다** */
      fCutP = V.add(SNPf, V.mul(shDirF, shLenFront * num(opt.fCutShF, K.fCutShF)));
      fArmLow = frontArm; fArmUp = null;
    } else {
      var fCutY = Math.max(p69[1], fArmTan[1] + Math.max(0, num(opt.fCutDrop, 0)));
      var fCut = cutSegsAtY(frontArm, fCutY, false);
      fCutP = fCut.p; fArmLow = fCut.head; fArmUp = fCut.tail;
    }
    var fPrinOut = cutLine(fCutP, [fCx, BP[1]], fPwA, fCross, fPhA);
    var fPrinIn  = cutLine(fCutP, [fCx, BP[1]], fPwB, fCross, fPhB);
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
    /* [40] 75번 — 라펠선이 여밈선과 만나는 자리. 도면은 맨 윗단추보다 위다 */
    var breakPt = [-ov, btnTopY - num(opt.lapelBreakUp, K.lapelBreakUp)];
    var rollOn  = V.add(SNPf, V.mul(V.norm(V.sub(SPf, SNPf)),
                    num(opt.rollIn, K.rollIn)));                     // [41] 76번
    var rollDir = V.norm(V.sub(rollOn, breakPt));                    // 꺾임선 방향(위쪽)
    var rollOut = [rollDir[1], -rollDir[0]];                         // 몸 바깥쪽 법선
    if (rollOut[0] > 0) rollOut = [-rollOut[0], -rollOut[1]];
    /* 고지선 끝(V 바닥) — **앞중심선 위**, 목옆점에서 notchDrop 아래 (도면 규칙) */
    var gorgeEnd = [0, SNPf[1] + num(opt.notchDrop, K.notchDrop)];             // [43] 83번
    /* 라펠 꼭짓점 — 앞중심 **바깥** lapelOut, 목옆점에서 lapelDrop 아래 */
    var lapelPt = [-num(opt.lapelOut, K.lapelOut), SNPf[1] + num(opt.lapelDrop, K.lapelDrop)];
    /* 고지선 — 현에서 아래로 부푼 곡선 (도면 실측 1.20) */
    var gorgeSegs = splineSegs([SNPf,
        chordBulge(SNPf, gorgeEnd, 0.5, -num(opt.gorgeBulge, K.gorgeBulge)), gorgeEnd],
      endTan(V.sub(gorgeEnd, SNPf), 1.0), endTan(V.sub(gorgeEnd, SNPf), 1.0));
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
      fArmLow: fArmLow, fArmUp: fArmUp, fCutP: fCutP, fCutShoulder: fCutShoulder,
      dartTip: dartTip,
      shLenFront: shLenFront,
      fSideTop: wedge.top, fSideBot: wedge.bot,
      wedgeTop: wedge.pTop, wedgeBot: wedge.pBot, wedgeAmt: wedge.amt,
      fHemSideCut: wedge.hem, dartClose: dartClose,
      /* 여밈 · 라펠 */
      overlap: ov, btnTopY: btnTopY, breakPt: breakPt, rollOn: rollOn,
      rollDir: rollDir, rollOut: rollOut, gorgeEnd: gorgeEnd, gorgeSegs: gorgeSegs,
      lapelPt: lapelPt, lapelW: lapelW
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
    var nArmF = g.fCutShoulder
      ? { low: armNotches(g.frontArm, g.Uf, [g.fCx, g.BL + 6], '앞 암홀'), up: [] }
      : armSplitNotches(g.frontArm, g.fArmLow, g.fArmUp, g.Uf, [g.fCx, g.BL + 6], '앞 암홀');

    /* ══ ① 앞패널1 — 앞중심 여밈 · 라펠 · 어깨 · 앞 암홀 위쪽 ═══════════
       ★ 테일러드 앞판에는 **앞목둘레 곡선이 없다** — 고지선이 그 자리다 [43].
         앞중심도 골선이 아니다. 여밈이 앞중심을 overlap 만큼 넘어간다(더블).   */
    var edgeX = -g.overlap;
    var hemEdgeF = [edgeX, g.fHemAt(edgeX)];
    /* ★ 어깨 출발(도면 구성)이면 **앞판에 암홀이 없다** — 어깨선 일부만 갖고
       암홀은 통째로 앞옆판 몫이다. 암홀 출발(교재 [28])이면 예전대로. */
    pieces.push(mk('front', '앞판', [
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPf, g.fCutShoulder ? g.fCutP : g.SPf) }
    ].concat(g.fCutShoulder ? [] : [
      { name: '앞 암홀',  role: 'armhole',  segs: revSegs(g.fArmUp) }
    ], [
      { name: '절개선',   role: 'princess', segs: g.fPrinIn },
      { name: '밑단',     role: 'hem',      segs: lineSegs(g.fPhB, hemEdgeF) },
      { name: '여밈선',   role: 'center',   segs: lineSegs(hemEdgeF, g.breakPt) },
      { name: '라펠선',   role: 'center',   segs: lineSegs(g.breakPt, g.lapelPt) },
      /* 라펠 윗변 — 노치의 위쪽 변. 카라가 아니라 **안단**과 만난다 */
      { name: '라펠 윗변', role: 'center',   segs: lineSegs(g.lapelPt, g.gorgeEnd) },
      /* 고지선 — **카라가 붙는 변**. V 바닥에서 목옆점까지 */
      { name: '고지선',   role: 'neck',     segs: revSegs(g.gorgeSegs) }
    ]), [[edgeX * 0.4, g.BL + 2.0], [edgeX * 0.4, g.hemYf - 4.0]],
      [{ p: cp(g.SNPf), angle: 0,   label: '목옆점' },
       { p: cp(g.gorgeEnd), angle: 0, label: '노치(카라 끝)' },
       { p: cp(g.lapelPt), angle: 0, label: '라펠 꼭짓점' },
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
        })()), 2));   /* 앞중심이 골선이 아니다 — 좌우 한 쌍이라 2매 */

    /* ══ ② 앞패널2 — 앞 암홀 아래쪽 · 옆선 · 가슴다트 ══════════════════ */
    pieces.push(mk('frontSide', '앞옆판',
      (g.fCutShoulder
        ? [{ name: '어깨선',  role: 'shoulder', segs: lineSegs(g.fCutP, g.SPf) },
           { name: '앞 암홀', role: 'armhole',  segs: g.frontArm }]
        : [{ name: '앞 암홀', role: 'armhole',  segs: revSegs(g.fArmLow) }]).concat([
      { name: '옆선 (위)',  role: 'side',     segs: g.fSideTop },
      /* 다트를 접으면 두 다리가 포개진다. 다리 길이가 꼭짓점에서 조금 달라
         남는 만큼을 짧게 이어 준다 — 접었을 때 맞는 연장이다.
         ★ 이 도막은 옆선이 **아니므로** 이름을 따로 준다. 옆선에 넣으면 앞뒤
           옆선 짝을 잴 때 다트 입 길이까지 같이 재어 1.4 어긋난 것처럼 보인다. */
      { name: '가슴다트',   role: 'side',     segs: lineSegs(g.wedgeTop, wedgeBotC) },
      { name: '옆선 (아래)', role: 'side',    segs: fSideBotC },
      { name: '밑단',       role: 'hem',      segs: lineSegs(fHemSideC, fPhAC) },
      { name: '절개선',     role: 'princess', segs: revSegs(fPrinOutC) }
    ]), [[g.fCx + 3.0, g.BL + 2.0], [g.fCx + 3.0, g.hemYf - 4.0]],
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

    /* ══ ④ 뒤패널1 — 뒤중심 · 어깨(다트) · 뒤 암홀 위쪽 · **밑단 트임** ══════
       뒤중심 트임 — 밑단에서 위로 `bodyVentLen`, 덧단 `bodyVentW`.
       좌우 두 장이 같은 패턴이고 꿰맬 때 한쪽이 위로 겹친다.
       ★ 접히는 자리라 **직선 구간**이어야 한다 — 뒤중심은 허리 아래가 직선이다. */
    var bVent = null;
    if (num(opt.bodyVentLen, K.bodyVentLen) > 0.05) {
      var vLen = Math.min(num(opt.bodyVentLen, K.bodyVentLen), g.hemY - g.WLb - 1.0);
      /* 미터 사선은 트임보다 길 수 없다 — 짧은 트임을 넣어도 모양이 깨지지 않게 */
      bVent = ventOf(g.bCenter, [g.bCx, g.hemY], num(opt.bodyVentW, K.bodyVentW),
                     vLen, Math.min(num(opt.bodyVentMitre, K.bodyVentMitre), vLen * 0.5));
      if (num(opt.bodyVentLen, K.bodyVentLen) > g.hemY - g.WLb - 1.0)
        warnings.push('밑단 트임이 허리선을 넘어 ' + r4(num(opt.bodyVentLen, K.bodyVentLen)) +
                      ' → ' + r4(vLen) + ' 로 줄였다 (굽은 구간은 접히지 않는다)');
    }
    var backCenterEdges = bVent
      ? [{ name: '뒤중심',    role: 'center', segs: bVent.seamHead },
         { name: '트임 미터', role: 'center', segs: lineSegs(bVent.mitreOn, bVent.topOut) },
         { name: '트임',      role: 'center', segs: lineSegs(bVent.topOut, bVent.hemOut) },
         { name: '트임 밑단', role: 'hem',    segs: lineSegs(bVent.hemOut, [g.cbIn, g.hemY]) }]
      : [{ name: '뒤중심',    role: 'center', segs: g.bCenter }];
    var shoulderEdges = (g.shDart > 0.01)
      ? [{ name: '어깨선 (밖)', role: 'shoulder', segs: lineSegs(g.SPb, g.shLegOut) },
         { name: '어깨 다트',   role: 'dart',     segs: lineSegs(g.shLegOut, g.shApex, g.shLegIn) },
         { name: '어깨선 (안)', role: 'shoulder', segs: lineSegs(g.shLegIn, g.SNPb) }]
      : [{ name: '어깨선',      role: 'shoulder', segs: lineSegs(g.SPb, g.SNPb) }];
    pieces.push(mk('back', '뒤판', [
      { name: '뒷목둘레', role: 'neck',     segs: g.backNeck }
    ].concat(backCenterEdges, [
      { name: '밑단',     role: 'hem',      segs: lineSegs([g.cbIn, g.hemY], g.bPhB) },
      { name: '절개선',   role: 'princess', segs: revSegs(g.bPrinIn) },
      { name: '뒤 암홀',  role: 'armhole',  segs: g.bArmUp }
    ], shoulderEdges),
      [[3.2, 4.0], [3.2, g.hemY - 4.0]],
      [{ p: cp(g.SNPb), angle: 0, label: '목옆점' },
       { p: cp(g.bCutP), angle: 180, label: '절개 시작' }]
        .concat(bVent ? [{ p: cp(bVent.mitreOn), angle: 0, label: '트임 끝' }] : [])
        .concat(nArmB.up).concat(nBack.a),
      [L('blB',  'dashed', [[0.5, g.BL], [g.bCx - 0.5, g.BL]], '가슴선'),
       L('wlB',  'dashed', [[g.cbIn + 0.3, g.WLb], [g.bCx - 0.5, g.WLb]], '허리선'),
       L('hipB', 'dashed', [[g.cbIn + 0.3, g.hipY], [g.bCx - 0.5, g.hipY]], '엉덩이선')]
        .concat(bVent ? [
          L('ventFold', 'dashed', subsamp(bVent.fold), '트임 접음선'),
          L('ventTop',  'dashed', [cp(bVent.top), cp(bVent.topOut)], '트임 위 접음선')] : [])
        .concat(g.shDart > 0.01
          ? [L('shDart', 'dashed', [cp(g.shLegOut), cp(g.shApex), cp(g.shLegIn)], '어깨 다트')]
          : [])));

    /* ══ ⑤ 카라 [42]~[46] ═══════════════════════════════════════════
       ★ 테일러 카라는 **옆목점에서 0.5 나가서** 뒷목선을 그린다 [42] 78번.
         78~79 = 뒷목치수 · 79~80 = 카라넓이. 위카라(80번)가 꺾임선(77번) 안으로
         들어가면 안 된다 — 들어가면 카라가 목에서 뜬다.
       조각으로 뽑을 때는 목붙임선(= 뒷목 + 옆목~고지 + 고지선)을 그대로 두고
       바깥선만 slash & spread 로 벌린다. 「접어서 확인」은 검산기가 대신한다.

       ★ 목붙임선을 **굽히는 방향**이 카라의 성격을 정한다.
         굽은 안쪽(회전 중심)이 목 쪽이면 → 바깥으로 밀 때 반지름이 커져 **길어진다**
         = 눕는 카라. 반대면 바깥선이 짧아져 목을 조이는 **선 카라**가 된다.
         테일러 카라는 꺾여 내려오므로 반드시 앞쪽이다. */
    /* 카라 목붙임선 = 뒷목 + **고지선**. 라펠 윗변은 카라가 아니라 안단과 만난다. */
    var collarNeckLen = sLen(g.backNeck) + sLen(g.gorgeSegs), collarOuterLen = 0;
    (function () {
      var Hc = num(opt.collarW, K.collarW);
      var st = Math.min(Hc - 1.0, num(opt.collarStand, K.collarStand));
      var Lc = collarNeckLen;
      /* ★ 목붙임선은 **몸판 목둘레를 펴서** 만든다 — 테일러드 카라의 정석이다.
         카라를 따로 그리는 게 아니라, 꺾임선을 축으로 몸판 위에 그린 뒤 떼어낸다
         [42]~[46]. 그 결과가 곧 「목둘레 곡선을 스프링만큼만 남기고 편 선」이다.

         구현: 뒷목둘레 + 고지선을 **한 줄기**로 이어 (호길이, 방향변화) 수열로 바꾸고,
         방향변화만 `collarSpring` 배로 줄여 다시 적분한다. 길이는 손대지 않으므로
         목둘레와 **정확히** 같고, 휨 분포는 목선을 그대로 물려받는다 —
         뒷목 쪽은 굽고 고지선 쪽은 곧은, 실제 카라 모양이 된다.

         ⚠ 예전 판은 **길이만 맞춘 원호**였다. 그래서 라펠·꺾임선·고지선을 아무리
           바꿔도 카라가 꿈쩍하지 않았다(늘림 0.2653 고정). 지금은 목선이 바뀌면
           카라가 따라온다.

         `collarSpring` = 몸판 목둘레의 휨을 얼마나 남기는가.
           0 = 완전히 편 곧은 띠(선 카라) · 1 = 목둘레 그대로(피터팬처럼 눕는다). */
      var spring = Math.max(0, Math.min(1, num(opt.collarSpring, K.collarSpring)));
      /* 목둘레 한 줄기 — 뒤중심 → 목옆점(뒷목둘레를 뒤집어) → 노치(고지선).
         두 조각이 좌우 반대 좌표계라 고지선의 회전 부호를 뒤집어 이어 붙인다. */
      function turnSeq(pts, sgn) {
        var out = [];
        for (var i = 1; i < pts.length; i++) {
          var dphi = 0;
          if (i > 1) {
            var a = V.sub(pts[i - 1], pts[i - 2]), b = V.sub(pts[i], pts[i - 1]);
            dphi = sgn * Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
          }
          out.push([V.dist(pts[i - 1], pts[i]), dphi]);
        }
        return out;
      }
      /* 부호 — 목둘레를 뒤집어 훑으면 회전이 음수로 나온다. 그대로 쓰면 카라가
         목 쪽으로 굽어 **바깥선이 짧아진다**(= 목을 조이는 선 카라). 바깥선이
         길어지는 쪽으로 두 도막을 맞춘다. */
      var seq = turnSeq(sampleSegs(g.backNeck, 0.05).slice().reverse(), -1)
        .concat(turnSeq(sampleSegs(g.gorgeSegs, 0.05), 1));
      var np = [[0, Hc]], ang = 0, cx = 0, cy = Hc, thTot = 0;
      seq.forEach(function (s) {
        ang += s[1] * spring; thTot += s[1] * spring;
        cx += s[0] * Math.cos(ang); cy += s[0] * Math.sin(ang);
        np.push([cx, cy]);
      });
      var th = thTot;
      /** 목붙임선을 **바깥(위) 법선**으로 dd 만큼 민다. 굽은 선을 밀면 길어진다. */
      function push(pts, dd) {
        return pts.map(function (q, i) {
          var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
          var t = V.norm(V.sub(b, a));
          return [q[0] + t[1] * dd, q[1] - t[0] * dd];
        });
      }
      var outer = push(np, Hc), stand = push(np, st);
      for (var oi = 1; oi < outer.length; oi++) collarOuterLen += V.dist(outer[oi - 1], outer[oi]);
      /* 뒷목 끝 — 어깨선에 맞추는 자리. 목붙임선을 뒷목치수만큼 잰 곳 */
      var bnLen = sLen(g.backNeck), acc = 0, shPt = np[np.length - 1];
      for (var i = 1; i < np.length; i++) {
        acc += V.dist(np[i - 1], np[i]);
        if (acc >= bnLen) { shPt = np[i]; break; }
      }
      /* 식서 — 굽은 조각이라 고정 좌표로 두면 밖으로 나간다. 10% 자리에서
         목붙임선↔바깥선을 잇는 선분 위에 놓는다. */
      var gi = Math.round(np.length * 0.10), gA = np[gi], gB = outer[gi];
      function gLerp(u) { return [gA[0] + (gB[0] - gA[0]) * u, gA[1] + (gB[1] - gA[1]) * u]; }
      pieces.push(mk('collar', '카라', [
        { name: '뒤중심',    role: 'fold', segs: lineSegs(np[0], outer[0]) },
        { name: '카라 윗선', role: 'neck', segs: lineSegs.apply(null, outer) },
        { name: '카라 끝',   role: 'neck', segs: lineSegs(outer[outer.length - 1], np[np.length - 1]) },
        { name: '목붙임선',  role: 'neck', segs: lineSegs.apply(null, np.slice().reverse()) }
      ], [gLerp(0.10), gLerp(0.85)],
        [{ p: cp(np[0]), angle: 270, label: '뒤중심' },
         { p: cp(shPt), angle: 270, label: '뒷목 끝(어깨)' }],
        [L('stand', 'dashed', stand.filter(function (q, i) { return i % 8 === 0 || i === stand.length - 1; }),
           '스탠드 꺾임선')], 1));
    })();

    /* ══ ⑥ 주머니 플랩 · 주머니감 ═════════════════════════════════════ */
    (function () {
      /* 귀 둥글리기 — 중심 (cx,cy) 반지름 r 인 사분원. 각도는 라디안.
         점 간격 0.04 로 뽑는다 (suite-verify 의 0.015~0.06 규칙 안). */
      function corner(cx, cy, r, a0, a1) {
        var n = Math.max(6, Math.ceil(Math.abs(a1 - a0) * r / 0.04)), p = [];
        for (var i = 0; i <= n; i++) {
          var t = a0 + (a1 - a0) * i / n;
          p.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
        }
        return p;
      }
      var HALF = Math.PI / 2;
      var w = num(opt.pocketW, K.pocketW), h = num(opt.flapH, K.flapH);
      /* ★ 도면 플랩은 **아랫변(자유변) 두 귀만** 둥글다 — 실측 반지름 1.99 와 0.73.
         다는변(윗선) 쪽 두 귀는 각져 있다. 두 반지름이 다른데 도면에 앞뒤 표시가
         없어, 기울기가 「앞이 올라간다」인 것에 맞춰 **큰 쪽을 앞(x=0)** 으로 둔다. */
      var rF = Math.min(num(opt.flapRoundF, K.flapRoundF), w / 2, h);
      var rB = Math.min(num(opt.flapRoundB, K.flapRoundB), w / 2, h);
      pieces.push(mk('flap', '주머니 플랩', [
        { name: '윗선',      role: 'princess', segs: lineSegs([0, 0], [w, 0]) },
        { name: '옆선',      role: 'side',     segs: lineSegs([w, 0], [w, h - rB]) },
        { name: '뒤 귀',     role: 'hem',      segs: lineSegs.apply(null, corner(w - rB, h - rB, rB, 0, HALF)) },
        { name: '아랫선',    role: 'hem',      segs: lineSegs([w - rB, h], [rF, h]) },
        { name: '앞 귀',     role: 'hem',      segs: lineSegs.apply(null, corner(rF, h - rF, rF, HALF, Math.PI)) },
        { name: '옆선 (앞)', role: 'side',     segs: lineSegs([0, h - rF], [0, 0]) }
      ], [[w * 0.5, h * 0.2], [w * 0.5, h * 0.8]],
        [{ p: [w / 2, 0], angle: 90, label: '중심' }],
        [L('fold', 'dashed', [[0, h * 0.5], [w, h * 0.5]], '접음선')]));
      var pw = w + num(opt.pocketBagAdd, K.pocketBagAdd), ph = num(opt.pocketBagH, K.pocketBagH);
      /* 주머니감도 **바닥 두 귀가 둥글다** — 도면 실측 3.49 / 3.27, 평균으로 둔다.
         모서리가 각지면 안감이 뭉쳐 주머니 바닥에 각이 선다. */
      var rP = Math.min(num(opt.pocketBagRound, K.pocketBagRound), pw / 2, ph / 2);
      pieces.push(mk('pocketBag', '주머니감', [
        { name: '입구',      role: 'princess', segs: lineSegs([0, 0], [pw, 0]) },
        { name: '옆선',      role: 'side',     segs: lineSegs([pw, 0], [pw, ph - rP]) },
        { name: '뒤 귀',     role: 'hem',      segs: lineSegs.apply(null, corner(pw - rP, ph - rP, rP, 0, HALF)) },
        { name: '아랫선',    role: 'hem',      segs: lineSegs([pw - rP, ph], [rP, ph]) },
        { name: '앞 귀',     role: 'hem',      segs: lineSegs.apply(null, corner(rP, ph - rP, rP, HALF, Math.PI)) },
        { name: '옆선 (앞)', role: 'side',     segs: lineSegs([0, ph - rP], [0, 0]) }
      ], [[pw * 0.5, ph * 0.2], [pw * 0.5, ph * 0.8]],
        [{ p: [pw / 2, 0], angle: 90, label: '중심' }],
        [L('mid', 'dashed', [[0, ph * 0.5], [pw, ph * 0.5]], '접음선')]));
    })();

    /* ══ ⑦ 안단 — 앞 안단 · 뒤 안단 (원문 「안단선」 절) ═══════════════
       ★ 안단은 **몸판에서 떠낸 조각**이다. 바깥 변(고지선·라펠·여밈선·밑단 일부)은
         앞판과 **같은 선**을 써야 겹쳐 놓았을 때 어긋나지 않는다.
       ★ 안단선은 라펠을 **덮어야** 한다 — 가슴선 높이에서 꺾임선보다 안쪽으로
         `facingRoll` 만큼 들어간 자리를 지난다. 안 그러면 뒤집었을 때 겉감이 보인다. */
    var facingWarn = [], fcLineG = null, fcAG = null;
    if (num(opt.includeFacing, 1)) {
      var fSh = num(opt.facingSh, K.facingSh), fHm = num(opt.facingHem, K.facingHem);
      var shU2 = V.norm(V.sub(g.SPf, g.SNPf));
      var fcA = V.add(g.SNPf, V.mul(shU2, fSh));                 // 어깨선 위 안단 끝
      var fcH = [edgeX + fHm, g.fHemAt(edgeX + fHm)];            // 밑단 위 안단 끝
      /* ★ 가운데 통과점은 **꺾임선의 중간**에서 몸 안쪽으로 `facingRoll` 들어간 자리다.
         예전에는 「가슴선 높이의 꺾임선 x」로 잡았는데, 꺾임 시작을 도면대로 위로
         올리자 가슴선이 꺾임선 **아래**가 되어 그 x 가 곡선 밖으로 나갔다
         (안단선이 앞판을 벗어난다는 경고가 떴다). 꺾임선 위의 점이라야 늘 안전하다. */
      var rollMid = _lerp(g.breakPt, g.rollOn, 0.5);
      var inward = [-g.rollOut[0], -g.rollOut[1]];
      var fcM = V.add(rollMid, V.mul(inward, num(opt.facingRoll, K.facingRoll)));
      var fcLine = splineSegs([fcH, fcM, fcA],
        endTan([0, -1], 1.0), endTan(V.sub(fcA, fcM), 1.0));
      fcLineG = fcLine; fcAG = fcA;
      /* ★ 안단은 **라펠을 덮어야** 한다 — 꺾임선보다 몸 안쪽에 있어야 뒤집었을 때
         라펠 겉면이 안단이 된다. 밖으로 나가면 라펠 안쪽이 겉감이라 못 쓴다.
         주석에는 늘 적혀 있었지만 **재는 곳이 없었다** — `facingRoll` 을 0 이나
         음수로 놓아도 아무 경고가 안 떴다. 꺾임선 구간에서 가장 얕은 자리를 잰다. */
      (function () {
        var rA = g.breakPt, rB = g.rollOn;
        var rl = V.dist(rA, rB); if (rl < 1e-6) return;
        var n = V.norm(V.sub(rB, rA)), worst = Infinity;
        sampleSegs(fcLine, 0.3).forEach(function (q) {
          var t = (q[0] - rA[0]) * n[0] + (q[1] - rA[1]) * n[1];
          if (t < 0 || t > rl) return;                       // 꺾임선이 있는 높이만 본다
          var fx = rA[0] + n[0] * t, fy = rA[1] + n[1] * t;
          var dd = (q[0] - fx) * inward[0] + (q[1] - fy) * inward[1];
          if (dd < worst) worst = dd;
        });
        if (worst < 0.5)
          facingWarn.push('안단선이 꺾임선보다 ' + r4(worst) + ' 밖에 안 들어간다 — 라펠 안쪽이 겉감이 된다 (0.5 이상이라야 한다)');
      })();
      /* 안단선이 앞판 **안**에 있어야 한다 — 절개선을 넘어가면 안단이 조각 밖으로 나간다 */
      (function () {
        var fp = pieces.filter(function (x) { return x.id === 'front'; })[0];
        var sp = sampleSegs(fcLine, 0.5);
        for (var i = 1; i < sp.length - 1; i++)
          if (!ptInPoly(sp[i], fp.outline)) { facingWarn.push('앞 안단선이 앞판 밖으로 나간다'); return; }
      })();
      pieces.push(mk('frontFacing', '앞 안단', [
        { name: '어깨선',    role: 'shoulder', segs: lineSegs(fcA, g.SNPf) },
        { name: '고지선',    role: 'neck',     segs: g.gorgeSegs },
        { name: '라펠 윗변', role: 'center',   segs: lineSegs(g.gorgeEnd, g.lapelPt) },
        { name: '라펠선',    role: 'center',   segs: lineSegs(g.lapelPt, g.breakPt) },
        { name: '여밈선',    role: 'center',   segs: lineSegs(g.breakPt, hemEdgeF) },
        { name: '밑단',      role: 'hem',      segs: lineSegs(hemEdgeF, fcH) },
        { name: '안단선',    role: 'side',     segs: fcLine }
      ], [[edgeX * 0.3, g.BL + 2.0], [edgeX * 0.3, g.hemYf - 6.0]],
        [{ p: cp(g.SNPf), angle: 0, label: '목옆점' },
         { p: cp(g.gorgeEnd), angle: 0, label: '노치(카라 끝)' },
         { p: cp(g.lapelPt), angle: 0, label: '라펠 꼭짓점' },
         { p: cp(g.breakPt), angle: 0, label: '꺾임점' }],
        [L('roll', 'dashed', [cp(g.breakPt), cp(g.rollOn)], '꺾임선'),
         L('cf', 'dashed', [[0, g.SNPf[1] + 1.0], [0, g.fHemAt(0)]], '앞중심')], 2));

      /* 뒤 안단 — 뒷목선을 안쪽으로 facingBack 민 띠 */
      var fBk = num(opt.facingBack, K.facingBack);
      var shUb2 = V.norm(V.sub(g.SPb, g.SNPb));
      var fbA = V.add(g.SNPb, V.mul(shUb2, fSh));                // 어깨선 위 안단 끝
      var bnPts = sampleSegs(g.backNeck, 0.05);
      var bnMid = bnPts[Math.floor(bnPts.length / 2)];
      var fbM = [bnMid[0], bnMid[1] + fBk];                      // 뒷목선 중간을 안쪽으로
      var fbCy = g.BNP[1] + fBk;
      var cbPts = sampleSegs(g.bCenter, 0.05).filter(function (q) { return q[1] <= fbCy; });
      var fbC = cbPts.length > 1 ? cbPts[cbPts.length - 1] : [0, fbCy];
      pieces.push(mk('backFacing', '뒤 안단', [
        { name: '뒷목둘레', role: 'neck',     segs: g.backNeck },
        { name: '뒤중심',   role: 'center',   segs: lineSegs.apply(null, cbPts) },
        { name: '안단선',   role: 'side',     segs: splineSegs([fbC, fbM, fbA],
                              endTan([1, 0], 1.0), endTan(V.sub(fbA, fbM), 1.0)) },
        { name: '어깨선',   role: 'shoulder', segs: lineSegs(fbA, g.SNPb) }
      ], [[g.SNPb[0] * 0.35, g.BNP[1] + 0.6], [g.SNPb[0] * 0.35, fbCy - 0.6]],
        [{ p: cp(g.SNPb), angle: 0, label: '목옆점' },
         { p: cp(g.BNP), angle: 0, label: '뒤중심' }],
        [L('fw', 'dashed', [cp(fbA), cp(fbM)], '안단 폭 ' + f1(fBk))], 2));
    }

    /* ══ ⑧ 2장소매 ═══════════════════════════════════════════════════
       ★ 소매는 **우리 암홀 길이**로 제도한다 — 소매산 대각선이 곧 암홀 길이다.
         재킷 암홀이 계산식으로 나오므로 소매도 전 호수가 따라온다.
       소매길이·부리는 호수별 기본값에 가감만 준다 (그레이딩을 덮어쓰지 않는다). */
    var sleeve = null;
    if (num(opt.includeSleeve, 1)) {
      var sOpt = {}, kk;
      for (kk in opt) if (opt.hasOwnProperty(kk)) sOpt[kk] = opt[kk];
      var stp = (num(opt.B, m.B) - BASE.B) / GRADE.B;
      var la = num(opt.sleeveLenAdd, K.sleeveLenAdd), ca = num(opt.cuffAdd, K.cuffAdd);
      if (sOpt.sleeveLen === undefined && la)
        sOpt.sleeveLen = SLEEVE_TYPE.two.len + SLEEVE_TYPE.two.lenGrade * stp + la;
      if (sOpt.cuffW === undefined && ca)
        sOpt.cuffW = SLEEVE_TYPE.two.cuff + SLEEVE_TYPE.two.cuffGrade * stp + ca;
      sleeve = twoSleeveGeom(m, sOpt, sLen(g.backArm), sLen(g.frontArm));
      pieces.push.apply(pieces, twoSleevePieces(sleeve, seam));
    }

    /* ══ ⑨ 안감 — 앞판 · 앞옆판 · 뒤옆판 · 뒤판 · 큰소매 · 작은소매 ═══════
       겉감 조각에서 **솔기를 따라 밑단을 올려** 만든다. 앞판 안감은 안단 자리를
       뺀 나머지이고, 뒤판 안감은 뒤중심에 주름분을 더한다.
       ⚠ 트임은 안감에 없다 — 안감은 트임 위까지만 내려오고 그 아래는 겉감이 받는다. */
    if (num(opt.includeLining, 1)) (function () {
      var lift = num(opt.liningHemUp, K.liningHemUp);
      var pleat = num(opt.liningPleat, K.liningPleat);
      /** 변의 **끝에서** L 만큼 줄인다 (밑단이 기울어 있어도 정확하다) */
      function cutEnd(segs, L) {
        var r = splitSegsAtLenFromEnd(segs, L);
        return (r.head && r.head.length) ? r.head : segs;
      }
      function cutStart(segs, L) { return revSegs(cutEnd(revSegs(segs), L)); }
      function endOf(segs) { return cp(segs[segs.length - 1].p1); }
      function startOf(segs) { return cp(segs[0].p0); }
      /** 겉감 너치를 그대로 쓰되 **복사**한다 — fixNotches 가 좌표를 고쳐 쓰기 때문에
          원본을 넘기면 겉감 조각의 너치까지 같이 움직인다. */
      function nc(list) {
        return (list || []).map(function (n) { return { p: cp(n.p), angle: n.angle, label: n.label }; });
      }

      /* ① 앞판 안감 — 안단 자리를 뺀 나머지 */
      if (fcLineG) {
        var lFPrin = cutEnd(g.fPrinIn, lift);
        var lFFace = revSegs(cutEnd(revSegs(fcLineG), lift));   // (밑단 위) → 안단 어깨 끝
        pieces.push(mk('frontLining', '앞판 안감', [
          { name: '어깨선',  role: 'shoulder', segs: lineSegs(fcAG, g.fCutShoulder ? g.fCutP : g.SPf) }
        ].concat(g.fCutShoulder ? [] : [
          { name: '앞 암홀', role: 'armhole',  segs: revSegs(g.fArmUp) }
        ], [
          { name: '절개선',  role: 'princess', segs: lFPrin },
          { name: '밑단',    role: 'hem',      segs: lineSegs(endOf(lFPrin), startOf(lFFace)) },
          { name: '안단선',  role: 'side',     segs: lFFace }
        ]), [[g.fCx - 5.0, g.BL + 2.0], [g.fCx - 5.0, g.hemYf - 8.0]],
          [{ p: cp(g.fCutP), angle: 180, label: '절개 시작' },
           { p: cp(fcAG), angle: 180, label: '안단 끝' }].concat(nc(nFront.a)),
          [L('wlFL', 'dashed', [[startOf(lFFace)[0] + 1.0, g.WLf], [g.fCx, g.WLf]], '허리선'),
           L('hemFL', 'dashed', [[startOf(lFFace)[0] + 1.0, g.fHemAt(0) - lift],
                                 [g.fCx, g.fHemAt(g.fCx) - lift]], '안감 밑단')], 2));
      }
      /* ② 앞옆판 안감 */
      var lFSide = cutEnd(fSideBotC, lift), lFPrinO = cutEnd(fPrinOutC, lift);
      pieces.push(mk('frontSideLining', '앞옆판 안감',
        (g.fCutShoulder
          ? [{ name: '어깨선',  role: 'shoulder', segs: lineSegs(g.fCutP, g.SPf) },
             { name: '앞 암홀', role: 'armhole',  segs: g.frontArm }]
          : [{ name: '앞 암홀', role: 'armhole',  segs: revSegs(g.fArmLow) }]).concat([
        { name: '옆선 (위)', role: 'side',     segs: g.fSideTop },
        { name: '가슴다트',  role: 'side',     segs: lineSegs(g.wedgeTop, wedgeBotC) },
        { name: '옆선 (아래)', role: 'side',   segs: lFSide },
        { name: '밑단',      role: 'hem',      segs: lineSegs(endOf(lFSide), endOf(lFPrinO)) },
        { name: '절개선',    role: 'princess', segs: revSegs(lFPrinO) }
      ]), [[g.fCx + 3.0, g.BL + 2.0], [g.fCx + 3.0, g.hemYf - 8.0]],
        [{ p: cp(g.Uf), angle: 180, label: '겨드랑' }]
          .concat(nc(nArmF.low)).concat(nc(nFront.b)).concat(nc(nSide.b)),
        [L('bustL', 'dashed', [cp(g.wedgeTop), cp(g.dartTip)], '가슴다트 접음선')], 2));
      /* ③ 뒤옆판 안감 */
      var lBSide = cutEnd(g.backSide, lift), lBPrinO = cutEnd(g.bPrinOut, lift);
      pieces.push(mk('backSideLining', '뒤옆판 안감', [
        { name: '뒤 암홀', role: 'armhole',  segs: revSegs(g.bArmLow) },
        { name: '옆선',    role: 'side',     segs: lBSide },
        { name: '밑단',    role: 'hem',      segs: lineSegs(endOf(lBSide), endOf(lBPrinO)) },
        { name: '절개선',  role: 'princess', segs: revSegs(lBPrinO) }
      ], [[g.bCx + 3.0, g.BL + 2.0], [g.bCx + 3.0, g.hemY - 8.0]],
        [{ p: cp(g.Ub), angle: 180, label: '겨드랑' }]
          .concat(nc(nArmB.low)).concat(nc(nBack.b)).concat(nc(nSide.a)),
        [L('blBSL', 'dashed', [[g.bCx + 0.5, g.BL], [g.Ub[0], g.BL]], '가슴선'),
         L('wlBSL', 'dashed', [[g.bCx + 0.5, g.WLb], [g.bWaistSide[0], g.WLb]], '허리선')], 2));
      /* ④ 뒤판 안감 — 뒤중심에 **주름분**. 트임은 없다 */
      var shift = function (q) { return [q[0] - pleat, q[1]]; };
      var lBCen = cutEnd(mapSegs(g.bCenter, shift), lift);
      var lBPrinI = cutEnd(g.bPrinIn, lift);
      pieces.push(mk('backLining', '뒤판 안감', [
        { name: '뒷목둘레', role: 'neck',     segs: g.backNeck },
        { name: '주름분',   role: 'center',   segs: lineSegs(g.BNP, shift(g.BNP)) },
        { name: '뒤중심',   role: 'center',   segs: lBCen },
        { name: '밑단',     role: 'hem',      segs: lineSegs(endOf(lBCen), endOf(lBPrinI)) },
        { name: '절개선',   role: 'princess', segs: revSegs(lBPrinI) },
        { name: '뒤 암홀',  role: 'armhole',  segs: g.bArmUp },
        { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SPb, g.SNPb) }
      ], [[g.bCx - 4.0, 6.0], [g.bCx - 4.0, g.hemY - 8.0]],
        [{ p: cp(g.SNPb), angle: 0, label: '목옆점' },
         { p: cp(g.bCutP), angle: 180, label: '절개 시작' },
         { p: cp(g.BNP), angle: 0, label: '주름분' }]
          .concat(nc(nArmB.up)).concat(nc(nBack.a)),
        [L('pleat', 'dashed', [cp(shift(g.BNP)), [shift(g.BNP)[0], g.hemY - lift]], '주름 접음선'),
         L('wlBL', 'dashed', [[shift([g.cbIn, 0])[0] + 0.3, g.WLb], [g.bCx - 0.5, g.WLb]], '허리선')], 2));
      /* ⑤⑥ 소매 안감 — 트임 없이 밑단만 올린다 */
      if (sleeve) {
        var sv = sleeve;
        var poly2 = function (pts) { return lineSegs.apply(null, pts); };
        var lBigFront = cutEnd(sv.bigFront, lift), lBigBack = cutEnd(sv.bigBack, lift);
        pieces.push(mk('sleeveBigLining', '큰소매 안감', [
          { name: '앞 소매산', role: 'armhole',   segs: poly2(sv.capBigFront) },
          { name: '앞 밑선',   role: 'side',      segs: lBigFront },
          { name: '밑단',      role: 'sleeveHem', segs: lineSegs(endOf(lBigFront), endOf(lBigBack)) },
          { name: '뒤 절개선', role: 'side',      segs: revSegs(lBigBack) },
          { name: '뒤 소매산', role: 'armhole',   segs: poly2(sv.capBigBack) }
        ], [[sv.apexShift, 2.0], [sv.apexShift, sv.sleeveLen - 6.0]],
          [{ p: cp(sv.splitP), angle: 0, label: '절개 시작' },
           { p: cp(sv.apex), angle: 90, label: '소매산 정점' }],
          [L('elbowL', 'dashed', [[sv.bigHemB[0] - 0.5, sv.elbowY], [sv.frontInX + 0.5, sv.elbowY]], '팔꿈치선')], 2));
        var lUndOut = cutEnd(sv.undOuter, lift), lUndBack = cutEnd(sv.undBack, lift);
        pieces.push(mk('sleeveUnderLining', '작은소매 안감', [
          { name: '뒤 소매산',  role: 'armhole',   segs: poly2(sv.capUnderBack) },
          { name: '절개선',     role: 'side',      segs: lUndBack },
          { name: '밑단',       role: 'sleeveHem', segs: lineSegs(endOf(lUndBack), endOf(lUndOut)) },
          { name: '바깥 뒤선',  role: 'side',      segs: revSegs(lUndOut) },
          { name: '소매통 연결', role: 'armhole',  segs: sv.undCapOut }
        ], [[sv.backOutX + 2, 15], [sv.backOutX + 2, sv.sleeveLen - 6.0]],
          [{ p: cp(sv.splitU), angle: 180, label: '절개 시작' },
           { p: cp(sv.pBB), angle: 270, label: '뒤 합인' }],
          [L('elbowUL', 'dashed', [[sv.backOutX - 0.5, sv.elbowY], [sv.undHemF[0] + 0.5, sv.elbowY]], '팔꿈치선')], 2));
      }
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
    /* [23] 52번 확인 — 앞 어깨점이 「어깨너비/2 + 어깨 늘림(패드분)」 자리에 오는가.
       ⚠ 패드분을 빼고 재면 재킷에서는 늘 어긋난 것처럼 보인다 (77·88호가 그랬다). */
    var spTarget = num(opt.shoulderW, m.shoulderW) / 2 + num(opt.shoulderAdd, K.shoulderAdd);
    if (Math.abs(g.SPf[0] - spTarget) > 1.5)
      warnings.push('앞 어깨점 x ' + r4(g.SPf[0]) + ' — 어깨너비/2 + 패드분 ' +
                    r4(spTarget) + ' 와 어긋난다 [23] 52번');
    /* [16] 뒤 절개는 26번 위로 · [28] 앞 절개는 69번 위로 올라가면 안 된다 */
    if (g.bCutP[1] < g.bArmTan[1] - 0.05)
      warnings.push('뒤 절개 시작이 26번보다 위다 [16]');
    if (!g.fCutShoulder && g.fCutP[1] < g.p69[1] - 0.05)
      warnings.push('앞 절개 시작이 69번보다 위다 [28]');
    /* [40] 75번은 W 선 위로 2.5 이상 — 그보다 낮으면 배꼽이 보인다 */
    if (g.WLf - g.btnTopY < 2.5)
      warnings.push('꺾임 시작(75번)이 허리에서 ' + r4(g.WLf - g.btnTopY) + ' 위 — 2.5 이상이라야 한다 [40]');
    facingWarn.forEach(function (w) { warnings.push(w); });
    /* 소매 — 소매산 이세는 앞뒤 **각각** 봐야 한다. 총합만 보면 배분이 틀려도 안 드러난다
       (앞 이세가 음수인데 총 이세는 넉넉해 통과한 적이 있다 — 원형2 QA). */
    if (sleeve) {
      if (sleeve.capEaseFront < 0.2 || sleeve.capEaseFront > 3.5)
        warnings.push('앞 소매산 이세 ' + r4(sleeve.capEaseFront) + ' (0.2~3.5 이라야 한다)');
      if (sleeve.capEaseBack < 0.2 || sleeve.capEaseBack > 4.0)
        warnings.push('뒤 소매산 이세 ' + r4(sleeve.capEaseBack) + ' (0.2~4.0 이라야 한다)');
      if (Math.abs(sleeve.seamLenBig - sleeve.seamLenUnder) > 0.15)
        warnings.push('소매 절개선 짝 ' + r4(sleeve.seamLenBig) + ' ↔ ' + r4(sleeve.seamLenUnder));
    }
    /* [42] 위카라가 꺾임선 안으로 들어가면 안 된다 = 카라넓이 > 스탠드 */
    if (num(opt.collarW, K.collarW) - num(opt.collarStand, K.collarStand) < 1.0)
      warnings.push('카라넓이 − 스탠드 가 1.0 미만 — 위카라가 꺾임선 안으로 들어간다 [42]');
    /* ★ 눕는 카라는 바깥선이 목붙임선보다 짧으면 안 된다 — 짧으면 목을 조인다.
       예전 판이 목붙임선을 반대로 굽혀 바깥선이 2.1 **짧았다**. 그 사고를 막는다.
       (도면의 늘림은 +0.24 로 작다 — 바이어스 언더칼라라서다. 하한만 건다.) */
    if (collarOuterLen > 0 && collarOuterLen < collarNeckLen)
      warnings.push('카라 바깥선 ' + r4(collarOuterLen) + ' 이 목붙임선 ' + r4(collarNeckLen) +
                    ' 보다 짧다 — 카라가 눕지 못하고 목을 조인다');

    /* ★ 제도선은 **조각 안에 들어오는 구간만** 남긴다 (2026-08-15 · 조끼→원피스에서 이식).
       조각 밖 허공에 뜬 기준선은 화면에서 바로 눈에 띈다.
       ⚠ 자르는 것은 **기준선 계열(dashed·line·thin)** 뿐이다 — edge(다트·주름)와
         point(BP 표시)를 자르면 뜻이 깨진다(조끼에서 폭 1.5 다트가 0.199 로 잘렸다).
       ⚠ 선을 잘게 나눠 판정한다 — 점 2개짜리 기준선은 통째로 사라진다.
       ⚠ 경계 위의 점(어깨선 위 다트 다리 등)은 안쪽으로 친다. */
    pieces.forEach(function (pc) {
      var kept = [];
      (pc.internal || []).forEach(function (it) {
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
        neckFront: r4(sLen(g.gorgeSegs) + V.dist(g.gorgeEnd, g.lapelPt) +
                      V.dist(g.lapelPt, g.breakPt)),
        neckTotal: r4(collarNeckLen),
        /* 카라 — 바깥선이 목붙임선보다 **길어야** 눕는다 */
        collarNeck: r4(collarNeckLen), collarOuter: r4(collarOuterLen),
        collarSpread: r4(collarOuterLen - collarNeckLen),
        armholeBack: r4(sLen(g.backArm)), armholeFront: r4(sLen(g.frontArm)),
        armholeTotal: r4(sLen(g.backArm) + sLen(g.frontArm)),
        sideBack: r4(sideBack), sideFront: r4(sideFront),
        bustDart: r4(g.wedgeAmt),
        backWaistDart: r4(g.bDart), frontWaistDart: r4(g.fDart),
        princessBackIn: r4(sLen(g.bPrinIn)), princessBackOut: r4(sLen(g.bPrinOut)),
        princessFrontIn: r4(sLen(g.fPrinIn)), princessFrontOut: r4(sLen(g.fPrinOut)),
        lapelW: r4(g.lapelW), collarW: r4(num(opt.collarW, K.collarW)),
        sleeveLen: sleeve ? r4(sleeve.sleeveLen) : null,
        cuffWidth: sleeve ? r4(sleeve.cuffW) : null,
        sleeveCapTotal: sleeve ? r4(sleeve.capLenTotal) : null,
        capEase: sleeve ? r4(sleeve.capEase) : null,
        capEaseFront: sleeve ? r4(sleeve.capEaseFront) : null,
        capEaseBack: sleeve ? r4(sleeve.capEaseBack) : null,
        sleeveSeamBig: sleeve ? r4(sleeve.seamLenBig) : null,
        sleeveSeamUnder: sleeve ? r4(sleeve.seamLenUnder) : null,
        pieceCount: pieces.length
      },
      meta: {
        title: '바 재킷 (더블)',
        source: '백영례 「테일러 자켓 패턴」 번호점 제도법 (docs/테일러드재킷-제도법-백영례.md)',
        sizeName: sizeNameOf(m), m: m, geom: g, warnings: warnings, notes: [],
        formulaNotes: formulaNotes(m, g).concat(sleeve ? twoNotes(sleeve) : []), seam: seam
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
      FN('lapel', '라펠',      '꺾임 = 75(맨 윗단추) → 76(어깨선 안 ' + f1(K.rollIn) + ') · V 바닥 = 앞중심 위 ' +
                  f1(K.notchDrop) + ' 아래 · 라펠 끝 = 앞중심 바깥 ' + f1(K.lapelOut) +
                  '  [40]~[46]', g.lapelW, 'front',
                  [g.lapelPt[0] - 1.0, g.lapelPt[1] + 3.0]),
      FN('collar', '카라',     '옆목점에서 ' + f1(K.collarOut) + ' 나가서 · 뒷목치수 + 카라넓이 ' +
                  f1(K.collarW) + '  [42]', K.collarW, 'collar', [1.0, K.collarW * 0.5])
    ];
  }
  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }


  /* ══════════════════════════════════════════════════════════════════
   * 7. 2장소매 — `숙녀복기본원형2` 에서 이식 (2026-08-12)
   *
   *   ★ 소매는 **암홀 길이만 있으면 제도된다** — `twoSleeveGeom(m, opt, AHb, AHf)`.
   *     재킷 암홀이 이제 계산식으로 나오므로 그대로 물리면 전 호수가 따라온다.
   *   ★ 원형2 판을 **그대로** 가져왔다. 2026-08-12 에 소맷부리 몫을 이분법으로 풀어
   *     큰↔작은 절개선 짝을 전 호수 0.000 으로 맞춘 판이다 — 옛 버전을 쓰면 안 된다.
   *   ⚠ 이 소매는 「큰소매 앞폭 3 을 떼어 작은소매 뒤에 붙인」 설계라
   *     **조각 경계 ≠ 앞뒤 암홀 경계**다. 작은소매의 `소매통 연결`은 제도상 뒤에 있어도
   *     꿰맬 때는 **앞 암홀** 몫이다 (SPEC §B2-1).
   * ════════════════════════════════════════════════════════════════ */
  var SLEEVE_TYPE = {
    /* ★ 소매길이 — **도면(Barjacke) 값**. 원형2 이식판은 60.0 이었고 그러면 조각이
       도면보다 2.8 길다(61.8 ↔ 59.9). 등급 1.0/호는 도면 한 호수로는 못 정하니 그대로 둔다.
       밑단 앞 y 가 곧 이 값이다 (hemY = 패드분 + 길이 − twoHemUp, 55호 step −1). */
    two: { name: '2장소매', len: 57.23, lenGrade: 1.0,     // 패드점에서 잰 길이
           /* 소맷부리 총둘레 — **Barjacke 도면** 55호 14.24 + 11.16 = 25.40 → 66호 26.05.
              예전 25.479 는 원형2 DXF 값(큰 17.019 + 작은 8.460)이었다. */
           cuff: 26.05, cuffGrade: 0.65, twoPiece: true }
  };
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
  /** 곡선 위에서 y 가 주어진 자리 — **가장 가까운 점을 반드시 낸다.**
   *  몸판용 `ptOnSegsAtY` 는 0.25 를 넘으면 null 을 내므로 소매 절개점에 쓸 수 없다. */
  function ptOnSegsAtYNear(segs, targetY) {
    var p = sampleSegs(segs, 0.01), best = p[0], bd = 1e9;
    for (var i = 0; i < p.length; i++) {
      var d = Math.abs(p[i][1] - targetY);
      if (d < bd) { bd = d; best = p[i]; }
    }
    return cp(best);
  }
  function ptAtLenOn(segs, dist, fromEnd) {
    var p = sampleSegs(segs, 0.02);
    if (fromEnd) p = p.slice().reverse();
    var acc = 0;
    for (var i = 1; i < p.length; i++) {
      var seg = V.dist(p[i - 1], p[i]);
      if (acc + seg >= dist) {
        var t = seg > 1e-9 ? (dist - acc) / seg : 0;
        return { p: _lerp(p[i - 1], p[i], t), tan: V.norm(V.sub(p[i], p[i - 1])) };
      }
      acc += seg;
    }
    return { p: cp(p[p.length - 1]), tan: V.norm(V.sub(p[p.length - 1], p[p.length - 2])) };
  }
  function inwardAngle(tan, at, inside) {
    var nr = [tan[1], -tan[0]];
    if (nr[0] * (inside[0] - at[0]) + nr[1] * (inside[1] - at[1]) < 0) nr = [-nr[0], -nr[1]];
    return angDeg(nr);
  }
  function capNotches(s) {
    var mid = [s.apexShift, s.sleeveLen * 0.4], out = [];
    /* 앞뒤 이세 재배분 — 전체 이세를 뒤 capEaseBack / 앞 나머지 로 나눈다 */
    var capLB = polyLen(sampleSegs(s.capBack, 0.02)), capLF = polyLen(sampleSegs(s.capFront, 0.02));
    var easeAll = Math.max(0, (capLB + capLF) - (s.AHb + s.AHf));
    var easeB = easeAll * K.capEaseBack, easeF = easeAll - easeB;
    /* 어깨 맞춤점 = 뒤 소매산에서 (뒤암홀 + 뒤이세) 만큼 간 자리. 정점에서 얼마나 밀렸는지도 낸다 */
    var needB = s.AHb + easeB;
    /* 뒤 소매산만으로 모자라면 **정점을 넘어 앞 소매산 쪽으로** 넘어간다 (66호 0.45) */
    var fit = (needB <= capLB) ? ptAtLenOn(s.capBack, needB, true)
                               : ptAtLenOn(s.capFront, needB - capLB, false);
    out.push({ p: cp(fit.p), angle: inwardAngle(fit.tan, fit.p, mid), label: '어깨 맞춤' });
    [[s.capBack, s.AHb, '뒤', easeB], [s.capFront, s.AHf, '앞', easeF]].forEach(function (w) {
      var AH = w[1];
      var ease = w[3], accE = 0;
      for (var q = 1; q < K.armNotchDiv; q++) {
        accE += ease * (K.capEaseShare[q - 1] || 0);
        var hit = ptAtLenOn(w[0], AH * q / K.armNotchDiv + accE, true);
        out.push({ p: cp(hit.p), angle: inwardAngle(hit.tan, hit.p, mid),
                   label: w[2] + ' ' + q + '/' + K.armNotchDiv });
      }
    });
    return out;
  }
  function splitSegsAtX(segs, targetX) {
    var p = sampleSegs(segs, 0.01), cut = -1;
    for (var i = 1; i < p.length; i++) {
      if ((p[i - 1][0] - targetX) * (p[i][0] - targetX) <= 0) { cut = i; break; }
    }
    if (cut < 1) cut = Math.max(1, Math.floor(p.length / 2));
    return { head: p.slice(0, cut + 1).map(cp), tail: p.slice(cut - 1).map(cp) };
  }
  function revPts(a) { return a.slice().reverse(); }
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
  /** 트임 덧단 — 폭은 조각마다 다르다 (도면 큰 2.174 / 작은 2.0). 하나로 쓰면
   *  큰소매 트임 밑단이 −0.21, 미터가 −0.19 짧다. */
  function ventOf(seamSegs, insideRef, wIn, lenIn, mitreIn) {
    var ventW = (wIn === undefined) ? K.ventW : wIn;
    var vLen  = (lenIn === undefined) ? K.ventLen : lenIn;
    var vMit  = (mitreIn === undefined) ? K.ventMitre : mitreIn;
    var sp = splitSegsAtLenFromEnd(seamSegs, vLen);
    var top = sp.head.length ? sp.head[sp.head.length - 1].p1 : seamSegs[0].p0;
    var fold = sp.tail;                                  // 트임 접음선 = 절개선 아래 9
    var hem = seamSegs[seamSegs.length - 1].p1;
    var ch = V.norm(V.sub(hem, top)), nr = [ch[1], -ch[0]];
    if (nr[0] * (hem[0] - insideRef[0]) + nr[1] * (hem[1] - insideRef[1]) < 0) nr = [-nr[0], -nr[1]];
    var vv = [nr[0] * ventW, nr[1] * ventW];
    /* 절개선은 **미터 기준점(트임 위 2.0)** 에서 끝난다 — 그 아래는 미터 사선이 대신한다 */
    var mp = splitSegsAtLenFromEnd(seamSegs, vLen + vMit);
    return {
      seamHead: mp.head, fold: fold, top: top, hem: hem,
      mitreOn: mp.head.length ? mp.head[mp.head.length - 1].p1 : top,
      topOut: [top[0] + vv[0], top[1] + vv[1]],
      hemOut: [hem[0] + vv[0], hem[1] + vv[1]],
      vec: vv, w: ventW, len: polyLen(sampleSegs(fold, 0.02))
    };
  }
  /** 점열의 **끝에서부터** 기준점 ref 와의 현(직선거리)이 d 가 되는 자리.
   *  도면의 「3」처럼 곡선을 따라가 아니라 **직선거리로 잰 치수**를 옮길 때 쓴다.
   *  @returns {i, p} — i = 그 자리 직전 점의 인덱스, p = 보간한 점 */
  function idxAtChordFromEnd(pts, ref, d) {
    for (var i = pts.length - 2; i >= 0; i--) {
      var a = pts[i], b = pts[i + 1], da = V.dist(a, ref), db = V.dist(b, ref);
      if (da >= d && db <= d) {
        var t = (da - db) ? (da - d) / (da - db) : 0;
        return { i: i, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
      }
    }
    return { i: 0, p: pts[0].slice() };
  }
  function seamMatchNotches(segsA, segsB, inside) {
    var LA = sLen(segsA), LB = sLen(segsB), L3 = Math.min(LA, LB) / 3;
    function nt(segs, dist, fromEnd, label) {
      var h = ptAtLenOn(segs, dist, fromEnd);
      return { p: cp(h.p), angle: inwardAngle(h.tan, h.p, inside), label: label };
    }
    return {
      a: [nt(segsA, L3, false, '앞솔기 1/3'), nt(segsA, L3, true, '앞솔기 2/3')],
      b: [nt(segsB, L3, false, '앞솔기 1/3'), nt(segsB, L3, true, '앞솔기 2/3'),
          /* 가운데 — 남는 이세 " + (LB - LA).toFixed(2) + " 를 여기에서 조절한다 */
          nt(segsB, LB / 2, false, '이세 조절 (' + f1(Math.abs(LB - LA)) + ')')],
      ease: LB - LA, LA: LA, LB: LB
    };
  }

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
  function twoNotes(s) {
    var B = 'sleeveBig', U = 'sleeveUnder', mid = s.sleeveLen * 0.55;
    var vB = s.ventBig, vU = s.ventUnd;
    return [
      /* ── 공통 골격 (큰소매에 표기) ── */
      FN('capH',     '소매산 높이', 'AH/4 + 2',                         s.capH, B, [s.apexShift + 0.4, s.capH * 0.5]),
      FN('apexPt',   '정점 이동',   '앞으로 ' + f1(K.capApexShift),    s.apexShift, B, [s.apexShift, -0.9]),
      FN('center',   '소매길이',    '2장소매 — 66호 ' + f1(SLEEVE_TYPE.two.len) +
                                    ' · 호수당 +' + f1(SLEEVE_TYPE.two.lenGrade), s.sleeveLen, B, [s.apexShift, mid]),
      FN('elbow',    '팔꿈치선',    '소매길이/2 + ' + f1(K.elbowAdd), s.elbowY, B, [s.frontInX * 0.4, s.elbowY]),
      FN('splitPt',  '절개 시작점', '뒤 소매산 위 x = −AH/4',            -s.AH / 4, B, cp(s.splitP)),
      FN('frontIn',  '앞 경계',     '앞 소매통 − ' + f1(s.sideOff),   s.frontInX, B, [s.frontInX, s.topY - 0.8]),
      FN('capBigFront', '큰소매 앞 소매산', '정점 → 앞 경계 (소매통까지 가지 않는다) · 앞 암홀 몫',
                     polyLen(s.capBigFront), B, [s.frontInX * 0.55, s.capH * 0.45]),
      FN('capBigBack',  '큰소매 뒤 소매산', '정점 → 절개점 · 뒤 암홀 몫',
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
      FN('backOut',  '뒤 경계',     '뒤 소매통 + ' + f1(s.sideOff),   s.backOutX, U, [s.backOutX, s.topY - 0.8]),
      FN('bicep',    '소매통 연결', '뒤 경계 → 소매통 끝 · 제도는 뒤에 있어도 **앞 암홀 몫**' +
                     ' (큰소매 앞에서 ' + f1(s.sideOff) + ' 떼어 여기 붙였다)',
                     polyLen(sampleSegs(s.undCapOut, 0.02)), U, [(s.backOutX + s.bicepB[0]) / 2, s.topY - 0.6]),
      FN('capUnderBack', '작은소매 소매산', '소매통 → 절개점 · 뒤 암홀 몫',
                     polyLen(s.capUnderBack), U, [(s.bicepB[0] + s.splitP[0]) / 2, s.capH * 0.55]),
      FN('splitPt',  '절개 시작점', '뒤 소매산 위 x = −AH/4',            -s.AH / 4, U, cp(s.splitP)),
      FN('elbow',    '팔꿈치선',    '소매길이/2 + ' + f1(K.elbowAdd), s.elbowY, U, [s.backOutX + 2.5, s.elbowY]),
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
      /* ── 봉제 기준 앞뒤 (조각 경계와 다르다) ── */
      FN('capAll',   '소매산 총합',  '큰 + 작은 = 암홀 ' + f1(s.AH) + ' + 이세분',
                     s.capLenTotal, B, [s.apexShift, 1.4]),
      FN('capSewnF', '앞 소매산(봉제)', '큰소매 앞 ' + f1(s.capLenBigFront) + ' + 작은소매 소매통 연결 ' +
                     f1(s.capLenUnderOut) + ' = 앞 암홀 ' + f1(s.AHf) + ' + 이세 ' + f1(s.capEaseFront),
                     s.capLenFront, B, [s.frontInX * 0.62, s.capH * 0.72]),
      FN('capSewnB', '뒤 소매산(봉제)', '큰소매 뒤 ' + f1(s.capLenBigBack) + ' + 작은소매 소매산 ' +
                     f1(s.capLenUnderBack) + ' = 뒤 암홀 ' + f1(s.AHb) + ' + 이세 ' + f1(s.capEaseBack),
                     s.capLenBack, B, [s.splitP[0] * 0.62, s.capH * 0.72])
    ];
  }

  function capGeom(AH, AHb, AHf, capReduce, apexShift, capHIn, padIn, botBIn, bulgeIn, topDivIn) {
    var capH = (capHIn === undefined) ? AH / 4 + 2 : capHIn;   // ★ 이 모듈은 AH/3 + 패드분
    /* ★ AH 대각선은 **상단선이 아니라 패드점 (0, 패드분) 에서** 내린다 — 정답지 확인.
       패드분은 소매산을 위로 밀어 올릴 뿐 대각선(=암홀 길이)의 수직변이 아니다.
       상단선에서 내리면 66호 소매폭이 1.87 좁아진다. */
    var pad = padIn || 0, vert = capH - pad;
    var diagB = AHb - capReduce, diagF = AHf - capReduce;    // 대각선 = 각 암홀 길이
    var halfB = Math.sqrt(Math.max(diagB * diagB - vert * vert, 0.01));
    var halfF = Math.sqrt(Math.max(diagF * diagF - vert * vert, 0.01));
    var apex = [apexShift, 0], bicepB = [-halfB, capH], bicepF = [halfF, capH];

    // 마크 — 상단은 중심선 상단점에서 수평 AH/8, 하단은 소매폭 끝에서 안쪽으로
    var topDiv = (topDivIn === undefined) ? 8 : topDivIn;
    var markTopB = [-AH / topDiv, 0], markTopF = [AH / topDiv, 0];
    /* 뒤 하단 마크는 **고정 4.5** — 정답지 실측 4.5000 (AH/12+0.6 = 4.41 이 아니다) */
    var markBotB = [-halfB + (botBIn === undefined ? AH / 12 + 0.6 : botBIn), capH];
    var markBotF = [halfF - AH / 8, capH];

    /* 각 마크에서 대각선에 수선 → 발점. 곡선은 발점↔마크 사이 capBulge 비율 지점을 지난다.
       ★ 수선을 내리는 대각선은 **패드점 (0, 패드분) → 소매폭점** 이다 (원본 DXF 에 그 선이
         엔티티로 남아 있다: (0,1)→(−18.47,16.218) · (0,1)→(15.5,16.218)).
         공용 footOn() 은 원점 (0,0) 기준이라 여기서 쓰면 상단 통과점이 0.33 어긋난다
         — 그게 소매산이 도면보다 배부르던 원인이다. tightSleeveGeom 은 패드분이 없어
         (0,0)=패드점이므로 공용 footOn 그대로 쓴다. */
    var org = [0, pad];
    function footFromOrg(D, P) {
      var d = V.sub(D, org), L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L];
      var q = V.sub(P, org), t = q[0] * u[0] + q[1] * u[1];
      var F = [org[0] + u[0] * t, org[1] + u[1] * t];
      return { foot: F, t: t / L, dist: V.dist(P, F), u: u, len: L };
    }
    var fTB = footFromOrg(bicepB, markTopB), fBB = footFromOrg(bicepB, markBotB);
    var fTF = footFromOrg(bicepF, markTopF), fBF = footFromOrg(bicepF, markBotF);
    var bulge = (bulgeIn === undefined) ? K.capBulge : bulgeIn;
    var mixP = function (f, mk) { return _lerp(f.foot, mk, bulge); };
    var pTB = mixP(fTB, markTopB), pBB = mixP(fBB, markBotB);
    var pTF = mixP(fTF, markTopF), pBF = mixP(fBF, markBotF);

    // 소매산 곡선 — 정점에서 수평 출발, 상단 볼록점 → 하단 오목점 → 소매폭 끝
    /* 양 끝 접선은 **둘 다 수평** — 정점에서 수평으로 출발해 소매통 끝에도 수평으로
       닿는다 (긴소매 DXF 실측: 소매통 도착 접선 뒤 −1.55° / 앞 1.82°).
       끝접선을 자유롭게 두면 소매통 근처에서 도면과 0.15 cm 어긋난다. */
    /* 정점 → 상단 통과점 → 하단 통과점 → 소매통 끝을 **C2 스플라인**으로 잇는다.
       양 끝 접선은 둘 다 수평 (DXF 실측 도착 접선 뒤 −1.55° / 앞 1.82°).
       구간별 장력을 따로 적합하던 이전 방식은 통과점 사이가 직선처럼 펴져 보였다. */
    /* 앞뒤 장력을 따로 쓴다 — 하나로 묶으면 앞이 배부르고 뒤가 모자란다 */
    var cb = CAL.capBack || CAL.sleeveCap, cf = CAL.capFront || CAL.sleeveCap;
    /* ★ 중간앵커(현의 중점)를 뺐다 — **이 도면에는 그 마크가 없다**. 실제 곡선은 중점보다
       0.27 뒤를 지난다. 4점 [정점, 상단 통과점, 하단 통과점, 소매폭점] 이 도면과 맞는다. */
    var capBack = splineSegs([apex, pTB, pBB, bicepB],
      endTan([-1, 0], cb.k0), endTan([-1, 0], cb.k1));
    var capFront = splineSegs([apex, pTF, pBF, bicepF],
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
  function twoSleeveGeom(m, opt, AHb, AHf) {
    var AH = AHb + AHf;
    var capReduce = (opt.capReduce === undefined) ? K.capReduce : +opt.capReduce;
    capReduce = Math.max(0, Math.min(1, capReduce));
    var ST = SLEEVE_TYPE.two;
    var step = (m.B - BASE.B) / GRADE.B;
    var sleeveLen = (opt.sleeveLen === undefined) ? ST.len + ST.lenGrade * step : +opt.sleeveLen;
    var cuffW = (opt.cuffW === undefined) ? ST.cuff + ST.cuffGrade * step : +opt.cuffW;

    /* ★ 소매산 높이를 넘긴다 — 원형1 은 AH/4+2, 이 모듈은 **AH/3 + 패드분** 이다.
       capGeom 안에 하드코딩돼 있던 것을 파라미터로 뺐다. */
    var capH2 = AH / num(opt.capHeightDiv, K.capHeightDiv) + num(opt.capPad, K.capPad);
    var pad2 = num(opt.capPad, K.capPad);
    var cg = capGeom(AH, AHb, AHf, capReduce, K.capApexShift, capH2, pad2,
      num(opt.twoMarkBotB, K.twoMarkBotB), num(opt.capBulge, K.capBulge), num(opt.capTopDiv, K.capTopDiv));
    var halfB = cg.halfB, halfF = cg.halfF;
    /* 길이 골격은 **패드점 기준** — 정답지: 팔꿈치 33.5 = 1 + 60/2 + 2.5 · 부리 61.0 = 1 + 60 */
    var elbowY = pad2 + sleeveLen / 2 + K.elbowAdd;
    var insetY = K.twoInsetY;              // 이세처리 구간 표시용

    /* ── 절개 골격 (정답지 실측) ────────────────────────────────────────
     *  · 절개점 높이 = **소매산의 정확히 절반** (정답지 8.109 = 16.218/2)
     *  · 큰소매 절개점 = 소매산 곡선 ∩ 그 높이
     *  · 작은소매 절개점 = 큰소매보다 **0.8 뒤** (도면 `0.8` 두 곳 · 실측 0.8000)
     *    두 조각이 절개선에서 0.8 씩 겹쳐 그 만큼이 이세로 들어간다.
     *  ⚠ 예전에는 splitX = −AH/4 한 점을 두 조각이 공유했다.
     *  ★ 이 모듈은 「절반」이 아니다 — 도면의 뒤 소매산이 그보다 길다. `twoSplitAt` 참고. */
    var splitY = cg.capH * num(opt.twoSplitAt, K.twoSplitAt);
    var splitP = ptOnSegsAtYNear(cg.capBack, splitY);
    var splitX = splitP[0];
    var splitU = [splitX - num(opt.twoSplitGap, K.twoSplitGap), splitY];   // 작은소매 절개점
    /* 소매산(정점 → 뒤 소매통)을 절개점에서 자른다.
       head = 정점~절개점 → **큰소매** 몫, tail = 절개점~뒤 소매통 → **작은소매** 몫 */
    var capSplit = splitSegsAtX(cg.capBack, splitX);

    /* ★ 큰소매 앞 소매산은 소매통 끝까지 가지 않고 **소매폭점 F 에서 현(직선거리) 3.0 인
       곡선 위 점**에서 끝난다. 도면의 숫자 `3` 은 x 오프셋이 아니라 **현 길이**다
       (실측 앞 3.0087 · 뒤 3.0071). 예전에는 x = halfF − 3 으로 잘라 끝점이 도면과
       0.16 어긋났고, `앞경계 상단 0.558 올림`을 별도 규칙으로 오해했다 — 그 0.558 은
       현 3 절단의 **결과**이지 규칙이 아니다. */
    var capFrontPts = sampleSegs(cg.capFront, 0.02);
    /* ★ 절개 위치는 **소매폭에 대한 비율**이다. 고정 cm 로 두면 호수가 작을수록
       비율이 커져 앞 경계가 소매산 위로 더 올라가고, 어느 호수에서 소매산 너치가
       큰소매↔작은소매 사이를 넘어간다 — 44호만 조각별 너치 개수가 달라졌다. */
    var sideOff = halfF * num(opt.twoSideOffAt, K.twoSideOffAt);
    var cutF = idxAtChordFromEnd(capFrontPts, cg.bicepF, sideOff);
    var capBigFront = capFrontPts.slice(0, cutF.i + 1).concat([cutF.p]);
    var frontInX = cutF.p[0];
    var topY = cutF.p[1];
    /* ★ 잘라낸 꼬리(앞경계 → 소매폭점 F)를 **소매폭만큼 뒤로 평행이동**한 것이
       작은소매의 `소매통 연결`이다. 도면에서 두 곡선의 끝점 차 0.0017 · 접선각 둘 다 23.17°
       — 같은 곡선이다. 「큰소매 앞폭 3 을 떼어 작은소매 뒤에 붙인다」가 문자 그대로 이것이다.
       그래서 backOutX·topY 는 규칙이 아니라 **파생값**이다. */
    var sleeveW = halfB + halfF;
    var capOutPts = capFrontPts.slice(cutF.i + 1);
    capOutPts = [cutF.p].concat(capOutPts, [cg.bicepF]).map(function (q) { return [q[0] - sleeveW, q[1]]; });
    var backOutX = capOutPts[0][0];
    /* 밑단선 y — **패드점 기준**이라야 팔꿈치(33.5)와 앞뒤가 맞는다.
       도면 실측 60.7 = 패드분 1 + 소매길이 60 − 0.3. 그 0.3 이 어디서 오는지는 [미확정]. */
    var hemY = pad2 + sleeveLen - K.twoHemUp, hemLowY = hemY + K.twoHemDrop;

    /* ★ 큰소매 부리 앞 모서리. 예전에는 `halfF − 상수` 였는데, halfF 는 호수마다
       커지므로 상수를 빼면 이 모서리가 halfF 를 그대로 따라 밖으로 나간다 —
       그러면 **부리 몫이 호수마다 널뛴다** (44호 0.53 → 88호 0.71 · 도면 0.561).
       소매폭에 대한 **비율**로 잡아야 몫이 유지된다. */
    var bigHemF = [halfF * num(opt.twoFrontHemAt, K.twoFrontHemAt), hemY];
    /* ★ 작은소매 부리 뒤 모서리는 뒤 경계보다 **안쪽**이고 **0.3 올라간다**
       (도면 마크 「작은소매 부리 뒤모서리(0.3 올림)」 실측 (−20.250, 60.4) · 뒤 경계 −21.425).
       예전에는 `backOutX − 1.492` 로 **바깥으로** 내밀어 부호가 반대였다. 그 2.6 때문에
       바깥 뒤선이 팔꿈치 아래에서 크게 휘고(휨 0.404 · 도면 0.117) 부리 몫도 틀렸다
       (작은 9.85 / 도면 8.46). 팔꿈치선까지는 도면과 0.05 로 맞고 있었다.

       ★ 이 x 는 **상수가 아니라 푼 값**이다. 큰소매 `앞 밑선` 과 작은소매 `바깥 뒤선` 은
         서로 꿰매는 짝인데, 예전에는 아무도 안 맞추고 있어서 전 호수 0.26~0.39 어긋나
         있었다(검사 표에도 없었다). 부리 앞 모서리를 도면 몫에 맞추자 그 차이가 1.1 까지
         벌어져 드러났다. 두 조각의 밑단 모서리는 서로 독립이므로,
         **뒤 모서리를 이분법으로 밀어** 두 변의 길이를 맞춘다. */
    var bigFront = splineSegs([[frontInX, topY], [frontInX - K.twoFrontElbowIn, elbowY], bigHemF],
      endTan([0, 1], CAL.twoFront.k0), null);
    var bigFrontLen = polyLen(sampleSegs(bigFront, 0.02));
    function mkUndOuter(hb) {
      return splineSegs([[backOutX, topY],
          [backOutX + K.twoUndOutIn1, K.twoUndOutY1],
          [backOutX + K.twoUndOutIn2, K.twoUndOutY2], hb],
        endTan([0, 1], CAL.twoUndOuter.k0), endTan([0, 1], CAL.twoUndOuter.k1));
    }
    var undHemB = (function () {
      var yb = hemY - K.twoUndHemRise, seed = num(opt.twoUndHemIn, K.twoUndHemIn);
      function gapO(dx) { return polyLen(sampleSegs(mkUndOuter([backOutX + dx, yb]), 0.02)) - bigFrontLen; }
      /* ⚠ gapO 는 **단조가 아니다** — 뒤 모서리를 어느 쪽으로 밀어도 곡선이 길어져서
         양 끝 부호가 같고 가운데서 0 을 두 번 지난다. 양 끝만 보고 이분법을 걸면
         답이 있는데도 못 찾는다(55호 gapO(−8)=+4.07 · gapO(8)=+1.50 인데 1.2 근처는 음수).
         그래서 **훑어서 부호가 바뀌는 구간을 먼저 찾고**, 씨앗값(도면 1.175)에 가장
         가까운 구간 안에서만 이분법을 쓴다. */
      var best = null, prev = gapO(-8), pd = -8, dx, mid0;
      for (dx = -7.8; dx <= 8.0001; dx += 0.2) {
        var cur = gapO(dx);
        if (prev * cur <= 0) {
          mid0 = (pd + dx) / 2;
          if (!best || Math.abs(mid0 - seed) < Math.abs(best[2] - seed)) best = [pd, dx, mid0];
        }
        prev = cur; pd = dx;
      }
      if (!best) return [backOutX + seed, yb];
      var lo = best[0], hi = best[1], gLo = gapO(lo);
      for (var i = 0; i < 40; i++) {
        var mid = (lo + hi) / 2;
        if (gapO(mid) * gLo > 0) lo = mid; else hi = mid;
      }
      return [backOutX + (lo + hi) / 2, yb];
    })();
    /* ★ 작은소매 절개선은 큰소매 절개선을 **절개점 수직선에 대칭**시킨 것이다.
       도면이 그렇다 — 큰 −5.586 / 작은 −15.836 은 절개점 −10.711 에 대해 정확히 대칭.
       대칭이면 두 절개변 길이가 저절로 같아진다(도면 53.7565 = 53.7565).
       그래서 **입력은 소맷부리 총둘레 하나뿐**이고, 큰/작은 몫은 대칭이 정한다.
         총둘레 C = (앞 − 큰끝) + (2·절개x − 큰끝 − 작은바깥)
         ⇒ 큰끝 = (앞 − 작은바깥 + 2·절개x − C) / 2
       ⚠ 큰소매 몫만 따로 등급을 주면 대칭 때문에 작은소매 몫이 호수마다 널뛴다
         (66호 6.9 → 88호 3.4 로 줄었다). 총둘레를 등급하고 몫은 계산해야 한다. */
    /* ★ 소맷부리는 **큰:작은 = 2:1** 로 나눈다 (도면 17.019 / 8.460 = 0.668 / 0.332).
       예전에는 두 조각을 절개점 수직선에 대칭시켜 몫을 정했다. 그러면 대칭축이
       절개점(엔진 −9.585)에 묶이는데, 도면의 축은 **밑단 두 모서리의 중점 −9.835** 이고
       절개점의 중점(−10.074)과도 다르다 — 즉 대칭이 아니라 이 비율이 축을 정한다. */
    /* 비율은 **호(부리선 길이)** 기준이다. 밑단 두 끝의 y 가 달라(하강 1.492 · 올림 0.3)
       x 폭으로 그대로 쓰면 호가 길어진다 — y 차를 빼고 x 폭을 낸다. */
    var xOf = function (arc, dy) { return Math.sqrt(Math.max(arc * arc - dy * dy, 0.01)); };
    /* ★ 몫(share)은 **고정 상수가 아니라 계산 결과**다 — 위 주석이 이미 경고한 함정이다.
       2/3 을 박아 두면 66호만 맞고, 다른 호수에서는 두 밑단 모서리(bigHemF·undHemB)가
       서로 다른 속도로 벌어져 **큰↔작은 절개선 길이가 44호 1.16 · 88호 1.53 어긋난다**
       (2026-08-12 QA). 두 절개선은 서로 꿰매는 짝이라 길이가 같아야 한다.
       총 부리둘레 cuffW 는 그대로 두고 **몫만 이분법으로 풀어** 길이를 맞춘다.
       66호에서는 답이 2/3 근처로 나오므로 정답지 적합이 유지된다. */
    var hemPts = function (share) {
      return [[bigHemF[0] - xOf(cuffW * share, hemLowY - bigHemF[1]), hemLowY],
              [undHemB[0] + xOf(cuffW * (1 - share), hemLowY - undHemB[1]), hemLowY]];
    };
    var shareSolved, cuffBigArc, cuffUndArc, bigHemB, undHemF, cuffBig, cuffUnder;   // ↓ mkSeam 정의 뒤에 푼다

    /* 절개선 — 절개점 → 팔꿈치선 위의 중간 앵커 → 밑단.
       앵커 위치(mr·my)와 양 끝 접선(k0·k1)은 도면 bigBack 41점에 적합했다. */
    /* 절개선은 **C 자**다 — 한쪽으로만 휘고 곡률 부호가 바뀌지 않는다.
       x 의 극값이 중간(y = twoInsetY 20.805)에 있을 뿐이다.
       도면 큰소매 뒤선: 절개점 −9.674 → 가장 부푼 점 −10.335(y 20.805) → 트임어깨 −8.796.
       즉 절개점 수직선에서 **뒤로 0.661** 부풀었다가 밑단 쪽으로 돌아온다.
       ⚠ 예전 앵커는 팔꿈치선보다 6.8 **위**의 한 점이라 이 S 를 못 그렸고, 팔꿈치 휨이
         0.25(도면 0.94)로 거의 곧은 선이었다. 앵커를 정점 자리로 옮긴다. */
    var mkSeam = function (endPt, startP, outSign, bulgeScale) {
      var cs = CAL.twoSeam;
      var st = startP || splitP;
      var bs = (bulgeScale === undefined) ? 1 : bulgeScale;
      /* 앵커 **두 점** — 가장 부푼 자리(y 20.805)와 팔꿈치 아래(y 34.315).
         한 점만 쓰면 아래쪽이 곧게 펴져 도면과 0.29 벗어난다 (도면 −10.078 · 엔진 −9.9). */
      /* ★ 두 절개선은 서로의 거울이지만 **각자의 절개점**에서 출발한다. 그래서 자기
         절개점 기준으로 재면 부푼 양이 다르다 (큰 0.661/0.404 · 작은 1.139/0.882).
         차이는 둘 다 0.478 로 같다 — 대칭축이 절개점이 아니라 그 사이의 −9.835 이기 때문. */
      var sg = (outSign || -1), un = (sg > 0);
      /* ★ 앵커 y 는 **절개선 자기 구간 안의 비율**이다 (절대 좌표 아님).
         66호 실측 y(20.8 · 34.315 · 51.273)를 그대로 박아 뒀더니 절개점·밑단은
         호수 따라 움직이는데 앵커는 안 움직여, 서로 반대로 부푸는 두 곡선이 호수마다
         다르게 늘어났다 — **큰↔작은 절개선 짝이 44호 1.16 · 88호 1.53 어긋났다**
         (66호만 −0.045 로 맞았다. 2026-08-12 QA). 봉제하면 소매가 뒤틀린다. */
      var yAt = function (t) { return st[1] + (endPt[1] - st[1]) * t; };
      var b1 = [st[0] + sg * bs * num(opt.twoSeamBulge, un ? K.twoSeamBulgeU : K.twoSeamBulge), yAt(K.twoSeamT1)];
      var b2 = [st[0] + sg * bs * (un ? K.twoSeamBulgeU2 : K.twoSeamBulge2), yAt(K.twoSeamT2)];
      /* 앵커 3 — **트임어깨 자리**(y 51.27). 여기가 비어 있으면 아래쪽이 끝접선만으로
         흘러가 트임어깨가 큰 0.193 · 작은 0.110 어긋난다. 이 자리에서 곡선은 자기
         절개점 수직선을 이미 **넘어가 있다**(큰 +0.878 · 작은 −0.398) — 그래서 부호가 음수다. */
      var b3 = [st[0] + sg * bs * (un ? K.twoSeamBulgeU3 : K.twoSeamBulge3), yAt(K.twoSeamT3)];
      return splineSegs([st, b1, b2, b3, endPt],
        endTan([0, 1], cs.k0), endTan(V.sub(endPt, b3), cs.k1));
    };
    shareSolved = (function () {
      function gap(sh) {
        var h = hemPts(sh);
        return sLen(mkSeam(h[0])) - sLen(mkSeam(h[1], splitU, +1));
      }
      /* 구간을 넓게 잡는다 — 예전 [0.35, 0.90] 은 **44호에서 답을 놓쳐** 대비값
         2/3 으로 떨어졌고, 그 호수만 작은소매 부리가 8.2 로 쪼그라들었다.
         대비값은 절개선 짝을 맞추지 않으므로 여기 빠지면 안 된다. */
      var lo = 0.15, hi = 0.95, gLo = gap(lo);
      if (gLo * gap(hi) > 0) return K.twoCuffBigShare;      // 구간 안에 답이 없으면 도면 몫
      for (var i = 0; i < 44; i++) {
        var mid = (lo + hi) / 2;
        if (gap(mid) * gLo > 0) lo = mid; else hi = mid;
      }
      var sol = (lo + hi) / 2;
      /* ★ 몫에 **울타리**를 친다. 절개선 짝 하나로는 몫이 덜 정해지는 호수가 있다 —
         44호는 gap 곡선이 거의 평평해 답이 0.21 까지 흘러가고, 그러면 작은소매 부리가
         큰소매보다 넓어진다(19.4 / 5.2). 울타리에 걸린 호수도 짝 어긋남은 0.09 로
         허용(0.15) 안이다. 도면 몫 0.561 은 울타리 한가운데다. */
      var bd = K.twoCuffShareBand;
      return Math.max(bd[0], Math.min(bd[1], sol));
    })();
    cuffBigArc = cuffW * shareSolved; cuffUndArc = cuffW * (1 - shareSolved);
    var _hp = hemPts(shareSolved);
    bigHemB = _hp[0]; undHemF = _hp[1];
    cuffBig = bigHemF[0] - bigHemB[0]; cuffUnder = undHemF[0] - undHemB[0];
    var bigBack = mkSeam(bigHemB);
    /* 작은소매 절개선은 **자기 절개점(splitU)** 에서 출발한다 — 큰소매보다 0.8 뒤.
       두 절개선이 그 0.8 만큼 겹쳐 그것이 이세로 들어간다 (도면 `0.8` 두 곳). */
    /* ★ 두 절개선은 **서로 꿰매는 짝**이라 길이가 같아야 한다. 앵커 x 는 66호 실측이라
       호수가 바뀌면 밑단 x 가 크게 움직여(큰소매 dx 44호 −3.2 ↔ 88호 +7.4) 두 곡선이
       다르게 늘어난다 — 44호 1.16 · 88호 1.53 어긋난 채 나갔다 (2026-08-12 QA).
       작은소매 앵커의 부푼 양에 **배율 하나**를 걸어 길이를 맞춘다. 66호는 배율 ≈ 1
       이라 정답지 적합이 그대로 유지되고, 다른 호수만 따라온다.
       (부푼 양을 줄이면 곡선이 짧아진다 — 단조라 이분법으로 찾는다) */
    var undBack = mkSeam(undHemF, splitU, +1);   // 작은소매는 반대쪽(앞)으로 부푼다 — 큰소매의 거울
    /* 트임 — 두 조각 모두 절개선 아래 9 를 바깥으로 2.2 내민다 */
    var vLn = num(opt.ventLen, K.ventLen);
    var ventBig = ventOf(bigBack, [halfF, elbowY], num(opt.ventWBig, K.ventWBig), vLn);   // 조각 안쪽 = 앞쪽 → 덧단은 뒤로
    var ventUnd = ventOf(undBack, [backOutX, elbowY], num(opt.ventWUnd, K.ventW), vLn);   // 조각 안쪽 = 뒤쪽 → 덧단은 앞으로

    /* 작은소매 바깥 뒤선 — 앵커 **두 점**. 가장 앞으로 나온 자리는 팔꿈치선(33.5)이 아니라
       그보다 아래 y 36.199 다 (도면 −19.460 · 뒤 경계에서 1.965). 팔꿈치선에 한 점만 두면
       아래쪽이 곧게 펴져 도면과 0.53 벗어난다.
       (`bigFront` 와 `mkUndOuter` 는 부리 뒤 모서리를 풀 때 이미 위에서 만들었다.) */
    var undOuter = mkUndOuter(undHemB);
    /* 소매통 연결 — 위에서 만든 **큰소매 앞 소매산의 잘린 꼬리를 평행이동한 것** 그대로다.
       예전에는 CAL.twoCapOut 으로 따로 적합한 스플라인을 그렸다 (도면에 없는 곡선이었다). */
    var undCapOut = lineSegs.apply(null, capOutPts);

    /* ── 작은소매 소매산 — **독립 재제도 곡선**이다 (도면 마크가 그대로 남아 있다) ──
     *  예전에는 큰소매 소매산을 큰소매 절개점에서 자른 tail 을 그대로 썼다. 그러면 끝점이
     *  절개선 시작점(0.8 뒤)과 안 맞아 외곽선에 0.8 짜리 직선 점프가 생겼다.
     *  도면의 작도 골격:
     *    · 소매폭점 B 에서 앞으로 **0.8 수평 직선** (실측 Δx 0.800 / Δy 0.002)
     *    · 그 다음 스플라인이 pBB(뒤 하단 마크 4.5 의 수선 통과점, 큰소매와 공유) 와
     *      **선분 splitU↔markBotB 의 중점** 을 지나 작은소매 절개점에서 끝난다
     *      (도면 십자 마크 3곳과 0.002 이내 일치)
     *  평행이동·x압축 가설은 각각 편차 0.68 · 0.53 으로 기각됐다. */
    var undCapHead = [cg.bicepB, [cg.bicepB[0] + num(opt.twoSplitGap, K.twoSplitGap), cg.bicepB[1]]];
    var undCapCurve = splineSegs(
      [undCapHead[1], cg.pBB, _lerp(splitU, cg.markBotB, 0.5), splitU],
      endTan([1, 0], CAL.twoUnderCap.k0), null);
    var capUnderBack = undCapHead.concat(sampleSegs(undCapCurve, 0.02).slice(1));

    var out = {
      AH: AH, AHb: AHb, AHf: AHf, capReduce: capReduce, sleeveLen: sleeveLen,
      sleeveType: 'two', typeName: ST.name, twoPiece: true,
      cuffBig: cuffBig, cuffUnder: cuffUnder, cuffW: cuffBig + cuffUnder,
      elbowY: elbowY, insetY: insetY, splitX: splitX, splitP: splitP, splitU: splitU,
      backOutX: backOutX, frontInX: frontInX, topY: topY,
      capBigFront: capBigFront,               // 정점 → 앞 절단점 (소매통까지 안 간다)
      capBigBack: revPts(capSplit.head),      // 절개점 → 정점
      capUnderBack: capUnderBack,             // 뒤 소매통 → 작은소매 절개점(0.8 뒤)
      bigHemF: bigHemF, bigHemB: bigHemB, undHemB: undHemB, undHemF: undHemF,
      bigBack: bigBack, undBack: undBack, bigFront: bigFront,
      ventBig: ventBig, ventUnd: ventUnd, ventW: K.ventW, ventLen: K.ventLen,
      undOuter: undOuter, undCapOut: undCapOut, sideOff: sideOff,
      seamLenBig: polyLen(sampleSegs(bigBack, 0.02)),
      seamLenUnder: polyLen(sampleSegs(undBack, 0.02)),
      underLenB: polyLen(sampleSegs(undOuter, 0.02)),
      underLenF: polyLen(sampleSegs(bigFront, 0.02)),
      hemEndB: bigHemB, hemEndF: bigHemF, hemMidB: bigHemB, hemMidF: bigHemF,
      hemHalfB: cuffBig / 2, hemHalfF: cuffBig / 2, hemBack: null, hemFront: null
    };
    for (var k in cg) if (cg.hasOwnProperty(k)) out[k] = cg[k];

    /* ── 봉제 기준 앞뒤 구분 ────────────────────────────────────────────────
     *  이 2장소매는 **큰소매 앞쪽 폭에서 3 을 떼어 작은소매 뒤쪽에 붙인** 설계다.
     *  그래서 작은소매의 `소매통 연결`(뒤바깥 상단 → 소매폭점 B)은 제도에서는 뒤에
     *  그려지지만 **꿰맬 때는 앞 암홀**로 들어간다.
     *      앞 = 큰소매 앞 소매산 + 작은소매 소매통 연결   (정답지 20.662 + 3.035 = 23.697)
     *      뒤 = 큰소매 뒤 소매산 + 작은소매 뒤 소매산     (정답지 13.679 + 12.258 = 25.937)
     *  ⚠ 총합만 보면 이 배분이 틀려도 안 드러난다. 예전에는 소매통 연결을 뒤로 세어
     *    앞 이세가 −0.95(소매가 안 들어가는 값)인데도 총 이세 4.66 이라 통과했다.        */
    var lenBigF = polyLen(out.capBigFront), lenBigB = polyLen(out.capBigBack);
    var lenUndB = polyLen(out.capUnderBack), lenUndO = polyLen(sampleSegs(undCapOut, 0.02));
    out.capLenBigFront = lenBigF; out.capLenBigBack = lenBigB;
    out.capLenUnderBack = lenUndB; out.capLenUnderOut = lenUndO;
    out.capLenFront = lenBigF + lenUndO;          // 봉제 앞 소매산
    out.capLenBack = lenBigB + lenUndB;           // 봉제 뒤 소매산
    out.capLenTotal = out.capLenFront + out.capLenBack;
    out.capEaseFront = out.capLenFront - AHf;
    out.capEaseBack = out.capLenBack - AHb;
    out.capEase = out.capLenTotal - AH;
    return out;
  }
  /** 2장소매 소매산 너치 — **겨드랑에서 꿰매는 순서대로** 걸어 자리를 잡는다.
   *  앞 = 작은소매 `소매통 연결` → 큰소매 앞 소매산   (조각 경계 ≠ 앞뒤 암홀 경계)
   *  뒤 = 작은소매 소매산 → 큰소매 뒤 소매산
   *  이렇게 하면 조각이 바뀌어도 자리가 정확하고, 너치 개수가 호수에 상관없이 같다. */
  function twoCapNotches(s, big, und) {
    var midB = [s.apexShift, s.sleeveLen * 0.4];
    var midU = [(s.backOutX + s.splitU[0]) / 2, s.sleeveLen * 0.4];
    var frontPath = [
      { pts: revPts(sampleSegs(s.undCapOut, 0.02)), host: und, inside: midU },
      { pts: revPts(s.capBigFront), host: big, inside: midB }
    ];
    var backPath = [
      { pts: s.capUnderBack.slice(), host: und, inside: midU },
      { pts: s.capBigBack.slice(), host: big, inside: midB }
    ];
    function put(path, dist, label) {
      for (var k = 0; k < path.length; k++) {
        var pts = path[k].pts, acc = 0;
        for (var i = 1; i < pts.length; i++) {
          var seg = V.dist(pts[i - 1], pts[i]);
          if (acc + seg >= dist) {
            var t = seg > 1e-9 ? (dist - acc) / seg : 0, p = _lerp(pts[i - 1], pts[i], t);
            path[k].host.notches.push({ p: cp(p), label: label,
              angle: inwardAngle(V.norm(V.sub(pts[i], pts[i - 1])), p, path[k].inside) });
            return;
          }
          acc += seg;
        }
        dist -= acc;
      }
      /* 경로 끝을 넘어가면 마지막 조각 끝에 붙인다 — 개수는 호수와 무관하게 같아야 한다 */
      var last = path[path.length - 1], lp = last.pts[last.pts.length - 1];
      last.host.notches.push({ p: cp(lp), angle: 90, label: label });
    }
    var div = K.armNotchDiv, q, accE = 0;
    for (q = 1; q < div; q++) {
      accE += s.capEaseBack * (K.capEaseShare[q - 1] || 0);
      put(backPath, s.AHb * q / div + accE, '뒤 ' + q + '/' + div);
    }
    accE = 0;
    for (q = 1; q < div; q++) {
      accE += s.capEaseFront * (K.capEaseShare[q - 1] || 0);
      put(frontPath, s.AHf * q / div + accE, '앞 ' + q + '/' + div);
    }
    /* 어깨 맞춤 — 뒤 소매산을 뒤 암홀 + 뒤 이세만큼 간 자리 */
    put(backPath, s.AHb + s.capEaseBack, '어깨 맞춤');
  }
  function twoSleevePieces(s, seam) {
    function mk(id, name, edges, grain, notches) {
      var loop = edgesToLoop(edges), sm = buildSeamline(loop, seam);
      /* ★ 몸판 조각과 **같은 보정**을 건다 — 재단선 위로 스냅하고, 틱이 조각 안쪽을
         향하게 돌린다. 원형2 판에는 이 보정이 없어 손으로 넣은 각(180 등)에 의존했다.
         재킷은 암홀이 달라 그 각이 맞지 않는다 — 작은소매 「절개 시작」 틱이
         전 호수에서 조각 밖으로 나갔다 (2026-08-12). */
      fixNotches(notches, loop.pts);
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
        /* ★ 트임 끝은 **외곽선 위의 mitreOn** 이다 — 절개선(봉제선)이 실제로 끝나는 자리.
           예전엔 vB.top(원래 절개선 위 9 지점)을 썼는데 그 자리는 미터 사선으로 대체돼
           **외곽선에서 1.4cm 떨어진 허공**이었다 (전 호수, 2026-08-12 QA).
           봉제하는 사람에게 필요한 것은 「여기서 박음질을 멈춘다」는 재단선 위의 표시다. */
        { p: cp(vB.mitreOn), angle: 0, label: '트임 끝' }]
       .concat(seamMatchNotches(s.bigFront, revSegs(s.undOuter), [0, s.sleeveLen * 0.5]).a)
       );
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
       /* ★ 작은소매의 절개 시작점은 **자기 절개점 splitU** 다 — splitP(큰소매 것)를 쓰면
          twoSplitGap 0.8 만큼 통째로 어긋난다. 그 0.8 이 이세로 들어가는 값이라
          숫자가 작아 눈에 안 띄었다 (전 호수 정확히 0.800 어긋나 있었다). */
       [{ p: cp(s.splitU), angle: 180, label: '절개 시작' },
        /* 뒤 합인 — 도면 마크 (−14.9255, 11.7312). 절개점과 소매통 사이라 작은소매 몫 */
        { p: cp(s.pBB), angle: angDeg(V.norm(V.sub([0, s.sleeveLen * 0.5], s.pBB))), label: '뒤 합인' },
        { p: cp(vU.mitreOn), angle: 180, label: '트임 끝' }]
       .concat(seamMatchNotches(s.bigFront, revSegs(s.undOuter), [0, s.sleeveLen * 0.5]).b)
       );
    /* ★ 소매산 맞춤 너치 — **각 조각의 실제 소매산 곡선 위**에서 잰다.
       한 장 소매용 `capNotches` 는 capGeom 의 통짜 소매산에서 재기 때문에,
       작은소매처럼 **독립 재제도된** 곡선에서는 0.4 넘게 떠 「어느 조각에도 안 속한」
       너치가 생긴다 — 재킷 암홀에서 실제로 44호 「뒤 2/3」이 사라졌다(호수마다
       너치 개수가 달라졌다). 겨드랑에서 출발해 **꿰매는 순서대로** 걸으면
       조각이 바뀌어도 자리가 정확하고 개수가 호수에 상관없이 같다. */
    twoCapNotches(s, big, und);
    /* (옛 방식 — 통짜 소매산에서 재어 조각에 배분하던 코드는 아래 주석 참고)
       ★ 소매산 맞춤 너치는 **조각 외곽선에 붙여 나눈다.**
       예전엔 「어느 곡선 위인가」(onPts)로 걸렀는데, 곡선 경계에 놓인 너치가 어느 쪽에도
       안 잡혀 **통째로 사라졌다** — 「뒤 1/3」이 44·55·88호에 없었다(66·77호만 있었다).
       몸판 암홀 3등분에 대응하는 필수 너치가 호수에 따라 있다 없다 한 것이다
       (2026-08-12 QA). 외곽선이 기준이면 조각이 곧 판정 기준이라 빠질 수가 없다. */
    (function () {
      /** 외곽선까지 최단거리와 그 발 — 꼭짓점이 아니라 **변에 내린 수선**이라야
          너치가 재단선 위에 정확히 앉는다 */
      function foot(q, o) {
        var best = null, bd = Infinity, bt = null;
        for (var i = 1; i < o.length; i++) {
          var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          var t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var c = [a[0] + t * dx, a[1] + t * dy], e = V.dist(q, c);
          if (e < bd) { bd = e; best = c; }
        }
        return { d: bd, p: best };
      }
    })();
    fixNotches(big.notches, big.outline);
    fixNotches(und.notches, und.outline);
    return [big, und];
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
