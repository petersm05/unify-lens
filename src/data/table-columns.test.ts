import { describe, expect, it } from 'vitest';
import type { AttributeChoice } from './attributes';
import { columnFor, foldCharted, NAME_COLUMN, type Column } from './table-columns';

function attribute(definitionId: string, categoryId = 'category'): AttributeChoice {
  return {
    categoryId,
    categoryName: 'Category',
    definitionId,
    name: definitionId,
    kind: 'enum',
  };
}

const criticality = attribute('criticality');
const owner = attribute('owner');
const cost = attribute('cost');

/** Column identity is a key; the assertions read better as the keys. */
const keys = (columns: readonly Column[]): string[] => columns.map((column) => column.key);

describe('foldCharted', () => {
  it('gives a chart of one attribute one column', () => {
    const folded = foldCharted([], [], [criticality]);

    expect(keys(folded.columns)).toEqual([columnFor(criticality).key]);
    expect(folded.added).toEqual([columnFor(criticality).key]);
  });

  it('gives a comparison both columns, in the order the chart names them', () => {
    const folded = foldCharted([], [], [criticality, cost]);

    expect(keys(folded.columns)).toEqual([columnFor(criticality).key, columnFor(cost).key]);
  });

  it('takes back the last chart’s columns when the chart changes', () => {
    const first = foldCharted([], [], [criticality, cost]);
    const second = foldCharted(first.columns, first.added, [owner]);

    expect(keys(second.columns)).toEqual([columnFor(owner).key]);
  });

  it('leaves a column added by hand alone', () => {
    const byHand = [columnFor(owner)];
    const charted = foldCharted(byHand, [], [criticality]);
    const next = foldCharted(charted.columns, charted.added, [cost]);

    expect(keys(next.columns)).toEqual([columnFor(owner).key, columnFor(cost).key]);
  });

  it('does not claim a hand-added column just because a chart also names it', () => {
    // Added through the picker, then charted. It is still the reader's column,
    // so the next chart must not take it away with its own.
    const byHand = [columnFor(owner)];
    const charted = foldCharted(byHand, [], [owner]);

    expect(charted.added).toEqual([]);
    expect(keys(foldCharted(charted.columns, charted.added, [cost]).columns)).toEqual([
      columnFor(owner).key,
      columnFor(cost).key,
    ]);
  });

  it('keeps the columns already there in the order they were in', () => {
    const existing = [columnFor(owner), columnFor(cost)];
    const folded = foldCharted(existing, [], [criticality]);

    expect(keys(folded.columns)).toEqual([
      columnFor(owner).key,
      columnFor(cost).key,
      columnFor(criticality).key,
    ]);
  });

  it('adds one column for an attribute charted against itself', () => {
    const folded = foldCharted([], [], [criticality, criticality]);

    expect(keys(folded.columns)).toEqual([columnFor(criticality).key]);
  });

  it('charting nothing takes the last chart’s columns away and adds none', () => {
    const charted = foldCharted([], [], [criticality]);
    const folded = foldCharted(charted.columns, charted.added, []);

    expect(folded.columns).toEqual([]);
    expect(folded.added).toEqual([]);
  });

  it('tells apart two attributes of the same name in different categories', () => {
    // "Business Criticality" can be defined in two categories; the key carries
    // the category so the table does not fold them into one column.
    const mine = attribute('criticality', 'general');
    const theirs = attribute('criticality', 'lifecycle');
    const folded = foldCharted([], [], [mine, theirs]);

    expect(keys(folded.columns)).toEqual([columnFor(mine).key, columnFor(theirs).key]);
    expect(columnFor(mine).key).not.toEqual(columnFor(theirs).key);
  });

  it('never touches the name column, which is not one of the extras', () => {
    // `foldCharted` only ever sees the columns after Name, so charting an
    // attribute cannot displace the row's identity.
    const folded = foldCharted([], [], [criticality]);

    expect(keys(folded.columns)).not.toContain(NAME_COLUMN.key);
  });
});
