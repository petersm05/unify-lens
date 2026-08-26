/**
 * Renders the brand mark to PNG at the sizes iOS and the manifest need.
 *
 * Written by hand rather than pulled from a rasteriser: the mark is four
 * primitives, and a build step nobody can run without installing ImageMagick
 * is a build step that rots. Node's zlib is the only dependency.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand');

// Palette, matching app.css.
const CREAM = [0xfa, 0xf5, 0xea];
const TEAL = [0x25, 0x67, 0x60];
const TERRACOTTA = [0xb4, 0x5c, 0x3c];

/** Geometry in the mark's own 512-unit space. */
const U = 512;
const RING_OUTER = 182;
const RING_INNER = 118;
const DOT = 44;
const CORNER = 112;
/** The lifted segment, clockwise from twelve o'clock. */
const SEGMENT = [-Math.PI / 2, -Math.PI / 2 + Math.PI / 3];
/** Samples per axis; 4 means 16 samples a pixel, which is plenty for flat art. */
const SS = 4;

function colourAt(x, y, { maskable }) {
  const inset = maskable ? U * 0.11 : 0;
  const scale = maskable ? 0.78 : 1;

  // Background: a rounded square, or a full bleed when the platform masks it.
  if (!maskable) {
    const dx = Math.max(CORNER - x, x - (U - CORNER), 0);
    const dy = Math.max(CORNER - y, y - (U - CORNER), 0);
    if (Math.hypot(dx, dy) > CORNER) return null;
  }
  void inset;

  const cx = (x - U / 2) / scale;
  const cy = (y - U / 2) / scale;
  const r = Math.hypot(cx, cy);

  if (r <= DOT) return TEAL;
  if (r >= RING_INNER && r <= RING_OUTER) {
    // atan2 gives -pi..pi with 0 at three o'clock, which is the same frame the
    // segment is expressed in.
    const angle = Math.atan2(cy, cx);
    const inSegment = angle >= SEGMENT[0] && angle <= SEGMENT[1];
    return inSegment ? TERRACOTTA : TEAL;
  }
  return CREAM;
}

function render(size, options) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = U / size;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) * step;
          const y = (py + (sy + 0.5) / SS) * step;
          const colour = colourAt(x, y, options);
          if (colour) {
            r += colour[0];
            g += colour[1];
            b += colour[2];
            a += 255;
          }
        }
      }

      const samples = SS * SS;
      const offset = (py * size + px) * 4;
      // Weight colour by coverage so the rounded corners antialias rather than
      // fading to black.
      const covered = a / 255;
      pixels[offset] = covered ? Math.round(r / covered) : 0;
      pixels[offset + 1] = covered ? Math.round(g / covered) : 0;
      pixels[offset + 2] = covered ? Math.round(b / covered) : 0;
      pixels[offset + 3] = Math.round(a / samples);
    }
  }

  return pixels;
}

// ── PNG encoding ─────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_unused, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha

  // Every scanline carries a leading filter byte; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── outputs ──────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon-32.png', 32, {}],
];

for (const [name, size, options] of targets) {
  const file = join(OUT, name);
  writeFileSync(file, png(size, render(size, options)));
  console.log(`${name} ${size}×${size}`);
}
