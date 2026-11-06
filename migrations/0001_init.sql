-- cfbblindresume D1 schema (Cloudflare D1 = SQLite).
-- Privacy (SPEC house rule 6): no IP addresses, user ids or cookies anywhere, and no timestamp finer
-- than a UTC day except rate_limit.window_start (the hour a rate-limit window starts), which sits
-- next to the only per-client value, rate_limit.hash: a salted SHA-256 whose salt rotates daily.
-- Rate-limit rows are deleted 24 hours after their window starts (on vote and event writes, and by
-- the daily purge workflow .github/workflows/purge-rate-limit.yml).

-- One row per ranked trio (POST /api/vote). a, b, c are in the order the user ranked them.
CREATE TABLE votes (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  a TEXT NOT NULL,            -- ranked 1st
  b TEXT NOT NULL,            -- ranked 2nd
  c TEXT NOT NULL,            -- ranked 3rd
  created_day TEXT NOT NULL   -- UTC date, YYYY-MM-DD (no time of day)
);
CREATE INDEX votes_by_week ON votes (season, week);

-- Pairwise counters maintained on insert (each vote adds a>b, a>c, b>c), so /api/fans and
-- /api/fans/top25 read a handful of rows instead of scanning votes.
CREATE TABLE pair_counts (
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  winner TEXT NOT NULL,
  loser TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season, week, winner, loser)
) WITHOUT ROWID;

-- Votes per week (threshold for the fans' top 25).
CREATE TABLE vote_totals (
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season, week)
) WITHOUT ROWID;

-- Vote rate limiting: requests per client per one-hour window (window_start = unix seconds).
CREATE TABLE rate_limit (
  hash TEXT NOT NULL,          -- hex SHA-256(IP_SALT | UTC day | IP); never the IP itself
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hash, window_start)
) WITHOUT ROWID;
CREATE INDEX rate_limit_by_window ON rate_limit (window_start);

-- Anonymous event counters (POST /api/event): no ids, just how many times per day.
CREATE TABLE events (
  day TEXT NOT NULL,           -- UTC date, YYYY-MM-DD
  name TEXT NOT NULL,          -- allowlisted event name
  prop TEXT NOT NULL DEFAULT '', -- allowlisted property value ('' when none)
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, prop)
) WITHOUT ROWID;
