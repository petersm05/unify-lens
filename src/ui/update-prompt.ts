import { overlayHost } from './overlay';

/**
 * Offers a newly deployed version, rather than swapping it in unannounced.
 *
 * A single-page app holds state that only exists on screen — a filter, a
 * selection, a chart someone is reading. Reloading underneath them would throw
 * that away without asking, so the new version waits until it is wanted.
 *
 * The worker is checked again whenever the app comes back to the foreground.
 * Browsers only look for a new worker on navigation, and an installed app on a
 * tablet may not navigate for days.
 */

const RECHECK_AFTER_MS = 30 * 60 * 1000;

let reloading = false;

export function watchForUpdates(registration: ServiceWorkerRegistration): void {
  // A version may already be waiting from a previous visit.
  if (registration.waiting && navigator.serviceWorker.controller) {
    offer(registration.waiting);
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener('statechange', () => {
      // Without a controller this is the first install, not an update: there is
      // no previous version for it to replace and nothing to interrupt.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        offer(installing);
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    globalThis.location.reload();
  });

  let lastCheck = Date.now();
  const check = (): void => {
    lastCheck = Date.now();
    void registration.update().catch(() => undefined);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > RECHECK_AFTER_MS) {
      check();
    }
  });
}

function offer(worker: ServiceWorker): void {
  if (document.querySelector('.update-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'update-text';
  text.textContent = 'A new version is ready.';

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'update-accept';
  accept.textContent = 'Reload';
  accept.addEventListener('click', () => {
    accept.disabled = true;
    accept.textContent = 'Reloading…';
    // The worker takes over, which fires controllerchange, which reloads.
    worker.postMessage({ type: 'skip-waiting' });
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'update-dismiss';
  dismiss.setAttribute('aria-label', 'Not now');
  dismiss.textContent = '✕';
  // Only for this visit: the version is still waiting, and the next launch
  // starts on it anyway.
  dismiss.addEventListener('click', () => bar.remove());

  bar.append(text, accept, dismiss);
  overlayHost().append(bar);
}
