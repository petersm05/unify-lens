import type { CrossTab } from '../data/attributes';
import { reducedMotion, stagger } from '../ui/motion';
import { formatCount } from '../format';

export interface HeatmapOptions {
  readonly rowLabel: string;
  readonly colLabel: string;
  readonly onPick?: (row: string, col: string) => void;
  readonly active?: { readonly row: string; readonly col: string };
}

/** Ramp steps available for magnitude; step 0 is reserved for "none". */
const STEPS = 6;

/**
 * Counts for two categoricals, as a grid.
 *
 * Sequential, single hue: the cell's *position* already states which two values
 * it belongs to, so colour is free to carry the one thing position cannot —
 * magnitude. Colouring by category instead would spend a palette restating the
 * axes, and this palette has no categorical set to spend.
 */
export function renderHeatmap(host: HTMLElement, table: CrossTab, options: HeatmapOptions): void {
  if (table.rows.length === 0 || table.cols.length === 0) {
    host.replaceChildren();
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'heat';
  grid.style.gridTemplateColumns = `minmax(6rem, auto) repeat(${table.cols.length}, minmax(0, 1fr))`;

  grid.append(corner(options.rowLabel, options.colLabel));
  for (const col of table.cols) grid.append(headCell(col));

  table.rows.forEach((row, r) => {
    grid.append(headCell(row, true));

    table.cols.forEach((col, c) => {
      const count = table.counts[r]?.[c] ?? 0;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'heat-cell';
      cell.title = `${row} · ${col} — ${formatCount(count)}`;

      if (count === 0) {
        cell.classList.add('empty');
      } else {
        // Ramp index by share of the busiest cell, so a grid with one dominant
        // combination still separates the rest.
        const step = Math.min(
          STEPS - 1,
          Math.max(0, Math.round((count / table.max) * (STEPS - 1))),
        );
        cell.style.background = `var(--ord-${step})`;
        // Past the ramp's midpoint the fill is dark enough to need light ink.
        if (step >= 3) cell.classList.add('on-dark');
      }

      if (options.active?.row === row && options.active.col === col) cell.classList.add('active');

      const value = document.createElement('span');
      value.textContent = count === 0 ? '' : formatCount(count);
      cell.append(value);

      if (!reducedMotion()) {
        cell.style.animationDelay = `${stagger(r * table.cols.length + c, 8, 200)}ms`;
        cell.classList.add('enter');
      }

      if (options.onPick && count > 0) {
        const pick = options.onPick;
        cell.addEventListener('click', () => pick(row, col));
      } else {
        cell.disabled = true;
      }

      grid.append(cell);
    });
  });

  host.replaceChildren(grid);
}

function corner(rowLabel: string, colLabel: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'heat-corner';
  cell.textContent = `${rowLabel} ↓ / ${colLabel} →`;
  return cell;
}

function headCell(text: string, row = false): HTMLElement {
  const cell = document.createElement('div');
  cell.className = row ? 'heat-head row' : 'heat-head';
  cell.textContent = text;
  cell.title = text;
  return cell;
}
