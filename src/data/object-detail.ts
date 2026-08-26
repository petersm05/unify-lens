import type { UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Kg } from '../sdk/client';

const SELECTOR = {
  description: true,
  externalId: true,
  externalSource: true,
  labels: true,
  systemAttributes: true,
  attributeCategories: true,
  relatedObjects: true,
  views: true,
} as const;

export interface AttributeValue {
  /** Addresses the attribute for charting: `categoryId` + definition id. */
  readonly categoryId: string;
  readonly definitionId: string;
  readonly name: string;
  readonly kind: string;
  readonly display: string;
  readonly currency?: string;
  readonly numeric?: number;
}

export interface AttributeGroup {
  readonly category: string;
  readonly values: readonly AttributeValue[];
}

export interface RelatedGroup {
  readonly role: string;
  readonly objects: ReadonlyArray<{ id: UUID; name: string; type: string }>;
}

export interface Detail {
  readonly id: UUID;
  readonly name: string;
  readonly type: string;
  readonly description: string | null;
  readonly externalSource: string | null;
  readonly externalId: string | null;
  readonly labels: readonly string[];
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly groups: readonly AttributeGroup[];
  readonly related: readonly RelatedGroup[];
  readonly views: ReadonlyArray<{ id: UUID; name: string }>;
  /** Attributes the type defines but this object has no value for. */
  readonly emptyCount: number;
}

/**
 * Everything the knowledge graph holds about one object.
 *
 * A single `getObject` with a wide selector: attribute values, one level of
 * related objects grouped by role, and the views it appears in. Related objects
 * arrive keyed by role name already, which is the grouping a reader wants — no
 * second traversal needed.
 */
export async function fetchDetail(kg: Kg, id: UUID): Promise<Detail | null> {
  // ts-results `Option`: `some` is the discriminant, `val` the payload.
  const option = await kg.getObject({ filter: { id }, selector: SELECTOR });
  if (!option.some) return null;
  const object = option.val;

  const groups: AttributeGroup[] = [];
  let emptyCount = 0;

  for (const category of object.attributeCategories) {
    const values: AttributeValue[] = [];
    for (const attribute of category.attributes) {
      const display = render(attribute);
      if (display === null) {
        emptyCount += 1;
        continue;
      }
      values.push({
        categoryId: category.id,
        definitionId: attribute.id,
        name: attribute.name,
        kind: attribute.type,
        display,
        ...(attribute.type === 'money' && 'currency' in attribute && attribute.currency
          ? { currency: attribute.currency as string }
          : {}),
        ...(typeof attribute.value === 'number' ? { numeric: attribute.value } : {}),
      });
    }
    if (values.length > 0) groups.push({ category: category.name, values });
  }

  const related: RelatedGroup[] = Object.entries(object.relatedObjects ?? {})
    .filter(([, entries]) => Array.isArray(entries) && entries.length > 0)
    .map(([role, entries]) => ({
      role,
      objects: (entries ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name ?? '(unnamed)',
        type: entry.type,
      })),
    }));

  return {
    id: object.id,
    name: object.name ?? '(unnamed)',
    type: object.type,
    description: object.description ?? null,
    externalSource: object.externalSource ?? null,
    externalId: object.externalId ?? null,
    labels: object.labels ?? [],
    createdAt: object.systemAttributes?.createdAt ?? null,
    updatedAt: object.systemAttributes?.updatedAt ?? null,
    groups,
    related,
    views: (object.views ?? []).map((view) => ({ id: view.id, name: view.name ?? '(unnamed)' })),
    emptyCount,
  };
}

/** `null` for an absent value, so empty attributes can be counted not listed. */
function render(attribute: {
  type: string;
  value?: unknown;
  displayValue?: string | null;
}): string | null {
  const value = attribute.value;
  if (value === null || value === undefined || value === '') return null;

  if (attribute.type === 'enum') return attribute.displayValue ?? String(value);
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object' && 'name' in (value as object)) {
    return String((value as { name?: string }).name ?? '');
  }
  return String(value);
}
