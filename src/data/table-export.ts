import type { Row } from './object-table';
import type { Column } from './table-columns';

/**
 * The table on screen, as something a spreadsheet will accept.
 *
 * Tab-separated, not comma-separated, because this goes to the clipboard.
 * Pasting commas into Excel, Numbers or Sheets gives one column of text and a
 * trip through Text-to-Columns; pasting tabs lands in the grid. A `.csv`
 * download is the other half of this and wants commas — the separator is a
 * fact about the destination, not about the data, so it is a parameter.
 */
export interface ExportOptions {
  /**
   * One line above the table saying what this is a list of.
   *
   * A list of 23 names with no record of the filter that produced it is a list
   * someone will misread in a week. It costs one row at the top of the paste,
   * which is worth it.
   */
  readonly heading?: string;
  /** Says so, in the heading, when the rows are a sample rather than all of them. */
  readonly sampled?: boolean;
  readonly separator?: '\t' | ',';
}

/**
 * A value as the spreadsheet should receive it.
 *
 * `raw` is preferred only for numeric columns. It holds epoch milliseconds for
 * dates, so preferring it everywhere would export `1735689600000` where the
 * screen says `31/12/2024`; `cells` already carries the formatted date. And
 * `cells` writes an em dash for a missing value, which is right on screen and
 * noise in a cell — nothing is the honest export of nothing.
 */
function valueOf(row: Row, column: Column): string {
  if (column.numeric) {
    const raw = row.raw[column.key];
    if (typeof raw === 'number') return String(raw);
    if (raw === undefined) return '';
  }

  const cell = row.cells[column.key] ?? '';
  return cell === '—' ? '' : cell;
}

/**
 * Flattens a value into one cell.
 *
 * A tab or a newline inside a value would end the cell early and shear every
 * column after it out of line, so whitespace collapses rather than travelling.
 *
 * A leading `=` is the other one: a spreadsheet reads that cell as a formula,
 * and an object named `=1+1` should arrive as its name. Quoting it is enough
 * to keep it text. Only text is guarded — a numeric cell has already been
 * emitted as a number and must stay one.
 */
function cell(value: string, separator: string): string {
  const flat = value.replace(/[\t\r\n]+/g, ' ').trim();
  if (flat.startsWith('=')) return `"${flat.replace(/"/g, '""')}"`;

  // A comma-separated destination needs the usual quoting; a tab-separated one
  // does not, and quoting it would show the quotes in the cell.
  if (separator === ',' && /[",]/.test(flat)) return `"${flat.replace(/"/g, '""')}"`;
  return flat;
}

export function toDelimitedTable(
  columns: readonly Column[],
  rows: readonly Row[],
  options: ExportOptions = {},
): string {
  const separator = options.separator ?? '\t';
  const lines: string[] = [];

  if (options.heading !== undefined && options.heading !== '') {
    const sampled = options.sampled === true ? ' · a sample, not every object' : '';
    lines.push(cell(`${options.heading}${sampled}`, separator));
  }

  lines.push(columns.map((column) => cell(column.label, separator)).join(separator));
  for (const row of rows) {
    lines.push(columns.map((column) => cell(valueOf(row, column), separator)).join(separator));
  }

  return lines.join('\n');
}
