// Generates HopReady's icon and splash artwork from one geometry, so the Icon Composer layer (SVG)
// and the fallback PNGs can never drift apart. No dependencies: PNGs are rasterised and encoded here.
// Run from the repo root: node apps/mobile/scripts/generate-brand-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BRAND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'brand');
const CANVAS = 1024;

// A rising route joins an origin to a destination. A single broad curve stays legible at 32px.
const STROKE_WIDTH = 64;
const ORIGIN = { x: 296, y: 700, radius: 55 };
const DESTINATION = { x: 728, y: 320, radius: 76 };
const CURVE = {
  start: { x: 296, y: 580 },
  firstControl: { x: 296, y: 320 },
  secondControl: { x: 728, y: 580 },
  end: { x: 728, y: 396 },
};
const CURVE_SEGMENTS = 80;
const ROUTE = [
  ORIGIN,
  CURVE.start,
  ...Array.from({ length: CURVE_SEGMENTS + 1 }, (_, index) => {
    const t = index / CURVE_SEGMENTS;
    const u = 1 - t;
    return {
      x:
        u ** 3 * CURVE.start.x +
        3 * u ** 2 * t * CURVE.firstControl.x +
        3 * u * t ** 2 * CURVE.secondControl.x +
        t ** 3 * CURVE.end.x,
      y:
        u ** 3 * CURVE.start.y +
        3 * u ** 2 * t * CURVE.firstControl.y +
        3 * u * t ** 2 * CURVE.secondControl.y +
        t ** 3 * CURVE.end.y,
    };
  }),
];

const GRADIENT_TOP = [55, 114, 241];
const GRADIENT_BOTTOM = [28, 65, 181];
export const BRAND_COLOUR_HEX = '#2557D6';

function glyphSvg(colour = '#FFFFFF') {
  return `<svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M ${ORIGIN.x} ${ORIGIN.y} V ${CURVE.start.y} C ${CURVE.firstControl.x} ${CURVE.firstControl.y} ${CURVE.secondControl.x} ${CURVE.secondControl.y} ${CURVE.end.x} ${CURVE.end.y}" stroke="${colour}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" fill="none"/>
  <circle cx="${ORIGIN.x}" cy="${ORIGIN.y}" r="${ORIGIN.radius}" fill="${colour}"/>
  <circle cx="${DESTINATION.x}" cy="${DESTINATION.y}" r="${DESTINATION.radius}" stroke="${colour}" stroke-width="${STROKE_WIDTH}" fill="none"/>
</svg>\n`;
}

function distanceToSegment(x, y, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared));
  return Math.hypot(x - from.x - t * dx, y - from.y - t * dy);
}

function insideGlyph(x, y) {
  if (Math.hypot(x - ORIGIN.x, y - ORIGIN.y) <= ORIGIN.radius) return true;
  if (
    Math.abs(Math.hypot(x - DESTINATION.x, y - DESTINATION.y) - DESTINATION.radius) <=
    STROKE_WIDTH / 2
  )
    return true;
  for (let index = 1; index < ROUTE.length; index++) {
    if (distanceToSegment(x, y, ROUTE[index - 1], ROUTE[index]) <= STROKE_WIDTH / 2) return true;
  }
  return false;
}

// Supersampled coverage gives smooth edges without an imaging library.
const SAMPLES_PER_AXIS = 4;
function glyphCoverage(canvasX, canvasY, scale) {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES_PER_AXIS; sy++) {
    for (let sx = 0; sx < SAMPLES_PER_AXIS; sx++) {
      const x = (canvasX + (sx + 0.5) / SAMPLES_PER_AXIS) / scale;
      const y = (canvasY + (sy + 0.5) / SAMPLES_PER_AXIS) / scale;
      if (insideGlyph(x, y)) hits++;
    }
  }
  return hits / SAMPLES_PER_AXIS ** 2;
}

function gradientAt(x, y, size) {
  const t = Math.min(1, Math.max(0, (x + y) / (2 * size)));
  return GRADIENT_TOP.map((top, channel) => top + (GRADIENT_BOTTOM[channel] - top) * t);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndBody));
  return Buffer.concat([length, typeAndBody, crc]);
}

function encodePng(width, height, channels, pixelAt) {
  const rowLength = width * channels + 1;
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = pixelAt(x, y);
      for (let c = 0; c < channels; c++) raw[y * rowLength + 1 + x * channels + c] = pixel[c];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// App Store icons must be opaque, so the fallback icon bakes in the background gradient.
function opaqueIcon(size) {
  const scale = size / CANVAS;
  return encodePng(size, size, 3, (x, y) => {
    const background = gradientAt(x, y, size);
    const coverage = glyphCoverage(x, y, scale);
    return background.map((channel) => Math.round(channel + (255 - channel) * coverage));
  });
}

function transparentGlyph(size) {
  const scale = size / CANVAS;
  return encodePng(size, size, 4, (x, y) => [
    255,
    255,
    255,
    Math.round(255 * glyphCoverage(x, y, scale)),
  ]);
}

function iconComposerManifest() {
  const [red, green, blue] = BRAND_COLOUR_HEX.match(/[0-9A-F]{2}/gi).map(
    (hex) => parseInt(hex, 16) / 255,
  );
  return {
    fill: {
      'automatic-gradient': `extended-srgb:${red.toFixed(5)},${green.toFixed(5)},${blue.toFixed(5)},1.00000`,
    },
    groups: [
      {
        layers: [{ 'image-name': 'hop-mark.svg', name: 'hop-mark' }],
        shadow: { kind: 'neutral', opacity: 0.5 },
        translucency: { enabled: true, value: 0.4 },
      },
    ],
    'supported-platforms': { squares: 'shared' },
  };
}

function write(relativePath, contents) {
  const path = join(BRAND_DIR, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  process.stdout.write(`wrote ${relativePath}\n`);
}

write('hop-mark.svg', glyphSvg());
write('hopready.icon/Assets/hop-mark.svg', glyphSvg());
write('hopready.icon/icon.json', `${JSON.stringify(iconComposerManifest(), null, 2)}\n`);
write('icon-1024.png', opaqueIcon(1024));
write('splash-mark.png', transparentGlyph(512));
