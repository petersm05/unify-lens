import type { ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { BackendStamp, Kg } from '../sdk/client';
import { attributesFor, type AttributeChoice } from './attributes';
import { keepOnly, read, write } from './idb';

const STORE = 'schema';

/**
 * How long a cached schema is trusted without checking.
 *
 * The backend version is part of the cache key, but that tracks the platform
 * build, not a tenant's metamodel: someone adding an attribute category does
 * not change it. So a cached schema is also re-read on a timer, and the reader
 * is told if it turned out to have changed.
 */
const REVALIDATE_AFTER_MS = 10 * 60 * 1000;

interface Entry {
  readonly choices: AttributeChoice[];
  readonly storedAt: number;
}

/**
 * The attribute schema for a type, from this device where possible.
 *
 * The schema is needed before anything can be drawn, and it is the slowest kind
 * of thing to be waiting on: it changes rarely and costs a round trip every
 * time. Reading it locally turns the opening moment of the app from a wait into
 * a paint.
 *
 * `onChanged` fires only when a revalidation actually disagrees with what was
 * shown — so the common case is silent, and a genuine metamodel change still
 * corrects itself without a reload.
 */
export async function attributesForCached(
  kg: Kg,
  type: ObjectType,
  stamp: BackendStamp,
  onChanged?: (choices: AttributeChoice[]) => void,
): Promise<AttributeChoice[]> {
  const key = `${stamp.key}|${type}`;
  // Without a version that moves on upgrade, age proves nothing: check every
  // time. The reader still gets the cached answer immediately either way.
  const trustFor = stamp.versioned ? REVALIDATE_AFTER_MS : 0;
  const cached = await read<Entry>(STORE, key);

  if (!cached) {
    const choices = await attributesFor(kg, type);
    void store(key, choices);
    return choices;
  }

  // Fresh enough to trust outright.
  if (Date.now() - cached.storedAt < trustFor) return cached.choices;

  // Otherwise answer now and check behind the reader.
  void (async () => {
    try {
      const choices = await attributesFor(kg, type);
      await store(key, choices);
      if (onChanged && !same(cached.choices, choices)) onChanged(choices);
    } catch {
      // The cached copy stands; a failed check is not a reason to lose it.
    }
  })();

  return cached.choices;
}

async function store(key: string, choices: AttributeChoice[]): Promise<void> {
  const stamp = key.slice(0, key.lastIndexOf('|') + 1);
  await write(STORE, key, { choices, storedAt: Date.now() } satisfies Entry);
  // A backend upgrade changes the stamp, which orphans every older entry.
  await keepOnly(STORE, stamp);
}

/** Identity by content, so a reordered-but-equal schema is not called a change. */
function same(a: readonly AttributeChoice[], b: readonly AttributeChoice[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}
