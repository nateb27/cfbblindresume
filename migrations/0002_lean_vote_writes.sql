-- Fewer D1 rows written per vote (free plan: 100,000 rows written per day).
-- * votes_by_week indexed a table nothing reads (votes is the raw archive; the fans endpoints read
--   pair_counts), costing one extra row write per vote.
-- * vote_totals duplicated pair_counts: every vote adds exactly three pairwise counts, so the
--   week's total is SUM(pair_counts.n) / 3 (functions/_lib/fans.ts votesFromPairs).
-- The Functions stopped using both before this migration, so it can be applied before or after
-- the deploy that ships that code.
DROP INDEX IF EXISTS votes_by_week;
DROP TABLE IF EXISTS vote_totals;
