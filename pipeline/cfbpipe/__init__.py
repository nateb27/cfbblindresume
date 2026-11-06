"""cfbblindresume weekly data pipeline (fetch, join, validate, write).

Modules:
  net        HTTP with retry/backoff and a raw-response cache (pipeline/.cache/)
  fei        bcftoys FEI table: HTML parser + CSV / pasted-text fallback
  cfbd       CollegeFootballData.com API helpers
  committee  CFP selection committee top 25 (CFP site, CFBD, bcftoys cross-check)
  names      name aliases and pinned slugs
  build      assemble a WeekFile (src/lib/types.ts) from the parsed sources
"""

USER_AGENT = "cfbblindresume-pipeline/1.0"
SCHEMA_VERSION = 1


class PipelineError(Exception):
    """A hard failure: the pipeline must stop and not write anything."""
