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
deploys. `src/test-graph.test.ts` catches it, though only for static imports: a dynamic
`await import(…)` slips past, and fails as one test rather than taking the
collection down. The fix is always to move the
pure part into its own module (as `table-columns.ts` was split from
`object-table.ts`), never to add a loader shim.

**`import type` and `import { type X }` are different statements.**
`verbatimModuleSyntax` is on. The first is erased; the second still emits
`import {} from '…'` and loads the module. That difference only bites on the
SDK: `import type { MetaModel } from '@bizzdesign/…'` in a test is fine, while
`import { type MetaModel } from '@bizzdesign/…'` is not. Inline `type` beside
real imports from a local module — `import { columnFor, type Column } from
'./table-columns'` — is ordinary and correct.

**Anything naming an attribute to the server uses the definition id, never the
display name.** That is `conditionName`'s `categoryId.definitionId` for a
filter, and it is also the `aggregate` descriptor on `aggregateAttributeValues`
— whose field is spelled `name` but holds `definitionId`, which is exactly the
sort of thing that invites a helpful correction. Substituting the label there
matches nothing and fails silently: no error, an empty result or a zero sum.

Locally it is the other way round. Keys into a sample's value map are
`categoryId::name`, because that is what the read hands back. So the question
is not which field is called what, but which side of the wire the value is
going to.

**Sampling must not be swallowed.** `SAMPLE_LIMIT` bounds reads, and where a
figure is derived from a sample, `truncated` travels with it and is surfaced.
A figure from a sample is a different claim from one over the population, so
dropping the flag on the floor is a correctness bug, not a tidy-up.

`truncated: false` is not automatically a dropped flag, though. Some reads are
exact either way: they use the shared sample when it is complete and fall back
to server-side counts when it is not, so neither path is an extrapolation.
`coverage` carries no flag at all, and `crossTab` and `enumDistribution` set
`false` on every path because their counts are exact. That list is what is
true today rather than a guarantee — check which of the two shapes a function
has before calling a `false` an oversight.

**Status is never colour alone.** Every state carries a word as well as a hue.

**The two theme ramps are different colours.** `--ord-0…5` are *not* the same in
light and dark; the light ramp starts mid-toned and the dark one starts
near-white. Anything that puts ink on a ramp step must take it from
`--on-ord-0…5`, which is defined beside the ramp, and never from
`--text-primary` or `--surface-1` — those swap with the theme and hand each end
of the ramp the other end's ink. That was a 1.11:1 contrast defect.

## The compiler settings a suggestion has to satisfy

`strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
`noImplicitOverride` and `isolatedModules`. In
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
  layouts without a live tenant, since the app connects before it renders and
  there is no session here. It imports one real module — `src/ui/rail.ts`, so
  the breakpoint decision is the app's own — and the rest of each view is its
  `innerHTML` template pasted in and filled with representative strings. So the
  stylesheet is live — it links `../src/app.css`, which is why it lives in the
  repo — and the markup is a copy. A CSS change reaches it; a template change
  does not. Markup here that has drifted from its module is worth flagging; its
  being a copy is not.

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
