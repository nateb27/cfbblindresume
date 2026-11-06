#!/usr/bin/env python3
"""Build data/{season}/week-{N}.json and data/{season}/index.json from live sources.

  python3 pipeline/run.py --season 2026 [--week N] [--fei-csv PATH]
                          [--committee-source cfp|cfbd|auto|none] [--dry-run]

Sources: FEI table from bcftoys.com (or a pasted CSV), games and teams from
CollegeFootballData.com, committee top 25 from collegefootballplayoff.com cross-checked with
CFBD. See pipeline/README.md. Exits 1 without writing anything when a check fails.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from cfbpipe import PipelineError  # noqa: E402
from cfbpipe import cfbd, committee, fei  # noqa: E402
from cfbpipe.build import build_week  # noqa: E402
from cfbpipe.names import SlugBook, load_aliases, resolve_names  # noqa: E402
from cfbpipe.net import Fetcher, FetchError  # noqa: E402
import validate as validator  # noqa: E402

REPO = HERE.parent
EASTERN = ZoneInfo("America/New_York")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def log(msg: str) -> None:
    print(msg, flush=True)


def dumps(obj) -> str:
    # allow_nan=False: NaN/Infinity are not JSON and would break the site's JSON.parse.
    return json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n"


def fei_url(season: int) -> str:
    return f"https://bcftoys.com/{season}-fei"


def iso_date_arg(value: str) -> str:
    try:
        if not ISO_DATE.match(value):
            raise ValueError
        date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not a date in YYYY-MM-DD form") from None
    return value


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--week", type=int, help="snapshot week (default: FEI 'through Week N'); must equal the FEI "
                    "input's week when it states one")
    ap.add_argument("--fei-csv", type=Path, help="read FEI from a CSV / pasted text file instead of bcftoys.com")
    ap.add_argument("--committee-source", choices=["cfp", "cfbd", "auto", "none"], default="auto")
    ap.add_argument("--committee-release-date", type=iso_date_arg,
                    help="YYYY-MM-DD release date for the latest CFBD committee poll "
                    "(overrides pipeline/committee_schedule.json)")
    ap.add_argument("--as-of", type=iso_date_arg, help="pin asOf (YYYY-MM-DD); default: today in US Eastern, or "
                    "the existing file's asOf when nothing else changed")
    ap.add_argument("--dry-run", action="store_true", help="build and validate, write nothing")
    ap.add_argument("--use-cache", action="store_true", help="read raw responses from the cache instead of the network")
    ap.add_argument("--cache-dir", type=Path, default=HERE / ".cache")
    ap.add_argument("--data-dir", type=Path, default=REPO / "data")
    ap.add_argument("--config-dir", type=Path, default=HERE, help="where aliases.json, slugs.json, ... live")
    return ap.parse_args(argv)


def read_json(path: Path, what: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise PipelineError(f"cannot read {what} {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PipelineError(f"{what} {path} is not valid JSON: {exc}") from exc


def load_season_config(path: Path, season: int, what: str) -> dict | list:
    data = read_json(path, what)
    if not isinstance(data, dict) or str(season) not in data:
        raise PipelineError(f"{path} has no entry for season {season}; add the {what} for {season} first")
    return data[str(season)]


def season_schedule(args) -> list[str] | None:
    """Scheduled committee release dates for the season, or None when the file has no entry."""
    path = args.config_dir / "committee_schedule.json"
    if not path.exists():
        return None
    data = read_json(path, "committee release schedule")
    entry = data.get(str(args.season)) if isinstance(data, dict) else None
    if entry is None:
        return None
    releases = entry.get("releases") if isinstance(entry, dict) else None
    if not isinstance(releases, list) or not all(isinstance(d, str) and ISO_DATE.match(d) for d in releases):
        raise PipelineError(f"{path}: {args.season}.releases must be a list of YYYY-MM-DD dates")
    return releases


# ------------------------------------------------------------------ FEI


def fei_week_cache(season: int, week: int) -> str:
    return f"{season}/bcftoys-fei-w{week}.html"


def load_fei(args, fetcher: Fetcher) -> fei.FeiTable:
    if args.fei_csv:
        if not args.fei_csv.is_file():
            raise PipelineError(f"--fei-csv {args.fei_csv}: no such file")
        log(f"FEI: reading {args.fei_csv} (CSV / pasted text)")
        return fei.parse_fei_text(args.fei_csv.read_text(encoding="utf-8"))
    url = fei_url(args.season)
    try:
        # bcftoys.com keeps no weekly archive of the full table, so every live fetch is also saved
        # per through-week; --use-cache --week N reads that copy to rebuild week N exactly.
        cache_name = f"{args.season}/bcftoys-fei.html"
        if args.use_cache and args.week is not None and fetcher.cached(fei_week_cache(args.season, args.week)):
            cache_name = fei_week_cache(args.season, args.week)
        res = fetcher.get(url, cache_name)
        table = fei.parse_fei_html(res.text)
        if not res.from_cache and table.through_week is not None:
            fetcher.store(fei_week_cache(args.season, table.through_week), res.text)
        log(f"FEI: {len(table.rows)} teams from {url}{f' (cache {cache_name})' if res.from_cache else ''}, "
            f"through Week {table.through_week}")
        return table
    except (FetchError, PipelineError) as exc:
        fallback = args.config_dir / "manual" / f"{args.season}-fei.csv"
        if fallback.exists():
            log(f"WARNING: FEI fetch/parse failed ({exc}); falling back to {fallback}")
            return fei.parse_fei_text(fallback.read_text(encoding="utf-8"))
        raise PipelineError(
            f"FEI: could not read {url} ({exc}). Paste the table into a CSV (see pipeline/README.md, "
            f"'CSV fallback') and re-run with --fei-csv PATH, or save it as {fallback}."
        ) from exc


# ------------------------------------------------------------------ committee


def load_committee(args, fetcher, week: int, as_of: date, fbs: list[dict], games: list[dict], windows,
                   slug_by_id: dict[int, str], aliases) -> committee.Release | None:
    mode = args.committee_source
    if mode == "none":
        log("committee: skipped (--committee-source none)")
        return None
    school_to_id = {t["school"]: int(t["id"]) for t in fbs}
    schedule = season_schedule(args)

    cfp_rel = None
    if mode in ("cfp", "auto"):
        try:
            res = fetcher.get(committee.CFP_URL, f"{args.season}/cfp-rankings.html")
            cfp_rel = committee.parse_cfp_page(res.text, args.season, as_of)
            names = resolve_names(cfp_rel.names, set(school_to_id),
                                  {**aliases.get("fei", {}), **aliases.get("cfp", {})}, "CFP site")
            cfp_rel.slugs = [slug_by_id[school_to_id[names[n]]] for n in cfp_rel.names]
            log(f"committee: CFP site release {cfp_rel.date}: {', '.join(cfp_rel.slugs[:5])}, ...")
        except (FetchError, committee.CommitteeUnavailable) as exc:
            if mode == "cfp":
                raise PipelineError(f"committee (cfp): {exc}") from exc
            log(f"WARNING: committee: CFP site not usable ({exc})")
            cfp_rel = None

    cfbd_rels: list[committee.Release] = []
    cfbd_ok = False
    if mode in ("cfbd", "auto"):
        try:
            by_type = {"regular": cfbd.rankings(fetcher, args.season, "regular")}
            try:
                by_type["postseason"] = cfbd.rankings(fetcher, args.season, "postseason")
            except (FetchError, PipelineError) as exc:
                log(f"  note: CFBD postseason rankings unavailable ({exc})")
            polls = committee.committee_polls(by_type)
            cfbd_ok = True
            if polls:
                if schedule is None:
                    raise PipelineError(f"{args.config_dir / 'committee_schedule.json'} has no entry for season "
                                        f"{args.season}; add the committee release schedule for {args.season} first")
                dated = committee.date_cfbd_polls(polls, schedule, windows, args.committee_release_date)
                for p, d in dated:
                    unknown = [f"{s} ({tid})" for _, tid, s in p["ranks"] if tid not in slug_by_id]
                    if unknown:
                        raise PipelineError(f"CFBD committee poll week {p['week']}: not FBS teams: {unknown}")
                    if [r for r, _, _ in p["ranks"]] != list(range(1, committee.COMMITTEE_SIZE + 1)):
                        raise PipelineError(f"CFBD committee poll week {p['week']}: ranks are not 1..25")
                    cfbd_rels.append(committee.Release(
                        date=d, names=[s for _, _, s in p["ranks"]], slugs=[slug_by_id[t] for _, t, _ in p["ranks"]],
                        source="cfbd", detail=f"CFBD {p['seasonType']} week {p['week']}"))
                log(f"committee: CFBD has {len(polls)} committee poll(s): "
                    + ", ".join(f"{r.detail} = {r.date}" for r in cfbd_rels))
            else:
                log("committee: CFBD has no committee poll yet")
        except FetchError as exc:
            if mode == "cfbd":
                raise PipelineError(f"committee (cfbd): {exc}") from exc
            log(f"WARNING: committee: CFBD rankings unavailable ({exc})")

    if mode == "auto" and cfp_rel is None and not cfbd_ok:
        raise PipelineError("committee: neither the CFP site nor CFBD could be read; refusing to guess "
                            "whether a ranking exists (use --committee-source none to build without one)")

    # The release for week N is the first one after week N's last game (Tuesday after a normal
    # week, Sunday after championship weekend); later releases reflect later games.
    release_dates = {date.fromisoformat(d) for d in (schedule or [])}
    release_dates |= {date.fromisoformat(r.date) for r in cfbd_rels}
    if cfp_rel is not None:
        release_dates.add(date.fromisoformat(cfp_rel.date))
    last_game = committee.last_game_day(week, games, windows)
    cutoff = committee.snapshot_cutoff(week, games, windows, sorted(release_dates))
    log(f"committee: week {week} ends {last_game} (last game, or the calendar week's end if none are listed); "
        + (f"the release that follows is dated {cutoff}" if cutoff else "no scheduled release follows it"))

    chosen = committee.choose(mode, cfp_rel, cfbd_rels, as_of, cutoff, log, cfbd_available=cfbd_ok)
    if chosen is None:
        log("committee: no release for this snapshot -> committee null")
        return None
    log(f"committee: using the {chosen.date} release ({chosen.source})")
    if mode == "auto":
        advisory_bcftoys(args, fetcher, chosen, school_to_id, slug_by_id, aliases)
    return chosen


def advisory_bcftoys(args, fetcher, chosen, school_to_id, slug_by_id, aliases) -> None:
    """Advisory cross-check with bcftoys.com/{season}-cfp (warning only)."""
    url = f"https://bcftoys.com/{args.season}-cfp"
    try:
        res = fetcher.get(url, f"{args.season}/bcftoys-cfp.html")
        rows = committee.parse_bcftoys_cfp(res.text)
        if len(rows) != committee.COMMITTEE_SIZE:
            log(f"  note: {url} lists {len(rows)} ranked teams; advisory cross-check skipped")
            return
        names = resolve_names([n for _, n in rows], set(school_to_id), aliases.get("fei", {}), "bcftoys CFP page")
        slugs = [slug_by_id[school_to_id[names[n]]] for _, n in rows]
        tw = fei.through_week(res.text)
        if slugs == chosen.slugs:
            log(f"  committee: bcftoys CFP profile page (through Week {tw}) agrees")
        else:
            diff = [f"#{i + 1} {a} vs {b}" for i, (a, b) in enumerate(zip(chosen.slugs, slugs)) if a != b]
            log(f"WARNING: committee: bcftoys CFP profile page (through Week {tw}) differs: {'; '.join(diff[:10])} "
                "(advisory only; it may lag a new release)")
    except (FetchError, PipelineError) as exc:
        log(f"  note: advisory bcftoys CFP cross-check skipped ({exc})")


# ------------------------------------------------------------------ main


def run(args) -> int:
    fetcher = Fetcher(args.cache_dir, use_cache=args.use_cache, log=log)
    cfg = args.config_dir
    aliases = load_aliases(cfg / "aliases.json")
    slugs = SlugBook(cfg / "slugs.json")
    playoff_formats = load_season_config(cfg / "playoff_formats.json", args.season, "playoff formats")
    if not isinstance(playoff_formats, list) or not playoff_formats:
        raise PipelineError(f"{cfg / 'playoff_formats.json'}: {args.season} must be a non-empty list of formats")
    as_of = date.fromisoformat(args.as_of) if args.as_of else datetime.now(EASTERN).date()

    season_dir = args.data_dir / str(args.season)
    index_path = season_dir / "index.json"
    index = read_json(index_path, "season index") if index_path.exists() else {"season": args.season, "weeks": []}
    if not isinstance(index, dict) or not isinstance(index.get("weeks"), list):
        raise PipelineError(f"{index_path}: expected {{season, weeks: [...]}}")
    latest = max((w["week"] for w in index["weeks"] if isinstance(w, dict) and isinstance(w.get("week"), int)),
                 default=None)

    table = load_fei(args, fetcher)
    if args.week is None and table.through_week is None:
        schedule = season_schedule(args) if not args.fei_csv else None
        last_release = date.fromisoformat(max(schedule)) if schedule else None
        if latest is not None and last_release is not None and as_of > last_release:
            # Fremeau's final (post-bowl) page drops "(through Week N)". Week files pair FEI with
            # regular-season games and committee releases, which are over by now.
            log(f"FEI page has no 'through Week N' (final ratings) and the season's last committee release "
                f"({last_release}) has passed: season complete, nothing to do")
            return 0
        raise PipelineError("snapshot week unknown: the FEI input has no 'through Week N' line; pass --week N "
                            "(the FEI records are then checked against CFBD games through week N)")
    week = args.week if args.week is not None else table.through_week
    if table.through_week is not None and week != table.through_week:
        raise PipelineError(
            f"--week {week} but the FEI input is through Week {table.through_week}. A week file must pair ratings "
            f"and games from the same week, and bcftoys.com keeps no weekly archive of the full table, so week "
            f"{week} can only be built from FEI for week {week}: --use-cache with a saved "
            f"{args.cache_dir / fei_week_cache(args.season, week)}, or --fei-csv with a table through Week {week}."
        )
    if table.through_week is None:
        log(f"WARNING: the FEI input does not say which week it runs through; treating it as week {week} and "
            f"requiring its records to match CFBD games through week {week}")
    if args.week is None and latest is not None and week < latest:
        raise PipelineError(f"FEI is through Week {week} but week {latest} already exists in {index_path}: stale "
                            f"input? Nothing written. To rebuild week {week} on purpose from this week-{week} table, "
                            f"pass --week {week}.")

    windows = committee.calendar_windows(cfbd.calendar(fetcher, args.season))
    regular_weeks = sorted(w for (stype, w) in windows if stype == "regular")
    if regular_weeks and week > regular_weeks[-1]:
        if args.week is None:
            log(f"FEI is through Week {week}, past the last regular-season week ({regular_weeks[-1]}) in the CFBD "
                "calendar. Week files cover regular-season weeks only: season complete, nothing to do")
            return 0
        raise PipelineError(f"--week {week} is past the last regular-season week ({regular_weeks[-1]}) "
                            "in the CFBD calendar")

    fbs = cfbd.fbs_teams(fetcher, args.season)
    games = cfbd.regular_games(fetcher, args.season)
    log(f"CFBD: {len(fbs)} FBS teams, {len(games)} regular-season games listed")
    slug_by_id = {int(t["id"]): slugs.slug_for(int(t["id"]), t["school"]) for t in sorted(fbs, key=lambda t: int(t["id"]))}

    chosen = load_committee(args, fetcher, week, as_of, fbs, games, windows, slug_by_id, aliases)

    result = build_week(
        season=args.season, week=week, as_of=as_of.isoformat(), fei=table, fei_url=fei_url(args.season),
        cfbd_teams=fbs, cfbd_games=games, committee=chosen,
        committee_url=committee.CFP_URL if chosen else None, playoff_formats=playoff_formats, aliases=aliases,
        slugs=slugs,
    )
    for n in result.notes:
        log(f"  note: {n}")
    if result.errors:
        log(f"FAILED: {len(result.errors)} cross-check error(s):")
        for e in result.errors:
            log(f"  - {e}")
        return 1
    doc = result.doc

    # Keep the previous asOf when nothing but the pull date changed (no churn commits).
    week_path = season_dir / f"week-{week}.json"
    if week_path.exists() and not args.as_of:
        old = read_json(week_path, "existing week file")
        if isinstance(old, dict) and {**old, "asOf": None} == {**doc, "asOf": None}:
            doc["asOf"] = old["asOf"]

    entry = {"week": week, "asOf": doc["asOf"], "label": doc["label"], "hasCommittee": doc["committee"] is not None}
    new_index = {
        "season": args.season,
        "weeks": sorted([w for w in index["weeks"] if isinstance(w, dict) and w.get("week") != week] + [entry],
                        key=lambda w: w["week"]),
    }
    prev_path = validator.previous_week_path(week_path) if season_dir.is_dir() else None
    previous = read_json(prev_path, "previous week file") if prev_path is not None else None
    problems = validator.validate_week(doc, index=new_index, label=str(week_path), previous=previous,
                                       config_dir=args.config_dir)
    if problems:
        log(f"FAILED validation ({len(problems)} problem(s)); nothing written:")
        for p in problems[:100]:
            log(f"  - {p}")
        return 1

    s = result.stats
    teams = doc["teams"]
    gwd25 = {k for k, t in teams.items() if t["ranks"]["sor"] <= 25}
    com25 = set(doc["committee"] or [])
    log(f"built week {week}: {s['teams']} teams (fbsCount {doc['fbsCount']}), {s['games']} games "
        f"({s['fbsVsFbs']} FBS-vs-FBS, {s['neutral']} neutral), {s['opponents']} non-FBS opponents; "
        f"{s['excludedLaterCompleted']} completed games after week {week} excluded")
    if doc["committee"]:
        log(f"committee {doc['sources']['committee']['releaseDate']}: top-25 overlap with GWD top 25 = "
            f"{len(gwd25 & com25)} (pool size {len(gwd25 | com25)})")
    if slugs.added:
        log(f"slugs: {len(slugs.added)} new slug(s) pinned")
    if args.dry_run:
        log("dry run: nothing written")
        return 0
    week_text, index_text = dumps(doc), dumps(new_index)
    season_dir.mkdir(parents=True, exist_ok=True)
    week_path.write_text(week_text, encoding="utf-8")
    index_path.write_text(index_text, encoding="utf-8")
    if slugs.added:
        slugs.save()
    log(f"wrote {week_path} and {index_path.name}")
    return 0


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        return run(args)
    except (PipelineError, FetchError) as exc:
        log(f"FAILED: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
