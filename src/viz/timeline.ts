import type { Bin } from '../data/attributes';
import { reducedMotion, stagger } from '../ui/motion';
import { formatCount } from '../format';

export interface TimelineOptions {
  readonly onPick?: (index: number) => void;
  readonly activeIndex?: number;
  /**
   * What the column height means. Defaults to the number of objects in the
   * period; a trend passes the measure it aggregated instead.
   */
  readonly value?: (bin: Bin, index: number) => number;
  readonly format?: (value: number) => string;
}

/**
 * Counts per period, as columns.
 *
 * Time runs left to right, which is the one convention no chart should fight —
 * the horizontal bar list used everywhere else would put the earliest period at
 * the top and turn a trend into a ranking.
 */
export function renderTimeline(
  host: HTMLElement,
  bins: readonly Bin[],
  options: TimelineOptions = {},
): void {
  if (bins.length === 0) {
    host.replaceChildren();
    return;
  }

  const valueOf = options.value ?? ((bin: Bin) => bin.count);
  const format = options.format ?? formatCount;
  const values = bins.map((bin, index) => valueOf(bin, index));
  // Columns are drawn from zero, so a negative measure has no honest height
  // here; clamping keeps the axis meaning what it appears to mean.
  const max = Math.max(...values.map((value) => Math.max(value, 0)), 1);
  // Past roughly a dozen columns the labels cannot all be read, so they thin
  // out rather than overlapping or rotating.
  const every = Math.ceil(bins.length / 12);

  host.replaceChildren(
    ...bins.map((bin, index) => {
      const column = document.createElement('button');
      column.type = 'button';
      column.className = 'col';
      column.title = `${bin.label} · ${format(values[index] ?? 0)}`;
      if (options.activeIndex === index) column.classList.add('on');
      if (options.onPick) {
        const pick = options.onPick;
        column.addEventListener('click', () => pick(index));
      } else {
        column.disabled = true;
      }

      const value = document.createElement('span');
      value.className = 'col-value';
      value.textContent = format(values[index] ?? 0);

      const track = document.createElement('span');
      track.className = 'col-track';
      const fill = document.createElement('span');
      fill.className = 'col-fill';
      if (options.activeIndex !== undefined && options.activeIndex !== index) {
        fill.classList.add('muted');
      }

      const height = `${(Math.max(values[index] ?? 0, 0) / max) * 100}%`;
      if (reducedMotion()) {
        fill.style.height = height;
      } else {
        fill.style.height = '0%';
        fill.style.transitionDelay = `${stagger(index, 22)}ms`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fill.style.height = height;
          });
        });
      }
      track.append(fill);

      const label = document.createElement('span');
      label.className = 'col-label';
      label.textContent = index % every === 0 ? bin.label : '';

      column.append(value, track, label);
      return column;
    }),
  );
}
