/**
 * The LOCAL MODE leaderboard.
 *
 * Worth testing properly because it is what most players will actually see on a
 * first visit, and because it has to reproduce the server's ordering rules from a
 * completely different data shape. Where the two disagree, a player's rank changes
 * when the network comes back.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { localLeaderboard } from '@/services/leaderboard/localLeaderboard';

function insert(
  nickname: string,
  totalScore: number,
  stageScores?: Record<string, number>,
  createdAt = new Date().toISOString(),
): number {
  return localLeaderboard.insert({
    runId: `run-${nickname}`,
    nickname,
    totalScore,
    createdAt,
    ...(stageScores ? { stageScores } : {}),
  });
}

beforeEach(() => {
  localLeaderboard.clear();
});

describe('the combined board', () => {
  it('orders by total score, highest first', () => {
    insert('ひくい', 100);
    insert('たかい', 900);
    insert('まんなか', 500);

    const board = localLeaderboard.fetch('all', 50);

    expect(board.entries.map((entry) => entry.nickname)).toEqual([
      'たかい',
      'まんなか',
      'ひくい',
    ]);
    expect(board.scope).toBe('total');
  });

  it('breaks a tie in favour of the earlier entry, like the server does', () => {
    insert('さきに', 500, undefined, '2026-05-01T01:00:00.000Z');
    insert('あとから', 500, undefined, '2026-05-01T02:00:00.000Z');

    expect(localLeaderboard.fetch('all', 50).entries.map((e) => e.nickname)).toEqual([
      'さきに',
      'あとから',
    ]);
  });
});

describe('the stage boards', () => {
  it('ranks by the chosen stage, not by the total', () => {
    insert('はしる人', 1000, { late: 900, bread: 50, teacher: 50 });
    insert('かくれる人', 800, { late: 50, bread: 50, teacher: 700 });

    expect(localLeaderboard.fetch('all', 50, undefined, 'late').entries.map((e) => e.nickname)).toEqual([
      'はしる人',
      'かくれる人',
    ]);
    expect(
      localLeaderboard.fetch('all', 50, undefined, 'teacher').entries.map((e) => e.nickname),
    ).toEqual(['かくれる人', 'はしる人']);
  });

  it('reports the stage score, not the total', () => {
    insert('ひとり', 1000, { late: 400, bread: 300, teacher: 300 });

    expect(localLeaderboard.fetch('all', 50, undefined, 'bread').entries[0]?.score).toBe(300);
    expect(localLeaderboard.fetch('all', 50).entries[0]?.score).toBe(1000);
  });

  /**
   * Entries saved before stage boards existed have no per-stage scores. They must
   * keep their place on the combined board and simply not appear on the stage ones -
   * discarding them would wipe a player's history for a feature they never asked for.
   */
  it('keeps a pre-existing entry on the combined board and off the stage boards', () => {
    insert('むかしのひと', 700);
    insert('いまのひと', 200, { late: 200, bread: 0, teacher: 0 });

    expect(localLeaderboard.fetch('all', 50).entries.map((e) => e.nickname)).toEqual([
      'むかしのひと',
      'いまのひと',
    ]);
    expect(localLeaderboard.fetch('all', 50, undefined, 'late').entries.map((e) => e.nickname)).toEqual(
      ['いまのひと'],
    );
  });

  it('counts only the entries on that board', () => {
    insert('あり', 500, { late: 500 });
    insert('なし', 400);

    expect(localLeaderboard.fetch('all', 50, undefined, 'late').total).toBe(1);
    expect(localLeaderboard.fetch('all', 50).total).toBe(2);
  });

  it('gives the caller their own stage placement even when off the page', () => {
    insert('わたし', 10, { late: 10 });
    for (let i = 0; i < 4; i++) insert(`つよい${i}`, 900 + i, { late: 900 + i });

    const board = localLeaderboard.fetch('all', 2, 'run-わたし', 'late');

    expect(board.entries).toHaveLength(2);
    expect(board.me?.nickname).toBe('わたし');
    expect(board.me?.rank).toBe(5);
  });

  it('survives a stored entry whose stageScores are not numbers', () => {
    // Hand-edited or corrupted localStorage must not take the screen down.
    localStorage.setItem(
      'komato:leaderboard',
      JSON.stringify([
        { runId: 'a', nickname: 'こわれ', totalScore: 1, createdAt: '2026-05-01T00:00:00.000Z', stageScores: { late: 'x' } },
        { runId: 'b', nickname: 'ふつう', totalScore: 2, createdAt: '2026-05-01T00:00:00.000Z', stageScores: { late: 5 } },
      ]),
    );

    expect(localLeaderboard.fetch('all', 50, undefined, 'late').entries.map((e) => e.nickname)).toEqual(
      ['ふつう'],
    );
  });
});
