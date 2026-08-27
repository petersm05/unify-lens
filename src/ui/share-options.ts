import type { SavedStore, SharedWith } from '../data/saved';
import type { Session } from '../sdk/client';
import { MIN_SEARCH, searchUsers, type FoundUser } from '../sdk/users';
import { must } from './dom';

/** Long enough that typing a name is one request, not one per letter. */
const DEBOUNCE_MS = 250;

export interface ShareChoice {
  readonly tenantWide: boolean;
  readonly people: readonly SharePerson[];
}

export interface SharePerson {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface ShareOptions {
  /** What is currently chosen, for a caller that applies it later. */
  choice(): ShareChoice;
}

/**
 * Who may read an analysis — the same controls wherever sharing is offered.
 *
 * Two modes, because sharing an analysis that exists and sharing one being
 * created are not the same problem. Given an `apply`, every change takes effect
 * as it is made, which is right for an analysis already saved. Without one, the
 * choices are only collected: at save time there is no deliverable yet, so
 * there is nothing to grant a permission on until it has been written.
 *
 * Search rather than a list, in both modes: nothing appears until two
 * characters are typed, so this is a way to find a colleague and never a way to
 * read off the staff directory.
 */
export function mountShareOptions(
  host: HTMLElement,
  session: Session,
  params: {
    /** Applied as changes are made. Omit to collect them for the caller instead. */
    readonly apply?: {
      readonly setTenantWide: (shared: boolean) => Promise<void>;
      readonly setPerson: (person: SharePerson, shared: boolean) => Promise<void>;
    };
    readonly initial?: ShareChoice;
    /** Existing grants, loaded asynchronously by whoever knows the analysis. */
    readonly load?: () => Promise<readonly SharedWith[]>;
  },
): ShareOptions {
  host.innerHTML = `
    <div class="share-options">
      <label class="share-everyone">
        <input type="checkbox" class="share-tenant" />
        <span>
          <span class="share-everyone-label">Anyone in this environment can open it</span>
          <span class="share-everyone-note">They can open and copy it. They cannot change it.</span>
        </span>
      </label>
      <label class="field">
        <span>Or share with someone in particular</span>
        <input type="search" class="share-search" placeholder="Name or email"
               autocomplete="off" autocapitalize="none" spellcheck="false" />
      </label>
      <div class="share-results" role="listbox" aria-label="People"></div>
      <p class="share-note"></p>
      <div class="share-current"></div>
    </div>
  `;

  const tenant = must(host.querySelector<HTMLInputElement>('.share-tenant'), 'share: tenant');
  const input = must(host.querySelector<HTMLInputElement>('.share-search'), 'share: input');
  const results = must(host.querySelector<HTMLElement>('.share-results'), 'share: results');
  const note = must(host.querySelector<HTMLElement>('.share-note'), 'share: note');
  const current = must(host.querySelector<HTMLElement>('.share-current'), 'share: current');

  let tenantWide = params.initial?.tenantWide ?? false;
  let people: SharePerson[] = [...(params.initial?.people ?? [])];
  let debounce: number | undefined;
  let generation = 0;

  tenant.checked = tenantWide;
  tenant.addEventListener('change', () => {
    const wanted = tenant.checked;
    if (!params.apply) {
      tenantWide = wanted;
      return;
    }
    tenant.disabled = true;
    note.textContent = wanted ? 'Sharing with everyone…' : 'Stopping…';
    void params.apply
      .setTenantWide(wanted)
      .then(() => {
        tenantWide = wanted;
        note.textContent = wanted
          ? 'Anyone here can open it now.'
          : 'No longer shared with everyone.';
      })
      .catch(() => {
        tenant.checked = tenantWide;
        note.textContent = 'Could not change that.';
      })
      .finally(() => {
        tenant.disabled = false;
      });
  });

  function paintCurrent(): void {
    current.replaceChildren();
    if (people.length === 0) return;

    const heading = document.createElement('p');
    heading.className = 'share-heading';
    heading.textContent = 'Shared with';
    current.append(heading);

    for (const person of people) {
      const row = document.createElement('div');
      row.className = 'share-person';

      const label = document.createElement('span');
      label.textContent = person.name;

      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'share-revoke';
      revoke.textContent = 'Remove';
      revoke.addEventListener('click', () => {
        const drop = (): void => {
          people = people.filter((other) => other.email !== person.email);
          paintCurrent();
        };
        if (!params.apply) {
          drop();
          return;
        }
        revoke.disabled = true;
        revoke.textContent = 'Removing…';
        void params.apply
          .setPerson(person, false)
          .then(() => {
            drop();
            // Said plainly: revoking stops further access, it does not reach
            // into a copy someone has already saved for themselves.
            note.textContent = `${person.name} can no longer open it. Anything already copied stays theirs.`;
          })
          .catch(() => {
            revoke.disabled = false;
            revoke.textContent = 'Remove';
            note.textContent = 'Could not remove that person.';
          });
      });

      row.append(label, revoke);
      current.append(row);
    }
  }

  function paintResults(found: readonly FoundUser[]): void {
    const already = new Set(people.map((person) => person.email));
    results.replaceChildren(
      ...found
        .filter((user) => !already.has(user.email))
        .slice(0, 8)
        .map((user) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'share-result';
          row.setAttribute('role', 'option');

          const name = document.createElement('span');
          name.className = 'share-name';
          name.textContent = user.name;
          // Two people share a name far more often than an address.
          const mail = document.createElement('span');
          mail.className = 'share-email';
          mail.textContent = user.email;
          row.append(name, mail);

          row.addEventListener('click', () => {
            const add = (): void => {
              people = [...people, user];
              paintCurrent();
              paintResults(found);
            };
            if (!params.apply) {
              add();
              note.textContent = `${user.name} will be able to open it once it is saved.`;
              return;
            }
            row.disabled = true;
            note.textContent = `Sharing with ${user.name}…`;
            void params.apply
              .setPerson(user, true)
              .then(() => {
                add();
                note.textContent = `${user.name} can open it now.`;
              })
              .catch(() => {
                row.disabled = false;
                note.textContent = `Could not share with ${user.name}.`;
              });
          });

          return row;
        }),
    );
  }

  input.addEventListener('input', () => {
    window.clearTimeout(debounce);
    const term = input.value.trim();

    if (term.length < MIN_SEARCH) {
      results.replaceChildren();
      note.textContent = term.length === 0 ? '' : 'Keep typing…';
      return;
    }

    note.textContent = 'Searching…';
    const mine = ++generation;
    debounce = window.setTimeout(() => {
      void searchUsers(session, term).then((found) => {
        // A slower earlier search must not overwrite a later one.
        if (mine !== generation) return;
        note.textContent = found.length === 0 ? 'Nobody matches that.' : '';
        paintResults(found);
      });
    }, DEBOUNCE_MS);
  });

  paintCurrent();

  // Existing grants arrive after the dialog does; the address identifies a
  // person, and the id is recovered by search only if one is removed.
  if (params.load) {
    void params.load().then((existing) => {
      people = existing.map((person) => ({ id: '', email: person.email, name: person.name }));
      paintCurrent();
    });
  }

  return {
    choice: () => ({ tenantWide, people }),
  };
}

/**
 * Applies choices collected before an analysis existed.
 *
 * Failures are reported together rather than one at a time: the analysis is
 * already saved by this point, and a half-applied share is worth knowing about
 * without losing the save itself.
 */
export async function applyChoice(
  store: SavedStore,
  id: string,
  choice: ShareChoice,
): Promise<string[]> {
  const failures: string[] = [];

  if (choice.tenantWide) {
    try {
      await store.setSharedWithTenant(id, true);
    } catch {
      failures.push('everyone in this environment');
    }
  }

  for (const person of choice.people) {
    try {
      await store.setUserShared(id, person.id, person.email, true);
    } catch {
      failures.push(person.name);
    }
  }

  return failures;
}
