"""Name joins (aliases.json) and stable slugs (slugs.json)."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from . import PipelineError

APOSTROPHES = "'’‘ʻʼ`´"


def slugify(name: str) -> str:
    """ascii-fold, lowercase, drop '&' and apostrophes, non-alnum -> '-', collapse.

    "Miami (OH)" -> "miami-oh", "Texas A&M" -> "texas-am", "Hawai'i" -> "hawaii",
    "San José State" -> "san-jose-state".
    """
    s = name
    for ch in APOSTROPHES:
        s = s.replace(ch, "")
    s = s.replace("&", "")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    if not s:
        raise PipelineError(f"cannot build a slug from team name {name!r}")
    return s


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise PipelineError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PipelineError(f"{path} is not valid JSON: {exc}") from exc


def load_aliases(path: Path) -> dict[str, dict[str, str]]:
    data = _read_json(path)
    if not isinstance(data, dict):
        raise PipelineError(f"{path}: expected an object with 'fei' and 'cfp' sections")
    out: dict[str, dict[str, str]] = {}
    for key in ("fei", "cfp"):
        section = data.get(key, {})
        if not isinstance(section, dict):
            raise PipelineError(f"{path}: '{key}' must be an object of source name -> CFBD school")
        out[key] = {str(k): str(v) for k, v in section.items()}
    return out


def resolve_names(names: list[str], known: set[str], alias_map: dict[str, str], source: str) -> dict[str, str]:
    """Map each source name to a CFBD school name. Any unmatched name is a hard failure."""
    resolved: dict[str, str] = {}
    unmatched: list[str] = []
    for n in names:
        target = alias_map.get(n, n)
        if target in known:
            resolved[n] = target
        else:
            unmatched.append(n)
    if unmatched:
        raise PipelineError(
            f"{source}: {len(unmatched)} team name(s) do not match any CFBD FBS school: "
            + ", ".join(repr(u) for u in sorted(unmatched))
            + f". Add an entry under \"{'cfp' if source.startswith('CFP') else 'fei'}\" in pipeline/aliases.json"
            " (source name -> CFBD school) after checking the team by hand."
        )
    return resolved


class SlugBook:
    """Slugs pinned per CFBD team id. Existing slugs are never changed."""

    def __init__(self, path: Path):
        self.path = path
        raw = _read_json(path) if path.exists() else {}
        if not isinstance(raw, dict):
            raise PipelineError(f"{path}: expected an object of CFBD team id -> slug")
        self.by_id: dict[int, str] = {}
        for k, v in raw.items():
            if not str(k).isdigit() or not isinstance(v, str) or not v:
                raise PipelineError(f"{path}: bad entry {k!r}: {v!r}")
            self.by_id[int(k)] = v
        owners: dict[str, int] = {}
        for tid, slug in self.by_id.items():
            if slug in owners:
                raise PipelineError(f"{path}: slug {slug!r} is pinned to both {owners[slug]} and {tid}")
            if slug != slugify(slug):
                raise PipelineError(f"{path}: slug {slug!r} (id {tid}) is not a valid slug")
            owners[slug] = tid
        self._owners = owners
        self.added: dict[int, str] = {}

    def slug_for(self, team_id: int, name: str) -> str:
        if team_id in self.by_id:
            return self.by_id[team_id]
        base = slugify(name)
        slug = base
        k = 1
        while slug in self._owners:
            # Never steal an existing slug; disambiguate deterministically with the id (and a
            # counter if even that is taken, e.g. by a pinned slug that happens to end in -{id}).
            slug = f"{base}-{team_id}" if k == 1 else f"{base}-{team_id}-{k}"
            k += 1
        self.by_id[team_id] = slug
        self._owners[slug] = team_id
        self.added[team_id] = slug
        return slug

    def dumps(self) -> str:
        ordered = {str(k): self.by_id[k] for k in sorted(self.by_id)}
        return json.dumps(ordered, indent=1, ensure_ascii=False) + "\n"

    def save(self) -> None:
        self.path.write_text(self.dumps(), encoding="utf-8")
