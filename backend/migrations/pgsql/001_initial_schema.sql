-- KOMATO RUSH - initial schema (PostgreSQL)
--
-- Also the dialect to use when the database is hosted on Supabase Postgres:
-- point DB_DSN at it and run `php bin/migrate.php`.

CREATE TABLE runs (
    id             UUID        NOT NULL PRIMARY KEY,
    seed           BIGINT      NOT NULL,
    config_version INTEGER     NOT NULL,
    started_at     TIMESTAMP   NOT NULL,
    expires_at     TIMESTAMP   NOT NULL,
    completed_at   TIMESTAMP   NULL,
    -- open | completed | rejected
    status         VARCHAR(16) NOT NULL
);

CREATE INDEX idx_runs_status_expires ON runs (status, expires_at);

CREATE TABLE scores (
    id              BIGSERIAL   PRIMARY KEY,
    run_id          UUID        NOT NULL UNIQUE REFERENCES runs (id) ON DELETE CASCADE,
    nickname        VARCHAR(64) NOT NULL,
    -- Server-recomputed total. The client's number is never stored here.
    total_score     INTEGER     NOT NULL,
    created_at      TIMESTAMP   NOT NULL,
    -- 0 = failed validation; kept for review rather than silently discarded.
    valid           SMALLINT    NOT NULL DEFAULT 1,
    suspicion_score INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX idx_scores_board ON scores (valid, total_score DESC, created_at ASC);
CREATE INDEX idx_scores_created ON scores (created_at);

CREATE TABLE stage_results (
    id           BIGSERIAL   PRIMARY KEY,
    run_id       UUID        NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    stage_id     VARCHAR(32) NOT NULL,
    score        INTEGER     NOT NULL,
    client_score INTEGER     NOT NULL,
    duration_ms  INTEGER     NOT NULL,
    metrics_json TEXT        NOT NULL,
    UNIQUE (run_id, stage_id)
);

CREATE INDEX idx_stage_results_run ON stage_results (run_id);

-- Fixed-window rate limiting. `bucket` is a SHA-256 hash, never a raw IP address.
CREATE TABLE rate_limits (
    bucket       CHAR(64)  NOT NULL,
    window_start TIMESTAMP NOT NULL,
    hits         INTEGER   NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
);

CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);
