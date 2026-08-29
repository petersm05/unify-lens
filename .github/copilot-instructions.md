# Reviewing Unify Lens

A visualization surface for the Bizzdesign Unify knowledge graph, built on the
published partner SDK. TypeScript, no framework, no runtime beyond the browser.
`pages.yml` runs `npm test` before it builds, so a failing test costs a build
and not a publish — do not suggest reordering those steps.

What follows is the set of rules that have actually been broken here, and the
conventions that are deliberate rather than accidental. Please weigh findings
against these rather than against general TypeScript style.

## Rules worth failing a review over

**No test may reach the SDK at run time.** `@bizzdesign/sdk-bundle` is CommonJS
underneath, so the test runner's ESM loader cannot take a named export out of
`ts-results` and dies *collecting* the file — which fails the whole suite while
reporting every other test as passing, and stops the deploy. This has cost two
deploys. `src/test-graph.test.ts` enforces it. The fix is always to move the
pure part into its own module (as `table-columns.ts` was split from
`object-table.ts`), never to add a loader shim.

**`import type` and `import { type X }` are different statements.**
`verbatimModuleSyntax` is on. The first is erased; the second still emits
`import {} from '…'` and loads the module. A test taking SDK *types* is fine; a
test that mentions `type` inside braces is not.

**An `attributeFilter` condition addresses the definition id, never the display
name.** `conditionName` builds `categoryId.definitionId`. A filter built from a
label matches nothing and fails silently — no error, just an empty result.

The rule is about conditions only. Keys into a sample's value map are
`categoryId::name` on purpose, because that is what the read returns; those are
correct as they stand.

**Sampling must not be swallowed.** `SAMPLE_LIMIT` bounds reads, and
`truncated` is threaded through the distributions and `scatterPoints` on
purpose.

Two reads are exact instead, and carry no meaningful flag: `coverage` asks the
server for counts where the sample cannot answer honestly, and `crossTab`
counts per cell server-side — its `truncated` is `false` on both paths and
nothing reads it. Do not raise a dropped-flag finding against either. A figure derived from a sample is a different claim
from one over the population. Dropping a `truncated` flag on the floor is a
correctness bug, not a tidy-up.

**Status is never colour alone.** Every state carries a word as well as a hue.

**The two theme ramps are different colours.** `--ord-0…5` are *not* the same in
light and dark; the light ramp starts mid-toned and the dark one starts
near-white. Anything that puts ink on a ramp step must take it from
`--on-ord-0…5`, which is defined beside the ramp, and never from
`--text-primary` or `--surface-1` — those swap with the theme and hand each end
of the ramp the other end's ink. That was a 1.11:1 contrast defect.

## The compiler settings a suggestion has to satisfy

`strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. In
particular: indexing an array yields `T | undefined`, and an optional property
will not accept an explicit `undefined`. A suggestion that ignores either will
not compile.

## Things that look like problems here and are not

- **Long comments explaining *why*.** The house style records the reasoning
  behind a decision, including options that were rejected and measurements that
  settled a question. Please do not suggest shortening or deleting them; a
  comment that only restates the code is worth flagging, one that carries
  history is not.
- **Prose in commit messages and pull request bodies.** Same reason.
- **Inline `style.background` / `style.color` in the chart renderers.** Per-step
  ramp values come from CSS custom properties and are set inline on purpose, so
  the palette stays in one place.
- **`dev/phone-harness.html`.** A deliberate static harness for looking at
  layouts without a live tenant. It imports the real modules; that is the point.

## What is genuinely useful to flag

- Arithmetic that changes a figure — quantile conventions, bin boundaries,
  counts that no longer sum to their input, an off-by-one in a slice.
- A `truncated`, `null` or `undefined` case that is not handled where the
  surrounding code handles it.
- Anything that would widen the bundle: a new runtime dependency, or a large
  import pulled in for one helper. This app is opened over cellular on tablets
  and phones.
- Accessibility: contrast against the *actual* surface a thing sits on, hit
  targets, and anything conveyed by colour with no text beside it.
- Layout that breaks at a narrow width or a short one. The panel and the chart
  do **not** take turns — that was removed deliberately, and `src/ui/rail.ts`
  says why. The panel sits beside the chart where there is room and over it
  where there is not, and the chart is on screen either way. The widths that
  matter are 900, 820 (where the panel becomes an overlay), 700 and 560, plus a
  520px *height* breakpoint for a phone in landscape.

## What this app is not

There is no server, no framework and no state library. Suggestions that
introduce React, a store, a CSS framework, or a build step beyond Vite are out
of scope — please do not raise them.
