import type {
  AttributeFilter,
  MetaModel,
  ObjectType,
  UUID,
} from '@bizzdesign/sdk-bundle/browser';
import type { Kg } from '../sdk/client';
import { labelFor } from '../sdk/metamodel';
import { conditionName, type AttributeChoice } from './attributes';
import { SAMPLE_LIMIT, type Sample, type SampleStore } from './sample-store';

export type SortMode =
  /** The backend orders the whole result set correctly. */
  | 'server'
  /** The backend's ordering is wrong for this column; sort a bounded read. */
  | 'sample'
  | 'none';

export interface Column {
  readonly key: string;
  readonly label: string;
  readonly field: 'name' | 'type' | 'createdAt' | 'attribute';
  readonly choice?: AttributeChoice;
  readonly numeric: boolean;
  readonly sort: SortMode;
}

export interface Row {
  readonly id: UUID;
  readonly cells: Readonly<Record<string, string>>;
  /** Raw values, so a client-side sort compares numbers as numbers. */
  readonly raw: Readonly<Record<string, string | number | undefined>>;
}

export interface TableQuery {
  readonly type: ObjectType;
  readonly scope?: AttributeFilter<MetaModel>;
  readonly searchTerm?: string;
  readonly columns: readonly Column[];
  readonly sortKey: string;
  readonly descending: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export interface TableResult {
  readonly rows: readonly Row[];
  readonly total: number;
  readonly sortedBy: SortMode;
  /** Set when a sample sort could not see the whole population. */
  readonly truncated: boolean;
}

export const NAME_COLUMN: Column = {
  key: 'name',
  label: 'Name',
  field: 'name',
  numeric: false,
  sort: 'server',
};

export const CREATED_COLUMN: Column = {
  key: 'createdAt',
  label: 'Created',
  field: 'createdAt',
  numeric: false,
  sort: 'server',
};

/**
 * Turns an attribute into a table column, deciding how it can be sorted.
 *
 * `orderBy.attributeValue` compares values as **text**. For a string or an
 * enumeration that is exactly right. For a number it is silently wrong —
 * 97000 sorts above 1900000 — so those columns are sorted from a bounded
 * client-side read instead, and the UI says which happened.
 */
export function columnFor(choice: AttributeChoice): Column {
  const numeric = choice.kind === 'integer' || choice.kind === 'real' || choice.kind === 'money';
  return {
    key: `${choice.categoryId}.${choice.definitionId}`,
    label: choice.name,
    field: 'attribute',
    choice,
    numeric,
    sort: numeric || choice.kind === 'date' ? 'sample' : 'server',
  };
}

/**
 * Folds the attributes a chart is built from into the columns already shown.
 *
 * A chart contributes a column per attribute it charts, so comparing two
 * attributes puts both in the table rather than whichever half the chart
 * happened to pass — the scatter used to keep y and drop x, the cross-tab keep
 * the row and drop the column.
 *
 * Two things survive a change of chart. Columns someone added through the
 * picker are theirs, so only the ones a chart added are taken back; `added` is
 * what to remember for that, not `charted`, because an attribute that was
 * already there by hand is not this chart's to remove later. And order is
 * kept: existing columns stay where they were and the chart's go on the end,
 * so a chart change does not reshuffle the table under the reader.
 */
export function foldCharted(
  shown: readonly Column[],
  fromLastChart: readonly string[],
  charted: readonly AttributeChoice[],
): { readonly columns: readonly Column[]; readonly added: readonly string[] } {
  const kept = shown.filter((column) => !fromLastChart.includes(column.key));
  const added: Column[] = [];

  for (const choice of charted) {
    const column = columnFor(choice);
    const already =
      kept.some((entry) => entry.key === column.key) ||
      added.some((entry) => entry.key === column.key);
    if (!already) added.push(column);
  }

  return { columns: [...kept, ...added], added: added.map((column) => column.key) };
}

const SELECTOR = { attributeCategories: true, systemAttributes: true } as const;

export async function fetchTable(
  kg: Kg,
  store: SampleStore,
  query: TableQuery,
): Promise<TableResult> {
  const column = query.columns.find((candidate) => candidate.key === query.sortKey);
  const order = query.descending ? ('DESC' as const) : ('ASC' as const);

  const filter = {
    types: [query.type],
    ...(query.scope ? { attributeFilter: query.scope } : {}),
    ...(query.searchTerm ? { searchTerm: query.searchTerm } : {}),
  };

  // Columns the backend can order correctly: paginate on the server and let it
  // do the work, so paging never loads more than one page.
  if (!column || column.sort === 'server') {
    const result = kg.getObjects({
      filter: { ...filter, ...(column ? { orderBy: orderByFor(column, order) } : {}) },
      selector: SELECTOR,
    });

    const pages = result.asPages({ pageSize: query.pageSize });
    const [items, total] = await Promise.all([pages.getPage(query.page), pages.getCount()]);

    return {
      rows: items.map((item) => toRow(item, query.columns)),
      total,
      sortedBy: column ? 'server' : 'none',
      truncated: false,
    };
  }

  // Columns the backend orders wrongly have to be sorted here, which needs the
  // whole population. Without a search term that is exactly the shared sample,
  // so paging and re-sorting cost nothing after the first read — this used to
  // re-stream the entire estate for every page.
  let rows: Row[];
  let truncated: boolean;

  if (!query.searchTerm) {
    const sample = await store.get(query.type, query.scope);
    rows = sample.objects.map((object) => fromSample(object, query.columns));
    truncated = sample.truncated;
  } else {
    // A search term narrows server-side by relevance, which the sample cannot
    // reproduce, so that combination still reads its own slice.
    const result = kg.getObjects({ filter, selector: SELECTOR });
    rows = [];
    let seen = 0;
    truncated = false;
    for await (const item of result.stream()) {
      rows.push(toRow(item, query.columns));
      seen += 1;
      if (seen >= SAMPLE_LIMIT) {
        truncated = true;
        break;
      }
    }
  }

  rows.sort((a, b) => compare(a.raw[column.key], b.raw[column.key]) * (query.descending ? -1 : 1));

  const start = query.page * query.pageSize;
  return {
    rows: rows.slice(start, start + query.pageSize),
    total: rows.length,
    sortedBy: 'sample',
    truncated,
  };
}

/** A row built from the shared sample rather than its own query. */
function fromSample(object: Sample['objects'][number], columns: readonly Column[]): Row {
  const cells: Record<string, string> = {};
  const raw: Record<string, string | number | undefined> = {};

  for (const column of columns) {
    if (column.field === 'name') {
      cells[column.key] = object.name;
      raw[column.key] = object.name;
      continue;
    }
    if (column.field === 'createdAt') {
      cells[column.key] = object.createdAt ? object.createdAt.toLocaleDateString() : '—';
      raw[column.key] = object.createdAt ? object.createdAt.getTime() : undefined;
      continue;
    }
    if (column.field === 'type') {
      cells[column.key] = '';
      continue;
    }

    const choice = column.choice;
    if (!choice) continue;
    const value = object.values.get(`${choice.categoryId}::${choice.name}`);

    if (typeof value === 'number') {
      raw[column.key] = value;
      cells[column.key] = String(value);
    } else if (value instanceof Date) {
      raw[column.key] = value.getTime();
      cells[column.key] = value.toLocaleDateString();
    } else if (value === undefined) {
      cells[column.key] = '—';
    } else {
      raw[column.key] = String(value);
      cells[column.key] = String(value);
    }
  }

  return { id: object.id, cells, raw };
}

function orderByFor(column: Column, value: 'ASC' | 'DESC') {
  switch (column.field) {
    case 'name':
      return { name: value };
    case 'type':
      return { type: value };
    case 'createdAt':
      return { createdAt: value };
    default:
      return {
        attributeValue: {
          categoryId: column.choice?.categoryId ?? '',
          // Attributes are addressed by definition id, never by display name.
          name: column.choice?.definitionId ?? '',
          value,
        },
      };
  }
}

function compare(a: string | number | undefined, b: string | number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  // Missing values sort last in either direction is not possible with a single
  // multiplier, so they simply sort low and end up grouped.
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

type Streamed = { id?: UUID; name?: string | null; type?: string; attributeCategories: readonly { id: string; attributes: readonly { name: string; type: string; value?: unknown; displayValue?: string | null }[] }[]; systemAttributes?: { createdAt?: Date } };

function toRow(object: unknown, columns: readonly Column[]): Row {
  const item = object as Streamed;
  const cells: Record<string, string> = {};
  const raw: Record<string, string | number | undefined> = {};

  for (const column of columns) {
    if (column.field === 'name') {
      cells[column.key] = item.name ?? '(unnamed)';
      raw[column.key] = item.name ?? undefined;
      continue;
    }
    if (column.field === 'type') {
      // The metamodel-qualified type is what the server sorts on; the reader
      // gets the label.
      cells[column.key] = labelFor(item.type);
      raw[column.key] = item.type;
      continue;
    }
    if (column.field === 'createdAt') {
      const created = item.systemAttributes?.createdAt;
      cells[column.key] = created ? created.toLocaleDateString() : '—';
      raw[column.key] = created ? created.getTime() : undefined;
      continue;
    }

    const choice = column.choice;
    if (!choice) continue;

    let value: string | number | undefined;
    let text = '—';
    for (const category of item.attributeCategories ?? []) {
      if (category.id !== choice.categoryId) continue;
      for (const attribute of category.attributes) {
        if (attribute.name !== choice.name) continue;
        if (typeof attribute.value === 'number') {
          value = attribute.value;
          text = String(attribute.value);
        } else if (attribute.type === 'enum') {
          value = attribute.displayValue ?? String(attribute.value ?? '');
          text = String(value);
        } else if (attribute.value instanceof Date) {
          value = attribute.value.getTime();
          text = attribute.value.toLocaleDateString();
        } else if (attribute.value !== null && attribute.value !== undefined) {
          value = String(attribute.value);
          text = value;
        }
      }
    }

    cells[column.key] = text;
    raw[column.key] = value;
  }

  return { id: item.id ?? ('' as UUID), cells, raw };
}

/** Kept exported so callers can build an "exists" filter for a column. */
export { conditionName };
