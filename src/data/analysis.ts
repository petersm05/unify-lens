import type { ObjectType } from '@bizzdesign/sdk-bundle/browser';
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

