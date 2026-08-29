/**
 * Number formatting shared by the data and view layers.
 *
 * Lives outside `viz/` because bin labels are built where the bins are
 * computed; a second copy in the data layer is how the histogram ended up
 * still saying "1,2 mln." after the rest of the app moved to K/M/B.
 */
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return integer.format(value);
}

/** Anything that knows how many objects its figures were read from. */
export interface SampledRead {
  readonly sampled: number;
}

/**
 * What a partial read actually covered, for the sentence that says so.
 *
 * `SAMPLE_LIMIT` is a ceiling, not a measurement, and naming the constant was
 * wrong in every message that did it: `SampleStore` also stops on a time
 * budget, so a slow read is truncated at whatever it reached — 2.500 of 10.000
 * objects, under a caption claiming the first 4.000.
 *
 * It takes the read rather than a number for that reason. A caption cannot
 * reach for the constant again without first inventing something that claims
 * to be a read, where `sampledObjects(SAMPLE_LIMIT)` would have compiled and
 * looked ordinary — the compiler enforces on every build what a check on the
 * source could only look for.
 */
export function sampledObjects(read: SampledRead): string {
  return `the first ${formatCount(read.sampled)} objects read`;
}

/**
 * Compact suffixes, chosen over `Intl`'s own compact notation.
 *
 * The locale form is correct but not self-consistent: Dutch CLDR renders
 * thousands as `K` and millions as `mln.`, so one dashboard ends up mixing the
 * two. Digits, separators and currency placement still come from the locale —
 * only the magnitude suffix is fixed.
 */
const SUFFIXES: ReadonlyArray<{ from: number; divisor: number; suffix: string }> = [
  { from: 1e9, divisor: 1e9, suffix: 'B' },
  { from: 1e6, divisor: 1e6, suffix: 'M' },
  { from: 1e4, divisor: 1e3, suffix: 'K' },
];

function scale(value: number): { value: number; suffix: string } {
  const magnitude = Math.abs(value);
  for (const step of SUFFIXES) {
    if (magnitude >= step.from) return { value: value / step.divisor, suffix: step.suffix };
  }
  return { value, suffix: '' };
}

function digits(value: number, fraction: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: fraction }).format(value);
}

/** Headline figures compact to 12.9K; tables keep the exact number. */
export function formatCompact(value: number): string {
  const scaled = scale(value);
  return digits(scaled.value, scaled.suffix ? 1 : 0) + scaled.suffix;
}

export function formatMoney(value: number, currency: string | undefined): string {
  const scaled = scale(value);
  if (!currency) return formatCompact(value);

  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      // The currency style defaults the *minimum* to 2 and clamps it down to
      // the ceiling rather than to zero, which rendered a round figure as
      // "€16.0K" where formatCompact gave "16K". Both are headline forms and
      // they sat next to each other.
      minimumFractionDigits: 0,
      maximumFractionDigits: scaled.suffix ? 1 : 0,
    }).formatToParts(scaled.value);

    // Append the suffix to the number itself, wherever the locale puts it
    // relative to the symbol — "€ 87,4M" in Dutch, "$87.4M" in English.
    const numeric = new Set(['integer', 'group', 'decimal', 'fraction']);
    let last = -1;
    parts.forEach((part, index) => {
      if (numeric.has(part.type)) last = index;
    });

    return parts.map((part, index) => (index === last ? part.value + scaled.suffix : part.value)).join('');
  } catch {
    return `${formatCompact(value)} ${currency}`;
  }
}



/**
 * A money value at full precision.
 *
 * A record view wants the actual figure — €16.000, not €16K. Compaction is for
 * headlines and axes, where the exact digits are noise.
 */
export function formatMoneyExact(value: number, currency: string | undefined): string {
  if (!currency) return formatCount(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${formatCount(value)} ${currency}`;
  }
}
