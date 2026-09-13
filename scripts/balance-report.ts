/**
 * Balance report.
 *
 *   npm run balance
 *
 * Simulates many runs of each stage at four skill levels and prints the score
 * distribution, so rank thresholds and score constants can be chosen from numbers
 * rather than guesses.
 *
 * The simulations drive the REAL code wherever the real code is pure: the stage 3
 * school map, patrol agents, vision and detection model, the bread
 * `generateBreadProblems`, the seeded `Rng`, the stage configs and the shared scoring
 * formulas. Only the *player* is modelled.
 *
 * BUILD-TIME TOOL. Run it after changing anything in `shared/game-rules/` or
 * `src/config/stages/`.
 */
import { RULES, type StageId } from '../src/config/rules';
import { lateConfig } from '../src/config/stages/late';
import {
  DEFAULT_MAP_ID,
  getSchoolMap,
  teacherConfig,
  type SchoolMapData,
} from '../src/config/stages/teacher';
import { generateBreadProblems } from '../src/game/stages/bread/problemGenerator';
import { SchoolMap } from '../src/game/stages/teacher/map/SchoolMap';
import { angleDelta, degToRad } from '../src/game/stages/teacher/map/geometry';
import { TeacherAgent } from '../src/game/stages/teacher/sim/TeacherAgent';
import { DetectionMeter } from '../src/game/stages/teacher/sim/DetectionMeter';
import { canSee } from '../src/game/stages/teacher/sim/vision';
import { generateMission, MissionProgress } from '../src/game/stages/teacher/sim/mission';
import {
  comboUnitsForHit,
  computeStageScore,
  speedUnitsForReaction,
} from '../src/game/core/scoring';
import { createRng, deriveSeed, type Rng } from '../src/utils/rng';

const RUNS = 400;
const STEP_MS = 16;

/**
 * Four reference players. "average" is the one the rank thresholds are tuned around:
 * it should land on B, a good player on A, and an expert on S.
 */
type Skill = 'novice' | 'average' | 'good' | 'expert';
const SKILLS: Skill[] = ['novice', 'average', 'good', 'expert'];

interface Sample {
  score: number;
  metrics: Record<string, number>;
}

// ---------------------------------------------------------------------------
// STAGE 1 - late
// ---------------------------------------------------------------------------

/** How often this player squeezes past, and how often they clip someone. */
const LATE_PROFILE: Record<Skill, { nearMiss: number; collision: number }> = {
  novice: { nearMiss: 0.18, collision: 0.1 },
  average: { nearMiss: 0.42, collision: 0.055 },
  good: { nearMiss: 0.68, collision: 0.03 },
  expert: { nearMiss: 0.86, collision: 0.012 },
};

function simulateLate(rng: Rng, skill: Skill): Sample {
  const profile = LATE_PROFILE[skill];
  const limitMs = lateConfig.timeLimitMs;

  let elapsed = 0;
  let distance = 0;
  let sinceSpawn = 0;
  let slowdownLeft = 0;
  let spawnTimer = lateConfig.spawn.startMs;

  let nearMissCount = 0;
  let collisionCount = 0;
  let comboUnits = 0;
  let combo = 0;
  let maxCombo = 0;
  // Obstacles that have spawned but not yet reached the player.
  let pending = 0;
  let goalReached = 0;
  let timeRemainingSec = 0;

  while (elapsed < limitMs) {
    const progress = Math.min(1, distance / lateConfig.courseDistancePx);
    const base =
      lateConfig.scroll.startSpeed +
      (lateConfig.scroll.endSpeed - lateConfig.scroll.startSpeed) * progress;
    const speed = base * (slowdownLeft > 0 ? lateConfig.collision.slowdownFactor : 1);

    const delta = (speed * STEP_MS) / 1000;
    distance += delta;
    sinceSpawn += delta;
    elapsed += STEP_MS;
    slowdownLeft = Math.max(0, slowdownLeft - STEP_MS);

    // Spawning, using the real interval ramp.
    const interval =
      lateConfig.spawn.startMs + (lateConfig.spawn.endMs - lateConfig.spawn.startMs) * progress;
    spawnTimer -= STEP_MS;
    if (spawnTimer <= 0) {
      spawnTimer += interval;
      if (sinceSpawn >= lateConfig.spawn.minGapPx && distance < lateConfig.courseDistancePx) {
        sinceSpawn = 0;
        pending += 1;
      }
    }

    // An obstacle reaches the player roughly one screen-height of travel later.
    // Resolving one per ~350px of scroll approximates the real pass rate closely
    // enough for balance purposes.
    if (
      pending > 0 &&
      distance > 0 &&
      Math.floor(distance / 350) > Math.floor((distance - delta) / 350)
    ) {
      pending -= 1;
      const roll = rng.next();
      if (roll < profile.collision) {
        collisionCount += 1;
        combo = 0;
        slowdownLeft = lateConfig.collision.slowdownMs;
      } else if (roll < profile.collision + profile.nearMiss) {
        nearMissCount += 1;
        combo += 1;
        maxCombo = Math.max(maxCombo, combo);
        comboUnits += comboUnitsForHit(combo, RULES.stages.late.scoring.maxComboUnitsPerHit);
      }
    }

    if (distance >= lateConfig.courseDistancePx) {
      goalReached = 1;
      timeRemainingSec = Math.floor((limitMs - elapsed) / 1000);
      break;
    }
  }

  const metrics = {
    nearMissCount,
    comboUnits,
    collisionCount,
    maxCombo,
    goalReached,
    timeRemainingSec,
  };
  return { score: computeStageScore('late', metrics), metrics };
}

// ---------------------------------------------------------------------------
// STAGE 2 - bread
// ---------------------------------------------------------------------------

/**
 * Reaction time = a fixed "read the order" cost plus a per-product scan cost, with
 * an extra penalty for same-family look-alikes that have to be read properly.
 */
const BREAD_PROFILE: Record<
  Skill,
  { baseMs: number; perChoiceMs: number; decoyMs: number; errorRate: number }
> = {
  novice: { baseMs: 900, perChoiceMs: 190, decoyMs: 320, errorRate: 0.22 },
  average: { baseMs: 620, perChoiceMs: 120, decoyMs: 210, errorRate: 0.11 },
  good: { baseMs: 430, perChoiceMs: 78, decoyMs: 130, errorRate: 0.05 },
  expert: { baseMs: 300, perChoiceMs: 48, decoyMs: 80, errorRate: 0.02 },
};

function simulateBread(rng: Rng, skill: Skill): Sample {
  const profile = BREAD_PROFILE[skill];
  const problems = generateBreadProblems(rng);

  let correctCount = 0;
  let mistakeCount = 0;
  let speedUnits = 0;
  let comboUnits = 0;
  let combo = 0;
  let maxCombo = 0;
  let totalReactionMs = 0;

  for (const problem of problems) {
    const decoys = problem.choices.filter(
      (choice) => choice.family === problem.target.family && choice.id !== problem.target.id,
    ).length;

    let reaction =
      profile.baseMs +
      profile.perChoiceMs * problem.choices.length +
      profile.decoyMs * decoys +
      rng.range(-120, 220);

    // Wrong taps cost time as well as points.
    const mistakes = rng.next() < profile.errorRate ? (rng.next() < 0.25 ? 2 : 1) : 0;
    mistakeCount += mistakes;
    reaction += mistakes * 420;
    if (mistakes > 0) combo = 0;

    reaction = Math.max(160, reaction);
    totalReactionMs += reaction;

    correctCount += 1;
    speedUnits += speedUnitsForReaction(reaction);
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    comboUnits += comboUnitsForHit(combo, RULES.stages.bread.scoring.maxComboUnitsPerHit);
  }

  const metrics = {
    questionCount: problems.length,
    correctCount,
    mistakeCount,
    speedUnits,
    comboUnits,
    maxCombo,
    totalReactionMs: Math.round(totalReactionMs),
  };
  return { score: computeStageScore('bread', metrics), metrics };
}

// ---------------------------------------------------------------------------
// STAGE 3 - the stealth run
//
// This one drives the REAL stage: the authored map, `TeacherAgent`, `canSee`,
// `DetectionMeter` and `generateMission`. Only the player is modelled, and the model
// is deliberately about the two decisions the stage is built on - which route to
// take, and whether to wait for a patrol to pass.
// ---------------------------------------------------------------------------

/**
 * The simulated player.
 *
 * WHAT THIS MODELS, AND WHAT IT DOES NOT. A reactive bot cannot play stealth the way
 * a person does - it has no memory of the patrol and cannot time a crossing. So this
 * models the one axis it can model honestly: **how much exposure a player accepts**.
 * A beginner waits for a completely clear corridor and pays for it in time; a bolder
 * player crosses while briefly visible, betting on breaking the sight line before the
 * meter fills.
 *
 * Several more elaborate models were tried (wait for a gap in the patrol; run for the
 * nearest doorway when spotted) and every one of them played *worse* than this - they
 * stood in corridors, or oscillated in doorways. Tuning the game to compensate for a
 * bad bot is how a real design gets broken, so the model stayed simple and the
 * questions it is trusted to answer stayed narrow:
 *
 *   - do the stages contribute comparable shares of the total?
 *   - does a faster player score more than a slower one?
 *   - does ignoring the teachers entirely win? (the strategy check below)
 *
 * `riskWeight`  how far they detour around patrolled ground when planning the route
 * `lookaheadPx` how far ahead they check before stepping into the open
 * `enterAt`     detection level below which they will still walk into a cone (nerve)
 * `patienceMs`  how long a cautious player waits before going anyway
 * `speedScale`  how much of the theoretical walking speed they actually achieve;
 *               nobody drags a thumb in a perfect straight line
 */
const STEALTH_PROFILE: Record<
  Skill,
  {
    riskWeight: number;
    lookaheadPx: number;
    enterAt: number;
    patienceMs: number;
    speedScale: number;
  }
> = {
  novice: { riskWeight: 2.6, lookaheadPx: 50, enterAt: 0, patienceMs: 4000, speedScale: 0.72 },
  average: { riskWeight: 1.3, lookaheadPx: 110, enterAt: 0.12, patienceMs: 2600, speedScale: 0.85 },
  good: { riskWeight: 0.7, lookaheadPx: 170, enterAt: 0.34, patienceMs: 1800, speedScale: 0.95 },
  expert: { riskWeight: 0.15, lookaheadPx: 230, enterAt: 0.48, patienceMs: 1200, speedScale: 1 },
};

/**
 * How hot each graph edge is - the map a player builds in their head after a few runs.
 *
 * Only edges a patrol actually walks count, plus a smaller mark on the edges leading
 * into a waypoint where someone stands and looks around. An earlier version also
 * marked every neighbour of every patrol waypoint, which coloured the whole school
 * red and made "avoid patrolled ground" indistinguishable from "take the short way".
 */
function buildRiskTable(map: SchoolMap, data: SchoolMapData): Map<string, number> {
  const risk = new Map<string, number>();
  const bump = (a: string, b: string, amount: number): void => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    risk.set(key, (risk.get(key) ?? 0) + amount);
  };
  for (const patrol of data.patrols) {
    for (let i = 1; i < patrol.route.length; i++) {
      bump(patrol.route[i - 1] as string, patrol.route[i] as string, 1);
    }
    for (const id of patrol.waitAt ?? []) {
      for (const neighbour of map.neighboursOf(id)) bump(id, neighbour, 0.5);
    }
  }
  return risk;
}

/** Dijkstra over the patrol graph with a risk-weighted edge cost. */
function planRoute(
  map: SchoolMap,
  risk: Map<string, number>,
  from: string,
  to: string,
  riskWeight: number,
): string[] {
  const distance = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, string>();
  const pending = new Set<string>([from]);

  while (pending.size > 0) {
    let current = '';
    let best = Number.POSITIVE_INFINITY;
    for (const id of pending) {
      const value = distance.get(id) ?? Number.POSITIVE_INFINITY;
      if (value < best) {
        best = value;
        current = id;
      }
    }
    pending.delete(current);
    if (current === to) break;

    const node = map.waypoint(current);
    for (const neighbourId of map.neighboursOf(current)) {
      const neighbour = map.waypoint(neighbourId);
      const key = current < neighbourId ? `${current}|${neighbourId}` : `${neighbourId}|${current}`;
      const length = Math.hypot(neighbour.x - node.x, neighbour.y - node.y);
      const cost = best + length * (1 + (risk.get(key) ?? 0) * riskWeight);
      if (cost < (distance.get(neighbourId) ?? Number.POSITIVE_INFINITY)) {
        distance.set(neighbourId, cost);
        previous.set(neighbourId, current);
        pending.add(neighbourId);
      }
    }
  }

  const path: string[] = [];
  let cursor = to;
  while (cursor !== from) {
    path.push(cursor);
    const step = previous.get(cursor);
    if (step === undefined) return [to];
    cursor = step;
  }
  return path.reverse();
}

/**
 * The strategy check: a player who ignores the teachers completely and simply runs
 * the shortest route at full speed, never waiting and never retreating.
 *
 * If THIS wins, the stealth is decoration. It is reported separately from the skill
 * ladder because it is not a skill level - it is the degenerate strategy the design
 * has to beat.
 */
const SPRINTER = {
  riskWeight: 0,
  lookaheadPx: 0,
  enterAt: Number.POSITIVE_INFINITY,
  patienceMs: 0,
  speedScale: 1,
} as const;

function simulateTeacher(rng: Rng, skill: Skill | 'sprinter'): Sample {
  const profile = skill === 'sprinter' ? SPRINTER : STEALTH_PROFILE[skill];
  const data = getSchoolMap(DEFAULT_MAP_ID);
  const map = new SchoolMap(data);
  const risk = buildRiskTable(map, data);

  const mission = generateMission(data, rng);
  const progress = new MissionProgress(mission);
  const agents = data.patrols.map(
    (patrol) =>
      new TeacherAgent(
        map,
        patrol,
        teacherConfig.teacherTypes[patrol.typeId],
        rng,
        teacherConfig.investigate,
      ),
  );
  const meters = agents.map(() => new DetectionMeter(teacherConfig.detection));

  let x = data.spawn.x;
  let y = data.spawn.y;
  let elapsed = 0;
  let idleTimeMs = 0;
  let routeDistance = 0;
  let waitedMs = 0;
  let freezeMs = 0;
  let graceMs = 0;
  let safeX = x;
  let safeY = y;

  let caughtCount = 0;
  let detectionCount = 0;
  let dangerPassCount = 0;
  const dangerPaid = new Set<string>();

  let waypoints: string[] = [];
  /** Waypoints already passed - the retreat path when a cone sweeps across us. */
  let visited: string[] = [map.nearestWaypointId(x, y)];
  let targetId = '';

  const limitMs = teacherConfig.timeLimitMs;
  const speed = teacherConfig.player.speedPxPerSec * profile.speedScale;

  const replan = (): void => {
    const checkpoint = progress.current;
    if (!checkpoint) {
      waypoints = [];
      return;
    }
    const goal = map.nearestWaypointId(checkpoint.x, checkpoint.y);
    if (targetId === checkpoint.id && waypoints.length > 0) return;
    targetId = checkpoint.id;
    waypoints = planRoute(map, risk, map.nearestWaypointId(x, y), goal, profile.riskWeight);
  };
  replan();

  /** Is anyone actually looking at this spot right now? */
  const exposedAt = (px: number, py: number): boolean =>
    agents.some((agent) => canSee(agent.position, { x: px, y: py }, agent.cone, map).visible);

  /** The same bounded setback the scene applies - see `caught.maxSetbackPx`. */
  const respawnPoint = (px: number, py: number): { x: number; y: number } => {
    const candidates = data.waypoints
      .map((node) => ({ node, distance: Math.hypot(node.x - px, node.y - py) }))
      .filter((entry) => entry.distance <= teacherConfig.caught.maxSetbackPx)
      .sort((a, b) => b.distance - a.distance);
    for (const { node } of candidates) {
      if (!exposedAt(node.x, node.y)) return { x: node.x, y: node.y };
    }
    return { x: safeX, y: safeY };
  };

  while (elapsed < limitMs && !progress.isComplete) {
    for (const agent of agents) agent.update(STEP_MS);
    elapsed += STEP_MS;
    graceMs = Math.max(0, graceMs - STEP_MS);

    if (freezeMs > 0) {
      freezeMs -= STEP_MS;
      idleTimeMs += STEP_MS;
      if (freezeMs <= 0) {
        const respawn = respawnPoint(x, y);
        x = respawn.x;
        y = respawn.y;
        graceMs = teacherConfig.caught.graceMs;
        for (const meter of meters) meter.reset();
        for (const agent of agents) agent.resetToPatrol();
        waypoints = [];
        visited = [map.nearestWaypointId(x, y)];
        targetId = '';
        replan();
      }
      continue;
    }

    // -- steering along the planned route ---------------------------------
    const checkpoint = progress.current;
    if (!checkpoint) break;
    const nextId = waypoints[0];
    const goal = nextId === undefined ? checkpoint : map.waypoint(nextId);
    const stepPx = (speed * STEP_MS) / 1000;

    // A player who is spotted ducks back the way they came. Modelling that retreat is
    // what makes "round the corner" an escape in the simulation as well as the game.
    const peak = meters.reduce((max, meter) => Math.max(max, meter.value), 0);
    const exposedNow = graceMs <= 0 && exposedAt(x, y);

    let steerX = goal.x;
    let steerY = goal.y;
    let retreating = false;
    if (exposedNow && visited.length > 0) {
      const back = map.waypoint(visited[visited.length - 1] as string);
      if (Math.hypot(back.x - x, back.y - y) < 12 && visited.length > 1) visited.pop();
      steerX = back.x;
      steerY = back.y;
      retreating = true;
    }

    const dx = steerX - x;
    const dy = steerY - y;
    const length = Math.hypot(dx, dy) || 1;

    // Would advancing put us where someone is looking?
    let blocked = false;
    if (!retreating) {
      for (const probe of [stepPx, profile.lookaheadPx * 0.5, profile.lookaheadPx]) {
        if (exposedAt(x + (dx / length) * probe, y + (dy / length) * probe)) {
          blocked = true;
          break;
        }
      }
    }
    // A bolder player walks in anyway while the meter is still low, betting on
    // breaking the sight line before it fills.
    const pushThrough =
      (profile.enterAt > 0 && peak < profile.enterAt) || waitedMs >= profile.patienceMs;

    if (blocked && !pushThrough) {
      waitedMs += STEP_MS;
      idleTimeMs += STEP_MS;
    } else {
      if (!retreating) waitedMs = 0;
      const moved = map.move(
        x,
        y,
        (dx / length) * stepPx,
        (dy / length) * stepPx,
        teacherConfig.player.radiusPx,
      );
      routeDistance += Math.hypot(moved.x - x, moved.y - y);
      x = moved.x;
      y = moved.y;
      if (!retreating && nextId !== undefined && Math.hypot(goal.x - x, goal.y - y) < 10) {
        visited.push(nextId);
        waypoints.shift();
      }
    }

    // -- detection ---------------------------------------------------------
    let caught = false;
    agents.forEach((agent, index) => {
      if (caught) return;
      const meter = meters[index] as DetectionMeter;
      const sight =
        graceMs > 0
          ? { visible: false, closeness: 0 }
          : canSee(agent.position, { x, y }, agent.cone, map);
      const result = meter.update(STEP_MS, sight.visible, sight.closeness);
      if (result.alert) {
        detectionCount += 1;
        agent.investigate({ x, y });
      }
      if (result.caught) {
        caught = true;
        caughtCount += 1;
        freezeMs = teacherConfig.caught.freezeMs;
        for (const other of meters) other.reset();
        for (const other of agents) other.resetToPatrol();
      }

      // -- danger bonus, with the same anti-farm key the scene uses --------
      const distance = Math.hypot(agent.x - x, agent.y - y);
      if (
        agent.isMoving &&
        distance <= teacherConfig.danger.distancePx &&
        Math.abs(angleDelta(agent.facing, Math.atan2(y - agent.y, x - agent.x))) <=
          degToRad(teacherConfig.danger.maxFacingAngleDeg) / 2 &&
        map.hasLineOfSight(agent.position, { x, y })
      ) {
        const key = `${agent.id}:${progress.completed}`;
        if (!dangerPaid.has(key)) {
          dangerPaid.add(key);
          dangerPassCount += 1;
        }
      }
    });
    if (caught) continue;

    // -- objectives --------------------------------------------------------
    const collected = progress.tryCollect(x, y, teacherConfig.player.checkpointRadiusPx);
    if (collected) {
      safeX = collected.x;
      safeY = collected.y;
      waypoints = [];
      visited = [map.nearestWaypointId(x, y)];
      targetId = '';
      replan();
    }
  }

  const cleared = progress.isComplete;
  const metrics = {
    cleared: cleared ? 1 : 0,
    checkpointsCompleted: progress.completed,
    timeRemainingSec: cleared ? Math.max(0, Math.floor((limitMs - elapsed) / 1000)) : 0,
    caughtCount,
    detectionCount,
    dangerPassCount: Math.min(dangerPassCount, RULES.stages.teacher.scoring.maxDangerPassCount),
    perfectStealth: caughtCount === 0 && detectionCount === 0 ? 1 : 0,
    routeDistance: Math.round(routeDistance),
    idleTimeMs,
    durationSec: Math.round(elapsed / 1000),
  };
  return { score: computeStageScore('teacher', metrics), metrics };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const SIMULATORS: Record<StageId, (rng: Rng, skill: Skill) => Sample> = {
  late: simulateLate,
  bread: simulateBread,
  teacher: simulateTeacher,
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] as number;
}

function summarise(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: percentile(sorted, 1),
    mean: Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)),
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function rankOf(stageId: StageId, score: number): string {
  const rank = RULES.stages[stageId].rank;
  if (score >= rank.S) return 'S';
  if (score >= rank.A) return 'A';
  if (score >= rank.B) return 'B';
  return 'C';
}

const results: Record<string, Record<Skill, number[]>> = {};
const metricSamples: Record<string, Record<Skill, Record<string, number>>> = {};

for (const stageId of RULES.stageOrder) {
  results[stageId] = { novice: [], average: [], good: [], expert: [] };
  metricSamples[stageId] = {} as Record<Skill, Record<string, number>>;

  for (const skill of SKILLS) {
    const totals: Record<string, number> = {};
    for (let run = 0; run < RUNS; run++) {
      const rng = createRng(deriveSeed(run * 7919 + 13, stageId));
      const sample = SIMULATORS[stageId](rng, skill);
      results[stageId]![skill].push(sample.score);
      for (const [key, value] of Object.entries(sample.metrics)) {
        totals[key] = (totals[key] ?? 0) + value;
      }
    }
    metricSamples[stageId]![skill] = Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [key, Math.round((value / RUNS) * 10) / 10]),
    );
  }
}

console.info('');
console.info(
  `KOMATO RUSH - balance report (configVersion ${RULES.configVersion}, ${RUNS} runs/skill)`,
);
console.info('='.repeat(78));

for (const stageId of RULES.stageOrder) {
  const rank = RULES.stages[stageId].rank;
  console.info('');
  console.info(`## ${stageId}   ranks: S>=${rank.S}  A>=${rank.A}  B>=${rank.B}`);
  console.info(
    `   ${'skill'.padEnd(9)}${pad('p10', 8)}${pad('median', 8)}${pad('p90', 8)}${pad('max', 8)}   rank(median)`,
  );

  for (const skill of SKILLS) {
    const stats = summarise(results[stageId]![skill]);
    console.info(
      `   ${skill.padEnd(9)}${pad(stats.p10, 8)}${pad(stats.median, 8)}${pad(stats.p90, 8)}${pad(stats.max, 8)}   ${rankOf(stageId, stats.median)}`,
    );
  }
  for (const skill of SKILLS) {
    console.info(`   ${skill.padEnd(9)}metrics ${JSON.stringify(metricSamples[stageId]![skill])}`);
  }
}

console.info('');
console.info('## totals (same skill across all three stages)');
console.info(
  `   ${'skill'.padEnd(9)}${pad('p10', 9)}${pad('median', 9)}${pad('p90', 9)}   share per stage (median)`,
);

for (const skill of SKILLS) {
  const totals: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    let sum = 0;
    for (const stageId of RULES.stageOrder) sum += results[stageId]![skill][run] ?? 0;
    totals.push(sum);
  }
  const stats = summarise(totals);
  const shares = RULES.stageOrder
    .map((stageId) => {
      const median = summarise(results[stageId]![skill]).median;
      return `${stageId} ${Math.round((median / Math.max(1, stats.median)) * 100)}%`;
    })
    .join('  ');
  console.info(
    `   ${skill.padEnd(9)}${pad(stats.p10, 9)}${pad(stats.median, 9)}${pad(stats.p90, 9)}   ${shares}`,
  );
}

console.info('');
// ---------------------------------------------------------------------------
// Strategy check: is the stealth actually load-bearing?
// ---------------------------------------------------------------------------
{
  const sprintScores: number[] = [];
  let sprintCaught = 0;
  let sprintSeconds = 0;
  for (let run = 0; run < RUNS; run++) {
    const rng = createRng(deriveSeed(run * 7919 + 13, 'teacher'));
    const sample = simulateTeacher(rng, 'sprinter');
    sprintScores.push(sample.score);
    sprintCaught += sample.metrics.caughtCount ?? 0;
    sprintSeconds += sample.metrics.durationSec ?? 0;
  }
  const sprint = summarise(sprintScores);
  const expert = summarise(results.teacher?.expert ?? []);

  console.info('');
  console.info('## strategy check - a player who ignores the teachers and just runs');
  console.info(
    `   sprinter median ${pad(sprint.median, 6)}   caught/run ${(sprintCaught / RUNS).toFixed(1)}` +
      `   avg ${(sprintSeconds / RUNS).toFixed(1)}s`,
  );
  console.info(`   expert   median ${pad(expert.median, 6)}`);
  console.info(
    sprint.median > expert.median
      ? '   *** IGNORING THE TEACHERS WINS - the stealth is decoration, fix the balance ***'
      : '   ok: playing carefully beats running blindly',
  );
  console.info('');
}

console.info('Balance targets:');
console.info('  - each stage contributes a comparable share of the total (no stage dominates)');
console.info('  - median average-player = B, good = A, expert = S');
console.info('');
