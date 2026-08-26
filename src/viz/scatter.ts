import { scaleLinear, scaleLog } from 'd3-scale';
import type { Point } from '../data/attributes';
import { must } from '../ui/dom';
import { ramp } from '../ui/motion';
import { token } from './theme';

export interface ScatterLabels {
  readonly x: string;
  readonly y: string;
  readonly formatX: (value: number) => string;
  readonly formatY: (value: number) => string;
}

export type Quadrant = 'high-high' | 'high-low' | 'low-high' | 'low-low';

export interface QuadrantOptions {
  /** Where each axis is split. */
  readonly x: number;
  readonly y: number;
  readonly onPick?: (quadrant: Quadrant) => void;
  readonly active?: Quadrant;
}

export interface HighlightOptions {
  /** The attribute being highlighted by, for the legend heading. */
  readonly label: string;
  readonly values: readonly string[];
  readonly active?: string;
  readonly onPick: (value: string | undefined) => void;
}

export interface ScatterOptions {
  readonly quadrant?: QuadrantOptions;
  /**
   * Paints one category in the accent and recedes the rest.
   *
   * Not a multi-hue categorical encoding: a scatter is an all-pairs form, where
   * every category must be distinguishable from every other, and this palette's
   * hues are too close and too muted to survive that test — the validator fails
   * every three-hue combination drawn from it. One hue plus the de-emphasis grey
   * always passes, and it answers the actual question ("where do the SaaS ones
   * sit?") for any number of categories rather than the three a palette allows.
   */
  readonly highlight?: HighlightOptions;
  /** Tapping a mark opens that object rather than selecting a region. */
  readonly onPickPoint?: (point: Point) => void;
  /** Legend line for the bubble-area encoding, when one is in use. */
  readonly sizeLabel?: string;
  readonly formatSize?: (value: number) => string;
}

/**
 * `left` is a floor only: the real value is measured per render from the widest
 * tick label, because a fixed gutter cannot know whether an axis reads "10" or
 * "€ 100,0K". `top` leaves room for the y-axis title, which sits horizontally
 * above the plot rather than rotated beside it.
 */
const PADDING = { top: 40, right: 24, bottom: 46, left: 52 };
/** ≥8px across so the mark stays a target, not a speck. */
const DOT_RADIUS = 5;
const MIN_BUBBLE = 4;
const MAX_BUBBLE = 17;

/**
 * Two measures across the same objects.
 *
 * Drawn on canvas because a few thousand marks in SVG stops being interactive
 * on a tablet. One series, so one hue — colouring by a third field is possible
 * but caps at three categories in an all-pairs form like this, so it is left
 * out rather than offered and then quietly failing colour-vision separation.
 */
export function renderScatter(
  host: HTMLElement,
  points: readonly Point[],
  labels: ScatterLabels,
  options: ScatterOptions = {},
): () => void {
  host.replaceChildren();

  const canvas = document.createElement('canvas');
  canvas.className = 'scatter-canvas';
  host.append(canvas);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  host.append(tip);

  const context = must(canvas.getContext('2d'), 'scatter: 2d context');

  let width = 0;
  let height = 0;
  let placed: Array<{ point: Point; cx: number; cy: number; r: number }> = [];
  /** Left gutter for the current render; see PADDING. */
  let padLeft = PADDING.left;
  let split: { x: number; y: number } | null = null;
  /** 0→1 entrance progress; marks grow and fade in as it advances. */
  let entrance = 0;

  const resize = new ResizeObserver(() => draw());
  resize.observe(host);

  const cancelEntrance = ramp(560, (progress) => {
    entrance = progress;
    draw();
  });

  function draw(): void {
    width = host.clientWidth;
    height = host.clientHeight;
    if (width === 0 || height === 0) return;

    const ratio = globalThis.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    if (points.length === 0) return;

    const xValues = points.map((point) => point.x);
    const yValues = points.map((point) => point.y);
    const xLog = shouldUseLog(xValues);
    const yLog = shouldUseLog(yValues);

    // Tick *values* depend only on the domain, so they can be measured before
    // the range is fixed — which is what makes the gutter computable.
    const yScale = axis(yValues, yLog);
    context.font = '11px -apple-system, system-ui, sans-serif';
    const widest = ticksFor(yScale, yLog, 5).reduce(
      (max, tick) => Math.max(max, context.measureText(labels.formatY(tick)).width),
      0,
    );
    padLeft = Math.max(PADDING.left, Math.ceil(widest + 18));

    const x = axis(xValues, xLog).range([padLeft, width - PADDING.right]);
    const y = yScale.range([height - PADDING.bottom, PADDING.top]);

    // Quadrant chrome sits under the grid: it is background, not data.
    if (options.quadrant) {
      split = { x: x(options.quadrant.x), y: y(options.quadrant.y) };
      paintQuadrants(split);
    } else {
      split = null;
    }

    // Recessive grid first, so marks sit above it.
    context.strokeStyle = token('--border');
    context.lineWidth = 1;
    context.fillStyle = token('--text-muted');
    context.font = '11px -apple-system, system-ui, sans-serif';

    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (const tick of ticksFor(y, yLog, 5)) {
      const py = Math.round(y(tick)) + 0.5;
      context.beginPath();
      context.moveTo(PADDING.left, py);
      context.lineTo(width - PADDING.right, py);
      context.stroke();
      context.fillText(labels.formatY(tick), PADDING.left - 10, py);
    }

    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (const tick of ticksFor(x, xLog, 6)) {
      const px = Math.round(x(tick)) + 0.5;
      context.fillText(labels.formatX(tick), px, height - PADDING.bottom + 10);
    }

    // Axis titles. A log axis is always named as one: an unannounced log scale
    // makes a long tail look linear and understates every large value.
    context.fillStyle = token('--text-secondary');
    context.font = '12px -apple-system, system-ui, sans-serif';
    context.fillText(
      xLog ? `${labels.x} (log scale)` : labels.x,
      (padLeft + width - PADDING.right) / 2,
      height - 16,
    );
    // The y-axis title sits horizontally above the plot, not rotated down the
    // side. Rotated, it shares a narrow gutter with the tick labels and any
    // change to their width — a currency prefix, a longer magnitude — puts the
    // two on top of each other. Above the axis it cannot collide at all, and it
    // reads without tilting your head.
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(yLog ? `${labels.y} (log scale)` : labels.y, padLeft - widest - 8, PADDING.top - 16);

    // Bubble **area** carries the third measure — scaling the radius linearly
    // would overstate a large value by the square.
    const sizes = points.map((point) => point.size ?? 0);
    const maxSize = Math.max(...sizes, 0);
    const radiusOf = (point: Point): number => {
      if (point.size === undefined || maxSize <= 0) return DOT_RADIUS;
      return MIN_BUBBLE + (MAX_BUBBLE - MIN_BUBBLE) * Math.sqrt(point.size / maxSize);
    };

    // Scores are small integers, so hundreds of objects land on a lattice of a
    // few dozen positions and hide each other entirely. A deterministic jitter
    // of well under one unit separates them without moving anything across a
    // gridline or a quadrant boundary.
    // Measured from the domain's own start so a log axis never asks for x(0).
    const unitX = spacing(x, xValues);
    const unitY = spacing(y, yValues);
    const jitter = (seed: string, spread: number): number =>
      spread === 0 ? 0 : ((hash(seed) % 1000) / 1000 - 0.5) * spread;

    placed = points.map((point) => ({
      point,
      cx: x(point.x) + jitter(point.name, Math.min(unitX * 0.55, 18)),
      cy: y(point.y) + jitter(`${point.name}~`, Math.min(unitY * 0.55, 18)),
      r: radiusOf(point),
    }));

    const fill = token('--series-1');
    const dim = token('--de-emphasis');
    const active = options.highlight?.active;
    const surface = token('--surface-1');
    for (const { point, cx, cy, r } of placed) {
      // Marks grow from a point rather than fading a full-size dot in, so a
      // dense cluster resolves instead of flashing.
      const radius = r * (0.35 + 0.65 * entrance);
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      const lit = active === undefined || point.group === active;
      context.fillStyle = lit ? fill : dim;
      context.globalAlpha = (lit ? 0.75 : 0.5) * entrance;
      context.fill();
      context.globalAlpha = 1;
      // A 2px surface ring keeps overlapping marks readable as separate points.
      context.lineWidth = 1.5;
      context.strokeStyle = surface;
      context.globalAlpha = entrance;
      context.stroke();
      context.globalAlpha = 1;
    }
  }

  /**
   * The dividing lines, a wash on the selected region, and a corner label each.
   *
   * Deliberately not four coloured point sets: position already states which
   * quadrant an object is in, so colouring the marks too would spend the
   * categorical palette restating the geometry.
   */
  function paintQuadrants(at: { x: number; y: number }): void {
    const left = padLeft;
    const right = width - PADDING.right;
    const top = PADDING.top;
    const bottom = height - PADDING.bottom;

    const regions: Array<{ id: Quadrant; x: number; y: number; w: number; h: number }> = [
      { id: 'low-high', x: left, y: top, w: at.x - left, h: at.y - top },
      { id: 'high-high', x: at.x, y: top, w: right - at.x, h: at.y - top },
      { id: 'low-low', x: left, y: at.y, w: at.x - left, h: bottom - at.y },
      { id: 'high-low', x: at.x, y: at.y, w: right - at.x, h: bottom - at.y },
    ];

    const active = options.quadrant?.active;
    for (const region of regions) {
      if (region.w <= 0 || region.h <= 0) continue;
      context.fillStyle = region.id === active ? token('--series-1-soft') : token('--surface-2');
      context.globalAlpha = region.id === active ? 0.55 : 0.4;
      context.fillRect(region.x, region.y, region.w, region.h);
    }
    context.globalAlpha = 1;

    // Dividing lines, dashed so they never read as data.
    context.save();
    context.setLineDash([7, 5]);
    context.strokeStyle = token('--text-muted');
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(Math.round(at.x) + 0.5, top);
    context.lineTo(Math.round(at.x) + 0.5, bottom);
    context.moveTo(left, Math.round(at.y) + 0.5);
    context.lineTo(right, Math.round(at.y) + 0.5);
    context.stroke();
    context.restore();

    // No corner labels: the axis titles and ticks already say which quadrant
    // is which, so anything written in the corners is restating the geometry.
    // The count for a selected quadrant belongs in the figures above the chart,
    // where it is read once rather than four times.
  }

  function onMove(event: PointerEvent): void {
    const bounds = canvas.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;

    let closest: { point: Point; cx: number; cy: number; r: number } | null = null;
    let best = Infinity;
    for (const candidate of placed) {
      const distance = Math.hypot(candidate.cx - px, candidate.cy - py);
      // Hit target larger than the mark.
      if (distance < best && distance <= candidate.r + 8) {
        best = distance;
        closest = candidate;
      }
    }

    if (!closest) {
      tip.hidden = true;
      return;
    }

    tip.innerHTML = '';
    const name = document.createElement('strong');
    name.textContent = closest.point.name;
    const detail = document.createElement('em');
    const size =
      closest.point.size !== undefined && options.sizeLabel
        ? ` · ${options.sizeLabel}: ${(options.formatSize ?? String)(closest.point.size)}`
        : '';
    detail.textContent = `${labels.x}: ${labels.formatX(closest.point.x)} · ${labels.y}: ${labels.formatY(closest.point.y)}${size}`;
    tip.append(name, detail);
    tip.hidden = false;
    tip.style.left = `${Math.min(closest.cx + 14, width - 260)}px`;
    tip.style.top = `${Math.max(closest.cy - 10, 8)}px`;
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onMove);
  canvas.addEventListener('pointerleave', () => (tip.hidden = true));

  /** Tapping empty space inside a quadrant selects that quadrant. */
  canvas.addEventListener('click', (event) => {
    const pick = options.quadrant?.onPick;
    if (!pick && !options.onPickPoint) return;

    const bounds = canvas.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;

    // A tap on a mark is about that object, not its quadrant.
    const onMark = placed.find(
      (candidate) => Math.hypot(candidate.cx - px, candidate.cy - py) <= candidate.r + 8,
    );
    if (onMark) {
      options.onPickPoint?.(onMark.point);
      return;
    }
    if (!pick || !split) return;
    if (px < padLeft || px > width - PADDING.right) return;
    if (py < PADDING.top || py > height - PADDING.bottom) return;

    const high = px >= split.x;
    const top = py <= split.y;
    pick(high ? (top ? 'high-high' : 'high-low') : top ? 'low-high' : 'low-low');
  });

  return () => {
    cancelEntrance();
    resize.disconnect();
    host.replaceChildren();
  };
}

/** Stable per-name offset, so a point does not move between renders. */
function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

function extent(values: readonly number[]): [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

/**
 * Whether an axis should be logarithmic.
 *
 * Decided by where the median lands rather than by a skew ratio, because that
 * is the thing that actually goes wrong: on a long-tailed measure a linear axis
 * pushes the median against an edge, and a quadrant split there produces three
 * empty slivers instead of four comparable regions.
 *
 * So: if the median sits outside the middle of a linear axis, and a log axis
 * would bring it closer to centre, use log. Needs strictly positive values —
 * log has nothing to say about zero.
 */
function shouldUseLog(values: readonly number[]): boolean {
  const [min, max] = extent(values);
  if (min <= 0 || max <= min || values.length < 8) return false;

  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? min;

  const linearAt = (median - min) / (max - min);
  if (Math.abs(linearAt - 0.5) <= 0.2) return false;

  const logAt = (Math.log(median) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.abs(logAt - 0.5) < Math.abs(linearAt - 0.5);
}

function axis(values: readonly number[], log: boolean) {
  const [min, max] = extent(values);
  return log
    ? scaleLog().domain([Math.max(min, 1e-6), max])
    : scaleLinear().domain([min, max]).nice();
}

/**
 * Tick values for an axis.
 *
 * A log scale spanning only a few decades hands back every minor tick — 300,
 * 400, 500 … 900, 1.000 — which is a wall of numbers, not an axis. Decades
 * alone are usually right; where that leaves too few, the 1/2/5 steps come back
 * in before falling back to everything.
 */
function ticksFor(
  scale: { ticks: (count?: number) => number[] },
  log: boolean,
  count: number,
): number[] {
  const all = scale.ticks(count);
  if (!log) return all;

  const mantissa = (value: number): number => value / 10 ** Math.floor(Math.log10(value));
  const decades = all.filter((value) => Math.abs(mantissa(value) - 1) < 0.001);
  if (decades.length >= 3) return decades;

  const oneTwoFive = all.filter((value) => {
    const m = Math.round(mantissa(value));
    return m === 1 || m === 2 || m === 5;
  });
  return oneTwoFive.length >= 3 ? oneTwoFive : all;
}

/** Screen distance for one step at the low end of the domain. */
function spacing(scale: (value: number) => number, values: readonly number[]): number {
  const [min] = extent(values);
  const step = Math.abs(scale(min + 1) - scale(min));
  return Number.isFinite(step) ? step : 0;
}
