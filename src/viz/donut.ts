import type { Bin } from '../data/attributes';
import { ramp, reducedMotion } from '../ui/motion';
import { formatCount } from './theme';

const SIZE = 220;
const THICKNESS = 34;
/** 2px of surface between segments, as an angular gap. */
const GAP = 0.012;

/**
 * Part-to-whole for a small number of slices.
 *
 * Only ever reached when the mark chooser allows it — at most five slices, all
 * parts of one whole. The ring is thin and directly labelled; the legend is the
 * bar list beside it, which shares the same ordinal ramp.
 */
export interface DonutOptions {
  /** Selecting a slice filters, exactly as tapping a bar does. */
  readonly onPick?: (index: number) => void;
  /** Emphasises one slice and recedes the rest. */
  readonly activeIndex?: number;
  /** Overrides the centre figure — a share of money is not a count. */
  readonly format?: (value: number) => string;
  readonly caption?: string;
  /**
   * Value shown in the hole. Defaults to the whole the ring represents; set it
   * to a selected slice so the centre reads as a focus readout.
   */
  readonly centreValue?: number;
}

export function renderDonut(
  host: HTMLElement,
  bins: readonly Bin[],
  options: DonutOptions = {},
): () => void {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  if (total === 0) {
    host.replaceChildren();
    return () => undefined;
  }

  const radius = SIZE / 2 - 4;
  const inner = radius - THICKNESS;

  // Selecting a slice re-renders the ring, which would otherwise drop keyboard
  // focus to <body> and strand anyone navigating without a pointer. Restored
  // only when the focus was keyboard-driven, so a pointer user never inherits
  // a focus ring they did not ask for.
  const active = document.activeElement;
  const focused =
    host.contains(active) && active instanceof SVGPathElement && active.matches(':focus-visible')
      ? [...host.querySelectorAll('path')].indexOf(active)
      : -1;

  host.innerHTML = `
    <svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Share of total">
      <g transform="translate(${SIZE / 2} ${SIZE / 2})">${bins
        .map(
          (bin, index) =>
            `<path class="slice" fill="var(--ord-${index})" data-index="${index}" tabindex="0" role="button" aria-label="${escapeAttribute(bin.label)}" />`,
        )
        .join('')}</g>
      <text x="${SIZE / 2}" y="${SIZE / 2 - 4}" class="donut-total"></text>
      <text x="${SIZE / 2}" y="${SIZE / 2 + 16}" class="donut-caption"></text>
    </svg>
  `;

  // Usable width inside the hole. The inset is generous on purpose: text that
  // technically fits the hole still reads as crowding the ring.
  const holeWidth = inner * 2 - 30;

  const label = host.querySelector<SVGTextElement>('.donut-total');
  if (label) {
    label.textContent = (options.format ?? formatCount)(options.centreValue ?? total);
    fitText(label, holeWidth, 30);
  }

  const caption = host.querySelector<SVGTextElement>('.donut-caption');
  if (caption) {
    caption.textContent = options.caption ?? 'objects';
    fitText(caption, holeWidth, 12);
  }

  const paths = [...host.querySelectorAll<SVGPathElement>('path')];

  if (focused >= 0) paths[Math.min(focused, paths.length - 1)]?.focus();

  paths.forEach((path, index) => {
    if (options.activeIndex !== undefined && options.activeIndex !== index) {
      path.classList.add('muted');
    }
    if (options.activeIndex === index) path.classList.add('on');
    if (!options.onPick) return;
    const pick = options.onPick;
    path.classList.add('pickable');
    path.addEventListener('click', () => pick(index));
    path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick(index);
      }
    });
  });

  /**
   * The ring is redrawn each frame rather than faded in: sweeping clockwise
   * from twelve o'clock is how a part-to-whole actually accumulates, and it
   * lands on exactly the geometry a static render would produce.
   */
  const paint = (progress: number): void => {
    let angle = -Math.PI / 2;
    bins.forEach((bin, index) => {
      const sweep = (bin.count / total) * Math.PI * 2 * progress;
      const from = angle + GAP / 2;
      const to = angle + sweep - GAP / 2;
      angle += sweep;
      paths[index]?.setAttribute('d', to > from ? arc(from, to, radius, inner) : '');
    });
  };

  if (reducedMotion()) {
    paint(1);
    return () => undefined;
  }
  return ramp(620, paint);
}

/**
 * Shrinks a label until it fits the width it has.
 *
 * Measured rather than estimated from character count: "€ 87,4 mln." and
 * "1.234.567" are the same length and nowhere near the same width, and the
 * currency, separators and locale all vary at runtime.
 */
function fitText(element: SVGTextElement, maxWidth: number, baseSize: number): void {
  element.setAttribute('font-size', String(baseSize));

  let measured = 0;
  try {
    measured = element.getComputedTextLength();
  } catch {
    measured = 0;
  }

  // A detached or not-yet-laid-out node measures 0; leave the base size alone
  // rather than scaling by a meaningless ratio.
  if (measured <= 0 || measured <= maxWidth) return;

  const scaled = Math.max(11, Math.floor(baseSize * (maxWidth / measured)));
  element.setAttribute('font-size', String(scaled));
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function arc(from: number, to: number, outer: number, inner: number): string {
  const large = to - from > Math.PI ? 1 : 0;
  const x0 = Math.cos(from) * outer;
  const y0 = Math.sin(from) * outer;
  const x1 = Math.cos(to) * outer;
  const y1 = Math.sin(to) * outer;
  const x2 = Math.cos(to) * inner;
  const y2 = Math.sin(to) * inner;
  const x3 = Math.cos(from) * inner;
  const y3 = Math.sin(from) * inner;

  return [
    `M ${x0} ${y0}`,
    `A ${outer} ${outer} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}
