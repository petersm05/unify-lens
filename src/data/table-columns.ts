/**
 * Table columns: what one is, and how a chart's attributes fold into a set.
 *
 * Split from `object-table.ts` so that testing this needs no SDK. That module
 * reads objects, so it imports `labelFor` and through it the whole SDK bundle
 * — which is CommonJS underneath and cannot be loaded by the test runner's ESM
 * loader. A test that reached it took the whole suite down with a collection
 * error, and with the suite the deploy. None of what is below needs any of it.
 */
import type { AttributeChoice } from './attributes';

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
