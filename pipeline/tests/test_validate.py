import contextlib
import copy
import io
import json
import tempfile
import unittest
from datetime import date, timedelta
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
        self.doc["schemaVersion"] = 1
        self.assertProblem("schemaVersion: expected 2, got 1")

    def test_v1_playoff_field_is_rejected(self):
        self.doc["playoff"] = self.doc.pop("playoffFormats")[0]
        probs = self.problems()
        self.assertIn("file.playoffFormats: missing", probs)
        self.assertIn("file.playoff: unexpected field", probs)

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
        self.doc["playoffFormats"][0]["autoBids"]["guaranteed"][0]["slug"] = "nowhere"
        self.assertProblem("playoffFormats[0].autoBids.guaranteed[0].slug: 'nowhere' is not an FBS team")

    def fmt(self, i=1):
        return self.doc["playoffFormats"][i]

    def test_exactly_one_default(self):
        self.fmt()["default"] = True
        self.assertProblem("exactly one format must have default: true, found 2")
        self.fmt(0)["default"] = self.fmt(1)["default"] = False
        self.assertProblem("exactly one format must have default: true, found 0")

    def test_unique_ids(self):
        self.fmt()["id"] = "12-team"
        self.assertProblem("playoffFormats: id '12-team' is used more than once")
        self.fmt()["id"] = "24 Team"
        self.assertProblem("playoffFormats[1].id: expected lowercase letters")
        self.fmt()["id"] = "24"  # purely numeric ids would reorder JS object keys
        self.assertProblem("playoffFormats[1].id: expected lowercase letters")
        self.fmt()["id"] = "24-team"
        self.assertEqual(self.problems(), [])

    def test_byes_must_complete_the_next_power_of_two(self):
        self.fmt()["byes"] = 4
        self.assertProblem("playoffFormats[1].byes: 4 but a standard seeded bracket of 24 teams has nextPow2(24) - 24 = 8 byes")
        self.fmt(0)["size"], self.fmt(0)["byes"] = 16, 0
        self.fmt()["byes"] = 8
        self.assertEqual(self.problems(), [])

    def test_rule_counts(self):
        rules = self.fmt()["autoBids"]["rules"]
        rules[0]["count"] = 2  # 2 power champions, only SEC listed
        self.assertProblem("playoffFormats[1].autoBids.rules[0].count: 2 power champions but only 1 power conferences")
        rules[0]["count"] = 0
        self.assertProblem("playoffFormats[1].autoBids.rules[0].count: expected a positive int, got 0")
        rules[0] = {"from": "mid-major", "count": 1}
        self.assertProblem("rules[0].from: expected one of all, power, nonPower")
        rules[0] = {"from": "nonPower", "count": 1}
        self.assertProblem("rules[1].from: 'nonPower' appears in more than one rule")
        self.fmt(0)["autoBids"]["rules"] = [{"from": "all", "count": 12}]
        self.assertProblem("playoffFormats[0].autoBids: 13 automatic bids do not fit a field of 12")

    def test_power_conferences_must_exist(self):
        self.fmt()["powerConferences"] = ["SEC", "Big Twelve"]
        self.assertProblem("playoffFormats[1].powerConferences: 'Big Twelve' is not the conference of any FBS team")
        self.fmt()["powerConferences"] = ["SEC", "FBS Independents"]
        self.assertProblem("'FBS Independents' is also listed in nonConferences")
        self.fmt()["powerConferences"] = []
        self.assertProblem("rules[0]: a 'power' rule needs powerConferences")

    def test_format_text_fields(self):
        f = self.fmt()
        f["note"] = "No period"
        f["label"] = ""
        f["status"] = "rumored"
        f["checkedOn"] = "2026-13-01"
        f["sourceUrl"] = "http://example.com"
        probs = self.problems()
        for needle in ("playoffFormats[1].note: expected one plain-English sentence", "playoffFormats[1].label: expected a non-empty string",
                       "playoffFormats[1].status: expected 'current' or 'proposed'", "playoffFormats[1].checkedOn: expected YYYY-MM-DD",
                       "playoffFormats[1].sourceUrl: expected an https URL"):
            self.assertTrue(any(needle in p for p in probs), f"{needle!r} not in {probs}")

    def test_source_url_never_on_the_banned_network(self):
        self.fmt()["sourceUrl"] = "https://www." + V.BANNED_HOST + ".com/college-football/story"
        self.assertProblem("playoffFormats[1].sourceUrl: links to a banned network's site")

    def test_formats_must_be_a_list(self):
        self.doc["playoffFormats"] = []
        self.assertProblem("playoffFormats: expected a non-empty list")
        self.doc["playoffFormats"] = [{"id": "x"}]
        self.assertProblem("playoffFormats[0].size: missing")

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
        self.doc["playoffFormats"][0]["autoBids"]["guaranteed"][0]["slug"] = {"slug": "notre-dame"}
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


class PlayoffFormatsConfig(unittest.TestCase):
    """pipeline/playoff_formats.json holds the formats SPEC.md "Playoff formats" describes."""

    @classmethod
    def setUpClass(cls):
        cls.formats = V.load_json(PIPE / "playoff_formats.json")["2026"]

    def test_two_formats_12_default(self):
        f12, f24 = self.formats
        self.assertEqual([f["id"] for f in self.formats], ["12-team", "24-team"])
        self.assertEqual((f12["status"], f12["default"], f12["size"], f12["byes"]), ("current", True, 12, 4))
        self.assertEqual(f12["autoBids"], {"rules": [{"from": "all", "count": 5}],
                                           "guaranteed": [{"slug": "notre-dame", "ifRankedAtOrAbove": 12}]})
        self.assertEqual((f24["status"], f24["default"], f24["size"], f24["byes"]), ("proposed", False, 24, 8))
        self.assertEqual(f24["autoBids"], {"rules": [{"from": "power", "count": 4}, {"from": "nonPower", "count": 1}],
                                           "guaranteed": []})
        for f in self.formats:
            self.assertEqual(f["powerConferences"], ["ACC", "Big 12", "Big Ten", "SEC"])
            self.assertEqual(f["nonConferences"], ["FBS Independents"])
        self.assertEqual(f24["sourceName"], "Deseret News")
        self.assertTrue(f24["sourceUrl"].startswith("https://www.deseret.com/"))

    def test_validates_against_a_full_conference_set(self):
        teams = {"notre-dame": {"conference": "FBS Independents"}}
        for c in ("ACC", "Big 12", "Big Ten", "SEC", "Mountain West"):
            teams[c] = {"conference": c}
        err = V.Errors("config")
        V._validate_playoff_formats({"playoffFormats": self.formats}, teams, err)
        self.assertEqual(err.items, [])
        blob = json.dumps(self.formats)
        self.assertNotIn(V.BANNED_HOST, blob.lower())
        for b in V.BANNED:
            self.assertNotIn(b, blob)


class RankingsConferencesDates(unittest.TestCase):
    """DA-1/2/3: realistic corruptions of the real week-9 file that used to pass the validator."""

    @classmethod
    def setUpClass(cls):
        path = PIPE.parent / "data" / "2026" / "week-9.json"
        if not path.exists():
            raise unittest.SkipTest("no committed week-9 file")
        cls.base = V.load_json(path)

    def setUp(self):
        self.doc = copy.deepcopy(self.base)
        self.t = self.doc["teams"]

    def problems(self, **kw):
        return V.validate_week(self.doc, **kw)

    def assertProblem(self, needle, **kw):
        probs = self.problems(**kw)
        self.assertTrue(any(needle in p for p in probs), f"{needle!r} not in {probs[:8]}")

    def test_real_file_passes_including_legitimate_ties(self):
        # ELS has a nine-way tie at #129 (so 130-137 are absent): a valid competition ranking.
        self.assertEqual(sum(1 for t in self.t.values() if t["ranks"]["sos"] == 129), 9)
        self.assertEqual(self.problems(), [])

    def test_rank_gap_and_shared_rank(self):  # 03a: no #5, two #6
        self.t["alabama"]["ranks"]["fei"] = 6
        self.assertProblem("ranks.fei (by values.fei): not a valid ranking (no team is ranked #5)")

    def test_no_number_one(self):  # 03b
        self.t["kentucky"]["ranks"]["sor"] = 2
        self.assertProblem("ranks.sor (by values.gwd): no team is ranked #1")

    def test_shifted_tail(self):  # 03c: every OFEI rank >= 60 shifted +1
        for t in self.t.values():
            if t["ranks"]["off"] >= 60:
                t["ranks"]["off"] = min(138, t["ranks"]["off"] + 1)
        self.assertProblem("ranks.off (by values.ofei): not a valid ranking (no team is ranked #60)")

    def test_rank_value_inversion(self):  # 03d: best and worst swapped
        self.t["notre-dame"]["ranks"]["fei"], self.t["sacramento-state"]["ranks"]["fei"] = 138, 1
        self.assertProblem("ranks and values disagree")

    def test_value_contradicts_rank(self):  # 09
        self.t["miami"]["values"]["gwd"] = -9.99
        self.assertProblem("ranks.sor (by values.gwd): texas (#4) has a higher value (1.92) than miami (#3, -9.99)")

    def test_tied_ranks_need_equal_values(self):
        self.t["wyoming"]["values"]["els"] = 0.08
        self.assertProblem("share #129 but have different values")

    def test_unknown_conference_name(self):  # 07a: a typo makes a one-team conference
        self.t["ohio-state"]["conference"] = "Big 10"
        self.assertProblem("conference 'Big 10' (ohio-state) is not in the season's list")

    def test_conference_game_against_fcs(self):  # 07b
        g = next(g for g in self.t["miami"]["games"] if not g["oppFbs"])
        g["conf"] = True
        self.t["miami"]["confRecord"]["w" if g["result"] == "W" else "l"] += 1
        self.assertProblem("is marked a conference game against a non-FBS team")

    def test_conference_game_across_conferences(self):  # 07c
        for a, b in (("usc", "fresno-state"), ("fresno-state", "usc")):
            g = next(g for g in self.t[a]["games"] if g["opp"] == b)
            g["conf"] = True
            self.t[a]["confRecord"]["w" if g["result"] == "W" else "l"] += 1
        self.assertProblem("but usc plays in 'Big Ten' and fresno-state in 'Pac-12'")

    def test_independent_has_no_conference_games(self):
        for a, b in (("notre-dame", "navy"), ("navy", "notre-dame")):
            g = next((g for g in self.t[a]["games"] if g["opp"] == b), None)
            if g is None:
                self.skipTest("no Notre Dame - Navy game in this file")
            g["conf"] = True
            self.t[a]["confRecord"]["w" if g["result"] == "W" else "l"] += 1
        self.assertProblem("is marked a conference game, but 'FBS Independents' is not a conference")

    def test_committee_release_before_the_season_schedule(self):  # 08
        self.doc["sources"]["committee"]["releaseDate"] = "2026-10-20"
        self.assertProblem("is before the season's first scheduled release 2026-11-03")
        self.assertProblem("a stale committee ranking for week 9")

    def test_last_weeks_release_is_still_allowed(self):
        # A Monday build keeps the previous Tuesday's release: up to a week older than the newest game.
        newest = max(g["date"] for t in self.t.values() for g in t["games"])
        self.assertLessEqual((date.fromisoformat(newest) - date.fromisoformat("2026-11-03")).days, V.STALE_COMMITTEE_DAYS)
        self.assertEqual(self.problems(), [])

    def test_game_after_as_of(self):  # 10
        g = next(g for g in self.t["miami"]["games"] if not g["oppFbs"])
        g["date"] = "2026-11-14"
        self.t["miami"]["games"].sort(key=lambda x: x["date"])
        self.assertProblem("is dated 2026-11-14, after asOf 2026-11-05")

    def test_duplicate_game_on_another_date(self):  # 13: a rescheduled game listed twice, mirrored
        for a, b in (("miami", "stanford"), ("stanford", "miami")):
            g = copy.deepcopy(next(g for g in self.t[a]["games"] if g["opp"] == b))
            g["date"] = (date.fromisoformat(g["date"]) + timedelta(days=1)).isoformat()
            self.t[a]["games"].append(g)
            self.t[a]["games"].sort(key=lambda x: x["date"])
            self.t[a]["record"]["w" if g["result"] == "W" else "l"] += 1
            if g["conf"]:
                self.t[a]["confRecord"]["w" if g["result"] == "W" else "l"] += 1
        self.assertProblem("teams[miami]: two games vs stanford")

    def test_rematch_six_days_later_is_allowed(self):
        # A Saturday finale and a Friday conference championship six days later are two real games.
        probs = []
        err = V.Errors("x")
        games = {"a": [{"week": 13, "date": "2026-11-28", "opp": "b"}, {"week": 14, "date": "2026-12-04", "opp": "b"}]}
        V._validate_dates({"asOf": "2026-12-08", "sources": {}}, games, None, err)
        probs.extend(err.items)
        self.assertEqual(probs, [])

    def test_conference_or_membership_change_from_previous_week(self):
        previous = copy.deepcopy(self.base)
        previous["week"] = 8
        self.t["boise-state"]["conference"] = "Mountain West"
        self.assertProblem("teams[boise-state].conference is 'Mountain West' but week 8 says 'Pac-12'", previous=previous)
        self.doc = copy.deepcopy(self.base)
        del previous["teams"]["utep"]
        self.assertProblem("'utep' is new since week 8", previous=previous)
        previous = copy.deepcopy(self.base)
        previous["week"] = 8
        opp = next(iter(sorted(self.doc["opponents"])))
        self.doc["opponents"][opp]["classification"] = "ii"
        self.assertProblem(f"opponents[{opp}].classification is 'ii' but week 8 says", previous=previous)

    def test_upcoming_schedule(self):
        up = self.t["miami"]["upcoming"]
        self.assertTrue(up)
        g = up[0]
        g["site"] = "neutral"
        self.assertProblem("teams[miami].upcoming: week 10")
        self.doc = copy.deepcopy(self.base)
        self.doc["teams"]["miami"]["upcoming"][0]["week"] = 9
        self.assertProblem("must be after the file's week 9")
        self.doc = copy.deepcopy(self.base)
        self.doc["teams"]["miami"]["upcoming"][0]["pf"] = 3
        self.assertProblem("teams[miami].upcoming[0].pf: unexpected field")
        self.doc = copy.deepcopy(self.base)
        for t in self.doc["teams"].values():
            del t["upcoming"]
        # Optional: a file without schedules is valid once opponents only referenced by them are gone.
        used = {g["opp"] for t in self.doc["teams"].values() for g in t["games"] if not g["oppFbs"]}
        self.doc["opponents"] = {k: v for k, v in self.doc["opponents"].items() if k in used}
        self.assertEqual(V.validate_week(self.doc), [])

    def test_season_needs_a_conference_list(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "conferences.json").write_text(json.dumps({"2025": ["SEC"]}), encoding="utf-8")
            self.assertProblem("has no conference list for season 2026", config_dir=Path(d))


class ConferencesConfig(unittest.TestCase):
    def test_every_committed_conference_is_listed(self):
        cfg = V.load_json(PIPE / "conferences.json")
        for path in sorted((PIPE.parent / "data").glob("*/week-*.json")):
            doc = V.load_json(path)
            used = {t["conference"] for t in doc["teams"].values()}
            self.assertEqual(sorted(used - set(cfg[str(doc["season"])])), [], path)


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
