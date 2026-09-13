/** STAGE 2 module descriptor. */
import { computeStageScore } from '@/game/core/scoring';
import type { StageModule } from '@/game/core/stageTypes';

export const breadStage: StageModule = {
  id: 'bread',
  label: '羽沢パン購入RTA',
  tagline: '注文のパンを最速でタップ',
  rules: [
    '上に表示された注文と同じパンをタップ',
    '早く正解するほど高得点',
    '連続正解でコンボ',
    '間違えると減点＋コンボリセット',
  ],
  controlHint: 'パンをタップ（後半は似た商品が増えます）',
  bundles: ['common', 'bread'],
  enabled: true,
  approxDurationSec: 40,

  async loadScene() {
    const { createBreadScene } = await import('./BreadScene');
    return createBreadScene;
  },

  debugSampleResult() {
    // The score is derived, never hand-written: a literal here would drift from
    // the formula and the server would (correctly) reject the submission.
    const metrics = {
      questionCount: 8,
      correctCount: 7,
      mistakeCount: 1,
      speedUnits: 30,
      comboUnits: 12,
      maxCombo: 5,
      totalReactionMs: 9800,
    };
    return {
      stageId: 'bread' as const,
      score: computeStageScore('bread', metrics),
      durationMs: 22_000,
      metrics,
    };
  },

  formatMetrics(metrics) {
    const correct = metrics.correctCount ?? 0;
    const averageReaction = correct > 0 ? Math.round((metrics.totalReactionMs ?? 0) / correct) : 0;
    return [
      { label: '正解', value: `${correct} / ${metrics.questionCount ?? 0}` },
      { label: 'ミス', value: `${metrics.mistakeCount ?? 0} 回` },
      { label: '最大コンボ', value: `${metrics.maxCombo ?? 0}` },
      { label: '平均反応', value: correct > 0 ? `${(averageReaction / 1000).toFixed(2)} 秒` : '-' },
    ];
  },
};
