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

/** `SAMPLE_LIMIT` where a formatter or a template will turn it into words. */
const WORDED = [
  // sampledObjects(SAMPLE_LIMIT), formatCount(SAMPLE_LIMIT), and so on.
  /\b[A-Za-z_$][\w$]*\(\s*SAMPLE_LIMIT\s*\)/,
  // `${SAMPLE_LIMIT}` interpolated straight into a string.
  /\$\{\s*SAMPLE_LIMIT\s*\}/,
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

  it('never puts the ceiling into words', () => {
    const offenders = sources.flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n');
      return lines.flatMap((line, index) =>
        WORDED.some((pattern) => pattern.test(line))
          ? [`${relative(SRC, file)}:${index + 1} — ${line.trim()}`]
          : [],
      );
    });

    // Where this fails: the producer already carries how many objects were
    // read — `Distribution.sampled`, `Trend.sampled`, the scatter's result, or
    // `TableResult.total` on a sample sort. Pass that to `sampledObjects`.
    // Comparing against the constant is fine; describing a read with it is not.
    expect(offenders).toEqual([]);
  });
});
