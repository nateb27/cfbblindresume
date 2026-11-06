import copy
import json
import tempfile
import unittest
from pathlib import Path

from _util import MINI, PIPE, mini_json, read

from cfbpipe import PipelineError
from cfbpipe.build import build_week, included_games
from cfbpipe.fei import parse_fei_html
from cfbpipe.names import SlugBook, load_aliases


def build(games=None, teams=None, fei_html=None, week=3, aliases=None, committee=None):
    with tempfile.TemporaryDirectory() as d:
        slugs = SlugBook(Path(d) / "slugs.json")
        playoff = json.loads(read(PIPE / "playoff_format.json"))["2026"]
        return build_week(
            season=2026, week=week, as_of="2026-09-25",
            fei=parse_fei_html(fei_html or read(MINI / "2026" / "bcftoys-fei.html")),
            fei_url="https://bcftoys.com/2026-fei",
            cfbd_teams=teams if teams is not None else mini_json("cfbd-teams-fbs.json"),
            cfbd_games=games if games is not None else mini_json("cfbd-games-regular.json"),
            committee=committee, committee_url=None, playoff=playoff,
            aliases=aliases or load_aliases(PIPE / "aliases.json"), slugs=slugs,
        )


class BuildMini(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res = build()
        cls.doc = cls.res.doc
        cls.t = cls.doc["teams"]

    def test_no_errors_and_counts(self):
        self.assertEqual(self.res.errors, [])
        self.assertEqual(self.doc["fbsCount"], 6)
        self.assertEqual(sorted(self.t), ["app-state", "hawaii", "miami-oh", "notre-dame", "san-jose-state", "texas-am"])
        self.assertEqual(self.res.stats["games"], 6)

    def test_week_filter_excludes_later_completed_games(self):
        # 900008 (week 4, completed midweek) and 900009 (week 4, not played) are excluded from week 3
        self.assertEqual(self.t["miami-oh"]["record"], {"w": 0, "l": 2})
        self.assertEqual(self.t["san-jose-state"]["record"], {"w": 1, "l": 0})
        self.assertTrue(all(g["week"] <= 3 for t in self.t.values() for g in t["games"]))
        self.assertEqual(self.res.stats["excludedLaterCompleted"], 1)
        ids = [g["id"] for g in included_games(mini_json("cfbd-games-regular.json"), {87, 2026, 62, 23, 245, 193}, 4)]
        self.assertIn(900008, ids)
        self.assertNotIn(900009, ids)

    def test_fcs_opponent(self):
        self.assertEqual(self.doc["opponents"], {
            "the-citadel": {"slug": "the-citadel", "name": "The Citadel", "classification": "fcs"}})
        g = self.t["app-state"]["games"][0]
        self.assertEqual((g["opp"], g["oppFbs"], g["site"], g["result"], g["pf"], g["pa"]),
                         ("the-citadel", False, "home", "W", 45, 10))
        # an FCS-vs-FCS game (The Citadel vs Furman) is not part of the file
        self.assertNotIn("furman", self.doc["opponents"])

    def test_neutral_site(self):
        a = self.t["texas-am"]["games"][0]
        n = self.t["notre-dame"]["games"][0]
        self.assertEqual((a["site"], a["opp"], a["result"]), ("neutral", "notre-dame", "W"))
        self.assertEqual((n["site"], n["opp"], n["result"], n["pf"], n["pa"]), ("neutral", "texas-am", "L", 24, 31))

    def test_home_away_and_eastern_date(self):
        g = self.t["hawaii"]["games"][1]  # kickoff 2026-09-20T02:00Z = Sept 19, 10pm Eastern
        self.assertEqual((g["date"], g["site"], g["opp"]), ("2026-09-19", "home", "miami-oh"))
        g = self.t["hawaii"]["games"][0]  # 2026-09-12T03:00Z = Sept 11 Eastern, at San José State
        self.assertEqual((g["date"], g["site"], g["conf"]), ("2026-09-11", "away", True))

    def test_records_and_conf_records(self):
        self.assertEqual(self.t["texas-am"]["record"], {"w": 2, "l": 0})
        self.assertEqual(self.t["hawaii"]["confRecord"], {"w": 0, "l": 1})
        self.assertEqual(self.t["san-jose-state"]["confRecord"], {"w": 1, "l": 0})

    def test_ranks_values_identity(self):
        nd = self.t["notre-dame"]
        self.assertEqual(nd["ranks"], {"sor": 2, "sos": 1, "off": 2, "def": 1, "fei": 2, "committee": None})
        self.assertEqual(nd["values"], {"fei": 0.95, "ofei": 0.55, "dfei": 0.5, "gwd": 0.2, "els": 0.45})
        self.assertEqual(nd["name"], "Notre Dame")
        self.assertEqual(self.t["hawaii"]["name"], "Hawai'i")
        self.assertRegex(nd["colors"]["primary"], r"^#[0-9a-f]{6}$")
        self.assertIsNone(self.doc["committee"])
        self.assertIsNone(self.doc["sources"]["committee"])
        self.assertEqual(self.doc["champions"], {})
        self.assertEqual(self.doc["label"], "After Week 3")

    def test_record_mismatch_with_fei_is_an_error(self):
        games = mini_json("cfbd-games-regular.json")
        games[4]["homePoints"], games[4]["awayPoints"] = 10, 17  # Texas A&M now loses to App State
        res = build(games=games)
        self.assertTrue(any("Texas A&M: record" in e and "FEI says 2-0" in e for e in res.errors), res.errors)

    def test_fei_from_another_week_is_refused(self):
        # FEI through week 3 with week-4 games would mix two weeks' data in one file
        with self.assertRaisesRegex(PipelineError, "through Week 3 but the snapshot is week 4"):
            build(week=4)

    def test_fei_without_week_is_cross_checked_against_the_snapshot_week(self):
        html = read(MINI / "2026" / "bcftoys-fei.html").replace("(through Week 3)", "")
        self.assertIsNone(parse_fei_html(html).through_week)
        self.assertEqual(build(fei_html=html).errors, [])
        res = build(fei_html=html, week=4)  # week-4 games added, FEI records still week 3 -> refused
        self.assertTrue(any("Miami (OH): record from CFBD games through week 4 is 1-2 but FEI says 0-2" in e
                            for e in res.errors), res.errors)

    def test_unmatched_fei_name_fails(self):
        aliases = load_aliases(PIPE / "aliases.json")
        del aliases["fei"]["Hawaii"]
        with self.assertRaisesRegex(PipelineError, "'Hawaii'"):
            build(aliases=aliases)

    def test_missing_fei_team_fails(self):
        html = read(MINI / "2026" / "bcftoys-fei.html")
        html = "\n".join(line for line in html.split("\n") if "Miami (OH)" not in line)
        with self.assertRaisesRegex(PipelineError, "Miami \\(OH\\)"):
            build(fei_html=html)

    def test_completed_game_without_score_fails(self):
        games = mini_json("cfbd-games-regular.json")
        games[0]["homePoints"] = None
        with self.assertRaisesRegex(PipelineError, "no score"):
            build(games=games)

    def test_champion_detection(self):
        games = mini_json("cfbd-games-regular.json")
        champ = copy.deepcopy(games[2])  # San José State vs Hawai'i, both Mountain West
        champ.update({"id": 900100, "week": 3, "startDate": "2026-09-19T23:00:00.000Z", "neutralSite": False,
                      "notes": "Mountain West Championship", "homeId": 62, "homeTeam": "Hawai'i", "homePoints": 30,
                      "awayId": 23, "awayTeam": "San José State", "awayPoints": 20})
        teams = mini_json("cfbd-teams-fbs.json")
        fei_html = (read(MINI / "2026" / "bcftoys-fei.html")
                    .replace(">1-0<", ">1-1<").replace(">1-1</td><td align=\"center\">1-1</td><td align=\"center\">-.15", ">2-1</td><td align=\"center\">2-1</td><td align=\"center\">-.15"))
        res = build(games=games + [champ], teams=teams, fei_html=fei_html)
        self.assertEqual(res.errors, [])
        self.assertEqual(res.doc["champions"], {"Mountain West": "hawaii"})


if __name__ == "__main__":
    unittest.main()
