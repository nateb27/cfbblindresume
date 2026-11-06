"""End-to-end: run.py over the mini fixture cache (no network)."""
import contextlib
import io
import json
import shutil
import unittest

from _util import FIX, make_workspace, run_args

import run
import validate as V


def call(argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = run.main(argv)
    return code, out.getvalue()


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.ws = make_workspace()
        self.addCleanup(shutil.rmtree, self.ws, True)
        self.week = self.ws / "data" / "2026" / "week-3.json"
        self.index = self.ws / "data" / "2026" / "index.json"

    def test_build_validate_and_idempotent(self):
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 0, out)
        self.assertIn("committee: CFP site not usable", out)       # no CFP page in the fixture cache
        self.assertIn("CFBD has no committee poll yet", out)
        doc = json.loads(self.week.read_text(encoding="utf-8"))
        self.assertEqual((doc["week"], doc["asOf"], doc["fbsCount"], doc["committee"]), (3, "2026-09-25", 6, None))
        self.assertEqual(json.loads(self.index.read_text()), {"season": 2026, "weeks": [
            {"week": 3, "asOf": "2026-09-25", "label": "After Week 3", "hasCommittee": False}]})
        self.assertEqual(V.validate_path(self.week), [])
        slugs = json.loads((self.ws / "config" / "slugs.json").read_text(encoding="utf-8"))
        self.assertEqual(slugs, {"23": "san-jose-state", "62": "hawaii", "87": "notre-dame", "193": "miami-oh",
                                 "245": "texas-am", "2026": "app-state", "2643": "the-citadel"})
        first = (self.week.read_bytes(), self.index.read_bytes())
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 0, out)
        self.assertEqual((self.week.read_bytes(), self.index.read_bytes()), first)
        # without --as-of, an unchanged rebuild keeps the existing asOf (no churn)
        argv = [a for a in run_args(self.ws) if a not in ("--as-of", "2026-09-25")]
        code, out = call(argv)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.week.read_bytes(), first[0])

    def test_csv_fallback_produces_same_file(self):
        self.assertEqual(call(run_args(self.ws))[0], 0)
        html_bytes = self.week.read_bytes()
        self.week.unlink()
        code, out = call(run_args(self.ws, "--fei-csv", str(FIX / "fei_mini_paste.txt")))
        self.assertEqual(code, 0, out)
        self.assertEqual(self.week.read_bytes(), html_bytes)

    def test_fetch_failure_uses_manual_csv(self):
        (self.ws / "cache" / "2026" / "bcftoys-fei.html").unlink()
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("--fei-csv", out)
        self.assertFalse(self.week.exists())
        (self.ws / "config" / "manual").mkdir()
        shutil.copy(FIX / "fei_mini.csv", self.ws / "config" / "manual" / "2026-fei.csv")
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 0, out)
        self.assertIn("falling back to", out)

    def test_unmatched_alias_writes_nothing(self):
        aliases = json.loads((self.ws / "config" / "aliases.json").read_text(encoding="utf-8"))
        del aliases["fei"]["San Jose State"]
        (self.ws / "config" / "aliases.json").write_text(json.dumps(aliases), encoding="utf-8")
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("'San Jose State'", out)
        self.assertFalse(self.week.exists())
        self.assertEqual((self.ws / "config" / "slugs.json").read_text(), "{}\n")

    def test_record_mismatch_refuses_to_write(self):
        p = self.ws / "cache" / "2026" / "cfbd-games-regular.json"
        games = json.loads(p.read_text(encoding="utf-8"))
        games[7]["week"] = 3  # the midweek week-4 game sneaks into week 3 -> records disagree with FEI
        p.write_text(json.dumps(games), encoding="utf-8")
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("Miami (OH): record from CFBD games through week 3 is 1-2 but FEI says 0-2", out)
        self.assertFalse(self.week.exists())

    def test_dry_run_and_committee_none(self):
        code, out = call(run_args(self.ws, "--dry-run", "--committee-source", "none"))
        self.assertEqual(code, 0, out)
        self.assertIn("dry run", out)
        self.assertFalse(self.week.exists())

    def test_stale_fei_refused(self):
        self.index.parent.mkdir(parents=True)
        self.index.write_text(json.dumps({"season": 2026, "weeks": [
            {"week": 4, "asOf": "2026-09-29", "label": "After Week 4", "hasCommittee": False}]}), encoding="utf-8")
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("stale input", out)

    def fei_moves_to_week_4(self):
        """The cached 'latest' FEI page now says week 4; the week-3 page survives only as a per-week copy."""
        latest = self.ws / "cache" / "2026" / "bcftoys-fei.html"
        shutil.copy(latest, latest.with_name("bcftoys-fei-w3.html"))
        latest.write_text(latest.read_text(encoding="utf-8").replace("(through Week 3)", "(through Week 4)"),
                          encoding="utf-8")

    def test_week_mismatch_with_fei_is_refused(self):
        self.fei_moves_to_week_4()
        (self.ws / "cache" / "2026" / "bcftoys-fei-w3.html").unlink()
        code, out = call(run_args(self.ws, "--week", "3"))
        self.assertEqual(code, 1, out)
        self.assertIn("--week 3 but the FEI input is through Week 4", out)
        self.assertIn("bcftoys-fei-w3.html", out)
        self.assertFalse(self.week.exists())

    def test_per_week_cache_rebuilds_an_archived_week(self):
        self.fei_moves_to_week_4()
        code, out = call(run_args(self.ws, "--week", "3"))
        self.assertEqual(code, 0, out)
        self.assertIn("cache 2026/bcftoys-fei-w3.html", out)
        doc = json.loads(self.week.read_text(encoding="utf-8"))
        self.assertEqual((doc["week"], doc["sources"]["ratings"]["throughWeek"]), (3, 3))

    def test_live_fetch_saves_a_per_week_copy(self):
        from test_net import FakeResp, FakeSession
        from cfbpipe.net import Fetcher
        page = (self.ws / "cache" / "2026" / "bcftoys-fei.html").read_text(encoding="utf-8")
        live = self.ws / "live-cache"
        fetcher = Fetcher(live, session=FakeSession([FakeResp(200, page)]), log=lambda m: None)
        args = run.parse_args(["--season", "2026", "--config-dir", str(self.ws / "config")])
        with contextlib.redirect_stdout(io.StringIO()):
            table = run.load_fei(args, fetcher)
        self.assertEqual(table.through_week, 3)
        self.assertEqual((live / "2026" / "bcftoys-fei-w3.html").read_text(encoding="utf-8"), page)
        self.assertTrue((live / "2026" / "bcftoys-fei.html").exists())

    def test_fei_without_week_needs_week_and_is_cross_checked(self):
        p = self.ws / "cache" / "2026" / "bcftoys-fei.html"
        p.write_text(p.read_text(encoding="utf-8").replace("(through Week 3)", ""), encoding="utf-8")
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("snapshot week unknown", out)
        code, out = call(run_args(self.ws, "--week", "4"))  # FEI records are week 3's: refused
        self.assertEqual(code, 1)
        self.assertIn("Miami (OH): record from CFBD games through week 4 is 1-2 but FEI says 0-2", out)
        self.assertFalse(self.week.with_name("week-4.json").exists())
        code, out = call(run_args(self.ws, "--week", "3"))
        self.assertEqual(code, 0, out)
        self.assertIsNone(json.loads(self.week.read_text(encoding="utf-8"))["sources"]["ratings"]["throughWeek"])

    def test_final_fei_page_after_the_last_release_is_season_complete(self):
        self.assertEqual(call(run_args(self.ws))[0], 0)
        before = (self.week.read_bytes(), self.index.read_bytes())
        p = self.ws / "cache" / "2026" / "bcftoys-fei.html"
        p.write_text(p.read_text(encoding="utf-8").replace("(through Week 3)", ""), encoding="utf-8")
        argv = [a if a != "2026-09-25" else "2027-01-11" for a in run_args(self.ws)]
        code, out = call(argv)
        self.assertEqual(code, 0, out)
        self.assertIn("season complete, nothing to do", out)
        self.assertEqual((self.week.read_bytes(), self.index.read_bytes()), before)
        # before the last scheduled release the same input is still an error
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("snapshot week unknown", out)

    def test_week_past_the_regular_season_is_not_built(self):
        p = self.ws / "cache" / "2026" / "bcftoys-fei.html"
        p.write_text(p.read_text(encoding="utf-8").replace("(through Week 3)", "(through Week 6)"), encoding="utf-8")
        code, out = call(run_args(self.ws))  # the mini calendar ends with week 5
        self.assertEqual(code, 0, out)
        self.assertIn("past the last regular-season week (5)", out)
        self.assertFalse(self.week.parent.exists())
        code, out = call(run_args(self.ws, "--week", "6"))
        self.assertEqual(code, 1)
        self.assertIn("--week 6 is past the last regular-season week (5)", out)


class InputMistakes(unittest.TestCase):
    """Common operator mistakes end in a one-line FAILED / usage message, not a traceback."""

    def setUp(self):
        self.ws = make_workspace()
        self.addCleanup(shutil.rmtree, self.ws, True)

    def test_bad_dates_are_usage_errors(self):
        for flag, value in (("--as-of", "11/05/2026"), ("--committee-release-date", "Nov 3"), ("--as-of", "2026-02-30")):
            err = io.StringIO()
            with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as cm:
                run.parse_args(["--season", "2026", flag, value])
            self.assertEqual(cm.exception.code, 2)
            self.assertIn("is not a date in YYYY-MM-DD form", err.getvalue())

    def test_missing_fei_csv(self):
        code, out = call(run_args(self.ws, "--fei-csv", str(self.ws / "nope.csv")))
        self.assertEqual(code, 1)
        self.assertIn("FAILED: --fei-csv", out)
        self.assertIn("no such file", out)

    def test_malformed_index_and_week_file(self):
        season = self.ws / "data" / "2026"
        season.mkdir(parents=True)
        (season / "index.json").write_text("{not json", encoding="utf-8")
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("FAILED: season index", out)
        self.assertIn("is not valid JSON", out)
        (season / "index.json").unlink()
        (season / "week-3.json").write_text("{not json", encoding="utf-8")
        argv = [a for a in run_args(self.ws) if a not in ("--as-of", "2026-09-25")]
        code, out = call(argv)
        self.assertEqual(code, 1)
        self.assertIn("FAILED: existing week file", out)

    def test_malformed_config(self):
        (self.ws / "config" / "aliases.json").write_text("{", encoding="utf-8")
        code, out = call(run_args(self.ws))
        self.assertEqual(code, 1)
        self.assertIn("aliases.json is not valid JSON", out)


if __name__ == "__main__":
    unittest.main()
