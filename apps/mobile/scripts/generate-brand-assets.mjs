// Generates HopReady's icon and splash artwork from one geometry, so the Icon Composer layer (SVG)
// and the fallback PNGs can never drift apart. No dependencies: PNGs are rasterised and encoded here.
// Run from the repo root: node apps/mobile/scripts/generate-brand-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BRAND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'brand');
const CANVAS = 1024;

// The mark: an origin, a transfer and a destination on one baseline, joined by two hops.
const BASELINE_Y = 560;
const STROKE_WIDTH = 44;
const STOPS = [
  { x: 224, radius: 44 },
  { x: 560, radius: 38 },
  { x: 800, radius: 60 },
];
const HOP_HEIGHTS = [160, 110];

const GRADIENT_TOP = [14, 124, 123];
const GRADIENT_BOTTOM = [22, 75, 102];
export const BRAND_COLOUR_HEX = '#0E6F6E';

function hopArcs() {
  return HOP_HEIGHTS.map((height, index) => {
    const from = STOPS[index];
    const to = STOPS[index + 1];
    const halfChord = (to.x - from.x) / 2;
    const radius = (halfChord ** 2 + height ** 2) / (2 * height);
    return {
      fromX: from.x,
      toX: to.x,
      radius,
      centreX: from.x + halfChord,
      centreY: BASELINE_Y - height + radius,
    };
  });
}

function glyphSvg(colour = '#FFFFFF') {
  const arcs = hopArcs()
    .map(
      (arc) =>
        `<path d="M ${arc.fromX} ${BASELINE_Y} A ${arc.radius.toFixed(2)} ${arc.radius.toFixed(2)} 0 0 1 ${arc.toX} ${BASELINE_Y}" stroke="${colour}" stroke-width="${STROKE_WIDTH}" fill="none"/>`,
    )
    .join('\n  ');
  const stops = STOPS.map(
    (stop) => `<circle cx="${stop.x}" cy="${BASELINE_Y}" r="${stop.radius}" fill="${colour}"/>`,
  ).join('\n  ');
  return `<svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" fill="none" xmlns="http://www.w3.org/2000/svg">\n  ${arcs}\n  ${stops}\n</svg>\n`;
}

function insideGlyph(x, y) {
  for (const stop of STOPS) {
    if (Math.hypot(x - stop.x, y - BASELINE_Y) <= stop.radius) return true;
  }
  for (const arc of hopArcs()) {
    // Only the half above the baseline is drawn; the stops cover where each hop lands.
    if (y > BASELINE_Y) continue;
    const distanceFromCentre = Math.hypot(x - arc.centreX, y - arc.centreY);
    if (Math.abs(distanceFromCentre - arc.radius) <= STROKE_WIDTH / 2) return true;
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
