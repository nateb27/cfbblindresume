import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

from _util import PIPE
from test_build import build

import validate as V


def index_for(doc):
    return {"season": doc["season"], "weeks": [
        {"week": doc["week"], "asOf": doc["asOf"], "label": doc["label"], "hasCommittee": doc["committee"] is not None}]}


class ValidatorCatches(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = build().doc

    def setUp(self):
        self.doc = copy.deepcopy(self.base)

    def problems(self, doc=None, index="auto"):
        doc = self.doc if doc is None else doc
        return V.validate_week(doc, index=index_for(doc) if index == "auto" else index)

    def assertProblem(self, needle):
        probs = self.problems()
        self.assertTrue(any(needle in p for p in probs), f"{needle!r} not in {probs}")

    def test_valid_file_passes(self):
        self.assertEqual(self.problems(), [])

    def test_missing_team(self):
        del self.doc["teams"]["san-jose-state"]
        probs = self.problems()
        self.assertTrue(any("fbsCount is 6 but teams has 5" in p for p in probs), probs)
        self.assertTrue(any("'san-jose-state' is marked FBS but is not in teams" in p for p in probs), probs)

    def test_unresolved_opponent(self):
        self.doc["teams"]["app-state"]["games"][0]["opp"] = "nowhere-state"
        self.assertProblem("'nowhere-state' is marked non-FBS but is not in opponents")

    def test_unreferenced_opponent(self):
        self.doc["opponents"]["furman"] = {"slug": "furman", "name": "Furman", "classification": "fcs"}
        self.assertProblem("opponents[furman]: not referenced")

    def test_null_rank(self):
        self.doc["teams"]["hawaii"]["ranks"]["sos"] = None
        self.assertProblem("teams[hawaii].ranks.sos: is null")

    def test_rank_out_of_range(self):
        self.doc["teams"]["hawaii"]["ranks"]["off"] = 7
        self.assertProblem("teams[hawaii].ranks.off: 7 is not an int in 1..6")

    def test_unmirrored_game(self):
        self.doc["teams"]["notre-dame"]["games"].pop(0)  # drop ND's side of the Texas A&M game
        self.doc["teams"]["notre-dame"]["record"] = {"w": 1, "l": 0}
        self.assertProblem("teams[texas-am]: week 1 2026-09-05 neutral vs notre-dame 31-24 is not mirrored")

    def test_inconsistent_site_is_unmirrored(self):
        g = self.doc["teams"]["texas-am"]["games"][0]
        g["site"] = "home"
        self.assertProblem("is not mirrored")

    def test_wrong_record(self):
        self.doc["teams"]["texas-am"]["record"] = {"w": 1, "l": 1}
        self.assertProblem("teams[texas-am].record is 1-1 but the game log is 2-0")

    def test_wrong_conf_record(self):
        self.doc["teams"]["hawaii"]["confRecord"] = {"w": 0, "l": 0}
        self.assertProblem("teams[hawaii].confRecord is 0-0 but conference games are 0-1")

    def test_result_inconsistent_with_score(self):
        self.doc["teams"]["texas-am"]["games"][0]["result"] = "L"
        self.assertProblem("does not match score")

    def test_duplicate_game(self):
        t = self.doc["teams"]["app-state"]
        t["games"].insert(1, copy.deepcopy(t["games"][0]))
        t["record"]["w"] += 1
        self.assertProblem("duplicate game vs the-citadel")

    def test_bad_color(self):
        self.doc["teams"]["hawaii"]["colors"]["secondary"] = "green"
        self.assertProblem("teams[hawaii].colors.secondary")

    def test_missing_and_extra_fields(self):
        del self.doc["teams"]["hawaii"]["short"]
        self.doc["teams"]["hawaii"]["logo"] = "x"
        probs = self.problems()
        self.assertIn("teams[hawaii].short: missing", probs)
        self.assertIn("teams[hawaii].logo: unexpected field", probs)

    def test_wrong_types(self):
        self.doc["week"] = "3"
        self.doc["teams"]["hawaii"]["games"][0]["oppFbs"] = 1
        probs = self.problems(index=None)
        self.assertTrue(any(p.startswith("week: expected an int") for p in probs), probs)
        self.assertTrue(any("oppFbs: expected a boolean" in p for p in probs), probs)

    def test_schema_version(self):
        self.doc["schemaVersion"] = 2
        self.assertProblem("schemaVersion: expected 1")

    def test_committee_rules(self):
        com = ["texas-am", "notre-dame", "unknown-u"] + [f"x{i}" for i in range(22)]
        self.doc["committee"] = com
        self.doc["sources"]["committee"] = {"name": "College Football Playoff Selection Committee",
                                            "url": "https://collegefootballplayoff.com/rankings", "releaseDate": "2026-09-22"}
        self.doc["teams"]["texas-am"]["ranks"]["committee"] = 1
        self.doc["teams"]["notre-dame"]["ranks"]["committee"] = 2
        probs = self.problems()
        self.assertTrue(any("committee[2]: 'unknown-u' is not an FBS team" in p for p in probs), probs)
        self.doc["committee"] = ["texas-am"] * 25
        self.assertProblem("committee: duplicate slugs")

    def test_committee_rank_must_match_list(self):
        self.doc["teams"]["texas-am"]["ranks"]["committee"] = 1
        self.assertProblem("teams[texas-am].ranks.committee is 1 but the committee list says None")

    def test_committee_team_needs_game_log(self):
        self.doc["teams"]["app-state"]["games"] = []
        self.doc["teams"]["app-state"]["record"] = {"w": 0, "l": 0}
        self.doc["committee"] = ["app-state"]
        self.doc["teams"]["app-state"]["ranks"]["committee"] = 1
        self.doc["sources"]["committee"] = {"name": "College Football Playoff Selection Committee",
                                            "url": "https://collegefootballplayoff.com/rankings", "releaseDate": "2026-09-22"}
        self.assertProblem("committee[0]: 'app-state' has no game log")

    def test_banned_string(self):
        word = V.BANNED[1]
        self.doc["teams"]["hawaii"]["mascot"] = f"{word} Warriors"
        self.assertProblem(f"banned string {word!r}")

    def test_index_consistency(self):
        idx = index_for(self.doc)
        idx["weeks"][0]["asOf"] = "2026-09-24"
        probs = self.problems(index=idx)
        self.assertTrue(any("asOf '2026-09-24' != file asOf '2026-09-25'" in p for p in probs), probs)
        probs = self.problems(index={"season": 2026, "weeks": []})
        self.assertTrue(any("expected exactly one entry for week 3" in p for p in probs), probs)

    def test_guaranteed_slug_must_exist(self):
        self.doc["playoff"]["autoBids"]["guaranteed"][0]["slug"] = "nowhere"
        self.assertProblem("playoff.autoBids.guaranteed[0].slug")

    def test_ratings_week_must_equal_file_week(self):
        self.doc["sources"]["ratings"]["throughWeek"] = 4
        self.assertProblem("sources.ratings.throughWeek is 4 but the file is week 3")
        self.doc["sources"]["ratings"]["throughWeek"] = None  # FEI input that did not state its week
        self.assertEqual(self.problems(), [])

    def test_nan_and_infinity_are_not_numbers(self):
        self.doc["teams"]["hawaii"]["values"]["fei"] = float("nan")
        self.doc["teams"]["hawaii"]["values"]["gwd"] = float("inf")
        probs = self.problems()
        self.assertTrue(any("teams[hawaii].values.fei: expected a number, got nan" in p for p in probs), probs)
        self.assertTrue(any("teams[hawaii].values.gwd: expected a number, got inf" in p for p in probs), probs)

    def test_nan_literal_in_file_is_rejected_on_load(self):
        with tempfile.TemporaryDirectory() as d:
            season = Path(d) / "2026"
            season.mkdir()
            text = json.dumps(self.doc).replace('"gwd": 0.2,', '"gwd": Infinity,', 1)
            self.assertIn("Infinity", text)
            (season / "week-3.json").write_text(text, encoding="utf-8")
            (season / "index.json").write_text(json.dumps(index_for(self.doc)), encoding="utf-8")
            probs = V.validate_path(season / "week-3.json")
            self.assertTrue(any("Infinity is not valid JSON" in p for p in probs), probs)

    def test_slug_cannot_be_both_team_and_opponent(self):
        # two FBS teams recorded as non-FBS opponents of each other
        for a, b in (("texas-am", "notre-dame"), ("notre-dame", "texas-am")):
            self.doc["opponents"][b] = {"slug": b, "name": b, "classification": "fcs"}
            self.doc["teams"][a]["games"][0]["oppFbs"] = False
        probs = self.problems()
        self.assertIn("opponents[notre-dame]: 'notre-dame' is both an FBS team and a non-FBS opponent", probs)
        self.assertIn("opponents[texas-am]: 'texas-am' is both an FBS team and a non-FBS opponent", probs)

    def test_non_string_slugs_do_not_crash(self):
        self.doc["committee"] = [["texas-am"]] + [f"x{i}" for i in range(24)]
        self.doc["sources"]["committee"] = {"name": "College Football Playoff Selection Committee",
                                            "url": "https://collegefootballplayoff.com/rankings", "releaseDate": "2026-09-22"}
        self.doc["playoff"]["autoBids"]["guaranteed"][0]["slug"] = {"slug": "notre-dame"}
        self.doc["champions"] = {"SEC": ["texas-am"]}
        probs = self.problems()
        self.assertIn("committee: expected a list of slugs or null", probs)
        self.assertTrue(any("guaranteed[0].slug: expected a slug string" in p for p in probs), probs)
        self.assertTrue(any("champions[SEC]: ['texas-am'] is not an FBS team" in p for p in probs), probs)

    def test_cli_and_index_files(self):
        with tempfile.TemporaryDirectory() as d:
            season = Path(d) / "2026"
            season.mkdir()
            (season / "week-3.json").write_text(json.dumps(self.doc), encoding="utf-8")
            (season / "index.json").write_text(json.dumps(index_for(self.doc)), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(V.main(["--all", "--data-dir", d]), 0)
                self.assertEqual(V.main([str(season / "week-3.json")]), 0)
                (season / "week-4.json").write_text(json.dumps(self.doc), encoding="utf-8")  # wrong week, not indexed
                self.assertEqual(V.main(["--all", "--data-dir", d]), 1)
            self.assertIn("week-4.json exists but is not listed in index.json", out.getvalue())
            self.assertIn("file name says week 4 but the file says week 3", out.getvalue())


class CommittedData(unittest.TestCase):
    def test_committed_week_files_validate(self):
        data = PIPE.parent / "data"
        if not any(data.glob("*/week-*.json")):
            self.skipTest("no committed week files")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = V.main(["--all"])
        self.assertEqual(code, 0, out.getvalue())


if __name__ == "__main__":
    unittest.main()
