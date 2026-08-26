/** Honour the OS setting — every animation here is skipped when it is set. */
export function reducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Per-item entrance delay.
 *
 * Capped so a long list still finishes quickly: a 40-row table should not take
 * a second to appear because row 40 waited its turn.
 */
export function stagger(index: number, step = 18, max = 240): number {
  return Math.min(index * step, max);
}

const EASE_OUT = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Counts a figure up to its value.
 *
 * Takes the number and a formatter rather than a finished string, so the
 * currency, compaction and locale stay identical to the final frame — a
 * count-up that formats differently mid-flight reads as a glitch.
 */
export function countUp(
  element: HTMLElement,
  to: number,
  format: (value: number) => string,
  duration = 620,
): void {
  if (reducedMotion() || !Number.isFinite(to)) {
    element.textContent = format(to);
    return;
  }

  const from = 0;
  let start: number | null = null;

  const step = (now: number): void => {
    start ??= now;
    const progress = Math.min(1, (now - start) / duration);
    element.textContent = format(from + (to - from) * EASE_OUT(progress));
    if (progress < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

/**
 * Runs an eased 0→1 ramp, for canvas drawing that cannot use CSS.
 *
 * Returns a cancel function so a superseded render stops painting rather than
 * fighting the next one for the same canvas.
 */
export function ramp(duration: number, onFrame: (progress: number) => void): () => void {
  if (reducedMotion()) {
    onFrame(1);
    return () => undefined;
  }

  let cancelled = false;
  let start: number | null = null;

  const step = (now: number): void => {
    if (cancelled) return;
    start ??= now;
    const progress = Math.min(1, (now - start) / duration);
    onFrame(EASE_OUT(progress));
    if (progress < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
  return () => {
    cancelled = true;
  };
}
