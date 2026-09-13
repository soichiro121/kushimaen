/** STAGE 3 module descriptor. */
import { teacherConfig } from '@/config/stages/teacher';
import { computeStageScore, isPerfectStealth } from '@/game/core/scoring';
import type { StageModule } from '@/game/core/stageTypes';

export const teacherStage: StageModule = {
  id: 'teacher',
  label: '放課後ステルス',
  tagline: '先生の目を盗んで校内を回れ',
  rules: [
    'ドラッグした方向へ移動する',
    '目的地に近づくと自動で回収。全部回ったら昇降口へ',
    '先生の視界に一定時間入ると発見される。壁の陰なら見つからない',
    'タイムが最大の得点源。待てば安全、でも大幅に減点',
  ],
  controlHint: '画面をドラッグ＝移動',
  bundles: ['common', 'teacher'],
  enabled: true,
  approxDurationSec: teacherConfig.approxDurationSec,

  async loadScene() {
    const { createTeacherScene } = await import('./TeacherScene');
    return createTeacherScene;
  },

  debugSampleResult() {
    // The score is derived, never hand-written: a literal here would drift from the
    // formula and the server would (correctly) reject the submission.
    const metrics = {
      cleared: 1,
      checkpointsCompleted: 4,
      timeRemainingSec: 41,
      caughtCount: 1,
      detectionCount: 3,
      dangerPassCount: 2,
      perfectStealth: 0,
      routeDistance: 9200,
      idleTimeMs: 2400,
    };
    return {
      stageId: 'teacher' as const,
      score: computeStageScore('teacher', metrics),
      durationMs: 49_000,
      metrics,
    };
  },

  formatMetrics(metrics) {
    const cleared = (metrics.cleared ?? 0) > 0;
    return [
      { label: '結果', value: cleared ? '脱出成功' : '時間切れ' },
      { label: '目的地', value: `${metrics.checkpointsCompleted ?? 0} 箇所` },
      { label: '残り時間', value: `${metrics.timeRemainingSec ?? 0} 秒` },
      { label: '発見', value: `${metrics.caughtCount ?? 0} 回` },
      {
        label: 'ステルス',
        value:
          cleared && isPerfectStealth(metrics)
            ? 'PERFECT'
            : `見られた ${metrics.detectionCount ?? 0} 回`,
      },
    ];
  },
};
