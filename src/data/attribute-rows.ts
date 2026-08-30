import type { AttributeChoice, AttributeKind } from './attributes';
import type { EditValue } from './attribute-edit';
import type { AttributeValue, Detail } from './object-detail';

/**
 * What the record sheet lists, once the attributes with no value are in it too.
 *
 * The read only returns values, so an object's *missing* attributes have until
 * now been a number at the foot of the sheet — which is the one thing a reader
 * who came from a coverage chart is there to see. The type's schema is what
 * turns that number back into rows, and it is already on the device
 * (`schema-cache.ts`), so this is a merge rather than a request.
 *
 * Pure, and free of the SDK, because the count it produces is a figure on
 * screen: "7 of 8 set" beside a list of nine would be worse than no count.
 */

export interface AttributeRow {
  readonly categoryId: string;
  readonly definitionId: string;
  readonly name: string;
  readonly kind: AttributeKind;
  /** What the sheet prints, or `null` where the object has no value. */
  readonly display: string | null;
  readonly value: EditValue;
  readonly currency?: string;
  readonly numeric?: number;
  /** For `enum`: the allowed values, in the metamodel's declared order. */
  readonly order?: readonly string[];
}

export interface AttributeRowGroup {
  readonly category: string;
  readonly rows: readonly AttributeRow[];
  /** How many of `rows` the object has a value for. */
  readonly set: number;
}

/**
 * The object's values merged onto its type's schema.
 *
 * The schema is the spine, so the rows come out in the order `attributesFor`
 * returns — sorted by category name and then by attribute name — rather than
 * in whichever order the object's payload happened to carry. That is the order
 * the attribute rail already groups by, so the sheet and the rail agree.
 *
 * Not the metamodel's declaration order: only `enumValues` keeps that, and it
 * is the one place the order is a documented contract.
 */
export function rowsFor(
  detail: Detail,
  choices: readonly AttributeChoice[],
): AttributeRowGroup[] {
  const held = new Map<string, AttributeValue>();
  const categoryNames = new Map<string, string>();

  for (const group of detail.groups) {
    for (const value of group.values) {
      held.set(address(value.categoryId, value.definitionId), value);
      categoryNames.set(value.categoryId, group.category);
    }
  }

  const groups = new Map<string, { category: string; rows: AttributeRow[] }>();
  const covered = new Set<string>();

  for (const choice of choices) {
    const key = address(choice.categoryId, choice.definitionId);
    covered.add(key);

    const entry = groups.get(choice.categoryId) ?? { category: choice.categoryName, rows: [] };
    entry.rows.push(rowFor(choice, held.get(key)));
    groups.set(choice.categoryId, entry);
  }

  // A value the cached schema does not list — a schema read that has gone
  // stale, or an attribute added since. It is a real value the object carries,
  // so listing it late beats dropping it.
  for (const [key, value] of held) {
    if (covered.has(key)) continue;

    const entry = groups.get(value.categoryId) ?? {
      category: categoryNames.get(value.categoryId) ?? value.categoryId,
      rows: [],
    };
    entry.rows.push(unlistedRow(value));
    groups.set(value.categoryId, entry);
  }

  return [...groups.values()]
    .filter((entry) => entry.rows.length > 0)
    .map((entry) => ({
      category: entry.category,
      rows: entry.rows,
      set: entry.rows.filter((row) => row.display !== null).length,
    }));
}

/** The key a sampled value is stored under: `categoryId::attributeName`. */
export function sampleKeyFor(row: AttributeRow): string {
  return `${row.categoryId}::${row.name}`;
}

function rowFor(choice: AttributeChoice, value: AttributeValue | undefined): AttributeRow {
  return {
    categoryId: choice.categoryId,
    definitionId: choice.definitionId,
    name: choice.name,
    kind: choice.kind,
    display: value?.display ?? null,
    value: value?.value ?? null,
    // The currency belongs to the definition, so it is known for an attribute
    // the object has no value for — which is what lets an unset money row
    // still carry the right symbol.
    ...(choice.currency ? { currency: choice.currency } : {}),
    ...(value?.numeric !== undefined ? { numeric: value.numeric } : {}),
    ...(choice.enumValues ? { order: choice.enumValues.map((entry) => entry.name) } : {}),
  };
}

function unlistedRow(value: AttributeValue): AttributeRow {
  return {
    categoryId: value.categoryId,
    definitionId: value.definitionId,
    name: value.name,
    kind: value.kind as AttributeKind,
    display: value.display,
    value: value.value,
    ...(value.currency ? { currency: value.currency } : {}),
    ...(value.numeric !== undefined ? { numeric: value.numeric } : {}),
  };
}

/** `categoryId` + the definition's **id** — the way a filter or a write says it. */
function address(categoryId: string, definitionId: string): string {
  return `${categoryId}.${definitionId}`;
}
