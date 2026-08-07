/* ============================================================================
 * 기본 무다트 원형 (문화식) — 제도 엔진
 *   · 새로운 기본 무다트 앞면원형(시니어) p.31 / 어깨다트 없는 뒷면원형 p.34
 *   · SPEC.md §1 좌표계 · §2 치수 · §3 계산식 · §8 인터페이스 계약 준수
 *
 * 좌표계: cm. x = 중심선(CB/CF)에서 옆선 방향 +, y = 상단 기준선에서 아래 +
 *         조각마다 자기 로컬 원점(뒤판 = CB×상단선, 앞판 = CF×상단선)
 *
 * 노출: window.NoDartEngine / module.exports  (ES module import 금지, 외부 lib 없음)
 * 곡선: draft-bunka-fs.js 의 V / bez / bezLen / through / sPath / LN 유틸을 이식해
 *       Freesewing(Brian block) 계열 3차 베지어로 목선·암홀을 생성.
 *       핸들 길이·끝접선 각도는 66호 원본 DXF(dxf-66-groundtruth.json)에 맞춰
 *       캘리브레이션했고, 전부 무차원 비율이라 호수가 바뀌어도 자기유사하게 스케일된다.
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NoDartEngine = api;
  else if (root) root.NoDartEngine = api;
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
   * 2. 제도 상수 (SPEC §3 + 66호 DXF 실측 캘리브레이션)
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;          // outline/seamline 폴리라인 간격 (cm) — 요구 0.05 이하
  var K = {
    /* ── 공통 ── */
    armDepthEase : 0.6,        // 가슴선 BL = B/4 + 0.6
    fixedX       : 23.5,       // 고정치수선 (전 호수 고정)
    frontRise    : 1.0,        // 앞 상단기준선이 뒤 상단기준선보다 1.0 위 (DXF 절대좌표 실측)

    /* ── 뒤판 ── */
    backSideEase : 1.9,        // 옆선 x = B/4 + 1.9
    backNeckRise : 0.3,        // 뒷목 중심점 y = −0.3
    backNeckLift : 3.5,        // 뒷목 옆점 올림 3.5 (목너비 사각 모서리)
    backShDrop   : 3.1,        // 어깨선이 고정치수선(x=23.5)과 만나는 y
    backNeckExt  : 1.0,        // 목옆점 = 사각 모서리에서 어깨선 바깥으로 1.0 (도면 `1(⅜)`)
    shTipExt     : 0.6,        // 어깨점 세로 안내선 x = 어깨너비/2 + 0.6  (DXF 20.35 실측)

    /* ── 앞판 ── */
    frontSideEase: 1.5,        // 옆선 x = B/4 + 1.5  (DXF 23.5 는 반올림 — SPEC §3.2 ※)
    frontNeckLift: 0.6,        // CF 상단 올림 / 앞목 옆점 y = −0.6
    frontNeckDeep: 0.3,        // 앞목 깊이 = B/12 + 0.3
    frontShDrop  : 5.4,        // 앞 어깨선이 고정치수선(x=23.5)과 만나는 y
    frontDrop    : 1.3,        // 앞내림분 (CF 밑단 = 등길이 + 1.3)
    frontHemRise : 1.0,        // 옆선 밑단 = 등길이 + 1.0 (뒤 WL 과 같은 높이)
    hemFlatX     : 5.4,        // 밑단 수평 구간 끝 x (SPEC §3.2) — 여기부터 CF 까지 곡선 하강
    neckDiagRatio: 2 / 3,      // 앞목 곡선은 목 구성 사각 대각선의 2/3 지점을 지난다 (DXF 정확 일치)

    /* ── 반소매 (SPEC §3.4) ── */
    capReduce      : 0,        // 대각선 감소량 0~1. QA 실측 이세분 ≈ 1.65 − 2·capReduce → 기본 0
    sleeveHemInset : 1.5,      // 밑단 들임 (좌우 각)
    sleeveHemDrop  : 0.5,      // 밑단 2등분점 → 끝 하강량
    capBulge       : 0.45,     // 곡선 통과점 = 대각선 발점 ↔ 마크 사이의 비율.
                               //   원본 DXF 는 정확히 1/2(수선 3.150/2.453/2.964/2.964 → 오프셋
                               //   1.50/1.23/1.48/1.49)이지만, 교재식 AH/8·AH/12+0.6 마크를
                               //   이 몸판 AH 에 적용하면 수선이 더 길어져(3.42/2.63/3.48/3.48)
                               //   1/2 로는 오프셋이 1.71~1.74 로 과해진다. 0.45 를 쓰면
                               //   오프셋 1.54/1.18/1.57/1.57 로 SPEC §3.4 표(±0.09)에 더 가깝고
                               //   이세분도 전 호수 PASS 대역(1.0~2.5)에 들어온다.
    capTension     : 0.42,     // 소매산 통과점 베지어 장력 (through 기본값)
    hemC1: 0.25, hemC2x: 0.18, hemC2y: 0.025,  // 밑단 하강 곡선 핸들
                               //   (DXF 밑단 정규화 형상에 적합 — 최대편차 0.040 cm)

    /* ── 앞 밑단 캘리브레이션 ──
     * hemStyle 'curve' : CF→옆선 전폭 완만곡선 (원본 DXF poly2 재현) — **기본값**
     *                    SPEC §9-1 총괄 결정. DXF 편차 0.005 (spec 방식은 0.285).
     * hemStyle 'spec'  : 수평 구간 + 앞내림 S곡선 (§3.2 구판 표기 — 폐기됨. 호환용으로만 유지) */
    hemDropH  : 0.45,                                   // S곡선 핸들 / 수평구간 길이
    /* 양 끝 접선 모두 수평 — CF 골선에 직각이고, 옆선(수직)에도 직각이라
       앞뒤를 옆선에서 붙였을 때 뒤 허리선과 꺾임 없이 이어진다.
       원본 DXF 앞밑단(curves[2]) 대비 최대편차 0.0316 cm. */
    hemH0: 0.83, hemH1: 0.15, hemA1: 0
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도
   * ════════════════════════════════════════════════════════════════ */
  /** 제도점 + 곡선만 계산 (폴리라인 flatten 없음). draftNoDart 와 engine-verify 가 공유. */
  function geom(m, opt) {
    opt = opt || {};
    var shEase = (opt.shoulderEase === undefined) ? 0.95 : +opt.shoulderEase; // 뒷어깨 이세분
    var fSideEase = (opt.frontSideEase === undefined) ? K.frontSideEase : +opt.frontSideEase;
    MEAS_KEYS.forEach(function (k) {
      if (typeof m[k] !== 'number' || !isFinite(m[k])) throw new Error('치수 누락/오류: ' + k);
    });

    var B = m.B, nw = B / 12;
    var AD = B / 4 + K.armDepthEase;            // 가슴선 BL (뒤판 기준)
    var WL = m.backLen;

    /* ───────── 뒤판 ───────── */
    var bSideX = B / 4 + K.backSideEase;
    var bPitchX = m.backW / 2;
    var bSpX = m.shoulderW / 2 + K.shTipExt;
    var BNP = [0, -K.backNeckRise];
    var bNeckCorner = [nw, -K.backNeckLift];                       // 목너비 사각 모서리
    var bShDir = V.norm(V.sub([K.fixedX, K.backShDrop], bNeckCorner));
    var SNPb = V.add(bNeckCorner, V.mul(bShDir, K.backNeckExt));   // 실제 목옆점
    var SPb = [bSpX, bNeckCorner[1] + (bShDir[1] / bShDir[0]) * (bSpX - bNeckCorner[0])];
    var Ub = [bSideX, AD];                                          // 겨드랑 (옆선 × BL)
    var bWaist = [bSideX, WL];
    var shLenBack = V.dist(bNeckCorner, SPb);                       // SPEC §3.1 실측 정의(사각 모서리 기준)
    var shLenBackSeam = V.dist(SNPb, SPb);                          // 실제 봉제 어깨솔기 길이

    /* ───────── 앞판 ───────── */
    var BLf = AD + K.frontRise;
    var fSideX = B / 4 + fSideEase;
    var fPitchX = m.frontW / 2;
    var SNPf = [nw, -K.frontNeckLift];
    var FNP = [0, nw + K.frontNeckDeep];
    var fShDir = V.norm(V.sub([K.fixedX, K.frontShDrop], SNPf));
    var shLenFront = shLenBack - shEase;
    var SPf = V.add(SNPf, V.mul(fShDir, shLenFront));
    var shLenFrontSeam = V.dist(SNPf, SPf);                         // 실제 봉제 어깨솔기 길이 (앞은 목옆점 = 구성점)
    var Uf = [fSideX, BLf];
    var fSideHem = [fSideX, WL + K.frontHemRise];   // 등길이+1.0 = 뒤 WL 과 같은 높이 → 옆선 길이 일치
    var fCFHem = [0, WL + K.frontDrop];             // 등길이+1.3 (앞내림분)
    var BP = [m.bpSpan / 2, SNPf[1] + m.bpLen];     // 유폭/2 · y = 유장 − 0.6 (CF 상단점에서 수직 유장)

    /* ───────── 곡선 ───────── */
    var backNeck = curveBackNeck(BNP, SNPb, bShDir);
    var backArm = curveArmhole(Ub, SPb, bShDir, bPitchX, AD, true);
    var frontNeck = curveFrontNeck(FNP, SNPf, fShDir, nw);
    var frontArm = curveArmhole(Uf, SPf, fShDir, fPitchX, BLf, false);
    var frontHem = curveFrontHem(fCFHem, fSideHem, opt.hemStyle || 'curve');

    return {
      m: m, shEase: shEase, nw: nw, AD: AD, WL: WL, BLf: BLf,
      bSideX: bSideX, bPitchX: bPitchX, bSpX: bSpX, bShDir: bShDir, bNeckCorner: bNeckCorner,
      BNP: BNP, SNPb: SNPb, SPb: SPb, Ub: Ub, bWaist: bWaist,
      shLenBack: shLenBack, shLenBackSeam: shLenBackSeam, shLenFront: shLenFront, shLenFrontSeam: shLenFrontSeam,
      fSideX: fSideX, fPitchX: fPitchX, fShDir: fShDir,
      SNPf: SNPf, FNP: FNP, SPf: SPf, Uf: Uf, fSideHem: fSideHem, fCFHem: fCFHem, BP: BP,
      backNeck: backNeck, backArm: backArm, frontNeck: frontNeck, frontArm: frontArm, frontHem: frontHem
    };
  }

  function draftNoDart(m, opt) {
    opt = opt || {};
    var seam = (opt.seam === undefined) ? 0 : opt.seam;   // 숫자 = 균일 · 객체 = role 별 (SPEC §11-1)
    var g0 = geom(m, opt);
    var nw = g0.nw, AD = g0.AD, WL = g0.WL, BLf = g0.BLf;
    var bSideX = g0.bSideX, bPitchX = g0.bPitchX, bSpX = g0.bSpX;
    var bNeckCorner = g0.bNeckCorner, bShDir = g0.bShDir, fShDir = g0.fShDir;
    var BNP = g0.BNP, SNPb = g0.SNPb, SPb = g0.SPb, Ub = g0.Ub, bWaist = g0.bWaist;
    var fSideX = g0.fSideX, fPitchX = g0.fPitchX;
    var SNPf = g0.SNPf, FNP = g0.FNP, SPf = g0.SPf, Uf = g0.Uf;
    var fSideHem = g0.fSideHem, fCFHem = g0.fCFHem, BP = g0.BP;
    var shLenBack = g0.shLenBack, shLenBackSeam = g0.shLenBackSeam, shLenFront = g0.shLenFront;
    var shLenFrontSeam = g0.shLenFrontSeam;
    var shEase = g0.shEase;
    var backNeck = g0.backNeck, backArm = g0.backArm;
    var frontNeck = g0.frontNeck, frontArm = g0.frontArm, frontHem = g0.frontHem;

    /* ───────── 조각 조립 ───────── */
    var backEdges = [
      { name: '뒷목둘레', role: 'neck',     segs: backNeck },
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(SNPb, SPb) },
      { name: '뒤암홀',   role: 'armhole',  segs: revSegs(backArm) },        // SP → 겨드랑
      { name: '옆선',     role: 'side',     segs: lineSegs(Ub, bWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(bWaist, [0, WL]) },
      { name: '뒤중심',   role: 'fold',     segs: lineSegs([0, WL], BNP) }   // CB = 골선 (시접 0)
    ];
    var frontEdges = [
      { name: '앞목둘레', role: 'neck',     segs: frontNeck },
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(SNPf, SPf) },
      { name: '앞암홀',   role: 'armhole',  segs: revSegs(frontArm) },
      { name: '옆선',     role: 'side',     segs: lineSegs(Uf, fSideHem) },
      { name: '밑단',     role: 'hem',      segs: revSegs(frontHem) },        // 옆선 → CF
      { name: '앞중심',   role: 'fold',     segs: lineSegs(fCFHem, FNP) }     // CF = 골선 (시접 0)
    ];

    var backLoop = edgesToLoop(backEdges), frontLoop = edgesToLoop(frontEdges);
    var backOutline = backLoop.pts, frontOutline = frontLoop.pts;
    var backSeam = buildSeamline(backLoop, seam), frontSeam = buildSeamline(frontLoop, seam);

    var backPiece = {
      id: 'back', name: '뒷판', cutCount: 2,
      grainline: [[1.5, 2.0], [1.5, WL - 2.0]],
      outline: backOutline,
      seamline: backSeam.seamline,
      foldEdges: backSeam.foldEdges,          // outline 인덱스 기준 골선 구간
      seamEdges: backSeam.seamEdges,          // seamline 인덱스 기준 변 구간 {role,name,seam,start,end}
      seamFoldEdges: backSeam.seamFoldEdges,  // seamline 인덱스 기준 골선 구간
      seamByRole: backSeam.seamByRole,        // 실제 적용된 role 별 시접 cm
      edges: withSeam(backLoop.ranges, backSeam.edgeSeam),
      internal: backInternal(m, { AD: AD, WL: WL, sideX: bSideX, pitchX: bPitchX, spX: bSpX,
        BNP: BNP, corner: bNeckCorner, SNP: SNPb, SP: SPb, U: Ub, nw: nw })
        .concat(backEdgeInternals({ U: Ub, waist: bWaist, WL: WL, sideX: bSideX,
          SNP: SNPb, SP: SPb, arm: backArm, neck: backNeck })),
      notches: [
        { p: cp(SPb),  angle: angDeg(perpToward(bShDir, SPb, Ub)),  label: '어깨점' },
        { p: cp(SNPb), angle: angDeg(perpToward(bShDir, SNPb, BNP)), label: '목옆점' },
        { p: cp(Ub),   angle: 180,                                   label: '옆선 BL' }
      ],
      bbox: bboxOf(backOutline)
    };
    var frontPiece = {
      id: 'front', name: '앞판', cutCount: 2,
      grainline: [[1.5, 4.0], [1.5, WL - 2.0]],
      outline: frontOutline,
      seamline: frontSeam.seamline,
      foldEdges: frontSeam.foldEdges,
      seamEdges: frontSeam.seamEdges,
      seamFoldEdges: frontSeam.seamFoldEdges,
      seamByRole: frontSeam.seamByRole,
      edges: withSeam(frontLoop.ranges, frontSeam.edgeSeam),
      internal: frontInternal(m, { BL: BLf, WL: WL, sideX: fSideX, pitchX: fPitchX,
        SNP: SNPf, FNP: FNP, SP: SPf, U: Uf, BP: BP, nw: nw, cfHem: fCFHem, sideHem: fSideHem })
        .concat(frontEdgeInternals({ U: Uf, sideHem: fSideHem, cfHem: fCFHem,
          SNP: SNPf, SP: SPf, arm: frontArm, neck: frontNeck })),
      notches: [
        { p: cp(SPf),  angle: angDeg(perpToward(fShDir, SPf, Uf)),   label: '어깨점' },
        { p: cp(SNPf), angle: angDeg(perpToward(fShDir, SNPf, FNP)), label: '목옆점' },
        { p: cp(Uf),   angle: 180,                                    label: '옆선 BL' }   // 조각 안쪽 = −x
      ],
      bbox: bboxOf(frontOutline)
    };

    var AHb = sLen(backArm), AHf = sLen(frontArm);
    var NKb = sLen(backNeck), NKf = sLen(frontNeck);
    var sideBack = V.dist(Ub, bWaist), sideFront = V.dist(Uf, fSideHem);

    /* ───────── 반소매 (SPEC §3.4) ───────── */
    var slv = (opt.includeSleeve === false) ? null : sleeveGeom(m, opt, AHb, AHf);
    var pieces = [backPiece, frontPiece];
    if (slv) pieces.push(sleevePiece(slv, seam));

    return {
      pieces: pieces,
      measures: {
        shoulderBack: r4(shLenBack),
        shoulderFront: r4(shLenFront),
        shoulderEase: r4(shEase),
        // SPEC §9-3 1차 검사용 — 뒷목 곡선이 어깨선 1.0 연장점에서 끝나므로
        // 실제 봉제 솔기는 목옆점(SNP) 기준이다. |뒤 − 앞| ≤ 0.10 이어야 한다.
        shoulderBackSeam: r4(shLenBackSeam),
        shoulderFrontSeam: r4(shLenFrontSeam),
        armholeBack: r4(AHb), armholeFront: r4(AHf), armholeTotal: r4(AHb + AHf),
        neckBack: r4(NKb), neckFront: r4(NKf), neckTotal: r4(NKb + NKf),
        sideBack: r4(sideBack), sideFront: r4(sideFront),
        /* ── 반소매 (SPEC §3.4) — UI 계산결과에 표시 ── */
        sleeveCapEase:  slv ? r4(slv.capLenTotal - (AHb + AHf)) : null,  // 이세분 (판정값)
        sleeveWidth:    slv ? r4(slv.halfB + slv.halfF) : null,
        capHeight:      slv ? r4(slv.capH) : null,
        sleeveHemWidth: slv ? r4(slv.hemHalfB + slv.hemHalfF) : null,
        sleeveLen:        slv ? r4(slv.sleeveLen) : null,
        sleeveCapLenBack: slv ? r4(slv.capLenBack) : null,
        sleeveCapLenFront: slv ? r4(slv.capLenFront) : null,
        sleeveCapLenTotal: slv ? r4(slv.capLenTotal) : null,
        capReduce:        slv ? r4(slv.capReduce) : null
      },
      size: sizeNameOf(m),
      points: {   // 검증·주석용 주요 제도점 (계약 외 추가 정보)
        back:  { BNP: cp(BNP), neckCorner: cp(bNeckCorner), SNP: cp(SNPb), SP: cp(SPb), U: cp(Ub),
                 waist: cp(bWaist), BL: AD, WL: WL, sideX: bSideX, pitchX: bPitchX, spGuideX: bSpX },
        front: { FNP: cp(FNP), SNP: cp(SNPf), SP: cp(SPf), U: cp(Uf), BP: cp(BP),
                 cfHem: cp(fCFHem), sideHem: cp(fSideHem), BL: BLf, WL: WL, sideX: fSideX, pitchX: fPitchX }
      },
      curves: {   // 베지어 원본 (출력팀은 outline 폴리라인만 써도 됨)
        backNeck: backNeck, backArm: backArm, frontNeck: frontNeck, frontArm: frontArm, frontHem: frontHem,
        sleeveCapBack: slv ? slv.capBack : null, sleeveCapFront: slv ? slv.capFront : null,
        sleeveHemBack: slv ? slv.hemBack : null, sleeveHemFront: slv ? slv.hemFront : null
      },
      sleeve: slv,   // 소매 제도점 전부 (검증·주석용)
      meta: {
        hemStyle: opt.hemStyle || 'curve',
        formulaNotes: formulaNotes(m, {
          AD: AD, WL: WL, nw: nw, bSideX: bSideX, fSideX: fSideX, BLf: BLf,
          bPitchX: bPitchX, fPitchX: fPitchX, bSpX: bSpX, shLenBack: shLenBack,
          shLenFront: shLenFront, shEase: shEase, BP: BP, seam: seam,
          SNPb: SNPb, SPb: SPb, SNPf: SNPf, SPf: SPf,
          AHb: AHb, AHf: AHf, NKb: NKb, NKf: NKf
        }).concat(slv ? sleeveNotes(slv) : [])
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 3-S. 반소매 (소매 원형) — SPEC §3.4
   *   로컬 원점 = 소매산 정점. x 오른쪽 +(앞) / 왼쪽 −(뒤), y 아래 +.
   *   AH·뒤AH·앞AH 는 몸판 draft 에서 자동 산출 (사용자 입력 아님).
   * ════════════════════════════════════════════════════════════════ */

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
    // 소매길이: 66호 25.0, 호수당 +0.5 (B 는 호수당 +6 → /12)
    var sleeveLen = (opt.sleeveLen === undefined) ? 25.0 + (m.B - BASE.B) / 12 : +opt.sleeveLen;

    var capH = AH / 4 + 2;                                   // 소매산 높이
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
      FN('center',   '소매길이',   '66호 25.0 · 호수당 +0.5',           s.sleeveLen, 'sleeve', [0, mid]),
      FN('hemLine',  '밑단폭',     '소매통 − 들임 1.5×2',               s.hemHalfB + s.hemHalfF, 'sleeve', [0, s.sleeveLen]),
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
    var pin = perpToward(shDir, SNP, BNP);              // 어깨선에 수직, 목 안쪽 방향
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
    var pin = perpToward(shDir, SNP, FNP);
    return [
      { p0: FNP, c1: [FNP[0] + nw * C.h0, FNP[1]], c2: V.sub(Mp, V.mul(tm, nw * C.h1)), p1: Mp },
      { p0: Mp,  c1: V.add(Mp, V.mul(tm, nw * C.h2)), c2: V.add(SNP, V.mul(pin, nw * C.h3)), p1: SNP }
    ];
  }

  /** 암홀 : 겨드랑(수평 출발) → 오목점 hollow → 품점(등품/앞품 접점) → 어깨점(어깨선 수직 도착)
   *  Freesewing fsArmhole 의 4앵커 3세그먼트 구조. 앵커 위치·핸들 길이는 전부
   *  dx(품선→옆선) · dy(어깨점→BL) 스팬 대비 비율이라 호수에 따라 자연스럽게 스케일된다.
   *  앞·뒤 모두 "x 는 중심선에서 옆선 쪽 +" 로컬 좌표라 같은 식을 쓴다. */
  function curveArmhole(U, SP, shDir, pitchXm, BL, back) {
    var C = back ? CAL.backArm : CAL.frontArm;
    var dy = BL - SP[1];                                       // 어깨점 → BL 세로 스팬
    var dx = U[0] - pitchXm;                                   // 품선 → 옆선 가로 스팬
    var P = [pitchXm + C.pdx * dx, SP[1] + C.pky * dy];        // 품점
    var H = [U[0] - C.hdx * dx, BL - C.hdy * dy];              // 오목점 hollow
    var tm = rotv(V.norm(V.sub(P, U)), C.hth);                 // hollow 접선 = 현(U→P) 에서 hth도
    var pin = perpToward(shDir, SP, U);
    return [
      { p0: U, c1: [U[0] - C.h0 * dx, U[1]], c2: V.sub(H, V.mul(tm, C.h1 * dy)), p1: H },
      { p0: H, c1: V.add(H, V.mul(tm, C.h2 * dy)), c2: [P[0], P[1] + C.h3 * dy], p1: P },
      { p0: P, c1: [P[0], P[1] - C.h4 * dy], c2: V.add(SP, V.mul(pin, C.h5 * dy)), p1: SP }
    ];
  }

  /** 앞 밑단 : CF → 옆선
   *  style 'spec'  — SPEC §3.2 : CF 밑단(등길이+1.3) 에서 x=5.4 까지 앞내림 S곡선으로
   *                  올라간 뒤, 옆선까지 y=등길이+1.0 수평. 양 끝 접선 모두 수평이라
   *                  CF 골선에 직각이고 수평 구간과도 꺾임 없이 이어진다.
   *  style 'curve' — 원본 DXF poly2(앞밑단 22점) 를 그대로 재현하는 전폭 완만곡선.
   *                  (DXF 대조 모드에서만 사용 — engine-README.md 의 '미해결 쟁점' 참고) */
  function curveFrontHem(cf, side, style) {
    if (style === 'curve') {
      var W = side[0] - cf[0];
      var tEnd = rotv([-1, 0], K.hemA1);
      return [{ p0: cf, c1: [cf[0] + W * K.hemH0, cf[1]], c2: V.add(side, V.mul(tEnd, W * K.hemH1)), p1: side }];
    }
    var kx = Math.min(K.hemFlatX, side[0] * 0.5);       // 수평 구간 시작점 x
    var knee = [kx, side[1]];
    var h = kx * K.hemDropH;
    return [
      { p0: cf, c1: [cf[0] + h, cf[1]], c2: [knee[0] - h, knee[1]], p1: knee },   // 앞내림 S곡선
      { p0: knee, c1: _lerp(knee, side, 1 / 3), c2: _lerp(knee, side, 2 / 3), p1: side }  // 수평 직선
    ];
  }

  /* ── 곡선 캘리브레이션 상수 ──────────────────────────────────────────
   *  66호 원본 DXF(dxf-66-groundtruth.json) 폴리라인에 대한 최대편차를
   *  최소화하도록 적합한 값. 모두 무차원 비율/각도(도)이므로 55·77호에서도
   *  같은 모양이 유지된다.  재적합: node engine-verify.js --calibrate         */
  var CAL = {
    /* 뒤 목선 — 스팬 W = 목옆점 x. mx·my = 중간 앵커의 (BNP→목옆점) 사각 내 비율,
       mt = 현에서의 중간 접선 회전각(도). 66호 DXF 최대편차 0.0038 cm */
    backNeck : { mx: 0.739689, my: 0.173472, mt: -0.476839,
                 h0: 0.253966, h1: 0.198616, h2: 0.253903, h3: 0.036665 },
    /* 앞 목선 — 스팬 = B/12. 중간 앵커는 목 사각 대각선 2/3 점(고정),
       mt = 대각선 수직에서의 회전각(도). 최대편차 0.0106 cm */
    frontNeck: { mt: -8.218831, h0: 0.108725, h1: 0.340544, h2: 0.288209, h3: 0.010292 },
    /* 암홀 — pdx·hdx 는 dx(품선→옆선), pky·hdy·h1~h5 는 dy(어깨점→BL) 대비 비율.
       hth = 현(겨드랑→품점)에서의 hollow 접선 회전각(도).
       뒤 최대편차 0.0319 cm · 앞 0.0387 cm */
    backArm  : { pdx: -0.011348, pky: 0.531304, hdx: 0.421482, hdy: 0.020323, hth: -32.156148,
                 h0: 0.243732, h1: 0.041917, h2: 0.139686, h3: 0.205414, h4: 0.120163, h5: 0.004000 },
    frontArm : { pdx: -0.000501, pky: 0.521973, hdx: 0.720336, hdy: 0.102838, hth: -1.629470,
                 h0: 0.438464, h1: 0.083725, h2: 0.065721, h3: 0.240844, h4: 0.133049, h5: 0.013419 }
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
  var SEAM_DEFAULT = { neck: 1.0, shoulder: 1.0, armhole: 1.0, side: 1.5, hem: 3.0, sleeveHem: 2.5, fold: 0 };
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

  function backInternal(m, g) {
    return [
      L('topLine',  'line',   [[0, 0], [K.fixedX, 0]], '상단 기준선'),
      L('BL',       'line',   [[0, g.AD], [g.sideX, g.AD]], 'BL'),
      L('backW',    'dashed', [[g.pitchX, 0], [g.pitchX, g.AD]], '등품선'),
      L('fixedX',   'dashed', [[K.fixedX, 0], [K.fixedX, K.backShDrop]], '고정치수선'),
      L('shGuide',  'dashed', [[g.spX, -1.2], [g.spX, g.SP[1] + 0.6]], '어깨 안내선'),
      L('neckW',    'dashed', [[g.nw, 0], [g.nw, -K.backNeckLift]], '뒷목너비'),
      L('neckRise', 'dashed', [[0, -K.backNeckLift], [g.nw, -K.backNeckLift]], '뒷목 올림'),
      L('neckExt',  'dashed', [g.corner, g.SNP], '목옆점 연장'),
      L('shExt',    'dashed', [g.SP, [K.fixedX, K.backShDrop]], '어깨선 연장'),
      L('SP',       'point',  [g.SP], 'SP'),
      L('SNP',      'point',  [g.SNP], 'SNP')
    ];
  }
  function frontInternal(m, g) {
    return [
      L('topLine',  'line',   [[0, 0], [K.fixedX, 0]], '상단 기준선'),
      L('cfRise',   'dashed', [[0, -K.frontNeckLift], [K.fixedX, -K.frontNeckLift]], 'CF 올림'),
      L('BL',       'line',   [[0, g.BL], [g.sideX, g.BL]], 'BL'),
      L('WL',       'dashed', [[0, g.WL], [g.sideX, g.WL]], '허리 안내선'),
      L('frontW',   'dashed', [[g.pitchX, -K.frontNeckLift], [g.pitchX, g.BL]], '앞품선'),
      L('neckW',    'dashed', [[g.nw, -K.frontNeckLift], [g.nw, g.FNP[1]]], '앞목너비'),
      L('neckD',    'dashed', [[0, g.FNP[1]], [g.nw, g.FNP[1]]], '앞목깊이'),
      L('neckDiag', 'dashed', [[0, 0], [g.nw, g.FNP[1]]], '목 사각 대각선'),
      L('shExt',    'dashed', [g.SP, [K.fixedX, K.frontShDrop]], '어깨선 연장'),
      L('bpLen',    'dashed', [g.SNP, g.BP], '유장'),
      L('bpSpan',   'dashed', [[g.BP[0], 0], [g.BP[0], g.BP[1]]], '유폭'),
      L('BP',       'point',  [g.BP], 'BP'),
      L('SP',       'point',  [g.SP], 'SP'),
      L('SNP',      'point',  [g.SNP], 'SNP')
    ];
  }
  function f1(v) { return (Math.round(v * 100) / 100).toString(); }

  /** 외곽선 변을 가리키는 internal 항목 — formulaNotes.id 가 전부 대응되도록.
   *  좌표는 외곽선과 완전히 겹치므로 도면이 달라지지 않고, UI 는 id 로 주석을 붙일 수 있다. */
  function subsamp(segs, n) {
    var p = sampleSegs(segs, 0.4), out = [], step = Math.max(1, Math.floor(p.length / (n || 40)));
    for (var i = 0; i < p.length; i += step) out.push(p[i]);
    if (out[out.length - 1] !== p[p.length - 1]) out.push(p[p.length - 1]);
    return out;
  }
  function backEdgeInternals(g) {
    return [
      L('side',     'line', [g.U, g.waist], '옆선'),
      L('WL',       'line', [[0, g.WL], [g.sideX, g.WL]], '허리선'),
      L('shBack',   'line', [g.SNP, g.SP], '어깨선'),
      L('armBack',  'line', subsamp(g.arm), '뒤 암홀'),
      L('neckBack', 'line', subsamp(g.neck), '뒷목둘레')
    ];
  }
  function frontEdgeInternals(g) {
    return [
      L('side',      'line',  [g.U, g.sideHem], '옆선'),
      L('shFront',   'line',  [g.SNP, g.SP], '어깨선'),
      L('armFront',  'line',  subsamp(g.arm), '앞 암홀'),
      L('neckFront', 'line',  subsamp(g.neck), '앞목둘레'),
      L('hemSide',   'point', [g.sideHem], '옆선 밑단'),
      L('hemCF',     'point', [g.cfHem], 'CF 밑단')
    ];
  }

  /** meta.formulaNotes — SPEC §8.1 확정 구조
   *  { id, label, formula, value, piece, anchor }  · id 로 internal 항목과 대응 */
  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }
  function formulaNotes(m, g) {
    var nw = g.nw;
    return [
      /* ── 뒤판 ── */
      FN('BL',       'BL',          'B/4 + 0.6',            g.AD,          'back',  [g.bSideX * 0.5, g.AD]),
      FN('WL',       '허리선',       '등길이',                 g.WL,          'back',  [g.bSideX * 0.5, g.WL]),
      FN('side',     '옆선',         'B/4 + 1.9',            g.bSideX,      'back',  [g.bSideX, (g.AD + g.WL) / 2]),
      FN('backW',    '등품선',       '등품/2',                g.bPitchX,     'back',  [g.bPitchX, g.AD * 0.62]),
      FN('fixedX',   '고정치수선',    '전 호수 고정',            K.fixedX,      'back',  [K.fixedX, K.backShDrop]),
      FN('shGuide',  '어깨 안내선',   '어깨너비/2 + 0.6',       g.bSpX,        'back',  [g.bSpX, 0.9]),
      FN('neckW',    '뒷목너비',      'B/12',                 nw,            'back',  [nw * 0.5, -K.backNeckLift]),
      FN('neckRise', '뒷목 올림',     '고정 3.5',              K.backNeckLift,'back',  [nw, -K.backNeckLift * 0.5]),
      FN('neckExt',  '목옆점 연장',   '어깨선 바깥 1.0',         K.backNeckExt, 'back',  cp(g.SNPb)),
      FN('shBack',   '뒤 어깨선',     '(B/12,−3.5) → (23.5, 3.1)', g.shLenBack, 'back', [(g.SNPb[0] + g.SPb[0]) / 2, (g.SNPb[1] + g.SPb[1]) / 2]),
      FN('armBack',  '뒤 암홀',      '곡선길이',               g.AHb,         'back',  [g.bPitchX + 1.0, g.AD * 0.55]),
      FN('neckBack', '뒷목둘레',      '곡선길이',               g.NKb,         'back',  [nw * 0.5, -0.9]),
      /* ── 앞판 ── */
      FN('BL',       'BL',          'B/4 + 1.6',            g.BLf,         'front', [g.fSideX * 0.5, g.BLf]),
      FN('WL',       '허리 안내선',   '등길이',                 g.WL,          'front', [g.fSideX * 0.5, g.WL]),
      FN('hemSide',  '옆선 밑단',     '등길이 + 1.0',           g.WL + K.frontHemRise, 'front', [g.fSideX * 0.75, g.WL + K.frontHemRise]),
      FN('hemCF',    'CF 밑단',      '등길이 + 1.3 (앞내림)',    g.WL + K.frontDrop, 'front', [1.2, g.WL + K.frontDrop]),
      FN('side',     '옆선',         'B/4 + 1.5',            g.fSideX,      'front', [g.fSideX, (g.BLf + g.WL) / 2]),
      FN('frontW',   '앞품선',       '앞품/2',                g.fPitchX,     'front', [g.fPitchX, g.BLf * 0.6]),
      FN('neckW',    '앞목너비',      'B/12',                 nw,            'front', [nw * 0.5, -K.frontNeckLift]),
      FN('neckD',    '앞목깊이',      'B/12 + 0.3',           nw + K.frontNeckDeep, 'front', [0.6, (nw + K.frontNeckDeep) * 0.5]),
      FN('bpLen',    '유장',         '앞목옆점에서 수직 유장',     m.bpLen,       'front', [(g.SNPf[0] + g.BP[0]) / 2, (g.SNPf[1] + g.BP[1]) / 2]),
      FN('bpSpan',   '유폭',         '유폭/2',                g.BP[0],       'front', [g.BP[0] * 0.5, g.BP[1] - 1.2]),
      FN('BP',       'BP',          '(유폭/2, 유장 − 0.6)',    g.BP[1],       'front', cp(g.BP)),
      FN('shFront',  '앞 어깨선',     '뒤 어깨선 − 이세 ' + f1(g.shEase), g.shLenFront, 'front', [(g.SNPf[0] + g.SPf[0]) / 2, (g.SNPf[1] + g.SPf[1]) / 2]),
      FN('armFront', '앞 암홀',      '곡선길이',               g.AHf,         'front', [g.fPitchX + 1.0, g.BLf * 0.55]),
      FN('neckFront','앞목둘레',      '곡선길이',               g.NKf,         'front', [nw * 0.45, (nw + 0.3) * 0.55]),
      FN('seam',     '시접',         '전 둘레 균일',            g.seam,        'both',  [0, 0])
    ];
  }

  /* ══════════════════════════════════════════════════════════════════
   * 6. 노출
   * ════════════════════════════════════════════════════════════════ */
  return {
    measuresForSize: measuresForSize,
    draftNoDart: draftNoDart,
    geom: geom,                       // 제도점·베지어만 (검증/캘리브레이션용)
    // 부가 (UI·출력·검증용)
    MEAS_KEYS: MEAS_KEYS, MEAS_LABEL: MEAS_LABEL, SIZES: Object.keys(SIZE_STEP),
    BASE: BASE, GRADE: GRADE, K: K, CAL: CAL, FLATTEN: FLATTEN,
    SEAM_DEFAULT: SEAM_DEFAULT, SEAM_ROLES: SEAM_ROLES,   // SPEC §11-1 role 별 기본 시접
    util: { V: V, bez: bez, bezLen: bezLen, sLen: sLen, through: through, sPath: sPath, LN: LN,
            sampleSegs: sampleSegs, polyLen: polyLen, offsetLoop: offsetLoop, offsetLoopSeg: offsetLoopSeg,
            normSeam: normSeam, lineSegs: lineSegs,
            rotv: rotv, perpToward: perpToward, revSegs: revSegs }
  };
});
