#!/usr/bin/env python3
"""Validate weekly snapshot files against the WeekFile contract (src/lib/types.ts).

Usage:
  python3 pipeline/validate.py data/2026/week-9.json [more files...]
  python3 pipeline/validate.py --all            # every data/*/week-*.json + index.json

Exit status 1 with readable messages when anything is wrong. Standard library only.
run.py imports validate_week() and refuses to write a file that fails it.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

SCHEMA_VERSION = 2
COMMITTEE_SIZE = 25
REPO = Path(__file__).resolve().parent.parent
DATA_DIR = REPO / "data"
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WEEK_FILE = re.compile(r"^week-(\d+)\.json$")
# House rule 1 (SPEC.md): the names of the excluded network and its metrics must never appear in
# shipped JSON. Spelled in pieces so repo-wide greps for those names stay clean.
BANNED = tuple("".join(parts) for parts in (("ES", "PN"), ("F", "PI"), ("SP", "+"), ("Game ", "Control")))
# Playoff format sources must never point at that network's site (lowercase host check).
BANNED_HOST = "".join(("es", "pn"))
# At least one letter: a purely numeric id would reorder JS object keys (results are keyed by id).
FORMAT_ID = re.compile(r"^(?=[a-z0-9-]*[a-z])[a-z0-9]+(-[a-z0-9]+)*$")
AUTO_BID_POOLS = ("all", "power", "nonPower")

TOP_KEYS = {"schemaVersion", "season", "week", "asOf", "label", "sources", "playoffFormats", "fbsCount",
            "teams", "opponents", "committee"}
OPTIONAL_TOP = {"champions"}
TEAM_KEYS = {"slug", "id", "name", "short", "mascot", "conference", "colors", "record", "confRecord",
             "ranks", "values", "games"}
RANK_KEYS = {"sor", "sos", "off", "def", "fei", "committee"}
VALUE_KEYS = {"fei", "ofei", "dfei", "gwd", "els"}
GAME_KEYS = {"week", "date", "opp", "oppFbs", "site", "pf", "pa", "result", "conf"}
OPP_KEYS = {"slug", "name", "classification"}
FORMAT_KEYS = {"id", "label", "status", "default", "note", "sourceName", "sourceUrl", "checkedOn", "size", "byes",
               "seeding", "autoBids", "powerConferences", "nonConferences"}


class Errors:
    def __init__(self, label: str):
        self.label = label
        self.items: list[str] = []

    def add(self, msg: str) -> None:
        self.items.append(msg)

    def __bool__(self) -> bool:
        return bool(self.items)


def is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def is_num(v) -> bool:
    """A finite JSON number (NaN and Infinity are not valid JSON; the site's JSON.parse rejects them)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def valid_date(v) -> bool:
    if not isinstance(v, str) or not DATE.match(v):
        return False
    try:
        date.fromisoformat(v)
        return True
    except ValueError:
        return False


def check_keys(obj, expected: set[str], path: str, err: Errors, optional: set[str] = frozenset()) -> bool:
    if not isinstance(obj, dict):
        err.add(f"{path}: expected an object, got {type(obj).__name__}")
        return False
    missing = expected - set(obj)
    extra = set(obj) - expected - set(optional)
    for k in sorted(missing):
        err.add(f"{path}.{k}: missing")
    for k in sorted(extra):
        err.add(f"{path}.{k}: unexpected field")
    return not missing


def check_wl(obj, path: str, err: Errors) -> bool:
    if not check_keys(obj, {"w", "l"}, path, err):
        return False
    ok = True
    for k in ("w", "l"):
        if not is_int(obj[k]) or obj[k] < 0:
            err.add(f"{path}.{k}: expected a non-negative int, got {obj[k]!r}")
            ok = False
    return ok


def _validate_sources(doc: dict, err: Errors) -> None:
    src = doc["sources"]
    if not check_keys(src, {"ratings", "games", "committee"}, "sources", err):
        return
    r = src["ratings"]
    if check_keys(r, {"name", "author", "url", "throughWeek"}, "sources.ratings", err):
        if r["name"] != "FEI":
            err.add(f"sources.ratings.name: expected 'FEI', got {r['name']!r}")
        if r["author"] != "Brian Fremeau":
            err.add(f"sources.ratings.author: expected 'Brian Fremeau', got {r['author']!r}")
        if not isinstance(r["url"], str) or not r["url"].startswith("https://bcftoys.com/"):
            err.add(f"sources.ratings.url: expected a https://bcftoys.com/ URL, got {r['url']!r}")
        if r["throughWeek"] is not None and not is_int(r["throughWeek"]):
            err.add(f"sources.ratings.throughWeek: expected int or null, got {r['throughWeek']!r}")
        elif is_int(r["throughWeek"]) and is_int(doc.get("week")) and r["throughWeek"] != doc["week"]:
            err.add(f"sources.ratings.throughWeek is {r['throughWeek']} but the file is week {doc['week']}: "
                    "ratings and games come from different weeks")
    g = src["games"]
    if check_keys(g, {"name", "url"}, "sources.games", err):
        if g["name"] != "CollegeFootballData.com":
            err.add(f"sources.games.name: expected 'CollegeFootballData.com', got {g['name']!r}")
        if not isinstance(g["url"], str) or not g["url"].startswith("https://"):
            err.add(f"sources.games.url: expected an https URL, got {g['url']!r}")
    c = src["committee"]
    if c is None:
        if doc.get("committee") is not None:
            err.add("sources.committee is null but committee is present")
    else:
        if check_keys(c, {"name", "url", "releaseDate"}, "sources.committee", err):
            if c["name"] != "College Football Playoff Selection Committee":
                err.add(f"sources.committee.name: unexpected {c['name']!r}")
            if not isinstance(c["url"], str) or not c["url"].startswith("https://"):
                err.add(f"sources.committee.url: expected an https URL, got {c['url']!r}")
            if not valid_date(c["releaseDate"]):
                err.add(f"sources.committee.releaseDate: expected YYYY-MM-DD, got {c['releaseDate']!r}")
            elif valid_date(doc.get("asOf")) and c["releaseDate"] > doc["asOf"]:
                err.add(f"sources.committee.releaseDate {c['releaseDate']} is after asOf {doc['asOf']}")
        if doc.get("committee") is None:
            err.add("sources.committee is set but committee is null")


def next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p *= 2
    return p


def _str_list(v) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) and x for x in v)


def _validate_format(f, path: str, teams: dict, conferences: set[str], err: Errors) -> None:
    if not check_keys(f, FORMAT_KEYS, path, err):
        return
    for k in ("label", "note", "sourceName"):
        if not isinstance(f[k], str) or not f[k].strip():
            err.add(f"{path}.{k}: expected a non-empty string, got {f[k]!r}")
    if not isinstance(f["id"], str) or not FORMAT_ID.match(f["id"]):
        err.add(f"{path}.id: expected lowercase letters, digits and hyphens with a letter (e.g. '12-team'), got {f['id']!r}")
    if isinstance(f["note"], str) and f["note"].strip() and ("\n" in f["note"] or not f["note"].rstrip().endswith(".")):
        err.add(f"{path}.note: expected one plain-English sentence ending in a period")
    if f["status"] not in ("current", "proposed"):
        err.add(f"{path}.status: expected 'current' or 'proposed', got {f['status']!r}")
    if not isinstance(f["default"], bool):
        err.add(f"{path}.default: expected a boolean, got {f['default']!r}")
    url = f["sourceUrl"]
    if not isinstance(url, str) or not url.startswith("https://"):
        err.add(f"{path}.sourceUrl: expected an https URL, got {url!r}")
    elif BANNED_HOST in url.lower().split("/")[2]:
        err.add(f"{path}.sourceUrl: links to a banned network's site (house rule 1); cite another source")
    if not valid_date(f["checkedOn"]):
        err.add(f"{path}.checkedOn: expected YYYY-MM-DD, got {f['checkedOn']!r}")
    size = f["size"]
    size_ok = is_int(size) and size >= 2
    if not size_ok:
        err.add(f"{path}.size: expected an int >= 2, got {size!r}")
    if not is_int(f["byes"]):
        err.add(f"{path}.byes: expected an int, got {f['byes']!r}")
    elif size_ok and f["byes"] != next_pow2(size) - size:
        err.add(f"{path}.byes: {f['byes']} but a standard seeded bracket of {size} teams has "
                f"nextPow2({size}) - {size} = {next_pow2(size) - size} byes")
    if f["seeding"] != "straight":
        err.add(f"{path}.seeding: expected 'straight', got {f['seeding']!r}")

    power = f["powerConferences"]
    non = f["nonConferences"]
    if not _str_list(non):
        err.add(f"{path}.nonConferences: expected a list of conference names")
        non = []
    if not _str_list(power):
        err.add(f"{path}.powerConferences: expected a list of conference names")
        power = []
    else:
        if len(set(power)) != len(power):
            err.add(f"{path}.powerConferences: duplicate names")
        for c in power:
            if c not in conferences:
                err.add(f"{path}.powerConferences: {c!r} is not the conference of any FBS team in this file")
            if c in non:
                err.add(f"{path}.powerConferences: {c!r} is also listed in nonConferences")

    ab = f["autoBids"]
    if not check_keys(ab, {"rules", "guaranteed"}, f"{path}.autoBids", err):
        return
    total = 0
    if not isinstance(ab["rules"], list):
        err.add(f"{path}.autoBids.rules: expected a list")
    else:
        seen = set()
        for i, r in enumerate(ab["rules"]):
            rp = f"{path}.autoBids.rules[{i}]"
            if not check_keys(r, {"from", "count"}, rp, err):
                continue
            if r["from"] not in AUTO_BID_POOLS:
                err.add(f"{rp}.from: expected one of {', '.join(AUTO_BID_POOLS)}, got {r['from']!r}")
            elif r["from"] in seen:
                err.add(f"{rp}.from: {r['from']!r} appears in more than one rule")
            else:
                seen.add(r["from"])
            if not is_int(r["count"]) or r["count"] < 1:
                err.add(f"{rp}.count: expected a positive int, got {r['count']!r}")
                continue
            total += r["count"]
            if r["from"] == "power" and r["count"] > len(power):
                err.add(f"{rp}.count: {r['count']} power champions but only {len(power)} power conferences")
            if r["from"] in ("power", "nonPower") and not power:
                err.add(f"{rp}: a {r['from']!r} rule needs powerConferences")
    if not isinstance(ab["guaranteed"], list):
        err.add(f"{path}.autoBids.guaranteed: expected a list")
    else:
        for i, gr in enumerate(ab["guaranteed"]):
            gp = f"{path}.autoBids.guaranteed[{i}]"
            if check_keys(gr, {"slug", "ifRankedAtOrAbove"}, gp, err):
                if not isinstance(gr["slug"], str):
                    err.add(f"{gp}.slug: expected a slug string, got {gr['slug']!r}")
                elif gr["slug"] not in teams:
                    err.add(f"{gp}.slug: {gr['slug']!r} is not an FBS team in this file")
                if not is_int(gr["ifRankedAtOrAbove"]) or gr["ifRankedAtOrAbove"] < 1 or (
                        size_ok and gr["ifRankedAtOrAbove"] > size):
                    err.add(f"{gp}.ifRankedAtOrAbove: expected an int in 1..size, got {gr['ifRankedAtOrAbove']!r}")
                total += 1
    if size_ok and total > size:
        err.add(f"{path}.autoBids: {total} automatic bids do not fit a field of {size}")


def _validate_playoff_formats(doc: dict, teams: dict, err: Errors) -> None:
    formats = doc["playoffFormats"]
    if not isinstance(formats, list) or not formats:
        err.add("playoffFormats: expected a non-empty list of formats")
        return
    conferences = {t.get("conference") for t in teams.values() if isinstance(t, dict)}
    for i, f in enumerate(formats):
        _validate_format(f, f"playoffFormats[{i}]", teams, conferences, err)
    good = [f for f in formats if isinstance(f, dict)]
    ids = [f.get("id") for f in good]
    for dup in sorted({x for x in ids if isinstance(x, str) and ids.count(x) > 1}):
        err.add(f"playoffFormats: id {dup!r} is used more than once")
    defaults = [f.get("id") for f in good if f.get("default") is True]
    if len(defaults) != 1:
        err.add(f"playoffFormats: exactly one format must have default: true, found {len(defaults)} {defaults}")


def _validate_game(g, path: str, file_week: int, err: Errors) -> bool:
    if not check_keys(g, GAME_KEYS, path, err):
        return False
    ok = True
    if not is_int(g["week"]) or g["week"] < 0 or (is_int(file_week) and g["week"] > file_week):
        err.add(f"{path}.week: {g['week']!r} is not a week in 0..{file_week}")
        ok = False
    if not valid_date(g["date"]):
        err.add(f"{path}.date: expected YYYY-MM-DD, got {g['date']!r}")
        ok = False
    if not isinstance(g["opp"], str) or not g["opp"]:
        err.add(f"{path}.opp: expected a slug")
        ok = False
    if not isinstance(g["oppFbs"], bool):
        err.add(f"{path}.oppFbs: expected a boolean")
        ok = False
    if g["site"] not in ("home", "away", "neutral"):
        err.add(f"{path}.site: expected home/away/neutral, got {g['site']!r}")
        ok = False
    for k in ("pf", "pa"):
        if not is_int(g[k]) or g[k] < 0:
            err.add(f"{path}.{k}: expected a non-negative int, got {g[k]!r}")
            ok = False
    if g["result"] not in ("W", "L"):
        err.add(f"{path}.result: expected W or L, got {g['result']!r}")
        ok = False
    elif ok and (g["pf"] == g["pa"] or (g["result"] == "W") != (g["pf"] > g["pa"])):
        err.add(f"{path}.result: {g['result']} does not match score {g['pf']}-{g['pa']}")
        ok = False
    if not isinstance(g["conf"], bool):
        err.add(f"{path}.conf: expected a boolean")
        ok = False
    return ok


def validate_week(doc, index: dict | None = None, label: str = "week file") -> list[str]:
    """Return a list of human-readable problems (empty = valid)."""
    err = Errors(label)
    if not check_keys(doc, TOP_KEYS, "file", err, optional=OPTIONAL_TOP):
        return err.items
    if doc["schemaVersion"] != SCHEMA_VERSION:
        err.add(f"schemaVersion: expected {SCHEMA_VERSION}, got {doc['schemaVersion']!r}")
    for k in ("season", "week", "fbsCount"):
        if not is_int(doc[k]):
            err.add(f"{k}: expected an int, got {doc[k]!r}")
    if not valid_date(doc["asOf"]):
        err.add(f"asOf: expected YYYY-MM-DD, got {doc['asOf']!r}")
    if is_int(doc["week"]) and doc["label"] != f"After Week {doc['week']}":
        err.add(f"label: expected 'After Week {doc['week']}', got {doc['label']!r}")

    teams = doc["teams"] if isinstance(doc["teams"], dict) else {}
    opponents = doc["opponents"] if isinstance(doc["opponents"], dict) else {}
    if not isinstance(doc["teams"], dict):
        err.add("teams: expected an object keyed by slug")
    if not isinstance(doc["opponents"], dict):
        err.add("opponents: expected an object keyed by slug")
    n = doc["fbsCount"] if is_int(doc["fbsCount"]) else None
    if n is not None and n != len(teams):
        err.add(f"fbsCount is {n} but teams has {len(teams)} entries (missing or extra FBS teams)")
    _validate_sources(doc, err)
    _validate_playoff_formats(doc, teams, err)

    # ---- opponents
    for slug, o in opponents.items():
        path = f"opponents[{slug}]"
        if not check_keys(o, OPP_KEYS, path, err):
            continue
        if o["slug"] != slug:
            err.add(f"{path}.slug is {o['slug']!r}, expected the key {slug!r}")
        if not isinstance(o["name"], str) or not o["name"]:
            err.add(f"{path}.name: expected a non-empty string")
        if not isinstance(o["classification"], str) or not o["classification"] or o["classification"] == "fbs":
            err.add(f"{path}.classification: expected a non-FBS classification, got {o['classification']!r}")
    for slug in sorted(set(teams) & set(opponents)):
        err.add(f"opponents[{slug}]: {slug!r} is both an FBS team and a non-FBS opponent")

    # ---- teams
    file_week = doc["week"]
    good_games: dict[str, list[dict]] = {}
    referenced_opps: set[str] = set()
    for slug, t in teams.items():
        path = f"teams[{slug}]"
        if not check_keys(t, TEAM_KEYS, path, err):
            continue
        if t["slug"] != slug:
            err.add(f"{path}.slug is {t['slug']!r}, expected the key {slug!r}")
        if not is_int(t["id"]):
            err.add(f"{path}.id: expected an int")
        for k in ("name", "short", "conference"):
            if not isinstance(t[k], str) or not t[k]:
                err.add(f"{path}.{k}: expected a non-empty string, got {t[k]!r}")
        if t["mascot"] is not None and not isinstance(t["mascot"], str):
            err.add(f"{path}.mascot: expected a string or null")
        if check_keys(t["colors"], {"primary", "secondary"}, f"{path}.colors", err):
            for k in ("primary", "secondary"):
                if not isinstance(t["colors"][k], str) or not HEX.match(t["colors"][k]):
                    err.add(f"{path}.colors.{k}: {t['colors'][k]!r} is not a #rrggbb hex color")
        if check_keys(t["ranks"], RANK_KEYS, f"{path}.ranks", err):
            for k in ("sor", "sos", "off", "def", "fei"):
                v = t["ranks"][k]
                if v is None:
                    err.add(f"{path}.ranks.{k}: is null")
                elif not is_int(v) or n is None or not 1 <= v <= n:
                    err.add(f"{path}.ranks.{k}: {v!r} is not an int in 1..{n}")
            c = t["ranks"]["committee"]
            if c is not None and (not is_int(c) or not 1 <= c <= COMMITTEE_SIZE):
                err.add(f"{path}.ranks.committee: {c!r} is not null or an int in 1..{COMMITTEE_SIZE}")
        if check_keys(t["values"], VALUE_KEYS, f"{path}.values", err):
            for k in VALUE_KEYS:
                if not is_num(t["values"][k]):
                    err.add(f"{path}.values.{k}: expected a number, got {t['values'][k]!r}")
        check_wl(t["record"], f"{path}.record", err)
        check_wl(t["confRecord"], f"{path}.confRecord", err)
        if not isinstance(t["games"], list):
            err.add(f"{path}.games: expected a list")
            continue
        games_ok = []
        for i, g in enumerate(t["games"]):
            gp = f"{path}.games[{i}]"
            if not _validate_game(g, gp, file_week, err):
                continue
            if g["oppFbs"]:
                if g["opp"] not in teams:
                    err.add(f"{gp}.opp: {g['opp']!r} is marked FBS but is not in teams")
                    continue
                if g["opp"] == slug:
                    err.add(f"{gp}.opp: a team cannot play itself")
                    continue
            else:
                if g["opp"] not in opponents:
                    err.add(f"{gp}.opp: {g['opp']!r} is marked non-FBS but is not in opponents")
                    continue
                referenced_opps.add(g["opp"])
            games_ok.append(g)
        good_games[slug] = games_ok
        # chronological, no duplicates
        dates = [g["date"] for g in games_ok]
        if dates != sorted(dates):
            err.add(f"{path}.games: not in chronological order")
        dupes = [k for k, c in Counter((g["week"], g["opp"], g["date"]) for g in games_ok).items() if c > 1]
        for wk, opp, d in dupes:
            err.add(f"{path}.games: duplicate game vs {opp} (week {wk}, {d})")
        # records equal game counts
        if len(games_ok) == len(t["games"]) and isinstance(t["record"], dict) and isinstance(t["confRecord"], dict):
            w = sum(1 for g in games_ok if g["result"] == "W")
            losses = sum(1 for g in games_ok if g["result"] == "L")
            if (t["record"].get("w"), t["record"].get("l")) != (w, losses):
                err.add(f"{path}.record is {t['record'].get('w')}-{t['record'].get('l')} but the game log is {w}-{losses}")
            cw = sum(1 for g in games_ok if g["conf"] and g["result"] == "W")
            cl = sum(1 for g in games_ok if g["conf"] and g["result"] == "L")
            if (t["confRecord"].get("w"), t["confRecord"].get("l")) != (cw, cl):
                err.add(f"{path}.confRecord is {t['confRecord'].get('w')}-{t['confRecord'].get('l')} but conference games are {cw}-{cl}")

    for slug in sorted(set(opponents) - referenced_opps):
        err.add(f"opponents[{slug}]: not referenced by any game")

    # ---- FBS-vs-FBS games mirrored in the opponent's log
    flip_site = {"home": "away", "away": "home", "neutral": "neutral"}
    remaining: dict[str, Counter] = {
        s: Counter((g["week"], g["date"], g["opp"], g["pf"], g["pa"], g["site"], g["conf"]) for g in gl if g["oppFbs"])
        for s, gl in good_games.items()
    }
    for slug, gl in sorted(good_games.items()):
        for g in gl:
            if not g["oppFbs"] or g["opp"] not in good_games:
                continue
            key = (g["week"], g["date"], slug, g["pa"], g["pf"], flip_site[g["site"]], g["conf"])
            if remaining[g["opp"]][key] > 0:
                continue
            err.add(
                f"teams[{slug}]: week {g['week']} {g['date']} {g['site']} vs {g['opp']} {g['pf']}-{g['pa']} "
                f"is not mirrored in teams[{g['opp']}].games (same week/date, swapped score, matching site/conf)"
            )

    # ---- committee
    com = doc["committee"]
    if com is not None:
        if not isinstance(com, list) or not all(isinstance(s, str) for s in com):
            err.add("committee: expected a list of slugs or null")
        else:
            if len(com) != COMMITTEE_SIZE:
                err.add(f"committee: expected {COMMITTEE_SIZE} slugs, got {len(com)}")
            if len(set(com)) != len(com):
                err.add("committee: duplicate slugs")
            for i, s in enumerate(com):
                if s not in teams:
                    err.add(f"committee[{i}]: {s!r} is not an FBS team in this file")
                elif not good_games.get(s):
                    err.add(f"committee[{i}]: {s!r} has no game log")
    com_ok = isinstance(com, list) and all(isinstance(s, str) for s in com)
    crank = {s: i + 1 for i, s in enumerate(com)} if com_ok else {}
    for slug, t in teams.items():
        r = t.get("ranks") if isinstance(t, dict) else None
        if isinstance(r, dict) and "committee" in r and r["committee"] != crank.get(slug):
            err.add(f"teams[{slug}].ranks.committee is {r['committee']!r} but the committee list says {crank.get(slug)!r}")

    # ---- champions
    champs = doc.get("champions")
    if champs is not None:
        if not isinstance(champs, dict):
            err.add("champions: expected an object of conference -> slug")
        else:
            for conf, s in champs.items():
                if not isinstance(s, str) or s not in teams:
                    err.add(f"champions[{conf}]: {s!r} is not an FBS team")
                elif isinstance(teams[s], dict) and teams[s].get("conference") != conf:
                    err.add(f"champions[{conf}]: {s!r} plays in {teams[s].get('conference')!r}")

    # ---- banned strings (house rule 1)
    blob = json.dumps(doc, ensure_ascii=False)
    for b in BANNED:
        if b in blob:
            err.add(f"file contains the banned string {b!r} (house rule 1)")

    # ---- index consistency
    if index is not None:
        err.items.extend(index_entry_problems(doc, index))
    return err.items


def index_entry_problems(doc: dict, index: dict) -> list[str]:
    out = []
    if not isinstance(index, dict) or not isinstance(index.get("weeks"), list):
        return ["index.json: expected {season, weeks: [...]}"]
    if index.get("season") != doc.get("season"):
        out.append(f"index.json season {index.get('season')!r} != file season {doc.get('season')!r}")
    entries = [w for w in index["weeks"] if isinstance(w, dict) and w.get("week") == doc.get("week")]
    if len(entries) != 1:
        out.append(f"index.json: expected exactly one entry for week {doc.get('week')}, found {len(entries)}")
        return out
    e = entries[0]
    if e.get("asOf") != doc.get("asOf"):
        out.append(f"index.json week {doc['week']}: asOf {e.get('asOf')!r} != file asOf {doc.get('asOf')!r}")
    if e.get("label") != doc.get("label"):
        out.append(f"index.json week {doc['week']}: label {e.get('label')!r} != file label {doc.get('label')!r}")
    if e.get("hasCommittee") != (doc.get("committee") is not None):
        out.append(f"index.json week {doc['week']}: hasCommittee {e.get('hasCommittee')!r} does not match the file")
    return out


def validate_index(index, season_dir: Path) -> list[str]:
    out = []
    if not isinstance(index, dict):
        return ["index.json: expected an object"]
    if set(index) != {"season", "weeks"}:
        out.append(f"index.json: expected keys season, weeks; got {sorted(index)}")
    if not is_int(index.get("season")):
        out.append("index.json: season must be an int")
    weeks = index.get("weeks")
    if not isinstance(weeks, list):
        return out + ["index.json: weeks must be a list"]
    nums = []
    for i, w in enumerate(weeks):
        if not isinstance(w, dict) or set(w) != {"week", "asOf", "label", "hasCommittee"}:
            out.append(f"index.json weeks[{i}]: expected keys week, asOf, label, hasCommittee")
            continue
        if not is_int(w["week"]) or not valid_date(w["asOf"]) or not isinstance(w["label"], str) or not isinstance(w["hasCommittee"], bool):
            out.append(f"index.json weeks[{i}]: bad field types {w}")
            continue
        nums.append(w["week"])
    if nums != sorted(set(nums)):
        out.append(f"index.json: weeks must be unique and sorted oldest first, got {nums}")
    on_disk = sorted(int(m.group(1)) for p in season_dir.iterdir() if (m := WEEK_FILE.match(p.name)))
    for wk in sorted(set(nums) - set(on_disk)):
        out.append(f"index.json lists week {wk} but {season_dir}/week-{wk}.json does not exist")
    for wk in sorted(set(on_disk) - set(nums)):
        out.append(f"{season_dir}/week-{wk}.json exists but is not listed in index.json")
    return out


def _reject_constant(name: str):
    raise ValueError(f"{name} is not valid JSON (the site's JSON.parse would fail)")


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh, parse_constant=_reject_constant)


def validate_path(path: Path) -> list[str]:
    try:
        doc = load_json(path)
    except (OSError, ValueError) as exc:  # ValueError covers JSONDecodeError and NaN/Infinity
        return [f"cannot read: {exc}"]
    index_path = path.parent / "index.json"
    index = None
    problems = []
    if index_path.exists():
        try:
            index = load_json(index_path)
        except (OSError, ValueError) as exc:  # ValueError covers JSONDecodeError and NaN/Infinity
            problems.append(f"cannot read {index_path}: {exc}")
    else:
        problems.append(f"{index_path} is missing")
    m = WEEK_FILE.match(path.name)
    if m and isinstance(doc, dict) and doc.get("week") != int(m.group(1)):
        problems.append(f"file name says week {m.group(1)} but the file says week {doc.get('week')!r}")
    if isinstance(doc, dict) and path.parent.name.isdigit() and doc.get("season") != int(path.parent.name):
        problems.append(f"directory says season {path.parent.name} but the file says {doc.get('season')!r}")
    return problems + validate_week(doc, index=index, label=str(path))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path, help="week JSON files to validate")
    ap.add_argument("--all", action="store_true", help="validate every data/*/week-*.json and each index.json")
    ap.add_argument("--data-dir", type=Path, default=DATA_DIR, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    targets: list[Path] = list(args.files)
    index_checks: list[Path] = []
    if args.all:
        for season_dir in sorted(p for p in args.data_dir.iterdir() if p.is_dir() and p.name.isdigit()):
            index_checks.append(season_dir)
            targets.extend(sorted((p for p in season_dir.iterdir() if WEEK_FILE.match(p.name)),
                                  key=lambda p: int(WEEK_FILE.match(p.name).group(1))))
    if not targets and not index_checks:
        ap.error("give one or more week files, or --all")
    failed = 0
    for season_dir in index_checks:
        ip = season_dir / "index.json"
        if not ip.exists():
            if any(WEEK_FILE.match(p.name) for p in season_dir.iterdir()):
                print(f"FAIL {ip}: missing")
                failed += 1
            continue
        try:
            probs = validate_index(load_json(ip), season_dir)
        except (OSError, ValueError) as exc:  # ValueError covers JSONDecodeError and NaN/Infinity
            probs = [f"cannot read: {exc}"]
        if probs:
            failed += 1
            print(f"FAIL {ip}")
            for p in probs:
                print(f"  - {p}")
        else:
            print(f"ok   {ip}")
    for path in targets:
        probs = validate_path(path)
        if probs:
            failed += 1
            print(f"FAIL {path} ({len(probs)} problem{'s' if len(probs) != 1 else ''})")
            for p in probs[:200]:
                print(f"  - {p}")
            if len(probs) > 200:
                print(f"  ... and {len(probs) - 200} more")
        else:
            print(f"ok   {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
