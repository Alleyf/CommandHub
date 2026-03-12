import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const outDir = path.join(root, "electron", "assets");
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(left, right, t) {
  return [
    mix(left[0], right[0], t),
    mix(left[1], right[1], t),
    mix(left[2], right[2], t),
    mix(left[3], right[3], t)
  ];
}

function over(bottom, top) {
  const alpha = top[3] + bottom[3] * (1 - top[3]);
  if (alpha <= 0) return [0, 0, 0, 0];
  return [
    (top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / alpha,
    (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / alpha,
    (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / alpha,
    alpha
  ];
}

function sdfRoundedRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdfCircle(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) - radius;
}

function sdfSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function coverage(distance, feather = 1.2) {
  return clamp(0.5 - distance / feather, 0, 1);
}

function gradientStrokeColor(x, size) {
  const t = clamp(x / size);
  if (t < 0.52) {
    return mixColor([244, 201, 93, 1], [102, 217, 232, 1], t / 0.52);
  }
  return mixColor([102, 217, 232, 1], [82, 214, 162, 1], (t - 0.52) / 0.48);
}

function renderPixel(size, x, y) {
  const sx = (x / size) * 96;
  const sy = (y / size) * 96;

  let color = [0, 0, 0, 0];

  const outer = sdfRoundedRect(sx, sy, 48, 48, 40, 40, 24);
  const inner = sdfRoundedRect(sx, sy, 48, 48, 36.5, 36.5, 20);
  const outerMask = coverage(outer, 1.3);
  const innerMask = coverage(inner, 1.3);
  const shellMask = clamp(outerMask - innerMask, 0, 1);

  const bgBase = mixColor([5, 11, 16, 0.85], [12, 24, 34, 0.98], sy / 96);
  const glowLeft = [244, 201, 93, smoothstep(20, 0, Math.hypot(sx - 30, sy - 28)) * 0.26];
  const glowRight = [82, 214, 162, smoothstep(18, 0, Math.hypot(sx - 70, sy - 74)) * 0.18];
  const bg = over(over(bgBase, glowLeft), glowRight);
  color = over(color, [bg[0], bg[1], bg[2], outerMask * bg[3]]);

  if (shellMask > 0) {
    const shell = gradientStrokeColor(sx, 96);
    color = over(color, [shell[0], shell[1], shell[2], shellMask * 0.95]);
  }

  const hubSegments = [
    [28, 64, 28, 32, 8],
    [28, 32, 48, 50, 8],
    [48, 50, 68, 32, 8],
    [68, 32, 68, 64, 8]
  ];

  for (const [ax, ay, bx, by, width] of hubSegments) {
    const d = sdfSegment(sx, sy, ax, ay, bx, by) - width / 2;
    const alpha = coverage(d, 1.35);
    if (alpha > 0) {
      const stroke = gradientStrokeColor((ax + bx) / 2, 96);
      color = over(color, [stroke[0], stroke[1], stroke[2], alpha]);
    }
  }

  const orb = coverage(sdfCircle(sx, sy, 48, 48, 8), 1.2);
  if (orb > 0) {
    const orbColor = mixColor([254, 241, 191, 1], [102, 217, 232, 1], 0.72);
    color = over(color, [orbColor[0], orbColor[1], orbColor[2], orb]);
  }

  const beamSegments = [
    [48, 24, 48, 40, 5],
    [24, 48, 40, 48, 5],
    [56, 48, 72, 48, 5],
    [48, 56, 48, 72, 5]
  ];

  for (const [ax, ay, bx, by, width] of beamSegments) {
    const d = sdfSegment(sx, sy, ax, ay, bx, by) - width / 2;
    const alpha = coverage(d, 1.1);
    if (alpha > 0) {
      color = over(color, [254, 241, 191, alpha * 0.9]);
    }
  }

  return color.map((channel, index) => index === 3 ? Math.round(clamp(channel) * 255) : Math.round(clamp(channel / 255) * 255));
}

function createPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = renderPixel(size, x + 0.5, y + 0.5);
      const offset = (y * size + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }

  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    createChunk("IHDR", ihdr),
    createChunk("IDAT", zlib.deflateSync(scanlines)),
    createChunk("IEND", Buffer.alloc(0))
  ]);

  return png;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  const payloads = [];

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.buffer.length;
    entries.push(entry);
    payloads.push(image.buffer);
  }

  return Buffer.concat([header, ...entries, ...payloads]);
}

function createSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hubShell" x1="8%" y1="10%" x2="88%" y2="90%">
      <stop offset="0%" stop-color="#f4c95d"/>
      <stop offset="52%" stop-color="#66d9e8"/>
      <stop offset="100%" stop-color="#52d6a2"/>
    </linearGradient>
    <linearGradient id="hubBeam" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef1bf"/>
      <stop offset="100%" stop-color="#66d9e8"/>
    </linearGradient>
    <radialGradient id="hubGlowLeft" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(30 28) rotate(90) scale(20)">
      <stop stop-color="#f4c95d" stop-opacity=".28"/>
      <stop offset="1" stop-color="#f4c95d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="hubGlowRight" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(70 74) rotate(90) scale(18)">
      <stop stop-color="#52d6a2" stop-opacity=".22"/>
      <stop offset="1" stop-color="#52d6a2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="8" y="8" width="80" height="80" rx="24" fill="#071118"/>
  <rect x="8" y="8" width="80" height="80" rx="24" fill="url(#hubGlowLeft)"/>
  <rect x="8" y="8" width="80" height="80" rx="24" fill="url(#hubGlowRight)"/>
  <rect x="8" y="8" width="80" height="80" rx="24" stroke="url(#hubShell)" stroke-width="3"/>
  <path d="M28 64V32L48 50L68 32V64" stroke="url(#hubShell)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="48" cy="48" r="8" fill="url(#hubBeam)"/>
  <path d="M48 24V40M24 48H40M56 48H72M48 56V72" stroke="url(#hubBeam)" stroke-width="5" stroke-linecap="round"/>
</svg>
`;
}

const pngImages = sizes.map((size) => {
  const buffer = createPng(size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buffer);
  return { size, buffer };
});

fs.writeFileSync(path.join(outDir, "tray-icon.png"), createPng(32));
fs.writeFileSync(path.join(outDir, "icon.ico"), createIco(pngImages.filter((image) => [16, 24, 32, 48, 64, 128, 256].includes(image.size))));
fs.writeFileSync(path.join(outDir, "icon.svg"), createSvg(), "utf8");

console.log(`Generated brand assets in ${outDir}`);
