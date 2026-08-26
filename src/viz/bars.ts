import { reducedMotion, stagger } from '../ui/motion';
import { formatCount } from './theme';

export interface BarDatum {
  readonly label: string;
  readonly count: number;
}

export interface BarListOptions {
  /**
   * Ranked lists sort by magnitude; ordered scales (enum values, histogram
   * buckets) must keep their given order or the reading changes.
   */
  readonly preserveOrder?: boolean;
  readonly onPick?: (datum: BarDatum, index: number) => void;
  /** Extra line in the tooltip, e.g. share of population. */
  readonly detail?: (datum: BarDatum, total: number) => string;
  /** Overrides the value label — money and ratios are not counts. */
  readonly format?: (value: number) => string;
  /**
   * Highlights one bar and recedes the rest.
   *
   * The emphasis pattern: when one value is the point, colouring every bar
   * equally buries it.
   */
  readonly activeIndex?: number;
  /**
   * Steps the bars through the ordinal ramp instead of one flat hue.
   *
   * Only for genuinely ordered scales, and only up to the ramp's six validated
   * steps — past that the ramp is dropped rather than extended with invented
   * colours.
   */
  readonly ramp?: boolean;
  /**
   * Appends each bar's share of the total.
   *
   * Only where a share means something: a share of counts or of sums does, a
   * share of a set of averages does not.
   */
  readonly share?: boolean;
}

/**
 * A single-series ranked bar list.
 *
 * One series, so one hue and no legend — the heading names the measure. Every
 * bar carries its value directly, which makes an axis redundant.
 */
export function renderBarList(
  target: HTMLElement,
  data: readonly BarDatum[],
  options: BarListOptions = {},
): void {
  const ordered = options.preserveOrder ? [...data] : [...data].sort((a, b) => b.count - a.count);
  const max = Math.max(...ordered.map((datum) => datum.count), 1);
  const total = ordered.reduce((sum, datum) => sum + datum.count, 0);

  target.replaceChildren(
    ...ordered.map((datum, index) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'listitem');
      if (options.onPick) row.tabIndex = 0;

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = datum.label;

      const track = document.createElement('span');
      track.className = 'track';
      const fill = document.createElement('span');
      fill.className = 'fill';

      // Bars grow out of the baseline rather than appearing at length, which
      // reads as the data arriving. The row itself fades up on the same delay
      // so the label and the bar land together.
      const target = `${(datum.count / max) * 100}%`;
      const delay = stagger(index);
      if (reducedMotion()) {
        fill.style.width = target;
      } else {
        fill.style.width = '0%';
        fill.style.transitionDelay = `${delay}ms`;
        row.style.animationDelay = `${delay}ms`;
        row.classList.add('enter');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fill.style.width = target;
          });
        });
      }
      if (options.ramp && ordered.length <= 6) {
        fill.style.background = `var(--ord-${index})`;
      }
      if (options.activeIndex !== undefined && options.activeIndex !== index) {
        fill.classList.add('muted');
      }
      if (options.activeIndex === index) {
        row.classList.add('active');
      }
      track.append(fill);

      const value = document.createElement('span');
      value.className = 'value';
      value.textContent = (options.format ?? formatCount)(datum.count);

      row.append(label, track, value);

      if (options.share) {
        const share = document.createElement('span');
        share.className = 'share';
        share.textContent = total === 0 ? '—' : `${((datum.count / total) * 100).toFixed(1)}%`;
        row.append(share);
      }

      if (options.detail) {
        row.title = `${datum.label} — ${options.detail(datum, total)}`;
      }
      if (options.onPick) {
        const pick = options.onPick;
        row.addEventListener('click', () => pick(datum, index));
      }
      return row;
    }),
  );
}

export interface LegendOptions {
  readonly onPick?: (index: number) => void;
  readonly activeIndex?: number;
  /** Overrides the value label — a share of money is not a count. */
  readonly format?: (value: number) => string;
}

/**
 * The legend for a donut — swatch, label, value, share.
 *
 * A donut beside a bar list would encode the same numbers twice and squeeze
 * both. The ring carries the proportions; this carries the identities and the
 * exact figures, sharing the ring's ramp so the two read as one chart.
 */
export function renderLegend(
  target: HTMLElement,
  data: readonly BarDatum[],
  options: LegendOptions = {},
): void {
  const total = data.reduce((sum, datum) => sum + datum.count, 0);

  target.replaceChildren(
    ...data.map((datum, index) => {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.setAttribute('role', 'listitem');
      if (!reducedMotion()) {
        row.style.animationDelay = `${stagger(index)}ms`;
        row.classList.add('enter');
      }
      if (options.activeIndex === index) row.classList.add('active');
      if (options.onPick) {
        const pick = options.onPick;
        row.tabIndex = 0;
        row.classList.add('pickable');
        row.addEventListener('click', () => pick(index));
      }

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      // The swatch is the ring's key, so it has to mute with the ring —
      // otherwise the legend still shows colours the chart no longer uses.
      const muted = options.activeIndex !== undefined && options.activeIndex !== index;
      swatch.style.background = muted ? 'var(--de-emphasis)' : `var(--ord-${index})`;

      const label = document.createElement('span');
      label.className = 'l-label';
      label.textContent = datum.label;

      const value = document.createElement('span');
      value.className = 'l-value';
      value.textContent = (options.format ?? formatCount)(datum.count);

      const share = document.createElement('span');
      share.className = 'l-share';
      share.textContent = total === 0 ? '—' : `${((datum.count / total) * 100).toFixed(1)}%`;

      row.append(swatch, label, value, share);
      return row;
    }),
  );
}
