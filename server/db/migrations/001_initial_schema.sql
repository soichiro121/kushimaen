-- KOMATO RUSH - initial schema (PostgreSQL / Neon)
--
-- Applied by `npm run db:migrate`, never by hand. See docs/DEPLOYMENT.md.
--
-- EVERY TIMESTAMP IS TIMESTAMPTZ, deliberately. A bare TIMESTAMP has no zone, so the
-- driver has to guess one when it converts a JavaScript Date - and it guesses the
-- machine's local zone. On a serverless platform that machine is in an arbitrary
-- region, which would silently shift every `expires_at` and every leaderboard
-- timestamp. TIMESTAMPTZ stores an absolute instant and round-trips exactly.

CREATE TABLE runs (
    id             UUID        NOT NULL PRIMARY KEY,
    -- The client's PRNG seed, issued here so a player cannot fish for an easy layout.
    seed           BIGINT      NOT NULL,
    config_version INTEGER     NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    completed_at   TIMESTAMPTZ NULL,
    -- open | completed | rejected
    status         VARCHAR(16) NOT NULL
);

CREATE INDEX idx_runs_status_expires ON runs (status, expires_at);

CREATE TABLE scores (
    id              BIGSERIAL   PRIMARY KEY,
    -- UNIQUE is the last line of defence against a double submission; the real one is
    -- the conditional UPDATE in `markRunCompleted`.
    run_id          UUID        NOT NULL UNIQUE REFERENCES runs (id) ON DELETE CASCADE,
    nickname        VARCHAR(64) NOT NULL,
    -- Server-recomputed total. The client's number is never stored here.
    total_score     INTEGER     NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    -- 0 = failed validation; kept for review rather than silently discarded.
    valid           SMALLINT    NOT NULL DEFAULT 1,
    suspicion_score INTEGER     NOT NULL DEFAULT 0,
    -- Which balance generation this score was played under. Scores from different
    -- rule sets are not comparable, so the leaderboard filters on this rather than
    -- leaving old, inflated totals sitting permanently on top.
    config_version  INTEGER     NOT NULL DEFAULT 1
);

CREATE INDEX idx_scores_version_board ON scores (config_version, valid, total_score DESC, created_at ASC);
CREATE INDEX idx_scores_created ON scores (created_at);

CREATE TABLE stage_results (
    id           BIGSERIAL   PRIMARY KEY,
    run_id       UUID        NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    stage_id     VARCHAR(32) NOT NULL,
    -- `score` is the server's recomputation; `client_score` is what was claimed.
    -- Both are kept precisely so the two can be compared when reviewing abuse.
    score        INTEGER     NOT NULL,
    client_score INTEGER     NOT NULL,
    duration_ms  INTEGER     NOT NULL,
    metrics_json TEXT        NOT NULL,
    UNIQUE (run_id, stage_id)
);

CREATE INDEX idx_stage_results_run ON stage_results (run_id);

-- Fixed-window rate limiting. `bucket` is a SHA-256 hash, never a raw IP address.
CREATE TABLE rate_limits (
    bucket       CHAR(64)    NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits         INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, window_start)
);

CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);
