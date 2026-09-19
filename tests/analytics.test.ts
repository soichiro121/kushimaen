/**
 * What the game sends to analytics.
 *
 * These players are school students, so the value here is not "does the vendor
 * work" - it is a standing check on what leaves the device. The last test walks the
 * whole event catalogue and fails if anyone ever adds a field that could carry
 * free text, which is the only way a nickname could get out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.fn();
vi.mock('@vercel/analytics', () => ({ track: (...args: unknown[]) => track(...args) }));

const { trackEvent, resetAnalytics } = await import('@/services/analytics/track');

beforeEach(() => {
  track.mockClear();
  resetAnalytics(true);
});

afterEach(() => {
  resetAnalytics(null);
});

describe('sending an event', () => {
  it('passes the name and the properties, with the name stripped out', () => {
    trackEvent({ name: 'stage_finished', stage: 'bread', outcome: 'cleared' });

    expect(track).toHaveBeenCalledWith('stage_finished', {
      stage: 'bread',
      outcome: 'cleared',
    });
  });

  it('never lets an analytics failure reach the caller', () => {
    track.mockImplementationOnce(() => {
      throw new Error('blocked by an extension');
    });

    expect(() => trackEvent({ name: 'run_started', stageCount: 3 })).not.toThrow();
  });

  it('sends nothing at all when tracking is off', () => {
    resetAnalytics(false);

    trackEvent({ name: 'run_started', stageCount: 3 });

    expect(track).not.toHaveBeenCalled();
  });
});

describe('what is in an event', () => {
  /**
   * Every event the app can send. Listed by hand on purpose: the point is that a
   * person has to write the event down here, and the assertions below then hold it
   * to the rules. A generated list would grow silently with the union.
   */
  const everyEvent = [
    { name: 'backend_mode', mode: 'local' },
    { name: 'run_started', stageCount: 3 },
    { name: 'stage_finished', stage: 'late', outcome: 'timeUp' },
    { name: 'run_submitted', accepted: true, totalScore: 12_345 },
    { name: 'leaderboard_viewed', scope: 'teacher', period: 'today' },
  ] as const;

  it('carries at most two properties, which is all Vercel keeps', () => {
    for (const event of everyEvent) {
      const { name, ...properties } = event;
      expect(Object.keys(properties).length, `${name} has too many properties`).toBeLessThanOrEqual(
        2,
      );
    }
  });

  /**
   * The nickname is the only text a player types. No event may have a field it
   * could be assigned to, so every string value has to come from a fixed set.
   */
  it('has no free-text field a nickname could be placed in', () => {
    const allowed = new Set([
      'local',
      'remote',
      'late',
      'bread',
      'teacher',
      'total',
      'cleared',
      'timeUp',
      'today',
      'all',
    ]);

    for (const event of everyEvent) {
      const { name, ...properties } = event;
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value !== 'string') continue;
        expect(allowed.has(value), `${name}.${key} carries unconstrained text`).toBe(true);
      }
    }
  });

  it('carries no identifier that could follow a player around', () => {
    for (const event of everyEvent) {
      for (const key of Object.keys(event)) {
        expect(key.toLowerCase()).not.toMatch(/id$|nickname|user|session|ip/);
      }
    }
  });
});
