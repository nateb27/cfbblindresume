import json
import unittest
from datetime import date

from _util import FIX, PIPE, read

from cfbpipe import PipelineError
from cfbpipe.committee import (CommitteeUnavailable, Release, calendar_windows, choose, committee_polls,
                               date_cfbd_polls, last_game_day, parse_bcftoys_cfp, parse_cfp_page,
                               snapshot_cutoff)

CAL = [
    {"season": 2026, "week": 9, "seasonType": "regular", "startDate": "2026-10-26T07:00:00.000Z", "endDate": "2026-11-02T07:59:00.000Z"},
    {"season": 2026, "week": 10, "seasonType": "regular", "startDate": "2026-11-02T08:00:00.000Z", "endDate": "2026-11-09T07:59:00.000Z"},
    {"season": 2026, "week": 11, "seasonType": "regular", "startDate": "2026-11-09T08:00:00.000Z", "endDate": "2026-11-16T07:59:00.000Z"},
    {"season": 2026, "week": 12, "seasonType": "regular", "startDate": "2026-11-16T08:00:00.000Z", "endDate": "2026-11-23T07:59:00.000Z"},
]
SCHEDULE = ["2026-11-03", "2026-11-10", "2026-11-17"]
A = [f"t{i}" for i in range(25)]
B = A[1:] + A[:1]


def poll(week, ids):
    return {"season": 2026, "seasonType": "regular", "week": week, "polls": [
        {"poll": "AP Top 25", "ranks": []},
        {"poll": "Playoff Committee Rankings", "ranks": [{"rank": i + 1, "teamId": t, "school": f"S{t}"} for i, t in enumerate(ids)]}]}


class CfpPage(unittest.TestCase):
    def test_parse_synthetic_page(self):
        rel = parse_cfp_page(read(FIX / "cfp_rankings_synthetic.html"), 2026, date(2026, 11, 5))
        self.assertEqual(rel.date, "2026-11-03")
        self.assertEqual(len(rel.names), 25)
        self.assertEqual(rel.names[:3], ["Miami", "Georgia", "Utah"])
        self.assertEqual(rel.names[19], "Southern California")

    def test_later_dates_on_page_are_ignored(self):
        # the "Next rankings release: Nov. 10" line must not become the release date
        rel = parse_cfp_page(read(FIX / "cfp_rankings_synthetic.html"), 2026, date(2026, 11, 11))
        self.assertEqual(rel.date, "2026-11-03")

    def test_inline_text_format(self):
        names = ["Miami", "Georgia", "Miami (OH)", "Texas A&M"] + [f"Team {chr(65 + i)}" for i in range(21)]
        body = " ".join(f"{i + 1} {n} {8 - i % 3}-{i % 3}" for i, n in enumerate(names))
        rel = parse_cfp_page(f"<p>Rankings Nov. 3</p><div>Full Rankings {body}</div>", 2026, date(2026, 11, 5))
        self.assertEqual(rel.names, names)

    def test_blocked_page(self):
        with self.assertRaises(CommitteeUnavailable):
            parse_cfp_page("<html>Request unsuccessful. Incapsula incident ID: 1</html>", 2026, date(2026, 11, 5))

    def test_bcftoys_cfp_profile(self):
        rows = parse_bcftoys_cfp(read(FIX / "bcftoys_cfp_trimmed.html"))
        self.assertEqual(len(rows), 25)
        self.assertEqual(rows[0], (1, "Miami"))
        self.assertEqual(rows[19], (20, "USC"))


class CfbdDating(unittest.TestCase):
    def setUp(self):
        self.win = calendar_windows(CAL)

    def test_polls_extracted_in_order(self):
        polls = committee_polls({"regular": [poll(11, range(25)), poll(10, range(25)), {"week": 9, "polls": []}]})
        self.assertEqual([p["week"] for p in polls], [10, 11])
        self.assertEqual(polls[0]["ranks"][0], (1, 0, "S0"))

    def test_ordinal_dates(self):
        polls = committee_polls({"regular": [poll(10, range(25)), poll(11, range(25))]})
        self.assertEqual([d for _, d in date_cfbd_polls(polls, SCHEDULE, self.win)], ["2026-11-03", "2026-11-10"])

    def test_misaligned_poll_fails(self):
        polls = committee_polls({"regular": [poll(11, range(25))]})  # CFBD missing the week-10 poll
        with self.assertRaisesRegex(PipelineError, "does not line up"):
            date_cfbd_polls(polls, SCHEDULE, self.win)

    def test_override(self):
        polls = committee_polls({"regular": [poll(11, range(25))]})
        self.assertEqual(date_cfbd_polls(polls, SCHEDULE, self.win, "2026-11-10")[0][1], "2026-11-10")

    def test_cutoff_is_the_first_release_after_the_weeks_last_game(self):
        games = [{"seasonType": "regular", "week": 9, "startDate": "2026-10-31T23:30:00.000Z"},
                 {"seasonType": "regular", "week": 10, "startDate": "2026-11-08T00:30:00.000Z"}]  # Sat 7:30pm ET
        rels = [date.fromisoformat(d) for d in SCHEDULE]
        self.assertEqual(last_game_day(10, games, self.win), date(2026, 11, 7))
        self.assertEqual(snapshot_cutoff(9, games, self.win, rels), date(2026, 11, 3))
        self.assertEqual(snapshot_cutoff(10, games, self.win, rels), date(2026, 11, 10))
        self.assertEqual(snapshot_cutoff(11, games, self.win, rels), date(2026, 11, 17))  # no games: window end
        self.assertIsNone(snapshot_cutoff(12, games, self.win, rels))  # no release after week 12
        with self.assertRaises(PipelineError):
            snapshot_cutoff(20, games, self.win, rels)  # neither games nor a calendar window

    def test_postponed_game_outside_the_window_is_ignored(self):
        games = [{"seasonType": "regular", "week": 9, "startDate": "2026-10-31T23:30:00.000Z"},
                 {"seasonType": "regular", "week": 9, "startDate": "2026-11-14T19:00:00.000Z"}]
        self.assertEqual(last_game_day(9, games, self.win), date(2026, 10, 31))


class RealCalendar2026(unittest.TestCase):
    """Real CFBD /calendar?year=2026 and the real 2026 game dates (fetched 2026-11-05), with the
    scheduled committee releases: the Tuesday releases follow weeks 9-13, and the Sunday Dec 6
    release follows championship weekend (week 14, which CFBD has not filled with games yet)."""

    @classmethod
    def setUpClass(cls):
        cls.win = calendar_windows(json.loads(read(FIX / "cfbd_2026_calendar.json")))
        cls.games = json.loads(read(FIX / "cfbd_2026_game_days.json"))
        sched = json.loads(read(PIPE / "committee_schedule.json"))["2026"]["releases"]
        cls.dates = [date.fromisoformat(d) for d in sched]
        cls.rels = [rel(d, [f"r{i}"], "cfbd") for i, d in enumerate(sched)]

    def pick(self, week, as_of, games=None):
        games = self.games if games is None else games
        cutoff = snapshot_cutoff(week, games, self.win, self.dates)
        r = choose("cfbd", None, self.rels, as_of, cutoff, lambda _m: None)
        return r.date if r else None

    def test_each_week_gets_the_release_that_follows_it(self):
        jan = date(2027, 1, 15)
        expected = {9: "2026-11-03", 10: "2026-11-10", 11: "2026-11-17", 12: "2026-11-24",
                    13: "2026-12-01", 14: "2026-12-06", 15: "2026-12-06"}
        self.assertEqual({w: self.pick(w, jan) for w in expected}, expected)

    def test_week_13_never_takes_the_post_championship_release(self):
        for as_of in (date(2026, 12, 2), date(2026, 12, 6), date(2026, 12, 7), date(2027, 1, 15)):
            self.assertEqual(self.pick(13, as_of), "2026-12-01", as_of)

    def test_week_14_with_championship_games_listed(self):
        champs = [{"seasonType": "regular", "week": 14, "startDate": "2026-12-05T20:00:00.000Z"},
                  {"seasonType": "regular", "week": 14, "startDate": "2026-12-06T01:00:00.000Z"}]  # Sat 8pm ET
        self.assertEqual(self.pick(14, date(2026, 12, 7), self.games + champs), "2026-12-06")
        self.assertEqual(self.pick(14, date(2026, 12, 5), self.games + champs), "2026-12-01")

    def test_monday_run_keeps_the_previous_release_until_the_next_one_is_out(self):
        self.assertEqual(self.pick(10, date(2026, 11, 9)), "2026-11-03")   # Monday after week 10
        self.assertEqual(self.pick(10, date(2026, 11, 11)), "2026-11-10")  # Wednesday run
        self.assertIsNone(self.pick(9, date(2026, 11, 2)))                 # before the first release


def rel(d, slugs, source):
    return Release(date=d, names=list(slugs), slugs=list(slugs), source=source)


class Choose(unittest.TestCase):
    quiet = staticmethod(lambda _m: None)

    def test_agree(self):
        r = choose("auto", rel("2026-11-03", A, "cfp"), [rel("2026-11-03", A, "cfbd")], date(2026, 11, 5), None, self.quiet)
        self.assertEqual((r.source, r.slugs), ("cfp", A))

    def test_disagree_fails_loudly(self):
        with self.assertRaisesRegex(PipelineError, "disagree"):
            choose("auto", rel("2026-11-03", A, "cfp"), [rel("2026-11-03", B, "cfbd")], date(2026, 11, 5), None, self.quiet)

    def test_cfp_newer_than_cfbd(self):
        r = choose("auto", rel("2026-11-10", B, "cfp"), [rel("2026-11-03", A, "cfbd")], date(2026, 11, 11), None, self.quiet)
        self.assertEqual(r.date, "2026-11-10")

    def test_cfbd_newer_than_cfp_fails(self):
        with self.assertRaises(PipelineError):
            choose("auto", rel("2026-11-03", A, "cfp"), [rel("2026-11-03", A, "cfbd"), rel("2026-11-10", B, "cfbd")],
                   date(2026, 11, 11), None, self.quiet)

    def test_cfbd_only_when_cfp_blocked(self):
        r = choose("auto", None, [rel("2026-11-03", A, "cfbd")], date(2026, 11, 5), None, self.quiet)
        self.assertEqual((r.source, r.date), ("cfbd", "2026-11-03"))

    def test_no_release_yet(self):
        self.assertIsNone(choose("auto", None, [], date(2026, 10, 30), None, self.quiet))

    def test_release_after_build_date_not_used(self):
        self.assertIsNone(choose("auto", None, [rel("2026-11-03", A, "cfbd")], date(2026, 11, 2), None, self.quiet))

    def test_snapshot_cutoff_picks_the_matching_release(self):
        cands = [rel("2026-11-03", A, "cfbd"), rel("2026-11-10", B, "cfbd")]
        r = choose("auto", None, cands, date(2026, 11, 20), date(2026, 11, 9), self.quiet)  # rebuilding week 9 later
        self.assertEqual(r.date, "2026-11-03")

    def test_cfp_page_too_new_without_cfbd_fails(self):
        with self.assertRaisesRegex(PipelineError, "newer than this snapshot allows"):
            choose("auto", rel("2026-11-10", B, "cfp"), [], date(2026, 11, 12), date(2026, 11, 9), self.quiet,
                   cfbd_available=False)
        # with CFBD available and no older release, null is the right answer (e.g. rebuilding week 8)
        self.assertIsNone(choose("auto", rel("2026-11-03", A, "cfp"), [rel("2026-11-03", A, "cfbd")],
                                 date(2026, 11, 12), date(2026, 11, 2), self.quiet))

    def test_modes(self):
        self.assertIsNone(choose("none", rel("2026-11-03", A, "cfp"), [], date(2026, 11, 5), None, self.quiet))
        with self.assertRaises(PipelineError):
            choose("cfp", None, [rel("2026-11-03", A, "cfbd")], date(2026, 11, 5), None, self.quiet)
        r = choose("cfbd", rel("2026-11-03", B, "cfp"), [rel("2026-11-03", A, "cfbd")], date(2026, 11, 5), None, self.quiet)
        self.assertEqual(r.slugs, A)


if __name__ == "__main__":
    unittest.main()
