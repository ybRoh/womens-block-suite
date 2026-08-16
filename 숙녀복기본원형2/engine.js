/* ============================================================================
 * 숙녀복 기본원형 II — 제도 엔진
 *   · 교재 「숙녀복 기본원형 II」 제도 1(구성) · 제도 2(완성 조각)
 *   · 조각 2개 — 앞면(가슴다트) · 뒷면
 *
 * 좌표계: cm. x = 중심선(CB/CF)에서 옆선 방향 +, y = **각 조각 자기 상단선**에서 아래 +
 *         앞 상단선이 뒤 상단선보다 `앞 등길이 차이치수`(4) 만큼 위에 있어서,
 *         두 조각을 나란히 놓으면 허리선이 같은 높이에 온다.
 *
 * 노출: window.Bodice2Engine / module.exports (ES module import 금지, 외부 lib 없음)
 * ==========================================================================*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.Bodice2Engine = api; window.Bodice2Engine = api; }
  else if (root) root.Bodice2Engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** ★ 너치 틱이 조각 **밖**을 향하면 안쪽으로 돌린다 (SPEC §8.1).
   *  판정은 **틱 끝점의 point-in-polygon** — 그리는 것과 같은 방식이어야 한다.
   *  ⚠ 무게중심 방향으로 재면 **오목한 변(암홀·다트 입)에서 샌다** — 판정은 통과하는데
   *  실제 0.5cm 틱은 조각 밖이었다 (2026-08-12 QA 가 5개 모듈에서 찾았다).
   *  뒤집어도 안 되는 자리(목옆점 같은 모서리)는 5° 씩 돌려 가장 가까운 안쪽 방향을 쓴다. */
  function fixNotchDirs(pieces) {
    function inPoly(pt, poly) {
      var c = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var a = poly[i], b = poly[j];
        if ((a[1] > pt[1]) !== (b[1] > pt[1]) &&
            pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
      }
      return c;
    }
    var TICK = 0.5;
    /* ★ ① 너치를 **외곽선 위로 스냅**한다. 제도점과 실제 재단선이 조금 어긋나는 자리가
       있다(앞 밑단이 옆으로 처지면 허리다트 다리가 밑단선보다 0.2~0.3 위에 뜬다).
       너치는 재단선 위에 있어야 가위가 지나간다. 0.5 넘게 떨어진 것은 **점 자체가
       틀린 것**이므로 스냅하지 않고 검증기(suite-verify)가 잡도록 남긴다. */
    function snap(pt, o) {
      var best = null, bd = Infinity;
      for (var i = 1; i < o.length; i++) {
        var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        var t = L2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var q = [a[0] + t * dx, a[1] + t * dy], e = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
        if (e < bd) { bd = e; best = q; }
      }
      return bd <= 0.5 ? best : pt;
    }
    /* 스냅된 자리의 **선분 방향**도 같이 돌려준다 — 너치를 재단선에 직각으로 세우려면
       그 선분이 필요하다 (2026-08-15 · 조끼→원피스→여기로 이식). */
    function snapSeg(pt, o) {
      var bd = Infinity, bt = null;
      for (var i = 1; i < o.length; i++) {
        var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        var t = L2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var q = [a[0] + t * dx, a[1] + t * dy], e = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
        if (e < bd) { bd = e; bt = L2 ? [dx / Math.sqrt(L2), dy / Math.sqrt(L2)] : null; }
      }
      return bt;
    }
    function dstN(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
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
        for (i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dstN(pts[i], pts[i - 1]));
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
        for (var k = 0; k < pc.notches.length; k++)
          if (dstN(pc.notches[k].p, q) < 1.0) return;      // 이미 그 자리에 있으면 그만
        var i, near = 0, tx = 0, ty = 0;
        for (i = 1; i < inf.pts.length; i++)
          if (dstN(inf.pts[i], q) < dstN(inf.pts[near], q)) near = i;
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
      (pieces || []).forEach(function (pc) {
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

    (pieces || []).forEach(function (p) {
      var o = p && p.outline;
      if (!o || o.length < 4) return;
      (p.notches || []).forEach(function (n) {
        if (!n || !n.p || typeof n.angle !== 'number' || !isFinite(n.angle)) return;
        function ok(deg) {
          var r = deg * Math.PI / 180;
          return inPoly([n.p[0] + Math.cos(r) * TICK, n.p[1] + Math.sin(r) * TICK], o);
        }
        n.p = snap(n.p, o);
        /* ★ ② 너치는 **재단선에 직각**이라야 한다. 방향만 안쪽으로 맞추면 선과 나란히
           누워 재단선에 묻힌다. 조각 **꼭짓점**은 한쪽 변의 법선이 다른 변에 눕으므로
           두 변의 **이등분선**으로 세운다. 양쪽 다 밖인 퇴화 자리는 아래 탐색으로. */
        var bt = snapSeg(n.p, o);
        if (bt) {
          var nx = -bt[1], ny = bt[0], near = [];
          for (var k2 = 1; k2 < o.length; k2++) {
            var a2 = o[k2 - 1], b2 = o[k2], dx2 = b2[0] - a2[0], dy2 = b2[1] - a2[1];
            var L22 = dx2 * dx2 + dy2 * dy2;
            var t2 = L22 ? ((n.p[0] - a2[0]) * dx2 + (n.p[1] - a2[1]) * dy2) / L22 : 0;
            t2 = t2 < 0 ? 0 : t2 > 1 ? 1 : t2;
            if (L22 && Math.hypot(n.p[0] - (a2[0] + t2 * dx2), n.p[1] - (a2[1] + t2 * dy2)) <= 0.02)
              near.push([dx2 / Math.sqrt(L22), dy2 / Math.sqrt(L22)]);
          }
          if (near.length >= 2) {
            var f2 = near[0], l2 = near[near.length - 1];
            var bx = f2[0] - l2[0], by = f2[1] - l2[1], bl = Math.hypot(bx, by);
            if (bl > 1e-6) { nx = bx / bl; ny = by / bl; }
          }
          if (!inPoly([n.p[0] + nx * TICK, n.p[1] + ny * TICK], o)) { nx = -nx; ny = -ny; }
          if (inPoly([n.p[0] + nx * TICK, n.p[1] + ny * TICK], o)) {
            n.angle = Math.atan2(ny, nx) * 180 / Math.PI;
            return;
          }
        }
        if (ok(n.angle)) return;
        for (var s = 5; s <= 180; s += 5) {
          if (ok(n.angle + s)) { n.angle = ((n.angle + s) % 360 + 360) % 360; return; }
          if (ok(n.angle - s)) { n.angle = ((n.angle - s) % 360 + 360) % 360; return; }
        }
      });
      /* ★ ③ 제도선은 **조각 안에 들어오는 구간만** 남긴다. 조각 밖 허공에 뜬 기준선은
         화면에서 바로 눈에 띈다 (이 모듈들은 최대 7.4cm 나가 있었다).
         ⚠ 자르는 것은 기준선 계열(dashed·line·thin)뿐 — edge(다트)·point(BP)는 그대로.
         ⚠ 선을 잘게 나눠 판정하고, 경계 위의 점은 안쪽으로 친다. */
      var kept = [];
      (p.internal || []).forEach(function (it) {
        /* ★ point(표시점 · BP·FNP·마크)는 선이 아니라 점이라 자를 수 없다 —
           **조각 밖에 있으면 그 조각의 것이 아니므로 버린다** (2026-08-15).
           BP 를 앞옆판에도 붙여 1.75cm 허공에 뜬 것 같은 자리다(조끼에서 겪은 유형).
           경계 0.05 안쪽이면 남긴다. */
        if (it.type === 'point') {
          var okPt = (it.pts || []).some(function (q) {
            if (inPoly(q, o)) return true;
            for (var i = 1; i < o.length; i++) {
              var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
              var t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              if (Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)) <= 0.05) return true;
            }
            return false;
          });
          if (okPt) kept.push(it);
          return;
        }
        var CT = { dashed: 1, line: 1, thin: 1 };
        if (!CT[it.type] || !it.pts || it.pts.length < 2) { kept.push(it); return; }
        var dense = [], j, a0, b0, L0, n0, t0;
        for (j = 1; j < it.pts.length; j++) {
          a0 = it.pts[j - 1]; b0 = it.pts[j]; L0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
          n0 = Math.max(1, Math.ceil(L0 / 0.1));
          for (t0 = 0; t0 < n0; t0++)
            dense.push([a0[0] + (b0[0] - a0[0]) * t0 / n0, a0[1] + (b0[1] - a0[1]) * t0 / n0]);
        }
        dense.push([it.pts[it.pts.length - 1][0], it.pts[it.pts.length - 1][1]]);
        function inside(q) {
          if (inPoly(q, o)) return true;
          for (var i = 1; i < o.length; i++) {
            var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
            var t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            if (Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)) <= 0.05) return true;
          }
          return false;
        }
        var run = null, runs = [];
        dense.forEach(function (q) {
          if (inside(q)) { if (!run) { run = []; runs.push(run); } run.push([q[0], q[1]]); }
          else run = null;
        });
        runs.forEach(function (r, i) {
          var Lr = 0; for (var k = 1; k < r.length; k++) Lr += Math.hypot(r[k][0] - r[k-1][0], r[k][1] - r[k-1][1]);
          if (r.length < 2 || Lr < 0.2) return;
          kept.push({ id: it.id + (i ? '_' + (i + 1) : ''), type: it.type, pts: r, label: it.label });
        });
      });
      p.internal = kept;
    });
    return pieces;
  }

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
   * 1. 치수와 그레이딩 (SPEC §19-1 — 66호 = 교재 46P 필요치수)
   * ════════════════════════════════════════════════════════════════ */
  var BASE  = { B: 87.6, backLen: 38.0, frontLen: 42.0, shoulderW: 38.0,
                backW: 36.8, frontW: 34.3, bpLen: 24.0, bpSpan: 16.0 };   // 원본 DXF 실측
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
   * 2. 제도 상수 (SPEC §II + 원본 DXF 실측 캘리브레이션)
   * ════════════════════════════════════════════════════════════════ */
  var FLATTEN = 0.04;
  var K = {
    ease         : 4.0,        // 여유분 — 폭 = B/4 + 여유분/2 (도면 `B/4 + 여유분/2`)
    frontBackDiff: 4.0,        // 앞 등길이 차이치수 — 앞 상단이 뒤 상단보다 위 (도면 `앞 등길이 차이치수 4`)
    frontSpOut   : 1.0,        // 앞 어깨점 x = 앞품/2 + 1.0 [도면 18.1539 − 17.15 = 1.0039]
    shEase       : 0.5,        // 어깨 이세분 0.3~0.6 — 뒤 어깨 안내선 = 어깨너비/2 + 이세분
    shEaseMin    : 0.3,
    shEaseMax    : 0.6,

    /* ── 뒷면 ── */
    backNeckAdd  : 0.5,        // 뒷목너비 = B/12 + 0.5
    backNeckLift : 2.5,        // 뒷목 옆점 올림 (도면 `2.5↑`)
    backShDrop   : 1.0,        // 어깨점 = 어깨 안내선에서 아래로 1.0 (도면 `↓1`)
    backArmMid   : 0.3,        // 뒤 암홀 겨드랑 쪽 조정 (도면 `0.3↑`)

    /* ── 앞면 ── */
    frontNeckAdd : 0.6,        // 앞목깊이 = B/12 + 0.6
    frontShDrop  : 4.5,        // 앞 어깨 안내선 = 상단에서 아래로 4.5 (도면 `4.5↓`)
    neckDiagOut  : 0.3,        // 앞목둘레는 목사각 대각선 2/3 점에서 0.3 더 나간 점을 지난다
    frontArmDown : 0.2,        // 앞 암홀 아래쪽 조정 (도면 `0.2↑`)
    dartAmount   : 4.0,        // 가슴다트 분량 (도면 `4 다트분`)
    dartRise     : 9.9,        // 다트 아래 다리 = 허리선에서 위로 9.9
    sideAboveDart: 6.2,        // 겨드랑 → 다트 위 (세로 기준, 도면 `6.2`)
    dartTrueOut  : 1.14,       // 다트 중심선을 다리길이보다 이만큼 더 연장한 곳이 트루잉 점

    /* ── 타이트 소매 (교재 「타이트 소매」 도면) ──
     *  도면의 숫자는 66호 값이고 전부 AH 로 환산된다 — 5.7 = AH/8 (45.71/8 = 5.714) ·
     *  4.5 ≈ AH/12 + 0.6 (4.41). 소매산 높이만 이 원형이 **AH/3** 로 다르다
     *  (숙녀복기본원형1 타이트 긴소매는 AH/4 + 2). */
    capHeightDiv : 3,          // 소매산 높이 = AH/3 (도면 `AH/3`)
    /* ── 2장소매 (교재 「2장소매」) ─────────────────────────────────────
     *  절개 규칙은 숙녀복기본원형1 의 48P 검증본과 **같다** — 큰소매 앞쪽에서 3 을 떼어
     *  작은소매 뒤쪽에 붙이므로 소매통 총폭은 그대로다 (사용자 확정 2026-08-10).
     *  다른 것은 ① 소매산 높이 AH/3 (48P 는 AH/4+2) ② **패드분**이 올라간다는 점.
     *  ⚠ CAL.two* 곡선 적합값은 48P 도면 것이라 이 도면 DXF 가 오면 재적합 대상이다. */
    capPad         : 1.0,      // 패드분 (정답지 정확히 1.0000)
    twoMarkBotB    : 4.5,      // 뒤 하단 마크 — 고정 4.5 (AH/12+0.6 아님)      // 패드분 — 소매산을 이만큼 더 올린다 (도면 `패드분 ↑1`)
    capReduce      : 0,
    armNotchDiv    : 3,
    capEaseShare   : [0.0, 0.5, 0.5],
    capEaseBack    : 0.6,
    twoSplitGap    : 0.8,      // 큰·작은 절개점 간격 (도면 `0.8` · 실측 0.8000)
    twoSideOff     : 3.0,      // 큰소매 앞 −3 · 작은소매 뒤 +3 (도면 `3` 두 개 · 총폭 불변)
    twoHemDrop     : 1.492,    // 소맷부리 다트분 (도면 `1.5` 두 개 · 실측 1.4920)
    twoHemUp       : 0.300,    // 밑단선 — 패드점+소매길이 에서 올림 (실측 60.7 = 1+60−0.3) [식 미상]
    twoCuffBigShare: 2 / 3,    // 소맷부리 큰소매 몫 (도면 17.019 / 25.479 = 0.6680)
    twoSeamBulge   : 0.661,    // 절개선 앵커 1 — 가장 부푼 자리 (실측 10.335−9.674)
    twoSeamBulge2  : 0.404,    // 절개선 앵커 2 — 팔꿈치 아래 (실측 10.078−9.674)
    twoSeamBulge3  : -0.878,   // 절개선 앵커 3 — 트임어깨 자리 (실측 8.796−9.674, 부호 반전)
    twoSeamBulgeU3 : -0.398,   // 작은소매 앵커 3 (실측 10.872−10.474)
    /* 앵커 y 는 절개선 구간의 **비율**이다 — 66호 절대 y(20.8 · 34.315 · 51.273)를
       (절개점 8.105 ~ 밑단 62.192) 구간으로 나눈 값. 절대값을 박으면 66호만 맞는다. */
    twoSeamT1      : 0.234715,  // 옛 twoInsetY 20.8
    twoSeamT2      : 0.484585,  // 옛 twoSeamY2 34.315
    twoSeamT3      : 0.798122,  // 옛 twoSeamY3 51.273 (트임어깨)
    twoUndOutIn1   : 1.965,    // 작은소매 바깥 뒤선 앵커 1 — 뒤 경계에서 (실측 21.425−19.460)
    twoUndOutY1    : 36.199,   // 앵커 1 의 y — 가장 앞으로 나온 자리
    twoUndOutIn2   : 1.809,    // 앵커 2 (실측 21.425−19.616)
    twoUndOutY2    : 45.291,
    twoSeamBulgeU  : 1.139,    // 작은소매 앵커 1 (실측 10.474−9.335)
    twoSeamBulgeU2 : 0.882,    // 작은소매 앵커 2 (실측 10.474−9.592)
    twoSeamY2      : 34.315,   // 앵커 2 의 y (도면 점열 자리)    // 절개선 S 자 정점 — 절개점 수직선에서 조각 바깥으로 (실측 10.335−9.674)
    twoUndHemIn    : 1.175,    // 작은소매 부리 뒤 모서리 — 뒤 경계에서 **안쪽** (실측 21.425−20.250)
    twoUndHemRise  : 0.300,    // 위 모서리 올림 (도면 마크 `0.3 올림`)
    twoFrontHemIn  : 6.25,     // 큰소매 앞 밑단 들임 (정답지 x 9.250)
    twoFrontElbowIn: 1.44,     // 큰소매 앞 경계의 팔꿈치 들임
    twoBackElbowOut: -1.91,    // 작은소매 바깥 뒤 — 48P 와 **휘는 방향이 반대**다
    twoInsetY      : 20.8,     // 절개짝 너치 y (정답지 20.805)     // 이세처리 구간 표시용 y (원형1 은 반소매 길이를 썼다)
    ventW          : 2.0,      // 작은소매 트임 너비 [도면 2.0]
    ventWBig       : 2.174,    // 큰소매 트임 너비 [도면 2.174] — 조각마다 다르다
    ventLen        : 9.0,
    ventMitre      : 2.0,
    capApexShift : 0.6,        // 소매산 정점을 앞으로 이동 (도면 `앞으로 이동 0.6`)
    capMarkTop   : 8,          // 상단 마크 = 중심에서 AH/8 (도면 `5.7`)
    capMarkBotB  : 0.6,        // 뒤 하단 마크 = 소매폭 끝에서 안쪽 AH/12 + 0.6 (도면 `4.5`)
    sleeveLen    : 58.0,       // 소매길이 (66호) — UI 에서 조절
    sleeveLenGrade: 1.0,
    cuffW        : 24.0,       // 소매부리 (66호) — UI 에서 조절
    cuffWGrade   : 0.5,
    elbowAdd     : 2.5,        // 팔꿈치선 = 소매길이/2 + 2.5
    capBulge     : 0.5,        // 곡선 통과점 = 대각선 발점 ↔ 마크 사이의 비율 (도면 실측 0.500~0.512)
    elbowDart    : 4.5,        // 팔꿈치 다트분 (도면 `다트분 4.5`) — **소맷부리에 입이 난다**
    elbowTipDrop : 4.4,        // 다트 끝 = 팔꿈치선에서 **아래로** (도면 `↓3.8~5`)
    cuffDartDrop : 0.3,        // 다트 두 다리를 소맷부리선에서 0.3 내림 (도면 `0.3↓` 두 개)
    cuffBackDrop : 0.3         // 소맷부리 뒤쪽 끝 내림 (도면 `0.3↓`)
  };

  /* 곡선 캘리브레이션 — 원본 DXF 에 맞춰 적합. 무차원 비율/접선크기라 호수를 따라 스케일된다.
     재적합: node calibrate.js */
  var CAL = {
    /* 소매산 — 마크를 대각선에 수직으로 미는 양 (뒤는 볼록 +, 앞 하단은 오목) */
    /* 소매산 — 대각선의 t 지점에서 수직으로 떨어진 양 (뒤 볼록 · 앞 아래 오목) */
    /* 소매산 곡선의 양 끝 접선 장력 — 숙녀복기본원형1(긴소매 DXF 검증)과 같은 값 */
    sleeveCap: { k0: 1.1487, k1: 1.8359 },
    /* 2장소매 소매산 — 패드점 수선 + 4점 스플라인 구성에 맞춰 앞뒤 따로 적합 (2장소매 DXF) */
    capBack  : { k0: 1.10, k1: 1.50 },
    capFront : { k0: 1.40, k1: 1.60 },
    twoSeam  : { k0: 0.10, k1: 0.10 },   // 완만한 C자 — 절개점 수직 출발, 앵커 두 점 → 밑단
    twoFront : { k0: 1.00 },
    twoUndOuter: { k0: 0.10, k1: 1.60 },   // 앵커 두 점 — 편차 0.217
    twoUnderCap: { k0: 1.00 },   // 작은소매 소매산 — 0.8 수평 뒤 출발접선 장력
    backNeck : { mx: 0.6624, my: 0.1858, a0: 21.21, k0: 1.3386, k1: 0.3122 },              // 편차 0.009
    frontNeck: { along: 0.3009, a1: -20.40, k0: 1.3493, k1: 0.8123 },                      // 편차 0.007
    backArm  : { d1: 0.2275, a0: 2.9376, k0: 0.7656, kA: 0.7750, kB: 0.6902, k1: 1.4753 }, // 편차 0.043
    frontArm : { d1: 0.1848, d2: 0.0737, a0: -2.28, k0: 1.1811, k1: 1.1691 }               // 편차 0.048
  };

  /* ══════════════════════════════════════════════════════════════════
   * 3. 제도
   * ════════════════════════════════════════════════════════════════ */
  function rotAbout(p, c, a) {
    var s = Math.sin(a), q = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + x * q - y * s, c[1] + x * s + y * q];
  }
  function num(v, d) { return (v === undefined || v === null || v === '' || !isFinite(+v)) ? d : +v; }

  /** 제도점 + 곡선 (폴리라인 flatten 없음) — draftBodice2 와 검증기가 공유
   *  좌표계: 앞뒤 **각자 자기 상단선**이 y=0. 앞 상단은 뒤 상단보다 frontBackDiff 위라
   *  두 조각을 나란히 놓으면 허리선이 같은 높이에 온다. */
  function geom(m, opt) {
    opt = opt || {};
    MEAS_KEYS.forEach(function (k) {
      if (typeof m[k] !== 'number' || !isFinite(m[k])) throw new Error('치수 누락/오류: ' + k);
    });
    var B = m.B, nw = B / 12;
    var ease    = num(opt.ease,        K.ease);
    var shEase  = num(opt.shoulderEase, K.shEase);
    var dartAmt = num(opt.dartAmount,  K.dartAmount);
    var dartRise= num(opt.dartRise,    K.dartRise);

    var halfW = B / 4 + ease / 2;      // 옆선 x — 앞뒤 공통
    var BL    = B / 4;                 // 가슴선 y — 앞뒤 공통 (각자 상단 기준)
    var WLb   = m.backLen;             // 뒤 허리선
    var WLf   = m.frontLen;            // 앞 허리선
    var diff  = WLf - WLb;             // 앞 등길이 차이치수 (도면 4)

    /* ───────── 뒷면 ───────── */
    var bSideX  = halfW, bPitchX = m.backW / 2;
    var BNP     = [0, 0];
    var bNeckW  = nw + K.backNeckAdd;
    var SNPb    = [bNeckW, -K.backNeckLift];
    var bSpX    = m.shoulderW / 2 + shEase;
    var SPb     = [bSpX, K.backShDrop];
    var Ub      = [bSideX, BL];
    var bWaist  = [bSideX, WLb];
    var shLenBack = V.dist(SNPb, SPb);

    /* ───────── 앞면 ───────── */
    var fSideX  = halfW, fPitchX = m.frontW / 2;
    var SNPf    = [nw, 0];                       // 앞목 옆점 — 상단선 위
    var FNP     = [0, nw + K.frontNeckAdd];      // 앞목 깊이
    /* 앞 어깨 — 목옆점에서 **뒤 어깨선과 같은 길이**로 재어 상단에서 4.5 내려간 자리가 안내선 끝.
       거기서 이세분만큼 되돌린 점이 실제 어깨점이다 (도면 `이세분 커트`). */
    var dy = K.frontShDrop, dx = Math.sqrt(Math.max(0, shLenBack * shLenBack - dy * dy));
    var fShGuide= [SNPf[0] + dx, SNPf[1] + dy];
    var shLenFront = shLenBack - shEase;
    var fShDir  = V.norm(V.sub(fShGuide, SNPf));
    /* ★ 실제 어깨점은 **안내선 위에 있지 않다** — x 는 `앞품/2 + 1.0` 으로 따로 정해지고
       (도면 SP x 18.1539 − 앞품선 17.15 = 1.0039), y 는 어깨선 길이로 결정된다.
       숙녀복 기본원형 III 도 같은 구조다(거기는 +1.25). 안내선(깊이 4.5)은 **길이·경사를
       재는 보조선**일 뿐이다.
       ⚠ 예전에는 안내선 위에서 이세분만큼 되돌린 점을 썼다. 그러면 SP 가 도면과 0.115
         어긋나고, 그 현이 0.094 길어져 **앞 암홀 호가 +0.090** 이 됐다 (곡선 모양은 맞았다). */
    var fSpX    = fPitchX + K.frontSpOut;
    var fSpDx   = fSpX - SNPf[0];
    var SPf     = [fSpX, SNPf[1] + Math.sqrt(Math.max(shLenFront * shLenFront - fSpDx * fSpDx, 0.01))];
    var Uf      = [fSideX, BL];
    var fWaist  = [fSideX, WLf];
    var BP      = [m.bpSpan / 2, SNPf[1] + m.bpLen];

    /* 가슴다트 — 아래 다리를 옆선에 두고 BP 중심으로 다트분만큼 돌려 위 다리를 만든다 */
    var dartLo  = [fSideX, WLf - dartRise];
    var dartLeg = V.dist(BP, dartLo);
    var dartAng = 2 * Math.asin(Math.min(0.999, dartAmt / 2 / dartLeg));
    var dartHi  = rotAbout(dartLo, BP, -dartAng);
    /* 트루잉 점 — 다트를 접었을 때 옆선이 이어지도록 두 다리 끝에서 같은 거리에 둔다 */
    var mid     = [(dartHi[0] + dartLo[0]) / 2, (dartHi[1] + dartLo[1]) / 2];
    var dartT   = V.add(BP, V.mul(V.norm(V.sub(mid, BP)), dartLeg + K.dartTrueOut));

    /* ───────── 곡선 ───────── */
    var backNeck  = curveBackNeck(BNP, SNPb, SPb);
    var backArm   = curveBackArm(SPb, SNPb, bPitchX, Ub, BL);
    var frontNeck = curveFrontNeck(FNP, SNPf, nw, SPf);
    var frontArm  = curveFrontArm(SPf, SNPf, fPitchX, Uf, BL, fShGuide);

    /* ───────── 타이트 소매 ───────── */
    var sleeve = (opt.includeSleeve === false) ? null
      : sleeveGeom(m, opt, sLen(backArm), sLen(frontArm));

    return {
      m: m, opt: { ease: ease, shEase: shEase, dartAmount: dartAmt, dartRise: dartRise },
      sleeve: sleeve,
      nw: nw, B: B, BL: BL, halfW: halfW, WLb: WLb, WLf: WLf, diff: diff, shEase: shEase,
      bSideX: bSideX, bPitchX: bPitchX, bNeckW: bNeckW, bSpX: bSpX,
      BNP: BNP, SNPb: SNPb, SPb: SPb, Ub: Ub, bWaist: bWaist, shLenBack: shLenBack,
      fSideX: fSideX, fPitchX: fPitchX, fShGuide: fShGuide, fShDir: fShDir, shLenFront: shLenFront,
      SNPf: SNPf, FNP: FNP, SPf: SPf, Uf: Uf, fWaist: fWaist, BP: BP,
      bPitchTop: SNPb[1] + (bPitchX - SNPb[0]) * (SPb[1] - SNPb[1]) / (SPb[0] - SNPb[0]),
      /* ★ 앞품선 위끝은 **어깨 안내선** ∩ 앞품선이다 (도면 3.9055 · 안내선으로 재면 3.9053).
         실제 어깨선(SP 로 가는 선)과의 교점(4.004)이 아니다 — SP 가 안내선 위에 없기 때문. */
      fPitchTop: SNPf[1] + (fPitchX - SNPf[0]) * (fShGuide[1] - SNPf[1]) / (fShGuide[0] - SNPf[0]),
      dartLo: dartLo, dartHi: dartHi, dartT: dartT, dartLeg: dartLeg, dartAng: dartAng,
      backNeck: backNeck, backArm: backArm, frontNeck: frontNeck, frontArm: frontArm
    };
  }

  function draftBodice2(m, opt) {
    opt = opt || {};
    var seam = (opt.seam === undefined) ? 0 : opt.seam;
    var g = geom(m, opt);

    var backEdges = [
      { name: '뒷목둘레', role: 'neck',     segs: revSegs(g.backNeck) },   // 뒤중심 → 목옆점
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPb, g.SPb) },
      { name: '뒤암홀',   role: 'armhole',  segs: g.backArm },
      { name: '옆선',     role: 'side',     segs: lineSegs(g.Ub, g.bWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.bWaist, [0, g.WLb]) },
      { name: '뒤중심',   role: 'fold',     segs: lineSegs([0, g.WLb], g.BNP) }
    ];
    var frontEdges = [
      { name: '앞목둘레', role: 'neck',     segs: g.frontNeck },            // 앞중심 → 목옆점
      { name: '어깨선',   role: 'shoulder', segs: lineSegs(g.SNPf, g.SPf) },
      { name: '앞암홀',   role: 'armhole',  segs: g.frontArm },
      { name: '옆선 위',  role: 'side',     segs: lineSegs(g.Uf, g.dartHi) },
      { name: '다트',     role: 'dart',     segs: lineSegs(g.dartHi, g.dartT, g.dartLo) },
      { name: '옆선 아래', role: 'side',    segs: lineSegs(g.dartLo, g.fWaist) },
      { name: '허리선',   role: 'hem',      segs: lineSegs(g.fWaist, [0, g.WLf]) },
      { name: '앞중심',   role: 'fold',     segs: lineSegs([0, g.WLf], g.FNP) }
    ];

    var backLoop = edgesToLoop(backEdges), frontLoop = edgesToLoop(frontEdges);
    var backSeam = buildSeamline(backLoop, seam), frontSeam = buildSeamline(frontLoop, seam);

    var nBackArm  = armNotches(g.backArm,  g.Ub, [g.bPitchX / 2, g.BL], '뒤암홀');
    var nFrontArm = armNotches(g.frontArm, g.Uf, [g.fPitchX / 2, g.BL], '앞암홀');

    var backPiece = {
      id: 'back', name: '뒷면', cutCount: 2, kind: 'body',
      grainline: [[1.5, 2.0], [1.5, g.WLb - 2.0]],
      outline: backLoop.pts, seamline: backSeam.seamline, foldEdges: backSeam.foldEdges,
      seamEdges: backSeam.seamEdges, seamFoldEdges: backSeam.seamFoldEdges,
      seamByRole: backSeam.seamByRole, edges: withSeam(backLoop.ranges, backSeam.edgeSeam),
      internal: backInternal(g),
      notches: [{ p: cp(g.SPb), angle: 180, label: '어깨점' },
                { p: cp(g.SNPb), angle: 90, label: '목옆점' },
                { p: cp(g.Ub), angle: 180, label: '겨드랑' }].concat(nBackArm),
      bbox: bboxOf(backLoop.pts)
    };
    var frontPiece = {
      id: 'front', name: '앞면', cutCount: 2, kind: 'body',
      grainline: [[1.5, 4.0], [1.5, g.WLf - 2.0]],
      outline: frontLoop.pts, seamline: frontSeam.seamline, foldEdges: frontSeam.foldEdges,
      seamEdges: frontSeam.seamEdges, seamFoldEdges: frontSeam.seamFoldEdges,
      seamByRole: frontSeam.seamByRole, edges: withSeam(frontLoop.ranges, frontSeam.edgeSeam),
      internal: frontInternal(g),
      notches: [{ p: cp(g.SPf), angle: 180, label: '어깨점' },
                { p: cp(g.SNPf), angle: 90, label: '목옆점' },
                { p: cp(g.Uf), angle: 180, label: '겨드랑' },
                { p: cp(g.dartHi), angle: 180, label: '다트 위' },
                { p: cp(g.dartLo), angle: 180, label: '다트 아래' }].concat(nFrontArm),
      bbox: bboxOf(frontLoop.pts)
    };

    /* ───────── 소매 ───────── */
    var sv = g.sleeve, sleevePiece = null, twoPieces = null;
    /* 2장소매면 큰소매·작은소매 두 조각을 따로 만든다 (조각 id sleeveBig / sleeveUnder).
       ⚠ 주석의 piece 도 그 id 를 써야 붙는다 — 'sleeve' 로 달면 하나도 안 붙는다. */
    if (sv && sv.twoPiece) { twoPieces = twoSleevePieces(sv, seam); }
    else if (sv) {
      var sleeveEdges = [
        { name: '소매산 뒤', role: 'armhole', segs: sv.capBack },              // 뒤 겨드랑 → 정점
        { name: '소매산 앞', role: 'armhole', segs: sv.capFront },             // 정점 → 앞 겨드랑
        { name: '앞 밑선',  role: 'side',    segs: lineSegs(sv.capF, sv.hemF) },
        { name: '소맷부리(앞)', role: 'sleeveHem', segs: lineSegs(sv.hemF, sv.dartA) },
        { name: '팔꿈치 다트',  role: 'dart', segs: lineSegs(sv.dartA, sv.dartTip, sv.dartB) },
        { name: '소맷부리(뒤)', role: 'sleeveHem', segs: lineSegs(sv.dartB, sv.hemB) },
        { name: '뒤 밑선',  role: 'side',    segs: lineSegs(sv.hemB, sv.capB) }
      ];
      var sLoop = edgesToLoop(sleeveEdges), sSeam = buildSeamline(sLoop, seam);
      /* 소매산 너치 — 몸판 암홀 3등분과 대응시킨다.
         겨드랑 구간에는 이세를 넣지 않고, 이세는 위쪽 두 구간에 나눠 준다. */
      var nCap = capNotchesB2(sv);
      sleevePiece = {
        id: 'sleeve', name: '소매', cutCount: 2, kind: 'sleeve',
        grainline: [[sv.apex[0], sv.capH + 2], [sv.apex[0], sv.sleeveLen - 2]],
        outline: sLoop.pts, seamline: sSeam.seamline, foldEdges: sSeam.foldEdges,
        seamEdges: sSeam.seamEdges, seamFoldEdges: sSeam.seamFoldEdges,
        seamByRole: sSeam.seamByRole, edges: withSeam(sLoop.ranges, sSeam.edgeSeam),
        internal: sleeveInternal(sv),
        notches: [{ p: cp(sv.apex), angle: 90, label: '소매산 정점' },
                  { p: cp(sv.capB), angle: 0,  label: '뒤 겨드랑' },
                  { p: cp(sv.capF), angle: 180, label: '앞 겨드랑' },
                  { p: cp(sv.elbowBack), angle: 0, label: '팔꿈치' }].concat(nCap),
        bbox: bboxOf(sLoop.pts)
      };
    }

    var AHb = sLen(g.backArm), AHf = sLen(g.frontArm);
    var NKb = sLen(g.backNeck), NKf = sLen(g.frontNeck);
    /* 옆선 — 앞은 다트분만큼 길게 재단하고 접으면 뒤와 같아진다 */
    var sideBack = V.dist(g.Ub, g.bWaist);
    var sideFrontCut = (g.WLf - g.BL);
    var sideFrontSewn = sideFrontCut - g.opt.dartAmount;

    var warnings = [], notes = [];
    if (sv) {
      var capL = (sv.capLen !== undefined) ? sv.capLen : sv.capLenTotal;
      var ease2 = capL - sv.AH;
      if (ease2 < 1.5 || ease2 > 4.5)
        warnings.push('소매산 이세분 ' + r4(ease2) + ' cm — 2~4 가 보통입니다.');
      /* ★ 앞뒤를 **따로** 본다. 총 이세가 맞아도 한쪽이 음수면 그 쪽 소매가 안 들어간다.
         2장소매에서 작은소매 `소매통 연결`을 뒤로 세던 시절 앞 이세가 −0.95 였는데
         총 이세는 4.66 이라 아무 경고도 안 났다. */
      if (sv.capEaseFront !== undefined) {
        if (sv.capEaseFront < 0.8 || sv.capEaseFront > 3.4)
          warnings.push('앞 소매산 이세분 ' + r4(sv.capEaseFront) + ' cm (소매산 ' +
            r4(sv.capLenFront) + ' − 앞 암홀 ' + r4(sv.AHf) + ') — 1~3 이라야 합니다.');
        if (sv.capEaseBack < 0.8 || sv.capEaseBack > 3.4)
          warnings.push('뒤 소매산 이세분 ' + r4(sv.capEaseBack) + ' cm (소매산 ' +
            r4(sv.capLenBack) + ' − 뒤 암홀 ' + r4(sv.AHb) + ') — 1~3 이라야 합니다.');
      }
    }
    if (Math.abs(sideBack - sideFrontSewn) > 0.05)
      warnings.push('다트를 접은 뒤 앞 옆선 ' + r4(sideFrontSewn) + ' 이 뒤 옆선 ' + r4(sideBack) +
        ' 과 ' + r4(Math.abs(sideBack - sideFrontSewn)) + ' 다릅니다.');

    var pieces = [frontPiece, backPiece];
    if (sleevePiece) pieces.push(sleevePiece);
    if (twoPieces) pieces = pieces.concat(twoPieces);

    return {
      pieces: fixNotchDirs(pieces), warnings: warnings, notes: notes,
      measures: {
        shoulderBack: r4(g.shLenBack), shoulderFront: r4(g.shLenFront), shoulderEase: r4(g.shEase),
        shoulderBackSeam: r4(g.shLenBack), shoulderFrontSeam: r4(g.shLenFront),
        armholeBack: r4(AHb), armholeFront: r4(AHf), armholeTotal: r4(AHb + AHf),
        neckBack: r4(NKb), neckFront: r4(NKf), neckTotal: r4(NKb + NKf),
        sideBack: r4(sideBack), sideFront: r4(sideFrontCut), sideFrontSewn: r4(sideFrontSewn),
        halfWidth: r4(g.halfW), ease: r4(g.opt.ease), BL: r4(g.BL),
        frontBackDiff: r4(g.diff), dartAmount: r4(g.opt.dartAmount),
        dartLeg: r4(g.dartLeg), dartAngleDeg: r4(g.dartAng * 180 / Math.PI),
        bust: r4(g.B), waistBack: r4(g.WLb), waistFront: r4(g.WLf),
        /* 2장소매는 필드 이름이 다르다 (capLenTotal / halfB+halfF) — 둘 다 받아 준다 */
        capHeight: sv ? r4(sv.capH) : null,
        sleeveWidth: sv ? r4(sv.width !== undefined ? sv.width : sv.halfB + sv.halfF) : null,
        sleeveCapLen: sv ? r4(sv.capLen !== undefined ? sv.capLen : sv.capLenTotal) : null,
        sleeveCapEase: sv ? r4((sv.capLen !== undefined ? sv.capLen : sv.capLenTotal) - sv.AH) : null,
        /* 봉제 기준 앞뒤 — 2장소매는 조각 경계와 앞뒤 경계가 다르다 (twoSleeveGeom 주석 참고) */
        sleeveCapFront: (sv && sv.capLenFront !== undefined) ? r4(sv.capLenFront) : null,
        sleeveCapBack: (sv && sv.capLenBack !== undefined) ? r4(sv.capLenBack) : null,
        sleeveCapEaseFront: (sv && sv.capEaseFront !== undefined) ? r4(sv.capEaseFront) : null,
        sleeveCapEaseBack: (sv && sv.capEaseBack !== undefined) ? r4(sv.capEaseBack) : null,
        sleeveLen: sv ? r4(sv.sleeveLen) : null, cuffWidth: sv ? r4(sv.cuffW) : null,
        elbowDart: (sv && sv.dartA && sv.dartB) ? r4(V.dist(sv.dartA, sv.dartB)) : null,
        sleeveType: sv ? (sv.twoPiece ? 'two' : 'tight') : null,
        sleeveTypeName: sv ? (sv.twoPiece ? SLEEVE_TYPE.two.name : SLEEVE_TYPE.tight.name) : null
      },
      meta: {
        title: '숙녀복 기본원형 II', source: '교재 「숙녀복 기본원형 II」 제도 1·2',
        sizeName: sizeNameOf(m), m: m, geom: g, warnings: warnings, notes: notes,
        /* 2장소매는 조각이 둘이라 주석도 따로 낸다 — piece 가 sleeveBig / sleeveUnder 여야 붙는다 */
        formulaNotes: formulaNotes(m, g, AHb, AHf, NKb, NKf, seam)
          .concat(!sv ? [] : (sv.twoPiece ? twoNotes(sv) : sleeveNotes(sv)))
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 4. 곡선
   * ════════════════════════════════════════════════════════════════ */
  /** 뒷목둘레 : 목옆점(어깨선 수직을 a0° 회전해 출발) → 중간점 → 뒤중심(수평 도착) */
  function curveBackNeck(BNP, SNP, SP) {
    var C = CAL.backNeck;
    var Mp = [SNP[0] * C.mx, SNP[1] * C.my];
    var sd = V.norm(V.sub(SP, SNP));
    return splineSegs([SNP, Mp, BNP],
      endTan(rotv([-sd[1], sd[0]], C.a0), C.k0), endTan([-1, 0], C.k1));
  }
  /** 앞목둘레 : 앞중심(수평 출발) → 목사각 대각선 2/3 점에서 `along` 더 나간 점 → 목옆점 */
  function curveFrontNeck(FNP, SNP, nw, SP) {
    var C = CAL.frontNeck, dep = FNP[1];
    var Pm = V.add([nw * 2 / 3, dep * 2 / 3], V.mul(V.norm([nw, dep]), C.along));
    var sd = V.norm(V.sub(SP, SNP));
    return splineSegs([FNP, Pm, SNP],
      endTan([1, 0], C.k0), endTan(rotv([sd[1], -sd[0]], C.a1), C.k1));
  }
  /** 암홀 — 교재 작도 그대로
   *  · 품선 위끝 = **어깨선 ∩ 품선** (도면 등품선 0.671 · 앞품선 3.906 이 정확히 그 자리)
   *  · 그 아래 BL 까지를 **3등분**, 곡선은 1/3·2/3 자리를 지난다 (도면 `3등분`)
   *  · 오목점 H = 품선×BL 모서리에서 [2/3점 → 겨드랑] 현에 내린 **수선의 중점**에서
   *    뒤 0.3 · 앞 0.2 더 나간 점 (도면 `0.3↑` `0.2↑`)
   *  · 뒤는 2/3 점에서 품선에 **접**하므로 거기서 수직 접선으로 끊어 두 조각으로 그린다 */
  function curveArm(SP, SNP, pitchX, U, BL, mid, C, guideEnd) {
    /* 품선 위끝은 **어깨 안내선**과의 교점이다. 뒤는 SP 가 안내선 위에 있어 둘이 같고,
       앞은 SP 가 안내선 밖이라 반드시 안내선(guideEnd)으로 재야 한다. */
    var GE = guideEnd || SP;
    var topY = SNP[1] + (pitchX - SNP[0]) * (GE[1] - SNP[1]) / (GE[0] - SNP[0]);
    var y1 = topY + (BL - topY) / 3, y2 = topY + (BL - topY) * 2 / 3;
    var A = [pitchX, y2], d = V.norm(V.sub(U, A)), Cn = [pitchX, BL];
    var F = V.add(A, V.mul(d, (Cn[0] - A[0]) * d[0] + (Cn[1] - A[1]) * d[1]));   // 수선의 발
    var H = V.add(Cn, V.mul(V.norm(V.sub(F, Cn)), V.dist(Cn, F) / 2 + mid));
    var sd = V.norm(V.sub(SP, SNP));
    var t0 = endTan(rotv([-sd[1], sd[0]], C.a0), C.k0);
    var P1 = [pitchX + C.d1, y1];
    if (C.kA !== undefined) {
      var P2 = [pitchX, y2];
      return splineSegs([SP, P1, P2], t0, endTan([0, 1], C.kA))
        .concat(splineSegs([P2, H, U], endTan([0, 1], C.kB), endTan([1, 0], C.k1)));
    }
    return splineSegs([SP, P1, [pitchX + C.d2, y2], H, U], t0, endTan([1, 0], C.k1));
  }
  function curveBackArm(SP, SNP, pitchX, U, BL) {
    return curveArm(SP, SNP, pitchX, U, BL, K.backArmMid, CAL.backArm);
  }
  function curveFrontArm(SP, SNP, pitchX, U, BL, guideEnd) {
    return curveArm(SP, SNP, pitchX, U, BL, K.frontArmDown, CAL.frontArm, guideEnd);
  }

  var SLEEVE_TYPE = {
    tight: { name: '타이트 소매', len: 58.0, lenGrade: 1.0, cuff: 24.0, cuffGrade: 0.5 },
    two:   { name: '2장소매',    len: 60.0, lenGrade: 1.0,   // 패드점에서 잰 길이
             cuff: 25.479, cuffGrade: 0.65, twoPiece: true }   // 도면 큰 17.019 + 작은 8.460
  };
  var SLEEVE_TYPES = Object.keys(SLEEVE_TYPE);

  /* ══════════════════════════════════════════════════════════════════
   * 5. 타이트 소매 (교재 「타이트 소매」)
   * ════════════════════════════════════════════════════════════════ */
  /** 좌표: 중심선 상단(정점 높이) 원점 · x = 뒤(−) / 앞(+) · y 아래 +
   *  · 소매산 높이 = AH/3
   *  · 정점을 앞으로 0.6 이동
   *  · 뒤/앞 소매폭점 = 정점에서 각각 뒤AH · 앞AH 길이의 대각선이 소매폭선과 만나는 자리
   *  · 소매산 곡선은 상단 마크(중심에서 AH/8)와 하단 마크를 지난다 */
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
  /** 곡선 위에서 y 좌표가 주어진 자리 (절개점 높이 = 소매산/2 를 잡는 데 쓴다) */
  function ptOnSegsAtY(segs, targetY) {
    var p = sampleSegs(segs, 0.01), best = p[0], bd = 1e9;
    for (var i = 0; i < p.length; i++) {
      var d = Math.abs(p[i][1] - targetY);
      if (d < bd) { bd = d; best = p[i]; }
    }
    return cp(best);
  }

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
  function splitSegsAtX(segs, targetX) {
    var p = sampleSegs(segs, 0.01), cut = -1;
    for (var i = 1; i < p.length; i++) {
      if ((p[i - 1][0] - targetX) * (p[i][0] - targetX) <= 0) { cut = i; break; }
    }
    if (cut < 1) cut = Math.max(1, Math.floor(p.length / 2));
    return { head: p.slice(0, cut + 1).map(cp), tail: p.slice(cut - 1).map(cp) };
  }
  function revPts(a) { return a.slice().reverse(); }
  function bezSplit(g, t) {
    var a = _lerp(g.p0, g.c1, t), b = _lerp(g.c1, g.c2, t), c = _lerp(g.c2, g.p1, t);
    var d = _lerp(a, b, t), e = _lerp(b, c, t), m = _lerp(d, e, t);
    return [{ p0: g.p0, c1: a, c2: d, p1: m }, { p0: m, c1: e, c2: c, p1: g.p1 }];
  }
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
  function ventOf(seamSegs, insideRef, wIn) {
    var ventW = (wIn === undefined) ? K.ventW : wIn;
    var sp = splitSegsAtLenFromEnd(seamSegs, K.ventLen);
    var top = sp.head.length ? sp.head[sp.head.length - 1].p1 : seamSegs[0].p0;
    var fold = sp.tail;                                  // 트임 접음선 = 절개선 아래 9
    var hem = seamSegs[seamSegs.length - 1].p1;
    var ch = V.norm(V.sub(hem, top)), nr = [ch[1], -ch[0]];
    if (nr[0] * (hem[0] - insideRef[0]) + nr[1] * (hem[1] - insideRef[1]) < 0) nr = [-nr[0], -nr[1]];
    var vv = [nr[0] * ventW, nr[1] * ventW];
    /* 절개선은 **미터 기준점(트임 위 2.0)** 에서 끝난다 — 그 아래는 미터 사선이 대신한다 */
    var mp = splitSegsAtLenFromEnd(seamSegs, K.ventLen + K.ventMitre);
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
  function capGeom(AH, AHb, AHf, capReduce, apexShift, capHIn, padIn, botBIn) {
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
    var markTopB = [-AH / 8, 0], markTopF = [AH / 8, 0];
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
    var capH2 = AH / K.capHeightDiv + num(opt.capPad, K.capPad);
    var pad2 = num(opt.capPad, K.capPad);
    var cg = capGeom(AH, AHb, AHf, capReduce, K.capApexShift, capH2, pad2, K.twoMarkBotB);
    var halfB = cg.halfB, halfF = cg.halfF;
    /* 길이 골격은 **패드점 기준** — 정답지: 팔꿈치 33.5 = 1 + 60/2 + 2.5 · 부리 61.0 = 1 + 60 */
    var elbowY = pad2 + sleeveLen / 2 + K.elbowAdd;
    var insetY = K.twoInsetY;              // 이세처리 구간 표시용

    /* ── 절개 골격 (정답지 실측) ────────────────────────────────────────
     *  · 절개점 높이 = **소매산의 정확히 절반** (정답지 8.109 = 16.218/2)
     *  · 큰소매 절개점 = 소매산 곡선 ∩ 그 높이
     *  · 작은소매 절개점 = 큰소매보다 **0.8 뒤** (도면 `0.8` 두 곳 · 실측 0.8000)
     *    두 조각이 절개선에서 0.8 씩 겹쳐 그 만큼이 이세로 들어간다.
     *  ⚠ 예전에는 splitX = −AH/4 한 점을 두 조각이 공유했다. */
    var splitY = cg.capH / 2;
    var splitP = ptOnSegsAtY(cg.capBack, splitY);
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
    var cutF = idxAtChordFromEnd(capFrontPts, cg.bicepF, num(opt.twoSideOff, K.twoSideOff));
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

    var bigHemF = [halfF - K.twoFrontHemIn, hemY];
    /* ★ 작은소매 부리 뒤 모서리는 뒤 경계보다 **안쪽**이고 **0.3 올라간다**
       (도면 마크 「작은소매 부리 뒤모서리(0.3 올림)」 실측 (−20.250, 60.4) · 뒤 경계 −21.425).
       예전에는 `backOutX − 1.492` 로 **바깥으로** 내밀어 부호가 반대였다. 그 2.6 때문에
       바깥 뒤선이 팔꿈치 아래에서 크게 휘고(휨 0.404 · 도면 0.117) 부리 몫도 틀렸다
       (작은 9.85 / 도면 8.46). 팔꿈치선까지는 도면과 0.05 로 맞고 있었다. */
    var undHemB = [backOutX + K.twoUndHemIn, hemY - K.twoUndHemRise];
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
      var lo = 0.35, hi = 0.90, gLo = gap(lo);
      if (gLo * gap(hi) > 0) return K.twoCuffBigShare;      // 구간 안에 답이 없으면 도면 몫
      for (var i = 0; i < 44; i++) {
        var mid = (lo + hi) / 2;
        if (gap(mid) * gLo > 0) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
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
    var ventBig = ventOf(bigBack, [halfF, elbowY], num(opt.ventWBig, K.ventWBig));      // 조각 안쪽 = 앞쪽 → 덧단은 뒤로
    var ventUnd = ventOf(undBack, [backOutX, elbowY], num(opt.ventWUnd, K.ventW));   // 조각 안쪽 = 뒤쪽 → 덧단은 앞으로

    var bigFront = splineSegs([[frontInX, topY], [frontInX - K.twoFrontElbowIn, elbowY], bigHemF],
      endTan([0, 1], CAL.twoFront.k0), null);
    /* 작은소매 바깥 뒤선 — 앵커 **두 점**. 가장 앞으로 나온 자리는 팔꿈치선(33.5)이 아니라
       그보다 아래 y 36.199 다 (도면 −19.460 · 뒤 경계에서 1.965). 팔꿈치선에 한 점만 두면
       아래쪽이 곧게 펴져 도면과 0.53 벗어난다. */
    var undOuter = splineSegs([[backOutX, topY],
        [backOutX + K.twoUndOutIn1, K.twoUndOutY1],
        [backOutX + K.twoUndOutIn2, K.twoUndOutY2], undHemB],
      endTan([0, 1], CAL.twoUndOuter.k0), endTan([0, 1], CAL.twoUndOuter.k1));
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
      undOuter: undOuter, undCapOut: undCapOut,
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
  function onPts(q, pts) {
    if (!pts || !pts.length) return false;
    for (var i = 0; i < pts.length; i++) if (V.dist(q, pts[i]) < 0.06) return true;
    return false;
  }
  /** 앞솔기 맞춤 너치 — 큰소매 앞 밑선과 작은소매 바깥 뒤선은 **봉제로 만나는 짝**이다.
   *  작은소매가 조금 길게 나오는 것이 정상이고(이세), 그 여유를 가운데 구간에 몰아 준다.
   *
   *  · 짧은 쪽 길이의 **1/3 을 위·아래 양 끝에서** 재어 양쪽에 같은 자리로 너치를 넣는다
   *    → 위·아래 구간은 길이가 정확히 같아 그대로 맞물리고,
   *  · 남는 이세는 전부 **가운데 구간**에 들어간다. 작은소매 가운데에 이세 조절 너치를
   *    하나 더 찍어 어디를 오그릴지 표시한다.
   *  @param segsA 큰소매 앞 밑선 · segsB 작은소매 바깥 뒤선 (둘 다 소매통 → 밑단 방향)
   */
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
    /* ★ 소매산 맞춤 너치는 **조각 외곽선에 붙여 나눈다.**
       예전엔 「어느 곡선 위인가」(onPts)로 걸렀는데, 곡선 경계에 놓인 너치가 어느 쪽에도
       안 잡혀 **통째로 사라졌다** — 「뒤 1/3」이 44·55·88호에 없었다(66·77호만 있었다).
       몸판 암홀 3등분에 대응하는 필수 너치가 호수에 따라 있다 없다 한 것이다
       (2026-08-12 QA). 외곽선이 기준이면 조각이 곧 판정 기준이라 빠질 수가 없다. */
    (function () {
      /** 외곽선까지 최단거리와 그 발 — 꼭짓점이 아니라 **변에 내린 수선**이라야
          너치가 재단선 위에 정확히 앉는다 */
      function foot(q, o) {
        var best = null, bd = Infinity;
        for (var i = 1; i < o.length; i++) {
          var a = o[i - 1], b = o[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          var t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var c = [a[0] + t * dx, a[1] + t * dy], e = V.dist(q, c);
          if (e < bd) { bd = e; best = c; }
        }
        return { d: bd, p: best };
      }
      capNotches(s).forEach(function (nt) {
        var fb = foot(nt.p, big.outline), fu = foot(nt.p, und.outline);
        var host = fb.d <= fu.d ? big : und, hit = fb.d <= fu.d ? fb : fu;
        /* ⚠ capNotches 는 **한 장 소매의 소매산**에서 잰다. 작은소매 소매산은 독립
           재제도 곡선이라 「뒤 1/3」이 0.02~0.11 떠 있다 — 그래서 재단선 위로 내린다.
           0.35 를 넘으면 그 조각 것이 아니므로 넣지 않는다. */
        if (hit.d > 0.35) return;
        var dup = host.notches.some(function (x) { return V.dist(x.p, hit.p) < 0.06; });
        if (!dup) host.notches.push({ p: cp(hit.p), angle: nt.angle, label: nt.label });
      });
    })();
    return [big, und];
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
      FN('frontIn',  '앞 경계',     '앞 소매통 − ' + f1(K.twoSideOff),   s.frontInX, B, [s.frontInX, s.topY - 0.8]),
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
      FN('backOut',  '뒤 경계',     '뒤 소매통 + ' + f1(K.twoSideOff),   s.backOutX, U, [s.backOutX, s.topY - 0.8]),
      FN('bicep',    '소매통 연결', '뒤 경계 → 소매통 끝 · 제도는 뒤에 있어도 **앞 암홀 몫**' +
                     ' (큰소매 앞에서 ' + f1(K.twoSideOff) + ' 떼어 여기 붙였다)',
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

  /** 소매 종류에 따라 갈라진다 — 'tight' 한 장 타이트 · 'two' 2장소매 */
  function sleeveGeom(m, opt, AHb, AHf) {
    var stKey = SLEEVE_TYPE[opt && opt.sleeveType] ? opt.sleeveType : 'tight';
    if (stKey === 'two') return twoSleeveGeom(m, opt, AHb, AHf);
    return tightSleeveGeom(m, opt, AHb, AHf);
  }

  function tightSleeveGeom(m, opt, AHb, AHf) {
    var AH = AHb + AHf;
    var capH  = AH / K.capHeightDiv;
    var apex  = [num(opt.capApexShift, K.capApexShift), 0];
    var sleeveLen = num(opt.sleeveLen, K.sleeveLen + K.sleeveLenGrade * ((m.B - BASE.B) / GRADE.B));
    var cuffW     = num(opt.cuffW,     K.cuffW     + K.cuffWGrade     * ((m.B - BASE.B) / GRADE.B));

    var dB = Math.sqrt(Math.max(0.01, AHb * AHb - capH * capH));
    var dF = Math.sqrt(Math.max(0.01, AHf * AHf - capH * capH));
    var capB = [apex[0] - dB, capH];                 // 뒤 소매폭점
    var capF = [apex[0] + dF, capH];                 // 앞 소매폭점
    var width = dB + dF;

    /* 소매산 곡선 — **대각선(앞AH·뒤AH)에서 수직으로 떨어진 양**으로 그린다.
       대각선 자체가 암홀 길이이므로, 곡선이 대각선을 조금만 벗어나야
       소매산 길이 ≈ AH + 이세분(2~4) 이 된다.
       위쪽은 볼록(+), 아래쪽은 오목(−) — 도면의 ≠ 마크가 그 자리다. */
    var C = CAL.sleeveCap;
    function onDiag(a, b, t, off) {                 // a→b 대각선의 t 지점에서 수직 off (+ 가 바깥)
      var u = V.norm(V.sub(b, a)), n2 = [u[1], -u[0]];
      var p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      return [p[0] + n2[0] * off, p[1] + n2[1] * off];
    }
    /* ── 소매산 곡선 — **대각선 기준 수선 오프셋** (SPEC §3.4)
     *  기본원형·숙녀복기본원형1 이 반소매/긴소매 DXF 로 검증한 그 제도법을 그대로 쓴다.
     *  교재 도면의 작은 `⌐` 직각 기호와 등분 표시(⊹ ≠)가 바로 이 수선과 그 이등분이다.
     *
     *  1. 마크 — 상단은 **중심선 상단점(0,0)에서 수평으로** AH/8 (도면 `←5.7` `5.7→`),
     *           하단은 소매폭 끝에서 안쪽으로 뒤 AH/12+0.6(`4.5`) · 앞 AH/8(`5.7`)
     *  2. 각 마크에서 해당 대각선에 **수선**을 내려 발점을 구한다
     *  3. 곡선은 발점↔마크 사이 capBulge(0.5) 자리를 지난다 — 오프셋이 절대값이 아니라
     *     **수선 길이에 비례**한다. 호수가 커져도 모양이 유지되는 이유다.
     *  4. 양 끝 접선은 **둘 다 수평** (긴소매 DXF 실측 도착 접선 뒤 −1.55° / 앞 1.82°)
     *  ⚠ 대각선은 **원점(0,0) 기준**이고 정점만 앞으로 0.6 옮겨진다 — 긴소매 DXF 로 확인된 성질.
     *  ⚠ 상단 마크를 곡선 통과점으로 그대로 쓰면 안 된다. 소매산이 53~54 가 되어
     *    이세분이 8 을 넘는다. 마크는 수선을 내리기 위한 자리다. */
    var markTopB = [-AH / 8, 0],            markTopF = [AH / 8, 0];
    var markBotB = [capB[0] + (AH / 12 + 0.6), capH], markBotF = [capF[0] - AH / 8, capH];
    var fTB = footOn(capB, markTopB), fBB = footOn(capB, markBotB);
    var fTF = footOn(capF, markTopF), fBF = footOn(capF, markBotF);
    var mixP = function (f, mk) { return _lerp(f.foot, mk, K.capBulge); };
    var pTB = mixP(fTB, markTopB), pBB = mixP(fBB, markBotB);
    var pTF = mixP(fTF, markTopF), pBF = mixP(fBF, markBotF);
    /* 상단↔하단 통과점 사이는 S 자이고 그 현의 중점에서 방향이 바뀐다 — 앵커로 넣는다 */
    var midB = _lerp(pTB, pBB, 0.5), midF = _lerp(pTF, pBF, 0.5);
    var capBackA  = splineSegs([apex, pTB, midB, pBB, capB], endTan([-1, 0], C.k0), endTan([-1, 0], C.k1));
    var capFrontA = splineSegs([apex, pTF, midF, pBF, capF], endTan([ 1, 0], C.k0), endTan([ 1, 0], C.k1));
    var capBack  = revSegs(capBackA);        // 조각은 뒤 겨드랑 → 정점 순서로 쓴다
    var capFront = capFrontA;

    /* 소매길이 · 팔꿈치선 · 소매부리 */
    var elbowY = sleeveLen / 2 + K.elbowAdd;
    /* 소맷부리 — **다트분만큼 뒤로 연장한다** (도면 `소맷부리` 치수선이 다트 바깥에서 시작한다).
     *  연장하지 않으면 다트를 접었을 때 소맷부리가 다트분(4.5)만큼 모자란다.
     *  재단 밑단 = 소맷부리 + 다트분 → 접으면 정확히 소맷부리가 된다. */
    var hemB = [-(cuffW / 2 + num(opt.elbowDart, K.elbowDart)), sleeveLen + K.cuffBackDrop];
    var hemF = [ cuffW / 2, sleeveLen];
    /* 팔꿈치 다트 — 도면대로 **소맷부리에 입이 나고 위(팔꿈치)로 뾰족하다**.
     *  중심 : 팔꿈치선에서 **뒤 밑선과 소매 중심선의 중점** (도면의 `중심` + 등분 표시)
     *  끝   : 팔꿈치선에서 아래로 3.8~5 (도면 `↓3.8~5`)
     *  입   : 소맷부리선에서 다트분 4.5, 두 다리를 각각 0.3 내림 (도면 `0.3↓` 두 개)
     *  ⚠ 예전에는 뒤 밑선에 입이 나고 끝이 가로로 뻗어 있었다 — 방향이 90° 달랐다. */
    var eb = lineAt(capB, hemB, elbowY);              // 뒤 밑선 위의 팔꿈치점
    var dartCx = eb[0] / 2;                           // 소매 중심선은 x = 0
    var dartTip = [dartCx, elbowY + num(opt.elbowTipDrop, K.elbowTipDrop)];
    function onHem(x) {                               // 소맷부리선 위의 x 자리
      var t = (hemF[0] - hemB[0]) ? (x - hemB[0]) / (hemF[0] - hemB[0]) : 0;
      return [x, hemB[1] + (hemF[1] - hemB[1]) * t];
    }
    var dHalf = num(opt.elbowDart, K.elbowDart) / 2;
    var dartB = onHem(dartCx - dHalf); dartB[1] += K.cuffDartDrop;   // 뒤쪽 다리
    var dartA = onHem(dartCx + dHalf); dartA[1] += K.cuffDartDrop;   // 앞쪽 다리

    return {
      AH: AH, AHb: AHb, AHf: AHf, capH: capH, apex: apex, capB: capB, capF: capF,
      width: width, sleeveLen: sleeveLen, cuffW: cuffW, elbowY: elbowY,
      hemB: hemB, hemF: hemF, elbowBack: eb, dartA: dartA, dartB: dartB, dartTip: dartTip,
      capBack: capBack, capFront: capFront,
      /* 제도선·치수선용 — 도면의 마크·수선(⌐)·통과점을 그대로 낸다 (SPEC §8.1) */
      markTopB: markTopB, markTopF: markTopF, markBotB: markBotB, markBotF: markBotF,
      footTopB: fTB.foot, footBotB: fBB.foot, footTopF: fTF.foot, footBotF: fBF.foot,
      pTB: pTB, pBB: pBB, pTF: pTF, pBF: pBF,
      capLenBack: sLen(capBackA), capLenFront: sLen(capFrontA),
      /* 앞뒤 이세를 따로 낸다 — 한 장 소매는 조각 경계와 앞뒤 경계가 같으므로 그대로다 */
      capEaseBack: sLen(capBackA) - AHb, capEaseFront: sLen(capFrontA) - AHf,
      capLen: sLen(capBack) + sLen(capFront)
    };
  }
  /** 두 점을 잇는 직선 위에서 y 좌표가 주어진 자리 */
  function lineAt(a, b, y) {
    var t = (b[1] - a[1]) ? (y - a[1]) / (b[1] - a[1]) : 0;
    return [a[0] + (b[0] - a[0]) * t, y];
  }

  /** 소매산 너치 — 몸판 암홀 3등분에 대응. 겨드랑 구간은 이세 0, 나머지에 이세를 나눈다 */
  function capNotchesB2(sv) {
    var out = [], mid = [sv.apex[0], sv.capH + sv.sleeveLen * 0.3];
    var easeAll = Math.max(0, sv.capLen - sv.AH);
    [[sv.capBack, sv.AHb, '뒤', easeAll * 0.6, true],
     [sv.capFront, sv.AHf, '앞', easeAll * 0.4, false]].forEach(function (w) {
      var segs = w[0], L = w[1], tag = w[2], ez = w[3], fromEnd = w[4];
      var acc = 0;
      for (var q = 1; q < 3; q++) {
        acc += ez * (q === 1 ? 0 : 0.5);           // 겨드랑 구간(1/3)에는 이세를 안 넣는다
        var h = _ptAtLen(segs, L * q / 3 + acc, fromEnd);
        out.push({ p: cp(h.p), angle: _inward(h.tan, h.p, mid), label: '소매산 ' + tag + ' ' + q + '/3' });
      }
    });
    return out;
  }
  /** 소매 제도선 — 교재 도면에 그어져 있는 선을 그대로 낸다.
   *  ⚠ 대각선은 **중심선 상단점(0,0) 기준**이고 정점만 앞으로 0.6 옮겨진다.
   *    예전에는 정점에서 그어 도면과 달랐다. */
  function sleeveInternal(sv) {
    var top = [0, 0];
    return [
      L('topLine',  'dashed', [[sv.capB[0], 0], [sv.capF[0], 0]], '상단 기준선'),
      L('capLine',  'line',   [[sv.capB[0], sv.capH], [sv.capF[0], sv.capH]], '소매폭선'),
      L('center',   'dashed', [[0, 0], [0, sv.sleeveLen]], '중심선'),
      L('elbow',    'dashed', [[sv.capB[0], sv.elbowY], [sv.capF[0], sv.elbowY]], '팔꿈치선'),
      L('diagB',    'dashed', [top, sv.capB], '뒤 AH 대각선'),
      L('diagF',    'dashed', [top, sv.capF], '앞 AH 대각선'),
      /* 마크 — 상단은 상단점에서 수평 AH/8, 하단은 소매폭 끝에서 안쪽으로 */
      L('markTopB', 'point',  [sv.markTopB], '뒤 상단 마크'),
      L('markTopF', 'point',  [sv.markTopF], '앞 상단 마크'),
      L('markBotB', 'point',  [sv.markBotB], '뒤 하단 마크'),
      L('markBotF', 'point',  [sv.markBotF], '앞 하단 마크'),
      /* 수선 — 도면의 작은 ⌐ 직각 기호 */
      L('perpTB',   'dashed', [sv.markTopB, sv.footTopB], '뒤 상단 수선'),
      L('perpBB',   'dashed', [sv.markBotB, sv.footBotB], '뒤 하단 수선'),
      L('perpTF',   'dashed', [sv.markTopF, sv.footTopF], '앞 상단 수선'),
      L('perpBF',   'dashed', [sv.markBotF, sv.footBotF], '앞 하단 수선'),
      /* 곡선 통과점 — 수선의 중점 */
      L('pTB',      'point',  [sv.pTB], '뒤 볼록점'),
      L('pBB',      'point',  [sv.pBB], '뒤 오목점'),
      L('pTF',      'point',  [sv.pTF], '앞 볼록점'),
      L('pBF',      'point',  [sv.pBF], '앞 오목점'),
      /* 팔꿈치 다트 — 두 다리는 외곽선과 같은 굵기, 중심선은 파선 */
      L('dartLegA', 'edge',   [sv.dartTip, sv.dartA], '팔꿈치 다트'),
      L('dartLegB', 'edge',   [sv.dartTip, sv.dartB], ''),
      L('dartMid',  'dashed', [sv.dartTip, [sv.dartTip[0], sv.hemB[1]]], '다트 중심'),
      L('apex',     'point',  [sv.apex], '정점')
    ];
  }

  /** 소매 계산식 주석 — 도면의 치수 표기를 그대로 옮긴다.
   *  ⚠ piece 는 조각 id 문자열과 정확히 같아야 한다 ('sleeve'). 다르면 하나도 안 붙는다. */
  function sleeveNotes(sv) {
    var AH = sv.AH, mid = (sv.capH + sv.elbowY) / 2;
    return [
      FN('capH',     '소매산 높이', 'AH/3',                         sv.capH,     'sleeve', [sv.apex[0], sv.capH * 0.5]),
      FN('apex',     '정점 이동',   '앞으로 0.6',                    sv.apex[0],  'sleeve', [sv.apex[0], -1.2]),
      FN('diagB',    '뒤 AH 대각선', '뒤 암홀 길이',                  sv.AHb,      'sleeve', [sv.capB[0] * 0.55, sv.capH * 0.55]),
      FN('diagF',    '앞 AH 대각선', '앞 암홀 길이',                  sv.AHf,      'sleeve', [sv.capF[0] * 0.55, sv.capH * 0.55]),
      FN('markTopB', '뒤 상단 마크', '상단점에서 수평 AH/8',            AH / 8,      'sleeve', [sv.markTopB[0], -2.6]),
      FN('markTopF', '앞 상단 마크', '상단점에서 수평 AH/8',            AH / 8,      'sleeve', [sv.markTopF[0], -2.6]),
      FN('markBotB', '뒤 하단 마크', '소매폭 끝에서 안쪽 AH/12 + 0.6',  AH / 12 + 0.6, 'sleeve', [sv.markBotB[0], sv.capH + 1.6]),
      FN('markBotF', '앞 하단 마크', '소매폭 끝에서 안쪽 AH/8',         AH / 8,      'sleeve', [sv.markBotF[0], sv.capH + 1.6]),
      FN('pTB',      '뒤 볼록점',   '수선의 ' + f1(K.capBulge * 100) + '% (발점↔마크)', V.dist(sv.footTopB, sv.pTB), 'sleeve', [sv.pTB[0] - 1.2, sv.pTB[1] + 1.4]),
      FN('pBB',      '뒤 오목점',   '수선의 ' + f1(K.capBulge * 100) + '%',            V.dist(sv.footBotB, sv.pBB), 'sleeve', [sv.pBB[0] + 1.6, sv.pBB[1] - 1.0]),
      FN('pTF',      '앞 볼록점',   '수선의 ' + f1(K.capBulge * 100) + '%',            V.dist(sv.footTopF, sv.pTF), 'sleeve', [sv.pTF[0] + 1.2, sv.pTF[1] + 1.4]),
      FN('pBF',      '앞 오목점',   '수선의 ' + f1(K.capBulge * 100) + '%',            V.dist(sv.footBotF, sv.pBF), 'sleeve', [sv.pBF[0] - 1.6, sv.pBF[1] - 1.0]),
      FN('capLine',  '소매폭',     '뒤 반 + 앞 반 = √(대각선² − 소매산²) 합', sv.width, 'sleeve', [sv.apex[0], sv.capH - 1.2]),
      FN('capBack',  '뒤 소매산',   '곡선길이 (뒤 암홀 ' + f1(sv.AHb) + ')',  sv.capLenBack,  'sleeve', [sv.capB[0] * 0.42, sv.capH * 0.30]),
      FN('capFront', '앞 소매산',   '곡선길이 (앞 암홀 ' + f1(sv.AHf) + ')',  sv.capLenFront, 'sleeve', [sv.capF[0] * 0.42, sv.capH * 0.30]),
      FN('capEase',  '이세분',     '소매산 − AH',                   sv.capLen - AH, 'sleeve', [sv.apex[0], sv.capH * 0.72]),
      FN('elbow',    '팔꿈치길이',  '소매길이/2 + ' + f1(K.elbowAdd), sv.elbowY,   'sleeve', [sv.apex[0] * 0.5, sv.elbowY - 1.2]),
      FN('sleeveLen','소매길이',   '치수',                          sv.sleeveLen, 'sleeve', [sv.apex[0], mid]),
      FN('dartLegA', '팔꿈치 다트', '다트분 · 끝은 팔꿈치선 아래 ' + f1(K.elbowTipDrop), V.dist(sv.dartA, sv.dartB), 'sleeve', [sv.dartTip[0], sv.dartTip[1] + 2.2]),
      FN('capLine2', '소맷부리',   '치수 + 다트분(접으면 치수)',       sv.cuffW,    'sleeve', [sv.apex[0] * 0.4, sv.hemB[1] - 1.6])
    ];
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
  var SEAM_DEFAULT = { neck: 1.0, shoulder: 1.0, armhole: 1.0, side: 1.5, hem: 3.0,
                       sleeveHem: 2.5, dart: 1.5, fold: 0 };
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
      L('topLine', 'line',   [[0, 0], [g.bSideX, 0]], '상단 기준선'),
      L('BL',      'line',   [[0, g.BL], [g.bSideX, g.BL]], 'BL (B/4)'),
      L('backW',   'dashed', [[g.bPitchX, g.bPitchTop], [g.bPitchX, g.BL]], '등품선 (위끝 = 어깨선 교점)'),
      L('div3',    'dashed', [[g.bPitchX - 1.6, g.bPitchTop + (g.BL - g.bPitchTop) / 3],
                              [g.bPitchX, g.bPitchTop + (g.BL - g.bPitchTop) / 3]], '등품선 3등분'),
      L('div3b',   'dashed', [[g.bPitchX - 3.5, g.bPitchTop + (g.BL - g.bPitchTop) * 2 / 3],
                              [g.bPitchX, g.bPitchTop + (g.BL - g.bPitchTop) * 2 / 3]], '등품선 3등분'),
      L('shGuide', 'dashed', [[g.bSpX, -1.2], [g.bSpX, g.SPb[1]]], '어깨 안내선 (어깨너비/2 + 이세분)'),
      L('neckW',   'dashed', [[g.bNeckW, 0], [g.bNeckW, -2.5]], '뒷목너비'),
      L('SP',      'point',  [g.SPb], 'SP'),
      L('SNP',     'point',  [g.SNPb], 'SNP')
    ];
  }
  function frontInternal(g) {
    var dep = g.FNP[1], nw = g.nw;
    return [
      L('topLine',  'line',   [[0, 0], [g.fSideX, 0]], '상단 기준선'),
      L('BL',       'line',   [[0, g.BL], [g.fSideX, g.BL]], 'BL (B/4)'),
      L('frontW',   'dashed', [[g.fPitchX, g.fPitchTop], [g.fPitchX, g.BL]], '앞품선 (위끝 = 어깨 안내선 교점)'),
      L('neckBox',  'dashed', [[0, dep], [nw, dep], [nw, 0]], '앞목 사각'),
      L('neckDiag', 'dashed', [[0, 0], [nw, dep]], '목 사각 대각선'),
      L('shGuide',  'dashed', [g.fShGuide, [g.fShGuide[0], 0]], '어깨 안내선 (4.5↓)'),
      L('shCut',    'dashed', [g.SPf, g.fShGuide], '이세분 커트'),
      L('bpLen',    'dashed', [g.SNPf, g.BP], '유장'),
      L('bpSpan',   'dashed', [[g.BP[0], 0], [g.BP[0], g.BP[1]]], '유폭/2'),
      /* 다트 접는 선 — 재단선이 아니라 **봉제선**이라 외곽선이 아닌 기준선으로 긋는다.
         바깥의 작은 삼각(다트 위·아래 다리 끝 → 트루잉 점)은 접으면 겹쳐 옆선이 이어진다. */
      /* 다트 다리는 실제로 접어 꿰매는 선이라 **외곽선과 같은 굵기**로 긋는다 (type 'edge').
         기초선(BL·품선)과 같은 회색 가는 선으로 두면 재단할 때 눈에 안 띈다. */
      L('dartLegHi','edge',   [g.BP, g.dartHi], '다트 (위 다리)'),
      L('dartLegLo','edge',   [g.BP, g.dartLo], '다트 (아래 다리)'),
      L('dartMid',  'dashed', [g.BP, g.dartT], '다트 중심'),
      L('sideGuide','dashed', [[g.fSideX, g.BL], [g.fSideX, g.BL + 6.2]], '겨드랑 → 다트 (6.2)'),
      L('BP',       'point',  [g.BP], 'BP'),
      L('SP',       'point',  [g.SPf], 'SP'),
      L('SNP',      'point',  [g.SNPf], 'SNP'),
      L('FNP',      'point',  [g.FNP], 'FNP')
    ];
  }

  function FN(id, label, formula, value, piece, anchor) {
    return { id: id, label: label, formula: formula, value: r4(value), piece: piece, anchor: cp(anchor) };
  }
  function formulaNotes(m, g, AHb, AHf, NKb, NKf, seam) {
    var nw = g.nw;
    return [
      FN('BL',      'BL',        'B/4',                       g.BL,      'back',  [g.bSideX * 0.5, g.BL]),
      FN('side',    '폭',        'B/4 + 여유분/2',             g.bSideX,  'back',  [g.bSideX, g.BL * 0.6]),
      FN('WL',      '허리선',     '등길이',                     g.WLb,     'back',  [g.bSideX * 0.5, g.WLb]),
      FN('backW',   '등품선',     '등품/2',                     g.bPitchX, 'back',  [g.bPitchX, g.BL * 0.5]),
      FN('neckW',   '뒷목너비',   'B/12 + 0.5',                g.bNeckW,  'back',  [g.bNeckW * 0.5, -2.5]),
      FN('neckLift','뒷목 올림',  '고정 2.5',                   2.5,       'back',  cp(g.SNPb)),
      FN('shGuide', '어깨 안내선', '어깨너비/2 + 이세분',          g.bSpX,    'back',  [g.bSpX, 0.4]),
      FN('shBack',  '뒤 어깨선',  '목옆점 → (어깨너비/2+이세분, 1.0)', g.shLenBack, 'back',
                                  [(g.SNPb[0] + g.SPb[0]) / 2, (g.SNPb[1] + g.SPb[1]) / 2]),
      FN('armBack', '뒤 암홀',    '곡선길이',                    AHb,       'back',  [g.bPitchX + 1.2, g.BL * 0.55]),
      FN('neckBack','뒷목둘레',   '곡선길이',                    NKb,       'back',  [nw * 0.5, -1.0]),
      FN('BL',      'BL',        'B/4',                       g.BL,      'front', [g.fSideX * 0.5, g.BL]),
      FN('WL',      '허리선',     '앞길이',                     g.WLf,     'front', [g.fSideX * 0.5, g.WLf]),
      FN('diff',    '앞 등길이 차이', '앞길이 − 등길이',           g.diff,    'front', [g.fSideX * 0.2, 1.5]),
      FN('frontW',  '앞품선',     '앞품/2',                     g.fPitchX, 'front', [g.fPitchX, g.BL * 0.5]),
      FN('neckW',   '앞목너비',   'B/12',                       nw,        'front', [nw * 0.5, -0.8]),
      FN('neckD',   '앞목깊이',   'B/12 + 0.6',                 g.FNP[1],  'front', [0.6, g.FNP[1] * 0.5]),
      FN('neckDiag','앞목 통과점', '목 사각 대각선 2/3 점에서 0.3 더', 0.3,  'front', [nw * 0.7, g.FNP[1] * 0.7]),
      FN('shGuide', '앞 어깨 안내선', '상단에서 4.5 아래',         4.5,       'front', cp(g.fShGuide)),
      FN('shFront', '앞 어깨선',  '뒤 어깨선 − 이세분 (이세분 커트)', g.shLenFront, 'front',
                                  [(g.SNPf[0] + g.SPf[0]) / 2, (g.SNPf[1] + g.SPf[1]) / 2]),
      FN('bpLen',   '유장',       '앞목 옆점에서',                m.bpLen,   'front', [(g.SNPf[0] + g.BP[0]) / 2, (g.SNPf[1] + g.BP[1]) / 2]),
      FN('bpSpan',  '유폭',       '유폭/2',                     g.BP[0],   'front', [g.BP[0] * 0.5, g.BP[1] - 1.2]),
      FN('dart',    '가슴다트',   '다트분 ' + f1(g.opt.dartAmount) + ' · 아래 다리 = 허리선 위 ' + f1(g.opt.dartRise),
                                  g.opt.dartAmount, 'front', [(g.BP[0] + g.fSideX) / 2, (g.dartHi[1] + g.dartLo[1]) / 2]),
      FN('armFront','앞 암홀',    '곡선길이',                    AHf,       'front', [g.fPitchX + 1.2, g.BL * 0.55]),
      FN('neckFront','앞목둘레',  '곡선길이',                    NKf,       'front', [nw * 0.45, g.FNP[1] * 0.55]),
      FN('seam',    '시접',       '변별 기본값',                 (typeof seam === 'number' ? seam : 0), 'both', [0, 0])
    ];
  }

  /* ══════════════════════════════════════════════════════════════════
   * 6. 노출
   * ════════════════════════════════════════════════════════════════ */
  return {
    measuresForSize: measuresForSize,
    draftBodice2: draftBodice2,
    draft: draftBodice2,
    geom: geom,
    MEAS_KEYS: MEAS_KEYS, MEAS_LABEL: MEAS_LABEL, SIZES: Object.keys(SIZE_STEP),
    SLEEVE_TYPE: SLEEVE_TYPE, SLEEVE_TYPES: SLEEVE_TYPES,    BASE: BASE, GRADE: GRADE, K: K, CAL: CAL, FLATTEN: FLATTEN,
    SEAM_DEFAULT: SEAM_DEFAULT, SEAM_ROLES: SEAM_ROLES,
    util: { V: V, bez: bez, bezLen: bezLen, sLen: sLen, through: through, splineSegs: splineSegs,
            endTan: endTan, sPath: sPath, LN: LN,
            sampleSegs: sampleSegs, polyLen: polyLen, offsetLoop: offsetLoop, offsetLoopSeg: offsetLoopSeg,
            normSeam: normSeam, lineSegs: lineSegs,
            rotv: rotv, rotAbout: rotAbout, perpToward: perpToward, revSegs: revSegs }
  };
});
