import type { AttributeFilter, MetaModel, ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { AttributeChoice } from './attributes';

/** A chosen slice of one attribute — an enum value, a histogram bucket. */
export interface AttributeSelection {
  readonly choice: AttributeChoice;
  /** Shown on the filter chip, e.g. `Business Criticality: Mission Critical`. */
  readonly label: string;
  /** The bin's own label, used to mark it as the active bar. */
  readonly binLabel: string;
  readonly condition: AttributeFilter<MetaModel>;
}

export interface LensFilter {
  readonly type?: ObjectType;
  /**
   * Selections across *different* attributes, combined with AND.
   *
   * At most one entry per attribute: picking another bucket of the same
   * attribute moves that selection rather than adding a contradictory second
   * one, since a value cannot be in two buckets at once.
   */
  readonly attributes: readonly AttributeSelection[];
}

type Listener = (filter: LensFilter) => void;

/**
 * The one piece of state every view reads.
 *
 * Selections are held as ready-made `AttributeFilter` fragments rather than as
 * values to interpret later, so each view composes them into its own query
 * instead of re-deriving the condition — the same slice means the same
 * server-side filter everywhere.
 */
export class FilterStore {
  private filter: LensFilter = { attributes: [] };
  private readonly listeners = new Set<Listener>();

  get(): LensFilter {
    return this.filter;
  }

  setType(type: ObjectType | undefined): void {
    this.filter = { ...this.filter, ...(type ? { type } : {}) };
    if (!type) {
      const { type: _dropped, ...rest } = this.filter;
      this.filter = rest;
    }
    this.emit();
  }

  /** Adds a selection, replacing any existing one on the same attribute. */
  select(selection: AttributeSelection): void {
    this.filter = {
      ...this.filter,
      attributes: [
        ...this.filter.attributes.filter(
          (existing) => !isSameAttribute(existing.choice, selection.choice),
        ),
        selection,
      ],
    };
    this.emit();
  }

  deselect(choice: AttributeChoice): void {
    this.filter = {
      ...this.filter,
      attributes: this.filter.attributes.filter(
        (existing) => !isSameAttribute(existing.choice, choice),
      ),
    };
    this.emit();
  }

  clear(): void {
    this.filter = { attributes: [] };
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Drops selections whose attribute does not exist on the current type.
   *
   * An attribute filter addresses `categoryId.definitionId`, which belongs to
   * one object type's schema. Carried onto a type that has no such attribute it
   * cannot match anything, so the view goes empty and reads as broken rather
   * than as filtered. Returns what was dropped, so it can be said out loud.
   *
   * @returns the labels of the removed selections.
   */
  prune(isValid: (choice: AttributeChoice) => boolean): string[] {
    const dropped = this.filter.attributes.filter((selection) => !isValid(selection.choice));
    if (dropped.length === 0) return [];

    this.filter = {
      ...this.filter,
      attributes: this.filter.attributes.filter((selection) => isValid(selection.choice)),
    };
    this.emit();
    return dropped.map((selection) => selection.label);
  }

  /** The whole filter, for a URL or a saved analysis. */
  snapshot(): LensFilter {
    return this.filter;
  }

  restore(filter: LensFilter): void {
    this.filter = { ...filter, attributes: filter.attributes ?? [] };
    this.emit();
  }

  /** True when a filter narrows the population in any way. */
  get isActive(): boolean {
    return this.filter.type !== undefined || this.filter.attributes.length > 0;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.filter);
  }
}

/**
 * The attribute conditions to apply when querying, optionally excluding one.
 *
 * A chart passes its own attribute as `exclude` so it keeps every bar while
 * still honouring selections made on *other* attributes — filtering a chart by
 * one of its own values would collapse it to a single bar.
 */
export function scopeFor(
  filter: LensFilter,
  exclude?: AttributeChoice,
): AttributeFilter<MetaModel> | undefined {
  const conditions = filter.attributes
    .filter((selection) => !exclude || !isSameAttribute(selection.choice, exclude))
    .map((selection) => selection.condition);

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { and: conditions };
}

/**
 * Conditions excluding selections on any of the given attributes.
 *
 * A two-axis chart owns two attributes, so it needs to drop both — scoping a
 * quadrant plot by its own axes leaves only the selected quadrant on screen,
 * rescales the axes to it, and re-splits that at a new median.
 */
export function scopeExcluding(
  filter: LensFilter,
  ...exclude: readonly AttributeChoice[]
): AttributeFilter<MetaModel> | undefined {
  const conditions = filter.attributes
    .filter((selection) => !exclude.some((choice) => isSameAttribute(selection.choice, choice)))
    .map((selection) => selection.condition);

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { and: conditions };
}

/** The selection on a given attribute, if one is active. */
export function selectionFor(
  filter: LensFilter,
  choice: AttributeChoice,
): AttributeSelection | undefined {
  return filter.attributes.find((selection) => isSameAttribute(selection.choice, choice));
}

export function isSameAttribute(a: AttributeChoice, b: AttributeChoice): boolean {
  return a.categoryId === b.categoryId && a.definitionId === b.definitionId;
}
