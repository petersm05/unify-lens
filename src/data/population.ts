import type { AttributeFilter, MetaModel, ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { Kg } from '../sdk/client';
import { labelFor } from '../sdk/metamodel';

export interface TypeCount {
  readonly type: ObjectType;
  readonly label: string;
  readonly count: number;
}

/**
 * How many objects exist per type.
 *
 * `aggregateAttributeValues()` only does `sum` of one numeric attribute, so a
 * count breakdown is a fan-out: one `getCount()` per bucket. With
 * `queryBatching` enabled these leave as a single HTTP request, and none of
 * them fetch any items.
 */
export async function countsByType(
  kg: Kg,
  types: readonly ObjectType[],
  scope?: AttributeFilter<MetaModel>,
): Promise<TypeCount[]> {
  const counts = await Promise.all(
    types.map(async (type) => ({
      type,
      label: labelFor(type),
      count: await kg
        .getObjects({
          filter: { types: [type], ...(scope ? { attributeFilter: scope } : {}) },
          selector: {},
        })
        .getCount(),
    })),
  );

  return counts.filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
}

/**
 * Sums one numeric attribute across every object matching the filter.
 *
 * The only aggregation the backend does for us — everything else is computed
 * on-device from the cached population.
 */
export async function sumAttribute(
  kg: Kg,
  params: { types?: readonly ObjectType[]; categoryId: string; name: string },
): Promise<number> {
  const { sum } = await kg.aggregateAttributeValues({
    filter: params.types ? { types: [...params.types] } : undefined,
    aggregate: { sum: { categoryId: params.categoryId, name: params.name } },
  });
  return sum;
}
