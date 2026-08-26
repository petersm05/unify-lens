import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';
import type { Session } from '../sdk/client';
import { scopeFor, type FilterStore } from '../data/filter';
import { labelFor } from '../sdk/metamodel';
import { busy } from './busy';
import { must } from './dom';

export interface Hit {
  readonly id: UUID;
  readonly name: string;
  readonly type: string;
}

export interface SearchBox {
  destroy(): void;
}

const DEBOUNCE_MS = 250;
const RESULTS = 12;

/**
 * Full-text object search.
 *
 * `searchTerm` is matched server-side, and `orderBy: { score: 'DESC' }` ranks by
 * relevance — which the SDK only permits when a non-blank term is set, so the
 * ordering is applied conditionally rather than always.
 */
export function mountSearch(
  container: HTMLElement,
  session: Session,
  onPick: (hit: Hit) => void,
  options: {
    readonly type?: ObjectType;
    readonly placeholder?: string;
    /** When given, results honour the app-wide filter. */
    readonly filters?: FilterStore;
  } = {},
): SearchBox {
  container.innerHTML = `
    <div class="search">
      <input type="search" autocomplete="off" spellcheck="false"
             placeholder="${options.placeholder ?? 'Search objects…'}"
             aria-label="Search objects" />
      <ul class="hits" role="listbox" hidden></ul>
    </div>
  `;

  const input = must(container.querySelector<HTMLInputElement>('input'), 'search: input');
  const list = must(container.querySelector<HTMLElement>('.hits'), 'search: results');

  let timer: number | undefined;
  let generation = 0;

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(input.value.trim()), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  async function run(term: string): Promise<void> {
    if (term.length < 2) return close();

    const mine = ++generation;
    const active = options.filters?.get();
    const scope = active ? scopeFor(active) : undefined;
    const type = options.type ?? active?.type;

    const hits = await busy.track(
      session.kg
      .getObjects({
        filter: {
          searchTerm: term,
          orderBy: { score: 'DESC' },
          ...(type ? { types: [type] } : {}),
          ...(scope ? { attributeFilter: scope } : {}),
        },
        selector: {},
      })
      .asPages({ pageSize: RESULTS })
      .getPage(0),
    );

    // A slower earlier query must not overwrite a newer one's results.
    if (mine !== generation) return;
    show(hits.map((hit) => ({ id: hit.id, name: hit.name ?? '(unnamed)', type: hit.type })));
  }

  function show(hits: readonly Hit[]): void {
    if (hits.length === 0) {
      list.replaceChildren(Object.assign(document.createElement('li'), {
        className: 'empty',
        textContent: 'No matches',
      }));
      list.hidden = false;
      return;
    }

    list.replaceChildren(
      ...hits.map((hit) => {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.tabIndex = 0;

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = hit.name;

        const type = document.createElement('span');
        type.className = 'kind';
        type.textContent = labelFor(hit.type);

        item.append(name, type);
        item.addEventListener('click', () => {
          onPick(hit);
          close();
          input.value = hit.name;
        });
        return item;
      }),
    );
    list.hidden = false;
  }

  function close(): void {
    list.hidden = true;
    list.replaceChildren();
  }

  return {
    destroy(): void {
      window.clearTimeout(timer);
      container.replaceChildren();
    },
  };
}
