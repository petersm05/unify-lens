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
  measureOverTime,
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
import { attributeIcon, controlsIcon, filterIcon, sidebarIcon } from '../ui/icons';
import {
  closesOnPick,
  laneNow,
  onLaneChange,
  rememberWideRail,
  wideRailOpen,
  type Lane,
} from '../ui/rail';
import { createPicker, type Picker } from '../ui/picker';
import { renderBarList, renderLegend } from './bars';
import { mountObjectTable, type ObjectTable } from './object-table';
import { renderDonut } from './donut';
import { renderScatter, type Quadrant } from './scatter';
import { renderTimeline } from './timeline';
import { renderHeatmap } from './heatmap';
import { formatCompact, formatCount, formatMoney } from './theme';

/**
 * Above this many objects the population is not read speculatively.
 *
 * Half the sample ceiling: past it a read is both slow and likely to be
 * truncated, and the charts that would be served by counts instead lose more
 * than the ones needing values gain.
 */
const PREFETCH_LIMIT = 2000;

/**
 * Length of the gauge's sweep, for the arc the card's path draws.
 *
 * 270° at r=40, matching the `A 40 40` in that path. Two numbers that have to
 * agree, so the one that is not in the markup says which one it is.
 */
const GAUGE_ARC = 40 * 1.5 * Math.PI;

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
      <aside class="rail" tabindex="-1">
        <label class="field">
          <span>Object type</span>
          <div class="type-select"></div>
        </label>
        <div class="attr-list" role="list" aria-label="Attributes"></div>
      </aside>

      <!-- Outside both scrolling panels on purpose. A chart page is long, so a
           toggle inside it scrolls out of reach; and where the two take turns,
           the one that is hidden cannot offer the way back to the other. -->
      <div class="rail-bar">
        <button type="button" class="rail-toggle" aria-expanded="true">
          <span class="rail-label">Attributes</span>
        </button>
      </div>

      <!-- Only where the panel covers the chart. Tapping beside it puts it
           away, which is what covering something is expected to allow. -->
      <div class="rail-scrim" hidden></div>

      <div class="detail">
        <div class="insight" hidden>
          <div class="kpis">
            <div class="kpi hero">
              <span class="k-label" data-k="headline-label">Objects</span>
              <span class="k-value" data-k="headline">—</span>
              <span class="k-of" data-k="headline-of" hidden></span>
            </div>
            <div class="kpi">
              <span class="k-label" data-k="second-label">Values</span>
              <span class="k-value" data-k="second">—</span>
              <span class="k-of" data-k="second-of" hidden></span>
            </div>
            <!-- Coverage is a figure about the population like the two beside
                 it, so it takes the same shape — label, number, supporting
                 line — and the arc is the frame around the number rather than
                 a chart of its own. The sweep stops short of a full ring on
                 purpose: the chart card below can draw a donut, and two rings
                 of one attribute read as two distributions. -->
            <div class="kpi coverage" hidden>
              <span class="k-label">Coverage</span>
              <div class="cov-body">
                <div class="gauge">
                  <svg viewBox="0 4 100 92" aria-hidden="true" focusable="false">
                    <path class="gauge-track" d="M 21.72 78.28 A 40 40 0 1 1 78.28 78.28" />
                    <path class="gauge-fill" d="M 21.72 78.28 A 40 40 0 1 1 78.28 78.28" />
                  </svg>
                  <span class="k-value gauge-value" data-k="cov-value">—</span>
                </div>
                <span class="cov-read">
                  <span class="cov-state" data-k="cov-state"></span>
                  <span class="k-of" data-k="cov-foot"></span>
                </span>
              </div>
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

        <button type="button" class="placeholder" disabled>Pick an attribute to chart it.</button>
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
  const attrList = q('.attr-list', 'list');
  const split = q('.split', 'split');
  const rail = q('.rail', 'rail');
  const railToggle = q<HTMLButtonElement>('.rail-toggle', 'rail toggle');
  const railScrim = q('.rail-scrim', 'rail scrim');
  railToggle.prepend(sidebarIcon());
  const insight = q('.insight', 'insight');
  const placeholder = q<HTMLButtonElement>('.placeholder', 'placeholder');

  /**
   * The empty pane's line.
   *
   * @param canPick - whether picking an attribute is the thing to do next. Only
   *   then is the line a control: it opens the list, which on a phone is the
   *   pane it is standing in for. While something is loading, or when the type
   *   has nothing to offer, it is a sentence and nothing more.
   */
  function say(message: string, canPick = false): void {
    placeholder.hidden = false;
    placeholder.textContent = message;
    placeholder.disabled = !canPick;
  }
  const plot = q('.plot', 'plot');
  const donutHost = q('.donut', 'donut');
  const timelineHost = q('.timeline', 'timeline');
  const heatHost = q('.heatmap', 'heatmap');
  const withDonut = q('.with-donut', 'chart body');
  const rows = q('.rows', 'rows');
  const topSection = q('.top', 'top');
  const topRows = q('.top-rows', 'top rows');
  const statsRow = q('.stats', 'stats');
  const kpiRow = q('.kpis', 'figure row');
  const coverageCard = q('.kpi.coverage', 'coverage card');
  const gaugeFill = must(
    container.querySelector<SVGPathElement>('.gauge-fill'),
    'attributes: coverage gauge',
  );
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

  /**
   * Whether the attribute rail is showing, kept once per arrangement.
   *
   * Two flags rather than one. A wide screen's collapsed rail is a considered
   * preference about how to read a chart, worth carrying across sessions; a
   * phone's is a position in a drill-down, which means nothing once there is
   * room to show both. Sharing one variable would leak yesterday's iPad choice
   * into today's phone, and back again.
   */
  let lane: Lane = laneNow();
  let wideOpen = wideRailOpen();
  let narrowOpen = false;

  /**
   * Shows or hides the attribute panel.
   *
   * One question — is the panel open? — and the arrangement only decides where
   * it goes. The chart is on screen either way, so nothing here has to say
   * which pane you are looking at, and the toggle keeps one name.
   *
   * @param moveFocus - whether a person asked for this. Opening the panel over
   *   the chart has to take focus with it, and closing has to bring it back, or
   *   it is left on something that is no longer in front of anyone. A restore
   *   from a link was nobody's gesture, and stealing focus for it would be
   *   worse than not managing focus at all.
   */
  function applyRail(moveFocus = false): void {
    const open = lane === 'wide' ? wideOpen : narrowOpen;

    split.classList.toggle('lane-wide', lane === 'wide');
    split.classList.toggle('lane-narrow', lane === 'narrow');
    split.classList.toggle('rail-on', open);
    split.classList.toggle('rail-off', !open);

    railToggle.setAttribute('aria-expanded', String(open));
    rail.hidden = !open;
    // Only where the panel is over the chart is there anything to dim.
    railScrim.hidden = !open || lane === 'wide';

    if (!moveFocus) return;
    if (open) {
      // Onto the row they are already on, so the list opens where they left it
      // rather than at the top of forty-odd attributes.
      (
        rail.querySelector<HTMLElement>('.attr.on') ??
        rail.querySelector<HTMLElement>('.attr:not(:disabled)') ??
        rail
      ).focus();
    } else {
      railToggle.focus();
    }
  }

  /** Opens or closes the panel, remembering the choice where it is kept. */
  function setRail(open: boolean): void {
    if (lane === 'wide') {
      wideOpen = open;
      rememberWideRail(open);
    } else {
      narrowOpen = open;
    }
    applyRail(true);
  }

  placeholder.addEventListener('click', () => setRail(true));
  railToggle.addEventListener('click', () =>
    setRail(!(lane === 'wide' ? wideOpen : narrowOpen)),
  );
  railScrim.addEventListener('click', () => setRail(false));

  /**
   * Escape closes the panel where it is covering the chart.
   *
   * Not where it sits beside it: there it is not covering anything, and Escape
   * belongs to whatever is — the chart options menu binds it too, and closing
   * both from one press would be a surprise.
   */
  const onRailEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || lane === 'wide' || !narrowOpen) return;
    setRail(false);
  };
  document.addEventListener('keydown', onRailEscape);

  const stopLane = onLaneChange((next) => {
    lane = next;
    // Turning a device is not a request to open anything. Each arrangement
    // resumes its own resting state: the remembered one where there is room to
    // keep the panel open, and closed where it would be covering the chart.
    narrowOpen = false;
    applyRail();
  });

  applyRail();
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
    say('Reading the attribute schema…');
    attrList.replaceChildren();
    primary = null;
    secondary = null;
    mark = null;
    // With no chart there is nothing for the list to sit in front of, so where
    // the two take turns this brings it back. One call covers the type picker,
    // the filter subscription and a restore, which all pass through here.
    applyRail();

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
      say(`${labelFor(type)} has no attribute categories defined.`);
      return;
    }

    say('Pick an attribute to chart it.', true);

    // The type is settled and the population read takes seconds, so it starts
    // now rather than when an attribute is tapped — the moment when someone is
    // actually waiting. Nothing is guessed here: this is the type they chose.
    void prefetchPopulation(type, mine);

    // Grouped by category with a sticky heading: the category was previously
    // repeated on all forty-odd rows, which is a lot of ink to say the same
    // thing and leaves nothing to scan by.
    const groups = new Map<string, AttributeChoice[]>();
    for (const choice of choices) {
      const bucket = groups.get(choice.categoryName) ?? [];
      bucket.push(choice);
      groups.set(choice.categoryName, bucket);
    }

    attrList.replaceChildren(
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
                attrList.querySelectorAll('.attr').forEach((other) => other.classList.remove('on'));
                item.classList.add('on');
                primary = choice;
                secondary = null;
                mark = null;
                // The list has done its job; where they take turns the chart
                // takes the screen. Where both fit, nothing moves.
                if (closesOnPick(lane)) narrowOpen = false;
                applyRail(true);
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
    grainField.hidden = mark !== 'timeline' && mark !== 'trend';
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
      say('Computing…');
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
        mark === 'trend' && pair
          ? drawTrend(field, pair, mine)
          : (mark === 'scatter' || mark === 'quadrant') && pair
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

  // ── a date with a measure: what happened to this number over time ──

  /**
   * The measure per period, as columns.
   *
   * Which of the pair is the date decides the axis rather than the order they
   * were picked in, so choosing a measure and comparing it with a date gives
   * the same chart as the other way round.
   */
  async function drawTrend(
    a: AttributeChoice,
    b: AttributeChoice,
    mine: number,
  ): Promise<void> {
    const when = a.kind === 'date' ? a : b;
    const measure = a.kind === 'date' ? b : a;

    const trend = await measureOverTime(
      session.sample,
      type,
      when,
      measure,
      scopeExcluding(filters.get(), when, measure),
      grain === '' ? undefined : grain,
    );
    if (mine !== generation) return;

    reveal();
    showSurface('timeline');
    hideCoverage();
    teardownPlot?.();
    teardownPlot = null;
    legendHost.hidden = true;

    const money = measure.kind === 'money';
    const format = (value: number): string =>
      money ? formatMoney(value, measure.currency) : formatCompact(value);

    set('title', `${measure.name} over ${when.name}`);
    set(
      'subtitle',
      `${measure.categoryName} · ${money ? 'totalled' : 'averaged'} per ${trend.grain || 'period'}, across ${formatCount(trend.counted)} ${labelFor(type)} objects carrying both a date and a value.`,
    );

    const self = selectionFor(filters.get(), when);
    const activeIndex = self ? trend.points.findIndex((p) => p.label === self.binLabel) : -1;

    kpi(
      money ? `Total ${measure.name}` : `Average ${measure.name}`,
      {
        value: money
          ? trend.points.reduce((sum, point) => sum + point.measure, 0)
          : trend.points.reduce((sum, point) => sum + point.measure, 0) /
            Math.max(trend.points.length, 1),
        format,
      },
      'Periods',
      { value: trend.points.length, format: formatCount },
    );

    rows.replaceChildren();
    renderTimeline(timelineHost, trend.points, {
      ...(activeIndex >= 0 ? { activeIndex } : {}),
      value: (_bin, index) => trend.points[index]?.measure ?? 0,
      format,
      onPick: (index) => pick(when, trend.points[index], self?.binLabel),
    });

    syncObjectTable([when, measure]);
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

    const money = (value: number): string =>
      choice.kind === 'money' ? formatMoney(value, choice.currency) : formatCompact(value);

    set('title', `${choice.name} across ${labelFor(type)}`);

    // A sum only means something for an additive measure. Money is additive;
    // a rating or a score is not — "Total Business Fit Score = 382" is
    // arithmetic without a referent, so those lead with the count instead.
    const additive = choice.kind === 'money';

    // Every distribution counts objects that carry a value, never the whole
    // population — so the headline says so in each case rather than reading as
    // "Objects" in one shape and "Objects with a value" in another. The
    // population it came from is shown beside it, from the coverage read that
    // has already happened, so no extra query is needed to say what the count
    // is a part of.
    const population = cover.withValue + cover.notSet;
    const countLabel = self ? `Objects in ${self.binLabel}` : 'Objects with a value';

    if (total !== undefined && additive) {
      kpi(
        self ? `Total in ${self.binLabel}` : `Total ${choice.name}`,
        { value: total, format: (n) => formatMoney(n, choice.currency) },
        distribution.truncated ? 'Objects sampled' : countLabel,
        { value: counted, format: formatCount, outOf: population },
      );
    } else if (stats) {
      kpi(
        countLabel,
        { value: counted, format: formatCompact, outOf: population },
        'Median',
        { value: stats.median, format: formatCompact },
      );
    } else {
      kpi(
        countLabel,
        { value: counted, format: formatCompact, outOf: population },
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
      // The coverage gauge in the figure row already accounts for it.
      const slices = distribution.bins.filter((bin) => bin.label !== 'Not set');
      const withValue = slices.reduce((sum, bin) => sum + bin.count, 0);

      showSurface('donut');
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
      syncObjectTable([choice]);
      set(
        'subtitle',
        `${choice.categoryName} · share of the ${formatCount(withValue)} objects that carry a value, in the order the metamodel defines them.`,
      );
      return;
    }

    teardownPlot?.();
    teardownPlot = null;

    const activeIndex = self ? distribution.bins.findIndex((b) => b.label === self.binLabel) : -1;
    // Time reads left to right, so periods get columns rather than rows.
    if (mark === 'timeline') {
      showSurface('timeline');
      rows.replaceChildren();
      renderTimeline(timelineHost, distribution.bins, {
        ...(activeIndex >= 0 ? { activeIndex } : {}),
        onPick: (index) => pick(choice, distribution.bins[index], self?.binLabel),
      });
      syncObjectTable([choice]);
      return;
    }

    showSurface('bars');

    renderBarList(rows, distribution.bins, {
      preserveOrder: mark !== 'frequency',
      // Enum values are an ordered scale, so the ramp carries that order.
      ramp: choice.kind === 'enum',
      share: true,
      ...(activeIndex >= 0 ? { activeIndex } : {}),
      onPick: (_datum, index) => pick(choice, distribution.bins[index], self?.binLabel),
    });
    syncObjectTable([choice]);
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
    showSurface('heatmap');
    hideCoverage();
    statsRow.hidden = true;
    topSection.hidden = true;
    rows.replaceChildren();
    teardownPlot?.();
    teardownPlot = null;

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

    syncObjectTable([row, col]);
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
    showSurface('plot');
    hideCoverage();
    statsRow.hidden = true;
    topSection.hidden = true;
    rows.replaceChildren();
    teardownPlot?.();

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
    syncObjectTable([x, y]);
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
    showSurface(mark === 'donut' ? 'donut' : 'bars');
    hideCoverage();
    statsRow.hidden = true;
    topSection.hidden = true;

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
    syncObjectTable([category, measure]);
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

  /**
   * Coverage, as the third figure in the row.
   *
   * The arc is drawn by dashing a path of known length rather than by
   * measuring it: `getTotalLength` would have to be called after layout, and
   * the card is written before it is ever shown. The number counts up the way
   * the two figures beside it do, so the row animates as one thing.
   */
  function drawCoverage(cover: { withValue: number; notSet: number }, choice: AttributeChoice): void {
    const populated = cover.withValue + cover.notSet;
    const filled = populated === 0 ? 0 : cover.withValue / populated;

    // The thresholds and the vocabulary are the bar's, unchanged: the shape
    // moved, the reading did not.
    const state = filled >= 0.8 ? 'good' : filled >= 0.5 ? 'warning' : 'sparse';
    const word = state === 'good' ? 'Well covered' : state === 'warning' ? 'Partial' : 'Sparse';

    const wasHidden = coverageCard.hidden;
    coverageCard.hidden = false;
    kpiRow.classList.add('has-coverage');
    coverageCard.className = `kpi coverage ${state}`;

    // Coming back from `display: none` in the same frame, the arc has no start
    // value to transition from and would snap to its length while the figure
    // inside it counts up. Empty it and flush, so the sweep has somewhere to
    // start. Synchronous, so a render superseded a moment later cannot land a
    // stale arc a frame after the one that replaced it.
    if (wasHidden) {
      gaugeFill.style.strokeDashoffset = `${GAUGE_ARC}`;
      gaugeFill.getBoundingClientRect();
    }
    gaugeFill.style.strokeDashoffset = `${GAUGE_ARC * (1 - filled)}`;

    const node = container.querySelector<HTMLElement>('[data-k="cov-value"]');
    if (node) countUp(node, filled * 100, (value) => `${Math.round(value)}%`);
    set('cov-state', word);

    // Not the part and the whole: the card beside this one already carries
    // that pair. On a money attribute the hero is the total, which makes the
    // second card the count — "1.001 of 1.191" — and this card would print the
    // same two numbers immediately to its right. Everywhere else the hero is
    // the count and the repeat is one card further away, but it is the same
    // repeat. `figure` already declines to say "301 of 301"; this is that rule
    // across two cards rather than within one.
    //
    // The gap is the number no other card carries, and it is what the unfilled
    // part of the arc is showing. Where there is no gap it says nothing rather
    // than "0 not set" — the arc reads 100% and the word says so.
    const foot = container.querySelector<HTMLElement>('[data-k="cov-foot"]');
    if (foot) {
      foot.hidden = cover.notSet === 0;
      foot.textContent = `${formatCount(cover.notSet)} not set`;
    }
    coverageCard.title = `${formatCount(cover.withValue)} of ${formatCount(populated)} ${labelFor(type).toLowerCase()} objects have a value for ${choice.name} · ${formatCount(cover.notSet)} not set`;
  }

  /**
   * Takes the card out of the row where coverage of one attribute is not the
   * question — a cross-tab, a scatter, a trend, a measure split by category.
   *
   * `hidden` leaves it a child of the row, so the row says how many figures it
   * is carrying rather than leaving the phone layout to infer it from
   * `:last-child` and get it wrong.
   */
  function hideCoverage(): void {
    coverageCard.hidden = true;
    kpiRow.classList.remove('has-coverage');
  }

  /**
   * Reads the population ahead of being asked for it, when that is a good trade.
   *
   * Not always: an enum chart is two counts, and `enumDistribution` uses a
   * sample only when a complete one already exists rather than starting a read
   * for one. Fetching thousands of objects so an enum chart can skip two counts
   * would be a loss, and a larger estate makes it a worse one. So the size is
   * checked first — a count is cheap — and the read only happens where it is
   * bounded enough to pay for every chart that follows.
   */
  async function prefetchPopulation(forType: ObjectType, mine: number): Promise<void> {
    const scope = scopeFor(filters.get());
    if (session.sample.peek(forType, scope)) return;

    try {
      const count = await session.kg
        .getObjects({
          filter: { types: [forType], ...(scope ? { attributeFilter: scope } : {}) },
        })
        .getCount();
      if (mine !== generation || count === 0 || count > PREFETCH_LIMIT) return;

      // Deliberately outside busy.track: this is work nobody asked for, and a
      // progress bar for it would report the app as busy when it is not.
      await session.sample.get(forType, scope);
    } catch {
      // Best effort. Whatever needs the population will read it itself.
    }
  }

  function reveal(): void {
    placeholder.hidden = true;
    insight.hidden = false;
  }

  /**
   * Which of the mutually exclusive chart surfaces is on screen.
   *
   * A chart is a plot, or a heatmap, or a timeline, or a ring — never two. But
   * each draw path used to say so by listing the ones it was not, six or seven
   * lines of `hidden = true` apiece, which meant a sixth surface would have to
   * be added to five separate lists and would be forgotten in one of them.
   * Naming the surface that shows is the whole statement.
   *
   * `'bars'` is the horizontal bar list, which is the case where none of the
   * four is shown: it draws into `.rows`, which is always in the document and
   * is not one of the surfaces — the donut's legend is drawn there too.
   */
  function showSurface(which: 'plot' | 'heatmap' | 'timeline' | 'donut' | 'bars'): void {
    plot.hidden = which !== 'plot';
    heatHost.hidden = which !== 'heatmap';
    timelineHost.hidden = which !== 'timeline';
    donutHost.hidden = which !== 'donut';
    withDonut.classList.toggle('has-donut', which === 'donut');
  }

  /**
   * Once a slice is selected, the bucket-count table is answering a question
   * nobody is asking any more — so it gives way to the objects themselves.
   *
   * Takes every attribute the chart is built from, not one of them: comparing
   * two attributes is a statement that both are of interest, so both get a
   * column rather than whichever half this particular chart passed.
   */
  function syncObjectTable(charted: readonly AttributeChoice[]): void {
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
    if (!created || charted.length > 0) objectTable.setFocus(charted);
  }

  /** A figure is either final text or a number to count up to. */
  type Figure =
    | string
    | {
        value: number;
        format: (n: number) => string;
        /**
         * The whole this figure is part of. Shown beside it so a count is never
         * read as the population when it is a subset of it.
         */
        outOf?: number;
      };

  function kpi(label: string, value: Figure, secondLabel: string, secondValue: Figure): void {
    set('headline-label', label);
    figure('headline', value);
    set('second-label', secondLabel);
    figure('second', secondValue);
  }

  function figure(key: string, value: Figure): void {
    const node = container.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (!node) return;

    const outOf = container.querySelector<HTMLElement>(`[data-k="${key}-of"]`);
    if (outOf) {
      // "301 of 301" says nothing twice, so the whole only appears when the
      // figure is genuinely a part of it.
      const whole = typeof value === 'string' ? undefined : value.outOf;
      const show = whole !== undefined && whole !== (typeof value === 'string' ? -1 : value.value);
      outOf.hidden = !show;
      outOf.textContent = show ? `of ${formatCount(whole)}` : '';
    }

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
    say(error instanceof Error ? error.message : String(error));
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

    attrList.querySelectorAll('.attr').forEach((item) => {
      item.classList.toggle('on', item.textContent?.includes(primary?.name ?? '\u0000') === true);
    });

    // Charting from a record is a request for that chart, so it lands on the
    // chart rather than on the list it was picked from. Before the render, so
    // it appears in the right pane while it computes.
    if (closesOnPick(lane)) narrowOpen = false;
    applyRail(true);

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
      say('Pick an attribute to chart it.', true);
      return;
    }

    attrList.querySelectorAll('.attr').forEach((item) => {
      item.classList.toggle('on', item.textContent?.includes(primary?.name ?? '\u0000') === true);
    });
    // A shared link describes a chart, not a device: where the panels take
    // turns it opens on the chart it names, and where both fit the reader's own
    // remembered choice stands, because the rail is theirs and not the
    // sender's. No focus move — nobody gestured.
    if (closesOnPick(lane)) narrowOpen = false;
    applyRail();
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
      document.removeEventListener('keydown', onRailEscape);
      stopLane();
      unsubscribe();
      objectTable?.destroy();
      teardownPlot?.();
      generation += 1;
      container.replaceChildren();
    },
  };
}
