import { describe, expect, it } from 'vitest';
import type { Sample, Value } from './sample-store';
import { countBelow, peersFor, provenanceOf, valuesOf, type PeerInput } from './peers';

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

describe('countBelow', () => {
  it('counts the values strictly below', () => {
    expect(countBelow([1, 2, 3, 4], 3)).toBe(2);
  });

  it('does not count ties', () => {
    // Four values, three of them 5. Only the 1 is below, so a 5 is above one
    // of the population — not three of it.
    expect(countBelow([1, 5, 5, 5], 5)).toBe(1);
  });

  it('puts the smallest value above none of the population', () => {
    expect(countBelow([1, 2, 3, 4], 1)).toBe(0);
  });

  // Which is why no phrasing built on "all" can be exact: the largest of four
  // is above three of them, never four.
  it('never counts the object itself, so the maximum is one short of the total', () => {
    expect(countBelow([1, 2, 3, 4], 4)).toBe(3);
  });

  it('answers nothing for an empty population', () => {
    expect(countBelow([], 3)).toBeNull();
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
    expect(result?.caption).toBe('higher than 3 of 5');
  });

  // The caption and the mark are two renderings of one figure. A row that says
  // 78% under a bar filled to 22% is worse than a row with no bar.
  // The caption's count over the total it names is the fraction the bar is
  // filled to. There is no wording anywhere on this line that is not that.
  it('never lets the caption and the mark disagree', () => {
    for (const own of values) {
      const result = peers({ kind: 'real', values, own });
      const mark = result?.mark;
      if (mark?.shape !== 'position') throw new Error('expected a position mark');

      const figures = /than (?:(\d+)|none) of (\d+)/.exec(result?.caption ?? '');
      if (!figures) throw new Error(`unreadable caption: ${result?.caption ?? ''}`);
      expect(Number(figures[1] ?? 0) / Number(figures[2])).toBe(mark.at);
    }
  });

  // Every wording built on "all" or "the lowest" was subtly false somewhere: a
  // tied minimum is not the lowest, and the strict maximum of 412 is above 411
  // rather than all of them. A count is exact at both ends and under ties.
  it('is exact at both ends, and under ties', () => {
    const many = Array.from({ length: 400 }, (_, index) => index);
    expect(peers({ kind: 'real', values: many, own: 399 })?.caption).toBe('higher than 399 of 400');
    expect(peers({ kind: 'real', values: many, own: 0 })?.caption).toBe('higher than none of 400');
    expect(peers({ kind: 'real', values: many, own: 1 })?.caption).toBe('higher than 1 of 400');

    const tied = peers({ kind: 'integer', values: [0, 0, 0, 0, 0, 5, 9], own: 0 });
    expect(tied?.caption).toBe('higher than none of 7');

    const earliest = new Date(2020, 0, 1);
    const dates = [earliest, new Date(2021, 0, 1)];
    expect(peers({ kind: 'date', values: dates, own: earliest })?.caption).toBe('later than none of 2');
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
    expect(result?.caption).toBe('higher than 1 of 2');
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
    expect(result?.caption).toBe('later than 1 of 4');
  });

  it('counts only the objects that have a date, as the numbers do', () => {
    const result = peers({ kind: 'date', values, missing: 6, own: new Date(2018, 0, 1) });
    expect(result?.caption).toBe('later than 1 of 4');
  });

  it('does not invert the figure between the words and the bar', () => {
    const result = peers({ kind: 'date', values, own: new Date(2024, 0, 1) });
    const mark = result?.mark;
    if (mark?.shape !== 'position') throw new Error('expected a position mark');
    expect(result?.caption).toBe(`later than ${mark.at * 4} of 4`);
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
    const held = [...values, 'Decommissioned'];
    const result = peers({ kind: 'enum', values: held, own: 'Decommissioned', order });
    expect(result?.mark).toEqual({ shape: 'share', share: 1 / 6 });
    expect(result?.caption).toBe('1 of 6 share it');
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

  // Checked rather than coerced. A string on a boolean attribute would be read
  // as false, and the row above prints whatever it was given — so "true" would
  // sit over a caption counting the objects that are not.
  it('says nothing for a value that is not a boolean at all', () => {
    expect(peers({ kind: 'boolean', values, own: 'true' })).toBeNull();
    expect(peers({ kind: 'boolean', values, own: 1 })).toBeNull();
  });

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

// The population and the row can disagree: the object may sit past where a
// truncated read stopped, or the cached sample may be older than the object.
// A tally of nothing under a row showing a value is a contradiction on screen,
// so the line stays away — the same answer the unset branch already gave.
describe('a population that does not contain this object', () => {
  it('says nothing rather than tallying it at zero', () => {
    const away = { values: ['Someone else'] as Value[], missing: 0, truncated: true };
    expect(peers({ kind: 'enum', own: 'Mission critical', order: ['Mission critical'], ...away })).toBeNull();
    expect(peers({ kind: 'boolean', own: true, values: [false, false], missing: 0, truncated: true })).toBeNull();
    expect(peers({ kind: 'string', own: 'Northwind', values: [], missing: 4, truncated: true })).toBeNull();
  });

  // A rank is a comparison rather than a tally, so it stays meaningful whether
  // or not the object is one of the values it is compared against.
  it('still ranks a value against a population it is not part of', () => {
    const result = peers({ kind: 'money', values: [1, 2, 3, 4], own: 99, truncated: true });
    expect(result?.mark).toEqual({ shape: 'position', at: 1 });
    // And says so: "all but a few" under a track filled to the end is the same
    // mismatch the bottom end has its own phrase for.
    expect(result?.caption).toBe('higher than 4 of 4');
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
  it('stops naming a total the tally does not have', () => {
    const complete = peers({ kind: 'enum', values: ['a', 'b'], own: 'a' });
    const partial = peers({ kind: 'enum', values: ['a', 'b'], own: 'a', truncated: true });

    expect(complete?.caption).toBe('1 of 2 share it');
    expect(partial?.caption).toBe('1 of those read share it');
  });

  it('qualifies every tally, not only some of them', () => {
    const captions = [
      peers({ kind: 'enum', values: ['a'], own: 'a', truncated: true }),
      peers({ kind: 'boolean', values: [true], own: true, truncated: true }),
      peers({ kind: 'string', values: ['a'], own: 'a', truncated: true }),
      peers({ kind: 'money', values: [], missing: 2, own: null, truncated: true }),
    ].map((result) => result?.caption ?? '');

    for (const caption of captions) {
      expect(caption, caption).toContain('those read');
      expect(caption, caption).not.toMatch(/of \d/);
    }
  });

  // A rank names its count either way. "Of those read" means the whole sample
  // everywhere else on the panel, and a rank is taken over the objects that
  // have a value — two of four thousand read, under a caption that would
  // otherwise promise four thousand.
  it('names what a rank was actually taken over, read whole or not', () => {
    const partial = peers({ kind: 'money', values: [100, 200], missing: 3998, own: 200, truncated: true });
    expect(partial?.caption).toBe('higher than 1 of 2');
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
