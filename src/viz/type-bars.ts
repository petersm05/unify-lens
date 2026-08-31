import type { ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { objectTypesFor } from '../sdk/metamodel';
import { countsByType, type TypeCount } from '../data/population';
import { watchGraph } from '../data/live';
import { scopeFor, type FilterStore } from '../data/filter';
import { busy } from '../ui/busy';
import { countUp } from '../ui/motion';
import { must } from '../ui/dom';
import { renderBarList } from './bars';
import { formatCompact, formatCount } from './theme';

export interface TypeBars {
  /** Where the filter chips belong: the top of the column that scrolls. */
  readonly filterHost: HTMLElement;
  destroy(): void;
}

/**
 * The population overview: a KPI row over a ranked bar list.
 *
 * The headline numbers are single values, so they are figures rather than
 * one-bar charts. The breakdown is one series, so one hue and no legend.
 */
export function mountTypeBars(
  container: HTMLElement,
  session: Session,
  filters: FilterStore,
  onSelectType: (type: ObjectType) => void,
): TypeBars {
  container.innerHTML = `
    <section class="chart on-plane">
      <div class="kpis">
        <div class="kpi hero">
          <span class="k-label">Objects</span>
          <span class="k-value" data-k="objects">—</span>
          <span class="k-of" data-k="objects-of" hidden></span>
        </div>
        <div class="kpi">
          <span class="k-label" data-k="relations-label">Relations</span>
          <span class="k-value" data-k="relations">—</span>
        </div>
        <div class="kpi">
          <span class="k-label">Types in use</span>
          <span class="k-value" data-k="types">—</span>
        </div>
      </div>

      <div class="card">
        <h2>Population by type</h2>
        <p class="sub" data-k="sub">Tap a type to explore its attributes.</p>
        <div class="rows" role="list"></div>
      </div>

    </section>
  `;

  const rows = must(container.querySelector<HTMLElement>('.rows'), 'type-bars: rows');

  let counts: TypeCount[] = [];
  /**
   * The population before any filter, so a narrowed count can say what it is a
   * part of. Read once and kept: it only moves when the graph does, and asking
   * again on every filter change would cost a fan-out per keystroke.
   */
  let unfiltered: number | null = null;
  /** Guards against a slow population read landing after a newer one. */
  let denominator = 0;

  void refresh();

  // Every view reads the same filter, so a slice chosen in Attributes narrows
  // these counts too.
  const unsubscribe = filters.subscribe(() => void refresh());

  // Any create lands in some bucket, so re-count on the trailing edge of a
  // burst rather than once per event.
  let debounce: number | undefined;
  const live = watchGraph(session.kg, {
    onObjectChanged: () => {
      // The shared sample is now stale — a chart drawn from it would show the
      // population as it was before the change.
      session.sample.clear();
      // The graph moved, so the population did too.
      unfiltered = null;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refresh(), 700);
    },
  });

  async function refresh(): Promise<void> {
    const active = filters.get().attributes;
    const scope = scopeFor(filters.get());

    const [byType, relations] = await busy.track(
      Promise.all([
        countsByType(session.kg, objectTypesFor(session.metaModel), scope),
        session.kg.getRelations({ selector: {} }).getCount(),
      ]),
    );

    counts = byType;
    const objects = counts.reduce((sum, entry) => sum + entry.count, 0);

    // With nothing filtered out, what is on screen is the whole population.
    if (active.length === 0) unfiltered = objects;

    countKpi('objects', objects, formatCompact);
    outOfKpi('objects-of', objects, unfiltered);

    // The population behind a filter is context, not the answer, so it is
    // fetched after the counts are on screen and filled in when it arrives.
    // Awaiting it here would let one extra query hold up the whole KPI row.
    if (active.length > 0 && unfiltered === null) {
      const mine = ++denominator;
      void countsByType(session.kg, objectTypesFor(session.metaModel), undefined)
        .then((whole) => {
          if (mine !== denominator) return;
          unfiltered = whole.reduce((sum, entry) => sum + entry.count, 0);
          outOfKpi('objects-of', objects, unfiltered);
        })
        .catch(() => {
          // Leaves the count standing on its own, which is what it did before.
        });
    }
    countKpi('relations', relations, formatCompact);
    countKpi('types', counts.length, formatCount);

    // The relation count is not narrowed by an object attribute filter, so say
    // so rather than letting it read as part of the filtered slice.
    setKpi('relations-label', active.length > 0 ? 'Relations (all)' : 'Relations');
    setKpi(
      'sub',
      active.length > 0
        ? `Narrowed to ${active.map((s) => s.label).join(' and ')}. Tap a type to explore its attributes.`
        : 'Tap a type to explore its attributes.',
    );

    renderBarList(rows, counts, {
      share: true,
      onPick: (_datum, index) => {
        const picked = counts[index];
        if (picked) onSelectType(picked.type);
      },
      detail: (datum, total) =>
        `${formatCount(datum.count)} objects, ${((datum.count / total) * 100).toFixed(1)}% of population`,
    });
  }

  function setKpi(key: string, value: string): void {
    const node = container.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (node) node.textContent = value;
  }

  /** Says what a narrowed count is a part of; silent when it is the whole. */
  function outOfKpi(key: string, value: number, whole: number | null): void {
    const node = container.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (!node) return;
    const show = whole !== null && whole !== value;
    node.hidden = !show;
    node.textContent = show ? `of ${formatCount(whole)}` : '';
  }

  function countKpi(key: string, value: number, format: (n: number) => string): void {
    const node = container.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (node) countUp(node, value, format);
  }

  return {
    filterHost: must(container.querySelector<HTMLElement>('.chart'), 'type-bars: chart'),

    destroy(): void {
      window.clearTimeout(debounce);
      unsubscribe();
      live.unsubscribe();
      container.replaceChildren();
    },
  };
}
