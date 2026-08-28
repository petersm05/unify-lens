# Unify Lens

An iPad-first visualization surface for the Bizzdesign Unify knowledge graph,
built on the published partner SDK (`@bizzdesign/sdk-bundle`, browser entry).

## Before it will run: the Cognito allowlist

`sdk.ensureAuthenticated()` sends the browser through the Cognito
authorization-code flow and redirects back to `callbackUrl`, which this app sets
to `globalThis.location.origin`. **That exact origin must be on the Cognito app
client's callback allowlist**, which only a Bizzdesign administrator can change.

Ask for these up front — it is the longest-lead item in the project:

| Origin | Why |
| --- | --- |
| `http://localhost:4201` | local development — 4200 is the main Unify app, so Lens sits beside it. Already allowlisted on the `mpeters` sandbox client. Override the port with `PORT=… npm run dev` |
| your staging/production origin | wherever the PWA is hosted |
| your universal-link callback | only if you later wrap this in Capacitor |

Without it, login fails with a redirect-mismatch error and nothing else in the
app is reachable.

## Setup

```bash
cp .env.example .env      # then set VITE_UNIFY_ENVIRONMENT_URL
npm install
npm run dev
```

`npm install` reads the `@bizzdesign` scope from `.npmrc` and the GitHub
Packages token from your user `~/.npmrc`. No token is committed. In CI, use
`actions/setup-node` with `registry-url` + `NODE_AUTH_TOKEN`.

Only the environment root is configured by hand —
`configFromUnifyEnvironment()` reads `<root>/env.js` and derives the AppSync and
Cognito settings from it.

## Shipping it

### Serving

`npm run build` produces a static `dist/` — no server code. Any static host will
do: S3 + CloudFront, nginx, a CDN, or a folder inside an existing site.

**One artifact serves every tenant.** Which Unify instance it talks to is read
at start-up from `config.json` beside the app, not baked in at build time:

```json
{ "environmentUrl": "https://your-environment.unify.cloud", "metaModel": "BDCore" }
```

Resolution order is `config.json` → `VITE_*` build variables (development) → a
choice saved on the device. If none of those answer, the app asks, rather than
failing with a stack trace — so it is usable on a static host nobody can
reconfigure.

Two deployment shapes worth knowing:

- **Beside the tenant** — host at `https://<tenant>.unify.cloud/lens/` and point
  `environmentUrl` at that origin. Same origin as the data, one config line.
- **Standalone** — host anywhere and set `environmentUrl` per deployment. Works
  identically; the callback allowlist below is what has to keep up.

### The pipeline

Two workflows, both needing one repository secret:

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | pull requests, and pushes to any branch but `main` | `npm run build` (`tsc --noEmit && vite build`) then `npm test` |
| `pages.yml` | pushes to `main`, or by hand | `npm test`, then the same build with `DEPLOY=1`, then publishes `dist/` to Pages |

Tests run before the deploy build rather than after, so a failing test costs a
build and not a publish.

**`PACKAGES_TOKEN` is what makes either one work.** `@bizzdesign/sdk-bundle`
lives in GitHub Packages under the bizzdesign org, and the automatic
`GITHUB_TOKEN` cannot read another org's packages — so a build with no token
dies at `npm ci` with a 401 before it compiles a line. The secret holds a PAT
with `read:packages` from an account that can see that org. Both workflows check
for it first and say so, rather than letting npm report it as a broken package.

**Pages must be set to build from GitHub Actions**, not from a branch
(Settings → Pages → Source). Serving from `gh-pages` means `deploy-pages` has
nowhere to publish and the site only changes when someone uploads a build by
hand — which is how the site came to be serving a 4 MB sourcemap beside a 1.6 MB
bundle. This repo is public, so that exposed nothing; it was just two and a half
times the app in dead weight, on something people open over cellular. `DEPLOY=1`
is what drops sourcemaps, and `pages.yml` now fails the build rather than
publish one.

A deployed artifact is tenant-neutral on purpose: the workflow builds with no
`.env` and no `config.json`, so the app asks which environment to use on first
run. Pin a deployment by dropping a `config.json` beside the built files.

### Tests

```bash
npm test          # once
npm run test:watch
```

Vitest, no browser environment and no DOM: what is covered is the pure decision
logic, which is where a wrong answer is silent rather than loud.

- **`data/chart-spec.ts`** — which marks a field combination earns. A donut only
  at two to five slices, a quadrant ahead of a scatter only when neither axis is
  money, a date and a measure landing on a trend in either order, money summed
  where a score is averaged. An incorrect mark still renders; it just
  misrepresents the data, so these are the rules worth pinning.
- **`data/filter.ts`** — one selection per attribute, charts excluding their own
  attribute so they keep every bar, and `prune()` dropping what a new type
  cannot match.
- **`format.ts`** — the compact thresholds (K starts at 1e4, not 1e3) and the
  money path.

Assertions there avoid pinning a locale. These functions call `Intl` with
`undefined`, so separators come from the runner's environment; the tests assert
what is actually ours — which suffix, how many fraction digits — rather than
`en-US` punctuation.

The `ui/` and `viz/` layers are untested. They need a DOM environment and a
separate argument about what is worth asserting about a rendered chart.

### The Cognito callback is the operational constraint

`sdk.ensureAuthenticated()` sends the browser through the Cognito
authorization-code flow and returns to `callbackUrl`, which defaults to the
app's own origin. **That exact origin must be on the Cognito app client's
callback allowlist**, and only a Bizzdesign administrator can add it.

This is per host, not per app. Every distinct place the app runs needs its own
entry, and it is the long pole in any new deployment:

| Where it runs | Allowlist entry |
| --- | --- |
| Local development | `http://localhost:4201` |
| A hosted deployment | that exact origin, e.g. `https://lens.example.com` |
| Installed PWA | the same origin — installing changes nothing |
| Capacitor build | its custom scheme or universal link |

### Testing on a device

**The LAN address does not work, and cannot be made to.** `npm run dev` serves
on `http://192.168.x.x:4201` and the iPad can reach it, but login will not
complete: Cognito accepts an `http` callback **only** for `localhost`, so that
origin can never be added to the allowlist. Everything up to the sign-in
redirect works; the return trip fails.

Testing on a device therefore needs an **https origin**, and that origin has to
be allowlisted once. Two ways:

1. **A tunnel** (`ngrok http 4201`). Quickest, but a free ngrok hostname changes
   on every restart, and each new hostname needs the administrator again — so
   this is only practical with a reserved domain (`ngrok http --url=<yours> 4201`).
   Vite rejects unrecognised `Host` headers, so tunnel domains are listed in
   `vite.config.ts`; without that a tunnel answers 403 before reaching the app.
2. **A static deploy** to a fixed URL — `npm run build`, upload `dist/`, add a
   `config.json`. One allowlist entry, permanently. This is also what production
   looks like, so nothing is thrown away.

Either way, ask for the origin to be added to the Cognito app client's callback
URLs **before** picking up the iPad — it is the only step that needs someone
else.

A tunnel puts the app on the public internet. The data behind it still requires
a Cognito login, so what is exposed is the shell, not the graph — but it is
worth closing the tunnel when you are done rather than leaving it up.

### On an iPad

**Today, as a PWA.** Open it in Safari and Add to Home Screen: it launches
without browser chrome (`display: standalone`), keeps its own icon, and the
OAuth flow works unchanged because the origin has not changed. This needs no
Apple Developer account, no review, and no build step — and it is how the app
should be evaluated first.

**As a real `.ipa`, with Capacitor.** Worth it only when you need App Store or
MDM distribution, an icon pushed to managed devices, or native capabilities. It
adds: an Apple Developer account, Xcode, a release process — and one thing that
is easy to miss, **a new redirect URI**. A Capacitor app is not served from an
https origin, so it must authenticate against a custom scheme or an associated
universal link, and that URI needs adding to the Cognito app client before the
first build will get past login.

The PWA is not a stepping stone that gets thrown away: Capacitor wraps the same
`dist/`, so the work is the wrapper and the redirect, not the app.

### Brand

`scripts/make-icons.mjs` renders every icon size from the mark — a ring with one
segment lifted out, which is the app's own donut. It is written against Node's
`zlib` with no image library, because a build step that needs ImageMagick
installed is a build step that rots. Re-run it after changing the mark:

```bash
node scripts/make-icons.mjs
```

## What is here

| Path | What it does |
| --- | --- |
| `src/sdk/client.ts` | Connect + authenticate once per page load; query batching on |
| `src/sdk/metamodel.ts` | Per-metamodel type and role lists, display labels |
| `src/data/population.ts` | Count fan-out, `sum` aggregation, streaming sync |
| `src/data/cache.ts` | IndexedDB store, indexed by object type |
| `src/data/live.ts` | `CREATE_*` / `UPDATE_*` subscriptions |
| `src/data/attributes.ts` | Attribute schema, enum counts, numeric histograms |
| `src/data/analysis.ts` | The shareable description of a screen |
| `src/data/chart-spec.ts` | Field types → the marks worth offering |
| `src/data/saved.ts` | Saved analyses, on this device |
| `src/data/sample-store.ts` | One population read, shared by every derivation |
| `src/data/filter.ts` | The cross-filter every view reads |
| `src/data/view-writer.ts` | Writes a graph back to Unify as a view |
| `src/ui/detail-sheet.ts` | The record slide-over |
| `src/ui/search.ts` | Relevance-ranked object search |
| `src/viz/bars.ts` | Shared single-series bar list, legend + table view |
| `src/data/object-detail.ts` | Everything the graph holds about one object |
| `src/data/object-table.ts` | Paged, searchable, sortable object rows |
| `src/viz/object-table.ts` | The table that replaces the chart legend once filtered |
| `src/viz/scatter.ts` | Canvas scatter for two measures |
| `src/viz/donut.ts` | Part-to-whole ring, gated to five slices |
| `src/viz/type-bars.ts` | Population — KPI row over ranked bars, live-updating |
| `src/viz/attribute-insight.ts` | Attributes — two-pane schema-driven explorer |
| `src/viz/ego-network.ts` | Touch ego network — search, tap to expand, drag, pinch |
| `src/viz/theme.ts` | Palette roles read from CSS |
| `src/format.ts` | Number formatting, shared by data and view layers |

Three views:

- **Population** — headline figures over a ranked breakdown by object type. Tap a
  type to explore it in the network.
- **Attributes** — pick an object type and the app lists what the metamodel
  declares for it, then charts whichever attribute you pick: an enumeration
  becomes an ordered bar chart, a numeric attribute a histogram with an exact
  server-side total, quantiles, and a ranked list of the highest-valued objects.
  Every attribute also gets a coverage meter — what fraction of the population
  carries a value at all, which changes how much the distribution above it is
  worth. The declared type picks the chart, so there is no chart configuration
  to fill in.
- **Network** — search for a starting object, then tap nodes to expand the graph
  outward. Drag to reposition, pinch to zoom, and save the result back to Unify
  as a view.

### How a chart gets chosen

**Users pick fields, never chart types.** The metamodel already declares what
each attribute is, so `chart-spec.ts` derives which marks are meaningful, picks
the first for you, and offers only the valid alternates as a switch. A gallery
of every chart type — where most options misrepresent the data you selected —
is what makes BI tools tedious.

| Fields | Marks offered |
| --- | --- |
| one categorical | Donut when there are ≤ 5 values, else Bars |
| one quantitative | Histogram |
| one temporal | Over time — counts per period, as columns (period selectable) |
| two categorical | Grid — a cross-tab of counts |
| one free-text | Most common — value counts, when the cardinality allows |
| two quantitative | Quadrant (leads for two scores), Scatter |
| categorical + quantitative | Total (or Average) by category; Donut when the measure is money; Counts |

Consequences worth knowing:

- **Bars are horizontal**, not vertical, because EA type and value names are
  long. Vertical columns are for time, which this metamodel does not yet expose
  as a chart dimension.
- **Donut leads for a small enumeration** — it is a part-to-whole before it is a
  ranking — and is withheld above five values, where angles stop being
  comparable. It excludes "Not set" from the ring: that is the absence of a
  value, not one of the values, and the coverage meter already accounts for it.
- **A grouped ring is offered only for an additive measure.** Share of total
  spend by criticality is a real question; a ring of *averages* would invent a
  whole that does not exist, so scores get bars only.
- **Slices filter, exactly as bars do.** Selecting one keeps its hue and sends
  the rest — and their legend swatches — to the de-emphasis grey. Fading by
  opacity instead breaks whenever the lightest ramp step is the one selected.
- **The ring keeps the whole; the figures follow the selection.** Selecting
  *Administrative* leaves all five slices drawn, but the headline becomes
  "Total in Administrative — €12,2M", the second tile becomes its share of the
  total, and the hole turns into a readout for that slice. A donut whose centre
  reported the whole while a slice was selected was answering a question nobody
  had just asked.
- **The quadrant is derived, never named.** It splits both axes at their
  **median** — nothing is keyed to particular attribute names, because which
  attributes exist differs per customer. Any two numeric attributes make a grid.
  Tapping a quadrant selects both halves at once, one condition per axis,
  AND-combined by the filter store.
- **The corners carry no labels.** The axis titles and ticks already state which
  quadrant is which, so anything written there restates the geometry. The count
  for a selected quadrant lives in the figures above the chart, where it is read
  once instead of four times.
- **Bubble area is opt-in unless it is unambiguous.** It auto-selects only when
  exactly one money attribute is free; this environment has three, so it stays
  Uniform until chosen. Picking "the first money attribute" would encode an
  arbitrary choice as if it meant something. Area, not radius — scaling the
  radius would overstate a large value by its square.
- **Scores land on a lattice**, so a deterministic sub-unit jitter separates
  points that share coordinates. It never moves a point across a gridline or a
  quadrant boundary.
- **Time runs left to right.** Periods get *columns*, not the horizontal bar
  list used everywhere else — laying periods out top-to-bottom turns a trend
  into a ranking. Granularity follows the span: months for a couple of years,
  quarters for a decade, years beyond, because a fixed choice either crushes a
  long history into one bar or scatters a short one across hundreds. Labels thin
  out past ~12 columns rather than overlapping or rotating.
- **Free text is charted by frequency.** Many "string" attributes are
  categorical in practice — vendor, domain, licence model — and their value
  counts are the only sensible chart. The subtitle states how many distinct
  values exist, so a genuinely free-text attribute is obvious from the count
  rather than silently rendering a meaningless top-12.
- **Long-tailed axes go logarithmic**, decided by *where the median lands*
  rather than by a skew ratio — that is the thing that actually goes wrong. On a
  long-tailed measure a linear axis pushes the median against an edge, and a
  quadrant split there produces three empty slivers instead of four comparable
  regions. So if the median sits outside the middle of a linear axis and a log
  axis would bring it closer to centre, the axis goes log. (A ratio threshold
  was the first attempt and got this wrong: Annual Cost at 12× max-to-median
  fell under a 20× cut-off while still putting its median at the very bottom.)
  The axis title then always says *(log scale)* — an unannounced log axis makes
  a long tail look linear and understates every large value. Ticks are thinned
  to decades, since d3 hands back every minor tick over a short span.
- **Highlighting, not colouring, for categories.** A scatter is an all-pairs
  form: every category must be distinguishable from every *other*, and this
  palette cannot do that. The validator rejected every three-hue combination
  drawn from the textile — its hues are deliberately muted and sit close
  together, which is what makes it good for a single-hue ramp and useless for
  categorical separation. So *Highlight by* paints one selected value in the
  accent and recedes the rest to the de-emphasis grey. One hue plus grey always
  passes, and it works for twelve categories as readily as three.
- **Highlighting is not filtering, and stays separate.** A filter removes
  objects; a highlight marks a subset while everything else stays on screen.
  That difference is the whole point — "where do the SaaS ones sit in the
  estate?" needs the rest of the estate visible, and filtering to SaaS would
  delete the context that makes the answer legible (and leave every remaining
  point highlighted). The bridge is explicit instead: while a highlight is
  active a *Filter to X* chip appears, which applies the filter and clears the
  highlight, since once the population **is** the subset, marking it says
  nothing.
- **Axis titles sit horizontally above the plot**, not rotated down the side. A
  rotated title shares a narrow gutter with the tick labels, so any change in
  their width — a currency prefix, a larger magnitude — puts the two on top of
  each other. The left gutter is still measured from the widest tick label each
  render; moving the title out of it removed the collision entirely rather than
  making the arithmetic tighter.
- **Scatter is one hue.** Colouring by a third field is possible but an
  all-pairs form caps at three categories before colour-vision separation
  fails, so it is left out rather than offered and quietly broken.
- **Total by category** is the one true group-by the backend can express: one
  `aggregateAttributeValues` call per category value, no objects fetched. On
  this sandbox the five groups sum to €87.4M — exactly the ungrouped total.

Adding a mark means adding a row to `marksFor()` and a renderer. A custom D3
visualization plugs in the same way: it is a renderer keyed by a mark name, and
the field-type table decides when it is offered.

### The object table

Right-click a cell — or long-press on a tablet — to narrow to or exclude the
value under the pointer. Enumerations are the awkward case there: the cell shows
a label but the backend filters on the value's **id**, so the label is mapped
back through the definition.

`Created` is opt-in and always last: a record date is provenance, not something
a table is read for.

With no filter, the panel under a chart is the distribution as a table. **Once a
filter is set that gives way to the objects themselves** — a bucket-count table
is answering a question nobody is asking any more.

It opens on Name, Created and **the attribute currently being charted**, so the
values you were just looking at are there without opening the column picker.
There is no Type column — the table is always scoped to one object type, so it
would repeat a single value down every row. It is searchable (server-side
`searchTerm`, composed with the active filter), paged 25 at a time, and further
columns come from the same attribute schema the charts use.

Sorting goes to the server wherever the server can be trusted:

| Column | Sorted |
| --- | --- |
| Name, Type, Created | server — correct ordering across the whole result set |
| string / text / enum attributes | server — `orderBy.attributeValue` compares text, which is right for text |
| numeric, money, date attributes | **client-side over a bounded read** |

That last row is not a shortcut. `orderBy.attributeValue` compares values as
strings, so on a numeric column the backend ranks 97,000 above 1,900,000 without
raising an error. Those columns are therefore sorted here instead.

**The UI says nothing about any of this.** Where the work happened is not the
reader's problem — the only note that ever appears is when a client-side ranking
could not see the whole population, because that is the one case where what is
on screen might be incomplete. Sorting a column the backend orders badly is a
bug to work around, not a caveat to make the user carry.

### Layout

Cards on a page plane, not one flat surface. **Charts stay on `--surface-1`** —
that is the surface every palette check was validated against — and the plane
behind the cards is a separate token, so raising the cards never changes the
ground a mark is measured against.

The attribute rail groups by category under sticky headings. It previously
repeated the category on all forty-odd rows, which spent a lot of ink saying the
same thing and left nothing to scan by.

Chart controls sit on one row under a hairline, below the title rather than
above the figures. Stacked full-width selects pushed the chart below the fold on
every single load.

All three views share the language: Population uses the same plane and cards,
and the network's floating controls adopt the card radius. The graph canvas
itself stays on `--surface-1` for the same reason the charts do — its hop ramp
was validated against that surface.

Tables live *inside* a card rather than being one: a `<caption>` renders outside
the table's background box, so styling the table as the card dropped the caption
onto the plane behind it.

### Number formatting

Magnitude suffixes are fixed at **K / M / B**; everything else — digits,
decimal and group separators, currency symbol and its placement — comes from the
viewer's locale.

`Intl`'s own `notation: 'compact'` is locale-*correct* but not self-consistent:
Dutch CLDR renders thousands as `K` and millions as `mln.`, so a single view ends
up reading "€ 196K" beside "€ 87,4 mln.". The suffix is therefore applied by
hand and spliced into the number part of `formatToParts()`, which keeps symbol
placement right in every locale — `€ 87,4M` in Dutch, `$87.4M` in English.

Centre labels inside the donut are **measured** with `getComputedTextLength()`
and scaled to fit the hole, not estimated from character count: `€ 87,4 mln.`
and `1.234.567` are the same length and nowhere near the same width.

### Motion

Entrance animation is there to show data arriving, not for decoration: bars grow
out of the baseline on a capped stagger, headline figures count up through the
same formatter they end on, the ring sweeps clockwise from twelve o'clock, and
scatter marks grow from a point so a dense cluster resolves rather than flashes.
All of it is skipped under `prefers-reduced-motion`.

The bigger perceived-speed win is not animation: a mark switch reuses the last
distribution instead of re-querying, which took switching between Donut and Bars
from roughly 800 ms to 150 ms. A control that pauses reads as the app thinking
rather than responding.

### When there is nothing to rank

A bounded score puts dozens of objects on the same maximum. "Highest values"
then renders ten identical full-length bars, which say nothing except which ones
the sample happened to reach first — the ranking is an artefact, not a finding.

So when the whole leading group shares one value the chart drops the ranking and
becomes a **roster**: the heading states the value, the caption states how many
share it, and the names are listed as chips. The names are the only information
left, so they are what gets shown. Past 24 names a "+N more" chip filters to
that value and hands the rest to the object table, which is built to page
through them.

### The record sheet

Tapping a row in the object table or a mark in a scatter opens a slide-over with
everything the graph holds about that object: description, provenance and dates,
every attribute value grouped by category, related objects grouped by role, and
the views it appears in. One `getObject` with a wide selector — related objects
come back keyed by role name already, which is the grouping a reader wants, so
no second traversal is needed.

Each chartable attribute carries a link straight to its chart: seeing one
object's value invites the obvious next question — how does that compare? With
nothing charted the attribute becomes the subject; with a compatible chart
already up it becomes the comparison.

It is a sheet rather than a route, so the chart or table that led you there is
still behind it when it closes — nothing in the app navigates away from a
selection. Related objects are links: following one replaces the sheet's
contents, so the graph can be walked without losing your place. **Show in
network** hands the object to the graph view.

Attributes the type defines but the object has no value for are counted, not
listed — "12 further attributes defined for this type but not set" says more
than twelve empty rows, and keeps the coverage question visible per-object.

### Why one read serves every chart

The selector can only request `attributeCategories` **as a whole** — there is no
per-attribute projection — so a single object arrives carrying all forty of its
values. Streaming once per *attribute* therefore re-downloaded the same payload
for every chart: switching from Annual Cost to User Count re-read the entire
estate to look at a number already in memory.

`SampleStore` reads a population once per `(type, filter)` and every derivation
works off that: histogram, quantiles, ranking, scatter pairs, date buckets and
text frequencies. Concurrent callers share one in-flight read, and a live
`CREATE_*`/`UPDATE_*` event clears it, since a chart drawn from a stale sample
would show the population as it was before the change.

A sample that ran to the end **is** the population, so coverage, enum counts and
numeric totals are computed from it rather than asked for — two `getCount()`
calls are a round trip for an answer already in memory. A *truncated* sample
proves nothing about the tail, so those still go to the server. Nothing ever
starts a population read just to avoid a count: a cold enum chart is two counts,
and streaming to dodge them would be a loss.

The read is also warmed as soon as the attribute list renders, so it overlaps
with choosing an attribute rather than following it.

Measured on a 299-object Application population (`performance.getEntriesByType`,
GraphQL requests only):

| Action | Before | After |
| --- | --- | --- |
| Switch to another attribute | full population re-read | **0 requests, ~120 ms** |
| Second/third/fourth attribute | full re-read each time | **0 requests** |
| Page a numerically-sorted table | 2 requests, ~5.0 s **per page** | **0 requests, ~0.4 s** |

Payload sizes could not be measured: the AppSync endpoint sends no
`Timing-Allow-Origin`, so `encodedBodySize` reads 0 cross-origin.

Still slow, and understood: the **first** read of a population under a given
filter (~2 s here). Applying a filter creates a second population — the chart
deliberately excludes its own filter while the table includes it — so choosing a
numeric sort right after filtering pays that cost once (~5 s). Paging and
re-sorting afterwards are free. Prefetching that second population speculatively
was rejected: it would spend a full read for a sort most sessions never ask for.

### Sharing an analysis

The whole screen — view, type, charted attribute, comparison, mark, bubble
size, highlight, and every filter — is a small spec kept in the URL. The address
bar always describes what is on screen, so a link is a share, a bookmark and a
Back button at once. Changing view pushes a history entry; adjusting a chart
replaces one, or a dozen near-identical states would bury the previous screen.

The spec is a description of a **question**, never its answer: no values, no
rows, no counts. So a link carries nothing the recipient could not already see —
their own session fetches the data with their own token — and it stays correct
as the graph changes, which a screenshot or an export does not. It is stamped
with the environment it was built against and refuses to load elsewhere, since
its filters address attributes by id and would silently match nothing.

Two details that bite:

- **`JSON.stringify` destroys a `Date`.** A date-range filter round-trips
  through a URL as a string the backend rejects, so dates are tagged on the way
  out and revived on the way in.
- **A stored filter carries its whole `AttributeChoice`**, including every value
  of an enumeration — none of which restoring needs, since the condition travels
  alongside. Trimming it took a representative link from 1309 to 965 characters.

Saved analyses live in `localStorage`: a handful of small specs, always read in
full, never queried — the simpler store is the right size. Nothing there is
shared; the link is how an analysis reaches someone else.

### Cross-filtering

Tapping a bar anywhere sets an app-wide filter, shown as removable chips under
the tabs. Tapping *Mission Critical* on Application's Business Criticality
narrows Population to those 16 applications, scopes network search to them, and
re-scopes every other attribute chart.

**Switching page keeps filters; switching object type prunes them.** A filter
addresses `categoryId.definitionId`, which belongs to one type's schema —
carried onto a type with no such attribute it can never match, so the view goes
empty and reads as broken rather than as filtered. Only the selections that
cannot apply are dropped, and the app says which: *"Dropped a filter that
Capability has no attribute for: Business Criticality: Mission Critical."*
Silently discarding them would be its own surprise. The type chip follows the
rail, so the two never disagree about which population is on screen.

Filters are held as ready-made `AttributeFilter` fragments rather than as values
re-interpreted per view, so the same slice always means the same server-side
query. Three rules keep it honest:

- **A chart keeps its full distribution when the filter is on its own
  attribute**, and emphasises the selected bar instead — otherwise picking one
  bucket erases every other bar, leaving nothing to compare against and nothing
  to click to move the selection. Everything *around* the chart (total,
  quantiles, ranking) reports the filtered slice, and the subtitle says so.
- **Coverage stays relative to the type**, never to the slice — scoped to a
  value bucket it would always read 100%, since every object in that bucket has
  a value by definition.
- The relation count is not narrowed by an object attribute filter, so its label
  changes to *Relations (all)* rather than reading as part of the slice.

### Saving a view back to Unify

`ViewDto.content` is typed `object` in the public SDK, so the diagram schema is
undocumented. `src/data/view-writer.ts` mirrors what the product itself writes,
read off existing views in the environment:

- `content` is keyed by **diagram element id** — a fresh id per shape, *not* the
  semantic object id. Each entry points at the real element through
  `semanticsId`. Getting that indirection wrong yields a view that saves cleanly
  and then renders empty.
- Nodes are `graphicKind: 3` with a `layout: { x, y, width: 196, height: 80 }`;
  edges are `graphicKind: 2` with `sourceId`/`targetId` referencing the *shape*
  ids, plus a `style.shape.label.positionOffset[].linkFoldingStateId` block.
- `metaModelTerm` uses a colon (`BDCore:Application`) while `typeName` is the
  bare type (`Application`).
- `kind` and `definition` are empty strings on product-written views.

> **Unverified against a live environment.** The schema above was read from
> views the sandbox already contained, and the payload typechecks, but no view
> has been created from this app yet — press **Save to Unify** on a graph and
> confirm it opens correctly in Unify before relying on it.

## Things the SDK's shape forced

**Counts are a fan-out, not an aggregate.** `aggregateAttributeValues()` does
exactly one thing: `sum` of a single numeric attribute over a filter. There is
no group-by and no count aggregate. So a by-type breakdown is one
`getObjects(...).getCount()` per type — none of which fetch items — issued
together and folded into a single HTTP request by `queryBatching`.

**Expansion must be `normalized`.** `getNeighboringRelationsOfObjects` defaults
to `directionHandling: 'original'`, which only returns relations where the given
ids are the *source*. An ego network needs both ends, so it passes
`'normalized'`.

**Everything lazy stays lazy.** `getObjects()` and
`getNeighboringRelationsOfObjects()` return a `Result`, not a promise — nothing
is requested until `stream()`, `asPages()`, or `getCount()` is called.

**There are no delete events.** The realtime feed emits `CREATE_*` and
`UPDATE_*` only. Anything that has to notice removals re-counts, or reads
`kg.auditLogs()`, which returns a snapshot of each deleted object as it was.

**Attributes are addressed by id, not by name.** An `attributeFilter` condition
takes a single qualified string, `` `${categoryId}.${definitionId}` `` — a bare
attribute name is rejected with *"Name must contain at least the category and
the attribute name"*, and the second half is the definition's **id**, not its
display name. `aggregateAttributeValues()` splits the same address across
`{ categoryId, name }`, where `name` is again the definition id. That one fails
quietly: a ref that matches nothing returns `sum: 0` rather than an error, so a
wrong id is indistinguishable from a real total of zero. Both conventions are
undocumented; they come from how the main Unify frontend builds its filters.

**`orderBy.attributeValue` sorts as text.** Ranking a numeric attribute
server-side puts 97,000 above 1,900,000, because the values are compared as
strings. There is no error — the page just comes back in the wrong order. The
attribute views therefore rank client-side from the streamed sample and say so,
rather than trusting the server ordering. `orderBy: { name }` and
`orderBy: { score }` are unaffected.

**Views are not re-renderable.** `ViewDto.content` is typed `object` in the
public surface, so there is no node geometry to read. `objectReferences` and
`relationReferences` are reliable — lay them out yourself.

## Colour

The palette is derived from a printed floral textile — cream ground, terracotta,
ochre, sage, deep teal. Roles:

| Role | Hue | Why |
| --- | --- | --- |
| Accent / magnitude | deep teal | the one cool anchor in a warm palette, so data reads as data against the ground |
| Ordinal scales | terracotta | enum values in metamodel order; a different hue from the accent so an ordered scale never reads as more of the same measure |
| Graph hop distance | teal | distance from the focus |
| Status | **unthemed** | good / warning / serious stay fixed by design, so a state never impersonates a series colour |

Every ramp was re-run through the palette validator **against these surfaces**.
That matters: a cream ground is darker than white, so a ramp that clears the 2:1
light-end floor on `#fcfcfb` does not automatically clear it on `#faf5ea`. Two
of the first drafts failed exactly there and were re-stepped.

Text on the accent uses an `--on-accent` token rather than white: white on the
dark-mode teal measures 3.16:1, which fails for anything at body size. It flips
to the cream ink in light mode (6.06:1) and the dark ink in dark mode (5.30:1).

One caveat worth knowing: `status-serious` (`#ec835a`) now sits close to the
terracotta ramp. Status colours are fixed by the design system precisely so they
never drift, and the mitigation is the one already in place — every status ships
with a word beside it ("Well covered" / "Partial" / "Sparse"), never colour alone.

Attribute kinds carry icons rather than repeating the type as text. `money` is
the exception: it renders the real currency symbol, derived from the code the
metamodel supplies via `Intl`, so a USD or GBP environment shows $ or £ rather
than a hard-coded €.

If you swap in Bizzdesign brand ramps, re-run the palette validator against the
new values rather than eyeballing them.

## Next

- Cross-filter: translate a brushed selection into an `attributeFilter` /
  `roleFilter` and re-query rather than filtering the cache.
- Date attributes: bucket by month/quarter for a change-over-time view.
- Colour graph nodes by an attribute value once a type is pinned, keeping hop
  distance as size or ring.
- `createView()` + `publishView()` to write an iPad-built visualization back
  into Unify.
- Capacitor shell for App Store distribution and offline launch.
