import type { AttributeKind } from './attributes';

/**
 * Turning what someone typed into a value the graph will accept.
 *
 * Deliberately free of the SDK, and of the DOM: every rule here is arithmetic
 * or string handling, which is the part worth testing and the part a mistake in
 * is expensive — a misread separator does not fail, it saves the wrong number.
 * The write itself lives in `attribute-writer.ts`, the way `view-writer.ts`
 * holds the only other call that changes anything.
 */

/** The control an attribute kind is edited with. */
export type Editor = 'choice' | 'toggle' | 'number' | 'date' | 'line' | 'paragraph';

/** A value on its way to the graph. `null` means "clear this attribute". */
export type EditValue = string | number | boolean | Date | null;

export type Parsed =
  | { readonly ok: true; readonly value: EditValue }
  | { readonly ok: false; readonly message: string };

export interface EditContext {
  readonly kind: AttributeKind;
  /**
   * For `enum` only: the value ids the metamodel allows.
   *
   * Ids rather than labels, because that is what a write carries — the same
   * distinction the rest of the app makes between what is shown and what is
   * sent.
   */
  readonly allowed?: readonly string[];
}

/**
 * Which editor a kind gets, or `null` for a kind this app does not edit.
 *
 * `reference` is the only `null`: pointing an attribute at another object
 * needs a way to find that object, which is a feature rather than a field.
 */
export function editorFor(kind: AttributeKind): Editor | null {
  switch (kind) {
    case 'enum':
      return 'choice';
    case 'boolean':
      return 'toggle';
    case 'integer':
    case 'real':
    case 'money':
      return 'number';
    case 'date':
      return 'date';
    case 'string':
      return 'line';
    case 'text':
      return 'paragraph';
    case 'reference':
      return null;
  }
}

export function isEditable(kind: AttributeKind): boolean {
  return editorFor(kind) !== null;
}

/** One allowed value of an enumeration: `id` is written, `name` is shown. */
export interface EnumOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The id of the enum value an object currently holds.
 *
 * A read hands enum values back inconsistently — `attributeCategories` carries
 * both a `value` and a `displayValue`, and which of the two a given field holds
 * is not something the public types settle. Rather than guess, this accepts
 * either and returns the id, because the id is what a write has to carry:
 * `conditionFor` in `attributes.ts` already resolves the same ambiguity the
 * same way round when it builds a filter.
 *
 * Ids are matched first. A label that happens to equal some *other* value's id
 * would otherwise resolve to that other value, which is a silent wrong save.
 */
export function enumIdFor(options: readonly EnumOption[], raw: string): string | null {
  return (
    options.find((option) => option.id === raw)?.id ??
    options.find((option) => option.name === raw)?.id ??
    null
  );
}

/**
 * What someone typed, as a value — or why it cannot be one.
 *
 * An empty field is a request to clear the attribute, not a request to store
 * an empty string: the sheet already counts unset attributes separately from
 * set ones, so the two have to stay distinguishable all the way to the write.
 */
export function parseEdit(context: EditContext, raw: string): Parsed {
  const editor = editorFor(context.kind);
  if (editor === null) {
    return { ok: false, message: `A ${context.kind} attribute cannot be edited here.` };
  }

  // `trim` only touches the ends, so a paragraph keeps its interior newlines
  // and the indentation inside them.
  const text = raw.trim();
  if (text.length === 0) return { ok: true, value: null };

  switch (editor) {
    case 'choice': {
      const allowed = context.allowed ?? [];
      return allowed.includes(text)
        ? { ok: true, value: text }
        : { ok: false, message: 'Pick one of the values this attribute allows.' };
    }
    case 'toggle': {
      if (text === 'true') return { ok: true, value: true };
      if (text === 'false') return { ok: true, value: false };
      return { ok: false, message: 'A yes-or-no attribute takes Yes, No, or nothing at all.' };
    }
    case 'number': {
      const value = toNumber(text);
      if (value === null) return { ok: false, message: `"${text}" is not a number.` };
      if (context.kind === 'integer' && !Number.isInteger(value)) {
        return { ok: false, message: 'This attribute holds whole numbers only.' };
      }
      return { ok: true, value };
    }
    case 'date': {
      const value = parseDateInput(text);
      if (value === null) {
        return { ok: false, message: `"${text}" is not a date. Dates are entered as YYYY-MM-DD.` };
      }
      return { ok: true, value };
    }
    case 'line':
    case 'paragraph':
      return { ok: true, value: text };
  }
}

/**
 * The text a field opens on.
 *
 * A number opens as its digits and nothing else — no grouping, no currency
 * symbol. Seeding the field with the *display* form would spend the first
 * keystroke deleting a €, and would put a locale round trip between reading a
 * value and saving the same value back unchanged, which is where a formatting
 * bug turns into a data bug.
 */
export function seedFor(value: EditValue): string {
  if (value === null) return '';
  if (value instanceof Date) return dateToInputValue(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return value;
}

/**
 * Whether a save would change anything.
 *
 * Checked before the write rather than after it: a no-op `UPDATE` is a real
 * mutation to everything downstream — it moves `updatedAt`, lands in the audit
 * log, and comes back over the realtime feed to invalidate every cached sample
 * for the type.
 */
export function isUnchanged(before: EditValue, after: EditValue): boolean {
  if (before instanceof Date && after instanceof Date) return before.getTime() === after.getTime();
  if (before instanceof Date || after instanceof Date) return false;
  return before === after;
}

/**
 * A `Date` as an `<input type="date">` value, in the reader's own timezone.
 *
 * Built from the local getters rather than from `toISOString()`, which is UTC:
 * a date stored as local midnight in Amsterdam is 22:00 the previous day in
 * UTC, so the ISO form hands the field yesterday. Half the world's timezones
 * would see a date move by a day just by opening the editor and saving.
 */
export function dateToInputValue(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${String(value.getFullYear()).padStart(4, '0')}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * `YYYY-MM-DD` — what a date field hands back, in every locale — as a `Date`
 * at local midnight.
 *
 * `new Date('2019-03-14')` would parse it as *UTC* midnight, which renders as
 * the 13th anywhere west of Greenwich. The local constructor is the pair to
 * `dateToInputValue`, so a value read out and put back is the same day.
 */
export function parseDateInput(raw: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(year, month - 1, day);
  // Two-digit years are mapped into the 1900s by the constructor, which would
  // silently turn 0099 into 1999.
  if (year < 100) date.setFullYear(year);

  // The constructor rolls an impossible date forward rather than refusing it —
  // 31 February becomes 3 March — so the only way to reject one is to ask
  // whether the date it built is the date it was given.
  const built = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return built ? date : null;
}

/**
 * A number typed by a person, in whichever notation their keyboard produces.
 *
 * `input[type="number"]` normalises this in most browsers and not in all of
 * them, and a pasted figure arrives in whatever notation it was copied from.
 * The rule: **the last separator is the decimal one**, and every separator
 * before it has to be a group of three. That reads `1.240.000,50` and
 * `1,240,000.50` as the same number and rejects `1.24.000`.
 *
 * One separator on its own is genuinely ambiguous — `1,500` is fifteen hundred
 * to one reader and one and a half to another. It is taken as a group when it
 * is followed by exactly three digits and the part before it does not start
 * with a zero: `1,500` is 1500, `0,750` is 0.75. Anyone meaning one and a half
 * types `1,5`, which has no second reading.
 */
function toNumber(input: string): number | null {
  // Several locales group with a non-breaking or narrow no-break space, so a
  // figure copied out of this app's own formatting comes back carrying one.
  // `\s` covers both — U+00A0 and U+202F are in its class — which is why this
  // is not a hand-written list of the space characters Intl happens to use.
  const text = input.replace(/\s/g, '');
  if (!/^[+-]?[\d.,]*\d$/.test(text)) return null;

  const sign = text.startsWith('-') ? -1 : 1;
  const body = text.replace(/^[+-]/, '');

  const last = Math.max(body.lastIndexOf(','), body.lastIndexOf('.'));
  if (last === -1) return sign * Number(body);

  const decimalMark = body[last]!;
  const groupMark = decimalMark === ',' ? '.' : ',';
  const whole = body.slice(0, last);
  const fraction = body.slice(last + 1);

  const lone = !whole.includes(',') && !whole.includes('.');
  if (lone && fraction.length === 3 && !whole.startsWith('0')) {
    return sign * Number(whole + fraction);
  }

  // Anything of the other mark left in the whole part means two decimal
  // separators in one figure.
  if (whole.includes(decimalMark)) return null;

  const groups = whole.split(groupMark);
  if (groups.length > 1) {
    const wellFormed = groups.every((group, index) =>
      index === 0 ? group.length > 0 && group.length <= 3 : group.length === 3,
    );
    if (!wellFormed) return null;
  }

  // A bare `.5` has an empty whole part, which is a number even though it is
  // not a digit.
  const digits = groups.join('') || '0';
  if (!/^\d+$/.test(digits) || !/^\d+$/.test(fraction)) return null;

  return sign * Number(`${digits}.${fraction}`);
}
