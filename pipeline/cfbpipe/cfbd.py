"""CollegeFootballData.com API (https://api.collegefootballdata.com).

Only these fields are used: teams (id, school, abbreviation, mascot, conference, color,
alternateColor; logos are ignored), games (id, week, seasonType, startDate, completed,
neutralSite, conferenceGame, notes, home*/away* id, team, classification, points), rankings
(poll "Playoff Committee Rankings" only) and the season calendar (week windows).
"""
from __future__ import annotations

import json

from . import PipelineError
from .net import Fetcher, cfbd_headers

BASE = "https://api.collegefootballdata.com"
SITE_URL = "https://collegefootballdata.com"


def get_json(fetcher: Fetcher, path: str, params: dict, cache_name: str):
    res = fetcher.get(f"{BASE}{path}", cache_name, params=params, headers=cfbd_headers())
    try:
        data = json.loads(res.text)
    except json.JSONDecodeError as exc:
        raise PipelineError(f"CFBD {path}: response is not JSON ({exc})") from exc
    if not isinstance(data, list):
        raise PipelineError(f"CFBD {path}: expected a JSON list, got {type(data).__name__}: {str(data)[:200]}")
    return data


def fbs_teams(fetcher: Fetcher, season: int) -> list[dict]:
    data = get_json(fetcher, "/teams/fbs", {"year": season}, f"{season}/cfbd-teams-fbs.json")
    if not data:
        raise PipelineError(f"CFBD /teams/fbs?year={season} returned no teams")
    return data


def regular_games(fetcher: Fetcher, season: int) -> list[dict]:
    return get_json(fetcher, "/games", {"year": season, "seasonType": "regular"}, f"{season}/cfbd-games-regular.json")


def rankings(fetcher: Fetcher, season: int, season_type: str) -> list[dict]:
    return get_json(
        fetcher, "/rankings", {"year": season, "seasonType": season_type}, f"{season}/cfbd-rankings-{season_type}.json"
    )


def calendar(fetcher: Fetcher, season: int) -> list[dict]:
    return get_json(fetcher, "/calendar", {"year": season}, f"{season}/cfbd-calendar.json")
