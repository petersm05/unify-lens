import type { Deliverable, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { deserialise, serialise, type Analysis } from './analysis';

const KEY = 'unify-lens:saved';

/**
 * Identifies our payloads among everyone else's deliverables.
 *
 * `DeliverableType` is a closed enum with nothing generic in it, so a saved
 * analysis has to borrow a type another feature owns. `definition` is what
 * makes ours recognisable: it is a free string already used as a versioned
 * discriminator by convention elsewhere in the platform. The version is part of
 * it so a change to the stored shape can be told apart rather than guessed at.
 */
const DEFINITION = JSON.stringify({ version: 'unify-lens.analysis.1', payload: null });

/**
 * The type a saved analysis borrows.
 *
 * There is no generic option, so one belonging to another feature has to be
 * used. `document` looked like the neutral choice and is not: for `image`,
 * `thumbnail` and `document` the SDK resolves content as binary, which would
 * make a JSON payload arrive as bytes.
 *
 * Of the types that keep content as JSON, this is also the closest in meaning —
 * a saved analysis *is* a population with a chart on it. Anything of ours is
 * identified by `definition`, so a deliverable of this type that belongs to
 * something else is simply skipped.
 */
const TYPE = 'population' as const;

export interface SavedAnalysis {
  readonly id: string;
  readonly name: string;
  readonly savedAt: number;
  /** False when this came from the device rather than from Unify. */
  readonly remote: boolean;
  /** Readable by everyone in the tenant, rather than only by its owner. */
  readonly sharedWithTenant: boolean;
  /** False when someone else saved it and shared it — it is not yours to change. */
  readonly mine: boolean;
  /** Who saved it, shown only when that was not you. */
  readonly owner?: string;
}

export interface SavedStore {
  /**
   * The names, without their contents.
   *
   * A deliverable's content is a separate fetch each, so resolving them all to
   * draw a list of names made opening the menu cost a round trip per entry. The
   * list needs only names; the analysis itself is read when one is opened.
   */
  list(): Promise<SavedAnalysis[]>;
  /** The analysis behind one entry, read at the moment it is wanted. */
  open(id: string): Promise<Analysis | null>;
  save(name: string, analysis: Analysis): Promise<SavedAnalysis[]>;
  remove(id: string): Promise<SavedAnalysis[]>;
  /** True while analyses live on this device only, so the menu can say so. */
  isLocalOnly(): boolean;
  /**
   * Makes one readable by everyone in the tenant, or stops that.
   *
   * Read-only on purpose: a recipient can open a shared analysis and save their
   * own copy, but cannot rename or overwrite someone else's.
   */
  setSharedWithTenant(id: string, shared: boolean): Promise<SavedAnalysis[]>;
}

/**
 * Saved analyses, in Unify where possible and on the device where not.
 *
 * Storing them centrally is what makes them belong to a person rather than to a
 * browser: they follow someone to another machine, survive clearing site data,
 * and do not sit in a shared device's storage waiting for the next user.
 *
 * The device store is kept as a fallback rather than removed. A tenant where
 * someone cannot write deliverables should lose the syncing, not the feature —
 * and whatever is already on a device is migrated across the first time an
 * account is found to have nothing of its own.
 */
export function createSavedStore(session: Session): SavedStore {
  let localOnly = false;
  /**
   * The last listing, kept for the session.
   *
   * Listing is slow and variable — measured between five and twelve seconds for
   * a single entry, dominated by the deliverables query rather than by anything
   * this app does. Nobody else writes these, so a list that has already been
   * read stays true until this app changes it, and reopening the menu should
   * not pay for it again.
   */
  let cached: SavedAnalysis[] | null = null;
  let meId: string | null | undefined;

  /** The signed-in user's id, so an entry can say whether it is theirs. */
  async function currentUserId(session: Session): Promise<string | null> {
    if (meId !== undefined) return meId;
    try {
      const user = await session.sdk.authClient.getAuthenticatedUser();
      meId = (user as { userId?: string }).userId ?? null;
    } catch {
      meId = null;
    }
    return meId;
  }

  async function remote(): Promise<SavedAnalysis[] | null> {
    const client = session.sdk.deliverableClient;
    if (!client) return null;

    try {
      const result = client.getDeliverables({ type: [TYPE] }, undefined, undefined, {
        content: true,
      });

      // Two passes on purpose. `content` is a lazy promise per deliverable, and
      // resolving it is a fetch of its own — so awaiting inside the loop made
      // the list cost one round trip per entry, in series. Ours are picked out
      // first by their definition, which needs no content at all, and only
      // those are then resolved, together.
      const mine = [];
      for await (const deliverable of result.stream()) {
        if (isOurs(deliverable)) mine.push(deliverable);
      }

      const meId = await currentUserId(session);
      const found = mine.map((deliverable) => toEntry(deliverable, meId));
      localOnly = false;
      return found.sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      // No permission, or deliverables unavailable on this tenant.
      localOnly = true;
      return null;
    }
  }

  return {
    isLocalOnly: () => localOnly,

    async open(id: string): Promise<Analysis | null> {
      const local = readLocal().find((entry) => entry.id === id);
      if (local) return localAnalysis(id);
      try {
        const found = await session.sdk.deliverableClient.getDeliverable(id as UUID);
        // An Option, not a value: `some` is the flag and `val` the payload.
        return found.some ? await contentAnalysis(found.val) : null;
      } catch {
        return null;
      }
    },

    async list(): Promise<SavedAnalysis[]> {
      if (cached) return cached;
      const stored = await remote();
      if (stored === null) return readLocal();

      // Whatever predates this change comes across once, and only into an
      // account that has nothing yet — so a second device cannot resurrect
      // entries someone has since deleted.
      const local = readLocal();
      if (stored.length === 0 && local.length > 0) {
        for (const entry of local) {
          const analysis = localAnalysis(entry.id);
          if (!analysis) continue;
          try {
            await write(session, entry.name, analysis);
          } catch {
            return local;
          }
        }
        writeLocal([]);
        cached = (await remote()) ?? local;
        return cached;
      }

      cached = stored;
      return cached;
    },

    async save(name: string, analysis: Analysis): Promise<SavedAnalysis[]> {
      cached = null;
      try {
        await write(session, name, analysis);
      } catch {
        localOnly = true;
        saveLocal(name, analysis);
        return readLocal();
      }
      cached = (await remote()) ?? readLocal();
      return cached;
    },

    async setSharedWithTenant(id: string, shared: boolean): Promise<SavedAnalysis[]> {
      cached = null;
      await session.sdk.deliverableClient.updateDeliverable({
        id: id as UUID,
        permissions: [
          {
            action: shared ? 'ALLOW' : 'REVOKE',
            permissions: ['DELIVERABLE_READ'],
            users: [],
            tenantWide: true,
          },
        ],
      });
      cached = (await remote()) ?? readLocal();
      return cached;
    },

    async remove(id: string): Promise<SavedAnalysis[]> {
      cached = null;
      try {
        await session.sdk.deliverableClient.deleteDeliverables([id as UUID]);
      } catch {
        removeLocal(id);
        return readLocal();
      }
      cached = (await remote()) ?? readLocal();
      return cached;
    },
  };
}

/** Replaces an analysis of the same name, so saving twice does not duplicate it. */
async function write(session: Session, name: string, analysis: Analysis): Promise<void> {
  const client = session.sdk.deliverableClient;
  const content = { name, savedAt: Date.now(), analysis: serialise(analysis) };

  const existing: UUID[] = [];
  const result = client.getDeliverables({ type: [TYPE], name }, undefined, undefined, {});
  for await (const deliverable of result.stream()) {
    if (isOurs(deliverable) && deliverable.name === name) existing.push(deliverable.id);
  }

  const first = existing[0];
  if (first !== undefined) {
    await client.updateDeliverable({ id: first, name, content, definition: DEFINITION });
    return;
  }
  // The id is chosen by the caller rather than the server.
  await client.createDeliverable({
    id: crypto.randomUUID() as UUID,
    type: TYPE,
    name,
    content,
    definition: DEFINITION,
  });
}

function isOurs(deliverable: { definition?: unknown }): boolean {
  return typeof deliverable.definition === 'string' && deliverable.definition.includes(
    'unify-lens.analysis.',
  );
}

/** The listable facts about a deliverable, none of which need its content. */
function toEntry(deliverable: Deliverable, meId: string | null): SavedAnalysis {
  const updatedAt = deliverable.systemAttributes?.updatedAt;
  const createdBy = deliverable.systemAttributes?.createdBy;
  const ownerId = createdBy?.userId;
  const mine = meId === null || ownerId === undefined || ownerId === meId;
  const owner = [createdBy?.firstName, createdBy?.lastName].filter(Boolean).join(' ');

  return {
    id: deliverable.id,
    name: deliverable.name,
    savedAt: Date.parse(typeof updatedAt === 'string' ? updatedAt : '') || 0,
    remote: true,
    sharedWithTenant: (deliverable.tenantPermissions ?? []).length > 0,
    mine,
    // Only worth saying when it was not you; otherwise it is noise on every row.
    ...(mine ? {} : { owner: owner || createdBy?.email || 'someone else' }),
  };
}

/** Resolves the lazy content promise and reads the analysis out of it. */
async function contentAnalysis(deliverable: Deliverable | null): Promise<Analysis | null> {
  if (!deliverable) return null;
  let content: object | undefined;
  try {
    content = await deliverable.content;
  } catch {
    return null;
  }
  if (!content) return null;
  const record = content as Record<string, unknown>;
  return typeof record['analysis'] === 'string' ? deserialise(record['analysis']) : null;
}

/** The analysis behind a device-stored entry. */
function localAnalysis(id: string): Analysis | null {
  const raw = rawLocal().find((entry) => entry['id'] === id);
  const text = raw?.['analysis'];
  return typeof text === 'string' ? deserialise(text) : null;
}

// ── the device store, kept as a fallback and as the migration source ──

function readLocal(): SavedAnalysis[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry): SavedAnalysis | null => {
        const record = entry as Record<string, unknown>;
        if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') return null;
        return {
          id: record['id'],
          name: record['name'],
          savedAt: typeof record['savedAt'] === 'number' ? record['savedAt'] : 0,
          remote: false,
          sharedWithTenant: false,
          mine: true,
        };
      })
      .filter((entry): entry is SavedAnalysis => entry !== null)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function saveLocal(name: string, analysis: Analysis): void {
  const now = Date.now();
  const entry = {
    id: `${now}-${Math.round(now % 100000)}`,
    name,
    savedAt: now,
    // Stored as text so the Date tagging survives, exactly as in a URL.
    analysis: serialise(analysis),
  };
  writeLocal([entry, ...rawLocal().filter((other) => other['name'] !== name)]);
}

function removeLocal(id: string): void {
  writeLocal(rawLocal().filter((entry) => entry['id'] !== id));
}

function rawLocal(): Array<Record<string, unknown>> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function writeLocal(entries: ReadonlyArray<Record<string, unknown>>): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {
    // A full or disabled store must not break the app; saving simply fails.
  }
}
