import type { SavedAnalysis, SavedStore } from '../data/saved';
import type { Session } from '../sdk/client';
import { MIN_SEARCH, searchUsers, type FoundUser } from '../sdk/users';
import { must } from './dom';
import { overlayHost } from './overlay';

/** Long enough that typing a name is one request, not one per letter. */
const DEBOUNCE_MS = 250;

/**
 * Choosing who may read an analysis.
 *
 * Deliberately a search rather than a list. Nothing appears until at least two
 * characters are typed, and only matches for what was typed come back — so this
 * is a way to find a colleague, never a way to read off the staff directory.
 *
 * Access is granted immediately on picking someone rather than collected behind
 * a Save button: each grant is its own call, and a dialog that looks like a form
 * but has already taken effect would be worse than one that plainly acts.
 */
export function openShareWith(
  session: Session,
  store: SavedStore,
  entry: SavedAnalysis,
  onChanged: (entries: SavedAnalysis[]) => void,
): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal share-with" role="dialog" aria-modal="true">
      <h2>Share with someone</h2>
      <p class="hint"></p>
      <label class="field">
        <span>Find a person</span>
        <input type="search" class="share-search" placeholder="Name or email"
               autocomplete="off" autocapitalize="none" spellcheck="false" />
      </label>
      <div class="share-results" role="listbox" aria-label="People"></div>
      <p class="share-note"></p>
      <div class="share-current"></div>
      <div class="modal-actions">
        <button type="button" class="primary" data-act="done">Done</button>
      </div>
    </div>
  `;

  const hint = must(backdrop.querySelector<HTMLElement>('.hint'), 'share: hint');
  const input = must(backdrop.querySelector<HTMLInputElement>('.share-search'), 'share: input');
  const results = must(backdrop.querySelector<HTMLElement>('.share-results'), 'share: results');
  const note = must(backdrop.querySelector<HTMLElement>('.share-note'), 'share: note');
  const current = must(backdrop.querySelector<HTMLElement>('.share-current'), 'share: current');

  hint.textContent = `Whoever you choose can open “${entry.name}” from their own saved list. They cannot change it.`;

  let shared = entry.sharedWith;
  let debounce: number | undefined;
  let generation = 0;

  function paintCurrent(): void {
    current.replaceChildren();
    if (shared.length === 0) return;

    const heading = document.createElement('p');
    heading.className = 'share-heading';
    heading.textContent = 'Shared with';
    current.append(heading);

    for (const person of shared) {
      const row = document.createElement('div');
      row.className = 'share-person';

      const label = document.createElement('span');
      label.textContent = person.name;

      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'share-revoke';
      revoke.textContent = 'Remove';
      revoke.addEventListener('click', () => {
        revoke.disabled = true;
        revoke.textContent = 'Removing…';
        void store
          .setUserShared(entry.id, person.id, false)
          .then((entries) => {
            shared = shared.filter((other) => other.id !== person.id);
            paintCurrent();
            onChanged(entries);
            // Said plainly: revoking stops future access, it does not reach
            // into a copy someone already saved for themselves.
            note.textContent = `${person.name} can no longer open it. Anything they already copied stays theirs.`;
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

  function paintResults(found: FoundUser[]): void {
    const already = new Set(shared.map((person) => person.id));
    results.replaceChildren(
      ...found
        .filter((user) => !already.has(user.id))
        .slice(0, 8)
        .map((user) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'share-result';
          row.setAttribute('role', 'option');

          const name = document.createElement('span');
          name.className = 'share-name';
          name.textContent = user.name;
          const mail = document.createElement('span');
          mail.className = 'share-email';
          mail.textContent = user.email;
          row.append(name, mail);

          row.addEventListener('click', () => {
            row.disabled = true;
            note.textContent = `Sharing with ${user.name}…`;
            void store
              .setUserShared(entry.id, user.id, true)
              .then((entries) => {
                shared = [...shared, { id: user.id, name: user.name }];
                paintCurrent();
                paintResults(found);
                onChanged(entries);
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

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  backdrop.querySelector('[data-act="done"]')?.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);

  paintCurrent();
  overlayHost().append(backdrop);
  input.focus();
}
