#!/usr/bin/env node
/**
 * Render la-gram's icons from their SVGs: `npm run icons`, after changing
 * `src/icons/favicon.svg` or `src/icons/app-icon.svg`. Every file it writes is
 * kept in the repository, beside its SVG:
 *
 * - `favicon.ico` — 16, 32, 48 px of the favicon, for browsers that take no SVG
 *   favicon (Safari) and whatever asks for `/favicon.ico`;
 * - `app-icon.icns` — the macOS app's icon, for `npm run package`;
 * - `app-icon.ico` — the Windows app's icon, for `npm run package`;
 * - `app-icon.png` — 512 px: the window's icon on Windows and Linux, and the
 *   Dock's while the app runs unpackaged on macOS.
 *
 * The app icon is the mark on a tile (`app-icon.svg`) from 48 px up; at 32 px
 * and less, where the tile would leave the mark a few pixels, it is the bare
 * mark (`favicon.svg`). Drawn by Chrome — the system Chrome, as the browser
 * tests use, or `LA_GRAM_CHROME` — so the renderings match the SVGs.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icons = path.join(root, 'src/icons');
const svgOf = (name) => `data:image/svg+xml;base64,${readFileSync(path.join(icons, name)).toString('base64')}`;
const MARK = svgOf('favicon.svg');
const TILE = svgOf('app-icon.svg');
/** The app icon at a size: the bare mark where the tile would leave it too small. */
const appIcon = (size) => [size <= 32 ? MARK : TILE, size];

const executablePath = process.env.LA_GRAM_CHROME;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
const page = await browser.newPage();

/** PNG renderings of `[svg, size]` pairs, drawn on a transparent canvas of that size. */
async function render(pairs) {
  const urls = await page.evaluate(async (pairs) => {
    const out = [];
    for (const [svg, size] of pairs) {
      const image = new Image();
      image.src = svg;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      out.push(canvas.toDataURL('image/png'));
    }
    return out;
  }, pairs);
  return urls.map((url, i) => ({ size: pairs[i][1], png: Buffer.from(url.split(',')[1], 'base64') }));
}

/** An ICO: a 6-byte header, a 16-byte entry per frame, the frames (PNG, read since Windows Vista). */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // an icon
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length + 16 * frames.length;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0); // width; 0 is 256
    entry.writeUInt8(size % 256, 1); // height
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

/** An ICNS: "icns" and its length, then each image as its 4-character type, its length and its PNG. */
function icns(images) {
  const chunks = images.map(({ type, png }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
}

function write(name, bytes, sizes) {
  writeFileSync(path.join(icons, name), bytes);
  console.log(`src/icons/${name}: ${sizes} (${bytes.length} bytes)`);
}

try {
  const favicon = await render([16, 32, 48].map((size) => [MARK, size]));
  write('favicon.ico', ico(favicon), '16, 32, 48 px');

  const windows = await render([16, 24, 32, 48, 64, 128, 256].map(appIcon));
  write('app-icon.ico', ico(windows), windows.map((f) => f.size).join(', ') + ' px');

  // macOS's types by pixel size: 16 and 32 px for 16 pt, 32 and 64 for 32 pt,
  // then 128, 256, 512 pt, each at 1x and 2x. Sized by point: the bare mark for
  // 16 and 32 pt at both scales, as one design per point size.
  const mac = [
    ['icp4', MARK, 16], ['ic11', MARK, 32], ['icp5', MARK, 32], ['ic12', MARK, 64],
    ['ic07', TILE, 128], ['ic13', TILE, 256], ['ic08', TILE, 256], ['ic14', TILE, 512],
    ['ic09', TILE, 512], ['ic10', TILE, 1024],
  ];
  const macImages = await render(mac.map(([, svg, size]) => [svg, size]));
  write('app-icon.icns', icns(macImages.map((image, i) => ({ type: mac[i][0], png: image.png }))), '16–1024 px');

  const [png] = await render([[TILE, 512]]);
  write('app-icon.png', png.png, '512 px');
} finally {
  await browser.close();
}
