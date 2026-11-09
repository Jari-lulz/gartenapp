// Erzeugt die App-Symbole (grünes Feld mit weißem Blatt) ohne externe Pakete.
// Aufruf: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const BG = [46, 125, 50];
const LEAF = [255, 255, 255];
const VEIN = [46, 125, 50];

// Farbe an Punkt (x, y) in -1..1
function color(x, y) {
  const a = -Math.PI / 4; // Blatt schräg stellen
  const u = x * Math.cos(a) - y * Math.sin(a);
  const v = x * Math.sin(a) + y * Math.cos(a);
  const R = 0.62, d = 0.38;
  const inLeaf = u * u + (v - d) ** 2 < R * R && u * u + (v + d) ** 2 < R * R;
  if (inLeaf && Math.abs(v) < 0.025 && u > -0.42 && u < 0.38) return VEIN;
  if (inLeaf) return LEAF;
  if (Math.abs(v) < 0.035 && u <= -0.45 && u > -0.68) return LEAF; // Stiel
  return BG;
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const ss = 3; // Kantenglättung
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const x = ((px + (sx + 0.5) / ss) / size) * 2 - 1;
        const y = ((py + (sy + 0.5) / ss) / size) * 2 - 1;
        const c = color(x, y);
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(sum[i] / (ss * ss));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 Bit, RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const s of [192, 512]) writeFileSync(`icons/icon-${s}.png`, png(s));
console.log('Icons erstellt.');
