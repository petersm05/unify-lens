/**
 * Where the attribute rail sits, and what it does there.
 *
 * The breakpoint lives here and nowhere else. It used to be a `max-width` rule
 * in the stylesheet, but the two arrangements differ in *behaviour* as well as
 * in looks — what the rail's resting state is, whether choosing an attribute
 * puts it away, whether the choice is remembered — and behaviour is not
 * something a stylesheet can hold. Since JavaScript needs the number anyway, a
 * second copy in CSS would only be a number waiting to disagree with this one,
 * so `.split` carries the answer as a class instead.
 */

/** Below this the rail and the chart cannot both be on screen. */
const NARROW = '(max-width: 820px)';

/** Whether there is room for the rail beside the chart. */
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
 * Whether the rail shows beside the chart, as this device last left it.
 *
 * Only the closed state is written. Showing the attributes is what a wide
 * screen is for, so someone who has never touched the toggle should see them —
 * and a device that has never been asked stores nothing.
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

export interface RailView {
  /** Whether the attribute list is on screen. */
  readonly rail: boolean;
  /** Whether the chart is on screen. On a phone the two are exclusive. */
  readonly detail: boolean;
  /** Whether the toggle has anywhere to go. */
  readonly toggle: boolean;
  /** What the button will do, not what is on screen. */
  readonly label: string;
  readonly glyph: 'sidebar' | 'back' | 'forward';
}

/**
 * What each part of the split shows, given the arrangement, what was last
 * asked for, and whether there is a chart to ask for.
 *
 * One total function of three inputs rather than a scattering of conditionals
 * through the mount. Every combination is enumerable, which is the only reason
 * any of this is testable in a project whose runner has no DOM.
 */
export function railView(lane: Lane, open: boolean, charted: boolean): RailView {
  if (lane === 'wide') {
    return { rail: open, detail: true, toggle: true, label: 'Attributes', glyph: 'sidebar' };
  }

  // With nothing charted there is nowhere to go back to, so the list is the
  // whole view and a toggle would be a button that does nothing.
  const rail = open || !charted;
  return {
    rail,
    detail: !rail,
    toggle: charted,
    label: rail ? 'Chart' : 'Attributes',
    glyph: rail ? 'forward' : 'back',
  };
}
