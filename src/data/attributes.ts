import type {
  AttributeFilter,
  CurrencyCodeType,
  EnumValue,
  MetaModel,
  ObjectType,
  UUID,
} from '@bizzdesign/sdk-bundle/browser';
import type { Kg } from '../sdk/client';
import { numbersOf, SAMPLE_LIMIT, type SampleStore } from './sample-store';

export { SAMPLE_LIMIT };
import { formatCompact } from '../format';

export type AttributeKind =
  | 'integer'
  | 'real'
  | 'money'
  | 'enum'
  | 'boolean'
  | 'date'
  | 'string'
  | 'text'
  | 'reference';

export interface AttributeChoice {
  readonly categoryId: string;
  readonly categoryName: string;
  /** The definition's id — filters address attributes by id, not by name. */
  readonly definitionId: string;
  readonly name: string;
  readonly kind: AttributeKind;
  /** Present for `enum`, in the metamodel's defined order — render as-is. */
  readonly enumValues?: readonly EnumValue[];
  readonly currency?: CurrencyCodeType;
}

export interface Bin {
  readonly label: string;
  readonly count: number;
  /** The filter this bin represents, so tapping it can narrow every view. */
  readonly condition?: AttributeFilter<MetaModel>;
  /** Numeric bounds, for re-deriving stats without a second round trip. */
  readonly range?: { readonly from: number; readonly to: number };
}

export interface Distribution {
  readonly bins: readonly Bin[];
  readonly total: number;
  /** Set when the sample hit `SAMPLE_LIMIT` and the tail was not read. */
  readonly truncated: boolean;
  /**
   * How many objects were read into the sample the bins came from — zero where
   * they came from server-side counts and nothing was read.
   *
   * Only meaningful beside `truncated`, and it has to travel with it, because
   * `SAMPLE_LIMIT` cannot stand in for it: the read also stops on a time
   * budget, so a truncated sample holds whatever it reached rather than the
   * ceiling.
   */
  readonly sampled: number;
  /** Server-side total, for numeric attributes only. */
  readonly sum?: number;
  /** The period a timeline was bucketed into. */
  readonly grain?: Grain;
  /** Sampled quantiles, for numeric attributes only. */
  readonly stats?: NumericStats;
  /** Highest-valued objects, for numeric attributes only. */
  readonly top?: readonly RankedObject[];
  /** The sampled values themselves, so a bucket can be re-read client-side. */
  readonly observations?: readonly RankedObject[];
}

export interface NumericStats {
  readonly min: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
}

export interface Coverage {
  readonly withValue: number;
  readonly notSet: number;
}

export interface RankedObject {
  readonly id: UUID;
  readonly name: string;
  readonly value: number;
}

/**
 * The attributes defined for an object type, flattened across categories.
 *
 * This is the schema the charts are built from: the declared `type` decides
 * which visualization is even meaningful, so the app can propose one instead of
 * presenting an empty configuration panel.
 */
export async function attributesFor(kg: Kg, type: ObjectType): Promise<AttributeChoice[]> {
  const choices: AttributeChoice[] = [];

  for await (const category of kg.getAttributeCategoryDefinitions({ types: [type] }).stream()) {
    for (const definition of category.attributeDefinitions) {
      choices.push({
        categoryId: category.id,
        categoryName: category.name,
        definitionId: definition.id,
        name: definition.name,
        kind: definition.type as AttributeKind,
        // `enumValues` order is a documented stable contract — keep the array
        // as the source of order rather than re-deriving it from a lookup.
        ...(definition.type === 'enum' ? { enumValues: definition.enumValues } : {}),
        ...(definition.type === 'money' ? { currency: definition.currency } : {}),
      });
    }
  }

  return choices.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.name.localeCompare(b.name));
}

/** Charts we know how to draw. Anything else is listed but not plotted. */
export function isPlottable(choice: AttributeChoice): boolean {
  return ['enum', 'boolean', 'integer', 'real', 'money', 'date', 'string', 'text'].includes(
    choice.kind,
  );
}

/**
 * The name an `attributeFilter` condition expects: `categoryId.definitionId`.
 *
 * A bare attribute name is rejected by the backend with "Name must contain at
 * least the category and the attribute name", and the second half is the
 * definition's **id**, not its display name.
 */
export function conditionName(choice: AttributeChoice): string {
  return `${choice.categoryId}.${choice.definitionId}`;
}

/**
 * A numeric comparison value typed to match the attribute it is compared
 * against — a `money` attribute is not filtered with a `real` expression.
 */
function numberExpression(choice: AttributeChoice, value: number) {
  return choice.kind === 'money'
    ? ({ type: 'money', value, ...(choice.currency ? { currency: choice.currency } : {}) } as const)
    : ({ type: choice.kind === 'integer' ? 'integer' : 'real', value } as const);
}

/** Composes a bin's own condition with whatever filter is already active. */
function withScope(
  own: AttributeFilter<MetaModel>,
  scope: AttributeFilter<MetaModel> | undefined,
): AttributeFilter<MetaModel> {
  return scope ? { and: [scope, own] } : own;
}

export interface Point {
  readonly id: UUID;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** Optional third measure, used for bubble area. */
  readonly size?: number;
  /** Optional categorical value, used to highlight a subset. */
  readonly group?: string;
}

/**
 * An equality condition for a value as the table displays it.
 *
 * Enumerations are the awkward case: a cell shows the label but the backend
 * filters on the value's **id**, so the label is mapped back through the
 * definition. Returns null when the value cannot be expressed as a filter.
 */
export function equalsCondition(
  choice: AttributeChoice,
  raw: unknown,
): AttributeFilter<MetaModel> | null {
  const name = conditionName(choice);

  if (choice.kind === 'enum') {
    const match = choice.enumValues?.find((entry) => entry.name === String(raw));
    if (!match) return null;
    return {
      condition: {
        name,
        operator: 'equals',
        expression: { value: { type: 'enum', value: match.id } },
      },
    };
  }

  if (typeof raw === 'number') {
    return {
      condition: {
        name,
        operator: 'equals',
        expression: { value: numberExpression(choice, raw) },
      },
    };
  }

  if (typeof raw === 'string' && raw !== '') {
    return {
      condition: { name, operator: 'equals', expression: { value: { type: 'string', value: raw } } },
    };
  }

  if (typeof raw === 'boolean') {
    return {
      condition: { name, operator: 'equals', expression: { value: { type: 'boolean', value: raw } } },
    };
  }

  return null;
}

/** A half-open numeric condition, for slicing an axis at a threshold. */
export function thresholdCondition(
  choice: AttributeChoice,
  operator: 'greaterThanOrEquals' | 'lessThan',
  value: number,
): AttributeFilter<MetaModel> {
  return {
    condition: {
      name: conditionName(choice),
      operator,
      expression: { value: numberExpression(choice, value) },
    },
  };
}

/**
 * Paired values of two numeric attributes, for a scatter plot.
 *
 * One stream, both attributes read per object — the backend has no way to
 * project two attributes into pairs, and two separate queries could not be
 * joined back together reliably.
 */
export async function scatterPoints(
  store: SampleStore,
  type: ObjectType,
  x: AttributeChoice,
  y: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
  size?: AttributeChoice,
  group?: AttributeChoice,
): Promise<{ points: Point[]; truncated: boolean; sampled: number; groups: string[] }> {
  const sample = await store.get(type, scope);
  const xKey = `${x.categoryId}::${x.name}`;
  const yKey = `${y.categoryId}::${y.name}`;
  const sizeKey = size ? `${size.categoryId}::${size.name}` : null;
  const groupKey = group ? `${group.categoryId}::${group.name}` : null;
  const seen = new Set<string>();

  const points: Point[] = [];
  for (const object of sample.objects) {
    const xValue = object.values.get(xKey);
    const yValue = object.values.get(yKey);
    // Only objects carrying both measures can be positioned.
    if (typeof xValue !== 'number' || typeof yValue !== 'number') continue;

    const sizeValue = sizeKey === null ? undefined : object.values.get(sizeKey);
    const groupValue = groupKey === null ? undefined : object.values.get(groupKey);
    if (typeof groupValue === 'string' && groupValue !== '') seen.add(groupValue);

    points.push({
      id: object.id,
      name: object.name,
      x: xValue,
      y: yValue,
      ...(typeof sizeValue === 'number' ? { size: sizeValue } : {}),
      ...(typeof groupValue === 'string' && groupValue !== '' ? { group: groupValue } : {}),
    });
  }

  return {
    points,
    truncated: sample.truncated,
    sampled: sample.objects.length,
    groups: [...seen].sort(),
  };
}

export interface CrossTab {
  readonly rows: readonly string[];
  readonly cols: readonly string[];
  /** `counts[row][col]`. */
  readonly counts: readonly (readonly number[])[];
  readonly max: number;
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * Counts for every combination of two categorical attributes.
 *
 * The backend has no cross-tabulation, so this is either derived from a
 * complete sample or, failing that, one `getCount()` per cell — a 5×5 grid is
 * 25 counts that fetch no objects and batch into a single request.
 */
export async function crossTab(
  kg: Kg,
  store: SampleStore,
  type: ObjectType,
  row: AttributeChoice,
  col: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
): Promise<CrossTab> {
  const rows = (row.enumValues ?? []).map((value) => value.name);
  const cols = (col.enumValues ?? []).map((value) => value.name);
  const rowKey = `${row.categoryId}::${row.name}`;
  const colKey = `${col.categoryId}::${col.name}`;

  const sample = store.peek(type, scope);
  let counts: number[][];
  let truncated = false;

  if (sample && !sample.truncated) {
    counts = rows.map(() => cols.map(() => 0));
    for (const object of sample.objects) {
      const r = rows.indexOf(String(object.values.get(rowKey) ?? ''));
      const c = cols.indexOf(String(object.values.get(colKey) ?? ''));
      if (r >= 0 && c >= 0) counts[r]![c]! += 1;
    }
  } else {
    counts = await Promise.all(
      (row.enumValues ?? []).map(async (rowValue) =>
        Promise.all(
          (col.enumValues ?? []).map(async (colValue) =>
            kg
              .getObjects({
                filter: {
                  types: [type],
                  attributeFilter: withScope(
                    {
                      and: [
                        {
                          condition: {
                            name: conditionName(row),
                            operator: 'equals',
                            expression: { value: { type: 'enum', value: rowValue.id } },
                          },
                        },
                        {
                          condition: {
                            name: conditionName(col),
                            operator: 'equals',
                            expression: { value: { type: 'enum', value: colValue.id } },
                          },
                        },
                      ],
                    },
                    scope,
                  ),
                },
                selector: {},
              })
              .getCount(),
          ),
        ),
      ),
    );
    truncated = false;
  }

  let max = 0;
  let total = 0;
  for (const line of counts) {
    for (const value of line) {
      max = Math.max(max, value);
      total += value;
    }
  }

  return { rows, cols, counts, max, total, truncated };
}

/** The equality condition for one enum value, by its label. */
export function enumCondition(
  choice: AttributeChoice,
  label: string,
): AttributeFilter<MetaModel> | null {
  const match = choice.enumValues?.find((value) => value.name === label);
  if (!match) return null;
  return {
    condition: {
      name: conditionName(choice),
      operator: 'equals',
      expression: { value: { type: 'enum', value: match.id } },
    },
  };
}

export interface GroupStat {
  readonly label: string;
  readonly sum: number;
  /** Objects in the group that carry a value — the divisor for an average. */
  readonly objects: number;
  readonly condition: AttributeFilter<MetaModel>;
}

/**
 * A measure aggregated for each value of a categorical attribute.
 *
 * Entirely server-side: per category value, one `aggregateAttributeValues` call
 * for the sum and one `getCount()` for the divisor. No objects are fetched, so
 * this stays cheap over a population of any size — the one genuine group-by the
 * backend can express, and the count is what makes an average possible, since
 * the backend has no `avg`.
 */
export async function statsByCategory(
  kg: Kg,
  type: ObjectType,
  category: AttributeChoice,
  measure: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
): Promise<GroupStat[]> {
  const values = category.enumValues ?? [];

  return Promise.all(
    values.map(async (value) => {
      const condition: AttributeFilter<MetaModel> = {
        condition: {
          name: conditionName(category),
          operator: 'equals',
          expression: { value: { type: 'enum', value: value.id } },
        },
      };

      const inGroup = withScope(condition, scope);
      // The divisor counts only objects that carry the measure, so a group with
      // missing values is not averaged against its full membership.
      const withMeasure: AttributeFilter<MetaModel> = {
        and: [inGroup, { condition: { name: conditionName(measure), operator: 'exists' } }],
      };

      const [{ sum }, objects] = await Promise.all([
        kg.aggregateAttributeValues({
          filter: { types: [type], attributeFilter: inGroup },
          aggregate: { sum: { categoryId: measure.categoryId, name: measure.definitionId } },
        }),
        kg.getObjects({ filter: { types: [type], attributeFilter: withMeasure }, selector: {} }).getCount(),
      ]);

      return { label: value.name, sum, objects, condition };
    }),
  );
}

export type Grain = 'month' | 'quarter' | 'year';

/**
 * The default period for a set of dates.
 *
 * Follows the span, because a fixed choice either crushes a long history into
 * one bar or scatters a short one across hundreds. Only a starting point — the
 * reader can override it.
 */
export function suggestGrain(dates: readonly Date[]): Grain {
  if (dates.length === 0) return 'year';
  const times = dates.map((date) => date.getTime());
  const span = (Math.max(...times) - Math.min(...times)) / (365.25 * 24 * 3600 * 1000);
  return span <= 3 ? 'month' : span <= 12 ? 'quarter' : 'year';
}

function bucketFor(date: Date, grain: Grain): { key: string; start: Date; end: Date } {
  const year = date.getFullYear();
  if (grain === 'year') {
    return { key: String(year), start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }
  if (grain === 'quarter') {
    const quarter = Math.floor(date.getMonth() / 3);
    return {
      key: `${year} Q${quarter + 1}`,
      start: new Date(year, quarter * 3, 1),
      end: new Date(year, quarter * 3 + 3, 1),
    };
  }
  const month = date.getMonth();
  return {
    key: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date),
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 1),
  };
}


export interface Frequency extends Distribution {
  /** How many distinct values exist in the sample. */
  readonly distinct: number;
}

/**
 * The most common values of a free-text attribute.
 *
 * Many "string" attributes are categorical in practice — vendor, domain,
 * licence model — and their value counts are the only sensible chart. Genuinely
 * free text has too many distinct values to plot, so the count of distinct
 * values is reported and the caller decides.
 */
export async function valueFrequency(
  store: SampleStore,
  type: ObjectType,
  choice: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
  limit = 12,
): Promise<Frequency> {
  const key = `${choice.categoryId}::${choice.name}`;
  const sample = await store.get(type, scope);

  const tally = new Map<string, number>();
  let total = 0;
  for (const object of sample.objects) {
    const value = object.values.get(key);
    if (typeof value !== 'string' || value.trim() === '') continue;
    const text = value.trim();
    tally.set(text, (tally.get(text) ?? 0) + 1);
    total += 1;
  }

  const name = conditionName(choice);
  const bins: Bin[] = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      condition: {
        condition: {
          name,
          operator: 'equals' as const,
          expression: { value: { type: 'string' as const, value: label } },
        },
      },
    }));

  return {
    bins,
    total,
    truncated: sample.truncated,
    sampled: sample.objects.length,
    distinct: tally.size,
  };
}

/** The server-side sum of one numeric attribute under an arbitrary scope. */
export async function sumOf(
  kg: Kg,
  type: ObjectType,
  choice: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
): Promise<number> {
  const { sum } = await kg.aggregateAttributeValues({
    filter: { types: [type], ...(scope ? { attributeFilter: scope } : {}) },
    aggregate: { sum: { categoryId: choice.categoryId, name: choice.definitionId } },
  });
  return sum;
}

/**
 * How much of the population actually carries this attribute.
 *
 * A data-quality reading as much as a chart caveat: a distribution over 40% of
 * the estate says something different from one over 98%, and nothing else on
 * the screen reveals which you are looking at.
 */
export async function coverage(
  kg: Kg,
  store: SampleStore,
  type: ObjectType,
  choice: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
): Promise<Coverage> {
  // A sample that ran to the end *is* the population, so coverage is already
  // known and two counts would be a round trip for an answer in memory. A
  // truncated sample proves nothing about the tail, so that still asks.
  const sample = store.peek(type, scope);
  if (sample && !sample.truncated) {
    const key = `${choice.categoryId}::${choice.name}`;
    const withValue = sample.objects.reduce(
      (total, object) => total + (object.values.has(key) ? 1 : 0),
      0,
    );
    return { withValue, notSet: sample.objects.length - withValue };
  }

  const [withValue, notSet] = await Promise.all([
    count(kg, type, choice, 'exists', scope),
    count(kg, type, choice, 'notExists', scope),
  ]);
  return { withValue, notSet };
}

function count(
  kg: Kg,
  type: ObjectType,
  choice: AttributeChoice,
  operator: 'exists' | 'notExists',
  scope: AttributeFilter<MetaModel> | undefined,
): Promise<number> {
  return kg
    .getObjects({
      filter: {
        types: [type],
        attributeFilter: withScope(
          { condition: { name: conditionName(choice), operator } },
          scope,
        ),
      },
      selector: {},
    })
    .getCount();
}

/**
 * Counts objects per enum value, entirely server-side.
 *
 * One `getCount()` per value plus one for "not set" — batched into a single
 * request. Bins keep the metamodel's declared order, so a Low/Medium/High
 * enumeration reads in that order rather than by frequency.
 */
export async function enumDistribution(
  kg: Kg,
  store: SampleStore,
  type: ObjectType,
  choice: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
): Promise<Distribution> {
  const values = choice.enumValues ?? [];

  // The sample keeps enum labels, so a complete one answers this without a
  // request. Never *starts* a read for it though: a cold enum chart is two
  // counts, and streaming the population to avoid them would be a loss.
  const sample = store.peek(type, scope);
  if (sample && !sample.truncated) {
    const key = `${choice.categoryId}::${choice.name}`;
    const tally = new Map<string, number>();
    let notSet = 0;
    for (const object of sample.objects) {
      const value = object.values.get(key);
      if (typeof value === 'string' && value !== '') {
        tally.set(value, (tally.get(value) ?? 0) + 1);
      } else {
        notSet += 1;
      }
    }

    const counted = values.map((value) => ({
      label: value.name,
      count: tally.get(value.name) ?? 0,
      condition: {
        condition: {
          name: conditionName(choice),
          operator: 'equals' as const,
          expression: { value: { type: 'enum' as const, value: value.id } },
        },
      },
    }));

    const bins =
      notSet > 0
        ? [
            ...counted,
            {
              label: 'Not set',
              count: notSet,
              condition: {
                condition: { name: conditionName(choice), operator: 'notExists' as const },
              },
            },
          ]
        : counted;

    return {
      bins,
      total: bins.reduce((sum, bin) => sum + bin.count, 0),
      truncated: false,
      sampled: sample.objects.length,
    };
  }

  const counted = await Promise.all(
    values.map(async (value) => {
      // An enum attribute stores the value's id, not its label.
      const condition: AttributeFilter<MetaModel> = {
        condition: {
          name: conditionName(choice),
          operator: 'equals',
          expression: { value: { type: 'enum', value: value.id } },
        },
      };

      return {
        label: value.name,
        condition,
        count: await kg
          .getObjects({
            filter: { types: [type], attributeFilter: withScope(condition, scope) },
            selector: {},
          })
          .getCount(),
      };
    }),
  );

  const notSetCondition: AttributeFilter<MetaModel> = {
    condition: { name: conditionName(choice), operator: 'notExists' },
  };

  const notSet = await kg
    .getObjects({
      filter: { types: [type], attributeFilter: withScope(notSetCondition, scope) },
      selector: {},
    })
    .getCount();

  const bins =
    notSet > 0
      ? [...counted, { label: 'Not set', count: notSet, condition: notSetCondition }]
      : counted;

  return {
    bins,
    total: bins.reduce((sum, bin) => sum + bin.count, 0),
    truncated: false,
    // Counted server-side; no objects were read, so there is no read to size.
    sampled: 0,
  };
}

/**
 * A histogram of a numeric attribute, plus the exact server-side total.
 *
 * The sum comes from `aggregateAttributeValues()` and covers every matching
 * object. The bins are computed here from a bounded sample, because the backend
 * has no group-by — so the two numbers answer different questions and the
 * sample size is stated rather than implied.
 */
export async function numericDistribution(
  kg: Kg,
  store: SampleStore,
  type: ObjectType,
  choice: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
): Promise<Distribution> {
  const key = `${choice.categoryId}::${choice.name}`;

  const cached = store.peek(type, scope);
  const sample = cached ?? (await store.get(type, scope));

  const observations = numbersOf(sample, key);
  const numbers = observations.map((observation) => observation.value);

  // Same reasoning as coverage: an untruncated sample holds every value, so the
  // total is already computable and the aggregate call is pure latency. Only a
  // truncated read has to ask the server for a figure covering the tail.
  const sum = sample.truncated
    ? (
        await kg.aggregateAttributeValues({
          filter: { types: [type], ...(scope ? { attributeFilter: scope } : {}) },
          aggregate: { sum: { categoryId: choice.categoryId, name: choice.definitionId } },
        })
      ).sum
    : numbers.reduce((total, value) => total + value, 0);

  // An empty sample has no quantiles. `stats` is declared optional and now
  // means it: absent rather than present-and-undefined.
  const stats = quantiles(numbers);

  return {
    ...histogram(numbers, choice),
    total: numbers.length,
    truncated: sample.truncated,
    sampled: sample.objects.length,
    sum,
    ...(stats ? { stats } : {}),
    top: rank(observations),
    observations,
  };
}

/**
 * Counts per time period.
 *
 * The backend has no date grouping, so values are read once into the shared
 * sample and bucketed here. Granularity follows the span — months for a couple
 * of years, quarters for a decade, years beyond — because a fixed choice either
 * crushes a long history into one bar or scatters a short one across hundreds.
 */
export async function dateDistribution(
  store: SampleStore,
  type: ObjectType,
  choice: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
  grain?: Grain,
): Promise<Distribution> {
  const key = `${choice.categoryId}::${choice.name}`;
  const sample = await store.get(type, scope);

  const dates: Date[] = [];
  for (const object of sample.objects) {
    const value = object.values.get(key);
    if (value instanceof Date) dates.push(value);
  }

  if (dates.length === 0)
    return { bins: [], total: 0, truncated: sample.truncated, sampled: sample.objects.length };

  const chosen: Grain = grain ?? suggestGrain(dates);

  const counts = new Map<string, { start: Date; end: Date; count: number }>();
  for (const date of dates) {
    const bucket = bucketFor(date, chosen);
    const existing = counts.get(bucket.key);
    if (existing) existing.count += 1;
    else counts.set(bucket.key, { start: bucket.start, end: bucket.end, count: 1 });
  }

  const name = conditionName(choice);
  const bins: Bin[] = [...counts.entries()]
    .sort((a, b) => a[1].start.getTime() - b[1].start.getTime())
    .map(([label, bucket]) => ({
      label,
      count: bucket.count,
      condition: {
        and: [
          {
            condition: {
              name,
              operator: 'greaterThanOrEquals' as const,
              expression: { value: { type: 'date' as const, value: bucket.start } },
            },
          },
          {
            condition: {
              name,
              operator: 'lessThan' as const,
              expression: { value: { type: 'date' as const, value: bucket.end } },
            },
          },
        ],
      },
    }));

  return {
    bins,
    total: dates.length,
    truncated: sample.truncated,
    sampled: sample.objects.length,
  };
}

export interface TrendPoint extends Bin {
  /** The aggregated measure for the period, which is what the column height shows. */
  readonly measure: number;
}

export interface Trend {
  readonly points: readonly TrendPoint[];
  readonly grain: Grain;
  /** True when the measure is summed rather than averaged. */
  readonly additive: boolean;
  readonly truncated: boolean;
  /** How many objects were read to build it — see `Distribution.sampled`. */
  readonly sampled: number;
  /** Objects carrying both a date and a measure — the population behind the line. */
  readonly counted: number;
  /**
   * The measure across all of them, as the headline beside the chart.
   *
   * Averaged over objects rather than over periods, which is not the same
   * number: ten objects averaging 2 in one month and one at 10 in the next is
   * 2,7 across the eleven, where a mean of the two periods' means is 6 and
   * gives a quiet month the same say as a busy one. Computed from the pairs
   * rather than from the buckets, so it does not depend on the per-period
   * arithmetic agreeing with it. Summed instead where the measure is money.
   */
  readonly overall: number;
}

/**
 * A measure per period: what happened to this number over this date.
 *
 * Money is summed, because a total of costs is a cost. Anything else is
 * averaged: adding up scores across a quarter produces a bigger number for a
 * busier quarter rather than a higher-scoring one, which is a headcount wearing
 * a score's label.
 *
 * Both values come from the shared population read, so pairing an attribute
 * with a date costs nothing beyond the read that has already happened.
 */
export async function measureOverTime(
  store: SampleStore,
  type: ObjectType,
  when: AttributeChoice,
  measure: AttributeChoice,
  scope?: AttributeFilter<MetaModel>,
  grain?: Grain,
): Promise<Trend> {
  const dateKey = `${when.categoryId}::${when.name}`;
  const measureKey = `${measure.categoryId}::${measure.name}`;
  const sample = await store.get(type, scope);

  const paired: Array<{ date: Date; value: number }> = [];
  for (const object of sample.objects) {
    const date = object.values.get(dateKey);
    const value = object.values.get(measureKey);
    // Only objects carrying both belong here; one without the other would move
    // a period's figure without being part of what it describes.
    if (date instanceof Date && typeof value === 'number') paired.push({ date, value });
  }

  const chosen: Grain = grain ?? suggestGrain(paired.map((entry) => entry.date));
  // A money measure is summed whether or not anything carried it: `additive`
  // is a fact about the measure, and saying otherwise here made the same
  // attribute report `true` with one pair and `false` with none.
  const additive = measure.kind === 'money';
  if (paired.length === 0) {
    return {
      points: [],
      grain: chosen,
      additive,
      truncated: sample.truncated,
      sampled: sample.objects.length,
      counted: 0,
      overall: 0,
    };
  }

  const measured = paired.reduce((sum, entry) => sum + entry.value, 0);
  const buckets = new Map<string, { start: Date; end: Date; sum: number; count: number }>();
  for (const { date, value } of paired) {
    const bucket = bucketFor(date, chosen);
    const existing = buckets.get(bucket.key);
    if (existing) {
      existing.sum += value;
      existing.count += 1;
    } else {
      buckets.set(bucket.key, { start: bucket.start, end: bucket.end, sum: value, count: 1 });
    }
  }

  const name = conditionName(when);
  const points: TrendPoint[] = [...buckets.entries()]
    .sort((a, b) => a[1].start.getTime() - b[1].start.getTime())
    .map(([label, bucket]) => ({
      label,
      count: bucket.count,
      measure: additive ? bucket.sum : bucket.sum / bucket.count,
      condition: {
        and: [
          {
            condition: {
              name,
              operator: 'greaterThanOrEquals' as const,
              expression: { value: { type: 'date' as const, value: bucket.start } },
            },
          },
          {
            condition: {
              name,
              operator: 'lessThan' as const,
              expression: { value: { type: 'date' as const, value: bucket.end } },
            },
          },
        ],
      },
    }));

  return {
    points,
    grain: chosen,
    additive,
    truncated: sample.truncated,
    sampled: sample.objects.length,
    counted: paired.length,
    overall: additive ? measured : measured / paired.length,
  };
}

export function rank(observations: readonly RankedObject[]): RankedObject[] {
  return [...observations].sort((a, b) => b.value - a.value).slice(0, 10);
}

/** Quantiles of the sample — the shape a single total cannot show. */
export function quantiles(values: readonly number[]): NumericStats | undefined {
  if (values.length === 0) return undefined;

  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!;

  return { min: sorted[0]!, median: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1]! };
}

/**
 * Equal-width bins over the observed range, rounded to readable boundaries.
 *
 * Exported for the tests that pin the boundaries: where a bin starts, which
 * bin the maximum lands in, and that the counts still add up to what went in.
 * Reaching it through `numericDistribution` would mean standing up a knowledge
 * graph and a sample store to check arithmetic that needs neither.
 */
export function histogram(values: readonly number[], choice: AttributeChoice): { bins: Bin[] } {
  if (values.length === 0) return { bins: [] };

  const low = Math.min(...values);
  const high = Math.max(...values);

  if (low === high) {
    return { bins: [{ label: format(low), count: values.length }] };
  }

  const count = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(values.length))));
  const step = niceStep((high - low) / count);
  const start = Math.floor(low / step) * step;
  const binCount = Math.max(1, Math.ceil((high - start) / step));

  const counts = new Array<number>(binCount).fill(0);
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - start) / step));
    counts[index] = (counts[index] ?? 0) + 1;
  }

  const name = conditionName(choice);

  return {
    bins: counts.map((total, index) => {
      const from = start + index * step;
      const to = from + step;
      const last = index === binCount - 1;

      return {
        label: `${format(from)}–${format(to)}`,
        count: total,
        range: { from, to },
        // Half-open buckets, except the last one which must include the max.
        condition: {
          and: [
            {
              condition: {
                name,
                operator: 'greaterThanOrEquals' as const,
                expression: { value: numberExpression(choice, from) },
              },
            },
            {
              condition: {
                name,
                operator: last ? ('lessThanOrEquals' as const) : ('lessThan' as const),
                expression: { value: numberExpression(choice, to) },
              },
            },
          ],
        },
      };
    }),
  };
}

function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const snapped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return snapped * magnitude;
}

/** Bucket bounds read with the same suffixes as every other figure. */
function format(value: number): string {
  return formatCompact(Math.round(value * 100) / 100);
}
