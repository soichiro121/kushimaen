/**
 * Generates the site icons in `public/`.
 *
 *   npm run assets:icons
 *
 * WHY A GENERATOR RATHER THAN CHECKED-IN BINARIES
 *   Same reason as the rest of the art: the mark is a miniature of the title logo,
 *   and both read their colours from `lib/brand.mjs`, so a palette change cannot
 *   leave the tab icon behind. It is also the only way to keep the letterform crisp
 *   at every size - see the note on `glyphScale` below.
 *
 * WHAT IT MAKES
 *   favicon.svg          browsers that support it - sharp at any zoom
 *   favicon-32.png       fallback for those that do not
 *   apple-touch-icon.png iOS home screen (this game is meant to be added there)
 *   icon-192/512.png     Android home screen, via site.webmanifest
 *   site.webmanifest     name, colours and the icon list
 *
 * BUILD-TIME TOOL. It never runs in the browser or on the server.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, hex } from './lib/raster.mjs';
import { glyphCells, GLYPH_HEIGHT, GLYPH_WIDTH } from './lib/font.mjs';
import { BRAND } from './lib/brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public');

/**
 * The mark, on a 32-unit grid: a paper "K" on navy over the logo's accent bar.
 *
 * One letter, not "KR". At the 16px a browser tab actually renders, the 5x7 letter
 * cells are already about two screen pixels each; a second letter halves that and
 * the whole thing turns to mush.
 */
const GRID = 32;
const LETTER = 'K';
const LETTER_TOP = 4; // in grid units, before scaling
const BAR_GAP = 1;
const BAR_HEIGHT = 2;

/** Where the letter and bar sit for a given icon size, in pixels. */
function layout(size) {
  const unit = size / GRID;

  // INTEGER on purpose. A 5x7 letter scaled by 5.625 renders some cells 5px wide and
  // others 6px, and the wobble is plainly visible on an icon. Flooring keeps every
  // cell square and identical; the leftover fraction goes into the margins, where
  // nobody can see it.
  const glyphScale = Math.max(1, Math.floor(unit * 3));

  const letterWidth = GLYPH_WIDTH * glyphScale;
  const letterHeight = GLYPH_HEIGHT * glyphScale;
  const barHeight = Math.max(1, Math.round(unit * BAR_HEIGHT));
  const blockHeight = letterHeight + Math.round(unit * BAR_GAP) + barHeight;

  const left = Math.round((size - letterWidth) / 2);
  const top = Math.round(Math.min((size - blockHeight) / 2, unit * LETTER_TOP));

  return {
    unit,
    glyphScale,
    left,
    top,
    letterWidth,
    letterHeight,
    barY: top + letterHeight + Math.round(unit * BAR_GAP),
    barHeight,
  };
}

/**
 * @param size   pixel size of the square
 * @param rounded  false for the iOS icon, which Apple masks itself - rounding it
 *                 here would show as a dark fringe inside their rounded corners
 */
function iconCanvas(size, rounded) {
  const canvas = new Canvas(size, size);
  const navy = hex(BRAND.navy);

  if (rounded) canvas.roundRect(0, 0, size, size, Math.round(size * 0.22), navy);
  else canvas.rect(0, 0, size, size, navy);

  const { glyphScale, left, top, letterWidth, barY, barHeight } = layout(size);

  const paper = hex(BRAND.paper);
  const cells = glyphCells(LETTER);
  for (let row = 0; row < cells.length; row++) {
    for (let column = 0; column < cells[row].length; column++) {
      if (!cells[row][column]) continue;
      canvas.rect(
        left + column * glyphScale,
        top + row * glyphScale,
        glyphScale,
        glyphScale,
        paper,
      );
    }
  }

  canvas.rect(left, barY, letterWidth, barHeight, hex(BRAND.accent));
  return canvas;
}

/** The same mark as SVG, so it stays sharp at any size and weighs almost nothing. */
function iconSvg() {
  const { glyphScale, left, top, letterWidth, barY, barHeight } = layout(GRID);
  const cells = glyphCells(LETTER);

  const rects = [];
  for (let row = 0; row < cells.length; row++) {
    for (let column = 0; column < cells[row].length; column++) {
      if (!cells[row][column]) continue;
      rects.push(
        `<rect x="${left + column * glyphScale}" y="${top + row * glyphScale}" ` +
          `width="${glyphScale}" height="${glyphScale}" fill="${BRAND.paper}"/>`,
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" role="img" aria-label="KOMATO RUSH">`,
    `  <rect width="${GRID}" height="${GRID}" rx="7" fill="${BRAND.navy}"/>`,
    ...rects.map((rect) => `  ${rect}`),
    `  <rect x="${left}" y="${barY}" width="${letterWidth}" height="${barHeight}" fill="${BRAND.accent}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

const manifest = {
  name: 'KOMATO RUSH',
  short_name: 'KOMATO',
  description: '駒場東邦をモチーフにしたスマホ向けミニゲーム集',
  lang: 'ja',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#10141c',
  theme_color: '#10141c',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    // `maskable` lets Android crop to its own shape without clipping the letter -
    // the 22% corner radius already keeps the mark inside the safe zone.
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const files = [
  ['favicon.svg', Buffer.from(iconSvg(), 'utf8')],
  ['favicon-32.png', iconCanvas(32, true).toPNG()],
  ['apple-touch-icon.png', iconCanvas(180, false).toPNG()],
  ['icon-192.png', iconCanvas(192, true).toPNG()],
  ['icon-512.png', iconCanvas(512, true).toPNG()],
  ['site.webmanifest', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')],
];

for (const [name, buffer] of files) {
  writeFileSync(join(OUT, name), buffer);
  console.info(`[icons] ${name.padEnd(22)} ${String(buffer.length).padStart(6)} bytes`);
}
console.info(`[icons] wrote ${files.length} files to public/`);
