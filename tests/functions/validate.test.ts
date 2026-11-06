import { describe, expect, it } from 'vitest';
import { EVENT_RULES, isSlug, parseEvent, parseTrioParam, parseVote, validSeasonWeek, voteInPool } from '../../functions/_lib/validate';

describe('parseVote', () => {
  const ok = { season: 2026, week: 9, order: ['miami', 'georgia', 'utah'] };

  it('accepts a well-formed vote and keeps the user order', () => {
    expect(parseVote(ok)).toEqual({ ok: true, value: { season: 2026, week: 9, order: ['miami', 'georgia', 'utah'] } });
    expect(parseVote({ ...ok, extra: 'ignored' }).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', [1, 2, 3]],
    ['a string', 'miami'],
    ['season as a string', { ...ok, season: '2026' }],
    ['a fractional week', { ...ok, week: 9.5 }],
    ['a season out of range', { ...ok, season: 1999 }],
    ['a negative week', { ...ok, week: -1 }],
    ['two teams', { ...ok, order: ['miami', 'georgia'] }],
    ['four teams', { ...ok, order: ['miami', 'georgia', 'utah', 'byu'] }],
    ['a repeated team', { ...ok, order: ['miami', 'miami', 'utah'] }],
    ['an uppercase slug', { ...ok, order: ['Miami', 'georgia', 'utah'] }],
    ['a slug with spaces', { ...ok, order: ['ohio state', 'georgia', 'utah'] }],
    ['a non-string slug', { ...ok, order: [1, 'georgia', 'utah'] }],
    ['no order', { season: 2026, week: 9 }],
  ])('rejects %s', (_label, body) => {
    const r = parseVote(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
  });
});

describe('helpers', () => {
  it('isSlug', () => {
    expect(isSlug('texas-am')).toBe(true);
    expect(isSlug('a')).toBe(true);
    expect(isSlug('-texas')).toBe(false);
    expect(isSlug('texas--am')).toBe(false);
    expect(isSlug('x'.repeat(65))).toBe(false);
    expect(isSlug('<script>')).toBe(false);
  });

  it('validSeasonWeek', () => {
    expect(validSeasonWeek(2026, 0).ok).toBe(true);
    expect(validSeasonWeek(2256, 1).ok).toBe(false);
    expect(validSeasonWeek(2026, 31).ok).toBe(false);
    expect(validSeasonWeek(null, 1).ok).toBe(false);
  });

  it('voteInPool names the teams outside the pool', () => {
    expect(voteInPool(['a', 'b', 'c'], ['a', 'b', 'c', 'd']).ok).toBe(true);
    const r = voteInPool(['a', 'x', 'c'], new Set(['a', 'b', 'c']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('x');
  });

  it('parseTrioParam', () => {
    expect(parseTrioParam('a,b,c')).toEqual({ ok: true, value: ['a', 'b', 'c'] });
    expect(parseTrioParam(null).ok).toBe(false);
    expect(parseTrioParam('a,b').ok).toBe(false);
    expect(parseTrioParam('a,a,b').ok).toBe(false);
  });
});

describe('parseEvent', () => {
  it('accepts every event the island sends (src/game/api.ts track())', () => {
    // The island sends { name, prop: String(first prop) | null, props }.
    expect(parseEvent({ name: 'round_completed', prop: '3', props: { round: 3 } })).toEqual({ ok: true, value: { name: 'round_completed', prop: '3' } });
    expect(parseEvent({ name: 'run_completed', prop: '15', props: { rounds: 15 } })).toEqual({ ok: true, value: { name: 'run_completed', prop: '15' } });
    expect(parseEvent({ name: 'results_shared', prop: 'webshare', props: { channel: 'webshare' } })).toEqual({ ok: true, value: { name: 'results_shared', prop: 'webshare' } });
    expect(parseEvent({ name: 'skip_to_results', prop: '6' }).ok).toBe(true);
    expect(parseEvent({ name: 'reveal_disabled', prop: null, props: {} })).toEqual({ ok: true, value: { name: 'reveal_disabled', prop: '' } });
    expect(parseEvent({ name: 'do_another', prop: '15' }).ok).toBe(true);
    expect(Object.keys(EVENT_RULES).sort()).toEqual(['do_another', 'results_shared', 'reveal_disabled', 'round_completed', 'run_completed', 'skip_to_results']);
  });

  it('accepts numbers and a props-only body, normalizing the value', () => {
    expect(parseEvent({ name: 'round_completed', prop: 7 })).toEqual({ ok: true, value: { name: 'round_completed', prop: '7' } });
    expect(parseEvent({ name: 'round_completed', props: { round: 12 } })).toEqual({ ok: true, value: { name: 'round_completed', prop: '12' } });
    expect(parseEvent({ name: 'round_completed', prop: '07' })).toEqual({ ok: true, value: { name: 'round_completed', prop: '7' } });
  });

  it.each([
    ['an unknown name', { name: 'page_view', prop: null }],
    ['a prototype key', { name: '__proto__', prop: null }],
    ['round 0', { name: 'round_completed', prop: '0' }],
    ['round 31', { name: 'round_completed', prop: '31' }],
    ['free text', { name: 'results_shared', prop: 'twitter.com/someone' }],
    ['a prop on a prop-less event', { name: 'reveal_disabled', prop: 'x' }],
    ['a missing prop', { name: 'round_completed' }],
    ['an object prop', { name: 'round_completed', prop: { round: 3 } }],
  ])('rejects %s', (_l, body) => {
    expect(parseEvent(body).ok).toBe(false);
  });
});
