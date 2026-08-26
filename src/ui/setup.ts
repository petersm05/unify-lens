import { rememberEnvironment } from '../sdk/runtime-config';
import { must } from './dom';

/**
 * Asked only when nothing else says which Unify instance to use.
 *
 * A deployment normally answers this with `config.json`; this exists so the
 * same artifact is still usable on a static host nobody can reconfigure, and so
 * a first run fails with a question rather than a stack trace.
 */
export function showSetup(root: HTMLElement, message?: string): void {
  root.innerHTML = `
    <div class="setup">
      <img class="boot-mark" src="brand/mark.svg" width="72" height="72" alt="" />
      <h1>Unify Lens</h1>
      <p class="setup-lead">Which Unify environment should this connect to?</p>
      <form class="setup-form">
        <label class="field">
          <span>Environment address</span>
          <input type="url" name="url" placeholder="https://your-environment.unify.cloud"
                 autocomplete="url" required />
        </label>
        <button type="submit" class="primary">Connect</button>
      </form>
      <p class="setup-note"></p>
    </div>
  `;

  const form = must(root.querySelector<HTMLFormElement>('.setup-form'), 'setup: form');
  const input = must(root.querySelector<HTMLInputElement>('input[name="url"]'), 'setup: input');
  const note = must(root.querySelector<HTMLElement>('.setup-note'), 'setup: note');

  note.textContent =
    message ??
    'Its address is the root of your Unify site. This is remembered on this device only.';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let url: URL;
    try {
      url = new URL(input.value.trim());
    } catch {
      note.textContent = 'That does not look like a web address.';
      return;
    }
    // Only the origin matters; a pasted deep link would otherwise be fetched
    // as-is when looking for env.js.
    rememberEnvironment(url.origin);
    globalThis.location.reload();
  });

  input.focus();
}
