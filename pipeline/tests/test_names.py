import json
import tempfile
import unittest
from pathlib import Path

from _util import PIPE

from cfbpipe import PipelineError
from cfbpipe.names import SlugBook, load_aliases, resolve_names, slugify


class Slugs(unittest.TestCase):
    def test_slug_rule(self):
        cases = {
            "Miami (OH)": "miami-oh", "Texas A&M": "texas-am", "Hawai'i": "hawaii", "Hawaiʻi": "hawaii",
            "San José State": "san-jose-state", "Ohio State": "ohio-state", "UL Monroe": "ul-monroe",
            "St. Francis (PA)": "st-francis-pa", "Prairie View A&M": "prairie-view-am", "William & Mary": "william-mary",
            "Arkansas-Pine Bluff": "arkansas-pine-bluff", "Notre Dame": "notre-dame",
        }
        for name, slug in cases.items():
            self.assertEqual(slugify(name), slug, name)

    def test_pinned_slug_never_changes_and_collisions_disambiguate(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "slugs.json"
            p.write_text(json.dumps({"2390": "miami", "193": "miami-ohio-legacy"}), encoding="utf-8")
            book = SlugBook(p)
            self.assertEqual(book.slug_for(193, "Miami (OH)"), "miami-ohio-legacy")  # pinned wins
            self.assertEqual(book.slug_for(999, "Miami"), "miami-999")              # collision
            self.assertEqual(book.slug_for(62, "Hawai'i"), "hawaii")
            self.assertEqual(book.added, {999: "miami-999", 62: "hawaii"})
            book.save()
            again = SlugBook(p)
            self.assertEqual(again.slug_for(62, "Hawaii renamed"), "hawaii")
            self.assertEqual(list(json.loads(p.read_text())), ["62", "193", "999", "2390"])  # numeric order

    def test_duplicate_pinned_slug_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "slugs.json"
            p.write_text(json.dumps({"1": "x", "2": "x"}), encoding="utf-8")
            with self.assertRaises(PipelineError):
                SlugBook(p)

    def test_suffixed_slug_never_collides_with_a_pinned_one(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "slugs.json"
            p.write_text(json.dumps({"1": "foo", "2": "foo-99"}), encoding="utf-8")
            book = SlugBook(p)
            self.assertEqual(book.slug_for(99, "Foo"), "foo-99-2")
            book.save()
            self.assertEqual(SlugBook(p).by_id, {1: "foo", 2: "foo-99", 99: "foo-99-2"})  # reloads cleanly

    def test_malformed_slug_file_is_a_pipeline_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "slugs.json"
            p.write_text('{"1": "foo",', encoding="utf-8")
            with self.assertRaisesRegex(PipelineError, "not valid JSON"):
                SlugBook(p)


class Aliases(unittest.TestCase):
    def setUp(self):
        self.aliases = load_aliases(PIPE / "aliases.json")
        self.known = {"App State", "UConn", "Hawai'i", "San José State", "Southern Miss", "USC", "Miami", "Texas A&M"}

    def test_fei_aliases(self):
        names = ["Appalachian State", "Connecticut", "Hawaii", "San Jose State", "Southern Mississippi", "Miami", "Texas A&M"]
        got = resolve_names(names, self.known, self.aliases["fei"], "FEI")
        self.assertEqual(got["Appalachian State"], "App State")
        self.assertEqual(got["Connecticut"], "UConn")
        self.assertEqual(got["Hawaii"], "Hawai'i")
        self.assertEqual(got["San Jose State"], "San José State")
        self.assertEqual(got["Southern Mississippi"], "Southern Miss")
        self.assertEqual(got["Miami"], "Miami")

    def test_cfp_alias(self):
        got = resolve_names(["Southern California"], self.known, self.aliases["cfp"], "CFP site")
        self.assertEqual(got, {"Southern California": "USC"})

    def test_unmatched_is_hard_failure_listing_names(self):
        with self.assertRaises(PipelineError) as cm:
            resolve_names(["Miami", "Miami (FL)", "Hawaii Rainbow"], self.known, self.aliases["fei"], "FEI")
        msg = str(cm.exception)
        self.assertIn("'Miami (FL)'", msg)
        self.assertIn("'Hawaii Rainbow'", msg)
        self.assertIn("2 team name(s)", msg)


if __name__ == "__main__":
    unittest.main()
