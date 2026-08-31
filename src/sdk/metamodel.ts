import {
  ArchiMate,
  BDCore,
  labelForElement,
  type MetaModel,
  type ObjectType,
} from '@bizzdesign/sdk-bundle/browser';

/**
 * The metamodels this app accepts from configuration.
 *
 * `satisfies readonly MetaModel[]` is the point: the SDK's own union decides
 * whether these names are real, so a rename there fails the build here rather
 * than at the first query.
 */
export const META_MODELS = ['BDCore', 'ArchiMate'] as const satisfies readonly MetaModel[];

/** A configured metamodel name, or `null` if the SDK does not define it. */
export function toMetaModel(value: string | undefined): MetaModel | null {
  return META_MODELS.find((known) => known === value) ?? null;
}

/**
 * The object types belonging to one metamodel.
 *
 * The bundle's top-level `objectTypes` is the union of both metamodels, which
 * would make a type picker offer ArchiMate types on a BDCore environment.
 */
export function objectTypesFor(metaModel: MetaModel): readonly ObjectType[] {
  return metaModel === 'BDCore' ? BDCore.objectTypes : ArchiMate.objectTypes;
}

/** Relation role names belonging to one metamodel, e.g. BDCore's `dependsOn`. */
export function roleNamesFor(metaModel: MetaModel): readonly string[] {
  return metaModel === 'BDCore' ? BDCore.relationRoleNames : ArchiMate.relationRoleNames;
}

/** `'BDCore.Application'` → `'Application'`, using the metamodel's own label. */
export function labelFor(type: string | undefined): string {
  if (type === undefined) return 'Unknown';
  try {
    return labelForElement(type as ObjectType);
  } catch {
    return type.includes('.') ? (type.split('.')[1] ?? type) : type;
  }
}
