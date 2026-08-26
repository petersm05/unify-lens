import { connect, MissingEnvironment, onSdkError } from './sdk/client';
import { forgetEnvironment, savedEnvironment } from './sdk/runtime-config';
import { mountShell } from './ui/shell';
import { showSetup } from './ui/setup';
import { watchForUpdates } from './ui/update-prompt';

const root = document.querySelector<HTMLElement>('#app');

async function boot(): Promise<void> {
  if (!root) return;

  try {
    const session = await connect();
    onSdkError(session, (message) => console.warn('[sdk]', message));

    // Dev-only handle so the SDK can be driven from the console when working
    // out an undocumented payload shape. Never present in a production build.
    if (import.meta.env.DEV) {
      (globalThis as typeof globalThis & { __lens?: unknown }).__lens = session;
    }

    mountShell(root, session);
  } catch (error) {
    // Nothing configured is a question to ask, not an error to report.
    if (error instanceof MissingEnvironment) {
      showSetup(root);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);

    // If this device chose the environment, a failure means the answer was
    // wrong — so ask again rather than stranding someone on an error with no
    // control. Without this a typed-in typo is permanent: the bad value is
    // remembered, every reload fails the same way, and the only way out is
    // clearing the site's data.
    const chosen = savedEnvironment();
    if (chosen !== null) {
      forgetEnvironment();
      showSetup(
        root,
        `Could not connect to ${chosen}. Check the address and try again.`,
        chosen,
      );
      return;
    }

    // A deployment configured this, so there is nothing here for the reader to
    // correct; report it plainly.
    root.replaceChildren();
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = `Could not connect to Unify: ${message}`;
    root.append(box);
  }
}

/**
 * Registers the shell cache, which is what makes the installed app open
 * instantly and survive having no network.
 *
 * Production only: in development the dev server is the source of truth, and a
 * worker sitting in front of it would serve yesterday's module while hot
 * reload insisted everything was fine.
 *
 * The path is relative so it resolves under whatever sub-path the app is
 * deployed at, which also scopes the worker to the app rather than the whole
 * origin — on a shared host like github.io that matters.
 */
function registerShellCache(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  globalThis.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI).href, {
        scope: new URL('./', document.baseURI).href,
      })
      .then((registration) => {
        if (registration) watchForUpdates(registration);
      })
      .catch(() => {
        // Not fatal: without it the app simply always goes to the network.
      });
  });
}

registerShellCache();

void boot();
