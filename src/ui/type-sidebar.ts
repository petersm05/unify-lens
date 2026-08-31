import type { ObjectType } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { countsByType } from '../data/population';
import { labelFor, objectTypesFor } from '../sdk/metamodel';
import { formatCount } from '../viz/theme';
import { must } from './dom';

export interface TypeSidebar {
  /** Moves the highlight without re-reading the counts. */
  setCurrent(type: ObjectType | undefined): void;
  destroy(): void;
}

/**
 * The population, as a column beside whatever it led to.
 *
 * On a phone the trail collapses and you go back to change the type. There is
 * no reason to make someone do that on a screen with room for both levels at
 * once — a split view is the same trail, laid flat — so above the breakpoint
 * the level above the current one becomes a column and the back button, having
 * nothing left to reveal, goes away.
 *
 * Counts are read without the attribute filter on purpose: this column is how
 * you leave the current question, so it should describe the whole population
 * rather than the slice the question narrowed it to.
 */
export function mountTypeSidebar(
  container: HTMLElement,
  session: Session,
  current: ObjectType | undefined,
  onPick: (type: ObjectType) => void,
): TypeSidebar {
  container.innerHTML = `
    <h2 class="rail-head">Population</h2>
    <div class="type-list" role="list"></div>
  `;

  const list = must(container.querySelector<HTMLElement>('.type-list'), 'type sidebar: list');

  /**
   * By name, not by size.
   *
   * The population screen ranks types by count because it is answering "what is
   * this graph made of". This column answers "take me to Applications", which
   * is a lookup — and ranking by a number that arrives after the list is drawn
   * would reorder the rows under whoever was already reaching for one.
   */
  const types = [...objectTypesFor(session.metaModel)].sort((a, b) =>
    labelFor(a).localeCompare(labelFor(b)),
  );
  let selected = current;
  let live = true;

  // Drawn from the metamodel first so the column is complete and clickable
  // before any query answers; the counts fill in behind it.
  render(new Map());

  void countsByType(session.kg, types, undefined)
    .then((counts) => {
      if (!live) return;
      render(new Map(counts.map((entry) => [entry.type, entry.count])));
    })
    .catch(() => {
      // The names are the navigation; a missing count costs nothing that
      // stops someone getting where they were going.
    });

  function render(counts: Map<ObjectType, number>): void {
    list.replaceChildren(
      ...types.map((type) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'type-item';
        item.setAttribute('role', 'listitem');
        item.setAttribute('aria-current', String(type === selected));

        const name = document.createElement('span');
        name.className = 't-name';
        name.textContent = labelFor(type);

        const count = document.createElement('span');
        count.className = 't-count';
        const value = counts.get(type);
        count.textContent = value === undefined ? '' : formatCount(value);

        item.append(name, count);
        item.addEventListener('click', () => onPick(type));
        return item;
      }),
    );
  }

  return {
    setCurrent(type: ObjectType | undefined): void {
      selected = type;
      list.querySelectorAll<HTMLElement>('.type-item').forEach((item, index) => {
        item.setAttribute('aria-current', String(types[index] === selected));
      });
    },

    destroy(): void {
      live = false;
      container.replaceChildren();
    },
  };
}
