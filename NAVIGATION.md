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

- [ ] **NAV-1 — Route model.** A `Route` union and a `RouteStack` with
      push/pop/replace/subscribe, in `src/data/route.ts`. Replaces the
      `ViewId` + `show()` pair in `shell.ts`.
- [ ] **NAV-2 — Analysis carries a path.** `Analysis` gains optional `path`;
      `decode` maps a legacy `view` onto a stack so existing shared links keep
      working, and `encode` keeps writing `view` for older cached builds.
- [ ] **NAV-3 — Shell rewrite.** Nav bar (back · title · overflow) and bottom
      toolbar replace `header.bar` + `nav.tabs`. Route drives the title, the
      back label and which view is mounted.
- [ ] **NAV-4 — Attribute picker becomes the title.** `attribute-insight`
      exposes its attribute list; the shell raises it from the nav-bar title.
      The rail's object-type select goes away — the type is the route.
- [ ] **NAV-5 — Chart options move to the toolbar.** The existing
      `.menu-panel` is raised from the toolbar rather than from the card head;
      `.menu-btn` in the chart card is removed.
- [ ] **NAV-6 — Filter leaves the shell.** Chips render inside the scrolling
      pane; the toolbar gets a Filter button with a count badge.
- [ ] **NAV-7 — Split view ≥820px.** Stack depth maps to columns:
      types | attributes | detail. Back button hides when its level is visible.
- [ ] **NAV-8 — Canvas network lens.** Ego network mounts full-bleed with no
      nav bar; floating inspector, lens bar and (wide only) palette. Detented
      bottom sheet on the phone.
- [ ] **NAV-9 — Wire the pushes.** Population's `onSelectType`, the detail
      sheet's *Show in network*, and *Chart this attribute* all become route
      pushes rather than tab switches.
- [ ] **NAV-10 — CSS.** Remove `nav.tabs` and the shell filter bar; add nav
      bar, toolbar, split columns and canvas/floating-panel styles.

## Notes

- `filters.clear()` on a fresh tab becomes "popping to root clears the
  filters" — same intent, expressed by the stack.
- The type filter is still set on `FilterStore` (every view reads it), it just
  stops being rendered as a removable chip: the back button names it instead.
- Shared links must rebuild a stack rather than set a tab index, which is the
  main cost of this design.
