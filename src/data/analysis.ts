import type { ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { AttributeSelection } from './filter';
import type { Mark } from './chart-spec';
import { parsePath, ROOT, type Route } from './route';

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
  /**
   * The deepest screen, kept for links written before the trail existed — and
   * still written, so a build cached before this change can open a new link.
   */
  readonly view: ViewId;
  /** The whole trail, innermost last. Absent in links older than the trail. */
  readonly path?: readonly Route[];
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
 * The trail a link describes.
 *
 * Links written before the trail carry only a view and a type, which is enough
 * to rebuild the stack that view would have been reached through — reaching
 * Attributes means having picked a type, and reaching Network from a type means
 * having passed through its attributes. `fallbackType` covers the one case the
 * old shape could express and the new one cannot: an attribute view with no
 * type chosen, which used to fall back to the first type in the metamodel.
 */
export function pathOf(
  analysis: Analysis,
  fallbackType: () => ObjectType | undefined,
): Route[] {
  const stored = parsePath(analysis.path);
  if (stored.length > 0) return stored;

  const type = analysis.type ?? fallbackType();

  if (analysis.view === 'attributes') {
    return type ? [ROOT, { at: 'attributes', type }] : [ROOT];
  }

  if (analysis.view === 'network') {
    return type
      ? [ROOT, { at: 'attributes', type }, { at: 'network', type }]
      : [ROOT, { at: 'network' }];
  }

  return [ROOT];
}

/** The legacy `view` field for a trail — the kind of its deepest screen. */
export function viewOf(path: readonly Route[]): ViewId {
  return path[path.length - 1]?.at ?? 'population';
}

function isAnalysis(value: unknown): value is Analysis {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<Analysis>;
  return (
    candidate.v === 1 &&
    typeof candidate.env === 'string' &&
    (candidate.view === 'population' ||
      candidate.view === 'attributes' ||
      candidate.view === 'network')
  );
}

