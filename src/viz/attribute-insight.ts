import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { labelFor, objectTypesFor } from '../sdk/metamodel';
import {
  coverage,
  crossTab,
  type Grain,
  enumCondition,
  equalsCondition,
  dateDistribution,
  valueFrequency,
  type Coverage,
  type Distribution,
  enumDistribution,
  isPlottable,
  numericDistribution,
  quantiles,
  rank,
  SAMPLE_LIMIT,
  scatterPoints,
  statsByCategory,
  thresholdCondition,
  sumOf,
  type AttributeChoice,
  type Bin,
  type RankedObject,
} from '../data/attributes';
import { attributesForCached } from '../data/schema-cache';
import { compatible, levelOf, marksFor, type Mark } from '../data/chart-spec';
import { scopeExcluding, scopeFor, selectionFor, type FilterStore } from '../data/filter';
import { busy } from '../ui/busy';
import { countUp } from '../ui/motion';
import { must } from '../ui/dom';
import { attributeIcon, controlsIcon, filterIcon } from '../ui/icons';
import { createPicker, type Picker } from '../ui/picker';
import { renderBarList, renderLegend } from './bars';
import { mountObjectTable, type ObjectTable } from './object-table';
import { renderDonut } from './donut';
import { renderScatter, type Quadrant } from './scatter';
import { renderTimeline } from './timeline';
import { renderHeatmap } from './heatmap';
import { formatCompact, formatCount, formatMoney } from './theme';

export interface AttributeSnapshot {
  readonly type?: ObjectType;
  readonly primary?: string;
  readonly secondary?: string;
  readonly mark?: Mark;
  readonly size?: string;
  readonly group?: string;
  readonly active?: string;
}

export interface AttributeInsight {
  /** What is on screen, as keys rather than object references. */
  snapshot(): AttributeSnapshot;
  /** Puts a described chart back on screen; resolves once it is drawn. */
  restore(snapshot: AttributeSnapshot): Promise<void>;
  /**
   * Charts one attribute, switching object type first if needed.
   *
   * With nothing charted it becomes the subject; with a compatible chart
   * already up it becomes the comparison, which is what "compare this too"
   * means from a record.
   */
  chart(objectType: string, categoryId: string, definitionId: string): void;
  destroy(): void;
}

export function mountAttributeInsight(
  container: HTMLElement,
  session: Session,
  filters: FilterStore,
  openDetail: (id: UUID) => void,
  onStateChange: () => void = () => undefined,
  notify: (message: string) => void = () => undefined,
): AttributeInsight {
  const types = objectTypesFor(session.metaModel);

  container.innerHTML = `
    <section class="split">
      <aside class="rail">
        <label class="field">
          <span>Object type</span>
          <div class="type-select"></div>
        </label>
        <div class="attr-list" role="list" aria-label="Attributes"></div>
      </aside>

      <div class="detail">
        <div class="insight" hidden>
          <div class="kpis">
            <div class="kpi hero">
              <span class="k-label" data-k="headline-label">Objects</span>
              <span class="k-value" data-k="headline">—</span>
            </div>
            <div class="kpi">
              <span class="k-label" data-k="second-label">Values</span>
              <span class="k-value" data-k="second">—</span>
            </div>
          </div>

          <div class="card chart-card">
            <div class="card-head">
              <div class="card-title">
                <h2 data-k="title">—</h2>
                <p class="sub" data-k="subtitle"></p>
              </div>
              <div class="chart-menu">
                <button type="button" class="menu-btn" aria-expanded="false" aria-haspopup="dialog">
                  <span class="menu-current"></span>
                </button>
                <div class="menu-panel" hidden role="dialog" aria-label="Chart options">
                  <div class="menu-group">
                    <span class="menu-label">Chart type</span>
                    <div class="marks" role="group" aria-label="Chart type"></div>
                  </div>
                  <label class="field">
                    <span>Compare with</span>
                    <div class="compare-select"></div>
                  </label>
                  <label class="field size-field" hidden>
                    <span>Bubble size</span>
                    <div class="size-select"></div>
                  </label>
                  <label class="field group-field" hidden>
                    <span>Highlight by</span>
                    <div class="group-select"></div>
                  </label>
                  <label class="field grain-field" hidden>
                    <span>Period</span>
                    <select class="grain-select">
                      <option value="">Fit to the span</option>
                      <option value="month">Month</option>
                      <option value="quarter">Quarter</option>
                      <option value="year">Year</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div class="meter-block">
              <div class="meter-head"><span>Coverage</span><span data-k="cov-value">—</span></div>
              <div class="meter"><span class="meter-fill"></span></div>
              <p class="meter-foot" data-k="cov-foot"></p>
            </div>

            <div class="plot" hidden></div>
            <div class="highlight-legend" hidden role="group"></div>

            <div class="timeline" hidden></div>
            <div class="heatmap" hidden></div>

            <div class="with-donut">
              <div class="donut" hidden></div>
              <div class="rows" role="list"></div>
            </div>

            <div class="stats" hidden>
              <div class="stat"><span class="s-label">Lowest</span><span class="s-value" data-k="st-min">—</span></div>
              <div class="stat"><span class="s-label">Median</span><span class="s-value" data-k="st-median">—</span></div>
              <div class="stat"><span class="s-label">90th pct</span><span class="s-value" data-k="st-p90">—</span></div>
              <div class="stat"><span class="s-label">Highest</span><span class="s-value" data-k="st-max">—</span></div>
            </div>
          </div>

          <section class="card top" hidden>
            <h2>Highest values</h2>
            <p class="sub"></p>
            <div class="rows top-rows" role="list"></div>
          </section>


          <div class="objects-host card"></div>
        </div>

        <p class="placeholder">Pick an attribute to chart it.</p>
      </div>
    </section>
  `;

  const q = <T extends HTMLElement>(selector: string, what: string): T =>
    must(container.querySelector<T>(selector), `attributes: ${what}`);

  const select = mountPicker('.type-select', 'type select');
  const compare = mountPicker('.compare-select', 'compare select', 'Nothing — one measure');
  const sizeSelect = mountPicker('.size-select', 'size select', 'Uniform');
  const sizeField = q('.size-field', 'size field');
  const groupSelect = mountPicker('.group-select', 'group select', 'Nothing');
  const groupField = q('.group-field', 'group field');
  const grainSelect = q<HTMLSelectElement>('.grain-select', 'grain select');
  const grainField = q('.grain-field', 'grain field');
  const legendHost = q('.highlight-legend', 'highlight legend');
  const markBar = q('.marks', 'marks');
  const menuButton = q<HTMLButtonElement>('.menu-btn', 'menu button');
  const menuPanel = q('.menu-panel', 'menu panel');
  const menuCurrent = q('.menu-current', 'menu label');
  menuButton.prepend(controlsIcon());
  const rail = q('.attr-list', 'list');
  const insight = q('.insight', 'insight');
  const placeholder = q('.placeholder', 'placeholder');
  const plot = q('.plot', 'plot');
  const donutHost = q('.donut', 'donut');
  const timelineHost = q('.timeline', 'timeline');
  const heatHost = q('.heatmap', 'heatmap');
  const withDonut = q('.with-donut', 'chart body');
  const rows = q('.rows', 'rows');
  const topSection = q('.top', 'top');
  const topRows = q('.top-rows', 'top rows');
  const statsRow = q('.stats', 'stats');
  const meterBlock = q('.meter-block', 'meter block');
  const meterFill = q('.meter-fill', 'meter');
  const objectsHost = q('.objects-host', 'objects host');

  select.setOptions(types.map((entry) => ({ value: entry, label: labelFor(entry) })));

  let type: ObjectType = filters.get().type ?? types[0]!;
  select.setValue(type);

  let choices: AttributeChoice[] = [];
  let primary: AttributeChoice | null = null;
  let secondary: AttributeChoice | null = null;
  let mark: Mark | null = null;
  /** null = auto, '' = explicitly none, otherwise an attribute key. */
  let sizeKey: string | null = null;
  /** '' = no highlight; otherwise an attribute key. */
  let groupKey = '';
  let activeGroup: string | undefined;
  /** '' = choose from the span; otherwise a fixed period. */
  let grain: '' | Grain = '';
  let generation = 0;
  let teardownPlot: (() => void) | null = null;
  let objectTable: ObjectTable | null = null;
  /**
   * The last distribution, keyed by everything that could change it.
   *
   * Donut and Bars are two renderings of one query, so switching between them
   * must not go back to the server — a mark switch that pauses reads as the app
   * thinking rather than responding.
   */
  let cache: { key: string; distribution: Distribution; cover: Coverage } | null = null;

  select.onChange((value) => {
    type = value as ObjectType;
    // The filter bar's type chip has to follow the rail, or the two disagree
    // about what population is on screen.
    filters.setType(type);
    void loadAttributes().catch(fail);
  });

  compare.onChange((value) => {
    secondary = choices.find((choice) => keyOf(choice) === value) ?? null;
    mark = null;
    sizeKey = null;
    if (primary) void render().catch(fail);
  });

  sizeSelect.onChange((value) => {
    sizeKey = value;
    if (primary) void render().catch(fail);
  });

  grainSelect.addEventListener('change', () => {
    grain = grainSelect.value as '' | Grain;
    if (primary) void render().catch(fail);
  });

  groupSelect.onChange((value) => {
    groupKey = value;
    activeGroup = undefined;
    if (primary) void render().catch(fail);
  });

  // ── options menu ──────────────────────────────────────────────────
  const setMenu = (open: boolean): void => {
    menuPanel.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
  };

  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenu(menuPanel.hidden);
  });
  menuPanel.addEventListener('click', (event) => event.stopPropagation());
  const onAway = (): void => setMenu(false);
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') setMenu(false);
  };
  document.addEventListener('click', onAway);
  document.addEventListener('keydown', onEscape);

  void loadAttributes().catch(fail);

  const unsubscribe = filters.subscribe((filter) => {
    if (filter.type && filter.type !== type) {
      type = filter.type;
      select.setValue(type);
      void loadAttributes().catch(fail);
      return;
    }
    if (primary) void render().catch(fail);
  });

  async function loadAttributes(): Promise<void> {
    const mine = ++generation;
    insight.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = 'Reading the attribute schema…';
    rail.replaceChildren();
    primary = null;
    secondary = null;
    mark = null;

    // Assign only after the staleness check. Writing `choices` first meant a
    // superseded load — a type switched away from before it finished — still
    // overwrote the shared state, leaving the winning load's rail on screen
    // beside another type's attributes in every derived control.
    // Served from the device when it can be, so the rail appears immediately
    // rather than after a round trip. A revalidation that disagrees reloads the
    // view, which is rare enough to be worth the interruption and correct.
    const loaded = await busy.track(
      attributesForCached(session.kg, type, session.stamp, (changed) => {
        if (mine !== generation || changed.length === 0) return;
        void loadAttributes().catch(fail);
      }),
    );
    if (mine !== generation) return;
    choices = loaded;

    // Anything filtering on an attribute this type does not have can never
    // match, so it would show an empty view rather than a filtered one.
    const available = new Set(choices.map((choice) => keyOf(choice)));
    const dropped = filters.prune((choice) =>
      available.has(`${choice.categoryId}.${choice.definitionId}`),
    );
    if (dropped.length > 0) {
      notify(
        `${dropped.length === 1 ? 'Dropped a filter' : `Dropped ${dropped.length} filters`} that ${labelFor(type)} has no attribute for: ${dropped.join(', ')}.`,
      );
    }

    if (choices.length === 0) {
      placeholder.textContent = `${labelFor(type)} has no attribute categories defined.`;
      return;
    }

    placeholder.textContent = 'Pick an attribute to chart it.';

    // Grouped by category with a sticky heading: the category was previously
    // repeated on all forty-odd rows, which is a lot of ink to say the same
    // thing and leaves nothing to scan by.
    const groups = new Map<string, AttributeChoice[]>();
    for (const choice of choices) {
      const bucket = groups.get(choice.categoryName) ?? [];
      bucket.push(choice);
      groups.set(choice.categoryName, bucket);
    }

    rail.replaceChildren(
      ...[...groups].flatMap(([category, members]) => {
        const heading = document.createElement('h3');
        heading.className = 'rail-head';
        heading.textContent = category;

        return [
          heading,
          ...members.map((choice) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'attr';
            item.setAttribute('role', 'listitem');
            item.disabled = !isPlottable(choice);
            item.title = `${choice.name} · ${choice.kind}`;

            const name = document.createElement('span');
            name.className = 'a-name';
            name.textContent = choice.name;

            item.append(attributeIcon(choice.kind, choice.currency), name);

            if (!item.disabled) {
              item.addEventListener('click', () => {
                rail.querySelectorAll('.attr').forEach((other) => other.classList.remove('on'));
                item.classList.add('on');
                primary = choice;
                secondary = null;
                mark = null;
                void render().catch(fail);
              });
            }
            return item;
          }),
        ];
      }),
    );
  }

  /**
   * Rebuilds the compare list and the mark controls, then draws.
   *
   * The user never picks a chart type from a gallery: the fields decide which
   * marks are meaningful, the first is chosen for them, and only the valid
   * alternates are offered as a switch.
   */
  async function render(): Promise<void> {
    if (!primary) return;
    const mine = ++generation;

    const pairs = compatible(primary, choices);
    compare.setOptions([
      { value: '', label: 'Nothing — one measure' },
      ...pairs.map((choice) => ({
        value: keyOf(choice),
        label: choice.name,
        note: choice.categoryName,
        icon: () => attributeIcon(choice.kind, choice.currency),
      })),
    ]);
    compare.setValue(secondary ? keyOf(secondary) : '');
    compare.setDisabled(pairs.length === 0);

    const options = marksFor(primary, secondary ?? undefined);
    if (!mark || !options.some((entry) => entry.mark === mark)) {
      mark = options[0]?.mark ?? null;
    }

    markBar.replaceChildren(
      ...options.map((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mark';
        button.textContent = entry.label;
        button.title = entry.hint;
        button.setAttribute('aria-pressed', String(entry.mark === mark));
        button.addEventListener('click', () => {
          mark = entry.mark;
          void render().catch(fail);
        });
        return button;
      }),
    );
    // Inside the menu the switcher always shows, even for a single option —
    // it is what tells you which chart you are looking at.
    markBar.hidden = false;
    menuCurrent.textContent = options.find((entry) => entry.mark === mark)?.label ?? 'Chart';

    // Bubble size is only meaningful on a point plot.
    const plots = mark === 'scatter' || mark === 'quadrant';
    sizeField.hidden = !plots;
    groupField.hidden = !plots;
    // Only a timeline has periods to choose between.
    grainField.hidden = mark !== 'timeline';
    grainSelect.value = grain;
    if (plots && primary && secondary) {
      buildSizeOptions(primary, secondary);
      buildGroupOptions();
    }
    if (!plots) legendHost.hidden = true;

    // Only blank the pane when there is nothing to keep. Once a chart is on
    // screen it stays, dimmed, while the next one is computed — replacing it
    // with the word "Computing…" loses the reader's place on every change.
    if (insight.hidden) {
      placeholder.hidden = false;
      placeholder.textContent = 'Computing…';
    }
    insight.classList.add('busy');

    const field = primary;
    const pair = secondary;
    try {
      // With a pair selected, both 'sum-by' and 'donut' describe the grouped
      // measure — routing 'donut' to the single-field renderer would silently
      // chart object counts instead of the totals.
      const grouped = pair !== null && (mark === 'sum-by' || mark === 'donut');
      const crossed = pair !== null && mark === 'heatmap';

      await busy.track(
        (mark === 'scatter' || mark === 'quadrant') && pair
          ? drawScatter(field, pair, mine)
          : crossed && pair
            ? drawCrossTab(field, pair, mine)
            : grouped && pair
              ? drawSumBy(field, pair, mine)
              : drawDistribution(field, mine),
      );
    } finally {
      if (mine === generation) {
        insight.classList.remove('busy');
        onStateChange();
      }
    }
  }

  // ── one field: bars / histogram / donut ────────────────────────────

  async function drawDistribution(choice: AttributeChoice, mine: number): Promise<void> {
    const self = selectionFor(filters.get(), choice);

    // The distribution keeps every bar when a selection is on its own attribute
    // — the selected one is emphasised instead — while still honouring
    // selections on other attributes. Everything around it reports the full
    // filtered slice, this attribute's own selection included.
    const scopeChart = scopeFor(filters.get(), choice);
    const scopeSlice = scopeFor(filters.get());

    const key = JSON.stringify([
      type,
      choice.categoryId,
      choice.definitionId,
      scopeChart ?? null,
      choice.kind === 'date' ? grain : '',
    ]);

    if (cache?.key !== key) {
      // The attribute's declared type picks how it is counted, exactly as it
      // picks how it is drawn.
      const [fetched, cover] = await Promise.all([
        choice.kind === 'enum' || choice.kind === 'boolean'
          ? enumDistribution(session.kg, session.sample, type, choice, scopeChart)
          : choice.kind === 'date'
            ? dateDistribution(session.sample, type, choice, scopeChart, grain || undefined)
            : choice.kind === 'string' || choice.kind === 'text'
              ? valueFrequency(session.sample, type, choice, scopeChart)
              : numericDistribution(session.kg, session.sample, type, choice, scopeChart),
        coverage(session.kg, session.sample, type, choice, scopeChart),
      ]);
      if (mine !== generation) return;
      cache = { key, distribution: fetched, cover };
    }

    const { distribution, cover } = cache;

    const range = self ? distribution.bins.find((b) => b.label === self.binLabel)?.range : undefined;
    const inSlice: readonly RankedObject[] | undefined =
      range && distribution.observations
        ? distribution.observations.filter((o) => o.value >= range.from && o.value <= range.to)
        : undefined;

    const top = inSlice ? rank(inSlice) : (distribution.top ?? []);
    const stats = inSlice ? quantiles(inSlice.map((o) => o.value)) : distribution.stats;
    const counted = inSlice
      ? inSlice.length
      : self
        ? (distribution.bins.find((bin) => bin.label === self.binLabel)?.count ?? 0)
        : distribution.total;
    const total =
      distribution.sum === undefined
        ? undefined
        : self
          ? await sumOf(session.kg, type, choice, scopeSlice)
          : distribution.sum;
    if (mine !== generation) return;

    reveal();
    plot.hidden = true;
    meterBlock.hidden = false;
    heatHost.hidden = true;
    timelineHost.hidden = true;

    const money = (value: number): string =>
      choice.kind === 'money' ? formatMoney(value, choice.currency) : formatCompact(value);

    set('title', `${choice.name} across ${labelFor(type)}`);

    // A sum only means something for an additive measure. Money is additive;
    // a rating or a score is not — "Total Business Fit Score = 382" is
    // arithmetic without a referent, so those lead with the count instead.
    const additive = choice.kind === 'money';

    if (total !== undefined && additive) {
      kpi(
        self ? `Total in ${self.binLabel}` : `Total ${choice.name}`,
        { value: total, format: (n) => formatMoney(n, choice.currency) },
        distribution.truncated ? 'Objects sampled' : 'Objects with a value',
        { value: counted, format: formatCount },
      );
    } else if (stats) {
      kpi(
        self ? `Objects in ${self.binLabel}` : 'Objects with a value',
        { value: counted, format: formatCompact },
        'Median',
        { value: stats.median, format: formatCompact },
      );
    } else {
      kpi(
        self ? `Objects in ${self.binLabel}` : 'Objects',
        { value: counted, format: formatCompact },
        'Distinct values',
        { value: distribution.bins.length, format: formatCount },
      );
    }

    drawCoverage(cover, choice);

    const distinct = 'distinct' in distribution ? (distribution as { distinct: number }).distinct : 0;

    const shape =
      choice.kind === 'enum' || choice.kind === 'boolean'
        ? 'values in the order the metamodel defines them'
        : choice.kind === 'date'
          ? `${formatCount(distribution.bins.length)} periods, oldest first`
          : mark === 'frequency'
            ? `the ${formatCount(distribution.bins.length)} most common of ${formatCount(distinct)} distinct values`
            : distribution.truncated
          ? `based on the first ${formatCount(SAMPLE_LIMIT)} objects`
          : 'covering every object with a value';
    set(
      'subtitle',
      self
        ? `${choice.categoryName} · the full distribution is kept for context; the figures above describe ${self.binLabel}. Tap the highlighted bar to clear it.`
        : `${choice.categoryName} · ${shape}.`,
    );

    if (stats) {
      statsRow.hidden = false;
      set('st-min', money(stats.min));
      set('st-median', money(stats.median));
      set('st-p90', money(stats.p90));
      set('st-max', money(stats.max));
    } else {
      statsRow.hidden = true;
    }

    if (top.length > 0) {
      topSection.hidden = false;
      renderTop(top, inSlice ?? distribution.observations ?? [], choice, money, distribution.truncated);
    } else {
      topSection.hidden = true;
    }

    if (mark === 'donut') {
      // "Not set" is the absence of a value, not one of the values, so it is
      // left out of the ring rather than pushing the slice count over the cap.
      // The coverage meter above already accounts for it.
      const slices = distribution.bins.filter((bin) => bin.label !== 'Not set');
      const withValue = slices.reduce((sum, bin) => sum + bin.count, 0);

      donutHost.hidden = false;
      withDonut.classList.add('has-donut');
      teardownPlot?.();

      // Indices address `slices`, which excludes "Not set" — picking by the
      // full bin list here would select the wrong value.
      const activeSlice = self ? slices.findIndex((bin) => bin.label === self.binLabel) : -1;

      const chosenSlice = activeSlice >= 0 ? slices[activeSlice] : undefined;

      teardownPlot = renderDonut(donutHost, slices, {
        ...(chosenSlice
          ? { centreValue: chosenSlice.count, caption: chosenSlice.label }
          : {}),
        ...(activeSlice >= 0 ? { activeIndex: activeSlice } : {}),
        onPick: (index) => pick(choice, slices[index], self?.binLabel),
      });
      renderLegend(rows, slices, {
        ...(activeSlice >= 0 ? { activeIndex: activeSlice } : {}),
        onPick: (index) => pick(choice, slices[index], self?.binLabel),
      });
      syncObjectTable(choice);
      set(
        'subtitle',
        `${choice.categoryName} · share of the ${formatCount(withValue)} objects that carry a value, in the order the metamodel defines them.`,
      );
      return;
    }

    donutHost.hidden = true;
    withDonut.classList.remove('has-donut');
    teardownPlot?.();
    teardownPlot = null;

    const activeIndex = self ? distribution.bins.findIndex((b) => b.label === self.binLabel) : -1;
    // Time reads left to right, so periods get columns rather than rows.
    if (mark === 'timeline') {
      timelineHost.hidden = false;
      rows.replaceChildren();
      renderTimeline(timelineHost, distribution.bins, {
        ...(activeIndex >= 0 ? { activeIndex } : {}),
        onPick: (index) => pick(choice, distribution.bins[index], self?.binLabel),
      });
      syncObjectTable(choice);
      return;
    }

    timelineHost.hidden = true;

    renderBarList(rows, distribution.bins, {
      preserveOrder: mark !== 'frequency',
      // Enum values are an ordered scale, so the ramp carries that order.
      ramp: choice.kind === 'enum',
      share: true,
      ...(activeIndex >= 0 ? { activeIndex } : {}),
      onPick: (_datum, index) => pick(choice, distribution.bins[index], self?.binLabel),
    });
    syncObjectTable(choice);
  }

  /**
   * The highest-valued objects — as a ranking, or as a roster when they tie.
   *
   * A bounded score puts dozens of objects on the same maximum, and ten
   * full-length identical bars say nothing except which ones the sample
   * happened to reach first. When the whole leading group shares one value the
   * ranking is dropped for a list of names, because the names are the only
   * information left.
   */
  function renderTop(
    top: readonly RankedObject[],
    observations: readonly RankedObject[],
    choice: AttributeChoice,
    money: (value: number) => string,
    truncated: boolean,
  ): void {
    const heading = topSection.querySelector<HTMLElement>('h2');
    const caption = topSection.querySelector<HTMLElement>('.sub');
    const best = top[0]?.value;
    const tiedThroughout = best !== undefined && top.length > 1 && top.every((e) => e.value === best);

    if (!tiedThroughout || best === undefined) {
      topRows.className = 'rows top-rows';
      if (heading) heading.textContent = 'Highest values';
      if (caption) {
        caption.textContent = truncated
          ? `Highest among the first ${formatCount(SAMPLE_LIMIT)} objects read.`
          : 'Highest across every object carrying a value.';
      }
      renderBarList(
        topRows,
        top.map((entry) => ({ label: entry.name, count: entry.value })),
        {
          preserveOrder: true,
          format: money,
          onPick: (_datum, index) => {
            const picked = top[index];
            if (picked) openDetail(picked.id);
          },
        },
      );
      return;
    }

    const tied = observations.filter((entry) => entry.value === best);
    const shown = tied.slice(0, 24);

    if (heading) heading.textContent = `At the maximum, ${money(best)}`;
    if (caption) {
      caption.textContent = `${formatCount(tied.length)} object${tied.length === 1 ? '' : 's'} share the highest value, so there is nothing to rank — these are the names.`;
    }

    topRows.className = 'roster';
    topRows.replaceChildren(
      ...shown.map((entry) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'roster-chip';
        chip.textContent = entry.name;
        chip.addEventListener('click', () => openDetail(entry.id));
        return chip;
      }),
      ...(tied.length > shown.length
        ? [
            (() => {
              const more = document.createElement('button');
              more.type = 'button';
              more.className = 'roster-chip more';
              more.textContent = `+${formatCount(tied.length - shown.length)} more`;
              // Filtering to the maximum sends the whole set to the object
              // table, which is built to page through them.
              more.addEventListener('click', () => {
                const binLabel = `≥ ${money(best)}`;
                filters.setType(type);
                filters.select({
                  choice,
                  label: `${choice.name}: ${binLabel}`,
                  binLabel,
                  condition: thresholdCondition(choice, 'greaterThanOrEquals', best),
                });
              });
              return more;
            })(),
          ]
        : []),
    );
  }

  /** Two categoricals, as a grid of counts. */
  async function drawCrossTab(
    row: AttributeChoice,
    col: AttributeChoice,
    mine: number,
  ): Promise<void> {
    const scope = scopeExcluding(filters.get(), row, col);
    const table = await crossTab(session.kg, session.sample, type, row, col, scope);
    if (mine !== generation) return;

    reveal();
    plot.hidden = true;
    timelineHost.hidden = true;
    meterBlock.hidden = true;
    statsRow.hidden = true;
    topSection.hidden = true;
    donutHost.hidden = true;
    withDonut.classList.remove('has-donut');
    rows.replaceChildren();
    teardownPlot?.();
    teardownPlot = null;
    heatHost.hidden = false;

    set('title', `${row.name} against ${col.name}`);
    set(
      'subtitle',
      `${row.categoryName} · every combination counted; colour is the count, position is the pair. Tap a cell to filter to it.`,
    );
    kpi(
      'Objects counted',
      { value: table.total, format: formatCompact },
      'Combinations',
      { value: table.rows.length * table.cols.length, format: formatCount },
    );

    const rowPick = selectionFor(filters.get(), row);
    const colPick = selectionFor(filters.get(), col);

    renderHeatmap(heatHost, table, {
      rowLabel: row.name,
      colLabel: col.name,
      ...(rowPick && colPick
        ? { active: { row: rowPick.binLabel, col: colPick.binLabel } }
        : {}),
      onPick: (rowValue, colValue) => {
        const rowCondition = enumCondition(row, rowValue);
        const colCondition = enumCondition(col, colValue);
        if (!rowCondition || !colCondition) return;
        filters.setType(type);
        filters.select({
          choice: row,
          label: `${row.name}: ${rowValue}`,
          binLabel: rowValue,
          condition: rowCondition,
        });
        filters.select({
          choice: col,
          label: `${col.name}: ${colValue}`,
          binLabel: colValue,
          condition: colCondition,
        });
      },
    });

    syncObjectTable(row);
  }

  // ── two fields ─────────────────────────────────────────────────────

  async function drawScatter(x: AttributeChoice, y: AttributeChoice, mine: number): Promise<void> {
    // The plot keeps every point and washes the selected quadrant instead of
    // filtering itself down to it — the same rule the bar charts follow.
    const scope = scopeExcluding(filters.get(), x, y);

    const sizeBy = resolveSize(x, y);
    const groupBy = choices.find((candidate) => keyOf(candidate) === groupKey);

    const { points, truncated, groups } = await scatterPoints(
      session.sample,
      type,
      x,
      y,
      scope,
      sizeBy,
      groupBy,
    );
    if (mine !== generation) return;

    reveal();
    meterBlock.hidden = true;
    statsRow.hidden = true;
    topSection.hidden = true;
    donutHost.hidden = true;
    withDonut.classList.remove('has-donut');
    rows.replaceChildren();
    plot.hidden = false;
    teardownPlot?.();
    heatHost.hidden = true;
    timelineHost.hidden = true;

    set('title', `${y.name} against ${x.name}`);
    const splitX = median(points.map((point) => point.x));
    const splitY = median(points.map((point) => point.y));

    const sized = sizeBy ? ` Bubble area is ${sizeBy.name}.` : '';
    set(
      'subtitle',
      (truncated
        ? `Only objects carrying both measures are plotted, from the first ${formatCount(SAMPLE_LIMIT)} read.`
        : 'Every object carrying both measures is plotted.') +
        (mark === 'quadrant'
          ? ` Split at the median of each axis — tap a quadrant to filter to it.${sized}`
          : sized),
    );
    const active = activeQuadrant(x, y);
    const inQuadrant = active
      ? points.filter((point) => quadrantOf(point, splitX, splitY) === active).length
      : 0;

    kpi(
      active ? 'Objects in this quadrant' : 'Objects plotted',
      { value: active ? inQuadrant : points.length, format: formatCompact },
      active ? 'Share of plotted' : 'Measures',
      active
        ? points.length === 0
          ? '—'
          : `${((inQuadrant / points.length) * 100).toFixed(1)}%`
        : '2',
    );

    const fx = (value: number): string =>
      x.kind === 'money' ? formatMoney(value, x.currency) : formatCompact(value);
    const fy = (value: number): string =>
      y.kind === 'money' ? formatMoney(value, y.currency) : formatCompact(value);

    teardownPlot = renderScatter(
      plot,
      points,
      { x: x.name, y: y.name, formatX: fx, formatY: fy },
      {
        onPickPoint: (point) => openDetail(point.id),
        ...(groupBy
          ? {
              highlight: {
                label: groupBy.name,
                values: groups,
                ...(activeGroup ? { active: activeGroup } : {}),
                onPick: (value: string | undefined) => {
                  activeGroup = value;
                  void render().catch(fail);
                },
              },
            }
          : {}),
        ...(sizeBy
          ? {
              sizeLabel: sizeBy.name,
              formatSize: (value: number) => formatMoney(value, sizeBy.currency),
            }
          : {}),
        ...(mark === 'quadrant'
          ? {
              quadrant: {
                x: splitX,
                y: splitY,
                ...(activeQuadrant(x, y) ? { active: activeQuadrant(x, y)! } : {}),
                onPick: (quadrant: Quadrant) => pickQuadrant(x, y, splitX, splitY, quadrant),
              },
            }
          : {}),
      },
    );
    renderHighlightLegend(groupBy, groups);
    syncObjectTable(y);
  }

  /**
   * Values of the highlight attribute, as a tappable legend under the plot.
   *
   * Highlighting deliberately does *not* filter: the point of it is to see
   * where a subset sits **within** the whole population, and filtering would
   * remove the very context that makes the position meaningful. The bridge is
   * explicit instead — once you have seen the pattern, one tap narrows to it.
   */
  function renderHighlightLegend(
    groupBy: AttributeChoice | undefined,
    values: readonly string[],
  ): void {
    const label = groupBy?.name;
    if (!label || values.length === 0) {
      legendHost.hidden = true;
      legendHost.replaceChildren();
      return;
    }

    legendHost.hidden = false;
    legendHost.setAttribute('aria-label', `Highlight by ${label}`);

    legendHost.replaceChildren(
      ...values.map((value) => {
        const active = value === activeGroup;

        // A pill with two actions: the body toggles the highlight, and once
        // highlighted a funnel appears to narrow everything to it. Nested
        // buttons are not valid, so the pill is a container styled to read as
        // one control.
        const pill = document.createElement('span');
        pill.className = active ? 'legend-pill on' : 'legend-pill';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'pill-label';
        toggle.textContent = value;
        toggle.setAttribute('aria-pressed', String(active));
        toggle.addEventListener('click', () => {
          activeGroup = active ? undefined : value;
          void render().catch(fail);
        });
        pill.append(toggle);

        if (active && groupBy) {
          const narrow = document.createElement('button');
          narrow.type = 'button';
          narrow.className = 'pill-filter';
          narrow.title = `Filter everything to ${value}`;
          narrow.setAttribute('aria-label', narrow.title);
          narrow.append(filterIcon());
          narrow.addEventListener('click', () => applyGroupFilter(groupBy, value));
          pill.append(narrow);
        }

        return pill;
      }),
    );
  }

  /** Turns the current highlight into an app-wide filter. */
  function applyGroupFilter(choice: AttributeChoice, value: string): void {
    const condition = equalsCondition(choice, value);
    if (!condition) return;
    // Once the population *is* the highlight, highlighting it says nothing.
    activeGroup = undefined;
    filters.setType(type);
    filters.select({ choice, label: `${choice.name}: ${value}`, binLabel: value, condition });
  }

  function buildGroupOptions(): void {
    const candidates = choices.filter((candidate) =>
      ['enum', 'boolean', 'string', 'text'].includes(candidate.kind),
    );
    groupSelect.setOptions([
      { value: '', label: 'Nothing' },
      ...candidates.map((candidate) => ({
        value: keyOf(candidate),
        label: candidate.name,
        note: candidate.categoryName,
        icon: () => attributeIcon(candidate.kind, candidate.currency),
      })),
    ]);
    groupSelect.setValue(
      candidates.some((candidate) => keyOf(candidate) === groupKey) ? groupKey : '',
    );
    groupSelect.setDisabled(candidates.length === 0);
  }

  async function drawSumBy(a: AttributeChoice, b: AttributeChoice, mine: number): Promise<void> {
    // Whichever of the pair is the enum groups; the other is aggregated.
    const category = a.kind === 'enum' ? a : b;
    const measure = a.kind === 'enum' ? b : a;
    const additive = measure.kind === 'money';

    const scope = scopeFor(filters.get(), category);
    const groups = await statsByCategory(session.kg, type, category, measure, scope);
    if (mine !== generation) return;

    const bins: Bin[] = groups.map((group) => ({
      label: group.label,
      count: additive ? group.sum : group.objects === 0 ? 0 : group.sum / group.objects,
      condition: group.condition,
    }));

    reveal();
    plot.hidden = true;
    meterBlock.hidden = true;
    heatHost.hidden = true;
    timelineHost.hidden = true;
    statsRow.hidden = true;
    topSection.hidden = true;
    if (mark !== 'donut') {
      donutHost.hidden = true;
      withDonut.classList.remove('has-donut');
    }

    const format = (value: number): string =>
      additive
        ? formatMoney(value, measure.currency)
        : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

    const totalSum = groups.reduce((sum, group) => sum + group.sum, 0);
    const totalObjects = groups.reduce((sum, group) => sum + group.objects, 0);

    const chosen = selectionFor(filters.get(), category);
    const chosenIndex = chosen ? bins.findIndex((bin) => bin.label === chosen.binLabel) : -1;
    const chosenBin = chosenIndex >= 0 ? bins[chosenIndex] : undefined;
    const chosenGroup = chosenIndex >= 0 ? groups[chosenIndex] : undefined;

    set('title', `${additive ? 'Total' : 'Average'} ${measure.name} by ${category.name}`);
    set(
      'subtitle',
      additive
        ? `${category.categoryName} · ${mark === 'donut' ? 'each slice is that group’s share of the total' : 'each bar totals that group'}.`
        : `${category.categoryName} · a score does not add up, so each bar is the group's average across the objects that carry a value.`,
    );

    // The ring keeps every group, but the figures beside it describe whatever
    // is selected — the same rule the single-attribute charts follow.
    if (additive) {
      kpi(
        chosenBin ? `Total in ${chosenBin.label}` : `Total ${measure.name}`,
        { value: chosenBin ? chosenBin.count : totalSum, format },
        chosenBin ? 'Share of total' : 'Groups',
        chosenBin
          ? totalSum === 0
            ? '—'
            : `${((chosenBin.count / totalSum) * 100).toFixed(1)}%`
          : { value: bins.length, format: formatCount },
      );
    } else {
      kpi(
        chosenBin ? `Average in ${chosenBin.label}` : `Average ${measure.name}`,
        { value: chosenBin ? chosenBin.count : totalObjects === 0 ? 0 : totalSum / totalObjects, format },
        'Objects counted',
        { value: chosenGroup ? chosenGroup.objects : totalObjects, format: formatCount },
      );
    }

    const selected = chosen;
    const activeIndex = chosenIndex;

    if (mark === 'donut') {
      donutHost.hidden = false;
      withDonut.classList.add('has-donut');
      teardownPlot?.();
      teardownPlot = renderDonut(donutHost, bins, {
        format,
        // With a slice selected the hole becomes a readout for it; the ring
        // still draws the whole, so the part-to-whole reading is intact.
        caption: chosenBin ? chosenBin.label : measure.name,
        ...(chosenBin ? { centreValue: chosenBin.count } : {}),
        ...(activeIndex >= 0 ? { activeIndex } : {}),
        onPick: (index) => pick(category, bins[index], selected?.binLabel),
      });
      renderLegend(rows, bins, {
        format,
        ...(activeIndex >= 0 ? { activeIndex } : {}),
        onPick: (index) => pick(category, bins[index], selected?.binLabel),
      });
    } else {
      teardownPlot?.();
      teardownPlot = null;
      renderBarList(rows, bins, {
        preserveOrder: true,
        ramp: true,
        format,
        share: additive,
        ...(activeIndex >= 0 ? { activeIndex } : {}),
        onPick: (_datum, index) => pick(category, bins[index], selected?.binLabel),
      });
    }

    // Averages do not compose into a whole, so the table drops the share
    // column and reports the same figures the bars show.
    syncObjectTable(measure);
  }

  // ── helpers ────────────────────────────────────────────────────────

  function pick(choice: AttributeChoice, bin: Bin | undefined, activeLabel: string | undefined): void {
    if (!bin?.condition) return;
    if (activeLabel === bin.label) {
      filters.deselect(choice);
      return;
    }
    filters.setType(type);
    filters.select({
      choice,
      label: `${choice.name}: ${bin.label}`,
      binLabel: bin.label,
      condition: bin.condition,
    });
  }

  function drawCoverage(cover: { withValue: number; notSet: number }, choice: AttributeChoice): void {
    const populated = cover.withValue + cover.notSet;
    const filled = populated === 0 ? 0 : cover.withValue / populated;
    meterFill.style.width = `${filled * 100}%`;

    const state = filled >= 0.8 ? 'good' : filled >= 0.5 ? 'warning' : 'sparse';
    const word = state === 'good' ? 'Well covered' : state === 'warning' ? 'Partial' : 'Sparse';
    meterFill.className = `meter-fill ${state}`;
    if (meterFill.parentElement) meterFill.parentElement.className = `meter ${state}`;

    const node = container.querySelector<HTMLElement>('[data-k="cov-value"]');
    if (node) {
      node.innerHTML = '';
      const badge = document.createElement('span');
      badge.className = `cov-state ${state}`;
      badge.textContent = word;
      const pct = document.createElement('span');
      pct.textContent = ` · ${Math.round(filled * 100)}%`;
      node.append(badge, pct);
    }
    set(
      'cov-foot',
      `${formatCount(cover.withValue)} of ${formatCount(populated)} ${labelFor(type).toLowerCase()} objects have a value for ${choice.name} · ${formatCount(cover.notSet)} not set`,
    );
  }

  function reveal(): void {
    placeholder.hidden = true;
    insight.hidden = false;
  }

  /**
   * Once a slice is selected, the bucket-count table is answering a question
   * nobody is asking any more — so it gives way to the objects themselves.
   */
  function syncObjectTable(focus: AttributeChoice | null): void {
    const active = filters.isActive;
    objectsHost.hidden = !active;

    if (!active) {
      objectTable?.destroy();
      objectTable = null;
      return;
    }

    const created = objectTable === null;
    objectTable ??= mountObjectTable(
      objectsHost,
      session,
      filters,
      () => ({ type, attributes: choices }),
      openDetail,
    );
    // A fresh table already loads once; only nudge an existing one.
    if (!created || focus) objectTable.setFocus(focus);
  }

  /** A figure is either final text or a number to count up to. */
  type Figure = string | { value: number; format: (n: number) => string };

  function kpi(label: string, value: Figure, secondLabel: string, secondValue: Figure): void {
    set('headline-label', label);
    figure('headline', value);
    set('second-label', secondLabel);
    figure('second', secondValue);
  }

  function figure(key: string, value: Figure): void {
    const node = container.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (!node) return;
    if (typeof value === 'string') {
      node.textContent = value;
      return;
    }
    countUp(node, value.value, value.format);
  }

  /** Quantitative attributes that could drive bubble area, minus the two axes. */
  function sizeCandidates(x: AttributeChoice, y: AttributeChoice): AttributeChoice[] {
    return choices.filter(
      (candidate) =>
        levelOf(candidate.kind) === 'quantitative' && !isSame(candidate, x) && !isSame(candidate, y),
    );
  }

  /**
   * The measure driving bubble area.
   *
   * Auto-selection only happens when it is unambiguous — exactly one money
   * attribute is available. Picking "the first money attribute" out of several
   * would encode an arbitrary choice as if it were meaningful, and which
   * attributes exist differs per customer.
   */
  function resolveSize(x: AttributeChoice, y: AttributeChoice): AttributeChoice | undefined {
    const candidates = sizeCandidates(x, y);
    if (sizeKey !== null) {
      return candidates.find((candidate) => keyOf(candidate) === sizeKey);
    }
    const money = candidates.filter((candidate) => candidate.kind === 'money');
    return money.length === 1 ? money[0] : undefined;
  }

  function buildSizeOptions(x: AttributeChoice, y: AttributeChoice): void {
    const candidates = sizeCandidates(x, y);
    const resolved = resolveSize(x, y);

    sizeSelect.setOptions([
      { value: '', label: 'Uniform' },
      // Attribute names repeat across categories, so the category disambiguates
      // — exactly as it does in the compare list.
      ...candidates.map((candidate) => ({
        value: keyOf(candidate),
        label: candidate.name,
        note: candidate.categoryName,
        icon: () => attributeIcon(candidate.kind, candidate.currency),
      })),
    ]);
    sizeSelect.setValue(resolved ? keyOf(resolved) : '');
    sizeSelect.setDisabled(candidates.length === 0);
  }

  /** Selects both halves at once — one condition per axis, combined by AND. */
  function pickQuadrant(
    x: AttributeChoice,
    y: AttributeChoice,
    splitX: number,
    splitY: number,
    quadrant: Quadrant,
  ): void {
    const [xHalf, yHalf] = quadrant.split('-') as ['high' | 'low', 'high' | 'low'];

    filters.setType(type);
    for (const [choice, half, split] of [
      [x, xHalf, splitX],
      [y, yHalf, splitY],
    ] as const) {
      const operator = half === 'high' ? 'greaterThanOrEquals' : 'lessThan';
      const binLabel = `${half === 'high' ? '≥' : '<'} ${formatCompact(split)}`;
      filters.select({
        choice,
        label: `${choice.name}: ${binLabel}`,
        binLabel,
        condition: thresholdCondition(choice, operator, split),
      });
    }
  }

  function quadrantOf(point: { x: number; y: number }, splitX: number, splitY: number): Quadrant {
    return point.x >= splitX
      ? point.y >= splitY
        ? 'high-high'
        : 'high-low'
      : point.y >= splitY
        ? 'low-high'
        : 'low-low';
  }

  /** Which quadrant the current filter corresponds to, if any. */
  function activeQuadrant(x: AttributeChoice, y: AttributeChoice): Quadrant | undefined {
    const half = (choice: AttributeChoice): 'high' | 'low' | undefined => {
      const selection = selectionFor(filters.get(), choice);
      if (!selection) return undefined;
      return selection.binLabel.startsWith('≥')
        ? 'high'
        : selection.binLabel.startsWith('<')
          ? 'low'
          : undefined;
    };

    const xHalf = half(x);
    const yHalf = half(y);
    return xHalf && yHalf ? (`${xHalf}-${yHalf}` as Quadrant) : undefined;
  }

  function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }

  function isSame(a: AttributeChoice, b: AttributeChoice): boolean {
    return a.categoryId === b.categoryId && a.definitionId === b.definitionId;
  }

  function fail(error: unknown): void {
    insight.classList.remove('busy');
    insight.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = error instanceof Error ? error.message : String(error);
  }

  function set(key: string, value: string): void {
    const node = container.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (node) node.textContent = value;
  }

  /**
   * Swaps a placeholder for a searchable picker, keeping the placeholder's
   * classes so the surrounding layout rules still apply.
   */
  function mountPicker(selector: string, name: string, placeholder?: string): Picker {
    const host = q(selector, name);
    const picker = createPicker(placeholder);
    picker.element.classList.add(...host.classList);
    host.replaceWith(picker.element);
    return picker;
  }

  function keyOf(choice: AttributeChoice): string {
    return `${choice.categoryId}.${choice.definitionId}`;
  }

  async function chartAttribute(
    objectType: string,
    categoryId: string,
    definitionId: string,
  ): Promise<void> {
    if (objectType !== type) {
      type = objectType as ObjectType;
      select.setValue(type);
      await loadAttributes();
    }

    const choice = choices.find(
      (candidate) => candidate.categoryId === categoryId && candidate.definitionId === definitionId,
    );
    if (!choice || !isPlottable(choice)) return;

    if (!primary || isSame(primary, choice)) {
      primary = choice;
      secondary = null;
    } else if (compatible(primary, choices).some((candidate) => isSame(candidate, choice))) {
      secondary = choice;
    } else {
      // Not a valid pairing — chart it on its own rather than silently
      // ignoring the request.
      primary = choice;
      secondary = null;
    }

    mark = null;
    sizeKey = null;

    rail.querySelectorAll('.attr').forEach((item) => {
      item.classList.toggle('on', item.textContent?.includes(primary?.name ?? '\u0000') === true);
    });

    await render();
  }

  async function restoreSnapshot(snapshot: AttributeSnapshot): Promise<void> {
    if (snapshot.type) {
      type = snapshot.type;
      select.setValue(type);
    }

    // Always wait for the schema, even when the type already matches: mounting
    // the view kicks off its own load, and looking an attribute up before that
    // resolves finds an empty list and silently restores nothing.
    await loadAttributes();

    const find = (key: string | undefined): AttributeChoice | null =>
      key ? (choices.find((candidate) => keyOf(candidate) === key) ?? null) : null;

    primary = find(snapshot.primary);
    secondary = find(snapshot.secondary);
    mark = snapshot.mark ?? null;
    sizeKey = snapshot.size ?? null;
    groupKey = snapshot.group ?? '';
    activeGroup = snapshot.active;

    if (!primary) {
      insight.hidden = true;
      placeholder.hidden = false;
      placeholder.textContent = 'Pick an attribute to chart it.';
      return;
    }

    rail.querySelectorAll('.attr').forEach((item) => {
      item.classList.toggle('on', item.textContent?.includes(primary?.name ?? '\u0000') === true);
    });
    await render();
  }

  return {
    snapshot(): AttributeSnapshot {
      return {
        type,
        ...(primary ? { primary: keyOf(primary) } : {}),
        ...(secondary ? { secondary: keyOf(secondary) } : {}),
        ...(mark ? { mark } : {}),
        ...(sizeKey ? { size: sizeKey } : {}),
        ...(groupKey ? { group: groupKey } : {}),
        ...(activeGroup ? { active: activeGroup } : {}),
      };
    },

    restore(snapshot: AttributeSnapshot): Promise<void> {
      return restoreSnapshot(snapshot).catch(fail);
    },

    chart(objectType: string, categoryId: string, definitionId: string): void {
      void chartAttribute(objectType, categoryId, definitionId).catch(fail);
    },
    destroy(): void {
      document.removeEventListener('click', onAway);
      document.removeEventListener('keydown', onEscape);
      unsubscribe();
      objectTable?.destroy();
      teardownPlot?.();
      generation += 1;
      container.replaceChildren();
    },
  };
}
