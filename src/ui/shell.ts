import type { ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { mountDetailSheet } from './detail-sheet';
import {
  decode,
  encode,
  pathOf,
  slimFilters,
  viewOf,
  type Analysis,
} from '../data/analysis';
import { RouteStack, sameRoute, type Route } from '../data/route';
import { mountSavedPanel } from './saved-panel';
import { createSavedStore } from '../data/saved';
import { FilterStore } from '../data/filter';
import {
  mountAttributeInsight,
  type AttributeInsight,
  type AttributeSnapshot,
} from '../viz/attribute-insight';
import { mountEgoNetwork, type EgoNetwork } from '../viz/ego-network';
import { mountTypeBars, type TypeBars } from '../viz/type-bars';
import { mountTypeSidebar, type TypeSidebar } from './type-sidebar';
import { labelFor, objectTypesFor } from '../sdk/metamodel';
import { must } from './dom';
import { busy } from './busy';
import { mountFilterBar } from './filter-bar';
import { forgetEnvironment } from '../sdk/runtime-config';
import { expireSession } from '../sdk/session-guard';
import { canShare, shareLink } from './share';
import { chevronIcon, controlsIcon, filterIcon, shareIcon } from './icons';

interface View {
  /**
   * Where the filter chips belong inside this view.
   *
   * The chips used to sit in a band above every view, which cost 66 points and
   * moved the chart down the moment a filter was set. Handing the view a place
   * to put them lets them scroll away with its content instead.
   */
  readonly filterHost?: HTMLElement;
  destroy(): void;
}

export function mountShell(root: HTMLElement, session: Session): void {
  root.innerHTML = `
    <header class="navbar">
      <button type="button" class="nav-back" hidden><span class="back-label"></span></button>
      <div class="nav-heading">
        <button type="button" class="nav-title" aria-haspopup="false">
          <span class="title-text"></span>
        </button>
        <p class="nav-sub"></p>
      </div>
      <div class="nav-trailing">
        <div class="saved-host"></div>
      </div>
    </header>
    <p class="notice" hidden></p>
    <div class="progress" role="status" aria-live="polite"><span></span></div>
    <div class="shell-body">
      <aside class="type-rail" hidden></aside>
      <main class="pane"></main>
    </div>
    <nav class="toolbar" aria-label="Actions">
      <button type="button" class="tool" data-act="filter">
        <span class="tool-label">Filter</span><span class="tool-count" hidden></span>
      </button>
      <button type="button" class="tool primary" data-act="options" hidden>
        <span class="tool-label">Chart options</span>
      </button>
      <button type="button" class="tool" data-act="share">
        <span class="tool-label">Share</span>
      </button>
    </nav>
  `;

  const pane = must(root.querySelector<HTMLElement>('main.pane'), 'shell: pane');
  const typeRail = must(root.querySelector<HTMLElement>('.type-rail'), 'shell: type rail');
  const navBack = must(root.querySelector<HTMLButtonElement>('.nav-back'), 'shell: back');
  const navTitle = must(root.querySelector<HTMLButtonElement>('.nav-title'), 'shell: title');
  const navSub = must(root.querySelector<HTMLElement>('.nav-sub'), 'shell: subtitle');
  const toolbar = must(root.querySelector<HTMLElement>('nav.toolbar'), 'shell: toolbar');
  const filterButton = must(
    root.querySelector<HTMLButtonElement>('[data-act="filter"]'),
    'shell: filter button',
  );
  const filterCount = must(root.querySelector<HTMLElement>('.tool-count'), 'shell: filter count');
  const optionsButton = must(
    root.querySelector<HTMLButtonElement>('[data-act="options"]'),
    'shell: options button',
  );
  const shareButton = must(
    root.querySelector<HTMLButtonElement>('[data-act="share"]'),
    'shell: share button',
  );

  navBack.prepend(chevronIcon('back'));
  navTitle.append(chevronIcon('down'));
  filterButton.prepend(filterIcon());
  optionsButton.prepend(controlsIcon());
  shareButton.prepend(shareIcon());
  // Only the sheet is called "Share"; a clipboard copy should say so rather
  // than promise something the browser cannot do.
  if (!canShare()) {
    must(shareButton.querySelector<HTMLElement>('.tool-label'), 'shell: share label').textContent =
      'Copy link';
  }

  const progress = must(root.querySelector<HTMLElement>('.progress'), 'shell: progress');
  busy.subscribe((working) => {
    progress.classList.toggle('on', working);
    pane.setAttribute('aria-busy', String(working));
  });

  const notice = must(root.querySelector<HTMLElement>('.notice'), 'shell: notice');
  const filters = new FilterStore();
  const routes = new RouteStack();
  const types = objectTypesFor(session.metaModel);

  /** Detached until a view offers somewhere to put it. */
  const filterBar = document.createElement('div');
  filterBar.className = 'filters';
  const teardownFilterBar = mountFilterBar(filterBar, filters);

  /** True while state is being applied, so restoring does not rewrite the URL. */
  let restoring = false;
  /**
   * True while a view is being torn down and rebuilt.
   *
   * Mounting sets the type on the filter store, which notifies, which would
   * write the *new* screen over the history entry belonging to the old one —
   * and Back would land somewhere that no longer describes anything.
   */
  let settling = false;
  let noticeTimer: number | undefined;

  /** A transient line under the nav bar — used when the app changes state itself. */
  function showNotice(message: string): void {
    notice.hidden = false;
    notice.textContent = message;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice.hidden = true), 7000);
  }

  function currentAnalysis(): Analysis {
    const filter = filters.get();
    const chart = insightView?.snapshot();
    const path = routes.path;
    // Resolved once: testing `filter.type ?? chart?.type` narrows nothing about
    // the second evaluation of it.
    const type = filter.type ?? chart?.type;

    return {
      v: 1,
      env: session.label,
      view: viewOf(path),
      path,
      ...(type ? { type } : {}),
      ...(chart?.primary ? { primary: chart.primary } : {}),
      ...(chart?.secondary ? { secondary: chart.secondary } : {}),
      ...(chart?.mark ? { mark: chart.mark } : {}),
      ...(chart?.size ? { size: chart.size } : {}),
      ...(chart?.group ? { group: chart.group } : {}),
      ...(chart?.active ? { active: chart.active } : {}),
      ...(filter.attributes.length > 0 ? { filters: slimFilters(filter.attributes) } : {}),
    };
  }

  function linkFor(analysis: Analysis): string {
    const url = new URL(globalThis.location.href);
    url.search = `?a=${encode(analysis)}`;
    return url.toString();
  }

  shareButton.addEventListener('click', () => {
    void shareLink(
      linkFor(currentAnalysis()),
      'Unify Lens',
      `An analysis of ${session.label}`,
    ).then((outcome) => {
      if (outcome === 'copied') showNotice('Link copied. Anyone with it opens this same view.');
      if (outcome === 'failed') showNotice('Could not share that link.');
    });
  });

  filterButton.addEventListener('click', () => {
    // The chips are the control. Bringing them into view is what "Filter"
    // means here — there is nothing to configure that a chip does not carry.
    filterBar.classList.toggle('open');
    filterBar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  optionsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    insightView?.openOptions();
  });

  navTitle.addEventListener('click', (event) => {
    event.stopPropagation();
    // Only the attribute view has a title worth opening: it names the subject
    // of the screen, so tapping it is how the subject is changed.
    if (routes.current.at !== 'attributes') return;
    insightView?.openSubjects();
  });

  navBack.addEventListener('click', () => routes.pop());

  /**
   * Keeps the address bar describing what is on screen.
   *
   * Moving between screens pushes a history entry so Back means something;
   * everything else replaces, or adjusting a chart would bury the previous
   * screen under a dozen near-identical states.
   */
  function syncUrl(push = false): void {
    if (restoring || settling) return;
    const next = linkFor(currentAnalysis());
    if (next === globalThis.location.href) return;
    if (push) globalThis.history.pushState(null, '', next);
    else globalThis.history.replaceState(null, '', next);
  }

  async function applyAnalysis(analysis: Analysis): Promise<void> {
    if (analysis.env !== session.label) {
      notice.hidden = false;
      notice.textContent = `That link was built against ${analysis.env}; this session is connected to ${session.label}, where its filters would not resolve.`;
      return;
    }

    restoring = true;
    filters.restore({
      ...(analysis.type ? { type: analysis.type } : {}),
      attributes: analysis.filters ?? [],
    });
    routes.restore(pathOf(analysis, () => types[0]));
    mountCurrent();

    // The flag has to outlive the *asynchronous* part of the restore, or the
    // chart's own state change rewrites the URL while it is still being applied.
    await insightView?.restore({
      ...(analysis.type ? { type: analysis.type } : {}),
      ...(analysis.primary ? { primary: analysis.primary } : {}),
      ...(analysis.secondary ? { secondary: analysis.secondary } : {}),
      ...(analysis.mark ? { mark: analysis.mark } : {}),
      ...(analysis.size ? { size: analysis.size } : {}),
      ...(analysis.group ? { group: analysis.group } : {}),
      ...(analysis.active ? { active: analysis.active } : {}),
    });
    restoring = false;
    syncUrl();
  }

  mountSavedPanel(
    must(root.querySelector<HTMLElement>('.saved-host'), 'shell: saved host'),
    currentAnalysis,
    (analysis) => void applyAnalysis(analysis),
    linkFor,
    createSavedStore(session),
    session,
    session.label,
    () => void endSession({ forgetEnvironment: false }),
    () => void endSession({ forgetEnvironment: true }),
  );

  /**
   * Leaves the current session, and optionally the environment with it.
   *
   * Both land on a bare URL rather than reloading in place: the analysis in the
   * query belongs to the session being left, and restoring it on the way back
   * in would put someone straight back where they were told they no longer are.
   *
   * Signing out is best effort. A failure there still means someone asked to
   * leave, and the tokens are discarded either way — refusing to go because the
   * server did not answer would be the wrong way round.
   */
  async function endSession(options: { forgetEnvironment: boolean }): Promise<void> {
    try {
      await session.sdk.authClient.logout();
    } catch {
      // Already gone, or unreachable. The local state below is what matters.
    }
    expireSession();
    if (options.forgetEnvironment) forgetEnvironment();

    const home = new URL(globalThis.location.href);
    home.search = '';
    globalThis.location.replace(home.toString());
  }

  globalThis.addEventListener('popstate', () => {
    const analysis = decode(new URL(globalThis.location.href).searchParams.get('a') ?? '');
    if (analysis) void applyAnalysis(analysis);
  });

  filters.subscribe(() => {
    renderChrome();
    syncUrl();
  });

  let view: View | null = null;
  /** The route the mounted view was built for; null before the first mount. */
  let mounted: Route | null = null;
  /** Set when the record sheet asks for an attribute to be charted. */
  let pendingChart: { objectType: string; categoryId: string; definitionId: string } | null = null;
  let insightView: AttributeInsight | null = null;
  let typeSidebar: TypeSidebar | null = null;

  /**
   * What each attribute screen had charted when it was left.
   *
   * This is the difference between a stack and a tab bar. Going deeper and
   * coming back should return the screen you left, not a blank one — and
   * without this, following a record into the graph and pressing Back costs
   * you the chart you were reading, which is the whole reason you went.
   *
   * Keyed by route rather than held as one value, so two types explored in the
   * same session each keep their own chart.
   */
  const charts = new Map<string, AttributeSnapshot>();

  /**
   * Wide enough to show the level above the current one as a column.
   *
   * Below it the trail collapses and Back is how you get there; above it both
   * levels are on screen, so Back would offer to reveal something already
   * visible.
   */
  const wide = globalThis.matchMedia('(min-width: 900px)');
  wide.addEventListener('change', () => {
    renderColumns();
    renderChrome();
  });

  /**
   * Shows or hides the population column for the current route.
   *
   * Only the attribute screen has a level above it worth a column: the
   * population is the root and has none, and the network lens is a canvas that
   * gives its space to the graph.
   */
  function renderColumns(): void {
    const show = wide.matches && routes.current.at === 'attributes';
    typeRail.hidden = !show;

    if (!show) {
      typeSidebar?.destroy();
      typeSidebar = null;
      return;
    }

    const type = routes.current.at === 'attributes' ? routes.current.type : undefined;
    if (typeSidebar) {
      typeSidebar.setCurrent(type);
      return;
    }

    typeSidebar = mountTypeSidebar(typeRail, session, type, (picked) => {
      // Sideways, not deeper: the column is showing the level this screen was
      // reached from, so choosing another entry swaps this screen for its
      // sibling rather than stacking a second one on top.
      routes.replace({ at: 'attributes', type: picked });
    });
  }

  const sheet = mountDetailSheet(
    session,
    (id, name, type) => routes.push({ at: 'network', focus: { id, name, type } }),
    (objectType, categoryId, definitionId) => {
      // Already charting this type: hand it straight over. Otherwise the chart
      // belongs to a different screen, so go to that screen and let it pick the
      // request up as it mounts.
      const current = routes.current;
      if (insightView && current.at === 'attributes' && current.type === objectType) {
        insightView.chart(objectType, categoryId, definitionId);
        return;
      }
      pendingChart = { objectType, categoryId, definitionId };
      routes.push({ at: 'attributes', type: objectType as ObjectType });
    },
  );

  routes.subscribe((path, change) => {
    // Popping to the root is where a question ends. The filters belonged to the
    // question being left, and the type filter does not even apply to the
    // population view, so it would sit there looking as though it did.
    if (change === 'pop' && path.length === 1) filters.clear();

    mountCurrent();
    if (change !== 'restore') syncUrl(change === 'push' || change === 'pop');
  });

  /** The name a screen goes by — in its own title, and in a back button. */
  function labelOf(route: Route): string {
    switch (route.at) {
      case 'population':
        return 'Population';
      case 'attributes':
        return labelFor(route.type);
      case 'network':
        return route.focus?.name || (route.type ? labelFor(route.type) : 'Network');
    }
  }

  function renderChrome(): void {
    const route = routes.current;
    const parent = routes.parent;

    // A back button that reveals something already on screen is a control that
    // appears to do nothing.
    navBack.hidden = parent === undefined || !typeRail.hidden;
    if (parent) {
      const label = labelOf(parent);
      must(navBack.querySelector<HTMLElement>('.back-label'), 'shell: back label').textContent =
        label;
      navBack.setAttribute('aria-label', `Back to ${label}`);
    }

    // On the attribute screen the title *is* the subject being charted, so it
    // opens the attribute list. Everywhere else it only names the screen.
    const openable = route.at === 'attributes';
    navTitle.classList.toggle('menu', openable);
    navTitle.disabled = !openable;
    navTitle.setAttribute('aria-haspopup', openable ? 'menu' : 'false');
    // The title is the only control for the attribute panel, so it is the
    // thing that has to report whether the panel is showing.
    navTitle.setAttribute(
      'aria-expanded',
      openable ? String(insightView?.subjectsOpen() ?? false) : 'false',
    );

    const subject = openable ? insightView?.subject() : null;
    must(navTitle.querySelector<HTMLElement>('.title-text'), 'shell: title text').textContent =
      openable ? (subject ?? 'Attribute') : labelOf(route);

    navSub.textContent = subtitleFor(route);
    navSub.hidden = navSub.textContent === '';

    optionsButton.hidden = route.at !== 'attributes';
    // With the primary in the bar there is no room on a phone for three sets of
    // words; without it there is room for two.
    toolbar.classList.toggle('crowded', !optionsButton.hidden);
    // Over the canvas the toolbar floats rather than standing on the graph —
    // hiding it outright would put Share out of reach on the one view most
    // worth sharing.
    toolbar.classList.toggle('floating', route.at === 'network');

    const count = filters.get().attributes.length;
    filterCount.hidden = count === 0;
    filterCount.textContent = String(count);
    filterButton.classList.toggle('on', count > 0);
    // Filters are created by tapping a bar, never from here — so with none set
    // this button has nothing to show and says so by being unavailable.
    filterButton.disabled = count === 0;
  }

  function subtitleFor(route: Route): string {
    switch (route.at) {
      case 'population':
        // Not the environment. Which instance you are connected to is a
        // once-a-quarter fact, and it was being repeated under the title of
        // the screen you spend the most time on — where a long host name also
        // crowded the bar it sat in. It is named in More, beside signing out,
        // which is where you would go to change it.
        return '';
      case 'attributes':
        return labelFor(route.type);
      case 'network':
        // The focus carries its raw type id; the subtitle is for a reader.
        return route.focus ? labelFor(route.focus.type as ObjectType) : '';
    }
  }

  /**
   * Puts the current route's view on screen, reusing what is already there.
   *
   * Called for every stack change, including ones that leave the top of the
   * stack alone — restoring a trail whose deepest screen is the one already
   * mounted should not tear that screen down and rebuild it.
   */
  /** A stable identity for a route, for keying what it had on screen. */
  function keyOf(route: Route): string {
    return route.at === 'attributes' ? `attributes:${route.type}` : route.at;
  }

  function mountCurrent(): void {
    const route = routes.current;

    if (mounted && sameRoute(mounted, route)) {
      renderChrome();
      return;
    }

    // Before the outgoing view is destroyed and its state with it.
    if (mounted?.at === 'attributes' && insightView) {
      charts.set(keyOf(mounted), insightView.snapshot());
    }

    mounted = route;
    settling = true;

    // Every view reads the type from the filter store, so the route has to have
    // set it before anything mounts and asks.
    filters.setType(route.at === 'population' ? undefined : route.type);

    view?.destroy();
    view = null;
    insightView = null;
    filterBar.remove();
    pane.replaceChildren();
    pane.dataset['at'] = route.at;
    // The shell paints differently for the canvas lens — the bar floats over
    // it rather than standing on it — and that is a decision about the whole
    // shell, not about the pane.
    root.dataset['at'] = route.at;

    switch (route.at) {
      case 'population': {
        const bars: TypeBars = mountTypeBars(pane, session, filters, (type) =>
          // Picking a type is a question about that type's data, so it lands on
          // the attribute view. The graph is reached from a record instead.
          routes.push({ at: 'attributes', type }),
        );
        view = bars;
        break;
      }
      case 'attributes': {
        const insight: AttributeInsight = mountAttributeInsight(
          pane,
          session,
          filters,
          (id) => sheet.open(id),
          () => {
            renderChrome();
            syncUrl();
          },
          showNotice,
        );
        view = insight;
        insightView = insight;
        if (pendingChart) {
          const { objectType, categoryId, definitionId } = pendingChart;
          pendingChart = null;
          insight.chart(objectType, categoryId, definitionId);
          break;
        }
        // An explicit request beats a remembered one: someone asking for a
        // particular attribute did not ask to come back to where they were.
        const remembered = charts.get(keyOf(route));
        if (remembered) void insight.restore(remembered);
        break;
      }
      case 'network': {
        const network: EgoNetwork = mountEgoNetwork(pane, session, filters);
        view = network;
        if (route.focus) {
          const { id, name, type } = route.focus;
          void network.focusObject(id, name, type);
          break;
        }
        if (route.type) void network.focusType(route.type);
        break;
      }
    }

    if (view?.filterHost) view.filterHost.prepend(filterBar);
    settling = false;
    renderColumns();
    renderChrome();
  }

  const opening = decode(new URL(globalThis.location.href).searchParams.get('a') ?? '');
  if (opening) {
    void applyAnalysis(opening);
  } else {
    mountCurrent();
  }

  // Nothing tears the shell down today, but the filter bar owns a subscription
  // and a detached node; leaving it unreachable would leak both.
  globalThis.addEventListener('pagehide', () => teardownFilterBar(), { once: true });
}
