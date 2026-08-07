/* ============================================================================
 * 숙녀복 기본원형 I — 제도 엔진
 *   · 교재 46P 「숙녀복 기본원형 I」 (패터너 김재성 패턴제공) 제도1·제도2
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
 * 노출: window.Lady1Engine  (+ 재사용 모듈 호환용 별칭 window.NoDartEngine)
 * 곡선: 기본원형 엔진과 같은 Freesewing(Brian block) 계열 3차 베지어.
 *       핸들 길이·끝접선 각도는 66호 원본 DXF 에 맞춰 캘리브레이션했고,
 *       전부 무차원 비율이라 호수가 바뀌어도 자기유사하게 스케일된다.
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.Lady1Engine = api; window.NoDartEngine = api; }
  else if (root) { root.Lady1Engine = api; root.NoDartEngine = api; }
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
    fDartTipDown : 2.5,        // 앞 허리다트끝 = BP 아래 2.5 (도면 `BP 2.5↑`)
    fDartIn      : 1.0,        // 앞 허리다트 CF 쪽 다리  (도면 `←1`)
    fDartOut     : 1.5,        // 앞 허리다트 옆선 쪽 다리 (도면 `1.5→`)

    /* ── 반소매 (SPEC §17-2 · 반소매원형 (1).dxf 실측) ── */
    capReduce      : 0,        // 대각선 감소량. 도면 교차검증 결과 0 (대각선 = 암홀 길이)
    sleeveHemInset : 1.5,      // 밑단 들임 (좌우 각)
    sleeveHemDrop  : 0.5,      // 밑단 2등분점 → 끝 하강량
    capBulge       : 0.5,      // 곡선 통과점 = 대각선 발점 ↔ 마크 사이의 비율 (도면 실측 0.500~0.512)
    capTension     : 0.42,     // 소매산 통과점 베지어 장력
    hemC1: 0.25, hemC2x: 0.18, hemC2y: 0.025   // 밑단 하강 곡선 핸들
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
    var dartAmt = m.frontLen - m.backLen;   // 앞뒤길이 차이치수 = 옆선 가슴다트 분량

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

    // 옆선 가슴다트 — 위 다리는 옆선 위 (BL + 5.0) 을 향하되 0.3 짧게,
    //                 아래 다리는 0.3 길게, 두 끝 사이 벌어짐 = 앞길이 − 등길이
    var dFoot = [halfW, BL + K.sideDartDrop];
    var uUp = V.norm(V.sub(dFoot, BP));
    var rA = V.dist(BP, dFoot);
    var rU = Math.max(0.5, rA - K.sideDartTrue);
    var rL = rA + K.sideDartTrue;
    var cosT = (rU * rU + rL * rL - dartAmt * dartAmt) / (2 * rU * rL);
    var dTheta = Math.acos(Math.max(-1, Math.min(1, cosT)));
    var aU = Math.atan2(uUp[1], uUp[0]);
    var dUp = [BP[0] + rU * Math.cos(aU), BP[1] + rU * Math.sin(aU)];
    var dLo = [BP[0] + rL * Math.cos(aU + dTheta), BP[1] + rL * Math.sin(aU + dTheta)];

    /* 옆선 — 교재 규칙(위 다리 −0.3) 그대로 두면 앞 옆선(봉제 길이)이 뒤 옆선과
       저절로 맞는다 (66호 차 0.007 cm). 그래서 기본은 규칙점을 그대로 쓴다.
       opt.trueSide = true 를 주면 차이를 0 으로 강제하지만, 그만큼(≈0.03) 도면에서 밀린다. */
    var sideBack = V.dist(Ub, bWaist);
    var fWaist = [halfW - K.waistIn, WLf];
    var sideLow = V.dist(dLo, fWaist);
    var dUpTrue = (opt.trueSide === true)
      ? pointOnRayAtDist(BP, uUp, Uf, Math.max(0.5, sideBack - sideLow), rU)
      : dUp;

    // 앞 허리다트 — 중심 = BP 아래 수직, 끝은 BP 에서 2.5 아래
    var fDartTip = [BP[0], BP[1] + K.fDartTipDown];
    var fDartL = [BP[0] - K.fDartIn, WLf];
    var fDartR = [BP[0] + K.fDartOut, WLf];

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
      { name: '옆선',       role: 'side',     segs: lineSegs(g.Ub, g.bWaist) },
      { name: '허리선(옆)', role: 'hem',      segs: lineSegs(g.bWaist, g.bDartR) },
      { name: '다트 옆다리', role: 'dart',    segs: lineSegs(g.bDartR, g.bDartTip) },
      { name: '다트 중심다리', role: 'dart',  segs: lineSegs(g.bDartTip, g.bDartL) },
      { name: '허리선(중심)', role: 'hem',    segs: lineSegs(g.bDartL, [0, g.WLb]) },
      { name: '뒤중심',     role: 'fold',     segs: lineSegs([0, g.WLb], g.BNP) }
    ];
    var frontEdges = [
      { name: '앞목둘레',   role: 'neck',     segs: g.frontNeck },
      { name: '어깨선',     role: 'shoulder', segs: lineSegs(g.SNPf, g.SPf) },
      { name: '앞암홀',     role: 'armhole',  segs: revSegs(g.frontArm) },
      { name: '옆선(위)',   role: 'side',     segs: lineSegs(g.Uf, g.dUpTrue) },
      { name: '가슴다트 위다리', role: 'dart', segs: lineSegs(g.dUpTrue, g.BP) },
      { name: '가슴다트 아래다리', role: 'dart', segs: lineSegs(g.BP, g.dLo) },
      { name: '옆선(아래)', role: 'side',     segs: lineSegs(g.dLo, g.fWaist) },
      { name: '밑단(옆)',   role: 'hem',      segs: lineSegs(g.fWaist, g.fDartR) },
      { name: '허리다트 옆다리', role: 'dart', segs: lineSegs(g.fDartR, g.fDartTip) },
      { name: '허리다트 중심다리', role: 'dart', segs: lineSegs(g.fDartTip, g.fDartL) },
      { name: '밑단(중심)', role: 'hem',      segs: lineSegs(g.fDartL, [0, g.WLf]) },
      { name: '앞중심',     role: 'fold',     segs: lineSegs([0, g.WLf], g.FNP) }
    ];

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
        { p: cp(g.Ub),   angle: 180,                                          label: '옆선 BL' },
        { p: cp(g.bDartL), angle: -90,                                        label: '다트' },
        { p: cp(g.bDartR), angle: -90,                                        label: '다트' }
      ],
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
        { p: cp(g.Uf),   angle: 180,                                          label: '옆선 BL' },
        { p: cp(g.dUpTrue), angle: 180,                                       label: '가슴다트' },
        { p: cp(g.dLo),  angle: 180,                                          label: '가슴다트' },
        { p: cp(g.fDartL), angle: -90,                                        label: '허리다트' },
        { p: cp(g.fDartR), angle: -90,                                        label: '허리다트' }
      ],
      bbox: bboxOf(frontLoop.pts)
    };

    var AHb = sLen(g.backArm), AHf = sLen(g.frontArm);
    var NKb = sLen(g.backNeck), NKf = sLen(g.frontNeck);
    var sideFront = g.sideUp + g.sideLow;

    /* ───────── 반소매 (SPEC §17-2) ───────── */
    var slv = (opt.includeSleeve === false) ? null : sleeveGeom(m, opt, AHb, AHf);
    var pieces = [backPiece, frontPiece];
    if (slv) pieces.push(sleevePiece(slv, seam));

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
    short: { name: '반소매', len: 23.0, lenGrade: 0.5 }
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
  function sleeveGeom(m, opt, AHb, AHf) {
    var AH = AHb + AHf;
    var capReduce = (opt.capReduce === undefined) ? K.capReduce : +opt.capReduce;
    capReduce = Math.max(0, Math.min(1, capReduce));
    /* 소매 종류 — 기본 'short'(반소매). 알 수 없는 값이 오면 조용히 기본값으로.
       소매길이 = 종류 기준값 + 호수당 grade.  opt.sleeveLen 을 주면 그것으로 덮어쓴다.
       ※ short 의 25.0 + 0.5·step 은 기존 식 25.0 + (B−87.6)/12 와 항등 → 하위호환. */
    var stKey = SLEEVE_TYPE[opt.sleeveType] ? opt.sleeveType : 'short';
    var ST = SLEEVE_TYPE[stKey];
    var step = (m.B - BASE.B) / GRADE.B;                     // 호수 스텝 (66호 = 0)
    var sleeveLen = (opt.sleeveLen === undefined) ? ST.len + ST.lenGrade * step : +opt.sleeveLen;

    var capH = AH / 4 + 2;                                   // 소매산 높이 (소매 종류와 무관 — AH 로만 결정)
    var diagB = AHb - capReduce, diagF = AHf - capReduce;    // 대각선
    var halfB = Math.sqrt(Math.max(diagB * diagB - capH * capH, 0.01));
    var halfF = Math.sqrt(Math.max(diagF * diagF - capH * capH, 0.01));
    var apex = [0, 0], bicepB = [-halfB, capH], bicepF = [halfF, capH];

    var hemHalfB = halfB - K.sleeveHemInset, hemHalfF = halfF - K.sleeveHemInset;
    var hemEndB = [-hemHalfB, sleeveLen + K.sleeveHemDrop];
    var hemEndF = [hemHalfF, sleeveLen + K.sleeveHemDrop];
    var hemMidB = [-hemHalfB / 2, sleeveLen];                // 2등분점 (중심선 ↔ 밑단 끝)
    var hemMidF = [hemHalfF / 2, sleeveLen];

    // 마크 — 상단은 정점에서 수평 AH/8, 하단은 소매폭 끝에서 안쪽으로
    var markTopB = [-AH / 8, 0],  markTopF = [AH / 8, 0];
    var markBotB = [-halfB + (AH / 12 + 0.6), capH];
    var markBotF = [halfF - AH / 8, capH];

    // 각 마크에서 대각선에 수선 → 발점. 곡선은 발점↔마크 사이 capBulge 비율 지점을 지난다
    // (66호 DXF: 수선 길이의 정확히 1/2 지점 — 뒤 하단 1.227/1.229, 앞 1.482/1.482·1.485 일치)
    var fTB = footOn(bicepB, markTopB), fBB = footOn(bicepB, markBotB);
    var fTF = footOn(bicepF, markTopF), fBF = footOn(bicepF, markBotF);
    var mixP = function (f, mk) { return _lerp(f.foot, mk, K.capBulge); };
    var pTB = mixP(fTB, markTopB), pBB = mixP(fBB, markBotB);
    var pTF = mixP(fTF, markTopF), pBF = mixP(fBF, markBotF);

    // 소매산 곡선 — 정점에서 수평 출발, 상단 볼록점 → 하단 오목점 → 소매폭 끝
    var capBack  = through([apex, pTB, pBB, bicepB], [-1, 0], null, K.capTension);
    var capFront = through([apex, pTF, pBF, bicepF], [ 1, 0], null, K.capTension);

    // 밑단 — 중앙은 수평, 2등분점부터 끝까지 0.5 하강 (2등분점에서 수평 접선)
    var hemBack  = hemCurve(hemMidB, hemEndB);
    var hemFront = hemCurve(hemMidF, hemEndF);

    var capLenBack = sLen(capBack), capLenFront = sLen(capFront);
    return {
      AH: AH, AHb: AHb, AHf: AHf, capReduce: capReduce, sleeveLen: sleeveLen,
      sleeveType: stKey, typeName: ST.name,
      underLenB: V.dist(bicepB, hemEndB), underLenF: V.dist(bicepF, hemEndF),   // 밑선(직선) 길이
      capH: capH, diagB: diagB, diagF: diagF, halfB: halfB, halfF: halfF,
      hemHalfB: hemHalfB, hemHalfF: hemHalfF,
      apex: apex, bicepB: bicepB, bicepF: bicepF,
      hemEndB: hemEndB, hemEndF: hemEndF, hemMidB: hemMidB, hemMidF: hemMidF,
      markTopB: markTopB, markTopF: markTopF, markBotB: markBotB, markBotF: markBotF,
      footTopB: fTB, footBotB: fBB, footTopF: fTF, footBotF: fBF,
      pTB: pTB, pBB: pBB, pTF: pTF, pBF: pBF,
      capBack: capBack, capFront: capFront, hemBack: hemBack, hemFront: hemFront,
      capLenBack: capLenBack, capLenFront: capLenFront, capLenTotal: capLenBack + capLenFront,
      capEase: capLenBack + capLenFront - AH
    };
  }

  /** 밑단 2등분점 → 끝점, 2등분점에서 수평 접선인 완만한 하강 곡선 (단일 큐빅) */
  function hemCurve(mid, end) {
    var W = end[0] - mid[0], D = end[1] - mid[1];
    return [{ p0: mid, c1: [mid[0] + W * K.hemC1, mid[1]],
              c2: [end[0] - W * K.hemC2x, end[1] - D * K.hemC2y], p1: end }];
  }

  function sleevePiece(s, seam) {
    var edges = [
      { name: '앞 소매산',   role: 'armhole',   segs: s.capFront },
      { name: '앞 밑선',     role: 'side',      segs: lineSegs(s.bicepF, s.hemEndF) },
      { name: '앞 밑단',     role: 'sleeveHem', segs: revSegs(s.hemFront) },
      { name: '밑단 중앙',   role: 'sleeveHem', segs: lineSegs(s.hemMidF, s.hemMidB) },
      { name: '뒤 밑단',     role: 'sleeveHem', segs: s.hemBack },
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
      notches: [
        { p: cp(s.apex), angle: 90,           label: '소매산 정점' },
        { p: cp(s.pBB),  angle: inward(s.pBB), label: '뒤 합인' },
        { p: cp(s.pBF),  angle: inward(s.pBF), label: '앞 합인' },
        { p: cp(s.hemMidB), angle: -90,        label: '뒤 밑단 2등분' },
        { p: cp(s.hemMidF), angle: -90,        label: '앞 밑단 2등분' }
      ],
      bbox: bboxOf(loop.pts)
    };
  }

  function sleeveInternal(s) {
    return [
      L('bicep',    'line',   [s.bicepB, s.bicepF], '소매통선'),
      L('center',   'dashed', [[0, 0], [0, s.sleeveLen]], '중심선'),
      L('diagBack', 'dashed', [s.apex, s.bicepB], '뒤 대각선'),
      L('diagFront','dashed', [s.apex, s.bicepF], '앞 대각선'),
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
    ];
  }

  function sleeveNotes(s) {
    var mid = s.sleeveLen * 0.55;
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
      FN('hemLine',  '밑단폭',     '소매통 − 들임 1.5×2 (교재 규정)',     s.hemHalfB + s.hemHalfF, 'sleeve', [0, s.sleeveLen]),
      FN('capBack',  '뒤 소매산',  '곡선길이 (≥ 뒤AH ' + f1(s.AHb) + ')', s.capLenBack,  'sleeve', [-s.halfB * 0.55, s.capH * 0.35]),
      FN('capFront', '앞 소매산',  '곡선길이 (≥ 앞AH ' + f1(s.AHf) + ')', s.capLenFront, 'sleeve', [s.halfF * 0.55, s.capH * 0.35]),
      FN('apexPt',   '이세분',     '소매산 곡선길이 − AH',              s.capEase, 'sleeve', [0, 1.2])
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
    var tm = rotv(V.norm(V.sub(SNP, BNP)), C.mt);       // 현(BNP→SNP)에서 mt도 회전
    /* 끝접선 — 이 원형의 뒷목은 어깨선에 **수직으로 도착하지 않는다**
       (66호 DXF 실측 −58.05°, 어깨 수직이면 −71.38°). 어깨 수직에서 et 도 돌려 맞춘다. */
    var pin = rotv(perpToward(shDir, SNP, BNP), C.et || 0);
    return [
      { p0: BNP, c1: [BNP[0] + W * C.h0, BNP[1]], c2: V.sub(Mp, V.mul(tm, W * C.h1)), p1: Mp },
      { p0: Mp,  c1: V.add(Mp, V.mul(tm, W * C.h2)),  c2: V.add(SNP, V.mul(pin, W * C.h3)), p1: SNP }
    ];
  }

  /** 앞 목선 : CF(수평 출발) → 목 구성 사각 대각선 2/3 점 → 목옆점(어깨선에 수직 도착) — 2 큐빅
   *  대각선 2/3 점은 66호 DXF 의 원호/스플라인 접합점과 정확히 일치한다 (4.8667, 5.0667). */
  function curveFrontNeck(FNP, SNP, shDir, nw) {
    var C = CAL.frontNeck;
    var dep = FNP[1];                                            // 앞목깊이 = B/12+0.3
    var Mp = [nw * K.neckDiagRatio, dep * K.neckDiagRatio];      // 목 구성 사각 대각선 2/3 점
    var diag = V.norm([nw, dep]);
    var tm = rotv([diag[1], -diag[0]], C.mt);                    // 대각선 수직에서 mt도 회전
    var pin = rotv(perpToward(shDir, SNP, FNP), C.et || 0);      // 어깨 수직에서 et 도
    return [
      { p0: FNP, c1: [FNP[0] + nw * C.h0, FNP[1]], c2: V.sub(Mp, V.mul(tm, nw * C.h1)), p1: Mp },
      { p0: Mp,  c1: V.add(Mp, V.mul(tm, nw * C.h2)), c2: V.add(SNP, V.mul(pin, nw * C.h3)), p1: SNP }
    ];
  }

  /** 암홀 : 겨드랑(수평 출발) → 오목점 hollow → 품점(품선 2등분점, 세로 접선)
   *          → 접점 T → 어깨점 (T~SP 는 **직선**)
   *
   *  66호 DXF 로 확인한 이 원형의 암홀 구조 —
   *   ① 어깨점에서 어깨선에 **수직으로 내린 직선**이 품선과 만나는 점까지가 안내선이고
   *      (뒤 5.637 = DXF LINE (17.2,6.548)-(19,1.206) · 앞 5.273 = LINE (16,9.037)-(17.864,4.105)),
   *      암홀 윗부분은 그 직선 위를 그대로 지난다 (DXF 편차 0.0003 cm).
   *   ② 암홀은 품선의 2등분점에서 품선에 **접한다** (뒤 (17.2,10.8) 편차 0.0003 cm).
   *  → 직선 구간 T~SP 를 따로 두어야 곡선 하나로 뭉개지 않는다.
   *
   *  앵커 위치·핸들 길이는 전부 dx(품선→옆선) · dy(어깨점→BL) 스팬 대비 비율이라
   *  호수에 따라 자연스럽게 스케일된다.
   *  앞·뒤 모두 "x 는 중심선에서 옆선 쪽 +" 로컬 좌표라 같은 식을 쓴다. */
  function curveArmhole(U, SP, shDir, pitchXm, pitchY, BL, back) {
    var C = back ? CAL.backArm : CAL.frontArm;
    var dy = BL - SP[1];                                       // 어깨점 → BL 세로 스팬
    var dx = U[0] - pitchXm;                                   // 품선 → 옆선 가로 스팬
    /* 품점 = **품선의 2등분점** (도면 `중심 2등분`). 66호 DXF 에서 뒤 암홀이
       등품선 2등분점 (17.2, 10.8) 을 편차 0.0003 cm 로 지나는 것을 확인했다.
       pdx·pdy 는 그 점에서의 미세 보정(무차원)이다. */
    var P = [pitchXm + C.pdx * dx, pitchY + C.pdy * dy];       // 품점
    var H = [U[0] - C.hdx * dx, BL - C.hdy * dy];              // 오목점 hollow
    var tm = rotv(V.norm(V.sub(P, U)), C.hth);                 // hollow 접선 = 현(U→P) 에서 hth도
    var pin = perpToward(shDir, SP, U);                        // 어깨선 수직, 조각 안쪽
    /* 어깨점에서 어깨선에 수직으로 내린 직선이 품선과 만날 때까지의 거리 */
    var sQ = Math.abs(pin[0]) > 1e-6 ? (pitchXm - SP[0]) / pin[0] : dy;
    if (!isFinite(sQ) || sQ <= 0.2) sQ = dy;
    var T = V.add(SP, V.mul(pin, sQ * C.tR));                  // 곡선이 그 직선에 접하는 점
    var pv = rotv([0, 1], C.pt || 0);                          // 품점 접선 — 세로에서 pt 도
    return [
      { p0: U, c1: [U[0] - C.h0 * dx, U[1]], c2: V.sub(H, V.mul(tm, C.h1 * dy)), p1: H },
      { p0: H, c1: V.add(H, V.mul(tm, C.h2 * dy)), c2: V.add(P, V.mul(pv, C.h3 * dy)), p1: P },
      { p0: P, c1: V.sub(P, V.mul(pv, C.h4 * dy)), c2: V.add(T, V.mul(pin, C.h5 * dy)), p1: T },
      { p0: T, c1: _lerp(T, SP, 1 / 3), c2: _lerp(T, SP, 2 / 3), p1: SP }   // 직선 구간
    ];
  }

  /* ── 곡선 캘리브레이션 상수 ──────────────────────────────────────────
   *  66호 원본 DXF(dxf-66-groundtruth.json) 폴리라인에 대한 최대편차를
   *  최소화하도록 적합한 값. 모두 무차원 비율/각도(도)이므로 44~88호에서도
   *  같은 모양이 유지된다.  재적합: node engine-verify.js --calibrate         */
  var CAL = {
    backNeck : { mx: 0.684360, my: 0.171795, mt: 2.567098, et: 9.391350, h0: 0.225975, h1: 0.183573, h2: 0.049407, h3: 0.280296 },
    frontNeck: { mt: -6.182503, et: -1.128876, h0: 0.359261, h1: 0.102646, h2: 0.172661, h3: 0.405875 },
    backArm  : { pdx: -0.006039, pdy: 0.000000, pt: 0.784335, hdx: 0.421482, hdy: 0.020323, hth: -28.977293, tR: 0.281445, h0: 0.040327, h1: 0.035878, h2: 0.139686, h3: 0.054153, h4: 0.206202, h5: 0.093916 },
    frontArm : { pdx: -0.000241, pdy: -0.070886, pt: -1.065325, hdx: 0.970840, hdy: 0.333172, hth: 22.099420, tR: 0.053238, h0: 0.096528, h1: 0.346931, h2: 0.326745, h3: 0.120189, h4: 0.064717, h5: 0.031283 }
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
      FN('bustDart', '다트 다리',     '위 −0.3 · 아래 +0.3 (트루잉)', g.rL,      'front', cp(g.dLo)),
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
            rotv: rotv, perpToward: perpToward, revSegs: revSegs, pointOnRayAtDist: pointOnRayAtDist }
  };
});
