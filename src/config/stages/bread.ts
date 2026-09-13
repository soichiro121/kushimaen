/**
 * STAGE 2 - 羽沢パン購入RTA: product catalogue and tuning.
 *
 * ADDING A NEW BREAD (no gameplay code changes):
 *   1. Put the image in `public/assets/bread/` and add it to `assetManifest.ts`
 *      under `bread.item.<id>`.
 *   2. Add one row to `BREAD_ITEMS` below.
 * That is the whole procedure - see docs/GAME_DESIGN.md.
 */
import { RULES } from '@/config/rules';
import type { AssetId } from '@/assets/assetRegistry';

/**
 * Products that look or read alike belong to the same family. Late questions
 * deliberately fill the shelf with same-family items, which is what turns the stage
 * from "find the picture" into a real reading-speed challenge.
 */
export type BreadFamily = 'curry' | 'melon' | 'an' | 'sandwich' | 'long' | 'sweet' | 'savory';

export interface BreadItem {
  readonly id: string;
  /** Display name, also the text of the order. */
  readonly name: string;
  readonly assetId: AssetId;
  readonly family: BreadFamily;
  readonly tags: readonly string[];
  /** 1 (easy to spot) .. 3 (easily confused). Biases how often it is the target. */
  readonly difficulty: number;
}

export const BREAD_ITEMS: readonly BreadItem[] = [
  {
    id: 'curry',
    name: 'カレーパン',
    assetId: 'bread.item.curry',
    family: 'curry',
    tags: ['揚げ', '惣菜'],
    difficulty: 1,
  },
  {
    id: 'curryHot',
    name: '辛口カレーパン',
    assetId: 'bread.item.curryHot',
    family: 'curry',
    tags: ['揚げ', '惣菜', '辛い'],
    difficulty: 3,
  },
  {
    id: 'melon',
    name: 'メロンパン',
    assetId: 'bread.item.melon',
    family: 'melon',
    tags: ['菓子パン'],
    difficulty: 1,
  },
  {
    id: 'melonWhip',
    name: 'ホイップメロンパン',
    assetId: 'bread.item.melonWhip',
    family: 'melon',
    tags: ['菓子パン', 'クリーム'],
    difficulty: 3,
  },
  {
    id: 'an',
    name: 'あんパン',
    assetId: 'bread.item.an',
    family: 'an',
    tags: ['菓子パン', '和'],
    difficulty: 1,
  },
  {
    id: 'anUguisu',
    name: 'うぐいすあんパン',
    assetId: 'bread.item.anUguisu',
    family: 'an',
    tags: ['菓子パン', '和'],
    difficulty: 3,
  },
  {
    id: 'cream',
    name: 'クリームパン',
    assetId: 'bread.item.cream',
    family: 'sweet',
    tags: ['菓子パン', 'クリーム'],
    difficulty: 2,
  },
  {
    id: 'croissant',
    name: 'クロワッサン',
    assetId: 'bread.item.croissant',
    family: 'sweet',
    tags: ['パン'],
    difficulty: 1,
  },
  {
    id: 'chocoCorone',
    name: 'チョココロネ',
    assetId: 'bread.item.chocoCorone',
    family: 'sweet',
    tags: ['菓子パン', 'チョコ'],
    difficulty: 2,
  },
  {
    id: 'chocoChip',
    name: 'チョコチップパン',
    assetId: 'bread.item.chocoChip',
    family: 'sweet',
    tags: ['菓子パン', 'チョコ'],
    difficulty: 2,
  },
  {
    id: 'sugarTwist',
    name: 'シュガーツイスト',
    assetId: 'bread.item.sugarTwist',
    family: 'sweet',
    tags: ['菓子パン'],
    difficulty: 2,
  },
  {
    id: 'yakisoba',
    name: '焼きそばパン',
    assetId: 'bread.item.yakisoba',
    family: 'long',
    tags: ['惣菜'],
    difficulty: 1,
  },
  {
    id: 'koppe',
    name: 'コッペパン',
    assetId: 'bread.item.koppe',
    family: 'long',
    tags: ['プレーン'],
    difficulty: 2,
  },
  {
    id: 'milkFrance',
    name: 'ミルクフランス',
    assetId: 'bread.item.milkFrance',
    family: 'long',
    tags: ['菓子パン', 'クリーム'],
    difficulty: 2,
  },
  {
    id: 'katsuSand',
    name: 'カツサンド',
    assetId: 'bread.item.katsuSand',
    family: 'sandwich',
    tags: ['サンド', '惣菜'],
    difficulty: 2,
  },
  {
    id: 'tamagoSand',
    name: 'たまごサンド',
    assetId: 'bread.item.tamagoSand',
    family: 'sandwich',
    tags: ['サンド'],
    difficulty: 2,
  },
  {
    id: 'hamCheese',
    name: 'ハムチーズサンド',
    assetId: 'bread.item.hamCheese',
    family: 'sandwich',
    tags: ['サンド'],
    difficulty: 3,
  },
  {
    id: 'pizza',
    name: 'ピザパン',
    assetId: 'bread.item.pizza',
    family: 'savory',
    tags: ['惣菜'],
    difficulty: 1,
  },
];

export const breadConfig = {
  /** Safety net only: the stage normally ends when the last order is answered. */
  timeLimitMs: 75_000,

  questions: {
    min: RULES.stages.bread.minQuestions,
    max: RULES.stages.bread.maxQuestions,
  },

  /** Number of products on the shelf, interpolated from the first to the last order. */
  choices: {
    start: 4,
    end: 12,
  },

  /**
   * How many same-family decoys are forced onto the shelf, interpolated across the
   * run. This is the main difficulty curve.
   */
  similarDecoys: {
    start: 0,
    end: 3,
  },

  layout: {
    /** Column count by choice count: the first entry whose `upTo` fits wins. */
    columns: [
      { upTo: 4, columns: 2 },
      { upTo: 9, columns: 3 },
      { upTo: 99, columns: 3 },
    ],
    /** Cell size is derived from the viewport, clamped to this range (px). */
    minCellWidth: 92,
    maxCellWidth: 150,
    gap: 10,
  },

  feedback: {
    /** How long a wrong item stays disabled, to prevent frantic double-taps. */
    lockoutMs: 220,
    /** Delay between answering and the next order appearing. */
    advanceDelayMs: 160,
    /**
     * Extra delay before the new shelf accepts taps. It exists only so a fast
     * double-tap cannot carry over onto the next order; keep it short, because every
     * millisecond here feels like a dropped tap.
     */
    inputOpenDelayMs: 70,
    /** Shelf entry animation. Must finish close to when input opens. */
    entryDurationMs: 130,
    entryStaggerMs: 8,
  },
} as const;

export function breadItemById(id: string): BreadItem | undefined {
  return BREAD_ITEMS.find((item) => item.id === id);
}
