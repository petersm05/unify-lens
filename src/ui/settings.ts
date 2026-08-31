import { must } from './dom';
import { overlayHost } from './overlay';
import { confirmAction } from './prompt';
import { buildId, diagnostics, REPO } from './report';
import {
  canBadgeIcon,
  disableIconBadge,
  enableIconBadge,
  iconBadgeOn,
} from './app-badge';

/**
 * Everything that is a preference rather than a piece of work.
 *
 * The overflow menu used to carry all of this: which environment this is, how
 * to leave it, whether the app icon may be badged, and which build is running —
 * filed under two grey headings beneath the list of saved analyses, in
 * twelve-pixel text with no icons. Three unrelated things in one dropdown means
 * none of them is where anybody looks, and "Sign out" ended up the same size
 * and weight as a footnote.
 *
 * So the menu keeps what someone opened it for — their analyses — and the
 * settings live here, in a sheet with room to say what each one does. Nothing
 * here is per-analysis and nothing here is urgent, which is exactly what makes
 * a separate surface right for it.
 */
export interface SettingsOptions {
  /** Which Unify this is. Absent where nothing is connected yet. */
  readonly environment?: string;
  /** Whether saved analyses are living on this device only. */
  readonly localOnly: boolean;
  /** Ends the session. Absent in contexts with no session to end. */
  readonly onSignOut?: () => void | Promise<void>;
  /** Forgets which Unify this is and asks again. */
  readonly onChangeEnvironment?: () => void | Promise<void>;
  /** Told once badging is on, so the count can be put on the icon straight away. */
  readonly onBadgeEnabled?: () => void;
}

export function openSettings(options: SettingsOptions): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal settings" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="settings-head">
        <h2>Settings</h2>
        <button type="button" class="sheet-close" data-act="close" aria-label="Close">×</button>
      </div>

      <section class="settings-group">
        <span class="menu-label">Environment</span>
        <p class="settings-value"></p>
        <p class="settings-note settings-storage"></p>
        <div class="settings-buttons">
          <button type="button" class="settings-btn" data-act="switch">Change environment…</button>
          <button type="button" class="settings-btn is-danger" data-act="signout">Sign out</button>
        </div>
      </section>

      <section class="settings-group" data-group="badge" hidden>
        <span class="menu-label">Notifications</span>
        <button type="button" class="settings-switch" role="switch" aria-checked="false">
          <span class="settings-switch-text">
            <span class="settings-switch-label">Count on the app icon</span>
            <span class="settings-note">How many analyses other people have shared that you have
              not opened yet, on the installed app's icon.</span>
          </span>
          <span class="switch" aria-hidden="true"><span class="switch-knob"></span></span>
        </button>
        <p class="settings-note settings-badge-said" hidden></p>
      </section>

      <section class="settings-group">
        <span class="menu-label">About</span>
        <p class="settings-value settings-build"></p>
        <p class="settings-note">Worth quoting in a report: it says exactly which version of the
          app you are looking at, which an installed app has no address bar to tell you.</p>
        <div class="settings-buttons">
          <button type="button" class="settings-btn" data-act="copy">Copy build details</button>
          <button type="button" class="settings-btn" data-act="repo">Project on GitHub</button>
        </div>
      </section>
    </div>
  `;

  const value = must(backdrop.querySelector<HTMLElement>('.settings-value'), 'settings: env');
  value.textContent = options.environment ?? 'Not connected';

  /**
   * Where analyses are actually being kept, said here rather than only when one
   * is saved. Unify is the normal case and the sheet says so plainly; a local
   * fallback is not an error, but nobody should have to deduce it from an
   * analysis failing to turn up on their laptop.
   */
  const storage = must(
    backdrop.querySelector<HTMLElement>('.settings-storage'),
    'settings: storage',
  );
  storage.textContent = options.localOnly
    ? 'Analyses you save are on this device only — Unify could not be reached, so they will not appear anywhere else.'
    : 'Analyses you save are kept in this environment, so they follow you to any browser you sign in from.';

  const build = must(backdrop.querySelector<HTMLElement>('.settings-build'), 'settings: build');
  build.textContent = `Unify Lens · build ${buildId()}`;

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  must(backdrop.querySelector<HTMLButtonElement>('[data-act="close"]'), 'settings: close')
    .addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);

  const signOut = must(
    backdrop.querySelector<HTMLButtonElement>('[data-act="signout"]'),
    'settings: sign out',
  );
  signOut.disabled = options.onSignOut === undefined;
  signOut.addEventListener('click', () => {
    close();
    void confirmAction({
      title: 'Sign out?',
      hint: 'Analyses saved on this device are kept. You will need to sign in again to read anything.',
      confirmLabel: 'Sign out',
    }).then((yes) => {
      if (yes) void options.onSignOut?.();
    });
  });

  const switchEnv = must(
    backdrop.querySelector<HTMLButtonElement>('[data-act="switch"]'),
    'settings: switch',
  );
  switchEnv.disabled = options.onChangeEnvironment === undefined;
  switchEnv.addEventListener('click', () => {
    close();
    void confirmAction({
      title: 'Change environment?',
      hint: `This signs out of ${options.environment ?? 'the current environment'} and asks which Unify to connect to. Saved analyses are kept — each records the environment it was built against.`,
      confirmLabel: 'Change environment',
    }).then((yes) => {
      if (yes) void options.onChangeEnvironment?.();
    });
  });

  /**
   * Offered rather than assumed, and hidden where it is not a choice at all.
   *
   * On iOS badging an installed app counts as a notification, so switching it
   * on costs a permission prompt; where the browser cannot badge, the row would
   * be a switch that does nothing, which is worse than its absence.
   */
  const group = must(
    backdrop.querySelector<HTMLElement>('[data-group="badge"]'),
    'settings: badge group',
  );
  const toggle = must(
    backdrop.querySelector<HTMLButtonElement>('.settings-switch'),
    'settings: badge switch',
  );
  const said = must(
    backdrop.querySelector<HTMLElement>('.settings-badge-said'),
    'settings: badge note',
  );
  group.hidden = !canBadgeIcon();
  const drawToggle = (): void => {
    toggle.setAttribute('aria-checked', String(iconBadgeOn()));
  };
  drawToggle();

  const say = (message: string): void => {
    said.hidden = message.length === 0;
    said.textContent = message;
  };

  toggle.addEventListener('click', () => {
    if (iconBadgeOn()) {
      disableIconBadge();
      drawToggle();
      say('');
      return;
    }
    void enableIconBadge().then((on) => {
      drawToggle();
      if (on) {
        options.onBadgeEnabled?.();
        say('');
        return;
      }
      say(
        typeof Notification !== 'undefined' && Notification.permission === 'denied'
          ? 'The app icon cannot be badged while notifications are blocked for this app. The count still shows in the menu.'
          : 'This browser will not badge the app icon. The count still shows in the menu.',
      );
    });
  });

  const copy = must(
    backdrop.querySelector<HTMLButtonElement>('[data-act="copy"]'),
    'settings: copy',
  );
  copy.addEventListener('click', () => {
    void navigator.clipboard
      ?.writeText(diagnostics())
      .then(() => {
        copy.textContent = 'Copied';
        globalThis.setTimeout(() => (copy.textContent = 'Copy build details'), COPIED_MS);
      })
      .catch(() => (copy.textContent = 'Could not copy'));
  });

  must(backdrop.querySelector<HTMLButtonElement>('[data-act="repo"]'), 'settings: repo')
    .addEventListener('click', () => {
      globalThis.open(REPO, '_blank', 'noopener');
    });

  overlayHost().append(backdrop);
  must(backdrop.querySelector<HTMLButtonElement>('[data-act="close"]'), 'settings: close').focus();
}

/** Long enough to read, short enough that the label is not left lying. */
const COPIED_MS = 1_800;
