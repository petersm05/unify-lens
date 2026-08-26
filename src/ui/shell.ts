import type { UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { mountDetailSheet } from './detail-sheet';
import { decode, encode, slimFilters, type Analysis } from '../data/analysis';
import { mountSavedPanel } from './saved-panel';
import { FilterStore } from '../data/filter';
import { mountAttributeInsight, type AttributeInsight } from '../viz/attribute-insight';
import { mountEgoNetwork, type EgoNetwork } from '../viz/ego-network';
import { mountTypeBars, type TypeBars } from '../viz/type-bars';
import { must } from './dom';
import { busy } from './busy';
import { mountFilterBar } from './filter-bar';
import { canShare, shareLink } from './share';
import { shareIcon } from './icons';

type ViewId = 'population' | 'attributes' | 'network';

const TABS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'population', label: 'Population' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'network', label: 'Network' },
];

interface View {
  destroy(): void;
}

export function mountShell(root: HTMLElement, session: Session): void {
  root.innerHTML = `
    <header class="bar">
      <h1>Unify Lens</h1>
      <button type="button" class="share-btn">Share</button>
      <div class="saved-host"></div>
    </header>
    <p class="notice" hidden></p>
    <nav class="tabs" role="tablist"></nav>
    <div class="progress" role="status" aria-live="polite"><span></span></div>
    <div class="filters"></div>
    <main class="pane"></main>
  `;

  const tabs = must(root.querySelector<HTMLElement>('nav.tabs'), 'shell: tabs');
  const filterSlot = must(root.querySelector<HTMLElement>('.filters'), 'shell: filters');
  const pane = must(root.querySelector<HTMLElement>('main.pane'), 'shell: pane');

  const progress = must(root.querySelector<HTMLElement>('.progress'), 'shell: progress');
  busy.subscribe((working) => {
    progress.classList.toggle('on', working);
    pane.setAttribute('aria-busy', String(working));
  });

  const notice = must(root.querySelector<HTMLElement>('.notice'), 'shell: notice');
  const filters = new FilterStore();
  mountFilterBar(filterSlot, filters);

  /** True while state is being applied, so restoring does not rewrite the URL. */
  let restoring = false;
  let noticeTimer: number | undefined;

  /** A transient line under the tabs — used when the app changes state itself. */
  function showNotice(message: string): void {
    notice.hidden = false;
    notice.textContent = message;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice.hidden = true), 7000);
  }

  function currentAnalysis(): Analysis {
    const filter = filters.get();
    const chart = insightView?.snapshot();
    return {
      v: 1,
      env: session.label,
      view: current ?? 'population',
      ...(filter.type ?? chart?.type ? { type: filter.type ?? chart?.type } : {}),
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

  const share = must(root.querySelector<HTMLButtonElement>('.share-btn'), 'shell: share');
  share.prepend(shareIcon());
  // Only the sheet is called "Share"; a clipboard copy should say so rather
  // than promise something the browser cannot do.
  if (!canShare()) share.lastChild!.textContent = 'Copy link';
  share.addEventListener('click', () => {
    void shareLink(
      linkFor(currentAnalysis()),
      'Unify Lens',
      `An analysis of ${session.label}`,
    ).then((outcome) => {
      if (outcome === 'copied') showNotice('Link copied. Anyone with it opens this same view.');
      if (outcome === 'failed') showNotice('Could not share that link.');
    });
  });

  /**
   * Keeps the address bar describing what is on screen.
   *
   * Coarse moves — changing view — push a history entry so Back means something;
   * everything else replaces, or adjusting a chart would bury the previous
   * screen under a dozen near-identical states.
   */
  function syncUrl(push = false): void {
    if (restoring) return;
    const analysis = currentAnalysis();
    const next = linkFor(analysis);
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
    show(analysis.view);

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
    session.label,
  );

  globalThis.addEventListener('popstate', () => {
    const analysis = decode(new URL(globalThis.location.href).searchParams.get('a') ?? '');
    if (analysis) void applyAnalysis(analysis);
  });

  filters.subscribe(() => syncUrl());

  let current: ViewId | null = null;
  let view: View | null = null;
  /** Set when the sheet asks for an object to be shown in the graph. */
  let pendingObject: { id: UUID; name: string; type: string } | null = null;
  /** Set when the record sheet asks for an attribute to be charted. */
  let pendingChart: { objectType: string; categoryId: string; definitionId: string } | null = null;
  let insightView: AttributeInsight | null = null;

  const sheet = mountDetailSheet(
    session,
    (id, name, type) => {
      pendingObject = { id, name, type };
      show('network');
    },
    (objectType, categoryId, definitionId) => {
      // Already on the attribute view: hand it straight over. Otherwise stash
      // it for the view to pick up once it mounts.
      if (insightView) {
        insightView.chart(objectType, categoryId, definitionId);
        return;
      }
      pendingChart = { objectType, categoryId, definitionId };
      show('attributes');
    },
  );

  tabs.replaceChildren(
    ...TABS.map((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.role = 'tab';
      button.textContent = tab.label;
      button.addEventListener('click', () => show(tab.id, true));
      return button;
    }),
  );

  /**
   * @param fresh - whether to drop the current filters. Set when someone picks
   *   a tab, because reaching for a tab is starting a new question rather than
   *   carrying the last one over — and the type filter does not even apply to
   *   the population view, so it sat there looking like it did. Left off for
   *   navigation the app performs itself: picking a type, charting an attribute
   *   from a record and restoring a shared analysis all set a filter and *then*
   *   move, so clearing would discard what they had just chosen.
   */
  function show(next: ViewId, fresh = false): void {
    if (current === next) return;
    current = next;

    tabs.querySelectorAll('button').forEach((button, index) => {
      button.setAttribute('aria-selected', String(TABS[index]?.id === next));
    });

    view?.destroy();
    view = null;
    insightView = null;
    pane.replaceChildren();

    // After the outgoing view is gone, so its subscription does not answer a
    // change it is about to be destroyed over, and before the URL is written so
    // that what gets pushed is the state actually arrived at.
    if (fresh) filters.clear();

    // A view change is a step worth going Back to.
    syncUrl(true);

    switch (next) {
      case 'population': {
        const bars: TypeBars = mountTypeBars(pane, session, filters, (type) => {
          filters.setType(type);
          // Picking a type is a question about that type's data, so it lands on
          // the attribute view. The graph is reached from search instead.
          show('attributes');
        });
        view = bars;
        break;
      }
      case 'attributes': {
        const insight: AttributeInsight = mountAttributeInsight(
          pane,
          session,
          filters,
          (id) => sheet.open(id),
          () => syncUrl(),
          showNotice,
        );
        view = insight;
        insightView = insight;
        if (pendingChart) {
          const { objectType, categoryId, definitionId } = pendingChart;
          pendingChart = null;
          insight.chart(objectType, categoryId, definitionId);
        }
        break;
      }
      case 'network': {
        const network: EgoNetwork = mountEgoNetwork(pane, session, filters);
        view = network;
        if (pendingObject) {
          const { id, name, type } = pendingObject;
          pendingObject = null;
          void network.focusObject(id, name, type);
          break;
        }
        const type = filters.get().type;
        if (type) void network.focusType(type);
        break;
      }
    }
  }

  const opening = decode(new URL(globalThis.location.href).searchParams.get('a') ?? '');
  if (opening) {
    void applyAnalysis(opening);
  } else {
    show('population');
  }
}
