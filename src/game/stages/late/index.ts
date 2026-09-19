/**
 * STAGE 1 module descriptor.
 *
 * The Phaser scene is loaded lazily so stage 1's code (and only stage 1's) is in the
 * first chunk the player downloads.
 */
import { RULES } from '@/config/rules';
import { computeStageScore } from '@/game/core/scoring';
import type { StageModule } from '@/game/core/stageTypes';

export const lateStage: StageModule = {
  id: 'late',
  label: '遅刻回避',
  shortLabel: '遅刻',
  tagline: '私道を駆け抜けて校門へ',
  rules: [
    '生徒をギリギリでかわすほど高得点',
    '連続ニアミスでコンボ倍率アップ',
    'ぶつかると減速＋大幅減点',
    '時間内に校門へ着けばボーナス',
  ],
  controlHint: '画面を指で左右にドラッグ（指の移動量で動きます）',
  bundles: ['common', 'late'],
  enabled: true,
  approxDurationSec: RULES.stages.late.timeLimitSec,

  async loadScene() {
    const { createLateScene } = await import('./LateScene');
    return createLateScene;
  },

  debugSampleResult() {
    // The score is derived, never hand-written: a literal here would drift from
    // the formula and the server would (correctly) reject the submission.
    const metrics = {
      nearMissCount: 14,
      comboUnits: 18,
      collisionCount: 1,
      maxCombo: 5,
      goalReached: 1,
      timeRemainingSec: 6,
    };
    return {
      stageId: 'late' as const,
      score: computeStageScore('late', metrics),
      durationMs: 24_000,
      metrics,
    };
  },

  formatMetrics(metrics) {
    return [
      { label: 'ニアミス', value: `${metrics.nearMissCount ?? 0} 回` },
      { label: '最大コンボ', value: `${metrics.maxCombo ?? 0}` },
      { label: '衝突', value: `${metrics.collisionCount ?? 0} 回` },
      {
        label: '校門到達',
        value:
          (metrics.goalReached ?? 0) > 0 ? `残り ${metrics.timeRemainingSec ?? 0} 秒` : '時間切れ',
      },
    ];
  },
};
