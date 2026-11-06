# cfbblindresume visual language

Binding for every surface: content pages (Astro), the game island (React), OG/share images.
Tokens live in `src/styles/tokens.css` (CSS) and `src/styles/tokens.ts` (same values for code that
cannot read CSS). Shared component classes live in `src/styles/global.css`. Do not invent colors,
fonts, radii or durations outside these files; if you need one, add a token there.

**Identity: broadcast graphics without the broadcast.** Near-black stage, one electric green-gold
accent, condensed numerals, team identity as lower-third slabs, one color ramp for opponent
quality. Everything is orthogonal: rectangles, 2-8px radii, no skews, no glows, no gradients
(except the one fade above the sticky rank bar), no textures.

## 1. Five rules

1. **Accent means "you".** `accent` marks the user's picks, the current selection (tab, segment,
   toggle), the primary action, focus, and the user's own numbers. Never decorate with it, never
   use it for data about teams.
2. **The tier ramp means "how good".** Opponent tiers (stars, resume-strip dots) and rank bars all
   use the same 8-step ramp. Gold = elite, grey = weak, everywhere.
3. **Win/loss colors only mean W and L** (and up/down rank deltas). Always paired with the letter
   or a drawn triangle, never color alone.
4. **Teams are lower-thirds.** Primary color block + condensed caps name + 4px secondary rule,
   built with `.team-block` / `.team-chip` + `teamVars()`. No logos, ever.
5. **Numbers are condensed and tabular.** Ranks, records, margins, seeds: Barlow Condensed 700.

## 2. Wiring

```astro
---
// layouts: import once
import '../styles/global.css';
import barlow700 from '../assets/fonts/BarlowCondensed-700.woff2?url'; // same hashed file as the CSS url()
import barlow600 from '../assets/fonts/BarlowCondensed-600.woff2?url';
---
<html lang="en" data-theme="dark">          <!-- game pages (/ and /r/*) only; content pages omit it -->
<head>
  <link rel="preload" href={barlow700} as="font" type="font/woff2" crossorigin />
  <link rel="preload" href={barlow600} as="font" type="font/woff2" crossorigin />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#0e0f12" media="(prefers-color-scheme: dark)" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" /> <!-- content pages -->
</head>
```

- Built output: `/_astro/BarlowCondensed-700.<hash>.woff2` (+ 600). Preload both: 700 (headline,
  records, ranks) and 600 (labels, table heads, team chips). A late 600 swap re-measured auto-width
  table columns (small CLS on /teams and /rankings); the metric-matched fallback face covers the rest.
- Themes: `@theme` = dark (default, game). Content pages follow `prefers-color-scheme`.
  `data-theme="light|dark"` on any element forces that theme for the subtree.
- `tokens.ts` exports `colors.dark/light`, `tierKey(stars)`, `tierColor(stars, theme)`,
  `TIER_DOT_PX`, `contrast()`, `teamInk()`, `teamRule()`, `teamVars(colors)` (style object for
  `.team-block`/`.team-chip`), `teamPaint(colors)` (hex for raster), `fonts.ttf`, `motion`, `og`.
  React: `style={teamVars(team.colors) as React.CSSProperties}`. Astro: `style={teamVars(team.colors)}`.
- Never re-implement tiers/ranks: tier = `tierFor()` from `@lib/tiers`, bar fill = `rankFill(rank, week.fbsCount)`,
  bar color = `tierKey(tierFor({ fbs: true, feiRank: rank }).stars)`.
- `tests/design-tokens.test.ts` checks CSS/TS parity and every contrast pair below.
- Tailwind's default palette still compiles, but do not use it (`bg-gray-800`, `text-red-500`...).
  Only the token utilities listed here.

## 3. Palette

Utilities: `bg-*`, `text-*`, `border-*`, `ring-*`, `outline-*`, `fill-*` with the names below.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `page` | `#0e0f12` | `#ffffff` | page background (`html`/`body` set explicitly) |
| `surface` | `#16181d` | `#f5f6f8` | cards, panels, callouts, sticky footer |
| `raised` | `#1e2128` | `#ebedf0` | card header slab, chips, TBD bracket slots, hover |
| `raised-2` | `#272b33` | `#e1e4e8` | seed plates, pressed |
| `line` | `#2a2e36` | `#e1e4e8` | hairlines (decorative) |
| `line-strong` | `#3a3f49` | `#c5cad1` | table head rule, blind header rule, empty stars |
| `control` | `#7a808a` | `#6e7581` | boundaries of interactive controls (>= 3:1) |
| `track` | `#2b2f37` | `#e1e4e8` | empty part of bars, upcoming progress |
| `fg` | `#ecedee` | `#121317` | primary text |
| `fg-muted` | `#9ba1ab` | `#555b66` | labels, secondary text |
| `fg-faint` | `#878d97` | `#5f6570` | meta, disabled; not on `raised-2` |
| `accent` | `#c8f135` | `#4a6b00` | accent as text/icon |
| `accent-fill` | `#c8f135` | `#c8f135` | primary buttons, picked plate, active underline, field plates |
| `on-accent` | `#0e0f12` | `#0e0f12` | text on `accent-fill` |
| `accent-tint` | `#333f22` | `#eef8d4` | selected background (segment, 2nd pick, hover on rank button) |
| `accent-edge` | `#c8f135` | `#5f8700` | accent borders/rules that must stay visible (callout, cut lines, outlines) |
| `focus` | `#c8f135` | `#4a6b00` | focus ring |
| `win` / `win-tint` | `#3dd68c` / `#1b3a2f` | `#087040` / `#e3f3e9` | W text / W chip |
| `loss` / `loss-tint` | `#ff6b6b` / `#3e2329` | `#b91e2a` / `#fbe7e8` | L text / L chip |
| `selection` | `#c8f135` | `#d9f27a` | `::selection` (text `on-selection` `#0e0f12`) |
| `scrim` | `rgb(6 7 9 / .8)` | `rgb(14 15 18 / .55)` | modal backdrop |
| `ink` / `paper` | `#0e0f12` / `#ffffff` | same | constant inks for team blocks and OG |

### Measured contrast (WCAG 2.x; enforced by the test)

| Pair | Min | Dark | Light |
| --- | --- | --- | --- |
| `fg` on `page` / `surface` / `raised` / `raised-2` | 4.5:1 | 16.35 / 15.15 / 13.74 / 12.11 | 18.56 / 17.17 / 15.83 / 14.55 |
| `fg-muted` on `page` / `surface` / `raised` / `raised-2` | 4.5:1 | 7.37 / 6.83 / 6.20 / 5.46 | 6.83 / 6.32 / 5.82 / 5.35 |
| `fg-faint` on `page` / `surface` / `raised` | 4.5:1 | 5.74 / 5.32 / 4.82 | 5.86 / 5.42 / 5.00 |
| `accent` on `page` / `surface` / `raised` | 4.5:1 | 14.68 / 13.61 / 12.34 | 6.19 / 5.72 / 5.27 |
| `on-accent` on `accent-fill` | 4.5:1 | 14.68 | 14.68 |
| `accent` on `accent-tint` | 4.5:1 | 8.58 | 5.60 |
| `win` on `page` / `surface` / `raised` | 4.5:1 | 10.22 / 9.47 / 8.59 | 6.17 / 5.71 / 5.26 |
| `win` on `win-tint` | 4.5:1 | 6.61 | 5.37 |
| `loss` on `page` / `surface` / `raised` | 4.5:1 | 6.91 / 6.40 / 5.81 | 6.40 / 5.92 / 5.46 |
| `loss` on `loss-tint` | 4.5:1 | 5.12 | 5.39 |
| `on-selection` on `selection` | 4.5:1 | 14.68 | 15.45 |
| `control` on `page` / `surface` / `raised` | 3:1 | 4.82 / 4.47 / 4.05 | 4.64 / 4.29 / 3.96 |
| `focus` on `page` / `surface` / `raised` | 3:1 | 14.68 / 13.61 / 12.34 | 6.19 / 5.72 / 5.27 |
| `accent-edge` on `page` / `surface` / `raised` | 3:1 | 14.68 / 13.61 / 12.34 | 4.24 / 3.92 / 3.62 |
| `tier-50` on `page` / `surface` / `raised` | 3:1 | 12.81 / 11.87 / 10.77 | 4.22 / 3.90 / 3.60 |
| `tier-45` | 3:1 | 10.43 / 9.66 / 8.77 | 4.72 / 4.36 / 4.02 |
| `tier-40` | 3:1 | 8.61 / 7.98 / 7.24 | 4.82 / 4.46 / 4.11 |
| `tier-30` | 3:1 | 7.84 / 7.26 / 6.59 | 4.61 / 4.26 / 3.93 |
| `tier-20` | 3:1 | 6.28 / 5.82 / 5.28 | 4.08 / 3.78 / 3.48 |
| `tier-15` | 3:1 | 5.38 / 4.99 / 4.52 | 3.87 / 3.58 / 3.30 |
| `tier-10` | 3:1 | 4.67 / 4.33 / 3.93 | 3.73 / 3.45 / 3.18 |
| `tier-05` | 3:1 | 4.13 / 3.82 / 3.47 | 3.57 / 3.30 / 3.04 |
| team name on its block (`teamInk`) | 4.5:1 | >= 4.58 for any color (swept in the test) | same |

`accent-fill` on a light page is 1.3:1 by design: light-theme primary buttons carry an
`accent-edge` border, and accent is never the only cue for state.

## 4. Opponent-tier ramp

Key = stars x 10 (`tierKey(stars)`): `data-tier="50|45|40|30|20|15|10|05"` on any element sets
`--tier` (color), `--stars` and `--tier-dot`. Utilities `bg-tier-45`, `text-tier-45`... always exist.

| Key | Stars | Tier (FEI rank) | Dark | Light | Dot |
| --- | --- | --- | --- | --- | --- |
| `50` | 5 | 1-5 | `#ffcd34` gold | `#937900` | 14px |
| `45` | 4.5 | 6-10 | `#f8b23d` amber | `#b65a00` | 12px |
| `40` | 4 | 11-25 | `#d9a461` bronze | `#8c6b56` | 11px |
| `30` | 3 | 26-50 | `#77abd7` steel | `#4479a9` | 10px |
| `20` | 2 | 51-75 | `#7f96af` slate | `#698098` | 9px |
| `15` | 1.5 | 76-100 | `#7c8999` | `#768392` | 8px |
| `10` | 1 | 101+ | `#777e87` | `#7e858e` | 7px |
| `05` | 0.5 | FCS / non-FBS | `#717579` | `#84888c` | 6px |

- **Stars:** `<span class="stars" data-tier="45" role="img" aria-label="4.5 of 5 stars"></span>`
  (60x12, half stars automatic, empty stars `line-strong`). Never use star glyphs from a font.
- **Rank bars:** the bar for rank N uses the tier of that rank band (a #3 offense is gold, #61 is
  slate). `<div class="meter" data-tier="50" style="--fill:.985"><span></span></div>`, 6px tall.
- **Resume-strip dots:** `<span class="tier-dot" data-tier="30"></span>`, sized by tier, with the
  W/L letter under it (section 7).
- **Quality-win chips:** Top 10 = `50`, 11-25 = `40`, 26-50 = `30` dot (8px). Labels "Top 10" /
  "11-25" / "26-50" everywhere (game card, team page, compare card); the heading names the scale
  ("Quality wins (by FEI rank)"), so labels never truncate.
- Light theme: gold `50` leans yellow, amber `45` leans orange and bronze `40` is muted, so the
  three top tiers stay distinguishable after darkening for contrast on white.

## 5. Type

| Role | Utility | Spec |
| --- | --- | --- |
| Label (metric names, column heads, kickers) | `label-caps` | Barlow Condensed 600, 12/16, +0.08em, caps |
| Tab / button / table team name | `cond text-label-lg uppercase` | 600, 15/20, +0.06em |
| Team name on tiles / slots | `text-team` (inside `.team-block`) | 700, 16/17, +0.02em, caps |
| Card rank "#N" | `cond text-stat` | 700, 22/24 |
| Panel title, h2 | `cond text-heading uppercase` | 700, 24/26 |
| h1 phone, section title | `cond text-title uppercase` | 700, 32/32 |
| Stat row numeral (content) | `cond text-stat-lg` | 700, 36/36 |
| Card record | `text-record` (in `.team-block`) | 700, 44/40 |
| h1 desktop, team hero name | `cond text-display uppercase` | 700, 56/52 |
| "15" numeral | `cond text-hero` | 700, 96/88 |
| Body | `text-base` / `text-sm` / `text-lg` | system UI sans 16/24, 14/20, 18/28 |

- Fonts: `font-condensed` (Barlow Condensed 600/700 only, self-hosted, `font-display: swap`) and
  `font-sans` (system UI). Never another family; never 400/500 weights of the condensed face.
- `body` sets `tabular-nums`; `proportional-nums` opts out. `cond` = condensed + tabular.
- Minimum text: 12px (labels), 13px sans meta, 14px body in tables, 16px body copy.
- The condensed font has no arrows or stars: deltas use `.delta` (drawn triangle), minus is
  U+2212 (`−`), the separator is ` · `.
- Copy casing: condensed text is uppercase via CSS (`uppercase`); write strings in normal case.

## 6. Space, radius, shadow, motion

- Base unit 4px (`p-1` = 4px). Gutter `px-gutter` (16px) on phones, `lg:px-gutter-lg` (32px).
  Containers: `max-w-read` 672px prose, `max-w-page` 1216px content, `max-w-game` 1216px game (the
  same as page, so the home hero, game panel, "This week" and header share one left edge).
- Radius: `rounded-slab` 2px (team blocks, plates, bars), `rounded-chip` 4px (chips, buttons,
  tiles, inputs), `rounded-card` 8px (cards, table frames), `rounded-panel` 12px (modals).
- Shadow: `shadow-card` (cards), `shadow-panel` (modals), `shadow-footer` (sticky bars). Flat
  otherwise; no colored glows.
- Motion (all < 300ms; zeroed under `prefers-reduced-motion` by global.css):
  `--duration-instant` 90ms (press), `--duration-fast` 140ms (hover, toggles), `--duration-base`
  200ms (pick, panel fade, tab change), `--duration-slow` 280ms (reveal wipe, bar fill, modal
  enter). Easing `ease-out` (default), `ease-snap` (pick press overshoot). Animations:
  `animate-rise` (8px up + fade), `animate-fade`, `animate-wipe` (left-to-right clip reveal),
  `meter[data-animate]` (bar fill). Use `duration-(--duration-base)` for custom transitions.
- Focus: 2px `focus` outline, 2px offset, on `:focus-visible` (global). Do not remove it.
- `html` sets `scrollbar-gutter: stable`: on desktops with classic scrollbars the centered page never
  shifts when the scrollbar appears mid-load (no effect with overlay scrollbars). Never size with `100vw`.
- Touch targets: 44px minimum (`.btn`, `.switch`, `.tab`); segments 40px inside a 48px control.

## 7. Component classes (global.css)

| Class | Markup / states |
| --- | --- |
| `.team-block` | flex row; `style={teamVars(c)}`; children `.seed-plate` + name + meta; `data-in-field` = accent ring (box-shadow: 2px `page` gap + 2px `accent-edge`) + accent plate; a focused in-field block adds a 3px `fg` outline outside the ring |
| `.team-chip` | inline name with a 12x20 color block + 4px rule; tables, lists, prose |
| `.seed-plate` | left plate in a team block: `raised-2`, condensed 700 numeral |
| `.meter` | rank bar, `data-tier`, `--fill`; `data-animate` to grow on mount |
| `.stars`, `.tier-dot` | see section 4 |
| `.result-chip` | `data-result="W|L"`: `<span class="result-chip" data-result="W"><span>W</span><span>+16</span></span>`, min 60x24 |
| `.delta` | `data-dir="up|down"` + number; add sr-only text ("up 3 from the committee"); omit when equal (sr-only "agree" text stays; tables show a muted `=` so the cell does not read as missing). Direction is always from the side of the label beside it (`Delta` `subject`/`ref`) |
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-rank` | 44px min, condensed 700 17px caps |
| `.switch` + `.switch-track` | `<button role="switch" aria-checked>`; on = accent track |
| `.segmented` | children `[aria-pressed]` / `[aria-selected]` / `[aria-current]`; selected = `accent-tint` + accent text + 1px `accent-edge` |
| `.tabs` + `.tab` | `[aria-selected=true]` = `fg` + 3px `accent-fill` underline |
| `.link` | `fg` text, 2px `accent-edge` underline, hover `accent` text |
| `.table-wrap` + `.data-table` | `th[data-num]`, `td[data-num]` right-aligned condensed; `tr[data-cut]` = 2px accent cut line. `.table-wrap` is `position: relative` so `.sr-only` cell text scrolls with the table instead of widening the page |
| `.team-chip-tap` | team link in a table row (`TeamChip tap`): 44px-tall hit area with -8px block margins, so the row height does not change |
| `.hero-name` | team-page hero name (`TeamBlock` `nameFit` from `heroNameFit()`): size container + `min(max, (100cqi - meta) / width-per-px)`, two stacked `.hero-line`s for long names on phones; never truncates |
| `.callout` | `surface`, 4px `accent-edge` left rule |
| `.ad-slot` + `.ad-label` + `.ad-box` | section 13 |

`.btn-rank` states: default (2px `accent-edge` border, `accent` text, hover `accent-tint`);
`data-place="1"` picked 1st (`accent-fill`, `on-accent`, `aria-pressed="true"`, label
"1st · tap to undo"); `data-place="2"` (`accent-tint` + accent border + text "2nd");
`data-place="3"` implied 3rd (`raised`, `fg-muted`, "3rd"); `disabled` while the round locks
(transparent, `line-strong` border, `fg-faint`, `cursor: not-allowed`).

## 8. Team block (lower-third)

Color block in `primary` (`--team-bg`), name in condensed caps in `teamInk(primary)` (white or
ink, always >= 4.5:1), a 4px bottom rule in `secondary` (`teamRule`: falls back to the ink color
when secondary is within 1.5:1 of primary, e.g. BYU). If the primary vanishes into the page
(< 1.5:1, 41 of 138 teams on dark: navy/black/maroon) `teamVars` adds a 1px hairline edge; the
secondary rule carries identity (Michigan maize, Iowa gold). Seed plate sits left, meta right.

| Size | Height | Plate | Name | Use |
| --- | --- | --- | --- | --- |
| slot | `h-9` 36 | `min-w-8` 18px | 15px | bracket slots |
| row | `h-12` 48 | `min-w-10` 22px | 18px | phone results list, rankings lists |
| tile | `min-h-16` 64 | `min-w-9` 22px | `text-team` 16px, 2 lines max | results grid |
| reveal | `h-14` 56 | `min-w-12` 28px | `text-heading` 24px | reveal panel |
| hero | `min-h-[4.5rem] sm:min-h-24` | none | `.hero-name`: up to 32px phones / 56px from 640px, sized to fit (two lines on phones for long names) | team page header |

```html
<a href="/teams/miami" class="team-block min-h-16 pr-3" style="--team-bg:#f47321;--team-ink:#0e0f12;--team-rule:#005030;--team-edge-dark:transparent;--team-edge-light:transparent">
  <span class="seed-plate min-w-9">1</span>
  <span class="text-team line-clamp-2 min-w-0 flex-1 pl-2.5">Miami</span>
  <span class="ml-2 flex-none text-[1.0625rem]">8-0</span>   <!-- optional meta (record) -->
</a>
```

Every team name links to `/teams/{slug}` (block or chip). Hover: `brightness(1.1)` (built in).
Text placed over a team color is only the name and record in `--team-ink`; anything else
(committee rank, deltas, tags) goes outside the block on `page`/`surface`.

## 9. Blind card

Width: 1/3 of the row on desktop (>= 1024px, gap 20px), 88% of the viewport (max 416px) on
phones/tablets. Card: `rounded-card border border-line bg-surface shadow-card overflow-hidden`.
Header = a team block with the identity redacted: `--team-bg: raised`, `--team-rule: line-strong`.
The reveal panel shows the same slab painted in team colors.

```html
<article class="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card" aria-label="Team A, record 6-2">
  <header class="team-block h-16 rounded-none pr-4" style="--team-bg:var(--color-raised);--team-ink:var(--color-fg);--team-rule:var(--color-line-strong)">
    <span class="seed-plate w-16 rounded-none bg-fg text-[2.75rem] text-page" aria-hidden="true">A</span>
    <div class="ml-4 flex flex-col"><span class="label-caps text-fg-muted">Team A</span><span class="text-record">6-2</span></div>
    <!-- picked: <span class="ml-auto rounded-chip bg-accent-fill px-2.5 py-1 text-label-lg text-on-accent">1st</span> -->
  </header>
  <section class="grid grid-cols-2 gap-x-5 gap-y-2.5 px-4 pt-3 pb-3.5" aria-label="Ratings (rank among FBS teams)">
    <div class="col-span-2">   <!-- Strength of record; then Offense | Defense (one column each); then Schedule (col-span-2) -->
      <div class="flex items-baseline justify-between gap-2">
        <button type="button" aria-expanded="false" class="label-caps text-fg-muted underline decoration-line-strong decoration-dotted decoration-1 underline-offset-[5px] hover:text-fg">Strength of record</button>
        <span class="cond text-stat">#2</span>
      </div>
      <div class="meter mt-1.5" data-tier="50" style="--fill:.993"><span></span></div>
      <!-- expanded: <p class="mt-1.5 text-[0.8125rem] leading-5 text-fg-muted">one-line definition</p> -->
    </div>
  </section>
  <section class="border-t border-line px-4 py-3">
    <h3 class="label-caps text-fg-muted">Quality wins</h3>
    <ul class="mt-1.5 grid grid-cols-3 gap-1.5">
      <li class="flex h-7 min-w-0 items-center gap-1 rounded-chip bg-raised px-1.5">
        <span class="tier-dot" data-tier="50" style="--tier-dot:8px"></span>
        <span class="label-caps flex-1 whitespace-nowrap tracking-[0.04em] text-fg-muted">Top 10</span>
        <span class="cond whitespace-nowrap text-[1.0625rem] leading-none font-bold">0-1</span>  <!-- 0-0: text-fg-faint -->
      </li>
    </ul>
    <h3 class="label-caps mt-2.5 text-fg-muted">Season</h3>
    <ol class="mt-1.5 flex gap-1.5" aria-label="Results in order">
      <li class="flex w-4 flex-col items-center gap-1">
        <span class="grid h-3.5 place-items-center"><span class="tier-dot" data-tier="30"></span></span>
        <span class="cond text-[0.75rem] leading-none font-bold text-win">W</span>   <!-- L: text-loss -->
      </li>
    </ol>
  </section>
  <section class="border-t border-line px-4 pt-3 pb-2">
    <h3 class="label-caps text-fg-muted">Toughest opponent first</h3>
    <ol class="mt-1">
      <li class="grid h-7 grid-cols-[auto_1fr_auto_auto] items-center gap-x-2.5 border-t border-line first:border-t-0">
        <span class="stars" data-tier="50" role="img" aria-label="5 of 5 stars"></span>
        <span class="cond truncate text-[0.9375rem] leading-5 font-semibold">FEI 1-5 team</span>
        <span class="cond text-[0.9375rem] leading-5 font-semibold text-fg-muted">Home</span>
        <span class="result-chip" data-result="L"><span>L</span><span>−3</span></span>
      </li>
    </ol>
  </section>
</article>
```

- Labels: "Strength of record", "Offense", "Defense", "Schedule"; "#N" = rank among
  `fbsCount` teams. A tap on a label toggles a one-line definition under that bar.
- Picked 1st: `ring-2 ring-accent-fill` on the card, letter plate `bg-accent-fill text-on-accent`,
  "1st" badge in the header. Picked 2nd: `ring-1 ring-accent-edge`, plate `bg-accent-tint
  text-accent`, "2nd" badge (`accent-tint` + inset `accent-edge`). Implied 3rd: badge "3rd" on
  `raised-2`, `fg-muted`. Pick feedback: card `scale(.98)` for `--duration-instant` with
  `ease-snap` back; ring/plate change over `--duration-fast`.

## 10. Game screen

- **Progress row:** `label-caps` "Round 3 of 15" (number in `fg`, words `fg-muted`); 15 segments
  `h-1.5 flex-1 gap-1 rounded-slab` (done `accent-fill`, current `fg`, upcoming `track`); right
  `btn btn-ghost` "Skip to results" (`disabled` until round 5). Rounds 16-30: "Round 17 of 30",
  30 segments. Phones: label + skip on one line, segments full width below.
- **Head-to-head flag** (centered above the cards, one per meeting, stacked with `gap-1.5`):
  `inline-flex gap-2.5 rounded-chip border border-line bg-surface py-1.5 pr-3 pl-2` with
  `<span class="label-caps rounded-slab bg-raised-2 px-1.5 py-0.5">H2H</span>` + condensed 600 17px
  "B beat A head-to-head · +16".
- **Desktop (>= 1024px):** `grid grid-cols-3 gap-x-5`. Rank buttons live in a sticky bar that is
  the grid's last row: `sticky bottom-0 col-span-3 grid grid-cols-3 gap-x-5 bg-page pt-3 pb-4`
  with a 24px `page`-to-transparent fade above (`before:` pseudo). Each button is aligned with its
  card ("Rank A 1st", then "Rank B 2nd"). The buttons never scroll out of view, even with
  13-game logs; when the cards fit, the bar sits right under them.
- **Phones/tablets (< 1024px):** `flex snap-x snap-mandatory gap-3 overflow-x-auto px-gutter
  scroll-px-gutter`; cards `w-[88%] max-w-[26rem] flex-none snap-center`; no per-card button.
  Sticky footer `fixed inset-x-0 bottom-0 border-t border-line bg-surface shadow-footer
  pb-[env(safe-area-inset-bottom)]`, inner `max-w-[30rem] px-gutter py-3 flex items-center gap-4`:
  three dots (`role="tab"`, current `h-2 w-6 bg-accent-fill`, others `size-2 bg-control`; tap
  scrolls to that card) + `btn btn-rank flex-1` for the card in view ("Rank B 1st"; after a pick
  on that card: "1st · tap to undo" filled). Main content gets `pb-28`.
- **Phone ranking is two deliberate taps:** "Rank B 1st" for the card in view, then two buttons
  "Rank A 2nd" / "Rank C 2nd"; Undo stays in the same left-hand spot and the footer is a fixed 68px
  tall in every state. After locking, the bar stays visible but disabled ("Locked in"). Any control
  that appears or changes under the finger ignores taps for 400 ms (keyboard never blocked).
- **At-a-glance table (phones):** above the cards, one row per team (record, SoR, Off, Def, Sched,
  vs top 25), the best value per column highlighted; tapping a row scrolls to that card. The A/B/C
  footer buttons show each team's record.
- **Card credit:** every blind card ends with a one-line footer "Ratings: FEI by Brian Fremeau"
  (`.link` to the season's FEI page; the link never wraps).
- **Lock in automatically** (saved setting, on by default): the second pick locks after a short
  countdown; only a real mouse move or keyboard focus on Undo stops it.
- One line under the cards: "#N = rank among all 138 FBS teams · Ratings: FEI by Brian
  Fremeau" (`text-[0.8125rem] text-fg-muted`, link `.link`; 138 from `fbsCount`). This line
  also appears in the reveal footer and on results (the attribution on every game view).

## 11. Reveal panel

Modal: overlay `fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-scrim p-gutter`;
panel `w-full max-w-[34rem] rounded-panel border border-line bg-surface shadow-panel
animate-rise`, `role="dialog" aria-modal="true"`, focus trapped, Esc / tap / any key continues,
heading announced (`aria-labelledby`, plus a polite live region with the running line).

- Header `px-5 pt-4 pb-3`: `label-caps` "Round 3 of 15", `cond text-heading uppercase` "Your
  order", ghost close button (44x44, 16px X icon, `aria-label="Close"`).
- Three rows (`gap-4`, `px-5`), the user's order: `team-block h-14` (reveal size) with the place
  numeral in the plate and the record as meta; it enters with `animate-wipe` staggered 60ms.
  Under it `grid grid-cols-4 gap-1` cells `rounded-slab bg-raised px-2 py-1`: `label-caps`
  You / Committee / FEI / Fans, value `cond 20px` "1st|2nd|3rd" + actual rank `#5` in
  `fg-muted` 14px (Committee: `NR` when unranked). Values that equal the user's place are
  `text-accent`. Hide the Fans cell (3 columns) until fan data exists.
- Match chips: matched = `accent-tint` + accent text + inset `accent-edge` + 12px check icon
  ("Matches committee"); not matched = `raised` + `fg-muted` + X icon ("Differs from FEI").
- Running line 15px: "You've matched the committee in **4 of 6** rounds, FEI in **5 of 6**."
- Footer `border-t border-line px-5 py-3 text-[0.75rem] text-fg-faint`: "Tap anywhere or press
  any key to continue" left, attribution right; it and Next round stay pinned to the bottom edge
  while the panel scrolls. Tap, Esc, Enter or a letter key closes; arrows, Page, Home/End and Space
  scroll. The panel opens scrolled to the top. Without a committee the cells are two columns (You,
  FEI SoR). The FEI cell is labeled "FEI SoR".

## 12. "15 rankings in" panel

Inline (replaces the card row), centered `max-w-[34rem] rounded-panel border border-line
bg-surface px-6 py-8 text-center shadow-card animate-rise`: `cond text-hero text-accent` "15",
`cond text-heading uppercase` "Rankings in", running line (`text-fg-muted`, numbers `fg`),
buttons `btn btn-primary` "Final results" + `btn btn-secondary` "Do another" (stacked full width
on phones, side by side `min-w-48` from 640px), note "Up to 30 rounds. More picks, sharper
ranking." in `fg-faint` 13px.

## 13. Results

Order top to bottom: header, tabs, controls, top 25 + first five out, (ad), bracket, bid lists,
agreement sentence, share module, play again.

- **Header:** kicker `label-caps text-accent` "After Week 9 · 15 rounds" (add "· partial" when
  skipped), `cond text-title lg:text-display uppercase` "Your top 25", `btn btn-secondary` "Play
  again" right (phones: a jump row Bracket · Bids · Share instead). Under the title a headline stat
  ("Matched the committee on **43%** of your head-to-head calls, FEI on **65%**.", numbers accent).
- **Tabs:** `.tabs` with Your ranking / Committee / FEI / Fans (Fans only above the threshold).
- **Controls row** (`flex flex-wrap gap-x-6 py-2`): two `.switch` ("Compare with committee",
  "Highlight playoff field"), then `.segmented` right-aligned (`ml-auto`; full width with equal
  segments on phones): "12 teams · 2026 format" | "24 teams · proposed" (below 360px "12 · 2026
  format" | "24 · proposed", so both fit 288px). Selecting 24 shows under the controls: the one-line
  rules, "Proposed for 2027 — not final" (`label-caps text-fg-muted`), source link (`.link`).
- **Legend** (13px `fg-muted`, under the controls): the delta triangle, the field ring, `AQ`
  (automatic bid tag, also on the tiles), Unseen / Not shown. "NR" marks positions past what the
  selected source ranked (committee 25; the fans' list length). The Fans tab's next five shows only
  the fans' own teams past 25 (as many as they ranked, up to five), then "The fans' ranking stops at
  N teams so far."
- **Grid (>= 640px):** `grid grid-cols-5 gap-x-3 gap-y-3.5` of tiles (team block, tile size).
  >= 1024px: `grid lg:grid-cols-[minmax(0,5fr)_minmax(0,1fr)] gap-6`; right column `lg:border-l
  lg:border-line lg:pl-6`, `label-caps` "First 5 out", tiles 26-30 in one column. 640-1023px: the
  first five out is a 5-column row under the grid.
- **List (< 640px):** `flex flex-col gap-2`; each row = `team-block h-12` (row size, record as
  meta) + a 76px right cell on `page`: `label-caps text-fg-muted` "CFP 6" + `.delta` inline.
- **Compare with committee:** under each tile a 16px line `mt-1.5 flex justify-between px-0.5`:
  `label-caps text-fg-muted` "CFP 6" ("CFP NR" when unranked) and `.delta` up/down (omitted when
  equal). Delta = committee rank minus your rank (positive = you rank them higher = up).
- **Highlight playoff field:** `data-in-field` on the team block: a 2px `accent-edge` ring at 2px
  offset (box-shadow, so the 3px `fg` focus outline stays distinct) + accent seed plate. Field = the
  selected format's field.
- **Unseen:** tag `label-caps rounded-slab bg-raised-2 px-1 text-fg` "Unseen" in the tile's
  under-line (right side), never on the color block.

```html
<li>
  <a href="/teams/kentucky" class="team-block min-h-16 pr-3" data-in-field style="…teamVars…">
    <span class="seed-plate min-w-9">3</span><span class="text-team line-clamp-2 min-w-0 flex-1 pl-2.5">Kentucky</span>
  </a>
  <div class="mt-1.5 flex h-4 items-center justify-between px-0.5">
    <span class="label-caps text-fg-muted">CFP 6</span>
    <span class="delta" data-dir="up">3<span class="sr-only"> spots above the committee</span></span>
  </div>
</li>
```

- **Bracket header:** `cond text-heading uppercase` "12-team bracket" + `text-sm text-fg-muted`
  "Seeds from your ranking · seeds 1-4 have first-round byes", `border-b border-line pb-2`.
- **Game box:** `flex flex-col gap-0.5 rounded-chip border border-line bg-surface p-1`, two slot-size
  team blocks (seed in the plate). Undecided slot: same height, `rounded-slab bg-raised
  border-b-4 border-transparent`, empty plate `–` in `fg-faint`, text condensed 600 15px
  `fg-muted` "Winner 8 v 9" / "Winner SF 1".

```html
<li class="relative flex items-center py-2 after:absolute after:top-1/2 after:left-full after:h-px after:w-8 after:bg-line-strong">
  <div class="relative z-[1] flex w-full flex-col gap-0.5 rounded-chip border border-line bg-surface p-1">
    <a class="team-block h-9 pr-2.5" style="…"><span class="seed-plate min-w-8 text-[1.125rem]">8</span><span class="min-w-0 flex-1 truncate pl-2.5 text-[0.9375rem] leading-4">UCLA</span></a>
    <a class="team-block h-9 pr-2.5" style="…"><span class="seed-plate min-w-8 text-[1.125rem]">9</span><span class="min-w-0 flex-1 truncate pl-2.5 text-[0.9375rem] leading-4">BYU</span></a>
  </div>
</li>
```

- **Desktop bracket (>= 1024px):** one grid column per round, `gap-x-8`, `label-caps` round
  headers. Each column is an `ol` with `grid grid-rows-N` (12-team: 4 / 4 / 2 / 1; 24-team:
  8 / 8 / 4 / 2 / 1) so every game is vertically centered on its feeders. Connectors are 1px
  `line-strong`: a full-gap stub from a game into the next column when the pairing is 1:1
  (first round → bye game), else a 16px stub out of each game plus a `]` on the receiving game
  (`before:absolute before:right-full before:top-1/4 before:bottom-1/4 before:w-4 before:border-y
  before:border-r`). Top-to-bottom order (12): 8v9→1, 5v12→4, 6v11→3, 7v10→2 (from
  `buildBracket`). 24-team at 1024-1279px: wrap in `overflow-x-auto` with `min-w-[68rem]`.
- **Phone bracket (< 1024px, 390px reference):** one round at a time. A full-width `.segmented`
  (`role="tablist"`): First round | Quarters | Semis | Final (24: Round 1 | Round 2 | Quarters |
  Semis | Final, scrolls horizontally). Below it the round's games stacked `gap-2.5`, full width
  (358px), each game box adds a 13px line "Winner plays **Miami** (1) in the quarterfinals". Bye
  games list the seeded team + "Winner 8 v 9". No connectors, no horizontal scroll.
- **Bid lists:** two columns (`sm:grid-cols-2`, `border-t border-line pt-5`): `label-caps`
  "Automatic bids · 5 highest-ranked champions" / "At-large · 7", then `.team-chip` links
  `flex flex-wrap gap-x-4 gap-y-2`.
- **Agreement sentence:** `text-lg`, numbers `cond text-[1.25rem] text-accent` (the user's own).
- **Share module:** `rounded-card border border-line bg-surface p-4`: preview of the share image
  (1200x630, `rounded-chip`), buttons `btn btn-primary` "Share" (Web Share), `btn btn-secondary`
  "Copy link" (label flips to "Copied" for 2s with `aria-live`), `btn btn-secondary` "Save image".
- One ad slot (`incontent`) just above the share module (after the bracket, bids and agreement
  line), outside the play area; a plain div like the content slots.

## 14. Content pages

Typographic, tables not cards; light or dark by OS. `max-w-page`, `px-gutter lg:px-gutter-lg`.

- **Site header:** `h-14 border-b border-line`; wordmark `cond 20px 700 uppercase` with an
  `accent` middot; nav `text-sm text-fg-muted`, current page `text-fg`. Footer: `border-t
  border-line py-6 text-sm text-fg-muted`, always "Ratings: FEI by Brian Fremeau" linking to
  `https://bcftoys.com/{season}-fei` + data credits.
- **Breadcrumb/kicker:** `label-caps text-fg-muted` above every h1.
- **Team page header:** hero team block (`h-[4.5rem] sm:h-24`, name `cond text-title
  sm:text-display uppercase pl-4 sm:pl-6`, right meta: record 20/28px + "ACC 6-0" 13/15px;
  independents show the record only). Below, the **four ranks + committee rank** as a stat row
  `dl grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-5 mt-5`: Committee first (phones: `col-span-2`;
  desktop: `sm:border-r sm:border-line sm:pr-6`), `label-caps text-fg-muted` label, `cond
  text-stat-lg` "#1" ("NR" if unranked), then a 6px bar: every rank, the committee's included, is a
  `.meter` with the tier color of its rank band and `rankFill` (`track` when unranked), so a #20
  committee bar is never longer than a #14 strength of record. Strength of record and schedule add
  one plain line under the bar ("1.22 more wins than a good team would expect on this schedule",
  "An elite team would expect 1.25 losses on this schedule"), the raw value below in `fg-muted`.
- **Status line** under the hero: one sentence from the committee's projected fields ("By the
  committee's ranking, Ohio State would be the 1st team out of the 12-team field and the No. 12
  seed in the proposed 24-team field.").
- **Resume highlights** (team page Resume section and compare cards): record vs the committee top
  25, best win, worst loss (`resumeHighlights()` in site.ts).
- **Labels:** the strength-of-record (GWD) rank is "SoR" in tight spots (columns, chips, "SoR 16"),
  "FEI strength of record" / "Strength of record" in prose. Bare "FEI" only ever means FEI overall
  (`ranks.fei`) or the system; `scripts/content-verify.mjs` fails on a bare "FEI 16"-style label.
- **Jump nav** (`JumpNav`): a grid of 44px chips, 2 columns on phones, equal columns >= 10.5rem
  from 640px: every chip visible (no hidden sideways scroll), and the row count never depends on
  text width, so a late font swap cannot re-wrap it.
- **Committee vs FEI callout:** `.callout mt-8`: `label-caps` "Committee vs FEI" + one 18px
  sentence with ranks in `cond 20px 700`: "The committee has Miami **#1**. FEI's strength of
  record puts them **#3**, two spots lower."
- **Tables:** `.table-wrap` > `table.data-table`; team cells use `.team-chip` links; numeric
  columns `data-num`; results as `.result-chip`; score `pf-pa` in the condensed numeric cell.
  Game log columns: Opponent | Tier (stars + tier label in `fg-muted`) | Site | Result | Score.
  Under 640px drop the Date and Site columns, the tier label (stars keep their `aria-label`) and
  shorten the head to "Tier"; the site (and "CFP N") becomes a second line under the opponent
  (`pl-5 text-[0.8125rem] leading-4 text-fg-muted`), the date a second line under the score, and
  inner cell padding drops to 6px, so the table fits 328px (a 360px phone) without scrolling. Non-FBS opponents: `.team-chip` with
  `--team-bg: var(--color-raised-2)` (default rule), not a link. Rankings
  tables: Rank | Team | Record | SoR (or CFP) | SoR vs CFP delta; cut lines for "in the 12" and "in the 24
  (proposed)" as `tr[data-cut]` + a right-aligned `label-caps text-accent` note in the last cell.
- **Still to play** (team page, after the game log; `UpcomingTable` from `upcomingRows`): h2 + one
  muted line ("4 games left · 1 vs the committee's top 25 · toughest: at Notre Dame (FEI 1-5
  team)"), then a `data-table` in date order: Date | Opponent (chip + `CFP N`) | Opponent tier
  (stars + label) | Site (· Conf for conference games). Under 640px the site and CFP rank fold into
  a second line under the opponent and the tier label drops (stars keep their name). Hidden when
  the week file has no schedule; "No regular-season games left." when it is empty.
- **Remaining schedule** (compare page): the same table per team, `compact` (always folded), in
  two columns from 768px (`md:grid-cols-2 gap-8`), each under its team chip and summary line.
- **Rank-history strip:** `ol flex gap-1.5 overflow-x-auto`, one cell per week file:
  `w-16 rounded-slab bg-surface px-2 py-1.5` with `label-caps` "Wk 9", `cond 24px 700` GWD
  "#3", `label-caps text-fg-muted` "CFP 1" ("CFP —" before the first release).
- **Compare page:** two un-blinded cards side by side (`md:grid-cols-2 gap-5`; stacked on phones),
  each with its hero team block (reveal size) on top instead of the redacted header. Above them a
  head-to-head note (same style as the H2H flag) and a two-line verdict: "Committee: A (#4) over
  B (#9)" / "FEI strength of record: B (#6) over A (#11)", team names as `.team-chip`.
- **Bubble:** a `data-table` of committee 8-20 sorted by GWD rank; the gap column uses `.delta`; the
  gap chart is drawn in % of its column (fills any width). In/out cells: "In 10" / "2nd out" / "Out"
  (one out-wording everywhere: `outText()` = "1st out"), 14px with 4px padding on phones.
- **Play pitch** (`PlayCta`): `rounded-card border border-line bg-surface p-5`, kicker, one
  question in condensed caps, one line, `btn btn-primary` "Rank them blind" to `/#play`. On compare,
  bubble and team pages; never inside an ad slot.
- **Compare hub** (`/compare`): neighbors in the ranking, the cut-line matchups (`CutPairs`), then a
  no-JS `<details>` per committee team with all of its compares.

## 15. Ad slots

```html
<div class="ad-slot" data-kind="incontent">
  <span class="ad-label">Advertisement</span>
  <div class="ad-box"><!-- creative --></div>
</div>
```

A plain div with the visible label, not a landmark (two `aside aria-label="Advertisement"` on one
page were two identically named landmarks). The ad loader is injected only on pages that render a
slot (`BaseLayout ads`).

Reserved creative heights = the tallest unit the slot's width accepts: `leaderboard` 100px phones /
90px >= 768 (max 728 wide); `incontent` 280px (max 336, so a 336x280 fill cannot grow it);
`sidebar` 280px phones (max 336), 600px sticky (`top-6`) >= 1024 in a 300px right column
(`lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10`). Hairlines above/below, label
`fg-faint`. Nothing else may look like this (no ads styled as content); never inside cards or
modals.

## 16. OG images (1200x630, rectangles + Barlow Condensed glyphs only)

No rounded corners, gradients or images, so the build-time resvg renderer and the Worker glyph
atlas produce identical results. Colors from `colors.dark` / `teamPaint()`; text widths from the
TTF advance widths (`src/assets/fonts/BarlowCondensed-{600,700}.ttf`).

**Team image** (`public/og/teams/{slug}.png`):
- Page `#0e0f12`. Color block x 0-1200, y 0-300 in primary (1px `#3a3f49` inset stroke when
  `teamPaint().edge`), 12px secondary rule y 300-312.
- Kicker x 56 baseline 96: condensed 600 36px, +2 tracking, ink: "ACC · CONF 6-0" (conference
  only for independents). Name x 56 baseline 250: 700 caps, 150px, shrink by 2px to fit
  `1088 - recordWidth - 48` (min 72px). Record right-aligned at x 1144 baseline 250, 700 120px.
- Stat row y 312-558: five cells of 217.6px from x 56: label 600 caps 26px (shrink to fit cell
  minus 24, min 20) `fg-muted` baseline 388; numeral 700 92px `fg` baseline 478; bar y 500 h 10,
  width cell minus 28, `track` + fill: every bar, the committee's included, is the tier color of its
  rank band x `rankFill` (a #20 committee rank must not draw a full bar). Order: Committee, Strength of record, Offense, Defense, Schedule.
- Footer y 558-630 `surface`: "CFBBLINDRESUME.COM" 700 32px +1.5 tracking `fg` at x 56 baseline
  605; right-aligned at x 1144 "After Week 9 · Ratings: FEI by Brian Fremeau" 600 28px `fg-muted`.

**Share image** (user's top 12, `/og/r/{code}.png`):
- Page `#0e0f12`; 8px `accent-fill` bar at the top.
- "MY TOP 12" 700 76px `fg` x 56 baseline 104; right-aligned "AFTER WEEK 9 · 2026" 600 30px
  +2 tracking `fg-muted` baseline 102 (66 when the hook is drawn).
- Hook (right-aligned, baseline 104, 600 28px, +0.3 tracking): "Matched the committee on **43%** ·
  Biggest call: **Kentucky** ▲4" (`fg-muted`, the percentage in `accent`, the team and number in
  `fg`, the triangle drawn as rectangles 15x13 in `win`/`loss`). Biggest call = the top-12 team
  furthest from its committee rank (unranked by the committee counts as 26 − position). Shorter
  wordings are used when it does not fit beside the title; no committee: "Matched FEI on 65%".
- Two columns of six rows: x 56 and 628, width 516, rows 60px tall, 12px apart, from y 140.
  Each row: seed plate 64x60 (`accent-fill` + `on-accent` numeral for seeds 1-4 (byes),
  `raised-2` + `fg` otherwise), numeral 700 40px centered baseline +44; color block 452x60 in
  primary with a 6px secondary rule at its bottom; name 700 caps 34px (shrink to 26) in ink at
  +20, baseline +42; record 600 30px right-aligned at -18.
- Footer baseline 600: "Same game. Different numbers." 600 28px `fg-muted` left; right-aligned
  "CFBBLINDRESUME.COM · RATINGS: FEI BY BRIAN FREMEAU" 600 26px +1.5 tracking.
- Atlas glyph sizes needed: 76, 40, 34 (down to 26), 30, 28, 26 at weights 700/600 (600/28 also
  carries mixed-case names and `%` for the hook).

Reference renders (resvg, real data): see the mock list at the end.

## 17. Icons

`public/favicon.svg`: a ranked list of three lower-thirds (light plates, slabs of decreasing
length: accent, `fg-muted`, dim grey) on a `#0e0f12` rounded square. `public/apple-touch-icon.png`
(180, full bleed) and `public/site.webmanifest` match.

## 18. Do / don't

- Do: lower-third slabs, square-ish shapes, condensed caps, tabular numerals, the tier ramp,
  accent only for the user.
- Don't: slanted or skewed badges, sunburst/ray backgrounds, dashed card borders, question-mark
  badges, red accents, neon glows, logos, script/slab/serif display fonts (Graduate, Rye, Oswald),
  colored text on team blocks other than the computed ink, color-only meaning.

## 19. Reference mocks

Rendered from a throwaway Astro build of these exact classes
(scratchpad `design/astro-mock`, built into `design-dist`):
`design/game-1280.png`, `design/game-390.png` (cards, sticky rank bar/footer),
`design/results-1280.png`, `design/results-390-top.png`, `design/results-390-bracket.png`,
`design/reveal-390.png`, `design/reveal-1280.png`, `design/done-390.png`,
`design/team-1280-light.png`, `design/team-390-light.png`, `design/team-1280.png` (dark),
`design/swatches-1280.png` (tier ramp, both themes), `design/og-team-*.png`,
`design/og-share.png`, `design/favicon-preview.png`.
