import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';

import { labelFor } from '../sdk/metamodel';
import { fetchTable } from '../data/object-table';
import { toDelimitedTable } from '../data/table-export';
import {
  columnFor,
  CREATED_COLUMN,
  foldCharted,
  NAME_COLUMN,
  type Column,
} from '../data/table-columns';
import { equalsCondition, SAMPLE_LIMIT, type AttributeChoice } from '../data/attributes';
import { scopeFor, type FilterStore } from '../data/filter';
import { onContextRequest, showContextMenu } from '../ui/context-menu';
import { busy } from '../ui/busy';
import { must } from '../ui/dom';
import { attributeIcon, controlsIcon, dragIcon } from '../ui/icons';
import { formatCompact, formatCount, formatMoney, sampledObjects } from './theme';

export interface ObjectTable {
  /**
   * Keeps a column for each attribute the chart is built from — both of them
   * where two are being compared.
   */
  setFocus(charted: readonly AttributeChoice[]): void;
  refresh(): void;
  destroy(): void;
}

const PAGE_SIZE = 25;
/**
 * How much a copy takes.
 *
 * The page on screen is 25 rows, which is not what anyone means by "copy this
 * table". The whole selection is, and `SAMPLE_LIMIT` is the ceiling the rest
 * of the app already reads to — past it the answer is a sample either way, and
 * the heading says so.
 */
const COPY_LIMIT = SAMPLE_LIMIT;
const COPIED_MS = 1_800;
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
          <button type="button" class="objects-copy">Copy</button>
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
  const copyButton = must(host.querySelector<HTMLButtonElement>('.objects-copy'), 'objects: copy');
  const prev = must(host.querySelector<HTMLButtonElement>('[data-act="prev"]'), 'objects: prev');
  const next = must(host.querySelector<HTMLButtonElement>('[data-act="next"]'), 'objects: next');

  // No Type column: the table is always scoped to a single object type, so it
  // would repeat one value down every row. Name stays first: it is the row's
  // identity and the click target, so a table that opened on some other column
  // would read as a list of values with no subject.
  let extraColumns: Column[] = [];
  /** Keys of the columns the current chart put there, and only those. */
  let fromChart: readonly string[] = [];
  /** Kept across rebuilds so a rebuild does not wipe what someone just typed. */
  let colTerm = '';

  const columnsNow = (): Column[] => [NAME_COLUMN, ...extraColumns];
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

  copyButton.addEventListener('click', () => {
    void copyTable();
  });

  const unsubscribe = filters.subscribe(() => {
    page = 0;
    void load();
  });

  /**
   * Which columns show, and in which order.
   *
   * Two lists rather than a row of checkboxes: order only means something once
   * the chosen columns are shown in their own order, and a checkbox cannot be
   * dragged. Search filters the "Add" list only — the shown list stays whole so
   * dragging never reorders against a partial view of it.
   */
  function buildColumnPicker(): void {
    const { attributes } = getContext();
    // Created is offered last: a record date is provenance, not something you
    // read a table for, so it should not head the list of things to add.
    const offered: Column[] = [...attributes.map(columnFor), CREATED_COLUMN];
    const shownKeys = new Set(extraColumns.map((column) => column.key));
    const available = offered.filter((column) => !shownKeys.has(column.key));

    const term = colTerm.trim().toLowerCase();
    const matching = term
      ? available.filter((column) => column.label.toLowerCase().includes(term))
      : available;

    const parts: HTMLElement[] = [];

    if (offered.length >= 7) {
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'col-search';
      search.placeholder = 'Search columns…';
      search.autocomplete = 'off';
      search.setAttribute('aria-label', 'Search columns');
      search.value = colTerm;
      search.addEventListener('input', () => {
        colTerm = search.value;
        buildColumnPicker();
        // Rebuilding replaces the node, so focus and caret have to be restored.
        const again = colList.querySelector<HTMLInputElement>('.col-search');
        again?.focus();
        again?.setSelectionRange(again.value.length, again.value.length);
      });
      parts.push(search);
    }

    parts.push(heading('Shown'), shownList(), divider(), heading('Add'));

    if (matching.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'col-empty';
      empty.textContent = term ? 'Nothing matches.' : 'Every column is already shown.';
      parts.push(empty);
    } else {
      parts.push(
        ...matching.map((column) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'col-add';
          row.append(plus(), columnLabel(column));
          row.addEventListener('click', () => {
            extraColumns = [...extraColumns, column];
            colTerm = '';
            void load();
          });
          return row;
        }),
      );
    }

    colList.replaceChildren(...parts);
  }

  /** The chosen columns, in order, each draggable to a new position. */
  function shownList(): HTMLElement {
    const list = document.createElement('div');
    list.className = 'col-shown';

    const fixed = document.createElement('div');
    fixed.className = 'col-row is-fixed';
    fixed.append(spacer(), columnLabel(NAME_COLUMN));
    const pinned = document.createElement('span');
    pinned.className = 'col-note';
    pinned.textContent = 'always first';
    fixed.append(pinned);
    list.append(fixed);

    extraColumns.forEach((column, index) => {
      const row = document.createElement('div');
      row.className = 'col-row';
      row.dataset['key'] = column.key;

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'col-handle';
      handle.setAttribute('aria-label', `Move ${column.label}`);
      handle.append(dragIcon());
      // Arrow keys do the same job for anyone not using a pointer.
      handle.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (step === 0) return;
        event.preventDefault();
        move(index, index + step);
      });
      startDragging(handle, row, list);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'col-remove';
      remove.setAttribute('aria-label', `Remove ${column.label}`);
      remove.textContent = '✕';
      remove.addEventListener('click', () => {
        extraColumns = extraColumns.filter((entry) => entry.key !== column.key);
        // Taken away on purpose, so the next chart change must not bring it
        // back as one of its own.
        fromChart = fromChart.filter((key) => key !== column.key);
        settleSort();
        void load();
      });

      row.append(handle, columnLabel(column), remove);
      list.append(row);
    });

    return list;
  }

  function move(from: number, to: number): void {
    if (to < 0 || to >= extraColumns.length || from === to) return;
    const next = [...extraColumns];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    extraColumns = next;
    void load();
  }

  /**
   * Drag-to-reorder on pointer events rather than HTML5 drag-and-drop, which
   * does not fire for touch at all — and this is a tablet app first.
   *
   * The move and release listeners go on the document rather than the handle:
   * once the pointer leaves the handle, only a document-level listener still
   * hears it. Pointer capture would also work but fails quietly in enough
   * situations that relying on it makes dragging feel broken at random.
   */
  function startDragging(handle: HTMLElement, row: HTMLElement, list: HTMLElement): void {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      row.classList.add('dragging');

      const onMove = (moveEvent: PointerEvent): void => {
        const others = [...list.querySelectorAll<HTMLElement>('.col-row:not(.is-fixed)')];
        for (const other of others) {
          if (other === row) continue;
          const box = other.getBoundingClientRect();
          const middle = box.top + box.height / 2;
          const before = moveEvent.clientY < middle;
          const position = other.compareDocumentPosition(row);
          // Only swap when the pointer crosses a neighbour's midline, so a row
          // does not oscillate while hovering a boundary.
          if (before && position & Node.DOCUMENT_POSITION_FOLLOWING) {
            other.before(row);
            return;
          }
          if (!before && position & Node.DOCUMENT_POSITION_PRECEDING) {
            other.after(row);
            return;
          }
        }
      };

      const onUp = (): void => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        row.classList.remove('dragging');

        // The DOM is the source of truth once dragging ends; read the order back.
        const order = [...list.querySelectorAll<HTMLElement>('.col-row:not(.is-fixed)')]
          .map((element) => element.dataset['key'])
          .filter((key): key is string => Boolean(key));
        const byKey = new Map(extraColumns.map((column) => [column.key, column]));
        const reordered = order
          .map((key) => byKey.get(key))
          .filter((column): column is Column => Boolean(column));
        if (reordered.length !== extraColumns.length) return;
        const changed = reordered.some((column, index) => column.key !== extraColumns[index]?.key);
        extraColumns = reordered;
        // A drag that ended where it started should not cost a round trip.
        if (changed) void load();
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  /** Sorting by a column that is no longer shown means nothing; fall back. */
  function settleSort(): void {
    if (!columnsNow().some((column) => column.key === sortKey)) {
      sortKey = NAME_COLUMN.key;
      descending = false;
    }
  }

  /**
   * Attribute names repeat across categories — an environment can define
   * "Business Criticality" in two of them — so the category comes along or the
   * list offers the same label twice with no way to tell them apart.
   */
  function columnLabel(column: Column): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'col-name-wrap';

    if (column.choice) wrap.append(attributeIcon(column.choice.kind, column.choice.currency));

    const text = document.createElement('span');
    text.className = 'col-name';
    text.textContent = column.label;
    wrap.append(text);

    if (column.choice) {
      const category = document.createElement('span');
      category.className = 'col-cat';
      category.textContent = column.choice.categoryName;
      wrap.append(category);
    }
    return wrap;
  }

  function heading(text: string): HTMLElement {
    const element = document.createElement('p');
    element.className = 'col-heading';
    element.textContent = text;
    return element;
  }

  function plus(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'col-plus';
    element.setAttribute('aria-hidden', 'true');
    element.textContent = '+';
    return element;
  }

  function spacer(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'col-spacer';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  /**
   * The whole selection on the clipboard, not the page on screen.
   *
   * Reuses `fetchTable` with one big page rather than a second query shape:
   * the server-sorted path asks for that many at once, and the sample-sorted
   * path already builds every row before it slices, so both answer this with
   * the code that answers the table.
   */
  async function copyTable(): Promise<void> {
    const { type } = getContext();
    const columns = columnsNow();
    const scope = scopeFor(filters.get());

    const result = await busy.track(
      fetchTable(session.kg, session.sample, {
        type,
        ...(scope ? { scope } : {}),
        searchTerm: term,
        columns,
        sortKey,
        descending,
        page: 0,
        pageSize: COPY_LIMIT,
      }),
    );

    // What this is a list of. Without it a column of names is a column of
    // names, and a week later nobody knows which question produced it.
    const applied = filters.get().attributes.map((selection) => selection.label);
    const heading = [labelFor(type), ...applied, new Date().toLocaleDateString()].join(' · ');

    const table = toDelimitedTable(columns, result.rows, {
      heading,
      // Either the ranking could not see everything, or there were more rows
      // than one copy takes. Both mean the same thing to whoever reads it.
      sampled: result.truncated || result.total > result.rows.length,
    });

    const said = (message: string): void => {
      copyButton.textContent = message;
      globalThis.setTimeout(() => (copyButton.textContent = 'Copy'), COPIED_MS);
    };

    try {
      await navigator.clipboard.writeText(table);
      said(`Copied ${formatCount(result.rows.length)}`);
    } catch {
      said('Could not copy');
    }
  }

  async function load(): Promise<void> {
    const mine = ++generation;
    const { type } = getContext();
    const columns = columnsNow();

    const scope = scopeFor(filters.get());

    const result = await busy.track(
      fetchTable(session.kg, session.sample, {
        type,
        ...(scope ? { scope } : {}),
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
      ? `Ranked from ${sampledObjects(result.total)}, so this order may not be complete.`
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
    setFocus(charted: readonly AttributeChoice[]): void {
      const next = foldCharted(extraColumns, fromChart, charted);
      fromChart = next.added;

      const unchanged =
        next.columns.length === extraColumns.length &&
        next.columns.every((column, index) => column.key === extraColumns[index]?.key);
      if (unchanged) return;

      extraColumns = [...next.columns];

      settleSort();
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
