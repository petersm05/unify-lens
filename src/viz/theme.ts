/** Reads a palette role off the `.viz-root` element so CSS stays the source of truth. */
export function token(name: string): string {
  const root = document.querySelector('.viz-root') ?? document.documentElement;
  return getComputedStyle(root).getPropertyValue(name).trim();
}

/** The validated 4-step ordinal ramp, indexed by hop distance from the root. */
export function hopColor(hop: number): string {
  return token(`--hop-${Math.min(hop, 3)}`);
}

export const HOP_LABELS = ['Focus', '1 hop', '2 hops', '3 hops'] as const;

export { formatCount, formatCompact, formatMoney, percent, sampledObjects } from '../format';
export type { SampledRead } from '../format';
