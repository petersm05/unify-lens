import { describe, expect, it } from 'vitest';
import type { Sample, Value } from './sample-store';
import { peersFor, provenanceOf, rankAmong, valuesOf, type PeerInput } from './peers';

/** A sample whose objects carry exactly the values given, under one key. */
function sampleOf(
  key: string,
  values: ReadonlyArray<Value | null>,
  extra: Partial<Sample> = {},
): Sample {
  return {
    objects: values.map((value, index) => ({
      id: `id-${index}` as Sample['objects'][number]['id'],
      name: `Object ${index}`,
      createdAt: null,
      values: new Map(value === null ? [] : [[key, value]]),
    })),
    truncated: false,
    complete: true,
    ...extra,
  };
}

function peers(input: Partial<PeerInput> & Pick<PeerInput, 'kind'>): ReturnType<typeof peersFor> {
  return peersFor({ values: [], missing: 0, own: null, truncated: false, ...input });
}

describe('rankAmong', () => {
  it('is the share strictly below', () => {
    expect(rankAmong([1, 2, 3, 4], 3)).toBe(0.5);
  });

  it('does not count ties', () => {
    // Four values, three of them 5. Only the 1 is below, so a 5 is above a
    // quarter of the population — not three quarters of it.
    expect(rankAmong([1, 5, 5, 5], 5)).toBe(0.25);
  });

  it('puts the smallest value above none of the population', () => {
    expect(rankAmong([1, 2, 3, 4], 1)).toBe(0);
  });

  it('counts the object itself in the denominator, not the numerator', () => {
    // The largest of four is above the other three: 0.75, never 1.
    expect(rankAmong([1, 2, 3, 4], 4)).toBe(0.75);
  });

  it('answers nothing for an empty population', () => {
    expect(rankAmong([], 3)).toBeNull();
  });
});

describe('valuesOf', () => {
  it('separates the values from the objects that have none', () => {
    const sample = sampleOf('cat::Annual cost', [10, null, 30, null, 50]);
    const { values, missing } = valuesOf(sample, 'cat::Annual cost');
    expect(values).toEqual([10, 30, 50]);
    expect(missing).toBe(2);
  });

  // `object-detail`'s `render` treats an empty string as no value and the row
  // prints "Not set"; `SampleStore` keeps one. Without the same rule here the
  // sheet could say "412 of 412 have one" under a row reading Not set.
  it('counts an empty string as no value, the way the row does', () => {
    const sample = sampleOf('cat::Vendor', ['Northwind', '', 'Contoso']);
    expect(valuesOf(sample, 'cat::Vendor')).toEqual({
      values: ['Northwind', 'Contoso'],
      missing: 1,
    });
  });

  it('counts every object as missing when the key is not the one held', () => {
    const sample = sampleOf('cat::Annual cost', [10, 20]);
    expect(valuesOf(sample, 'cat::Something else')).toEqual({ values: [], missing: 2 });
  });
});

describe('numeric attributes', () => {
  const values = [100, 200, 300, 400, 500];

  it('ranks the value and says so in the same number the mark draws', () => {
    const result = peers({ kind: 'money', values, own: 400 });
    expect(result?.mark).toEqual({ shape: 'position', at: 0.6 });
    expect(result?.caption).toBe('higher than 60% of 5');
  });

  // The caption and the mark are two renderings of one figure. A row that says
  // 78% under a bar filled to 22% is worse than a row with no bar.
  it('never lets the caption and the mark disagree', () => {
    for (const own of values) {
      const result = peers({ kind: 'real', values, own });
      const mark = result?.mark;
      if (mark?.shape !== 'position') throw new Error('expected a position mark');

      const figure = /(\d+)%/.exec(result?.caption ?? '');
      if (figure) {
        expect(Number(figure[1])).toBe(Math.round(mark.at * 100));
      } else {
        // The ends are worded instead of given a figure, and only the ends.
        expect(mark.at === 0 || mark.at < 0.005 || mark.at >= 0.995).toBe(true);
      }
    }
  });

  // `percent()` guards its own ends, which reads as two comparators inside
  // "higher than >99% of 412". The ends are said in words instead.
  it('words the ends rather than composing two comparators', () => {
    const captions = [
      peers({ kind: 'real', values, own: 100 })?.caption,
      peers({ kind: 'date', values: [new Date(2020, 0, 1), new Date(2021, 0, 1)], own: new Date(2020, 0, 1) })?.caption,
    ];
    expect(captions).toEqual(['the lowest of 5', 'the earliest of 2']);

    const many = Array.from({ length: 400 }, (_, index) => index);
    expect(peers({ kind: 'real', values: many, own: 399 })?.caption).toBe(
      'higher than all but a few of 400',
    );
    expect(peers({ kind: 'real', values: many, own: 1 })?.caption).toBe(
      'higher than a few of 400',
    );
  });

  it('treats the three numeric kinds alike', () => {
    const marks = (['integer', 'real', 'money'] as const).map(
      (kind) => peers({ kind, values, own: 300 })?.mark,
    );
    expect(marks).toEqual([
      { shape: 'position', at: 0.4 },
      { shape: 'position', at: 0.4 },
      { shape: 'position', at: 0.4 },
    ]);
  });

  // The bar is drawn from the rank and the caption names the denominator, so
  // the two have to be the same population. Ranking over the objects that have
  // a value and then naming the size of the whole one puts a bar filled to 50%
  // beside a sentence about ten objects, nine of which were never in it.
  it('names the population it actually ranked against, not the whole sample', () => {
    const result = peers({ kind: 'money', values: [100, 200], missing: 8, own: 200 });
    expect(result?.mark).toEqual({ shape: 'position', at: 0.5 });
    expect(result?.caption).toBe('higher than 50% of 2');
  });

  it('says nothing when the population holds no numbers to rank against', () => {
    expect(peers({ kind: 'real', values: ['a', 'b'], own: 3, missing: 0 })).toBeNull();
  });
});

describe('dates', () => {
  const values: Value[] = [
    new Date(2015, 0, 1),
    new Date(2018, 0, 1),
    new Date(2021, 0, 1),
    new Date(2024, 0, 1),
  ];

  it('ranks by the moment, and phrases it in the direction the mark fills', () => {
    const result = peers({ kind: 'date', values, own: new Date(2018, 0, 1) });
    expect(result?.mark).toEqual({ shape: 'position', at: 0.25 });
    expect(result?.caption).toBe('later than 25% of 4');
  });

  it('counts only the objects that have a date, as the numbers do', () => {
    const result = peers({ kind: 'date', values, missing: 6, own: new Date(2018, 0, 1) });
    expect(result?.caption).toBe('later than 25% of 4');
  });

  it('does not invert the figure between the words and the bar', () => {
    const result = peers({ kind: 'date', values, own: new Date(2024, 0, 1) });
    const mark = result?.mark;
    if (mark?.shape !== 'position') throw new Error('expected a position mark');
    expect(result?.caption).toBe(`later than ${Math.round(mark.at * 100)}% of 4`);
  });
});

describe('enumerations', () => {
  const order = ['Planned', 'In development', 'In production', 'Phasing out', 'Retired'];
  const values: Value[] = [
    'In production',
    'In production',
    'Phasing out',
    'Planned',
    'In production',
  ];

  it('marks the value position in the metamodel order, not in the sample', () => {
    const result = peers({ kind: 'enum', values, own: 'In production', order });
    expect(result?.mark).toEqual({ shape: 'steps', total: 5, index: 2 });
    expect(result?.caption).toBe('3 of 5 share it');
  });

  it('keeps a value the metamodel does not list as a share rather than a segment', () => {
    const result = peers({ kind: 'enum', values, own: 'Decommissioned', order });
    expect(result?.mark).toEqual({ shape: 'share', share: 0 });
    expect(result?.caption).toBe('0 of 5 share it');
  });

  // Twenty segments in a 104px track are three pixels each, which is a texture
  // rather than a mark. Past the ceiling the row says the same thing with the
  // share bar instead.
  it('gives up the segments for an enumeration too long to draw', () => {
    const long = Array.from({ length: 20 }, (_, index) => `value-${index}`);
    const result = peers({ kind: 'enum', values: ['value-3'], own: 'value-3', order: long });
    expect(result?.mark).toEqual({ shape: 'share', share: 1 });
    expect(result?.caption).toBe('1 of 1 share it');
  });

  it('keeps the segments at the last length that still draws', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => `value-${index}`);
    const result = peers({ kind: 'enum', values: ['value-3'], own: 'value-3', order: twelve });
    expect(result?.mark).toEqual({ shape: 'steps', total: 12, index: 3 });
  });

  it('falls back to a share when no order was supplied', () => {
    const result = peers({ kind: 'enum', values, own: 'Phasing out' });
    expect(result?.mark).toEqual({ shape: 'share', share: 0.2 });
  });
});

describe('booleans', () => {
  const values: Value[] = [true, false, false, false];

  it('shows the share that matches this object, whichever side it is on', () => {
    expect(peers({ kind: 'boolean', values, own: true })).toEqual({
      mark: { shape: 'share', share: 0.25 },
      caption: '1 of 4 are',
    });
    expect(peers({ kind: 'boolean', values, own: false })).toEqual({
      mark: { shape: 'share', share: 0.75 },
      caption: '3 of 4 are not',
    });
  });
});

describe('free text', () => {
  it('reports coverage, because a distribution of names means nothing', () => {
    const result = peers({ kind: 'string', values: ['Northwind', 'Contoso'], missing: 2, own: 'Northwind' });
    expect(result).toEqual({ mark: { shape: 'share', share: 0.5 }, caption: '2 of 4 have one' });
  });

  it('treats a paragraph the same way', () => {
    expect(peers({ kind: 'text', values: ['a'], missing: 3, own: 'a' })?.caption).toBe(
      '1 of 4 have one',
    );
  });
});

describe('an unset attribute', () => {
  it('reports the gap it is part of, whatever the kind', () => {
    for (const kind of ['money', 'enum', 'boolean', 'date', 'string'] as const) {
      expect(peers({ kind, values: [], missing: 3, own: null })).toEqual({
        mark: { shape: 'share', share: 1 },
        caption: '3 of 3 have none',
      });
    }
  });

  // This object is in the population and is itself one of the objects with no
  // value, so it is inside the figure. "Also" would say the opposite — that
  // the count is of the others — and be one out every time.
  it('does not describe a count it is part of as the others', () => {
    const caption = peers({ kind: 'money', values: [1], missing: 3, own: null })?.caption ?? '';
    expect(caption).toBe('3 of 4 have none');
    expect(caption).not.toContain('also');
  });

  // The object is unset and the sample says nothing is: they disagree, because
  // the read stopped before reaching it. "0 of 412 are also unset" beside a
  // row reading "Not set" is a contradiction on screen.
  it('says nothing rather than contradicting the row above it', () => {
    expect(peers({ kind: 'money', values: [1, 2], missing: 0, own: null })).toBeNull();
  });
});

describe('references', () => {
  it('gets no peer line at all', () => {
    expect(peers({ kind: 'reference', values: ['a'], own: 'a' })).toBeNull();
  });

  // A reference has a value the sheet prints and no scalar behind it, so it
  // arrives here looking exactly like an unset attribute. Answering "3 of 4 are
  // also unset" under a row naming an object would be a plain falsehood.
  it('is not mistaken for an unset attribute when it has no scalar', () => {
    expect(peers({ kind: 'reference', values: ['a'], missing: 3, own: null })).toBeNull();
  });
});

describe('an empty population', () => {
  it('produces nothing rather than dividing by zero', () => {
    expect(peers({ kind: 'money', values: [], missing: 0, own: 3 })).toBeNull();
  });
});

describe('a truncated read', () => {
  // The rule the whole line lives under: a figure from a sample is a different
  // claim from one over the population, so the caption stops naming a total it
  // does not have.
  it('stops naming a total it does not have', () => {
    const complete = peers({ kind: 'money', values: [1, 2, 3, 4], own: 3 });
    const partial = peers({ kind: 'money', values: [1, 2, 3, 4], own: 3, truncated: true });

    expect(complete?.caption).toBe('higher than 50% of 4');
    expect(partial?.caption).toBe('higher than 50% of those read');
  });

  it('qualifies every kind of caption, not only the ranked ones', () => {
    const captions = [
      peers({ kind: 'enum', values: ['a'], own: 'a', truncated: true }),
      peers({ kind: 'boolean', values: [true], own: true, truncated: true }),
      peers({ kind: 'string', values: ['a'], own: 'a', truncated: true }),
      peers({ kind: 'date', values: [new Date(2020, 0, 1)], own: new Date(2020, 0, 1), truncated: true }),
      peers({ kind: 'money', values: [], missing: 2, own: null, truncated: true }),
    ].map((result) => result?.caption ?? '');

    for (const caption of captions) {
      expect(caption, caption).toContain('those read');
      expect(caption, caption).not.toMatch(/of \d/);
    }
  });
});

describe('provenanceOf', () => {
  it('calls a complete read the population, because it is', () => {
    expect(provenanceOf(sampleOf('k', [1, 2, 3]))).toBe(
      'Peer figures read from all 3 objects of this type.',
    );
  });

  // The count comes from the sample, never from SAMPLE_LIMIT: the read stops
  // on a time budget too, so a slow one holds less than the ceiling.
  it('names what a partial read actually reached, and says it is not everything', () => {
    const sample = sampleOf('k', [1, 2], { truncated: true });
    expect(provenanceOf(sample)).toBe(
      'Peer figures read from the first 2 objects — not the whole population.',
    );
  });
});
