import { describe, expect, it } from 'vitest';
import type { AttributeChoice } from './attributes';
import type { Sample, SampledObject, Value } from './sample-store';
import { PER_KIND, percent, scanForLeads, scannedAttributes, shortlist, type Lead } from './leads';

/**
 * These build a population by hand rather than through `SampleStore`, which
 * would need a knowledge graph to answer. What a scan reads is a map of values
 * per object, so that is what the fixtures are.
 *
 * Figures are asserted through `\D` stripping or a `[.,]` class wherever a
 * grouping separator could appear: `formatCount` takes its separator from the
 * runner's locale, and pinning "1.191" would fail on a machine set to English
 * for a difference that is not this module's.
 */

const enumValues = [
  { id: 'lc-1', name: 'Production' },
  { id: 'lc-2', name: 'Retired' },
] as unknown as NonNullable<AttributeChoice['enumValues']>;

function attribute(overrides: Partial<AttributeChoice> = {}): AttributeChoice {
  return {
    categoryId: 'general',
    categoryName: 'General',
    definitionId: 'def-1',
    name: 'Business criticality',
    kind: 'enum',
    enumValues,
    ...overrides,
  };
}

const cost = attribute({
  categoryId: 'financials',
  categoryName: 'Financials',
  definitionId: 'def-tco',
  name: 'Total cost of ownership',
  kind: 'money',
  currency: 'EUR' as NonNullable<AttributeChoice['currency']>,
});

/** The key `SampleStore` files a value under: category id, then attribute name. */
function keyOf(choice: AttributeChoice): string {
  return `${choice.categoryId}::${choice.name}`;
}

/**
 * A population of `size` objects, where `values(index)` decides what each one
 * carries. Anything left out of the returned map is an object with no value,
 * which is what "not set" is on the way in.
 */
function population(
  size: number,
  values: (index: number) => ReadonlyArray<[AttributeChoice, Value]>,
  truncated = false,
): Sample {
  const objects: SampledObject[] = Array.from({ length: size }, (_, index) => ({
    id: `object-${index}` as never,
    name: `Object ${index}`,
    createdAt: null,
    values: new Map(values(index).map(([choice, value]) => [keyOf(choice), value])),
  }));

  return { objects, truncated, complete: true };
}

/**
 * One attribute carried by the first `filled` objects and no others.
 *
 * The values alternate unless one is given, so a fixture about coverage does
 * not accidentally also be a fixture about concentration — the two readings
 * are ordered, and a single repeated value would decide these tests through
 * the wrong branch.
 */
function covered(choice: AttributeChoice, size: number, filled: number, value?: Value): Sample {
  return population(size, (index) =>
    index < filled ? [[choice, value ?? (index % 2 === 0 ? 'Production' : 'Retired')]] : [],
  );
}

const kinds = (leads: readonly Lead[]): string[] => leads.map((lead) => lead.kind);
const digits = (text: string): string => text.replace(/\D/g, '');

describe('percent', () => {
  it('rounds to whole percentages', () => {
    expect(percent(0.1234)).toBe('12%');
    expect(percent(0.5)).toBe('50%');
    expect(percent(1)).toBe('100%');
    expect(percent(0)).toBe('0%');
  });

  it('never rounds a value that exists away to nothing', () => {
    // Five objects out of 4.000 carry a value. "0% covered" would be a
    // falsehood the reader finds out about by opening the chart.
    expect(percent(5 / 4000)).toBe('<1%');
  });

  it('never rounds a gap that exists up to everything', () => {
    expect(percent(3999 / 4000)).toBe('>99%');
    // The boundary itself: 0.995 is the first share that rounds *to* 100, so
    // it is the first that has to be held back from saying so.
    expect(percent(199 / 200)).toBe('>99%');
    expect(percent(198 / 200)).toBe('99%');
  });
});

describe('scanForLeads', () => {
  it('reports an attribute filled in for a minority of the population', () => {
    const criticality = attribute();
    const scan = scanForLeads(covered(criticality, 1191, 143), [criticality]);

    expect(scan.leads).toHaveLength(1);
    expect(scan.leads[0]).toMatchObject({
      kind: 'sparse',
      word: 'Sparse',
      title: 'Business criticality',
      note: 'General',
      headline: '12% covered',
    });
    // The gap and the population, which is the pair the coverage card prints.
    expect(digits(scan.leads[0]!.detail)).toBe(`${1191 - 143}${1191}`);
  });

  it('says nothing about an attribute that is filled in', () => {
    const criticality = attribute();
    // Half is where the coverage gauge stops saying "sparse", so half is not a
    // lead. One more object either side of it decides the row.
    expect(scanForLeads(covered(criticality, 100, 50), [criticality]).leads).toEqual([]);
    expect(kinds(scanForLeads(covered(criticality, 100, 49), [criticality]).leads)).toEqual([
      'sparse',
    ]);
  });

  it('routes the row at the attribute it is about', () => {
    const criticality = attribute();
    const scan = scanForLeads(covered(criticality, 100, 10), [criticality]);

    expect(scan.leads[0]?.choice).toBe(criticality);
  });

  it('reports a value that holds almost everything', () => {
    const lifecycle = attribute({ definitionId: 'def-lc', name: 'Lifecycle' });
    const sample = population(100, (index) => [
      [lifecycle, index < 94 ? 'Production' : 'Retired'],
    ]);

    const lead = scanForLeads(sample, [lifecycle]).leads[0];

    expect(lead).toMatchObject({ kind: 'concentrated', word: 'One value' });
    expect(lead?.headline).toBe('94% are “Production”');
  });

  it('leaves a merely lopsided distribution alone', () => {
    const lifecycle = attribute({ definitionId: 'def-lc', name: 'Lifecycle' });
    const sample = population(100, (index) => [
      [lifecycle, index < 89 ? 'Production' : 'Retired'],
    ]);

    expect(scanForLeads(sample, [lifecycle]).leads).toEqual([]);
  });

  it('measures concentration against the objects that have a value', () => {
    const lifecycle = attribute({ definitionId: 'def-lc', name: 'Lifecycle' });
    // 60 of 100 carry a value; 57 of those 60 — 95% — are Production. As a
    // share of the population that is 57%, which would not be a finding.
    const sample = population(100, (index) =>
      index < 57 ? [[lifecycle, 'Production']] : index < 60 ? [[lifecycle, 'Retired']] : [],
    );

    const lead = scanForLeads(sample, [lifecycle]).leads[0];

    expect(lead?.headline).toBe('95% are “Production”');
    expect(digits(lead?.detail ?? '')).toBe('5760');
  });

  it('gives one attribute one row, taking the coverage reading first', () => {
    const lifecycle = attribute({ definitionId: 'def-lc', name: 'Lifecycle' });
    // Ten objects have a value and all ten say Production, so both readings
    // fire. The empty ninety are the story; which of the ten values dominates
    // is a statement about 10% of the estate.
    const sample = population(100, (index) => (index < 10 ? [[lifecycle, 'Production']] : []));

    expect(kinds(scanForLeads(sample, [lifecycle]).leads)).toEqual(['sparse']);
  });

  it('reports a top value far above the median', () => {
    const sample = population(20, (index) => [[cost, index === 0 ? 4100 : 100]]);

    const lead = scanForLeads(sample, [cost]).leads[0];

    expect(lead).toMatchObject({ kind: 'outlier', word: 'Outlier' });
    expect(lead?.headline).toBe('highest value is 41× the median');
    // The two figures behind the ratio, as money because the attribute is.
    expect(digits(lead?.detail ?? '')).toBe(`${4100}${100}`);
  });

  it('leaves a top value within reach of the median alone', () => {
    const sample = population(20, (index) => [[cost, index === 0 ? 1900 : 100]]);

    expect(scanForLeads(sample, [cost]).leads).toEqual([]);
  });

  it('will not take a ratio against a median of too few values', () => {
    // Seven values, one of them enormous. A median over seven numbers is not
    // a middle worth measuring a distance from.
    const sample = population(7, (index) => [[cost, index === 0 ? 100_000 : 100]]);

    expect(scanForLeads(sample, [cost]).leads).toEqual([]);
  });

  it('will not take a ratio against a median of zero', () => {
    const sample = population(20, (index) => [[cost, index === 0 ? 100_000 : 0]]);

    expect(scanForLeads(sample, [cost]).leads).toEqual([]);
  });

  it('rolls a category whose attributes are all sparse into one row', () => {
    const members = ['Contract value', 'Annual cost', 'Licence count'].map((name, index) =>
      attribute({
        categoryId: 'financials',
        categoryName: 'Financials',
        definitionId: `def-${index}`,
        name,
        kind: 'integer',
      }),
    );

    // The first is the best covered of the three, at 12%.
    const sample = population(100, (index) =>
      members.flatMap((member, position): Array<[AttributeChoice, Value]> =>
        index < 12 - position * 5 ? [[member, 10]] : [],
      ),
    );

    const scan = scanForLeads(sample, members);

    expect(kinds(scan.leads)).toEqual(['empty']);
    expect(scan.leads[0]).toMatchObject({
      title: 'Financials',
      note: '3 attributes',
      headline: 'every one is sparse',
      detail: 'best covered is Contract value, at 12%',
    });
    // A chart of the emptiest attribute has nothing on it, so the row opens
    // the one with the most to show.
    expect(scan.leads[0]?.choice).toBe(members[0]);
  });

  it('leaves the rows alone where one of the category is covered', () => {
    const members = ['Contract value', 'Annual cost', 'Licence count'].map((name, index) =>
      attribute({
        categoryId: 'financials',
        categoryName: 'Financials',
        definitionId: `def-${index}`,
        name,
        kind: 'integer',
      }),
    );

    const sample = population(100, (index) =>
      members.flatMap((member, position): Array<[AttributeChoice, Value]> =>
        position === 0 || index < 10 ? [[member, 10]] : [],
      ),
    );

    expect(kinds(scanForLeads(sample, members).leads)).toEqual(['sparse', 'sparse']);
  });

  it('will not speak for a category holding an attribute it cannot read', () => {
    const members = ['Contract value', 'Annual cost', 'Licence count'].map((name, index) =>
      attribute({
        categoryId: 'financials',
        categoryName: 'Financials',
        definitionId: `def-${index}`,
        name,
        kind: 'integer',
      }),
    );
    // A reference is not examined, so nothing here knows whether it is filled
    // in — and "every one is sparse" would be a claim about it too.
    const owner = attribute({
      categoryId: 'financials',
      categoryName: 'Financials',
      definitionId: 'def-owner',
      name: 'Cost owner',
      kind: 'reference',
    });

    const sample = population(100, (index) =>
      members.flatMap((member): Array<[AttributeChoice, Value]> =>
        index < 10 ? [[member, 10]] : [],
      ),
    );

    expect(kinds(scanForLeads(sample, [...members, owner]).leads)).toEqual([
      'sparse',
      'sparse',
      'sparse',
    ]);
  });

  it('will not call two attributes a whole section of the metamodel', () => {
    const members = ['Contract value', 'Annual cost'].map((name, index) =>
      attribute({
        categoryId: 'financials',
        categoryName: 'Financials',
        definitionId: `def-${index}`,
        name,
        kind: 'integer',
      }),
    );

    const sample = population(100, (index) =>
      members.flatMap((member): Array<[AttributeChoice, Value]> =>
        index < 10 ? [[member, 10]] : [],
      ),
    );

    expect(kinds(scanForLeads(sample, members).leads)).toEqual(['sparse', 'sparse']);
  });

  it('ranks the kinds in the order they are worth reading', () => {
    const empty = ['A', 'B', 'C'].map((name, index) =>
      attribute({
        categoryId: 'empty-cat',
        categoryName: 'Unused',
        definitionId: `def-e${index}`,
        name,
        kind: 'integer',
      }),
    );
    const thin = attribute({ categoryId: 'other', definitionId: 'def-thin', name: 'Thin', kind: 'integer' });
    const lifecycle = attribute({ categoryId: 'other', definitionId: 'def-lc', name: 'Lifecycle' });

    const sample = population(100, (index) => [
      ...empty.flatMap((member): Array<[AttributeChoice, Value]> => (index < 5 ? [[member, 1]] : [])),
      ...(index < 20 ? ([[thin, 1]] as Array<[AttributeChoice, Value]>) : []),
      [lifecycle, index < 95 ? 'Production' : 'Retired'],
      [cost, index === 0 ? 4100 : 100],
    ]);

    expect(kinds(scanForLeads(sample, [...empty, thin, lifecycle, cost]).leads)).toEqual([
      'empty',
      'sparse',
      'concentrated',
      'outlier',
    ]);
  });

  it('puts the emptiest attribute of a kind first', () => {
    const worse = attribute({ definitionId: 'def-worse', name: 'Worse', kind: 'integer' });
    const better = attribute({ definitionId: 'def-better', name: 'Better', kind: 'integer' });

    const sample = population(100, (index) => [
      ...(index < 5 ? ([[worse, 1]] as Array<[AttributeChoice, Value]>) : []),
      ...(index < 40 ? ([[better, 1]] as Array<[AttributeChoice, Value]>) : []),
    ]);

    expect(scanForLeads(sample, [better, worse]).leads.map((lead) => lead.title)).toEqual([
      'Worse',
      'Better',
    ]);
  });

  it('does not chase a boolean into a chart that cannot draw it', () => {
    // `enumDistribution` counts booleans through `enumValues`, which they do
    // not have (#61). Until that is fixed, a row about one would open a chart
    // saying the opposite of what the row said.
    const flag = attribute({ definitionId: 'def-flag', name: 'Cloud hosted', kind: 'boolean' });
    const scan = scanForLeads(covered(flag, 100, 5, true), [flag]);

    expect(scan.leads).toEqual([]);
    expect(scan.examined).toBe(0);
  });

  it('says nothing about attributes it cannot chart', () => {
    const reference = attribute({ definitionId: 'def-ref', name: 'Owner', kind: 'reference' });

    expect(scanForLeads(covered(reference, 100, 5), [reference]).examined).toBe(0);
  });

  it('takes coverage from the counts where it is given them', () => {
    const criticality = attribute();
    // The prefix that was read carries a value on every object; the whole
    // population does not, and the gauge the row opens counts the whole
    // population. Without the counts this row would not exist at all.
    const sample = population(4000, () => [[criticality, 'Production']], true);
    const counts = new Map([['general.def-1', { withValue: 4000, notSet: 8406 }]]);

    const scan = scanForLeads(sample, [criticality], counts);

    expect(scan.exactCoverage).toBe(true);
    expect(scan.leads[0]).toMatchObject({ kind: 'sparse', headline: '32% covered' });
    expect(digits(scan.leads[0]!.detail)).toBe(`${8406}${12406}`);
  });

  it('says nothing about coverage it cannot stand behind', () => {
    const criticality = attribute();
    const sample = population(4000, (index) => (index < 100 ? [[criticality, 'Production']] : []), true);

    // 100 of the 4.000 read carry a value, which on a complete sample would
    // be the strongest lead on the screen. The chart behind it would count the
    // whole population and disagree, so there is no row and no claim.
    const scan = scanForLeads(sample, [criticality]);

    expect(scan.exactCoverage).toBe(false);
    expect(scan.leads).toEqual([]);
    // A map that is missing this attribute is not counts for it.
    expect(scanForLeads(sample, [criticality], new Map()).exactCoverage).toBe(false);
    expect(scanForLeads(sample, [criticality], new Map()).leads).toEqual([]);
  });

  it('still reads the values of a sample it cannot judge coverage from', () => {
    const lifecycle = attribute({ definitionId: 'def-lc', name: 'Lifecycle' });
    // What was read is what a distribution chart would draw from too, so a
    // dominant value is the same claim on the row and on the chart.
    const sample = population(4000, (index) => [[lifecycle, index < 3800 ? 'Production' : 'Retired']], true);

    expect(kinds(scanForLeads(sample, [lifecycle]).leads)).toEqual(['concentrated']);
  });

  it('scans the attributes it says it scans', () => {
    const flag = attribute({ definitionId: 'def-flag', kind: 'boolean' });
    const owner = attribute({ definitionId: 'def-ref', kind: 'reference' });
    const criticality = attribute();

    expect(scannedAttributes([flag, owner, criticality])).toEqual([criticality]);
  });

  it('carries the read it was taken from, so a caveat can be stated', () => {
    const criticality = attribute();
    const sample = population(
      4000,
      (index) => (index < 100 ? [[criticality, 'Production']] : []),
      true,
    );

    const scan = scanForLeads(sample, [criticality]);

    expect(scan).toMatchObject({ truncated: true, sampled: 4000, examined: 1 });
  });

  it('has nothing to say about an empty population', () => {
    const criticality = attribute();
    const scan = scanForLeads({ objects: [], truncated: false, complete: true }, [criticality]);

    expect(scan).toMatchObject({ leads: [], sampled: 0 });
  });
});

describe('shortlist', () => {
  const sparse = (index: number): Lead => ({
    id: `sparse:general.def-${index}`,
    kind: 'sparse',
    word: 'Sparse',
    title: `Attribute ${index}`,
    note: 'General',
    headline: '10% covered',
    detail: '90 of 100 not set',
    choice: attribute({ definitionId: `def-${index}` }),
    magnitude: 1 - index / 100,
  });

  const many = Array.from({ length: 6 }, (_, index) => sparse(index));

  it('shows a few of one kind rather than all of them', () => {
    expect(shortlist(many, new Set())).toHaveLength(PER_KIND);
  });

  it('promotes the next of a kind when one is dismissed', () => {
    const shown = shortlist(many, new Set([many[0]!.id]));

    expect(shown).toHaveLength(PER_KIND);
    expect(shown.map((lead) => lead.id)).not.toContain(many[0]!.id);
    // The row that was fourth in the ranking, which nothing had shown before.
    expect(shown[PER_KIND - 1]?.id).toBe(many[PER_KIND]!.id);
  });

  it('does not spend one kind’s room on another', () => {
    const outlier: Lead = { ...sparse(9), id: 'outlier:general.def-9', kind: 'outlier' };
    const shown = shortlist([...many, outlier], new Set());

    expect(shown).toHaveLength(PER_KIND + 1);
    expect(shown.at(-1)).toBe(outlier);
  });
});
