"""FEI table from bcftoys.com: HTML parser and CSV / pasted-text fallback.

The live page (https://bcftoys.com/{season}-fei) is a run of small <table> blocks of 15 rows,
each starting with the same header row. Columns (in order):

  Rk Team Rec FBS FEI | OFEI Rk DFEI Rk SFEI Rk | ELS Rk GLS Rk ALS Rk | EWD Rk GWD Rk AWD Rk

with empty spacer cells between the groups. Values look like ".65", "-.55", "1.43".
"""
from __future__ import annotations

import csv
import html
import re
from dataclasses import dataclass
from html.parser import HTMLParser

from . import PipelineError

COLUMNS = [
    "Rk", "Team", "Rec", "FBS", "FEI",
    "OFEI", "OFEI_Rk", "DFEI", "DFEI_Rk", "SFEI", "SFEI_Rk",
    "ELS", "ELS_Rk", "GLS", "GLS_Rk", "ALS", "ALS_Rk",
    "EWD", "EWD_Rk", "GWD", "GWD_Rk", "AWD", "AWD_Rk",
]
INT_COLS = {"Rk"} | {c for c in COLUMNS if c.endswith("_Rk")}
REC_COLS = {"Rec", "FBS"}
FLOAT_COLS = set(COLUMNS) - INT_COLS - REC_COLS - {"Team"}

THROUGH_WEEK_RE = re.compile(r"through\s+Week\s+(\d+)", re.I)
RECORD_RE = re.compile(r"^(\d+)-(\d+)$")
NUM_RE = re.compile(r"^-?(\d+)?\.?\d+$")
MINUS_CHARS = "−–‒"


@dataclass
class FeiRow:
    rank: int
    team: str
    rec: tuple[int, int]
    fbs: tuple[int, int]
    values: dict[str, float]   # FEI, OFEI, DFEI, SFEI, ELS, GLS, ALS, EWD, GWD, AWD
    ranks: dict[str, int]      # OFEI_Rk, DFEI_Rk, ... AWD_Rk


@dataclass
class FeiTable:
    through_week: int | None
    rows: list[FeiRow]
    origin: str  # "html" or "csv"

    def by_team(self) -> dict[str, FeiRow]:
        return {r.team: r for r in self.rows}


def _clean(text: str) -> str:
    t = html.unescape(text).replace("\xa0", " ")
    for ch in MINUS_CHARS:
        t = t.replace(ch, "-")
    return re.sub(r"\s+", " ", t).strip()


def _parse_num(col: str, raw: str, where: str) -> float:
    if not NUM_RE.match(raw):
        raise PipelineError(f"FEI {where}: column {col} value {raw!r} is not a number")
    return float(raw)


def _parse_int(col: str, raw: str, where: str) -> int:
    if not raw.isdigit():
        raise PipelineError(f"FEI {where}: column {col} value {raw!r} is not an integer rank")
    return int(raw)


def _parse_rec(col: str, raw: str, where: str) -> tuple[int, int]:
    m = RECORD_RE.match(raw)
    if not m:
        raise PipelineError(f"FEI {where}: column {col} value {raw!r} is not a W-L record")
    return int(m.group(1)), int(m.group(2))


def row_from_fields(fields: dict[str, str], where: str) -> FeiRow:
    missing = [c for c in COLUMNS if c not in fields]
    if missing:
        raise PipelineError(f"FEI {where}: missing columns {missing}")
    team = fields["Team"].strip()
    if not team:
        raise PipelineError(f"FEI {where}: empty team name")
    return FeiRow(
        rank=_parse_int("Rk", fields["Rk"], where),
        team=team,
        rec=_parse_rec("Rec", fields["Rec"], where),
        fbs=_parse_rec("FBS", fields["FBS"], where),
        values={c: _parse_num(c, fields[c], where) for c in COLUMNS if c in FLOAT_COLS},
        ranks={c: _parse_int(c, fields[c], where) for c in COLUMNS if c in INT_COLS and c != "Rk"},
    )


# The rank columns the week file uses, each with the value it orders (a higher value ranks better).
RANKED_COLUMNS = (("Rk", "FEI"), ("OFEI_Rk", "OFEI"), ("DFEI_Rk", "DFEI"), ("ELS_Rk", "ELS"), ("GWD_Rk", "GWD"))


def _check_rank_order(rows: list[FeiRow], origin: str) -> None:
    """Ranks must follow their values: ordered by rank, a value never increases and tied ranks share a value.

    Works on any subset of the table (trimmed copies too). It catches the typical hand-paste typo (a
    rank or value changed in one row); validate.py also checks that each rank column is a complete,
    gap-free ranking of every FBS team.
    """
    for rk, vk in RANKED_COLUMNS:
        pts = sorted(((r.rank if rk == "Rk" else r.ranks[rk]), r.values[vk], r.team) for r in rows)
        for (r0, v0, t0), (r1, v1, t1) in zip(pts, pts[1:]):
            if (r0 == r1 and v0 != v1) or v1 > v0:
                raise PipelineError(
                    f"FEI ({origin}): column {rk} does not follow {vk}: {t0} is #{r0} with {vk} {v0:g} and {t1} is "
                    f"#{r1} with {v1:g}. A higher {vk} must rank better and tied ranks must share a value; check "
                    "these rows against the page (a typo in a pasted table?)"
                )


def _check_rows(rows: list[FeiRow], origin: str) -> None:
    if not rows:
        raise PipelineError(f"FEI ({origin}): no data rows found")
    seen: dict[str, int] = {}
    for r in rows:
        if r.team in seen:
            raise PipelineError(f"FEI ({origin}): team {r.team!r} appears twice")
        seen[r.team] = r.rank
    _check_rank_order(rows, origin)


# ---------------------------------------------------------------- HTML


class _RowCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._close_row()
            self._row = []
        elif tag in ("td", "th"):
            if self._row is None:
                self._row = []
            self._close_cell()
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th"):
            self._close_cell()
        elif tag == "tr":
            self._close_row()
        elif tag == "table":
            self._close_row()

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def _close_cell(self):
        if self._cell is not None and self._row is not None:
            self._row.append(_clean("".join(self._cell)))
        self._cell = None

    def _close_row(self):
        self._close_cell()
        if self._row is not None:
            self.rows.append(self._row)
        self._row = None

    def close(self):
        super().close()
        self._close_row()


def html_rows(text: str) -> list[list[str]]:
    p = _RowCollector()
    p.feed(text)
    p.close()
    return p.rows


def header_map(cells: list[str]) -> dict[str, int]:
    """Map COLUMNS names to cell indexes from a header row.

    Accepts the page's header (Rk, Team, ..., OFEI, Rk, DFEI, Rk: a bare "Rk" after a column is
    that column's rank) and the template's (OFEI, OFEI_Rk, ...). A repeated name is an error.
    """
    out: dict[str, int] = {}
    prev: str | None = None
    for i, c in enumerate(cells):
        if not c:
            continue
        if c == "Rk":
            name = "Rk" if prev is None else f"{prev}_Rk"
        else:
            name = c
            prev = c
        if name in out:
            raise PipelineError(f"FEI header: column {name} appears twice: {cells}")
        out[name] = i
    return out


def through_week(text: str) -> int | None:
    m = THROUGH_WEEK_RE.search(_clean(re.sub(r"<[^>]+>", " ", text)))
    return int(m.group(1)) if m else None


def parse_fei_html(text: str) -> FeiTable:
    rows = html_rows(text)
    hmap: dict[str, int] | None = None
    width = 0
    out: list[FeiRow] = []
    for n, cells in enumerate(rows):
        if len(cells) >= 2 and cells[0] == "Rk" and cells[1] == "Team":
            hmap = header_map(cells)
            width = len(cells)
            missing = [c for c in COLUMNS if c not in hmap]
            if missing:
                raise PipelineError(f"FEI html: header row is missing columns {missing}: {cells}")
            continue
        if not cells or not cells[0].isdigit():
            continue
        if hmap is None:
            raise PipelineError("FEI html: data row before any header row")
        if len(cells) != width:
            raise PipelineError(f"FEI html: row {n} has {len(cells)} cells, header has {width}: {cells}")
        out.append(row_from_fields({c: cells[i] for c, i in hmap.items()}, f"html row {n} ({cells[1]})"))
    _check_rows(out, "html")
    return FeiTable(through_week=through_week(text), rows=out, origin="html")


# ---------------------------------------------------------------- CSV / pasted text

_WS_ROW_RE = re.compile(r"^(\d+)\s+(.+?)\s+(\d+-\d+)\s+(\d+-\d+)\s+(.*)$")


def _line_fields(line: str) -> tuple[list[str], str]:
    if "\t" in line:
        return [_clean(f) for f in line.split("\t")], "tsv"
    if "," in line:
        return [_clean(f) for f in next(csv.reader([line]))], "csv"
    m = _WS_ROW_RE.match(_clean(line))
    if not m:
        return [_clean(line)], "text"
    return [m.group(1), m.group(2), m.group(3), m.group(4)] + m.group(5).split(), "text"


def parse_fei_text(text: str) -> FeiTable:
    """Parse a CSV with the fei_template.csv header, or raw text copied from the page.

    Accepted line formats (mixed is fine): comma-separated, tab-separated (what browsers put on
    the clipboard when you copy a table), or space-separated. Values are matched to columns by
    the header row ("Rk, Team, ..."), never by position: either the page's header (OFEI, Rk,
    DFEI, Rk, ...; repeated every 15 rows on the site) or the template's (OFEI, OFEI_Rk, ...).
    A data row before any header row, or a header missing a column, is an error. The group-title
    row, title/footer lines and blank spacer cells are ignored. Lines starting with '#' are
    comments. A line containing "through Week N" anywhere sets the through-week.
    """
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    out: list[FeiRow] = []
    hmap: dict[str, int] | None = None
    width = 0
    for n, line in enumerate(text.split("\n"), start=1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields, kind = _line_fields(line)
        fields = [f for f in fields if f != ""]
        words = fields[0].split() if kind == "text" and len(fields) == 1 else fields
        if len(words) >= 2 and words[0] == "Rk" and words[1] == "Team":
            hmap = header_map(words)
            width = len(words)
            missing = [c for c in COLUMNS if c not in hmap]
            if missing:
                raise PipelineError(f"FEI csv line {n}: header row is missing columns {missing}: {words}")
            continue
        if not fields or not fields[0].isdigit():
            continue  # title / group-title / footer line
        if hmap is None:
            raise PipelineError(
                f"FEI csv line {n}: data row before any header row. Keep the 'Rk,Team,...' header from "
                "pipeline/fei_template.csv, or copy the table's header row along with the data: columns "
                "are matched by name, never by position."
            )
        if len(fields) != width:
            if kind == "text":
                continue  # not a table row (space-separated lines are only loosely recognisable)
            raise PipelineError(
                f"FEI csv line {n}: expected {width} non-empty fields (as in the header row "
                f"{', '.join(c for c in hmap)}), found {len(fields)}: {fields}"
            )
        row = {c: fields[i] for c, i in hmap.items()}
        out.append(row_from_fields(row, f"csv line {n} ({row['Team']})"))
    _check_rows(out, "csv")
    tw = THROUGH_WEEK_RE.search(text)
    return FeiTable(through_week=int(tw.group(1)) if tw else None, rows=out, origin="csv")


def looks_like_fei_page(text: str) -> bool:
    try:
        return len(parse_fei_html(text).rows) > 0
    except PipelineError:
        return False
