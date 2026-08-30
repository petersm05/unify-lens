import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttributeKind } from './attributes';
import {
  dateToInputValue,
  editorFor,
  enumIdFor,
  isEditable,
  isUnchanged,
  parseDateInput,
  parseEdit,
  seedFor,
  type EditValue,
} from './attribute-edit';

/** Every kind the metamodel can declare, so the switch cannot go one short. */
const KINDS: readonly AttributeKind[] = [
  'integer',
  'real',
  'money',
  'enum',
  'boolean',
  'date',
  'string',
  'text',
  'reference',
];

/** The value from a successful parse, or a failure with its message attached. */
function parsed(context: Parameters<typeof parseEdit>[0], raw: string): EditValue {
  const result = parseEdit(context, raw);
  if (!result.ok) throw new Error(`expected "${raw}" to parse, got: ${result.message}`);
  return result.value;
}

function rejection(context: Parameters<typeof parseEdit>[0], raw: string): string {
  const result = parseEdit(context, raw);
  if (result.ok) throw new Error(`expected "${raw}" to be rejected, got: ${String(result.value)}`);
  return result.message;
}

describe('editorFor', () => {
  it('gives every kind an editor except reference', () => {
    const withoutEditor = KINDS.filter((kind) => editorFor(kind) === null);
    expect(withoutEditor).toEqual(['reference']);
  });

  it('sends the three numeric kinds to one editor', () => {
    expect([editorFor('integer'), editorFor('real'), editorFor('money')]).toEqual([
      'number',
      'number',
      'number',
    ]);
  });

  it('separates one-line from many-line text', () => {
    expect(editorFor('string')).toBe('line');
    expect(editorFor('text')).toBe('paragraph');
  });

  it('agrees with isEditable', () => {
    for (const kind of KINDS) {
      expect(isEditable(kind)).toBe(editorFor(kind) !== null);
    }
  });
});

describe('clearing', () => {
  it('reads an empty field as no value rather than as an empty one', () => {
    for (const kind of KINDS.filter(isEditable)) {
      expect(parsed({ kind }, '')).toBeNull();
      expect(parsed({ kind }, '   ')).toBeNull();
    }
  });

  it('does not let a reference be cleared either', () => {
    expect(rejection({ kind: 'reference' }, '')).toContain('cannot be edited');
  });
});

describe('enumerations', () => {
  const context = {
    kind: 'enum',
    options: [
      { id: 'crit-1', name: 'Low' },
      { id: 'crit-2', name: 'Mission critical' },
    ],
  } as const;

  it('takes a value the metamodel allows', () => {
    expect(parsed(context, 'crit-2')).toBe('crit-2');
  });

  it('refuses one it does not', () => {
    expect(rejection(context, 'crit-9')).toContain('allows');
  });

  // A read may hand back either the id or the label, and `seedFor` opens the
  // field on whatever it gave — so a context that only matched ids would
  // refuse to save an enum nobody had touched. Either goes in; the id comes
  // out, because that is what a write carries.
  it('takes a display label and answers with its id', () => {
    expect(parsed(context, 'Mission critical')).toBe('crit-2');
  });

  it('refuses everything when the caller supplied no values', () => {
    expect(rejection({ kind: 'enum' }, 'crit-2')).toContain('allows');
  });
});

describe('enumIdFor', () => {
  const options = [
    { id: 'crit-1', name: 'Low' },
    { id: 'crit-2', name: 'Mission critical' },
  ];

  it('takes an id straight through', () => {
    expect(enumIdFor(options, 'crit-2')).toBe('crit-2');
  });

  it('resolves a display label to its id', () => {
    expect(enumIdFor(options, 'Mission critical')).toBe('crit-2');
  });

  it('answers nothing for a value the enumeration does not have', () => {
    expect(enumIdFor(options, 'Retired')).toBeNull();
    expect(enumIdFor([], 'crit-2')).toBeNull();
  });

  // Ids first, or a label colliding with another value's id saves the wrong
  // value — and saves it without complaint.
  it('prefers an id match over a label match on a different value', () => {
    const colliding = [
      { id: 'Mission critical', name: 'Low' },
      { id: 'crit-2', name: 'Mission critical' },
    ];
    expect(enumIdFor(colliding, 'Mission critical')).toBe('Mission critical');
  });
});

describe('booleans', () => {
  it('takes the two states', () => {
    expect(parsed({ kind: 'boolean' }, 'true')).toBe(true);
    expect(parsed({ kind: 'boolean' }, 'false')).toBe(false);
  });

  // The message tells a reader the field takes Yes or No, so the parser has to
  // take them. A message naming an input that is then refused is worse than no
  // message at all.
  it('takes the words its own message names, in any case', () => {
    expect(parsed({ kind: 'boolean' }, 'Yes')).toBe(true);
    expect(parsed({ kind: 'boolean' }, 'no')).toBe(false);
    expect(parsed({ kind: 'boolean' }, 'TRUE')).toBe(true);
  });

  it('refuses anything else, rather than reading it as false', () => {
    expect(rejection({ kind: 'boolean' }, '0')).toContain('Yes, No');
    expect(rejection({ kind: 'boolean' }, 'maybe')).toContain('Yes, No');
  });
});

describe('numbers', () => {
  const real = { kind: 'real' } as const;

  it('reads a plain figure', () => {
    expect(parsed(real, '3180')).toBe(3180);
    expect(parsed(real, '-42')).toBe(-42);
    expect(parsed(real, '+7')).toBe(7);
    expect(parsed(real, '0.5')).toBe(0.5);
    expect(parsed(real, '.5')).toBe(0.5);
  });

  it('reads both grouped notations as the same number', () => {
    expect(parsed(real, '1.240.000,50')).toBe(1240000.5);
    expect(parsed(real, '1,240,000.50')).toBe(1240000.5);
  });

  // The form this app's own `formatCount` and `formatMoneyExact` print. A rule
  // that reads the *last* separator as the decimal point rejects every one of
  // these, so a figure copied off the screen could not be typed back.
  it('reads a grouped whole number, in either notation', () => {
    expect(parsed(real, '1,240,000')).toBe(1240000);
    expect(parsed(real, '1.240.000')).toBe(1240000);
    expect(parsed(real, '1,234,567')).toBe(1234567);
    expect(parsed(real, '12.345.678.901')).toBe(12345678901);
  });

  it('reads an ungrouped figure with a decimal part', () => {
    expect(parsed(real, '1240000.5')).toBe(1240000.5);
    expect(parsed(real, '1240000,5')).toBe(1240000.5);
  });

  it('strips the spaces a locale groups with', () => {
    expect(parsed(real, '1 240 000')).toBe(1240000);
    expect(parsed(real, '1 240 000,5')).toBe(1240000.5);
    expect(parsed(real, '1 240 000')).toBe(1240000);
  });

  // A space is a group separator, so grouping by space has to hold the way
  // grouping by anything else does. Deleting every space first would read
  // `1 24 000` as 124000 while `1.24.000` was refused.
  it('holds a space grouping to the same shape as any other', () => {
    expect(rejection(real, '1 24 000')).toContain('not a number');
    expect(rejection(real, '1 5')).toContain('not a number');
    expect(rejection(real, '1234 567')).toContain('not a number');
  });

  // The judgement half of the rule: one separator is a decimal point, whatever
  // follows it. Grouping has to be unambiguous — a repeated mark, or a pair —
  // before it is read as grouping.
  it('reads a lone separator as a decimal point, three digits or not', () => {
    expect(parsed(real, '1,500')).toBe(1.5);
    expect(parsed(real, '1.500')).toBe(1.5);
    expect(parsed(real, '0,750')).toBe(0.75);
    expect(parsed(real, '1,5')).toBe(1.5);
    expect(parsed(real, '1,2505')).toBe(1.2505);
    expect(parsed(real, '1234.500')).toBe(1234.5);
  });

  // Why it goes that way. `seedFor` opens a field on the value the object
  // already holds, and a group reading turns three decimals into three orders
  // of magnitude — without anyone typing anything, and with `isUnchanged`
  // seeing a change and letting the write through.
  it('round-trips a three-decimal value the app itself seeded', () => {
    for (const value of [1.234, 3.142, 12.345, 123.456, 0.001]) {
      expect(parsed(real, seedFor(value))).toBe(value);
    }
  });

  it('refuses groups that are not groups', () => {
    expect(rejection(real, '1.24.000')).toContain('not a number');
    expect(rejection(real, '1,2400,000.5')).toContain('not a number');
  });

  it('refuses two decimal separators of the same kind', () => {
    expect(rejection(real, '1.2.3')).toContain('not a number');
  });

  it('refuses what is not a figure at all', () => {
    expect(rejection(real, 'lots')).toContain('not a number');
    expect(rejection(real, '12px')).toContain('not a number');
    expect(rejection(real, '1e6')).toContain('not a number');
    expect(rejection(real, '-')).toContain('not a number');
  });

  /**
   * The whole notation matrix in one place.
   *
   * The named tests above say what each rule is *for*; this says what the
   * parser does with every shape at once. Three separate reviews found three
   * separate edge cases in this one function — a position rule that could not
   * read a grouped integer, a group reading that refused rather than falling
   * back, and four hundred digits arriving as Infinity — so the answer is a
   * table that fails as a set rather than another patch per case.
   */
  const NOTATIONS: ReadonlyArray<readonly [string, number | 'refused']> = [
    ['0', 0],
    ['42', 42],
    ['-42', -42],
    ['+7', 7],
    ['3.14', 3.14],
    ['.5', 0.5],
    [',5', 0.5],
    ['1,000', 1],
    ['1.000', 1],
    ['12,345', 12.345],
    ['1.234', 1.234],
    // The range where a grouped figure has only one separator, and so is read
    // as a decimal. Stated here rather than left as a gap between 1,000 and
    // 1,234,567 — it is the cost of the tie-break, not an oversight.
    ['1,500', 1.5],
    ['9,999', 9.999],
    ['1.500', 1.5],
    // The far end of the same range: everything under a million groups with a
    // single separator, so all of it reads as a fraction.
    ['123,456', 123.456],
    ['999,999', 999.999],
    ['1,234,567', 1234567],
    ['1.234.567', 1234567],
    ['12.345.678.901', 12345678901],
    ['1 234 567', 1234567],
    ['1 24 000', 'refused'],
    ['1 5', 'refused'],
    ['1234 567', 'refused'],
    ['-1 240', -1240],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234,567.89', 1234567.89],
    ['1.234.567,89', 1234567.89],
    ['1,5', 1.5],
    ['1.5', 1.5],
    ['0,750', 0.75],
    ['0.750', 0.75],
    ['1234.500', 1234.5],
    ['12345,500', 12345.5],
    ['1,2505', 1.2505],
    ['abc', 'refused'],
    ['12px', 'refused'],
    ['1e6', 'refused'],
    ['-', 'refused'],
    ['1.24.000', 'refused'],
    ['1,2400,000.5', 'refused'],
    ['1.2.3', 'refused'],
    ['1,2,3', 'refused'],
    ['1.234,567.89', 'refused'],
    ['1,000,00', 'refused'],
    ['9'.repeat(400), 'refused'],
  ];

  it.each(NOTATIONS)('reads %s', (raw, expected) => {
    const result = parseEdit(real, raw);
    expect(result.ok ? result.value : 'refused').toBe(expected);
  });

  it('holds an integer attribute to whole numbers', () => {
    expect(parsed({ kind: 'integer' }, '3180')).toBe(3180);
    expect(rejection({ kind: 'integer' }, '3180.5')).toContain('whole numbers');
  });

  // An integer has no fraction, so the ambiguity a lone separator carries does
  // not exist on one: `formatCount(3180)` prints `3.180` or `3,180`, and
  // refusing that as "not whole" would be this app refusing its own output.
  it('reads a lone separator in a whole number as a group', () => {
    expect(parsed({ kind: 'integer' }, '3.180')).toBe(3180);
    expect(parsed({ kind: 'integer' }, '3,180')).toBe(3180);
    expect(parsed({ kind: 'integer' }, '12,345')).toBe(12345);
  });

  it('still refuses a real typed into a whole-number attribute', () => {
    // Not groupable — a first group of four digits is not a group — so it
    // falls through to the decimal reading and is refused for the right
    // reason.
    expect(rejection({ kind: 'integer' }, '3180.5')).toContain('whole numbers');
    expect(rejection({ kind: 'integer' }, '1.5')).toContain('whole numbers');
  });

  it('leaves the other numeric kinds reading a lone separator as a decimal', () => {
    expect(parsed({ kind: 'real' }, '3.180')).toBe(3.18);
    expect(parsed({ kind: 'money' }, '3,180')).toBe(3.18);
  });

  it('lets money carry a fraction', () => {
    expect(parsed({ kind: 'money' }, '1240000,50')).toBe(1240000.5);
  });
});

describe('dates', () => {
  /**
   * Run west of Greenwich, deliberately.
   *
   * A UTC-based implementation and a local one are the same code in UTC, so
   * every assertion below passes on both — and CI runs in UTC. The bug these
   * two functions exist to prevent would therefore ship green. Node re-reads
   * `TZ` when it is assigned, so moving the clock for this block is what makes
   * the assertions bite: under New York, `new Date('2019-03-14')` is the 13th.
   */
  const zone = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'America/New_York';
  });
  afterAll(() => {
    process.env['TZ'] = zone;
  });

  it('is running somewhere the two implementations differ', () => {
    expect(new Date(2019, 2, 14).getTimezoneOffset()).not.toBe(0);
  });

  it('reads a date field value as that day, not the day before', () => {
    const value = parsed({ kind: 'date' }, '2019-03-14');
    expect(value).toBeInstanceOf(Date);
    const date = value as Date;
    // Asserted through the local getters, which is how the sheet renders it.
    // Comparing against an ISO string would pass or fail on the runner's
    // timezone rather than on the code.
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2019, 2, 14]);
    expect([date.getHours(), date.getMinutes()]).toEqual([0, 0]);
  });

  it('round-trips through the field without moving the day', () => {
    for (const day of ['2019-03-14', '2020-02-29', '1999-12-31', '2026-01-01']) {
      expect(dateToInputValue(parseDateInput(day) as Date)).toBe(day);
    }
  });

  // The bug this pair exists to prevent: `new Date('2019-03-14')` is UTC
  // midnight, which is the 13th here.
  it('lands on local midnight rather than on an instant', () => {
    const date = parseDateInput('2019-03-14') as Date;
    expect([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]).toEqual(
      [0, 0, 0, 0],
    );
  });

  it('refuses a day that does not exist', () => {
    expect(rejection({ kind: 'date' }, '2019-02-31')).toContain('not a date');
    expect(rejection({ kind: 'date' }, '2019-13-01')).toContain('not a date');
    expect(rejection({ kind: 'date' }, '2019-00-10')).toContain('not a date');
  });

  it('refuses anything that is not the field format', () => {
    expect(rejection({ kind: 'date' }, '14/03/2019')).toContain('YYYY-MM-DD');
    expect(rejection({ kind: 'date' }, '2019-3-4')).toContain('YYYY-MM-DD');
    expect(parseDateInput('yesterday')).toBeNull();
  });

  it('keeps a two-digit year in its own century', () => {
    const date = parseDateInput('0099-06-01');
    expect(date?.getFullYear()).toBe(99);
  });
});

describe('text', () => {
  it('trims the ends of a single line', () => {
    expect(parsed({ kind: 'string' }, '  Marieke de Vries  ')).toBe('Marieke de Vries');
  });

  it('keeps the newlines inside a paragraph', () => {
    expect(parsed({ kind: 'text' }, '\n First line.\n\n  Second.\n')).toBe(
      'First line.\n\n  Second.',
    );
  });
});

describe('seedFor', () => {
  it('opens a number on its digits, with no grouping to re-parse', () => {
    expect(seedFor(1240000.5)).toBe('1240000.5');
    expect(seedFor(0)).toBe('0');
  });

  // `String(1e21)` is "1e+21", which the parser refuses — so a field opened on
  // a value the object already holds could not be saved back unchanged.
  it('never seeds a field with exponent notation', () => {
    expect(seedFor(1e21)).toBe('1000000000000000000000');
    expect(seedFor(1e-7)).toBe('0.0000001');
    expect(seedFor(-2.5e-8)).toBe('-0.000000025');
    expect(seedFor(1.5e21)).toBe('1500000000000000000000');
    expect(parsed({ kind: 'real' }, seedFor(1e21))).toBe(1e21);
  });

  // A formatter has to be told how many fraction digits to keep, and any
  // number it is told truncates something: at twenty, 1/30000 seeds as a
  // different value than the field was opened on, and `isUnchanged` then lets
  // a write through that rewrites it.
  it('seeds a value that needs more digits than a formatter would keep', () => {
    for (const value of [1 / 30000, 1 / 3, 2 / 7, 1e-9 / 3]) {
      expect(parsed({ kind: 'real' }, seedFor(value))).toBe(value);
    }
  });

  // The property the pair exists for, over a wide spread rather than a
  // handful of chosen values.
  it('round-trips whatever a double can hold', () => {
    let seed = 12345;
    for (let index = 0; index < 2000; index += 1) {
      // A small deterministic generator, so a failure is reproducible.
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const value = (seed / 2147483648 - 0.5) * 10 ** ((seed % 40) - 20);
      expect(parsed({ kind: 'real' }, seedFor(value)), String(value)).toBe(value);
    }
  });

  it('opens an unset attribute on an empty field', () => {
    expect(seedFor(null)).toBe('');
  });

  it('round-trips every kind of value back to itself', () => {
    const cases: ReadonlyArray<
      [AttributeKind, EditValue, Partial<{ options: Array<{ id: string; name: string }> }>]
    > = [
      ['real', 1240000.5, {}],
      ['real', 1.234, {}],
      ['integer', 3180, {}],
      ['money', 16000, {}],
      ['boolean', true, {}],
      ['boolean', false, {}],
      ['string', 'Marieke de Vries', {}],
      ['text', 'First line.\n\nSecond.', {}],
      ['enum', 'crit-2', { options: [{ id: 'crit-1', name: 'Low' }, { id: 'crit-2', name: 'High' }] }],
      ['date', new Date(2019, 2, 14), {}],
    ];

    for (const [kind, value, extra] of cases) {
      const back = parsed({ kind, ...extra }, seedFor(value));
      expect(isUnchanged(value, back), `${kind}: ${String(value)}`).toBe(true);
    }
  });
});

describe('isUnchanged', () => {
  it('compares dates by the moment they name, not by identity', () => {
    expect(isUnchanged(new Date(2019, 2, 14), new Date(2019, 2, 14))).toBe(true);
    expect(isUnchanged(new Date(2019, 2, 14), new Date(2019, 2, 15))).toBe(false);
  });

  // A `date` attribute is shown as a day and edited as a day, so a stored
  // value carrying a time cannot survive the field. Comparing instants would
  // call the untouched round trip a change and issue a write whose only effect
  // is to move the value to midnight.
  it('compares dates by the day they name, not the instant', () => {
    expect(isUnchanged(new Date(2019, 2, 14, 9, 30), new Date(2019, 2, 14))).toBe(true);
    expect(isUnchanged(new Date(2019, 2, 14, 23, 59), new Date(2019, 2, 15))).toBe(false);
  });

  it('calls an untouched round trip of a timed date unchanged', () => {
    const stored = new Date(2019, 2, 14, 9, 30);
    const back = parsed({ kind: 'date' }, seedFor(stored));
    expect(isUnchanged(stored, back)).toBe(true);
  });

  it('does not confuse a date with anything else', () => {
    expect(isUnchanged(new Date(2019, 2, 14), null)).toBe(false);
    expect(isUnchanged(null, new Date(2019, 2, 14))).toBe(false);
  });

  it('treats clearing an already-unset attribute as no change', () => {
    expect(isUnchanged(null, null)).toBe(true);
  });

  // Clearing a value is a change; storing an empty string is a different
  // request again, and the two must not collapse into each other.
  it('separates an empty string from no value', () => {
    expect(isUnchanged('', null)).toBe(false);
    expect(isUnchanged(0, null)).toBe(false);
    expect(isUnchanged(false, null)).toBe(false);
  });
});
