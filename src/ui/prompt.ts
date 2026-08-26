import { must } from './dom';
import { overlayHost } from './overlay';

/**
 * A modal text prompt.
 *
 * The native `prompt()` is blocked in installed PWAs and unstyleable
 * everywhere, so anything that writes back to Unify needs its own dialog.
 */
export function promptForText(params: {
  readonly title: string;
  readonly hint?: string;
  readonly value?: string;
  readonly confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2></h2>
        <p class="hint"></p>
        <input type="text" />
        <div class="modal-actions">
          <button type="button" class="ghost" data-act="cancel">Cancel</button>
          <button type="button" class="primary" data-act="confirm"></button>
        </div>
      </div>
    `;

    const heading = must(backdrop.querySelector('h2'), 'prompt: title');
    const hint = must(backdrop.querySelector<HTMLElement>('.hint'), 'prompt: hint');
    const input = must(backdrop.querySelector('input'), 'prompt: input');
    const confirm = must(
      backdrop.querySelector<HTMLButtonElement>('[data-act="confirm"]'),
      'prompt: confirm',
    );

    heading.textContent = params.title;
    hint.textContent = params.hint ?? '';
    hint.hidden = !params.hint;
    input.value = params.value ?? '';
    confirm.textContent = params.confirmLabel ?? 'Save';

    const close = (result: string | null): void => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };

    const submit = (): void => {
      const value = input.value.trim();
      if (value.length > 0) close(value);
    };

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Enter') submit();
    }

    backdrop.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));
    confirm.addEventListener('click', submit);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener('keydown', onKey);

    overlayHost().append(backdrop);
    input.focus();
    input.select();
  });
}
