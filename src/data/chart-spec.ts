import type { AttributeChoice, AttributeKind } from './attributes';

export type Mark =
  | 'heatmap'
  | 'bars'
  | 'donut'
  | 'histogram'
  | 'scatter'
  | 'sum-by'
  | 'quadrant'
  | 'timeline'
  | 'frequency' | 'trend';

export interface MarkOption {
  readonly mark: Mark;
  readonly label: string;
  /** Why this mark is offered, shown on the control. */
  readonly hint: string;
}

/** The measurement level that decides which marks are even meaningful. */
export type Level = 'categorical' | 'quantitative' | 'temporal' | 'nominal' | 'other';

export function levelOf(kind: AttributeKind): Level {
  switch (kind) {
    case 'enum':
    case 'boolean':
      return 'categorical';
    case 'integer':
    case 'real':
    case 'money':
      return 'quantitative';
    case 'date':
      return 'temporal';
    case 'string':
    case 'text':
      return 'nominal';
    default:
      return 'other';
  }
}

/**
 * The marks that are valid for a field combination, best first.
 *
 * This is the whole idea: the user picks *fields*, never a chart type. The
 * metamodel already declares what each attribute is, so the set of meaningful
 * visualizations is derivable — offering a gallery of every chart type and
 * letting people pick an invalid one is what makes BI tools tedious.
 *
 * A mark that would misrepresent the data is not offered at all, which is why
 * the list is short. That is the feature, not a limitation.
 */
export function marksFor(primary: AttributeChoice, secondary?: AttributeChoice): MarkOption[] {
  const a = levelOf(primary.kind);
  const b = secondary ? levelOf(secondary.kind) : undefined;

  // A date with a measure reads as a trend regardless of which was picked
  // first, so both orders land on the same chart rather than one of them
  // silently offering nothing.
  if (secondary && ((a === 'temporal' && b === 'quantitative') || (a === 'quantitative' && b === 'temporal'))) {
    const when = a === 'temporal' ? primary : secondary;
    const measure = a === 'temporal' ? secondary : primary;
    return [
      {
        mark: 'trend',
        label: 'Trend',
        hint: `${measure.name} over ${when.name}${measure.kind === 'money' ? ', totalled' : ', averaged'} per period. Tap a period to filter to it.`,
      },
    ];
  }

  if (secondary && a === 'quantitative' && b === 'quantitative') {
    const scatter: MarkOption = {
      mark: 'scatter',
      label: 'Scatter',
      hint: 'Two measures across the same objects — shows correlation and outliers.',
    };
    const quadrant: MarkOption = {
      mark: 'quadrant',
      label: 'Quadrant',
      hint: `Splits ${primary.name} against ${secondary.name} at the midpoint of each. Tap a quadrant to filter to it.`,
    };

    // Two scores make a rationalisation grid — high/low against high/low is the
    // question being asked. A cost axis has no natural midpoint, so those pairs
    // lead with the plain scatter.
    const scores = primary.kind !== 'money' && secondary.kind !== 'money';
    return scores ? [quadrant, scatter] : [scatter, quadrant];
  }

  // Two categoricals cross-tabulate. A grid of counts is the honest form: one
  // sequential hue for magnitude, and position carries both identities, so no
  // categorical palette is needed at all.
  if (secondary && a === 'categorical' && b === 'categorical') {
    return [
      {
        mark: 'heatmap',
        label: 'Grid',
        hint: `How ${primary.name} and ${secondary.name} combine. Tap a cell to filter to it.`,
      },
      { mark: 'bars', label: 'Counts', hint: `Counts of ${primary.name} alone.` },
    ];
  }

  if (secondary && a === 'categorical' && b === 'quantitative') {
    return pairMarks(primary, secondary);
  }

  if (secondary && a === 'quantitative' && b === 'categorical') {
    return pairMarks(secondary, primary);
  }

  if (a === 'categorical') {
    const options: MarkOption[] = [];
    // A pie only reads when the slices are few and genuinely parts of one
    // whole. Past five, angle differences stop being judgeable and a bar list
    // is strictly better, so it is withheld rather than offered and regretted.
    // A small enumeration is a part-to-whole before it is a ranking, so the
    // ring leads and the bars are the alternate. Past five values the angles
    // stop being comparable and the ordering flips back.
    const slices = primary.enumValues?.length ?? 0;
    if (slices >= 2 && slices <= 5) {
      options.push({
        mark: 'donut',
        label: 'Donut',
        hint: 'Part-to-whole. Offered only because there are five values or fewer.',
      });
    }
    options.push({ mark: 'bars', label: 'Bars', hint: 'Ranked comparison.' });
    return options;
  }

  if (a === 'quantitative') {
    return [{ mark: 'histogram', label: 'Histogram', hint: 'Distribution of one measure.' }];
  }

  if (a === 'temporal') {
    return [
      {
        mark: 'timeline',
        label: 'Over time',
        hint: 'How many objects fall in each period, oldest first.',
      },
    ];
  }

  // Free-text attributes are often categorical in practice — vendor, domain,
  // licence model — so their value counts are worth plotting. Genuinely free
  // text is caught at render time by its distinct-value count, not here.
  if (a === 'nominal') {
    return [
      { mark: 'frequency', label: 'Most common', hint: 'The values that occur most often.' },
    ];
  }

  return [];
}

/**
 * Grouping a measure by a category — summed if the measure is additive,
 * averaged otherwise.
 *
 * Money adds up; a rating or a score does not. "Total Business Fit Score" is
 * arithmetic without a referent, so a non-additive measure is averaged instead.
 */
/**
 * Marks for a measure grouped by a category.
 *
 * The ring is offered only when the measure is additive. A share-of-total makes
 * sense for money — "which criticality band holds the spend" — but averages do
 * not compose into a whole, so pie-charting them would invent a total that does
 * not exist.
 */
function pairMarks(category: AttributeChoice, measure: AttributeChoice): MarkOption[] {
  const marks: MarkOption[] = [groupMark(category, measure)];
  const slices = category.enumValues?.length ?? 0;

  if (measure.kind === 'money' && slices >= 2 && slices <= 5) {
    marks.push({
      mark: 'donut',
      label: 'Donut',
      hint: `Share of total ${measure.name} per ${category.name}.`,
    });
  }

  marks.push({ mark: 'bars', label: 'Counts', hint: 'How many objects hold each value.' });
  return marks;
}

function groupMark(category: AttributeChoice, measure: AttributeChoice): MarkOption {
  return measure.kind === 'money'
    ? {
        mark: 'sum-by',
        label: 'Total by category',
        hint: `Sums ${measure.name} for each ${category.name} value, server-side.`,
      }
    : {
        mark: 'sum-by',
        label: 'Average by category',
        hint: `Mean ${measure.name} per ${category.name} value — a score does not add up.`,
      };
}

/** Attributes that can pair with this one to make a chart worth offering. */
export function compatible(
  primary: AttributeChoice,
  all: readonly AttributeChoice[],
): AttributeChoice[] {
  const a = levelOf(primary.kind);
  if (a !== 'quantitative' && a !== 'categorical' && a !== 'temporal') return [];

  return all.filter((choice) => {
    if (choice.categoryId === primary.categoryId && choice.definitionId === primary.definitionId) {
      return false;
    }
    const b = levelOf(choice.kind);
    // A date pairs with a measure and nothing else for now: a measure over a
    // date is a trend, while a date against a category or another date needs a
    // form this app does not draw yet.
    if (a === 'temporal') return b === 'quantitative';
    // A categorical pairs with a measure (totals per group) or with another
    // categorical (a cross-tab). Previously only the first was offered, which
    // left "Compare with" dead for a type whose attributes are all enums.
    return a === 'quantitative'
      ? b === 'quantitative' || b === 'categorical' || b === 'temporal'
      : b === 'quantitative' || b === 'categorical';
  });
}
