import { connect, MissingEnvironment, onSdkError } from './sdk/client';
import { mountShell } from './ui/shell';
import { showSetup } from './ui/setup';

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
    root.replaceChildren();
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = `Could not connect to Unify: ${message}`;
    root.append(box);
  }
}

void boot();
