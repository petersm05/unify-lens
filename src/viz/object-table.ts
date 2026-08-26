import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';

import {
  columnFor,
  CREATED_COLUMN,
  fetchTable,
  NAME_COLUMN,
  type Column,
} from '../data/object-table';
import { equalsCondition, SAMPLE_LIMIT, type AttributeChoice } from '../data/attributes';
import { scopeFor, type FilterStore } from '../data/filter';
import { onContextRequest, showContextMenu } from '../ui/context-menu';
import { busy } from '../ui/busy';
import { must } from '../ui/dom';
import { attributeIcon, controlsIcon } from '../ui/icons';
import { formatCompact, formatCount, formatMoney } from './theme';

export interface ObjectTable {
  /** Keeps a column for the attribute currently being charted. */
  setFocus(choice: AttributeChoice | null): void;
  refresh(): void;
  destroy(): void;
}

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 280;

/**
 * The objects behind the current filter.
 *
 * Once a slice is selected, a table of bucket counts is answering a question
 * nobody is asking any more — "which objects are these?" is. Columns are added
 * from the same attribute schema the charts use, and sorting goes to the server
 * wherever the server can be trusted to order that column correctly.
 */
export function mountObjectTable(
  host: HTMLElement,
  session: Session,
  filters: FilterStore,
  getContext: () => { type: ObjectType; attributes: readonly AttributeChoice[] },
  openDetail: (id: UUID) => void,
): ObjectTable {
  host.innerHTML = `
    <section class="objects">
      <div class="objects-head">
        <h2>Objects in this selection</h2>
        <div class="objects-tools">
          <input type="search" class="obj-search" placeholder="Search these objects…"
                 aria-label="Search objects in this selection" autocomplete="off" />
          <details class="col-picker">
            <summary><span class="picker-label">Columns</span></summary>
            <div class="col-list"></div>
          </details>
        </div>
      </div>
      <p class="sub" data-k="objects-note" hidden></p>
      <div class="table-scroll"><table class="data objects-table">
        <thead><tr></tr></thead>
        <tbody></tbody>
      </table></div>
      <div class="pager">
        <button type="button" data-act="prev">Previous</button>
        <span class="pager-state"></span>
        <button type="button" data-act="next">Next</button>
      </div>
    </section>
  `;

  const search = must(host.querySelector<HTMLInputElement>('.obj-search'), 'objects: search');
  const colList = must(host.querySelector<HTMLElement>('.col-list'), 'objects: columns');
  // Same glyph as the chart options menu: both open a panel that configures
  // what the view shows, so they should read as the same kind of control.
  must(host.querySelector<HTMLElement>('.col-picker summary'), 'objects: picker').prepend(
    controlsIcon(),
  );
  const headRow = must(host.querySelector<HTMLElement>('thead tr'), 'objects: head');
  const body = must(host.querySelector<HTMLElement>('tbody'), 'objects: body');
  const note = must(host.querySelector<HTMLElement>('[data-k="objects-note"]'), 'objects: note');
  const pagerState = must(host.querySelector<HTMLElement>('.pager-state'), 'objects: pager');
  const prev = must(host.querySelector<HTMLButtonElement>('[data-act="prev"]'), 'objects: prev');
  const next = must(host.querySelector<HTMLButtonElement>('[data-act="next"]'), 'objects: next');

  // No Type column: the table is always scoped to a single object type, so it
  // would repeat one value down every row. Created is opt-in and always last —
  // a record date is provenance, not something you read a table for.
  let attributeColumns: Column[] = [];
  let showCreated = false;
  let focusKey: string | null = null;

  const columnsNow = (): Column[] => [
    NAME_COLUMN,
    ...attributeColumns,
    ...(showCreated ? [CREATED_COLUMN] : []),
  ];
  let sortKey = NAME_COLUMN.key;
  let descending = false;
  let page = 0;
  let term = '';
  let generation = 0;
  let debounce: number | undefined;

  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      term = search.value.trim();
      page = 0;
      void load();
    }, DEBOUNCE_MS);
  });

  prev.addEventListener('click', () => {
    if (page > 0) {
      page -= 1;
      void load();
    }
  });
  next.addEventListener('click', () => {
    page += 1;
    void load();
  });

  const unsubscribe = filters.subscribe(() => {
    page = 0;
    void load();
  });

  function buildColumnPicker(): void {
    const { attributes } = getContext();

    const created = document.createElement('label');
    created.className = 'col-option';
    const createdBox = document.createElement('input');
    createdBox.type = 'checkbox';
    createdBox.checked = showCreated;
    createdBox.addEventListener('change', () => {
      showCreated = createdBox.checked;
      if (!showCreated && sortKey === CREATED_COLUMN.key) {
        sortKey = NAME_COLUMN.key;
        descending = false;
      }
      void load();
    });
    created.append(createdBox, document.createElement('span'), text('Created'));

    colList.replaceChildren(
      created,
      divider(),
      ...attributes.map((choice) => {
        const column = columnFor(choice);
        const row = document.createElement('label');
        row.className = 'col-option';

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = attributeColumns.some((existing) => existing.key === column.key);
        box.addEventListener('change', () => {
          attributeColumns = box.checked
            ? [...attributeColumns, column]
            : attributeColumns.filter((existing) => existing.key !== column.key);
          if (!columnsNow().some((existing) => existing.key === sortKey)) {
            sortKey = NAME_COLUMN.key;
            descending = false;
          }
          void load();
        });

        const text = document.createElement('span');
        text.textContent = choice.name;

        row.append(box, attributeIcon(choice.kind, choice.currency), text);
        return row;
      }),
    );
  }

  async function load(): Promise<void> {
    const mine = ++generation;
    const { type } = getContext();
    const columns = columnsNow();

    const result = await busy.track(
      fetchTable(session.kg, session.sample, {
        type,
        scope: scopeFor(filters.get()),
        searchTerm: term,
        columns,
        sortKey,
        descending,
        page,
        pageSize: PAGE_SIZE,
      }),
    );
    if (mine !== generation) return;

    headRow.replaceChildren(
      ...columns.map((column) => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.className = column.numeric ? 'num' : '';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sort';
        button.textContent = column.label;
        if (column.key === sortKey) {
          button.classList.add('on');
          button.append(descending ? ' ↓' : ' ↑');
          cell.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
        }
        button.addEventListener('click', () => {
          if (sortKey === column.key) {
            descending = !descending;
          } else {
            sortKey = column.key;
            descending = column.numeric;
          }
          page = 0;
          void load();
        });

        cell.append(button);
        return cell;
      }),
    );

    body.replaceChildren(
      ...result.rows.map((row) => {
        const tr = document.createElement('tr');
        tr.className = 'pickable';
        tr.tabIndex = 0;
        tr.addEventListener('click', () => openDetail(row.id));
        for (const column of columns) {
          const td = document.createElement('td');
          td.className = column.numeric ? 'num' : '';
          td.textContent = cellText(column, row.raw[column.key], row.cells[column.key]);
          // Right-click, or long-press on a tablet, narrows to or excludes the
          // value under the pointer — the fastest route from "I see this" to
          // "show me only this".
          if (column.choice) {
            const choice = column.choice;
            const raw = row.raw[column.key];
            onContextRequest(td, (x, y) => offerCellFilters(x, y, choice, raw));
          }
          tr.append(td);
        }
        return tr;
      }),
    );

    // Only say something when it changes how the table should be read. Where
    // the work happened is not the reader's problem; an incomplete ranking is.
    const incomplete = result.sortedBy === 'sample' && result.truncated;
    note.hidden = !incomplete;
    note.textContent = incomplete
      ? `Ranked from the first ${formatCount(SAMPLE_LIMIT)} objects, so this order may not be complete.`
      : '';

    const from = result.total === 0 ? 0 : page * PAGE_SIZE + 1;
    const to = Math.min((page + 1) * PAGE_SIZE, result.total);
    pagerState.textContent = `${formatCount(from)}–${formatCount(to)} of ${formatCount(result.total)}`;
    prev.disabled = page === 0;
    next.disabled = to >= result.total;

    buildColumnPicker();
  }

  /** Menu for one cell: keep this value, or drop it. */
  function offerCellFilters(x: number, y: number, choice: AttributeChoice, raw: unknown): void {
    const condition = equalsCondition(choice, raw);
    if (!condition) return;

    const shown = raw === undefined || raw === null || raw === '' ? '—' : String(raw);
    const select = (label: string, binLabel: string, applied: typeof condition): void => {
      filters.select({ choice, label, binLabel, condition: applied });
    };

    showContextMenu(x, y, [
      {
        label: `Only ${shown}`,
        onPick: () => select(`${choice.name}: ${shown}`, shown, condition),
      },
      {
        label: `Exclude ${shown}`,
        // `not` wraps the same condition, so the two options stay in sync.
        onPick: () => select(`${choice.name}: not ${shown}`, `not ${shown}`, { not: condition }),
      },
    ]);
  }

  function text(value: string): HTMLElement {
    const span = document.createElement('span');
    span.textContent = value;
    return span;
  }

  function divider(): HTMLElement {
    const line = document.createElement('div');
    line.className = 'col-divider';
    return line;
  }

  /** Numbers are formatted for reading; the raw value stays the sort key. */
  function cellText(column: Column, raw: unknown, fallback: string | undefined): string {
    if (typeof raw !== 'number' || !column.numeric) return fallback ?? '—';
    return column.choice?.kind === 'money'
      ? formatMoney(raw, column.choice.currency)
      : formatCompact(raw);
  }

  void load();

  return {
    /**
     * Shows the attribute in focus as a column, replacing whichever attribute
     * was in focus before — so the table opens on the values being charted
     * without anyone opening the column picker, and columns added by hand are
     * left alone.
     */
    setFocus(choice: AttributeChoice | null): void {
      const column = choice ? columnFor(choice) : null;
      if (column?.key === focusKey) return;

      const kept = attributeColumns.filter((existing) => existing.key !== focusKey);
      attributeColumns =
        column && !kept.some((existing) => existing.key === column.key) ? [...kept, column] : kept;
      focusKey = column?.key ?? null;

      if (!columnsNow().some((existing) => existing.key === sortKey)) {
        sortKey = NAME_COLUMN.key;
        descending = false;
      }
      page = 0;
      void load();
    },

    refresh(): void {
      page = 0;
      void load();
    },
    destroy(): void {
      window.clearTimeout(debounce);
      unsubscribe();
      generation += 1;
      host.replaceChildren();
    },
  };
}
