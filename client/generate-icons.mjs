/**
 * Run once to generate PNG placeholder icons:
 *   node generate-icons.mjs
 *
 * Produces: public/icon-192.png and public/icon-512.png
 * Both are solid #0a0f1c (10,15,28) placeholders.
 * Replace with real branded PNGs before production.
 */
import { writeFileSync } from 'fs';
import { deflateSync, crc32 } from 'zlib';

function makePng(width, height, r, g, b) {
  // Each scanline: filter-byte (0=None) followed by RGB pixels
  const scanline = Buffer.alloc(1 + width * 3);
  scanline[0] = 0;
  for (let x = 0; x < width; x++) {
    scanline[1 + x * 3]     = r;
    scanline[1 + x * 3 + 1] = g;
    scanline[1 + x * 3 + 2] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => scanline));
  const compressed = deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBytes, data]);
    const len  = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  const sig  = Buffer.from('\x89PNG\r\n\x1a\n', 'binary');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 2; // colour type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// #0a0f1c
const [r, g, b] = [10, 15, 28];
writeFileSync('public/icon-192.png', makePng(192, 192, r, g, b));
writeFileSync('public/icon-512.png', makePng(512, 512, r, g, b));
console.log('Generated public/icon-192.png and public/icon-512.png');
