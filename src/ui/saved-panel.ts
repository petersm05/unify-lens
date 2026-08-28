import type { Analysis } from '../data/analysis';
import type { SavedAnalysis, SavedStore } from '../data/saved';
import type { Session } from '../sdk/client';
import { must } from './dom';
import { confirmAction } from './prompt';
import { canShare, shareLink } from './share';
import { bugIcon, chevronIcon, ideaIcon, moreIcon, settingsIcon, signOutIcon } from './icons';
import { showContextMenu, type MenuItem } from './context-menu';
import { openShareWith } from './share-with';
import { openSaveAnalysis } from './save-analysis';
import { applyChoice } from './share-options';
import { createIncoming } from '../data/incoming';
import { canBadgeIcon, enableIconBadge, iconBadgeOn, showIconBadge } from './app-badge';
import { buildId, openReport } from './report';
import { openSettings } from './settings';

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
        <button type="button" class="saved-offer" hidden>Show this count on the app icon</button>

        <div class="menu-rows">
          <button type="button" class="menu-row" data-act="settings">
            <span class="menu-row-label">Settings</span>
          </button>
          <button type="button" class="menu-row" data-act="bug">
            <span class="menu-row-label">Report a problem</span>
          </button>
          <button type="button" class="menu-row" data-act="idea">
            <span class="menu-row-label">Request a feature</span>
          </button>
        </div>

        <div class="menu-rows">
          <button type="button" class="menu-row is-danger" data-act="signout">
            <span class="menu-row-label">Sign out</span>
          </button>
        </div>

        <p class="saved-foot">
          <span class="saved-env"></span>
          <span class="saved-build"></span>
        </p>
      </div>
    </div>
  `;

  const button = must(host.querySelector<HTMLButtonElement>('.saved-btn'), 'saved: button');
  button.prepend(moreIcon());

  const incoming = createIncoming(session);
  const offer = must(host.querySelector<HTMLButtonElement>('.saved-offer'), 'saved: offer');
  const badge = document.createElement('span');
  badge.className = 'saved-badge';
  badge.hidden = true;
  button.append(badge);

  /**
   * How many analyses someone else has shared that have not been looked at.
   *
   * Only ever raised by what was actually read back from Unify. A background
   * check that failed says nothing, so the badge keeps its last honest value
   * rather than being cleared by an expired token.
   */
  function showBadge(entries: readonly SavedAnalysis[]): void {
    const count = incoming.unseen(entries).length;
    badge.hidden = count === 0;
    badge.textContent = count > 9 ? '9+' : String(count);
    button.setAttribute(
      'aria-label',
      count === 0 ? 'More' : `More — ${count} shared with you`,
    );
    void showIconBadge(count);
  }

  /**
   * Offered when there is a count to offer it for.
   *
   * Opening the menu is what marks them seen, so by the time the list has been
   * drawn the count is on its way to nought — which is exactly when someone has
   * just learned there is a count worth putting somewhere they would see it
   * without opening a menu. Hence the number the panel was opened *on*.
   */
  function showOffer(count: number): void {
    offer.hidden = !canBadgeIcon() || iconBadgeOn() || count === 0;
  }
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
   * plumbing and cannot drift from what is actually loaded. It sits in the
   * menu's footer, as a caption rather than as a heading of its own; the
   * settings sheet is where it can be copied for a report.
   */
  const build = must(host.querySelector<HTMLElement>('.saved-build'), 'saved: build');
  build.textContent = `Build ${buildId()}`;

  offer.addEventListener('click', () => {
    void enableIconBadge().then((on) => {
      offer.hidden = iconBadgeOn();
      if (on) {
        say('The app icon will show the count from now on.');
        void store.list().then((entries) => showBadge(entries));
      } else {
        say(
          typeof Notification !== 'undefined' && Notification.permission === 'denied'
            ? 'The app icon cannot be badged while notifications are blocked for this app.'
            : 'This browser will not badge the app icon. The count still shows here.'
        );
      }
    });
  });

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

  /**
   * Everything that is a preference, one level in.
   *
   * Changing environment is a once-a-quarter act and badging the icon is a
   * once-ever one; neither earns a place beside the analyses somebody opened
   * this menu to reach. The sheet also has room to say what each does, which a
   * dropdown row does not.
   */
  const settings = must(
    host.querySelector<HTMLButtonElement>('[data-act="settings"]'),
    'saved: settings',
  );
  settings.append(chevronIcon('forward'));
  settings.addEventListener('click', () => {
    setOpen(false);
    openSettings({
      environment,
      localOnly: store.isLocalOnly(),
      onSignOut,
      onChangeEnvironment,
      // Turning badging on there should put the count on the icon at once,
      // rather than at the next background check a few minutes later.
      onBadgeEnabled: () => void store.list().then((entries) => showBadge(entries)),
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

  // The rows read as a menu rather than as a paragraph of links, so each one
  // gets the glyph that says which kind of thing it is.
  for (const [act, glyph] of [
    ['settings', settingsIcon],
    ['bug', bugIcon],
    ['idea', ideaIcon],
    ['signout', signOutIcon],
  ] as const) {
    host.querySelector(`[data-act="${act}"]`)?.prepend(glyph());
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
      const entries = await store.list();
      await incoming.ready();
      const arrived = incoming.unseen(entries).length;
      render(entries);
      showOffer(arrived);
      // Cleared only after they have been drawn — having opened the menu is
      // what counts as having seen them, not having asked for it.
      void incoming.markSeen(entries).then(() => showBadge(entries));
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
    void openSaveAnalysis(
      session,
      store.isLocalOnly()
        ? 'Stored on this device.'
        : 'Stored in Unify, so it follows you to any browser you sign in from.',
    ).then(async (request) => {
      if (request === null) return;
      say('Saving…');
      try {
        const entries = await store.save(request.name, current());
        render(entries);

        // Sharing waits until the analysis exists, because there is nothing to
        // grant a permission on before that.
        const saved = entries.find((entry) => entry.name === request.name);
        const wanted = request.share.tenantWide || request.share.people.length > 0;
        if (saved && wanted) {
          say('Sharing…');
          const failed = await applyChoice(store, saved.id, request.share);
          render(await store.list());
          say(
            failed.length === 0
              ? 'Saved and shared.'
              : `Saved, but could not share with ${failed.join(', ')}.`,
          );
          return;
        }

        // Saving falls back to this device when Unify cannot be written to, and
        // the prompt has just promised the opposite.
        say(
          store.isLocalOnly()
            ? 'Saved on this device only — Unify could not be written to, so this will not appear elsewhere.'
            : '',
        );
      } catch {
        say('Could not save.');
      }
    });
  });

  function render(entries: readonly SavedAnalysis[]): void {
    const fresh = new Set(incoming.unseen(entries).map((entry) => entry.id));
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

          // The count says how many; this says which. Without it a badge of
          // three sends someone hunting down a list for what changed.
          if (fresh.has(entry.id)) {
            open.classList.add('is-new');
            from.textContent = `new — shared by ${entry.owner ?? 'someone else'}`;
          }

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
        label: 'Share with someone…',
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

  /**
   * Looks for analyses others have shared, in the background.
   *
   * Infrequent by design. Listing costs a slow query, and a share is something
   * a colleague mentions in a meeting rather than something that arrives by the
   * minute — so this is a check that finds it eventually, not a live feed.
   *
   * A failed read is silent. Tokens expire, most often while the app has been
   * sitting on a home screen untouched, and the session guard is what recovers
   * from that; a badge has no business raising it, and less business reporting
   * "nothing new" on the strength of a request that never arrived.
   */
  async function checkShares(): Promise<void> {
    if (document.visibilityState !== 'visible' || !panel.hidden) return;
    const entries = await store.refresh();
    if (!entries) return;
    await incoming.ready();
    showBadge(entries);
  }

  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  const stopChecking = (): void => {
    if (timer !== undefined) globalThis.clearInterval(timer);
    timer = undefined;
  };
  const startChecking = (): void => {
    stopChecking();
    timer = globalThis.setInterval(() => void checkShares(), CHECK_SHARES_MS);
  };

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      // Behind the session guard's own check on the same event, so a token that
      // died while the app was away is refreshed before this asks anything of
      // it rather than racing it and losing.
      globalThis.setTimeout(() => void checkShares(), RESUME_DELAY_MS);
      startChecking();
    } else {
      stopChecking();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  // Not at once: the first thing someone wants is their graph, and this query
  // is slow enough to be worth keeping out of the way of it.
  globalThis.setTimeout(() => void checkShares(), FIRST_CHECK_MS);
  if (document.visibilityState === 'visible') startChecking();

  return {
    destroy(): void {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', onVisible);
      stopChecking();
      host.replaceChildren();
    },
  };
}

/** Long enough that a slow query stays out of the way of everything else. */
const FIRST_CHECK_MS = 15_000;
const CHECK_SHARES_MS = 5 * 60_000;
/** Lets the session guard finish reviving the token before this uses it. */
const RESUME_DELAY_MS = 2_000;
