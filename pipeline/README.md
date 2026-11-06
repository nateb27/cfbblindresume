# Weekly data pipeline

Builds `data/{season}/week-{N}.json` (schema: `src/lib/types.ts`) and `data/{season}/index.json`
from three sources, checks everything, and writes only if every check passes.

| Data | Source |
| --- | --- |
| FEI, OFEI, DFEI, ELS, GWD and their ranks | `https://bcftoys.com/{season}-fei` (FEI by Brian Fremeau), or a pasted CSV |
| FBS teams, colors, conference; games, scores, sites | CollegeFootballData.com API (`/teams/fbs`, `/games`, `/calendar`) |
| Committee top 25 | `https://collegefootballplayoff.com/rankings` (primary), CFBD `/rankings` poll "Playoff Committee Rankings" (cross-check / fallback) |

Python 3.12+, standard library plus `requests` (`pipeline/requirements.txt`).

## Run it

```sh
python3 -m pip install -r pipeline/requirements.txt
python3 pipeline/run.py --season 2026            # fetch, build, validate, write
python3 pipeline/validate.py --all               # re-check every week file + index.json
```

`npm run pipeline -- --season 2026` and `npm run validate -- --all` do the same.

Options for `run.py`:

| Flag | Meaning |
| --- | --- |
| `--season Y` | Required. |
| `--week N` | Snapshot week. Default: the FEI page's "(through Week N)". When the FEI input states a week, `--week` must equal it (the run fails otherwise); it is needed only for a CSV without that line. |
| `--fei-csv PATH` | Read FEI from a CSV / pasted text file instead of bcftoys.com (see below). |
| `--committee-source auto\|cfp\|cfbd\|none` | Default `auto`: CFP site primary, CFBD cross-check/fallback. `none` writes `committee: null`. |
| `--committee-release-date YYYY-MM-DD` | Date for the latest CFBD committee poll when the schedule file cannot date it. |
| `--as-of YYYY-MM-DD` | Pin `asOf` (and the date used to pick the committee release). |
| `--dry-run` | Build and validate, write nothing. |
| `--use-cache` | Re-run offline from the raw responses in `pipeline/.cache/` (with `--week N`, from the saved week-N FEI page). |

Environment: `CFBD_API_KEY` (free key from collegefootballdata.com). It is sent as
`Authorization: Bearer ...` when set; requests carry the User-Agent `cfbblindresume-pipeline/1.0`.

Exit status is 1, with the reason printed, on any failure; nothing is written in that case.
Exit status 0 with "season complete, nothing to do" when FEI has moved past the regular season
(its week is beyond the last regular week in the CFBD calendar, or the page has no "through Week
N", as on Fremeau's final post-bowl page, after the season's last scheduled committee release).

## What goes into a week file

- **Snapshot week N** = FEI "through Week N" (`--week` only for an FEI input that does not say;
  ratings from one week are never combined with games from another). Only CFBD games with `completed`
  and `week <= N` are included, so midweek games of week N+1 that are already played are left
  out. Dates are the kickoff date in US Eastern; `neutralSite` games are `neutral`.
- **Teams**: every CFBD FBS team (`fbsCount` = that count). Ranks: `sor` = GWD Rk, `sos` = ELS Rk,
  `off` = OFEI Rk, `def` = DFEI Rk, `fei` = overall Rk, `committee` = 1..25 or null. Values:
  FEI, OFEI, DFEI, GWD, ELS as published. Records are computed from the included games and must
  equal FEI's Rec and FBS columns (always; for an FEI input without "through Week N" this is the
  check that it really is week N's table).
- **Opponents**: non-FBS teams that appear in a game log or a remaining schedule (classification
  from CFBD).
- **Remaining schedules** (`upcoming`, optional per team): CFBD regular-season games after week N
  that are not completed yet: week, date (US Eastern), opponent, site, conference flag, no score.
  Games of week N+1 already played midweek are in neither list until the next week's file.
- **Committee**: the latest release dated on/before both the build date and the first release
  that follows week N's last game (the last CFBD game date labelled week N, or the end of the
  CFBD calendar week if none are listed). That is the Tuesday release after a normal week and the
  Sunday release after championship weekend, so week 13 gets the Dec 1 release, never the Dec 6
  one. A Monday build of week N, before its release is out, keeps the previous release; the
  Wednesday run picks up the new one. In `auto` mode the CFP page and CFBD must agree, or the run
  fails. If neither has a release yet, `committee` is null.
  `bcftoys.com/{season}-cfp` (Fremeau's CFP profile table) is also compared as an advisory check:
  a mismatch is printed as a warning only, because that page can lag a new release.
- **Champions**: conference championship games (both teams in the same conference, CFBD notes
  mention "Championship") within the included weeks.
- **Playoff formats** (`playoffFormats`, schemaVersion 2): copied from `pipeline/playoff_formats.json`
  (the one place they live), in config order. Champion detection skips every format's `nonConferences`.
- **asOf**: today's date (US Eastern). If a rebuild changes nothing but the date, the existing
  `asOf` is kept, so scheduled runs do not create empty commits. Same inputs give byte-identical
  output.

`run.py` calls `validate.validate_week()` (with the season's previous week file, if any) before
writing and refuses to write an invalid file.

## validate.py checks

Schema version; every field present with the right type and no unknown fields; `fbsCount ==
len(teams)`; every game's `opp` resolves (`teams` when `oppFbs`, else `opponents`); every
FBS-vs-FBS game is mirrored in the opponent's log (same week and date, swapped score, home/away
swapped or both neutral, same conference flag); records and conference records equal the game
logs; ranks are ints in 1..fbsCount, never null (committee may be null); values are finite
numbers (NaN/Infinity are rejected, also as literals in the file, because they are not JSON);
`sources.ratings.throughWeek` is null or equals `week`; no slug is both in `teams` and in
`opponents`; committee = 25 distinct
known slugs, each with a game log, matching `ranks.committee`; colors are `#rrggbb`; no duplicate
games; games chronological; label "After Week N"; week/asOf/hasCommittee match `index.json`; the
house-rule strings (see SPEC.md rule 1) never appear. `--all` also checks that `index.json` and
the week files on disk list the same weeks.

Rankings: each FEI rank column (`fei`, `off`, `def`, `sor`, `sos`) is a standard competition
ranking of all FBS teams (the best is 1, ties share a rank and the next rank skips: 1, 2, 2, 4;
ELS really has a nine-way tie at #129), and ordered by rank its value (`fei`, `ofei`, `dfei`,
`gwd`, `els`) never increases, with tied teams sharing a value. The FEI parser checks the same
order on the table it reads (also for a pasted CSV), so a one-cell typo stops the run with the
two rows named.

Conferences: every team's conference is in the season's list in `pipeline/conferences.json` (a
CFBD rename or a typo would otherwise create a one-team "conference", crown it and change the
bracket); a game marked `conf` is between two FBS teams of the same conference, and
`FBS Independents` (any format's `nonConferences`) have no conference games.

Dates: no game is after `asOf`; no team has two games against the same opponent in one week or
fewer than 6 days apart (a rescheduled game listed twice; a Saturday finale and a Friday title-game
rematch are 6 days apart); the committee release is on or after the season's first scheduled
release (`committee_schedule.json`) and at most 7 days older than the newest game in the file (a
Monday build keeps the previous Tuesday's release; anything older is stale).

Previous week (same season, when a file exists): the same FBS teams, each in the same conference,
and the same classification for non-FBS opponents, because none of these change mid-season. If
this fires, one of the two files is wrong; fix that one (by hand for an old week if needed).

Remaining schedules: optional; when present, each entry has exactly week/date/opp/oppFbs/site/conf,
a week after the file's week, a resolvable opponent, chronological order, no repeat opponent in a
week, conference games only within a conference, and every FBS-vs-FBS game mirrored in the
opponent's list.

Playoff formats (schemaVersion 2): a non-empty list; every field present (id, label, status,
default, note, sourceName, sourceUrl, checkedOn, size, byes, seeding, autoBids, powerConferences,
nonConferences); exactly one `default: true`; unique ids (lowercase, hyphens); status is `current` or
`proposed`; `note` is one sentence ending in a period; `sourceUrl` is https and never on the excluded
network's domain; `checkedOn` is a date; `byes == nextPow2(size) - size` (12 -> 4, 24 -> 8);
seeding `straight`; each auto-bid rule has `from` in all/power/nonPower (no pool twice) and a
positive `count`, a `power` count no larger than the number of power conferences, and power/nonPower
rules need `powerConferences`; rule counts + guaranteed teams fit in `size`; guaranteed slugs are
FBS teams in the file with a threshold in 1..size; every power conference is the conference of some
team in the file and is not also a non-conference.

## CSV fallback (when bcftoys.com cannot be fetched)

If the fetch fails or returns something that is not the ratings table, `run.py` uses
`pipeline/manual/{season}-fei.csv` when that file exists, otherwise it stops and asks for one.
To make it:

1. Open `https://bcftoys.com/2026-fei` in a browser.
2. Select from the title line "2026 FEI Ratings (through Week N)" down to the last team in the
   table, and copy.
3. Paste into a plain-text file, e.g. `pipeline/manual/2026-fei.csv`. The raw paste is fine:
   tab-separated cells, the group-title row and empty spacer cells are ignored. (Or start from
   `pipeline/fei_template.csv` and enter rows as CSV with that header.) Values are matched to
   columns by the header row (`Rk, Team, ..., OFEI, Rk, DFEI, Rk, ...` as on the page, or the
   template's `OFEI_Rk` names), never by position, so the header must come before the first data
   row and name every column; the run fails otherwise.
4. Check the file contains the "through Week N" line (it does if you copied the title; in the
   template, replace `N`). Without it, pass `--week N`; FEI's records must then match the CFBD
   games through week N.
5. Run `python3 pipeline/run.py --season 2026 --fei-csv pipeline/manual/2026-fei.csv`.
   The same validation applies, including the 138-team join and the record cross-check.

On GitHub Actions: commit the file and start the "Weekly data" workflow by hand with
`fei_csv: pipeline/manual/2026-fei.csv`. Refresh or delete the file the next week. `run.py`
refuses to build a week older than the newest one in `index.json` unless `--week` is given,
so a stale paste cannot quietly overwrite newer data. (With `--week N` it rebuilds week N, and
only from a table through week N.)

## Names, aliases and slugs

- `pipeline/aliases.json` maps source spellings to the CFBD school name: `fei` for bcftoys pages
  (e.g. "Appalachian State" -> "App State", "Hawaii" -> "Hawai'i"), `cfp` for
  collegefootballplayoff.com ("Southern California" -> "USC"; `fei` entries also apply there).
  Any name that does not match is a hard failure that lists the names. Fix it by checking the
  team by hand and adding one entry; never add speculative aliases.
- `pipeline/slugs.json` pins one slug per CFBD team id (FBS teams and non-FBS opponents). New ids
  get a generated slug (ascii-fold, lowercase, drop `&` and apostrophes, other characters -> `-`)
  and are appended; an existing slug is never changed, because URLs and share codes depend on it.
  A collision gets `-{id}` appended (then `-{id}-2`, ... if that is taken too). Commit
  `slugs.json` whenever it changes.

## Other config

- `pipeline/playoff_formats.json`: playoff formats per season, `{"2026": [format, ...]}` (fields as
  `PlayoffFormat` in `src/lib/types.ts`). 2026: `12-team` (current, default: five highest-ranked
  champions + Notre Dame if top 12, 4 byes; source collegefootballplayoff.com) and `24-team` (proposed
  for 2027, not final: the four power-conference champions + the best other champion, 19 at-large,
  8 byes; source Deseret News, Oct 15 2026). Changing a format or adding one is a config edit plus a
  pipeline re-run (`python3 pipeline/run.py --season 2026 --use-cache --as-of <the week's asOf>` keeps
  a week's data and date). Tests use `pipeline/tests/fixtures/playoff_formats_mini.json` because the
  six-team fixture has only one power conference.
- `pipeline/conferences.json`: the season's FBS conference names exactly as CFBD spells them.
  Add the new season's list each August after checking realignment; the validator refuses any
  other conference name, and the first week of a season has no previous week to compare with, so
  check that file's conferences by hand.
- `pipeline/committee_schedule.json`: the season's published committee release dates. CFBD does
  not give a release date, so when the CFP page cannot be read the n-th CFBD committee poll is
  dated with the n-th scheduled release, after checking it falls inside that CFBD week. Dates
  read from the CFP page always win.

## GitHub Actions

`.github/workflows/weekly-data.yml` runs Monday 14:00 UTC and Wednesday 06:00 UTC (after the
Tuesday-night committee release), August to December, and on demand. There is no January
schedule: the last committee release is the Sunday after championship weekend and Fremeau's final
page has no "through Week N" (a run then exits 0, "season complete"). It runs the pipeline tests,
`run.py`, `validate.py --all`, then the site's unit tests and build against the new data
(`npm ci && npm test && npm run build`), and commits `data/` (and `pipeline/slugs.json`) to
`main` as `github-actions[bot]` only when something changed and all of that passed. The push
triggers the Cloudflare Pages build. Set the repository secret `CFBD_API_KEY`.

If bcftoys.com blocks GitHub's runners, run the pipeline locally and commit the result, or use
the CSV fallback above. collegefootballplayoff.com has answered automated requests with HTTP
403 (bot protection) from some networks, and with the rankings page from others; when it is
blocked the pipeline logs a warning and uses CFBD dated by the schedule file, with the bcftoys
advisory check. Do not try to get around the block. GitHub's runners start with no cache, so
there the `week` input is only useful together with `fei_csv`.

## Raw cache

Every successful response is saved under `pipeline/.cache/{season}/` (gitignored). Use
`--use-cache` to rebuild from it without the network, e.g. to check that output is identical.
The FEI page is also saved per week as `bcftoys-fei-w{N}.html`, because bcftoys.com overwrites
the table every week: `--use-cache --week N --as-of <that file's asOf>` rebuilds an archived
week N exactly, as long as that copy exists on the machine. Without it (or a `--fei-csv` of week
N's table) an older week cannot be rebuilt, and `run.py` refuses rather than pairing week N's
games with a later week's ratings.

## History

bcftoys.com has no per-week archive of the full ratings table. `/{season}-wfei` gives weekly
FEI/OFEI/DFEI/SFEI values and ranks per team, but not ELS or GWD (schedule and record strength),
so earlier weeks cannot be rebuilt with every field and are not backfilled. Keep every week
file from now on; team pages build rank history from them.

## Tests

```sh
python3 -m unittest discover -s pipeline/tests -p "test_*.py"    # or: python3 -m pytest pipeline/tests
```

Fixtures in `pipeline/tests/fixtures/`: `fei_trimmed.html` and `bcftoys_cfp_trimmed.html` are
trimmed copies of the live bcftoys pages; `mini/` is a synthetic six-team season in the same
formats (FEI page, CFBD teams/games/calendar/rankings) used for the build, validator and
end-to-end tests; `fei_mini.csv` and `fei_mini_paste.txt` are the same table as CSV and as a
browser paste; `cfp_rankings_synthetic.html` imitates the CFP rankings text (the parser has since
read the real page correctly on a live run, but no copy is saved here);
`cfbd_2026_calendar.json` is the real CFBD 2026 calendar and `cfbd_2026_game_days.json` the
real 2026 regular-season game dates (week, seasonType and startDate only, one entry per distinct
value), both fetched 2026-11-05, used to test which committee release each week gets.
