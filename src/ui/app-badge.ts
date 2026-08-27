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
 * Two conditions, not one: someone has asked for it, and — on iOS, where
 * badging an installed web app is a notification — the permission that requires
 * is still granted. A permission revoked in Settings turns the feature off
 * without the app being told, so it is checked rather than remembered.
 */
export function iconBadgeOn(): boolean {
  if (!canBadgeIcon()) return false;
  try {
    if (globalThis.localStorage?.getItem(KEY) !== 'on') return false;
  } catch {
    return false;
  }
  return typeof Notification === 'undefined' || Notification.permission === 'granted';
}

/**
 * Turns icon badging on, asking for permission if that is what it takes.
 *
 * Must be called from something the user did: a permission prompt out of
 * nowhere is both refused by browsers and deserved.
 */
export async function enableIconBadge(): Promise<boolean> {
  if (!canBadgeIcon()) return false;
  try {
    // Safari treats badging an installed web app as a notification and will
    // not do it unsolicited. Chrome and Edge badge without asking, and have no
    // Notification permission to grant here.
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      if ((await Notification.requestPermission()) !== 'granted') return false;
    }
    globalThis.localStorage?.setItem(KEY, 'on');
    return true;
  } catch {
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
