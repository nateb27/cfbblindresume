# cfbblindresume visual language: DOSSIER

Binding for every surface: content pages (Astro), the game island (React), OG and share images,
icons. Tokens live in `src/styles/tokens.css` (CSS) and `src/styles/tokens.ts` (the same values for
code that cannot read CSS). Shared component classes live in `src/styles/global.css`, game-only
components in `src/styles/game.css`. Do not invent colours, fonts, radii or durations outside these
files; if you need one, add a token there (and to the contrast test). SPEC.md owns flows, copy and
data rules; this file owns how they look.

## 1. Identity

**A redacted committee file.** The site is the selection committee's printed packet, handed to the
fan with the names blacked out: paper sheets on a grey board, ink type, ruled form fields, toner
bar charts. One violet stamp-pad ink marks everything the fan does (picks, their own numbers, the
playoff field they asked to see, their next action, focus). One marker bar marks everything they
are not allowed to know yet. Everything else stays quiet and exact, so the declassification (the
bars lift off the names and the team colours arrive) is the one loud moment. Colour is the reward:
during a round the file is black and white plus your violet marks. Light paper by default on every
page; dark mode is a photostat negative, where the redactions print white. One grotesque (Archivo),
sentence case everywhere, borders-only depth, 2-6px corners, no logos, no stars, no gradients, no
glow, no shadows.

What it rejects (the competitor's look and the generic defaults):

| Default | Instead |
| --- | --- |
| Near-black stage + one loud accent | Paper file by default; dark = photostat negative, by the OS |
| Red accent, red stamps | Violet stamp ink means you; red only ever means L |
| Condensed ALL-CAPS labels, tracked eyebrows | One grotesque, sentence case; labels are small semibold form-field labels |
| Gold 5-star opponent ratings | Five square pips inked in toner; empty pips are blank form boxes |
| Coloured tier ramp | Monochrome toner ramp: more ink = better opponent |
| Filled red/green W/L chip on every row | Wins print quiet (green W, no fill); losses are flagged (red wash) |
| Dark rounded cards with glow | Sheets on a board, ink rules, 4px corners, no shadows |
| "?" plate on Team A | Ink file-letter plate + a redaction bar where the name prints |
| Team colour slabs everywhere | Covers for the big moments (reveal, team hero, compare); index tabs for lists |
| Underline tabs | Folder tabs |
| Accenting a word in a headline | The one treated phrase ("Names hidden.") is redacted because it says what it does |

## 2. Five rules

1. **Violet means you.** `accent` (violet stamp ink) marks only the fan's own marks: picks (1st /
   2nd stamps, picked cards, rank buttons, the 1st/2nd file letters), the fan's own numbers
   (headline and agreement counts, reveal values that match their pick, the "12 of 15" match count
   on the done panel and the FEI count beside it, the running counts in the reveal; in a shared view
   these are the sharer's numbers, so they print in ink), the you-are-here progress tick, the
   primary action and focus. **Selection chrome is ink, not violet**: the open folder tab, the
   chosen segment, a checked box, the current nav item, the current archive week, and the playoff
   field ("Show playoff field" draws the field's dashed cut line in ink on every tab, the committee's
   and a stranger's included). Never use violet for data about teams, for links, for kickers or for
   decoration.
2. **More ink means a better opponent.** Opponent tiers (pips, season ticks) and rank bars use one
   8-step monochrome toner ramp (`tier-50` darkest on paper = FEI 1-5 ... `tier-05` lightest = FCS).
   The pip **count** and the **band text** ("FEI 11-25") carry the tier on every row; the grey steps
   reinforce, they are never the only cue.
3. **Green and red only mean W and L** (and up/down rank deltas), always with the letter or a
   drawn triangle. Wins print quiet (green letter, ink margin, no fill); losses are flagged (red
   letter and margin on `loss-tint`), because fans scan a resume for its losses.
4. **Teams are covers or index tabs.** A cover is the team's primary in full with the name in
   `teamInk` and the secondary rule: only the reveal, the team-page hero and compare cards. An index
   tab is the rank on a small team-colour tab (primary + secondary rule) with the name typed in ink
   on paper: every list (results, bracket, home lists). Inline mentions use `.team-chip` (a 10x18
   tab). Name + colours only. No logos, ever.
5. **Numbers are Archivo 800, tabular.** Ranks, records, margins, seeds, stats. Labels are Archivo
   600, meta 400. `body` sets tabular figures; `proportional-nums` opts out.

## 3. World

Domain: the committee's printed data packet; redacted case files (marker bars, declassification);
ballots ("rank these three"); file folders with index tabs; office forms (ruled boxes, a small field
label, the value typed in); violet stamp pads; photostat negatives; the dashed "cut here" line.

Colour world: copy paper `#fdfdfa`, cool grey folder board `#e8e8e3` (not cream, not manila),
toner/ink `#18191d`, redaction marker `#121317`, violet stamp ink `#4b2c92`, green ink `#17683a`,
red correction pencil `#a3262b`, form-field shading `#f1f1ec`, photostat negative `#161615` /
`#ecebe4`. Team colours appear only on declassified things.

## 4. Wiring

```astro
---
// BaseLayout.astro
import '../styles/global.css';
import archivo400 from '../assets/fonts/archivo-latin-400-normal.woff2?url'; // same hashed files as the CSS url()
import archivo600 from '../assets/fonts/archivo-latin-600-normal.woff2?url';
import archivo800 from '../assets/fonts/archivo-latin-800-normal.woff2?url';
---
<html lang="en" data-surface={game ? 'board' : undefined}>
<head>
  {[archivo400, archivo600, archivo800].map((href) => <link rel="preload" href={href} as="font" type="font/woff2" crossorigin />)}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content={game ? '#e8e8e3' : '#fdfdfa'} media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#161615" media="(prefers-color-scheme: dark)" />
  <meta name="color-scheme" content="light dark" />
```

- **Every page follows `prefers-color-scheme`.** Light (paper) is the default; dark = photostat.
  There is no forced theme and no `data-theme` attribute.
- **Two light surfaces.** Content pages are the sheet itself (`light-sheet`). Game pages (`/` and
  `/r/*`) are white sheets on a grey board (`light-board`): `<html data-surface="board">` and the
  island root `<section class="game-root" data-surface="board">` select it. Dark is one set for both.
- **tokens.css structure.** World tokens (`--board`, `--sheet`, `--ink`, `--stamp`, `--redaction`,
  `--toner-50` ...) are plain custom properties in three blocks: `:root` (light-sheet),
  `[data-surface="board"]` (light-board) and `@media (prefers-color-scheme: dark)` on
  `:root, [data-surface="board"]` (dark). The `@theme static` block maps every system token onto
  them (`--color-page: var(--board)` ...), so the utilities (`bg-page`, `text-fg-muted`,
  `border-line-strong`, `bg-tier-45` ...) follow the scheme with no markup change. The mapping is
  declared again on `[data-surface="board"]` (a custom property resolves where it is declared).
  Each world block sits between `@tokens <set>` and `@end` comments that the test parses.
- `:root { color-scheme: light }`, dark media `color-scheme: dark`; the reveal dialog inherits.
- **Fonts**: three Archivo woff2 files, all preloaded; metric-matched fallbacks (section 7).
- **tokens.ts** exports `colors.light` (sheet), `colors.board`, `colors.dark` (every key of section
  5, values equal to tokens.css), `tierKey(stars)`, `tierColor(stars, theme = 'light')`,
  `TIER_TICK_PX`, `contrast()`, `luminance()`, `teamInk()`, `teamRule()`, `teamVars(colors)` (style
  object for `.team-block` / `.team-chip`), `teamPaint(colors)` (hex for raster renderers:
  `{ bg, ink, rule, edge, redact }`), `fonts` (`family: 'Archivo'`, `ttf: { 400, 600, 800 }`),
  `motion`, `og`. React: `style={teamVars(team.colors) as React.CSSProperties}`. Astro:
  `style={teamVars(team.colors)}`.
- Never re-implement tiers or ranks: tier = `tierFor()` from `@lib/tiers`, bar fill =
  `rankFill(rank, week.fbsCount)`, bar colour = `tierKey(tierFor({ fbs: true, feiRank: rank }).stars)`.
- Tests: `tests/design-tokens.test.ts` (CSS/TS parity for all three sets, every pair of section 6
  at its minimum, toner ramp grey and monotonic, tick heights), `tests/team-redact.test.ts` (every
  FBS team of every committed week: reveal bar >= 3:1 on the primary, edge when the primary vanishes
  into the page).
- Tailwind's default palette still compiles; do not use it (`bg-gray-800`, `text-red-500` ...).
  Only the token utilities.

## 5. Colour tokens

Utilities: `bg-*`, `text-*`, `border-*`, `ring-*`, `outline-*`, `fill-*`, `stroke-*` with the
system names below.

| World token | System token (utility) | light-sheet (content) | light-board (game) | dark (photostat) | Role |
| --- | --- | --- | --- | --- | --- |
| `--board` | `page` | `#fdfdfa` | `#e8e8e3` | `#161615` | page; on game pages the desk under the sheets |
| `--sheet` | `surface` | `#f4f4ef` | `#fdfdfa` | `#1f1f1d` | cards, panels, reveal, footer bar, index-tab labels, callout |
| `--field` | `raised` | `#ecece6` | `#f1f1ec` | `#282826` | form-field shading: quality wins, reveal cells, bracket slots, segmented field, hover |
| `--field-2` | `raised-2` | `#e2e2db` | `#e6e6e0` | `#32322f` | pressed, quiet fills |
| `--rule` | `line` | `#d9d9d1` | `#dadad3` | `#34342f` | hairline rules (decorative) |
| `--rule-strong` | `line-strong` | `#b2b3aa` | `#b4b5ad` | `#4c4c46` | card/panel/table frames, index-tab outline, empty pip boxes, upcoming progress ticks, season baseline |
| `--edge` | `control` | `#74756d` | `#74756d` | `#8a8a82` | control boundaries (>= 3:1): checkbox, secondary button, segmented frame, 3rd stamp |
| `--track` | `track` | `#e2e2db` | `#e3e3dd` | `#33332f` | empty part of rank bars |
| `--ink` | `fg` | `#18191d` | `#18191d` | `#ecebe4` | type; ink plates; 2px header rule; table head rule; cut line; selection chrome; team-block focus |
| `--carbon` | `fg-muted` | `#50524b` | `#50524b` | `#aeada4` | labels, secondary text |
| `--graphite` | `fg-faint` | `#5f615a` | `#5d5f58` | `#9d9c93` | meta, captions, disabled |
| `--stamp` | `accent`, `focus` | `#4b2c92` | `#4b2c92` | `#b9a7f1` | you, as text/icon; focus ring |
| `--stamp-fill` | `accent-fill` | `#4b2c92` | `#4b2c92` | `#b9a7f1` | you, as a fill: primary button, 1st plate/stamp, you-are-here tick |
| `--on-stamp` | `on-accent` | `#fdfdfa` | `#fdfdfa` | `#161615` | text on violet fill |
| `--stamp-wash` | `accent-tint` | `#e9e3f5` | `#ebe5f6` | `#2d2742` | 2nd-pick plate (letter, rank button, the reveal's You 2nd), "Matches ..." chip |
| `--stamp-edge` | `accent-edge` | `#5a3aa3` | `#5a3aa3` | `#b9a7f1` | your rules: 2nd stamp, match stamp and your 3rd in the reveal, picked rank button, rank-button border |
| `--redaction` | `redaction` | `#121317` | `#121317` | `#e6e3d8` | THE bar (blind header, reveal, demo slabs, pitch, wordmark, hero phrase) |
| `--on-redaction` | `on-redaction` | `#fdfdfa` | `#fdfdfa` | `#161615` | type reversed out of a bar |
| `--won` / `--won-wash` | `win` / `win-tint` | `#17683a` / `#e0eee3` | `#17683a` / `#e2efe5` | `#78d39c` / `#1d3326` | W letter, up deltas / W wash (unused by chips) |
| `--lost` / `--lost-wash` | `loss` / `loss-tint` | `#a3262b` / `#f6e0dd` | `#a3262b` / `#f7e2df` | `#f3968c` / `#3f2523` | L letter + margin / the flagged L chip |
| `--toner-50` | `tier-50` | `#25262b` | `#25262b` | `#f3f2ec` | FEI 1-5 |
| `--toner-45` | `tier-45` | `#34363a` | `#34363a` | `#dad9d2` | FEI 6-10 |
| `--toner-40` | `tier-40` | `#43454a` | `#43454a` | `#c3c2bb` | FEI 11-25 |
| `--toner-30` | `tier-30` | `#505257` | `#505257` | `#acaba4` | FEI 26-50 |
| `--toner-20` | `tier-20` | `#5c5e63` | `#5f6166` | `#9a9991` | FEI 51-75 |
| `--toner-15` | `tier-15` | `#66686c` | `#686a6e` | `#8e8d86` | FEI 76-100 |
| `--toner-10` | `tier-10` | `#6f7175` | `#707276` | `#8a8982` | FEI 101+ |
| `--toner-05` | `tier-05` | `#76787c` | `#77797d` | `#82817b` | FCS / non-FBS |
| `--selection` / `--on-selection` | `selection` / `on-selection` | `#d9cdf3` / `#18191d` | same | `#4a3d78` / `#ecebe4` | `::selection` |
| (none) | `scrim` | `rgb(24 25 29 / 0.5)` | same | `rgb(0 0 0 / 0.62)` | modal backdrop |
| (none) | `ink` / `paper` | `#0e0f12` / `#ffffff` | same | same | constant inks: team names on team colours (`teamInk`) only |

The toner top step is deliberately lighter than `--redaction`, so the bar stays the blackest mark.

## 6. Measured contrast

Enforced by `tests/design-tokens.test.ts`: **3 token sets x 81 pairs, 0 failing, no exceptions**.
Text >= 4.5:1; graphics, control boundaries and focus >= 3:1.

| Pair | Min | light-sheet | light-board | dark | Use |
| --- | --- | --- | --- | --- | --- |
| `fg` on `page` / `surface` / `raised` | 4.5 | 17.24 / 15.92 / 14.81 | 14.29 / 17.24 / 15.50 | 15.15 / 13.81 / 12.36 | text, values, names on paper |
| `fg` on `raised-2` / `accent-tint` / `win-tint` / `loss-tint` | 4.5 | 13.50 / 14.03 / 14.64 / 13.90 | 14.02 / 14.28 / 14.81 / 14.13 | 10.76 / 11.87 / 11.31 / 11.71 | text on fills |
| `fg-muted` on `page` / `surface` / `raised` / `raised-2` | 4.5 | 7.78 / 7.18 / 6.68 / 6.09 | 6.45 / 7.78 / 6.99 / 6.33 | 8.03 / 7.32 / 6.55 / 5.70 | labels |
| `fg-faint` on `page` / `surface` / `raised` | 4.5 | 6.16 / 5.69 / 5.30 | 5.27 / 6.35 / 5.71 | 6.56 / 5.98 / 5.35 | meta |
| `accent` on `page` / `surface` / `raised` / `accent-tint` | 4.5 | 9.93 / 9.17 / 8.54 / 8.08 | 8.23 / 9.93 / 8.93 / 8.23 | 8.50 / 7.75 / 6.94 / 6.66 | your marks as text |
| `on-accent` on `accent-fill` | 4.5 | 9.93 | 9.93 | 8.50 | text on violet |
| `win` on `page` / `surface` / `raised` / `win-tint` | 4.5 | 6.70 / 6.18 / 5.75 / 5.69 | 5.55 / 6.70 / 6.02 / 5.75 | 10.00 / 9.12 / 8.16 / 7.46 | W |
| `loss` on `page` / `surface` / `raised` / `loss-tint` | 4.5 | 7.18 / 6.63 / 6.17 / 5.79 | 5.95 / 7.18 / 6.46 / 5.89 | 8.24 / 7.51 / 6.72 / 6.37 | L |
| `on-redaction` on `redaction` | 4.5 | 18.22 | 18.22 | 14.09 | wordmark, hero phrase |
| `surface` on `fg` / `page` on `fg` | 4.5 | 15.92 / 17.24 | 17.24 / 14.29 | 13.81 / 15.15 | file letters, H2H tag |
| `on-selection` on `selection` | 4.5 | 11.69 | 11.69 | 7.88 | selection |
| `control` on `page` / `surface` / `raised` | 3 | 4.57 / 4.22 / 3.93 | 3.79 / 4.57 / 4.11 | 5.21 / 4.75 / 4.25 | control boundaries |
| `focus` on `page` / `surface` / `raised` | 3 | 9.93 / 9.17 / 8.54 | 8.23 / 9.93 / 8.93 | 8.50 / 7.75 / 6.94 | focus ring |
| `fg` (graphic) on `page` / `surface` / `raised` | 3 | 17.24 / 15.92 / 14.81 | 14.29 / 17.24 / 15.50 | 15.15 / 13.81 / 12.36 | plates, rules, selection chrome, team focus |
| `accent-edge` on `page` / `surface` / `raised` | 3 | 8.02 / 7.41 / 6.89 | 6.65 / 8.02 / 7.21 | 8.50 / 7.75 / 6.94 | stamps, rank border |
| `accent-fill` on `page` / `surface` / `raised` | 3 | 9.93 / 9.17 / 8.54 | 8.23 / 9.93 / 8.93 | 8.50 / 7.75 / 6.94 | primary button, 1st plate, you-are-here |
| `redaction` on `page` / `surface` / `raised` | 3 | 18.22 / 16.83 / 15.65 | 15.10 / 18.22 / 16.38 | 14.09 / 12.85 / 11.50 | the bar |
| `tier-50` on `page` / `surface` / `raised` / `track` | 3 | 14.82 / 13.69 / 12.73 / 11.60 | 12.28 / 14.82 / 13.33 / 11.72 | 16.14 / 14.72 / 13.17 / 11.31 | pips, ticks, bars |
| `tier-45` | 3 | 11.88 / 10.97 / 10.21 / 9.30 | 9.85 / 11.88 / 10.68 / 9.39 | 12.79 / 11.66 / 10.44 / 8.96 | |
| `tier-40` | 3 | 9.41 / 8.70 / 8.09 / 7.37 | 7.80 / 9.41 / 8.47 / 7.45 | 10.14 / 9.24 / 8.27 / 7.10 | |
| `tier-30` | 3 | 7.67 / 7.09 / 6.59 / 6.01 | 6.36 / 7.67 / 6.90 / 6.07 | 7.86 / 7.17 / 6.41 / 5.51 | |
| `tier-20` | 3 | 6.37 / 5.88 / 5.47 / 4.99 | 5.04 / 6.08 / 5.47 / 4.81 | 6.33 / 5.77 / 5.16 / 4.43 | |
| `tier-15` | 3 | 5.48 / 5.06 / 4.71 / 4.29 | 4.41 / 5.32 / 4.78 / 4.21 | 5.44 / 4.96 / 4.43 / 3.81 | |
| `tier-10` | 3 | 4.80 / 4.43 / 4.12 / 3.76 | 3.92 / 4.73 / 4.25 / 3.74 | 5.16 / 4.70 / 4.21 / 3.61 | |
| `tier-05` | 3 | 4.34 / 4.01 / 3.73 / 3.40 | 3.55 / 4.28 / 3.85 / 3.38 | 4.64 / 4.23 / 3.78 / 3.25 | |
| team name on its colour (`teamInk`) | 4.5 | >= 4.58 for any colour (swept in the test) | same | same | covers, seed plates |

Not contrast-bearing by design (decorative, never the only cue): `line` hairlines; `line-strong`
empty pip outlines (the count is carried by the filled pips and the band text), upcoming progress
ticks (the text "Round 3 of 15" carries it), frames; `raised` shading.

Team colours: the reveal bar on a primary is `--team-redact-*` = `var(--redaction)` when that is
>= 3:1 on the primary, else `teamInk(primary)` (>= 4.5:1). A primary within 1.5:1 of a page or
sheet it can sit on gets a 1px edge (`--team-edge-light: rgb(24 25 29 / .34)` against `#fdfdfa` /
`#e8e8e3`; `--team-edge-dark: rgb(236 235 228 / .42)` against `#161615` / `#1f1f1d`) that frames the
plate or cover with its rule. The rule itself is per scheme (`--team-rule-light` / `-dark`,
`ruleOn()`): the secondary, unless it blends into that scheme's pages, sheets or fields
(`ruleBlends`: within 1.5:1 and without a hue to tell it apart: a white rule on paper, a black or
navy one on the photostat); then a shade of the primary (darker on paper, lighter on the photostat)
that clears 1.5:1 against the primary and every surface, else the primary itself (no rule). So no
plate looks 4px short of its row and none gets a stray frame. OG images and the share PNG use the
light rule (`teamPaint().rule`). Swept for every FBS team in `tests/team-redact.test.ts`.

## 7. Type

**Archivo** (Omnibus-Type / The Archivo Project Authors, SIL OFL 1.1). One family, static weights
400 / 600 / 800: a grotesque made for print and screen, slightly narrow, with heavy weights that
read like filled-in form values. No condensed face, no mono, no second family.

| File (`src/assets/fonts/`) | Bytes | Use |
| --- | --- | --- |
| `archivo-latin-400-normal.woff2` | 14,700 | body, meta, title-sub |
| `archivo-latin-600-normal.woff2` | 13,820 | labels, tabs, table heads, team chips, secondary buttons |
| `archivo-latin-800-normal.woff2` | 14,416 | numerals, records, ranks, headings, team names, primary buttons |
| `Archivo-{400,600,800}.ttf` + `Archivo-OFL.txt` | ~120k each | build-time images only (OG, glyph atlas); never shipped |

- The woff2 files are the `@fontsource/archivo@5.3.0` latin files; the TTFs are the matching static
  instances (`@expo-google-fonts/archivo@0.4.2`: same unitsPerEm 1000, hhea 878 / -210 / 0,
  identical advance widths). All three woff2 are preloaded (42,936 bytes on the critical path).
- `font-weight: 700` (`font-bold`) resolves to the 800 file: no 700 face is declared.
- Metric-matched fallbacks in global.css, one per weight band (`Archivo Fallback` over Arial /
  Liberation Sans: 100-500 size-adjust 98.5%, 600 96%, 700-900 103.7%, with ascent/descent
  overrides), so the swap moves nothing (CLS 0).

Type scale (ratio 1.25 from 16; hierarchy by weight and colour first). Utility = `text-<role>`.

| Role | Size / line-height | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `label` (and `label-caps`) | 13 / 16 | 600 | 0 | field labels, column heads, kickers, tags |
| `label-lg` | 15 / 20 | 600 | 0 | tabs, secondary buttons, table team names |
| `team` | 16 / 18 | 800 | -0.005em | team names on tiles / slots |
| `stat` | 22 / 24 | 800 | -0.01em | card ranks "#18" |
| `heading` | 25 / 28 | 800 | -0.015em | h2, panel titles, reveal names, pitch question |
| `title` | 31 / 34 | 800 | -0.02em | h1 phones, results title phones |
| `stat-lg` | 36 / 40 | 800 | -0.02em | content stat-row numerals |
| `record` | 38 / 38 | 800 | -0.025em | blind-card record |
| `display` | 52 / 54 | 800 | -0.03em | h1 desktop, team hero max |
| `hero` | 88 / 88 | 800 | -0.04em | the done panel's match count ("12" of 15) |
| body | 16 / 24, 15 / 24, 14 / 20, 13 / 20 | 400 | 0 | copy, meta (`text-fg-faint` 13px) |

- **Sentence case everywhere.** No `uppercase` class, no `tracking-*` class (`rg -n
  "uppercase|tracking-\[" src` returns nothing). Acronyms in the copy (SoR, FEI, CFP, H2H, AQ, NR)
  stay as written.
- `label-caps` (the historical name) is the form-field label: 13/16 600, no caps, no tracking.
  `cond` only keeps tabular figures (the family is Archivo everywhere); `font-condensed` is an
  alias of `font-sans`. New code uses neither.
- Minimum text 12px (tags, quality-win labels; the phone footer's 11px record digits are a
  non-essential duplicate of the card's record inside a 40px tap target).
- Headings get `text-wrap: balance`, paragraphs `text-wrap: pretty` (global).
- A heading is one colour. A second line is `.title-sub` (block, same ink, weight 400, -0.015em).
  No muted or accented words inside headings; the redacted "Names hidden." is the only single-phrase
  treatment on the site.
- Wordmark `.wordmark`: Archivo 800 18px/1, -0.015em: `CFB <span class="wm-redacted">Blind</span> Resume`.
- The font has no arrows or stars: deltas use `.delta` (drawn triangle), minus is U+2212 (`−`), the
  separator is ` · `.

## 8. Space, radius, depth, motion

- Base unit 4px (`p-1` = 4px). Gutter `px-gutter` (16px) on phones, `lg:px-gutter-lg` (32px).
  Containers: `max-w-read` 672px prose, `max-w-page` 1216px content, `max-w-game` 1216px game (the
  same as page, so the home hero, game panel, "This week" and header share one left edge).
- Radius: `rounded-slab` 2px (team plates, bars, stamps, tags), `rounded-chip` 3px (buttons, chips,
  inputs, bracket boxes), `rounded-card` 4px (cards, table frames, segmented), `rounded-panel` 6px
  (reveal, intro, done, error panels). Folder tabs 5px on top.
- **Depth is borders only.** There are no shadow tokens and no `shadow-card/panel/footer` classes.
  Inset 1-2px `shadow-[inset_…]` rules that act as borders (match chips, rank-history current week)
  are fine; drop shadows and glows are not.
- Motion (all < 300ms; zeroed under `prefers-reduced-motion` by global.css): `--duration-instant`
  90ms (press), `--duration-fast` 140ms (hover, toggles), `--duration-base` 200ms (pick, panel fade,
  tab change), `--duration-slow` 280ms (bar fill, modal enter). Easing `ease-out` (default),
  `ease-snap` (pick press). Animations: `animate-rise` (8px up + fade), `animate-fade`,
  `meter[data-animate]` (bar fill), `stamp-in` (pick stamps press in, 1.18 -> 1, 140ms
  `ease-snap`, upright). The reveal's declassify sequence is a storyboard in
  `src/game/Reveal.tsx` (`TIMING` / `PANEL` / `BAR`, handed to game.css as custom properties on the
  dialog and each row); `--declassify-duration` 240ms, `--declassify-start` 120ms and
  `--ease-declassify` `cubic-bezier(0.77, 0, 0.175, 1)` in tokens.css are only fallbacks. Section 9.
- Focus: `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px }` (violet,
  global). On team blocks a 3px `fg` outline, offset 3px (4px inside the island). Do not remove it.
- `html` sets `scrollbar-gutter: stable`. Never size with `100vw`.
- Touch targets: 44px minimum (`.btn`, `.switch` rows, `.tab`, jump-nav chips); segments 40px
  inside the control.

## 9. The signature: the redaction bar

| Where | How |
| --- | --- |
| Blind card header | An empty `<span data-redacted aria-hidden="true">` in `h3.card-header-title`: 22px tall, it fills the free grid column next to the record, min 48px. **Its width comes from the card, never from the hidden name**: no name, slug, colour or conference reaches the DOM before lock-in (the e2e asserts "no team name in the island before lock-in"). The h3's accessible name stays "Team A, 6 wins 2 losses". |
| Reveal ("Your order, revealed") | The same ink file letter and record stay put; the name (now in the DOM) shrink-wraps its text and `.team-name::after` covers it (`inset: 18% -0.25rem 18% 0.375rem`, marker-swipe clip-path, colour `--team-redact`). It **lifts**: `transform: scaleX(1 -> 0)`, `transform-origin: right`, 240ms `--ease-declassify`, delays 120 / 200 / 280ms (the sheet's 120ms fade is done before the first lift): all three declassified by **520ms** (the numbers live in `Reveal.tsx`
`TIMING` / `PANEL` / `BAR`; the panel itself lands with `reveal-in`, 8px rise + fade over 120ms). Transform and opacity only; `pointer-events: none` (Next round, Esc, Enter work throughout); screen readers get the names at once (the bar is a pseudo-element). The cover colour shows for the first time. Tests and the share capture wait for idle animations (`document.getAnimations()`; `scripts/e2e-game.mjs` `animationsDone()`). |
| Wordmark (header and footer, every page) | `CFB <span class="wm-redacted">Blind</span> Resume`: static markup, no script. `.wm-redacted`: `redaction` bg, `on-redaction` text, padding .06em .16em .08em, radius 1px. |
| Home hero | `Rank the resumes. <span class="hero-redacted">Names hidden.</span>`: reversed out of a bar because it says what it does (`box-decoration-break: clone`). The only single-phrase treatment on the site. |
| Intro demo slabs | Redacted names (14px bars, widths 82 / 64 / 47%) with 1st / 2nd / 3rd stamps. |
| Play pitch (team, compare, bubble pages) | A miniature redacted card header (section 19). |
| Dark mode | Photostat negative: bars and ink plates print paper-white (`--redaction: #e6e3d8`). |
| OG and share images | The wordmark with "Blind" reversed out of a bar on every image (section 22). |

Marker-swipe shape (every bar except the inline wordmark / hero spans and raster images):
`clip-path: polygon(0.8% 9%, 6% 2%, 97% 0, 100% 14%, 99.3% 91%, 94% 100%, 2% 97%, 0 82%)`.

## 10. Opponent-tier indicator

| Key (`data-tier`) | Stars value | Tier | Pips filled | Tick px | Toner light-sheet / board / dark |
| --- | --- | --- | --- | --- | --- |
| `50` | 5 | FEI 1-5 | 5 | 14 | `#25262b` / `#25262b` / `#f3f2ec` |
| `45` | 4.5 | FEI 6-10 | 4.5 | 12 | `#34363a` / `#34363a` / `#dad9d2` |
| `40` | 4 | FEI 11-25 | 4 | 10 | `#43454a` / `#43454a` / `#c3c2bb` |
| `30` | 3 | FEI 26-50 | 3 | 8 | `#505257` / `#505257` / `#acaba4` |
| `20` | 2 | FEI 51-75 | 2 | 6 | `#5c5e63` / `#5f6166` / `#9a9991` |
| `15` | 1.5 | FEI 76-100 | 1.5 | 5 | `#66686c` / `#686a6e` / `#8e8d86` |
| `10` | 1 | FEI 101+ | 1 | 4 | `#6f7175` / `#707276` / `#8a8982` |
| `05` | 0.5 | FCS / non-FBS | 0.5 | 3 | `#76787c` / `#77797d` / `#82817b` |

`data-tier` on any element sets `--tier` (toner), `--stars` and `--tier-tick`. Data stays `tierFor()`
/ `tierKey()`. Utilities `bg-tier-45`, `text-tier-45` ... always exist.

- **Pips** (`<span class="stars" data-tier="45" role="img" aria-label="4.5 of 5 pips, FEI 6-10">`):
  5 cells of 9px (8px in a `@container (max-width: 19rem)`), 10px tall. `::before` = five empty
  boxes (1px `line-strong` outline), `::after` = filled pips in toner up to `--stars`, so half tiers
  show a half-inked box. Filled vs empty is a **shape** difference, not only grey. The band text is
  on every row (blind card, game log, still to play, compare). Never use star glyphs.
- **Season ticks** (`<span class="tier-dot" data-tier="30">`): 8px wide, `height: var(--tier-tick)`,
  square, toner, `align-self: end`; `--tick-k` scales the height. In the blind card the season spans
  the card's width (`ol.season-ticks`, one equal grid column per game, `--tick-k: 1.7`, so 5-24px)
  and each tick sits in a `.tick-slot` (24px tall, items at the bottom, 1px `line-strong` bottom
  border) so the slots join into one baseline: a tiny printed bar chart, the W/L letter under it.
  `ResumeStrip.astro` is HTML (`.season-strip`, section 19): ticks 1.2x on phones, 2x (12px wide)
  from a 30rem strip. Legends and the how-it-works table use `.tier-tick-cell` (16x14 sample).
- **Rank bars** (`<div class="meter" data-tier="50" style="--fill:.985"><span></span></div>`): 5px
  tall, square ends, `track` + toner fill of the rank band (a #3 offense is near-black, #61 is mid
  grey), `rankFill`.
- **Quality wins**: no tier mark; the labels "Top 10" / "11-25" / "26-50" say it, and the heading
  names the scale.
- **How it works** copy: "Pips, tick heights and ink density all follow the same scale: the better
  the opponent, the more ink."

## 11. Team identity (`.team-block`, `.team-chip`, `teamVars`)

`teamVars(colors)` returns `--team-bg` (primary), `--team-ink` (`teamInk`), `--team-rule-light` /
`--team-rule-dark` (`teamRule`: the secondary, or the ink when the secondary is within 1.5:1 of the
primary, e.g. BYU; then redrawn per scheme by `ruleOn`, section 6), `--team-edge-light` /
`--team-edge-dark` and `--team-redact-light` / `--team-redact-dark` (section 6). CSS picks the
scheme (`--team-rule`, `--team-edge`, `--team-redact`).

Markup (`src/game/ui.tsx TeamBlock` and `src/components/TeamBlock.astro`): `data-variant="tab"` when
a seed plate is shown and the size is not `reveal`, else `"cover"`; `data-size` = size; the name
element has class `team-name`, the meta `team-meta`.

| Variant | Look | Used by |
| --- | --- | --- |
| **cover** | `team-bg` background, `team-ink` name 800 sentence case -0.01em, 4px `team-rule` bottom border, a 1px `team-edge` outline drawn inside the border box (it frames the rule too); hover `brightness(1.06)` | reveal (rule drawn as `inset 0 -4px 0`, ink file letter), team hero (6px rule, radius 4px 4px 0 0), compare cards, any block without a seed |
| **tab** | label: `surface` bg, `fg` text, no bottom border, inset 1px `line-strong`; `.seed-plate`: `team-bg` bg, `team-ink` numeral 800, inset 1px `team-edge` drawn over `inset 0 -4px 0 team-rule`; fixed plate width per size (40px, no padding) so two-digit seeds never shift the name; meta 600 `fg-muted`; hover label `raised` | results rows/tiles, next five, bracket slots (as fields), home "This week" lists |
| chip | `.team-chip::before` 10x18, radius 1px, `team-bg`, 3px `team-rule` bottom, 1px `team-edge` outline inside; name 15px 600 (14px in phone tables) | tables, prose, bid lists |

| Size | Height | Plate | Name | Use |
| --- | --- | --- | --- | --- |
| slot | `h-9` 36 | `min-w-8` 18px | 15px | bracket slots |
| row | `h-12` 48 | `min-w-10` 22px | 18px | phone results list, home lists |
| tile | `min-h-16` 64 | `min-w-9` 22px | `text-team` 16px, 2 lines max | results grid |
| reveal | `h-14` 56 (phones `h-12`) | `min-w-12` 28px | `text-heading` 25px (phones 20px) | reveal panel |
| hero | `min-h-[4.5rem] sm:min-h-24` | none | `.hero-name`, sized by `heroNameFit` | team page header |

```html
<a href="/teams/miami" class="team-block min-h-16 pr-3" data-variant="tab" data-size="tile" style="--team-bg:#f47321;--team-ink:#0e0f12;--team-rule:#005030;…">
  <span class="seed-plate min-w-9">1</span>
  <span class="team-name text-team line-clamp-2 min-w-0 flex-1 pl-2.5">Miami</span>
  <span class="team-meta ml-2 flex-none">8-0</span>   <!-- optional meta (record) -->
</a>
```

Every team name links to `/teams/{slug}` (block or chip). Text over a team colour is only the name
and the record in `--team-ink`; anything else (committee rank, deltas, tags) goes outside the block.

## 12. Component classes

global.css (`@layer components`, so a utility on the same element wins):

| Class | Markup / states |
| --- | --- |
| `[data-redacted]`, `.wordmark`, `.wm-redacted`, `.hero-redacted`, `.title-sub` | section 9, section 7 |
| `.stars`, `.tier-dot`, `.tick-slot`, `.tier-tick-cell`, `.meter` | section 10 |
| `.result-chip` | `<span class="result-chip" data-result="W"><span>W</span><span>+16</span></span>`: 22px tall, min 56px, 14px 800. W: transparent, green letter, ink margin. L: `loss-tint` bg, `loss` text |
| `.delta` | `data-dir="up|down"` + number, drawn triangle; add sr-only text ("up 3 from the committee"); omit when equal (tables show a muted `=`). Direction is from the side of the label beside it (`Delta` `subject`/`ref`) |
| `.tier-cell`, `.tier-band` | game-log tier cell: pips + band text beside them; under the pips (12/16) below 640px |
| `.team-block`, `.seed-plate`, `.team-chip`, `.team-chip-tap`, `.hero-name`, `.hero-conf` | section 11; `.team-chip-tap` = a 44px hit area in a table row with -8px block margins |
| `.file-letter` | the ink plate naming a resume: `fg` bg, `surface` letter, 800. Picked `data-place="1"` (on the letter, or on its `.blind-card` / `.demo-slab`) `accent-fill` + `on-accent`; `2` `accent-tint` + `accent` + inset 2px `accent-edge`; `3` `raised` + `fg-muted` + inset 1.5px `control` (the same quiet plate on the card header, the intro demo, the glance table and the confirm bar) |
| `.pick-stamp` | 1st / 2nd / 3rd: 2px `accent-edge` border, radius 2px, 14/18 800 `accent`; `data-place="1"` solid `accent-fill`; `3` 1.5px `control` border, `fg-muted`. Upright, ruled, never rotated |
| `.file-tag` | AQ / Unseen / Not shown: 12/16 600, `surface`, `fg`, inset 1px `fg-muted`; `data-tone="quiet"` transparent, `fg-muted`, inset 1px `line-strong` |
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-rank` | 44px min, Archivo 800 16px, radius 3px, `scale(.97)` on press. Primary `accent-fill`; secondary 1.5px `control` border, 600, hover `raised` + `fg` border; ghost 600 `fg-muted`. Every component hover (buttons, tabs, segments, checkboxes, team blocks, links, table rows) sits in `@media (hover: hover) and (pointer: fine)`: on touch screens `:hover` sticks under the thumb after a tap |
| `.switch` + `.switch-track` | `<button role="switch" aria-checked>`: an 18x18 form box (1.5px `control` border, radius 2px, `surface`); checked = `fg` border + an ink check mark; hover `fg` border. No pill, no knob, no violet |
| `.segmented` | frame 1px `control`, radius 4px, `raised` bg, 3px padding; options 15px 600 `fg-muted`; selected (`aria-pressed|selected|current`) = `surface` + `fg` + inset 2px `fg`. Below 640px options 14/16, padding 0 6px, wrap balanced inside the 40px segment |
| `.tabs` + `.tab` | folder tabs: 15px 600, 1px `line-strong` border without bottom, radius 5px 5px 0 0, `fg-muted`; hover `raised`; selected = `surface` + `fg` + `inset 0 3px 0 fg` (weight never changes). Below 640px the tabs share the row (14px, padding 0 6px; 13px / 4px below 360px) |
| `.link` | inherits colour; 1px `fg-faint` underline, offset 3px; hover `fg` text + 2px `fg` underline. No violet |
| `.table-wrap` + `.data-table` | head 13/16 600 `fg-muted` with a 1px `fg` rule; `td[data-num]` 16px 600 right-aligned; hairline rows; row hover `raised`; `tr[data-cut]` = 2px dashed `fg` line + `.cut-note` (13px 600 `fg`, scissors icon). Below 640px cell padding 6px. `.table-wrap` is `position: relative` so `.sr-only` cell text scrolls with the table |
| `.callout` | a memo: 3px `fg` left rule, radius 0 4px 4px 0, `surface` |
| `.pitch-file` (+ `-title`, `-rec`) | the play pitch's miniature redacted card header (section 19) |
| `.ad-slot` + `.ad-label` + `.ad-box` | section 20 |

game.css (island only; components in `@layer components`, then unlayered extras):

| Class | Markup / states |
| --- | --- |
| `.round-ticks` + `.round-tick[data-state]` | progress: `todo` 4px `line-strong`, `done` 4px `fg`, `current` 8px `accent-fill` |
| `.h2h-tag` | 12/16 800, `fg` bg, `page` text |
| `.blind-card[data-place]`, `.card-header`, `.card-header-title` | section 13 |
| `.file-letter-sm` / `-md` / `-rec`, `.file-letter-tick[data-current]` | glance table 28x24, confirm bar 32x32, phone footer 40x40 (letter over record; the card in view solid ink) + 20x2 ink tick |
| `.reveal-panel`, `.reveal-cell[data-match]`, `.reveal-value` | section 15 |
| `.step-no`, `.demo-slab[data-place]` | section 17 |
| bracket fields | `.game-root [data-testid="bracket"] .team-block[data-variant="tab"]`: `raised` bg, no frame; hover `raised-2` |
| `.game-carousel`, `.game-dialog::backdrop`, `.game-countdown`, viewport reservation, `cfbbr-play-pending` | unlayered extras |
| `.field-cut`, `.field-cut-tile[data-cut-below|data-cut-right]`, `.cut-swatch` | "Show playoff field": the dashed ink cut line (phones: under the row, with the `.cut-note`; grid: a staircase through the gaps); the switch's sample |
| `.card-result` | the card's game-log chip on the 6.3 steps (margin 16px 800, W/L 13px 800) |
| `.share-proof` | dark mode: the light share image on a raised mat with the strong rule, `brightness(.9)` |
| `html[data-modal]` | while the reveal is open, the root paints the scrim too (covers the classic-scrollbar gutter) |
| `.game-root .team-block:focus-visible` | focus 3px `fg`, offset 4px |

`.btn-rank` states: default (`surface` bg, 2px `accent-edge` border, `accent` text 800; pointer
hover `raised` bg + an extra inset 1px `accent-edge`, a cue no pick state uses); `data-place="1"` picked 1st (`accent-fill`, `on-accent`, `aria-pressed="true"`,
label "1st · tap to undo"); `data-place="2"` (`accent-tint` + `accent-edge` border + `accent` text
"2nd"); `data-place="3"` implied 3rd (`raised` bg and border, `fg-muted`, "3rd"); `disabled` while
the round locks (transparent, `line-strong` border, `fg-faint`, `cursor: not-allowed`).

## 13. Blind card

Width: 1/3 of the row on desktop (>= 1024px, gap 20px), 88% of the viewport (max 416px) on phones
and tablets. The card is a resume form: `blind-card @container flex flex-col overflow-hidden
rounded-card border bg-surface` (no border-colour utility: the picked state must win).

```html
<article class="blind-card @container flex h-full flex-col overflow-hidden rounded-card border bg-surface" data-card="A" data-place="1" aria-label="Team A, 6 wins 2 losses record, ranked 1st by you">
  <header class="card-header">
    <span class="file-letter" aria-hidden="true">A</span>
    <h3 class="card-header-title">
      <span class="label-caps">Team A</span>
      <span data-redacted aria-hidden="true"></span>
      <span class="text-record" data-record aria-hidden="true">6-2</span>
      <span class="sr-only">, 6 wins 2 losses</span>
    </h3>
    <span class="pick-stamp" data-place="1">1st</span>   <!-- once picked; presses in (stamp-in) -->
  </header>
  <!-- metrics grid px-4 pt-3.5 pb-3.5: Strength of record; Offense | Defense; Schedule
       (compact, < 1024px: one row "SoR | Offense | Defense | Schedule", 16px ranks, 3px meters) -->
  <!-- Quality wins: three fields "rounded-slab border-b border-line-strong bg-raised" h-7 -->
  <!-- Season, in order: .tick-slot > .tier-dot per game, W/L letter 13px 800 under it -->
  <!-- Game log, toughest first: [pips][band][site][result-chip] rows -->
  <footer class="border-t border-line bg-raised px-4 py-2 text-[0.8125rem] leading-4 text-fg-faint">Ratings: FEI by Brian Fremeau</footer>
</article>
```

- **Card**: 1px `line-strong` border, radius 4px, `surface`. `data-place="1"`: border
  `accent-fill` + `box-shadow: 0 0 0 1px accent-fill` (a 2px violet edge); `"2"`: border
  `accent-edge`. Pick feedback over `--duration-fast`.
- **Header** `.card-header`: min-height 72px, padding-right 16px, `surface`, a 2px `fg` bottom rule.
  `.file-letter` 56px wide, full height, 40px glyph, radius 0. `h3.card-header-title`: grid
  `minmax(0,1fr) auto` x 2 rows, gaps 12px / 5px, margin-left 14px. Row 1: "Team A" (`label-caps`,
  `fg-muted`, both columns). Row 2: the redaction bar (column 1, 18px tall, min 48px, max 120px, so
  the record leads) and the record (`text-record`, column 2). The `.pick-stamp` is absolute (top 7px, right 12px) so it never reflows
  the header; it presses in (`stamp-in`: 1.18 -> 1, 140ms `ease-snap`, never rotated).
- **Type steps** inside the card (6.3): labels and meta 13px (600 / 400), values 16px 800, W/L
  letters 13px 800, ranks 22px 800 (16px compact), record 38px, file letter 40px.
- **Metrics**: labels "Strength of record", "Offense", "Defense", "Schedule" are buttons (13/16
  600 `fg-muted`, dotted `control` underline; open: `fg`) that toggle a one-line definition under
  the bar; rank "#N" `text-stat` = rank among `fbsCount` teams; `.meter` 5px. **Compact** (below
  1024px, where the at-a-glance table above already lists the four ranks): one row of four
  label + rank pairs ("SoR" with the full name in its accessible name, 16px 800 ranks, 3px meters,
  about 64px tall); the open definition prints under the row, full width. So four or five game-log
  rows sit above the phone footer at 390.
- **Quality wins**: three shaded fields, label 13px 600 `fg-muted`, value 16px 800 (`fg-faint` for
  0-0). No tier mark.
- **Season, in order**: one equal column per game across the card (`ol.season-ticks`), a tick in a
  `.tick-slot` (1.7x heights), W/L letter 13px 800 in `win` / `loss`.
- **Game log** ("Game log, toughest first"): rows min-h 28px, hairline rules,
  `[pips][band][site][result]`: band "FEI 11-25" 13/18 600 `fg` (no "team": the pips' accessible
  name carries the full label), site 13/20 400 `fg-muted`, `.result-chip.card-result` (margin 16px
  800, W/L 13px 800). Pips `aria-label="{stars} of 5 pips, {tier label}"`.
- **Credit footer**: `bg-raised`, 13/16 `fg-faint`, "Ratings: FEI by Brian Fremeau" (`.link` to the
  season's FEI page; never wraps).
- **Dark mode**: the card's redaction bar prints as a toner strike (`tier-30`, rougher marker
  edge), not a paper-white field; the wordmark, hero phrase and reveal bars keep theirs.

## 14. Game screen

- **Progress row**: `label-caps` "Round 3 of 15" (number `fg`, words `fg-muted`); `ol.round-ticks`
  with one `li.round-tick[data-state]` per round (`todo` / `done` / `current`); right, in a 32px box
  either way: locked, the quiet 13px `fg-faint` note "Finish early after round 5" (a disabled button);
  unlocked, a small `btn btn-secondary` "Finish now" (13px 600, 1.5px `control` rule, hit area
  44px tall), so the unlock is visible and never outranks the round label. Rounds 16-30: "Round 17 of 30", 30 ticks. Phones:
  label + skip on one line, ticks full width below.
- **Head-to-head flag** (centered above the cards, one per meeting): a box with a 1px `line-strong`
  border holding `<span class="h2h-tag">H2H</span>` + 15px 600 "B over A by 16".
- **Desktop (>= 1024px)**: `grid grid-cols-3 gap-x-5`. Rank buttons live in a sticky bar, the grid's
  last row (`sticky bottom-0 col-span-3 grid grid-cols-3 gap-x-5 bg-page pt-3 pb-4`, a 24px
  `page`-to-transparent fade above). Each `.btn-rank` is aligned with its card ("Rank A 1st", then
  "Rank B 2nd"). The picked card's button takes the card's picked look (`accent-tint`, 2px
  `accent-edge`, 600) with the solid "1st" `.pick-stamp` and "Undo" (undo icon): the solid violet
  fill stays for actions that move forward. The confirm bar shows the order as `.file-letter.file-letter-md[data-place]`
  plates. Keyboard hint 13px `fg-faint` ("Keys: A B C rank a card · Backspace or Esc undo · Enter
  lock in"; Esc undoes the last pick, like Backspace), each `kbd` 600 Archivo.
- **Phones/tablets (< 1024px)**: a snap carousel (`.game-carousel`, cards `w-[88%] max-w-[26rem]`),
  no per-card button. Fixed footer `border-t border-line-strong bg-surface`, 68px in every state, no
  shadow: card switchers `.file-letter.file-letter-rec` (letter 17px 800 over the record 11px 600;
  the card in view `data-current` is solid ink, the others `raised` + `fg-muted` + inset 1px
  `line-strong`, with a 20x2 ink `.file-letter-tick` under the current one) + `.btn-rank` for the
  card in view. Main content gets `pb-28`.
- **Phone ranking is two deliberate taps**: "Rank B 1st" for the card in view, then two buttons
  "Rank A 2nd" / "Rank C 2nd"; Undo stays in the same spot. After the 1st pick the carousel moves
  to the first card still open, so the next candidate is in view. After locking the bar stays visible but
  disabled ("Locked in A · C · B"). Any control that appears or changes under the finger ignores
  taps for 400 ms (keyboard never blocked).
- **At-a-glance table (phones)**: above the cards, frame `border-line-strong`, table 14/20 800, head
  12px 600 `fg-muted` with an `fg` rule; best value per column 800 `fg`, others 400 `fg-muted`; the
  row header is `.file-letter.file-letter-sm[data-place]` (picked colours); rows are 44px tall with a
  quiet chevron at the end, and tapping anywhere on a row scrolls to that card.
- **Lock in automatically** (saved setting, on by default): the second pick locks after a short
  countdown (`.game-countdown`); only a real mouse move or keyboard focus on Undo stops it.
- One line under the cards: "#N = best of 138 FBS teams · Tap a label for its definition · Ratings: FEI by Brian Fremeau"
  (13px `fg-muted`, `.link`; 138 from `fbsCount`). It also appears in the reveal footer and on
  results (the attribution on every game view).

## 15. Reveal panel

Modal `dialog.game-dialog`: backdrop `scrim`; panel `reveal-panel rounded-panel border
border-line-strong bg-surface w-full max-w-[34rem]` (it lands with `reveal-in`: fade + 8px rise,
120ms, opaque before the first bar lifts at 120ms; none under reduced motion), no shadow,
`aria-modal`, focus trapped, heading
announced (`aria-labelledby`, plus a polite live region with the running line).

- Header `px-5 pt-4 pb-3`: `label-caps` "Round 1 of 15", `text-heading` "Your order, revealed".
- Three rows, the user's order: a **cover** team block (reveal size): primary bg, `teamInk` name,
  `box-shadow: inset 0 -4px 0 team-rule, inset 0 0 0 1px team-edge`, no bottom border. The plate is
  the **same ink file letter** as the blind card (`fg` bg, `surface` letter, `inset -2px 0 0 surface`:
  a paper gap so plate and cover never merge, e.g. Iowa). The name shrink-wraps its text
  (`flex-initial`), the record sits right (`ml-auto pl-3`, 800, team ink). The redaction bar lifts
  off the name (section 9).
- Cells `.reveal-cell` (`grid grid-cols-4 gap-1`, `rounded-slab bg-raised`, `inset 0 -1px 0
  line-strong`): `label-caps` You / Committee / FEI SoR / Fans, value `.reveal-value` 20/24 800
  "1st|2nd|3rd", sub "#19" 14px 600 `fg-muted` (Committee: `NR` when unranked); below 640px the sub
  is always its own 13px line, so every cell and row has one height. Four cells on a phone: the
  columns are weighted 0.85 / 1.25 / 1 / 0.9 (You / Committee / FEI SoR / Fans) with 12px labels,
  and below 360px the Committee label reads "CFP" (screen readers still hear "Committee"). **You** (`data-you`
  `data-place`) is the reference, always in stamp ink: 1st solid `accent-fill`, 2nd
  `accent-tint` + 2px `accent-edge`, 3rd the open ruled box (`accent` text, 2px `accent-edge`).
  **Agreement**: another cell whose place equals yours gets `data-match` and that same open ruled
  box plus sr-only ", same as your pick", so any match reads as two violet boxes in a row. A row
  nobody agrees with has one box (yours). Forced colours: your 3rd and every match are the same
  open `Highlight` box.
  Hide the Fans cell (3 columns) until fan data exists; without a committee, two columns.
- One line, 15px: this round's verdict per source, then the running counts: "This round: ✓ committee
  ✗ FEI · You've matched the committee in **4 of 6** rounds, FEI in **5 of 6**." (check in `accent`
  600 with sr-only "matched", cross `fg-muted` with "missed"; the counts `text-accent` 800, your
  numbers). No chips. The key line ("1st–3rd: order among these three · #: rank in the full
  ranking · FEI SoR: …") prints on the first reveal of the session only.
- Footer: Next round `btn-primary` full width, credit under it; both stay pinned to the bottom edge
  while the panel scrolls and stay operable during the lift. Tap, Esc, Enter or a letter key
  continues; arrows, Page, Home/End and Space scroll. The panel opens scrolled to the top.

## 16. Done panel

Inline (replaces the card row), centered `max-w-[34rem] rounded-panel border border-line-strong
bg-surface px-6 py-8 text-center animate-rise`, no shadow: kicker `label-caps text-fg-muted` "Round
15 of 15" ("Round 16 of 30" after extra rounds); the hero is the player's verdict: `text-hero text-accent` rounds matched ("12") +
`text-title text-fg-muted` "of 15", heading `text-heading` "Matched the committee" (FEI before the
first release), then "Rounds where your order matched the committee's. FEI: **9 of 15**."; `btn
btn-primary` "Final results" + `btn btn-secondary` "One more round" (one extra round each time, up
to 30; stacked full width on phones, side by side from 640px). The FEI count is `text-accent` 800
(your number). After round 30 a 13px `fg-faint` note: "That is the most rounds a run can hold."

## 17. Intro panel

`intro-panel rounded-panel border border-line-strong bg-surface`, no shadow; two columns from
1024px. One small heading, `h2.label-caps text-fg-muted` "How the blind resume game works": no
second display headline (the page's h1 right above pitches the game, with a one-sentence
paragraph), so on phones Play sits right under it and the steps follow. Steps:
`.step-no` (32x32 numbered form box: inset 1.5px `fg`, radius 2px, 18px 800), step titles 18/24 800.
Demo slabs (desktop column): `.demo-slab[data-place]` (56px, 1px `line-strong`, radius 3px,
`surface`) with a `.file-letter` (48px / 30px glyph, picked colours), "Team B" `label-caps`, a 14px
`[data-redacted]` bar and a `.pick-stamp`. Caption "Names appear only after you lock in your order."
The intro is server-rendered: it reads without JS, and the noscript style hides the whole Play row
(`[data-play-row]`: button, note and margin), so the steps follow the panel label with no gap.

## 18. Results

Order top to bottom: header, tabs, controls, the key, top 25 + next five, bracket, bid lists,
agreement sentence, (ad), share module, play again.

- **Header**: kicker `label-caps text-fg-muted` "After Week 9 · 15 rounds" (+ "· partial" when
  skipped), `text-title lg:text-display` "Your top 25", `btn btn-secondary` "Play again" (phones: a
  jump row Bracket · Bids · Share, 36px `btn btn-secondary text-label-lg` with 44px hit areas).
  Headline stat under the title ("Matched the committee on **43%** of your head-to-head calls, FEI
  on **65%**."): your numbers in `text-accent` 800; on `/r/*` they are the sharer's, in `text-fg`.
- **Tabs**: folder tabs Your ranking / Committee / FEI SoR / Fans (Fans only above the threshold;
  "Shared ranking" on `/r/*`).
- **Controls row**: two `.switch` checkboxes ("Compare to committee" with a `▲2` sample, "Show
  playoff field" with a `.cut-swatch` dashed sample; both fit one line from 360px), then
  `.segmented` (full width with equal segments on phones): "12 teams · 2026 format" | "24 teams
  (2027 proposal)". Selecting 24 shows the one-line rules, "Proposed for 2027 — not final" and the source
  link under the controls (2px `line` left rule, text at most 70ch). The 12-team rules fold into a
  one-line disclosure on phones ("12-team field: 5 champions, 7 at-large. Rules").
- **Key** (13px `fg-muted`, `data-testid="legend"`), one line right under the controls, before the
  first mark: the `.cut-note` "Above the line: the 12-team field", `.file-tag` AQ "automatic bid",
  the delta triangle, Unseen / Not shown tags. "NR" marks positions past what the selected source
  ranked.
- **Grid (>= 640px)**: `grid grid-cols-5 gap-x-3 gap-y-3.5` of index-tab tiles, the record (13px 600
  `fg-muted`) under the name (`.team-block[data-size="tile"][data-meta]` grid); >= 1024px a right
  column (`lg:border-l lg:border-line lg:pl-6`) "Next five" with tiles 26-30 (names 14/16, plate
  18px). 640-1023px: the next five is a row under the grid.
- **List (< 640px)**: `flex flex-col gap-2`; each row an index tab (row size, record as meta) + a
  fixed 76px side cell right next to it, left-aligned: "CFP 6" `label-caps text-fg-muted` +
  `.delta`, then the tags stacked under it (Unseen / Not shown, AQ). Its width never depends on
  state.
- **Compare to committee**: under each tile "CFP 6" ("CFP NR" when unranked) and `.delta`
  (omitted when equal). Delta = committee rank minus your rank (positive = you rank them higher).
- **Show playoff field**: selection chrome, in ink, the rankings tables' device: a 2px dashed `fg`
  cut line under the last team of the unbroken run at the top that is in the field, with the
  scissors `.cut-note` ("Above the line: the 12-team field"). Phones: `.field-cut` under that row,
  spanning row and side cell. Grid: a staircase through the gaps (`.field-cut-tile[data-cut-below]`
  under each tile whose neighbour below is past the cut, `[data-cut-right]` right of the last tile
  in) plus an sr-only note. AQ tags mark every automatic bid, so a team that comes in from below the
  line is marked. It marks the minority in both formats (12: about 11 above the line; 24: the five
  or six below it), never violet, on every tab.
- **Unseen / Not shown / AQ**: `.file-tag` in the tile's under-line, never on the colour. A team
  that never came up (`data-unseen`) is provisional: a dashed `control` frame on its label and the
  name in `fg-muted`, so your own picks separate from the fill. Partial-run
  note: "12 teams never came up; they hold their starting spot (committee order, then FEI) and are
  marked Unseen."

- **Bracket header**: `text-heading` "12-team bracket" + `text-sm text-fg-muted` "Byes: seeds 1-4 ·
  seeded from your ranking".
- **Game box**: `flex flex-col gap-0.5 rounded-chip border border-line-strong bg-surface p-1`, two
  slot-size index tabs drawn as shaded fields (no box-in-box). Undecided slot `[data-slot="tbd"]`:
  `bg-raised`, plate "–" `fg-faint`, "8/9 winner" 15px 600 `fg-muted`.
- **Desktop bracket (>= 1024px)**: one grid column per round, `gap-x-8`, `label-caps` round
  headers; each column an `ol` with `grid grid-rows-N` (12-team: 4 / 4 / 2 / 1; 24-team: 8 / 8 / 4 /
  2 / 1) so every game is centered on its feeders; connectors 1px `line-strong`. Top-to-bottom order
  (12): 8v9→1, 5v12→4, 6v11→3, 7v10→2 (`buildBracket`). 24-team at 1024-1279px scrolls inside
  `overflow-x-auto` with `min-w-[68rem]`.
- **Phone bracket (< 1024px)**: one round at a time, chosen with a full-width `.segmented`
  (`role="tablist"`): First round | Quarters | Semis | Final (24: Round 1 | Round 2 | Quarters |
  Semis | Final). Games stacked full width, each with a 13px line "Winner plays **Miami** (1) in the
  quarterfinals" (team name `fg`). No connectors, no horizontal scroll.
- **Bid lists**: two columns (`sm:grid-cols-2`, `border-t border-line pt-5`): `label-caps`
  "Automatic bids · 5" / "At-large · 7", then `.team-chip` links; phones: one ruled column, the rank
  right-aligned in tabular figures.
- **Agreement sentence**: `text-lg`, counts `text-accent` (yours; `text-fg` on `/r/*`), percentages plain.
- **Share module**: `rounded-card border border-line-strong bg-surface p-4`: preview image
  (1200x630, `rounded-chip`), URL field `bg-raised border-control` 15px 600 `fg-muted`, 44px tall (`h-11`), buttons
  `btn btn-primary` "Share" (Web Share; without it "Copy link" is the primary), `btn btn-secondary`
  "Copy link" ("Copied" for 2s, `aria-live`), `btn btn-secondary` "Save image". Sharing is the
  screen's one primary action: "Play again" under the module is `btn-secondary`. On `/r/*` every share
  button is secondary and "Play it yourself" is the primary.
- One ad slot (`incontent`) just above the share module, outside the play area.

## 19. Content pages

Typographic, tables not cards; light or dark by OS (the page is the sheet). `max-w-page`,
`px-gutter lg:px-gutter-lg`.

- **Site header**: `h-14 border-b border-line`; `.wordmark` with the redacted "Blind"; nav 14px 400
  `fg-muted`, current page `font-bold text-fg shadow-[inset_0_-3px_0_var(--color-fg)]` (an ink rule,
  not violet); phone Play button `btn btn-primary`, except on the game page itself, where it is
  the current-page mark (800 `fg` + the 3px ink rule) so the intro's Play is the one call to action. **Footer**: `border-t border-line py-6 text-sm
  text-fg-muted`, the wordmark, always "Ratings: FEI by Brian Fremeau" linking to
  `https://bcftoys.com/{season}-fei` + data credits.
- **Breadcrumb / kicker**: `label-caps text-fg-muted` above every h1. Never violet.
- **Headings**: one colour; second lines are `.title-sub` (rankings, bubble, compare hub);
  "Georgia vs Indiana" and "Game log, toughest first" print in one colour.
- **Home hero**: `Rank the resumes. <span class="hero-redacted">Names hidden.</span>`, then one
  sentence ("Three college football resumes a round. Your top 25 and 12-team bracket, next to the
  committee's and FEI's."). Phones: a line break puts the redacted phrase on its own line and the
  bar hangs into the margin (`margin-left: -0.14em`), so its "N" aligns under "R", as on
  `og/default.png`.
- **Home "This week"**: the committee top 12 beside FEI's strength-of-record top 12 (index-tab
  rows), each row tagged with its place in that ranking's projected field (`.file-tag` Bye / AQ, or
  quiet "Out"), plus "Also in the 12-team field: Boise State (#25, AQ)." under each list. The field
  tables, seeds and games live on /rankings (the "Full rankings" card), not on home.
- **How it works**: the glossary definitions carry a 1px `line-strong` left hairline (a list); the
  3px ink rule belongs to `.callout` only.
- **Team page header**: a cover team block (`data-size="hero"`): 6px `team-rule` bottom border,
  radius 4px 4px 0 0, name `.hero-name` 800 -0.025em sized by `heroNameFit` (measures the name as
  printed in Archivo 800 display case, reserves the real meta width + 16px gutter, up to 31px phones
  / 52px from 640px; long names two balanced `.hero-line`s on phones; never recased, never
  truncated); meta right: record 20 / 28px 800, conference line `.hero-conf` 13 / 15px 600. Line
  breaking is decided at build time (`heroConfBreaks()` in text-metrics.ts): one line when it fits
  in 92px on phones, otherwise the conference name over its record ("Conference USA" / "1-3"); it
  breaks between the name and the record, never inside the name, and `heroNameFit` reserves that
  width. Independents show the record only.
- **Stat row** (`dl grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-5 mt-5`): Committee first
  (phones `col-span-2`; desktop `sm:border-r sm:border-line sm:pr-6`), `label-caps text-fg-muted`
  label (plain text, never a link; "What these measure" under the row links to /how-it-works), `text-stat-lg` "#1" ("NR" if unranked), then a 5px `.meter`: every rank, the committee's
  included, uses the toner of its rank band and `rankFill` (`track` when unranked). Strength of record
  and schedule add one plain 13px line under the bar, the raw value below in `fg-muted`.
- **Status line** under the hero: one sentence from the committee's projected fields.
- **Resume highlights** (team Resume section and compare cards): record vs the committee top 25,
  best win, worst loss (`resumeHighlights()` in site.ts).
- **Resume strip** (`ResumeStrip.astro` + `src/styles/season-strip.css`, HTML, `role="img"` with the
  season as its label): per game the opponent (12px 600 `fg-muted`), a season tick on a 1px
  `line-strong` baseline (section 10), W/L 15px 800 (`win` / `loss`) and the margin 12px 600. It never
  scrolls sideways: the games share the strip's width (columns at least as wide as the labels need,
  at most 5rem), and when one row does not fit it wraps into two balanced rows (games 1-6 / 7-12),
  then three (container-query width buckets from `stripFit()`). Ticks 1.2x on phones, 2x from a 30rem
  strip. Compare cards share one column width and one slot count, so both strips read as one chart.
  Legend (`ResumeStrip legend`, inside the strip's container): "Tick height = opponent tier" with
  three `.tier-tick-cell` samples drawn at the strip's own scale (`--tick-k` 1.2 / 2, 12px wide
  ticks at 2x); the how-it-works tiers table draws its samples at the card's 1.7x.
- **Labels**: the strength-of-record (GWD) rank is "SoR" in tight spots, "FEI strength of record" /
  "Strength of record" in prose. Bare "FEI" only ever means FEI overall or the system;
  `scripts/content-verify.mjs` fails on a bare "FEI 16"-style label.
- **Jump nav** (`JumpNav`): phones: a grid of 44px chips (`border-control`, radius 3px, 14/16 600),
  3 columns from 375px (2 below), each chip printing its `short` label when it has one ("Committee",
  "Tiers", "American"; always a part of the full name, which stays the link's accessible name), so
  the row count never depends on text width and labels do not wrap ragged. From 640px the chips size
  to their text and flow (1px `line-strong` rule, 15/18 600, hover `fg` rule): an index, not a wall
  of buttons; on how-it-works the row is capped at the reading width. Ledes on rankings, teams and
  bubble are 16px on phones.
- **Committee vs FEI callout**: `.callout mt-8`: `label-caps` "Committee vs FEI" + one 18px sentence
  with ranks in 20px 800.
- **Tables**: `.table-wrap` > `table.data-table`; team cells `.team-chip` links; numeric columns
  `data-num`; results `.result-chip` (the compare card's best win / worst loss too); score `pf-pa`
  in the numeric cell. Game log columns: Opponent | Opponent tier | Site | Result | Score | Date (the
  rows are sorted by opponent, so the date goes last); the tier cell is `.tier-cell` = pips + band
  text "FEI 11-25" on **every row** (beside the pips; 12/16 under them on phones).
  Under 640px drop the Date and Site columns; the site (and "CFP N") becomes a second line under
  the opponent, the date a second line under the score, and cell padding drops to 6px, so the table
  fits 328px. Non-FBS opponents: `.team-chip` with `--team-bg: var(--color-raised-2)`, not a link.
- **Rankings tables**: Rank | Team | Record | SoR (or CFP) | SoR vs CFP delta; ink head rule; cut
  lines for "in the 12" and "in the 24 (proposed)" as `tr[data-cut]` (2px dashed `fg`) + a
  `.cut-note` (scissors, ink, not violet) in the last cell. "Auto bid" tags, the playoff tables'
  "Bye" and the "Proposed for 2027" status are `.file-tag` (one tag component site-wide). Archive weeks (`RankingsView`): current week `border-fg` + inset 1px `fg`.
- **Still to play** (team page, `UpcomingTable` from `upcomingRows`): h2 + one muted line, then a
  `data-table` in date order: Date | Opponent (chip + `CFP N`) | Opponent tier (`.tier-cell`) | Site
  (· Conf). Under 640px the site and CFP rank fold under the opponent. Hidden when the week file has
  no schedule; "No regular-season games left." when it is empty. On compare pages the same table per
  team, `compact`, in two columns from 768px.
- **Rank-history strip**: `ol flex gap-1.5 overflow-x-auto`, one cell per week file: `w-16
  rounded-slab bg-surface px-2 py-1.5`, current week inset 2px `line-strong`; `label-caps` "Wk 9",
  24px 800 GWD "#3", `label-caps text-fg-muted` "CFP 1" ("CFP —" before the first release).
- **Compare page**: two un-blinded cards (`ResumeCard`, `rounded-card border border-line-strong`,
  stacked on phones) with a cover team block on top; rows show site + short band (12px) stacked in
  the site cell. Above them a head-to-head note and one ruled list (`dl`, `divide-y`, max 40rem), a
  44px row per source (Committee / FEI SoR / FEI overall: preferred `.team-chip` + rank, "over" the
  other + rank), captioned "The committee and strength of record agree / disagree".
- **Bubble**: a `data-table` of committee 8-20 sorted by GWD rank; gap column `.delta`; In/out cells
  "In 10" / "2nd out" / "Out" (`outText()`).
- **Play pitch** (`PlayCta`, compare, bubble and team pages; never inside an ad slot): `play-pitch
  rounded-card border border-line-strong bg-surface p-5`, row layout from 640px. Opens with
  `.pitch-file` (aria-hidden): 216px wide, min 48px tall, 2px `fg` bottom rule, ink `.file-letter`
  "A" (40px / 24px), "Team A" 12px 600 `fg-muted` over a 12px redaction bar, then the real record
  (22px 800) of the team the question names (team page: that team; compare: the team argued up;
  /bubble names no single team, so no record).
  Then the kicker, the question (`text-heading`), one line, `btn btn-primary` "Rank them blind" to
  `/#play`.
- **Cards and frames** on content pages (`rounded-card border …`): `border-line-strong`.
- **Compare hub** (`/compare`): neighbors in the ranking, the cut-line matchups (`CutPairs`), then a
  no-JS `<details>` per committee team with all of its compares.

## 20. Ad slots

```html
<div class="ad-slot" data-kind="incontent">
  <span class="ad-label">Advertisement</span>
  <div class="ad-box"><!-- creative --></div>
</div>
```

A plain div with the visible label (sentence case, `fg-faint`), not a landmark. The ad loader is
injected only on pages that render a slot (`BaseLayout ads`). Reserved creative heights = the
tallest unit the slot's width accepts: `leaderboard` 100px phones / 90px >= 768 (max 728 wide);
`incontent` 280px (max 336); `sidebar` 280px phones (max 336), 600px sticky (`top-6`) >= 1024 in a
300px right column. Hairlines above and below. Nothing else may look like this; never inside cards
or modals.

## 21. Forced colours and reduced motion

- `@media (forced-colors: active)`: every redaction (`[data-redacted]`, the reveal bar) keeps
  `forced-color-adjust: none; background: CanvasText`; `.wm-redacted`, `.hero-redacted`:
  `CanvasText` bg, `Canvas` text. Pips, ticks and bars keep their shapes (filled `CanvasText`, empty
  pips `GrayText`, meter track outlined `GrayText`). File letters `CanvasText` / `Canvas`. Your marks
  map to `Highlight` / `HighlightText` (picked card border, 1st/2nd letters, pick stamps, picked
  rank buttons, you-are-here tick, match stamps and your 3rd in the reveal, checked tick, focus
  outline). The field's cut line is a dashed border, so it maps to `CanvasText` on its own. Selection chrome drawn with inset shadows (selected segment, open tab) gets `outline:
  2px solid Highlight; outline-offset: -2px`; step boxes, tags and index tabs a 1px `CanvasText`
  outline. Progress ticks: `GrayText` / `CanvasText`.
- `@media (prefers-reduced-motion: reduce)`: the reveal bar is never drawn (names show at once); the
  global rule zeroes all other durations.

## 22. OG and share images

All images: 1200x630, rectangles + Archivo glyphs only (no rounded corners, gradients, images or
strokes: frames are four 1px rects), so resvg (build time, `src/components/og.ts`) and the Worker
glyph atlas (`functions/_lib`) render alike. Palette `colors.light` (paper `#fdfdfa`, sheet
`#f4f4ef`, ink `#18191d`, carbon `#50524b`, `line-strong` `#b2b3aa`, `track` `#e2e2db`, toner,
violet `#4b2c92` only for "you", win/loss for the triangle), team colours via `teamPaint()` (a
`line-strong` frame around the plate or cover, rule included, when the primary or the rule is
within 1.5:1 of the paper or the sheet). Text widths from the static TTFs (`text-metrics.ts`
`textWidth(s, size, 400|600|800, trackPx)`); tracking in em x size. Sentence case.

- **Common footer and wordmark**: footer band y 558-630 `sheet`, 2px `ink` rule at y 558. Wordmark
  (`wordmark(x, baseline, size)` in og.ts) at x 56, baseline 606, 32px: "CFB" ink, a `redaction`
  rect behind "Blind" (`on-redaction`, padded 0.16 x size), then " Resume" ink; 800, -0.015em.
  Right, anchor end at x 1144, baseline 604: "After Week 9 · Ratings: FEI by Brian Fremeau" 600 26px
  carbon.
- **Team image** (`/og/teams/{slug}.png`): cover rect 0,0,1200,300 in the primary, 12px secondary
  rule y 300-312. Kicker x 56 baseline 96, 600 32px, team ink ("ACC · Conf 6-0"; independents: the
  conference name). Name x 56 baseline 250, 800, -0.025em, display case, 132px shrinking by 2px to
  fit `1088 - recordWidth - 48` (min 64). Record anchor end x 1144 baseline 250, 800 112px. Stat row
  on paper, five cells of 217.6px from x 56: label 600 26px carbon baseline 382 (a label wider than
  its cell less 32px, "Strength of record", takes two lines, 28px apart, ending on 382); numeral 800
  baseline 470, one size for the row (the largest <= 84px, min 52, that leaves at least 44px
  between neighbouring numerals); bar y 494 h 8:
  `track` + toner of the rank band x `rankFill` (committee included). Order: Committee (or FEI
  overall), Strength of record, Offense, Defense, Schedule.
- **Default** (`/og/default.png`, home, the game and every page without its own image): the
  redacted file. Kicker "After Week 9 · 2026 season" 600 28px carbon, x 56 baseline 84; "Rank the
  resumes." 800 84px ink -0.03em baseline 186; "Names hidden." in `on-redaction` reversed out of a
  `redaction` rect, baseline 288. Three blind card headers (y 380, 104px tall, a third of the width
  each, 24px gaps): sheet + 1px `line-strong` frame + 3px ink bottom rule, an 80px ink file letter
  "A"/"B"/"C" (56px, paper), "Team A" 600 24px carbon, a 116x24 redaction bar, and the real record
  (800 48px, right) of one of the week's top three. One wordmark, in the footer.
- **Rankings** (`/og/rankings.png`, /rankings and /bubble): "Committee vs strength of record" 800
  56px (FEI only before the first release), tagline "Same game. Different numbers." 600 32px carbon,
  "After Week 9 · 2026" right; two columns (Committee | FEI strength of record) of five index-tab rows
  (sheet row + 1px `line-strong` frame, 56px plate in the primary with a 5px secondary rule, numeral
  800 30px team ink, name 800 28px ink, record 600 26px carbon). The wordmark prints once (footer).
- **Compare** (`/og/compare/{pair}.png`): two covers (each half, 272px) with 12px rules; kicker 600
  28px ("SEC · Conf 5-1", as on the team image); name 800 fit 96 -> 40; record 800 60px; a centred ink 84x84 plate with "vs" 800 40px in
  paper. Ratings rows on paper (1px `line` separators): the better rank 800 40px ink, the other 600
  40px carbon; label 600 26px carbon centred.
- **Share image** (`/og/r/{code}.png`, Worker, `functions/_lib/share-image.ts`): paper page. The
  header leads with the fan's number: **"43%"** 800 76px violet, -0.02em, x 56 baseline 104; beside
  it (x = number + 20) "matched the committee" 600 26px carbon on baseline 70 and the call line on
  104, 26px (24px when tight): "Biggest call: " (600 carbon) **"Kentucky"** (800 ink) + a 15x13
  triangle and the number 800 in win/loss ("Call: " or the NR wordings when it does not fit; no
  call: the line alone on baseline 92). Right: "After Week 9 · 2026" 600 28px carbon anchor end x
  1144 baseline 62, "My top 12" 800 36px ink anchor end baseline 104. No committee: "65% matched
  FEI". Without an agreement number, "My top 12" is 800 76px at x 56 and the week sits right on
  baseline 104. Two columns of six index tabs at x 56 and 628, width 516, rows
  60px, 70px pitch, from y 136: sheet row + 1px `line-strong` frame; plate 64x60 primary with a 6px
  secondary rule; seed numeral 800 36px team ink; name 800 32px (shrink to 24) ink at x + 82; meta
  600 26px carbon anchor end at x + 498: "Bye · 8-0" for seeds 1-4, else "7-1"; name and meta share
  baseline y + 41 and the name keeps 24px clear of the meta. Footer as above
  with right text "cfbblindresume.com · Ratings: FEI by Brian Fremeau" 600 24px. The atlas
  (`scripts/fn-build-atlas.mjs`) reads `src/assets/fonts/Archivo-{600,800}.ttf` (via `fonts.ttf`),
  strikes 800 at 76 (letters, digits, "%"), 36 (letters and digits), 32, 30, 28, 26, 24; 600 at 28,
  26, 24. After any change: `npm run fn:atlas`,
  `node scripts/fn-build-atlas.mjs --check`, `npm run fn:integration`, `npm run fn:bench` (CPU
  budget).

## 23. Icons

`public/favicon.svg`: a paper tile `#fdfdfa` with a 2px ink frame (radius 5 in a 32 viewBox),
three redaction bars `#121317` (16 / 12 / 8 x 4 at x 8, y 8 / 14 / 20; pixel-aligned so it is crisp
at 16 and 32px), the last ended by a 6x4 violet stamp at x 18, y 20: a redacted list you marked. `public/apple-touch-icon.png` (180x180): the same drawing
full bleed on paper, no frame. `public/site.webmanifest`: `theme_color` and `background_color`
`#fdfdfa`.

## 24. Do / don't

- Do: paper, ink, toner, ruled form fields, file letters, folder tabs, index tabs, the redaction
  bar, sentence case, tabular numerals, violet only for the fan.
- Don't: shadows or glows, gradients, pills, rounded-full knobs, caps or tracked labels, a second
  font family, coloured tier ramps, star glyphs, red accents, violet links or kickers, slanted or
  rotated stamps, sunburst backgrounds, dashed card borders (the only dashed line is the cut line),
  question-mark badges, logos, colour-only meaning, coloured text on team colours other than the
  computed ink, accented words in headings.

## 25. Verification

Before shipping a visual change: `npm test`, `npm run check`, `npm run build`,
`node scripts/content-verify.mjs dist`, `node scripts/e2e-game.mjs --dist dist` (phone, laptop, skip,
bad codes; it waits for the declassify animations and asserts no team name in the island before
lock-in), axe + Lighthouse mobile on `/`, `/teams/ohio-state`, `/rankings`, `/teams`, `/r/<code>`
with light and dark emulated (performance >= 90, accessibility = 100, CLS = 0, ads on and off), the
no-JS intro in both schemes, a narrow matrix at 320 / 375 / 390 / 1280 (home, round, pick, reveal,
results tabs, format segment, bracket, long-name team heroes: no clipped label, no horizontal
scroll), `node scripts/fn-build-atlas.mjs --check`, and `rg -n "ESPN|FPI|SP\+|Game Control" dist`
limited to about.html. `rg -n "uppercase|tracking-\[|shadow-(card|panel|footer)|data-theme" src`
returns nothing.
