/**
 * Turns the photographs in `assets-src/` into the game's asset files.
 *
 *   npm run assets:source
 *
 * WHY THIS EXISTS RATHER THAN A FOLDER OF HAND-EDITED PNGs
 *   The originals stay in the repository untouched, and every derived file is
 *   reproducible. Re-cropping everything after a size change is one command, and a
 *   reviewer can see exactly what was done to a photo instead of taking a binary on
 *   trust.
 *
 * BACKGROUND REMOVAL
 *   A naive "make white transparent" pass punches holes through every white label on
 *   a package - and these are photographs of packaged food, so most of them have one.
 *   Instead this flood-fills inward from the border: only white that is CONNECTED to
 *   the edge of the photo is background. A white label in the middle of a wrapper is
 *   enclosed by print, so the fill never reaches it.
 *
 *   The edge is feathered rather than hard-cut: a pixel's alpha comes from how close
 *   to the background colour it is, which keeps the soft contact shadow under each
 *   product instead of leaving a jagged silhouette.
 *
 * BUILD-TIME TOOL. It never runs in the browser or on the server.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SOURCE_ASSETS } from './lib/source-assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets-src');
const OUT_DIR = join(ROOT, 'public', 'assets');

/**
 * How far below the measured background level a pixel has to be before it counts as
 * subject. Brightness is read from the MINIMUM RGB channel, so a pale cream wrapper -
 * whose blue channel is nowhere near white - is never mistaken for background.
 *
 * The background level is MEASURED per photo rather than fixed: these were shot on
 * white, but JPEG noise and lighting put the actual value anywhere from 228 to 255.
 * A single fixed threshold left one photo haloed and another eaten away.
 */
const DEFAULT_CUTOUT = { margin: 26 };

/** Sanity floor for the measured background, in case the subject covers the border. */
const MIN_BACKGROUND = 200;

/** Alpha a pixel needs before it counts towards the subject's bounding box.
 *  High on purpose: a feathered edge must not inflate the crop. */
const CONTENT_ALPHA = 160;

// ---------------------------------------------------------------------------

/**
 * Border-connected background removal.
 *
 * The cut is BINARY - a pixel is either background or it is not - and the edge is
 * softened afterwards. An earlier version ramped alpha by brightness instead, which
 * sounds gentler but left a translucent grey wash across the whole background of any
 * photo whose white was not perfectly even. None of these were.
 */
async function cutout(file, options) {
  const { margin } = { ...DEFAULT_CUTOUT, ...options };
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = width * height;
  const brightness = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const p = i * 4;
    brightness[i] = Math.min(data[p], data[p + 1], data[p + 2]);
  }

  // Measure the background from the border. The MEDIAN, not the minimum: on several
  // of these photos the wrapper runs right off the edge of the frame, and a minimum
  // would take the subject's own darkness as the background level.
  const border = [];
  for (let x = 0; x < width; x++) {
    border.push(brightness[x], brightness[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y++) {
    border.push(brightness[y * width], brightness[y * width + width - 1]);
  }
  border.sort((a, b) => a - b);
  const backgroundLevel = Math.max(MIN_BACKGROUND, border[border.length >> 1]);
  const threshold = backgroundLevel - margin;

  // Flood fill inward from every border pixel that is background-ish.
  const isBackground = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;

  const push = (index) => {
    if (isBackground[index] || brightness[index] < threshold) return;
    isBackground[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  // Bleed subject colour outwards before feathering. Without this the edge fades
  // towards the background's own white and every sprite gets a pale halo.
  bleedColour(data, isBackground, width, height, 3);

  let alpha = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) alpha[i] = isBackground[i] ? 0 : 255;
  alpha = softenEdges(alpha, width, height, 2);

  for (let i = 0; i < pixels; i++) data[i * 4 + 3] = Math.round(alpha[i]);

  return { data, width, height, backgroundLevel, threshold };
}

/** Repeatedly paints background pixels with the average colour of their subject
 *  neighbours, so a feathered edge blends into the subject rather than into white. */
function bleedColour(data, isBackground, width, height, passes) {
  let frontier = Uint8Array.from(isBackground);

  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(frontier);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (!frontier[index]) continue;

        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const n = ny * width + nx;
            if (frontier[n]) continue;
            r += data[n * 4];
            g += data[n * 4 + 1];
            b += data[n * 4 + 2];
            count++;
          }
        }
        if (count === 0) continue;
        data[index * 4] = r / count;
        data[index * 4 + 1] = g / count;
        data[index * 4 + 2] = b / count;
        next[index] = 0;
      }
    }
    frontier = next;
  }
}

/** A couple of 3x3 box blurs on the alpha channel - just enough to take the stair
 *  steps off a hard cut without smearing the silhouette. */
function softenEdges(alpha, width, height, passes) {
  let current = alpha;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let total = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            total += current[ny * width + nx];
            count++;
          }
        }
        next[y * width + x] = total / count;
      }
    }
    current = next;
  }
  return current;
}

/** Tightest box containing anything meaningfully opaque. */
function contentBox({ data, width, height }, threshold = CONTENT_ALPHA) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) throw new Error('the cutout removed the entire image');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

/** The cut-out subject, cropped and scaled to fit a box, as a PNG buffer. */
async function fitted(cut, box, [width, height]) {
  return sharp(cut.data, { raw: { width: cut.width, height: cut.height, channels: 4 } })
    .extract(box)
    .resize(width, height, { fit: 'contain', background: transparent })
    .png()
    .toBuffer();
}

/**
 * A run cycle synthesised from ONE photograph.
 *
 * There is no second pose to interpolate towards, so this is a cut-out animation:
 * the figure bobs, sways and stretches on a sine. At the size the runner appears on
 * screen that reads as running; it is not a substitute for real frames, and the
 * manifest says so next to the asset.
 */
function motionFor(style, index, count) {
  const phase = (index / count) * Math.PI * 2;
  if (style === 'hit') {
    // Two frames: upright, then knocked sideways and compressed.
    return index === 0
      ? { dx: 0, dy: 0, scale: 1 }
      : { dx: 6, dy: 4, scale: 0.94 };
  }
  return {
    dx: Math.round(Math.sin(phase) * 3),
    dy: Math.round(-Math.abs(Math.sin(phase)) * 5),
    scale: 1 + Math.sin(phase * 2) * 0.015,
  };
}

async function buildSheet(cut, box, entry) {
  const [frameWidth, frameHeight] = entry.frame;
  // Headroom so the bob never clips at the top of a frame.
  const artWidth = frameWidth - 10;
  const artHeight = frameHeight - 14;

  const sheet = sharp({
    create: {
      width: frameWidth * entry.frames,
      height: frameHeight,
      channels: 4,
      background: transparent,
    },
  });

  const layers = [];
  for (let index = 0; index < entry.frames; index++) {
    const { dx, dy, scale } = motionFor(entry.motion, index, entry.frames);
    const width = Math.max(1, Math.round(artWidth * scale));
    const height = Math.max(1, Math.round(artHeight * scale));

    const frame = await sharp(cut.data, {
      raw: { width: cut.width, height: cut.height, channels: 4 },
    })
      .extract(box)
      .resize(width, height, { fit: 'contain', background: transparent })
      .png()
      .toBuffer();

    layers.push({
      input: frame,
      left: index * frameWidth + Math.round((frameWidth - width) / 2) + dx,
      // Feet stay on the ground: the figure is anchored to the bottom of the frame.
      top: frameHeight - height - 4 + dy,
    });
  }

  return sheet.composite(layers).png().toBuffer();
}

// ---------------------------------------------------------------------------

let written = 0;
for (const entry of SOURCE_ASSETS) {
  const cut = await cutout(join(SRC_DIR, entry.src), entry.cutout);
  const box = contentBox(cut);

  const buffer = entry.frames
    ? await buildSheet(cut, box, entry)
    : await fitted(cut, box, entry.size);

  const target = join(OUT_DIR, entry.out);
  mkdirSync(dirname(target), { recursive: true });
  await sharp(buffer).toFile(target);

  const shape = entry.frames ? `${entry.frames} x ${entry.frame.join('x')}` : entry.size.join('x');
  console.info(
    `[assets:source] ${entry.out.padEnd(30)} ${shape.padEnd(12)} ` +
      `subject ${String(box.width).padStart(4)}x${String(box.height).padStart(4)} ` +
      `of ${cut.width}x${cut.height}  bg=${cut.backgroundLevel} cut<${cut.threshold}`,
  );
  written += 1;
}

console.info(`[assets:source] wrote ${written} files from ${SRC_DIR}`);
