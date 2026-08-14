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
  function _lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function _lerp2(a, b) { return _lerp(a, b, 0.5); }   // 2등분점 — 원문의 「2등분하여」
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

  /** 두 직선 (A0 + t·d0) × (A1 + u·d1) 교점. 평행이면 null */
  function lineX(A0, d0, A1, d1) {
    var den = d0[0] * d1[1] - d0[1] * d1[0];
    if (Math.abs(den) < 1e-12) return null;
    var t = ((A1[0] - A0[0]) * d1[1] - (A1[1] - A0[1]) * d1[0]) / den;
    return [A0[0] + d0[0] * t, A0[1] + d0[1] * t];
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
  /* ★ 조끼는 **소매가 없다.** 원피스에서 복제하며 sleeveLen·sleeveW·dressLen 이
     따라왔는데 어디에도 안 쓰여 「입력란이 거짓말하는」 상태였다(검산기가 흔들어
     확인해 잡았다 · 2026-08-14 QA). 밑단은 원문대로 **엉덩이선**이므로
     조끼길이는 hipLen 이 정한다 — 따로 둘 치수가 아니다. */
  var MEAS_KEYS = ['B', '유B', 'W', 'H', 'backLen', 'shoulderW', 'backW', 'frontW',
                   'bustLen', 'bustW', 'hipLen'];
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
    mpBack      :  0.65,  // [17] MP 0.5~0.8 (뒤 · 겨드랑~등의 살을 보고 정한다)
    mpFront     :  0.75,  // [39] MP 0.5~1 (앞 · 카라가 없거나 목파임이 큰 옷은 앞이 뜬다)
    neckOut     :  1.5,   // [18] 38 = 24 에서 1.5
    shDartLen   :  7.0,   // [19] 40 = 다트길이 7
    /* ── 앞판 [20]~[40] ─────────────────────────────────────── */
    frontShDrop :  4.5,   // [21] 48 = 47 에서 4.5 아래
    fNeckDrop   :  1.0,   // [22] 51 = 50 에서 1 내려온 곳
    fShScoop    :  1.5,   // [23] 52 = 20 에서 1.5 내려온 곳
    fNeckOut    :  1.5,   // [23] 53 = 51 에서 1.5 나간 곳
    bpOut       :  1.75,  // [26] 58 = 57(BP) 에서 1.5~2
    /* [27] 앞다트분 — **기본은 「남는 양」**(56 − 55)이라 이 값은 안 쓰인다.
       opt.frontDart 로 덮어쓸 때만 쓰이는 참고값이다. (fSplitDrop 은 삭제 —
       67 을 암홀 위 점으로 옮기면서 아무도 안 읽는 상수가 됐다) */
    frontDart   :  2.5,
    frontDrop   :  2.5,   // [38] 70 = 3 에서 앞처짐 2.5
    frontWrap   :  2.0,   // [38] 앞여밈분 — 얇은 원단 2 · 두꺼운 2.5
    frontArmGap :  0.5,   // [25] 앞암홀이 49(앞품)에서 0.5 떨어진다
    splitPanels :  1      // 1 = 암홀라인 절개 4조각
  };

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
  /** opt 값이 비어 있으면 기본값 d — 「2~2.5」처럼 폭이 있는 자리의 손잡이 */
  function num(v, d) { return (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v; }

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
  /* ★ 2026-08-14: 통과점 A 를 **부르는 쪽이 준다.**
     예전에는 (pitchTop + BL)/2 로 안에서 만들었다. 뒤판은 그게 우연히 27번의 y
     (=22~11 의 2등분)와 같아 맞았지만, 앞판은 원문 [25] 가 「**49번** 앞품에서
     0.5 정도 떨어지게」라고 못 박았는데도 52~41 의 중점을 써서 통과점이
     y 10.75 로 잡혔다 — 49 는 y 12.5 다(46~47 의 3등분점). 1.75 를 높이 지나갔다. */
  function armholeC(SP, shDir, A, U, C) {
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
    /* 뒤목선 [18] — 2 → 37 → 38. 어깨선에 직각으로 도착한다.
       ★ 시작점은 **2번**이다. 37 은 2~23 의 3등분점으로 기초선(y=0) 위에 있고,
         목선은 뒤중심(2)에서 평평하게 나와 37 을 지나 38 로 올라간다.
       ⚠ 예전에는 37 에서 시작해 등솔선 끝(2)과 2.33cm 벌어져 있었다 — 그 구간이
         어느 변에도 안 속해 시접이 목선이 아니라 뒤중심 값으로 나갔다. */
    var bShDir = V.norm(V.sub(p26, p38));
    var bNeck = splineSegs([p2, p37, p38],
                           endTan([1, 0], 1.0), endTan(neckEndTan(p38, p26, p37), 1.0));
    /* 뒤 암홀 [13] — 26 에서 시작해 27 에서 0.5~1 떨어져 통과 → **13**(겨드랑)
       ★ 끝점은 11 이 아니라 **13** 이다. 11 은 등품/2 자리의 작도점(27·28 을 잡는 데 쓴다)일
         뿐이고, 도면(9_뒤판이미지2)에서 암홀 곡선은 27 자리에서 x 18.5 까지 부풀었다가
         13 으로 치솟아 끝난다 — 옆선이 시작하는 바로 그 점이다.
       ⚠ 예전에는 11 에서 끝나 **암홀과 옆선 사이가 6.25cm 벌어진 채** 조각이 만들어졌다
         (그 구간은 어느 변도 아닌 암묵적 현으로 메워졌다). */
    var bArm = armholeC(p26, bShDir, [p11[0] + num(opt.armFromBW, K.armFromBW), p27[1]],
                        p13, CAL.arm);
    /* [17] 35 = 암홀 위의 적당한 곳. **현(26~11)이 아니라 곡선 위**라야 한다 —
       예전엔 현에서 잡아 암홀선에서 0.60~0.64 떠 있었다 (engine-verify 가 잡음).
       그래서 bArm 이 만들어진 **뒤에** 잡는다. */
    var p35 = (function () {
      var pts = sampleSegs(bArm, 0.02), t = num(opt.mpAt, K.mpAt);
      return cp(pts[Math.max(0, Math.min(pts.length - 1, Math.round(t * (pts.length - 1))))]);
    })();
    var p36 = [p35[0] - num(opt.mpBack, K.mpBack), p35[1]];
    /* 뒤 옆선 — 13 → 19 → 16 */
    var bSide = splineSegs([p13, p19, p16], endTan(V.sub(p19, p13), CAL.side.k0),
                                            endTan(V.sub(p16, p19), CAL.side.k1));
    /* 뒤 절개선 [16] — **암홀 위**에서 시작해 28 → 33/34 → 31/32 (암홀라인)
       ★ 시작점은 27 자체가 아니라 **암홀이 27 높이를 지나는 점**이다. 27 은 등품선
         위(x=17.75)에 있고 암홀은 거기서 0.75 밖(18.5)으로 지나간다.
         원문 「27번점에서부터 그리거나 내려오거나」를 지키면서 곡선이 조각의 변이 된다.
       ⚠ 예전에는 27 에서 그대로 시작해 어깨~절개선이 10.85cm 벌어져 있었다. */
    var p27a = [p11[0] + num(opt.armFromBW, K.armFromBW), p27[1]];
    function bSplit(waistX, hemX) {
      return splineSegs([p27a, p28, [waistX, WL], [hemX, HL]],
                        endTan(V.sub(p28, p27a), CAL.princess.k0), endTan([0, 1], CAL.princess.k1));
    }
    /* ★ [16] 「33번에서 32번을 연결 · 34번에서 31번을 연결」 — **교차한다.**
       허리에서 바깥쪽(33)인 변이 밑단에서는 안쪽(32)으로 간다. 30번이 그 교차점이다.
       예전에는 33→31 · 34→32 로 나란히 그어 두 변이 만나지 않았고, 밑단 끝이
       서로 1.5 어긋난 채였다 (engine-verify 가 전 호수에서 잡았다 · 2026-08-14 QA).
       ⚠ 「같은 쪽끼리 잇는다」가 자연스러워 보이지만 원문은 반대다 — 다이아몬드
         모양이라야 다트가 허리에서 물리고 밑단에서 풀린다. */
    var bSplitOut = bSplit(p33[0], p32[0]);    // 옆선 쪽 조각의 변 (33 → 32)
    var bSplitIn  = bSplit(p34[0], p31[0]);    // 중심 쪽 조각의 변 (34 → 31)
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
    /* [23] 52 = 20 에서 1.5 내려온 곳 · 53 = 51 에서 1.5 나간 곳
       ★ 20 번은 [10] 이 **기초선(y=0) 위**에 잡은 점이다(「2번에서 2분의어깨 나간곳」).
         앞판은 뒤판 **위에 겹쳐** 그리므로 앞판에서도 20 은 그대로 y=0 이고,
         「20번에서 1.5cm 내려와서」는 y = +1.5 다.
       ⚠ 예전에는 45선(y = −유차)에서 1.5 를 내려 (19, −1.0) 이었다. 그러면 앞 어깨
         기울기가 **2.7°** 가 된다(뒤는 18.4°) — 있을 수 없는 값이고, [23] 이 시키는
         「뒤 어깨(다트 뺀 것)와 같은지 확인」이 0.64 어긋났다.
         도면 11_앞판이미지 실측도 52 의 y 는 **1.8** 이지 −1.0 이 아니다(2.8 차이).
         뒤판 26 = 21(기초선)에서 1.5 내려온 곳과 정확히 짝이 되는 작도이기도 하다. */
    var f52 = [p20[0], num(opt.fShScoop, K.fShScoop)];
    var f53 = [f51[0] + num(opt.fNeckOut, K.fNeckOut), f51[1]];
    /* [24] 54 = 5 + W/4 · 55 = +여유 · 56 = **옆라인이 허리를 지나는 점**
       ★ 55 와 56 은 **다른 점**이다. [24] 참고: 「5번에서 W/4 + 여유분을 뺀 나머지를
         다트로 넣는 방법 … 정해진 치수로 다트를 주고 옆라인을 그리면 자칫 뒤판의
         옆라인과 많은 차이가 날 수 있다」 — 즉 옆라인을 **뒤판과 같은 형태로 먼저 긋고**,
         55 와의 차이가 곧 앞 다트분이다. 도면(11_앞판이미지)에도 55 와 56 사이에
         「다트」 브래킷이 그려져 있고 56 의 실측 x 는 22.3(예측 22.5)이다.
       ⚠ 예전에는 docs §5 의 추정대로 56 = 55 의 오기로 보고 옆라인을 55(18.75)까지
         끌어당겼다. 그 결과 **앞 옆선 39.25 · 뒤 옆선 34.85 — 4.4cm 어긋나** 꿰맬 수
         없는 패턴이 나왔다.
       56 = 41 에서 **뒤판이 들어온 만큼(13→19)** 들어온 곳 = 「뒤판과 같은 형태」 */
    var f54 = [W / 4, WL];
    var f55 = [f54[0] + num(opt.waistEase, K.waistEase), WL];
    var f56 = [f41[0] - (p13[0] - p19[0]), WL];
    /* [38] 70 = 3 에서 앞처짐 · 71 = 앞여밈분 · 72
       ★ 72 는 「71에서 직선으로 위로 올려 그은 선」의 **위 끝**, 곧 앞목선과 만나는 점이다.
         도면(11_앞판이미지) 을 재면 72 는 43번(진동선 × 앞중심) **바로 아래**,
         즉 여밈선 위의 y = BL − 유차 자리다. 예전에는 45선(y=−유차)까지 올려
         목선이 라운드로 그려졌지만, 조끼는 **V 넥**이다 (아래 fNeck 주석 참고). */
    var frontDrop = num(opt.frontDrop, K.frontDrop);
    var wrap = num(opt.frontWrap, K.frontWrap);
    var f70 = [0, HL + frontDrop];
    var f71 = [-wrap, HL + frontDrop];
    var f72 = [-wrap, f43[1]];
    /* [40] 밑단 = 71~16. 앞처짐 때문에 **기울어진 직선**이다 (뒤 밑단은 H선에 수평).
       ★ 59·60·61 은 그 밑단 위에 있어야 한다. HL 에 못 박아 두면 절개선이 밑단보다
         1.36 위에서 끝나 4조각이 닫히지 않는다 (2026-08-14 QA). */
    /* [40] 「71번과 16번을 연결하여 밑단」 — 다만 **앞판의 16 은 42번**이다.
       뒤판 16(H/4+여유를 뒤중심에서 잰 것)을 그대로 쓰면 앞은 여밈분만큼 더 나가
       완성 엉덩이가 H 보다 9 커진다. 사용자가 화면에서 「앞뒤판 엉덩이선이 하나는
       맞고 하나는 적용 안 됐다」고 짚었다 (2026-08-14). 앞은 42 에서 끝난다. */
    var fHemA = f71, fHemB = [f42[0], HL];
    function onFrontHem(x) { return [x, fHemA[1] + (fHemB[1] - fHemA[1]) * (x - fHemA[0]) / (fHemB[0] - fHemA[0])]; }
    /* [26] BP 57 = (유폭/2, 유장) · 58 = +1.5~2 · 59 = 58 에서 직선으로 내린 곳(밑단) */
    var f57 = [bustW / 2, bustLen];
    var f58 = [f57[0] + num(opt.bpOut, K.bpOut), bustLen];
    var f59 = onFrontHem(f58[0]);
    /* [27] 60·61 = (42~16)/2 를 59 양쪽 · 62 = 59 에서 5 위 · 63·64 = 앞다트분 */
    var fHalfHem = Math.abs(f42[0] - p16[0]) / 2;
    var f60 = onFrontHem(f59[0] + fHalfHem), f61 = onFrontHem(f59[0] - fHalfHem);
    var f62 = [f59[0], f59[1] - num(opt.hemUp, K.hemUp)];
    /* ★ 앞 다트분은 **고정값이 아니라 남는 양**이다 — [24] 참고가 그렇게 시킨다.
         옆라인(56)을 뒤판과 같은 형태로 먼저 긋고, 55(W/4+여유)와의 차이가 다트분.
         이렇게 해야 완성 허리가 앞뒤 모두 정확히 W/4+여유 가 된다.
       ⚠ 예전에는 K.frontDart 2.5 고정이었다 — 그 값과 옆라인이 서로 모르는 사이라
         완성 허리가 식과 안 맞았다. opt.frontDart 로 덮어쓸 수는 있게 남긴다. */
    var frontDart = num(opt.frontDart, f56[0] - f55[0]);
    var fSplitWaistX = f58[0];                    // 58 에서 수직으로 내린 절개 중심선
    var f63 = [fSplitWaistX + frontDart / 2, WL], f64 = [fSplitWaistX - frontDart / 2, WL];
    var f65 = [f41[0], f41[1] + num(opt.hemUp, K.hemUp)];
    var f66 = [f59[0], f59[1] + 유차];            // [27] 「59번에서 유차 내려간 곳」
    /* [28] 67·68 = 앞절개선. 69 = 46~48 의 2등분 — 그 위로 올라가면 안 된다
       ★ 67 은 **암홀 위의 점**이다 (「암홀쪽에서부터 … 앞절개선」).
         예전에는 (앞품/2, 진동선+1.5) = (16, 21.5) 였는데 그 자리는 암홀 위가 아니라
         진동선보다 **1.5 아래**다 — 절개선이 조각 밖에서 시작해 4조각이 22.7cm 벌어졌다.
         아래에서 암홀을 그린 뒤 그 통과점(49번 높이)을 그대로 쓴다: 69(y=11)보다
         아래이므로 「69번 위로 올라가면 안 된다」도 지킨다. */
    /* [39] 앞 MP — 53~68 선 위의 적당한 지점에서 절개선 쪽으로 접어 없앤다 */
    var fMp = _lerp(f53, f58, num(opt.mpAt, K.mpAt));
    var fMpDir = V.norm(V.sub(f58, f53));
    var fMpTo = [fMp[0] + fMpDir[0] * num(opt.mpFront, K.mpFront),
                 fMp[1] + fMpDir[1] * num(opt.mpFront, K.mpFront)];
    var f69 = _lerp2(f46, f48);

    /* 앞 곡선 ─────────────────────────────────────────────────── */
    var fShDir = V.norm(V.sub(f52, f53));
    /* 앞목선 — **V 넥**. 53 에서 72(여밈선 × 진동선 높이)까지 직선.
       ★ 원문 본문은 앞목선을 따로 정의하지 않는다. 도면이 근거다:
         11_앞판이미지 에서 53 에서 내려오는 초록 직선이 여밈선과 만나는 점이 72 이고,
         그 자리는 43번(진동선) 바로 아래다. 선 위의 임의점 실측 (7.4, 0.51) 이
         53→72 직선의 예측 (7.52, 0.51) 과 일치한다.
       ⚠ 예전 코드는 원피스에서 복제한 **라운드 목선**(깊이 B/6+0.5)이었고, 시작점이
         (0, 13) 이라 앞중심선(72)과 15.6cm 벌어져 조각이 닫히지 않았다. */
    var fNeck = lineSegs(f72, f53);
    /* [25] 앞 암홀 — 52 에서 시작해 **49번(앞품)에서 0.5 떨어져** 41 로 */
    var fArmGap = num(opt.frontArmGap, K.frontArmGap);
    var fArm = armholeC(f52, fShDir, [f49[0] + fArmGap, f49[1]], f41, CAL.armF);
    var f67 = [f49[0] + fArmGap, f49[1]];         // 절개선 시작 = 암홀 통과점 (곡선 위)
    var f68 = cp(f58);
    /* [24] 옆라인 41 → 56 → 16 (「뒤판과 같은 형태」) */
    var fSide = splineSegs([f41, f56, fHemB],
                           endTan(V.sub(f56, f41), CAL.side.k0), endTan([0, 1], CAL.side.k1));
    function fSplit(waistX, hemPt) {
      return splineSegs([f67, f68, [waistX, WL], hemPt],
                        endTan(V.sub(f68, f67), CAL.princess.k0), endTan([0, 1], CAL.princess.k1));
    }
    /* [29] 「64번과 60번을 연결 · 63번과 61번을 연결」 — 뒤와 같이 **62 에서 교차** */
    var fSplitOut = fSplit(f63[0], f61);
    var fSplitIn  = fSplit(f64[0], f60);
    var fHem = lineSegs(fHemA, fHemB);

    return {
      m: m, B: B, 유B: 유B, W: W, H: H, q: q, 유차: 유차,
      BL: BL, WL: WL, HL: HL, cbIn: cbIn, backLen: backLen, hipLen: hipLen,
      shoulderW: shoulderW, backW: backW, frontW: frontW, bustLen: bustLen, bustW: bustW,
      backDart: backDart, frontDart: frontDart, shDart: shDart, shDartLen: shDartLen,
      p2: p2, p3: p3, p4: p4, p5: p5, p6: p6, p7: p7, p8: p8, p9: p9, p10: p10,
      p11: p11, p12: p12, p13: p13, p14: p14, p15: p15, p16: p16, p17: p17, p18: p18,
      p19: p19, p20: p20, p21: p21, p22: p22, p23: p23, p24: p24, p25: p25, p26: p26,
      p27: p27, p27a: p27a, p28: p28, p29: p29, p30: p30, p31: p31, p32: p32, p33: p33, p34: p34,
      p35: p35, p36: p36, p37: p37, p38: p38, p39: p39,
      f41: f41, f42: f42, f43: f43, f44: f44, f45: f45, f46: f46, f47: f47, f48: f48,
      fMp: fMp, fMpTo: fMpTo,
      f49: f49, f50: f50, f51: f51, f52: f52, f53: f53, f54: f54, f55: f55, f56: f56,
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
  /* ════════════════════════════════════════════════════════════════
   * 6. 조각 — **암홀라인 절개** 4장 (뒤중심 · 뒤옆 · 앞중심 · 앞옆)
   *   원문 0. 「암홀라인 = 진동선(겨드랑이)쪽에서 절개선이 들어감」
   *   splitPanels 0 이면 통짜 2장(뒤판·앞판)으로 낸다.
   * ════════════════════════════════════════════════════════════════ */
  /** 점열 → 세그먼트 (길이 재기·변으로 쓰기 위해) */
  function poly2segs(pts) { return lineSegs.apply(null, pts); }
  /** 곡선을 점 P 에서 자른다. head=true 면 시작~P, false 면 P~끝 (P 는 곡선 위 점).
   *  절개선이 암홀 위에서 갈라지므로 암홀을 두 조각에 나눠 주는 데 쓴다. */
  function splitSegsAtPt(segs, P, head) {
    var pts = sampleSegs(segs, 0.01), bi = 0;
    for (var i = 0; i < pts.length; i++) if (V.dist(pts[i], P) < V.dist(pts[bi], P)) bi = i;
    return poly2segs(head ? pts.slice(0, bi + 1) : pts.slice(bi));
  }
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
    /* [19] 뒤 어깨 다트 — 39(38~22 의 2등분) 를 중심으로 다트분만큼 벌리고 길이 40(=7).
       ★ 예전에는 39·40·shDartLen 을 계산만 하고 **그리지 않았다.** 어깨 짝은 이미
         「다트분을 뺀 어깨」로 재고 있는데 도면에 다트가 없으면, 재단했을 때 뒤 어깨가
         다트분만큼 남는다. suite-verify 도 opt.shDartLen 을 흔들어 보고 아무것도
         안 변한다고 잡아냈다 (UI 슬라이더 무동작 = 안 그린다는 증거).
       ⚠ 다트 다리를 변으로 넣으면 어깨선이 셋으로 쪼개진다. 원문은 「그리고 접는다」
         이므로 **제도선(internal)** 으로 낸다. 이세로 처리하려면 opt.shDart 를
         0.7~0.8 로 낮추면 된다 ([12] 참고). */
    var shDir = V.norm(V.sub(g.p26, g.p38));                // 어깨선 방향
    var shN = [-shDir[1], shDir[0]];                        // 어깨선 법선
    if (shN[1] < 0) shN = [-shN[0], -shN[1]];               // 몸판 안쪽(+y)으로
    var dc = _lerp(g.p38, g.p26, 0.5);                      // 39 = 어깨선의 2등분점
    var dTip = [dc[0] + shN[0] * g.shDartLen, dc[1] + shN[1] * g.shDartLen];   // 40
    var dL = [dc[0] - shDir[0] * g.shDart / 2, dc[1] - shDir[1] * g.shDart / 2];
    var dR = [dc[0] + shDir[0] * g.shDart / 2, dc[1] + shDir[1] * g.shDart / 2];
    var bGuide = [
      L('blB', 'dashed', [[0, g.BL], [g.p13[0], g.BL]], '진동선'),
      L('wlB', 'dashed', [[0, g.WL], [g.p19[0], g.WL]], '허리선'),
      L('hlB', 'dashed', [[0, g.HL], [g.p16[0], g.HL]], '엉덩이선'),
      L('bwB', 'dashed', [[g.p11[0], 0], [g.p11[0], g.BL]], '등품선'),
      /* [17] MP(형지접어줄임) — 35 에서 다트쪽으로. **계산만 하고 안 그리면 종이엔 없다**
         (사용자 지적 2026-08-14 「다트가 다 들어가지 않았어」). 접는 양은 mpBack. */
      L('mpB', 'dashed', [cp(g.p35), cp(g.p36)], 'MP ' + r4(num(opt.mpBack, K.mpBack))),
      /* [14] 30 = 29 에서 5 위 — 절개(다트) 끝 표시. hemUp 이 여기서 살아난다 */
      L('dartTipB', 'edge', [[g.p30[0] - 0.6, g.p30[1]], [g.p30[0] + 0.6, g.p30[1]]], '다트 끝')
    ];
    if (split) {
      /* ★ 암홀라인 절개는 **암홀 위에서** 갈라진다 — 암홀도 두 조각으로 나눠야 한다.
         예전에는 뒤중심에 암홀이 아예 없고 뒤옆이 암홀을 통째로 가져가, 뒤중심의
         어깨끝(26)과 절개선 시작이 10.7cm 벌어진 채로 조각이 나갔다 (2026-08-14 QA). */
      var bArmUp  = splitSegsAtPt(g.bArm, g.p27a, true);    // 26 → 절개점
      var bArmLow = splitSegsAtPt(g.bArm, g.p27a, false);   // 절개점 → 13
      pieces.push(mk('back', '뒤중심', [
        { name: '뒷목',   role: 'neck',     segs: g.bNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.p38, g.p26) },
        { name: '진동',   role: 'armhole',  segs: bArmUp },
        { name: '절개선', role: 'princess', segs: g.bSplitIn },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.p31, g.p9) },   // 절개선(In)이 31 에서 끝난다
        { name: '등솔선', role: 'center',   segs: revSegs(g.bCb.concat(g.bCbLow)) }
      ], [[2.0, g.BL], [2.0, g.HL - 3]],
        [{ p: cp(g.p38), angle: 90, label: '목옆점' },
         { p: cp(dL), angle: 90, label: '다트 다리' }, { p: cp(dR), angle: 90, label: '다트 다리' }].concat(nB.a),
        bGuide.concat([
          L('cbB', 'dashed', [[0, 0], [0, g.HL]], '뒤중심 기초선'),
          /* [19] 어깨 다트는 **뒤중심에만** 넣는다 — 암홀라인 절개라 어깨는 뒤중심이
             통째로 갖는다. 공통 bGuide 에 두었더니 뒤옆에도 딸려가 「다트는 있는데
             다리 너치가 없는 조각」이 됐다 (dart-verify 가 잡았다 · 2026-08-14). */
          L('shDartB', 'edge', [dL, dTip, dR], '어깨 다트')
        ])));
      pieces.push(mk('backSide', '뒤옆', [
        { name: '진동',   role: 'armhole',  segs: bArmLow },
        { name: '옆선',   role: 'side',     segs: g.bSide },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.p16, g.p32) },   // 절개선(Out)이 32 에서 끝난다
        { name: '절개선', role: 'princess', segs: revSegs(g.bSplitOut) }
      ], [[g.p28[0] + 2.0, g.BL], [g.p28[0] + 2.0, g.HL - 3]],
        [{ p: cp(g.p13), angle: 180, label: '겨드랑' }].concat(nB.b), bGuide));
    } else {
      pieces.push(mk('back', '뒤판', [
        { name: '뒷목',   role: 'neck',     segs: g.bNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.p38, g.p26) },
        { name: '진동',   role: 'armhole',  segs: g.bArm },
        { name: '옆선',   role: 'side',     segs: g.bSide },
        { name: '밑단',   role: 'hem',      segs: revSegs(g.bHem) },
        { name: '등솔선', role: 'center',   segs: revSegs(g.bCb.concat(g.bCbLow)) }
      ], [[2.0, g.BL], [2.0, g.HL - 3]],
        [{ p: cp(g.p38), angle: 90, label: '목옆점' }, { p: cp(g.p13), angle: 180, label: '겨드랑' }],
        bGuide));
    }
    fn('blB', '진동깊이', 'B/4 + 1.5', g.BL, 'back', [1.0, g.BL - 1.0]);
    fn('bwB', '등품/2', '등품/2', g.backW / 2, 'back', [g.p11[0] - 3, g.BL / 2]);

    /* ══ 앞판 ══════════════════════════════════════════════════ */
    var nF = levelPair(g.fSplitIn, [0, g.WL], g.fSplitOut, [g.f42[0], g.WL],
               [['BP', g.bustLen], ['허리', g.WL], ['엉덩이', g.HL]]);
    /* ★ BP·MP 는 **앞중심 조각의 표시**다. 공통 fGuide 에 넣어 앞옆에도 붙였더니
       조각 밖 1.1~5.7cm 허공에 떠 있었다 (검산기가 잡음 · 2026-08-14 QA).
       조각마다 「그 조각 안에 있는 표시만」 준다. */
    var fGuideCommon = [
      L('blF', 'dashed', [[0, g.f41[1]], [g.f41[0], g.f41[1]]], '진동선'),
      L('wlF', 'dashed', [[0, g.WL], [g.f55[0], g.WL]], '허리선'),
      L('hlF', 'dashed', [[0, g.HL], [g.f42[0], g.HL]], '엉덩이선'),
      L('fwF', 'dashed', [[g.f46[0], g.f44[1]], [g.f46[0], g.f41[1]]], '앞품선'),
      /* [22] 앞 어깨기울기 안내선 S~N = 48~51. 제도 확인용 보조선이라 점선으로만 낸다
         (52 는 [23] 이 20번에서 잡으므로 이 선이 어깨 끝을 정하지는 않는다). */
      L('snF', 'dashed', [g.f48, g.f51], 'S~N 안내선'),
      /* [27] 62 = 59 에서 5 위 — 절개(다트) 끝 표시 */
      L('dartTipF', 'edge', [[g.f62[0] - 0.6, g.f62[1]], [g.f62[0] + 0.6, g.f62[1]]], '다트 끝'),
      /* [39] 앞 MP — 「53번에서 68번을 곡자로 연결하여 적당한 지점에」.
         목파임이 큰 옷은 앞이 뜨므로 0.5~1 을 접어 없앤다. 뒤 MP 와 짝이다.
         적당한 지점 = 53~68 의 중간(mpAt) 으로 잡고, 접는 방향은 절개선 쪽이다. */
    ];
    /* 앞중심에만 붙는 표시 — BP 십자 · 앞 MP */
    var fGuideCf = fGuideCommon.concat([
      L('bpF', 'edge', [[g.f57[0] - 0.6, g.f57[1]], [g.f57[0] + 0.6, g.f57[1]]], 'BP'),
      L('bpF2', 'edge', [[g.f57[0], g.f57[1] - 0.6], [g.f57[0], g.f57[1] + 0.6]], 'BP'),
      L('mpF', 'dashed', [cp(g.fMp), cp(g.fMpTo)], 'MP ' + r4(num(opt.mpFront, K.mpFront)))
    ]);
    if (split) {
      var fArmUp  = splitSegsAtPt(g.fArm, g.f67, true);     // 52 → 절개점(67)
      var fArmLow = splitSegsAtPt(g.fArm, g.f67, false);    // 67 → 41
      pieces.push(mk('front', '앞중심', [
        { name: '앞목',   role: 'neck',     segs: g.fNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.f53, g.f52) },
        { name: '진동',   role: 'armhole',  segs: fArmUp },
        { name: '절개선', role: 'princess', segs: g.fSplitIn },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.f60, g.f71) },   // 절개선(In)이 60 에서 끝난다
        { name: '앞중심', role: 'center',   segs: lineSegs(g.f71, g.f72) }
      ], [[-g.f71[0] + 2.0, g.BL], [-g.f71[0] + 2.0, g.HL - 3]],
        /* ★ BP 는 **너치가 아니다** — 조각 한가운데라 재단선 위에 못 찍는다.
           (fGuide 의 bpF/bpF2 십자 표시가 BP 자리를 알려 준다. 절개선 위의
            BP 높이 너치는 nF 가 따로 낸다.) 예전에는 f57 을 너치로 넣어
            외곽선에서 10cm 떨어진 허공에 찍혔다 (2026-08-14 suite-verify). */
        [{ p: cp(g.f53), angle: 90, label: '목옆점' }].concat(nF.a),
        fGuideCf.concat([L('cfF', 'dashed', [[0, g.f44[1]], [0, g.HL]], '앞중심 기초선')])));
      pieces.push(mk('frontSide', '앞옆', [
        { name: '진동',   role: 'armhole',  segs: fArmLow },
        { name: '옆선',   role: 'side',     segs: g.fSide },
        { name: '밑단',   role: 'hem',      segs: lineSegs(g.f42, g.f61) },   // 절개선(Out)이 61 에서 끝난다
        { name: '절개선', role: 'princess', segs: revSegs(g.fSplitOut) }
      ], [[g.f58[0] + 3.0, g.BL], [g.f58[0] + 3.0, g.HL - 3]],
        [{ p: cp(g.f41), angle: 180, label: '겨드랑' }].concat(nF.b), fGuideCommon));
    } else {
      pieces.push(mk('front', '앞판', [
        { name: '앞목',   role: 'neck',     segs: g.fNeck },
        { name: '어깨선', role: 'shoulder', segs: lineSegs(g.f53, g.f52) },
        { name: '진동',   role: 'armhole',  segs: g.fArm },
        { name: '옆선',   role: 'side',     segs: g.fSide },
        { name: '밑단',   role: 'hem',      segs: revSegs(g.fHem) },
        { name: '앞중심', role: 'center',   segs: lineSegs(g.f71, g.f72) }
      ], [[-g.f71[0] + 2.0, g.BL], [-g.f71[0] + 2.0, g.HL - 3]],
        [{ p: cp(g.f53), angle: 90, label: '목옆점' }],
        fGuideCf));
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
    /* ── 봉제 짝 치수 (검산기가 이걸로 잰다 — 「추측하지 말고 재라」) ─────── */
    function LEN(s) { return polyLen(sampleSegs(s, 0.02)); }
    var sideB = LEN(g.bSide), sideF = LEN(g.fSide);
    var shBackSewn = V.dist(g.p38, g.p26) - g.shDart;   // [23] 「다트분을 뺀 어깨」
    var shFront = V.dist(g.f53, g.f52);

    /* ★ 아직 안 고친 것 — **앞 옆선이 뒤 옆선보다 유차만큼 길다.**
       41 이 13 에서 유차 올라간 점([20])이라 앞 옆선은 구조상 유차만큼 길다.
       원문 [27] 은 「다트를 넣는 위치와 방법은 여러가지가 있으며 꼭 집어서 어느부분에
       넣어야 한다는 공식이나 원칙은 없습니다」라며 두 자리를 예로 든다:
         · 65 = 41 에서 5 내려간 곳 → BP 를 향한 선  (옆 다트)
         · 66 = 59 에서 **유차** 내려간 곳 → BP 를 향한 선  (밑단 다트)
       어느 쪽을 쓸지는 원문이 정하지 않았으므로 **엔진이 임의로 고르지 않는다.**
       대신 그 사실을 경고로 내보낸다 — 조용히 두면 못 꿰매는 패턴이 그대로 나간다. */
    if (Math.abs(sideF - sideB) > 0.3)
      warnings.push('앞 옆선이 뒤 옆선보다 ' + r4(sideF - sideB) + 'cm 길다 (유차 ' + r4(g['유차']) +
        ') — 원문 [27] 이 열어 둔 앞 다트(65 옆다트 / 66 밑단다트)를 아직 넣지 않았다');

    return {
      pieces: pieces, warnings: warnings, notes: [],
      meta: { formulaNotes: FN },
      measures: {
        B: r4(g.B), 유B: r4(g['유B']), W: r4(g.W), H: r4(g.H),
        BL: r4(g.BL), WL: r4(g.WL), HL: r4(g.HL), 유차: r4(g['유차']),
        ahBack: r4(g.ahBack), ahFront: r4(g.ahFront), AH: r4(g.AH),
        /* ★ 스위트 공통 이름도 함께 낸다 — ui.js 와 suite-verify.js 는 이 이름으로 읽는다.
           조끼 엔진만 ahBack/ahFront/AH 라 **요약표가 전부 「—」로 비었고**
           어깨·목둘레 검사가 조용히 건너뛰어졌다 (2026-08-14 suite-verify 지적).
           없는 키를 읽으면 통과도 실패도 안 한다 — 그게 제일 나쁘다. */
        armholeBack: r4(g.ahBack), armholeFront: r4(g.ahFront), armholeTotal: r4(g.AH),
        neckBack: r4(LEN(g.bNeck)), neckFront: r4(LEN(g.fNeck)),
        neckTotal: r4(LEN(g.bNeck) + LEN(g.fNeck)),
        shoulderBack: r4(V.dist(g.p38, g.p26)), shoulderBackSewn: r4(shBackSewn),
        shoulderFront: r4(shFront), shoulderFrontSewn: r4(shFront),
        shoulderEase: r4(shBackSewn - shFront), shoulderGap: r4(shBackSewn - shFront),
        sideBack: r4(sideB), sideFront: r4(sideF), sideFrontSewn: r4(sideF),
        sideGap: r4(sideF - sideB),
        splitBackIn: r4(LEN(g.bSplitIn)), splitBackOut: r4(LEN(g.bSplitOut)),
        splitFrontIn: r4(LEN(g.fSplitIn)), splitFrontOut: r4(LEN(g.fSplitOut)),
        backDart: r4(g.backDart), frontDart: r4(g.frontDart),
        /* 완성 치수 — 다트분을 뺀 반폭 × 2 ×2 */
        chestFinish: r4(2 * ((g.p13[0] - g.cbIn) + g.f41[0])),
        waistFinish: r4(2 * ((g.p19[0] - g.cbIn - g.backDart) + (g.f56[0] - g.frontDart))),
        /* 완성 엉덩이 — **여밈분은 빼고** 잰다(겹치는 분량이라 둘레에 안 더해진다).
           앞은 42 에서 끝난다(원문 [40] 의 「16」은 앞판에선 42다). */
        hipFinish:   r4(2 * ((g.p16[0] - g.cbIn - Math.abs(g.p31[0] - g.p32[0])) +
                             (g.f42[0] - Math.abs(g.f60[0] - g.f61[0]))))
      }
    };
  }

  /* ★ 2026-08-14 — 소매 관련 노출을 전부 걷어냈다.
     **조끼에는 소매가 없다.** sleeveGeom/twoSleeveGeom/SLEEVE_TYPE(S)/K_OLD/armCurve/
     throughT 는 원피스 모듈에서 복제된 뒤 아무도 부르지 않는 죽은 코드였고(393줄),
     UI 에는 그걸 믿고 만든 「소매 종류」 선택 상자가 남아 있었다.
     되살릴 일이 있으면 원피스 모듈에서 다시 가져올 것 — 여기 두면 거짓말이 된다. */
  return {
    measuresForSize: measuresForSize,
    draftVest: draftVest, draft: draftVest, geom: geom,
    MEAS_KEYS: MEAS_KEYS, MEAS_LABEL: MEAS_LABEL, SIZES: Object.keys(SIZE_STEP),
    BASE: BASE, GRADE: GRADE, K: K, CAL: CAL, FLATTEN: FLATTEN,
    SEAM_DEFAULT: SEAM_DEFAULT, SEAM_ROLES: SEAM_ROLES,
    /* util 은 검산기(engine-verify.js)가 쓴다. **여기 있는 것은 전부 살아 있어야 한다** —
       예전에는 sLen·through·sPath·LN·offsetLoop·offsetLoopSeg·rotv·rotAbout·perpToward 가
       실려 있었는데 엔진 안에서도 밖에서도 아무도 안 불렀다 (2026-08-14 정리). */
    util: { V: V, bez: bez, bezLen: bezLen, splineSegs: splineSegs, endTan: endTan,
            sampleSegs: sampleSegs, polyLen: polyLen,
            normSeam: normSeam, lineSegs: lineSegs, revSegs: revSegs }
  };
});
