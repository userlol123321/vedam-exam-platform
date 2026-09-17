// Generates the app icon in PNG, ICO (Windows) and ICNS (macOS) formats.
// Run: node scripts/make-icons.js
// - public/icon.png (512x512, used by Linux + Electron window)
// - public/icon.ico  (Windows installer + taskbar)
// - public/icon.icns (macOS dock/app bundle)
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function crcTable() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const TABLE = crcTable();
function crc32(b) {
  let c = 0 ^ -1;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function makePng(size) {
  const R = Math.round(size * 0.19);
  const thick = Math.max(14, Math.round(size * 0.065));
  const buf = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    buf[o++] = 0;
    for (let x = 0; x < size; x++) {
      let inside = false;
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      if (x >= R && x < size - R) inside = true;
      else if (y >= R && y < size - R) inside = true;
      else if (Math.hypot(x - R, y - R) <= R) inside = true;
      else if (Math.hypot(x - (size - 1 - R), y - R) <= R) inside = true;
      else if (Math.hypot(x - R, y - (size - 1 - R)) <= R) inside = true;
      else if (Math.hypot(x - (size - 1 - R), y - (size - 1 - R)) <= R) inside = true;
      if (!inside) { buf[o++] = 0; buf[o++] = 0; buf[o++] = 0; buf[o++] = 0; continue; }

      const t = (x + y) / (2 * size);
      const r = Math.round(79 + (124 - 79) * t);
      const g = Math.round(70 + (58 - 70) * t);
      const b = Math.round(229 + (237 - 229) * t);

      const cx = x - size / 2;
      const cy = y - size / 2 + size * 0.02;
      const slope = 0.55;
      const vert = size * 0.29;
      let white = Math.abs(cx + (cy + vert) * slope) < thick || Math.abs(cx - (cy + vert) * slope) < thick;
      if (cy > vert * 0.55 && Math.abs(cx) < thick * 0.6) white = true;

      if (white) { buf[o++] = 255; buf[o++] = 255; buf[o++] = 255; buf[o++] = 255; }
      else { buf[o++] = r; buf[o++] = g; buf[o++] = b; buf[o++] = 255; }
    }
  }
  const IHDR = Buffer.alloc(13);
  IHDR.writeUInt32BE(size, 0);
  IHDR.writeUInt32BE(size, 4);
  IHDR[8] = 8; IHDR[9] = 6; IHDR[10] = 0; IHDR[11] = 0; IHDR[12] = 0;
  const IDAT = zlib.deflateSync(buf, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const hdr = Buffer.concat([len, Buffer.from(type, "ascii"), data]);
    return Buffer.concat([hdr, Buffer.from([0]) , (() => { const c = Buffer.alloc(4); c.writeUInt32BE(crc32(hdr.slice(4))); return c; })()]);
  };
  // avoid duplicate chunk closure above (len duplicated) — recompute cleanly:
  function makeChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const hdr = Buffer.concat([len, Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(hdr.slice(4)));
    return Buffer.concat([hdr, crc]);
  }
  // NOTE: the first `chunk` above is unused; build with makeChunk instead.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makeChunk("IHDR", IHDR),
    makeChunk("IDAT", IDAT),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO container: 256x256 PNG entry (Windows)
function makeIco(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;          // width 256
  entry[1] = 0;          // height 256
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12); // offset after header+entry
  return Buffer.concat([header, entry, png256]);
}

const publicDir = path.join(__dirname, "..", "public");
fs.mkdirSync(publicDir, { recursive: true });

const png512 = makePng(512);
fs.writeFileSync(path.join(publicDir, "icon.png"), png512);
console.log("icon.png (512x512)");

const png256 = makePng(256);
fs.writeFileSync(path.join(publicDir, "icon-256.png"), png256);
fs.writeFileSync(path.join(publicDir, "icon.ico"), makeIco(png256));
console.log("icon.ico (256x256)");

// ICNS via macOS iconutil
if (process.platform === "darwin") {
  const iconset = path.join(publicDir, "icon.iconset");
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  const sizes = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
  ];
  for (const [s, name] of sizes) {
    fs.writeFileSync(path.join(iconset, name), makePng(s));
  }
  fs.writeFileSync(path.join(iconset, "icon_512x512@2x.png"), makePng(1024)); // 1024
  execSync(`iconutil -c icns "${iconset}" -o "${path.join(publicDir, "icon.icns")}"`);
  fs.rmSync(iconset, { recursive: true, force: true });
  console.log("icon.icns (via iconutil)");
} else {
  console.warn("Skipping .icns (requires macOS iconutil). Mac builds should run on a Mac anyway.");
}

console.log("Done. Placeholder icons replaced with branded icon.");