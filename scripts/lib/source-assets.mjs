/**
 * The table of real photographs and what each becomes.
 *
 * Shared by two scripts on purpose:
 *   - `process-source-assets.mjs` reads it to know what to produce
 *   - `generate-placeholders.mjs` reads it to know what NOT to overwrite
 *
 * That second one matters. Without it, regenerating the placeholder art would
 * silently destroy the real assets, and the loss would only show up the next time
 * someone looked at the game.
 */

/** `size` produces one image; `frames` produces a horizontal spritesheet. */
export const SOURCE_ASSETS = [
  { src: 'bread-melon.jpg', out: 'bread/item-melon.png', size: [192, 192] },
  { src: 'bread-choco-roll.jpg', out: 'bread/item-choco-roll.png', size: [192, 192] },
  { src: 'bread-sausage.jpg', out: 'bread/item-sausage-roll.png', size: [192, 192] },
  { src: 'onigiri-tuna.jpg', out: 'bread/item-onigiri-tuna.png', size: [192, 192] },
  { src: 'onigiri-ume.jpg', out: 'bread/item-onigiri-ume.png', size: [192, 192] },
  { src: 'onigiri-salmon.jpg', out: 'bread/item-onigiri-salmon.png', size: [192, 192] },
  {
    src: 'late-player.jpg',
    out: 'late/player-run.png',
    frame: [80, 208],
    frames: 6,
    motion: 'run',
  },
  {
    src: 'late-player.jpg',
    out: 'late/player-hit.png',
    frame: [80, 208],
    frames: 2,
    motion: 'hit',
  },
];

/** Paths under `public/assets/` that come from a photograph, not from code. */
export const SOURCE_OUTPUTS = new Set(SOURCE_ASSETS.map((entry) => entry.out));
