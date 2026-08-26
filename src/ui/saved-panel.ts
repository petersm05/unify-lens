import type { Analysis } from '../data/analysis';
import { listSaved, remove, save, type SavedAnalysis } from '../data/saved';
import { must } from './dom';
import { promptForText } from './prompt';
import { canShare, shareLink } from './share';
import { savedIcon } from './icons';
import { buildId, openReport } from './report';

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
  /** Named in a report only if someone chooses to add it. */
  environment?: string,
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
        <p class="saved-build"></p>
        <div class="saved-report">
          <button type="button" class="saved-action" data-act="bug">Report a problem</button>
          <button type="button" class="saved-action" data-act="idea">Request a feature</button>
        </div>
      </div>
    </div>
  `;

  const button = must(host.querySelector<HTMLButtonElement>('.saved-btn'), 'saved: button');
  button.prepend(savedIcon());
  const panel = must(host.querySelector<HTMLElement>('.saved-panel'), 'saved: panel');
  const list = must(host.querySelector<HTMLElement>('.saved-list'), 'saved: list');
  const empty = must(host.querySelector<HTMLElement>('.saved-empty'), 'saved: empty');
  const add = must(host.querySelector<HTMLButtonElement>('.saved-add'), 'saved: add');

  /**
   * Which build this is, taken from the bundle's own content-hashed filename.
   *
   * An installed app gives no way to tell what it is running — there is no
   * address bar and no reload button — so a report of "still broken" and a
   * report of "not updated yet" look identical. Naming the build separates
   * them. The hash comes from the module's own URL, so it needs no build-time
   * plumbing and cannot drift from what is actually loaded.
   */
  const build = must(host.querySelector<HTMLElement>('.saved-build'), 'saved: build');
  build.textContent = `Build ${buildId()}`;

  for (const [act, kind] of [
    ['bug', 'bug'],
    ['idea', 'idea'],
  ] as const) {
    host.querySelector(`[data-act="${act}"]`)?.addEventListener('click', () => {
      setOpen(false);
      openReport(kind, environment);
    });
  }

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
      hint: `Stored on this device. Use ${canShare() ? 'Share' : 'Copy link'} to send it to someone else.`,
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

        const resting = canShare() ? 'Share' : 'Copy link';
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'saved-action';
        link.textContent = resting;
        link.addEventListener('click', () => {
          void shareLink(linkFor(entry.analysis), entry.name, 'A saved Unify Lens analysis').then(
            (outcome) => {
              // A dismissed sheet needs no report: they saw it and closed it.
              if (outcome === 'dismissed' || outcome === 'shared') return;
              link.textContent = outcome === 'copied' ? 'Copied' : 'Failed';
              window.setTimeout(() => (link.textContent = resting), 1400);
            },
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
