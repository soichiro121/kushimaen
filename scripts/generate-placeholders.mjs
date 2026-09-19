/**
 * Generates every placeholder asset in `public/assets/`.
 *
 *   npm run assets:placeholders
 *
 * WHY THIS EXISTS
 *   The placeholders are emitted in the *final* formats (PNG images, real horizontal
 *   spritesheets, real audio files) so the game exercises the exact load path the
 *   finished artwork will use. Dropping in real art is then a pure file swap.
 *
 *   Output is deterministic (seeded PRNG) so regenerating never produces a noisy diff.
 *
 * THIS IS A BUILD-TIME TOOL. It never runs in the browser or on the server.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, hex } from './lib/raster.mjs';
import { drawTextCentered } from './lib/font.mjs';
import { createBuffer, encodeWav, makeSeamless, normalize, note, renderVoice } from './lib/wav.mjs';
import { SOURCE_OUTPUTS } from './lib/source-assets.mjs';
import { BRAND } from './lib/brand.mjs';

// ---------------------------------------------------------------------------
// Deterministic randomness (so `git status` stays clean between regenerations)
// ---------------------------------------------------------------------------
let seed = 0x4b4f4d41;
Math.random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets');

let written = 0;
let skipped = 0;
function emit(relativePath, buffer) {
  // Never overwrite an asset built from a real photograph. Those are produced by
  // `npm run assets:source` and would otherwise be destroyed by a routine
  // regeneration of the placeholder art.
  if (SOURCE_OUTPUTS.has(relativePath)) {
    skipped += 1;
    return;
  }
  const target = join(OUT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  written += 1;
}

function emitPng(relativePath, canvas) {
  emit(relativePath, canvas.toPNG());
}

/** Compose N frames of equal size into one horizontal spritesheet. */
function spritesheet(relativePath, frameWidth, frameHeight, frameCount, drawFrame) {
  const sheet = new Canvas(frameWidth * frameCount, frameHeight);
  for (let i = 0; i < frameCount; i++) {
    const frame = new Canvas(frameWidth, frameHeight);
    drawFrame(frame, i, frameCount);
    sheet.drawCanvas(frame, i * frameWidth, 0);
  }
  emitPng(relativePath, sheet);
}

// ---------------------------------------------------------------------------
// Palette - a muted school-life palette, slightly comical, easy to read on a phone
// ---------------------------------------------------------------------------
const C = {
  ink: hex(BRAND.ink),
  inkSoft: hex('#3a4150'),
  paper: hex(BRAND.paper),
  skin: hex('#f3d2ae'),
  skinShade: hex('#e0b98f'),
  navy: hex(BRAND.navy),
  navyLight: hex(BRAND.navyLight),
  blazer: hex('#37456e'),
  blazerAlt: hex('#4a3a63'),
  slacks: hex('#2b3040'),
  hair: hex('#2a2320'),
  hairAlt: hex('#4a3524'),
  shirt: hex('#f7f7f2'),
  accent: hex(BRAND.accent),
  accentDeep: hex(BRAND.accentDeep),
  danger: hex('#d9483b'),
  good: hex('#43a06a'),
  asphalt: hex('#6f7278'),
  asphaltDark: hex('#5e6167'),
  wall: hex('#cfc7b6'),
  wallDark: hex('#b3aa98'),
  hedge: hex('#4e7a4a'),
  wood: hex('#b8895a'),
  woodDark: hex('#8d6540'),
  board: hex('#2f5a45'),
  sky: hex('#cfe3f0'),
};

const ALPHA = (color, a) => [color[0], color[1], color[2], a];

// ---------------------------------------------------------------------------
// Shared drawing pieces
// ---------------------------------------------------------------------------

/**
 * A simple chibi student/teacher. `phase` (0..1) drives the walk cycle so the same
 * routine renders every spritesheet frame.
 */
function drawPerson(canvas, options) {
  const {
    x = canvas.width / 2,
    baseY = canvas.height - 4,
    height = canvas.height - 8,
    phase = 0,
    hair = C.hair,
    top = C.blazer,
    bottom = C.slacks,
    skin = C.skin,
    bagColor = C.accentDeep,
    facing = 1,
    lean = 0,
    arms = 'walk',
  } = options;

  const headR = height * 0.17;
  const bodyH = height * 0.36;
  const legH = height * 0.34;
  const bob = Math.sin(phase * Math.PI * 2) * height * 0.015;

  const hipY = baseY - legH + bob;
  const shoulderY = hipY - bodyH;
  const headCy = shoulderY - headR * 0.85;
  const leanX = lean * height * 0.06;

  // legs
  const swing = Math.sin(phase * Math.PI * 2) * height * 0.11;
  const legW = height * 0.085;
  canvas.roundRect(x - legW * 1.1 + swing * 0.5, hipY, legW, legH, legW * 0.4, bottom);
  canvas.roundRect(x + legW * 0.1 - swing * 0.5, hipY, legW, legH, legW * 0.4, bottom);
  // shoes
  canvas.roundRect(
    x - legW * 1.2 + swing * 0.5,
    baseY - height * 0.045,
    legW * 1.25,
    height * 0.05,
    3,
    C.ink,
  );
  canvas.roundRect(
    x - legW * 0.05 - swing * 0.5,
    baseY - height * 0.045,
    legW * 1.25,
    height * 0.05,
    3,
    C.ink,
  );

  // torso
  const bodyW = height * 0.3;
  canvas.roundRect(x - bodyW / 2 + leanX, shoulderY, bodyW, bodyH + 2, bodyW * 0.28, top);
  // shirt / collar
  canvas.polygon(
    [
      [x - bodyW * 0.18 + leanX, shoulderY],
      [x + bodyW * 0.18 + leanX, shoulderY],
      [x + leanX, shoulderY + bodyH * 0.4],
    ],
    C.shirt,
  );

  // school bag strap
  canvas.polygon(
    [
      [x - bodyW * 0.45 + leanX, shoulderY + bodyH * 0.05],
      [x - bodyW * 0.25 + leanX, shoulderY],
      [x + bodyW * 0.5 + leanX, shoulderY + bodyH * 0.75],
      [x + bodyW * 0.3 + leanX, shoulderY + bodyH * 0.8],
    ],
    ALPHA(bagColor, 235),
  );

  // arms
  const armW = height * 0.07;
  const armSwing = arms === 'walk' ? swing * 0.8 : 0;
  if (arms === 'up') {
    canvas.roundRect(
      x - bodyW * 0.62 + leanX,
      shoulderY - bodyH * 0.35,
      armW,
      bodyH * 0.6,
      armW / 2,
      skin,
    );
    canvas.roundRect(
      x + bodyW * 0.42 + leanX,
      shoulderY - bodyH * 0.35,
      armW,
      bodyH * 0.6,
      armW / 2,
      skin,
    );
  } else {
    canvas.roundRect(
      x - bodyW * 0.6 + leanX,
      shoulderY + bodyH * 0.05 - armSwing,
      armW,
      bodyH * 0.75,
      armW / 2,
      top,
    );
    canvas.roundRect(
      x + bodyW * 0.45 + leanX,
      shoulderY + bodyH * 0.05 + armSwing,
      armW,
      bodyH * 0.75,
      armW / 2,
      top,
    );
    canvas.ellipse(
      x - bodyW * 0.6 + armW / 2 + leanX,
      shoulderY + bodyH * 0.8 - armSwing,
      armW * 0.55,
      armW * 0.55,
      skin,
    );
    canvas.ellipse(
      x + bodyW * 0.45 + armW / 2 + leanX,
      shoulderY + bodyH * 0.8 + armSwing,
      armW * 0.55,
      armW * 0.55,
      skin,
    );
  }

  // head
  canvas.ellipse(x + leanX * 1.4, headCy, headR * 0.92, headR, skin);
  // hair cap
  canvas.ellipse(x + leanX * 1.4, headCy - headR * 0.22, headR * 0.96, headR * 0.82, hair);
  canvas.rect(
    x + leanX * 1.4 - headR * 0.96,
    headCy - headR * 0.5,
    headR * 1.92,
    headR * 0.5,
    hair,
  );
  // eyes
  const eyeY = headCy + headR * 0.12;
  const eyeDx = headR * 0.34;
  canvas.ellipse(x + leanX * 1.4 - eyeDx * facing * 0.9, eyeY, headR * 0.1, headR * 0.15, C.ink);
  canvas.ellipse(x + leanX * 1.4 + eyeDx * facing * 0.55, eyeY, headR * 0.1, headR * 0.15, C.ink);

  return { headCy, headR, shoulderY, hipY };
}

/** Soft contact shadow so sprites sit on the ground instead of floating. */
function drawShadow(canvas, cx, cy, rx) {
  canvas.ellipse(cx, cy, rx, rx * 0.32, ALPHA(C.ink, 55));
}

/** Marks a canvas as placeholder art: corner ticks + caption. */
function stampPlaceholder(canvas, label, color = ALPHA(C.ink, 110)) {
  const scale = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) / 110));
  drawTextCentered(canvas, label, canvas.width / 2, canvas.height - 10 * scale, color, scale);
}

// ---------------------------------------------------------------------------
// COMMON
// ---------------------------------------------------------------------------
function buildCommon() {
  // Logo -------------------------------------------------------------------
  {
    const c = new Canvas(720, 320);
    c.roundRect(40, 60, 640, 200, 28, ALPHA(C.navy, 240));
    c.roundRect(52, 72, 616, 176, 22, ALPHA(hex('#3d4f7d'), 255));
    drawTextCentered(c, 'KOMATO', 360, 104, C.paper, 9);
    drawTextCentered(c, 'RUSH', 360, 176, C.accent, 9);
    c.rect(220, 250, 280, 6, ALPHA(C.accent, 200));
    // No placeholder caption here: this is on the title screen, in front of
    // players, not on the /dev/assets sheet. The other stamps stay.
    emitPng('common/ui-logo.png', c);
  }

  // Missing-asset fallback -------------------------------------------------
  {
    const c = new Canvas(128, 128);
    c.fill(hex('#2b2b33'));
    for (let y = 0; y < 128; y += 16) {
      for (let x = 0; x < 128; x += 16) {
        if ((x / 16 + y / 16) % 2 === 0) c.rect(x, y, 16, 16, hex('#c0397f'));
      }
    }
    drawTextCentered(c, 'NO', 64, 46, C.paper, 3);
    drawTextCentered(c, 'IMG', 64, 74, C.paper, 3);
    emitPng('common/ui-fallback.png', c);
  }

  // Particles ---------------------------------------------------------------
  {
    const c = new Canvas(24, 24);
    c.ellipse(12, 12, 8, 8, ALPHA(hex('#ffffff'), 235));
    c.ellipse(12, 12, 4.5, 4.5, hex('#ffffff'));
    emitPng('common/fx-spark.png', c);
  }
  {
    // Drawn per pixel as an ANNULUS. Filling a disc and then "clearing" the middle
    // does not work: blending a fully transparent colour is a no-op, so the result
    // would be a solid circle that covers whatever it is drawn over.
    const c = new Canvas(96, 96);
    const outer = 46;
    const inner = 34;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        const d = Math.hypot(x + 0.5 - 48, y + 0.5 - 48);
        if (d > outer || d < inner) continue;
        // Fade out towards both edges so the ring has soft borders.
        const t = (d - inner) / (outer - inner);
        const alpha = Math.sin(t * Math.PI) * 235;
        c.blend(x, y, ALPHA(hex('#ffffff'), alpha));
      }
    }
    emitPng('common/fx-ring.png', c);
  }

  // Sound effects -----------------------------------------------------------
  emit('common/se-click.wav', sfxClick());
  emit('common/se-start.wav', sfxStart());
  emit('common/se-countdown.wav', sfxCountdown());
  emit('common/se-result.wav', sfxResult());
  emit('common/se-success.wav', sfxSuccess());
  emit('common/se-error.wav', sfxError());
  emit('common/bgm-title.wav', bgmTitle());
}

// ---------------------------------------------------------------------------
// STAGE 1 - late
// ---------------------------------------------------------------------------
function buildLate() {
  // Private road: MUST tile seamlessly on the vertical axis.
  {
    const w = 720;
    const h = 1280;
    const c = new Canvas(w, h);
    // Flat fill, not a gradient: a vertical gradient would make the tile seam
    // visible every screen height once this texture scrolls.
    c.rect(0, 0, w, h, C.asphalt);

    // side walls (concrete blocks) + hedge strip
    const wallW = 96;
    c.rect(0, 0, wallW, h, C.wall);
    c.rect(w - wallW, 0, wallW, h, C.wall);
    for (let y = 0; y < h; y += 64) {
      c.rect(0, y, wallW, 3, ALPHA(C.wallDark, 180));
      c.rect(w - wallW, y, wallW, 3, ALPHA(C.wallDark, 180));
    }
    c.rect(wallW - 14, 0, 14, h, ALPHA(C.hedge, 210));
    c.rect(w - wallW, 0, 14, h, ALPHA(C.hedge, 210));

    // centre dashes: period 160 divides 1280 exactly -> seamless loop
    for (let y = 0; y < h; y += 160) {
      c.roundRect(w / 2 - 7, y + 24, 14, 92, 7, ALPHA(C.paper, 120));
    }
    // asphalt speckle
    for (let i = 0; i < 2600; i++) {
      const x = wallW + Math.random() * (w - wallW * 2);
      const y = Math.random() * h;
      c.rect(x, y, 2, 2, ALPHA(C.ink, 20 + Math.random() * 30));
    }
    // No placeholder caption here on purpose: this texture tiles vertically, so a
    // caption would repeat down the middle of the road every screen height.
    emitPng('late/bg-private-road.png', c);
  }

  // School gate -------------------------------------------------------------
  {
    const c = new Canvas(720, 420);
    // pillars
    c.roundRect(40, 80, 110, 320, 10, C.wall);
    c.roundRect(570, 80, 110, 320, 10, C.wall);
    c.roundRect(40, 60, 110, 34, 8, C.wallDark);
    c.roundRect(570, 60, 110, 34, 8, C.wallDark);
    // cross bar + bars
    c.rect(150, 96, 420, 18, C.ink);
    for (let x = 170; x < 560; x += 46) c.rect(x, 96, 10, 240, ALPHA(C.inkSoft, 235));
    c.rect(150, 320, 420, 14, C.ink);
    // name plate
    c.roundRect(200, 150, 320, 96, 10, C.paper);
    drawTextCentered(c, 'KOMATO', 360, 172, C.navy, 4);
    drawTextCentered(c, 'HIGH SCHOOL', 360, 206, C.inkSoft, 2);
    stampPlaceholder(c, 'PLACEHOLDER GATE');
    emitPng('late/bg-gate.png', c);
  }

  // Roadside prop -----------------------------------------------------------
  {
    const c = new Canvas(96, 200);
    c.roundRect(6, 40, 84, 160, 6, C.wall);
    c.rect(6, 60, 84, 4, ALPHA(C.wallDark, 200));
    c.rect(6, 120, 84, 4, ALPHA(C.wallDark, 200));
    c.ellipse(48, 36, 44, 26, C.hedge);
    c.ellipse(30, 30, 24, 18, ALPHA(hex('#5f8f58'), 230));
    emitPng('late/prop-roadside.png', c);
  }

  // Player run --------------------------------------------------------------
  spritesheet('late/player-run.png', 128, 160, 6, (c, i, n) => {
    drawShadow(c, 64, 154, 30);
    drawPerson(c, {
      x: 64,
      baseY: 152,
      height: 146,
      phase: i / n,
      top: hex('#3a4c86'),
      hair: C.hair,
      bagColor: C.accent,
      lean: 0.35,
    });
  });

  // Player hit --------------------------------------------------------------
  spritesheet('late/player-hit.png', 128, 160, 2, (c, i) => {
    drawShadow(c, 64, 154, 30);
    drawPerson(c, {
      x: 64,
      baseY: 152,
      height: 146,
      phase: 0.25,
      top: hex('#3a4c86'),
      bagColor: C.accent,
      lean: -0.5 - i * 0.2,
      arms: 'up',
    });
    // impact star
    const cx = 92;
    const cy = 44 - i * 4;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      c.polygon(
        [
          [cx + Math.cos(a) * 26, cy + Math.sin(a) * 26],
          [cx + Math.cos(a + 0.5) * 9, cy + Math.sin(a + 0.5) * 9],
          [cx + Math.cos(a - 0.5) * 9, cy + Math.sin(a - 0.5) * 9],
        ],
        ALPHA(C.danger, 220),
      );
    }
  });

  // Students ----------------------------------------------------------------
  const students = [
    { file: 'student-normal01', top: C.blazer, hair: C.hair, bag: hex('#8a5a3c'), rate: 1 },
    { file: 'student-normal02', top: C.blazerAlt, hair: C.hairAlt, bag: hex('#57708f'), rate: 1 },
    {
      file: 'student-hurry',
      top: hex('#2f5c5a'),
      hair: C.hair,
      bag: hex('#c0562f'),
      rate: 1.6,
      lean: 0.3,
    },
    {
      file: 'student-wanderer',
      top: hex('#5a4a76'),
      hair: C.hairAlt,
      bag: hex('#7a8c46'),
      rate: 1,
      wobble: true,
    },
    {
      file: 'student-swerve',
      top: hex('#7a4a4a'),
      hair: C.hair,
      bag: hex('#3f6d8a'),
      rate: 1.2,
      lean: -0.25,
    },
  ];
  for (const s of students) {
    spritesheet(`late/${s.file}.png`, 112, 150, 4, (c, i, n) => {
      drawShadow(c, 56, 144, 26);
      drawPerson(c, {
        x: 56 + (s.wobble ? Math.sin((i / n) * Math.PI * 2) * 5 : 0),
        baseY: 142,
        height: 132,
        phase: (i / n) * (s.rate ?? 1),
        top: s.top,
        hair: s.hair,
        bagColor: s.bag,
        lean: s.lean ?? 0,
        facing: -1,
      });
    });
  }

  // Groups ------------------------------------------------------------------
  {
    const c = new Canvas(200, 150);
    drawShadow(c, 56, 144, 26);
    drawShadow(c, 144, 144, 26);
    drawPerson(c, {
      x: 56,
      baseY: 142,
      height: 130,
      phase: 0.1,
      top: C.blazer,
      bagColor: hex('#8a5a3c'),
      facing: -1,
    });
    drawPerson(c, {
      x: 144,
      baseY: 142,
      height: 134,
      phase: 0.6,
      top: hex('#46567f'),
      bagColor: hex('#6b7f4a'),
      facing: -1,
    });
    emitPng('late/student-pair.png', c);
  }
  {
    const c = new Canvas(288, 150);
    const tops = [C.blazer, C.blazerAlt, hex('#3b5f52')];
    for (let i = 0; i < 3; i++) {
      const x = 52 + i * 92;
      drawShadow(c, x, 144, 26);
      drawPerson(c, {
        x,
        baseY: 142,
        height: 128 + i * 4,
        phase: 0.15 + i * 0.3,
        top: tops[i],
        bagColor: hex('#8a5a3c'),
        facing: -1,
      });
    }
    emitPng('late/student-trio.png', c);
  }

  emit('late/se-near-miss.wav', sfxNearMiss());
  emit('late/se-collision.wav', sfxCollision());
  emit('late/se-combo.wav', sfxCombo(0));
  emit('late/se-goal.wav', sfxGoal());
  emit('late/bgm-main.wav', bgmDriving());
}

// ---------------------------------------------------------------------------
// STAGE 2 - bread
// ---------------------------------------------------------------------------
function buildBread() {
  {
    const c = new Canvas(720, 1280);
    c.gradientRect(0, 0, 720, 1280, hex('#f0e2c8'), hex('#e0cfae'));
    // tiled back wall
    for (let y = 0; y < 1280; y += 80) c.rect(0, y, 720, 2, ALPHA(C.woodDark, 40));
    for (let x = 0; x < 720; x += 80) c.rect(x, 0, 2, 1280, ALPHA(C.woodDark, 30));
    // hanging sign
    c.roundRect(160, 60, 400, 130, 16, C.wood);
    c.roundRect(174, 74, 372, 102, 12, C.paper);
    drawTextCentered(c, 'HAZAWA', 360, 96, C.woodDark, 5);
    drawTextCentered(c, 'BAKERY', 360, 138, C.accentDeep, 4);
    // counter at the bottom
    c.rect(0, 1080, 720, 200, C.wood);
    c.rect(0, 1080, 720, 16, C.woodDark);
    stampPlaceholder(c, 'PLACEHOLDER SHOP', ALPHA(C.paper, 170));
    emitPng('bread/bg-shop.png', c);
  }
  {
    const c = new Canvas(640, 96);
    c.roundRect(0, 20, 640, 56, 12, C.wood);
    c.roundRect(6, 26, 628, 22, 10, ALPHA(hex('#d8a670'), 255));
    c.rect(0, 72, 640, 10, ALPHA(C.woodDark, 200));
    emitPng('bread/ui-tray.png', c);
  }
  {
    const c = new Canvas(640, 160);
    c.roundRect(0, 0, 640, 160, 24, ALPHA(C.paper, 245));
    c.roundRect(8, 8, 624, 144, 18, ALPHA(hex('#fffaf0'), 255));
    c.rect(28, 44, 8, 72, C.accent);
    emitPng('bread/ui-tag.png', c);
  }

  for (const recipe of BREAD_RECIPES) {
    const c = new Canvas(192, 192);
    drawShadow(c, 96, 152, 52);
    recipe.draw(c);
    emitPng(`bread/${recipe.file}.png`, c);
  }

  emit('bread/se-correct.wav', sfxCorrect());
  emit('bread/se-wrong.wav', sfxWrong());
  emit('bread/se-order.wav', sfxOrder());
  emit('bread/se-combo.wav', sfxCombo(2));
  emit('bread/bgm-main.wav', bgmBusy());
}

/** Each bread gets a distinct silhouette AND a distinct colour: the player must be
 *  able to tell them apart at a glance on a small screen. */
const BREAD_RECIPES = [
  {
    file: 'item-curry',
    draw: (c) => {
      c.ellipse(96, 100, 70, 44, hex('#c8813c'));
      c.ellipse(96, 92, 62, 36, hex('#d99a52'));
      for (let i = 0; i < 90; i++) {
        c.rect(36 + Math.random() * 120, 68 + Math.random() * 60, 3, 3, ALPHA(hex('#a66327'), 150));
      }
    },
  },
  {
    file: 'item-curry-hot',
    draw: (c) => {
      c.ellipse(96, 100, 70, 44, hex('#a8471f'));
      c.ellipse(96, 92, 62, 36, hex('#c25c2b'));
      for (let i = 0; i < 90; i++) {
        c.rect(36 + Math.random() * 120, 68 + Math.random() * 60, 3, 3, ALPHA(hex('#7d3214'), 160));
      }
      c.polygon(
        [
          [130, 54],
          [158, 44],
          [140, 74],
        ],
        hex('#d22f28'),
      );
    },
  },
  {
    file: 'item-melon',
    draw: (c) => {
      c.ellipse(96, 98, 64, 60, hex('#dcc77a'));
      c.ellipse(96, 92, 58, 54, hex('#ecd98f'));
      for (let i = -3; i <= 3; i++) {
        c.polygon(
          [
            [96 + i * 18 - 2, 40],
            [96 + i * 18 + 2, 40],
            [96 + i * 18 + 20, 150],
            [96 + i * 18 + 16, 150],
          ],
          ALPHA(hex('#c0a95e'), 170),
        );
        c.polygon(
          [
            [96 + i * 18 - 2, 150],
            [96 + i * 18 + 2, 150],
            [96 + i * 18 + 20, 40],
            [96 + i * 18 + 16, 40],
          ],
          ALPHA(hex('#c0a95e'), 120),
        );
      }
    },
  },
  {
    file: 'item-melon-whip',
    draw: (c) => {
      c.ellipse(96, 98, 64, 60, hex('#e3d391'));
      c.ellipse(96, 92, 58, 54, hex('#f2e5ab'));
      for (let i = -3; i <= 3; i++) {
        c.polygon(
          [
            [96 + i * 18 - 2, 40],
            [96 + i * 18 + 2, 40],
            [96 + i * 18 + 20, 150],
            [96 + i * 18 + 16, 150],
          ],
          ALPHA(hex('#cbb76d'), 150),
        );
      }
      c.roundRect(40, 120, 112, 26, 13, hex('#fdfbf4'));
    },
  },
  {
    file: 'item-an',
    draw: (c) => {
      c.ellipse(96, 100, 62, 50, hex('#a8702c'));
      c.ellipse(96, 94, 56, 44, hex('#bd8038'));
      c.ellipse(96, 78, 9, 6, hex('#f4efe2'));
      c.ellipse(84, 82, 5, 3.5, hex('#f4efe2'));
      c.ellipse(108, 82, 5, 3.5, hex('#f4efe2'));
    },
  },
  {
    file: 'item-an-uguisu',
    draw: (c) => {
      c.ellipse(96, 100, 62, 50, hex('#8d8f4a'));
      c.ellipse(96, 94, 56, 44, hex('#a5a75c'));
      c.ellipse(96, 78, 9, 6, hex('#f4efe2'));
    },
  },
  {
    file: 'item-cream',
    draw: (c) => {
      c.ellipse(96, 100, 68, 46, hex('#d6a44b'));
      c.ellipse(96, 94, 62, 40, hex('#e8b95f'));
      for (let i = 0; i < 4; i++) {
        c.roundRect(58 + i * 22, 72, 7, 50, 3, ALPHA(hex('#b1802f'), 200));
      }
    },
  },
  {
    file: 'item-croissant',
    draw: (c) => {
      const gold = hex('#dfae5c');
      c.ellipse(96, 104, 66, 34, gold);
      c.ellipse(96, 92, 52, 26, hex('#ecc275'));
      c.ellipse(40, 96, 20, 16, gold);
      c.ellipse(152, 96, 20, 16, gold);
      c.ellipse(96, 126, 60, 18, [0, 0, 0, 0]);
      for (let i = -2; i <= 2; i++)
        c.roundRect(92 + i * 20, 74, 6, 44, 3, ALPHA(hex('#b98a3d'), 160));
    },
  },
  {
    file: 'item-choco-corone',
    draw: (c) => {
      c.polygon(
        [
          [34, 108],
          [150, 70],
          [152, 120],
          [40, 128],
        ],
        hex('#d9a45c'),
      );
      for (let i = 0; i < 5; i++) {
        c.ellipse(58 + i * 22, 100 - i * 5, 16 - i * 1.4, 22 - i * 2.4, hex('#e7b871'));
        c.ellipse(58 + i * 22, 100 - i * 5, 12 - i * 1.2, 17 - i * 2, ALPHA(hex('#c08c44'), 130));
      }
      c.ellipse(148, 74, 14, 16, hex('#4b2f1e'));
    },
  },
  {
    file: 'item-choco-chip',
    draw: (c) => {
      c.ellipse(96, 98, 62, 52, hex('#cfa165'));
      c.ellipse(96, 92, 56, 46, hex('#e0b478'));
      for (let i = 0; i < 14; i++) {
        c.ellipse(52 + Math.random() * 88, 60 + Math.random() * 66, 7, 6, hex('#4b2f1e'));
      }
    },
  },
  {
    file: 'item-yakisoba',
    draw: (c) => {
      c.roundRect(20, 74, 152, 58, 28, hex('#dcae6e'));
      c.roundRect(28, 80, 136, 22, 11, hex('#eec489'));
      for (let i = 0; i < 12; i++) {
        c.roundRect(34 + i * 11, 92 + Math.random() * 12, 10, 6, 3, hex('#8a5b2a'));
      }
      c.ellipse(112, 96, 12, 6, hex('#cc4a44'));
    },
  },
  {
    file: 'item-koppe',
    draw: (c) => {
      c.roundRect(18, 72, 156, 58, 28, hex('#d9ad72'));
      c.roundRect(26, 78, 140, 30, 15, hex('#ecc490'));
    },
  },
  {
    file: 'item-katsu-sand',
    draw: (c) => {
      c.polygon(
        [
          [36, 148],
          [96, 40],
          [156, 148],
        ],
        hex('#f5ead3'),
      );
      c.polygon(
        [
          [54, 122],
          [96, 66],
          [138, 122],
        ],
        hex('#b4702c'),
      );
      c.polygon(
        [
          [62, 112],
          [96, 80],
          [130, 112],
        ],
        hex('#cf8a3d'),
      );
    },
  },
  {
    file: 'item-tamago-sand',
    draw: (c) => {
      c.polygon(
        [
          [36, 148],
          [96, 40],
          [156, 148],
        ],
        hex('#f7efdd'),
      );
      c.polygon(
        [
          [54, 122],
          [96, 66],
          [138, 122],
        ],
        hex('#f0cf5a'),
      );
      c.polygon(
        [
          [64, 112],
          [96, 82],
          [128, 112],
        ],
        hex('#fae38a'),
      );
    },
  },
  {
    file: 'item-ham-cheese',
    draw: (c) => {
      c.polygon(
        [
          [36, 148],
          [96, 40],
          [156, 148],
        ],
        hex('#f5ead3'),
      );
      c.polygon(
        [
          [54, 126],
          [96, 70],
          [138, 126],
        ],
        hex('#e58f9a'),
      );
      c.polygon(
        [
          [58, 112],
          [96, 86],
          [134, 112],
        ],
        hex('#f2c94c'),
      );
    },
  },
  {
    file: 'item-pizza',
    draw: (c) => {
      c.ellipse(96, 100, 66, 50, hex('#d3a35f'));
      c.ellipse(96, 98, 56, 42, hex('#c9482f'));
      c.ellipse(96, 96, 50, 36, hex('#eab945'));
      for (let i = 0; i < 6; i++) {
        c.ellipse(64 + Math.random() * 64, 76 + Math.random() * 40, 8, 5, hex('#4b7a3a'));
      }
    },
  },
  {
    file: 'item-sugar-twist',
    draw: (c) => {
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        c.ellipse(44 + t * 104, 100 + Math.sin(t * Math.PI * 2) * 26, 20, 17, hex('#dfb471'));
        c.ellipse(44 + t * 104, 100 - Math.sin(t * Math.PI * 2) * 26, 20, 17, hex('#e9c68b'));
      }
      for (let i = 0; i < 28; i++) {
        c.rect(40 + Math.random() * 112, 66 + Math.random() * 68, 3, 3, ALPHA(hex('#ffffff'), 210));
      }
    },
  },
  {
    file: 'item-milk-france',
    draw: (c) => {
      c.roundRect(14, 78, 164, 48, 24, hex('#cf9f5f'));
      c.roundRect(22, 84, 148, 20, 10, hex('#e2b578'));
      for (let i = 0; i < 4; i++) {
        c.polygon(
          [
            [44 + i * 30, 84],
            [58 + i * 30, 84],
            [50 + i * 30, 116],
            [36 + i * 30, 116],
          ],
          ALPHA(hex('#a87c3e'), 170),
        );
      }
      c.roundRect(24, 112, 144, 12, 6, hex('#fdfaf2'));
    },
  },
];

// ---------------------------------------------------------------------------
// STAGE 3 - 放課後ステルス (top-down)
//
// Everything here is drawn from directly above. Floors and the wall are TILES, so
// they are built to wrap seamlessly on both axes - a tile with a seam is instantly
// obvious once it is stretched across a 2400x3160 map.
// ---------------------------------------------------------------------------

/** A seamless floor tile: flat base, wrapping grout lines, a little speckle. */
function floorTile(size, base, line, speckle, grid) {
  const c = new Canvas(size, size);
  c.fill(base);
  for (let i = 0; i < size; i += grid) {
    c.rect(i, 0, 2, size, line);
    c.rect(0, i, size, 2, line);
  }
  // Deterministic speckle (Math.random is seeded at the top of this file).
  for (let i = 0; i < size * 1.2; i++) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    c.rect(x, y, 2, 2, speckle);
  }
  return c;
}

/**
 * A top-down character: body disc, shoulders that swing with the walk cycle, and a
 * nose wedge pointing +X so the facing direction stays readable once the sprite is
 * rotated in game.
 */
function drawTopDownPerson(c, options) {
  const { cx, cy, radius, body, head, accent, step = 0 } = options;
  c.ellipse(cx, cy, radius * 1.02, radius * 1.02, ALPHA(C.ink, 45));

  const swing = Math.sin(step * Math.PI * 2) * radius * 0.22;
  c.ellipse(cx - radius * 0.15, cy - radius * 0.62 + swing, radius * 0.3, radius * 0.3, body);
  c.ellipse(cx - radius * 0.15, cy + radius * 0.62 - swing, radius * 0.3, radius * 0.3, body);

  c.ellipse(cx, cy, radius * 0.86, radius * 0.86, body);
  c.ellipse(cx, cy, radius * 0.56, radius * 0.56, head);
  c.polygon(
    [
      [cx + radius * 0.4, cy - radius * 0.26],
      [cx + radius * 1.02, cy],
      [cx + radius * 0.4, cy + radius * 0.26],
    ],
    accent,
  );
}

function buildTeacher() {
  // -- map tiles (seamless) --------------------------------------------------
  emitPng(
    'teacher/map-floor-corridor.png',
    floorTile(128, hex('#d9d2c2'), ALPHA(hex('#b6ad99'), 120), ALPHA(hex('#b6ad99'), 60), 32),
  );
  emitPng(
    'teacher/map-floor-classroom.png',
    floorTile(128, hex('#c9a985'), ALPHA(hex('#a9855e'), 130), ALPHA(hex('#a9855e'), 70), 64),
  );
  emitPng(
    'teacher/map-floor-room.png',
    floorTile(128, hex('#b9c4c0'), ALPHA(hex('#93a19c'), 120), ALPHA(hex('#93a19c'), 60), 42),
  );
  {
    // Stairs read as banded treads rather than a grid, and still wrap.
    const c = new Canvas(128, 128);
    c.fill(hex('#c2c6cf'));
    for (let y = 0; y < 128; y += 16) {
      c.rect(0, y, 128, 11, hex('#adb2bd'));
      c.rect(0, y + 11, 128, 3, ALPHA(C.ink, 60));
    }
    emitPng('teacher/map-floor-stairs.png', c);
  }
  emitPng(
    'teacher/map-floor-lobby.png',
    floorTile(128, hex('#cdd7c4'), ALPHA(hex('#a3b099'), 130), ALPHA(hex('#a3b099'), 70), 32),
  );
  {
    // The wall must read as "solid, cannot pass, cannot be seen through" at a glance.
    const c = new Canvas(64, 64);
    c.fill(hex('#464d5c'));
    for (let y = 0; y < 64; y += 16) {
      const offset = (y / 16) % 2 === 0 ? 0 : 16;
      for (let x = -16; x < 64; x += 32) {
        c.rect(x + offset + 1, y + 1, 30, 14, hex('#525a6c'));
      }
    }
    emitPng('teacher/map-wall.png', c);
  }

  // -- player ---------------------------------------------------------------
  spritesheet('teacher/player-idle.png', 64, 64, 2, (c, i) => {
    drawTopDownPerson(c, {
      cx: 32,
      cy: 32,
      radius: 24 + i * 0.6,
      body: C.navy,
      head: C.skin,
      accent: C.accent,
      step: 0,
    });
  });
  spritesheet('teacher/player-walk.png', 64, 64, 4, (c, i, n) => {
    drawTopDownPerson(c, {
      cx: 32,
      cy: 32,
      radius: 24,
      body: C.navy,
      head: C.skin,
      accent: C.accent,
      step: i / n,
    });
  });

  // -- teachers -------------------------------------------------------------
  spritesheet('teacher/npc-walk.png', 72, 72, 4, (c, i, n) => {
    drawTopDownPerson(c, {
      cx: 36,
      cy: 36,
      radius: 28,
      body: hex('#4a4f5b'),
      head: C.skinShade,
      accent: hex('#e9e4d8'),
      step: i / n,
    });
  });
  {
    const c = new Canvas(72, 72);
    drawTopDownPerson(c, {
      cx: 36,
      cy: 36,
      radius: 28,
      body: hex('#4a4f5b'),
      head: C.skinShade,
      accent: hex('#e9e4d8'),
      step: 0,
    });
    // A collar ring, so a standing teacher reads differently from a walking one.
    c.ellipse(36, 36, 31, 31, ALPHA(hex('#e9e4d8'), 70));
    c.ellipse(36, 36, 27, 27, ALPHA(hex('#4a4f5b'), 255));
    c.ellipse(36, 36, 16, 16, C.skinShade);
    emitPng('teacher/npc-wait.png', c);
  }
  {
    const c = new Canvas(72, 72);
    drawTopDownPerson(c, {
      cx: 36,
      cy: 36,
      radius: 28,
      body: hex('#7a4a4a'),
      head: C.skinShade,
      accent: C.danger,
      step: 0,
    });
    emitPng('teacher/npc-alert.png', c);
  }

  // -- objectives and feedback ----------------------------------------------
  {
    const c = new Canvas(72, 72);
    c.ellipse(36, 36, 32, 32, ALPHA(C.accent, 70));
    c.ellipse(36, 36, 23, 23, ALPHA(C.accent, 150));
    c.ellipse(36, 36, 13, 13, hex('#fff0cf'));
    emitPng('teacher/objective-marker.png', c);
  }
  {
    const c = new Canvas(72, 72);
    c.ellipse(36, 36, 32, 32, ALPHA(C.good, 80));
    c.ellipse(36, 36, 23, 23, ALPHA(C.good, 170));
    drawTextCentered(c, 'EXIT', 36, 29, hex('#ffffff'), 2);
    emitPng('teacher/objective-exit.png', c);
  }
  {
    const c = new Canvas(48, 48);
    c.ellipse(24, 24, 22, 22, ALPHA(C.danger, 200));
    c.rect(21, 10, 6, 19, hex('#ffffff'));
    c.rect(21, 32, 6, 6, hex('#ffffff'));
    emitPng('teacher/fx-alert.png', c);
  }

  emit('teacher/se-footstep.wav', sfxSoftStep());
  emit('teacher/se-teacher-footstep.wav', sfxFootstep());
  emit('teacher/se-door.wav', sfxDoorOpen());
  emit('teacher/se-detect.wav', sfxDetect());
  emit('teacher/se-caught.wav', sfxCaught());
  emit('teacher/se-checkpoint.wav', sfxCheckpoint());
  emit('teacher/se-clear.wav', sfxStealthClear());
  emit('teacher/bgm-main.wav', bgmTense());
}

// ---------------------------------------------------------------------------
// Audio recipes
// ---------------------------------------------------------------------------
function sfxClick() {
  const b = createBuffer(0.09);
  renderVoice(b, {
    duration: 0.07,
    freq: 1500,
    freqEnd: 900,
    wave: 'square',
    gain: 0.22,
    release: 0.9,
  });
  return encodeWav(normalize(b, 0.6));
}
function sfxStart() {
  const b = createBuffer(0.55);
  [0, 4, 7, 12].forEach((semi, i) => {
    renderVoice(b, {
      start: i * 0.08,
      duration: 0.3,
      freq: note(semi),
      wave: 'triangle',
      gain: 0.26,
    });
  });
  return encodeWav(normalize(b, 0.8));
}
function sfxCountdown() {
  const b = createBuffer(0.22);
  renderVoice(b, { duration: 0.18, freq: 660, wave: 'square', gain: 0.2, release: 0.8 });
  return encodeWav(normalize(b, 0.7));
}
function sfxResult() {
  const b = createBuffer(0.8);
  [0, 4, 7, 12, 16].forEach((semi, i) => {
    renderVoice(b, {
      start: i * 0.09,
      duration: 0.45,
      freq: note(semi + 7),
      wave: 'sine',
      gain: 0.22,
    });
  });
  return encodeWav(normalize(b, 0.85));
}
function sfxSuccess() {
  const b = createBuffer(0.38);
  renderVoice(b, { duration: 0.12, freq: note(7), wave: 'triangle', gain: 0.3 });
  renderVoice(b, { start: 0.1, duration: 0.26, freq: note(14), wave: 'triangle', gain: 0.3 });
  return encodeWav(normalize(b, 0.8));
}
function sfxError() {
  const b = createBuffer(0.34);
  renderVoice(b, {
    duration: 0.3,
    freq: 220,
    freqEnd: 110,
    wave: 'square',
    gain: 0.24,
    release: 0.7,
  });
  return encodeWav(normalize(b, 0.7));
}
function sfxNearMiss() {
  const b = createBuffer(0.28);
  renderVoice(b, {
    duration: 0.26,
    freq: 300,
    freqEnd: 2400,
    wave: 'noise',
    gain: 0.16,
    attack: 0.02,
    release: 0.8,
  });
  renderVoice(b, { duration: 0.2, freq: 900, freqEnd: 1800, wave: 'sine', gain: 0.14 });
  return encodeWav(normalize(b, 0.62));
}
function sfxCollision() {
  const b = createBuffer(0.45);
  renderVoice(b, {
    duration: 0.2,
    freq: 160,
    freqEnd: 60,
    wave: 'noise',
    gain: 0.4,
    attack: 0.001,
    release: 0.9,
  });
  renderVoice(b, {
    duration: 0.35,
    freq: 120,
    freqEnd: 50,
    wave: 'square',
    gain: 0.22,
    release: 0.8,
  });
  return encodeWav(normalize(b, 0.85));
}
function sfxCombo(offset) {
  const b = createBuffer(0.32);
  [0, 5, 9].forEach((semi, i) => {
    renderVoice(b, {
      start: i * 0.06,
      duration: 0.2,
      freq: note(semi + 12 + offset),
      wave: 'triangle',
      gain: 0.25,
    });
  });
  return encodeWav(normalize(b, 0.75));
}
function sfxGoal() {
  const b = createBuffer(0.95);
  [0, 4, 7, 12].forEach((semi, i) => {
    renderVoice(b, {
      start: i * 0.11,
      duration: 0.6,
      freq: note(semi + 12),
      wave: 'sine',
      gain: 0.24,
    });
  });
  renderVoice(b, {
    start: 0.3,
    duration: 0.6,
    freq: 300,
    freqEnd: 3000,
    wave: 'noise',
    gain: 0.07,
    release: 0.9,
  });
  return encodeWav(normalize(b, 0.85));
}
function sfxCorrect() {
  const b = createBuffer(0.3);
  renderVoice(b, { duration: 0.1, freq: note(12), wave: 'sine', gain: 0.32 });
  renderVoice(b, { start: 0.09, duration: 0.2, freq: note(19), wave: 'sine', gain: 0.3 });
  return encodeWav(normalize(b, 0.8));
}
function sfxWrong() {
  const b = createBuffer(0.38);
  renderVoice(b, { duration: 0.34, freq: 180, wave: 'square', gain: 0.26, release: 0.5 });
  renderVoice(b, { duration: 0.34, freq: 172, wave: 'square', gain: 0.22, release: 0.5 });
  return encodeWav(normalize(b, 0.75));
}
function sfxOrder() {
  const b = createBuffer(0.28);
  renderVoice(b, { duration: 0.1, freq: note(16), wave: 'triangle', gain: 0.28 });
  renderVoice(b, { start: 0.1, duration: 0.16, freq: note(11), wave: 'triangle', gain: 0.26 });
  return encodeWav(normalize(b, 0.75));
}
function sfxFootstep() {
  const b = createBuffer(0.38);
  for (let i = 0; i < 2; i++) {
    renderVoice(b, {
      start: i * 0.18,
      duration: 0.12,
      freq: 140,
      freqEnd: 80,
      wave: 'noise',
      gain: 0.25,
      attack: 0.002,
      release: 0.85,
    });
  }
  return encodeWav(normalize(b, 0.55));
}
function sfxDoorOpen() {
  const b = createBuffer(0.5);
  renderVoice(b, {
    duration: 0.46,
    freq: 260,
    freqEnd: 900,
    wave: 'saw',
    gain: 0.12,
    attack: 0.05,
    release: 0.6,
  });
  renderVoice(b, {
    duration: 0.46,
    freq: 1200,
    freqEnd: 400,
    wave: 'noise',
    gain: 0.08,
    attack: 0.05,
    release: 0.7,
  });
  return encodeWav(normalize(b, 0.6));
}
function sfxSoftStep() {
  const b = createBuffer(0.18);
  renderVoice(b, {
    duration: 0.09,
    freq: 190,
    freqEnd: 110,
    wave: 'noise',
    gain: 0.13,
    attack: 0.002,
    release: 0.9,
  });
  return encodeWav(normalize(b, 0.35));
}
function sfxDetect() {
  const b = createBuffer(0.32);
  renderVoice(b, { duration: 0.1, freq: note(4), wave: 'square', gain: 0.2 });
  renderVoice(b, { start: 0.1, duration: 0.18, freq: note(11), wave: 'square', gain: 0.22 });
  return encodeWav(normalize(b, 0.7));
}
function sfxCheckpoint() {
  const b = createBuffer(0.36);
  [0, 7].forEach((semi, i) => {
    renderVoice(b, {
      start: i * 0.08,
      duration: 0.2,
      freq: note(semi + 12),
      wave: 'triangle',
      gain: 0.28,
    });
  });
  return encodeWav(normalize(b, 0.75));
}
function sfxStealthClear() {
  const b = createBuffer(0.95);
  [0, 5, 9, 12, 17].forEach((semi, i) => {
    renderVoice(b, {
      start: i * 0.1,
      duration: 0.42,
      freq: note(semi + 5),
      wave: 'triangle',
      gain: 0.24,
    });
  });
  return encodeWav(normalize(b, 0.88));
}
function sfxCaught() {
  const b = createBuffer(0.65);
  renderVoice(b, {
    duration: 0.6,
    freq: 420,
    freqEnd: 90,
    wave: 'square',
    gain: 0.3,
    release: 0.6,
  });
  renderVoice(b, {
    start: 0.05,
    duration: 0.5,
    freq: 300,
    freqEnd: 70,
    wave: 'saw',
    gain: 0.18,
    release: 0.7,
  });
  return encodeWav(normalize(b, 0.85));
}

/** BGM loops: 4 bars of a simple progression, crossfaded so they loop cleanly. */
function bgmLoop({
  durationSec,
  bpm,
  chords,
  bassWave = 'triangle',
  leadWave = 'square',
  leadGain = 0.12,
  drums = true,
}) {
  const b = createBuffer(durationSec + 0.2);
  const beat = 60 / bpm;
  const beatsTotal = Math.floor(durationSec / beat);
  for (let i = 0; i < beatsTotal; i++) {
    const chord = chords[Math.floor(i / 4) % chords.length];
    const t = i * beat;
    renderVoice(b, {
      start: t,
      duration: beat * 0.9,
      freq: note(chord[0] - 24),
      wave: bassWave,
      gain: 0.22,
      release: 0.5,
    });
    const arp = chord[i % chord.length];
    renderVoice(b, {
      start: t,
      duration: beat * 0.5,
      freq: note(arp),
      wave: leadWave,
      gain: leadGain,
      release: 0.6,
    });
    renderVoice(b, {
      start: t + beat * 0.5,
      duration: beat * 0.4,
      freq: note(chord[(i + 2) % chord.length] + 12),
      wave: leadWave,
      gain: leadGain * 0.7,
      release: 0.7,
    });
    if (drums) {
      renderVoice(b, {
        start: t,
        duration: 0.06,
        freq: 120,
        freqEnd: 50,
        wave: 'noise',
        gain: 0.14,
        attack: 0.001,
        release: 0.9,
      });
      if (i % 2 === 1) {
        renderVoice(b, {
          start: t,
          duration: 0.07,
          freq: 6000,
          freqEnd: 3000,
          wave: 'noise',
          gain: 0.05,
          attack: 0.001,
          release: 0.9,
        });
      }
    }
  }
  return encodeWav(makeSeamless(normalize(b, 0.7)));
}

const bgmTitle = () =>
  bgmLoop({
    durationSec: 4,
    bpm: 108,
    chords: [
      [0, 4, 7],
      [-3, 2, 5],
      [-5, 0, 4],
      [2, 5, 9],
    ],
    drums: false,
    leadGain: 0.1,
  });
const bgmDriving = () =>
  bgmLoop({
    durationSec: 4,
    bpm: 152,
    chords: [
      [0, 3, 7],
      [5, 8, 12],
      [-2, 2, 5],
      [3, 7, 10],
    ],
    leadWave: 'square',
    leadGain: 0.13,
  });
const bgmBusy = () =>
  bgmLoop({
    durationSec: 4,
    bpm: 168,
    chords: [
      [0, 4, 9],
      [2, 5, 9],
      [-3, 0, 4],
      [4, 7, 11],
    ],
    leadWave: 'triangle',
    leadGain: 0.14,
  });
const bgmTense = () =>
  bgmLoop({
    durationSec: 4,
    bpm: 92,
    chords: [
      [0, 3, 7],
      [-1, 3, 6],
      [-4, 0, 3],
      [-2, 1, 5],
    ],
    leadWave: 'sine',
    leadGain: 0.09,
    drums: false,
  });

// ---------------------------------------------------------------------------
buildCommon();
buildLate();
buildBread();
buildTeacher();
console.info(
  `[placeholders] wrote ${written} files to public/assets/` +
    (skipped > 0 ? ` (kept ${skipped} real asset${skipped === 1 ? '' : 's'})` : ''),
);
