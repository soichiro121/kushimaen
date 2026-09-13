/**
 * Minimal dependency-free raster canvas + PNG encoder.
 *
 * Used only by `npm run assets:placeholders` to generate the placeholder art that
 * ships in `public/assets/`. It is a BUILD-TIME tool: nothing here runs in the
 * browser or on the production server.
 *
 * Placeholders are emitted as real PNG / real spritesheets on purpose — the game
 * then exercises exactly the same load path it will use for the final artwork, so
 * swapping a file cannot surprise us.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4); // RGBA, transparent
  }

  /** Alpha-blend a single pixel. `color` is [r, g, b, a] with a in 0..255. */
  blend(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = color[3] / 255;
    if (a <= 0) return;
    const i = (y * this.width + x) * 4;
    const inv = 1 - a;
    const dstA = this.data[i + 3] / 255;
    const outA = a + dstA * inv;
    if (outA <= 0) return;
    for (let c = 0; c < 3; c++) {
      this.data[i + c] = (color[c] * a + this.data[i + c] * dstA * inv) / outA;
    }
    this.data[i + 3] = outA * 255;
  }

  fill(color) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) this.blend(x, y, color);
    }
  }

  rect(x, y, w, h, color) {
    for (let py = Math.round(y); py < Math.round(y + h); py++) {
      for (let px = Math.round(x); px < Math.round(x + w); px++) this.blend(px, py, color);
    }
  }

  /** Vertical linear gradient over a rect. */
  gradientRect(x, y, w, h, top, bottom) {
    for (let py = 0; py < h; py++) {
      const t = h <= 1 ? 0 : py / (h - 1);
      const color = [
        top[0] + (bottom[0] - top[0]) * t,
        top[1] + (bottom[1] - top[1]) * t,
        top[2] + (bottom[2] - top[2]) * t,
        top[3] + (bottom[3] - top[3]) * t,
      ];
      for (let px = 0; px < w; px++) this.blend(x + px, y + py, color);
    }
  }

  /** Anti-aliased filled ellipse. */
  ellipse(cx, cy, rx, ry, color) {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        // Feather roughly one pixel wide, scaled back into normalised space.
        const feather = 1 / Math.max(rx, ry);
        const coverage =
          d <= 1 - feather ? 1 : d >= 1 + feather ? 0 : (1 + feather - d) / (2 * feather);
        if (coverage > 0) this.blend(x, y, [color[0], color[1], color[2], color[3] * coverage]);
      }
    }
  }

  roundRect(x, y, w, h, r, color) {
    r = Math.min(r, w / 2, h / 2);
    this.rect(x + r, y, w - 2 * r, h, color);
    this.rect(x, y + r, r, h - 2 * r, color);
    this.rect(x + w - r, y + r, r, h - 2 * r, color);
    this.ellipse(x + r, y + r, r, r, color);
    this.ellipse(x + w - r, y + r, r, r, color);
    this.ellipse(x + r, y + h - r, r, r, color);
    this.ellipse(x + w - r, y + h - r, r, r, color);
  }

  /** Filled convex/concave polygon via even-odd scanline test. */
  polygon(points, color) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, py] of points) {
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const crossings = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        const cy = y + 0.5;
        if (ay <= cy && by > cy) crossings.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
        else if (by <= cy && ay > cy) crossings.push(bx + ((cy - by) / (ay - by)) * (ax - bx));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        for (let x = Math.round(crossings[i]); x < Math.round(crossings[i + 1]); x++) {
          this.blend(x, y, color);
        }
      }
    }
  }

  /** Draw a sub-canvas at an offset (used to compose spritesheet frames). */
  drawCanvas(src, offsetX, offsetY) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        this.blend(offsetX + x, offsetY + y, [
          src.data[i],
          src.data[i + 1],
          src.data[i + 2],
          src.data[i + 3],
        ]);
      }
    }
  }

  toPNG() {
    const raw = Buffer.alloc(this.height * (this.width * 4 + 1));
    let p = 0;
    for (let y = 0; y < this.height; y++) {
      raw[p++] = 0; // filter: none — placeholders are small, compression ratio is fine
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4;
        raw[p++] = this.data[i];
        raw[p++] = this.data[i + 1];
        raw[p++] = this.data[i + 2];
        raw[p++] = this.data[i + 3];
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

export function hex(value, alpha = 255) {
  const n = parseInt(value.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, alpha];
}
