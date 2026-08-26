import type { AttributeFilter, MetaModel, ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Kg } from '../sdk/client';

/** How many objects a client-side derivation will read before it stops. */
export const SAMPLE_LIMIT = 4000;
/**
 * Objects per request.
 *
 * The SDK's default paging walks a population of three hundred in four
 * sequential round trips; at this size it takes one. Measured on 301 objects
 * carrying forty-four attributes each: 8.0s over four requests against 5.6s
 * over one. What remains is the server composing the payload, which no amount
 * of paging changes. 500 is the SDK's own soft ceiling — larger is permitted
 * but warns, and measured no faster.
 */
const PAGE = 500;

export type Value = number | string | boolean | Date;

export interface SampledObject {
  readonly id: UUID;
  readonly name: string;
  readonly createdAt: Date | null;
  /** Values keyed `categoryId::attributeName`. */
  readonly values: ReadonlyMap<string, Value>;
}

export interface Sample {
  readonly objects: readonly SampledObject[];
  /** Set when the read stopped at `SAMPLE_LIMIT` rather than the end. */
  readonly truncated: boolean;
  /** False while more pages are still arriving. */
  readonly complete: boolean;
}

/**
 * One read of a population, shared by every derivation that needs values.
 *
 * The selector can only ask for `attributeCategories` as a whole — there is no
 * per-attribute projection — so a single object arrives carrying all forty of
 * its values. Streaming once per *attribute* therefore downloaded the same
 * payload again for every chart: switching from Annual Cost to User Count re-read
 * the entire estate to look at a number that was already in memory.
 *
 * Keyed by type and filter, because a different filter is a different
 * population. Concurrent callers share one in-flight read.
 */
export class SampleStore {
  private readonly cache = new Map<string, Sample>();
  private readonly inFlight = new Map<string, Promise<Sample>>();

  constructor(private readonly kg: Kg) {}

  /**
   * @param onProgress - called with each partial snapshot, so a chart can draw
   *   from the first page instead of waiting for the whole population.
   */
  get(
    type: ObjectType,
    scope: AttributeFilter<MetaModel> | undefined,
    onProgress?: (sample: Sample) => void,
  ): Promise<Sample> {
    const key = JSON.stringify([type, scope ?? null]);

    const cached = this.cache.get(key);
    if (cached?.complete) return Promise.resolve(cached);

    const running = this.inFlight.get(key);
    if (running) return running;

    const read = this.read(type, scope, key, onProgress).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, read);
    return read;
  }

  /**
   * The cached sample, if there is a complete one — without starting a read.
   *
   * Lets a caller prefer deriving a figure over asking the server, but only
   * when the data is already in hand: forcing a population read to answer a
   * question two `getCount()` calls could settle would be a bad trade.
   */
  peek(type: ObjectType, scope: AttributeFilter<MetaModel> | undefined): Sample | undefined {
    const cached = this.cache.get(JSON.stringify([type, scope ?? null]));
    return cached?.complete ? cached : undefined;
  }

  /** Drops everything — call when the graph changes underneath. */
  clear(): void {
    this.cache.clear();
  }

  private async read(
    type: ObjectType,
    scope: AttributeFilter<MetaModel> | undefined,
    key: string,
    onProgress?: (sample: Sample) => void,
  ): Promise<Sample> {
    const pages = this.kg
      .getObjects({
        filter: { types: [type], ...(scope ? { attributeFilter: scope } : {}) },
        selector: { attributeCategories: true, systemAttributes: true },
      })
      .asPages({ pageSize: PAGE });

    const objects: SampledObject[] = [];
    let truncated = false;

    // The first page also settles the count, so asking how many there are costs
    // nothing extra afterwards.
    const first = await pages.getPage(0);
    const total = await pages.getNumberOfPages();
    const wanted = Math.min(total, Math.ceil(SAMPLE_LIMIT / PAGE));

    // Requested together rather than one after the next: pages are randomly
    // addressable, so the round trips overlap instead of queueing. Awaited in
    // order so a partial snapshot is always a prefix of the population rather
    // than whichever pages happened to land first.
    const rest = Array.from({ length: Math.max(wanted - 1, 0) }, (_, index) =>
      pages.getPage(index + 1),
    );

    for (const page of [Promise.resolve(first), ...rest]) {
      for (const object of await page) {
        const values = new Map<string, Value>();
        for (const category of object.attributeCategories) {
          for (const attribute of category.attributes) {
            const value = attribute.value;
            if (value === null || value === undefined) continue;
            if (attribute.type === 'enum') {
              values.set(
                `${category.id}::${attribute.name}`,
                attribute.displayValue ?? String(value),
              );
            } else if (
              typeof value === 'number' ||
              typeof value === 'string' ||
              typeof value === 'boolean' ||
              value instanceof Date
            ) {
              values.set(`${category.id}::${attribute.name}`, value);
            }
          }
        }

        objects.push({
          id: object.id,
          name: object.name ?? '(unnamed)',
          createdAt: object.systemAttributes?.createdAt ?? null,
          values,
        });

        if (objects.length >= SAMPLE_LIMIT) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
      onProgress?.({ objects: [...objects], truncated: false, complete: false });
    }

    truncated ||= total > wanted;

    const sample: Sample = { objects, truncated, complete: true };
    this.cache.set(key, sample);
    return sample;
  }
}

/** Numbers only, for a measure. */
export function numbersOf(sample: Sample, key: string): Array<{ id: UUID; name: string; value: number }> {
  const out: Array<{ id: UUID; name: string; value: number }> = [];
  for (const object of sample.objects) {
    const value = object.values.get(key);
    if (typeof value === 'number') out.push({ id: object.id, name: object.name, value });
  }
  return out;
}
