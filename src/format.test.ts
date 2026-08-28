import { describe, expect, it } from 'vitest';
import { formatCompact, formatCount, formatMoney, formatMoneyExact } from './format';

/**
 * These assertions avoid pinning a locale.
 *
 * Every function here calls `Intl` with `undefined`, so the grouping and
 * decimal characters come from whatever locale the runner happens to have.
 * Asserting "12.9K" would pass on a developer's machine and fail on a runner
 * set to Dutch, for a difference that is not ours. What *is* ours is which
 * suffix gets chosen and how many fraction digits survive, so that is what
 * these check — `[.,]` stands in for the one character we do not control.
 */
describe('formatCompact', () => {
  it('leaves anything under ten thousand uncompacted', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
    // The K threshold is 1e4, not 1e3: four digits still read fine in full.
    expect(formatCompact(9999)).not.toMatch(/[KMB]$/);
  });

  it('switches to K at ten thousand', () => {
    expect(formatCompact(10_000)).toBe('10K');
    expect(formatCompact(12_900)).toMatch(/^12[.,]9K$/);
  });

  it('switches to M at a million and B at a billion', () => {
    expect(formatCompact(1_000_000)).toBe('1M');
    expect(formatCompact(87_400_000)).toMatch(/^87[.,]4M$/);
    expect(formatCompact(1_000_000_000)).toBe('1B');
    expect(formatCompact(1_500_000_000)).toMatch(/^1[.,]5B$/);
  });

  it('keeps at most one fraction digit once a suffix is applied', () => {
    // 12_345 / 1000 is 12.345, which must not reach the label as 12.345K.
    expect(formatCompact(12_345)).toMatch(/^12[.,]3K$/);
  });

  it('scales by magnitude, so negatives compact the same way', () => {
    expect(formatCompact(-2_500_000)).toMatch(/^-2[.,]5M$/);
    expect(formatCompact(-10_000)).toBe('-10K');
  });
});

describe('formatCount', () => {
  it('rounds to a whole number', () => {
    // Stripping the grouping separator is the locale-free way to ask this:
    // "1,235" and "1.235" both mean the fraction is gone.
    expect(formatCount(1234.67).replace(/\D/g, '')).toBe('1235');
    expect(formatCount(7)).toBe('7');
  });
});

describe('formatMoney', () => {
  it('falls back to plain compaction when there is no currency', () => {
    expect(formatMoney(87_400_000, undefined)).toBe(formatCompact(87_400_000));
  });

  it('keeps the suffix attached to the number, not the symbol', () => {
    const formatted = formatMoney(87_400_000, 'EUR');
    expect(formatted).toMatch(/87[.,]4M/);
    // Whichever side the locale puts the symbol on, M must follow the digits.
    expect(formatted).not.toMatch(/M\s*\d/);
  });

  it('compacts at the same thresholds as formatCompact', () => {
    expect(formatMoney(16_000, 'EUR')).toMatch(/16K/);
    expect(formatMoney(999, 'EUR')).not.toMatch(/[KMB]/);
  });

  it('carries no trailing zero that plain compaction would drop', () => {
    // A ceiling of one fraction digit is not a floor of one. Intl's currency
    // style defaults the minimum to 2 and clamps it to the ceiling rather than
    // to zero, which rendered "€16.0K" beside formatCompact's "16K" — two
    // headline forms of the same figure, disagreeing on screen.
    expect(formatMoney(16_000, 'EUR')).not.toMatch(/[.,]0K/);
    expect(formatMoney(16_000, 'EUR').replace(/[^\dKMB]/g, '')).toBe('16K');
    expect(formatCompact(16_000)).toBe('16K');
  });

  it('still keeps a fraction digit where it carries information', () => {
    expect(formatMoney(87_400_000, 'EUR')).toMatch(/87[.,]4M/);
  });

  it('degrades to a trailing code rather than throwing on a bad currency', () => {
    // Intl rejects anything that is not a well-formed currency code.
    expect(formatMoney(1_500_000, 'NOT-A-CODE')).toBe(`${formatCompact(1_500_000)} NOT-A-CODE`);
  });
});

describe('formatMoneyExact', () => {
  it('keeps the real figure instead of compacting', () => {
    const formatted = formatMoneyExact(16_000, 'EUR');
    expect(formatted).not.toMatch(/[KMB]/);
    expect(formatted.replace(/\D/g, '')).toBe('16000');
  });

  it('counts plainly when there is no currency', () => {
    expect(formatMoneyExact(16_000, undefined)).toBe(formatCount(16_000));
  });

  it('degrades to a trailing code rather than throwing on a bad currency', () => {
    expect(formatMoneyExact(16_000, 'NOT-A-CODE')).toBe(`${formatCount(16_000)} NOT-A-CODE`);
  });
});
