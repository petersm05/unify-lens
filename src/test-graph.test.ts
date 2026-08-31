import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No test may reach the SDK at run time.
 *
 * The bundle is CommonJS underneath, so the runner's ESM loader cannot take a
 * named export out of `ts-results` and dies *collecting* the file — which
 * fails the whole suite while reporting every other test as passing, and takes
 * the deploy with it, because `pages.yml` tests before it builds. That is not
 * a hypothetical: it happened, twice, and the site sat on a stale build until
 * someone thought to look at the pipeline.
 *
 * CI already catches it. What it cannot do is say what the author did wrong —
 * the symptom is `SyntaxError: Named export 'Ok' not found` pointing at
 * `sdk/metamodel.ts`, which names neither the test nor the import that reached
 * it. This says both.
 *
 * The rule is worth keeping for its own sake as well. Loading the whole SDK to
 * check a quantile is slow, and it would make the suite depend on a package
 * that cannot be installed without an organisation token — so the tests would
 * stop running for anyone outside it.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const SDK = '@bizzdesign';

/**
 * Specifiers a module pulls in *at run time*.
 *
 * `import type { X } from 'm'` is erased and does not count — which is why the
 * existing tests may take `MetaModel` and `ObjectType` straight from the SDK.
 * `import { type X } from 'm'` is a different statement and does count: under
 * `verbatimModuleSyntax` it still emits `import {} from 'm'`, so the module is
 * loaded even though nothing is bound. Leading `import type` is therefore the
 * whole test, and it is exactly right.
 */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  // A character class matches newlines, so a multi-line import body is covered
  // without needing the dot-all flag.
  const statement = /^[ \t]*(?:import|export)(?<erased>[ \t]+type)?[ \t\n]+(?:[^'"]*?\sfrom\s+)?['"](?<spec>[^'"]+)['"]/gm;

  const specifiers: string[] = [];
  for (const match of source.matchAll(statement)) {
    if (match.groups?.['erased']) continue;
    const spec = match.groups?.['spec'];
    if (spec !== undefined) specifiers.push(spec);
  }
  return specifiers;
}

/** A relative specifier as a file on disk, or null for a package. */
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(from), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesIn(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

/**
 * The chain from a test to the SDK, or null when it never gets there.
 *
 * Breadth-first, so the chain reported is the shortest one — the import
 * closest to the test is the one its author can most easily do something
 * about.
 */
function routeToSdk(entry: string): string[] | null {
  const queue: string[][] = [[entry]];
  const seen = new Set([entry]);

  while (queue.length > 0) {
    const route = queue.shift()!;
    const current = route[route.length - 1]!;

    for (const spec of runtimeImports(current)) {
      if (spec.startsWith(SDK)) return [...route, spec];

      const next = resolveSpec(current, spec);
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      queue.push([...route, next]);
    }
  }
  return null;
}

const testFiles = tsFilesIn(SRC).filter((file) => file.endsWith('.test.ts'));

describe('the test suite', () => {
  // A check that quietly stops checking is worse than no check. If the walk
  // ever finds nothing — a moved directory, a changed suffix — this fails
  // rather than passing on an empty set.
  it('is found by this guard at all', () => {
    expect(testFiles.length).toBeGreaterThanOrEqual(6);
  });

  it('never reaches the SDK at run time', () => {
    const reached = testFiles
      .map((file) => ({ file, route: routeToSdk(file) }))
      .filter((entry) => entry.route !== null)
      .map(({ file, route }) => {
        const hops = route!.map((step) => (step.startsWith(SDK) ? step : relative(SRC, step)));
        return `${relative(SRC, file)} reaches the SDK: ${hops.join(' → ')}`;
      });

    // Where this fails: the pure part of what you are testing wants to be its
    // own module, importing types only, the way `table-columns.ts` was split
    // out of `object-table.ts`. Do not reach for a loader shim — the SDK in a
    // unit test is the thing being avoided, not an obstacle to it.
    expect(reached).toEqual([]);
  });
});
