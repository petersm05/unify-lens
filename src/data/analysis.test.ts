import { describe, expect, it } from 'vitest';
import type { AttributeFilter, MetaModel, ObjectType } from '@bizzdesign/sdk-bundle/browser';
import {
  decode,
  deserialise,
  encode,
  pathOf,
  serialise,
  viewOf,
  type Analysis,
} from './analysis';
import { ROOT } from './route';
import type { AttributeSelection } from './filter';

const selection: AttributeSelection = {
  choice: {
    categoryId: 'category',
    categoryName: 'Category',
    definitionId: 'criticality',
    name: 'Criticality',
    kind: 'enum',
  },
  label: 'Criticality: Mission Critical',
  binLabel: 'Mission Critical',
  condition: { marker: 'criticality' } as unknown as AttributeFilter<MetaModel>,
};

const analysis: Analysis = {
  v: 1,
  env: 'acme.unify.cloud',
  view: 'attributes',
  primary: 'category.criticality',
  mark: 'bars',
  filters: [selection],
};

/** The shape a link carries, as a plain object a test can bend field by field. */
function payload(): Record<string, unknown> {
  return JSON.parse(serialise(analysis)) as Record<string, unknown>;
}

function accepts(value: unknown): boolean {
  return deserialise(JSON.stringify(value)) !== null;
}

describe('a well-formed analysis', () => {
  it('survives a round trip through the link encoding', () => {
    const restored = decode(encode(analysis));
    expect(restored).toEqual(analysis);
  });

  it('is accepted with only its required fields', () => {
    expect(accepts({ v: 1, env: 'acme', view: 'population' })).toBe(true);
  });

  it('is accepted with no filters at all', () => {
    const { filters: _dropped, ...rest } = payload();
    expect(accepts(rest)).toBe(true);
  });
});

describe('a malformed analysis is refused rather than half-restored', () => {
  it.each([
    ['not an object', 'a string'],
    ['an array', []],
    ['a wrong version', { ...payload(), v: 2 }],
    ['a missing environment', { ...payload(), env: undefined }],
    ['a non-string environment', { ...payload(), env: 7 }],
    ['an unknown view', { ...payload(), view: 'galaxy' }],
    ['an unknown mark', { ...payload(), mark: 'pie' }],
    ['a non-string object type', { ...payload(), type: 42 }],
    ['a non-string primary attribute', { ...payload(), primary: { id: 'x' } }],
    ['filters that are not an array', { ...payload(), filters: 'criticality' }],
  ])('refuses %s', (_case, value) => {
    expect(accepts(value)).toBe(false);
  });

  /**
   * A prototype member is not a value. `'toString' in MARKS` is true, so an
   * `in` check here would accept `mark: 'toString'` and restore a chart with a
   * mark nothing can render.
   */
  it('refuses a mark inherited from Object.prototype', () => {
    expect(accepts({ ...payload(), mark: 'toString' })).toBe(false);
    expect(accepts({ ...payload(), view: 'constructor' })).toBe(false);
  });
});

describe('a filter is checked field by field, since restoring one queries the backend', () => {
  function withFilter(patch: Record<string, unknown>): Record<string, unknown> {
    return { ...payload(), filters: [{ ...selection, ...patch }] };
  }

  function withChoice(patch: Record<string, unknown>): Record<string, unknown> {
    return withFilter({ choice: { ...selection.choice, ...patch } });
  }

  it('accepts the selection the app itself produces', () => {
    expect(accepts(withFilter({}))).toBe(true);
  });

  it.each([
    ['a filter that is not an object', withFilter({ choice: null })],
    ['a missing label', withFilter({ label: undefined })],
    ['a non-string bin label', withFilter({ binLabel: 12 })],
    ['a missing condition', withFilter({ condition: undefined })],
    ['a condition that is not an object', withFilter({ condition: 'criticality = 1' })],
    ['a missing definition id', withChoice({ definitionId: undefined })],
    ['a non-string category name', withChoice({ categoryName: [] })],
    ['an unknown attribute kind', withChoice({ kind: 'colour' })],
    ['enum values that are not a list', withChoice({ enumValues: 'Mission Critical' })],
    ['a non-string currency', withChoice({ currency: 978 })],
  ])('refuses %s', (_case, value) => {
    expect(accepts(value)).toBe(false);
  });

  /**
   * The interior of a condition is the SDK's business and the backend's to
   * reject — this module only insists that one is present and is an object.
   */
  it('accepts a condition whose interior it does not recognise', () => {
    expect(accepts(withFilter({ condition: { anything: { nested: true } } }))).toBe(true);
  });
});

describe('a link that is not a link', () => {
  it.each([
    ['empty', ''],
    ['not base64', '!!!!'],
    ['base64 of something that is not JSON', btoa('hello')],
  ])('decodes %s to null', (_case, text) => {
    expect(decode(text)).toBeNull();
  });
});

/**
 * The compatibility seam. Links written before the trail existed carry a view
 * and a type; a trail has to be rebuilt from them, or every link already shared
 * opens on the wrong screen.
 */
describe('the trail a link describes', () => {
  const APPLICATION = 'BDCore.Application' as ObjectType;
  const first = (): ObjectType => 'BDCore.Goal' as ObjectType;

  it('prefers a stored path over anything derived', () => {
    const stored = pathOf(
      { v: 1, env: 'acme', view: 'population', path: [ROOT, { at: 'network' }] },
      first,
    );

    // `view` disagrees on purpose: the path is the more specific answer.
    expect(stored).toEqual([ROOT, { at: 'network' }]);
  });

  it('rebuilds the trail an attribute view was reached through', () => {
    expect(pathOf({ v: 1, env: 'acme', view: 'attributes', type: APPLICATION }, first)).toEqual([
      ROOT,
      { at: 'attributes', type: APPLICATION },
    ]);
  });

  it('rebuilds a graph as having been reached through its type', () => {
    expect(pathOf({ v: 1, env: 'acme', view: 'network', type: APPLICATION }, first)).toEqual([
      ROOT,
      { at: 'attributes', type: APPLICATION },
      { at: 'network', type: APPLICATION },
    ]);
  });

  it('falls back to the first type for an attribute view that named none', () => {
    // The only state the old shape could express that the new one cannot.
    expect(pathOf({ v: 1, env: 'acme', view: 'attributes' }, first)).toEqual([
      ROOT,
      { at: 'attributes', type: first() },
    ]);
  });

  it('opens at the root when there is no type to fall back to', () => {
    expect(pathOf({ v: 1, env: 'acme', view: 'attributes' }, () => undefined)).toEqual([ROOT]);
  });

  it('ignores a path that is not a trail, rather than opening nowhere', () => {
    expect(
      pathOf({ v: 1, env: 'acme', view: 'attributes', type: APPLICATION, path: [] }, first),
    ).toEqual([ROOT, { at: 'attributes', type: APPLICATION }]);
  });
});

describe('the view a trail is written as', () => {
  it('names the deepest screen, which is what an older build reads', () => {
    expect(viewOf([ROOT])).toBe('population');
    expect(viewOf([ROOT, { at: 'attributes', type: 'T' as ObjectType }])).toBe('attributes');
    expect(viewOf([ROOT, { at: 'network' }])).toBe('network');
  });

  it('answers for an empty trail rather than leaving the field undefined', () => {
    expect(viewOf([])).toBe('population');
  });
});

describe('a link carrying a trail', () => {
  it('survives a round trip with its path intact', () => {
    const withPath: Analysis = {
      ...analysis,
      path: [ROOT, { at: 'attributes', type: 'BDCore.Application' as ObjectType }],
    };

    expect(decode(encode(withPath))).toEqual(withPath);
  });

  it('is rejected when its path is not a list', () => {
    expect(accepts({ ...payload(), path: 'population' })).toBe(false);
  });
});
