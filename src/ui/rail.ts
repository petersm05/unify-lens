/**
 * Where the attribute panel sits, and what it does there.
 *
 * There is one panel and one control, and they behave the same way at every
 * size: the panel shows or hides, and the chart is on screen either way. Only
 * *where* the panel goes changes — beside the chart where there is room, over
 * it where there is not.
 *
 * That was not true at first. A phone got a drill-down instead, with the panel
 * and the chart taking turns, which meant a second set of rules about which one
 * you were looking at, a label that changed, and a chevron that turned round.
 * Two mechanisms for one idea. The overlay is the same mechanism as the column,
 * so all of that is gone and what is left here is the resting state and where
 * it is remembered.
 *
 * The breakpoint lives here and nowhere else. It is behaviour as much as
 * layout — what the resting state is, whether a selection closes the panel,
 * whether the choice is remembered — so JavaScript needs the number anyway, and
 * a second copy in CSS would only be a number waiting to disagree with this
 * one. `.split` carries the answer as a class.
 */

/** Below this the rail and the chart cannot both be on screen. */
const NARROW = '(max-width: 820px)';

/** Whether there is room for the panel beside the chart, or only over it. */
export type Lane = 'wide' | 'narrow';

export function laneNow(): Lane {
  return globalThis.matchMedia?.(NARROW).matches === true ? 'narrow' : 'wide';
}

/**
 * Reports a change of arrangement; returns the unsubscribe.
 *
 * `matchMedia` rather than a `resize` listener or a `ResizeObserver`: it fires
 * only when the answer actually changes, and an observer on the split would be
 * re-triggered by the rail's own collapse.
 */
export function onLaneChange(handle: (lane: Lane) => void): () => void {
  const query = globalThis.matchMedia?.(NARROW);
  if (!query) return () => undefined;
  const listener = (event: MediaQueryListEvent): void => handle(event.matches ? 'narrow' : 'wide');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const KEY = 'unify-lens:attr-rail';

/**
 * Whether the panel rests open, on a screen with room to keep it open.
 *
 * Only the closed state is written. Showing the attributes is what that much
 * room is for, so someone who has never touched the toggle should see them, and
 * a device that has never been asked stores nothing.
 *
 * Not asked where the panel covers the chart: resting open there would put a
 * list in front of the thing it is a list *for*, and it is one tap away.
 */
export function wideRailOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function rememberWideRail(open: boolean): void {
  try {
    if (open) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, 'off');
  } catch {
    // Private browsing refuses to store anything. The rail still opens and
    // closes; it just starts open again next time, which is the safe default.
  }
}

/**
 * Whether picking an attribute should put the panel away.
 *
 * Only where it is covering the chart. Beside it, the panel is something you
 * left open on purpose and a selection is not a reason to close it.
 */
export function closesOnPick(lane: Lane): boolean {
  return lane === 'narrow';
}
