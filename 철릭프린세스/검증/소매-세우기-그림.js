/* 철릭 긴소매 — 눕힌 옛 모습 vs 세운 지금. 시접선·너치·식서를 같이 그린다. */
var fs = require('fs'), path = require('path'), vm = require('vm');
var DIR = process.argv[2] || '철릭프린세스';
var ROOT = '/Users/ybr/pattern-Pro/여성복원형Suite';
var g = { window: {}, console: console }; g.self = g; vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(ROOT, DIR, 'engine.js'), 'utf8'), g);
var E = g.window[Object.keys(g.window).filter(function (k) { return /Engine/.test(k); })[0]];
var d = E.draftCheollik(E.measuresForSize('66호'), { seam: E.SEAM_DEFAULT });
var P = d.pieces.filter(function (p) { return p.id === 'sleeve'; })[0];

var ROLE_KO = { shoulder: '어깨선', side: '옆선', sleeveHem: '소매 밑단', armhole: '암홀' };
var S = 9, PAD = 46;                                   // px/cm

/** (X,Y) → 눕힌 제도 좌표. 세우기가 (x,y)→(폭−y, x) 이므로 역은 (X,Y)→(Y,−X) */
function lay(p) { return [p[1], -p[0]]; }
function mapPts(pts, f) { return f ? pts.map(f) : pts; }
function bbox(pts) {
  var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
  return { x: Math.min.apply(0, xs), y: Math.min.apply(0, ys),
           w: Math.max.apply(0, xs) - Math.min.apply(0, xs),
           h: Math.max.apply(0, ys) - Math.min.apply(0, ys) };
}

function panel(f, ox, title, sub) {
  var out = P.outline, seam = P.seamline;
  var o = mapPts(out, f), s = mapPts(seam, f), bb = bbox(s.concat(o));
  function X(p) { return (ox + (p[0] - bb.x) * S).toFixed(1); }
  function Y(p) { return (PAD + 56 + (p[1] - bb.y) * S).toFixed(1); }
  function poly(pts) { return pts.map(function (p) { return X(p) + ',' + Y(p); }).join(' '); }
  var t = [];
  t.push('<text x="' + ox + '" y="' + (PAD - 6) + '" class="ttl">' + title + '</text>');
  t.push('<text x="' + ox + '" y="' + (PAD + 15) + '" class="sub">' + sub + '</text>');
  t.push('<polygon class="seam" points="' + poly(s) + '"/>');
  t.push('<polygon class="cut" points="' + poly(o) + '"/>');
  /* 식서 */
  var gr = mapPts(P.grainline, f);
  t.push('<line class="grain" x1="' + X(gr[0]) + '" y1="' + Y(gr[0]) +
         '" x2="' + X(gr[1]) + '" y2="' + Y(gr[1]) + '"/>');
  t.push('<text class="grainT" x="' + (+X(gr[0]) + 5) + '" y="' +
         ((+Y(gr[0]) + +Y(gr[1])) / 2) + '">식서</text>');
  /* 너치 — 재단선에 직각인 빨간 틱 */
  (P.notches || []).forEach(function (n) {
    var p = f ? f(n.p) : n.p, a = n.angle * Math.PI / 180;
    var dx = Math.cos(a), dy = Math.sin(a);
    if (f) { var t2 = dx; dx = -dy; dy = t2; }          // 방향도 같이 눕힌다
    var q = [p[0] + dx * 0.6, p[1] + dy * 0.6];
    t.push('<line class="notch" x1="' + X(p) + '" y1="' + Y(p) + '" x2="' + X(q) + '" y2="' + Y(q) + '"/>');
  });
  /* 변마다 이름·시접 — 변 가운데에서 바깥으로 살짝 밀어 놓는다 */
  (P.edges || []).forEach(function (e) {
    var mid = out[Math.round((e.start + e.end) / 2)];
    if (!mid) return;
    var mp = f ? f(mid) : mid;
    var cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    var vx = mp[0] - cx, vy = mp[1] - cy, L = Math.hypot(vx, vy) || 1;
    var lp = [mp[0] + vx / L * 2.6, mp[1] + vy / L * 2.6];
    var anc = vx > 1 ? 'start' : vx < -1 ? 'end' : 'middle';
    t.push('<text class="edge" text-anchor="' + anc + '" x="' + X(lp) + '" y="' + Y(lp) + '">' +
           e.name + ' <tspan class="' + (e.role === 'sleeveHem' ? 'hi' : 'sa') + '">' +
           e.seam.toFixed(1) + '</tspan></text>');
  });
  return { svg: t.join('\n'), w: bb.w * S, h: bb.h * S };
}

var A = panel(lay, 60, '제도 — 눕혀서 (교재)', '소매산 꼭짓점이 왼쪽 · 수구가 오른쪽 · 가장 넓은 자리가 비셉');
var B = panel(null, 60 + A.w + 190, '조각 — 세워서 (+90°)', '소매산이 위 · 수구(소매 밑단)가 아래');
var W = 60 + A.w + 190 + B.w + 200, H = PAD + 82 + Math.max(A.h, B.h) + 70;

var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(W) + '" height="' + Math.ceil(H) +
  '" viewBox="0 0 ' + Math.ceil(W) + ' ' + Math.ceil(H) + '">\n' +
  '<style>\n' +
  'text{font-family:"Apple SD Gothic Neo","Noto Sans KR",sans-serif}\n' +
  '.ttl{font-size:20px;font-weight:700;fill:#111}\n' +
  '.sub{font-size:13px;fill:#666}\n' +
  '.cut{fill:none;stroke:#111;stroke-width:2}\n' +
  '.seam{fill:#f4f7ff;stroke:#3b6fd4;stroke-width:1.2;stroke-dasharray:7 4}\n' +
  '.notch{stroke:#e0322a;stroke-width:2.4;stroke-linecap:round}\n' +
  '.grain{stroke:#1a7f4b;stroke-width:1.6;marker-start:url(#ah);marker-end:url(#ah)}\n' +
  '.grainT{font-size:12px;fill:#1a7f4b}\n' +
  '.edge{font-size:12.5px;fill:#333}\n' +
  '.sa{font-weight:700;fill:#3b6fd4}\n' +
  '.hi{font-weight:700;fill:#e0322a}\n' +
  '.cap{font-size:13px;fill:#444}\n' +
  '</style>\n' +
  '<defs><marker id="ah" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6" orient="auto">' +
  '<path d="M0 0 L8 4 L0 8 z" fill="#1a7f4b"/></marker></defs>\n' +
  '<rect width="100%" height="100%" fill="#fff"/>\n' + A.svg + '\n' + B.svg + '\n' +
  '<text class="cap" x="60" y="' + (H - 26) + '">' +
  DIR + ' · 66호 · 표준 시접 — 검정 재단선 · 파란 점선 시접선 · 빨강 너치 · 초록 식서. ' +
  '+90° 강체 회전이라 치수·곡선은 한 치도 안 변한다 (도면 대조 편차 0.32cm 로 동일).</text>\n</svg>\n';

var outp = process.argv[3] || '/tmp/sleeve.svg';
fs.writeFileSync(outp, svg);
var bad = svg.replace(/data:[^"')\s]+/g, '').match(/undefined|NaN|\[object/g);
console.log(outp, '·', Math.ceil(W) + '×' + Math.ceil(H), bad ? '✗ ' + bad.length + '건 오염' : '✓ undefined/NaN 없음');
