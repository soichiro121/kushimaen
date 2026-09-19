-- Per-stage leaderboards.
--
-- A stage board reads `stage_results` filtered by `stage_id` and ordered by `score`,
-- joining back to `scores` for the nickname, the timestamp and - the part that
-- matters - `valid` and `config_version`.
--
-- Without this index that read is a sequential scan over every stage result ever
-- recorded, three times over (the page, the caller's placement, the count).
CREATE INDEX idx_stage_results_board ON stage_results (stage_id, score DESC);
