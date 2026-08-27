const KEY = 'unify-lens:icon-badge';

interface Badger {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Whether this browser can badge the installed app's icon at all. */
export function canBadgeIcon(): boolean {
  return typeof (navigator as Badger).setAppBadge === 'function';
}

/**
 * Whether the icon is being badged.
 *
 * The stored answer and nothing else. An earlier version also demanded
 * `Notification.permission === 'granted'`, which is only how Safari gates
 * badging: Chrome and Edge badge with no permission at all, leaving it at
 * "default" forever, so requiring it meant opting in could never take effect
 * there. Whether badging actually works is settled by doing it — see
 * `enableIconBadge` — not by reading a permission most engines never set.
 */
export function iconBadgeOn(): boolean {
  try {
    return canBadgeIcon() && globalThis.localStorage?.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Turns icon badging on, asking for permission only if that is what it takes.
 *
 * Tries it before asking for anything. Where badging is free — Chrome, Edge —
 * that is the whole story and nobody is prompted. Safari rejects until
 * notifications are allowed, and only then is there a reason to interrupt.
 *
 * Must be called from something the user did: a permission prompt out of
 * nowhere is both refused by browsers and deserved.
 */
export async function enableIconBadge(): Promise<boolean> {
  if (!canBadgeIcon()) return false;

  if (await badgeWorks()) return remember();

  try {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'denied') return false;
    if ((await Notification.requestPermission()) !== 'granted') return false;
  } catch {
    return false;
  }

  return (await badgeWorks()) ? remember() : false;
}

/**
 * Whether this really badges, established by badging.
 *
 * A number nobody asked for would be wrong to leave behind, so it is cleared
 * again immediately — the count is written properly by `showIconBadge` once
 * the setting has stuck.
 */
async function badgeWorks(): Promise<boolean> {
  try {
    await (navigator as Badger).setAppBadge?.(1);
    await clearIconBadge();
    return true;
  } catch {
    return false;
  }
}

function remember(): boolean {
  try {
    globalThis.localStorage?.setItem(KEY, 'on');
    return true;
  } catch {
    // Badging works but the choice cannot be kept, so it would be forgotten on
    // reload. Better to say it failed than to promise something that lapses.
    return false;
  }
}

export function disableIconBadge(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
  void clearIconBadge();
}

/**
 * Puts the count on the installed app's icon.
 *
 * What this cannot do is change while the app is closed. That needs a push
 * subscription and a server to push from, and there is neither — so the icon
 * carries the last count the app knew, and catches up when it is next opened.
 */
export async function showIconBadge(count: number): Promise<void> {
  if (!iconBadgeOn()) return;
  try {
    if (count > 0) await (navigator as Badger).setAppBadge?.(count);
    else await clearIconBadge();
  } catch {
    // Not installed, or refused. The in-app badge still shows the count.
  }
}

export async function clearIconBadge(): Promise<void> {
  try {
    await (navigator as Badger).clearAppBadge?.();
  } catch {
    // Nothing to clear.
  }
}
