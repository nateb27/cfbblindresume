import unittest

from _util import FIX, MINI, read

from cfbpipe import PipelineError
from cfbpipe.fei import COLUMNS, looks_like_fei_page, parse_fei_html, parse_fei_text


class RealPageTrimmed(unittest.TestCase):
    """fixtures/fei_trimmed.html: real bcftoys markup (rows 1-30 and 136-138)."""

    @classmethod
    def setUpClass(cls):
        cls.t = parse_fei_html(read(FIX / "fei_trimmed.html"))

    def test_through_week_and_row_count(self):
        self.assertEqual(self.t.through_week, 9)
        self.assertEqual(len(self.t.rows), 33)  # repeated header rows are skipped

    def test_first_row(self):
        r = self.t.rows[0]
        self.assertEqual((r.rank, r.team, r.rec, r.fbs), (1, "Notre Dame", (7, 1), (7, 1)))
        self.assertEqual(r.values["FEI"], 1.43)
        self.assertEqual(r.values["OFEI"], 0.65)  # ".65"
        self.assertEqual(r.values["EWD"], -0.55)  # "-.55"
        self.assertEqual(r.ranks["OFEI_Rk"], 4)
        self.assertEqual(r.ranks["DFEI_Rk"], 4)
        self.assertEqual(r.ranks["ELS_Rk"], 65)
        self.assertEqual(r.ranks["GWD_Rk"], 16)

    def test_negative_ratings_and_block_boundaries(self):
        by = self.t.by_team()
        self.assertEqual(by["UTEP"].values["FEI"], -1.37)
        self.assertEqual(by["UTEP"].rank, 136)
        self.assertEqual(by["UCLA"].rank, 16)  # first row after a repeated header
        self.assertEqual(by["Sacramento State"].values["GWD"], -6.69)
        self.assertEqual([r.rank for r in self.t.rows[:30]], list(range(1, 31)))


class MiniAndFallbacks(unittest.TestCase):
    def setUp(self):
        self.html = parse_fei_html(read(MINI / "2026" / "bcftoys-fei.html"))

    def test_mini_html(self):
        self.assertEqual(self.html.through_week, 3)
        self.assertEqual([r.team for r in self.html.rows],
                         ["Texas A&M", "Notre Dame", "San Jose State", "Hawaii", "Appalachian State", "Miami (OH)"])

    def test_csv_matches_html(self):
        t = parse_fei_text(read(FIX / "fei_mini.csv"))
        self.assertEqual(t.origin, "csv")
        self.assertEqual(t.through_week, 3)
        self.assertEqual(t.rows, self.html.rows)

    def test_pasted_tsv_matches_html(self):
        t = parse_fei_text(read(FIX / "fei_mini_paste.txt"))
        self.assertEqual(t.through_week, 3)
        self.assertEqual(t.rows, self.html.rows)

    def test_space_separated_paste(self):
        header = " ".join("Rk" if c.endswith("_Rk") else c for c in COLUMNS)  # the page's header row
        lines = ["2026 FEI Ratings (through Week 3)", header]
        for r in self.html.rows:
            lines.append("  ".join(str(v) for v in self.cells(r, COLUMNS)))
        t = parse_fei_text("\n".join(lines))
        self.assertEqual(t.rows, self.html.rows)

    @staticmethod
    def cells(r, order):
        vals = {"Rk": r.rank, "Team": r.team, "Rec": f"{r.rec[0]}-{r.rec[1]}", "FBS": f"{r.fbs[0]}-{r.fbs[1]}",
                **r.values, **r.ranks}
        return [vals[c] for c in order]

    def test_columns_are_matched_by_header_name_not_position(self):
        order = COLUMNS[:5] + ["DFEI", "DFEI_Rk", "OFEI", "OFEI_Rk"] + COLUMNS[9:]  # defense before offense
        csv_lines = ["# 2026 FEI Ratings (through Week 3)", ",".join(order)]
        csv_lines += [",".join(str(v) for v in self.cells(r, order)) for r in self.html.rows]
        self.assertEqual(parse_fei_text("\n".join(csv_lines)).rows, self.html.rows)
        # the same with the page's own header style (bare "Rk" after each column), tab-separated
        page_header = ["Rk" if c.endswith("_Rk") else c for c in order]
        tsv = ["2026 FEI Ratings (through Week 3)", "\t".join(page_header)]
        tsv += ["\t".join(str(v) for v in self.cells(r, order)) for r in self.html.rows]
        t = parse_fei_text("\n".join(tsv))
        self.assertEqual(t.rows, self.html.rows)
        nd = t.by_team()["Notre Dame"]
        self.assertEqual((nd.values["OFEI"], nd.ranks["OFEI_Rk"], nd.values["DFEI"], nd.ranks["DFEI_Rk"]),
                         (0.55, 2, 0.50, 1))

    def test_data_without_a_header_row_is_refused(self):
        lines = [ln for ln in read(FIX / "fei_mini.csv").splitlines() if not ln.startswith("Rk,")]
        with self.assertRaisesRegex(PipelineError, "data row before any header row"):
            parse_fei_text("\n".join(lines))
        paste = [ln for ln in read(FIX / "fei_mini_paste.txt").splitlines() if not ln.startswith("Rk\t")]
        with self.assertRaisesRegex(PipelineError, "data row before any header row"):
            parse_fei_text("\n".join(paste))

    def test_header_missing_or_repeating_a_column_is_refused(self):
        text = read(FIX / "fei_mini.csv")
        with self.assertRaisesRegex(PipelineError, r"missing columns \['GWD'\]"):
            parse_fei_text(text.replace(",GWD,GWD_Rk,", ",XWD,GWD_Rk,"))
        with self.assertRaisesRegex(PipelineError, "OFEI appears twice"):
            parse_fei_text(text.replace(",DFEI,DFEI_Rk,", ",OFEI,DFEI_Rk,"))

    def test_unicode_minus_and_template_header(self):
        text = read(FIX / "fei_mini.csv").replace(",-.55,", ",−.55,")
        self.assertEqual(parse_fei_text(text).rows, self.html.rows)

    def test_template_has_no_rows(self):
        with self.assertRaises(PipelineError):
            parse_fei_text(read(FIX.parents[1] / "fei_template.csv"))

    def test_short_csv_row_is_an_error(self):
        bad = read(FIX / "fei_mini.csv").replace(",1.70,1\n", ",1.70\n", 1)
        with self.assertRaisesRegex(PipelineError, "expected 23"):
            parse_fei_text(bad)

    def test_bad_number(self):
        bad = read(FIX / "fei_mini.csv").replace(",1.10,", ",1.1x,", 1)
        with self.assertRaisesRegex(PipelineError, "not a number"):
            parse_fei_text(bad)

    def test_duplicate_team(self):
        lines = read(FIX / "fei_mini.csv").splitlines()
        with self.assertRaisesRegex(PipelineError, "twice"):
            parse_fei_text("\n".join(lines + [lines[2]]))

    def test_rank_typo_in_a_paste_is_refused(self):
        # Notre Dame's GWD rank 2 -> 4: now below Hawaii (#4, -.30) with a higher GWD (.20).
        bad = read(FIX / "fei_mini.csv").replace(",-.55,3,.20,2,", ",-.55,3,.20,4,", 1)
        self.assertNotEqual(bad, read(FIX / "fei_mini.csv"))
        with self.assertRaisesRegex(PipelineError, "column GWD_Rk does not follow GWD"):
            parse_fei_text(bad)

    def test_value_typo_in_a_paste_is_refused(self):
        # Texas A&M's FEI 1.10 -> -1.10 while it stays #1.
        bad = read(FIX / "fei_mini.csv").replace(",1.10,", ",-1.10,", 1)
        with self.assertRaisesRegex(PipelineError, "column Rk does not follow FEI"):
            parse_fei_text(bad)

    def test_real_page_ranks_follow_values(self):
        # The trimmed real page (rows 1-30 and 136-138) passes the same check.
        self.assertEqual(len(parse_fei_html(read(FIX / "fei_trimmed.html")).rows), 33)

    def test_non_table_content(self):
        blocked = "<html><body>Request unsuccessful. Incapsula incident ID: 123</body></html>"
        self.assertFalse(looks_like_fei_page(blocked))
        with self.assertRaisesRegex(PipelineError, "no data rows"):
            parse_fei_html(blocked)


if __name__ == "__main__":
    unittest.main()
