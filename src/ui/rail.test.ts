import { afterEach, describe, expect, it } from 'vitest';
import { closesOnPick, rememberWideRail, wideRailOpen } from './rail';

/**
 * What is left to test once the panel behaves the same way at every size: where
 * the resting state is remembered, and whether a selection puts the panel away.
 * The runner has no DOM — see the README — so the rest of it is the stylesheet's
 * and is checked in `dev/phone-harness.html`.
 */
describe('closesOnPick', () => {
  it('closes the panel only where it is covering the chart', () => {
    expect(closesOnPick('narrow')).toBe(true);
    // Beside the chart it is something you left open on purpose.
    expect(closesOnPick('wide')).toBe(false);
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
