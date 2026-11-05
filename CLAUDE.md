# cfbblindresume

Independent CFP resume site (blind-resume game + static resume pages). Read SPEC.md before
changing anything: it is the contract (data schema in src/lib/types.ts, algorithms, site map,
design, house rules). Key rules: no ESPN-produced metrics or the strings ESPN/FPI/SP+/Game Control
outside /about; no logos; content pages work without JS; everything data-driven from
data/{season}/week-N.json; FEI attribution on every card and content page.

Commands: `npm run build`, `npm test`, `npm run check`, `npm run pipeline`, `npm run validate`.
