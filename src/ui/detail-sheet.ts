import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { fetchDetail, type Detail } from '../data/object-detail';
import { attributesForCached } from '../data/schema-cache';
import { rowsFor, sampleKeyFor, type AttributeRow, type AttributeRowGroup } from '../data/attribute-rows';
import { peersFor, provenanceOf, valuesOf, type PeerMark, type Peers } from '../data/peers';
import type { Sample, Value } from '../data/sample-store';
import { labelFor } from '../sdk/metamodel';
import { busy } from './busy';
import { must } from './dom';
import { overlayHost } from './overlay';
import { attributeIcon } from './icons';
import { formatCount, formatMoneyExact } from '../format';

/** Kinds the attribute view knows how to draw. */
const CHARTABLE = new Set(['enum', 'boolean', 'integer', 'real', 'money', 'date', 'string', 'text']);

/**
 * `bars.ts` ramps an ordered scale only this far and then stops, so the peer
 * segments stop with it. Past six steps the ramp runs out of contrast, and one
 * enum value drawn terracotta here and accent-coloured in its own chart would
 * be worse than no ramp at all.
 */
const RAMP_STEPS = 6;

export interface DetailSheet {
  open(id: UUID): void;
  destroy(): void;
}

/**
 * Everything known about one object, as a slide-over.
 *
 * A sheet rather than a route: it opens over whatever you were reading, so the
 * chart or table that led you here is still there when it closes. Nothing in
 * the app navigates away from a selection.
 */
export function mountDetailSheet(
  session: Session,
  onShowInNetwork: (id: UUID, name: string, type: string) => void,
  onChart: (objectType: string, categoryId: string, definitionId: string) => void,
): DetailSheet {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <aside class="sheet" role="dialog" aria-modal="true" aria-label="Object details">
      <header class="sheet-head">
        <div>
          <p class="sheet-kind"></p>
          <h2 class="sheet-name"></h2>
        </div>
        <button type="button" class="sheet-close" aria-label="Close">✕</button>
      </header>
      <div class="sheet-body"></div>
      <footer class="sheet-foot">
        <button type="button" class="ghost" data-act="network">Show in network</button>
      </footer>
    </aside>
  `;
  overlayHost().append(backdrop);

  const sheet = must(backdrop.querySelector<HTMLElement>('.sheet'), 'sheet');
  const kind = must(backdrop.querySelector<HTMLElement>('.sheet-kind'), 'sheet kind');
  const name = must(backdrop.querySelector<HTMLElement>('.sheet-name'), 'sheet name');
  const body = must(backdrop.querySelector<HTMLElement>('.sheet-body'), 'sheet body');
  const network = must(backdrop.querySelector<HTMLButtonElement>('[data-act="network"]'), 'sheet action');

  let current: Detail | null = null;
  let generation = 0;

  const close = (): void => {
    backdrop.hidden = true;
    document.removeEventListener('keydown', onKey);
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('.sheet-close')?.addEventListener('click', close);
  network.addEventListener('click', () => {
    if (!current) return;
    onShowInNetwork(current.id, current.name, current.type);
    close();
  });

  async function load(id: UUID): Promise<void> {
    const mine = ++generation;
    backdrop.hidden = false;
    document.addEventListener('keydown', onKey);
    // The body is what scrolls; the sheet around it holds the head and foot
    // still. Both are reset because which one carries the scroll is a layout
    // decision, and this should not have to be revisited if it changes back.
    sheet.scrollTop = 0;
    body.scrollTop = 0;

    kind.textContent = '';
    name.textContent = 'Loading…';
    body.replaceChildren();

    const detail = await busy.track(fetchDetail(session.kg, id));
    if (mine !== generation) return;

    if (!detail) {
      name.textContent = 'Not found';
      return;
    }

    const type = detail.type as ObjectType;

    // The schema is what turns the count of unset attributes back into rows.
    // It comes off this device where it has been read before, so the sheet
    // waits for it rather than painting once without the empty rows and again
    // with them. Where it cannot be had, the sheet still lists what the object
    // carries — one less thing shown, rather than nothing.
    const choices = await attributesForCached(session.kg, type, session.stamp).catch(() => []);
    if (mine !== generation) return;

    current = detail;
    kind.textContent = labelFor(detail.type);
    name.textContent = detail.name;
    body.replaceChildren(
      ...render(detail, rowsFor(detail, choices), choices.length > 0, populationFor(type)),
    );
  }

  /**
   * The population the peer lines compare against, if one is already in hand.
   *
   * `peek` and not `get`: a sheet is one object, and pulling the whole estate
   * to decorate eight rows is the wrong trade on a tablet over cellular. Where
   * the Attributes view has already read the population — which is the usual
   * way anyone arrives here — it is free.
   *
   * Deliberately the *unfiltered* sample. `SampleStore` is keyed by type and
   * filter, so under a cross-filter the nearest sample describes the slice, and
   * "78% of 412" would be a different 412 from the one the reader has in mind.
   * Where only a filtered sample is cached there is no peer line, which is the
   * same thing the sheet does when there is no sample at all.
   */
  function populationFor(type: ObjectType): Sample | null {
    return session.sample.peek(type, undefined) ?? null;
  }

  function render(
    detail: Detail,
    groups: readonly AttributeRowGroup[],
    schemaKnown: boolean,
    population: Sample | null,
  ): HTMLElement[] {
    const blocks: HTMLElement[] = [];

    if (detail.description) {
      blocks.push(paragraph(detail.description));
    }

    const facts: Array<[string, string]> = [];
    if (detail.externalSource) {
      facts.push(['Source', `${detail.externalSource}${detail.externalId ? ` · ${detail.externalId}` : ''}`]);
    }
    if (detail.createdAt) facts.push(['Created', detail.createdAt.toLocaleDateString()]);
    if (detail.updatedAt) facts.push(['Updated', detail.updatedAt.toLocaleDateString()]);
    if (detail.labels.length > 0) facts.push(['Labels', detail.labels.join(', ')]);
    if (facts.length > 0) blocks.push(section('Record', factList(facts)));

    for (const group of groups) {
      const list = document.createElement('ul');
      list.className = 'facts';

      for (const row of group.rows) {
        const item = document.createElement('li');
        item.append(factRow(detail, row, population));
        list.append(item);
      }

      const block = document.createElement('section');
      block.className = 'sheet-section';
      // The count only where the schema answered. Without it the rows are
      // whatever the object happens to carry, so every one of them has a value
      // and "3 of 3 set" would be a count of what is on screen dressed up as a
      // count of what exists.
      block.append(
        headRow(
          group.category,
          schemaKnown
            ? `${formatCount(group.set)} of ${formatCount(group.rows.length)} set`
            : undefined,
        ),
        list,
      );
      blocks.push(block);
    }

    // Said once, at the foot of the attributes, because it qualifies every
    // figure above it rather than any one of them. Where a read stopped short,
    // every mark on the panel is a statement about a partial population.
    if (population && groups.length > 0) {
      const provenance = text('p', provenanceOf(population));
      provenance.className = 'peer-note';
      blocks.push(provenance);
    }

    for (const group of detail.related) {
      const list = document.createElement('ul');
      list.className = 'related';
      for (const object of group.objects) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'related-link';
        button.append(text('span', object.name), text('em', labelFor(object.type)));
        // Following a relation replaces the sheet's contents, so the graph can
        // be walked without leaving the object you started from.
        button.addEventListener('click', () => void load(object.id));
        item.append(button);
        list.append(item);
      }
      blocks.push(section(prettyRole(group.role), list));
    }

    if (detail.views.length > 0) {
      const list = document.createElement('ul');
      list.className = 'plain';
      for (const view of detail.views) list.append(text('li', view.name));
      blocks.push(section('Appears in', list));
    }

    return blocks;
  }

  function factRow(detail: Detail, row: AttributeRow, population: Sample | null): HTMLElement {
    const element = document.createElement('div');
    element.className = 'fact';

    const name = text('span', row.name);
    name.className = 'f-name';

    const shown = text('span', row.display === null ? 'Not set' : valueText(row));
    shown.className = row.display === null ? 'f-value unset' : 'f-value';
    // The row clamps a paragraph to two lines, so the rest of it has to be
    // reachable somehow until the editor can open on it.
    if (row.kind === 'text' && row.display !== null) shown.title = row.display;

    element.append(attributeIcon(row.kind, row.currency), name, shown);

    // Offered on an attribute the object has no value for as well: seeing that
    // this one is unset is the most common reason to want the chart of how
    // many others are.
    if (CHARTABLE.has(row.kind)) {
      const chart = document.createElement('button');
      chart.type = 'button';
      chart.className = 'f-chart';
      chart.textContent = '↗';
      chart.setAttribute('aria-label', `Chart ${row.name} across ${labelFor(detail.type)}`);
      chart.addEventListener('click', () => {
        onChart(detail.type, row.categoryId, row.definitionId);
        close();
      });
      element.append(chart);
    }

    const peers = population ? peersOf(row, population) : null;
    if (peers) element.append(peerLine(peers));

    return element;
  }

  function peersOf(row: AttributeRow, sample: Sample): Peers | null {
    const { values, missing } = valuesOf(sample, sampleKeyFor(row));
    return peersFor({
      kind: row.kind,
      values,
      missing,
      own: ownValue(row),
      truncated: sample.truncated,
      ...(row.order ? { order: row.order } : {}),
    });
  }

  /**
   * This object's value, in the terms the sample holds.
   *
   * An enum is compared by its display label, because that is what a read hands
   * back and so what the sample is keyed on — the opposite of the definition id
   * a filter or a write has to carry. Everything else is the typed value.
   */
  function ownValue(row: AttributeRow): Value | null {
    return row.kind === 'enum' ? row.display : row.value;
  }

  function peerLine(peers: Peers): HTMLElement {
    const line = document.createElement('span');
    line.className = 'peer';

    const caption = text('span', peers.caption);
    caption.className = 'cap';

    // The caption is the same figure in words, and sits beside it, so the mark
    // is not announced a second time.
    const mark = markElement(peers.mark);
    mark.setAttribute('aria-hidden', 'true');

    line.append(caption, mark);
    return line;
  }

  function markElement(mark: PeerMark): HTMLElement {
    if (mark.shape === 'steps') {
      const steps = document.createElement('span');
      steps.className = 'peer-steps';
      steps.style.gridTemplateColumns = `repeat(${mark.total}, 1fr)`;

      for (let index = 0; index < mark.total; index += 1) {
        const step = document.createElement('i');
        if (index === mark.index) {
          step.style.background =
            mark.total <= RAMP_STEPS ? `var(--ord-${index})` : 'var(--series-1)';
        }
        steps.append(step);
      }
      return steps;
    }

    const track = document.createElement('span');
    track.className = 'peer-track';

    const share = clamp(mark.shape === 'share' ? mark.share : mark.at);
    const fill = document.createElement('span');
    fill.className = 'fill';
    fill.style.width = `${share * 100}%`;
    track.append(fill);

    if (mark.shape === 'position') {
      const tick = document.createElement('span');
      tick.className = 'tick';
      // Half the marker's width, so it is centred on the position rather than
      // starting at it — at the ends that is the difference between the tick
      // sitting on the track and hanging off it.
      tick.style.left = `calc(${share * 100}% - 2px)`;
      track.append(tick);
    }
    return track;
  }

  return {
    open(id: UUID): void {
      void load(id).catch((error: unknown) => {
        name.textContent = error instanceof Error ? error.message : String(error);
      });
    },
    destroy(): void {
      generation += 1;
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    },
  };
}

/** The figure a row prints, formatted the way the rest of the app formats it. */
function valueText(row: AttributeRow): string {
  if (row.numeric === undefined) return row.display ?? '';
  return row.kind === 'money'
    ? formatMoneyExact(row.numeric, row.currency)
    : formatCount(row.numeric);
}

function clamp(share: number): number {
  return Math.min(1, Math.max(0, share));
}

/**
 * A section heading, with an optional figure ranged right against it.
 *
 * Every headed block in the sheet is built from this one, so they are all
 * ruled off the same way — the attribute categories gained a rule when they
 * gained a count beside the name, and a Record block without one would read as
 * a different kind of thing than it is.
 */
function headRow(heading: string, note?: string): HTMLElement {
  const head = document.createElement('div');
  head.className = 'cat-head';
  head.append(text('h3', heading));
  if (note !== undefined) head.append(text('em', note));
  return head;
}

function section(heading: string, content: HTMLElement): HTMLElement {
  const block = document.createElement('section');
  block.className = 'sheet-section';
  block.append(headRow(heading), content);
  return block;
}

function factList(entries: ReadonlyArray<[string, string]>): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'facts';
  for (const [term, value] of entries) {
    const row = document.createElement('div');
    row.className = 'fact plain-fact';
    const name = text('span', term);
    name.className = 'f-name';
    const shown = text('span', value);
    shown.className = 'f-value';
    row.append(name, shown);
    const item = document.createElement('li');
    item.append(row);
    list.append(item);
  }
  return list;
}

function paragraph(value: string): HTMLElement {
  const element = text('p', value);
  element.className = 'sheet-desc';
  return element;
}

function text(tag: string, value: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

/** `isParentOf` → `Is parent of`. */
function prettyRole(role: string): string {
  const spaced = role.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
