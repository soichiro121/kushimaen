-- KOMATO RUSH - initial schema (MySQL / MariaDB)
--
-- Run with:  php bin/migrate.php
-- The runner applies files in filename order and records them in `migrations`,
-- so the database can always be rebuilt from zero. Never edit an applied file;
-- add a new numbered one instead.

CREATE TABLE runs (
    id             CHAR(36)     NOT NULL,
    seed           BIGINT       NOT NULL,
    config_version INT          NOT NULL,
    started_at     DATETIME     NOT NULL,
    expires_at     DATETIME     NOT NULL,
    completed_at   DATETIME     NULL,
    -- open | completed | rejected
    status         VARCHAR(16)  NOT NULL,
    PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Supports the housekeeping sweep for abandoned runs.
CREATE INDEX idx_runs_status_expires ON runs (status, expires_at);

CREATE TABLE scores (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    run_id          CHAR(36)     NOT NULL,
    nickname        VARCHAR(64)  NOT NULL,
    -- Server-recomputed total. The client's number is never stored here.
    total_score     INT          NOT NULL,
    created_at      DATETIME     NOT NULL,
    -- 0 = failed validation; kept for review rather than silently discarded.
    valid           TINYINT      NOT NULL DEFAULT 1,
    suspicion_score INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    -- Database-level guarantee that one run can score at most once.
    UNIQUE KEY uq_scores_run (run_id),
    CONSTRAINT fk_scores_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- The leaderboard query: filter by valid (+ date), order by score then time.
CREATE INDEX idx_scores_board ON scores (valid, total_score, created_at);
CREATE INDEX idx_scores_created ON scores (created_at);

CREATE TABLE stage_results (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    run_id       CHAR(36)    NOT NULL,
    stage_id     VARCHAR(32) NOT NULL,
    -- Server-recomputed stage score.
    score        INT         NOT NULL,
    -- What the client claimed, kept only so drift can be spotted.
    client_score INT         NOT NULL,
    duration_ms  INT         NOT NULL,
    metrics_json TEXT        NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_stage_results_run_stage (run_id, stage_id),
    CONSTRAINT fk_stage_results_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Fixed-window rate limiting. `bucket` is a SHA-256 hash, never a raw IP address.
CREATE TABLE rate_limits (
    bucket       CHAR(64) NOT NULL,
    window_start DATETIME NOT NULL,
    hits         INT      NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);
