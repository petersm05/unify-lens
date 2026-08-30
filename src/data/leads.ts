import { isPlottable, quantiles, type AttributeChoice } from './attributes';
import type { Sample, Value } from './sample-store';
import { formatCompact, formatCount, formatMoney } from '../format';

/**
 * What is worth looking at in a population, read off one sample of it.
 *
 * The view this feeds opens on an empty pane and a list of attribute names,
 * which answers "show me business criticality across applications" and says
 * nothing at all to "is there anything wrong with my model?" — the state most
 * people are in when they arrive. These are the leads: a coverage hole, a
 * default nobody has changed, a figure orders of magnitude above its median.
 *
 * **It costs one read, not one per attribute.** The obvious reading of the
 * problem — coverage for forty attributes is forty `getCount()` pairs — is the
 * expensive one, and it is not the shape of the data: the selector cannot
 * project a single attribute, so every object already arrives carrying all
 * forty of its values. `SampleStore` has that population in hand the moment
 * any chart has been drawn, and this derives every lead from it without
 * touching the network. That is what makes the screen affordable enough to
 * offer at all; the caller decides whether the *read* is worth starting.
 *
 * Nothing here reaches the SDK, so the rankings and the wording are testable
 * without one.
 */

/**
 * Below this share of the population an attribute reads as sparse.
 *
 * The coverage gauge's own threshold and its own word: an attribute this
 * screen calls sparse is one the card will also call sparse when it is opened,
 * rather than a second opinion about the same number.
 */
const SPARSE = 0.5;

/**
 * The share of the values one of them has to hold to be worth reporting.
 *
 * A distribution where one value holds nearly everything is usually a default
 * nobody has changed rather than a finding about the estate — which is exactly
 * why it is worth surfacing, and why the bar is high. At 0.75 it fired on
 * genuinely lopsided but real distributions, which is noise.
 */
const DOMINANT = 0.9;

/**
 * How far above the median the largest value has to sit.
 *
 * Twenty times, on at least this many values — a median taken over three
 * numbers is not a middle, and the ratio against it says nothing.
 */
const OUTLIER_RATIO = 20;
const OUTLIER_VALUES = 8;

/** How many attributes a category needs before "the whole section" holds. */
const CATEGORY_MEMBERS = 3;

/**
 * How many leads of one kind are shown at once.
 *
 * Per kind rather than overall, because the alternative is a model with thirty
 * sparse attributes crowding out every other reading — the ranking's job is to
 * pick what to look at first, and four coverage holes said four ways is one
 * thing to look at. Dismissing a row promotes the next of its own kind.
 */
export const PER_KIND = 3;

export type LeadKind = 'empty' | 'sparse' | 'concentrated' | 'outlier';

export interface Lead {
  /** Stable across scans of the same population, so a dismissal can name it. */
  readonly id: string;
  readonly kind: LeadKind;
  /** A word for the kind, so the row is never a colour alone. */
  readonly word: string;
  /** What the row is about — an attribute's name, or a category's. */
  readonly title: string;
  /** Where that sits: the category, or how much of it the row speaks for. */
  readonly note: string;
  /** The reading itself: "12% covered", "94% are Production". */
  readonly headline: string;
  /** The figures behind it. */
  readonly detail: string;
  /** The chart the row opens. */
  readonly choice: AttributeChoice;
  /** Rank within the kind, largest first. Not comparable across kinds. */
  readonly magnitude: number;
}

export interface Scan {
  /** Every lead found, ranked. `shortlist` decides which are shown. */
  readonly leads: readonly Lead[];
  /** How many objects the leads were read from. */
  readonly sampled: number;
  /** Set when the sample stopped short, so every share here is an estimate. */
  readonly truncated: boolean;
  /** How many attributes were examined. */
  readonly examined: number;
}

/** Kinds in the order they are worth reading, which is also the row order. */
const ORDER: readonly LeadKind[] = ['empty', 'sparse', 'concentrated', 'outlier'];

const WORDS: Readonly<Record<LeadKind, string>> = {
  empty: 'Unused',
  sparse: 'Sparse',
  concentrated: 'One value',
  outlier: 'Outlier',
};

/**
 * A share as a percentage, without rounding a real value away to nothing.
 *
 * "0% covered" on an attribute five objects carry is the one reading this
 * screen must not give: the row's whole claim is that something is missing,
 * and a reader who opens the chart and finds five bars has been told a
 * falsehood by a rounding rule.
 */
export function percent(share: number): string {
  if (share > 0 && share < 0.005) return '<1%';
  if (share < 1 && share > 0.995) return '>99%';
  return `${Math.round(share * 100)}%`;
}

/** Counts against a population, printed the way the coverage card prints them. */
function of(part: number, whole: number, noun: string): string {
  return `${formatCount(part)} of ${formatCount(whole)} ${noun}`;
}

function figure(choice: AttributeChoice, value: number): string {
  return choice.kind === 'money' ? formatMoney(value, choice.currency) : formatCompact(value);
}

/** The label a categorical value is tallied under, or null when it is not one. */
function categoricalLabel(value: Value): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * Reads every attribute of one sampled population.
 *
 * Every lead is a claim about the objects that were *read*: on a truncated
 * sample the shares are estimates from its prefix, which is why `truncated`
 * travels out with them rather than being decided here.
 */
export function scanForLeads(sample: Sample, choices: readonly AttributeChoice[]): Scan {
  const total = sample.objects.length;
  // Booleans are examined by nothing here on purpose: `enumDistribution` counts
  // them through `enumValues`, which a boolean definition does not have, so the
  // chart a row would open reports every object as "Not set" (#61). A lead is a
  // route into a chart, and that one contradicts whatever the row said.
  const examined = choices.filter((choice) => isPlottable(choice) && choice.kind !== 'boolean');

  if (total === 0) {
    return { leads: [], sampled: 0, truncated: sample.truncated, examined: examined.length };
  }

  const found: Lead[] = [];
  /** Sparse leads by category, for the rollup — every member has to be sparse. */
  const byCategory = new Map<string, { members: number; sparse: Lead[]; covered: number[] }>();

  for (const choice of examined) {
    const key = `${choice.categoryId}::${choice.name}`;
    const values: Value[] = [];
    for (const object of sample.objects) {
      const value = object.values.get(key);
      if (value !== undefined) values.push(value);
    }

    const share = values.length / total;
    const bucket = byCategory.get(choice.categoryId) ?? { members: 0, sparse: [], covered: [] };
    bucket.members += 1;
    bucket.covered.push(share);
    byCategory.set(choice.categoryId, bucket);

    // One lead per attribute, in this order. An attribute nobody fills in is
    // not also a story about which of the few values dominates: reporting both
    // would put the same attribute on the screen twice, and the second row
    // would be describing a handful of objects.
    const lead = coverageLead(choice, values.length, total) ?? valueLead(choice, values);
    if (!lead) continue;

    found.push(lead);
    if (lead.kind === 'sparse') bucket.sparse.push(lead);
  }

  return {
    leads: rank(rollUpCategories(found, byCategory)),
    sampled: total,
    truncated: sample.truncated,
    examined: examined.length,
  };
}

function coverageLead(choice: AttributeChoice, withValue: number, total: number): Lead | null {
  const share = withValue / total;
  if (share >= SPARSE) return null;

  return {
    id: `sparse:${choice.categoryId}.${choice.definitionId}`,
    kind: 'sparse',
    word: WORDS.sparse,
    title: choice.name,
    note: choice.categoryName,
    headline: `${percent(share)} covered`,
    detail: of(total - withValue, total, 'not set'),
    choice,
    magnitude: 1 - share,
  };
}

/** The reading that comes from the values themselves, once there are enough. */
function valueLead(choice: AttributeChoice, values: readonly Value[]): Lead | null {
  if (values.length === 0) return null;

  if (choice.kind === 'enum' || choice.kind === 'string' || choice.kind === 'text') {
    const tally = new Map<string, number>();
    for (const value of values) {
      const label = categoricalLabel(value);
      if (label === null) continue;
      tally.set(label, (tally.get(label) ?? 0) + 1);
    }

    const counted = [...tally.values()].reduce((sum, count) => sum + count, 0);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top || counted === 0) return null;

    const share = top[1] / counted;
    if (share < DOMINANT) return null;

    return {
      id: `concentrated:${choice.categoryId}.${choice.definitionId}`,
      kind: 'concentrated',
      word: WORDS.concentrated,
      title: choice.name,
      note: choice.categoryName,
      headline: `${percent(share)} are “${top[0]}”`,
      // Of the objects that carry a value, not of the population — the share
      // is a statement about the values, and the two differ wherever coverage
      // is short of complete.
      detail: `${formatCount(top[1])} of the ${formatCount(counted)} objects with a value`,
      choice,
      magnitude: share,
    };
  }

  if (choice.kind !== 'integer' && choice.kind !== 'real' && choice.kind !== 'money') return null;

  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (numbers.length < OUTLIER_VALUES) return null;

  const stats = quantiles(numbers);
  // A median at or below zero has no ratio worth printing: the multiple would
  // be undefined, negative, or an artefact of the sign rather than a distance.
  if (!stats || stats.median <= 0) return null;

  const ratio = stats.max / stats.median;
  if (ratio < OUTLIER_RATIO) return null;

  return {
    id: `outlier:${choice.categoryId}.${choice.definitionId}`,
    kind: 'outlier',
    word: WORDS.outlier,
    title: choice.name,
    note: choice.categoryName,
    headline: `highest value is ${formatCount(Math.round(ratio))}× the median`,
    detail: `${figure(choice, stats.max)} against a median of ${figure(choice, stats.median)}`,
    choice,
    magnitude: ratio,
  };
}

/**
 * A category none of whose attributes are filled in is one finding, not eight.
 *
 * The members' own rows are dropped for it. Eight sparse rows from one
 * category is the failure mode this screen has to avoid: it reads as eight
 * things to fix where it is one decision about a section of the metamodel that
 * nobody uses, and it buries every other kind of lead underneath it.
 *
 * The row opens the best covered of them, since a chart of the emptiest has
 * nothing on it, and the detail says which figure that is.
 */
function rollUpCategories(
  leads: readonly Lead[],
  categories: ReadonlyMap<string, { members: number; sparse: Lead[]; covered: number[] }>,
): Lead[] {
  const rolled: Lead[] = [];
  const replaced = new Set<string>();

  for (const [categoryId, bucket] of categories) {
    if (bucket.members < CATEGORY_MEMBERS || bucket.sparse.length !== bucket.members) continue;

    // The least sparse member: the highest magnitude is the emptiest.
    const best = bucket.sparse.reduce((a, b) => (b.magnitude < a.magnitude ? b : a));
    const bestShare = Math.max(...bucket.covered);

    for (const member of bucket.sparse) replaced.add(member.id);
    rolled.push({
      id: `empty:${categoryId}`,
      kind: 'empty',
      word: WORDS.empty,
      title: best.choice.categoryName,
      note: `${formatCount(bucket.members)} attributes`,
      headline: 'every one is sparse',
      detail: `best covered is ${best.choice.name}, at ${percent(bestShare)}`,
      choice: best.choice,
      // Averaged over the members, so a category of eight empty attributes
      // ranks above one of three that are merely thin.
      magnitude: bucket.sparse.reduce((sum, lead) => sum + lead.magnitude, 0) / bucket.members,
    });
  }

  return [...rolled, ...leads.filter((lead) => !replaced.has(lead.id))];
}

/** Kind order first, then magnitude within the kind. */
function rank(leads: readonly Lead[]): Lead[] {
  return [...leads].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.magnitude - a.magnitude,
  );
}

/**
 * The rows to show: the strongest few of each kind, minus what was dismissed.
 *
 * Applied at render rather than at scan, so dismissing a row promotes the next
 * of its kind instead of leaving a gap — the list is a shortlist of a longer
 * ranking, and dismissing is how the rest of it is reached.
 */
export function shortlist(leads: readonly Lead[], dismissed: ReadonlySet<string>): Lead[] {
  const taken = new Map<LeadKind, number>();
  const shown: Lead[] = [];

  for (const lead of leads) {
    if (dismissed.has(lead.id)) continue;
    const used = taken.get(lead.kind) ?? 0;
    if (used >= PER_KIND) continue;
    taken.set(lead.kind, used + 1);
    shown.push(lead);
  }

  return shown;
}
