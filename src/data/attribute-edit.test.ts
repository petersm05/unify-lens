import { describe, expect, it } from 'vitest';
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
  const context = { kind: 'enum', allowed: ['crit-1', 'crit-2', 'crit-3'] } as const;

  it('takes a value the metamodel allows', () => {
    expect(parsed(context, 'crit-2')).toBe('crit-2');
  });

  it('refuses one it does not', () => {
    expect(rejection(context, 'crit-9')).toContain('allows');
  });

  // The write carries the definition's id; the label is what the sheet shows.
  // Substituting one for the other is the failure this whole app is careful
  // about, so it must not be accepted here either.
  it('refuses a display label that is not itself an allowed id', () => {
    expect(rejection(context, 'Mission critical')).toContain('allows');
  });

  it('refuses everything when the caller supplied no allowed values', () => {
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

  // The documented tie-break for a single separator, both ways round.
  it('takes a lone separator before three digits as a group', () => {
    expect(parsed(real, '1,500')).toBe(1500);
    expect(parsed(real, '1.500')).toBe(1500);
  });

  // A lone separator before three digits is a group only where the grouping
  // holds. A first group of four digits is not a group, so this is a decimal
  // point — reading it as a malformed grouping and refusing the figure would
  // reject a number nobody would think twice about typing.
  it('falls back to a decimal point where the grouping would not hold', () => {
    expect(parsed(real, '1234.500')).toBe(1234.5);
    expect(parsed(real, '1234,500')).toBe(1234.5);
    expect(parsed(real, '12345,500')).toBe(12345.5);
  });

  it('takes it as a decimal point when a zero comes before it', () => {
    expect(parsed(real, '0,750')).toBe(0.75);
    expect(parsed(real, '0.750')).toBe(0.75);
  });

  it('takes it as a decimal point when what follows is not three digits', () => {
    expect(parsed(real, '1,5')).toBe(1.5);
    expect(parsed(real, '1,25')).toBe(1.25);
    expect(parsed(real, '1,2505')).toBe(1.2505);
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
    ['1,000', 1000],
    ['1.000', 1000],
    ['12,345', 12345],
    ['1,234,567', 1234567],
    ['1.234.567', 1234567],
    ['12.345.678.901', 12345678901],
    ['1 234 567', 1234567],
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

  it('lets money carry a fraction', () => {
    expect(parsed({ kind: 'money' }, '1240000,50')).toBe(1240000.5);
  });
});

describe('dates', () => {
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

  // The bug this pair exists to prevent is `new Date('2019-03-14')`, which is
  // UTC midnight and so the 13th anywhere west of Greenwich. It cannot be
  // caught by comparing the two parses: where the runner is itself in UTC they
  // agree exactly, and CI's is. What *is* checkable everywhere is the property
  // that makes the difference — local midnight of the named day — which a UTC
  // parse fails in every zone but one, and this asserts in all of them.
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
    expect(parsed({ kind: 'real' }, seedFor(1e21))).toBe(1e21);
  });

  it('opens an unset attribute on an empty field', () => {
    expect(seedFor(null)).toBe('');
  });

  it('round-trips every kind of value back to itself', () => {
    const cases: ReadonlyArray<[AttributeKind, EditValue, Partial<{ allowed: string[] }>]> = [
      ['real', 1240000.5, {}],
      ['integer', 3180, {}],
      ['money', 16000, {}],
      ['boolean', true, {}],
      ['boolean', false, {}],
      ['string', 'Marieke de Vries', {}],
      ['text', 'First line.\n\nSecond.', {}],
      ['enum', 'crit-2', { allowed: ['crit-1', 'crit-2'] }],
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
