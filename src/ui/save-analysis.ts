import type { Session } from '../sdk/client';
import { must } from './dom';
import { overlayHost } from './overlay';
import { mountShareOptions, type ShareChoice } from './share-options';

export interface SaveRequest {
  readonly name: string;
  readonly share: ShareChoice;
}

/**
 * Naming an analysis, and deciding who else may see it.
 *
 * Sharing is offered here because deciding it afterwards means remembering to,
 * and the moment someone names a thing is the moment they know who it is for.
 *
 * The choices are only collected. There is no deliverable to grant a permission
 * on until the analysis has been written, so the caller applies them once it
 * exists — and the sharing controls are the same ones used to change an
 * analysis already saved, rather than a second implementation that drifts.
 */
export function openSaveAnalysis(
  session: Session,
  hint: string,
): Promise<SaveRequest | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal save-analysis" role="dialog" aria-modal="true">
        <h2>Save this analysis</h2>
        <p class="hint"></p>
        <label class="field">
          <span>Name</span>
          <input type="text" class="save-name" placeholder="What is this showing?" />
        </label>
        <details class="save-share">
          <summary>Share it</summary>
          <div class="share-host"></div>
        </details>
        <div class="modal-actions">
          <button type="button" class="ghost" data-act="cancel">Cancel</button>
          <button type="button" class="primary" data-act="confirm">Save</button>
        </div>
      </div>
    `;

    must(backdrop.querySelector<HTMLElement>('.hint'), 'save: hint').textContent = hint;
    const name = must(backdrop.querySelector<HTMLInputElement>('.save-name'), 'save: name');

    // Folded away by default: most saves are private, and a sharing panel open
    // on every save would make the common case answer a question nobody asked.
    const options = mountShareOptions(
      must(backdrop.querySelector<HTMLElement>('.share-host'), 'save: share host'),
      session,
      {},
    );

    const close = (result: SaveRequest | null): void => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };

    const submit = (): void => {
      const value = name.value.trim();
      if (value.length > 0) close({ name: value, share: options.choice() });
    };

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') close(null);
      // Enter saves, but not while someone is typing a colleague's name into
      // the search below.
      if (event.key === 'Enter' && document.activeElement === name) submit();
    }

    backdrop.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));
    backdrop.querySelector('[data-act="confirm"]')?.addEventListener('click', submit);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener('keydown', onKey);

    overlayHost().append(backdrop);
    name.focus();
  });
}
