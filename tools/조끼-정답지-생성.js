/* 실행:  node tools/조끼-정답지-생성.js <15_앞뒤판완성이미지.bmp>
 *   bmp 는 원본 jpg 를 sips 로 변환:  sips -s format bmp ~/Downloads/조끼패턴/15_앞뒤판완성이미지.jpg --out /tmp/ref15.bmp
 *   축척(px/cm)은 격자선으로 세운 값이 박혀 있다 — 다른 스캔본이면 다시 세울 것. */
/* 완성이미지(15) 색 마스크 → docs/answer/조끼-{뒤판,앞판}.json 정답지 생성
   방법: 픽셀 색분류(G/R/P) → **엔진 최근접 곡선 배정** → 엔진 호 순서로 정렬 →
   0.12cm 데시메이션. 엔진이 이미 도면에 근접한 상태에서 돌려야 배정이 깨끗하다
   (2026-08-14 · cmp.js 와 같은 분류기/축척). */
var fs = require('fs');
var BM = require('./bmp-lite.js');
var E = require(__dirname + '/../조끼/engine.js');
var U = E.util;

var im = BM.readBMP(process.argv[2] || (__dirname + '/ref15.bmp'));
var W = im.w, H = im.h, PX = im.px;
function cls(x, y) {
  var o = (y * W + x) * 3, r = PX[o], gg = PX[o + 1], b = PX[o + 2];
  var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx - mn;
  if (sat >= 40) {
    if (b > gg + 25 && r > gg + 10 && b > 60) return 'P';
    if (gg > r + 25 && gg > b + 15) return 'G';
    if (r > gg + 45 && r > b + 30) return 'R';
  }
  return null;
}
var mask = { G: [], R: [], P: [] };
for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
  var c = cls(x, y); if (c) mask[c].push([x, y]);
}

/* 축척 (cmp.js 가 격자선으로 세운 값) */
var SY = 20.620, OY = 242.42, SX = 20.301, OXB = 1250.84, OXF = 521.5;
function cx(px_, pan) { return ((pan === 'B' ? OXB : OXF) - px_) / SX; }
function cy(py) { return (py - OY) / SY; }

var m = E.measuresForSize('55호'); m.hipLen = 20;
var g = E.geom(m, {});
function lin() { return U.lineSegs.apply(null, [].slice.call(arguments).map(function (p) { return p.slice(); })); }

/* 대조 곡선 — cmp.js 와 같은 목록에서 검정 은폐·정책적 괴리 항목을 뺐다 */
var CURVES = [
  ['bNeck',      'B', 'R', g.bNeck],
  ['bCb',        'B', 'R', g.bCb.concat(g.bCbLow)],
  ['bArm',       'B', 'R', g.bArm],
  ['bSide',      'B', 'R', g.bSide],
  ['bSplitIn',   'B', 'R', g.bSplitIn],
  ['bSplitOut',  'B', 'R', g.bSplitOut],
  ['bShoulder',  'B', 'R', lin(g.p38, g.p26)],
  ['fNeck',      'F', 'G', g.fNeck],
  ['fArm',       'F', 'G', g.fArm],
  ['fSide',      'F', 'G', g.fSide],
  ['fHem',       'F', 'G', g.fHem],
  ['fSplitIn',   'F', 'G', g.fSplitIn],
  ['fSplitOut',  'F', 'G', g.fSplitOut],
  ['fShoulder',  'F', 'G', lin(g.f53, g.f52)],
  ['fFacing',    'F', 'P', g.fFacing],
  ['bFacing',    'B', 'P', g.bFacing],
  ['fHemFacing', 'F', 'P', g.fHemFacing],
  ['bHemFacing', 'B', 'P', g.bHemFacing]
];
CURVES.forEach(function (C) { C.eng = U.sampleSegs(C[3], 0.05); C.px = []; });

/* 마스크 픽셀 → 최근접 엔진 곡선 배정 (2cm 캡 — 배정이 애매한 픽셀은 버린다) */
['R', 'G', 'P'].forEach(function (mk) {
  var grp = CURVES.filter(function (C) { return C[2] === mk; });
  grp.forEach(function (C) {
    C.cm = C.eng; // cm 좌표 그대로
  });
  mask[mk].forEach(function (p) {
    var bi = -1, bt = -1, bd = 4;   // 2cm^2 = 4
    for (var k = 0; k < grp.length; k++) {
      var pan = grp[k][1], q = [cx(p[0], pan), cy(p[1])], P = grp[k].cm;
      for (var t = 0; t < P.length; t++) {
        var dx = P[t][0] - q[0], dy = P[t][1] - q[1], d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = k; bt = t; }
      }
    }
    if (bi >= 0) grp[bi].px.push({ q: [cx(p[0], grp[bi][1]), cy(p[1])], t: bt, d: Math.sqrt(bd) });
  });
});

/* ── 주석 픽셀 여과 — 국소 중앙값 이탈 ─────────────────────────────────
   도면에는 곡선 말고도 MP 접기 표시·[27] 예시선·라벨 브래킷이 같은 색으로 그려져
   있다. 이런 픽셀은 곡선의 **국소 편차 중앙값**(엔진 호 ±2cm 창)에서 0.35 이상
   튄다 — 반면 실제 곡선의 체계적 편차(정책적 괴리 · 앞암홀 0.9 등)는 중앙값
   자체가 움직이므로 살아남는다. */
function medianPass(px, W2, thr) {
  var kept = [];
  for (var i = 0; i < px.length; i++) {
    var t0 = px[i].t, win = [];
    for (var j = i; j >= 0 && px[j].t >= t0 - W2; j--) win.push(px[j].d);
    for (var j2 = i + 1; j2 < px.length && px[j2].t <= t0 + W2; j2++) win.push(px[j2].d);
    win.sort(function (a, b) { return a - b; });
    var med = win[win.length >> 1];
    if (Math.abs(px[i].d - med) <= thr) kept.push(px[i]);
  }
  return kept;
}
CURVES.forEach(function (C) {
  if (!C.px.length) return;
  C.px.sort(function (a, b) { return a.t - b.t; });
  /* 2패스 — 폭 넓은 주석(너치 표시·라벨 브래킷)은 1패스의 창 중앙값을 저 자신이
     끌어당겨 살아남는다. 걸러낸 집합으로 중앙값을 다시 세우면 죽는다. */
  C.px = medianPass(C.px, 40, 0.35);            // ±2cm 창
  C.px = medianPass(C.px, 60, 0.30);            // ±3cm 창 · 더 엄격
});

/* 엔진 호 순서(t)로 정렬 → 0.12cm 데시메이션 (계단 부풀림 제거) */
function decimate(pts) {
  var out = [], last = null;
  pts.forEach(function (p) {
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.12) { out.push(p); last = p; }
  });
  return out;
}
function build(pan) {
  var curves = {};
  CURVES.filter(function (C) { return C[1] === pan; }).forEach(function (C) {
    if (C.px.length < 20) return;                     // 자료가 없으면 항목 자체를 뺀다
    C.px.sort(function (a, b) { return a.t - b.t; });
    var pts = decimate(C.px.map(function (e) { return [+e.q[0].toFixed(3), +e.q[1].toFixed(3)]; }));
    if (pts.length >= 8) curves[C[0]] = pts;
  });
  return curves;
}

var META = {
  image: '15_앞뒤판완성이미지.jpg', unit: 'cm', size: '55호',
  method: '픽셀 색분류(G/R/P) → 엔진 최근접 배정(2cm 캡) → 호 순서 정렬 → 0.12cm 데시메이션',
  transform: { sx: SX, sy: SY, oxB: OXB, oxF: OXF, oy: OY, residual_cm: 0.05, mirrored: false }
};
/* tol = 2026-08-14 실측 하우스도르프 + 여유 0.15~0.2. 큰 값은 전부 사연이 있다 —
   주석에 적고, 실측값 자체는 매 검산마다 3-C 줄에 찍힌다. */
var back = Object.assign({}, META, {
  points: {}, curves: build('B'),
  tol: { pt: 0.2, curve: 0.4 },
  tol_bCb: 0.45,        // 실측 0.28 · 위 1/3 은 검정 기초선에 은폐 (clipToRef 가 뺀다)
  tol_bNeck: 0.6,       // 실측 0.42 · 38 부근이 손그림 어깨 어긋남에 물려 있다
  tol_bArm: 0.65,       // 실측 0.50 · 13번 직전 hook 만 도면이 조금 더 밖 (끝점 원문 [7] 고정)
  tol_bSide: 0.55,      // 실측 0.39
  tol_bSplitIn: 1.0,    // 실측 0.81 · 시작각 31°(원문 27~34.7 · 시접) vs 완성이미지 ~12°
  tol_bSplitOut: 0.75,  // 실측 0.58
  tol_bShoulder: 1.25,  // 실측 1.06 · 어깨/2 라벨·브래킷이 선을 따라 붙어 여과 불가
                        //   + 손그림 회전 — 원문 [10][12] 수치 고정이라 참고용 항목
  tol_bFacing: 2.3,     // 실측 2.00 · 뒤중심 깊이 라벨 6~7 vs 실측 4.3 — 라벨 우선 정책
  tol_bHemFacing: 1.4,  // 실측 1.22 · 뒤중심 8 vs 실측 6.9 — 라벨 우선 정책
  note: '완성이미지는 손그림이라 어깨 일대·안단 깊이가 라벨과 어긋난다. 라벨(원문 숫자) 우선 정책에 따라 그 곡선들은 tol 을 넓혀 두되, 실측 하우스도르프는 매 검산마다 찍힌다. 검정 기초선과 겹치는 구간(등솔 위쪽·뒷목 평평 구간·밑단)은 색분류가 못 잡아 정답지에 없다 — clipToRef 가 그 구간을 대조에서 뺀다.'
});
var front = Object.assign({}, META, {
  points: {}, curves: build('F'),
  tol: { pt: 0.2, curve: 0.4 },
  tol_fNeck: 0.65,      // 실측 0.47 · 53 부근 손그림 어깨 어긋남 + 접기표시 잔재
  tol_fArm: 1.2,        // 실측 1.04 · 원문 [25] 「49에서 0.5」 고정 — 도면은 중간이 0.9 밖
  tol_fSide: 0.9,       // 실측 0.71 · 도면의 앞 옆선 위쪽이 뒤판과 0.4 다르다(손그림) —
                        //   옆선 짝은 봉제상 같아야 하므로 엔진은 앞뒤 동형을 지킨다
  tol_fHem: 0.6,        // 실측 0.43 · 도면 밑단은 살짝 처진 곡선, 원문 [40] 은 직선
  tol_fSplitIn: 0.9,    // 실측 0.73 · 시작각 27°(시접 하한 26) vs 실측 21°
  tol_fSplitOut: 1.2,   // 실측 1.02
  tol_fShoulder: 1.5,   // 실측 1.33 · 어깨 라벨·브래킷 오염 — 참고용 (bShoulder 주석)
  tol_fFacing: 1.75,    // 실측 1.54 · 어깨 4.5 라벨 vs 실측 2.54 — 라벨 우선 정책
  tol_fHemFacing: 1.0,  // 실측 0.83 · 앞중심 12 라벨 vs 실측 11.35 — 라벨 우선 정책
  note: '앞 절개선은 62번(밑단 위 5) 아래로 완성이미지에 아예 안 그려져 있다(원문 [29]는 60·61 밑단까지 연결) — 정답지가 62 에서 끝나므로 clipToRef 가 그 아래를 대조에서 뺀다. 앞 삼각(겨드랑)다트는 사용자 결정(절개선 이관)으로 도면과 자리가 달라 정답지에서 뺐다. 시작각·암홀 tol 사연은 engine.js K 주석 참고.'
});

var DIR = __dirname + '/../docs/answer';
fs.writeFileSync(DIR + '/조끼-뒤판.json', JSON.stringify(back));
fs.writeFileSync(DIR + '/조끼-앞판.json', JSON.stringify(front));
Object.keys(back.curves).forEach(function (k) { console.log('뒤 ' + k + ' ' + back.curves[k].length + '점'); });
Object.keys(front.curves).forEach(function (k) { console.log('앞 ' + k + ' ' + front.curves[k].length + '점'); });
console.log('저장 완료');
