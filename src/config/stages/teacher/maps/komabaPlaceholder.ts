/**
 * Placeholder school map - "駒東っぽい校舎" simplified to a playable floor plan.
 *
 * THIS FILE IS DATA. Replacing it with a map traced from the real building means
 * editing (or adding) a file like this one and pointing `DEFAULT_MAP_ID` at it.
 * No gameplay code changes. See docs/GAME_DESIGN.md → "マップを差し替える".
 *
 * Layout (world pixels, y grows downward):
 *
 *      x:120        700     1150 1330      1700      2100 2280
 *   y:140 ┌──────────┬────────┬───────────┬──────────────┐
 *         │  教室A    │  職員室 │           │    教室B      │
 *   560   ├──────────┴────────┴───────────┴──────────────┤
 *         │                 北 廊 下                      │  <- 3 doors
 *   740   ├───┬──────────────┬──┬─────────────────────┬───┤
 *         │ 西 │  西階段       │中│      東階段          │ 東 │
 *         │ 廊 ├──────────────┤央│─────────────────────┤ 廊 │
 *   1240  │ 下 │  渡り廊下      │廊│                     │ 下 │
 *   1420  │   ├──────────────┤下├─────────────────────┤   │
 *         │   │              │  │      用具室(行止)     │   │
 *   1820  ├───┴──────────────┴──┴─────────────────────┴───┤
 *         │                 中 央 廊 下                    │
 *   2000  ├───┬──────────────┬──┬─────────────────────┬───┤
 *         │   │   図書室      │  │      ロッカー室       │   │
 *   2560  ├───┴──────────────┴──┴─────────────────────┴───┤
 *         │                 南 廊 下                      │
 *   2740  ├─────────────────┬──────┬─────────────────────┤
 *         │                 │ 昇降口 │                     │
 *   3040  └─────────────────┴──────┴─────────────────────┘
 *
 * THE CORE DESIGN: from the entrance hall to the north wing there is a straight
 * central corridor (fast, two teachers on it) and a west / east perimeter loop
 * (roughly 1.6x longer, one slow teacher each). That is the risk/reward choice the
 * whole stage is built on.
 */
import type { MapEdge, MapWall, SchoolMapData } from '../mapTypes';

/** Keeps the wall table below to one readable line per block. */
function wall(x: number, y: number, width: number, height: number, note?: string): MapWall {
  return note === undefined
    ? { rect: { x, y, width, height } }
    : { rect: { x, y, width, height }, note };
}

/** Both directions are always walkable, so edges are declared once. */
function edges(...pairs: readonly (readonly [string, string])[]): readonly MapEdge[] {
  return pairs;
}

export const komabaPlaceholderMap: SchoolMapData = {
  id: 'komabaPlaceholder',
  name: '駒東（仮）校舎',
  bounds: { x: 0, y: 0, width: 2400, height: 3160 },

  // -- walkable areas: floor look + room names (NOT collision) ---------------
  areas: [
    {
      id: 'corridorNorth',
      name: '北廊下',
      kind: 'corridor',
      rect: { x: 120, y: 560, width: 2160, height: 180 },
    },
    {
      id: 'corridorMiddle',
      name: '中央廊下',
      kind: 'corridor',
      rect: { x: 120, y: 1820, width: 2160, height: 180 },
    },
    {
      id: 'corridorSouth',
      name: '南廊下',
      kind: 'corridor',
      rect: { x: 120, y: 2560, width: 2160, height: 180 },
    },
    {
      id: 'corridorWestUpper',
      name: '西廊下',
      kind: 'corridor',
      rect: { x: 120, y: 740, width: 180, height: 1080 },
    },
    {
      id: 'corridorWestLower',
      name: '西廊下',
      kind: 'corridor',
      rect: { x: 120, y: 2000, width: 180, height: 560 },
    },
    {
      id: 'corridorEastUpper',
      name: '東廊下',
      kind: 'corridor',
      rect: { x: 2100, y: 740, width: 180, height: 1080 },
    },
    {
      id: 'corridorEastLower',
      name: '東廊下',
      kind: 'corridor',
      rect: { x: 2100, y: 2000, width: 180, height: 560 },
    },
    {
      id: 'corridorSpineUpper',
      name: '中央連絡通路',
      kind: 'corridor',
      rect: { x: 1150, y: 740, width: 180, height: 1080 },
    },
    {
      id: 'corridorSpineLower',
      name: '中央連絡通路',
      kind: 'corridor',
      rect: { x: 1150, y: 2000, width: 180, height: 560 },
    },
    {
      id: 'corridorCross',
      name: '渡り廊下',
      kind: 'corridor',
      rect: { x: 300, y: 1240, width: 850, height: 180 },
    },
    // Recesses off the central corridor. Small, but enough to break a sight line -
    // without them the fast route is a kill box rather than a risk.
    {
      id: 'alcoveWest',
      name: '物置',
      kind: 'room',
      rect: { x: 1030, y: 940, width: 120, height: 120 },
    },
    {
      id: 'alcoveEast',
      name: '掲示板前',
      kind: 'room',
      rect: { x: 1330, y: 1280, width: 120, height: 120 },
    },
    {
      id: 'classroomA',
      name: '教室A',
      kind: 'classroom',
      rect: { x: 200, y: 140, width: 560, height: 420 },
    },
    {
      id: 'staffRoom',
      name: '職員室',
      kind: 'room',
      rect: { x: 900, y: 140, width: 580, height: 420 },
    },
    {
      id: 'classroomB',
      name: '教室B',
      kind: 'classroom',
      rect: { x: 1620, y: 140, width: 580, height: 420 },
    },
    {
      id: 'stairsWest',
      name: '西階段',
      kind: 'stairs',
      rect: { x: 300, y: 820, width: 400, height: 360 },
    },
    {
      id: 'stairsEast',
      name: '東階段',
      kind: 'stairs',
      rect: { x: 1700, y: 820, width: 400, height: 360 },
    },
    {
      id: 'storeroom',
      name: '用具室',
      kind: 'room',
      rect: { x: 1700, y: 1500, width: 400, height: 260 },
    },
    {
      id: 'library',
      name: '図書室',
      kind: 'room',
      rect: { x: 460, y: 2060, width: 600, height: 440 },
    },
    {
      id: 'lockerRoom',
      name: 'ロッカー室',
      kind: 'room',
      rect: { x: 1420, y: 2060, width: 620, height: 440 },
    },
    {
      id: 'entranceHall',
      name: '昇降口',
      kind: 'lobby',
      rect: { x: 860, y: 2740, width: 680, height: 300 },
    },
  ],

  // -- solids: block walking AND sight ---------------------------------------
  walls: [
    // outer shell
    wall(0, 0, 2400, 140, '北外壁'),
    wall(0, 3040, 2400, 120, '南外壁'),
    wall(0, 0, 120, 3160, '西外壁'),
    wall(2280, 0, 120, 3160, '東外壁'),

    // north room band + the partition that turns each room into a doored space
    wall(120, 140, 80, 420),
    wall(760, 140, 140, 420),
    wall(1480, 140, 140, 420),
    wall(2200, 140, 80, 420),
    wall(200, 536, 220, 24, '教室A 前壁（左）'),
    wall(560, 536, 200, 24, '教室A 前壁（右）'),
    wall(900, 536, 250, 24, '職員室 前壁（左）'),
    wall(1290, 536, 190, 24, '職員室 前壁（右）'),
    wall(1620, 536, 220, 24, '教室B 前壁（左）'),
    wall(1980, 536, 220, 24, '教室B 前壁（右）'),

    // west block: stairwell, the cross corridor, and the solid mass around them
    wall(300, 740, 850, 80),
    wall(700, 820, 450, 120),
    wall(700, 940, 330, 120, '西側の窪み（物置）を残す'),
    wall(700, 1060, 450, 120),
    wall(300, 1180, 850, 60),
    wall(300, 1420, 850, 400),
    wall(300, 820, 24, 120, '西階段 扉（上）'),
    wall(300, 1080, 24, 100, '西階段 扉（下）'),

    // east block: stairwell and the dead-end store room
    wall(1330, 740, 770, 80),
    wall(1330, 820, 370, 360),
    wall(1330, 1180, 770, 100),
    wall(1450, 1280, 650, 120, '東側の窪み（掲示板前）を残す'),
    wall(1330, 1400, 770, 100),
    wall(1330, 1500, 370, 260),
    wall(1330, 1760, 770, 60),
    wall(2076, 820, 24, 120, '東階段 扉（上）'),
    wall(2076, 1080, 24, 100, '東階段 扉（下）'),
    wall(2076, 1500, 24, 100, '用具室 扉（上）'),
    wall(2076, 1700, 24, 60, '用具室 扉（下）'),

    // south room band
    wall(300, 2000, 850, 60),
    wall(1330, 2000, 310, 60, 'ロッカー室 前壁（左）'),
    wall(1780, 2000, 320, 60, 'ロッカー室 前壁（右）'),
    wall(300, 2060, 160, 440),
    wall(1060, 2060, 90, 440),
    wall(1330, 2060, 90, 440),
    wall(2040, 2060, 60, 440),
    wall(300, 2500, 400, 60, '図書室 前壁（左）'),
    wall(840, 2500, 310, 60, '図書室 前壁（右）'),
    wall(1330, 2500, 770, 60),

    // entrance hall
    wall(120, 2740, 740, 300),
    wall(1540, 2740, 740, 300),
    wall(860, 2740, 260, 24, '昇降口 前壁（左）'),
    wall(1320, 2740, 220, 24, '昇降口 前壁（右）'),
  ],

  // -- patrol graph ----------------------------------------------------------
  waypoints: [
    { id: 'n_w', x: 210, y: 650 },
    { id: 'd_a', x: 490, y: 650 },
    { id: 'n_cw', x: 700, y: 650 },
    { id: 'd_staff', x: 1240, y: 650 },
    { id: 'n_ce', x: 1700, y: 650 },
    { id: 'd_b', x: 1910, y: 650 },
    { id: 'n_e', x: 2190, y: 650 },
    { id: 'r_a', x: 490, y: 380 },
    { id: 'r_staff', x: 1240, y: 380 },
    { id: 'r_b', x: 1910, y: 380 },
    { id: 'w_stair', x: 210, y: 1010 },
    { id: 'st_w', x: 500, y: 1010 },
    { id: 'c_w', x: 210, y: 1330 },
    { id: 'c_mid', x: 700, y: 1330 },
    { id: 'c_e', x: 1240, y: 1330 },
    { id: 'e_stair', x: 2190, y: 1010 },
    { id: 'st_e', x: 1890, y: 1010 },
    { id: 'e_tool', x: 2190, y: 1650 },
    { id: 'st_tool', x: 1890, y: 1650 },
    { id: 'm_w', x: 210, y: 1910 },
    { id: 'm_cw', x: 700, y: 1910 },
    { id: 'm_c', x: 1240, y: 1910 },
    { id: 'm_ce', x: 1710, y: 1910 },
    { id: 'm_e', x: 2190, y: 1910 },
    { id: 'w_low', x: 210, y: 2280 },
    { id: 'e_low', x: 2190, y: 2280 },
    { id: 'lib', x: 760, y: 2280 },
    { id: 'loc', x: 1730, y: 2280 },
    { id: 's_low', x: 1240, y: 2280 },
    { id: 'so_w', x: 210, y: 2650 },
    { id: 'so_cw', x: 770, y: 2650 },
    { id: 'so_c', x: 1240, y: 2650 },
    { id: 'so_e', x: 2190, y: 2650 },
    { id: 'hall', x: 1240, y: 2890 },
  ],

  edges: edges(
    ['n_w', 'd_a'],
    ['d_a', 'n_cw'],
    ['n_cw', 'd_staff'],
    ['d_staff', 'n_ce'],
    ['n_ce', 'd_b'],
    ['d_b', 'n_e'],
    ['d_a', 'r_a'],
    ['d_staff', 'r_staff'],
    ['d_b', 'r_b'],
    ['n_w', 'w_stair'],
    ['w_stair', 'st_w'],
    ['w_stair', 'c_w'],
    ['c_w', 'c_mid'],
    ['c_mid', 'c_e'],
    ['c_w', 'm_w'],
    ['d_staff', 'c_e'],
    ['c_e', 'm_c'],
    ['n_e', 'e_stair'],
    ['e_stair', 'st_e'],
    ['e_stair', 'e_tool'],
    ['e_tool', 'st_tool'],
    ['e_tool', 'm_e'],
    ['m_w', 'm_cw'],
    ['m_cw', 'm_c'],
    ['m_c', 'm_ce'],
    ['m_ce', 'm_e'],
    ['m_ce', 'loc'],
    ['m_w', 'w_low'],
    ['w_low', 'so_w'],
    ['m_e', 'e_low'],
    ['e_low', 'so_e'],
    ['m_c', 's_low'],
    ['s_low', 'so_c'],
    ['so_w', 'so_cw'],
    ['so_cw', 'so_c'],
    ['so_c', 'so_e'],
    ['so_cw', 'lib'],
    ['so_c', 'hall'],
  ),

  // -- objectives ------------------------------------------------------------
  checkpoints: [
    { id: 'classroomA', name: '教室A', kind: 'objective', x: 490, y: 380, areaId: 'classroomA' },
    { id: 'staffRoom', name: '職員室', kind: 'objective', x: 1240, y: 380, areaId: 'staffRoom' },
    { id: 'classroomB', name: '教室B', kind: 'objective', x: 1910, y: 380, areaId: 'classroomB' },
    { id: 'westStairs', name: '西階段', kind: 'objective', x: 500, y: 1010, areaId: 'stairsWest' },
    { id: 'eastStairs', name: '東階段', kind: 'objective', x: 1890, y: 1010, areaId: 'stairsEast' },
    { id: 'storeroom', name: '用具室', kind: 'objective', x: 1890, y: 1650, areaId: 'storeroom' },
    { id: 'library', name: '図書室', kind: 'objective', x: 760, y: 2280, areaId: 'library' },
    { id: 'locker', name: 'ロッカー', kind: 'objective', x: 1730, y: 2280, areaId: 'lockerRoom' },
    { id: 'exit', name: '昇降口', kind: 'exit', x: 1320, y: 2800, areaId: 'entranceHall' },
  ],

  /**
   * Four teachers. Nobody starts anywhere near the spawn point (asserted by a test),
   * so the first few seconds are always safe - see requirement 53.
   */
  /**
   * Five teachers on SHORT beats rather than a few on long ones.
   *
   * That is the difference between "risky" and "impossible": a short beat means the
   * fast central corridor has a predictable window every few seconds, so a player who
   * watches can time it. A single teacher sweeping the whole corridor would simply
   * close it, and the balance run showed exactly that.
   *
   * Nobody can see the spawn point when the stage opens (asserted by a test), so the
   * first seconds are always calm - requirement 53.
   */
  patrols: [
    {
      // The fast route's upper half, and the staff-room door with it. Turns often,
      // so tailgating them down the corridor is the classic way to get caught.
      id: 'spine',
      typeId: 'looker',
      route: ['d_staff', 'c_e'],
      startIndex: 1,
      startPhaseRange: [0, 0.6],
    },
    {
      // The north corridor, where every classroom door is.
      id: 'north',
      typeId: 'normal',
      route: ['n_w', 'd_a', 'n_cw', 'd_staff', 'n_ce'],
      waitAt: ['d_a'],
      startIndex: 4,
      startPhaseRange: [0, 0.7],
    },
    {
      // The west loop: slow, stops a lot, sweeps their gaze. Safe if you are patient.
      id: 'west',
      typeId: 'stander',
      route: ['w_stair', 'c_w', 'm_w'],
      waitAt: ['w_stair', 'm_w'],
      startIndex: 0,
      startPhaseRange: [0, 0.7],
    },
    {
      // Comes out of the east stairwell at intervals - the only teacher who is not
      // where you last saw them. Their beat is short on purpose: the east wing is
      // the LONG SAFE ROUTE, and something has to be patrolling it or it would be
      // free rather than merely slow.
      id: 'east',
      typeId: 'roomer',
      route: ['st_e', 'e_stair', 'e_tool'],
      waitAt: ['st_e'],
      startIndex: 0,
      startPhaseRange: [0, 0.5],
    },
    {
      // The exit guard. Requirement 54: the escape has to mean something.
      //
      // They wait at the two ENDS of the south corridor, never outside the entrance
      // hall itself. Loitering on the hall door turned the opening into a coin flip -
      // walking out of the door was an instant catch, which requirement 53 forbids.
      // Sweeping past the door instead keeps the tension without the ambush.
      id: 'south',
      typeId: 'normal',
      route: ['so_e', 'so_c', 'so_cw', 'so_w'],
      waitAt: ['so_e', 'so_w'],
      startIndex: 0,
      startPhaseRange: [0, 0.3],
    },
  ],

  missions: [
    {
      id: 'A',
      label: 'プリント回収',
      checkpoints: ['classroomA', 'locker', 'exit'],
      alternatives: [{ index: 1, options: ['locker', 'library'] }],
    },
    {
      id: 'B',
      label: '職員室ルート',
      checkpoints: ['westStairs', 'staffRoom', 'exit'],
      alternatives: [{ index: 0, options: ['westStairs', 'library'] }],
    },
    {
      id: 'C',
      label: '奥まで往復',
      checkpoints: ['locker', 'classroomB', 'exit'],
      alternatives: [{ index: 1, options: ['classroomB', 'eastStairs'] }],
    },
  ],

  spawn: { x: 1160, y: 2960 },

  floorAssets: {
    corridor: 'teacher.map.floorCorridor',
    classroom: 'teacher.map.floorClassroom',
    room: 'teacher.map.floorRoom',
    stairs: 'teacher.map.floorStairs',
    lobby: 'teacher.map.floorLobby',
  },
  wallAsset: 'teacher.map.wall',
};
