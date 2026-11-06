import tempfile
import unittest
from pathlib import Path

import _util  # noqa: F401  (sys.path)
import requests

from cfbpipe import USER_AGENT
from cfbpipe.net import Fetcher, FetchError


class FakeResp:
    def __init__(self, status, text="ok"):
        self.status_code = status
        self.text = text
        self.encoding = "utf-8"


class FakeSession:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append((url, params, headers))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FetcherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.sleeps = []

    def fetcher(self, script, **kw):
        self.session = FakeSession(script)
        return Fetcher(Path(self.tmp.name), sleep=self.sleeps.append, session=self.session, log=lambda m: None, **kw)

    def test_retry_with_backoff_then_cache(self):
        f = self.fetcher([requests.ConnectionError("boom"), FakeResp(503), FakeResp(200, "<table>")])
        res = f.get("https://example.test/x", "2026/x.html")
        self.assertEqual(res.text, "<table>")
        self.assertEqual(self.sleeps, [2.0, 4.0])
        self.assertEqual((Path(self.tmp.name) / "2026/x.html").read_text(), "<table>")
        self.assertEqual(self.session.calls[0][2]["User-Agent"], USER_AGENT)
        cached = Fetcher(Path(self.tmp.name), use_cache=True).get("https://example.test/x", "2026/x.html")
        self.assertTrue(cached.from_cache)

    def test_client_error_not_retried(self):
        f = self.fetcher([FakeResp(403, "blocked")])
        with self.assertRaises(FetchError) as cm:
            f.get("https://example.test/y", "y.html")
        self.assertEqual(cm.exception.status, 403)
        self.assertEqual(len(self.session.calls), 1)
        self.assertFalse((Path(self.tmp.name) / "y.html").exists())

    def test_gives_up_after_retries(self):
        f = self.fetcher([FakeResp(500)] * 4)
        with self.assertRaises(FetchError):
            f.get("https://example.test/z", "z.html")
        self.assertEqual(len(self.session.calls), 4)

    def test_missing_cache(self):
        with self.assertRaises(FetchError):
            Fetcher(Path(self.tmp.name), use_cache=True).get("https://example.test/q", "q.html")


if __name__ == "__main__":
    unittest.main()
