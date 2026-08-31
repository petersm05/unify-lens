import { describe, expect, it } from 'vitest';
import type { SampleStore } from './sample-store';
import {
  conditionName,
  measureOverTime,
  enumCondition,
  equalsCondition,
  histogram,
  isPlottable,
  quantiles,
  rank,
  suggestGrain,
  thresholdCondition,
  type AttributeChoice,
} from './attributes';

/**
 * `enumValues` and `currency` are SDK types whose full shape is the SDK's
 * business; the code under test reads `id`, `name` and the currency string.
 * Casting keeps these fixtures honest about that rather than guessing at
 * fields nothing here looks at.
 */
const enumValues = [
  { id: 'crit-1', name: 'Mission critical' },
  { id: 'crit-2', name: 'Business critical' },
] as unknown as NonNullable<AttributeChoice['enumValues']>;

function attribute(overrides: Partial<AttributeChoice> = {}): AttributeChoice {
  return {
    categoryId: 'general',
    categoryName: 'General',
    definitionId: 'def-42',
    name: 'Business criticality',
    kind: 'enum',
    ...overrides,
  };
}

const criticality = attribute({ enumValues });
const cost = attribute({
  kind: 'money',
  name: 'Total cost of ownership',
  definitionId: 'def-tco',
  currency: 'EUR' as NonNullable<AttributeChoice['currency']>,
});

describe('quantiles', () => {
  it('has nothing to say about no values', () => {
    expect(quantiles([])).toBeUndefined();
  });

  it('makes one value every quantile of itself', () => {
    expect(quantiles([7])).toEqual({ min: 7, median: 7, p90: 7, max: 7 });
  });

  it('takes the value at the fraction, not the average of the pair around it', () => {
    // Ten values, so the median is the sixth rather than halfway between the
    // fifth and sixth. This is a convention, and nothing else records which
    // one — so it is recorded here. Changing the rule should change this test
    // on purpose, not by accident.
    expect(quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({
      min: 1,
      median: 6,
      p90: 10,
      max: 10,
    });
  });

  it('sorts the values itself', () => {
    expect(quantiles([9, 1, 5])?.min).toBe(1);
    expect(quantiles([9, 1, 5])?.max).toBe(9);
  });

  it('leaves the caller’s array in the order it was given', () => {
    const values = [9, 1, 5];
    quantiles(values);

    expect(values).toEqual([9, 1, 5]);
  });

  it('handles negatives, which a cost or a delta can be', () => {
    expect(quantiles([-10, -1, -5])).toMatchObject({ min: -10, max: -1 });
  });
});

describe('rank', () => {
  const observations = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `id-${index}` as never,
      name: `Object ${index}`,
      value: index,
    }));

  it('takes the ten largest, largest first', () => {
    const top = rank(observations(12));

    expect(top).toHaveLength(10);
    expect(top.map((entry) => entry.value)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });

  it('returns everything when there are fewer than ten', () => {
    expect(rank(observations(3))).toHaveLength(3);
  });

  it('leaves the caller’s array in the order it was given', () => {
    const input = observations(3);
    rank(input);

    expect(input.map((entry) => entry.value)).toEqual([0, 1, 2]);
  });
});

describe('suggestGrain', () => {
  // UTC, not local. `new Date(y, 0, 1)` is midnight *somewhere*, so a span
  // sitting exactly on a threshold lands either side of it depending on the
  // machine — 2010 to 2022 is 12.000114 years in São Paulo and passes the
  // `<= 12` test only in zones where it is not.
  const years = (from: number, to: number) => [
    new Date(Date.UTC(from, 0, 1)),
    new Date(Date.UTC(to, 0, 1)),
  ];

  it('falls back to years when there are no dates to judge by', () => {
    expect(suggestGrain([])).toBe('year');
  });

  it('uses months for a single date, whose span is nothing', () => {
    expect(suggestGrain([new Date(Date.UTC(2020, 5, 1))])).toBe('month');
  });

  it('uses months for a couple of years and quarters beyond', () => {
    expect(suggestGrain(years(2020, 2022))).toBe('month');
    expect(suggestGrain(years(2020, 2024))).toBe('quarter');
  });

  it('measures in Julian years, so three calendar years just misses the month threshold', () => {
    // 2020 to 2023 is 1096 days and the divisor is 365.25, which makes the
    // span 3.0007 rather than 3 — so `span <= 3` fails by a hair and a
    // three-year history is bucketed by quarter. Nobody would predict that
    // from reading the expression, which is exactly why it is written down.
    expect(suggestGrain(years(2020, 2023))).toBe('quarter');
  });

  it('includes twelve years in quarters, and goes to years past it', () => {
    // 2010 to 2022 is 4383 days, which is 365.25 x 12 exactly — the inclusive
    // edge of `span <= 12`.
    expect(suggestGrain(years(2010, 2022))).toBe('quarter');
    expect(suggestGrain(years(2010, 2023))).toBe('year');
  });

  it('reads the span, not the order the dates arrive in', () => {
    expect(suggestGrain([new Date(Date.UTC(2030, 0, 1)), new Date(Date.UTC(2000, 0, 1))])).toBe('year');
  });
});

describe('histogram', () => {
  const measure = attribute({ kind: 'real', name: 'Score', definitionId: 'def-score' });

  it('has no bins for no values', () => {
    expect(histogram([], measure).bins).toEqual([]);
  });

  it('puts every equal value in one bin rather than dividing by zero', () => {
    const { bins } = histogram([4, 4, 4], measure);

    expect(bins).toHaveLength(1);
    expect(bins[0]?.count).toBe(3);
  });

  it('counts every value exactly once', () => {
    // The invariant that matters most: a value falling outside every bucket is
    // invisible, and nothing else would notice.
    const values = Array.from({ length: 97 }, (_, index) => index * 3.7);
    const { bins } = histogram(values, measure);

    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(values.length);
  });

  it('keeps the largest value in the last bin rather than one past the end', () => {
    // The maximum divides exactly by the step, so without the clamp its index
    // is one past the last bin — which in JavaScript grows the array rather
    // than failing, leaving a spurious bin that starts *at* the maximum. So
    // the property is that the last bin starts below it: counting the values
    // or checking the last bin is non-empty both hold either way.
    const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const { bins } = histogram(values, measure);
    const last = bins[bins.length - 1]?.range;

    expect(last).toBeDefined();
    expect(last!.from).toBeLessThan(100);
    expect(last!.to).toBeGreaterThanOrEqual(100);
    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(values.length);
  });

  it('leaves no gap between one bin and the next', () => {
    const { bins } = histogram([1, 7, 13, 19, 25, 31, 44, 58], measure);

    expect(bins.length).toBeGreaterThan(1);
    for (let index = 1; index < bins.length; index += 1) {
      // Asserted present rather than optional-chained: `range` is optional on
      // `Bin` and absent on the all-equal-values path, so chaining both sides
      // would compare undefined with undefined and pass while testing nothing.
      const previous = bins[index - 1]?.range;
      const current = bins[index]?.range;

      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(current!.from).toBe(previous!.to);
    }
  });

  it('closes the last bucket and leaves the rest half-open', () => {
    // Otherwise the maximum is in a bin the bin's own filter excludes, and
    // tapping that bar returns fewer objects than it counts.
    const { bins } = histogram([0, 25, 50, 75, 100], measure);

    // `AttributeFilter` is a readonly union in the SDK, so a direct cast to a
    // mutable shape is rejected — which the stubbed types here cannot see, and
    // CI can. Through `unknown`, and readonly throughout, so the assertion is
    // about the one shape `histogram` builds rather than about the union.
    const operatorsOf = (bin: (typeof bins)[number]) => {
      const filter = bin.condition as unknown as
        | { readonly and?: readonly { readonly condition: { readonly operator: string } }[] }
        | undefined;
      return (filter?.and ?? []).map((part) => part.condition.operator);
    };

    expect(operatorsOf(bins[0]!)).toEqual(['greaterThanOrEquals', 'lessThan']);
    expect(operatorsOf(bins[bins.length - 1]!)).toEqual([
      'greaterThanOrEquals',
      'lessThanOrEquals',
    ]);
  });

  it('keeps the bin count within the range a reader can take in', () => {
    for (const size of [6, 40, 500, 5000]) {
      const values = Array.from({ length: size }, (_, index) => index);
      const { bins } = histogram(values, measure);

      expect(bins.length).toBeGreaterThanOrEqual(1);
      expect(bins.length).toBeLessThanOrEqual(13);
    }
  });

  it('starts on a round number rather than on the lowest value', () => {
    // 1, 2, 5 × a power of ten — the point of the nice-step rounding, and what
    // keeps bucket labels readable.
    const { bins } = histogram([37, 45, 62, 88, 91, 140, 190, 220], measure);
    const step = (bins[0]?.range?.to ?? 0) - (bins[0]?.range?.from ?? 0);
    const magnitude = 10 ** Math.floor(Math.log10(step));

    expect([1, 2, 5, 10]).toContain(Math.round(step / magnitude));
    expect((bins[0]?.range?.from ?? 0) % step).toBe(0);
  });
});

describe('conditionName', () => {
  it('joins the category to the definition id, never to the display name', () => {
    // The backend rejects a bare name, and the second half is the definition's
    // id — a filter built from the label silently matches nothing.
    expect(conditionName(criticality)).toBe('general.def-42');
    expect(conditionName(criticality)).not.toContain('Business criticality');
  });
});

describe('isPlottable', () => {
  it('accepts the kinds a chart can carry', () => {
    for (const kind of ['enum', 'boolean', 'integer', 'real', 'money', 'date', 'string', 'text']) {
      expect(isPlottable(attribute({ kind: kind as AttributeChoice['kind'] }))).toBe(true);
    }
  });

  it('refuses a reference, which has no axis to sit on', () => {
    expect(isPlottable(attribute({ kind: 'reference' }))).toBe(false);
  });
});

describe('equalsCondition', () => {
  it('filters an enumeration by the value’s id, not by the label on screen', () => {
    expect(equalsCondition(criticality, 'Mission critical')).toEqual({
      condition: {
        name: 'general.def-42',
        operator: 'equals',
        expression: { value: { type: 'enum', value: 'crit-1' } },
      },
    });
  });

  it('gives up on an enumeration label it cannot map', () => {
    expect(equalsCondition(criticality, 'Not a value')).toBeNull();
  });

  it('types a money comparison as money, with its currency', () => {
    expect(equalsCondition(cost, 1000)).toEqual({
      condition: {
        name: 'general.def-tco',
        operator: 'equals',
        expression: { value: { type: 'money', value: 1000, currency: 'EUR' } },
      },
    });
  });

  it('separates integers from reals, which the backend does not treat alike', () => {
    const asInteger = equalsCondition(attribute({ kind: 'integer' }), 3);
    const asReal = equalsCondition(attribute({ kind: 'real' }), 3);

    expect(asInteger).toMatchObject({ condition: { expression: { value: { type: 'integer' } } } });
    expect(asReal).toMatchObject({ condition: { expression: { value: { type: 'real' } } } });
  });

  it('carries a boolean through as a boolean', () => {
    expect(equalsCondition(attribute({ kind: 'boolean' }), false)).toMatchObject({
      condition: { expression: { value: { type: 'boolean', value: false } } },
    });
  });

  it('has no condition for an absent value', () => {
    const text = attribute({ kind: 'string' });

    expect(equalsCondition(text, '')).toBeNull();
    expect(equalsCondition(text, undefined)).toBeNull();
    expect(equalsCondition(text, null)).toBeNull();
  });
});

describe('thresholdCondition', () => {
  it('passes the operator through and types the value by the attribute', () => {
    expect(thresholdCondition(cost, 'greaterThanOrEquals', 500)).toEqual({
      condition: {
        name: 'general.def-tco',
        operator: 'greaterThanOrEquals',
        expression: { value: { type: 'money', value: 500, currency: 'EUR' } },
      },
    });
  });
});

describe('enumCondition', () => {
  it('maps a label to its id', () => {
    expect(enumCondition(criticality, 'Business critical')).toMatchObject({
      condition: { expression: { value: { value: 'crit-2' } } },
    });
  });

  it('returns nothing for a label the attribute does not define', () => {
    expect(enumCondition(criticality, 'Invented')).toBeNull();
    expect(enumCondition(attribute({ kind: 'enum' }), 'Anything')).toBeNull();
  });
});

/**
 * A population read, without one.
 *
 * `SampleStore` needs a live graph; `measureOverTime` needs only what it hands
 * back. `as unknown as` defeats the check outright — a change to `get`'s
 * signature will not fail this file — which is the cost of testing a function
 * that takes the store rather than the sample.
 *
 * An entry may carry only one of the pair, because `sampled` counts what was
 * read and `counted` counts what could be plotted, and a fixture where every
 * object carries both cannot tell them apart.
 */
function storeOf(
  values: ReadonlyArray<{ when?: Date; measure?: number }>,
  truncated = false,
): SampleStore {
  const objects = values.map((entry, index) => ({
    id: `object-${index}`,
    name: `Object ${index}`,
    createdAt: null,
    values: new Map<string, Date | number>([
      ...(entry.when ? ([['lifecycle::Decommission date', entry.when]] as const) : []),
      ...(entry.measure === undefined
        ? []
        : ([['general::Total cost of ownership', entry.measure]] as const)),
    ]),
  }));

  return {
    get: async () => ({ objects, truncated, complete: true }),
  } as unknown as SampleStore;
}

const retires = attribute({
  kind: 'date',
  categoryId: 'lifecycle',
  categoryName: 'Lifecycle',
  name: 'Decommission date',
  definitionId: 'def-retires',
});
// Not money: the point of these is the branch that averages rather than sums.
const score = attribute({
  kind: 'real',
  name: 'Total cost of ownership',
  definitionId: 'def-score',
});

const type = 'ApplicationComponent' as unknown as Parameters<typeof measureOverTime>[1];

describe('measureOverTime', () => {
  // Ten objects at 2 in January and one at 10 in February. Averaging the two
  // periods' own averages gives 6, which is what the headline used to show:
  // it hands a month holding one object the same say as a month holding ten.
  // Plus one object with a date and no cost, and one with a cost and no date:
  // thirteen were read, eleven can be plotted, so the two counts differ.
  const lopsided = [
    ...Array.from({ length: 10 }, () => ({ when: new Date(Date.UTC(2024, 0, 15)), measure: 2 })),
    { when: new Date(Date.UTC(2024, 1, 15)), measure: 10 },
    { when: new Date(Date.UTC(2024, 1, 20)) },
    { measure: 900 },
  ];

  it('averages over objects rather than over periods', async () => {
    const trend = await measureOverTime(storeOf(lopsided), type, retires, score, undefined, 'month');

    expect(trend.overall).toBeCloseTo(30 / 11, 10);
    expect(trend.overall).not.toBeCloseTo(6, 5);
  });

  it('still shows each period its own average', async () => {
    const trend = await measureOverTime(storeOf(lopsided), type, retires, score, undefined, 'month');

    expect(trend.points.map((point) => point.measure)).toEqual([2, 10]);
    expect(trend.points.map((point) => point.count)).toEqual([10, 1]);
  });

  it('sums a money measure instead, where a total is the question', async () => {
    const trend = await measureOverTime(storeOf(lopsided), type, retires, cost, undefined, 'month');

    expect(trend.additive).toBe(true);
    expect(trend.overall).toBe(30);
  });

  it('counts only objects carrying both, and says how many that was', async () => {
    const trend = await measureOverTime(storeOf(lopsided), type, retires, score, undefined, 'month');

    // Eleven of the thirteen carry both, so the other two are not plotted and
    // the lone 900 is not in the total.
    expect(trend.counted).toBe(11);
    expect(trend.sampled).toBe(13);
    expect(trend.overall).toBeCloseTo(30 / 11, 10);
  });

  it('carries how much was read beside the flag saying it fell short', async () => {
    const trend = await measureOverTime(
      storeOf(lopsided, true),
      type,
      retires,
      score,
      undefined,
      'month',
    );

    expect(trend.truncated).toBe(true);
    // `sampled` is what was read, `counted` what could be plotted. Keeping the
    // two apart is the point; a fixture where they agree cannot check it.
    expect(trend.sampled).toBe(13);
    expect(trend.counted).toBe(11);
  });

  it('has no average to give when nothing carries both', async () => {
    const trend = await measureOverTime(storeOf([]), type, retires, score, undefined, 'month');

    expect(trend.overall).toBe(0);
    expect(trend.counted).toBe(0);
  });

  it('knows a money measure is summed even with nothing to sum', async () => {
    // `additive` is a fact about the measure, not about what was found. The
    // empty return builds every field itself, so it can disagree with the
    // path beside it — and did, reporting the same attribute as averaged with
    // no pairs and summed with one.
    const empty = await measureOverTime(storeOf([]), type, retires, cost, undefined, 'month');
    const found = await measureOverTime(storeOf(lopsided), type, retires, cost, undefined, 'month');

    expect(empty.additive).toBe(found.additive);
    expect(empty.additive).toBe(true);
  });

  it('still says how much it read when none of it could be plotted', async () => {
    // The early return has its own copy of every field, so it can drop the
    // read size while the main path keeps it — and a truncated read with no
    // pairs would then caption itself "from the first 0 objects read".
    const unplottable = [{ measure: 5 }, { measure: 6 }, { measure: 7 }];
    const trend = await measureOverTime(
      storeOf(unplottable, true),
      type,
      retires,
      score,
      undefined,
      'month',
    );

    expect(trend.counted).toBe(0);
    expect(trend.truncated).toBe(true);
    expect(trend.sampled).toBe(3);
  });
});
