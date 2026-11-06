"""Assemble a WeekFile (see src/lib/types.ts) from parsed FEI, CFBD and committee data."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import SCHEMA_VERSION, PipelineError
from .cfbd import SITE_URL as CFBD_SITE_URL
from .committee import Release, to_eastern_date
from .fei import FeiTable
from .names import SlugBook, resolve_names

HEX6 = re.compile(r"^#?([0-9a-fA-F]{6})$")
HEX3 = re.compile(r"^#?([0-9a-fA-F]{3})$")
PLAYOFF_KEYS = ("size", "byes", "seeding", "autoBids", "nonConferences", "sourceUrl")


@dataclass
class BuildResult:
    doc: dict
    errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def norm_color(value, what: str) -> str:
    if not isinstance(value, str):
        raise PipelineError(f"{what}: missing color ({value!r})")
    v = value.strip()
    m = HEX6.match(v)
    if m:
        return "#" + m.group(1).lower()
    m = HEX3.match(v)
    if m:
        return "#" + "".join(c * 2 for c in m.group(1).lower())
    raise PipelineError(f"{what}: color {value!r} is not a hex color")


def included_games(games: list[dict], fbs_ids: set[int], week: int) -> list[dict]:
    """Completed regular-season games involving an FBS team with week <= snapshot week."""
    seen: dict[int, dict] = {}
    for g in games:
        if g.get("seasonType", "regular") != "regular" or not g.get("completed"):
            continue
        if g.get("week") is None or int(g["week"]) > week:
            continue
        if g.get("homeId") not in fbs_ids and g.get("awayId") not in fbs_ids:
            continue
        if g.get("homePoints") is None or g.get("awayPoints") is None:
            raise PipelineError(f"CFBD game {g.get('id')} ({g.get('awayTeam')} at {g.get('homeTeam')}) is completed but has no score")
        seen[int(g["id"])] = g
    return sorted(seen.values(), key=lambda g: (g["startDate"], int(g["id"])))


def build_week(
    *,
    season: int,
    week: int,
    as_of: str,
    fei: FeiTable,
    fei_url: str,
    cfbd_teams: list[dict],
    cfbd_games: list[dict],
    committee: Release | None,
    committee_url: str | None,
    playoff: dict,
    aliases: dict[str, dict[str, str]],
    slugs: SlugBook,
) -> BuildResult:
    errors: list[str] = []
    notes: list[str] = []
    if fei.through_week is not None and fei.through_week != week:
        raise PipelineError(
            f"FEI is through Week {fei.through_week} but the snapshot is week {week}: a week file must pair "
            "ratings and games from the same week"
        )

    # ---- FBS teams (CFBD) and the FEI join
    by_id: dict[int, dict] = {}
    by_school: dict[str, dict] = {}
    for t in cfbd_teams:
        if t.get("classification") not in (None, "fbs"):
            continue
        tid = int(t["id"])
        if t["school"] in by_school:
            raise PipelineError(f"CFBD /teams/fbs lists school {t['school']!r} twice")
        by_id[tid] = t
        by_school[t["school"]] = t
    fbs_count = len(by_id)

    fei_rows = fei.by_team()
    resolved = resolve_names(list(fei_rows), set(by_school), aliases.get("fei", {}), "FEI (bcftoys)")
    inverse: dict[str, str] = {}
    for fei_name, school in resolved.items():
        if school in inverse:
            raise PipelineError(f"FEI names {inverse[school]!r} and {fei_name!r} both map to CFBD school {school!r}")
        inverse[school] = fei_name
    missing = sorted(set(by_school) - set(inverse))
    if missing:
        raise PipelineError(
            f"FEI table has {len(fei_rows)} teams; {len(missing)} CFBD FBS school(s) have no FEI row: "
            + ", ".join(repr(m) for m in missing)
            + ". If FEI spells them differently, add aliases in pipeline/aliases.json."
        )

    # ---- slugs: FBS first, then opponents, each in id order (deterministic)
    slug_of: dict[int, str] = {tid: slugs.slug_for(tid, by_id[tid]["school"]) for tid in sorted(by_id)}

    games = included_games(cfbd_games, set(by_id), week)
    opp_ids: dict[int, tuple[str, str | None]] = {}
    for g in games:
        for side in ("home", "away"):
            tid = int(g[f"{side}Id"])
            if tid not in by_id and tid not in opp_ids:
                opp_ids[tid] = (g[f"{side}Team"], g.get(f"{side}Classification"))
            elif tid in opp_ids and opp_ids[tid][1] is None and g.get(f"{side}Classification"):
                opp_ids[tid] = (opp_ids[tid][0], g.get(f"{side}Classification"))
    opponents: dict[str, dict] = {}
    for tid in sorted(opp_ids):
        name, cls = opp_ids[tid]
        slug = slugs.slug_for(tid, name)
        slug_of[tid] = slug
        if not cls:
            notes.append(f"non-FBS opponent {name!r} (id {tid}) has no CFBD classification; stored as 'unknown'")
        if cls == "fbs":
            raise PipelineError(f"{name!r} (id {tid}) is classified fbs by CFBD games but is not in /teams/fbs")
        opponents[slug] = {"slug": slug, "name": name, "classification": cls or "unknown"}

    # ---- game logs
    logs: dict[int, list[dict]] = {tid: [] for tid in by_id}
    for g in games:
        date = to_eastern_date(g["startDate"]).isoformat()
        hp, ap = int(g["homePoints"]), int(g["awayPoints"])
        if hp == ap:
            raise PipelineError(f"CFBD game {g['id']} ended in a tie ({hp}-{ap}); not representable")
        for side, other, pf, pa in (("home", "away", hp, ap), ("away", "home", ap, hp)):
            tid = int(g[f"{side}Id"])
            if tid not in by_id:
                continue
            oid = int(g[f"{other}Id"])
            logs[tid].append({
                "week": int(g["week"]),
                "date": date,
                "opp": slug_of[oid],
                "oppFbs": oid in by_id,
                "site": "neutral" if g.get("neutralSite") else side,
                "pf": pf,
                "pa": pa,
                "result": "W" if pf > pa else "L",
                "conf": bool(g.get("conferenceGame")),
            })

    # ---- committee
    committee_slugs: list[str] | None = None
    if committee is not None:
        committee_slugs = list(committee.slugs)
    crank = {s: i + 1 for i, s in enumerate(committee_slugs or [])}

    # ---- teams
    teams: dict[str, dict] = {}
    for tid in sorted(by_id):
        t = by_id[tid]
        slug = slug_of[tid]
        row = fei_rows[inverse[t["school"]]]
        gl = logs[tid]
        rec = {"w": sum(1 for x in gl if x["result"] == "W"), "l": sum(1 for x in gl if x["result"] == "L")}
        conf = {
            "w": sum(1 for x in gl if x["conf"] and x["result"] == "W"),
            "l": sum(1 for x in gl if x["conf"] and x["result"] == "L"),
        }
        # FEI's Rec/FBS columns must equal the included games. An FEI input that does not say its
        # week is checked against the snapshot week (the only proof it is that week's table).
        if fei.through_week is None or fei.through_week == week:
            if (rec["w"], rec["l"]) != row.rec:
                errors.append(
                    f"{t['school']}: record from CFBD games through week {week} is {rec['w']}-{rec['l']} "
                    f"but FEI says {row.rec[0]}-{row.rec[1]}"
                )
            fbs_w = sum(1 for x in gl if x["oppFbs"] and x["result"] == "W")
            fbs_l = sum(1 for x in gl if x["oppFbs"] and x["result"] == "L")
            if (fbs_w, fbs_l) != row.fbs:
                errors.append(
                    f"{t['school']}: record vs FBS from CFBD is {fbs_w}-{fbs_l} but FEI says {row.fbs[0]}-{row.fbs[1]}"
                )
        abbr = t.get("abbreviation")
        if not abbr:
            notes.append(f"{t['school']}: CFBD has no abbreviation; using the school name")
            abbr = t["school"]
        teams[slug] = {
            "slug": slug,
            "id": tid,
            "name": t["school"],
            "short": abbr,
            "mascot": t.get("mascot") or None,
            "conference": t.get("conference") or "",
            "colors": {
                "primary": norm_color(t.get("color"), f"{t['school']} color"),
                "secondary": norm_color(t.get("alternateColor"), f"{t['school']} alternateColor"),
            },
            "record": rec,
            "confRecord": conf,
            "ranks": {
                "sor": row.ranks["GWD_Rk"],
                "sos": row.ranks["ELS_Rk"],
                "off": row.ranks["OFEI_Rk"],
                "def": row.ranks["DFEI_Rk"],
                "fei": row.rank,
                "committee": crank.get(slug),
            },
            "values": {
                "fei": row.values["FEI"],
                "ofei": row.values["OFEI"],
                "dfei": row.values["DFEI"],
                "gwd": row.values["GWD"],
                "els": row.values["ELS"],
            },
            "games": gl,
        }

    # ---- conference champions (championship games within the included weeks)
    non_conf = set(playoff.get("nonConferences", []))
    champions: dict[str, str] = {}
    for g in games:
        h, a = int(g["homeId"]), int(g["awayId"])
        if h not in by_id or a not in by_id:
            continue
        conf_name = by_id[h].get("conference")
        if not conf_name or conf_name != by_id[a].get("conference") or conf_name in non_conf:
            continue
        if "championship" not in str(g.get("notes") or "").lower():
            continue
        winner = h if int(g["homePoints"]) > int(g["awayPoints"]) else a
        champions[conf_name] = slug_of[winner]
        notes.append(f"champion detected: {conf_name} -> {slug_of[winner]} (game {g['id']}: {g.get('notes')})")

    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "season": season,
        "week": week,
        "asOf": as_of,
        "label": f"After Week {week}",
        "sources": {
            "ratings": {"name": "FEI", "author": "Brian Fremeau", "url": fei_url, "throughWeek": fei.through_week},
            "games": {"name": "CollegeFootballData.com", "url": CFBD_SITE_URL},
            "committee": (
                {
                    "name": "College Football Playoff Selection Committee",
                    "url": committee_url,
                    "releaseDate": committee.date,
                }
                if committee is not None
                else None
            ),
        },
        "playoff": {k: playoff[k] for k in PLAYOFF_KEYS},
        "fbsCount": fbs_count,
        "teams": teams,
        "opponents": opponents,
        "committee": committee_slugs,
        "champions": champions,
    }
    stats = {
        "teams": len(teams),
        "games": len(games),
        "fbsVsFbs": sum(1 for g in games if int(g["homeId"]) in by_id and int(g["awayId"]) in by_id),
        "neutral": sum(1 for g in games if g.get("neutralSite")),
        "opponents": len(opponents),
        "excludedLaterCompleted": sum(
            1 for g in cfbd_games
            if g.get("completed") and g.get("week") is not None and int(g["week"]) > week
            and (g.get("homeId") in by_id or g.get("awayId") in by_id)
        ),
    }
    return BuildResult(doc=doc, errors=errors, notes=notes, stats=stats)
