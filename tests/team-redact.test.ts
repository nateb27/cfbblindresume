/**
 * DOSSIER signature on team colours: in the reveal the redaction bar lifts off each team's name on
 * its primary colour, and team plates must not vanish into the paper / photostat page. For every
 * FBS team in every committed week file, in both schemes:
 * - the bar colour teamVars picks (--team-redact-light / -dark) is >= 3:1 on the primary;
 * - a primary within 1.5:1 of any page/sheet it sits on gets an edge (--team-edge-*);
 * - the 4px rule (--team-rule-light / -dark) never blends into a surface of its scheme (ruleBlends:
 *   within 1.5:1 and without a hue to tell it apart), or is
 *   the primary itself (no rule), so no plate looks 4px short of its row; the share/OG paint uses
 *   the light rule.
 */
import { describe, expect, it } from 'vitest';
import { listSeasons, loadSeasonIndex, loadWeek } from '../src/lib/data-node';
import { colors, contrast, ruleBlends, teamPaint, teamVars } from '../src/styles/tokens';

const weeks = (() => {
  try {
    return listSeasons().flatMap((s) => loadSeasonIndex(s).weeks.map((w) => loadWeek(s, w.week)));
  } catch {
    return [];
  }
})();
const teams = new Map(weeks.flatMap((w) => Object.values(w.teams).map((t) => [t.slug, t] as const)));
const BAR = { light: colors.light.redaction, dark: colors.dark.redaction } as const;
const resolve = (v: string, scheme: 'light' | 'dark') => (v === 'var(--redaction)' ? BAR[scheme] : v);

describe.skipIf(!teams.size)('team colours vs the redaction bar and the page', () => {
  it.each([...teams.values()].map((t) => [t.slug, t] as const))('%s', (_slug, t) => {
    const v = teamVars(t.colors);
    const primary = t.colors.primary.toLowerCase();
    for (const scheme of ['light', 'dark'] as const) {
      const bar = resolve(v[`--team-redact-${scheme}`]!, scheme);
      expect(contrast(bar, primary), `${t.name} ${scheme}: bar ${bar} on ${primary}`).toBeGreaterThanOrEqual(3);
    }
    const lightBgs = [colors.light.page, colors.board.page, colors.board.surface];
    const darkBgs = [colors.dark.page, colors.dark.surface];
    if (lightBgs.some((bg) => contrast(primary, bg) < 1.5)) expect(v['--team-edge-light']).not.toBe('transparent');
    if (darkBgs.some((bg) => contrast(primary, bg) < 1.5)) expect(v['--team-edge-dark']).not.toBe('transparent');
    const surfaces = {
      light: [colors.light.page, colors.light.surface, colors.light.raised, colors.board.page, colors.board.surface, colors.board.raised],
      dark: [colors.dark.page, colors.dark.surface, colors.dark.raised],
    };
    for (const scheme of ['light', 'dark'] as const) {
      const rule = v[`--team-rule-${scheme}`]!;
      if (rule === primary) continue;
      for (const bg of surfaces[scheme]) expect(ruleBlends(rule, bg), `${t.name} ${scheme}: rule ${rule} on ${bg} (${contrast(rule, bg).toFixed(2)}:1)`).toBe(false);
    }
    const paint = teamPaint(t.colors);
    if (paint.rule !== primary) for (const bg of [colors.light.page, colors.light.surface]) expect(ruleBlends(paint.rule, bg)).toBe(false);
  });
});
