import type { ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { AttributeKind } from './attributes';
import type { AttributeSelection } from './filter';
import type { Mark } from './chart-spec';

export type ViewId = 'population' | 'attributes' | 'network';

/**
 * Everything needed to reproduce what is on screen.
 *
 * Deliberately a description of a *question*, not of an answer: no values, no
 * rows, no counts. A shared link therefore carries nothing the recipient could
 * not already see — their own session fetches the data with their own token —
 * and it stays correct as the graph changes, which a screenshot or an export
 * does not.
 */
export interface Analysis {
  readonly v: 1;
  /** The environment this was built against; a link into another is refused. */
  readonly env: string;
  readonly view: ViewId;
  readonly type?: ObjectType;
  /** `categoryId.definitionId` of the charted attribute. */
  readonly primary?: string;
  readonly secondary?: string;
  readonly mark?: Mark;
  readonly size?: string;
  readonly group?: string;
  readonly active?: string;
  readonly filters?: readonly AttributeSelection[];
}

const DATE_TAG = '__d';

/**
 * Drops what a link does not need to carry.
 *
 * A stored selection keeps its whole `AttributeChoice`, including every value
 * of an enumeration — none of which restoring uses, since the condition is
 * stored alongside and any *new* condition is built from the freshly loaded
 * schema. Trimming it roughly halves the URL.
 */
export function slimFilters(
  selections: readonly AttributeSelection[],
): readonly AttributeSelection[] {
  return selections.map((selection) => ({
    ...selection,
    choice: {
      categoryId: selection.choice.categoryId,
      categoryName: selection.choice.categoryName,
      definitionId: selection.choice.definitionId,
      name: selection.choice.name,
      kind: selection.choice.kind,
      ...(selection.choice.currency ? { currency: selection.choice.currency } : {}),
    },
  }));
}

/**
 * `JSON.stringify` turns a `Date` into a string and `JSON.parse` leaves it as
 * one, so a date filter would come back as a broken condition the backend
 * rejects. Tagging them keeps the round trip lossless.
 */
function replacer(this: unknown, _key: string, value: unknown): unknown {
  // `this[key]` is the pre-`toJSON` value; by the time `value` arrives a Date
  // has already been stringified.
  const raw = (this as Record<string, unknown>)[_key];
  return raw instanceof Date ? { [DATE_TAG]: raw.toISOString() } : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && DATE_TAG in (value as object)) {
    const iso = (value as Record<string, unknown>)[DATE_TAG];
    if (typeof iso === 'string') return new Date(iso);
  }
  return value;
}

export function serialise(analysis: Analysis): string {
  return JSON.stringify(analysis, replacer);
}

export function deserialise(text: string): Analysis | null {
  try {
    const parsed: unknown = JSON.parse(text, reviver);
    return isAnalysis(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** URL-safe base64 — `btoa` output contains `+`, `/` and `=`. */
export function encode(analysis: Analysis): string {
  const bytes = new TextEncoder().encode(serialise(analysis));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(text: string): Analysis | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return deserialise(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * The unions, restated as objects so they can be tested against at runtime.
 *
 * `satisfies Record<..., true>` is what keeps them honest: adding a `Mark` or
 * an `AttributeKind` without adding it here fails the build, rather than
 * quietly making links carrying the new value undecodable.
 */
const VIEWS = { population: true, attributes: true, network: true } satisfies Record<ViewId, true>;

const MARKS = {
  heatmap: true,
  bars: true,
  donut: true,
  histogram: true,
  scatter: true,
  'sum-by': true,
  quadrant: true,
  timeline: true,
  frequency: true,
  trend: true,
} satisfies Record<Mark, true>;

const KINDS = {
  integer: true,
  real: true,
  money: true,
  enum: true,
  boolean: true,
  date: true,
  string: true,
  text: true,
  reference: true,
} satisfies Record<AttributeKind, true>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Object.hasOwn`, not `in`, so `'toString'` is not a valid mark. */
function isMember(table: object, value: unknown): boolean {
  return typeof value === 'string' && Object.hasOwn(table, value);
}

/** A present field must be a string; an absent one is fine. */
function optionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === 'string';
}

function isAnalysis(value: unknown): value is Analysis {
  if (!isRecord(value)) return false;

  if (value['v'] !== 1) return false;
  if (typeof value['env'] !== 'string') return false;
  if (!isMember(VIEWS, value['view'])) return false;

  for (const key of ['type', 'primary', 'secondary', 'size', 'group', 'active']) {
    if (!optionalString(value, key)) return false;
  }

  if (value['mark'] !== undefined && !isMember(MARKS, value['mark'])) return false;

  const filters = value['filters'];
  if (filters === undefined) return true;
  return Array.isArray(filters) && filters.every(isAttributeSelection);
}

/**
 * Checked field by field, because these arrive from a link someone was sent
 * and are composed straight into server-side queries on restore.
 *
 * `condition` is the exception: it is an SDK filter fragment whose interior
 * this app never interprets, so it is required to be an object and left at
 * that. The backend rejects a malformed one, which is the same answer a
 * hand-written schema here would give, a release later.
 */
function isAttributeSelection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value['label'] !== 'string' || typeof value['binLabel'] !== 'string') return false;
  if (!isRecord(value['condition'])) return false;

  const choice = value['choice'];
  if (!isRecord(choice)) return false;
  for (const key of ['categoryId', 'categoryName', 'definitionId', 'name']) {
    if (typeof choice[key] !== 'string') return false;
  }
  if (!isMember(KINDS, choice['kind'])) return false;
  if (choice['enumValues'] !== undefined && !Array.isArray(choice['enumValues'])) return false;
  return optionalString(choice, 'currency');
}

