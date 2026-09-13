/**
 * Configuration sanity.
 *
 * A rule set or a stage registry that is internally inconsistent produces bugs that
 * only show up in a real play-through - an unreachable rank, a stage with no rules,
 * a spawn interval of zero. These checks catch that at test time instead.
 */
import { describe, expect, it } from 'vitest';
import { RULES, rankForStage, rankForTotal, type Rank, type StageId } from '@/config/rules';
import { GAME_CONFIG } from '@/config/game';
import { breadConfig } from '@/config/stages/bread';
import { lateConfig } from '@/config/stages/late';
import { teacherConfig } from '@/config/stages/teacher';
import { allStageModules, findStageModule, getStageModule, playableStages } from '@/game/stages';
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  nicknameLength,
  sanitizeNickname,
  validateNickname,
} from '@/utils/nickname';

describe('rule set', () => {
  it('declares a positive config version and a non-empty stage order', () => {
    expect(RULES.configVersion).toBeGreaterThan(0);
    expect(RULES.stageOrder.length).toBeGreaterThan(0);
    expect(new Set(RULES.stageOrder).size).toBe(RULES.stageOrder.length);
  });

  it('has a rules block for every stage in the order, and no orphans', () => {
    expect([...RULES.stageOrder].sort()).toEqual(Object.keys(RULES.stages).sort());
  });

  it('orders rank thresholds S > A > B > C', () => {
    for (const stageId of RULES.stageOrder) {
      const { S, A, B, C } = RULES.stages[stageId].rank;
      expect(S, stageId).toBeGreaterThan(A);
      expect(A, stageId).toBeGreaterThan(B);
      expect(B, stageId).toBeGreaterThan(C);
      expect(C, stageId).toBe(0); // C must always be reachable
    }
  });

  it('gives every stage a usable duration window', () => {
    for (const stageId of RULES.stageOrder) {
      const { minDurationMs, maxDurationMs } = RULES.stages[stageId].limits;
      expect(minDurationMs, stageId).toBeGreaterThan(0);
      expect(maxDurationMs, stageId).toBeGreaterThan(minDurationMs);
    }
  });

  it('keeps the run duration window consistent with the per-stage windows', () => {
    const minPossible = RULES.stageOrder.reduce(
      (sum, id) => sum + RULES.stages[id].limits.minDurationMs,
      0,
    );
    const maxPossible = RULES.stageOrder.reduce(
      (sum, id) => sum + RULES.stages[id].limits.maxDurationMs,
      0,
    );

    // Otherwise a legitimately fast (or slow) run would be rejected outright.
    expect(RULES.run.minTotalDurationMs).toBeLessThanOrEqual(minPossible);
    expect(RULES.run.maxTotalDurationMs).toBeGreaterThanOrEqual(maxPossible);
  });

  it('gives a run long enough to actually finish before it expires', () => {
    const maxPlaySeconds = RULES.run.maxTotalDurationMs / 1000;
    expect(RULES.run.ttlSeconds).toBeGreaterThan(maxPlaySeconds);
  });

  it('keeps the nickname bounds usable', () => {
    expect(RULES.nickname.minLength).toBeGreaterThanOrEqual(1);
    expect(RULES.nickname.maxLength).toBeGreaterThan(RULES.nickname.minLength);
  });
});

describe('rank helpers', () => {
  it.each(RULES.stageOrder)('returns the expected band for %s', (stageId: StageId) => {
    const thresholds = RULES.stages[stageId].rank;

    expect(rankForStage(stageId, thresholds.S)).toBe('S');
    expect(rankForStage(stageId, thresholds.A)).toBe('A');
    expect(rankForStage(stageId, thresholds.B)).toBe('B');
    expect(rankForStage(stageId, 0)).toBe('C');
  });

  it('never returns a better rank for a lower score', () => {
    const order: Record<Rank, number> = { S: 3, A: 2, B: 1, C: 0 };
    let previous = 0;
    for (let score = 0; score <= 20_000; score += 250) {
      const current = order[rankForStage('late', score)];
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('grades the total against the sum of the per-stage thresholds', () => {
    const sum = (rank: 'S' | 'A' | 'B') =>
      RULES.stageOrder.reduce((total, id) => total + RULES.stages[id].rank[rank], 0);

    expect(rankForTotal(sum('S'))).toBe('S');
    expect(rankForTotal(sum('A'))).toBe('A');
    expect(rankForTotal(sum('B'))).toBe('B');
    expect(rankForTotal(0)).toBe('C');
  });
});

describe('stage registry', () => {
  it('registers a module for every stage in the rule set', () => {
    for (const stageId of RULES.stageOrder) {
      expect(findStageModule(stageId), stageId).toBeDefined();
    }
  });

  it('gives every module a unique id and complete presentation metadata', () => {
    const modules = allStageModules();

    expect(new Set(modules.map((m) => m.id)).size).toBe(modules.length);
    for (const stage of modules) {
      expect(stage.label.length, stage.id).toBeGreaterThan(0);
      expect(stage.tagline.length, stage.id).toBeGreaterThan(0);
      expect(stage.rules.length, stage.id).toBeGreaterThan(0);
      expect(stage.controlHint.length, stage.id).toBeGreaterThan(0);
      expect(stage.approxDurationSec, stage.id).toBeGreaterThan(0);
    }
  });

  it('formats metrics into displayable rows for the result screen', () => {
    for (const stage of allStageModules()) {
      // Deliberately empty metrics: a fresh/aborted stage must not crash the UI.
      const rows = stage.formatMetrics({});
      expect(rows.length, stage.id).toBeGreaterThan(0);
      for (const row of rows) {
        expect(typeof row.label).toBe('string');
        expect(typeof row.value).toBe('string');
      }
    }
  });

  it('plays the stages in the rule set order, filtered by the feature flags', () => {
    const playable = playableStages().map((stage) => stage.id);
    const enabled = RULES.stageOrder.filter(
      (id) => getStageModule(id).enabled && GAME_CONFIG.stageEnabled(id),
    );

    expect(playable).toEqual(enabled);
  });

  it('throws a helpful error for an unregistered stage', () => {
    expect(() => getStageModule('nope' as StageId)).toThrow(/not registered/);
  });
});

describe('stage tuning', () => {
  it('keeps stage 1 spawnable and finishable', () => {
    expect(lateConfig.courseDistancePx).toBeGreaterThan(0);
    expect(lateConfig.scroll.endSpeed).toBeGreaterThan(lateConfig.scroll.startSpeed);
    // Spawns must get faster, not slower, as the course goes on.
    expect(lateConfig.spawn.endMs).toBeLessThan(lateConfig.spawn.startMs);
    expect(lateConfig.spawn.endMs).toBeGreaterThan(0);
    expect(lateConfig.road.widthRatio).toBeGreaterThan(0);
    expect(lateConfig.road.widthRatio).toBeLessThanOrEqual(1);
    expect(lateConfig.player.yRatio).toBeGreaterThan(0.5);
    expect(lateConfig.player.yRatio).toBeLessThan(1);
  });

  it('makes a near miss strictly closer than the near-miss window but wider than a hit', () => {
    expect(lateConfig.nearMiss.minDistancePx).toBeLessThan(lateConfig.nearMiss.distancePx);
  });

  it('gives every obstacle a positive weight and size', () => {
    for (const obstacle of lateConfig.obstacles) {
      expect(obstacle.weight, obstacle.id).toBeGreaterThan(0);
      expect(obstacle.displayWidth, obstacle.id).toBeGreaterThan(0);
      expect(obstacle.speedFactor, obstacle.id).toBeGreaterThan(0);
      expect(obstacle.hitboxScale, obstacle.id).toBeGreaterThan(0);
      expect(obstacle.hitboxScale, obstacle.id).toBeLessThanOrEqual(1);
    }
  });

  it('leaves a gap in the road even behind the widest obstacle', () => {
    // On the narrowest supported viewport the player must still have somewhere to go.
    const narrowestViewport = 320;
    const roadWidth = narrowestViewport * lateConfig.road.widthRatio;
    const widest = Math.max(...lateConfig.obstacles.map((o) => o.displayWidth * o.hitboxScale));

    expect(widest).toBeLessThan(roadWidth - lateConfig.player.displayWidth * 0.5);
  });

  it('keeps stage 2 question counts inside the shared rule set', () => {
    expect(breadConfig.questions.min).toBe(RULES.stages.bread.minQuestions);
    expect(breadConfig.questions.max).toBe(RULES.stages.bread.maxQuestions);
    expect(breadConfig.choices.end).toBeGreaterThan(breadConfig.choices.start);
    expect(breadConfig.layout.minCellWidth).toBeGreaterThanOrEqual(44); // touch target
  });

  it('keeps stage 3 playable at the speed and scale it is tuned for', () => {
    expect(teacherConfig.player.speedPxPerSec).toBeGreaterThan(0);
    expect(teacherConfig.player.radiusPx).toBeGreaterThan(0);
    expect(teacherConfig.timeLimitMs).toBe(RULES.stages.teacher.timeLimitSec * 1000);
    // The anti-cheat speed bound must leave headroom over the real walking speed,
    // otherwise an honest run would be rejected as a speed hack.
    expect(RULES.stages.teacher.limits.maxPlayerSpeedPxPerSec).toBeGreaterThan(
      teacherConfig.player.speedPxPerSec,
    );
    // Checkpoints are collected by proximity, so the radius has to clear the body.
    expect(teacherConfig.player.checkpointRadiusPx).toBeGreaterThan(
      teacherConfig.player.radiusPx * 2,
    );
  });

  it('gives every teacher archetype a usable cone and a sane wait window', () => {
    const types = Object.values(teacherConfig.teacherTypes);
    expect(types.length).toBeGreaterThanOrEqual(3); // requirement 15

    for (const type of types) {
      expect(type.speedPxPerSec, type.id).toBeGreaterThan(0);
      // A teacher who outran the player would make this a chase, not a stealth game.
      expect(type.speedPxPerSec, type.id).toBeLessThan(teacherConfig.player.speedPxPerSec);
      expect(type.viewDistancePx, type.id).toBeGreaterThan(0);
      expect(type.viewAngleDeg, type.id).toBeGreaterThan(0);
      expect(type.viewAngleDeg, type.id).toBeLessThan(360);
      expect(type.waitMs.maxMs, type.id).toBeGreaterThanOrEqual(type.waitMs.minMs);
      expect(type.turnProbability, type.id).toBeGreaterThanOrEqual(0);
      expect(type.turnProbability, type.id).toBeLessThanOrEqual(1);
    }
    // They must not all behave identically, or the map has one enemy repeated.
    expect(new Set(types.map((type) => type.turnProbability)).size).toBeGreaterThan(1);
  });

  it('leaves a real reaction window between being seen and being caught', () => {
    // Requirement 20: one frame in a cone must never be fatal, and breaking line of
    // sight has to be a genuine escape rather than a pause.
    expect(teacherConfig.detection.fillMs).toBeGreaterThanOrEqual(250);
    expect(teacherConfig.detection.decayMs).toBeGreaterThan(0);
    expect(teacherConfig.detection.alertRatio).toBeGreaterThan(0);
    expect(teacherConfig.detection.alertRatio).toBeLessThan(1);
  });

  it('makes the drag control usable: dead zone inside full speed inside the rim', () => {
    expect(teacherConfig.input.deadZonePx).toBeLessThan(teacherConfig.input.fullSpeedPx);
    expect(teacherConfig.input.fullSpeedPx).toBeLessThanOrEqual(teacherConfig.input.maxOffsetPx);
    expect(teacherConfig.input.controlBandRatio).toBeGreaterThan(0);
    expect(teacherConfig.input.controlBandRatio).toBeLessThan(0.5);
  });
});

describe('nickname rules', () => {
  it('mirrors the shared bounds', () => {
    expect(NICKNAME_MIN).toBe(RULES.nickname.minLength);
    expect(NICKNAME_MAX).toBe(RULES.nickname.maxLength);
  });

  it('accepts an ordinary name', () => {
    expect(validateNickname('テスト太郎')).toBeNull();
    expect(sanitizeNickname('テスト太郎')).toBe('テスト太郎');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeNickname('  a \n b  ')).toBe('a b');
  });

  it('strips control and invisible characters', () => {
    expect(sanitizeNickname('a\u0000b')).toBe('ab');
    expect(sanitizeNickname('\u200B\uFEFF')).toBe('');
    expect(validateNickname('\u200B')).toBe('empty');
  });

  it('truncates by code point so an emoji is never cut in half', () => {
    const clean = sanitizeNickname('🍞'.repeat(40));

    expect(nicknameLength(clean)).toBe(NICKNAME_MAX);
    expect(clean.endsWith('🍞')).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(validateNickname('')).toBe('empty');
    expect(validateNickname('   ')).toBe('empty');
  });
});

describe('game config', () => {
  it('exposes a title, a config version matching the rule set, and a sane difficulty', () => {
    expect(GAME_CONFIG.title.length).toBeGreaterThan(0);
    expect(GAME_CONFIG.configVersion).toBe(RULES.configVersion);
    expect(GAME_CONFIG.difficultyScale).toBeGreaterThan(0);
  });

  it('uses a same-origin API base by default, so production needs no CORS', () => {
    expect(GAME_CONFIG.apiBaseUrl).toBe('');
  });
});
