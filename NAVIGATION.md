# Epic: Trail navigation, with a Canvas lens for the network

Lens spends ≈186pt of an iPhone screen on chrome before the first chart pixel:
a 60pt header, a 60pt segmented control and a 66pt filter tray. This epic
replaces that with a navigation stack, and gives the ego network the full-bleed
canvas treatment it actually needs.

Design study: <https://claude.ai/code/artifact/971d65c3-c03e-4233-b066-fc134fc9ab2d>

## The shape

Population, Attributes and Network are not three places — they are three stages
of one question. `show()` already treats picking a type as "start a new
question" and then jumps to Attributes. That is a push, described as a tab.

    Population  ──pick a type──▶  Attributes(type)  ──pick a record──▶  Record
                                                    ──show in network─▶  Network(focus)

- **Phone** — a navigation stack. Back button carries the trail, so the type
  filter stops needing a chip. The charted attribute becomes the nav-bar title
  menu. Verbs (Filter, Chart options, Share) move to a 44pt bottom toolbar.
- **≥820px** — the same trail laid flat: each level of the stack is a column.
  This is what `.split` is already half-way to being.
- **Network, everywhere** — full-bleed canvas, no chrome above it. Floating
  panels instead: inspector, lens bar, and a palette on wide screens.

## Sub-tasks

- [x] **NAV-1 — Route model.** A `Route` union and a `RouteStack` with
      push/pop/replace/subscribe, in `src/data/route.ts`. Replaces the
      `ViewId` + `show()` pair in `shell.ts`.
- [x] **NAV-2 — Analysis carries a path.** `Analysis` gains optional `path`;
      `decode` maps a legacy `view` onto a stack so existing shared links keep
      working, and `encode` keeps writing `view` for older cached builds.
- [x] **NAV-3 — Shell rewrite.** Nav bar (back · title · overflow) and bottom
      toolbar replace `header.bar` + `nav.tabs`. Route drives the title, the
      back label and which view is mounted.
- [x] **NAV-4 — Attribute picker becomes the title.** `attribute-insight`
      exposes its attribute list; the shell raises it from the nav-bar title.
      The rail's object-type select goes away — the type is the route.
- [x] **NAV-5 — Chart options move to the toolbar.** The existing
      `.menu-panel` is raised from the toolbar rather than from the card head;
      `.menu-btn` in the chart card is removed.
- [x] **NAV-6 — Filter leaves the shell.** Chips render inside the scrolling
      pane; the toolbar gets a Filter button with a count badge.
- [x] **NAV-7 — Split view ≥900px.** The population becomes a column beside
      the attribute screen (`type-sidebar.ts`), picking a type *replaces* rather
      than pushes, and the back button hides when its level is already visible.
- [x] **NAV-8 — Canvas network lens.** The graph runs edge to edge with the
      nav bar laid over it in glass; chips, HUD, legend and the toolbar all
      float on the canvas rather than standing on it.
- [x] **NAV-9 — Wire the pushes.** Population's `onSelectType`, the detail
      sheet's *Show in network* and *Chart this attribute* are route pushes.
- [x] **NAV-10 — CSS.** `nav.tabs`, `header.bar`, `.menu-btn` and `.share-btn`
      are gone; nav bar, toolbar, split columns, raised rail and the canvas
      overlays are in.

## What was built differently from the study

- The network keeps the ego view's existing floating HUD, finder and legend
  rather than gaining a detented bottom sheet. They were already floating over
  a full-bleed canvas — the change that mattered was getting the shell's bars
  off the top and out of the way.
- The toolbar is not hidden on the network lens, it floats: hiding it would
  have put Share out of reach on the view most worth sharing.
- The split breakpoint is 900px rather than 820px. `.split` inside the
  attribute view already turns at 820px, and stacking a second column at the
  same width left three columns in 820 points.

## Not verified end to end

The dev server sits behind Cognito, so the running app was not driven through
a real session. Types compile, the production build is clean, and the shell
chrome was checked in the browser at 375 × 812 and 1180 × 820 against a static
harness — nav bar, raised rail, split columns and the canvas overlay. The
data-driven paths (counts in the new population column, restoring a legacy
`?a=` link) still want a pass against a live environment.

## Notes

- `filters.clear()` on a fresh tab becomes "popping to root clears the
  filters" — same intent, expressed by the stack.
- The type filter is still set on `FilterStore` (every view reads it), it just
  stops being rendered as a removable chip: the back button names it instead.
- Shared links must rebuild a stack rather than set a tab index, which is the
  main cost of this design.
