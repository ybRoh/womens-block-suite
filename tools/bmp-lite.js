/* 24bit BMP reader -> {w,h,px:Uint8Array RGB row-major top-down} */
var fs = require('fs');
function readBMP(path) {
  var b = fs.readFileSync(path);
  if (b[0] !== 0x42 || b[1] !== 0x4D) throw new Error('not BMP');
  var off = b.readUInt32LE(10);
  var hdr = b.readUInt32LE(14);
  var w = b.readInt32LE(18), h = b.readInt32LE(22);
  var bpp = b.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error('bpp ' + bpp);
  var bytes = bpp / 8;
  var bottomUp = h > 0; h = Math.abs(h);
  var stride = Math.floor((w * bytes + 3) / 4) * 4;
  var px = new Uint8Array(w * h * 3);
  for (var y = 0; y < h; y++) {
    var sy = bottomUp ? (h - 1 - y) : y;
    var ro = off + sy * stride;
    for (var x = 0; x < w; x++) {
      var o = ro + x * bytes, d = (y * w + x) * 3;
      px[d] = b[o + 2]; px[d + 1] = b[o + 1]; px[d + 2] = b[o];
    }
  }
  return { w: w, h: h, px: px, hdr: hdr };
}
module.exports = { readBMP: readBMP };
