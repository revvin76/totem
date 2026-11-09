// Tauri needs an ICO for the Windows executable. Generate it from geometry.
import { mkdirSync, writeFileSync } from "node:fs";

const directory = new URL("../src-tauri/icons/", import.meta.url);
mkdirSync(directory, { recursive: true });
const size = 32;
const pixels = size * size * 4;
const mask = size * size / 8;
const icon = Buffer.alloc(22 + 40 + pixels + mask);
icon.writeUInt16LE(1, 2); // ICO
icon.writeUInt16LE(1, 4); // one image
icon[6] = icon[7] = size;
icon.writeUInt16LE(1, 10);
icon.writeUInt16LE(32, 12);
icon.writeUInt32LE(icon.length - 22, 14);
icon.writeUInt32LE(22, 18);
icon.writeUInt32LE(40, 22); // DIB header
icon.writeInt32LE(size, 26);
icon.writeInt32LE(size * 2, 30); // colour + mask
icon.writeUInt16LE(1, 34);
icon.writeUInt16LE(32, 36);
icon.writeUInt32LE(pixels, 42);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const stem = x >= 13 && x <= 18 && y >= 7 && y <= 24;
    const bar = x >= 6 && x <= 25 && y >= 20 && y <= 24;
    icon.writeUInt32LE(stem || bar ? 0xff72f6ed : 0xff20122f, 62 + (y * size + x) * 4);
  }
}
writeFileSync(new URL("icon.ico", directory), icon);
