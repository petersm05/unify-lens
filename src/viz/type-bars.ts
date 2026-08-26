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
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refresh(), 700);
    },
  });

  async function refresh(): Promise<void> {
    const scope = scopeFor(filters.get());

    const [byType, relations] = await busy.track(
      Promise.all([
        countsByType(session.kg, objectTypesFor(session.metaModel), scope),
        session.kg.getRelations({ selector: {} }).getCount(),
      ]),
    );

    counts = byType;
    const objects = counts.reduce((sum, entry) => sum + entry.count, 0);

    countKpi('objects', objects, formatCompact);
    countKpi('relations', relations, formatCompact);
    countKpi('types', counts.length, formatCount);

    const active = filters.get().attributes;
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

  function countKpi(key: string, value: number, format: (n: number) => string): void {
    const node = container.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (node) countUp(node, value, format);
  }

  return {
    destroy(): void {
      window.clearTimeout(debounce);
      unsubscribe();
      live.unsubscribe();
      container.replaceChildren();
    },
  };
}
