import type { SavedAnalysis, SavedStore } from '../data/saved';
import type { Session } from '../sdk/client';
import { must } from './dom';
import { overlayHost } from './overlay';
import { mountShareOptions } from './share-options';

/**
 * Sharing an analysis that already exists.
 *
 * A thin frame around the shared controls: because there is something to grant
 * a permission on, every change is applied as it is made rather than collected
 * behind a Save button that would already have taken effect.
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
      <h2>Share</h2>
      <p class="hint"></p>
      <div class="share-host"></div>
      <div class="modal-actions">
        <button type="button" class="primary" data-act="done">Done</button>
      </div>
    </div>
  `;

  must(backdrop.querySelector<HTMLElement>('.hint'), 'share: hint').textContent =
    `Who can open “${entry.name}”. Anyone you share with can open and copy it, but not change it.`;

  mountShareOptions(
    must(backdrop.querySelector<HTMLElement>('.share-host'), 'share: host'),
    session,
    {
      initial: { tenantWide: entry.sharedWithTenant, people: [] },
      load: () => store.sharedWith(entry.id),
      apply: {
        setTenantWide: async (shared) => {
          onChanged(await store.setSharedWithTenant(entry.id, shared));
        },
        setPerson: async (person, shared) => {
          onChanged(await store.setUserShared(entry.id, person.id, person.email, shared));
        },
      },
    },
  );

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

  overlayHost().append(backdrop);
  must(backdrop.querySelector<HTMLInputElement>('.share-search'), 'share: input').focus();
}
