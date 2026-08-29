import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No message may describe a read by `SAMPLE_LIMIT`.
 *
 * The constant is a ceiling, not a measurement. `SampleStore` stops at it *or*
 * at a time budget, whichever comes first, so a slow read of a 10.000-object
 * type is truncated at whatever it reached — and every caption saying so said
 * "the first 4.000 objects" regardless, because they formatted the constant.
 * The count travels beside the flag now, but nothing stopped the next caption
 * reaching for the constant again: a unit test of `sampledObjects` cannot,
 * since the count is its only argument and no assertion it makes can tell
 * which number it was handed.
 *
 * This is the check that can. It is about the shape rather than about a list
 * of call sites, because a hand-kept list of who currently gets it right is a
 * month from being one entry behind.
 *
 * What it is: grep that knows the names the ceiling travels under and the ways
 * a number becomes words. It follows the constant through a renamed import and
 * through a binding computed from it, and it reads the formatter names out of
 * `format.ts`. It does not do dataflow, so a value carried through an object
 * property, a function's return, or a parameter is past what it can see. That
 * is the honest boundary rather than a claim to catch everything, and every
 * shape it does claim is a case below rather than a sentence up here.
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

/**
 * Names that hold the ceiling, read out of the tree rather than listed: an
 * alias launders it past a check that only knows the original, and
 * `COPY_LIMIT` in `viz/object-table.ts` is exactly that alias, in a file that
 * writes captions.
 *
 * Collected across the whole tree rather than per file, because an alias is
 * worth exporting — bound in `sample-store.ts` and worded in a view, it would
 * be invisible to a check that only looked at one file at a time.
 */
const CEILING = 'SAMPLE_LIMIT';
const BINDINGS = [
  // Any binding whose value is worked out from the ceiling, not only one bound
  // straight to it: `const read = Math.min(SAMPLE_LIMIT, total);` is the shape
  // someone reaches for when a count might exceed it, and half the ceiling is
  // no more a measurement than the ceiling is.
  new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*(?::[^=;]+)?=\s*[^;]*\b${CEILING}\b[^;]*;`, 'g'),
  // import { SAMPLE_LIMIT as READ_CAP } — renamed at the door.
  new RegExp(String.raw`\b${CEILING}\s+as\s+(\w+)`, 'g'),
];
const aliasesIn = (source: string): string[] =>
  BINDINGS.flatMap((pattern) =>
    [...source.matchAll(pattern)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined),
  );

/** `SAMPLE_LIMIT` where a formatter or a template will turn it into words. */
const WORDED = [
  // Interpolated into a sentence, however it is dressed: `${SAMPLE_LIMIT}`,
  // `${formatCount(SAMPLE_LIMIT)}`, `${SAMPLE_LIMIT.toLocaleString()}`.
  (names: string) => new RegExp(String.raw`\$\{[^{}]*\b(?:${names})\b[^{}]*\}`, 'g'),
  // Handed to a formatter: wrapped across lines, with arguments beside it, or
  // through an inner call — `sampledObjects(Math.min(SAMPLE_LIMIT, total))` is
  // what someone reaches for when a count might exceed the ceiling, and is the
  // likeliest way it comes back. `[^)]*` crosses the inner bracket; a pattern
  // that balanced them could not, having consumed the call whole.
  (names: string) =>
    new RegExp(String.raw`\b(?:${formatters.join('|')})\s*\(\s*[^)]*\b(?:${names})\b`, 'g'),
  // Concatenated rather than interpolated. A template literal is the house
  // style, but `'the first ' + SAMPLE_LIMIT + ' objects'` is the same caption
  // and was walking past both patterns above.
  (names: string) =>
    new RegExp(String.raw`['"\`][^'"\`\n]*['"\`]\s*\+[^;\n]*\b(?:${names})\b`, 'g'),
  (names: string) =>
    new RegExp(String.raw`\b(?:${names})\b[^;\n]*\+\s*['"\`]`, 'g'),
  // A method on the constant is only ever called to display it.
  (names: string) => new RegExp(String.raw`\b(?:${names})\s*\.\s*\w+\s*\(`, 'g'),
];

/** True where any pattern would report this source. */
const worded = (source: string, names: string): boolean =>
  WORDED.some((build) => build(names).test(source));

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesIn(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

const sources = tsFilesIn(SRC).filter((file) => !file.endsWith('.test.ts'));

/** Every name the ceiling is bound to anywhere, so one file's alias is known in all. */
const names = [
  CEILING,
  ...new Set(sources.flatMap((file) => aliasesIn(readFileSync(file, 'utf8')))),
].join('|');

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

  it('follows the ceiling through the names it is bound to', () => {
    expect(aliasesIn('const COPY_LIMIT = SAMPLE_LIMIT;')).toEqual(['COPY_LIMIT']);
    expect(aliasesIn('let cap = SAMPLE_LIMIT;')).toEqual(['cap']);
    expect(aliasesIn('const cap: number = SAMPLE_LIMIT;')).toEqual(['cap']);
    expect(aliasesIn("import { SAMPLE_LIMIT as READ_CAP } from './sample-store';")).toEqual([
      'READ_CAP',
    ]);
    expect(aliasesIn('const read = Math.min(SAMPLE_LIMIT, total);')).toEqual(['read']);
    expect(aliasesIn('const half = SAMPLE_LIMIT / 2;')).toEqual(['half']);
    expect(aliasesIn('if (n >= SAMPLE_LIMIT) return;')).toEqual([]);
  });

  // Each shape written out rather than described, because a comment claiming
  // a pattern catches something is exactly what went unchecked here before: a
  // nested call was said to be covered while only the template-literal pattern
  // happened to be catching it, and a call outside one walked past.
  it.each([
    ['a plain revert', 'the first ${formatCount(SAMPLE_LIMIT)} objects', true],
    ['a bare interpolation', 'the first ${SAMPLE_LIMIT} objects', true],
    ['a dressed-up one', 'the first ${SAMPLE_LIMIT.toLocaleString()} objects', true],
    ['a wrapped call', 'sampledObjects(\n  SAMPLE_LIMIT,\n)', true],
    ['a nested call, in a template', '`from ${sampledObjects(Math.min(SAMPLE_LIMIT, n))}.`', true],
    ['a nested call, outside one', 'const note = sampledObjects(Math.min(SAMPLE_LIMIT, n));', true],
    ['an alias', 'sampledObjects(COPY_LIMIT)', true],
    ['a concatenation, ceiling last', "note = 'the first ' + SAMPLE_LIMIT;", true],
    ['a concatenation, ceiling first', "note = SAMPLE_LIMIT + ' objects read';", true],
    ['a method called on it', 'note = SAMPLE_LIMIT.toLocaleString();', true],
    ['a comparison', 'if (objects.length >= SAMPLE_LIMIT) break;', false],
    ['arithmetic on it', 'Math.ceil(SAMPLE_LIMIT / PAGE)', false],
    ['a formatter given a real count', 'sampledObjects(Math.min(999, total))', false],
  ])('is reported for %s: %s', (_name, source, reported) => {
    expect(worded(source, `${CEILING}|COPY_LIMIT`)).toBe(reported);
  });

  // Reads each file whole rather than line by line, because a call wrapped
  // across two lines is exactly the shape a per-line check would miss.
  it('never puts the ceiling into words', () => {
    const offenders = sources.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return WORDED.flatMap((build) =>
        [...source.matchAll(build(names))].map((match) => {
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
