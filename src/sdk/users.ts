import type { Session } from './client';

/**
 * Finding a person to share with.
 *
 * **This is the one call in the app that reaches past the supported API.** The
 * browser entry of the SDK exposes knowledge-graph, auth, deliverable, version
 * and error clients, and none of them can look up a user. Users are not in the
 * knowledge graph either — the metamodel has ten object types and not one is a
 * person. The GraphQL root does have `searchUsers`, documented as available to
 * all roles, so the capability exists; it simply is not reachable from a
 * partner app in a supported way.
 *
 * `lowLevelClient` is an implementation detail that happens to sit on the
 * knowledge-graph client at runtime. Everything unsupported is therefore kept
 * in this one function, so the day the SDK exposes user search this file is the
 * only thing that changes. Tracked in issue #10.
 *
 * Search-only by design, matching the API: nothing is returned until something
 * is typed, so this never becomes a way to enumerate the directory.
 */

export interface FoundUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/** Below this, a search matches most of an organisation and means nothing. */
export const MIN_SEARCH = 2;

export async function searchUsers(session: Session, term: string): Promise<FoundUser[]> {
  const searchTerm = term.trim();
  if (searchTerm.length < MIN_SEARCH) return [];

  const client = (session.kg as unknown as { lowLevelClient?: LowLevel }).lowLevelClient;
  if (!client) return [];

  try {
    const result = await client.query({
      searchUsers: {
        __args: { where: { searchTerm } },
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    const found = Array.isArray(result?.searchUsers) ? result.searchUsers : [];
    return found
      .filter((user): user is RawUser => typeof user?.id === 'string')
      .map((user) => ({
        id: user.id,
        email: user.email ?? '',
        // A name where there is one, the address where there is not — an entry
        // with neither is not something anyone can recognise.
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.email ?? user.id),
      }));
  } catch {
    return [];
  }
}

/**
 * Who an analysis is currently shared with.
 *
 * The SDK's own `users` map cannot answer this on a backend reporting schema
 * major 5: building it selects `UserInfo.userId`, which that backend does not
 * return, so the query fails and the map arrives empty. The grants themselves
 * are perfectly real — asking for the same records without `userId` shows them.
 *
 * That is why this reads them itself. It selects only fields the backend can
 * answer, and identifies a person by address, which is unique where a name is
 * not. Once the backend is upgraded this should become `deliverable.users` and
 * disappear along with the rest of this file.
 */
export async function readShares(session: Session, deliverableId: string): Promise<SharedPerson[]> {
  const client = (session.kg as unknown as { lowLevelClient?: LowLevel }).lowLevelClient;
  if (!client) return [];

  try {
    const result = await client.query({
      deliverables: {
        __args: { filter: { ids: [deliverableId] } },
        deliverables: {
          id: true,
          userPermissions: {
            permissions: true,
            user: { email: true, firstName: true, lastName: true },
          },
        },
      },
    });

    const first = result?.deliverables?.deliverables?.[0];
    const grants = Array.isArray(first?.userPermissions) ? first.userPermissions : [];

    return grants
      // Everyone who can only read: whoever can also write is the owner, who is
      // not "shared with" in any sense worth showing.
      .filter((grant) => {
        const held = grant?.permissions ?? [];
        return held.includes('DELIVERABLE_READ') && !held.includes('DELIVERABLE_WRITE');
      })
      .map((grant) => {
        const user = grant.user ?? {};
        const email = user.email ?? '';
        return {
          email,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || email,
        };
      })
      .filter((person) => person.email.length > 0);
  } catch {
    return [];
  }
}

export interface SharedPerson {
  readonly email: string;
  readonly name: string;
}

interface RawGrant {
  permissions?: string[];
  user?: { email?: string; firstName?: string; lastName?: string };
}

interface RawUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface LowLevel {
  query(selection: unknown): Promise<{
    searchUsers?: RawUser[];
    deliverables?: { deliverables?: Array<{ userPermissions?: RawGrant[] }> };
  } | null>;
}
