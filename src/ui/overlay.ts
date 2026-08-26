/**
 * Where overlays attach.
 *
 * Every palette token is declared on `.viz-root`, so anything appended to
 * `document.body` renders with all of them undefined — a transparent panel with
 * unstyled text. Overlays are fixed-position, so nesting them inside the root
 * costs nothing and keeps them inside the cascade.
 */
export function overlayHost(): HTMLElement {
  return document.querySelector<HTMLElement>('.viz-root') ?? document.body;
}
