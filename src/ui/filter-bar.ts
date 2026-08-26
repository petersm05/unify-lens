import type { FilterStore } from '../data/filter';
import { labelFor } from '../sdk/metamodel';

/**
 * The active filter, shown as removable chips.
 *
 * A cross-filter that is invisible is a trap — every view is narrowed and
 * nothing says so. The bar only occupies space while a filter is set.
 */
export function mountFilterBar(container: HTMLElement, filters: FilterStore): () => void {
  const bar = document.createElement('div');
  bar.className = 'filter-bar';
  bar.hidden = true;
  container.append(bar);

  const unsubscribe = filters.subscribe(render);
  render();

  function render(): void {
    const { type, attributes } = filters.get();

    if (!filters.isActive) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }

    bar.hidden = false;
    const chips: HTMLElement[] = [];

    if (type) {
      chips.push(chip(`Type: ${labelFor(type)}`, () => filters.setType(undefined)));
    }
    // One chip per attribute — they stack, so each is removable on its own.
    for (const selection of attributes) {
      chips.push(chip(selection.label, () => filters.deselect(selection.choice)));
    }

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'clear-all';
    clear.textContent = 'Clear all';
    clear.addEventListener('click', () => filters.clear());

    bar.replaceChildren(...chips, clear);
  }

  function chip(label: string, onRemove: () => void): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'filter-chip';
    element.setAttribute('aria-label', `Remove filter ${label}`);

    const text = document.createElement('span');
    text.textContent = label;

    const cross = document.createElement('span');
    cross.className = 'x';
    cross.textContent = '✕';

    element.append(text, cross);
    element.addEventListener('click', onRemove);
    return element;
  }

  return () => {
    unsubscribe();
    bar.remove();
  };
}
