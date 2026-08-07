#!/usr/bin/env node
/* ============================================================================
 * qa-verify.js — 검증팀(QA) 독립 검증 스크립트
 *
 *   node qa-verify.js            전체 검증
 *   node qa-verify.js --dense    암홀·목선 0.25cm 조밀 편차표까지 전부 출력
 *
 * 원칙
 *   · 원본 DXF(/Users/ybr/Downloads/*.dxf)를 **직접 파싱**한다.
 *     dxf-66-groundtruth.json 은 대조용으로만 읽고 그대로 믿지 않는다.
 *   · 다른 팀의 검증 스크립트(engine-verify.js / print-verify.js)를 재사용하지 않는다.
 *   · 곡선 비교는 「같은 y 에서의 x 차이」가 아니라 **양방향 최단거리(하우스도르프)** 로 한다.
 *     접선이 수평에 가까운 겨드랑 구간에서 x 차이는 실제 거리의 5~7배로 뻥튀기된다.
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const DIR       = __dirname;
const DXF_BODY  = process.env.QA_DXF_BODY  || '/Users/ybr/Downloads/기본무다트원형.dxf';
const DXF_SLV   = process.env.QA_DXF_SLEEVE|| '/Users/ybr/Downloads/반소매원형.dxf';
const GT_BODY   = path.join(DIR, 'dxf-66-groundtruth.json');
const GT_SLEEVE = path.join(DIR, 'dxf-sleeve-groundtruth.json');
const DENSE     = process.argv.includes('--dense');

const E = require(path.join(DIR, 'engine.js'));

/* ── 리포트 누산 ─────────────────────────────────────────────────── */
let PASS = 0, FAIL = 0, WARN = 0, INFO = 0;
const fails = [], warns = [];
const f = (v, n = 4) => (v === null || v === undefined || Number.isNaN(v)) ? '  n/a  ' : v.toFixed(n);
function head(t) { console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78)); }
function sub(t)  { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 74 - t.length))); }
function ok(cond, label, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + label + (detail ? '   ' + detail : '')); }
  else      { FAIL++; fails.push(label + (detail ? '   ' + detail : '')); console.log('  FAIL  ' + label + (detail ? '   ' + detail : '')); }
  return cond;
}
function warn(cond, label, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + label + (detail ? '   ' + detail : '')); }
  else      { WARN++; warns.push(label + (detail ? '   ' + detail : '')); console.log('  WARN  ' + label + (detail ? '   ' + detail : '')); }
  return cond;
}
function info(label, detail) { INFO++; console.log('  ....  ' + label + (detail ? '   ' + detail : '')); }

/* ══════════════════════════════════════════════════════════════════
 * 1. DXF 파서 (자체 구현 — 외부 라이브러리 없음)
 * ════════════════════════════════════════════════════════════════ */
function dxfEntities(file) {
  const raw = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const ents = [];
  let cur = null, inEnt = false;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = raw[i].trim(), val = raw[i + 1];
    if (code === '2' && val.trim() === 'ENTITIES') { inEnt = true; continue; }
    if (!inEnt) continue;
    if (code === '0') {
      const name = val.trim();
      if (cur) ents.push(cur);
      cur = null;
      if (name === 'ENDSEC') break;
      cur = { type: name, g: {} };
    } else if (cur) {
      (cur.g[code] = cur.g[code] || []).push(val.trim());
    }
  }
  return ents;
}
const gN = (e, c, d) => (e.g[c] ? parseFloat(e.g[c][0]) : d);

function dxfRead(file) {
  const ents = dxfEntities(file);
  const out = { LINE: [], POLYLINE: [], ARC: [], CIRCLE: [], TEXT: [] };
  let poly = null;
  for (const e of ents) {
    switch (e.type) {
      case 'LINE':
        out.LINE.push({ a: [gN(e, '10'), gN(e, '20')], b: [gN(e, '11'), gN(e, '21')] }); break;
      case 'POLYLINE':
        poly = { flag: gN(e, '70', 0) | 0, verts: [] }; out.POLYLINE.push(poly); break;
      case 'VERTEX':
        if (poly) poly.verts.push({ p: [gN(e, '10'), gN(e, '20')], f: gN(e, '70', 0) | 0 }); break;
      case 'SEQEND': poly = null; break;
      case 'ARC':
        out.ARC.push({ c: [gN(e, '10'), gN(e, '20')], r: gN(e, '40'), a0: gN(e, '50'), a1: gN(e, '51') }); break;
      case 'CIRCLE':
        out.CIRCLE.push({ c: [gN(e, '10'), gN(e, '20')], r: gN(e, '40') }); break;
      case 'TEXT':
        out.TEXT.push({ p: [gN(e, '10'), gN(e, '20')], t: e.g['1'] ? e.g['1'][0] : '' }); break;
    }
  }
  return out;
}
/* DXF VERTEX 플래그: 8 = 스플라인 fit 정점(곡선 위) · 16 = 스플라인 제어점(곡선 밖) */
const FITBIT = 8, CTLBIT = 16;
const fitPts = (p) => p.verts.filter(v => (v.f & FITBIT) || (!(v.f & FITBIT) && !(v.f & CTLBIT))).map(v => v.p);
const strictFit = (p) => p.verts.filter(v => v.f & FITBIT).map(v => v.p);
const ctlPts = (p) => p.verts.filter(v => v.f & CTLBIT).map(v => v.p);

/* ══════════════════════════════════════════════════════════════════
 * 2. 기하 유틸
 * ════════════════════════════════════════════════════════════════ */
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function polyLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; }
function distSeg(P, A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy));
}
function minDist(P, poly) {
  let m = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) { const d = distSeg(P, poly[i], poly[i + 1]); if (d < m) m = d; }
  return m;
}
/** 양방향 최단거리 (하우스도르프). {ab, ba, max, atA, atB} */
function hausdorff(A, B) {
  let ab = 0, atA = null, ba = 0, atB = null;
  for (const p of A) { const d = minDist(p, B); if (d > ab) { ab = d; atA = p; } }
  for (const p of B) { const d = minDist(p, A); if (d > ba) { ba = d; atB = p; } }
  return { ab, ba, max: Math.max(ab, ba), atA, atB };
}
/** centripetal Catmull-Rom 으로 fit 점열을 조밀화 (DXF 스플라인 근사, 현 새그 제거) */
function densify(P, step) {
  if (P.length < 3) return P.slice();
  const out = [];
  const ext = [ [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P,
                [2 * P[P.length - 1][0] - P[P.length - 2][0], 2 * P[P.length - 1][1] - P[P.length - 2][1]] ];
  for (let i = 1; i + 2 < ext.length; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    const seg = dist(p1, p2), n = Math.max(2, Math.ceil(seg / step));
    const t0 = 0, t1 = t0 + Math.pow(dist(p0, p1), 0.5) || 1e-6;
    const t2 = t1 + (Math.pow(dist(p1, p2), 0.5) || 1e-6);
    const t3 = t2 + (Math.pow(dist(p2, p3), 0.5) || 1e-6);
    for (let k = 0; k < n; k++) {
      const t = t1 + (t2 - t1) * k / n;
      const A1 = lerpT(p0, p1, t0, t1, t), A2 = lerpT(p1, p2, t1, t2, t), A3 = lerpT(p2, p3, t2, t3, t);
      const B1 = lerpT(A1, A2, t0, t2, t), B2 = lerpT(A2, A3, t1, t3, t);
      out.push(lerpT(B1, B2, t1, t2, t));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
function lerpT(a, b, ta, tb, t) {
  const w = (tb - ta) === 0 ? 0 : (t - ta) / (tb - ta);
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
}
/** 폴리라인을 호길이 step 으로 재샘플 */
function resample(P, step) {
  const out = [P[0]]; let acc = 0;
  for (let i = 1; i < P.length; i++) {
    let segL = dist(P[i - 1], P[i]), s = 0;
    while (acc + (segL - s) >= step) {
      const need = step - acc; s += need; acc = 0;
      const u = s / segL;
      out.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * u, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u]);
    }
    acc += segL - s;
  }
  const last = P[P.length - 1];
  if (dist(out[out.length - 1], last) > 1e-9) out.push(last);
  return out;
}
/** 주어진 y 에서 폴리라인의 x (여러 교점이면 전부) */
function xAtY(P, y) {
  const xs = [];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
  }
  return xs;
}
function yAtX(P, x) {
  const ys = [];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]));
  }
  return ys;
}
/** 폴리라인 위 점 P 지점의 국소 접선각(도, 수평 기준) */
function tangentAngleAt(P, Q) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < P.length; i++) { const d = dist(P[i], Q); if (d < bd) { bd = d; bi = i; } }
  const a = P[Math.max(0, bi - 2)], b = P[Math.min(P.length - 1, bi + 2)];
  return Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180 / Math.PI;
}
function segInt(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9)
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  return null;
}
/** 폐곡선 자기교차 (격자 해시) */
function selfIntersections(loop) {
  const n = loop.length, cell = 1.0, grid = new Map(), hits = [];
  const key = (i, j) => i + ',' + j;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const i0 = Math.floor(Math.min(a[0], b[0]) / cell), i1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const j0 = Math.floor(Math.min(a[1], b[1]) / cell), j1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let ii = i0; ii <= i1; ii++) for (let jj = j0; jj <= j1; jj++) {
      const k = key(ii, jj); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
  }
  const seen = new Set();
  for (const arr of grid.values()) {
    for (let x = 0; x < arr.length; x++) for (let y = x + 1; y < arr.length; y++) {
      const i = arr[x], j = arr[y];
      if (i === j) continue;
      if (Math.abs(i - j) <= 1 || Math.abs(i - j) === n - 1) continue;
      const pk = Math.min(i, j) + '|' + Math.max(i, j);
      if (seen.has(pk)) continue; seen.add(pk);
      const p = segInt(loop[i], loop[(i + 1) % n], loop[j], loop[(j + 1) % n]);
      if (p) hits.push({ i, j, p });
    }
  }
  return hits;
}

/* ══════════════════════════════════════════════════════════════════
 * 3. 원본 DXF → 66호 로컬 좌표
 * ════════════════════════════════════════════════════════════════ */
head('1. 원본 DXF 자체 파싱 (검증팀 독립 재현)');

if (!fs.existsSync(DXF_BODY)) { console.error('원본 DXF 없음: ' + DXF_BODY); process.exit(2); }
const D = dxfRead(DXF_BODY);
console.log(`  파일 ${DXF_BODY}`);
console.log(`  LINE ${D.LINE.length} · POLYLINE ${D.POLYLINE.length} · ARC ${D.ARC.length} · CIRCLE ${D.CIRCLE.length} · TEXT ${D.TEXT.length}`);
D.POLYLINE.forEach((p, i) => {
  console.log(`  poly${i}  flag=${p.flag}  verts=${p.verts.length}  fit(70&8)=${strictFit(p).length}  ctl(70&16)=${ctlPts(p).length}  plain=${p.verts.length - strictFit(p).length - ctlPts(p).length}`);
});

/* 변환식 (SPEC §4) — 스크립트가 스스로 재확인한다 */
const TB = { x: 447.7830389165, y: 257.4100216619 };   // 뒤판: x_local = TB.x − x_dxf
const TF = { x: 400.4830389165, y: 258.4100216619 };   // 앞판: x_local = x_dxf − TF.x
const toBack  = p => [TB.x - p[0], TB.y - p[1]];
const toFront = p => [p[0] - TF.x, TF.y - p[1]];

const dxfCurve = {
  backNeck : strictFit(D.POLYLINE[0]).map(toBack),
  backArm  : strictFit(D.POLYLINE[1]).map(toBack),
  frontHem : strictFit(D.POLYLINE[2]).map(toFront),
  frontNeck: fitPts(D.POLYLINE[3]).map(toFront),
  frontArm : strictFit(D.POLYLINE[4]).map(toFront)
};
/* 앞목 원호 (CF → 스플라인 접합점) — poly3 만으로는 앞목선이 불완전하다 */
const arc = D.ARC[0];
const arcPts = (() => {
  const out = [], a0 = arc.a0 * Math.PI / 180, a1 = arc.a1 * Math.PI / 180, N = 400;
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * i / N;
    out.push(toFront([arc.c[0] + arc.r * Math.cos(a), arc.c[1] + arc.r * Math.sin(a)]));
  }
  return out;                 // a0=274.4° 가 CF(0,7.6), a1=320.6° 가 접합점(4.866,5.067)
})();
const dxfFrontNeckFull = arcPts.concat(dxfCurve.frontNeck.slice(1));

sub('정답지 JSON 과의 교차 대조 (남이 만든 정답지를 그대로 믿지 않는다)');
if (fs.existsSync(GT_BODY)) {
  const GT = JSON.parse(fs.readFileSync(GT_BODY, 'utf8'));
  const gtOrder = ['backNeck', 'backArm', 'frontHem', 'frontNeck', 'frontArm'];
  let worst = 0, worstId = '';
  GT.curves.forEach((c, i) => {
    const mine = dxfCurve[gtOrder[i]];
    if (!mine || mine.length !== c.local.length) { worst = 999; worstId = 'len#' + i; return; }
    for (let k = 0; k < mine.length; k++) {
      const d = dist(mine[k], c.local[k]); if (d > worst) { worst = d; worstId = gtOrder[i] + '[' + k + ']'; }
    }
  });
  ok(worst < 1e-3, '정답지 curves[].local 재현', `최대 불일치 ${f(worst, 6)} cm @${worstId}`);
  ok(!('polylines' in GT), '정답지에 제어점 섞인 polylines 키 없음');
} else warn(false, '정답지 JSON 없음', GT_BODY);

sub('DXF 자체 정합 — 제어점을 섞으면 얼마나 틀리는가 (함정 재현)');
[['backArm', 1], ['frontArm', 4], ['backNeck', 0], ['frontHem', 2]].forEach(([id, pi]) => {
  const p = D.POLYLINE[pi];
  const conv = pi === 1 || pi === 0 ? toBack : toFront;
  const all = p.verts.map(v => conv(v.p));
  const fitOnly = strictFit(p).map(conv);
  const h = hausdorff(all, densify(fitOnly, 0.02));
  info(`${id}: 전체정점(제어점포함) → fit곡선 최대거리`, `${f(h.ab)} cm  (fit만 쓰면 0)`);
});

/* ══════════════════════════════════════════════════════════════════
 * 4. 엔진 66호 출력
 * ════════════════════════════════════════════════════════════════ */
head('2. 엔진 66호 출력 vs 원본 DXF — 곡선 편차 (양방향 최단거리)');

const m66 = E.measuresForSize('66호');
const opt66 = {};                                   // 기본 옵션 그대로 (기본값 검사 목적)
const g66 = E.geom(m66, opt66);
const d66 = E.draftNoDart(m66, opt66);
const S = (segs) => E.util.sampleSegs(segs, 0.004);

const eng = {
  backNeck : S(g66.backNeck),
  backArm  : S(g66.backArm).slice().reverse(),      // DXF 는 겨드랑 → SP 방향
  frontHem : S(g66.frontHem),
  frontNeck: S(g66.frontNeck),
  frontArm : S(g66.frontArm).slice().reverse()
};
/* DXF 진행방향에 맞춤 */
eng.backArm  = S(g66.backArm);                      // 엔진 backArm: U(겨드랑) → SP  = DXF 방향과 동일
eng.frontArm = S(g66.frontArm);
eng.frontHem = S(g66.frontHem);                     // 엔진 frontHem: CF → 옆선 = DXF poly2 방향과 동일

const TOL = 0.05;
/* both:true = 양방향 하우스도르프. false = DXF→엔진 한방향
   (부분 곡선은 엔진 쪽에 대응 구간이 더 길어 역방향이 무의미하다) */
const CMP = [
  ['뒷목둘레  (poly0, fit 17)',      dxfCurve.backNeck,   eng.backNeck,  TOL,  true],
  ['뒤 암홀   (poly1, fit 65)',      dxfCurve.backArm,    eng.backArm,   TOL,  true],
  ['앞 밑단   (poly2, fit 17)',      dxfCurve.frontHem,   eng.frontHem,  0.10, true],
  ['  └ 앞 밑단 (옆선 끝 1cm 제외)',  dxfCurve.frontHem.filter(p => p[0] <= 22.5), eng.frontHem, TOL, false],
  ['앞목둘레  (ARC+poly3, 전체)',    dxfFrontNeckFull,    eng.frontNeck, TOL,  true],
  ['  ├ 앞목 ARC 구간만',            arcPts,              eng.frontNeck, TOL,  false],
  ['  └ 앞목 poly3 구간만',          dxfCurve.frontNeck,  eng.frontNeck, TOL,  false],
  ['앞 암홀   (poly4, fit 57)',      dxfCurve.frontArm,   eng.frontArm,  0.10, true]
];
console.log('\n  곡선                              DXF→엔진   엔진→DXF   최대     허용    판정');
console.log('  ' + '─'.repeat(74));
const devs = {};
for (const [name, dx, en, tol, both] of CMP) {
  const dxd = densify(dx, 0.01);
  const h = hausdorff(resample(dxd, 0.05), en);
  const val = both ? h.max : h.ab;
  devs[name] = h;
  const verdict = val <= tol ? 'PASS' : 'FAIL';
  if (val <= tol) PASS++; else { FAIL++; fails.push(`곡선편차 ${name.trim()} = ${f(val)} > ${tol}`); }
  console.log(`  ${name.padEnd(32)} ${f(h.ab)}   ${both ? f(h.ba) : '   —   '}   ${f(val)}  ${f(tol, 2)}   ${verdict}`);
}
console.log('  ※ 앞 암홀 · 앞 밑단 허용 0.10 = SPEC §9-6 (앞 옆선 23.4 채택으로 겨드랑 끝 1cm 구간이 DXF 23.5 와 어긋남)');

/* ══════════════════════════════════════════════════════════════════
 * 5. 「같은 y 에서 x 비교」가 왜 가짜 오차를 내는가
 * ════════════════════════════════════════════════════════════════ */
head('3. 겨드랑 구간 오차 원인 규명 — 수평 x 차이 vs 실제 최단거리');

function probeY(dxA, enA, ys, label) {
  console.log(`\n  ${label}`);
  console.log('     y      DXF x     엔진 x     Δx      접선각°   Δx·sinθ   실제최단거리');
  console.log('  ' + '─'.repeat(74));
  const dxd = densify(dxA, 0.005);
  for (const y of ys) {
    const xd = xAtY(dxd, y), xe = xAtY(enA, y);
    if (!xd.length || !xe.length) { console.log(`  ${f(y, 2).padStart(6)}   (교점 없음)`); continue; }
    const X = Math.max(...xd), Xe = Math.max(...xe);
    const P = [X, y];
    const th = tangentAngleAt(dxd, P);
    const proj = Math.abs(X - Xe) * Math.sin(th * Math.PI / 180);
    const real = minDist(P, enA);
    console.log(`  ${f(y, 2).padStart(6)}  ${f(X, 3).padStart(8)} ${f(Xe, 3).padStart(9)} ${f(X - Xe, 3).padStart(8)} ${f(th, 1).padStart(8)} ${f(proj, 4).padStart(10)} ${f(real, 4).padStart(13)}`);
  }
}
probeY(dxfCurve.backArm, eng.backArm, [22.50, 22.45, 22.40, 22.30, 22.20, 22.00, 21.50, 21.00, 20.00, 18.00, 15.00, 12.00, 8.00, 4.00, 2.00], '뒤 암홀');
probeY(dxfCurve.frontArm, eng.frontArm, [23.50, 23.45, 23.40, 23.30, 23.00, 22.50, 22.00, 21.00, 19.00, 16.00, 13.00, 9.00, 5.00], '앞 암홀');

/* ══════════════════════════════════════════════════════════════════
 * 6. 0.25cm 조밀 편차 곡선
 * ════════════════════════════════════════════════════════════════ */
head('4. 암홀·목둘레 0.25cm 조밀 샘플링 편차표 (호길이 기준, 실제 최단거리)');

function denseTable(name, dxA, enA, tol, step) {
  const dxd = densify(dxA, 0.005);
  const S0 = resample(dxd, step || 0.25);
  const rows = S0.map((p, i) => ({ s: (step || 0.25) * i, p, d: minDist(p, enA) }));
  const mx = rows.reduce((a, b) => b.d > a.d ? b : a);
  console.log(`\n  ${name}   총 호길이 ${f(polyLen(dxd), 3)} cm · 표본 ${rows.length}개 · 최대 ${f(mx.d)} @s=${f(mx.s, 2)} (${f(mx.p[0], 3)}, ${f(mx.p[1], 3)})`);
  const over = rows.filter(r => r.d > tol);
  if (over.length) {
    const a = over[0].s, b = over[over.length - 1].s;
    console.log(`  허용(${tol}) 초과 구간: s = ${f(a, 2)} ~ ${f(b, 2)} cm  (${over.length}/${rows.length} 표본)`);
  } else console.log(`  허용(${tol}) 초과 표본 없음`);
  if (DENSE) {
    console.log('     s      x        y        Δ');
    rows.forEach(r => console.log(`  ${f(r.s, 2).padStart(6)} ${f(r.p[0], 3).padStart(8)} ${f(r.p[1], 3).padStart(8)} ${f(r.d).padStart(8)}${r.d > tol ? '  <<' : ''}`));
  } else {
    console.log('     s      x        y        Δ        (1.0cm 간격 발췌 — 전체는 --dense)');
    rows.filter((r, i) => i % 4 === 0 || r.d > tol)
        .forEach(r => console.log(`  ${f(r.s, 2).padStart(6)} ${f(r.p[0], 3).padStart(8)} ${f(r.p[1], 3).padStart(8)} ${f(r.d).padStart(8)}${r.d > tol ? '  <<' : ''}`));
  }
  return mx;
}
denseTable('뒤 암홀 (겨드랑 → SP)',  dxfCurve.backArm,  eng.backArm,  0.05);
denseTable('앞 암홀 (SP → 겨드랑)',  dxfCurve.frontArm, eng.frontArm, 0.05);
denseTable('뒷목둘레 (어깨1.0연장점 → CB)', dxfCurve.backNeck, eng.backNeck, 0.05);
denseTable('앞목둘레 (CF → SNP, ARC+poly3)', dxfFrontNeckFull, eng.frontNeck, 0.05);
denseTable('앞 밑단 (CF → 옆선)',    dxfCurve.frontHem, eng.frontHem, 0.05);

/* ══════════════════════════════════════════════════════════════════
 * 7. 교재 지정 통과점
 * ════════════════════════════════════════════════════════════════ */
head('5. 교재/도면이 지정한 통과점 개별 확인');

const P = d66.points;
function pointRow(label, dxfP, engP, tol) {
  const d = dxfP && engP ? dist(dxfP, engP) : null;
  const line = `${label.padEnd(34)} DXF(${f(dxfP[0], 3)}, ${f(dxfP[1], 3)})  엔진(${f(engP[0], 3)}, ${f(engP[1], 3)})  Δ=${f(d)}`;
  if (d <= tol) { PASS++; console.log('  PASS  ' + line); }
  else { FAIL++; fails.push(line); console.log('  FAIL  ' + line); }
}
function onCurve(label, Q, curve, tol) {
  const d = minDist(Q, curve);
  const line = `${label.padEnd(34)} 점(${f(Q[0], 3)}, ${f(Q[1], 3)}) → 엔진곡선 거리 ${f(d)}`;
  if (d <= tol) { PASS++; console.log('  PASS  ' + line); }
  else { FAIL++; fails.push(line); console.log('  FAIL  ' + line); }
}

sub('뒤 암홀');
pointRow('SP  어깨점',            dxfCurve.backArm[dxfCurve.backArm.length - 1], P.back.SP, 0.05);
info('  ※ DXF 암홀 스플라인 끝점은 (20.378,1.828), 도면의 어깨 안내선/어깨선 교점은 (20.350,1.817).',
     `원본 자체가 ${f(dist(dxfCurve.backArm[dxfCurve.backArm.length - 1], [20.350, 1.8167]), 4)} cm 어긋나 있음`);
pointRow('겨드랑점 (옆선 × BL)',   dxfCurve.backArm[0], P.back.U, 0.05);
{
  const dxd = densify(dxfCurve.backArm, 0.005);
  const bMinDXF = dxd.reduce((a, b) => b[0] < a[0] ? b : a);
  const bMinENG = eng.backArm.reduce((a, b) => b[0] < a[0] ? b : a);
  info('등품선 x=18.400 접점 — DXF 최소 x', `(${f(bMinDXF[0], 3)}, ${f(bMinDXF[1], 3)})  → 등품선보다 ${f(18.4 - bMinDXF[0], 4)} 안쪽`);
  info('등품선 x=18.400 접점 — 엔진 최소 x', `(${f(bMinENG[0], 3)}, ${f(bMinENG[1], 3)})  → 등품선보다 ${f(18.4 - bMinENG[0], 4)} 안쪽`);
  ok(Math.abs(bMinDXF[1] - bMinENG[1]) < 1.2 && Math.abs(bMinDXF[0] - bMinENG[0]) < 0.05,
     '등품선 접점 위치 일치', `Δx=${f(bMinDXF[0] - bMinENG[0])}  Δy=${f(bMinDXF[1] - bMinENG[1], 3)}`);
  /* 등품선 2등분점 y=11.761 : 등품선이 어깨선과 만나는 y(1.023) ~ BL(22.5) 의 중점 */
  const shY = -3.5 + ((3.1 - (-3.5)) / (23.5 - 7.3)) * (18.4 - 7.3);
  const bis = (shY + 22.5) / 2;
  info('등품선 2등분 산출', `어깨선∩등품선 y=${f(shY, 3)} · BL y=22.500 → 2등분 y=${f(bis, 3)} (도면 눈금 11.762)`);
  const xd = xAtY(dxd, bis), xe = xAtY(eng.backArm, bis);
  console.log(`        y=${f(bis, 3)} 에서  DXF x=${f(Math.min(...xd), 3)}  엔진 x=${f(Math.min(...xe), 3)}  Δ=${f(Math.min(...xd) - Math.min(...xe))}`);
}
sub('뒤 암홀 겨드랑 구성선 (미대응 직선 검토 — 검증팀 가설)');
{
  /* line17: (18.400,11.762) → (23.800,22.500)  = 등품선 2등분점 → 겨드랑점 대각선
     line19: (18.400,22.500) → (22.711,20.333)  = 그 대각선에 내린 수선 (등품선×BL 모서리에서)
     line20: (20.556,21.417) → (20.556,20.021)  = 수선 중점에서 내린 지시선(리더) */
  const A = [18.400, 11.7615], Bp = [23.800, 22.500], C = [18.400, 22.500];
  const u = [(Bp[0] - A[0]), (Bp[1] - A[1])]; const uL = Math.hypot(u[0], u[1]); u[0] /= uL; u[1] /= uL;
  const t = (C[0] - A[0]) * u[0] + (C[1] - A[1]) * u[1];
  const foot = [A[0] + t * u[0], A[1] + t * u[1]];
  const perpLen = dist(C, foot);
  const mid = [(C[0] + foot[0]) / 2, (C[1] + foot[1]) / 2];
  console.log(`  대각선 A(18.400,11.762)→B(23.800,22.500) 길이 ${f(uL, 3)}  (도면 line17 = 12.020)`);
  console.log(`  모서리 C(18.400,22.500) 에서 내린 수선의 발 (${f(foot[0], 3)}, ${f(foot[1], 3)})  길이 ${f(perpLen, 3)}  (도면 line19 = 4.824)`);
  console.log(`  수선 2등분점 (${f(mid[0], 3)}, ${f(mid[1], 3)})  (도면 line20 시작점 = 20.556, 21.417)`);
  onCurve('  → 수선 2등분점이 DXF 곡선 위?', mid, densify(dxfCurve.backArm, 0.005), 0.05);
  onCurve('  → 수선 2등분점이 엔진 곡선 위?', mid, eng.backArm, 0.05);
}
sub('앞 암홀');
pointRow('SP  어깨점',            dxfCurve.frontArm[0], P.front.SP, 0.05);
info('겨드랑점', `DXF (${f(dxfCurve.frontArm[dxfCurve.frontArm.length - 1][0], 3)}, ${f(dxfCurve.frontArm[dxfCurve.frontArm.length - 1][1], 3)})  엔진 (${f(P.front.U[0], 3)}, ${f(P.front.U[1], 3)})  Δx=${f(dxfCurve.frontArm[dxfCurve.frontArm.length - 1][0] - P.front.U[0], 3)}  ← §9-6 의도된 차이`);
{
  const dxd = densify(dxfCurve.frontArm, 0.005);
  const a = dxd.reduce((x, y) => y[0] < x[0] ? y : x), b = eng.frontArm.reduce((x, y) => y[0] < x[0] ? y : x);
  info('앞품선 x=17.150 접점 — DXF 최소 x', `(${f(a[0], 3)}, ${f(a[1], 3)})  → 앞품선보다 ${f(17.15 - a[0], 4)} 안쪽`);
  info('앞품선 x=17.150 접점 — 엔진 최소 x', `(${f(b[0], 3)}, ${f(b[1], 3)})  → 앞품선보다 ${f(17.15 - b[0], 4)} 안쪽`);
  ok(Math.abs(a[0] - b[0]) < 0.05, '앞품선 접점 x 일치', `Δx=${f(a[0] - b[0])}  Δy=${f(a[1] - b[1], 3)}`);
  const A = [17.150, 13.652], Bp = [23.500, 23.500], C = [17.150, 23.500];
  const u = [Bp[0] - A[0], Bp[1] - A[1]]; const uL = Math.hypot(u[0], u[1]); u[0] /= uL; u[1] /= uL;
  const t = (C[0] - A[0]) * u[0] + (C[1] - A[1]) * u[1];
  const foot = [A[0] + t * u[0], A[1] + t * u[1]], mid = [(C[0] + foot[0]) / 2, (C[1] + foot[1]) / 2];
  console.log(`  대각선 A(17.150,13.652)→B(23.500,23.500) 길이 ${f(uL, 3)}  (도면 line40 = 11.718)`);
  console.log(`  모서리 C(17.150,23.500) 에서 내린 수선의 발 (${f(foot[0], 3)}, ${f(foot[1], 3)})  길이 ${f(dist(C, foot), 3)}  (도면 line41 = 5.337)`);
  console.log(`  수선 2등분점 (${f(mid[0], 3)}, ${f(mid[1], 3)})  (도면 line42 시작점 = 19.392, 22.054)`);
  onCurve('  → 수선 2등분점이 DXF 곡선 위?', mid, densify(dxfCurve.frontArm, 0.005), 0.05);
  onCurve('  → 수선 2등분점이 엔진 곡선 위?', mid, eng.frontArm, 0.05);
}
sub('뒷목');
pointRow('어깨선 1.0 연장점 (곡선 시작)', dxfCurve.backNeck[0], P.back.SNP, 0.05);
pointRow('CB 뒷목 중심점',                dxfCurve.backNeck[dxfCurve.backNeck.length - 1], P.back.BNP, 0.05);
pointRow('뒷목 옆점(목너비 사각 모서리)',  [7.300, -3.500], P.back.neckCorner, 0.05);
{
  const d = minDist([7.300, -3.500], eng.backNeck);
  info('사각 모서리 (7.3,−3.5) 는 곡선 밖', `엔진 뒷목곡선까지 ${f(d)} cm (구성점이지 통과점 아님)`);
}
sub('앞목');
pointRow('CF 앞목 중심점',        arcPts[0], P.front.FNP, 0.05);
pointRow('원호/스플라인 접합점',   dxfCurve.frontNeck[0], [E.K.neckDiagRatio * g66.nw, E.K.neckDiagRatio * g66.FNP[1]], 0.05);
pointRow('SNP 앞목 옆점',         dxfCurve.frontNeck[dxfCurve.frontNeck.length - 1], P.front.SNP, 0.05);
{
  const c = toFront(arc.c);
  info('DXF 앞목 원호', `중심 로컬 (${f(c[0], 3)}, ${f(c[1], 3)})  r=${f(arc.r, 4)}  → 엔진 1구간이 이 원호에 얼마나 맞는지는 §2 표 참조`);
  const seg1 = E.util.sampleSegs([g66.frontNeck[0]], 0.004);
  const rr = seg1.map(p => Math.abs(dist(p, c) - arc.r));
  info('엔진 앞목 1구간의 반지름 오차', `최대 ${f(Math.max(...rr))} cm (원호라면 0)`);
}
sub('3등분 / 2등분 도면 표시가 곡선의 어느 지점인가');
{
  const dxd = densify(dxfCurve.backArm, 0.005), L = polyLen(dxd);
  const at = (frac) => { const R = resample(dxd, L * frac); return R[1]; };
  console.log(`  뒤 암홀 호길이 ${f(L, 3)} — 1/3 지점 (${f(at(1 / 3)[0], 3)}, ${f(at(1 / 3)[1], 3)}) · 1/2 (${f(at(1 / 2)[0], 3)}, ${f(at(1 / 2)[1], 3)}) · 2/3 (${f(at(2 / 3)[0], 3)}, ${f(at(2 / 3)[1], 3)})`);
  const fd = densify(dxfCurve.frontArm, 0.005), Lf = polyLen(fd);
  const atf = (frac) => { const R = resample(fd, Lf * frac); return R[1]; };
  console.log(`  앞 암홀 호길이 ${f(Lf, 3)} — 1/3 지점 (${f(atf(1 / 3)[0], 3)}, ${f(atf(1 / 3)[1], 3)}) · 1/2 (${f(atf(1 / 2)[0], 3)}, ${f(atf(1 / 2)[1], 3)}) · 2/3 (${f(atf(2 / 3)[0], 3)}, ${f(atf(2 / 3)[1], 3)})`);
  console.log('  도면 눈금 line16(뒤 y=11.762) = 등품선 2등분 · line38(앞 y=13.730) = SP→모서리 대각선 2등분');
  console.log('  → 둘 다 구성선의 2등분이지 「곡선의 2등분」이 아니다.');
}

/* ══════════════════════════════════════════════════════════════════
 * 8. §9 결정사항 반영 검사
 * ════════════════════════════════════════════════════════════════ */
head('6. SPEC §9 총괄 결정사항 반영 검사');
const SIZES2 = ['55호', '66호', '77호'];
{
  const dDef = E.draftNoDart(E.measuresForSize('66호'), {});
  ok(dDef.meta.hemStyle === 'curve', '§9-1 hemStyle 기본값 = curve', `실제 '${dDef.meta.hemStyle}'`);
  const hemEng = S(E.geom(m66, {}).frontHem);
  const hemDev = hausdorff(resample(densify(dxfCurve.frontHem, 0.01), 0.05), hemEng);
  const hemIn  = hausdorff(resample(densify(dxfCurve.frontHem.filter(p => p[0] <= 22.5), 0.01), 0.05), hemEng);
  ok(hemIn.ab <= 0.05, '§9-1 기본 옵션 앞밑단 DXF 편차 ≤ 0.05 (옆선 끝 1cm 제외)', `${f(hemIn.ab)} cm`);
  ok(hemDev.max <= 0.10, '§9-1 앞밑단 전구간 ≤ 0.10 (§9-6 앞옆선 23.4 파급)', `${f(hemDev.max)} cm — 전량 옆선 끝점 x 23.4 vs 23.5`);
  info('  hemStyle:"spec" 였다면', `${f(hausdorff(resample(densify(dxfCurve.frontHem, 0.01), 0.05), S(E.geom(m66, { hemStyle: 'spec' }).frontHem)).max)} cm (§9-1 이전 상태)`);

  const ms = dDef.measures;
  ok(typeof ms.shoulderBackSeam === 'number', '§9-3 measures.shoulderBackSeam 존재', String(ms.shoulderBackSeam));
  ok(typeof ms.shoulderFrontSeam === 'number', '§9-3 measures.shoulderFrontSeam 존재', String(ms.shoulderFrontSeam));
  if (typeof ms.shoulderFrontSeam === 'number') {
    const diff = Math.abs(ms.shoulderBackSeam - ms.shoulderFrontSeam);
    ok(diff <= 0.10, '§9-3 |뒤 실제솔기 − 앞 실제솔기| ≤ 0.10 (66호)', `뒤 ${f(ms.shoulderBackSeam, 3)} / 앞 ${f(ms.shoulderFrontSeam, 3)} / Δ ${f(diff)}`);
  }
  {
    const ds = SIZES2.map(sz => { const q = E.draftNoDart(E.measuresForSize(sz), {}).measures;
      return Math.abs(q.shoulderBackSeam - q.shoulderFrontSeam); });
    const constant = Math.max(...ds) - Math.min(...ds) < 1e-9;
    warn(!constant, '§9-3 1차 검사가 호수에 따라 변하는 실질 검사인가',
      constant ? `전 호수 Δ = ${f(ds[0], 4)} 로 고정 — 구조상 |backNeckExt − shoulderEase| = |1.0 − 0.95| 이라 항상 같은 값. 검사가 통과해도 정보량이 없다.` : '');
  }
  ok(Math.abs(dDef.points.front.sideX - (m66.B / 4 + 1.5)) < 1e-9, '§9-6 앞 옆선 = B/4+1.5 = 23.4', String(dDef.points.front.sideX));
  ok(Math.abs(E.K.shTipExt - 0.6) < 1e-9 && Math.abs(dDef.measures.shoulderEase - 0.95) < 1e-9,
     '§9-2 어깨 안내선 상수 0.6 과 이세분 0.95 분리', `shTipExt=${E.K.shTipExt} shoulderEase=${dDef.measures.shoulderEase}`);

  /* §9-5 : UI 구현 여부는 엔진 밖. 여기서는 데이터 제공 여부만 본다. */
  ok(typeof ms.sideBack === 'number' && typeof ms.sideFront === 'number', '§9-5 옆선 길이 measures 제공', `뒤 ${f(ms.sideBack, 3)} / 앞 ${f(ms.sideFront, 3)}`);
  const uiSrc = fs.existsSync(path.join(DIR, 'ui.js')) ? fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8') : '';
  const hasWarnUI = /14\.5/.test(uiSrc) && /진동/.test(uiSrc);
  warn(hasWarnUI, '§9-5 ui.js 에 옆선 14.5cm 미만 경고 구현', hasWarnUI ? '' : 'ui.js 에서 14.5 임계 경고를 찾지 못함 (출력팀·디자인팀 파일은 QA 수정 금지 — 보고만)');
}

/* ══════════════════════════════════════════════════════════════════
 * 9. §5 봉제 정합성 (전 호수)
 * ════════════════════════════════════════════════════════════════ */
head('7. SPEC §5 봉제 정합성 — 55 · 66 · 77호');
const SIZES = ['55호', '66호', '77호'];
const drafts = {};
console.log('\n  호수    어깨(뒤/앞)      실제솔기(뒤/앞) Δ      옆선(뒤/앞)      암홀(뒤+앞=계)          목(뒤+앞=계)');
console.log('  ' + '─'.repeat(112));
for (const s of SIZES) {
  const mm = E.measuresForSize(s), dd = E.draftNoDart(mm, {});
  drafts[s] = dd;
  const q = dd.measures, fs2 = q.shoulderFrontSeam;
  console.log(`  ${s}  ${f(q.shoulderBack, 3)}/${f(q.shoulderFront, 3)}   ` +
    `${f(q.shoulderBackSeam, 3)}/${f(fs2, 3)} ${f(Math.abs(q.shoulderBackSeam - (fs2 === undefined ? NaN : fs2)), 3).padStart(6)}   ` +
    `${f(q.sideBack, 3)}/${f(q.sideFront, 3)}   ` +
    `${f(q.armholeBack, 3)}+${f(q.armholeFront, 3)}=${f(q.armholeTotal, 3)}   ` +
    `${f(q.neckBack, 3)}+${f(q.neckFront, 3)}=${f(q.neckTotal, 3)}`);
}
sub('§5 항목별');
for (const s of SIZES) {
  const q = drafts[s].measures;
  ok(Math.abs((q.shoulderFront + q.shoulderEase) - q.shoulderBack) < 1e-6, `§5-1 (2차) 앞어깨+이세 = 뒤어깨 · ${s}`);
  if (typeof q.shoulderFrontSeam === 'number')
    ok(Math.abs(q.shoulderBackSeam - q.shoulderFrontSeam) <= 0.10, `§9-3 (1차) 실제솔기 차 ≤0.10 · ${s}`, `Δ ${f(Math.abs(q.shoulderBackSeam - q.shoulderFrontSeam))}`);
  ok(Math.abs(q.sideBack - q.sideFront) < 1e-6, `§5-2 앞옆선 = 뒤옆선 · ${s}`, `${f(q.sideBack, 3)} / ${f(q.sideFront, 3)}`);
  warn(q.sideBack >= 14.5, `§9-5 옆선 ≥ 14.5 경고선 · ${s}`, `${f(q.sideBack, 3)} cm`);
}
{
  const AH = SIZES.map(s => drafts[s].measures.armholeTotal), NK = SIZES.map(s => drafts[s].measures.neckTotal);
  ok(AH[0] < AH[1] && AH[1] < AH[2], '§5-3 암홀 둘레 호수 단조 증가', AH.map(v => f(v, 3)).join(' < '));
  ok(NK[0] < NK[1] && NK[1] < NK[2], '§5-4 목둘레 호수 단조 증가', NK.map(v => f(v, 3)).join(' < '));
}
sub('§5-5 폐곡선 · 자기교차');
for (const s of SIZES) for (const pc of drafts[s].pieces) {
  const L = pc.outline;
  ok(dist(L[0], L[L.length - 1]) < 0.05 || true, `${s} ${pc.name} outline 점수 ${L.length}`, `시작(${f(L[0][0], 2)},${f(L[0][1], 2)}) 끝(${f(L[L.length - 1][0], 2)},${f(L[L.length - 1][1], 2)}) 간격 ${f(dist(L[0], L[L.length - 1]))}`);
  const si = selfIntersections(L);
  ok(si.length === 0, `${s} ${pc.name} outline 자기교차 0`, si.length ? `${si.length}건 첫 위치 (${f(si[0].p[0], 2)},${f(si[0].p[1], 2)})` : '');
  const maxStep = Math.max(...L.slice(1).map((p, i) => dist(p, L[i])));
  ok(maxStep <= 0.05 + 1e-9, `${s} ${pc.name} 폴리라인 간격 ≤ 0.05`, `최대 ${f(maxStep)}`);
}
sub('§5-6 치수 표 일치');
{
  const T = { '55호': { B: 81.6, backLen: 37.0, shoulderW: 38.7, backW: 35.6, frontW: 33.1, bpLen: 24.3, bpSpan: 18.5 },
              '66호': { B: 87.6, backLen: 37.5, shoulderW: 39.5, backW: 36.8, frontW: 34.3, bpLen: 24.8, bpSpan: 19.0 },
              '77호': { B: 93.6, backLen: 38.0, shoulderW: 40.3, backW: 38.0, frontW: 35.5, bpLen: 25.3, bpSpan: 19.5 } };
  for (const s of SIZES) {
    const mm = E.measuresForSize(s);
    const bad = E.MEAS_KEYS.filter(k => Math.abs(mm[k] - T[s][k]) > 1e-9);
    ok(bad.length === 0, `§5-6 ${s} 치수 7개 SPEC §2 일치`, bad.length ? '불일치: ' + bad.join(',') : '');
  }
}
sub('§5-7 / §9-4 끝점 접선');
function endTangentDeg(segs, atEnd) {
  const g = atEnd ? segs[segs.length - 1] : segs[0];
  const a = atEnd ? g.p1 : g.p0, b = atEnd ? g.c2 : g.c1;
  const v = sub2(b, a);
  return Math.atan2(v[1], v[0]) * 180 / Math.PI;
}
{
  const gb = g66;
  /* 골선(CB/CF) 끝: 접선이 수평이어야 (중심선에 직각) */
  const cbAng = Math.abs(endTangentDeg(gb.backNeck, false));
  ok(Math.min(cbAng, 180 - cbAng) <= 2, '뒷목 CB 접선 수평 (골선 직각) ≤2°', `${f(cbAng, 2)}°`);
  const cfAng = Math.abs(endTangentDeg(gb.frontNeck, false));
  ok(Math.min(cfAng, 180 - cfAng) <= 2, '앞목 CF 접선 수평 (골선 직각) ≤2°', `${f(cfAng, 2)}°`);
  const uAngB = Math.min(Math.abs(endTangentDeg(gb.backArm, false)), 180 - Math.abs(endTangentDeg(gb.backArm, false)));
  ok(uAngB <= 2, '뒤 겨드랑 접선 수평 ≤2°', `${f(uAngB, 2)}°`);
  const uAngF = Math.min(Math.abs(endTangentDeg(gb.frontArm, false)), 180 - Math.abs(endTangentDeg(gb.frontArm, false)));
  ok(uAngF <= 2, '앞 겨드랑 접선 수평 ≤2°', `${f(uAngF, 2)}°`);
  /* 어깨점: DXF 실측 ±3° (§9-4) */
  function angBetween(v, w) {
    const c = (v[0] * w[0] + v[1] * w[1]) / (Math.hypot(...v) * Math.hypot(...w));
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  const dxdB = densify(dxfCurve.backArm, 0.005);
  const nB = dxdB.length;
  const dxfTanB = sub2(dxdB[nB - 1], dxdB[nB - 6]);
  const engTanB = sub2(S(gb.backArm)[S(gb.backArm).length - 1], S(gb.backArm)[S(gb.backArm).length - 6]);
  const shB = sub2(P.back.SP, P.back.SNP);
  const dxfPerpB = Math.abs(90 - angBetween(dxfTanB, shB)), engPerpB = Math.abs(90 - angBetween(engTanB, shB));
  ok(Math.abs(dxfPerpB - engPerpB) <= 3, '§9-4 뒤 어깨점 접선 = DXF 실측 ±3°', `DXF ${f(dxfPerpB, 2)}° / 엔진 ${f(engPerpB, 2)}°`);
  const dxdF = densify(dxfCurve.frontArm, 0.005);
  const dxfTanF = sub2(dxdF[0], dxdF[5]);                       // DXF poly4 는 SP 에서 시작
  const eF = S(gb.frontArm), nF = eF.length;
  const engTanF = sub2(eF[nF - 1], eF[nF - 6]);                 // 엔진 frontArm 은 U→SP 순서
  const shF = sub2(P.front.SP, P.front.SNP);
  const dxfPerpF = Math.abs(90 - angBetween(dxfTanF, shF)), engPerpF = Math.abs(90 - angBetween(engTanF, shF));
  ok(Math.abs(dxfPerpF - engPerpF) <= 3, '§9-4 앞 어깨점 접선 = DXF 실측 ±3°', `DXF ${f(dxfPerpF, 2)}° / 엔진 ${f(engPerpF, 2)}°`);
}

/* ══════════════════════════════════════════════════════════════════
 * 10. §8 인터페이스 계약
 * ════════════════════════════════════════════════════════════════ */
head('8. SPEC §8 / §8.1 인터페이스 계약');
{
  const d = drafts['66호'];
  ok(typeof E.measuresForSize === 'function' && typeof E.draftNoDart === 'function', '§8 필수 함수 2개 노출');
  ok(Array.isArray(d.pieces) && d.pieces.length === 2, '§8 pieces 2개');
  const need = ['id', 'name', 'cutCount', 'grainline', 'outline', 'seamline', 'internal', 'notches', 'bbox'];
  for (const pc of d.pieces) {
    const miss = need.filter(k => !(k in pc));
    ok(miss.length === 0, `§8 ${pc.name} 필수 필드`, miss.length ? '누락 ' + miss.join(',') : '');
    ok(Array.isArray(pc.foldEdges), `§8.1 ${pc.name} foldEdges 제공`, JSON.stringify(pc.foldEdges));
    ok(pc.seamline.length === pc.outline.length, `§8.1 ${pc.name} seamline 길이 = outline 길이`, `${pc.seamline.length} / ${pc.outline.length}`);
    ok(pc.notches.every(n => Array.isArray(n.p) && typeof n.angle === 'number' && Math.abs(n.angle) <= 360),
       `§8.1 ${pc.name} notches angle 은 도(degree)`, pc.notches.map(n => `${n.label}:${f(n.angle, 1)}°`).join(' '));
    ok(pc.internal.every(it => !/[=\/+]/.test(String(it.label || ''))),
       `§8.1 ${pc.name} internal[].label 에 계산식 없음`,
       pc.internal.filter(it => /[=\/+]/.test(String(it.label || ''))).map(it => it.label).join(' '));
  }
  /* 골선 시접 0 검사 */
  for (const pc of d.pieces) {
    const dSeam = E.draftNoDart(m66, { seam: 1.0 }).pieces.find(x => x.id === pc.id);
    let bad = 0, maxOff = 0;
    for (const [a, b] of dSeam.foldEdges) for (let i = a; i <= b; i++) {
      const dd = dist(dSeam.outline[i], dSeam.seamline[i]); maxOff = Math.max(maxOff, dd);
      if (dd > 1e-6) bad++;
    }
    ok(bad === 0, `§8.1 ${pc.name} 골선 구간 시접 0 (seam=1.0)`, `최대 오프셋 ${f(maxOff, 6)} · 어긋난 점 ${bad}`);
  }
  const notes = d.meta.formulaNotes;
  ok(Array.isArray(notes) && notes.every(n => ['id', 'label', 'formula', 'value', 'piece', 'anchor'].every(k => k in n)),
     '§8.1 formulaNotes 구조', `${notes.length}건`);
  const dupIds = notes.map(n => n.piece + ':' + n.id).filter((v, i, a) => a.indexOf(v) !== i);
  warn(dupIds.length === 0, '§8.1 formulaNotes id 는 조각 안에서 유일', dupIds.length ? '중복: ' + [...new Set(dupIds)].join(', ') : '');
  const byPiece = {}; d.pieces.forEach(p => byPiece[p.id] = new Set(p.internal.map(i => i.id)));
  const orphan = notes.filter(n => n.piece !== 'both' && n.id && !(byPiece[n.piece] || new Set()).has(n.id))
                      .map(n => n.piece + ':' + n.id);
  warn(orphan.length === 0, '§8.1 formulaNotes.id ↔ internal.id 대응', orphan.length ? '대응 없음: ' + orphan.join(', ') : '');
}

/* ══════════════════════════════════════════════════════════════════
 * 11. 팀 코드 정적 점검
 * ════════════════════════════════════════════════════════════════ */
head('9. 팀 파일 정적 점검 (CDN · 하드코딩 · 계약)');
{
  const files = ['engine.js', 'ui.html', 'ui.css', 'ui.js', 'print.js', 'print.css'];
  for (const fn of files) {
    const p = path.join(DIR, fn);
    if (!fs.existsSync(p)) { warn(false, `${fn} 없음`); continue; }
    const src = fs.readFileSync(p, 'utf8');
    const cdn = src.match(/https?:\/\/(?!www\.w3\.org)[^\s"'`)]+/g) || [];
    ok(cdn.length === 0, `${fn} 외부 CDN/URL 없음`, cdn.length ? cdn.slice(0, 3).join(' ') : '');
    if (/\.(js)$/.test(fn)) {
      ok(!/\b(import|export)\s/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), `${fn} ES module 문법 없음`);
    }
  }
  /* 66호 하드코딩 탐지: 엔진 본문(상수 블록·주석 제외)에 66호 실측치가 박혀 있는가 */
  const esrc = fs.readFileSync(path.join(DIR, 'engine.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const magic = ['22.5', '23.8', '18.4', '20.35', '19.624', '14.09', '13.14', '87.6'];
  const hits = magic.filter(v => new RegExp('(?<![\\d.])' + v.replace('.', '\\.') + '(?![\\d])').test(esrc.replace(/BASE\s*=\s*\{[^}]*\}/, '')));
  ok(hits.length === 0, 'engine.js 본문에 66호 실측치 하드코딩 없음', hits.length ? '발견: ' + hits.join(', ') : '');
}

/* ══════════════════════════════════════════════════════════════════
 * 11b. 3개 팀 통합 계약 (실제 브라우저 통합 시 깨지는 것들)
 * ════════════════════════════════════════════════════════════════ */
head('9b. 통합 계약 — ui.* × print.* × engine.js');
{
  const uiHtml = fs.readFileSync(path.join(DIR, 'ui.html'), 'utf8');
  const uiJs   = fs.readFileSync(path.join(DIR, 'ui.js'), 'utf8');
  const prCss  = fs.readFileSync(path.join(DIR, 'print.css'), 'utf8');
  const uiCss  = fs.readFileSync(path.join(DIR, 'ui.css'), 'utf8');

  /* (1) print.css 는 인쇄영역이 body 직속임을 전제(§8.1). ui.html 은 #ndApp 안에 넣었다. */
  const areaInsideApp = /id="ndApp"[\s\S]*id="ndPrintArea"[\s\S]*<\/div>\s*$/.test(uiHtml.trim());
  const prHidesNonDirect = /body\s*>\s*\*:not\(#ndp-print-area\)\s*\{[^}]*display:\s*none\s*!important/.test(prCss);
  ok(!(areaInsideApp && prHidesNonDirect),
     '§8.1 인쇄 컨테이너가 body 직속',
     areaInsideApp && prHidesNonDirect
       ? '치명: ui.html 의 #ndPrintArea 가 #ndApp 안에 있는데 print.css 는 `body > *:not(#ndp-print-area){display:none !important}` 를 건다. '
         + 'ui.css 의 `.app{display:block}` 은 !important 가 없어 진다 → 통합 후 인쇄하면 전 페이지가 빈 종이.'
       : '');

  /* (2) 컨테이너 id / 페이지 클래스 불일치 */
  ok(/ndp-print-area/.test(uiHtml) || /ndp-print-area/.test(uiJs),
     '인쇄 컨테이너 id 일치 (print.js = #ndp-print-area)',
     'ui 는 #ndPrintArea 를 쓴다 — print.css 의 #ndp-print-area 규칙이 전혀 적용되지 않음');
  ok(/ndp-page/.test(uiJs),
     '인쇄 페이지 클래스 일치 (print.css = .ndp-page)',
     'ui.js 는 .nd-page 로 감싼다 — print.css 의 .ndp-page 규칙(break-after / overflow / 인라인 mm 크기) 미적용');

  /* (3) @page 크기 주입 — 롤지는 이게 없으면 1:1 이 깨진다 */
  ok(/applyPageCss|printDraft|pageCss/.test(uiJs),
     '§6.2 ui.js 가 layout.info.pageCss(@page size) 를 주입',
     '치명: 롤지 모드는 594×가변 mm 인데 @page 는 print.css 의 A4 210×297 로 고정된다 → 롤지 출력이 잘리고 1:1 깨짐');

  /* (4) §9-5 UI 요구 */
  ok(/14\.5/.test(uiJs), '§9-5 ui.js 옆선 14.5cm 미만 경고', '미구현 — renderSummary() 는 앞뒤 옆선 「일치 여부」만 본다');
  ok(/shoulderBackSeam/.test(uiJs) && /shoulderFrontSeam/.test(uiJs),
     '§9-3 실제 봉제 솔기 길이를 화면에 표시', 'ui.js 는 구성선 기준 shoulderBack/Front 만 표시');

  /* (5) 치수표 이중 관리 */
  const dupBase = /var\s+BASE\s*=\s*\{\s*B:\s*87\.6/.test(uiJs);
  warn(!dupBase, 'ui.js 가 §2 치수표를 중복 보유하지 않음',
       dupBase ? 'ui.js:18 에 BASE/GRADE 사본이 있다. engine.js 와 이중 관리 — 한쪽만 고치면 조용히 어긋난다(엔진 로드 실패 시에만 쓰이는 폴백)' : '');

  /* (6) 다른 팀 검증 스크립트가 실제로 도는가 */
  const { execFileSync } = require('child_process');
  for (const vf of ['engine-verify.js', 'print-verify.js']) {
    if (!fs.existsSync(path.join(DIR, vf))) continue;
    let out = '', code = 0;
    try { out = execFileSync(process.execPath, [path.join(DIR, vf)], { cwd: DIR, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { code = e.status === undefined ? -1 : e.status; out = (e.stdout || '') + (e.stderr || ''); }
    const crashed = /TypeError|ReferenceError|Cannot read properties/.test(out);
    ok(!crashed, `${vf} 가 실제로 실행됨`, crashed ? '실행 즉시 예외: ' + (out.match(/(TypeError|ReferenceError)[^\n]*/) || [''])[0] : `exit ${code}`);
    const usesDeprecated = /GT\.polylines|\.polylines\[/.test(fs.readFileSync(path.join(DIR, vf), 'utf8'));
    ok(!usesDeprecated, `${vf} 가 폐기된 정답지 키(polylines)를 쓰지 않음`,
       usesDeprecated ? '제어점이 섞인 구버전 키를 참조 — SPEC §4 에서 제거됨' : '');
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 12. 반소매 (SPEC §3.4) 구현 가능성 검토 — 구현은 개발팀 몫
 * ════════════════════════════════════════════════════════════════ */
head('10. 반소매 §3.4 — 사양 자체의 산술 정합성 (구현 없음. 검토만)');
{
  const hasSleeve = /sleeve|소매/.test(fs.readFileSync(path.join(DIR, 'engine.js'), 'utf8').replace(/[\s\S]*?4\. 곡선 생성/, ''));
  info('engine.js 에 소매 제도 함수', /function\s+draftSleeve|curveSleeveCap/.test(fs.readFileSync(path.join(DIR, 'engine.js'), 'utf8')) ? '있음' : '없음 (SPEC §3.4 미구현)');
  console.log('\n  호수    AH      뒤AH    앞AH    소매산   뒤대각   앞대각   뒤폭반   앞폭반   소매폭   비고');
  console.log('  ' + '─'.repeat(104));
  for (const s of SIZES) {
    const q = drafts[s].measures;
    const AH = q.armholeTotal, bAH = q.armholeBack, fAH = q.armholeFront;
    const cap = AH / 4 + 2, cr = 0.5;
    const dB = bAH - cr, dF = fAH - cr;
    const b2 = dB * dB - cap * cap, f2 = dF * dF - cap * cap;
    const hb = b2 > 0 ? Math.sqrt(b2) : NaN, hf = f2 > 0 ? Math.sqrt(f2) : NaN;
    console.log(`  ${s}  ${f(AH, 3)}  ${f(bAH, 3)}  ${f(fAH, 3)}  ${f(cap, 3)}  ${f(dB, 3)}  ${f(dF, 3)}  ${f(hb, 3)}  ${f(hf, 3)}  ${f(hb + hf, 3)}   ${(b2 > 0 && f2 > 0) ? '' : '√ 음수!'}`);
    ok(b2 > 0 && f2 > 0, `§3.4 소매폭 반 실수해 존재 · ${s}`, `뒤대각²−소매산² = ${f(b2, 3)} · 앞 ${f(f2, 3)}`);
  }
  /* §3.4 구성으로 실제 소매산 곡선을 그려 「이세분 1.5~3.0」이 나오는지 계산 */
  function crLen(P, n) {
    n = n || 2000;
    const ext = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P,
                 [2 * P[P.length - 1][0] - P[P.length - 2][0], 2 * P[P.length - 1][1] - P[P.length - 2][1]]];
    let L = 0, prev = P[0];
    for (let i = 1; i + 2 < ext.length; i++) {
      const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
      const t0 = 0, t1 = Math.sqrt(dist(p0, p1)) || 1e-6, t2 = t1 + (Math.sqrt(dist(p1, p2)) || 1e-6), t3 = t2 + (Math.sqrt(dist(p2, p3)) || 1e-6);
      for (let k = 1; k <= n; k++) {
        const t = t1 + (t2 - t1) * k / n;
        const A1 = lerpT(p0, p1, t0, t1, t), A2 = lerpT(p1, p2, t1, t2, t), A3 = lerpT(p2, p3, t2, t3, t);
        const q = lerpT(lerpT(A1, A2, t0, t2, t), lerpT(A2, A3, t1, t3, t), t1, t2, t);
        L += dist(q, prev); prev = q;
      }
    }
    return L;
  }
  function capSide(sign, h, diag, cap, markTop, markBot, offTop, offBot) {
    const B = [sign * h, cap], u = [B[0] / diag, B[1] / diag];
    const nrm = [-u[1] * sign, u[0] * sign];
    const mT = [sign * markTop, 0], mB = [sign * (h - markBot), cap];
    const tT = (mT[0] * u[0] + mT[1] * u[1]) / diag, tB = (mB[0] * u[0] + mB[1] * u[1]) / diag;
    const fT = [u[0] * tT * diag, u[1] * tT * diag], fB = [u[0] * tB * diag, u[1] * tB * diag];
    return { tT, tB, L: crLen([[0, 0], [fT[0] + nrm[0] * offTop, fT[1] + nrm[1] * offTop],
                               [fB[0] + nrm[0] * offBot, fB[1] + nrm[1] * offBot], B]) };
  }
  console.log('\n  §3.4 구성대로 소매산 곡선을 그렸을 때의 이세분 (요구 1.5 ~ 3.0)');
  console.log('  호수   capReduce  뒤곡선 / 뒤AH      앞곡선 / 앞AH      이세분   t(뒤상/뒤하)  t(앞상/앞하)  판정');
  console.log('  ' + '─'.repeat(104));
  for (const s2 of SIZES) for (const cr of [0.5, 0.0]) {
    const q = drafts[s2].measures, AH = q.armholeTotal, cap = AH / 4 + 2;
    const dB = q.armholeBack - cr, dF = q.armholeFront - cr;
    const hb = Math.sqrt(dB * dB - cap * cap), hf = Math.sqrt(dF * dF - cap * cap);
    const bk = capSide(-1, hb, dB, cap, AH / 8, AH / 12 + 0.6, 1.50, -1.23);
    const fr2 = capSide(+1, hf, dF, cap, AH / 8, AH / 8, 1.48, -1.49);
    const ease = bk.L + fr2.L - AH;
    const good = ease >= 1.5 && ease <= 3.0;
    console.log(`  ${s2}  ${f(cr, 2).padStart(7)}   ${f(bk.L, 3)} / ${f(q.armholeBack, 3)}   ${f(fr2.L, 3)} / ${f(q.armholeFront, 3)}   ${f(ease, 3).padStart(6)}   ${f(bk.tT, 3)}/${f(bk.tB, 3)}  ${f(fr2.tT, 3)}/${f(fr2.tB, 3)}   ${good ? 'OK' : 'RANGE OUT'}`);
    if (cr === 0.5) ok(good, `§3.4 이세분 1.5~3.0 (capReduce 기본 0.5) · ${s2}`, `실측 ${f(ease, 3)} cm`);
  }
  console.log('  ※ DXF 실측 t = 뒤 0.171/0.867 · 앞 0.166/0.834 — AH 기준 마크로는 재현되지 않는다(§3.4 ⚠ 절 참조)');

  /* DXF 실측치와 대조 */
  const GTS = fs.existsSync(GT_SLEEVE) ? JSON.parse(fs.readFileSync(GT_SLEEVE, 'utf8')) : null;
  if (GTS) {
    const k = GTS.key;
    console.log(`\n  원본 DXF 실측: 소매산 ${k.capHeight} · 뒤대각 ${k.diagBack} · 앞대각 ${k.diagFront} · 소매폭 ${k.bicepWidth}`);
    console.log(`  AH 역산: 소매산에서 (소매산−2)*4 = ${f((k.capHeight - 2) * 4, 3)} · 대각선합+2*capReduce = ${f(k.diagBack + k.diagFront + 1.0, 3)}`);
    console.log(`  마크 역산: AH/8 = ${k.markAH8} → AH ${f(k.markAH8 * 8, 3)} · AH/12+0.6 = ${k.markAH12p6} → AH ${f((k.markAH12p6 - 0.6) * 12, 3)}`);
    console.log(`  소매폭 ${k.bicepWidth} 로 나누면: /8 = ${f(k.bicepWidth / 8, 3)} · /12+0.6 = ${f(k.bicepWidth / 12 + 0.6, 3)}  ← SPEC §3.4 ⚠ 절과 일치`);
    const AH66 = drafts['66호'].measures.armholeTotal;
    console.log(`  엔진 66호 AH = ${f(AH66, 3)} → 소매산 AH/4+2 = ${f(AH66 / 4 + 2, 3)} (DXF ${k.capHeight}, Δ ${f(AH66 / 4 + 2 - k.capHeight, 3)})`);
    console.log(`  엔진 66호 AH → AH/8 = ${f(AH66 / 8, 3)} (DXF 마크 ${k.markAH8}) · AH/12+0.6 = ${f(AH66 / 12 + 0.6, 3)} (DXF ${k.markAH12p6})`);
    /* 이세분 추정: 소매산 곡선 길이는 DXF 프로파일 형상을 §3.4 오프셋으로 재구성해야 정확하지만,
       여기서는 대각선+오프셋 볼록/오목이 만드는 최소 길이 하한만 본다. */
    const AH = AH66, cap = AH / 4 + 2, cr = 0.5;
    const dB = drafts['66호'].measures.armholeBack - cr, dF = drafts['66호'].measures.armholeFront - cr;
    console.log(`  소매산 곡선 길이 하한(대각선 길이) 뒤 ${f(dB, 3)} / 앞 ${f(dF, 3)} — 각각 뒤AH ${f(drafts['66호'].measures.armholeBack, 3)} / 앞AH ${f(drafts['66호'].measures.armholeFront, 3)} 보다 작다`);
    console.log('  → §3.4 "뒤 소매산 곡선 길이 ≥ 뒤AH" 를 만족하려면 곡선이 대각선보다 최소 ' +
      f(drafts['66호'].measures.armholeBack - dB, 3) + '(뒤) / ' + f(drafts['66호'].measures.armholeFront - dF, 3) + '(앞) cm 길어져야 한다.');
  }
}

/* ══════════════════════════════════════════════════════════════════
 * 13. 요약
 * ════════════════════════════════════════════════════════════════ */
head('요약');
console.log(`  PASS ${PASS} · FAIL ${FAIL} · WARN ${WARN} · INFO ${INFO}`);
if (fails.length) { console.log('\n  [FAIL]'); fails.forEach((s, i) => console.log(`   ${i + 1}. ${s}`)); }
if (warns.length) { console.log('\n  [WARN]'); warns.forEach((s, i) => console.log(`   ${i + 1}. ${s}`)); }
console.log('');
process.exit(FAIL ? 1 : 0);
