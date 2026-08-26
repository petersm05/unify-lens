import type { Analysis } from '../data/analysis';
import { listSaved, remove, save, type SavedAnalysis } from '../data/saved';
import { must } from './dom';
import { promptForText } from './prompt';

export interface SavedPanel {
  destroy(): void;
}

/**
 * Saved analyses for this device, plus a link to share one.
 *
 * Saving keeps a description of the question, never its answer — so an entry
 * stays correct as the graph changes, and the link it produces carries no data
 * the recipient would not fetch for themselves anyway.
 */
export function mountSavedPanel(
  host: HTMLElement,
  current: () => Analysis,
  onOpen: (analysis: Analysis) => void,
  linkFor: (analysis: Analysis) => string,
): SavedPanel {
  host.innerHTML = `
    <div class="saved">
      <button type="button" class="saved-btn" aria-expanded="false" aria-haspopup="dialog">Saved</button>
      <div class="saved-panel" hidden role="dialog" aria-label="Saved analyses">
        <div class="saved-head">
          <span class="menu-label">On this device</span>
          <button type="button" class="saved-add">Save current…</button>
        </div>
        <ul class="saved-list"></ul>
        <p class="saved-empty">Nothing saved yet.</p>
      </div>
    </div>
  `;

  const button = must(host.querySelector<HTMLButtonElement>('.saved-btn'), 'saved: button');
  const panel = must(host.querySelector<HTMLElement>('.saved-panel'), 'saved: panel');
  const list = must(host.querySelector<HTMLElement>('.saved-list'), 'saved: list');
  const empty = must(host.querySelector<HTMLElement>('.saved-empty'), 'saved: empty');
  const add = must(host.querySelector<HTMLButtonElement>('.saved-add'), 'saved: add');

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) render(listSaved());
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(panel.hidden);
  });
  panel.addEventListener('click', (event) => event.stopPropagation());

  const away = (): void => setOpen(false);
  const escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') setOpen(false);
  };
  document.addEventListener('click', away);
  document.addEventListener('keydown', escape);

  add.addEventListener('click', () => {
    void promptForText({
      title: 'Save this analysis',
      hint: 'Stored on this device. Use Copy link to share it with someone else.',
      value: '',
      confirmLabel: 'Save',
    }).then((name) => {
      if (name === null) return;
      render(save(name, current(), Date.now()));
    });
  });

  function render(entries: readonly SavedAnalysis[]): void {
    empty.hidden = entries.length > 0;
    list.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement('li');

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'saved-open';
        open.textContent = entry.name;
        open.addEventListener('click', () => {
          onOpen(entry.analysis);
          setOpen(false);
        });

        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'saved-action';
        link.textContent = 'Copy link';
        link.addEventListener('click', () => {
          void navigator.clipboard?.writeText(linkFor(entry.analysis)).then(
            () => {
              link.textContent = 'Copied';
              window.setTimeout(() => (link.textContent = 'Copy link'), 1400);
            },
            () => (link.textContent = 'Copy failed'),
          );
        });

        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'saved-action';
        drop.textContent = 'Delete';
        drop.addEventListener('click', () => render(remove(entry.id)));

        item.append(open, link, drop);
        return item;
      }),
    );
  }

  return {
    destroy(): void {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
      host.replaceChildren();
    },
  };
}
