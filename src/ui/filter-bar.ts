import type { FilterStore } from '../data/filter';

/**
 * The active filter, shown as removable chips.
 *
 * A cross-filter that is invisible is a trap — every view is narrowed and
 * nothing says so. The bar only occupies space while a filter is set.
 *
 * The object type is not one of those chips any more. It is the screen you
 * pushed, and the back button already names it; a chip saying the same thing
 * would be the third control on screen describing one choice, and removing it
 * would leave the view sitting on a type it claimed not to be filtered to.
 */
export function mountFilterBar(container: HTMLElement, filters: FilterStore): () => void {
  const bar = document.createElement('div');
  bar.className = 'filter-bar';
  bar.hidden = true;
  container.append(bar);

  const unsubscribe = filters.subscribe(render);
  render();

  function render(): void {
    const { attributes } = filters.get();

    if (attributes.length === 0) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }

    bar.hidden = false;

    // One chip per attribute — they stack, so each is removable on its own.
    const chips = attributes.map((selection) =>
      chip(selection.label, () => filters.deselect(selection.choice)),
    );

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'clear-all';
    clear.textContent = 'Clear all';
    // Only the attribute selections: clearing the type would strand the view on
    // a screen whose whole subject had just been removed from under it.
    clear.addEventListener('click', () => {
      for (const selection of attributes) filters.deselect(selection.choice);
    });

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
