/**
 * Resume strip layout (src/components/resume-strip.ts): the strip never scrolls sideways; it wraps
 * into balanced rows, and its width buckets match the container rules in src/styles/season-strip.css.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripFit, STRIP_FIT_STEP } from '../src/components/resume-strip';

const css = readFileSync(fileURLToPath(new URL('../src/styles/season-strip.css', import.meta.url)), 'utf8');

describe('stripFit', () => {
  it('splits a season into balanced rows', () => {
    expect(stripFit(12, 44)).toMatchObject({ half: 6, third: 4 });
    expect(stripFit(9, 44)).toMatchObject({ half: 5, third: 3 });
    expect(stripFit(13, 44)).toMatchObject({ half: 7, third: 5 });
  });

  it('rounds the widths up to a bucket the stylesheet has a rule for', () => {
    for (let n = 1; n <= 16; n++) {
      for (const col of [40, 44, 48, 52, 60]) {
        const { one, two } = stripFit(n, col);
        expect(one % STRIP_FIT_STEP).toBe(0);
        expect(one).toBeGreaterThanOrEqual(Math.min(n * col, 1040));
        expect(two).toBeGreaterThanOrEqual(Math.min(Math.ceil(n / 2) * col, 1040));
        expect(css).toContain(`(width < ${one}px) { .season-strip[data-fit-1="${one}"]`);
        expect(css).toContain(`(width < ${two}px) { .season-strip[data-fit-2="${two}"]`);
      }
    }
  });
});
