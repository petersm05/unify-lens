import type { AttributeKind } from './attributes';

/**
 * Turning what someone typed into a value the graph will accept.
 *
 * Deliberately free of the SDK, and of the DOM: every rule here is arithmetic
 * or string handling, which is the part worth testing and the part a mistake in
 * is expensive — a misread separator does not fail, it saves the wrong number.
 * The write that will carry these values belongs in a module of its own, the
 * way `view-writer.ts` holds the only call this app makes that changes
 * anything; nothing here reaches the SDK, and nothing here should.
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
    default: {
      // `AttributeKind` is a cast over whatever the metamodel returned, so a
      // kind this app does not model reaches here at run time even though the
      // union says it cannot. The assignment keeps the compiler's exhaustiveness
      // check — adding a kind to the union fails here — while the return keeps
      // `parseEdit` from falling off its own switch and handing a caller
      // `undefined` where it promised a result.
      const unmodelled: never = kind;
      void unmodelled;
      return null;
    }
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
      // A control emits `true`/`false`, and a person types Yes or No — which is
      // what the message below tells them to do, so it has to be taken. A
      // message naming an input the parser then refuses is worse than no
      // message.
      const said = text.toLowerCase();
      if (said === 'true' || said === 'yes') return { ok: true, value: true };
      if (said === 'false' || said === 'no') return { ok: true, value: false };
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
  if (typeof value === 'number') return PLAIN.format(value);
  if (typeof value === 'boolean') return String(value);
  return value;
}

/**
 * Digits, never exponent notation.
 *
 * `String(1e21)` is `"1e+21"`, which `parseEdit` refuses — so opening a field
 * on a value the object already holds and saving it unchanged would fail. A
 * fixed locale because the field holds a number rather than a formatted one,
 * and `toNumber` reads a dot decimal in any locale.
 */
const PLAIN = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumFractionDigits: 20,
});

/**
 * Whether a save would change anything.
 *
 * Checked before the write rather than after it: a no-op `UPDATE` is a real
 * mutation to everything downstream — it moves `updatedAt`, lands in the audit
 * log, and comes back over the realtime feed to invalidate every cached sample
 * for the type.
 *
 * Dates are compared by the day they name, not by the instant. A `date`
 * attribute is shown as a day and edited as a day, so a stored value carrying a
 * time of day cannot survive the field it is edited in — comparing instants
 * would call that a change and issue a write whose only effect is to move the
 * value to midnight.
 */
export function isUnchanged(before: EditValue, after: EditValue): boolean {
  if (before instanceof Date && after instanceof Date) {
    return dateToInputValue(before) === dateToInputValue(after);
  }
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
 * them, and a pasted figure arrives in whatever notation it was copied from —
 * including this app's own, which groups.
 *
 * The rule turns on repetition rather than on position. **A decimal separator
 * occurs at most once**, so a mark that appears twice is a group separator
 * whatever else is going on, and the other mark is the decimal point. That
 * reads `1.240.000,50` and `1,234,567.89` alike, and — the case a position
 * rule gets wrong — reads a grouped whole number like `1,240,000`, which is
 * exactly the form `formatCount` prints and so exactly what someone copies out
 * of this app and types back into it.
 *
 * **One separator on its own is a decimal point**, always. `1,500` is one and
 * a half, not fifteen hundred. That is the half of this that is a judgement,
 * and it went the other way at first — a lone separator before three digits
 * was read as a group, on the reasoning that nobody types `1,500` meaning one
 * and a half.
 *
 * What settled it is that the guess is not confined to what a person types.
 * `seedFor` opens a field on the value the object already holds, in machine
 * form with a dot: an attribute holding 1.234 seeded `"1.234"`, which the
 * group reading turned into 1234. Open the editor on such a value, change
 * nothing, save, and the figure is multiplied by a thousand — silently, and
 * without anyone having typed anything. A guess that only misreads what
 * someone typed is a guess they can see; one that misreads what the app itself
 * wrote is not.
 *
 * So grouping has to be unambiguous to be read as grouping: a mark that
 * repeats, or a pair where the other mark settles which is which. Groups are
 * then checked — every one after the first is three digits, and the decimal
 * point comes after all of them — so `1.24.000` is refused rather than guessed
 * at.
 */
function toNumber(input: string): number | null {
  const text = unspace(input);
  if (text === null) return null;
  if (!/^[+-]?[\d.,]*\d$/.test(text)) return null;

  const sign = text.startsWith('-') ? -1 : 1;
  const body = text.replace(/^[+-]/, '');

  const marks = separatorsIn(body);
  if (marks === null) return null;
  const { decimalMark, groupMark } = marks;

  // Groups come before the decimal point, or they are not groups.
  if (
    decimalMark !== null &&
    groupMark !== null &&
    body.lastIndexOf(groupMark) > body.indexOf(decimalMark)
  ) {
    return null;
  }

  const point = decimalMark === null ? body.length : body.indexOf(decimalMark);
  const fraction = body.slice(point + 1);
  if (decimalMark !== null && !/^\d+$/.test(fraction)) return null;

  const whole = groupMark === null ? body.slice(0, point) : ungroup(body.slice(0, point), groupMark);
  if (whole === null || !/^\d*$/.test(whole)) return null;

  // A bare `.5` has an empty whole part, which is a number even though it is
  // not a digit.
  const value = sign * Number(`${whole || '0'}.${decimalMark === null ? '0' : fraction}`);

  // Four hundred digits parse cleanly and come out as Infinity, which is not a
  // number anyone typed and not one any attribute can hold. Refused here so it
  // reads as "not a number" rather than reaching the integer check and being
  // refused for not being whole.
  return Number.isFinite(value) ? value : null;
}

/**
 * Space grouping, closed up — or `null` where the spaces do not group.
 *
 * Several locales group with a space, and a figure copied out of this app's own
 * formatting comes back carrying one. `\s` covers the non-breaking and narrow
 * no-break spaces Intl uses, so this is not a hand-written list of them.
 *
 * They are checked rather than simply deleted. A space is a group separator,
 * and grouping by space has to hold the way grouping by anything else does:
 * `1 24 000` is refused for the same reason `1.24.000` is, where stripping
 * every space first would have read it as 124000.
 */
function unspace(input: string): string | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] ?? '';

  const last = parts.length - 1;
  for (const [index, part] of parts.entries()) {
    // The first group is one to three digits and carries the sign; the last
    // may carry the fraction; the rest are three digits and nothing else.
    const shape =
      index === 0 ? /^[+-]?\d{1,3}$/ : index === last ? /^\d{3}([.,]\d+)?$/ : /^\d{3}$/;
    if (!shape.test(part)) return null;
  }
  return parts.join('');
}

/** Which mark groups and which one separates the fraction, if either does. */
function separatorsIn(
  body: string,
): { decimalMark: string | null; groupMark: string | null } | null {
  const commas = occurrences(body, ',');
  const dots = occurrences(body, '.');

  // Two marks that both repeat cannot both be groups and cannot be a decimal
  // point, so this is not a figure in any notation.
  if (commas > 1 && dots > 1) return null;

  if (commas > 1) return { groupMark: ',', decimalMark: dots === 1 ? '.' : null };
  if (dots > 1) return { groupMark: '.', decimalMark: commas === 1 ? ',' : null };

  if (commas === 1 && dots === 1) {
    const decimalMark = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.';
    return { decimalMark, groupMark: decimalMark === ',' ? '.' : ',' };
  }

  // A separator on its own is a decimal point. Nothing here can tell a group
  // from a decimal in `1,500`, and the reading that guesses is the one that
  // silently rewrites a value the app itself put in the field.
  if (commas === 1) return { decimalMark: ',', groupMark: null };
  if (dots === 1) return { decimalMark: '.', groupMark: null };

  return { decimalMark: null, groupMark: null };
}

/** `1,240,000` → `1240000`, or `null` where the groups are not groups. */
function ungroup(whole: string, mark: string): string | null {
  const groups = whole.split(mark);
  const wellFormed = groups.every((group, index) =>
    index === 0 ? group.length > 0 && group.length <= 3 : group.length === 3,
  );
  return wellFormed ? groups.join('') : null;
}

function occurrences(body: string, mark: string): number {
  let count = 0;
  for (const character of body) {
    if (character === mark) count += 1;
  }
  return count;
}
