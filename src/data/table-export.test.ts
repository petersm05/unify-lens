import { describe, expect, it } from 'vitest';
import type { Row } from './object-table';
import { toDelimitedTable } from './table-export';
import type { Column } from './table-columns';

const name: Column = {
  key: 'name',
  label: 'Name',
  field: 'name',
  numeric: false,
  sort: 'server',
};

const cost: Column = {
  key: 'general.cost',
  label: 'Total cost of ownership',
  field: 'attribute',
  numeric: true,
  sort: 'sample',
};

const retires: Column = {
  key: 'lifecycle.retires',
  label: 'Decommission date',
  field: 'attribute',
  numeric: false,
  sort: 'sample',
};

function row(cells: Record<string, string>, raw: Record<string, string | number | undefined> = {}): Row {
  return { id: 'id' as Row['id'], cells, raw };
}

const lines = (table: string): string[] => table.split('\n');

describe('toDelimitedTable', () => {
  it('leads with the column labels', () => {
    const table = toDelimitedTable([name, cost], []);

    expect(lines(table)).toEqual(['Name\tTotal cost of ownership']);
  });

  it('takes a numeric column from raw, so a spreadsheet gets a number', () => {
    const table = toDelimitedTable(
      [cost],
      [row({ 'general.cost': '€184.500' }, { 'general.cost': 184500 })],
    );

    expect(lines(table)[1]).toBe('184500');
  });

  it('takes a date from the formatted cell, not from raw', () => {
    // `raw` holds epoch milliseconds for dates. Preferring it everywhere would
    // export 1735689600000 where the screen says 31/12/2024.
    const table = toDelimitedTable(
      [retires],
      [row({ 'lifecycle.retires': '31/12/2024' }, { 'lifecycle.retires': 1735689600000 })],
    );

    expect(lines(table)[1]).toBe('31/12/2024');
  });

  it('exports a missing value as nothing, not as an em dash', () => {
    const table = toDelimitedTable([name, cost], [row({ name: 'Payments', 'general.cost': '—' })]);

    expect(lines(table)[1]).toBe('Payments\t');
  });

  it('exports a missing number as nothing rather than as the string undefined', () => {
    const table = toDelimitedTable([cost], [row({ 'general.cost': '—' }, { 'general.cost': undefined })]);

    expect(lines(table)[1]).toBe('');
  });

  it('flattens a tab inside a value, which would otherwise shear the row', () => {
    const table = toDelimitedTable([name, cost], [row({ name: 'A\tB', 'general.cost': '1' })]);

    // Three columns' worth of tabs would appear in a two-column row.
    expect(lines(table)[1]?.split('\t')).toHaveLength(2);
    expect(lines(table)[1]).toBe('A B\t');
  });

  it('flattens a newline inside a value, which would otherwise end the row', () => {
    const table = toDelimitedTable([name], [row({ name: 'A\nB' })]);

    expect(lines(table)).toHaveLength(2);
    expect(lines(table)[1]).toBe('A B');
  });

  it('quotes a value a spreadsheet would read as a formula', () => {
    const table = toDelimitedTable([name], [row({ name: '=1+1' })]);

    expect(lines(table)[1]).toBe('"=1+1"');
  });

  it('leaves a negative number alone, which is not a formula', () => {
    const table = toDelimitedTable([cost], [row({ 'general.cost': '-5' }, { 'general.cost': -5 })]);

    expect(lines(table)[1]).toBe('-5');
  });

  it('quotes commas only where the separator is a comma', () => {
    const withComma = [row({ name: 'Peters, M' })];

    expect(lines(toDelimitedTable([name], withComma, { separator: ',' }))[1]).toBe('"Peters, M"');
    // Quoting it in a tab-separated paste would show the quotes in the cell.
    expect(lines(toDelimitedTable([name], withComma))[1]).toBe('Peters, M');
  });

  it('doubles a quote inside a quoted value', () => {
    const table = toDelimitedTable([name], [row({ name: 'The "Old" One' })], { separator: ',' });

    expect(lines(table)[1]).toBe('"The ""Old"" One"');
  });

  it('puts the heading above the columns when there is one', () => {
    const table = toDelimitedTable([name], [], { heading: 'Application Component · Owner: none' });

    expect(lines(table)).toEqual(['Application Component · Owner: none', 'Name']);
  });

  it('says in the heading when the rows are a sample', () => {
    const table = toDelimitedTable([name], [], { heading: 'Applications', sampled: true });

    expect(lines(table)[0]).toBe('Applications · a sample, not every object');
  });

  it('says nothing about sampling when the rows are all of them', () => {
    const table = toDelimitedTable([name], [], { heading: 'Applications', sampled: false });

    expect(lines(table)[0]).toBe('Applications');
  });

  it('omits the heading line entirely when there is none', () => {
    expect(lines(toDelimitedTable([name], []))).toEqual(['Name']);
  });
});
