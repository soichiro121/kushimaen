-- Record which rule-set version each score was played under.
--
-- WHY: scores from different balance versions are not comparable. A single
-- rebalance would otherwise leave old, inflated totals sitting permanently at the
-- top of the board. The leaderboard filters on this column so each generation has
-- its own ranking, while the old rows are kept rather than deleted.
--
-- Denormalised from `runs` on purpose: the leaderboard is the hottest query in the
-- app and this keeps it a single indexed table scan instead of a join.

ALTER TABLE scores ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1;

-- Backfill from the run each score belongs to.
UPDATE scores
SET config_version = (SELECT config_version FROM runs WHERE runs.id = scores.run_id)
WHERE EXISTS (SELECT 1 FROM runs WHERE runs.id = scores.run_id);

CREATE INDEX idx_scores_version_board ON scores (config_version, valid, total_score, created_at);
