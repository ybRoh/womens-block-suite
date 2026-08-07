/* ============================================================================
 * PDF 내보내기 — 배율이 절대 틀리지 않는 1:1 출력
 *
 * 왜 PDF 인가
 *   브라우저 인쇄는 대화상자의 "페이지에 맞춤 / 배율" 설정에 따라 도면이 줄어든다.
 *   PDF 는 페이지 상자(MediaBox)와 좌표를 **포인트 단위로 직접 박아** 넣으므로
 *   뷰어에서 "실제 크기(100%)"로만 인쇄하면 배율이 어긋날 여지가 없다.
 *   1 cm = 28.346457 pt (72/2.54) 로 고정.
 *
 * 어떻게
 *   print.js 가 만든 **페이지 SVG 를 그대로 벡터로 옮긴다.** 배치·타일링·정합십자·
 *   눈금을 다시 구현하지 않으므로 인쇄 결과와 PDF 가 어긋날 수 없다.
 *   · 도형(path M/L/Z · line · rect · circle) → PDF 벡터 경로
 *   · ASCII 문자 → PDF 기본 폰트(Helvetica) 벡터
 *   · 한글 등 비ASCII 문자 → 캔버스로 한 번만 래스터화해 이미지로 재사용
 *     (한글 폰트를 통째로 끼워 넣으면 파일이 수 MB 가 되고, 외부 파일도 못 쓴다)
 *
 * 노출: window.NoDartPDF.buildPdf(pagesSvg, opt) → Promise&lt;Blob&gt;
 *       window.NoDartPDF.savePdf(pagesSvg, opt)  → Promise&lt;Blob&gt; (다운로드까지)
 *       스트림을 FlateDecode 로 압축하는데 CompressionStream 이 비동기라 둘 다 Promise 입니다.
 * 외부 라이브러리 없음.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var MM2PT = 72 / 25.4;             // 1 mm = 2.8346457 pt  (1 cm = 28.346457 pt)
  var TEXT_PX_PER_MM = 8;            // 한글 래스터 해상도 (203 dpi — 라벨용으로 충분)

  /* ── 행렬 [a b c d e f] = [[a c e],[b d f]] ─────────────────────────── */
  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }
  var IDENT = [1, 0, 0, 1, 0, 0];
  /** 변환 행렬은 자릿수를 줄이면 안 된다 — 배율 성분(1mm = 2.834646pt)을 3자리로
   *  반올림하면 2.835 가 되어 0.0125% (A4 세로에서 0.037mm) 어긋난다. */
  function fmtM(m) { return m.map(function (v) { return numHi(v); }).join(' '); }
  function numHi(v) {
    if (!isFinite(v)) return '0';
    var s = (Math.round(v * 1e6) / 1e6).toString();
    return s.indexOf('e') >= 0 ? v.toFixed(6) : s;
  }
  /* 좌표 자릿수 — 도면 좌표는 mm 단위라 소수 3자리면 1µm. 그 이상은 파일만 키운다. */
  function num(v) {
    if (!isFinite(v)) return '0';
    var s = (Math.round(v * 1e3) / 1e3).toString();
    return s.indexOf('e') >= 0 ? v.toFixed(3) : s;
  }

  /** SVG transform 속성 → 행렬 */
  function parseTransform(str) {
    var m = IDENT, re = /([a-zA-Z]+)\s*\(([^)]*)\)/g, hit;
    while ((hit = re.exec(str))) {
      var f = hit[1], a = hit[2].trim().split(/[\s,]+/).map(parseFloat);
      if (f === 'translate') m = mul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
      else if (f === 'scale') m = mul(m, [a[0], 0, 0, (a.length > 1 ? a[1] : a[0]), 0, 0]);
      else if (f === 'rotate') {
        var r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        if (a.length >= 3) m = mul(m, [1, 0, 0, 1, a[1], a[2]]);
        m = mul(m, [c, s, -s, c, 0, 0]);
        if (a.length >= 3) m = mul(m, [1, 0, 0, 1, -a[1], -a[2]]);
      } else if (f === 'matrix') m = mul(m, a);
    }
    return m;
  }

  /* ── 색 ─────────────────────────────────────────────────────────────── */
  var NAMED = { black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], none: null };
  function color(v) {
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    if (v === 'none' || v === 'transparent') return null;
    if (NAMED[v] !== undefined) return NAMED[v];
    if (v.charAt(0) === '#') {
      var h = v.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length !== 6) return [0, 0, 0];
      return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
    }
    var rgb = v.match(/^rgba?\(([^)]+)\)/);
    if (rgb) {
      var p = rgb[1].split(',').map(parseFloat);
      return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255];
    }
    return [0, 0, 0];
  }
  function eqc(a, b) { return a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

  /* ── 스타일 상속 ────────────────────────────────────────────────────── */
  var STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
                    'stroke-linejoin', 'font-size', 'font-family', 'font-weight',
                    'text-anchor', 'fill-opacity', 'stroke-opacity', 'opacity', 'paint-order'];
  function styleOf(el, parent) {
    var s = {}, i;
    for (i = 0; i < STYLE_KEYS.length; i++) s[STYLE_KEYS[i]] = parent ? parent[STYLE_KEYS[i]] : undefined;
    for (i = 0; i < STYLE_KEYS.length; i++) {
      var k = STYLE_KEYS[i];
      if (el.hasAttribute && el.hasAttribute(k)) s[k] = el.getAttribute(k);
    }
    var css = el.getAttribute && el.getAttribute('style');
    if (css) css.split(';').forEach(function (d) {
      var q = d.split(':');
      if (q.length === 2) s[q[0].trim()] = q[1].trim();
    });
    return s;
  }

  /* ── path 데이터 (print.js 는 M · L · Z 만 씁니다. C 도 안전하게 처리) ── */
  function pathOps(d) {
    var out = [], re = /([MmLlCcZzHhVv])([^MmLlCcZzHhVv]*)/g, hit, cx = 0, cy = 0, sx = 0, sy = 0;
    while ((hit = re.exec(d))) {
      var c = hit[1], a = hit[2].trim();
      var v = a ? a.split(/[\s,]+/).map(parseFloat).filter(function (x) { return isFinite(x); }) : [];
      var rel = (c === c.toLowerCase()), C = c.toUpperCase(), i;
      if (C === 'M') {
        for (i = 0; i + 1 < v.length; i += 2) {
          var X = rel ? cx + v[i] : v[i], Y = rel ? cy + v[i + 1] : v[i + 1];
          out.push(num(X) + ' ' + num(Y) + (i === 0 ? ' m' : ' l'));
          cx = X; cy = Y; if (i === 0) { sx = X; sy = Y; }
        }
      } else if (C === 'L') {
        for (i = 0; i + 1 < v.length; i += 2) {
          cx = rel ? cx + v[i] : v[i]; cy = rel ? cy + v[i + 1] : v[i + 1];
          out.push(num(cx) + ' ' + num(cy) + ' l');
        }
      } else if (C === 'H') {
        for (i = 0; i < v.length; i++) { cx = rel ? cx + v[i] : v[i]; out.push(num(cx) + ' ' + num(cy) + ' l'); }
      } else if (C === 'V') {
        for (i = 0; i < v.length; i++) { cy = rel ? cy + v[i] : v[i]; out.push(num(cx) + ' ' + num(cy) + ' l'); }
      } else if (C === 'C') {
        for (i = 0; i + 5 < v.length; i += 6) {
          var p = [];
          for (var j = 0; j < 6; j += 2) {
            p.push(rel ? cx + v[i + j] : v[i + j], rel ? cy + v[i + j + 1] : v[i + j + 1]);
          }
          out.push(p.map(num).join(' ') + ' c');
          cx = p[4]; cy = p[5];
        }
      } else if (C === 'Z') { out.push('h'); cx = sx; cy = sy; }
    }
    return out;
  }

  /* ── PDF 문자열 이스케이프 (WinAnsi) ────────────────────────────────── */
  function pdfStr(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), cc = s.charCodeAt(i);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else if (cc < 32 || cc > 126) out += ' ';
      else out += ch;
    }
    return out;
  }
  function isAscii(s) { return !/[^\x20-\x7E]/.test(s); }

  /* ── Flate 압축 ──────────────────────────────────────────────────────
   * 콘텐츠 스트림(조각 외곽선이 수만 선분)이 파일 크기의 대부분이라 압축이 필수다.
   * 브라우저 내장 CompressionStream('deflate') 이 zlib 포맷을 내주므로
   * PDF 의 /FlateDecode 와 그대로 맞는다. 없으면 RunLength 로 물러선다.       */
  function hasFlate() { return typeof global.CompressionStream === 'function'; }
  function deflate(bytes) {
    var cs = new global.CompressionStream('deflate');
    var w = cs.writable.getWriter();
    w.write(new Uint8Array(bytes)); w.close();
    return new global.Response(cs.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  /** 스트림 하나를 압축해 { filter, data } 로 돌려준다 */
  function packStream(bytes, preferRunLength) {
    if (hasFlate()) {
      return deflate(bytes).then(function (d) {
        if (d.length < bytes.length) return { filter: '/FlateDecode', data: d };
        return { filter: null, data: bytes };
      });
    }
    if (preferRunLength) {
      var r = runLength(bytes);
      if (r.length < bytes.length) return Promise.resolve({ filter: '/RunLengthDecode', data: r });
    }
    return Promise.resolve({ filter: null, data: bytes });
  }

  /* ── RunLength 압축 (PDF /RunLengthDecode) — CompressionStream 이 없을 때의 대비책 ── */
  function runLength(bytes) {
    var out = [], i = 0, n = bytes.length;
    while (i < n) {
      var run = 1;
      while (i + run < n && run < 128 && bytes[i + run] === bytes[i]) run++;
      if (run >= 2) { out.push(257 - run, bytes[i]); i += run; }
      else {
        var st = i, lit = 0;
        while (i < n && lit < 128 && !(i + 1 < n && i + 2 < n && bytes[i] === bytes[i + 1] && bytes[i] === bytes[i + 2])) { i++; lit++; }
        out.push(lit - 1);
        for (var k = 0; k < lit; k++) out.push(bytes[st + k]);
      }
    }
    out.push(128);
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════
   * 문자 래스터화 — 비ASCII 문자열만. 같은 (문자열·크기·굵기·색) 은 한 번만.
   * ════════════════════════════════════════════════════════════════ */
  function makeTextImage(text, sizeMm, weight, fill, halo) {
    var S = TEXT_PX_PER_MM, px = sizeMm * S;
    var cv = global.document.createElement('canvas');
    var g = cv.getContext('2d');
    var font = (weight && weight !== 'normal' ? weight + ' ' : '') + px + 'px ' +
               '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';
    g.font = font;
    var w = Math.max(1, Math.ceil(g.measureText(text).width));
    var padT = Math.ceil(px * 0.30), padB = Math.ceil(px * 0.32), pad = Math.ceil(px * 0.18);
    cv.width = w + pad * 2; cv.height = Math.ceil(px) + padT + padB;
    g = cv.getContext('2d');
    g.font = font; g.textBaseline = 'alphabetic';
    var baseY = padT + px;
    if (halo) {                                  // print.js 의 halo(흰 테두리) 재현
      g.lineWidth = Math.max(1, px * 0.22); g.strokeStyle = '#ffffff';
      g.lineJoin = 'round'; g.strokeText(text, pad, baseY);
    }
    g.fillStyle = 'rgb(' + Math.round(fill[0] * 255) + ',' + Math.round(fill[1] * 255) + ',' +
                  Math.round(fill[2] * 255) + ')';
    g.fillText(text, pad, baseY);
    var img = g.getImageData(0, 0, cv.width, cv.height).data;
    /* 색 채널은 글자색(+halo 흰색)뿐이라 회색조면 1채널로 충분하다.
       RunLength 로 거의 0 에 수렴해 파일이 3~4배 작아진다. */
    var gray = true;
    for (var t = 0; t < img.length; t += 4) {
      if (img[t + 3] && (img[t] !== img[t + 1] || img[t + 1] !== img[t + 2])) { gray = false; break; }
    }
    var rgb = [], alpha = [];
    for (var i = 0; i < img.length; i += 4) {
      if (gray) rgb.push(img[i]);
      else rgb.push(img[i], img[i + 1], img[i + 2]);
      alpha.push(img[i + 3]);
    }
    return {
      w: cv.width, h: cv.height, rgb: rgb, alpha: alpha, gray: gray,
      wMm: cv.width / S, hMm: cv.height / S,
      baseMm: baseY / S, padMm: pad / S, textWMm: w / S
    };
  }

  /* ══════════════════════════════════════════════════════════════════
   * SVG 한 장 → PDF 콘텐츠 스트림
   * ════════════════════════════════════════════════════════════════ */
  function pageContent(svgEl, hPt, res) {
    var ops = [];
    var base = [MM2PT, 0, 0, -MM2PT, 0, hPt];       // mm(y아래) → pt(y위)
    var clips = {};
    Array.prototype.forEach.call(svgEl.querySelectorAll('clipPath'), function (cp) {
      var r = cp.querySelector('rect');
      if (r) clips[cp.getAttribute('id')] = {
        x: +r.getAttribute('x') || 0, y: +r.getAttribute('y') || 0,
        w: +r.getAttribute('width') || 0, h: +r.getAttribute('height') || 0
      };
    });

    function paint(st, hasFillDefault) {
      var f = st.fill === undefined ? (hasFillDefault ? [0, 0, 0] : null) : color(st.fill);
      var s = color(st.stroke);
      var sw = st['stroke-width'] === undefined ? 1 : parseFloat(st['stroke-width']);
      var pre = [], op = '';
      if (f) pre.push(num(f[0]) + ' ' + num(f[1]) + ' ' + num(f[2]) + ' rg');
      if (s) {
        pre.push(num(s[0]) + ' ' + num(s[1]) + ' ' + num(s[2]) + ' RG');
        pre.push(num(sw > 0 ? sw : 0.06) + ' w');
        var da = st['stroke-dasharray'];
        if (da && da !== 'none') {
          var arr = String(da).trim().split(/[\s,]+/).map(parseFloat).filter(isFinite);
          pre.push('[' + arr.map(num).join(' ') + '] 0 d');
        } else pre.push('[] 0 d');
        var lj = st['stroke-linejoin'];
        pre.push((lj === 'round' ? 1 : lj === 'bevel' ? 2 : 0) + ' j');
        var lc = st['stroke-linecap'];
        pre.push((lc === 'round' ? 1 : lc === 'square' ? 2 : 0) + ' J');
      }
      op = (f && s) ? 'B' : f ? 'f' : s ? 'S' : 'n';
      return { pre: pre, op: op, none: !f && !s };
    }

    function draw(el, ctm, pst) {
      var tag = (el.tagName || '').toLowerCase();
      var st = styleOf(el, pst);
      var m = ctm;
      var tr = el.getAttribute && el.getAttribute('transform');
      if (tr) m = mul(m, parseTransform(tr));

      if (tag === 'defs' || tag === 'clippath' || tag === 'title' || tag === 'desc') return;

      if (tag === 'g' || tag === 'svg') {
        var cpRef = el.getAttribute && el.getAttribute('clip-path');
        var cid = cpRef && (cpRef.match(/#([^)"']+)/) || [])[1];
        var cl = cid && clips[cid];
        ops.push('q');
        if (cl) {
          /* 클립 사각형은 이 요소의 좌표계에서 정의된다. CTM 을 그쪽으로 옮겨 클립을
             건 뒤 CTM 만 되돌린다 — 클립은 q/Q 경계까지 그대로 남는다. */
          var CM = mul(base, m);
          ops.push(fmtM(CM) + ' cm');
          ops.push(num(cl.x) + ' ' + num(cl.y) + ' ' + num(cl.w) + ' ' + num(cl.h) + ' re W n');
          ops.push(fmtM(inv(CM)) + ' cm');
        }
        Array.prototype.forEach.call(el.childNodes, function (c) {
          if (c.nodeType === 1) draw(c, m, st);
        });
        ops.push('Q');
        return;
      }

      var R = mul(base, m);
      if (tag === 'path') {
        var d = el.getAttribute('d'); if (!d) return;
        var p = paint(st, true); if (p.none) return;
        ops.push('q', fmtM(R) + ' cm');
        p.pre.forEach(function (x) { ops.push(x); });
        pathOps(d).forEach(function (x) { ops.push(x); });
        ops.push(p.op, 'Q');
      } else if (tag === 'line') {
        var p2 = paint({ fill: 'none', stroke: st.stroke || '#000', 'stroke-width': st['stroke-width'],
                         'stroke-dasharray': st['stroke-dasharray'], 'stroke-linecap': st['stroke-linecap'],
                         'stroke-linejoin': st['stroke-linejoin'] }, false);
        if (p2.none) return;
        ops.push('q', fmtM(R) + ' cm');
        p2.pre.forEach(function (x) { ops.push(x); });
        ops.push(num(+el.getAttribute('x1') || 0) + ' ' + num(+el.getAttribute('y1') || 0) + ' m');
        ops.push(num(+el.getAttribute('x2') || 0) + ' ' + num(+el.getAttribute('y2') || 0) + ' l');
        ops.push('S', 'Q');
      } else if (tag === 'rect') {
        var p3 = paint(st, true); if (p3.none) return;
        ops.push('q', fmtM(R) + ' cm');
        p3.pre.forEach(function (x) { ops.push(x); });
        ops.push(num(+el.getAttribute('x') || 0) + ' ' + num(+el.getAttribute('y') || 0) + ' ' +
                 num(+el.getAttribute('width') || 0) + ' ' + num(+el.getAttribute('height') || 0) + ' re');
        ops.push(p3.op, 'Q');
      } else if (tag === 'circle') {
        var p4 = paint(st, true); if (p4.none) return;
        var cx = +el.getAttribute('cx') || 0, cy = +el.getAttribute('cy') || 0, r = +el.getAttribute('r') || 0;
        var kk = r * 0.5522847498;
        ops.push('q', fmtM(R) + ' cm');
        p4.pre.forEach(function (x) { ops.push(x); });
        ops.push(num(cx + r) + ' ' + num(cy) + ' m');
        ops.push([cx + r, cy + kk, cx + kk, cy + r, cx, cy + r].map(num).join(' ') + ' c');
        ops.push([cx - kk, cy + r, cx - r, cy + kk, cx - r, cy].map(num).join(' ') + ' c');
        ops.push([cx - r, cy - kk, cx - kk, cy - r, cx, cy - r].map(num).join(' ') + ' c');
        ops.push([cx + kk, cy - r, cx + r, cy - kk, cx + r, cy].map(num).join(' ') + ' c');
        ops.push(p4.op, 'Q');
      } else if (tag === 'text') {
        drawText(el, R, st, res, ops);
      }
    }

    Array.prototype.forEach.call(svgEl.childNodes, function (c) {
      if (c.nodeType === 1) draw(c, IDENT, null);
    });
    return ops.join('\n');
  }

  function inv(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    if (!det) return IDENT;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
            (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  }

  function drawText(el, R, st, res, ops) {
    var txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) return;
    var size = parseFloat(st['font-size'] || 3) || 3;
    var fill = color(st.fill === undefined ? '#000' : st.fill) || [0, 0, 0];
    var anchor = st['text-anchor'] || 'start';
    var weight = st['font-weight'] || 'normal';
    var halo = !!(st.stroke && color(st.stroke) && st['paint-order']);
    var x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0;

    if (isAscii(txt)) {
      /* PDF 기본 폰트 — 벡터. 폭은 캔버스로 근사 측정해 정렬만 맞춘다. */
      var w = res.measure(txt, size, weight);
      var dx = anchor === 'middle' ? -w / 2 : anchor === 'end' ? -w : 0;
      var fname = (weight === 'bold' || +weight >= 600) ? 'FB' : 'FR';
      res.fonts[fname] = 1;
      /* 텍스트는 y 뒤집힘을 상쇄해야 글자가 바로 선다 */
      var Tm = mul(R, [1, 0, 0, -1, x + dx, y]);
      ops.push('q', 'BT', '/' + fname + ' ' + num(size) + ' Tf',
               num(fill[0]) + ' ' + num(fill[1]) + ' ' + num(fill[2]) + ' rg',
               fmtM(Tm) + ' Tm', '(' + pdfStr(txt) + ') Tj', 'ET', 'Q');
      return;
    }

    /* 비ASCII — 래스터 이미지 (같은 문자열은 한 번만 만들어 재사용) */
    var key = txt + '|' + size + '|' + weight + '|' + fill.join(',') + '|' + (halo ? 'h' : '');
    var im = res.images[key];
    if (!im) {
      im = makeTextImage(txt, size, weight, fill, halo);
      im.name = 'Im' + (res.imgSeq++);
      res.images[key] = im;
    }
    var dx2 = anchor === 'middle' ? -im.textWMm / 2 : anchor === 'end' ? -im.textWMm : 0;
    var x0 = x + dx2 - im.padMm, y0 = y - im.baseMm;
    var M = mul(R, [im.wMm, 0, 0, -im.hMm, x0, y0 + im.hMm]);
    ops.push('q', fmtM(M) + ' cm', '/' + im.name + ' Do', 'Q');
  }

  /* ══════════════════════════════════════════════════════════════════
   * PDF 파일 조립
   * ════════════════════════════════════════════════════════════════ */
  function buildPdf(pagesSvg, opt) {
    opt = opt || {};
    if (!pagesSvg || !pagesSvg.length) throw new Error('NoDartPDF: 페이지가 없습니다.');
    if (!global.document || !global.DOMParser) throw new Error('NoDartPDF: 브라우저에서만 동작합니다.');

    var mcv = global.document.createElement('canvas').getContext('2d');
    var res = {
      images: {}, imgSeq: 1, fonts: {},
      measure: function (t, sizeMm, weight) {
        mcv.font = (weight && weight !== 'normal' ? weight + ' ' : '') + (sizeMm * 10) + 'px Helvetica,Arial,sans-serif';
        return mcv.measureText(t).width / 10;
      }
    };

    var parser = new global.DOMParser();
    var pages = [];
    for (var i = 0; i < pagesSvg.length; i++) {
      var doc = parser.parseFromString(pagesSvg[i], 'image/svg+xml');
      var svg = doc.documentElement;
      if (!svg || svg.nodeName === 'parsererror') throw new Error('NoDartPDF: ' + (i + 1) + '번째 페이지 SVG 를 읽지 못했습니다.');
      var wMm = parseFloat(svg.getAttribute('width')) || opt.widthMm || 210;
      var hMm = parseFloat(svg.getAttribute('height')) || opt.heightMm || 297;
      var wPt = wMm * MM2PT, hPt = hMm * MM2PT;
      pages.push({ wPt: wPt, hPt: hPt, content: pageContent(svg, hPt, res) });
    }

    /* ── 스트림을 먼저 전부 압축한다 (CompressionStream 이 비동기라 여기서 모아 처리) ── */
    var imgKeys = Object.keys(res.images);
    var jobs = [];
    pages.forEach(function (p) { jobs.push(packStream(strBytes(p.content), false)); });
    imgKeys.forEach(function (k) {
      var im = res.images[k];
      jobs.push(packStream(im.rgb, true));
      jobs.push(packStream(im.alpha, true));
    });

    return Promise.all(jobs).then(function (packed) {
      return assemble(pages, res, imgKeys, packed, opt);
    });
  }

  function strBytes(s) {
    var a = [];
    for (var k = 0; k < s.length; k++) a.push(s.charCodeAt(k) & 0xff);
    return a;
  }

  function assemble(pages, res, imgKeys, packed, opt) {
    var offsets = [], objn = 0, buf = [];
    function push(s) {
      for (var k = 0; k < s.length; k++) buf.push(s.charCodeAt(k) & 0xff);
    }
    function pushBytes(a) { for (var k = 0; k < a.length; k++) buf.push(a[k] & 0xff); }
    function obj(body, stream) {
      objn++;
      offsets[objn] = buf.length;
      push(objn + ' 0 obj\n' + body);
      if (stream) {
        push('\nstream\n');
        pushBytes(stream);
        push('\nendstream');
      }
      push('\nendobj\n');
      return objn;
    }

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    var pi = 0;
    var contentPacked = pages.map(function () { return packed[pi++]; });

    /* 이미지 XObject */
    var imgIds = {};
    imgKeys.forEach(function (k) {
      var im = res.images[k];
      var rgbP = packed[pi++], alP = packed[pi++];
      var smask = obj('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
        ' /ColorSpace /DeviceGray /BitsPerComponent 8' +
        (alP.filter ? ' /Filter ' + alP.filter : '') + ' /Length ' + alP.data.length + ' >>', alP.data);
      imgIds[im.name] = obj('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h +
        ' /ColorSpace /' + (im.gray ? 'DeviceGray' : 'DeviceRGB') + ' /BitsPerComponent 8' +
        (rgbP.filter ? ' /Filter ' + rgbP.filter : '') + ' /SMask ' + smask +
        ' 0 R /Length ' + rgbP.data.length + ' >>', rgbP.data);
    });

    /* 폰트 */
    var fontIds = {};
    if (res.fonts.FR) fontIds.FR = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    if (res.fonts.FB) fontIds.FB = obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    var fontDict = Object.keys(fontIds).map(function (n) { return '/' + n + ' ' + fontIds[n] + ' 0 R'; }).join(' ');
    var xobjDict = Object.keys(imgIds).map(function (n) { return '/' + n + ' ' + imgIds[n] + ' 0 R'; }).join(' ');
    var resDict = '<< /ProcSet [/PDF /Text /ImageC /ImageB]' +
      (fontDict ? ' /Font << ' + fontDict + ' >>' : '') +
      (xobjDict ? ' /XObject << ' + xobjDict + ' >>' : '') + ' >>';

    var pagesObjNum = 0;
    var kids = [];
    /* 페이지 객체는 Pages 객체 번호를 알아야 하므로 두 번에 나눠 만든다 */
    var contentIds = pages.map(function (p, i) {
      var c = contentPacked[i];
      return obj('<< ' + (c.filter ? '/Filter ' + c.filter + ' ' : '') + '/Length ' + c.data.length + ' >>', c.data);
    });
    var resId = obj(resDict);
    pagesObjNum = objn + pages.length + 1;
    pages.forEach(function (p, idx) {
      var id = obj('<< /Type /Page /Parent ' + pagesObjNum + ' 0 R /MediaBox [0 0 ' +
        numHi(p.wPt) + ' ' + numHi(p.hPt) + '] /Resources ' + resId + ' 0 R /Contents ' +
        contentIds[idx] + ' 0 R >>');
      kids.push(id + ' 0 R');
    });
    var pagesId = obj('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>');
    var infoId = obj('<< /Producer (여성복 원형 Suite) /Title (' + pdfStr(opt.title || 'pattern') + ') >>');
    var catId = obj('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');

    var xrefPos = buf.length;
    push('xref\n0 ' + (objn + 1) + '\n0000000000 65535 f \n');
    for (var q = 1; q <= objn; q++) {
      push(('0000000000' + offsets[q]).slice(-10) + ' 00000 n \n');
    }
    push('trailer\n<< /Size ' + (objn + 1) + ' /Root ' + catId + ' 0 R /Info ' + infoId + ' 0 R >>\n' +
         'startxref\n' + xrefPos + '\n%%EOF\n');

    return new global.Blob([new Uint8Array(buf)], { type: 'application/pdf' });
  }

  /** @returns {Promise<Blob>} */
  function savePdf(pagesSvg, opt) {
    return buildPdf(pagesSvg, opt).then(function (blob) {
      var name = (opt && opt.fileName) || 'pattern.pdf';
      var a = global.document.createElement('a');
      var url = global.URL.createObjectURL(blob);
      a.href = url; a.download = name;
      global.document.body.appendChild(a);
      a.click();
      global.setTimeout(function () { global.URL.revokeObjectURL(url); a.remove(); }, 2000);
      return blob;
    });
  }

  var api = { VERSION: VERSION, MM2PT: MM2PT, buildPdf: buildPdf, savePdf: savePdf,
              _parseTransform: parseTransform, _pathOps: pathOps, _runLength: runLength, _mul: mul };
  if (typeof global !== 'undefined') global.NoDartPDF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
