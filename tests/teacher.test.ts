/**
 * STAGE 3 - the stealth model.
 *
 * Everything that decides whether the stage is fair lives in pure modules, so it can
 * be asserted here rather than discovered on a phone: the map is structurally sound,
 * a teacher cannot see through a wall, one frame in a cone is not fatal, a corner is
 * a real escape, and the same seed produces the same run.
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '@/config/rules';
import {
  DEFAULT_MAP_ID,
  allSchoolMaps,
  getSchoolMap,
  teacherConfig,
  type MapPatrol,
  type Rect,
} from '@/config/stages/teacher';
import { SchoolMap, validateSchoolMap } from '@/game/stages/teacher/map/SchoolMap';
import { degToRad, segmentIntersectsRect } from '@/game/stages/teacher/map/geometry';
import { TeacherAgent } from '@/game/stages/teacher/sim/TeacherAgent';
import { DetectionMeter } from '@/game/stages/teacher/sim/DetectionMeter';
import { canSee } from '@/game/stages/teacher/sim/vision';
import { generateMission, MissionProgress } from '@/game/stages/teacher/sim/mission';
import { DragVector } from '@/game/core/DragVector';
import { computeStageScore } from '@/game/core/scoring';
import { validateSubmission } from '@/services/run/validation';
import { getStageModule } from '@/game/stages';
import { createRng } from '@/utils/rng';

const data = getSchoolMap(DEFAULT_MAP_ID);
const map = new SchoolMap(data);
const PLAYER_RADIUS = teacherConfig.player.radiusPx;

/** A cone that sees a long way in every direction, for isolating one variable. */
const WIDE_CONE = { facing: 0, distancePx: 5000, halfAngleRad: Math.PI };

function agentFor(patrol: MapPatrol, seed = 1): TeacherAgent {
  return new TeacherAgent(
    map,
    patrol,
    teacherConfig.teacherTypes[patrol.typeId],
    createRng(seed),
    teacherConfig.investigate,
  );
}

// ---------------------------------------------------------------------------
// Map data
// ---------------------------------------------------------------------------

describe('school map data', () => {
  it.each(allSchoolMaps().map((entry) => [entry.id, entry] as const))(
    '%s is structurally valid',
    (_id, entry) => {
      // Catches the authoring slips that would otherwise strand a player inside a
      // wall: a patrol leg that clips a door frame, a checkpoint in the masonry, a
      // mission that never reaches the exit.
      expect(validateSchoolMap(entry, PLAYER_RADIUS)).toEqual([]);
    },
  );

  it('keeps the player inside the building', () => {
    const { bounds } = data;
    const outside = map.move(data.spawn.x, data.spawn.y, 0, 99_999, PLAYER_RADIUS);

    expect(outside.y).toBeLessThanOrEqual(bounds.y + bounds.height);
    expect(map.isWalkable(outside.x, outside.y, PLAYER_RADIUS)).toBe(true);
  });

  it('refuses to walk through a wall', () => {
    // Straight north out of the entrance hall is the hall's own front wall.
    const wall = data.walls.find((entry) => entry.note === '昇降口 前壁（左）');
    expect(wall).toBeDefined();
    const rect = (wall as { rect: Rect }).rect;
    const startX = rect.x + rect.width / 2;

    const moved = map.move(startX, rect.y + 240, 0, -400, PLAYER_RADIUS);

    expect(moved.blocked).toBe(true);
    expect(moved.y).toBeGreaterThan(rect.y + rect.height);
    expect(map.isWalkable(moved.x, moved.y, PLAYER_RADIUS)).toBe(true);
  });

  it('slides along a wall instead of sticking to it', () => {
    // Pushing diagonally into the side of a corridor must still make progress.
    const corridor = map.waypoint('so_c');
    const moved = map.move(corridor.x, corridor.y, 60, 600, PLAYER_RADIUS);

    expect(Math.abs(moved.x - corridor.x)).toBeGreaterThan(1);
  });

  it('offers a short dangerous route and a long safe one to the same place', () => {
    // Requirement 34. The central corridor is the short way north; the east
    // perimeter is the long way. If these ever converge the stage loses its point.
    const legLength = (ids: readonly string[]): number => {
      let total = 0;
      for (let i = 1; i < ids.length; i++) {
        const a = map.waypoint(ids[i - 1] as string);
        const b = map.waypoint(ids[i] as string);
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return total;
    };

    const central = legLength(['so_c', 's_low', 'm_c', 'c_e', 'd_staff']);
    const perimeter = legLength([
      'so_c',
      'so_e',
      'e_low',
      'm_e',
      'e_tool',
      'e_stair',
      'n_e',
      'd_b',
      'n_ce',
      'd_staff',
    ]);

    expect(perimeter).toBeGreaterThan(central * 1.4);
    // ...and the short one has to be the patrolled one, or it is simply better.
    const patrolled = new Set(data.patrols.flatMap((patrol) => patrol.route));
    expect(patrolled.has('c_e')).toBe(true);
    expect(patrolled.has('d_staff')).toBe(true);
  });

  it('finds a path between any two waypoints', () => {
    const path = map.findPath('hall', 'r_b');

    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toBe('r_b');
    for (let i = 0; i < path.length; i++) {
      const from = i === 0 ? 'hall' : (path[i - 1] as string);
      expect(map.areEdgeConnected(from, path[i] as string)).toBe(true);
    }
  });

  it('returns an empty path for an unreachable target rather than throwing', () => {
    expect(map.findPath('hall', 'hall')).toEqual([]);
    expect(map.findPath('hall', 'nowhere')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

describe('teacher patrol', () => {
  it('walks its route in order and then back again', () => {
    const patrol: MapPatrol = {
      id: 'test',
      typeId: 'normal',
      route: ['so_w', 'so_cw', 'so_c', 'so_e'],
      startIndex: 0,
    };
    const agent = agentFor(patrol);

    // Arrivals are measured against the route's own nodes: `nearestWaypointId` would
    // also report side rooms the patrol walks past, which is not what we are asserting.
    const visited: string[] = [];
    for (let i = 0; i < 4000; i++) {
      agent.update(16);
      for (const id of patrol.route) {
        const node = map.waypoint(id);
        if (Math.hypot(node.x - agent.x, node.y - agent.y) < 6) {
          if (visited[visited.length - 1] !== id) visited.push(id);
        }
      }
    }

    // The ping-pong (A-B-C-D-C-B-A) is what makes a patrol learnable.
    expect(visited.slice(0, 4)).toEqual(['so_w', 'so_cw', 'so_c', 'so_e']);
    expect(visited.slice(4, 7)).toEqual(['so_c', 'so_cw', 'so_w']);
  });

  it('never leaves the walkable floor', () => {
    for (const patrol of data.patrols) {
      const agent = agentFor(patrol, 7);
      for (let i = 0; i < 3000; i++) {
        agent.update(16);
        expect(map.isWalkable(agent.x, agent.y, 4), `${patrol.id} left the building`).toBe(true);
      }
    }
  });

  it('is deterministic for a given seed, and varies with it', () => {
    const trace = (seed: number): string =>
      (() => {
        const agent = agentFor(data.patrols[0] as MapPatrol, seed);
        const samples: string[] = [];
        for (let i = 0; i < 900; i++) {
          agent.update(16);
          if (i % 100 === 0) samples.push(`${Math.round(agent.x)},${Math.round(agent.y)}`);
        }
        return samples.join('|');
      })();

    expect(trace(42)).toBe(trace(42));
    expect(trace(1)).not.toBe(trace(2));
  });

  it('stops to look around at its designated waypoints', () => {
    const patrol = data.patrols.find((entry) => (entry.waitAt ?? []).length > 0);
    expect(patrol).toBeDefined();
    const agent = agentFor(patrol as MapPatrol, 3);

    const states = new Set<string>();
    for (let i = 0; i < 6000; i++) {
      agent.update(16);
      states.add(agent.currentState);
    }

    expect(states.has('WAIT')).toBe(true);
  });

  it('walks toward where the player was last seen, then returns to its beat', () => {
    const patrol = data.patrols.find((entry) => entry.id === 'south') as MapPatrol;
    const agent = agentFor(patrol, 5);
    for (let i = 0; i < 200; i++) agent.update(16);

    const target = map.waypoint('so_cw');
    const before = Math.hypot(agent.x - target.x, agent.y - target.y);

    agent.investigate({ x: target.x, y: target.y });
    expect(agent.currentState).toBe('INVESTIGATE');

    let closest = before;
    for (let i = 0; i < 600; i++) {
      agent.update(16);
      closest = Math.min(closest, Math.hypot(agent.x - target.x, agent.y - target.y));
    }

    expect(closest).toBeLessThan(before);

    // And they must not stay off their beat forever - the search times out.
    for (let i = 0; i < 6000 && agent.currentState !== 'PATROL'; i++) agent.update(16);
    expect(agent.currentState).toBe('PATROL');
  });

  it('gives the player a calm opening: nobody can see the spawn point', () => {
    // Requirement 53. Checked across seeds because the start offset is seeded.
    for (let seed = 0; seed < 40; seed++) {
      for (const patrol of data.patrols) {
        const agent = agentFor(patrol, seed);
        const sight = canSee(agent.position, data.spawn, agent.cone, map);

        expect(sight.visible, `${patrol.id} can see the spawn (seed ${seed})`).toBe(false);
        expect(sight.distance, `${patrol.id} starts on top of the player`).toBeGreaterThan(
          teacherConfig.safeSpawnRadiusPx,
        );
      }
    }
  });

  it('keeps the spawn unwatched for the whole opening grace period', () => {
    // Not just at t=0: the first version of this map had the exit guard waiting
    // directly outside the entrance hall, so stepping through the door a few seconds
    // in was an instant catch. A player must have time to read the screen first.
    const frames = Math.ceil(teacherConfig.openingGraceMs / 16);

    for (let seed = 0; seed < 25; seed++) {
      const agents = data.patrols.map((patrol) => agentFor(patrol, seed));
      for (let frame = 0; frame < frames; frame++) {
        for (const agent of agents) {
          agent.update(16);
          expect(
            canSee(agent.position, data.spawn, agent.cone, map).visible,
            `${agent.id} can see the spawn ${Math.round(frame * 16)}ms in (seed ${seed})`,
          ).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

describe('vision', () => {
  const corridor = { x: 1240, y: 1400 };

  it('sees a target straight ahead and inside range', () => {
    const sight = canSee(
      corridor,
      { x: 1240, y: 1600 },
      { facing: Math.PI / 2, distancePx: 400, halfAngleRad: degToRad(70) / 2 },
      map,
    );

    expect(sight.visible).toBe(true);
    expect(sight.closeness).toBeGreaterThan(0);
  });

  it('does not see past its view distance', () => {
    expect(
      canSee(
        corridor,
        { x: 1240, y: 1750 },
        { facing: Math.PI / 2, distancePx: 200, halfAngleRad: Math.PI },
        map,
      ).visible,
    ).toBe(false);
  });

  it('does not see outside its cone, however close', () => {
    // Directly behind them.
    expect(
      canSee(
        corridor,
        { x: 1240, y: 1330 },
        { facing: Math.PI / 2, distancePx: 600, halfAngleRad: degToRad(70) / 2 },
        map,
      ).visible,
    ).toBe(false);
  });

  it('cannot see through a wall', () => {
    // The staff room and the classroom next door are separated by solid masonry.
    const staffRoom = { x: 1240, y: 380 };
    const classroomB = { x: 1910, y: 380 };

    expect(map.hasLineOfSight(staffRoom, classroomB)).toBe(false);
    expect(canSee(staffRoom, classroomB, WIDE_CONE, map).visible).toBe(false);
    // ...but the same distance along the open corridor is visible.
    expect(canSee({ x: 1240, y: 650 }, { x: 1910, y: 650 }, WIDE_CONE, map).visible).toBe(true);
  });

  it('has every wall actually block a ray that crosses it', () => {
    // Guards the occlusion primitive itself rather than one hand-picked case.
    for (const wall of data.walls) {
      const { rect } = wall;
      const left = { x: rect.x - 30, y: rect.y + rect.height / 2 };
      const right = { x: rect.x + rect.width + 30, y: rect.y + rect.height / 2 };

      expect(segmentIntersectsRect(left.x, left.y, right.x, right.y, rect)).toBe(true);
      expect(map.hasLineOfSight(left, right)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe('detection meter', () => {
  const config = teacherConfig.detection;
  const meter = (): DetectionMeter => new DetectionMeter(config);

  it('does not trigger on a single frame in a cone', () => {
    // Requirement 20: being brushed by a cone must never be instantly fatal.
    const detection = meter();
    const result = detection.update(16, true, 0);

    expect(result.caught).toBe(false);
    expect(detection.value).toBeLessThan(0.1);
  });

  it('catches the player after sustained exposure', () => {
    const detection = meter();
    let caught = false;
    for (let i = 0; i < 400 && !caught; i++) caught = detection.update(16, true, 0).caught;

    expect(caught).toBe(true);
  });

  it('catches far faster at point-blank range than at the edge of the cone', () => {
    const timeToCatch = (closeness: number): number => {
      const detection = meter();
      let elapsed = 0;
      while (!detection.update(16, true, closeness).caught && elapsed < 20_000) elapsed += 16;
      return elapsed;
    };

    expect(timeToCatch(1)).toBeLessThan(timeToCatch(0) / 2);
    // Walking straight into someone has to be about as punishing as it feels.
    expect(timeToCatch(1)).toBeLessThan(700);
  });

  it('drains once the sight line is broken, so a corner is a real escape', () => {
    const detection = meter();
    for (let i = 0; i < 30; i++) detection.update(16, true, 0.4);
    const peak = detection.value;
    expect(peak).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) detection.update(16, false);

    expect(detection.value).toBeLessThan(peak);
  });

  it('fully clears given enough time behind cover, and never goes negative', () => {
    const detection = meter();
    for (let i = 0; i < 40; i++) detection.update(16, true, 0.5);
    for (let i = 0; i < 400; i++) detection.update(16, false);

    expect(detection.value).toBe(0);
  });

  it('counts one continuous exposure as one detection, not sixty', () => {
    const detection = meter();
    let alerts = 0;
    for (let i = 0; i < 200; i++) {
      if (detection.update(16, true, 0.9).alert) alerts += 1;
      if (detection.isFull) break;
    }

    expect(alerts).toBe(1);
  });

  it('re-arms only after the meter has fully drained', () => {
    const detection = meter();
    let alerts = 0;
    const expose = (frames: number): void => {
      for (let i = 0; i < frames; i++) if (detection.update(16, true, 1).alert) alerts += 1;
    };
    const hide = (frames: number): void => {
      for (let i = 0; i < frames; i++) detection.update(16, false);
    };

    expose(30);
    hide(200); // long enough to clear completely
    expose(30);

    expect(alerts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

describe('mission generation', () => {
  it('always ends at the exit and never repeats a stop', () => {
    for (let seed = 0; seed < 60; seed++) {
      const mission = generateMission(data, createRng(seed));
      const last = mission.checkpoints[mission.checkpoints.length - 1];

      expect(last?.kind).toBe('exit');
      expect(new Set(mission.checkpoints.map((c) => c.id)).size).toBe(mission.checkpoints.length);
      expect(mission.checkpoints.length).toBeGreaterThanOrEqual(
        RULES.stages.teacher.limits.minCheckpointCount,
      );
      expect(mission.checkpoints.length).toBeLessThanOrEqual(
        RULES.stages.teacher.limits.maxCheckpointCount,
      );
    }
  });

  it('is deterministic for a given seed', () => {
    const describe = (seed: number): string =>
      generateMission(data, createRng(seed))
        .checkpoints.map((c) => c.id)
        .join('>');

    expect(describe(2024)).toBe(describe(2024));
  });

  it('varies between runs without becoming a lottery', () => {
    // Requirement 36: learn the patterns, but still read the objective list.
    const routes = new Set<string>();
    const patterns = new Set<string>();
    for (let seed = 0; seed < 80; seed++) {
      const mission = generateMission(data, createRng(seed));
      patterns.add(mission.patternId);
      routes.add(mission.checkpoints.map((c) => c.id).join('>'));
    }

    expect(patterns.size).toBe(data.missions.length);
    expect(routes.size).toBeGreaterThan(patterns.size); // the alternatives do something
    expect(routes.size).toBeLessThanOrEqual(patterns.size * 2);
  });

  it('honours a forced pattern without shifting the rest of the seeded run', () => {
    const forced = generateMission(data, createRng(9), 'C');
    expect(forced.patternId).toBe('C');

    // An unknown id is a debugging affordance, not an API: fall back, do not throw.
    expect(() => generateMission(data, createRng(9), 'nope')).not.toThrow();
  });
});

describe('mission progress', () => {
  const mission = generateMission(data, createRng(11));
  const radius = teacherConfig.player.checkpointRadiusPx;

  it('collects checkpoints in order, and only on arrival', () => {
    const progress = new MissionProgress(mission);
    const first = mission.checkpoints[0]!;
    const second = mission.checkpoints[1]!;

    // Standing on the SECOND objective does nothing while the first is still live.
    expect(progress.tryCollect(second.x, second.y, radius)).toBeNull();
    expect(progress.completed).toBe(0);

    expect(progress.tryCollect(first.x, first.y, radius)?.id).toBe(first.id);
    expect(progress.completed).toBe(1);
    expect(progress.current?.id).toBe(second.id);
  });

  it('needs the player to actually be close - no button, but no free pickups', () => {
    const progress = new MissionProgress(mission);
    const first = mission.checkpoints[0]!;

    expect(progress.tryCollect(first.x + radius + 40, first.y, radius)).toBeNull();
    expect(progress.tryCollect(first.x + radius - 5, first.y, radius)).not.toBeNull();
  });

  it('reports the final leg so the escape phase can be announced', () => {
    const progress = new MissionProgress(mission);
    for (const checkpoint of mission.checkpoints.slice(0, -1)) {
      progress.tryCollect(checkpoint.x, checkpoint.y, radius);
    }

    expect(progress.isFinalLeg).toBe(true);
    expect(progress.current?.kind).toBe('exit');

    const exit = mission.checkpoints[mission.checkpoints.length - 1]!;
    progress.tryCollect(exit.x, exit.y, radius);

    expect(progress.isComplete).toBe(true);
    expect(progress.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

describe('relative drag steering', () => {
  const options = teacherConfig.input;
  const make = (): DragVector => new DragVector(options);

  it('does nothing until the finger moves out of the dead zone', () => {
    const drag = make();
    drag.start(200, 600);
    drag.move(200 + options.deadZonePx - 1, 600);

    expect(drag.magnitude).toBe(0);
    expect(drag.x).toBe(0);
  });

  it('moves in the direction of travel, not toward the finger', () => {
    const drag = make();
    drag.start(300, 700);
    drag.move(300, 700 - options.fullSpeedPx); // dragged upward

    expect(drag.y).toBeLessThan(0);
    expect(Math.abs(drag.x)).toBeLessThan(0.001);
  });

  it('never makes a diagonal faster than a straight line', () => {
    // The classic bug: sqrt(2) times the speed on a diagonal.
    const straight = make();
    straight.start(0, 0);
    straight.move(options.fullSpeedPx * 3, 0);

    const diagonal = make();
    diagonal.start(0, 0);
    diagonal.move(options.fullSpeedPx * 3, options.fullSpeedPx * 3);

    expect(straight.magnitude).toBeCloseTo(1, 5);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 5);
  });

  it('drags the anchor along so a long swipe never saturates', () => {
    const drag = make();
    drag.start(100, 100);
    drag.move(100 + options.maxOffsetPx * 4, 100);

    expect(drag.anchor.x).toBeGreaterThan(100);
    expect(drag.magnitude).toBeCloseTo(1, 5);

    // Reversing direction responds immediately rather than travelling back to 0.
    drag.move(drag.anchor.x - options.fullSpeedPx, 100);
    expect(drag.x).toBeLessThan(0);
  });

  it('stops dead when the touch ends or is cancelled', () => {
    const drag = make();
    drag.start(100, 100);
    drag.move(300, 100);
    expect(drag.magnitude).toBeGreaterThan(0);

    drag.end();

    expect(drag.isActive).toBe(false);
    expect(drag.magnitude).toBe(0);
    // A stray move after the touch ended must not restart it.
    drag.move(500, 100);
    expect(drag.magnitude).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

describe('stage result', () => {
  const stage = getStageModule('teacher');

  it('produces a submission the validator accepts', () => {
    const result = stage.debugSampleResult?.();
    expect(result).toBeDefined();

    const outcome = validateSubmission([
      {
        stageId: 'teacher',
        score: result!.score,
        durationMs: result!.durationMs,
        metrics: result!.metrics as Record<string, number>,
      },
    ]);

    expect(outcome.issues.filter((issue) => issue.code !== 'run_too_short')).toEqual([]);
    expect(outcome.stageScores.teacher).toBe(result!.score);
  });

  it('carries every metric the score formula and the validator read', () => {
    const metrics = stage.debugSampleResult?.().metrics ?? {};

    for (const key of [
      'cleared',
      'checkpointsCompleted',
      'timeRemainingSec',
      'caughtCount',
      'detectionCount',
      'dangerPassCount',
      'perfectStealth',
      'routeDistance',
      'idleTimeMs',
    ]) {
      expect(metrics[key], key).toBeDefined();
    }
  });

  it('renders result rows for a run that ended without clearing', () => {
    const rows = stage.formatMetrics({ cleared: 0, checkpointsCompleted: 1 });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.value).toContain('時間切れ');
  });

  it('scores a faster escape higher than a slower one', () => {
    const base = { cleared: 1, checkpointsCompleted: 3, caughtCount: 0, detectionCount: 0 };

    expect(computeStageScore('teacher', { ...base, timeRemainingSec: 55 })).toBeGreaterThan(
      computeStageScore('teacher', { ...base, timeRemainingSec: 40 }),
    );
  });

  it('makes waiting for safety a real cost, not a free option', () => {
    // Requirement 33: hiding until the corridor is empty must never be optimal.
    const free = RULES.stages.teacher.scoring.timeBonusFreeSec;
    const perfectButSlow = computeStageScore('teacher', {
      cleared: 1,
      checkpointsCompleted: 3,
      timeRemainingSec: free + 5,
      caughtCount: 0,
      detectionCount: 0,
    });
    const spottedButFast = computeStageScore('teacher', {
      cleared: 1,
      checkpointsCompleted: 3,
      timeRemainingSec: free + 25,
      caughtCount: 0,
      detectionCount: 4,
    });

    expect(spottedButFast).toBeGreaterThan(perfectButSlow);
  });
});
