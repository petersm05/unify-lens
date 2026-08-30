import { describe, expect, it } from 'vitest';
import type { AttributeChoice } from './attributes';
import type { Detail } from './object-detail';
import { rowsFor, sampleKeyFor } from './attribute-rows';

function choice(over: Partial<AttributeChoice> & Pick<AttributeChoice, 'definitionId' | 'name'>): AttributeChoice {
  return {
    categoryId: 'cat-app',
    categoryName: 'Application',
    kind: 'string',
    ...over,
  };
}

function detailOf(groups: Detail['groups']): Detail {
  return {
    id: 'obj-1' as Detail['id'],
    name: 'Customer Relationship Management',
    type: 'BDCore.Application',
    description: null,
    externalSource: null,
    externalId: null,
    labels: [],
    createdAt: null,
    updatedAt: null,
    groups,
    related: [],
    views: [],
  };
}

const SCHEMA: readonly AttributeChoice[] = [
  choice({ definitionId: 'def-crit', name: 'Business criticality', kind: 'enum',
    enumValues: [
      { id: 'v1', name: 'Low' },
      { id: 'v2', name: 'Mission critical' },
    ] as NonNullable<AttributeChoice['enumValues']> }),
  choice({ definitionId: 'def-cost', name: 'Annual cost', kind: 'money', currency: 'EUR' as NonNullable<AttributeChoice['currency']> }),
  choice({ definitionId: 'def-owner', name: 'Business owner' }),
  choice({ categoryId: 'cat-host', categoryName: 'Hosting', definitionId: 'def-model', name: 'Hosting model', kind: 'enum' }),
];

const DETAIL = detailOf([
  {
    category: 'Application',
    values: [
      {
        categoryId: 'cat-app',
        definitionId: 'def-cost',
        name: 'Annual cost',
        kind: 'money',
        display: '€1.240.000',
        value: 1240000,
        currency: 'EUR',
        numeric: 1240000,
      },
      {
        categoryId: 'cat-app',
        definitionId: 'def-crit',
        name: 'Business criticality',
        kind: 'enum',
        display: 'Mission critical',
        value: 'v2',
      },
    ],
  },
]);

describe('rowsFor', () => {
  it('lists the attributes with no value alongside the ones with one', () => {
    const groups = rowsFor(DETAIL, SCHEMA);
    const application = groups.find((group) => group.category === 'Application');

    expect(application?.rows.map((row) => row.name)).toEqual([
      'Business criticality',
      'Annual cost',
      'Business owner',
    ]);
    expect(application?.rows.map((row) => row.display)).toEqual([
      'Mission critical',
      '€1.240.000',
      null,
    ]);
  });

  // The figure the category heading prints. Counting rows rather than values
  // would make it "3 of 3" on an object with one value.
  it('counts only the rows the object has a value for', () => {
    const groups = rowsFor(DETAIL, SCHEMA);
    expect(groups.map((group) => [group.category, group.set, group.rows.length])).toEqual([
      ['Application', 2, 3],
      ['Hosting', 0, 1],
    ]);
  });

  it('keeps a category the object has no values in at all', () => {
    const hosting = rowsFor(DETAIL, SCHEMA).find((group) => group.category === 'Hosting');
    expect(hosting?.rows).toHaveLength(1);
    expect(hosting?.rows[0]?.display).toBeNull();
  });

  it('orders by the schema, not by the order the object arrived in', () => {
    // The detail carries Annual cost before Business criticality; the schema
    // declares them the other way round, and the schema wins.
    const application = rowsFor(DETAIL, SCHEMA)[0];
    expect(application?.rows[0]?.name).toBe('Business criticality');
  });

  it('carries the enumeration order onto the row', () => {
    const row = rowsFor(DETAIL, SCHEMA)[0]?.rows[0];
    expect(row?.order).toEqual(['Low', 'Mission critical']);
  });

  // The definition knows the currency, so an unset money row still has one.
  it('takes the currency from the definition, value or no value', () => {
    const empty = rowsFor(detailOf([]), SCHEMA);
    const cost = empty[0]?.rows.find((row) => row.name === 'Annual cost');
    expect(cost?.currency).toBe('EUR');
    expect(cost?.display).toBeNull();
  });

  // Where the definition carries no currency at runtime, the value's own is
  // all there is — and dropping it turns €1.240.000 into a bare figure under a
  // generic ¤.
  it('falls back to the currency the value carries', () => {
    const withoutCurrency = SCHEMA.map((entry) =>
      entry.definitionId === 'def-cost' ? { ...entry, currency: undefined } : entry,
    ) as AttributeChoice[];
    const cost = rowsFor(DETAIL, withoutCurrency)[0]?.rows.find((row) => row.name === 'Annual cost');
    expect(cost?.currency).toBe('EUR');
  });

  // Where they disagree the value's own wins: the amount beside it was
  // recorded in that currency, and printing it under the definition's symbol
  // would put the wrong sign on a real figure.
  it('prefers the currency the value was recorded in', () => {
    const inDollars = detailOf([
      {
        category: 'Application',
        values: [
          {
            categoryId: 'cat-app',
            definitionId: 'def-cost',
            name: 'Annual cost',
            kind: 'money',
            display: '$1,240,000',
            value: 1240000,
            currency: 'USD',
            numeric: 1240000,
          },
        ],
      },
    ]);
    const cost = rowsFor(inDollars, SCHEMA)[0]?.rows.find((row) => row.name === 'Annual cost');
    expect(cost?.currency).toBe('USD');
  });

  it('leaves the typed value on the row for an editor to open on', () => {
    const cost = rowsFor(DETAIL, SCHEMA)[0]?.rows.find((row) => row.name === 'Annual cost');
    expect(cost?.value).toBe(1240000);
    expect(cost?.numeric).toBe(1240000);
  });

  // A schema read that has gone stale would otherwise hide a value the object
  // really carries, which is worse than listing it out of order.
  it('still lists a value the schema does not know about', () => {
    const groups = rowsFor(DETAIL, [SCHEMA[0]!]);
    const names = groups.flatMap((group) => group.rows.map((row) => row.name));
    expect(names).toContain('Annual cost');
    expect(groups.find((group) => group.category === 'Application')?.set).toBe(2);
  });

  it('produces nothing for an object whose type declares no attributes', () => {
    expect(rowsFor(detailOf([]), [])).toEqual([]);
  });

  // Whether a category's total is knowable is a question per category. A
  // schema that lists Application and has never heard of Hosting can still say
  // how much of Application is filled in — and must not say "2 of 2 set" over
  // a Hosting category built entirely from the object's own values.
  it('marks only the categories whose total it actually knows', () => {
    const groups = rowsFor(DETAIL, [SCHEMA[0]!, SCHEMA[2]!]);
    expect(groups.map((group) => [group.category, group.complete])).toEqual([
      ['Application', false],
    ]);
  });

  it('knows the total where every row in the category came from the schema', () => {
    expect(rowsFor(DETAIL, SCHEMA).map((group) => group.complete)).toEqual([true, true]);
  });

  it('knows no total at all when the schema could not be read', () => {
    expect(rowsFor(DETAIL, []).every((group) => group.complete)).toBe(false);
  });
});

describe('sampleKeyFor', () => {
  // Locally a sampled value is keyed by category id and the attribute's
  // *name*, because that is what the read hands back — the opposite of the
  // definition id a filter or a write has to use.
  it('keys by the attribute name, not by its definition id', () => {
    const row = rowsFor(DETAIL, SCHEMA)[0]?.rows[1];
    expect(sampleKeyFor(row!)).toBe('cat-app::Annual cost');
  });
});
