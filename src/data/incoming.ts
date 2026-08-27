import type { SavedAnalysis } from './saved';
import type { Session } from '../sdk/client';

const KEY = 'unify-lens:seen-shares';

export interface Incoming {
  /**
   * Resolves once what has already been seen is known.
   *
   * Reading it needs the signed-in identity, which is a request. Anything that
   * draws a count has to wait for that, or it would compute "nothing new" from
   * an empty set and draw nothing.
   */
  ready(): Promise<void>;
  /** Shared with me and not yet looked at, newest first. */
  unseen(entries: readonly SavedAnalysis[]): SavedAnalysis[];
  /** Records that these have now been shown. */
  markSeen(entries: readonly SavedAnalysis[]): Promise<void>;
}

/**
 * What other people have shared with me since I last looked.
 *
 * A count of everything shared with me would be a number, not a notice: it
 * would sit there saying "3" forever and stop meaning anything. What is worth
 * interrupting someone for is what is *new*, so the badge counts what has not
 * been seen and clears once it has.
 *
 * "Seen" is kept on the device rather than in Unify. It describes this
 * installation's reading, and there is nowhere on a deliverable to record that
 * a recipient noticed it without granting every recipient the right to write
 * to someone else's analysis.
 */
export function createIncoming(session: Session): Incoming {
  let seen: Set<string> | null = null;
  let key = KEY;

  /**
   * Scoped to whoever is signed in.
   *
   * A shared iPad is the case this exists for: without it, one person's having
   * read something would suppress the next person's badge for the same
   * analysis — and a badge wrongly hidden is the failure that matters here,
   * since nobody goes looking for a notice they were never given.
   */
  async function load(): Promise<Set<string>> {
    if (seen) return seen;
    try {
      const user = await session.sdk.authClient.getAuthenticatedUser();
      const id = (user as { userId?: string }).userId;
      if (id) key = `${KEY}:${id}`;
    } catch {
      // Unreadable identity is not worth failing over; the shared key is only
      // less precise, not wrong.
    }
    seen = read(key);
    return seen;
  }

  const loaded = load();

  return {
    ready: async (): Promise<void> => {
      await loaded;
    },

    unseen(entries: readonly SavedAnalysis[]): SavedAnalysis[] {
      // Synchronous on purpose: this is asked for on every render. Callers
      // that care about the answer being complete wait on `ready` first.
      const known = seen;
      if (!known) return [];
      return entries.filter((entry) => !entry.mine && !known.has(entry.id));
    },

    async markSeen(entries: readonly SavedAnalysis[]): Promise<void> {
      const known = await load();
      for (const entry of entries) {
        if (!entry.mine) known.add(entry.id);
      }

      // Kept to what is still in the list, so ids of analyses since deleted or
      // unshared do not accumulate forever. Pruning runs whether or not
      // anything was added: an analysis going away is a change too, and one
      // that would otherwise never be noticed.
      const present = new Set(entries.map((entry) => entry.id));
      for (const id of known) {
        if (!present.has(id)) known.delete(id);
      }
      write(key, [...known]);
    },
  };
}

function read(key: string): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(key: string, ids: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(ids));
  } catch {
    // A device that will not store this loses the badge clearing, not the app.
  }
}
