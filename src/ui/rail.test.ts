import { afterEach, describe, expect, it } from 'vitest';
import { railView, rememberWideRail, wideRailOpen } from './rail';

/**
 * `railView` is the whole specification of the attribute rail's behaviour, so
 * these enumerate it rather than sampling it. The runner has no DOM — see the
 * README — which is exactly why the decision was pulled out of the mount into a
 * function of three booleans.
 */
describe('railView', () => {
  it('shows the chart on a wide screen whether or not the rail is open', () => {
    expect(railView('wide', true, true).detail).toBe(true);
    expect(railView('wide', false, true).detail).toBe(true);
    // Also with nothing charted: the placeholder lives in the same pane.
    expect(railView('wide', true, false).detail).toBe(true);
  });

  it('follows the remembered choice on a wide screen', () => {
    expect(railView('wide', true, true).rail).toBe(true);
    expect(railView('wide', false, true).rail).toBe(false);
  });

  it('never shows both on a narrow screen', () => {
    for (const open of [true, false]) {
      for (const charted of [true, false]) {
        const view = railView('narrow', open, charted);
        expect(view.rail).not.toBe(view.detail);
      }
    }
  });

  it('keeps the list up on a narrow screen while nothing is charted', () => {
    // Not a preference that can be overridden: with no chart, closing the list
    // would leave the pane empty.
    expect(railView('narrow', false, false).rail).toBe(true);
    expect(railView('narrow', true, false).rail).toBe(true);
  });

  it('offers the toggle everywhere except a narrow screen with no chart', () => {
    expect(railView('wide', true, false).toggle).toBe(true);
    expect(railView('narrow', true, true).toggle).toBe(true);
    expect(railView('narrow', false, false).toggle).toBe(false);
  });

  it('labels the button with where it goes, not with what is on screen', () => {
    // The list is up, so the button leads to the chart.
    expect(railView('narrow', true, true).label).toBe('Chart');
    expect(railView('narrow', false, true).label).toBe('Attributes');
    // On a wide screen it shows and hides one region, so the name is constant
    // and `aria-expanded` carries the state instead.
    expect(railView('wide', true, true).label).toBe('Attributes');
    expect(railView('wide', false, true).label).toBe('Attributes');
  });

  it('points the chevron the way the swap will move', () => {
    expect(railView('narrow', true, true).glyph).toBe('forward');
    expect(railView('narrow', false, true).glyph).toBe('back');
    expect(railView('wide', false, true).glyph).toBe('sidebar');
  });
});

describe('wideRailOpen', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('opens the rail where nothing can be stored', () => {
    // Node has no `localStorage`, which is the same shape as a browser that
    // throws on one: showing the attributes is the safe answer either way.
    expect(wideRailOpen()).toBe(true);
  });

  it('remembers only the closed state, so an untouched device stores nothing', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };

    rememberWideRail(false);
    expect(store.size).toBe(1);
    expect(wideRailOpen()).toBe(false);

    rememberWideRail(true);
    expect(store.size).toBe(0);
    expect(wideRailOpen()).toBe(true);
  });
});
