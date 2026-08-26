import { deserialise, serialise, type Analysis } from './analysis';

const KEY = 'unify-lens:saved';

export interface SavedAnalysis {
  readonly id: string;
  readonly name: string;
  readonly savedAt: number;
  readonly analysis: Analysis;
}

/**
 * Saved analyses, on this device.
 *
 * `localStorage` rather than IndexedDB: the whole list is a handful of small
 * specs, always read in full, and never queried — the simpler store is the
 * right size for it. Nothing here is shared; a link is how an analysis reaches
 * someone else.
 */
export function listSaved(): SavedAnalysis[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry): SavedAnalysis | null => {
        const record = entry as Record<string, unknown>;
        const analysis =
          typeof record['analysis'] === 'string' ? deserialise(record['analysis']) : null;
        if (!analysis || typeof record['id'] !== 'string' || typeof record['name'] !== 'string') {
          return null;
        }
        return {
          id: record['id'],
          name: record['name'],
          savedAt: typeof record['savedAt'] === 'number' ? record['savedAt'] : 0,
          analysis,
        };
      })
      .filter((entry): entry is SavedAnalysis => entry !== null)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function save(name: string, analysis: Analysis, now: number): SavedAnalysis[] {
  const entry = {
    id: `${now}-${Math.round(now % 100000)}`,
    name,
    savedAt: now,
    // Stored as text so the Date tagging survives, exactly as in a URL.
    analysis: serialise(analysis),
  };

  const existing = read();
  write([entry, ...existing.filter((other) => other['name'] !== name)]);
  return listSaved();
}

export function remove(id: string): SavedAnalysis[] {
  write(read().filter((entry) => entry['id'] !== id));
  return listSaved();
}

function read(): Array<Record<string, unknown>> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function write(entries: ReadonlyArray<Record<string, unknown>>): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {
    // A full or disabled store must not break the app; saving simply fails.
  }
}
