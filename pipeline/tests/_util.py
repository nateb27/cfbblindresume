"""Shared helpers for pipeline tests (run with `python3 -m pytest pipeline/tests` or unittest)."""
import json
import shutil
import sys
import tempfile
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]
FIX = Path(__file__).resolve().parent / "fixtures"
MINI = FIX / "mini"
if str(PIPE) not in sys.path:
    sys.path.insert(0, str(PIPE))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def mini_json(name: str):
    return json.loads(read(MINI / "2026" / name))


# The mini fixture has six teams and only one of the four real power conferences (SEC), so it uses
# its own playoff formats (same shape; powerConferences limited to SEC). The real config is checked
# in test_validate.PlayoffFormatsConfig and against the committed week files.
MINI_FORMATS = FIX / "playoff_formats_mini.json"


def mini_formats() -> list:
    return json.loads(read(MINI_FORMATS))["2026"]


def make_workspace() -> Path:
    """Temp dir with a copy of the pipeline config (empty slugs) and the mini fixture cache."""
    tmp = Path(tempfile.mkdtemp(prefix="cfbpipe-test-"))
    cfg = tmp / "config"
    cfg.mkdir()
    for name in ("aliases.json", "committee_schedule.json", "conferences.json"):
        shutil.copy(PIPE / name, cfg / name)
    shutil.copy(MINI_FORMATS, cfg / "playoff_formats.json")
    (cfg / "slugs.json").write_text("{}\n", encoding="utf-8")
    shutil.copytree(MINI, tmp / "cache")
    (tmp / "data").mkdir()
    return tmp


def run_args(ws: Path, *extra: str) -> list[str]:
    return ["--season", "2026", "--use-cache", "--cache-dir", str(ws / "cache"), "--data-dir", str(ws / "data"),
            "--config-dir", str(ws / "config"), "--as-of", "2026-09-25", *extra]
