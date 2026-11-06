"""CFP selection committee top 25.

Sources, in order of authority:
  1. collegefootballplayoff.com/rankings (primary): text "Full Rankings 1 Miami 8-0 2 Georgia 7-1 ..."
     for the latest release, whose date ("Nov. 3") is shown on the page.
  2. CFBD /rankings poll "Playoff Committee Rankings" (cross-check, and fallback when the CFP
     site cannot be read). CFBD gives no release date, so polls are dated from the published
     release schedule in pipeline/committee_schedule.json (n-th committee poll of the season =
     n-th scheduled release), with a sanity check against CFBD's calendar week windows.
  3. bcftoys.com/{season}-cfp (advisory): Brian Fremeau's CFP profile table lists the current
     committee rank per team. A mismatch is reported as a warning, never used as data.

Which release belongs in a snapshot: the latest one dated on/before both the build date (asOf)
and the first release that follows week N's last game (see snapshot_cutoff). So week 13 takes
the Tuesday Dec 1 release, never the Sunday Dec 6 release that follows championship weekend.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from . import PipelineError
from .fei import html_rows

CFP_URL = "https://collegefootballplayoff.com/rankings"
COMMITTEE_POLL = "Playoff Committee Rankings"
COMMITTEE_SIZE = 25
EASTERN = ZoneInfo("America/New_York")

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_DATE_RE = re.compile(
    r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|"
    r"Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?"
    r"(?:,?\s+(\d{4}))?\b"
)
_SEASON_MONTHS = {8, 9, 10, 11, 12, 1}


class CommitteeUnavailable(Exception):
    """A committee source could not be read (blocked, changed markup, ...). Not fatal in auto mode."""


@dataclass
class Release:
    date: str                 # YYYY-MM-DD
    names: list[str]          # as published by the source, rank order
    slugs: list[str] = field(default_factory=list)
    source: str = ""          # 'cfp' | 'cfbd'
    detail: str = ""


def iso(d: date) -> str:
    return d.isoformat()


def to_eastern_date(stamp: str) -> date:
    dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    return dt.astimezone(EASTERN).date()


def page_text(raw_html: str) -> str:
    t = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", raw_html, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def _dates_in(text: str, season: int) -> list[date]:
    out = []
    for m in _DATE_RE.finditer(text):
        month = _MONTHS[m.group(1)[:3].lower()]
        if month not in _SEASON_MONTHS:
            continue
        year = int(m.group(3)) if m.group(3) else (season + 1 if month == 1 else season)
        try:
            out.append(date(year, month, int(m.group(2))))
        except ValueError:
            continue
    return out


def parse_cfp_page(raw_html: str, season: int, as_of: date) -> Release:
    """Parse the latest release from collegefootballplayoff.com/rankings."""
    text = page_text(raw_html)
    idx = text.lower().find("full rankings")
    if idx < 0:
        raise CommitteeUnavailable("CFP page has no 'Full Rankings' section (blocked or markup changed)")
    seg = text[idx + len("full rankings"):]
    names: list[str] = []
    pos = 0
    for expected in range(1, COMMITTEE_SIZE + 1):
        m = re.compile(rf"(?<![\d-]){expected}\s+([^\d]+?)\s+\(?(\d{{1,2}}-\d{{1,2}})\)?(?![\d-])").search(seg, pos)
        if not m:
            raise CommitteeUnavailable(f"CFP page: could not find rank {expected} after 'Full Rankings'")
        name = m.group(1).strip(" .,:;")
        names.append(name)
        pos = m.end()
    if len(set(names)) != COMMITTEE_SIZE:
        raise CommitteeUnavailable(f"CFP page: duplicate teams in parsed ranking: {names}")
    # Release date: prefer dates shown just before the ranking list, else anywhere on the page.
    near = [d for d in _dates_in(text[max(0, idx - 600): idx + 1], season) if d <= as_of]
    anywhere = [d for d in _dates_in(text, season) if d <= as_of]
    cands = near or anywhere
    if not cands:
        raise CommitteeUnavailable("CFP page: no release date on/before the build date found")
    return Release(date=iso(max(cands)), names=names, source="cfp", detail=CFP_URL)


def committee_polls(rankings_by_type: dict[str, list[dict]]) -> list[dict]:
    """[{seasonType, week, ranks: [(rank, teamId, school)]}] sorted chronologically."""
    order = {"regular": 0, "postseason": 1}
    out = []
    for stype, weeks in rankings_by_type.items():
        for wk in weeks:
            for poll in wk.get("polls", []):
                if poll.get("poll") != COMMITTEE_POLL:
                    continue
                ranks = sorted(
                    ((int(r["rank"]), int(r["teamId"]), str(r["school"])) for r in poll.get("ranks", [])),
                    key=lambda r: r[0],
                )
                out.append({"seasonType": wk.get("seasonType", stype), "week": int(wk["week"]), "ranks": ranks})
    out.sort(key=lambda p: (order.get(p["seasonType"], 9), p["week"]))
    return out


def calendar_windows(calendar: list[dict]) -> dict[tuple[str, int], tuple[date, date]]:
    out = {}
    for w in calendar:
        out[(w["seasonType"], int(w["week"]))] = (to_eastern_date(w["startDate"]), to_eastern_date(w["endDate"]))
    return out


def date_cfbd_polls(
    polls: list[dict],
    schedule: list[str],
    windows: dict[tuple[str, int], tuple[date, date]],
    override_latest: str | None = None,
) -> list[tuple[dict, str]]:
    """Attach a release date to each CFBD committee poll (n-th poll = n-th scheduled release)."""
    sched = sorted(schedule)
    out = []
    for k, p in enumerate(polls):
        if override_latest and k == len(polls) - 1:
            out.append((p, override_latest))
            continue
        if k >= len(sched):
            raise PipelineError(
                f"CFBD has {len(polls)} committee polls but pipeline/committee_schedule.json lists only "
                f"{len(sched)} release dates. Update the schedule or pass --committee-release-date."
            )
        d = date.fromisoformat(sched[k])
        win = windows.get((p["seasonType"], p["week"]))
        # A Tuesday release sits inside CFBD's week window; the final (Sunday) release may be filed
        # under the following week or the postseason, so allow a little slack before the window.
        slack = timedelta(days=2 if p["seasonType"] == "regular" else 7)
        if win and not (win[0] - slack <= d <= win[1]):
            raise PipelineError(
                f"CFBD committee poll #{k + 1} ({p['seasonType']} week {p['week']}, window {win[0]}..{win[1]}) "
                f"does not line up with scheduled release {d}. A poll is missing or the schedule is wrong; "
                "check pipeline/committee_schedule.json or pass --committee-release-date."
            )
        out.append((p, iso(d)))
    return out


def last_game_day(week: int, games: list[dict], windows: dict[tuple[str, int], tuple[date, date]]) -> date:
    """US Eastern date of the last CFBD regular-season game labelled week N.

    A game dated after the end of week N's calendar window (postponed but still labelled N) does
    not count. With no games listed for the week (e.g. championship matchups not yet set), the end
    of the week's calendar window is used.
    """
    win = windows.get(("regular", week))
    days = []
    for g in games:
        if g.get("seasonType", "regular") != "regular" or g.get("week") is None or int(g["week"]) != week:
            continue
        if not g.get("startDate"):
            continue
        d = to_eastern_date(g["startDate"])
        if win and d > win[1]:
            continue
        days.append(d)
    if days:
        return max(days)
    if win:
        return win[1]
    raise PipelineError(f"week {week} has no CFBD regular-season games and is not in the CFBD calendar")


def snapshot_cutoff(week: int, games: list[dict], windows: dict[tuple[str, int], tuple[date, date]],
                    release_dates: list[date]) -> date | None:
    """Latest release date that can belong to snapshot `week`.

    That is the first committee release dated after the last game of week N: the Tuesday release
    after a normal week, the Sunday release after championship weekend. Releases after it reflect
    later games. None when no release follows week N (every release on/before asOf qualifies).
    """
    last = last_game_day(week, games, windows)
    later = sorted(d for d in release_dates if d > last)
    return later[0] if later else None


def parse_bcftoys_cfp(raw_html: str) -> list[tuple[int, str]]:
    """bcftoys.com/{season}-cfp: rows 'CFP rank, Team, Rec, ...' -> [(rank, FEI-style name)]."""
    out = []
    for cells in html_rows(raw_html):
        if len(cells) >= 3 and cells[0].isdigit() and re.match(r"^\d+-\d+$", cells[2] or ""):
            out.append((int(cells[0]), cells[1]))
    out.sort()
    return out


def choose(
    mode: str,
    cfp: Release | None,
    cfbd: list[Release],
    as_of: date,
    cutoff: date | None,
    log: Callable[[str], None] = print,
    cfbd_available: bool = True,
) -> Release | None:
    """Pick the committee release for this snapshot; raise PipelineError on any disagreement."""
    if mode == "none":
        return None
    limit = min(as_of, cutoff) if cutoff else as_of

    def ok(r: Release) -> bool:
        return date.fromisoformat(r.date) <= limit

    cfbd_ok = [r for r in cfbd if ok(r)]
    cfbd_sel = max(cfbd_ok, key=lambda r: r.date) if cfbd_ok else None
    cfp_sel = cfp if (cfp and ok(cfp)) else None
    if cfp and not cfp_sel:
        log(f"  committee: CFP page shows the {cfp.date} release, which is after this snapshot's limit {limit}; not used")

    if cfp and not cfp_sel and (mode == "cfp" or not cfbd_available):
        # The CFP page only shows the latest release; without CFBD we cannot tell which older
        # release (if any) belongs to this snapshot.
        raise PipelineError(
            f"committee: the CFP page shows the {cfp.date} release, newer than this snapshot allows ({limit}), "
            "and CFBD is not available to find the right one; use --committee-source cfbd or auto"
        )
    if mode == "cfp":
        if cfp is None:
            raise PipelineError("--committee-source cfp: the CFP rankings page could not be read")
        return cfp_sel
    if mode == "cfbd":
        return cfbd_sel

    # auto
    if cfp_sel and cfbd_sel:
        if cfp_sel.date == cfbd_sel.date:
            if cfp_sel.slugs != cfbd_sel.slugs:
                diff = [
                    f"#{i + 1}: CFP {a} vs CFBD {b}"
                    for i, (a, b) in enumerate(zip(cfp_sel.slugs, cfbd_sel.slugs)) if a != b
                ]
                raise PipelineError(
                    f"committee: CFP site and CFBD disagree on the {cfp_sel.date} release: " + "; ".join(diff)
                )
            log(f"  committee: CFP site and CFBD agree on the {cfp_sel.date} release")
            cfp_sel.detail = f"{CFP_URL} (cross-checked with CFBD)"
            return cfp_sel
        if cfp_sel.date > cfbd_sel.date:
            if cfp_sel.slugs == cfbd_sel.slugs:
                raise PipelineError(
                    f"committee: CFP page date {cfp_sel.date} and CFBD-derived date {cfbd_sel.date} differ for "
                    "an identical ranking; check committee_schedule.json and the CFP page date parsing"
                )
            log(f"  committee: CFP site has a newer release ({cfp_sel.date}) than CFBD ({cfbd_sel.date}); using CFP")
            return cfp_sel
        raise PipelineError(
            f"committee: CFBD has a {cfbd_sel.date} release but the CFP page shows an older one ({cfp_sel.date})"
        )
    if cfp_sel:
        log(f"  committee: using CFP site release {cfp_sel.date} (no CFBD poll to cross-check)")
        return cfp_sel
    if cfbd_sel:
        if cfp is None:
            log(f"  committee: CFP site unavailable; using CFBD ({cfbd_sel.detail}, release {cfbd_sel.date}) without the CFP cross-check")
        return cfbd_sel
    return None
