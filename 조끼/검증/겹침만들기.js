/* 15_앞뒤판완성이미지.jpg(정답지) 위에 조끼 엔진(sp0 = UI 기본 통짜 2조각)을 겹친다.
 *
 *  축척은 정답지 json 의 transform 을 쓰되 **검정 격자선 픽셀로 독립 확인**했다:
 *    가로 검정선 py 191 / 243 / 704.19 / 1028 / 1438  ↔  엔진 y −2.5 / 0 / 22.5 / 38 / 58
 *    세로 검정선 px 1251.01 ↔ 뒤 x=0 · 764.49 ↔ 뒤 x=24 · 33 ↔ 앞 x=24
 *    (최대 어긋남 0.11cm — sx 20.301 sy 20.620 oxB 1250.84 oxF 521.5 oy 242.42)
 *
 *  ★ engine 은 outline = 완성선(제도선), seamline = 시접 붙인 재단선이다.
 *    처음에 seamline 을 겹쳤더니 시접만큼 통째로 밖으로 나가 「많이 다르다」로 보였다.
 */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = '/Users/ybr/pattern-Pro/여성복원형Suite';
var E = require(ROOT + '/조끼/engine.js');
var U = E.util;
var AC = require(ROOT + '/tools/answer-check.js');

var SX = 20.301, SY = 20.620, OXB = 1250.84, OXF = 521.5, OY = 242.42;
var IMG = '/Users/ybr/Downloads/조끼패턴/15_앞뒤판완성이미지.jpg';
var IW = 1296, IH = 1536;

var m = E.measuresForSize('55호'); m.hipLen = 20;      // 정답지 축척은 엉덩이길이 20
var g = E.geom(m, {});
/* ⚠ 예전에 여기서 `E.K.hemUpCf = E.K.frontPointRise` 로 덮어썼다 — frontPointRise 는
   2026-08-15 에 hemUpCf 로 이름이 바뀌며 사라진 상수라, **멀쩡한 12 를 undefined 로
   덮어써** 주석이 「앞중심 undefined」·「NaN」으로 나갔다. K 는 그대로 읽는다. */
var d = E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: 0 });

/* ── 좌표 변환 ─────────────────────────────────────────────── */
function PXY(pan, p) { return [(pan === 'B' ? OXB : OXF) - p[0] * SX, OY + p[1] * SY]; }
function poly(pan, pts) {
  var o = [], last = null;
  pts.forEach(function (p) {
    var q = PXY(pan, p);
    if (last && Math.abs(q[0] - last[0]) < 0.5 && Math.abs(q[1] - last[1]) < 0.5) return;
    last = q; o.push(q[0].toFixed(1) + ',' + q[1].toFixed(1));
  });
  return o.join(' ');
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

var art = [];   /* 도면 좌표계에 얹는 것 (확대판에도 같이 들어간다) */
function line(pan, pts, cls) { art.push('<polyline class="' + cls + '" points="' + poly(pan, pts) + '"/>'); }
function dot(pan, p, cls, r) { var q = PXY(pan, p); art.push('<circle class="' + cls + '" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="' + r + '"/>'); }
function txt(pan, p, s, cls, dx, dy, anchor) {
  var q = PXY(pan, p);
  art.push('<text class="' + cls + '" x="' + (q[0] + (dx || 0)).toFixed(1) + '" y="' + (q[1] + (dy || 0)).toFixed(1) +
    '" text-anchor="' + (anchor || 'middle') + '">' + esc(s) + '</text>');
}

/* ── 선 분류 ──────────────────────────────────────────────── */
var PAN = { back: 'B', front: 'F' };
var SPLIT = { splitB1: 1, splitB2: 1, splitF1: 1, splitF2: 1 };
var DART = { shDartB: 1, udF: 1, udF2: 1 };
var TIP = { dartTipB: 1, dartTipF: 1, mpB: 1, mpF: 1, bpF: 1, bpF2: 1 };

/* 라벨 자리는 손으로 준다 (t, dx, dy, anchor) — dx·dy 는 도면 픽셀 */
var LBL = {
  splitB1: [0.45, -14, -8, 'end'], splitB2: [0.70, 16, 16, 'start'],
  splitF1: [0.28, -12, -6, 'end'], splitF2: [0.78, 14, 18, 'start'],
  shDartB: [0.50, 0, -12, 'middle'],
  udF: [0.33, 0, -10, 'middle'], udF2: [0.33, 0, 18, 'middle'],
  facB: [0.55, -10, -8, 'end'], facF: [0.22, -12, -6, 'end'],
  facHemB: [0.45, 0, -10, 'middle'], facHemF: [0.38, 0, -10, 'middle'],
  mpB: [0.5, 22, -6, 'start'], mpF: [0.5, -22, -6, 'end']
};

d.pieces.forEach(function (p) {
  var pan = PAN[p.id];
  line(pan, p.seamline, 'cut');
  line(pan, p.outline, 'seam');
  (p.internal || []).forEach(function (it) {
    var cls = SPLIT[it.id] ? 'split' : DART[it.id] ? 'dart' : /^fac/.test(it.id) ? 'fac' : TIP[it.id] ? 'tip' : 'base';
    line(pan, it.pts, cls);
    var L = LBL[it.id];
    if (L && it.label) {
      var q;
      if (it.pts.length === 2) {                 /* 2점 직선은 **보간**해야 한다 —
        인덱스로 고르면 t 를 아무리 줘도 끝점뿐이라 라벨이 도면 밖으로 잘렸다 */
        q = [it.pts[0][0] + (it.pts[1][0] - it.pts[0][0]) * L[0],
             it.pts[0][1] + (it.pts[1][1] - it.pts[0][1]) * L[0]];
      } else q = it.pts[Math.min(it.pts.length - 1, Math.round((it.pts.length - 1) * L[0]))];
      txt(pan, q, it.label, 'lab ' + cls + 'T', L[1], L[2], L[3]);
    }
  });
  (p.notches || []).forEach(function (n) { dot(pan, n.p, 'notch', 4.5); });
});

/* 조각 이름 — 도면 빈 자리 */
txt('B', [12.5, 45.5], '엔진 back / 뒤판 — 통짜 좌우 2장', 'pname');
txt('F', [13.5, 45.5], '엔진 front / 앞판 — 통짜 좌우 2장', 'pname');

/* ── 조각 치수 (엔진 실측 · 완성선) ────────────────────────── */
function segLen(pts) { var s = 0; for (var i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
function eLen(p, name) {
  var e = p.edges.filter(function (x) { return x.name === name; })[0];
  return e ? segLen(p.outline.slice(e.start, e.end + 1)) : NaN;
}
var PB = d.pieces[0], PF = d.pieces[1];
var dim = {
  b: { 뒷목: eLen(PB, '뒷목'), 어깨선: eLen(PB, '어깨선'), 진동: eLen(PB, '진동'),
       옆선: eLen(PB, '옆선'), 밑단: eLen(PB, '밑단'), 등솔선: eLen(PB, '등솔선') },
  f: { 앞목: eLen(PF, '앞목'), 어깨선: eLen(PF, '어깨선'), 진동: eLen(PF, '진동'),
       겨드랑다트: eLen(PF, '겨드랑다트'), 옆선: eLen(PF, '옆선'), 밑단: eLen(PF, '밑단'),
       앞중심: eLen(PF, '앞중심') }
};
function dimBlock(pan, at, title, o) {
  var keys = Object.keys(o), q = PXY(pan, at);
  art.push('<rect class="dimbox" x="' + (q[0] - 72) + '" y="' + (q[1] - 15) + '" width="150" height="' + (17 * keys.length + 22) + '" rx="5"/>');
  art.push('<text class="dimT" x="' + (q[0] - 64) + '" y="' + (q[1] + 1) + '">' + esc(title) + '</text>');
  keys.forEach(function (k, i) {
    art.push('<text class="dimI" x="' + (q[0] - 64) + '" y="' + (q[1] + 18 + i * 17) + '">' + esc(k) + '</text>' +
      '<text class="dimI" x="' + (q[0] + 70) + '" y="' + (q[1] + 18 + i * 17) + '" text-anchor="end">' + o[k].toFixed(2) + '</text>');
  });
}
dimBlock('B', [11.5, 30.0], '엔진 뒤판 완성선 (cm)', dim.b);
dimBlock('F', [19.5, 31.0], '엔진 앞판 완성선 (cm)', dim.f);

/* ── 지적 3건을 숫자로 찍는다 (교재 실측은 픽셀에서 직접 잰 값) ────────
   ① 겨드랑다트 자리  ② 앞품선  ③ 안단 깊이(라벨 우선 정책) */
function callout(pan, from, to, lines, cls) {
  var a = PXY(pan, from), b = PXY(pan, to);
  art.push('<polyline class="callL" points="' + a[0].toFixed(1) + ',' + a[1].toFixed(1) + ' ' + b[0].toFixed(1) + ',' + b[1].toFixed(1) + '"/>');
  art.push('<circle class="callD" cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="3"/>');
  var w = 0; lines.forEach(function (s) { w = Math.max(w, s.length); });
  var bw = w * 5.9 + 14, bx = b[0] - bw / 2, by = b[1] - 12;
  art.push('<rect class="callB ' + cls + '" x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (lines.length * 14 + 8) + '" rx="4"/>');
  lines.forEach(function (s, i) {
    art.push('<text class="callT" x="' + (bx + 7).toFixed(1) + '" y="' + (by + 15 + i * 14).toFixed(1) + '">' + esc(s) + '</text>');
  });
}
/* 2026-08-14 사용자 지정으로 다트를 교재 자리로 내렸다 — 문구도 같이 옮긴다.
   (그림의 주석이 옛 상태로 남으면 고친 것을 안 고친 것처럼 읽는다.) */
callout('F', [17, 24.6], [13.5, 38.5], [
  '① 겨드랑다트 — 교재 자리로 내렸다 (2026-08-14)',
  '엔진  옆선 y ' + g.f65[1].toFixed(2) + '~' + g.f66[1].toFixed(2) + '  다트분 ' + g['유차'].toFixed(2),
  '교재  옆선 y 24.24~26.97  다트분 2.73  (픽셀 실측)',
  '→ 접으면 앞 옆선 = 뒤 옆선 (봉제 정합성 통과)'
], 'cDart');
/* 2026-08-15 — 보라선이 곧 밑단이고 그 아래는 잘라냈다 (사용자 확정) */
callout('F', [4.5, 54.4], [9.5, 44.0], [
  '④ 보라선이 **밑단**이다 — 그 아래는 잘라냈다 (2026-08-15)',
  '옆 ' + E.K.hemUpSide + ' · 앞중심 ' + E.K.hemUpCf + ' · V 꼭짓점 ' + E.K.hemUpPoint + ' · 뒤중심 ' + E.K.hemUpCb,
  '앞 길이 62.0 → ' + (g.HL + 2.5 - E.K.hemUpCf).toFixed(1) + ' (허리에서 약 10cm)',
  '→ 「밑단 안단」으로 읽었던 것이 실은 완성 밑단이었다'
], 'cDart');
callout('F', [16, 8], [16.5, 3.0], [
  '② 앞품선  엔진 16.00 (원문 [21] 앞품/2)  ·  도면 16.87',
  '   뒤 등품선은 엔진 17.75 ↔ 도면 17.82 로 맞는다',
  '   → 앞 암홀이 도면보다 0.7~1.0 안쪽 (fArm 1.04)'
], 'cBase');
callout('B', [0, 6.5], [10.5, 9.5], [
  '③ 안단 깊이는 라벨을 따른다 (프로젝트 규칙)',
  '뒤중심  엔진 6.5 (라벨 6~7)  ·  도면 실측 4.42',
  '뒤 밑단 뒤중심  엔진 8 (라벨 8)  ·  도면 7.03',
  '앞 밑단 앞중심  엔진 11.83 (라벨 12)  ·  도면 11.30',
  '어깨  엔진 4.49 (라벨 4~5)  ·  도면 1.4~2.5'
], 'cFac');

/* ── 정답지 대조 실측값 (하우스도르프) ─────────────────────── */
function measure() {
  function lin(a, b) { return U.lineSegs(a.slice(), b.slice()); }
  var SET = {
    '조끼-뒤판': { bNeck: g.bNeck, bCb: g.bCb.concat(g.bCbLow), bArm: g.bArm, bSide: g.bSide,
      bSplitIn: g.bSplitIn, bSplitOut: g.bSplitOut, bShoulder: lin(g.p38, g.p26),
      bFacing: g.bFacing, bHem: g.bHem },
    '조끼-앞판': { fNeck: g.fNeck, fArm: g.fArm, fSide: g.fSide, fHem: g.fHem,
      fSplitIn: g.fSplitIn, fSplitOut: g.fSplitOut, fShoulder: lin(g.f53, g.f52),
      fFacing: g.fFacing }
  };
  var rows = [];
  Object.keys(SET).forEach(function (nm) {
    var A = AC.load(nm);
    Object.keys(A.curves).forEach(function (k) {
      var segs = SET[nm][k]; if (!segs) return;
      var eng = U.sampleSegs(segs, 0.05);
      var dd = AC.hausdorff(AC.clipToRef(eng, A.curves[k]), A.curves[k]);
      rows.push([k, dd, A['tol_' + k] !== undefined ? A['tol_' + k] : A.tol.curve]);
    });
  });
  return rows;
}
/* ── 정답지의 **표시점**(MP·다트)을 그림에 찍는다 ────────────────────
   사용자 요청 2026-08-15 「표시점도 그림에 찍히게 해줘」.
   도면 실측 = 속 빈 원 · 엔진 = 채운 점 · 둘을 실선으로 잇는다 —
   차이가 있으면 그 선의 길이가 곧 오차라 눈으로 바로 읽힌다. */
(function () {
  var dd = E.draftVest(m, { seam: E.SEAM_DEFAULT, splitPanels: 1 });
  function mpOf(id) {
    var out = [];
    dd.pieces.forEach(function (pc) {
      if (pc.id !== id) return;
      (pc.notches || []).forEach(function (n) { if (n.label === 'MP') out.push(n.p); });
    });
    out.sort(function (a, b) { return a[1] - b[1]; });
    return out;
  }
  var mpB = mpOf('backSide'), mpF = mpOf('front');
  var ENG = { 'B': {}, 'F': {} };
  if (mpB.length === 2) { ENG.B['MP뒤a'] = mpB[0]; ENG.B['MP뒤b'] = mpB[1]; }
  if (mpF.length === 2) { ENG.F['MP앞a'] = mpF[0]; ENG.F['MP앞b'] = mpF[1]; }
  ENG.F['겨드랑다트65'] = g.f65; ENG.F['겨드랑다트66'] = g.f66;
  [['조끼-뒤판', 'B'], ['조끼-앞판', 'F']].forEach(function (r) {
    var A = AC.load(r[0]); if (!A || !A.points) return;
    Object.keys(A.points).forEach(function (k) {
      var ref = A.points[k], eng = ENG[r[1]][k];
      var q = PXY(r[1], ref);
      art.push('<circle class="ptRef" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="5.5"/>');
      if (!eng) return;
      var e = PXY(r[1], eng);
      art.push('<circle class="ptEng" cx="' + e[0].toFixed(1) + '" cy="' + e[1].toFixed(1) + '" r="3"/>');
      art.push('<line class="ptLink" x1="' + q[0].toFixed(1) + '" y1="' + q[1].toFixed(1) +
               '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '"/>');
      var d = Math.hypot(ref[0] - eng[0], ref[1] - eng[1]);
      art.push('<text class="ptTx" x="' + (e[0] + 7).toFixed(1) + '" y="' + (e[1] - 5).toFixed(1) +
               '">' + k + ' ' + d.toFixed(2) + '</text>');
    });
  });
})();

var ROWS = measure();

/* ── 아래 띠: 범례 + 실측표 ────────────────────────────────── */
var STRIP = 300, TOTH = IH + STRIP;
var foot = [];
function fTxt(x, y, s, cls, anchor) {
  foot.push('<text class="' + cls + '" x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'start') + '">' + esc(s) + '</text>');
}
foot.push('<rect x="0" y="' + IH + '" width="' + IW + '" height="' + STRIP + '" fill="#fbfbfd"/>');
foot.push('<line x1="0" y1="' + IH + '" x2="' + IW + '" y2="' + IH + '" stroke="#333" stroke-width="1.4"/>');
var y0 = IH + 26;
fTxt(24, y0, '교재 15_앞뒤판완성이미지.jpg  ↔  조끼 엔진 55호 · 통짜 2조각 · 엉덩이길이 20 · 2026-08-15 (밑단 잘림 · MP 이동 · 안단 조각)', 'ftT');
var LEG = [
  ['seam', '엔진 완성선 (제도선 — 교재와 대조하는 선)'],
  ['cut', '엔진 재단선 (시접 포함 · 교재엔 없는 선)'],
  ['split', '엔진 절개선  splitB1·splitB2 / splitF1·splitF2'],
  ['dart', '엔진 다트  어깨다트 shDartB · 겨드랑다트 udF·udF2'],
  ['fac', '엔진 안단선 facB·facF · 밑단안단선 facHemB·facHemF'],
  ['base', '엔진 기초선 (진동·허리·엉덩이·품·BP·MP)'],
  ['notch', '엔진 너치']
];
LEG.forEach(function (r, i) {
  var y = y0 + 26 + i * 20;
  if (r[0] === 'notch') foot.push('<circle class="notch" cx="' + 42 + '" cy="' + (y - 5) + '" r="4.5"/>');
  else foot.push('<polyline class="' + r[0] + '" points="24,' + (y - 5) + ' 62,' + (y - 5) + '"/>');
  fTxt(72, y, r[1], 'ftI');
});
fTxt(24, y0 + 26 + 7 * 20 + 8, '교재선 = 초록(앞판) · 빨강(뒤판) · 보라(안단) · 검정(기초선·치수)', 'ftI');

/* 실측표 2열 */
var cx0 = 470, cw = 400;
fTxt(cx0, y0 + 22, '정답지 곡선 대조 — 양방향 하우스도르프 (cm)', 'ftT');
fTxt(cx0, y0 + 40, '실측 = 지금 이 그림에서 두 선이 벌어진 최대치.  tol = engine-verify §3-C 허용치', 'ftS');
ROWS.forEach(function (r, i) {
  var col = i < 9 ? 0 : 1, row = i % 9;
  var x = cx0 + col * cw, y = y0 + 62 + row * 19;
  fTxt(x, y, r[0], 'ftI');
  fTxt(x + 190, y, r[1].toFixed(2), r[1] >= 1 ? 'ftBad' : 'ftI', 'end');
  fTxt(x + 260, y, 'tol ' + r[2].toFixed(2), 'ftS', 'end');
  fTxt(x + 350, y, '여유 ' + (r[2] - r[1]).toFixed(2), 'ftS', 'end');
});

/* ── SVG 조립 ─────────────────────────────────────────────── */
var b64 = fs.readFileSync(IMG).toString('base64');
var STYLE = '<style>\n' +
  'text{font-family:"Apple SD Gothic Neo","AppleGothic",sans-serif;paint-order:stroke;stroke:#fff;stroke-width:3;stroke-linejoin:round}\n' +
  'polyline,circle{fill:none;vector-effect:non-scaling-stroke}\n' +
  '.seam{stroke:#0b39ff;stroke-width:2.4}\n' +
  '.cut{stroke:#0b39ff;stroke-width:1;opacity:.28;stroke-dasharray:3 5}\n' +
  '.split{stroke:#ff6a00;stroke-width:2.2}\n' +
  '.dart{stroke:#e6009c;stroke-width:2.4}\n' +
  '.fac{stroke:#00a89b;stroke-width:2.0;stroke-dasharray:9 5}\n' +
  '.base{stroke:#9aa0a6;stroke-width:1.2;stroke-dasharray:5 4}\n' +
  '.tip{stroke:#e6009c;stroke-width:1.6}\n' +
  '.notch{fill:#0b39ff;stroke:#fff;stroke-width:1.4}\n' +
  '.lab{font-size:12px;font-weight:700}\n' +
  '.seamT{fill:#0b39ff}.splitT{fill:#ff6a00}.dartT{fill:#e6009c}.facT{fill:#00857c}.baseT{fill:#5f6368}.tipT{fill:#e6009c}\n' +
  '.pname{font-size:17px;font-weight:800;fill:#0b39ff;stroke-width:4.5}\n' +
  '.dimbox{fill:#ffffffd8;stroke:#0b39ff;stroke-width:1;vector-effect:non-scaling-stroke}\n' +
  '.dimT{font-size:11.5px;font-weight:800;fill:#0b39ff;stroke-width:2.4}\n' +
  '.dimI{font-size:11px;fill:#222;stroke-width:2.4}\n' +
  '.callL{stroke:#111;stroke-width:1.1}\n' +
  '.ptRef{fill:none;stroke:#ff8a00;stroke-width:2.2}\n' +
  '.ptEng{fill:#0b39ff;stroke:none}\n' +
  '.ptLink{stroke:#ff8a00;stroke-width:1.6}\n' +
  '.ptTx{font-size:11px;fill:#c05000;stroke:#fff;stroke-width:3;font-weight:700}\n' +
  '.callD{fill:#111;stroke:#fff;stroke-width:1.2}\n' +
  '.callB{stroke-width:1.2;vector-effect:non-scaling-stroke}\n' +
  '.cDart{fill:#fff0f8;stroke:#e6009c}.cBase{fill:#f4f4f6;stroke:#5f6368}.cFac{fill:#eefaf8;stroke:#00857c}\n' +
  '.callT{font-size:11px;fill:#111;stroke-width:2.4;font-weight:600}\n' +
  '.ftT{font-size:14px;font-weight:800;fill:#111;stroke-width:0}\n' +
  '.ftI{font-size:12.5px;fill:#222;stroke-width:0}\n' +
  '.ftS{font-size:11.5px;fill:#666;stroke-width:0}\n' +
  '.ftBad{font-size:12.5px;fill:#c00000;font-weight:800;stroke-width:0}\n' +
  '.zt{font-size:19px;font-weight:800;fill:#111;stroke-width:0}\n' +
  '.zs{font-size:14px;fill:#333;stroke-width:0}\n' +
  '.zbox{fill:none;stroke:#111;stroke-width:2}\n' +
  '</style>\n';
var DEFS = '<defs><g id="all">' +
  '<image x="0" y="0" width="' + IW + '" height="' + IH + '" xlink:href="data:image/jpeg;base64,' + b64 + '"/>' +
  '<g>' + art.join('') + '</g></g></defs>\n';

function svgOpen(w, h, vb) {
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'width="' + w + '" height="' + h + '" viewBox="' + vb + '">\n';
}

/* ① 전체 겹침 */
var full = svgOpen(IW * 2, TOTH * 2, '0 0 ' + IW + ' ' + TOTH) + STYLE + DEFS +
  '<rect width="' + IW + '" height="' + TOTH + '" fill="#fff"/>' +
  '<use xlink:href="#all"/>' + foot.join('\n') + '\n</svg>\n';
fs.writeFileSync(path.join(__dirname, 'overlay.svg'), full);

/* ② 확대 4칸 — 사용자가 지적한 자리 */
var ZW = 1440, ZH = 1040, PADT = 62;
var ZONES = [
  { r: [0, 480, 470, 400], t: '① 겨드랑다트 — 교재 자리로 내렸다 (2026-08-15)',
    s: '교재 자리(옆선 위 65~66 → BP)로 내렸고, 4조각에서는 회전해 절개선에 붙였다. 주황 원 = 도면 실측점.' },
  { r: [860, 1120, 180, 380], t: '② 뒤판 절개선 — 교차하는 자리',
    s: '교재(빨강 2줄) vs 엔진(주황 splitB1·B2). y≈52 에서 만나 밑단(16.10/13.64 ↔ 16.02/13.62)으로 다시 벌어진다.' },
  { r: [0, 1150, 620, 390], t: '③ 앞 밑단 — 보라선이 곧 밑단 (9 · 12 · 꼭짓점 4.5)',
    s: '이 보라선이 **완성 밑단**이고 그 아래는 잘라냈다 (안단이 아니었다). 안단은 어깨 4~5 · 앞단 6~7 둘뿐이다.' },
  { r: [660, 1150, 620, 390], t: '④ 뒤 밑단 — 보라선이 곧 밑단 (옆 9 · 뒤중심 8)',
    s: '교재 라벨 9(옆) · 8(뒤중심). 엔진 안단선(청록 점선)과 교재 안단(보라)을 겹쳤다.' }
];
var zs = [];
ZONES.forEach(function (Z, i) {
  var col = i % 2, row = (i / 2) | 0;
  var w = ZW / 2 - 20, h = (ZH - PADT * 2) / 2 - 10;
  var x = 10 + col * (ZW / 2), y = PADT + row * ((ZH - PADT) / 2);
  var sc = Math.min(w / Z.r[2], h / Z.r[3]);
  var dw = Z.r[2] * sc, dh = Z.r[3] * sc;
  zs.push('<text class="zt" x="' + x + '" y="' + (y - 24) + '">' + esc(Z.t) + '</text>');
  zs.push('<text class="zs" x="' + x + '" y="' + (y - 6) + '">' + esc(Z.s) + '</text>');
  zs.push('<svg x="' + x + '" y="' + y + '" width="' + dw + '" height="' + dh + '" viewBox="' +
    Z.r.join(' ') + '"><use xlink:href="#all"/></svg>');
  zs.push('<rect class="zbox" x="' + x + '" y="' + y + '" width="' + dw + '" height="' + dh + '"/>');
});
var zoom = svgOpen(ZW * 1.6, ZH * 1.6, '0 0 ' + ZW + ' ' + ZH) + STYLE + DEFS +
  '<rect width="' + ZW + '" height="' + ZH + '" fill="#fff"/>' +
  '<text class="zt" x="14" y="26" style="font-size:22px">조끼 — 교재 정답지 vs 엔진: 지적받은 4곳 확대</text>' +
  zs.join('\n') + '\n</svg>\n';
fs.writeFileSync(path.join(__dirname, 'zoom.svg'), zoom);

/* ★ 산출물에 **글자로 샌 undefined/NaN** 이 없는가 (사용자 요청 2026-08-15).
   그림은 검산기가 안 보는 산출물이라 이런 오염이 조용히 나간다 — 실제로
   사라진 상수(frontPointRise)를 읽어 「앞중심 undefined」와 NaN 30개가 찍혔다. */
(function () {
  var bad = 0;
  [['overlay.svg', full], ['zoom.svg', zoom]].forEach(function (r) {
    /* ⚠ 배경 도면은 base64 로 박혀 있다 — 그 난수열에 'NaN' 이 우연히 들어 있어
       그대로 세면 **오탐 4건**이 난다 (2026-08-15 실제로 그랬다). 데이터를 뺀 뒤 센다. */
    var body = r[1].replace(/xlink:href="data:[^"]*"/g, '').replace(/href="data:[^"]*"/g, '');
    ['undefined', 'NaN', '[object'].forEach(function (w) {
      var n = (body.split(w).length - 1);
      /* 스타일·주석에 그 글자가 들어갈 일은 없다 — 전부 값이 샌 것이다 */
      if (n) { console.log('  ✗ ' + r[0] + ' 에 「' + w + '」 ' + n + '군데 — 사라진 상수를 읽고 있다'); bad += n; }
    });
  });
  if (bad) { console.log('  → 그림을 내보내기 전에 고칠 것'); process.exitCode = 1; }
  else console.log('  ✓ 산출물에 undefined/NaN 없음');
})();

console.log('그림 요소 ' + art.length + ' · overlay ' + (full.length / 1048576).toFixed(2) + 'MB · zoom ' + (zoom.length / 1048576).toFixed(2) + 'MB');
ROWS.forEach(function (r) { console.log('  ' + (r[0] + '            ').slice(0, 13) + ' 실측 ' + r[1].toFixed(3) + '  tol ' + r[2] + '  여유 ' + (r[2] - r[1]).toFixed(3)); });
