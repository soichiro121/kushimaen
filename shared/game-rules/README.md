# Shared Game Rules

This directory is the **single source of truth** for every number that affects a score.

| File                  | Purpose                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `v3.json`             | Versioned rule set. Read by the TypeScript frontend **and** by the PHP backend.                            |
| `v2.json`             | The previous generation, kept so a run recorded under it can still be interpreted.                         |
| `score-fixtures.json` | Golden test vectors. Asserted by both `tests/scoring.test.ts` and `backend/tests/ScoreCalculatorTest.php`. |

## Why

The frontend computes a score so the player sees feedback instantly. The backend
**recomputes** the same score from the submitted metrics and stores its own value.
If the two formulas ever diverged, honest players would be silently penalised.

Two mechanisms prevent that:

1. **Constants are not duplicated.** Both runtimes `import` / `json_decode` the same
   `v3.json`. The backend copy is a symlink-free read of `../shared/game-rules` (see
   `backend/src/Config/RuleSet.php`).
2. **Formulas are pinned by golden fixtures.** `score-fixtures.json` contains metric
   inputs and the exact expected score. Both test suites read it. A formula change on
   one side alone turns the other side red.

## Score model: integer "units"

A score must be **exactly recomputable from the metrics alone** — the server never sees
the frame-by-frame gameplay. Anything that would otherwise depend on per-event timing is
therefore accumulated by the client into an **integer unit counter**, and the server
multiplies that counter by the unit value from `v3.json`.

Examples:

- `comboUnits` — each near miss at combo level `n` contributes `min(n - 1, maxComboUnitsPerHit)` units.
- `speedUnits` — each correct bread answer contributes `clamp(ceil((speedWindowMs - reactionMs) / speedStepMs), 0, max)` units.
- `timeRemainingSec` — the stage-3 clock, floored to whole seconds by the client and
  cross-checked against the submitted `durationMs` by the validator.

Units are bounded by other metrics (`comboUnits <= nearMissCount * maxComboUnitsPerHit`),
so an inflated unit count is rejected by the validator rather than silently scored.

## Version history

| Version | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Initial balance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2       | Balance pass. Tap-spam in the teacher stage was worth ~70% of the whole game, so flat taps were devalued and the score moved onto risk; the teacher combo now counts visits where the player held out to the doorknob and survived (it previously rewarded the most cautious play). Bread scores are normalised by run length, because a random 6-10 orders made the draw worth ~1.9x. Late-stage combo was capped to stop it scaling superlinearly with skill. Rank thresholds recalibrated from `npm run balance`.                                                                                                                                  |
| 3       | **Stage 3 replaced.** The tap-to-score / hold-to-hide classroom game became a top-down stealth speedrun, so every stage-3 metric and constant changed (`cleared`, `checkpointsCompleted`, `timeRemainingSec`, `caughtCount`, `detectionCount`, `dangerPassCount`, `routeDistance`, `idleTimeMs`). The time bonus now pays only for seconds saved beyond a free allowance, because paying for every second under the stage's safety limit handed the same large bonus to everyone who merely finished. Perfect stealth is derived from the exposure counters rather than read from a client flag. Rank thresholds recalibrated from `npm run balance`. |

## Adding a new rule version

1. Copy the current `vN.json` to `v(N+1).json` and edit it.
2. Bump `configVersion` inside the new file.
3. Point `src/config/rules.ts` and `backend/src/Config/RuleSet.php` at the new file.
4. Add fixtures for the new version.

Old runs keep the `config_version` they were created with, so leaderboards can be
filtered or segmented across a balance change.
