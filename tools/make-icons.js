// Малює іконки програми без жодних додаткових програм: node tools/make-icons.js
//
// Іконка — темне тло й кільце-«бюджет»: сіра доріжка і синя дуга, що показує,
// скільки часу ще лишилось. Однакова геометрія йде і в SVG, і в PNG.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'icons');
const BG = '#0d0d0d'; // тло (як у програмі)
const TRACK = '#2a2a28'; // доріжка кільця
const ARC = '#3987e5'; // дуга — синій акцент програми
const SWEEP = 245; // довжина дуги в градусах, від 12 години за годинниковою стрілкою

// Розміри задано для полотна 512×512 і масштабуються.
// Для «maskable» кільце менше: Android може обрізати іконку колом чи «краплею».
const NORMAL = { radius: 156, stroke: 52 };
const MASKABLE = { radius: 120, stroke: 40 };

function hex(color) {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

// Точка на колі: кут у градусах від 12 години за годинниковою стрілкою
function pointAt(angle, radius) {
  const rad = (angle * Math.PI) / 180;
  return [256 + radius * Math.sin(rad), 256 - radius * Math.cos(rad)];
}

// Колір у точці (x, y) полотна 512×512
function shade(x, y, { radius, stroke }) {
  const half = stroke / 2;
  const dx = x - 256;
  const dy = y - 256;
  const inRing = Math.abs(Math.hypot(dx, dy) - radius) <= half;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const [sx, sy] = pointAt(0, radius);
  const [ex, ey] = pointAt(SWEEP, radius);
  const inCap = Math.hypot(x - sx, y - sy) <= half || Math.hypot(x - ex, y - ey) <= half;
  if ((inRing && angle <= SWEEP) || inCap) return ARC;
  if (inRing) return TRACK;
  return BG;
}

// Растр size×size: кожен піксель — середнє з 16 точок (згладжені краї)
function render(size, ring) {
  const scale = size / 512;
  const pixels = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const color = hex(shade((x + (i + 0.5) / N) / scale, (y + (j + 0.5) / N) / scale, ring));
          sum[0] += color[0];
          sum[1] += color[1];
          sum[2] += color[2];
        }
      }
      const at = (y * size + x) * 4;
      pixels[at] = Math.round(sum[0] / (N * N));
      pixels[at + 1] = Math.round(sum[1] / (N * N));
      pixels[at + 2] = Math.round(sum[2] / (N * N));
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

// ---------- Найпростіший запис PNG ----------

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

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 біт на канал
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // без фільтра
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- SVG (для вкладки браузера) ----------

function svg({ radius, stroke }) {
  const [sx, sy] = pointAt(0, radius).map((v) => +v.toFixed(2));
  const [ex, ey] = pointAt(SWEEP, radius).map((v) => +v.toFixed(2));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${BG}"/>
  <circle cx="256" cy="256" r="${radius}" fill="none" stroke="${TRACK}" stroke-width="${stroke}"/>
  <path d="M${sx} ${sy} A${radius} ${radius} 0 ${SWEEP > 180 ? 1 : 0} 1 ${ex} ${ey}" fill="none" stroke="${ARC}" stroke-width="${stroke}" stroke-linecap="round"/>
</svg>
`;
}

const files = [
  ['icon-192.png', () => png(192, render(192, NORMAL))],
  ['icon-512.png', () => png(512, render(512, NORMAL))],
  ['icon-maskable-512.png', () => png(512, render(512, MASKABLE))],
  ['apple-touch-icon.png', () => png(180, render(180, NORMAL))],
  ['icon.svg', () => svg(NORMAL)],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, make] of files) {
  fs.writeFileSync(path.join(OUT, name), make());
  console.log('icons/' + name);
}
