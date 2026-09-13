/**
 * Small rendering constants shared by every Phaser view.
 *
 * Game units are CSS pixels (see `GameHost`'s RESIZE scale mode), which keeps layout
 * code simple and performance predictable. Text is the one thing that visibly suffers
 * at 1x on a high-DPI phone, so text objects are rendered at device resolution.
 */

export const TEXT_RESOLUTION =
  typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);

export const FONT_STACK =
  '"Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';
