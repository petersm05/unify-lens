import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No message may describe a read by `SAMPLE_LIMIT`.
 *
 * The constant is a ceiling, not a measurement. `SampleStore` stops at it *or*
 * at a time budget, whichever comes first, so a slow read of a 10.000-object
 * type is truncated at whatever it reached — and five captions said "the first
 * 4.000 objects" regardless, because they formatted the constant. The count
 * travels beside the flag now, but nothing stopped the next caption reaching
 * for the constant again: a unit test of `sampledObjects` cannot, since the
 * count is its only argument and it has no way to tell which number it was
 * handed.
 *
 * This is the check that can. It is deliberately about the shape rather than
 * about a list of call sites, because a hand-kept list of who currently gets
 * it right is a month from being one entry behind.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * The functions that turn a number into words, read out of `format.ts` rather
 * than listed here — a list would be the thing that falls behind, which is the
 * defect this file exists to stop rather than to repeat.
 */
const formatters = [...readFileSync(join(SRC, 'format.ts'), 'utf8').matchAll(/export function (\w+)/g)]
  .map((match) => match[1])
  .filter((name): name is string => name !== undefined);

/** `SAMPLE_LIMIT` where a formatter or a template will turn it into words. */
const WORDED = [
  // Interpolated into a sentence, however it is dressed: `${SAMPLE_LIMIT}`,
  // `${formatCount(SAMPLE_LIMIT)}`, `${SAMPLE_LIMIT.toLocaleString()}`.
  /\$\{[^{}]*\bSAMPLE_LIMIT\b[^{}]*\}/g,
  // Handed to a formatter, wrapped across lines or with arguments beside it.
  new RegExp(String.raw`\b(?:${formatters.join('|')})\s*\(\s*[^()]*\bSAMPLE_LIMIT\b`, 'g'),
];

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesIn(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

const sources = tsFilesIn(SRC).filter((file) => !file.endsWith('.test.ts'));

describe('a caption describing a partial read', () => {
  // A check that quietly stops checking is worse than none: if the walk ever
  // finds nothing, this fails rather than passing on an empty set.
  it('is looked for across the whole source tree', () => {
    expect(sources.length).toBeGreaterThanOrEqual(20);
  });

  // An empty list would leave the second pattern matching any open bracket at
  // all, which is a check that has stopped checking while still passing.
  it('knows which functions turn a number into words', () => {
    expect(formatters).toContain('sampledObjects');
    expect(formatters.length).toBeGreaterThanOrEqual(4);
  });

  // Reads each file whole rather than line by line, because a call wrapped
  // across two lines is exactly the shape a per-line check would miss.
  it('never puts the ceiling into words', () => {
    const offenders = sources.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return WORDED.flatMap((pattern) =>
        [...source.matchAll(pattern)].map((match) => {
          const line = source.slice(0, match.index).split('\n').length;
          return `${relative(SRC, file)}:${line} — ${match[0].replace(/\s+/g, ' ')}`;
        }),
      );
    });

    // Where this fails: the producer already carries how many objects were
    // read — `Distribution.sampled`, `Trend.sampled`, the scatter's result, or
    // `TableResult.total` on a sample sort. Pass that to `sampledObjects`.
    // Comparing against the constant is fine; describing a read with it is not.
    expect(offenders).toEqual([]);
  });
});
