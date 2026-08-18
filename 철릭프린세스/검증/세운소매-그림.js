/* 철릭 긴소매 — **세운** 조각 한 장을 크게. 재단선·시접선·너치·식서·치수. */
var fs = require('fs'), path = require('path'), vm = require('vm');
var DIR = process.argv[2] || '철릭프린세스';
var ROOT = path.join(__dirname, '..', '..');
var g = { window: {}, console: console }; g.self = g; vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(ROOT, DIR, 'engine.js'), 'utf8'), g);
var E = g.window[Object.keys(g.window).filter(function (k) { return /Engine/.test(k); })[0]];
var d = E.draftCheollik(E.measuresForSize('66호'), { seam: E.SEAM_DEFAULT });
var P = d.pieces.filter(function (p) { return p.id === 'sleeve'; })[0];

var S = 12, LEFT = 230, TOP = 150;                    // px/cm · 여백
var pts = P.seamline.concat(P.outline);
var cut = P.outline;
function cutSpan(i) { var v = cut.map(function (q) { return q[i]; });
  return { lo: Math.min.apply(0, v), hi: Math.max.apply(0, v) }; }
var cutX = cutSpan(0), cutY = cutSpan(1);
var mnx = Math.min.apply(0, pts.map(function (q) { return q[0]; }));
var mny = Math.min.apply(0, pts.map(function (q) { return q[1]; }));
var mxx = Math.max.apply(0, pts.map(function (q) { return q[0]; }));
var mxy = Math.max.apply(0, pts.map(function (q) { return q[1]; }));
function X(p) { return (LEFT + (p[0] - mnx) * S).toFixed(1); }
function Y(p) { return (TOP + (p[1] - mny) * S).toFixed(1); }
function poly(a) { return a.map(function (p) { return X(p) + ',' + Y(p); }).join(' '); }
var W = LEFT + (mxx - mnx) * S + 330, H = TOP + (mxy - mny) * S + 120;

var t = [];
/* 모눈 5cm */
for (var gx = Math.ceil(mnx / 5) * 5; gx <= mxx; gx += 5)
  t.push('<line class="grid" x1="' + X([gx, 0]) + '" y1="' + TOP + '" x2="' + X([gx, 0]) + '" y2="' + Y([0, mxy]) + '"/>');
for (var gy = Math.ceil(mny / 5) * 5; gy <= mxy; gy += 5)
  t.push('<line class="grid" x1="' + LEFT + '" y1="' + Y([0, gy]) + '" x2="' + X([mxx, 0]) + '" y2="' + Y([0, gy]) + '"/>');

t.push('<polygon class="seam" points="' + poly(P.seamline) + '"/>');
t.push('<polygon class="cut" points="' + poly(P.outline) + '"/>');

/* 제도선 (소매 중심선 · 가장 넓은 자리) */
(P.internal || []).forEach(function (it) {
  if (it.type !== 'dashed') return;
  t.push('<polyline class="guide" points="' + poly(it.pts) + '"/>');
});

/* 식서 */
var gr = P.grainline;
t.push('<line class="grain" x1="' + X(gr[0]) + '" y1="' + Y(gr[0]) + '" x2="' + X(gr[1]) + '" y2="' + Y(gr[1]) + '"/>');
t.push('<text class="grainT" x="' + (+X(gr[0]) + 8) + '" y="' + ((+Y(gr[0]) + +Y(gr[1])) / 2) + '">식서 (소매 중심선)</text>');

/* 너치 — 재단선에 직각 · 빨강. 같은 라벨이 겹치면 아래로 밀어 둔다 */
var seen = {};
(P.notches || []).forEach(function (n) {
  var a = n.angle * Math.PI / 180;
  var q = [n.p[0] + Math.cos(a) * 0.7, n.p[1] + Math.sin(a) * 0.7];
  t.push('<line class="notch" x1="' + X(n.p) + '" y1="' + Y(n.p) + '" x2="' + X(q) + '" y2="' + Y(q) + '"/>');
  var lx = +X(n.p) + (n.p[0] > (mnx + mxx) / 2 ? 12 : -12);
  var key = n.label + '|' + Math.round(n.p[0] / 4) + '|' + Math.round(n.p[1] / 4);
  seen[key] = (seen[key] || 0) + 1;
  t.push('<text class="ntc" text-anchor="' + (n.p[0] > (mnx + mxx) / 2 ? 'start' : 'end') +
         '" x="' + lx + '" y="' + (+Y(n.p) + 4 + (seen[key] - 1) * 14) + '">' + n.label + '</text>');
});

/* 변 이름 + 시접 */
var ROLE = { shoulder: '어깨선', side: '옆선', sleeveHem: '소매 밑단', armhole: '암홀' };
(P.edges || []).forEach(function (e) {
  var mid = P.outline[Math.round((e.start + e.end) / 2)]; if (!mid) return;
  var cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
  var vx = mid[0] - cx, vy = mid[1] - cy, L = Math.hypot(vx, vy) || 1;
  var lp = [mid[0] + vx / L * 4.4, mid[1] + vy / L * 4.4];
  var anc = vx > 1 ? 'start' : vx < -1 ? 'end' : 'middle';
  t.push('<text class="edge" text-anchor="' + anc + '" x="' + X(lp) + '" y="' + Y(lp) + '">' +
    e.name + ' <tspan class="' + (e.role === 'sleeveHem' ? 'hi' : 'sa') + '">시접 ' +
    e.seam.toFixed(1) + '</tspan> <tspan class="rl">(' + (ROLE[e.role] || e.role) + ')</tspan></text>');
});

/* 치수선 — 폭 · 길이 */
var yb = +Y([0, mxy]) + 46, xr = +X([mxx, 0]) + 52;
t.push('<line class="dim" x1="' + X([cutX.lo, 0]) + '" y1="' + yb + '" x2="' + X([cutX.hi, 0]) + '" y2="' + yb + '"/>');
t.push('<text class="dimT" text-anchor="middle" x="' + ((+X([cutX.lo, 0]) + +X([cutX.hi, 0])) / 2) + '" y="' + (yb - 8) + '">소매폭(비셉) ' + (cutX.hi - cutX.lo).toFixed(2) + '</text>');
t.push('<line class="dim" x1="' + xr + '" y1="' + Y([0, cutY.lo]) + '" x2="' + xr + '" y2="' + Y([0, cutY.hi]) + '"/>');
t.push('<text class="dimT" text-anchor="middle" transform="rotate(-90 ' + (xr + 16) + ' ' + ((+Y([0, cutY.lo]) + +Y([0, cutY.hi])) / 2) + ')" x="' + (xr + 16) + '" y="' + ((+Y([0, cutY.lo]) + +Y([0, cutY.hi])) / 2) + '">소매길이 ' + (cutY.hi - cutY.lo).toFixed(2) + '</text>');

/* 위·아래 표식 */
t.push('<text class="tag" text-anchor="middle" x="' + X([(mnx + mxx) / 2, 0]) + '" y="' + (TOP - 62) + '">▲ 소매산 — 몸판 진동에 붙는다</text>');
t.push('<text class="tag hi" text-anchor="middle" x="' + X([(mnx + mxx) / 2, 0]) + '" y="' + (+Y([0, mxy]) + 84) + '">▼ 수구 = 소매 밑단 (여기가 아래로 와야 한다)</text>');

var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(W) + '" height="' + Math.ceil(H) +
 '" viewBox="0 0 ' + Math.ceil(W) + ' ' + Math.ceil(H) + '">\n<style>\n' +
 'text{font-family:"Apple SD Gothic Neo","Noto Sans KR",sans-serif}\n' +
 '.grid{stroke:#e8eef7;stroke-width:1}\n' +
 '.cut{fill:none;stroke:#111;stroke-width:2.4}\n' +
 '.seam{fill:#f5f8ff;stroke:#3b6fd4;stroke-width:1.3;stroke-dasharray:8 5}\n' +
 '.guide{fill:none;stroke:#9aa6b8;stroke-width:1.1;stroke-dasharray:5 4}\n' +
 '.notch{stroke:#e0322a;stroke-width:2.8;stroke-linecap:round}\n' +
 '.ntc{font-size:12px;fill:#b3271f}\n' +
 '.grain{stroke:#1a7f4b;stroke-width:1.8;marker-start:url(#ah);marker-end:url(#ah)}\n' +
 '.grainT{font-size:13px;fill:#1a7f4b}\n' +
 '.edge{font-size:13.5px;fill:#222}\n' +
 '.sa{font-weight:700;fill:#3b6fd4}\n' +
 '.hi{font-weight:700;fill:#e0322a}\n' +
 '.rl{font-size:11.5px;fill:#8894a6}\n' +
 '.dim{stroke:#c2603a;stroke-width:1.3;marker-start:url(#dh);marker-end:url(#dh)}\n' +
 '.dimT{font-size:14px;fill:#c2603a;font-weight:600}\n' +
 '.tag{font-size:16px;font-weight:700;fill:#333}\n' +
 '.hd{font-size:22px;font-weight:700;fill:#111}\n' +
 '.sub{font-size:13.5px;fill:#666}\n' +
 '.cap{font-size:13px;fill:#555}\n</style>\n' +
 '<defs>' +
 '<marker id="ah" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#1a7f4b"/></marker>' +
 '<marker id="dh" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#c2603a"/></marker>' +
 '</defs>\n<rect width="100%" height="100%" fill="#fff"/>\n' +
 '<text class="hd" x="40" y="42">' + DIR + ' · 긴소매 — 세워서 낸 조각</text>\n' +
 '<text class="sub" x="40" y="66">66호 · 표준 시접 · **소매산이 위 · 수구(소매 밑단)가 아래** — 검정 재단선 · 파란 점선 시접선 · 빨강 너치 · 초록 식서</text>\n' +
 t.join('\n') + '\n<text class="cap" x="40" y="' + (H - 24) + '">' +
 '재단선 ' + (cutX.hi - cutX.lo).toFixed(2) + ' × ' + (cutY.hi - cutY.lo).toFixed(2) + ' cm · 너치 ' + (P.notches || []).length + '개 · ' +
 '+90° 강체 회전이라 교재 도면과의 편차는 회전 전과 같은 0.32cm.</text>\n</svg>\n';

var outp = process.argv[3] || '/tmp/sleeve-up.svg';
fs.writeFileSync(outp, svg);
var bad = svg.replace(/data:[^"')\s]+/g, '').match(/undefined|NaN|\[object/g);
console.log(outp, Math.ceil(W) + '×' + Math.ceil(H), bad ? '✗ ' + bad.length + '건 오염' : '✓ undefined/NaN 없음');
