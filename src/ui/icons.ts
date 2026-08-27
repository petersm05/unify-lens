import type { AttributeKind } from '../data/attributes';

/**
 * The symbol for a currency code, from the platform's own data.
 *
 * Hard-coding € would be wrong the moment an environment stores USD or GBP, so
 * the glyph is derived from the code the metamodel supplies.
 */
export function currencySymbol(currency: string | undefined): string {
  if (!currency) return '¤';
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Inline SVG paths, drawn in `currentColor` so they inherit the palette. */
const GLYPHS: Partial<Record<AttributeKind, string>> = {
  integer: '<path d="M5 7h10M4 12h10M7 3l-2 12M12 3l-2 12"/>',
  real: '<path d="M5 7h10M4 12h10M7 3l-2 12M12 3l-2 12"/>',
  enum: '<path d="M6 5h9M6 9h9M6 13h9"/><circle cx="3" cy="5" r="1"/><circle cx="3" cy="9" r="1"/><circle cx="3" cy="13" r="1"/>',
  date: '<rect x="2.5" y="3.5" width="13" height="12" rx="2"/><path d="M2.5 7h13M6 2v3M12 2v3"/>',
  boolean: '<rect x="1.5" y="5.5" width="15" height="8" rx="4"/><circle cx="12" cy="9.5" r="2.4" fill="currentColor" stroke="none"/>',
  string: '<path d="M3 14l4-10 4 10M4.4 11h5.2M13 6v8"/>',
  text: '<path d="M3 4h12M3 8h12M3 12h8"/>',
  reference: '<path d="M7.5 10.5a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 1 0-4.2-4.2l-.8.8"/><path d="M10.5 7.5a3 3 0 0 0-4.2 0L4.2 9.6a3 3 0 1 0 4.2 4.2l.8-.8"/>',
};

/**
 * An icon for an attribute kind.
 *
 * `money` is the exception: it renders the actual currency symbol as text, so
 * one component covers every currency the metamodel might use rather than
 * needing a hand-drawn glyph per code.
 */
export function attributeIcon(kind: AttributeKind, currency?: string): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');

  if (kind === 'money') {
    wrapper.classList.add('icon-text');
    wrapper.textContent = currencySymbol(currency);
    return wrapper;
  }

  const glyph = GLYPHS[kind];
  if (!glyph) {
    wrapper.classList.add('icon-text');
    wrapper.textContent = '•';
    return wrapper;
  }

  wrapper.innerHTML = `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
  return wrapper;
}


/** Sliders glyph for the chart options menu. */
export function controlsIcon(): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML =
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round"><path d="M2.5 5.5h4M11 5.5h4.5M2.5 12.5h6.5M13.5 12.5h2"/>' +
    '<circle cx="8.75" cy="5.5" r="2"/><circle cx="11.25" cy="12.5" r="2"/></svg>';
  return wrapper;
}


/** Funnel glyph — "narrow everything to this". */
export function filterIcon(): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML =
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2.5 4h13l-5 5.6V15l-3-1.8V9.6z"/></svg>';
  return wrapper;
}

/** Grip glyph for a row that can be dragged into a new position. */
export function dragIcon(): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML =
    '<svg viewBox="0 0 18 18" fill="currentColor" stroke="none">' +
    '<circle cx="6.5" cy="4.5" r="1.35"/><circle cx="11.5" cy="4.5" r="1.35"/>' +
    '<circle cx="6.5" cy="9" r="1.35"/><circle cx="11.5" cy="9" r="1.35"/>' +
    '<circle cx="6.5" cy="13.5" r="1.35"/><circle cx="11.5" cy="13.5" r="1.35"/></svg>';
  return wrapper;
}

/** Share glyph — a page with an arrow leaving it, as the platform draws it. */
export function shareIcon(): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML =
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 2.5v9"/><path d="M6 5.5 9 2.5l3 3"/>' +
    '<path d="M4 9.5v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5"/></svg>';
  return wrapper;
}

/** Bookmark glyph — the shelf of analyses kept on this device. */
export function savedIcon(): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML =
    '<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4.5 2.75h9a.75.75 0 0 1 .75.75v11.25L9 12.25l-5.25 2.5V3.5a.75.75 0 0 1 .75-.75z"/>' +
    '</svg>';
  return wrapper;
}

/** Overflow glyph — the menu of everything that is not a view. */
export function moreIcon(): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'icon';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.innerHTML =
    '<svg viewBox="0 0 18 18" fill="currentColor" stroke="none">' +
    '<circle cx="4" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/><circle cx="14" cy="9" r="1.5"/></svg>';
  return wrapper;
}
