import { describe, expect, it } from 'vitest';
import type { AttributeChoice, AttributeKind } from './attributes';
import { compatible, levelOf, marksFor } from './chart-spec';

/**
 * `marksFor` reads only `enumValues.length`, never the values themselves, so
 * the count is the honest thing to fabricate here. Building real `EnumValue`
 * objects would assert against the SDK's shape rather than against this
 * module's rule.
 */
function enumValues(count: number): AttributeChoice['enumValues'] {
  return Array.from({ length: count }, (_, index) => ({
    name: `value-${index}`,
  })) as unknown as AttributeChoice['enumValues'];
}

function attribute(
  kind: AttributeKind,
  overrides: Partial<AttributeChoice> = {},
): AttributeChoice {
  return {
    categoryId: 'category',
    categoryName: 'Category',
    definitionId: `${kind}-definition`,
    name: `${kind} attribute`,
    kind,
    ...overrides,
  };
}

const marks = (...args: Parameters<typeof marksFor>) => marksFor(...args).map((o) => o.mark);

describe('levelOf', () => {
  it('groups the kinds the metamodel declares into measurement levels', () => {
    expect(levelOf('enum')).toBe('categorical');
    expect(levelOf('boolean')).toBe('categorical');
    expect(levelOf('integer')).toBe('quantitative');
    expect(levelOf('real')).toBe('quantitative');
    expect(levelOf('money')).toBe('quantitative');
    expect(levelOf('date')).toBe('temporal');
    expect(levelOf('string')).toBe('nominal');
    expect(levelOf('text')).toBe('nominal');
  });

  it('treats a reference as something it cannot plot', () => {
    expect(levelOf('reference')).toBe('other');
    expect(marksFor(attribute('reference'))).toEqual([]);
  });
});

describe('marksFor, one attribute', () => {
  it('offers a donut only when an enum has between two and five values', () => {
    expect(marks(attribute('enum', { enumValues: enumValues(2) }))).toEqual(['donut', 'bars']);
    expect(marks(attribute('enum', { enumValues: enumValues(5) }))).toEqual(['donut', 'bars']);
    // Past five, angle differences stop being judgeable.
    expect(marks(attribute('enum', { enumValues: enumValues(6) }))).toEqual(['bars']);
    // One slice is not a part-to-whole.
    expect(marks(attribute('enum', { enumValues: enumValues(1) }))).toEqual(['bars']);
    expect(marks(attribute('enum'))).toEqual(['bars']);
  });

  it('leads with the ring, not the bars, when the ring is offered at all', () => {
    const [first] = marksFor(attribute('enum', { enumValues: enumValues(3) }));
    expect(first?.mark).toBe('donut');
  });

  it('picks the one form each remaining level supports', () => {
    expect(marks(attribute('money'))).toEqual(['histogram']);
    expect(marks(attribute('date'))).toEqual(['timeline']);
    expect(marks(attribute('string'))).toEqual(['frequency']);
  });
});

describe('marksFor, a date and a measure', () => {
  it('lands on a trend whichever was picked first', () => {
    expect(marks(attribute('date'), attribute('money'))).toEqual(['trend']);
    expect(marks(attribute('money'), attribute('date'))).toEqual(['trend']);
  });

  it('totals money over the period but averages a score', () => {
    const [money] = marksFor(attribute('date'), attribute('money'));
    expect(money?.hint).toContain('totalled');

    const [score] = marksFor(attribute('date'), attribute('integer'));
    expect(score?.hint).toContain('averaged');
  });
});

describe('marksFor, two measures', () => {
  it('leads with the quadrant when both axes are scores', () => {
    expect(marks(attribute('integer'), attribute('real'))).toEqual(['quadrant', 'scatter']);
  });

  it('leads with the scatter when either axis is money, which has no midpoint', () => {
    expect(marks(attribute('money'), attribute('integer'))).toEqual(['scatter', 'quadrant']);
    expect(marks(attribute('integer'), attribute('money'))).toEqual(['scatter', 'quadrant']);
  });
});

describe('marksFor, two categoricals', () => {
  it('cross-tabulates, with plain counts as the alternate', () => {
    expect(marks(attribute('enum'), attribute('boolean'))).toEqual(['heatmap', 'bars']);
  });
});

describe('marksFor, a category and a measure', () => {
  const category = attribute('enum', { enumValues: enumValues(3), name: 'Criticality' });

  it('sums money but averages a score, and says which', () => {
    const [summed] = marksFor(category, attribute('money'));
    expect(summed?.mark).toBe('sum-by');
    expect(summed?.label).toBe('Total by category');

    const [averaged] = marksFor(category, attribute('integer'));
    expect(averaged?.mark).toBe('sum-by');
    expect(averaged?.label).toBe('Average by category');
  });

  it('offers a share-of-total only for money, since averages do not compose', () => {
    expect(marks(category, attribute('money'))).toEqual(['sum-by', 'donut', 'bars']);
    expect(marks(category, attribute('integer'))).toEqual(['sum-by', 'bars']);
  });

  it('still withholds the ring when money is spread over too many values', () => {
    const wide = attribute('enum', { enumValues: enumValues(6) });
    expect(marks(wide, attribute('money'))).toEqual(['sum-by', 'bars']);
  });

  it('reads the same either way round', () => {
    expect(marks(attribute('money'), category)).toEqual(marks(category, attribute('money')));
  });
});

describe('compatible', () => {
  const money = attribute('money', { definitionId: 'money' });
  const score = attribute('integer', { definitionId: 'score' });
  const band = attribute('enum', { definitionId: 'band' });
  const when = attribute('date', { definitionId: 'when' });
  const notes = attribute('text', { definitionId: 'notes' });
  const all = [money, score, band, when, notes];

  const keys = (choice: AttributeChoice) =>
    compatible(choice, all).map((c) => c.definitionId).sort();

  it('never offers an attribute against itself', () => {
    expect(keys(money)).not.toContain('money');
  });

  it('pairs a date with measures and nothing else', () => {
    expect(keys(when)).toEqual(['money', 'score']);
  });

  it('pairs a measure with measures, categories and dates', () => {
    expect(keys(money)).toEqual(['band', 'score', 'when']);
  });

  it('pairs a category with measures and other categories, but not dates', () => {
    expect(keys(band)).toEqual(['money', 'score']);
  });

  it('offers nothing for a level it cannot plot against anything', () => {
    expect(compatible(notes, all)).toEqual([]);
  });
});
