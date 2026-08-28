import type { UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { fetchDetail, type Detail } from '../data/object-detail';
import { labelFor } from '../sdk/metamodel';
import { busy } from './busy';
import { must } from './dom';
import { overlayHost } from './overlay';
import { attributeIcon } from './icons';
import { formatCount, formatMoneyExact } from '../format';

/** Kinds the attribute view knows how to draw. */
const CHARTABLE = new Set(['enum', 'boolean', 'integer', 'real', 'money', 'date', 'string', 'text']);

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

    current = detail;
    kind.textContent = labelFor(detail.type);
    name.textContent = detail.name;
    body.replaceChildren(...render(detail));
  }

  function render(detail: Detail): HTMLElement[] {
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

    for (const group of detail.groups) {
      const list = document.createElement('ul');
      list.className = 'facts';

      for (const value of group.values) {
        const chartable = CHARTABLE.has(value.kind);
        // The whole row is the target when there is one. An inline button after
        // each label put a control at a different horizontal position on every
        // row and broke the column the names read down.
        const row = document.createElement(chartable ? 'button' : 'div');
        row.className = chartable ? 'fact chartable' : 'fact';

        if (row instanceof HTMLButtonElement) {
          row.type = 'button';
          row.setAttribute(
            'aria-label',
            `Chart ${value.name} across ${labelFor(detail.type)}`,
          );
          row.addEventListener('click', () => {
            onChart(detail.type, value.categoryId, value.definitionId);
            close();
          });
        }

        const name = text('span', value.name);
        name.className = 'f-name';

        const shown = text(
          'span',
          value.numeric === undefined
            ? value.display
            : value.kind === 'money'
              ? formatMoneyExact(value.numeric, value.currency)
              : formatCount(value.numeric),
        );
        shown.className = 'f-value';

        row.append(attributeIcon(value.kind as never, value.currency), name, shown);
        if (chartable) {
          const go = text('span', '↗');
          go.className = 'f-go';
          go.setAttribute('aria-hidden', 'true');
          row.append(go);
        }

        const item = document.createElement('li');
        item.append(row);
        list.append(item);
      }

      blocks.push(section(group.category, list));
    }

    if (detail.emptyCount > 0) {
      blocks.push(
        note(
          `${formatCount(detail.emptyCount)} further attribute${detail.emptyCount === 1 ? '' : 's'} defined for this type but not set.`,
        ),
      );
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

function section(heading: string, content: HTMLElement): HTMLElement {
  const block = document.createElement('section');
  block.className = 'sheet-section';
  block.append(text('h3', heading), content);
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

function note(value: string): HTMLElement {
  const element = text('p', value);
  element.className = 'sheet-note';
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
