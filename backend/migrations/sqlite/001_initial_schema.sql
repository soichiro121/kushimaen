-- KOMATO RUSH - initial schema (SQLite)
--
-- SQLite is what `composer test` uses, and it is fine for a small single-server
-- deployment. Use MySQL/MariaDB or PostgreSQL when many players submit at once.

CREATE TABLE runs (
    id             TEXT    NOT NULL PRIMARY KEY,
    seed           INTEGER NOT NULL,
    config_version INTEGER NOT NULL,
    started_at     TEXT    NOT NULL,
    expires_at     TEXT    NOT NULL,
    completed_at   TEXT    NULL,
    -- open | completed | rejected
    status         TEXT    NOT NULL
);

CREATE INDEX idx_runs_status_expires ON runs (status, expires_at);

CREATE TABLE scores (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT    NOT NULL UNIQUE REFERENCES runs (id) ON DELETE CASCADE,
    nickname        TEXT    NOT NULL,
    -- Server-recomputed total. The client's number is never stored here.
    total_score     INTEGER NOT NULL,
    created_at      TEXT    NOT NULL,
    -- 0 = failed validation; kept for review rather than silently discarded.
    valid           INTEGER NOT NULL DEFAULT 1,
    suspicion_score INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_scores_board ON scores (valid, total_score, created_at);
CREATE INDEX idx_scores_created ON scores (created_at);

CREATE TABLE stage_results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       TEXT    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    stage_id     TEXT    NOT NULL,
    score        INTEGER NOT NULL,
    client_score INTEGER NOT NULL,
    duration_ms  INTEGER NOT NULL,
    metrics_json TEXT    NOT NULL,
    UNIQUE (run_id, stage_id)
);

CREATE INDEX idx_stage_results_run ON stage_results (run_id);

-- Fixed-window rate limiting. `bucket` is a SHA-256 hash, never a raw IP address.
CREATE TABLE rate_limits (
    bucket       TEXT    NOT NULL,
    window_start TEXT    NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
);

CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);
