import type { Analysis } from '../data/analysis';
import type { SavedAnalysis, SavedStore } from '../data/saved';
import type { Session } from '../sdk/client';
import { must } from './dom';
import { confirmAction, promptForText } from './prompt';
import { canShare, shareLink } from './share';
import { moreIcon } from './icons';
import { showContextMenu, type MenuItem } from './context-menu';
import { openShareWith } from './share-with';
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
  /** Where saved analyses live — Unify where possible, this device otherwise. */
  store: SavedStore,
  /** Needed to look someone up when sharing with a person. */
  session: Session,
  /** Named in a report only if someone chooses to add it, and shown in the menu. */
  environment?: string,
  /** Ends the session. Absent in contexts with no session to end. */
  onSignOut?: () => void | Promise<void>,
  /** Forgets which Unify this is and asks again. */
  onChangeEnvironment?: () => void | Promise<void>,
): SavedPanel {
  host.innerHTML = `
    <div class="saved">
      <button type="button" class="saved-btn" aria-expanded="false" aria-haspopup="dialog">More</button>
      <div class="saved-panel" hidden role="dialog" aria-label="More">
        <div class="saved-head">
          <span class="menu-label">Analyses</span>
          <button type="button" class="saved-add">Save current…</button>
        </div>
        <ul class="saved-list"></ul>
        <p class="saved-empty">Nothing saved yet.</p>
        <p class="saved-status" hidden></p>

        <div class="menu-section">
          <span class="menu-label">Environment</span>
          <p class="saved-env"></p>
          <div class="saved-report">
            <button type="button" class="saved-action" data-act="switch">Change environment…</button>
            <button type="button" class="saved-action" data-act="signout">Sign out</button>
          </div>
        </div>

        <div class="menu-section">
          <span class="menu-label">About</span>
          <p class="saved-build"></p>
          <div class="saved-report">
            <button type="button" class="saved-action" data-act="bug">Report a problem</button>
            <button type="button" class="saved-action" data-act="idea">Request a feature</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const button = must(host.querySelector<HTMLButtonElement>('.saved-btn'), 'saved: button');
  button.prepend(moreIcon());
  const panel = must(host.querySelector<HTMLElement>('.saved-panel'), 'saved: panel');
  const list = must(host.querySelector<HTMLElement>('.saved-list'), 'saved: list');
  const empty = must(host.querySelector<HTMLElement>('.saved-empty'), 'saved: empty');
  const status = must(host.querySelector<HTMLElement>('.saved-status'), 'saved: status');
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

  const env = must(host.querySelector<HTMLElement>('.saved-env'), 'saved: environment');
  env.textContent = environment ?? 'Not connected';

  const signOut = must(
    host.querySelector<HTMLButtonElement>('[data-act="signout"]'),
    'saved: sign out',
  );
  signOut.disabled = onSignOut === undefined;
  signOut.addEventListener('click', () => {
    setOpen(false);
    void confirmAction({
      title: 'Sign out?',
      hint: 'Analyses saved on this device are kept. You will need to sign in again to read anything.',
      confirmLabel: 'Sign out',
    }).then((yes) => {
      if (yes) void onSignOut?.();
    });
  });

  const switchEnv = must(
    host.querySelector<HTMLButtonElement>('[data-act="switch"]'),
    'saved: switch',
  );
  switchEnv.disabled = onChangeEnvironment === undefined;
  switchEnv.addEventListener('click', () => {
    setOpen(false);
    void confirmAction({
      title: 'Change environment?',
      hint: `This signs out of ${environment ?? 'the current environment'} and asks which Unify to connect to. Saved analyses are kept — each records the environment it was built against.`,
      confirmLabel: 'Change environment',
    }).then((yes) => {
      if (yes) void onChangeEnvironment?.();
    });
  });

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
    // Reading them is a request now, so the list says it is working rather than
    // showing "nothing saved yet" while the answer is still on its way.
    if (open) void reload();
  };

  async function reload(): Promise<void> {
    status.hidden = true;
    empty.hidden = false;
    empty.textContent = 'Loading…';
    list.replaceChildren();
    try {
      render(await store.list());
      // Same for reading: a list that came from this device is not the list
      // someone thinks they are looking at.
      status.hidden = !store.isLocalOnly();
      status.textContent = store.isLocalOnly()
        ? 'These are on this device only — Unify could not be reached.'
        : '';
    } catch {
      empty.hidden = false;
      empty.textContent = 'Could not read your saved analyses.';
    }
  }

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
      hint: `${
        store.isLocalOnly() ? 'Stored on this device.' : 'Stored in Unify, so it follows you.'
      } Use ${canShare() ? 'Share' : 'Copy link'} to send it to someone else.`,
      value: '',
      confirmLabel: 'Save',
    }).then(async (name) => {
      if (name === null) return;
      empty.hidden = false;
      empty.textContent = 'Saving…';
      try {
        render(await store.save(name, current()));
        // Saving falls back to this device when Unify cannot be written to. The
        // prompt has just promised the opposite, so silence here is how an
        // analysis goes missing from someone's other browser with no sign that
        // anything went wrong.
        status.hidden = !store.isLocalOnly();
        status.textContent = store.isLocalOnly()
          ? 'Saved on this device only — Unify could not be written to, so this will not appear elsewhere.'
          : '';
      } catch {
        empty.hidden = false;
        empty.textContent = 'Could not save.';
      }
    });
  });

  function render(entries: readonly SavedAnalysis[]): void {
    empty.hidden = entries.length > 0;
    empty.textContent = store.isLocalOnly()
      ? 'Nothing saved yet. These would be kept on this device only.'
      : 'Nothing saved yet.';
    list.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement('li');

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'saved-open';
        open.textContent = entry.name;
        open.title = entry.name;
        open.addEventListener('click', () => {
          // The analysis is fetched now rather than with the list, so opening
          // one costs a request the list no longer pays for every entry.
          open.disabled = true;
          const label = open.textContent;
          open.textContent = 'Opening…';
          void store
            .open(entry.id)
            .then((analysis) => {
              if (!analysis) throw new Error('unreadable');
              setOpen(false);
              onOpen(analysis);
            })
            .catch(() => {
              open.disabled = false;
              open.textContent = label;
              say('Could not open that analysis.');
            });
        });

        item.append(open);

        if (entry.mine) {
          // One control rather than three. Three actions and a name competing
          // for one row left the name — the only part that identifies it —
          // squeezed to "this is …", and put two different things called
          // "Share" side by side.
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'saved-more';
          more.setAttribute('aria-label', `Actions for ${entry.name}`);
          more.append(moreIcon());
          more.addEventListener('click', (event) => {
            event.stopPropagation();
            const box = more.getBoundingClientRect();
            showContextMenu(box.right, box.bottom + 4, actionsFor(entry));
          });
          item.append(more);
        } else {
          const from = document.createElement('span');
          from.className = 'saved-owner';
          from.textContent = `shared by ${entry.owner ?? 'someone else'}`;
          item.append(from);

          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'saved-more';
          more.setAttribute('aria-label', `Actions for ${entry.name}`);
          more.append(moreIcon());
          more.addEventListener('click', (event) => {
            event.stopPropagation();
            const box = more.getBoundingClientRect();
            showContextMenu(box.right, box.bottom + 4, [linkAction(entry)]);
          });
          item.append(more);
        }

        return item;
      }),
    );
  }

  /** Everything that can be done to an analysis of your own. */
  function actionsFor(entry: SavedAnalysis): MenuItem[] {
    return [
      linkAction(entry),
      {
        label: entry.sharedWith.length > 0
          ? `Share with someone… (${entry.sharedWith.length})`
          : 'Share with someone…',
        onPick: () => openShareWith(session, store, entry, render),
      },
      {
        label: entry.sharedWithTenant ? 'Stop sharing with everyone' : 'Share with everyone',
        onPick: () => {
          say(entry.sharedWithTenant ? 'Stopping…' : 'Sharing…');
          void store
            .setSharedWithTenant(entry.id, !entry.sharedWithTenant)
            .then((next) => {
              render(next);
              say(entry.sharedWithTenant ? 'No longer shared.' : 'Everyone here can open it now.');
            })
            .catch(() => say('Could not change sharing.'));
        },
      },
      {
        label: 'Delete',
        onPick: () => {
          say('Deleting…');
          void store
            .remove(entry.id)
            .then((next) => {
              render(next);
              say('');
            })
            .catch(() => say('Could not delete that analysis.'));
        },
      },
    ];
  }

  /** Hands the analysis to someone as a link, by whichever route exists. */
  function linkAction(entry: SavedAnalysis): MenuItem {
    return {
      label: canShare() ? 'Send a link…' : 'Copy link',
      onPick: () => {
        void store
          .open(entry.id)
          .then((analysis) => {
            if (!analysis) throw new Error('unreadable');
            return shareLink(linkFor(analysis), entry.name, 'A saved Unify Lens analysis');
          })
          .then((outcome) => {
            if (outcome === 'copied') say('Link copied.');
            if (outcome === 'failed') say('Could not share that link.');
          })
          .catch(() => say('Could not read that analysis.'));
      },
    };
  }

  /** One place for the panel to speak, so feedback is not scattered per button. */
  function say(message: string): void {
    status.hidden = message.length === 0;
    status.textContent = message;
  }

  return {
    destroy(): void {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
      host.replaceChildren();
    },
  };
}
