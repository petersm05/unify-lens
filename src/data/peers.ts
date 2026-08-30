import type { AttributeKind } from './attributes';
import type { Sample, Value } from './sample-store';
import { formatCount } from '../format';

/**
 * Where one object's value sits among its peers.
 *
 * The record sheet's second line, as arithmetic. Pure and free of the SDK for
 * the usual reason — a mark that is merely ugly is a nuisance, and a mark that
 * is wrong is a claim about someone's estate — so the rank and the shares are
 * testable without a session.
 *
 * Every mark answers the same question: **what share of the population matches
 * this object**. That is what makes the enum, boolean, free-text and unset rows
 * one idea rather than four, and it is why the caption and the mark can never
 * disagree — they are two renderings of one number.
 */

/**
 * How many segments a 104px track can hold and still be read.
 *
 * Twelve segments with a 2px gap between them are 6.8px each, which is a mark;
 * twenty are 3.3px, which is a texture. An enumeration longer than this gets
 * the share bar instead — the same mark a value the metamodel does not list
 * falls back to.
 */
const MAX_STEPS = 12;

/** The mark drawn on the peer line. */
export type PeerMark =
  /** A tick along the population's range, at `at` (0…1). */
  | { readonly shape: 'position'; readonly at: number }
  /** One segment per allowed enum value; this object's is `index`. */
  | { readonly shape: 'steps'; readonly total: number; readonly index: number }
  /** A bar filled to the share of the population that matches (0…1). */
  | { readonly shape: 'share'; readonly share: number };

export interface Peers {
  readonly mark: PeerMark;
  /**
   * The same figure in words.
   *
   * Never optional. A 104px track cannot be read to a percentage, and it is the
   * only thing on the row carrying colour — so the words are what the row
   * actually says, and the mark is what makes a column of them scannable.
   */
  readonly caption: string;
}

export interface PeerInput {
  readonly kind: AttributeKind;
  /** This attribute's values across the sample, absent ones left out. */
  readonly values: readonly Value[];
  /** How many objects in the sample had no value for it. */
  readonly missing: number;
  /** This object's own value, or `null` where it has none. */
  readonly own: Value | null;
  /** For `enum`: the allowed values, in the metamodel's declared order. */
  readonly order?: readonly string[];
  /**
   * Whether the read stopped short of the population.
   *
   * Not decoration. Every figure below is derived from the sample, so where it
   * is partial the caption must stop naming a total it does not have.
   */
  readonly truncated: boolean;
}

/**
 * What a sample holds for one attribute: the values, and how many lack one.
 *
 * An empty string counts as no value, which is the rule `object-detail`'s
 * `render` already applies to the row itself. `SampleStore` keeps one, so
 * without this the sheet could print "Not set" on a row and "412 of 412 have
 * one" underneath it.
 */
export function valuesOf(sample: Sample, key: string): { values: Value[]; missing: number } {
  const values: Value[] = [];
  let missing = 0;

  for (const object of sample.objects) {
    const value = object.values.get(key);
    if (value === undefined || value === '') missing += 1;
    else values.push(value);
  }

  return { values, missing };
}

/**
 * The peer line for one attribute, or `null` where there is nothing to say.
 *
 * `null` rather than an empty mark: a row with no peer line is the row this
 * panel had before, which is a complete thing. A placeholder would be an
 * assertion that something is missing.
 */
export function peersFor(input: PeerInput): Peers | null {
  const size = input.values.length + input.missing;
  if (size === 0) return null;

  // Before the unset branch, not inside the switch after it. A reference
  // carries a value the sheet prints and no scalar behind it, so `own` is null
  // for a row that is not empty at all — and "31 of 412 are also unset" under a
  // row naming an object would be a plain falsehood.
  if (input.kind === 'reference') return null;

  const of = input.truncated ? 'those read' : formatCount(size);

  if (input.own === null) {
    // An object with no value cannot be ranked, so the peer fact is the gap
    // itself. Where the sample says nothing is missing while this object is,
    // the two disagree — the object was past the point the read stopped — and
    // the honest answer is to say nothing rather than to print "0 of 412".
    if (input.missing === 0) return null;
    // "have none" rather than "are also unset". This object is itself in the
    // population and is itself unset, so it is one of the objects counted —
    // and "also" says the opposite, that the figure is the others.
    return {
      mark: { shape: 'share', share: input.missing / size },
      caption: `${formatCount(input.missing)} of ${of} have none`,
    };
  }

  switch (input.kind) {
    case 'integer':
    case 'real':
    case 'money':
    case 'date': {
      const own = asNumber(input.own);
      if (own === null) return null;

      // Ranked against the objects that *have* a value, and the caption names
      // that same count. An object cannot be higher than an absent number, so
      // ranking over the whole population and then printing the population's
      // size would put two different denominators on one row — the bar drawn
      // from one and the sentence naming the other.
      const ranked = numbersIn(input.values);
      const at = rankAmong(ranked, own);
      if (at === null) return null;

      const among = input.truncated ? 'those read' : formatCount(ranked.length);
      // "later than", not "older than 1 - at". The caption has to be the same
      // number the mark draws, or a row says 78% under a bar filled to 22%.
      return { mark: { shape: 'position', at }, caption: rankPhrase(at, input.kind, among) };
    }

    case 'enum': {
      const own = String(input.own);
      const order = input.order ?? [];
      const index = order.indexOf(own);
      const matching = countMatching(input.values, own);
      const caption = `${formatCount(matching)} of ${of} share it`;

      // A value the metamodel does not list — a stale sample, or a label that
      // did not resolve — has no segment to fill, but its share is still a fact.
      // So does an enumeration with more values than the track can draw.
      if (index === -1 || order.length > MAX_STEPS) {
        return { mark: { shape: 'share', share: matching / size }, caption };
      }
      return { mark: { shape: 'steps', total: order.length, index }, caption };
    }

    case 'boolean': {
      const own = input.own === true;
      const matching = input.values.filter((value) => value === own).length;
      return {
        mark: { shape: 'share', share: matching / size },
        caption: `${formatCount(matching)} of ${of} ${own ? 'are' : 'are not'}`,
      };
    }

    case 'string':
    case 'text':
      // "Higher than 78%" means nothing for a vendor name. What is worth
      // knowing about free text is how many objects carry any at all.
      return {
        mark: { shape: 'share', share: input.values.length / size },
        caption: `${formatCount(input.values.length)} of ${of} have one`,
      };

    // No `reference` case: the guard above has already taken it out of the
    // union, and TypeScript rejects a branch for a kind that cannot reach here.
  }
}

/**
 * A rank as a sentence, carrying one comparator rather than two.
 *
 * `percent()` guards its own ends with `<1%` and `>99%`, which is right for a
 * figure standing alone and reads as two comparators inside "higher than >99%
 * of 412". So the ends are said in words here, and nothing in between needs
 * guarding: with a population of any size, a rank that rounds to 0 or 100 has
 * already been caught by one of them.
 */
function rankPhrase(at: number, kind: AttributeKind, among: string): string {
  const verb = kind === 'date' ? 'later' : 'higher';
  if (at === 0) return `${kind === 'date' ? 'the earliest' : 'the lowest'} of ${among}`;
  if (at < 0.005) return `${verb} than a few of ${among}`;
  if (at >= 0.995) return `${verb} than all but a few of ${among}`;
  return `${verb} than ${Math.round(at * 100)}% of ${among}`;
}

/**
 * The share of a population a value is above, from 0 to 1.
 *
 * A rank, not a bin: the values strictly below it, divided by how many there
 * are. No bucketing and no interpolation, and ties are not counted — so the
 * smallest value in a population is above none of it, and a value shared by
 * everyone is above none of it either.
 *
 * The object itself is in the population, and is not below itself, so it
 * counts in the denominator and not in the numerator. That is what makes
 * "higher than 78% of 412" a statement about the other 412 rather than 411.
 */
export function rankAmong(values: readonly number[], own: number): number | null {
  if (values.length === 0) return null;

  let below = 0;
  for (const value of values) {
    if (value < own) below += 1;
  }
  return below / values.length;
}

/**
 * The sentence that says where the figures came from.
 *
 * A complete sample *is* the population, so it can say so. A truncated one
 * cannot, and does not have the population's size to name either — the sheet
 * would need a count query it has no other reason to make — so it says what it
 * read and that it is not everything.
 *
 * The number comes from the sample itself and never from `SAMPLE_LIMIT`: the
 * read also stops on a time budget, so a slow one holds whatever it reached
 * rather than the ceiling.
 *
 * It says "objects of this type" rather than naming the type, because naming
 * it means pluralising it, and there is no rule that turns every label the
 * metamodel might carry into a plural that reads.
 */
export function provenanceOf(sample: Sample): string {
  const read = formatCount(sample.objects.length);
  return sample.truncated
    ? `Peer figures read from the first ${read} objects — not the whole population.`
    : `Peer figures read from all ${read} objects of this type.`;
}

/** Numbers and dates alike, as numbers a rank can be taken over. */
function numbersIn(values: readonly Value[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    const number = asNumber(value);
    if (number !== null) out.push(number);
  }
  return out;
}

function asNumber(value: Value): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

/** Compared as text, because the sample holds an enum as its display label. */
function countMatching(values: readonly Value[], own: string): number {
  let matching = 0;
  for (const value of values) {
    if (String(value) === own) matching += 1;
  }
  return matching;
}
