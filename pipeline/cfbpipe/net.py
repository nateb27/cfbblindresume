"""HTTP GET with retry/backoff, plus a raw-response cache in pipeline/.cache/."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import requests

from . import USER_AGENT

RETRY_STATUS = {429, 500, 502, 503, 504}


class FetchError(Exception):
    def __init__(self, url: str, message: str, status: int | None = None):
        super().__init__(f"{url}: {message}")
        self.url = url
        self.status = status


@dataclass
class Fetched:
    url: str
    text: str
    from_cache: bool


class Fetcher:
    def __init__(
        self,
        cache_dir: Path,
        use_cache: bool = False,
        retries: int = 4,
        backoff: float = 2.0,
        timeout: float = 30.0,
        sleep: Callable[[float], None] = time.sleep,
        session: requests.Session | None = None,
        log: Callable[[str], None] = print,
    ):
        self.cache_dir = cache_dir
        self.use_cache = use_cache
        self.retries = retries
        self.backoff = backoff
        self.timeout = timeout
        self.sleep = sleep
        self.session = session or requests.Session()
        self.log = log

    def _cache_path(self, name: str) -> Path:
        return self.cache_dir / name

    def cached(self, cache_name: str) -> bool:
        return self._cache_path(cache_name).is_file()

    def store(self, cache_name: str, text: str) -> None:
        """Save an extra copy of a response under another cache name (e.g. per-week FEI pages)."""
        path = self._cache_path(cache_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def get(self, url: str, cache_name: str, params: dict | None = None, headers: dict | None = None) -> Fetched:
        path = self._cache_path(cache_name)
        if self.use_cache:
            if path.exists():
                return Fetched(url=url, text=path.read_text(encoding="utf-8"), from_cache=True)
            raise FetchError(url, f"--use-cache given but {path} does not exist")
        hdrs = {"User-Agent": USER_AGENT}
        if headers:
            hdrs.update(headers)
        last: str = "request failed"
        status: int | None = None
        for attempt in range(self.retries):
            if attempt:
                delay = self.backoff * (2 ** (attempt - 1))
                self.log(f"  retrying {url} in {delay:.0f}s (attempt {attempt + 1}/{self.retries})")
                self.sleep(delay)
            try:
                resp = self.session.get(url, params=params, headers=hdrs, timeout=self.timeout)
            except requests.RequestException as exc:  # network error: retry
                last = f"{type(exc).__name__}: {exc}"
                status = None
                continue
            status = resp.status_code
            if resp.status_code == 200:
                resp.encoding = resp.encoding if resp.encoding and resp.encoding.lower() != "iso-8859-1" else "utf-8"
                text = resp.text
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
                return Fetched(url=url, text=text, from_cache=False)
            last = f"HTTP {resp.status_code}"
            if resp.status_code not in RETRY_STATUS:
                break
        raise FetchError(url, last, status)


def cfbd_headers() -> dict[str, str]:
    """Authorization header for api.collegefootballdata.com when CFBD_API_KEY is set."""
    key = os.environ.get("CFBD_API_KEY", "").strip()
    hdrs = {"Accept": "application/json"}
    if key:
        hdrs["Authorization"] = f"Bearer {key}"
    return hdrs
